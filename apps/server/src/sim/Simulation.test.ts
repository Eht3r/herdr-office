import { once } from "node:events";
import type { OfficeEvent, OfficeSnapshot } from "@herdr-office/core";
import { expect, it, vi } from "vitest";
import { createApp } from "../app.ts";
import { CompanyCalendar } from "../calendar.ts";
import { OrganizationStore } from "../db/OrganizationStore.ts";
import { HcClient } from "../hc/HcClient.ts";
import { Company } from "../state/Company.ts";
import { UsageMonitor } from "../usage.ts";
import { Planner } from "./Planner.ts";
import { Simulation } from "./Simulation.ts";
import { SimulationStore } from "./SimulationStore.ts";
import { WorkHours } from "./WorkHours.ts";

it("broadcasts the same active actions to existing sockets, new sockets, and HTTP clients", async () => {
  let now = Date.parse("2026-01-08T13:00:00+09:00");
  const store = new OrganizationStore(":memory:");
  const simStore = new SimulationStore(":memory:");
  const company = new Company(new HcClient(), () => ({
    groups: [],
    overrides: [],
    defaultWhenUnknown: true,
  }));
  const simulation = new Simulation(
    new Planner(simStore, new WorkHours(simStore, true, false)),
    new CompanyCalendar(),
    new UsageMonitor("Asia/Seoul", "/missing-example/shared.json"),
    simStore,
    { now: () => now },
  );
  const app = await createApp(company, store, simulation);
  const snapshot: OfficeSnapshot = {
    revision: 1,
    connected: true,
    organization: {
      buildings: [
        {
          id: "local",
          name: "Example",
          groups: [],
          departments: [
            {
              id: "example",
              name: "Example",
              machineId: "local",
              folder: null,
              vacantSince: null,
              leadAddress: "t1",
              departments: [],
              employees: [
                {
                  address: "t1",
                  machineId: "local",
                  spaceId: "example",
                  name: null,
                  cwd: "/workspace",
                  agent: "codex",
                  status: "working",
                  turn: 1,
                  title: "",
                  parent: null,
                  labels: {},
                },
              ],
            },
          ],
        },
      ],
    },
  };
  try {
    await app.ready();
    const events: OfficeEvent[] = [];
    const socket = await app.injectWS(
      "/ws",
      {},
      {
        onInit(ws) {
          ws.on("message", (payload) =>
            events.push(JSON.parse(payload.toString()) as OfficeEvent),
          );
        },
      },
    );
    await vi.waitFor(() =>
      expect(events.map(({ type }) => type)).toEqual(["snapshot", "actions"]),
    );
    simulation.observe(snapshot);
    const incoming = once(socket, "message");
    await simulation.tick();
    const [payload] = await incoming;
    const pushed = JSON.parse(payload.toString());
    expect(pushed).toMatchObject({
      type: "actions",
      timeline: { actions: [{ kind: "work", startAt: now }] },
    });
    now += 1_000;
    const reopened: OfficeEvent[] = [];
    const second = await app.injectWS(
      "/ws",
      {},
      {
        onInit(ws) {
          ws.on("message", (data) =>
            reopened.push(JSON.parse(data.toString()) as OfficeEvent),
          );
        },
      },
    );
    await vi.waitFor(() => expect(reopened).toHaveLength(2));
    expect(reopened[1]).toEqual({
      type: "actions",
      timeline: (await app.inject("/api/actions")).json(),
    });
    expect(reopened[1]).toMatchObject({
      timeline: { at: now, actions: pushed.timeline.actions },
    });
    socket.close();
    second.close();
  } finally {
    await app.close();
  }
});
