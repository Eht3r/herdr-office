import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type {
  Building,
  Department,
  OfficeDelta,
  OfficeSnapshot,
  Timeline,
} from "@herdr-office/core";

export function publicMachineId(id: string): string {
  return id === "local"
    ? id
    : `building-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
}

export function publicAddress(address: string): string {
  const separator = address.lastIndexOf("/");
  if (separator < 0) return address;
  return `${publicMachineId(address.slice(0, separator))}/${address.slice(separator + 1)}`;
}

export function withoutIp(value: string): string {
  return value.replace(/\[?[a-f\d.:]+(?:%[\w-]+)?\]?/giu, (candidate) => {
    const address = candidate.replace(/^\[|\]$/gu, "");
    const stripped = address.replace(/\.$/u, "");
    if (isIP(stripped)) return "[주소 숨김]";
    // Also accept an IPv4 address followed by a port.
    const host = stripped.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/u)?.[1];
    return host && isIP(host) ? "[주소 숨김]" : candidate;
  });
}

export function hostnameLabel(value: string | undefined): string | undefined {
  const host = value?.trim().replace(/\.$/u, "");
  if (!host || withoutIp(host) !== host) return undefined;
  return host.endsWith(".local") ? host.slice(0, -6) : host;
}

function publicDepartment(department: Department): Department {
  return {
    ...department,
    name: withoutIp(department.name),
    machineId: publicMachineId(department.machineId),
    folder: department.folder === null ? null : withoutIp(department.folder),
    leadAddress: department.leadAddress
      ? publicAddress(department.leadAddress)
      : null,
    departments: department.departments.map(publicDepartment),
    employees: department.employees.map((employee) => ({
      ...employee,
      address: publicAddress(employee.address),
      machineId: publicMachineId(employee.machineId),
      parent: employee.parent ? publicAddress(employee.parent) : null,
      name: employee.name ? withoutIp(employee.name) : null,
      cwd: withoutIp(employee.cwd),
      title: withoutIp(employee.title),
      labels: Object.fromEntries(
        Object.entries(employee.labels).map(([key, value]) => [
          withoutIp(key),
          withoutIp(value),
        ]),
      ),
    })),
  };
}

export function publicBuilding(building: Building): Building {
  return {
    ...building,
    id: publicMachineId(building.id),
    host: hostnameLabel(building.host),
    name: withoutIp(building.name),
    ...(building.site ? { site: withoutIp(building.site) } : {}),
    ...(building.roomName ? { roomName: withoutIp(building.roomName) } : {}),
    departments: building.departments.map(publicDepartment),
    groups: building.groups.map((group) => ({
      ...group,
      name: withoutIp(group.name),
      departments: group.departments.map(publicDepartment),
    })),
  };
}

export function publicSnapshot(snapshot: OfficeSnapshot): OfficeSnapshot {
  return {
    ...snapshot,
    organization: {
      buildings: snapshot.organization.buildings.map(publicBuilding),
    },
  };
}

export function publicDelta({
  revision,
  connected,
  buildings,
}: OfficeDelta): OfficeDelta {
  return {
    revision,
    connected,
    ...(buildings
      ? {
          buildings: {
            upsert: buildings.upsert.map(publicBuilding),
            remove: buildings.remove.map(publicMachineId),
          },
        }
      : {}),
  };
}

function publicEmployee(
  employee: Department["employees"][number],
): Department["employees"][number] {
  return {
    ...employee,
    // Working directories reveal user names and project paths.
    cwd: "",
    title: "",
    labels: Object.fromEntries(
      Object.entries(employee.labels).filter(([key]) => key.endsWith(".role")),
    ),
  };
}

function publicViewerDepartment(department: Department): Department {
  return {
    ...department,
    folder: null,
    employees: department.employees.map(publicEmployee),
    departments: department.departments.map(publicViewerDepartment),
  };
}

/** What a viewer may see of the organization. Owners see it as it is. */
export function viewerSnapshot(
  snapshot: OfficeSnapshot,
  viewer: "owner" | "public",
): OfficeSnapshot {
  if (viewer === "owner") return snapshot;
  return {
    ...snapshot,
    organization: {
      buildings: snapshot.organization.buildings.map((building) => ({
        ...building,
        host: undefined,
        departments: building.departments.map(publicViewerDepartment),
        groups: building.groups.map((group) => ({
          ...group,
          departments: group.departments.map(publicViewerDepartment),
        })),
      })),
    },
  };
}

const spokenKinds = new Set(["talk", "videocall", "leaveNote", "readNotes"]);

/**
 * The public never sees usage numbers or note contents, and when speech is
 * configured beyond status, conversation lines are dropped for them too.
 */
export function viewerTimeline(
  timeline: Timeline,
  viewer: "owner" | "public",
  detailedSpeech: boolean,
): Timeline {
  if (viewer === "owner") return timeline;
  return {
    ...timeline,
    actions: timeline.actions.map((action) => {
      const {
        usedPct: _used,
        notes: _notes,
        reason: _reason,
        ...props
      } = action.props;
      return {
        ...action,
        props,
        line: detailedSpeech && spokenKinds.has(action.kind) ? "" : action.line,
      };
    }),
  };
}
