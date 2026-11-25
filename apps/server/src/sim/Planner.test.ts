import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Employee, OfficeSnapshot } from "@herdr-office/core";
import { expect, it } from "vitest";
import { CompanyCalendar } from "../calendar.ts";
import { Planner } from "./Planner.ts";
import { SimulationStore } from "./SimulationStore.ts";
import { WorkHours } from "./WorkHours.ts";

const minute = 60_000;
const at = (date: string, time: string) =>
  Date.parse(`${date}T${time}:00+09:00`);
const calendar = new CompanyCalendar();
const thursday = "2026-01-08";
const employee = (status: string, address = "t1"): Employee => ({
  address,
  status,
  machineId: "local",
  spaceId: "example",
  name: null,
  agent: "codex",
  cwd: "/workspace",
  turn: 1,
  title: "",
  parent: null,
  labels: {},
});
function snapshot(people: Employee[]): OfficeSnapshot {
  return {
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
              employees: people,
              departments: [],
            },
          ],
        },
      ],
    },
  };
}
function fixture(
  path = ":memory:",
  remoteWork: "none" | "afterHours" = "afterHours",
) {
  const store = new SimulationStore(path);
  const planner = new Planner(store, new WorkHours(store, true, false), {
    remoteWork,
  });
  const plan = async (
    time: number,
    status: string,
    extra: Partial<Parameters<Planner["plan"]>[0]> = {},
  ) =>
    planner.plan({
      snapshot: snapshot([employee(status)]),
      at: time,
      day: await calendar.today(time),
      ...extra,
    });
  return { store, plan };
}

it("sends an idle employee home at night and back the next morning", async () => {
  const { store, plan } = fixture();
  try {
    const start = at(thursday, "20:00");
    expect((await plan(start, "idle")).actions[0]).toMatchObject({
      kind: "commuteOut",
      from: { kind: "desk" },
    });
    expect((await plan(start + 3 * minute, "idle")).actions).toEqual([]);
    expect(store.states()[0].position.kind).toBe("home");
    const morning = await plan(at("2026-01-09", "09:45"), "idle");
    expect(morning.actions[0]).toMatchObject({
      kind: "commuteIn",
      from: { kind: "home" },
    });
    expect(morning.actions.at(-1)?.to.kind).toBe("desk");
  } finally {
    store.close();
  }
});

it("keeps a working employee at the office as overtime at night", async () => {
  const { store, plan } = fixture();
  try {
    expect(
      (await plan(at(thursday, "21:00"), "working")).actions,
    ).toContainEqual(
      expect.objectContaining({
        kind: "overtime",
        to: { kind: "desk", buildingId: "local", employeeId: "t1" },
        props: expect.objectContaining({
          reason: "officeOvertime",
          items: ["deskLamp"],
        }),
      }),
    );
  } finally {
    store.close();
  }
});

it("compresses an important return even after 22:00 into 30–60 seconds", async () => {
  const { store, plan } = fixture();
  try {
    const departure = at(thursday, "21:45");
    await plan(departure, "idle");
    await plan(departure + 4 * minute, "idle");
    const after = await plan(at(thursday, "22:10"), "working", {
      snapshot: snapshot([{ ...employee("working"), title: "보안 배포" }]),
    });
    expect(after.actions[0]).toMatchObject({
      kind: "emergencyCommute",
      props: { reason: "urgent" },
    });
    const duration = after.actions.reduce(
      (sum, { durationMs }) => sum + durationMs,
      0,
    );
    expect(duration).toBeGreaterThanOrEqual(30_000);
    expect(duration).toBeLessThanOrEqual(60_000);
  } finally {
    store.close();
  }
});

it("runs normal late-night work from home", async () => {
  const { store, plan } = fixture();
  try {
    const departure = at(thursday, "19:10");
    await plan(departure, "idle");
    await plan(departure + 3 * minute, "idle");
    const night = await plan(at(thursday, "23:45"), "working");
    expect(night.actions).toContainEqual(
      expect.objectContaining({
        kind: "work",
        from: { kind: "home", employeeId: "t1", homeId: "home-t1" },
        to: { kind: "home", employeeId: "t1", homeId: "home-t1" },
        props: expect.objectContaining({
          reason: "homeWork",
          remoteWork: true,
          items: ["laptop"],
        }),
      }),
    );
  } finally {
    store.close();
  }
});

