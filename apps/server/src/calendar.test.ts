import { expect, it, vi } from "vitest";
import { CompanyCalendar, defaultSchedule } from "./calendar.ts";

const at = (date: string) => Date.parse(date);

it("uses Korean calendar dates, weekends and half-open work hours", async () => {
  const calendar = new CompanyCalendar();
  expect(await calendar.today(at("2025-12-31T16:30:00Z"))).toMatchObject({
    date: "2026-01-01",
    isHoliday: true,
    holidayNames: expect.arrayContaining(["1월 1일"]),
    workingHours: false,
  });
  expect(await calendar.today(at("2026-01-03T10:00:00+09:00"))).toMatchObject({
    isWeekend: true,
    workingHours: false,
  });
  expect(
    (await calendar.today(at("2026-01-05T08:59:00+09:00"))).workingHours,
  ).toBe(false);
  expect(
    (await calendar.today(at("2026-01-05T09:00:00+09:00"))).workingHours,
  ).toBe(true);
  expect(
    (await calendar.today(at("2026-01-05T18:00:00+09:00"))).workingHours,
  ).toBe(false);
});

it("warns once per unavailable year and uses a weekday-only fallback", async () => {
  const warn = vi.fn();
  const isHoliday = vi.fn(async () => {
    throw new RangeError("out of range");
  });
  const calendar = new CompanyCalendar(
    defaultSchedule,
    { isHoliday, getHolidayNames: async () => null },
    warn,
  );
  for (const date of ["2035-01-01", "2035-01-02"]) {
    expect(await calendar.today(at(`${date}T10:00:00+09:00`))).toMatchObject({
      isHoliday: false,
      workingHours: true,
      warning: expect.stringContaining("업데이트"),
    });
  }
  expect(warn).toHaveBeenCalledTimes(1);
  expect(isHoliday).toHaveBeenCalledTimes(1);
});

it("uses the company time zone and skips Korean holidays for another country", async () => {
  const calendar = new CompanyCalendar({
    ...defaultSchedule,
    timeZone: "America/New_York",
    country: "US",
  });
  expect(await calendar.today(at("2026-01-01T15:00:00Z"))).toMatchObject({
    minute: 600,
    isHoliday: false,
    workingHours: true,
  });
});
