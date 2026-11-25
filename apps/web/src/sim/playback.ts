import {
  type Action,
  type CommuteMode,
  type Employee,
  employeeHomeId,
  hashSeed,
  type Neighborhood,
  type Waypoint,
} from "@herdr-office/core";
import {
  type CampusLayout,
  type DeskLayout,
  FLOOR_Y,
  type OfficeLayout,
  type Point3,
} from "../layout/campusLayout.ts";
import { findPath, type GridPoint } from "./path.ts";

export interface DeskAnchor {
  desk: DeskLayout;
  employee: Employee;
  position: Point3;
}
export interface PlaybackRoute {
  points: Point3[];
  offsets: number[];
  distance: number;
}

export function collectDesks(campus: CampusLayout): Map<string, DeskAnchor> {
  const employees = new Map<string, DeskAnchor>();
  const visit = (office: OfficeLayout) => {
    for (const desk of office.desks) {
      if (desk.employee)
        employees.set(desk.employee.address, {
          desk,
          employee: desk.employee,
          position: [
            desk.position[0],
            desk.position[1],
            desk.position[2] + 0.49 * desk.scale,
          ],
        });
    }
    office.offices.forEach(visit);
  };
  for (const building of campus.buildings) building.offices.forEach(visit);
  return employees;
}

export function waypointPosition(
  waypoint: Waypoint,
  actor: string,
  campus: CampusLayout,
  town: Neighborhood,
  desks: Map<string, DeskAnchor>,
  transport?: CommuteMode,
): Point3 {
  const address = waypoint.employeeId ?? actor;
  const building = campus.buildings.find(
    ({ id }) =>
      id === (waypoint.buildingId ?? desks.get(address)?.employee.machineId),
  );
  const fallback =
    building?.waypoints.entrance ??
    campus.buildings[0]?.waypoints.entrance ??
    campus.origin;
  switch (waypoint.kind) {
    case "desk":
      return (
        desks.get(address)?.position ?? building?.waypoints.elevator ?? fallback
      );
    case "home":
      return (
        town.homes[waypoint.homeId ?? employeeHomeId(address)]?.position ??
        fallback
      );
    case "station":
      return (
        (transport === "subway" &&
          town.entities.find(({ id }) => id === `metro-${building?.id}`)
            ?.entrance.position) ||
        (building && town.stations[building.id]) ||
        fallback
      );
    case "park":
    case "convenienceStore":
    case "cafe":
    case "restaurant": {
      const locations = town.destinations[waypoint.kind];
      return locations[hashSeed(address) % locations.length] ?? fallback;
    }
    default:
      return building?.waypoints[waypoint.kind] ?? fallback;
  }
}

function contains(
  rect: { x: number; z: number; width: number; depth: number },
  x: number,
  z: number,
  pad = 0,
): boolean {
  return (
    Math.abs(x - rect.x) < rect.width / 2 + pad &&
    Math.abs(z - rect.z) < rect.depth / 2 + pad
  );
}

function routeFromPoints(points: Point3[]): PlaybackRoute {
  const offsets = [0];
  for (let i = 1; i < points.length; i++) {
    const [x, y, z] = points[i];
    const [a, b, c] = points[i - 1];
    offsets.push(offsets[i - 1] + Math.hypot(x - a, y - b, z - c));
  }
  return { points, offsets, distance: offsets.at(-1) ?? 0 };
}

const nonWalking = new Set(["bus", "car", "taxi", "subway", "bicycle"]);

export function vehicleSegment(action: Action): boolean {
  const { transport, trip } = action.props;
  return Boolean(
    transport &&
      trip &&
      nonWalking.has(transport) &&
      (["home", "station"].includes(action.from.kind) ||
        ["home", "station"].includes(action.to.kind)),
  );
}

