import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Group, OfficeEvent } from "@herdr-office/core";
import { expect, it } from "vitest";
import { createApp } from "./app.ts";
import { OrganizationStore } from "./db/OrganizationStore.ts";
import { HcClient } from "./hc/HcClient.ts";
import { Company } from "./state/Company.ts";

it("persists organization settings and rolls back reassignment conflicts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "office-test-"));
  const file = join(directory, "test.sqlite");
  const store = new OrganizationStore(file);
  const company = new Company(new HcClient(), () => ({
    groups: store.listGroups(),
    overrides: store.listOverrides(),
    defaultWhenUnknown: store.defaultWhenUnknown(),
  }));
  const app = await createApp(company, store);
  try {
    const create = await app.inject({
      method: "POST",
      url: "/api/groups",
      payload: { name: "Team", spaceIds: ["space-a"] },
    });
    expect(create.statusCode).toBe(201);
    const group = create.json<Group>();
    const conflict = await app.inject({
      method: "POST",
      url: "/api/groups",
      payload: { name: "Other", spaceIds: ["space-a"] },
    });
    expect(conflict.statusCode).toBe(409);
    expect((await app.inject("/api/groups")).json()).toEqual([group]);
    const update = await app.inject({
      method: "PUT",
      url: `/api/groups/${group.id}`,
      payload: { name: "Updated", spaceIds: ["space-b"] },
    });
    expect(update.statusCode).toBe(200);
    const rule = {
      parentSpaceId: "space-a",
      childSpaceId: "space-b",
      manages: false,
    };
    const ruleUrl = "/api/hierarchy/overrides/space-a/space-b";
    expect(
      (
        await app.inject({
          method: "PUT",
          url: ruleUrl,
          payload: { manages: false },
        })
      ).json(),
    ).toEqual(rule);
    expect((await app.inject({ method: "GET", url: ruleUrl })).json()).toEqual(
      rule,
    );
    const setting = await app.inject({
      method: "PUT",
      url: "/api/hierarchy",
      payload: { defaultWhenUnknown: false },
    });
    expect(setting.statusCode).toBe(200);

    const reopened = new OrganizationStore(file);
    try {
      expect(reopened.listGroups()).toEqual([
        { ...group, name: "Updated", spaceIds: ["space-b"] },
      ]);
      expect(reopened.listOverrides()).toEqual([rule]);
      expect(reopened.defaultWhenUnknown()).toBe(false);
    } finally {
      reopened.close();
    }
    expect(
      (await app.inject({ method: "DELETE", url: ruleUrl })).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/groups/${group.id}` }))
        .statusCode,
    ).toBe(204);
    expect((await app.inject("/api/groups")).json()).toEqual([]);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("streams an initial snapshot followed by a revisioned delta", async () => {
  const store = new OrganizationStore(":memory:");
  const company = new Company(new HcClient(), () => ({
    groups: [],
    overrides: [],
    defaultWhenUnknown: true,
  }));
  const app = await createApp(company, store);
  const messages: OfficeEvent[] = [];
  try {
    await app.ready();
    const socket = await app.injectWS(
      "/ws",
      {},
      {
        onInit(ws) {
          ws.once("message", (data) =>
            messages.push(JSON.parse(data.toString()) as OfficeEvent),
          );
        },
      },
    );
    const delta = once(socket, "message");
    company.settingsChanged();
    const [message] = await delta;
    messages.push(JSON.parse(message.toString()) as OfficeEvent);
    expect(messages).toMatchObject([
      {
        type: "snapshot",
        snapshot: { revision: 0, organization: { buildings: [] } },
      },
      {
        type: "delta",
        delta: { revision: 1, buildings: { upsert: [{ id: "local" }] } },
      },
    ]);
    socket.close();
  } finally {
    await app.close();
  }
});
