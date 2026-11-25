import {
  type Action,
  type Audience,
  type Department,
  type ExposureLevel,
  employeeHomeId,
  exposureLevels,
  hashSeed,
  type Note,
  type OfficeSettings,
  type OfficeSnapshot,
  type SpeechVariants,
  type Timeline,
  type TownFrame,
  type Waypoint,
} from "@herdr-office/core";
import { viewerSnapshot } from "../state/publicView.ts";

export function visibility(
  settings: OfficeSettings,
  viewer: Audience,
  teamId: string,
): ExposureLevel {
  return (
    (Object.hasOwn(settings.sharing.teams, teamId)
      ? settings.sharing.teams[teamId][viewer]
      : undefined) ?? settings.sharing.speech[viewer]
  );
}

function lower(a: ExposureLevel, b: ExposureLevel): ExposureLevel {
  return exposureLevels[
    Math.min(exposureLevels.indexOf(a), exposureLevels.indexOf(b))
  ];
}

function departments(snapshot: OfficeSnapshot): Department[] {
  const flatten = (departments: Department[]): Department[] =>
    departments.flatMap((department) => [
      department,
      ...flatten(department.departments),
    ]);
  return snapshot.organization.buildings.flatMap(({ departments, groups }) => [
    ...flatten(departments),
    ...groups.flatMap((group) => flatten(group.departments)),
  ]);
}

const conversation = new Set<Action["kind"]>([
  "talk",
  "videocall",
  "readNotes",
  "leaveNote",
]);
const titleAllowed = (level: ExposureLevel) =>
  exposureLevels.indexOf(level) >= exposureLevels.indexOf("title");