export function routePlanner(town: Neighborhood, campus: CampusLayout) {
  const { minX, minZ, maxX, maxZ } = town.bounds;
  const step = 1.45;
  const width = Math.ceil((maxX - minX) / step) + 1;
  const depth = Math.ceil((maxZ - minZ) / step) + 1;
  const solids = town.entities
    .filter(
      ({ kind }) => !["park", "parking", "busStop", "subway"].includes(kind),
    )
    .map(({ parcel }) => parcel);
  const deck = [
    ...campus.buildings.map(({ bounds }) => bounds),
    ...campus.walkways,
  ];
  const crosswalks = town.crossings.map(
    ({ axis, position: [x, , z], width: crossingWidth }) => ({
      x,
      z,
      width: axis === "x" ? 3.8 : crossingWidth + 2,
      depth: axis === "x" ? crossingWidth + 2 : 3.8,
    }),
  );
  const blocked = new Uint8Array(width * depth);
  const roads = new Uint8Array(width * depth);
  for (let z = 0; z < depth; z++)
    for (let x = 0; x < width; x++) {
      const px = minX + x * step;
      const pz = minZ + z * step;
      const index = z * width + x;
      if (solids.some((rect) => contains(rect, px, pz, -0.18))) {
        blocked[index] = 1;
      } else if (
        town.roads.some(({ parcel }) => contains(parcel, px, pz, -0.15)) &&
        !crosswalks.some((rect) => contains(rect, px, pz))
      ) {
        roads[index] = 1;
      }
    }
  const gridPoint = (point: Point3): GridPoint => ({
    x: Math.min(width - 1, Math.max(0, Math.round((point[0] - minX) / step))),
    z: Math.min(depth - 1, Math.max(0, Math.round((point[2] - minZ) / step))),
  });
  return (from: Point3, to: Point3, driving = false): PlaybackRoute => {
    if (Math.hypot(from[0] - to[0], from[2] - to[2]) < step * 1.4)
      return routeFromPoints([from, to]);
    const impassable = ({ x, z }: GridPoint) =>
      Boolean(blocked[z * width + x] || (!driving && roads[z * width + x]));
    const nearest = (point: GridPoint) => {
      if (!impassable(point)) return point;
      for (let radius = 1; radius <= 4; radius++) {
        for (let dz = -radius; dz <= radius; dz++)
          for (let dx = -radius; dx <= radius; dx++) {
            const x = point.x + dx;
            const z = point.z + dz;
            if (
              Math.abs(dx) + Math.abs(dz) === radius &&
              x >= 0 &&
              x < width &&
              z >= 0 &&
              z < depth &&
              !impassable({ x, z })
            )
              return { x, z };
          }
      }
      return point;
    };
    const start = nearest(gridPoint(from));
    const end = nearest(gridPoint(to));
    const grid =
      findPath({ width, depth, blocked: impassable }, start, end) ??
      findPath(
        {
          width,
          depth,
          blocked: ({ x, z }) => Boolean(blocked[z * width + x]),
        },
        start,
        end,
      );
    if (!grid) return routeFromPoints([from, to]);
    const points: Point3[] = grid.map(({ x, z }) => {
      const px = minX + x * step;
      const pz = minZ + z * step;
      return [
        px,
        deck.some((rect) => contains(rect, px, pz)) ? FLOOR_Y : 0.12,
        pz,
      ];
    });
    const turns = points.filter(([x, y, z], index) => {
      const before = points[index - 1];
      const after = points[index + 1];
      return (
        !before ||
        !after ||
        y !== before[1] ||
        y !== after[1] ||
        (before[0] !== after[0] && before[2] !== after[2]) ||
        (x === before[0] && z === before[2])
      );
    });
    return routeFromPoints([from, ...turns, to]);
  };
}

export function actionFrame(
  actions: Action[],
  at: number,
): { active?: Action; last?: Action; progress: number } {
  let last: Action | undefined;
  for (const action of actions) {
    if (action.startAt > at) break;
    if (action.startAt + action.durationMs > at) {
      return {
        active: action,
        last,
        progress: (at - action.startAt) / Math.max(1, action.durationMs),
      };
    }
    last = action;
  }
  return { last, progress: 1 };
}

export function interpolateRoute(
  route: PlaybackRoute,
  fraction: number,
): { point: Point3; angle: number } {
  const travelled = Math.min(1, Math.max(0, fraction)) * route.distance;
  if (route.distance === 0) return { point: route.points[0], angle: 0 };
  let next = route.offsets.findIndex(
    (offset, index) => index > 0 && offset > travelled,
  );
  if (next < 0) next = route.offsets.length - 1;
  const from = route.points[next - 1];
  const to = route.points[next];
  const ratio =
    (travelled - route.offsets[next - 1]) /
    Math.max(0.000001, route.offsets[next] - route.offsets[next - 1]);
  return {
    point: [
      from[0] + (to[0] - from[0]) * ratio,
      from[1] + (to[1] - from[1]) * ratio,
      from[2] + (to[2] - from[2]) * ratio,
    ],
    angle: Math.atan2(from[0] - to[0], from[2] - to[2]),
  };
}