it.each(["2026-01-10", "2026-01-01"])(
  "dispatches special shifts on %s",
  async (day) => {
    const { store, plan } = fixture();
    try {
      await plan(at(day, "07:00"), "idle");
      await plan(at(day, "07:05"), "idle");
      const result = await plan(at(day, "11:00"), "working", {
        snapshot: snapshot([{ ...employee("working"), title: "QA FAIL 확인" }]),
      });
      expect(result.actions[0]).toMatchObject({
        kind: "emergencyCommute",
        props: { reason: "specialShift", items: ["casualClothes"] },
      });
    } finally {
      store.close();
    }
  },
);

it("defers the next morning's arrival after observed overtime", async () => {
  const { store, plan } = fixture();
  try {
    const start = at(thursday, "18:30");
    await plan(start, "working");
    const initial = store.states()[0];
    initial.persona.arrivalOffsetMinutes = 0;
    store.save(initial);
    for (let delta = 10_000; delta <= 31 * minute; delta += 10_000)
      await plan(start + delta, "working");
    await plan(at(thursday, "20:00"), "idle");
    const early = await plan(at("2026-01-09", "09:00"), "idle");
    expect(early.actions).toEqual([]);
    expect(store.states()[0].lateMinutes).toBe(15);
    expect(
      (await plan(at("2026-01-09", "09:15"), "idle")).actions[0],
    ).toMatchObject({ kind: "commuteIn" });
  } finally {
    store.close();
  }
});

it("queues walks and bubbles without sending source text, then leaves a note for an exhausted coworker", async () => {
  const { store, plan } = fixture();
  const time = at(thursday, "13:00");
  const staff = snapshot([employee("working"), employee("working", "t2")]);
  const message = {
    from: "t1",
    to: "t2",
    body: "[배포 테스트] 검토 부탁드립니다",
    at: time + 1000,
  };
  try {
    await plan(time, "working", { snapshot: staff });
    const conversation = await plan(time + 1_000, "working", {
      snapshot: staff,
      messages: [message],
    });
    expect(conversation.actions).toContainEqual(
      expect.objectContaining({
        kind: "talk",
        from: { kind: "desk", buildingId: "local", employeeId: "t2" },
        line: expect.not.stringContaining("배포 테스트"),
        props: expect.objectContaining({ companions: ["t2"] }),
      }),
    );
    expect(
      (await plan(time + 2_000, "working", { snapshot: staff })).actions.some(
        ({ kind }) => kind === "talk",
      ),
    ).toBe(true);
    const waiting = await plan(time + 20_000, "working", {
      snapshot: staff,
      messages: [{ ...message, at: time + 20_000 }],
      usage: ({ address }) =>
        address === "t2"
          ? { usedPct: 100, resetAt: time + 3 * minute, exhausted: true }
          : { usedPct: null, resetAt: null, exhausted: false },
    });
    expect(waiting.actions).toContainEqual(
      expect.objectContaining({ kind: "leaveNote" }),
    );
    expect(waiting.actions).toContainEqual(
      expect.objectContaining({
        kind: "absence",
        props: expect.objectContaining({ absence: "powerNap" }),
      }),
    );
    expect(waiting.usage.t2.usedPct).toBeUndefined();
    expect(store.states().find(({ id }) => id === "t2")?.notes).toBe(1);
    expect(store.affinity("t1", "t2")).toBe(2);
    const returned = await plan(time + 4 * minute, "working", {
      snapshot: staff,
    });
    expect(returned.actions.some(({ kind }) => kind === "readNotes")).toBe(
      true,
    );
    const stillReturning = await plan(time + 4 * minute + 1000, "working", {
      snapshot: staff,
    });
    expect(
      stillReturning.actions.some(({ kind }) => kind === "readNotes"),
    ).toBe(true);
  } finally {
    store.close();
  }
});

