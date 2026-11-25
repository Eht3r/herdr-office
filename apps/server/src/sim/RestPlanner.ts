import {
  type Activity,
  type ActivityCondition,
  type ActivityPlace,
  activities,
  type CompanyEvent,
  type PersonalityTrait,
} from "@herdr-office/core";

export interface BreakContext {
  idleMs: number;
  remote?: boolean;
  month: number;
  minute: number;
  weekday: number;
  holiday?: string;
  weather?: "rain" | "snow";
  traits: PersonalityTrait[];
  event?: CompanyEvent;
  preferred?: string;
  companions: { id: string; name: string; affinity: number }[];
  recent: { activity: string; line: string }[];
  counts: ReadonlyMap<string, number>;
}

export interface BreakPlan {
  activity: string;
  template: string;
  motion: string;
  place: ActivityPlace;
  item: string;
  durationMs: number;
  dailyLimit: number;
  line: string;
  companions: string[];
  next?: string;
}

function condition(
  context: BreakContext,
  when: ActivityCondition | undefined,
): boolean {
  switch (when) {
    case "lunch":
      return context.minute >= 690 && context.minute < 810;
    case "afternoon":
      return context.minute >= 870 && context.minute < 990;
    case "night":
      return context.minute >= 1200 || context.minute < 360;
    case "rain":
      return context.weather === "rain";
    case "snow":
      return context.weather === "snow";
    case "friday":
      return context.weekday === 5 && context.minute >= 840;
    case "monday":
      return context.weekday === 1 && context.minute < 720;
    case "holiday":
      return Boolean(context.holiday);
    default:
      return true;
  }
}

function availableProps(activity: Activity, place: ActivityPlace): string[] {
  // The per-activity lists restrict motion; these venue restrictions prevent incompatible combinations.
  if (place === "restroom")
    return activity.items.filter((item) => item === "none" || item === "soap");
  if (place === "park" || place === "rooftop")
    return activity.items.filter(
      (item) => !["organizer", "boardGame", "meal"].includes(item),
    );
  if (place === "cafe")
    return activity.items.filter(
      (item) =>
        !["wateringCan", "mug"].includes(item) || activity.motion === "drink",
    );
  return activity.items;
}

function weighted<T extends { weight: number }>(
  values: T[],
  random: () => number,
): T | undefined {
  let remaining =
    random() * values.reduce((sum, value) => sum + value.weight, 0);
  for (const value of values) {
    remaining -= value.weight;
    if (remaining < 0) return value;
  }
  return values.at(-1);
}

export function planBreak(
  context: BreakContext,
  random = Math.random,
): BreakPlan | null {
  const short = context.idleMs < 120_000;
  const long = context.idleMs >= 30 * 60_000;
  const durationCap = short ? 45 : long ? 450 : 120;
  const recent = context.recent.slice(0, 8);
  const candidates = activities.flatMap((activity) => {
    if (
      !condition(context, activity.when) ||
      activity.duration[0] > durationCap ||
      (activity.event &&
        activity.event !== "sharedBreak" &&
        activity.event !== "blockedLong" &&
        activity.id !== "walk" &&
        context.event !== activity.event)
    )
      return [];
    const traits =
      activity.traits?.filter((trait) => context.traits.includes(trait))
        .length ?? 0;
    const weight =
      activity.weight *
      (1 + traits) *
      (activity.event && activity.event === context.event ? 5 : 1);
    return activity.places.flatMap((place) => {
      if (context.remote) {
        if (place !== "home" && (short || place !== "park")) return [];
      } else if (place === "home" || (short && place !== "desk")) return [];
      return availableProps(activity, place).flatMap((item) => {
        const id = `${activity.id}:${place}:${item}`;
        if (
          recent.some((entry) => entry.activity === id) ||
          (context.counts.get(id) ?? 0) >= activity.dailyLimit
        )
          return [];
        return [
          {
            activity,
            id,
            place,
            item,
            weight: weight * (context.preferred === activity.id ? 24 : 1),
          },
        ];
      });
    });
  });
  const preferred = candidates.filter(
    ({ activity }) => activity.id === context.preferred,
  );
  const selected = weighted(preferred.length ? preferred : candidates, random);
  if (!selected) return null;
  const { activity, id, place, item } = selected;
  const companion =
    activity.companions &&
    !short &&
    (context.event === "sharedBreak" ||
      context.event === activity.event ||
      random() < 0.48)
      ? weighted(
          context.companions.map((person) => ({
            ...person,
            weight: 1 + person.affinity,
          })),
          random,
        )
      : undefined;
  const second =
    companion && context.companions.length > 1 && random() < 0.22
      ? weighted(
          context.companions
            .filter((person) => person.id !== companion.id)
            .map((person) => ({ ...person, weight: 1 + person.affinity })),
          random,
        )
      : undefined;
  const season =
    context.month < 3 || context.month === 12
      ? "겨울"
      : context.month < 6
        ? "봄"
        : context.month < 9
          ? "여름"
          : "가을";
  const lines = [
    ...activity.lines,
    ...(companion ? [`${companion.name}님, 같이 잠깐 쉴래요?`] : []),
    ...(activity.when === "holiday" && context.holiday
      ? [`${context.holiday}인데 잠깐 쉬었다 할까요?`]
      : []),
    ...(activity.motion === "walk" ? [`${season} 바람 좀 쐬고 올게요.`] : []),
  ].map((line) => line.replace("{name}", companion?.name ?? "동료"));
  const unused = lines.filter(
    (line) => !recent.some((entry) => entry.line === line),
  );
  const choices = unused.length ? unused : lines;
  const [min, max] = activity.duration;
  return {
    activity: id,
    dailyLimit: activity.dailyLimit,
    template: activity.id,
    motion: activity.motion,
    place,
    item,
    durationMs:
      (min + Math.floor(random() * (Math.min(durationCap, max) - min + 1))) *
      1000,
    line: choices[
      Math.min(choices.length - 1, Math.floor(random() * choices.length))
    ],
    companions: [companion?.id, second?.id].filter((id): id is string =>
      Boolean(id),
    ),
    ...(activity.next ? { next: activity.next } : {}),
  };
}
