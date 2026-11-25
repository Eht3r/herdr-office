import { activities } from "@herdr-office/core";
import { expect, it } from "vitest";
import { type BreakContext, planBreak } from "./RestPlanner.ts";

it("does not repeat any of the recent eight activities over 100 consecutive plans", () => {
  const context: BreakContext = {
    idleMs: 50 * 60_000,
    month: 4,
    minute: 770,
    weekday: 3,
    traits: ["quiet", "investor"],
    companions: [{ id: "example", name: "동료", affinity: 7 }],
    recent: [],
    counts: new Map(),
  };
  const counts = new Map<string, number>();
  context.counts = counts;
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 100; i++) {
    const plan = planBreak(context, random);
    expect(plan).not.toBeNull();
    if (!plan) throw new Error("Ran out of daily break combinations");
    expect(context.recent.map(({ activity }) => activity)).not.toContain(
      plan.activity,
    );
    context.recent.unshift(plan);
    context.recent = context.recent.slice(0, 8);
    const uses = (counts.get(plan.activity) ?? 0) + 1;
    expect(uses).toBeLessThanOrEqual(plan.dailyLimit);
    counts.set(plan.activity, uses);
  }
  expect(activities.length).toBeGreaterThanOrEqual(30);
});

it("limits short breaks to the desk and honors compatible chained activities", () => {
  const context: BreakContext = {
    idleMs: 15_000,
    month: 11,
    minute: 915,
    weekday: 5,
    traits: [],
    companions: [],
    recent: [],
    counts: new Map(),
  };
  expect(planBreak(context, () => 0.6)).toMatchObject({ place: "desk" });
  expect(
    planBreak({ ...context, preferred: "wash", idleMs: 180_000 }, () => 0.5),
  ).toMatchObject({
    template: "wash",
    place: "restroom",
    item: "soap",
    next: "water",
  });
});
