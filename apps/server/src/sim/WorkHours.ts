import type { WorkDay } from "../calendar.ts";
import type { SimulationStore } from "./SimulationStore.ts";

export type Hours = [start: number, end: number];
export type HoursRule = Partial<Record<number, Hours | null>>;

const halfHour = 30 * 60_000;
const dayMs = 86_400_000;
const standard: HoursRule = {
  1: [540, 1080],
  2: [540, 1080],
  3: [540, 1080],
  4: [540, 1080],
  5: [540, 1080],
};

export function learnHours(
  samples: { bucket: number; minute: number }[],
): Hours | null {
  if (
    !samples.length ||
    (samples.at(-1)?.bucket ?? 0) - samples[0].bucket < 14 * dayMs
  )
    return null;
  const minutes = samples.map(({ minute }) => minute).sort((a, b) => a - b);
  const percentile = (ratio: number) =>
    Math.round(minutes[Math.round((minutes.length - 1) * ratio)] / 30) * 30;
  const start = percentile(0.1);
  const end = Math.min(1440, Math.max(start + 30, percentile(0.9)));
  return start < end ? [start, end] : null;
}

export class WorkHours {
  private learned: Hours | null = null;
  private nextRefresh = 0;

  constructor(
    private readonly store: SimulationStore,
    private enabled: boolean,
    private learn: boolean,
    private company?: HoursRule,
    private teams: Record<string, HoursRule> = {},
  ) {}

  configure(
    enabled: boolean,
    learn: boolean,
    company: HoursRule,
    teams: Record<string, HoursRule>,
  ): void {
    if (this.learn !== learn) {
      this.learned = null;
      this.nextRefresh = 0;
    }
    this.enabled = enabled;
    this.learn = learn;
    this.company = company;
    this.teams = teams;
  }

  observe(team: string, day: WorkDay, now: number): void {
    if (!this.learn) return;
    const time = Math.floor(now / halfHour) * halfHour;
    this.store.sample(team, time, day.minute - (day.minute % 30));
  }

  dayFor(team: string, day: WorkDay, now: number): WorkDay {
    if (!this.enabled)
      return {
        ...day,
        workingHours: true,
        scheduledDay: true,
        scheduledStart: 0,
        scheduledEnd: 1440,
      };
    if (this.learn && now >= this.nextRefresh) {
      const since = now - 28 * dayMs;
      this.learned = learnHours(this.store.samples(since, now));
      this.store.pruneSamples(since);
      this.nextRefresh = now + 7 * dayMs;
    }
    const fallback =
      this.learned && day.weekday >= 1 && day.weekday <= 5
        ? this.learned
        : standard[day.weekday];
    const teamHours = (
      Object.hasOwn(this.teams, team) ? this.teams[team] : undefined
    )?.[day.weekday];
    const companyHours = this.company?.[day.weekday];
    const range =
      teamHours !== undefined
        ? teamHours
        : companyHours !== undefined
          ? companyHours
          : fallback;
    return {
      ...day,
      scheduledStart: range ? range[0] : day.scheduledStart,
      scheduledEnd: range ? range[1] : day.scheduledEnd,
      scheduledDay: !day.isHoliday && Boolean(range),
      workingHours:
        !day.isHoliday &&
        Boolean(range && day.minute >= range[0] && day.minute < range[1]),
    };
  }
}

export function configuredHours(
  value: string | undefined,
): HoursRule | undefined {
  if (!value) return undefined;
  return parseHours(JSON.parse(value));
}

export function configuredTeamHours(
  value: string | undefined,
): Record<string, HoursRule> {
  if (!value) return {};
  const settings: unknown = JSON.parse(value);
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new RangeError("Invalid team work hours");
  return Object.fromEntries(
    Object.entries(settings).map(([team, rule]) => [team, parseHours(rule)]),
  );
}

export function parseHours(value: unknown): HoursRule {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RangeError("Invalid work hours");
  const entries = Object.entries(value).map(([weekday, range]) => {
    if (
      !/^[0-6]$/u.test(weekday) ||
      (range !== null &&
        !(
          Array.isArray(range) &&
          range.length === 2 &&
          range.every(Number.isInteger) &&
          range[0] >= 0 &&
          range[0] < range[1] &&
          range[1] <= 1440
        ))
    ) {
      throw new RangeError(
        "Weekday work hours must be within 0–1440 minutes, or null",
      );
    }
    return [weekday, range];
  });
  return Object.fromEntries(entries);
}
