import type {
  Action,
  Employee,
  Neighborhood,
  Timeline,
  Waypoint,
} from "@herdr-office/core";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import type { CampusLayout } from "../layout/campusLayout.ts";
import {
  actionFrame,
  collectDesks,
  type DeskAnchor,
  interpolateRoute,
  routePlanner,
  vehicleSegment,
  waypointPosition,
} from "../sim/playback.ts";
import { employeeName } from "../ui/employee.ts";
import { VehicleModel } from "./ActionProps.tsx";
import { Character } from "./Character.tsx";
import { SceneLabel } from "./SceneLabels.tsx";

const absenceLabel = {
  powerNap: "쪽잠",
  sleep: "수면",
  earlyLeave: "조기퇴근",
  vacation: "연차",
};

export interface Playback {
  timeline: Timeline | null;
  now: number;
  actualNow: () => number;
}

function shellEmployee(address: string, buildingId: string): Employee {
  return {
    address,
    machineId: buildingId,
    spaceId: "departure",
    name: null,
    cwd: "",
    status: null,
    agent: null,
    title: "",
    parent: null,
    turn: 0,
    labels: {},
  };
}

function durationLabel(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 60_000));
  if (total === 0) return "복귀 예정";
  if (total < 60) return `${total}분 후 복귀`;
  if (total < 24 * 60)
    return `${Math.floor(total / 60)}시간 ${total % 60}분 후 복귀`;
  return `${Math.floor(total / 1440)}일 ${Math.floor((total % 1440) / 60)}시간 후 복귀`;
}

function pose(
  action: Action | undefined,
  moving: boolean,
  person: Employee,
): string {
  if (moving) return action?.props.transport === "run" ? "run" : "walk";
  if (!action) return person.status === "working" ? "type" : "sit";
  if (action.kind === "videocall") return "videocall";
  if (action.kind === "work" || action.kind === "overtime") return "type";
  if (action.kind === "absence") return "lieDown";
  if (action.kind === "react" && action.props.reason === "done")
    return "stretch";
  return action.props.motion ?? "sit";
}

const emptyActions: Action[] = [];

