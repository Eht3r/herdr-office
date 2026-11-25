import type { CampusWaypoint } from "./simulation.ts";
import {
  type Department,
  type Employee,
  type GroupDepartment,
  type Organization,
  placementOf,
  type RoomKind,
} from "./types.ts";

export type Point3 = [x: number, y: number, z: number];

export interface Rect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface DeskLayout {
  position: Point3;
  employee?: Employee;
  lead: boolean;
  scale: number;
}

export interface OfficeLayout {
  key: string;
  name: string;
  kind: "department" | "group";
  bounds: Rect;
  workspace: Rect | null;
  offices: OfficeLayout[];
  desks: DeskLayout[];
  vacant: boolean;
}

export { campusWaypointKinds as waypointKinds } from "./simulation.ts";
export type WaypointKind = CampusWaypoint;

export interface BuildingLayout {
  id: string;
  name: string;
  /** The building (site) this machine's space belongs to. */
  site: string;
  roomKind: RoomKind;
  roomName: string;
  /** Position among the rooms of its site; 0 carries the site's entrance sign. */
  section: number;
  sections: number;
  bounds: Rect;
  offices: OfficeLayout[];
  availablePlots: Rect[];
  waypoints: Record<WaypointKind, Point3>;
}

export interface CampusLayout {
  origin: Point3;
  bounds: Bounds;
  buildings: BuildingLayout[];
  walkways: Rect[];
}

export const CAMPUS_ORIGIN: Point3 = [0, 0, 0];
export const FLOOR_Y = 0.6;
const PLOT_WIDTH = 10.8;
const PLOT_DEPTH = 10.2;
const COLUMNS = 3;
const BUILDING_WIDTH = 36;
const BUILDING_DISTANCE = 43;
/** Rooms of one site sit wall to wall. */
const SECTION_DISTANCE = BUILDING_WIDTH + 0.6;
const FRONT = 8.8;

type Zone =
  | { kind: "department"; source: Department }
  | { kind: "group"; source: GroupDepartment };

export function departmentKey(id: string): string {
  return `department:${id}`;
}

export function groupKey(buildingId: string, id: string): string {
  return `group:${buildingId}:${id}`;
}

export function boundsOf({ x, z, width, depth }: Rect): Bounds {
  return {
    minX: x - width / 2,
    maxX: x + width / 2,
    minZ: z - depth / 2,
    maxZ: z + depth / 2,
  };
}

