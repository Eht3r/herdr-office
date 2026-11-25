import {
  type BusinessKind,
  hashSeed,
  type Neighborhood,
  type ResidentAge,
  type ResidentKind,
  seededEmployeeName,
  type TownAction,
  type TownPoint,
  type TownResident,
  type WeatherKind,
} from "@herdr-office/core";

export interface ResidentProfile {
  id: string;
  name: string;
  age: ResidentAge;
  homeId: string;
  job: string;
  traits: string[];
  offset: number;
}

const ageGroups: ResidentAge[] = ["child", "young", "adult", "senior"];
const occupations = [
  "편집자",
  "회사원",
  "배송 기사",
  "도서관 직원",
  "공방 직원",
  "프리랜서",
];
const temperaments = [
  "산책을 좋아함",
  "집을 좋아함",
  "동네에 밝음",
  "아침형",
  "저녁형",
  "미식가",
];

export function generateResidents(
  seed: string,
  employees: number,
): ResidentProfile[] {
  const count = Math.max(40, Math.min(120, 40 + Math.round(employees) * 2));
  return Array.from({ length: count }, (_, index) => {
    const id = `resident-${index.toString(36).padStart(3, "0")}`;
    const hash = hashSeed(`${seed}:${id}`);
    const age =
      ageGroups[
        index < 20
          ? 2
          : hash % 11 < 2
            ? 0
            : hash % 11 < 5
              ? 1
              : hash % 11 < 9
                ? 2
                : 3
      ];
    const first = (hash >>> 7) % temperaments.length;
    return {
      id,
      name: seededEmployeeName(seed, id),
      age,
      homeId: `home-${id}`,
      job:
        age === "child"
          ? "학생"
          : age === "senior"
            ? "은퇴자"
            : occupations[(hash >>> 12) % occupations.length],
      traits: [
        temperaments[first],
        temperaments[
          (first + 1 + ((hash >>> 20) % (temperaments.length - 1))) %
            temperaments.length
        ],
      ],
      offset: ((hash >>> 16) % 81) - 40,
    };
  });
}

export interface ResidentPost {
  slotId: string;
  business: BusinessKind;
  name: string;
  entrance: TownPoint;
  opensAt: number;
  closesAt: number;
  owner: boolean;
}

export interface ResidentDay {
  date: string;
  weekday: number;
  holidayNames: string[];
  weather: WeatherKind;
  timeZone: string;
}

export interface ResidentVisit {
  id: string;
  actorId: string;
  name: string;
  slotId: string;
  at: number;
}

type Stop = {
  minute: number;
  until: number;
  kind: ResidentKind;
  point: TownPoint;
  shopId?: string;
  via?: TownPoint;
};

const dateFormats = new Map<string, Intl.DateTimeFormat>();

// Resolve civil time in the configured zone, including offset changes between days.
export function civilTime(date: string, minute: number, zone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const requested = Date.UTC(year, month - 1, day, 0, minute);
  let formatter = dateFormats.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    dateFormats.set(zone, formatter);
  }
  let guess = requested;
  for (let pass = 0; pass < 3; pass++) {
    const data = Object.fromEntries(
      formatter
        .formatToParts(guess)
        .map(({ type, value }) => [type, Number(value)]),
    );
    const civil = Date.UTC(
      data.year,
      data.month - 1,
      data.day,
      data.hour,
      data.minute,
    );
    const difference = requested - civil;
    guess += difference;
    if (!difference) break;
  }
  return guess;
}

