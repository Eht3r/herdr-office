import type { OfficeDay } from "@herdr-office/core";
import { getHolidayNames, isHoliday } from "@hyunbinseo/holidays-kr";

const korea = "Asia/Seoul";

export interface Schedule {
  timeZone: string;
  country: string;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  weekdays: number[];
}

export const defaultSchedule: Schedule = {
  timeZone: korea,
  country: "KR",
  enabled: true,
  startMinute: 9 * 60,
  endMinute: 18 * 60,
  weekdays: [1, 2, 3, 4, 5],
};

export interface WorkDay extends OfficeDay {
  minute: number;
  weekday: number;
  month: number;
  scheduledStart: number;
  scheduledEnd: number;
  scheduledDay: boolean;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

export function localTime(at: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(at).map(({ type, value }) => [type, value]),
  );
  const { year, month, day, hour, minute } = parts;
  return {
    date: `${year}-${month}-${day}`,
    month: Number(month),
    weekday: new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    ).getUTCDay(),
    minute: Number(hour) * 60 + Number(minute),
  };
}

type HolidayLookup = Pick<
  typeof import("@hyunbinseo/holidays-kr"),
  "isHoliday" | "getHolidayNames"
>;

export class CompanyCalendar {
  private readonly dates = new Map<string, Promise<string[]>>();
  private readonly unsupported = new Set<string>();

  constructor(
    readonly schedule: Schedule = defaultSchedule,
    private readonly lookup: HolidayLookup = { isHoliday, getHolidayNames },
    private readonly warn: (message: string) => void = console.warn,
  ) {
    localTime(0, schedule.timeZone);
    if (
      schedule.startMinute < 0 ||
      schedule.endMinute > 1440 ||
      schedule.startMinute >= schedule.endMinute
    ) {
      throw new RangeError("Working hours must use a same-day range");
    }
  }

  async today(at: number): Promise<WorkDay> {
    const { schedule } = this;
    const time = localTime(at, schedule.timeZone);
    const isWeekend = time.weekday === 0 || time.weekday === 6;
    const koreanDate = localTime(at, korea).date;
    const year = koreanDate.slice(0, 4);
    let holidayNames: string[] = [];
    if (schedule.country === "KR" && !this.unsupported.has(year)) {
      let request = this.dates.get(koreanDate);
      if (!request) {
        request = this.lookup
          .isHoliday(koreanDate)
          .then(async (holiday) =>
            holiday
              ? [...((await this.lookup.getHolidayNames(koreanDate)) ?? [])]
              : [],
          )
          .catch((error: unknown) => {
            if (!(error instanceof RangeError)) {
              this.dates.delete(koreanDate);
              throw error;
            }
            if (!this.unsupported.has(year))
              this.warn(`공휴일 데이터 업데이트 필요 (npm update, ${year})`);
            this.unsupported.add(year);
            return [];
          });
        this.dates.set(koreanDate, request);
        if (this.dates.size > 370) {
          const oldest = this.dates.keys().next().value;
          if (oldest) this.dates.delete(oldest);
        }
      }
      holidayNames = await request;
    }
    const isHoliday = holidayNames.length > 0;
    return {
      ...time,
      timeZone: schedule.timeZone,
      isWeekend,
      isHoliday,
      holidayNames,
      scheduledStart: schedule.startMinute,
      scheduledEnd: schedule.endMinute,
      scheduledDay: !isHoliday && schedule.weekdays.includes(time.weekday),
      workingHours:
        !schedule.enabled ||
        (!isHoliday &&
          schedule.weekdays.includes(time.weekday) &&
          time.minute >= schedule.startMinute &&
          time.minute < schedule.endMinute),
      ...(schedule.country === "KR" && this.unsupported.has(year)
        ? { warning: "공휴일 데이터 업데이트 필요 (npm update)" }
        : {}),
    };
  }
}
