import type {
  Action,
  ActionKind,
  ActionProps,
  CommuteMode,
  Waypoint,
} from "@herdr-office/core";
import { hashSeed } from "@herdr-office/core";
import { desk, type EmployeeState, home } from "./employeeState.ts";

export function queueAction(
  state: EmployeeState,
  at: number,
  kind: ActionKind,
  to: Waypoint,
  durationMs: number,
  line = "",
  props: ActionProps = {},
): void {
  const previous = state.actions.at(-1);
  const startAt = previous ? previous.startAt + previous.durationMs : at;
  state.actions.push({
    id: `${state.id}:${startAt}:${state.serial++}`,
    employeeId: state.id,
    kind,
    from: previous?.to ?? state.position,
    to,
    startAt,
    durationMs,
    props,
    line,
  });
}

export function completeActions(state: EmployeeState, at: number): void {
  const pending: Action[] = [];
  for (const action of state.actions) {
    if (action.startAt + action.durationMs > at) {
      pending.push(action);
      continue;
    }
    state.position = action.to;
    if (action.kind === "readNotes") {
      state.notes = Math.max(0, state.notes - (action.props.noteCount ?? 0));
      const read = new Set(
        action.props.notes?.map(({ fromId, at }) =>
          JSON.stringify([fromId, at]),
        ),
      );
      state.inbox = state.inbox?.filter(
        ({ fromId, at }) => !read.has(JSON.stringify([fromId, at])),
      );
    }
  }
  state.actions = pending;
}

export function atHome(state: EmployeeState): boolean {
  return state.position.kind === "home";
}

type Commute = Extract<
  ActionKind,
  | "commuteIn"
  | "commuteOut"
  | "firstCommute"
  | "finalDeparture"
  | "emergencyCommute"
  | "return"
>;

const travelTime: Record<CommuteMode, number> = {
  walk: 95_000,
  bus: 82_000,
  subway: 76_000,
  bicycle: 62_000,
  car: 61_000,
  taxi: 44_000,
  run: 54_000,
};

export function commute(
  state: EmployeeState,
  at: number,
  kind: Commute,
  inbound: boolean,
  line: string,
  reason = inbound ? "arrival" : "departure",
  transport: CommuteMode = state.persona.commute,
): void {
  const entrance: Waypoint = { kind: "entrance", buildingId: state.buildingId };
  const elevator: Waypoint = { kind: "elevator", buildingId: state.buildingId };
  const station: Waypoint = {
    kind: "station",
    buildingId: state.buildingId,
    employeeId: state.id,
  };
  const transfer = transport === "bus" || transport === "subway";
  const trip = `${state.id}:${at}:trip`;
  const props: ActionProps = {
    reason,
    transport,
    trip,
    ...(reason === "specialShift" ? { items: ["casualClothes"] } : {}),
  };
  const speed = kind === "emergencyCommute" ? 3_000 : 4_500;
  const road = travelTime[transport];
  const segments: [Waypoint, number][] = inbound
    ? [
        ...(transfer ? [[station, 16_000] as [Waypoint, number]] : []),
        [entrance, road],
        [elevator, speed],
        [desk(state), speed],
      ]
    : [
        [elevator, speed],
        [entrance, speed],
        ...(transfer ? [[station, 16_000] as [Waypoint, number]] : []),
        [home(state), road],
      ];
  const detour =
    kind === "commuteOut" &&
    reason === "departure" &&
    hashSeed(`${state.id}:${new Date(at).toISOString().slice(0, 10)}:shop`) %
      4 ===
      0;
  for (const [index, [to, duration]] of segments.entries()) {
    queueAction(
      state,
      at,
      index === 0 ? kind : "move",
      to,
      duration,
      index === 0 ? line : "",
      props,
    );
    if (detour && to.kind === "entrance") {
      const store: Waypoint = {
        kind: "convenienceStore",
        buildingId: state.buildingId,
      };
      queueAction(state, at, "move", store, 12_000, "", {
        ...props,
        transport: "walk",
      });
      queueAction(
        state,
        at,
        "break",
        store,
        24_000,
        "집에 가기 전에 간식 하나 사 갈게요.",
        {
          ...props,
          transport: "walk",
          motion: "shop",
          activity: "commuteShop",
        },
      );
    }
  }
}