export function settingsProjection(
  snapshot: OfficeSnapshot,
  settings: OfficeSettings,
  viewer: Audience,
  mask: (value: string) => string,
) {
  const levels = new Map<string, ExposureLevel>();
  const hiddenNames = new Set<string>();
  for (const team of departments(snapshot)) {
    const level = visibility(settings, viewer, team.id);
    for (const employee of team.employees) {
      levels.set(employee.address, level);
      if (level === "hidden" && employee.name) hiddenNames.add(employee.name);
    }
  }
  const level = (id: string) =>
    levels.get(id) ??
    (viewer === "public" ? "hidden" : settings.sharing.speech.owner);
  const visible = (id: string) => viewer === "owner" || level(id) !== "hidden";
  const titles = new Map(
    departments(snapshot).flatMap((team) =>
      team.employees.map(({ address, title }) => [address, title] as const),
    ),
  );
  const projectDepartment = (team: Department): Department => {
    const hidden =
      viewer === "public" && visibility(settings, viewer, team.id) === "hidden";
    return {
      ...team,
      name: mask(team.name),
      folder: team.folder ? mask(team.folder) : null,
      leadAddress: hidden ? null : team.leadAddress,
      employees: hidden
        ? []
        : team.employees.map((employee) => ({
            ...employee,
            name: employee.name ? mask(employee.name) : null,
            cwd: mask(employee.cwd),
            title: titleAllowed(level(employee.address))
              ? mask(titles.get(employee.address) ?? "")
              : "",
            parent:
              employee.parent && visible(employee.parent)
                ? employee.parent
                : null,
            labels: Object.fromEntries(
              Object.entries(employee.labels).map(([key, value]) => [
                mask(key),
                mask(value),
              ]),
            ),
          })),
      departments: team.departments.map(projectDepartment),
    };
  };
  const safe = viewerSnapshot(snapshot, viewer);
  const organization = {
    buildings: safe.organization.buildings.map((building) => ({
      ...building,
      name: mask(building.name),
      ...(building.site ? { site: mask(building.site) } : {}),
      ...(building.roomName ? { roomName: mask(building.roomName) } : {}),
      departments: building.departments.map(projectDepartment),
      groups: building.groups.map((group) => ({
        ...group,
        name: mask(group.name),
        departments: group.departments.map(projectDepartment),
      })),
    })),
  };
  const hiddenHomes = new Set(
    [...levels]
      .filter(([id]) => !visible(id))
      .map(([id]) => employeeHomeId(id)),
  );
  const safePoint = (point: Waypoint, employeeId: string): Waypoint =>
    (point.employeeId && !visible(point.employeeId)) ||
    (point.homeId && hiddenHomes.has(point.homeId))
      ? { kind: "desk", employeeId, buildingId: point.buildingId }
      : point;
  const byPerson = <T>(
    record: Record<string, T> | undefined,
    project: (value: T, id: string) => T,
  ): Record<string, T> =>
    Object.fromEntries(
      Object.entries(record ?? {})
        .filter(([id]) => visible(id))
        .map(([id, value]) => [id, project(value, id)]),
    );
  const lineAt = (
    speech: SpeechVariants,
    scope: Exclude<ExposureLevel, "hidden">,
  ) => {
    const raw = mask(speech.raw);
    // A rule installed after capture can match text beyond a title's truncation.
    if (raw !== speech.raw && (scope === "title" || scope === "messages"))
      return mask(speech.status);
    return scope === "raw" ? raw : mask(speech[scope]);
  };
  const notes = (items: Note[], recipient: string): Note[] =>
    items.flatMap(({ speech, line, ...note }) => {
      const scope = lower(level(note.fromId), level(recipient));
      if (scope === "hidden") return [];
      return [
        {
          ...note,
          line: speech ? lineAt(speech, scope) : mask("쪽지를 남겼어요."),
        },
      ];
    });
  const projectTimeline = (timeline: Timeline): Timeline => {
    const { inboxByEmployee, ...rest } = timeline;
    return {
      ...rest,
      usage: byPerson(timeline.usage, (usage) =>
        viewer === "owner"
          ? usage
          : { resetAt: usage.resetAt, exhausted: usage.exhausted },
      ),
      positions: byPerson(timeline.positions, safePoint),
      notesByEmployee: byPerson(timeline.notesByEmployee, (count, id) =>
        inboxByEmployee?.[id] ? notes(inboxByEmployee[id], id).length : count,
      ),
      ...(viewer === "owner"
        ? { inboxByEmployee: byPerson(inboxByEmployee, notes) }
        : {}),
      actions: timeline.actions
        .filter(({ employeeId }) => visible(employeeId))
        .map((action) => {
          const {
            speech,
            notes: inbox,
            companions,
            reason,
            usedPct,
            noteCount,
            ...props
          } = action.props;
          let scope = level(action.employeeId);
          for (const id of companions ?? []) scope = lower(scope, level(id));
          if (action.to.employeeId)
            scope = lower(scope, level(action.to.employeeId));
          const line =
            scope === "hidden"
              ? ""
              : speech
                ? lineAt(speech, scope)
                : conversation.has(action.kind) &&
                    (action.kind === "talk" || action.kind === "videocall")
                  ? "잠깐 이야기를 나눠요."
                  : action.line;
          return {
            ...action,
            from: safePoint(action.from, action.employeeId),
            to: safePoint(action.to, action.employeeId),
            line: mask(line),
            props: {
              ...props,
              ...(companions ? { companions: companions.filter(visible) } : {}),
              ...(viewer === "owner"
                ? {
                    reason,
                    usedPct,
                    noteCount,
                    ...(inbox
                      ? { notes: notes(inbox, action.employeeId) }
                      : {}),
                  }
                : {}),
            },
          };
        }),
    };
  };

  return {
    snapshot: { ...safe, organization },
    timeline: projectTimeline,
    town(frame: TownFrame): TownFrame {
      return {
        ...frame,
        layoutKey: `${frame.layoutKey}:${hashSeed([...hiddenHomes].sort().join(","))}`,
        neighborhood: {
          ...frame.neighborhood,
          homes: Object.fromEntries(
            Object.entries(frame.neighborhood.homes).filter(
              ([id]) => !hiddenHomes.has(id),
            ),
          ),
        },
        shops: frame.shops.map(({ greeting, regulars, ...shop }) => ({
          ...shop,
          regulars: regulars
            .filter((name) => viewer === "owner" || !hiddenNames.has(name))
            .map(mask),
          ...(greeting &&
          (viewer === "owner" ||
            ![...hiddenNames].some((name) => greeting.includes(name)))
            ? { greeting: mask(greeting) }
            : {}),
        })),
      };
    },
  };
}
