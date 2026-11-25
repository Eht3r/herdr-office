import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Employee,
  OfficeEvent,
  OfficeSettings,
  OfficeSnapshot,
  Timeline,
} from "@herdr-office/core";
import { expect, it, vi } from "vitest";
import { createApp } from "../app.ts";
import { CompanyCalendar } from "../calendar.ts";
import { OrganizationStore } from "../db/OrganizationStore.ts";
import { HcClient } from "../hc/HcClient.ts";
import { Planner } from "../sim/Planner.ts";
import { Simulation } from "../sim/Simulation.ts";
import { SimulationStore } from "../sim/SimulationStore.ts";
import { WorkHours } from "../sim/WorkHours.ts";
import { Company } from "../state/Company.ts";
import { UsageMonitor } from "../usage.ts";
import { CompanyWeather } from "../weather.ts";
import { compileMask, defaults, SettingsStore } from "./SettingsStore.ts";

it("persists settings with env as first defaults and rejects unsafe settings without replacing them", () => {
  const directory = mkdtempSync(join(tmpdir(), "office-settings-"));
  const path = join(directory, "settings.sqlite");
  try {
    const store = new SettingsStore(path, { OFFICE_COMPANY_NAME: "Bootstrap" });
    try {
      expect(store.get().company.name).toBe("Bootstrap");
      store.save({
        ...store.get(),
        company: { ...store.get().company, name: "Configured" },
      });
      const current = store.get();
      for (const update of [
        { company: { ...current.company, latitude: 91 } },
        { company: { ...current.company, timeZone: "Fake/Zone" } },
        { work: { ...current.work, company: { 1: [900, 800] } } },
        {
          work: { ...current.work, absence: { nap: 10, sleep: 9, leave: 20 } },
        },
        {
          security: { ...current.security, trustedNetworks: ["192.0.2.0/33"] },
        },
        {
          security: {
            ...current.security,
            allowedHosts: ["https://example.test"],
          },
        },
        { security: { ...current.security, masks: ["(a+)+$"] } },
        { security: { ...current.security, masks: ["[A-Z"] } },
      ])
        expect(() => store.save({ ...current, ...update })).toThrow(RangeError);
      expect(store.get()).toBe(current);
    } finally {
      store.close();
    }
    const reopened = new SettingsStore(path, {
      OFFICE_COMPANY_NAME: "Other",
      OFFICE_COMPANY_HOURS: "malformed",
    });
    try {
      expect(reopened.get().company.name).toBe("Configured");
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("allows constrained literal or class masking with bounded runtime", () => {
  expect(
    "key=DEMO-ABC123 and DEMO-XYZ".replace(compileMask("DEMO-[A-Z0-9]+"), "X"),
  ).toBe("key=X and X");
  expect(
    "tag.123".replace(compileMask(String.raw`tag\.\d{1,3}`), "masked"),
  ).toBe("masked");
  for (const rule of ["A*", "a+a+", "[a]+$", "a{512}", "(a|b)c", "^$"])
    expect(() => compileMask(rule)).toThrow(RangeError);
});

const employee = (
  address: string,
  name: string,
  spaceId: string,
): Employee => ({
  address,
  name,
  spaceId,
  machineId: "local",
  cwd: "/fake/work",
  title: "Task DEMO-OLD123",
  agent: "codex",
  status: "working",
  turn: 1,
  labels: {},
  parent: null,
});
const people = [
  employee("agent-a", "Visible fixture", "team-a"),
  employee("agent-b", "Hidden fixture", "team-b"),
];
const snapshot: OfficeSnapshot = {
  connected: true,
  revision: 7,
  organization: {
    buildings: [
      {
        id: "local",
        name: "Example HQ",
        groups: [],
        departments: people.map((person) => ({
          id: person.spaceId,
          name: person.spaceId,
          machineId: person.machineId,
          folder: person.cwd,
          employees: [person],
          leadAddress: person.address,
          departments: [],
          vacantSince: null,
        })),
      },
    ],
  },
};
const timeline: Timeline = {
  at: 25_000,
  today: null,
  actions: people.map((person) => ({
    id: `${person.address}-action`,
    employeeId: person.address,
    kind: "talk",
    from: { kind: "desk", employeeId: person.address },
    to: { kind: "desk", employeeId: person.address },
    startAt: 25_000,
    durationMs: 10_000,
    line: "Private legacy line",
    props: {
      speech: {
        status: "Status only",
        title: "Demo title",
        messages: "Demo summary",
        raw: "Demo raw DEMO-OLD123",
      },
    },
  })),
  usage: { "agent-a": { usedPct: 80 }, "agent-b": { usedPct: 73 } },
};

it("authorizes settings, separates team audiences on HTTP and WebSocket, and hot-applies masks and location", async () => {
  const db = new OrganizationStore(":memory:");
  const settings = new SettingsStore(":memory:");
  const simStore = new SimulationStore(":memory:");
  const calendar = new CompanyCalendar();
  const hours = new WorkHours(simStore, true, false);
  const usage = new UsageMonitor("Asia/Seoul");
  const simulation = new Simulation(
    new Planner(simStore, hours),
    calendar,
    usage,
    simStore,
  );
  vi.spyOn(simulation, "timeline").mockReturnValue(timeline);
  const company = new Company(new HcClient(), () => ({
    groups: [],
    overrides: [],
    defaultWhenUnknown: true,
  }));
  vi.spyOn(company, "snapshot").mockReturnValue(snapshot);
  const weather = new CompanyWeather(
    defaults().company,
    async () => new Response(null, { status: 503 }),
  );
  const onSettings = vi.fn((settings: OfficeSettings) => {
    weather.setLocation({
      latitude: settings.company.latitude,
      longitude: settings.company.longitude,
      timeZone: settings.company.timeZone,
    });
    hours.configure(
      settings.work.enabled,
      settings.work.learn,
      settings.work.company,
      settings.work.teams,
    );
  });
  const app = await createApp(company, db, simulation, weather, {
    settings,
    onSettings,
  });
  const external = { host: "localhost", "x-forwarded-for": "192.0.2.10" };
  const put = (section: keyof OfficeSettings, payload: object) =>
    app.inject({ method: "PUT", url: `/api/settings/${section}`, payload });
  try {
    expect(
      (await app.inject({ url: "/api/settings", headers: external }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/settings/company",
          payload: {},
          headers: external,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/api/settings/security?view=public" }))
        .statusCode,
    ).toBe(403);
    expect(
      (await put("company", { ...settings.get().company, longitude: 200 }))
        .statusCode,
    ).toBe(400);
    expect(onSettings).not.toHaveBeenCalled();
    await app.ready();
    const socket = await app.injectWS("/ws?view=public");
    const frame = once(socket, "message");
    try {
      const sharing: OfficeSettings["sharing"] = {
        speech: { owner: "raw", public: "status" },
        teams: { "team-b": { owner: "title", public: "hidden" } },
      };
      expect((await put("sharing", sharing)).statusCode).toBe(200);
      const [message] = await frame;
      expect(JSON.parse(message.toString()) as OfficeEvent).toMatchObject({
        type: "snapshot",
        snapshot: {
          viewer: "public",
          organization: {
            buildings: [
              {
                departments: [
                  { id: "team-a", employees: [{ title: "" }] },
                  { id: "team-b", employees: [], leadAddress: null },
                ],
              },
            ],
          },
        },
      });
      const owner = (await app.inject("/api/actions")).json<Timeline>();
      const visitor = (
        await app.inject("/api/actions?view=public")
      ).json<Timeline>();
      expect(owner.actions.map(({ line }) => line)).toEqual([
        "Demo raw DEMO-OLD123",
        "Demo title",
      ]);
      expect(visitor.actions.map(({ line }) => line)).toEqual(["Status only"]);
      expect(visitor.usage).toEqual({ "agent-a": {} });
      expect(JSON.stringify(owner)).not.toContain('"speech"');
      expect(JSON.stringify(visitor)).not.toContain("agent-b");
      expect(
        (
          await put("security", {
            ...settings.get().security,
            masks: ["DEMO-[A-Z0-9]+"],
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject("/api/actions")).json<Timeline>().actions[0].line,
      ).toBe("Demo raw [REDACTED]");
      expect((await app.inject("/api/org")).body).not.toContain("DEMO-OLD123");
      expect(
        (
          await put("company", {
            name: "Test Office",
            latitude: 48.8,
            longitude: 2.4,
            timeZone: "Europe/Paris",
            country: "FR",
          })
        ).statusCode,
      ).toBe(200);
      expect((await app.inject("/api/weather")).json()).toMatchObject({
        location: { latitude: 48.8, longitude: 2.4, timeZone: "Europe/Paris" },
      });
      expect((await app.inject("/api/snapshot")).json()).toMatchObject({
        companyName: "Test Office",
        settingsVersion: 3,
      });
      expect(onSettings).toHaveBeenCalledTimes(3);
    } finally {
      socket.close();
    }
  } finally {
    await app.close();
  }
});
