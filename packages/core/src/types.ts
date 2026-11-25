import type { Timeline } from "./simulation.ts";
import type { TownFrame } from "./townSociety.ts";

export interface Employee {
  address: string;
  machineId: string;
  spaceId: string;
  name: string | null;
  cwd: string;
  agent: string | null;
  status: string | null;
  turn: number;
  title: string;
  parent: string | null;
  labels: Record<string, string>;
}

/** What one machine's space is used for inside its site. */
export const roomKinds = ["office", "serverRoom", "lab", "studio"] as const;
export type RoomKind = (typeof roomKinds)[number];

export const roomKindLabels: Record<RoomKind, string> = {
  office: "사무실",
  serverRoom: "서버실",
  lab: "연구소",
  studio: "스튜디오",
};

/**
 * Where a machine sits in the company. Machines that share a `site` are one
 * building split into rooms; a machine with its own `site` is a separate
 * branch. Every machine stays a horizontal peer in the organization.
 */
export interface Placement {
  site: string;
  roomKind: RoomKind;
  roomName: string;
}

export interface Machine extends Partial<Placement> {
  id: string;
  /** Building name shown when no site is set (the site defaults to it). */
  name: string;
  host?: string;
}

/** A machine's placement, defaulting to its own branch with an office. */
export function placementOf(machine: Machine): Placement {
  return {
    site: machine.site?.trim() || machine.name,
    roomKind: machine.roomKind ?? "office",
    roomName:
      machine.roomName?.trim() || roomKindLabels[machine.roomKind ?? "office"],
  };
}

export interface Space {
  id: string;
  machineId: string;
  name: string;
  folder: string | null;
}

export interface Team extends Space {
  employees: Employee[];
  vacantSince: number | null;
}

export interface Group {
  id: string;
  name: string;
  spaceIds: string[];
}

export interface HierarchyOverride {
  parentSpaceId: string;
  childSpaceId: string;
  manages: boolean;
}

export interface ManagementEvidence {
  parentSpaceId: string;
  childSpaceId: string;
}

export interface OfficeMessage {
  from: string;
  to: string;
  body: string;
  at: number;
  truncated?: true;
}

export interface Department extends Team {
  leadAddress: string | null;
  departments: Department[];
}

export interface GroupDepartment {
  id: string;
  name: string;
  departments: Department[];
}

export interface Building extends Machine {
  departments: Department[];
  groups: GroupDepartment[];
}

export interface Organization {
  buildings: Building[];
}

export interface OfficeSnapshot {
  townSeed?: string;
  /** Who the server thinks is looking; only the owner may change settings. */
  viewer?: "owner" | "public";
  revision: number;
  connected: boolean;
  organization: Organization;
}

export interface OfficeDelta {
  revision: number;
  connected?: boolean;
  buildings?: { upsert: Building[]; remove: string[] };
  messages?: OfficeMessage[];
}

export type OfficeEvent =
  | { type: "snapshot"; snapshot: OfficeSnapshot }
  | { type: "delta"; delta: OfficeDelta }
  | { type: "actions"; timeline: Timeline }
  | { type: "town"; frame: TownFrame };