it("persists persona, actions, activity history and affinity across restarts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-sim-"));
  const path = join(dir, "sim.sqlite");
  const time = at(thursday, "13:00");
  const first = fixture(path);
  try {
    const initial = await first.plan(time, "idle");
    first.store.interact("t1", "t2");
    const persona = first.store.states()[0].persona;
    first.store.close();
    const restarted = fixture(path);
    try {
      const resume = await restarted.plan(time + 1_000, "idle");
      expect(resume.actions).toEqual(initial.actions);
      expect(restarted.store.states()[0].persona).toEqual(persona);
      expect(restarted.store.breakHistory("t1", thursday).recent).toHaveLength(
        1,
      );
      expect(restarted.store.affinity("t1", "t2")).toBe(1);
    } finally {
      restarted.store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("plans first arrivals and the final farewell only after an authoritative roster change", async () => {
  const { store, plan } = fixture();
  const time = at(thursday, "12:00");
  try {
    const before = snapshot([employee("idle")]);
    await plan(time, "idle", { snapshot: before });
    const joined = await plan(time + 1_000, "idle", {
      snapshot: snapshot([employee("idle"), employee("idle", "t2")]),
    });
    expect(joined.actions).toContainEqual(
      expect.objectContaining({ employeeId: "t2", kind: "firstCommute" }),
    );
    const offline = await plan(time + 3 * minute, "idle", {
      snapshot: { ...before, connected: false },
    });
    expect(offline.actions.some(({ kind }) => kind === "finalDeparture")).toBe(
      false,
    );
    const left = await plan(time + 3 * minute + 1_000, "idle", {
      snapshot: before,
    });
    expect(left.actions).toContainEqual(
      expect.objectContaining({ employeeId: "t2", kind: "finalDeparture" }),
    );
  } finally {
    store.close();
  }
});

it("escalates an unknown reset to sleep and returns after usage clears", async () => {
  const { store, plan } = fixture();
  const time = at(thursday, "12:00");
  const usage = () => ({ usedPct: 100, exhausted: true, resetAt: null });
  try {
    const start = await plan(time, "blocked", { usage });
    expect(start.actions.at(-1)).toMatchObject({
      kind: "absence",
      props: { absence: "powerNap" },
    });
    const sleep = await plan(time + 30 * minute, "blocked", { usage });
    expect(sleep.actions.at(-1)).toMatchObject({
      kind: "absence",
      to: { kind: "sleepCapsules" },
      props: { absence: "sleep" },
    });
    const wake = await plan(time + 31 * minute, "idle");
    expect(wake.actions[0]).toMatchObject({
      kind: "return",
      to: { kind: "desk" },
    });
  } finally {
    store.close();
  }
});

it("commutes during working hours regardless of policy and allows the none policy to force after-hours attendance", async () => {
  const regular = fixture();
  const onSite = fixture(":memory:", "none");
  try {
    for (const { plan } of [regular, onSite]) {
      await plan(at(thursday, "19:00"), "idle");
      await plan(at(thursday, "19:05"), "idle");
    }
    const regularHours = await regular.plan(
      at("2026-01-09", "11:00"),
      "working",
    );
    expect(regularHours.actions[0]).toMatchObject({
      kind: "commuteIn",
      from: { kind: "home" },
    });
    expect(regularHours.actions.at(-1)?.to.kind).toBe("desk");
    expect(
      (await onSite.plan(at(thursday, "23:00"), "working")).actions[0],
    ).toMatchObject({
      kind: "emergencyCommute",
      from: { kind: "home" },
    });
  } finally {
    regular.store.close();
    onSite.store.close();
  }
});

it("uses video calls for remote workers and summons a teammate and the lead when work is escalated", async () => {
  const { store, plan } = fixture();
  const friday = "2026-01-09";
  const people = (status: string) =>
    snapshot([employee(status), employee(status, "t2")]);
  try {
    await plan(at(friday, "18:00"), "idle", { snapshot: people("idle") });
    await plan(at(friday, "18:05"), "idle", { snapshot: people("idle") });
    const time = at(friday, "19:30");
    const active = await plan(time, "working", { snapshot: people("working") });
    expect(active.actions).toHaveLength(2);
    expect(
      active.actions.every(
        ({ to, props }) => to.kind === "home" && props.remoteWork,
      ),
    ).toBe(true);
    const call = await plan(time + 1000, "working", {
      snapshot: people("working"),
      messages: [
        { from: "t1", to: "t2", body: "좋은 저녁입니다!", at: time + 1000 },
      ],
    });
    expect(call.actions.map(({ kind }) => kind)).toEqual([
      "videocall",
      "videocall",
    ]);
    expect(
      call.actions.every(
        ({ from, to }) => from.kind === "home" && to.kind === "home",
      ),
    ).toBe(true);
    const late = at(friday, "23:30");
    const escalate = await plan(late, "working", {
      snapshot: people("working"),
      messages: [
        {
          from: "t1",
          to: "t2",
          body: "보안 배포 확인 부탁드립니다.",
          at: late,
        },
      ],
    });
    expect(
      escalate.actions
        .filter(({ kind }) => kind === "emergencyCommute")
        .map(({ employeeId }) => employeeId),
    ).toEqual(["t1", "t2"]);
  } finally {
    store.close();
  }
});

it("keeps normal holiday work at home", async () => {
  const { store, plan } = fixture();
  const holiday = "2026-01-01";
  try {
    await plan(at(holiday, "08:00"), "idle");
    await plan(at(holiday, "08:05"), "idle");
    expect(
      (await plan(at(holiday, "13:00"), "working")).actions[0],
    ).toMatchObject({
      kind: "work",
      to: { kind: "home" },
      props: { remoteWork: true },
    });
  } finally {
    store.close();
  }
});