function stableHash(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function assignSlots<T extends { id: string }>(
  items: T[],
  columns: number,
): { item: T; slot: number }[] {
  const taken = new Set<number>();
  return [...items]
    .sort((a, b) => a.id.localeCompare(b.id, "en"))
    .map((item) => {
      const preferred = stableHash(item.id) % columns;
      let slot = preferred;
      // Try the other columns in each row before reserving a new row.
      while (taken.has(slot)) {
        const next = ((slot % columns) + 1) % columns;
        const row = Math.floor(slot / columns);
        slot = (next === preferred ? row + 1 : row) * columns + next;
      }
      taken.add(slot);
      return { item, slot };
    });
}

function zoneLayout(
  zone: Zone,
  bounds: Rect,
  buildingId: string,
): OfficeLayout {
  const { id, name, departments } = zone.source;
  const isDepartment = zone.kind === "department";
  const { employees, leadAddress, vacantSince } = isDepartment
    ? zone.source
    : {
        employees: [],
        leadAddress: null,
        vacantSince: null,
      };
  const edge = Math.min(0.25, bounds.width * 0.05, bounds.depth * 0.05);
  const innerDepth = bounds.depth - edge * 2;
  const workspaceDepth = departments.length ? innerDepth * 0.44 : innerDepth;
  const workspace = !isDepartment
    ? null
    : {
        x: bounds.x,
        z: bounds.z + (innerDepth - workspaceDepth) / 2,
        width: bounds.width - edge * 2,
        depth: workspaceDepth,
      };
  const childDepth = innerDepth - (workspace ? workspaceDepth + edge : 0);
  const childWidth = bounds.width - edge * 2;
  const childColumns = Math.max(1, Math.ceil(Math.sqrt(departments.length)));
  const placements = assignSlots(departments, childColumns);
  const childRows =
    1 +
    Math.max(
      0,
      ...placements.map(({ slot }) => Math.floor(slot / childColumns)),
    );
  const offices = placements.map(({ item, slot }) => {
    const width = childWidth / childColumns;
    const depth = childDepth / childRows;
    const gap = Math.min(edge, width * 0.15, depth * 0.15);
    return zoneLayout(
      { kind: "department", source: item },
      {
        x: bounds.x - childWidth / 2 + ((slot % childColumns) + 0.5) * width,
        z:
          bounds.z -
          innerDepth / 2 +
          (Math.floor(slot / childColumns) + 0.5) * depth,
        width: width - gap,
        depth: depth - gap,
      },
      buildingId,
    );
  });

  return {
    key: isDepartment ? departmentKey(id) : groupKey(buildingId, id),
    name,
    kind: zone.kind,
    bounds,
    workspace,
    offices,
    desks: workspace
      ? arrangeDesks(workspace, employees, leadAddress, vacantSince !== null)
      : [],
    vacant: vacantSince !== null,
  };
}

function arrangeDesks(
  workspace: Rect,
  employees: Employee[],
  leadAddress: string | null,
  vacant: boolean,
): DeskLayout[] {
  const lead = employees.find(({ address }) => address === leadAddress);
  const peers = employees
    .filter((employee) => employee !== lead)
    .sort((a, b) => a.address.localeCompare(b.address, "en"));
  const positions = peers.length || !vacant ? peers : [undefined, undefined];
  const deskArea = workspace.width - (lead ? workspace.width * 0.28 : 0);
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt((positions.length * deskArea) / workspace.depth)),
  );
  const rows = Math.ceil(positions.length / columns);
  const cellWidth = deskArea / columns;
  const cellDepth = workspace.depth / Math.max(1, rows);
  const desks: DeskLayout[] = positions.map((employee, index) => ({
    position: [
      workspace.x - workspace.width / 2 + ((index % columns) + 0.5) * cellWidth,
      FLOOR_Y,
      workspace.z -
        workspace.depth / 2 +
        (Math.floor(index / columns) + 0.47) * cellDepth,
    ],
    employee,
    lead: false,
    scale: Math.min(1, cellWidth / 2.25, cellDepth / 2.5),
  }));
  if (lead)
    desks.push({
      position: [
        workspace.x -
          workspace.width / 2 +
          deskArea +
          (workspace.width - deskArea) / 2,
        FLOOR_Y,
        workspace.z,
      ],
      employee: lead,
      lead: true,
      scale: Math.min(
        1,
        (workspace.width - deskArea) / 2.35,
        workspace.depth / 2.5,
      ),
    });
  return desks;
}

