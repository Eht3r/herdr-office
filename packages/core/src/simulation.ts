import type { Importance } from "./importance.ts";

export const campusWaypointKinds = [
  "entrance",
  "elevator",
  "kitchenette",
  "restroom",
  "lounge",
  "sleepCapsules",
  "rooftop",
] as const;

export const townWaypointKinds = [
  "home",
  "station",
  "convenienceStore",
  "cafe",
  "restaurant",
  "park",
] as const;

export function employeeHomeId(employeeId: string): string {
  return `home-${employeeId.replace("/", "-")}`;
}

export type CampusWaypoint = (typeof campusWaypointKinds)[number];
export type TownWaypoint = (typeof townWaypointKinds)[number];
export type WaypointKind = CampusWaypoint | TownWaypoint | "desk";

export interface Waypoint {
  kind: WaypointKind;
  buildingId?: string;
  employeeId?: string;
  homeId?: string;
}

export const commuteModes = [
  "walk",
  "bus",
  "subway",
  "bicycle",
  "car",
] as const;
export type CommuteMode = (typeof commuteModes)[number] | "taxi" | "run";

export type AbsenceKind = "powerNap" | "sleep" | "earlyLeave" | "vacation";

export const personalityTraits = [
  "active",
  "quiet",
  "social",
  "gamer",
  "investor",
] as const;
export type PersonalityTrait = (typeof personalityTraits)[number];

export interface Persona {
  name: string;
  traits: PersonalityTrait[];
  homeId: string;
  commute: (typeof commuteModes)[number];
  arrivalOffsetMinutes: number;
}

export type ActionKind =
  | "commuteIn"
  | "commuteOut"
  | "firstCommute"
  | "finalDeparture"
  | "emergencyCommute"
  | "move"
  | "work"
  | "overtime"
  | "react"
  | "break"
  | "usageWarning"
  | "absence"
  | "return"
  | "talk"
  | "videocall"
  | "leaveNote"
  | "readNotes";

export interface Note {
  fromId: string;
  line: string;
  at: number;
}

export interface ActionProps {
  activity?: string;
  importance?: Importance;
  remoteWork?: boolean;
  motion?: string;
  items?: string[];
  companions?: string[];
  transport?: CommuteMode;
  trip?: string;
  reason?: string;
  absence?: AbsenceKind;
  resetAt?: number | null;
  usedPct?: number;
  noteCount?: number;
  notes?: Note[];
}

export interface Action {
  id: string;
  employeeId: string;
  kind: ActionKind;
  from: Waypoint;
  to: Waypoint;
  startAt: number;
  durationMs: number;
  props: ActionProps;
  line: string;
}

export interface OfficeDay {
  date: string;
  timeZone: string;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayNames: string[];
  workingHours: boolean;
  warning?: string;
}

export interface EmployeeUsage {
  usedPct: number | null;
  resetAt: number | null;
  exhausted: boolean;
}

export interface Timeline {
  at: number;
  today: OfficeDay | null;
  actions: Action[];
  positions?: Record<string, Waypoint>;
  notesByEmployee?: Record<string, number>;
  usage: Record<string, Partial<EmployeeUsage>>;
}
