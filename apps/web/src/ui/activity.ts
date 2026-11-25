import type {
  Action,
  Note,
  Timeline,
  Waypoint,
  WaypointKind,
} from "@herdr-office/core";

export const placeLabels: Record<WaypointKind, string> = {
  desk: "자기 자리",
  entrance: "건물 입구",
  elevator: "엘리베이터",
  kitchenette: "탕비실",
  restroom: "화장실",
  lounge: "라운지",
  sleepCapsules: "수면 캡슐",
  rooftop: "옥상",
  home: "집",
  station: "정류장",
  convenienceStore: "편의점",
  cafe: "카페",
  restaurant: "식당",
  park: "공원",
};

const inTown = new Set<WaypointKind>([
  "home",
  "station",
  "convenienceStore",
  "cafe",
  "restaurant",
  "park",
]);

export function isTownPlace(place: Waypoint): boolean {
  return inTown.has(place.kind);
}

export interface Activity {
  /** Where the employee is (or is heading) right now. */
  place: Waypoint | null;
  /** What they are doing, as a sentence for the card. */
  doing: string;
  action: Action | null;
}

/** What one employee is doing at `now`, from the simulation timeline. */
export function activityOf(
  timeline: Timeline | null,
  employeeId: string,
  now: number,
): Activity {
  const action =
    timeline?.actions.find(
      (candidate) =>
        candidate.employeeId === employeeId &&
        candidate.startAt <= now &&
        now < candidate.startAt + candidate.durationMs,
    ) ?? null;
  const place = action?.to ?? timeline?.positions?.[employeeId] ?? null;
  if (!place) return { place: null, doing: "출근 전", action };
  const where = placeLabels[place.kind];
  if (!action) return { place, doing: `${where}에 있음`, action };
  const moving = action.from.kind !== action.to.kind;
  return {
    place,
    doing: moving
      ? `${where}(으)로 가는 중`
      : `${where}에서 ${action.line || "시간을 보내는 중"}`,
    action,
  };
}

export function notesOf(
  timeline: Timeline | null,
  employeeId: string,
): { count: number; notes: Note[] } {
  return {
    count: timeline?.notesByEmployee?.[employeeId] ?? 0,
    notes: timeline?.inboxByEmployee?.[employeeId] ?? [],
  };
}
