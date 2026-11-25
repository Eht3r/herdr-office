import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import {
  type Group,
  type OfficeSnapshot,
  type Placement,
  roomKinds,
  type Timeline,
} from "@herdr-office/core";
import Fastify, { type FastifyRequest } from "fastify";
import {
  type Access,
  createAccess,
  type RequestFacts,
  type Viewer,
} from "./access.ts";
import type { OrganizationStore } from "./db/OrganizationStore.ts";
import type { Simulation } from "./sim/Simulation.ts";
import type { Company } from "./state/Company.ts";
import {
  publicDelta,
  publicSnapshot,
  viewerSnapshot,
  viewerTimeline,
  withoutIp,
} from "./state/publicView.ts";

import type { CompanyWeather } from "./weather.ts";

const spaceId = { type: "string", minLength: 1, maxLength: 256 };
const groupBody = {
  type: "object",
  required: ["name", "spaceIds"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" },
    spaceIds: {
      type: "array",
      items: spaceId,
      uniqueItems: true,
      maxItems: 256,
    },
  },
};
const booleanBody = (key: string) => ({
  type: "object",
  required: [key],
  properties: { [key]: { type: "boolean" } },
});
type GroupBody = Omit<Group, "id">;
type OverrideParams = { parentSpaceId: string; childSpaceId: string };
const pairPath = "/api/hierarchy/overrides/:parentSpaceId/:childSpaceId";
const pairSchema = {
  type: "object",
  required: ["parentSpaceId", "childSpaceId"],
  properties: { parentSpaceId: spaceId, childSpaceId: spaceId },
};

export interface AppOptions {
  access?: Access;
  /** Built web app to serve; skipped when the folder does not exist. */
  webRoot?: string;
  /** Speech lines carry topics beyond status; strip them for the public. */
  detailedSpeech?: boolean;
}

function facts(request: FastifyRequest): RequestFacts {
  return {
    // In-process injection (tests) has no socket.
    remoteAddress: request.socket?.remoteAddress,
    host: request.headers.host,
    headers: request.headers,
  };
}