export function planResident(
  profile: ResidentProfile,
  day: ResidentDay,
  town: Neighborhood,
  post: ResidentPost | undefined,
  shops: ResidentPost[],
  seed: string,
  times = new Map<number, number>(),
): { resident: TownResident; visits: ResidentVisit[] } {
  const home = town.homes[profile.homeId]?.position ?? [
    town.bounds.minX + 2,
    0.1,
    town.bounds.minZ + 2,
  ];
  const stop: Stop[] = [];
  const weekend = day.weekday === 0 || day.weekday === 6;
  const holiday = day.holidayNames.length > 0;
  const travelHoliday = day.holidayNames.some((name) =>
    /설날|추석/u.test(name),
  );
  const wet = ["rain", "snow", "storm"].includes(day.weather);
  const hash = hashSeed(`${seed}:${profile.id}:${day.date}`);
  const outing = !travelHoliday || hash % 4 === 0;
  const homeTown =
    town.entities.find(({ kind }) => kind === "park")?.entrance.position ??
    home;
  const station =
    Object.values(town.stations)[hash % Object.keys(town.stations).length] ??
    home;
  const preferredShop = shops.length
    ? shops[(hash >>> 7) % shops.length]
    : undefined;
  const weightedTimes = profile.offset;
  if (post) {
    const begin = post.owner
      ? post.opensAt
      : post.opensAt + 28 + Math.max(0, weightedTimes);
    const finish = post.owner
      ? post.closesAt - 12
      : Math.min(post.closesAt - 12, begin + 480);
    stop.push({
      minute: begin,
      until: finish,
      kind: "work",
      point: post.entrance,
      shopId: post.slotId,
    });
  } else if (!weekend && !holiday && profile.age !== "senior") {
    const start = (profile.age === "child" ? 500 : 540) + weightedTimes;
    stop.push({
      minute: start,
      until: start + (profile.age === "child" ? 368 : 465),
      kind: profile.age === "child" ? "school" : "work",
      point: station,
    });
  }
  if (
    outing &&
    !wet &&
    (weekend || holiday || profile.age === "senior" || hash % 3 === 0)
  ) {
    const parkAt =
      (weekend || holiday ? 660 : profile.age === "senior" ? 575 : 1090) +
      weightedTimes;
    stop.push({
      minute: parkAt,
      until: parkAt + (weekend ? 55 : 34),
      kind: weekend || holiday ? "festival" : "park",
      point: homeTown,
    });
  }
  if (
    outing &&
    preferredShop &&
    hash % (wet ? 4 : 2) === 0 &&
    profile.age !== "child"
  ) {
    const slot = (weekend || holiday ? 780 : 1140) + weightedTimes;
    const visit = Math.max(
      preferredShop.opensAt + 8,
      Math.min(preferredShop.closesAt - 26, slot),
    );
    stop.push({
      minute: visit,
      until: visit + 20,
      kind: "shop",
      point: preferredShop.entrance,
      shopId: preferredShop.slotId,
    });
  }
  stop.sort((a, b) => a.minute - b.minute);
  const at = (minute: number) => {
    const cached = times.get(minute);
    if (cached !== undefined) return cached;
    const computed = civilTime(day.date, minute, day.timeZone);
    times.set(minute, computed);
    return computed;
  };
  const actions: TownAction[] = [];
  const visits: ResidentVisit[] = [];
  const enqueue = (
    kind: ResidentKind,
    from: TownPoint,
    to: TownPoint,
    start: number,
    until: number,
    shopId?: string,
  ) => {
    if (until <= start) return;
    const startAt = at(start);
    actions.push({
      id: `${profile.id}:${day.date}:${kind}:${start}`,
      actorId: profile.id,
      kind,
      from,
      to,
      startAt,
      durationMs: Math.max(60_000, at(until) - startAt),
      props: {
        ...(kind === "walk" &&
        (day.weather === "rain" || day.weather === "storm")
          ? { umbrella: true }
          : {}),
        shopId,
      },
    });
  };
  let pointer = 0;
  let point = home;
  for (const entry of stop) {
    const walk = wet ? 16 : 12;
    if (entry.minute - walk < pointer) continue;
    if (point === home)
      enqueue("home", home, home, pointer, entry.minute - walk);
    else enqueue("rest", point, point, pointer, entry.minute - walk);
    enqueue("walk", point, entry.point, entry.minute - walk, entry.minute);
    enqueue(
      entry.kind,
      entry.point,
      entry.point,
      entry.minute,
      entry.until,
      entry.shopId,
    );
    if (entry.kind === "shop" && entry.shopId) {
      visits.push({
        id: `${profile.id}:${day.date}:${entry.shopId}`,
        actorId: profile.id,
        name: profile.name,
        slotId: entry.shopId,
        at: at(entry.minute),
      });
    }
    pointer = entry.until;
    point = entry.point;
    // Return home between widely separated errands instead of waiting at the workplace for hours.
    const next = stop.find((candidate) => candidate.minute > entry.minute);
    if (point !== home && (!next || next.minute - pointer > 110)) {
      enqueue("walk", point, home, pointer, Math.min(1440, pointer + walk));
      pointer += walk;
      point = home;
    }
  }
  if (point !== home)
    enqueue("walk", point, home, pointer, Math.min(1440, pointer + 12));
  enqueue(
    "home",
    home,
    home,
    point === home ? pointer : Math.min(1440, pointer + 12),
    1440,
  );
  return {
    resident: {
      id: profile.id,
      name: profile.name,
      age: profile.age,
      traits: profile.traits,
      home,
      job: post
        ? post.owner
          ? `${post.name} 운영`
          : `${post.name} 직원`
        : profile.job,
      actions,
    },
    visits,
  };
}