function Track({
  person,
  anchor,
  actions,
  position,
  notes,
  selected,
  focused,
  reduceMotion,
  playback,
  locate,
  navigate,
  onSelect,
}: {
  person: Employee;
  anchor?: DeskAnchor;
  actions: Action[];
  position?: Waypoint;
  notes?: number;
  selected: boolean;
  focused: boolean;
  reduceMotion: boolean;
  playback: Playback;
  locate: (
    waypoint: Waypoint,
    actor: string,
    transport?: Action["props"]["transport"],
  ) => [number, number, number];
  navigate: ReturnType<typeof routePlanner>;
  onSelect: () => void;
}) {
  const ref = useRef<Group>(null);
  const tracks = useMemo(
    () =>
      new Map(
        actions.map((action) => [
          action.id,
          navigate(
            locate(action.from, person.address, action.props.transport),
            locate(action.to, person.address, action.props.transport),
            vehicleSegment(action),
          ),
        ]),
      ),
    [actions, navigate, locate, person.address],
  );

  const { active, last } = actionFrame(actions, playback.now);
  const destination = last?.to ??
    position ?? { kind: "desk", employeeId: person.address };
  const point = locate(
    active?.from ?? destination,
    person.address,
    active?.props.transport,
  );
  const moving = Boolean(
    active && (tracks.get(active.id)?.distance ?? 0) > 0.2,
  );
  const absence = actions.find(
    (action) =>
      action.kind === "absence" &&
      (action.startAt <= playback.now ||
        (active?.props.reason &&
          active.props.reason === action.props.absence)) &&
      action.startAt + action.durationMs > playback.now,
  );
  const atHome = active?.to.kind === "home" || destination.kind === "home";
  const remote = Boolean(
    active?.props.remoteWork || (active?.kind === "videocall" && atHome),
  );
  const hidden =
    active?.kind === "absence" &&
    (active.props.absence === "vacation" ||
      active.props.absence === "earlyLeave");
  const offDuty = !active && destination.kind === "home";
  const bubble =
    active?.line &&
    playback.now - active.startAt < Math.min(active.durationMs, 7_500)
      ? active.line
      : null;
  const transport =
    active && moving && vehicleSegment(active)
      ? active.props.transport
      : undefined;
  const caption = absence?.props.absence
    ? absenceLabel[absence.props.absence]
    : remote
      ? "재택근무"
      : null;

  useFrame(() => {
    if (!ref.current) return;
    const frame = actionFrame(actions, playback.actualNow());
    const current = frame.active;
    const route = current && tracks.get(current.id);
    const sample = route ? interpolateRoute(route, frame.progress) : null;
    ref.current.position.set(
      ...(sample?.point ??
        locate(frame.last?.to ?? position ?? destination, person.address)),
    );
    const isMoving = route && route.distance > 0.2;
    ref.current.rotation.y = isMoving && sample ? sample.angle : 0;
    const fromDesk = current
      ? current.from.kind === "desk" && current.to.kind === "desk" && !isMoving
      : destination.kind === "desk";
    ref.current.scale.setScalar(fromDesk ? (anchor?.desk.scale ?? 1) : 1);
  });

  return (
    <>
      {anchor && (caption || notes) && (
        <SceneLabel
          position={[
            anchor.position[0],
            anchor.position[1] + 1.35,
            anchor.position[2],
          ]}
          order={11}
        >
          <div
            className="desk-sign"
            data-action={
              absence?.props.absence ?? (remote ? "remote" : "notes")
            }
          >
            <strong>
              {employeeName(person)} {caption}
            </strong>
            {absence?.props.resetAt ? (
              <span>{durationLabel(absence.props.resetAt - playback.now)}</span>
            ) : absence ? (
              <span>복귀 시각 미정</span>
            ) : null}
            {Boolean(notes) && <span>쪽지 {notes}개</span>}
          </div>
        </SceneLabel>
      )}
      {!hidden && !offDuty && (
        <group ref={ref} position={point}>
          {transport && !["walk", "run"].includes(transport) ? (
            <VehicleModel mode={transport} />
          ) : (
            <Character
              employee={person}
              lead={anchor?.desk.lead ?? false}
              selected={selected}
              showLabel={focused}
              reduceMotion={reduceMotion}
              motion={pose(active, moving, person)}
              item={active?.props.items?.[0]}
              remote={remote && !moving}
              onSelect={onSelect}
            />
          )}
          {bubble && (
            <SceneLabel position={[0, 2.15, 0]} order={17}>
              <span className="speech-balloon">{bubble}</span>
            </SceneLabel>
          )}
        </group>
      )}
    </>
  );
}

export function Actors({
  campus,
  town,
  playback,
  selected,
  building,
  reduceMotion,
  onSelect,
}: {
  campus: CampusLayout;
  town: Neighborhood;
  playback: Playback;
  selected: string | null;
  building: string | null;
  reduceMotion: boolean;
  onSelect: (buildingId: string, address: string) => void;
}) {
  const desks = useMemo(() => collectDesks(campus), [campus]);
  const navigate = useMemo(() => routePlanner(town, campus), [town, campus]);
  const locate = useMemo(
    () =>
      (
        waypoint: Waypoint,
        actor: string,
        transport?: Action["props"]["transport"],
      ) =>
        waypointPosition(waypoint, actor, campus, town, desks, transport),
    [campus, town, desks],
  );
  const tracks = useMemo(() => {
    const map = new Map<string, Action[]>();
    for (const action of playback.timeline?.actions ?? []) {
      const items = map.get(action.employeeId) ?? [];
      items.push(action);
      map.set(action.employeeId, items);
    }
    return map;
  }, [playback.timeline?.actions]);
  const actors = new Set([...desks.keys(), ...tracks.keys()]);
  return [...actors].map((id) => {
    const anchor = desks.get(id);
    const actions = tracks.get(id) ?? emptyActions;
    const fallbackBuilding =
      actions.find((action) => action.from.buildingId)?.from.buildingId ??
      actions.find((action) => action.to.buildingId)?.to.buildingId;
    const person =
      anchor?.employee ?? shellEmployee(id, fallbackBuilding ?? "local");
    return (
      <Track
        key={id}
        person={person}
        anchor={anchor}
        actions={actions}
        position={playback.timeline?.positions?.[id]}
        notes={playback.timeline?.notesByEmployee?.[id]}
        selected={id === selected}
        focused={Boolean(building && building === person.machineId)}
        reduceMotion={reduceMotion}
        playback={playback}
        locate={locate}
        navigate={navigate}
        onSelect={() => onSelect(person.machineId, id)}
      />
    );
  });
}
