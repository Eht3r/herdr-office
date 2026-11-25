import {
  type AbsenceKind,
  type Action,
  type CompanyEvent,
  commuteModes,
  type Employee,
  employeeHomeId,
  hashSeed,
  type Importance,
  type Note,
  type Persona,
  personalityTraits,
  type SpeechVariants,
  seededEmployeeName,
  type Waypoint,
} from "@herdr-office/core";
import { publicAddress, publicMachineId } from "../state/publicView.ts";

export interface PendingConversation {
  recipientId: string;
  line: string;
  speech?: SpeechVariants;
  at: number;
}

export interface EmployeeState {
  id: string;
  spaceId: string;
  buildingId: string;
  persona: Persona;
  present: boolean;
  status: string | null;
  statusSince: number;
  position: Waypoint;
  actions: Action[];
  notes: number;
  inbox?: Note[];
  priority?: { value: Importance; at: number };
  revisionSignals?: number[];
  dispatches?: { recipientId: string; at: number }[];
  remoteActive?: boolean;
  conversation: PendingConversation[];
  absence: {
    kind: AbsenceKind;
    since: number;
    resetAt: number | null;
    thresholds?: string;
  } | null;
  warningDay: string | null;
  nextBreak?: string;
  event?: CompanyEvent;
  overtimeMs: number;
  overtimeDate: string | null;
  lastTick: number;
  lateMinutes: number;
  lateDate: string | null;
  serial: number;
}

export function createPersona(employee: Employee): Persona {
  const seed = hashSeed(JSON.stringify([employee.spaceId, employee.address]));
  const first = seed % personalityTraits.length;
  const second =
    (first + 1 + ((seed >>> 7) % (personalityTraits.length - 1))) %
    personalityTraits.length;
  return {
    name: seededEmployeeName(employee.spaceId, employee.address),
    traits: [personalityTraits[first], personalityTraits[second]],
    homeId: employeeHomeId(publicAddress(employee.address)),
    commute: commuteModes[(seed >>> 13) % commuteModes.length],
    arrivalOffsetMinutes: ((seed >>> 19) % 61) - 30,
  };
}

export function createEmployeeState(
  employee: Employee,
  persona: Persona,
  at: number,
  atHome: boolean,
): EmployeeState {
  const id = publicAddress(employee.address);
  const buildingId = publicMachineId(employee.machineId);
  return {
    id,
    spaceId: employee.spaceId,
    buildingId,
    persona,
    present: true,
    status: employee.status,
    statusSince: at,
    position: atHome
      ? { kind: "home", employeeId: id, homeId: persona.homeId }
      : { kind: "desk", buildingId, employeeId: id },
    actions: [],
    notes: 0,
    conversation: [],
    absence: null,
    warningDay: null,
    overtimeMs: 0,
    overtimeDate: null,
    lastTick: at,
    lateMinutes: 0,
    lateDate: null,
    serial: 0,
  };
}

export function desk(state: EmployeeState): Waypoint {
  return { kind: "desk", buildingId: state.buildingId, employeeId: state.id };
}

export function home(state: EmployeeState): Waypoint {
  return { kind: "home", employeeId: state.id, homeId: state.persona.homeId };
}
