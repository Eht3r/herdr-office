import { expect, it } from "vitest";
import { CompanyCalendar } from "../calendar.ts";
import { SimulationStore } from "./SimulationStore.ts";
import { learnHours, WorkHours } from "./WorkHours.ts";

it("learns rounded 10th/90th percentiles over two weeks of samples", () => {
  const day = 86_400_000;
  const samples = Array.from({ length: 20 }, (_, index) => ({
    bucket: index * day,
    minute: index < 10 ? 572 : 1060,
  }));
  expect(learnHours(samples.slice(0, 14))).toBeNull();
  expect(learnHours(samples)).toEqual([570, 1050]);
});

it("uses team, company, learned, then standard hours in that order", async () => {
  const store = new SimulationStore(":memory:");
  try {
    const calendar = new CompanyCalendar();
    const at = Date.parse("2026-02-02T12:00:00+09:00");
    const day = await calendar.today(at);
    for (let i = 1; i <= 18; i++)
      store.sample("example", at - i * 86_400_000, i < 10 ? 470 : 530);
    const learned = new WorkHours(store, true, true);
    expect(learned.dayFor("example", day, at)).toMatchObject({
      scheduledStart: 480,
      workingHours: false,
    });
    const configured = new WorkHours(
      store,
      true,
      true,
      { 1: [660, 870] },
      { tools: { 1: [780, 960] } },
    );
    expect(configured.dayFor("example", day, at)).toMatchObject({
      workingHours: true,
      scheduledStart: 660,
    });
    expect(configured.dayFor("tools", day, at)).toMatchObject({
      workingHours: false,
      scheduledStart: 780,
    });
    expect(
      new WorkHours(store, true, false).dayFor("tools", day, at),
    ).toMatchObject({ workingHours: true, scheduledStart: 540 });
  } finally {
    store.close();
  }
});