export function computeCampusLayout(organization: Organization): CampusLayout {
  const byId = (a: { id: string }, b: { id: string }) => {
    if (a.id === "local") return b.id === "local" ? 0 : -1;
    if (b.id === "local") return 1;
    return a.id.localeCompare(b.id, "en");
  };
  // Sites keep the order of their first machine; rooms of a site stay together.
  const ordered = [...organization.buildings].sort(byId);
  const siteOrder = [...new Set(ordered.map((m) => placementOf(m).site))];
  const machines = ordered.sort(
    (a, b) =>
      siteOrder.indexOf(placementOf(a).site) -
        siteOrder.indexOf(placementOf(b).site) || byId(a, b),
  );
  const sectionCount = new Map<string, number>();
  for (const machine of machines) {
    const { site } = placementOf(machine);
    sectionCount.set(site, (sectionCount.get(site) ?? 0) + 1);
  }
  let cursor = 0;
  let previousSite: string | null = null;
  const seen = new Map<string, number>();
  const buildings: BuildingLayout[] = machines.map((building) => {
    const placement = placementOf(building);
    if (previousSite !== null)
      cursor +=
        placement.site === previousSite ? SECTION_DISTANCE : BUILDING_DISTANCE;
    previousSite = placement.site;
    const section = seen.get(placement.site) ?? 0;
    seen.set(placement.site, section + 1);
    const x = cursor;
    const zones = [
      ...building.departments.map(
        (source) => ({ id: source.id, kind: "department", source }) as const,
      ),
      ...building.groups.map(
        (source) =>
          ({ id: `group:${source.id}`, kind: "group", source }) as const,
      ),
    ];
    const slots = assignSlots(zones, COLUMNS);
    const rows =
      1 + Math.max(0, ...slots.map(({ slot }) => Math.floor(slot / COLUMNS)));
    const back = -8.8 - (rows - 1) * PLOT_DEPTH;
    const width = BUILDING_WIDTH;
    const plot = (slot: number): Rect => ({
      x: x + ((slot % COLUMNS) - 1) * (PLOT_WIDTH + 0.55),
      z: -2.7 - Math.floor(slot / COLUMNS) * PLOT_DEPTH,
      width: PLOT_WIDTH,
      depth: PLOT_DEPTH - 0.35,
    });
    const occupied = new Set(slots.map(({ slot }) => slot));
    return {
      id: building.id,
      name: building.name,
      ...placement,
      section,
      sections: sectionCount.get(placement.site) ?? 1,
      bounds: { x, z: (back + FRONT) / 2, width, depth: FRONT - back },
      offices: slots.map(({ item, slot }) =>
        zoneLayout(item, plot(slot), building.id),
      ),
      availablePlots: Array.from({ length: COLUMNS * rows }, (_, slot) => slot)
        .filter((slot) => !occupied.has(slot))
        .map(plot),
      waypoints: {
        entrance: [x, 0.26, FRONT + 1.5],
        elevator: [x, FLOOR_Y, FRONT - 2.25],
        kitchenette: [x - 13, FLOOR_Y, FRONT - 3.15],
        restroom: [x - 7.2, FLOOR_Y, FRONT - 3.15],
        lounge: [x + 7.2, FLOOR_Y, FRONT - 3.15],
        sleepCapsules: [x + 13, FLOOR_Y, FRONT - 3.15],
        rooftop: [x + 16.65, FLOOR_Y + 2.28, FRONT - 3.15],
      },
    };
  });

  // Covered walkways link separate sites; rooms of one site share a wall.
  const walkways = buildings.slice(1).flatMap((building, index) =>
    building.site === buildings[index].site
      ? []
      : [
          {
            x: (building.bounds.x + buildings[index].bounds.x) / 2,
            z: FRONT - 0.9,
            width: BUILDING_DISTANCE - BUILDING_WIDTH + 1.1,
            depth: 2.65,
          },
        ],
  );
  const extents = buildings.map((building) => boundsOf(building.bounds));
  return {
    origin: [...CAMPUS_ORIGIN],
    buildings,
    walkways,
    bounds: buildings.length
      ? {
          minX: Math.min(...extents.map(({ minX }) => minX)) - 4,
          maxX: Math.max(...extents.map(({ maxX }) => maxX)) + 4,
          minZ: Math.min(...extents.map(({ minZ }) => minZ)) - 3,
          maxZ: FRONT + 4.75,
        }
      : { minX: -21, maxX: 21, minZ: -11, maxZ: 13.55 },
  };
}

export function findOffice(
  offices: OfficeLayout[],
  key: string,
): OfficeLayout | undefined {
  for (const office of offices) {
    if (office.key === key) return office;
    const child = findOffice(office.offices, key);
    if (child) return child;
  }
}