export async function createApp(
  company: Company,
  store: OrganizationStore,
  simulation?: Simulation,
  weather?: CompanyWeather,
  options: AppOptions = {},
) {
  const app = Fastify({
    logger: process.env.OFFICE_DEBUG ? { level: "error" } : false,
  });
  const access =
    options.access ??
    createAccess({ trustedNetworks: [], allowedHosts: [], publicHosts: [] });
  const detailedSpeech = options.detailedSpeech ?? false;
  const townSeed =
    process.env.OFFICE_TOWN_SEED ??
    createHash("sha256").update(hostname()).digest("hex").slice(0, 18);
  const viewers = new WeakMap<object, Viewer>();
  const viewerOf = (request: FastifyRequest): Viewer =>
    access.viewer(facts(request));
  const readSnapshot = (
    viewer: Viewer,
  ): OfficeSnapshot & {
    viewer: Viewer;
  } => ({
    ...viewerSnapshot(publicSnapshot(company.snapshot()), viewer),
    townSeed,
    viewer,
  });
  const readTimeline = (timeline: Timeline, viewer: Viewer) =>
    viewerTimeline(timeline, viewer, detailedSpeech);

  // Refuse unknown Host headers (DNS rebinding) and cross-site or public writes.
  app.addHook("onRequest", async (request, reply) => {
    const request_ = facts(request);
    if (!access.hostAllowed(request_))
      return reply.code(421).send({ message: "Unknown host" });
    if (request.method === "GET" || request.method === "HEAD") return;
    if (!access.sameOrigin(request_) || viewerOf(request) !== "owner")
      return reply.code(403).send({ message: "읽기 전용 화면입니다." });
  });

  await app.register(websocket);
  app.get("/api/me", async (request) => ({
    viewer: viewerOf(request),
    now: Date.now(),
  }));
  if (weather) app.get("/api/weather", async () => weather.read());
  app.get("/api/snapshot", async (request) => readSnapshot(viewerOf(request)));
  app.get(
    "/api/org",
    async (request) => readSnapshot(viewerOf(request)).organization,
  );

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation(request, reply, done) {
        if (!access.sameOrigin(facts(request))) {
          void reply.code(403).send();
          return;
        }
        done();
      },
    },
    (socket, request) => {
      const viewer = viewerOf(request);
      viewers.set(socket, viewer);
      socket.send(
        JSON.stringify({
          type: "snapshot",
          snapshot: readSnapshot(viewer),
        }),
      );
      if (simulation)
        socket.send(
          JSON.stringify({
            type: "actions",
            timeline: readTimeline(simulation.timeline(), viewer),
          }),
        );
    },
  );

  /** Send each socket the payload its viewer may see (built once per viewer). */
  const broadcast = (payload: (viewer: Viewer) => unknown) => {
    const encoded = new Map<Viewer, string>();
    for (const socket of app.websocketServer.clients) {
      if (socket.readyState !== socket.OPEN) continue;
      if (socket.bufferedAmount > 1_000_000) {
        socket.terminate();
        continue;
      }
      const viewer = viewers.get(socket) ?? "public";
      let message = encoded.get(viewer);
      if (message === undefined) {
        message = JSON.stringify(payload(viewer));
        encoded.set(viewer, message);
      }
      socket.send(message);
    }
  };
  company.on("delta", (delta) => {
    // Rebuild from the filtered snapshot so public sockets never see raw data.
    const shared = publicDelta(delta);
    broadcast((viewer) =>
      viewer === "owner"
        ? { type: "delta", delta: shared }
        : {
            type: "delta",
            delta: shared.buildings
              ? {
                  ...shared,
                  buildings: {
                    remove: shared.buildings.remove,
                    upsert: viewerSnapshot(
                      {
                        revision: shared.revision,
                        connected: true,
                        organization: { buildings: shared.buildings.upsert },
                      },
                      "public",
                    ).organization.buildings,
                  },
                }
              : shared,
          },
    );
    simulation?.observe(company.snapshot(), delta.messages);
  });
  company.on("screen", (address, text) =>
    simulation?.observeScreen(address, text),
  );
  simulation?.on("timeline", (timeline) =>
    broadcast((viewer) => ({
      type: "actions",
      timeline: readTimeline(timeline, viewer),
    })),
  );
  if (simulation)
    app.get("/api/actions", async (request) =>
      readTimeline(simulation.timeline(), viewerOf(request)),
    );

  app.addHook("onClose", async () => {
    simulation?.stop();
    company.stop();
    store.close();
  });
  const placementText = {
    type: "string",
    minLength: 1,
    maxLength: 100,
    pattern: "\\S",
  };
  app.put<{ Params: { id: string }; Body: Partial<Placement> }>(
    "/api/buildings/:id/placement",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            site: placementText,
            roomKind: { type: "string", enum: [...roomKinds] },
            roomName: placementText,
          },
        },
      },
    },
    async ({ params, body }, reply) => {
      const building = publicSnapshot(
        company.snapshot(),
      ).organization.buildings.find(({ id }) => id === params.id);
      if (!building) return reply.code(404).send();
      const placement = {
        ...(body.site ? { site: body.site.trim() } : {}),
        ...(body.roomKind ? { roomKind: body.roomKind } : {}),
        ...(body.roomName ? { roomName: body.roomName.trim() } : {}),
      };
      for (const value of [placement.site, placement.roomName]) {
        if (value && withoutIp(value) !== value)
          return reply
            .code(400)
            .send({ message: "건물 이름에 IP 주소를 사용할 수 없습니다." });
      }
      store.setPlacement(params.id, placement);
      company.settingsChanged();
      return { id: params.id, ...placement };
    },
  );
  app.get("/api/groups", async () => store.listGroups());
  app.get<{ Params: { id: string } }>(
    "/api/groups/:id",
    async ({ params }, reply) =>
      store.listGroups().find(({ id }) => id === params.id) ??
      reply.code(404).send(),
  );
  app.post<{ Body: GroupBody }>(
    "/api/groups",
    { schema: { body: groupBody } },
    async ({ body }, reply) => {
      const saved = store.saveGroup({
        id: randomUUID(),
        name: body.name.trim(),
        spaceIds: body.spaceIds,
      });
      company.settingsChanged();
      return reply
        .code(201)
        .header("location", `/api/groups/${saved.id}`)
        .send(saved);
    },
  );
  app.put<{ Params: { id: string }; Body: GroupBody }>(
    "/api/groups/:id",
    { schema: { body: groupBody } },
    async ({ params, body }, reply) => {
      if (!store.listGroups().some(({ id }) => id === params.id))
        return reply.code(404).send();
      const saved = store.saveGroup({
        id: params.id,
        name: body.name.trim(),
        spaceIds: body.spaceIds,
      });
      company.settingsChanged();
      return saved;
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/groups/:id",
    async ({ params }, reply) => {
      if (!store.deleteGroup(params.id)) return reply.code(404).send();
      company.settingsChanged();
      return reply.code(204).send();
    },
  );

  app.get("/api/hierarchy/overrides", async () => store.listOverrides());
  app.get<{ Params: OverrideParams }>(
    pairPath,
    { schema: { params: pairSchema } },
    async ({ params }, reply) =>
      store
        .listOverrides()
        .find(
          (rule) =>
            rule.parentSpaceId === params.parentSpaceId &&
            rule.childSpaceId === params.childSpaceId,
        ) ?? reply.code(404).send(),
  );
  app.put<{ Params: OverrideParams; Body: { manages: boolean } }>(
    pairPath,
    { schema: { params: pairSchema, body: booleanBody("manages") } },
    async ({ params, body }, reply) => {
      if (params.parentSpaceId === params.childSpaceId) {
        return reply
          .code(400)
          .send({ message: "Parent and child must be different spaces" });
      }
      const saved = store.saveOverride({ ...params, manages: body.manages });
      company.settingsChanged();
      return saved;
    },
  );
  app.delete<{ Params: OverrideParams }>(
    pairPath,
    { schema: { params: pairSchema } },
    async ({ params }, reply) => {
      if (!store.deleteOverride(params.parentSpaceId, params.childSpaceId))
        return reply.code(404).send();
      company.settingsChanged();
      return reply.code(204).send();
    },
  );

  app.get("/api/hierarchy", async () => ({
    defaultWhenUnknown: store.defaultWhenUnknown(),
  }));
  app.put<{ Body: { defaultWhenUnknown: boolean } }>(
    "/api/hierarchy",
    {
      schema: { body: booleanBody("defaultWhenUnknown") },
    },
    async ({ body }) => {
      store.setDefaultWhenUnknown(body.defaultWhenUnknown);
      company.settingsChanged();
      return { defaultWhenUnknown: body.defaultWhenUnknown };
    },
  );
  if (options.webRoot && existsSync(options.webRoot)) {
    await app.register(fastifyStatic, { root: options.webRoot });
    // Client-side routes fall back to the app shell.
    app.setNotFoundHandler((request, reply) =>
      request.method === "GET" && !request.url.startsWith("/api/")
        ? reply.sendFile("index.html")
        : reply.code(404).send({ message: "Not found" }),
    );
  }
  return app;
}
