import { hashSeed } from "./identity.ts";
import type { TownWaypoint } from "./simulation.ts";

export type TownPoint = [number, number, number];
export interface TownBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface TownParcel {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export type TownEntityKind =
  | "apartment"
  | "house"
  | "convenienceStore"
  | "cafe"
  | "restaurant"
  | "park"
  | "bakery"
  | "bookstore"
  | "vacantShop"
  | "parking"
  | "busStop"
  | "subway";

export interface TownEntity {
  id: string;
  kind: TownEntityKind;
  name: string;
  position: TownPoint;
  entrance: { kind: TownWaypoint | "site"; position: TownPoint };
  parcel: TownParcel;
  capacity: number;
  variant: number;
}

export interface TownRoad {
  id: string;
  axis: "x" | "z";
  parcel: TownParcel;
  major: boolean;
}

export interface Crossing {
  id: string;
  axis: "x" | "z";
  position: TownPoint;
  roadId: string;
  width: number;
  phase: number;
}

export interface Neighborhood {
  seed: string;
  bounds: TownBounds;
  roads: TownRoad[];
  sidewalks: TownParcel[];
  crossings: Crossing[];
  entities: TownEntity[];
  trees: TownPoint[];
  lamps: TownPoint[];
  homes: Record<
    string,
    { entityId: string; position: TownPoint; unit: number }
  >;
  stations: Record<string, TownPoint>;
  destinations: Record<
    "convenienceStore" | "cafe" | "restaurant" | "park",
    TownPoint[]
  >;
}

interface TownInput {
  campus: TownBounds;
  buildings: { id: string; x: number }[];
  homeIds: string[];
  seed: string;
}

const starts = [
  "솔결",
  "느울",
  "물오름",
  "누리온",
  "한들",
  "포슬",
  "별노을",
  "새울",
  "오르담",
  "나무결",
  "바람틀",
  "단풍솔",
];
const ends = [
  "마루",
  "그리고",
  "뜰",
  "곁",
  "모퉁이",
  "다락",
  "온실",
  "정원",
  "골목",
];
const uses: Record<TownEntityKind, string> = {
  apartment: "공동주택",
  house: "주택",
  convenienceStore: "작은 상점",
  cafe: "커피집",
  restaurant: "식탁",
  park: "공원",
  bakery: "빵 공방",
  bookstore: "책방",
  vacantShop: "빈 점포",
  parking: "주차장",
  busStop: "정류장",
  subway: "역 입구",
};
const entryKinds: Partial<Record<TownEntityKind, TownWaypoint>> = {
  apartment: "home",
  house: "home",
  convenienceStore: "convenienceStore",
  cafe: "cafe",
  restaurant: "restaurant",
  park: "park",
  busStop: "station",
  subway: "station",
};
const capacities: Record<TownEntityKind, number> = {
  apartment: 6,
  house: 1,
  convenienceStore: 10,
  cafe: 16,
  restaurant: 22,
  park: 38,
  bakery: 12,
  bookstore: 10,
  vacantShop: 12,
  parking: 12,
  busStop: 8,
  subway: 24,
};

function parcel(
  x: number,
  z: number,
  width: number,
  depth: number,
): TownParcel {
  return { x, z, width, depth };
}
const center = (minimum: number, maximum: number) => (minimum + maximum) / 2;

export function townGen({
  campus,
  buildings,
  homeIds,
  seed,
}: TownInput): Neighborhood {
  const { minX, maxX, minZ, maxZ } = campus;
  const midX = center(minX, maxX);
  const midZ = center(minZ, maxZ);
  const left = minX - 9.5;
  const right = maxX + 9.5;
  const back = minZ - 9.5;
  const front = maxZ + 9.5;
  const span = right - left;
  const entities: TownEntity[] = [];
  const sidewalks: TownParcel[] = [];
  const roads: TownRoad[] = [];
  const crossings: Crossing[] = [];
  const trees: TownPoint[] = [];
  const lamps: TownPoint[] = [];
  const names = new Set<string>();

  const add = (
    id: string,
    kind: TownEntityKind,
    lot: TownParcel,
    facing = 1,
  ): TownEntity => {
    const variant = hashSeed(`${seed}:${id}`);
    const root = `${starts[variant % starts.length]}${ends[(variant >>> 8) % ends.length]}`;
    const base = kind === "vacantShop" ? uses[kind] : `${root} ${uses[kind]}`;
    let name = base;
    for (let number = 2; names.has(name); number++) name = `${base} ${number}`;
    names.add(name);
    const entity: TownEntity = {
      id,
      kind,
      name,
      position: [lot.x, 0, lot.z],
      parcel: lot,
      capacity: capacities[kind],
      variant,
      entrance: {
        kind: entryKinds[kind] ?? "site",
        position: [lot.x, 0.12, lot.z + facing * (lot.depth / 2 + 0.65)],
      },
    };
    entities.push(entity);
    return entity;
  };

  const addRoad = (
    id: string,
    axis: "x" | "z",
    lot: TownParcel,
    major: boolean,
  ) => {
    roads.push({ id, axis, parcel: lot, major });
    for (const side of [-1, 1]) {
      const band =
        axis === "x"
          ? parcel(lot.x, lot.z + side * (lot.depth / 2 + 1), lot.width, 2)
          : parcel(lot.x + side * (lot.width / 2 + 1), lot.z, 2, lot.depth);
      sidewalks.push(band);
    }
  };

  addRoad("front-avenue", "x", parcel(midX, front, span + 15, 7.2), true);
  addRoad("back-avenue", "x", parcel(midX, back, span + 7, 6.2), true);
  addRoad("west-street", "z", parcel(left, midZ, 6.2, front - back), false);
  addRoad("east-street", "z", parcel(right, midZ, 6.2, front - back), false);

  const cross = (
    id: string,
    x: number,
    z: number,
    roadId: string,
    axis: "x" | "z",
    width: number,
    phase: number,
  ) =>
    crossings.push({ id, axis, position: [x, 0.076, z], roadId, width, phase });
  for (const [side, x, offset] of [
    ["west", left, 5.5],
    ["east", right, -5.5],
  ] as const) {
    cross(
      `${side}-north`,
      x + offset,
      back,
      "back-avenue",
      "x",
      6.2,
      side === "west" ? 0 : 7,
    );
    cross(
      `${side}-south`,
      x + offset,
      front,
      "front-avenue",
      "x",
      7.2,
      side === "west" ? 5 : 11,
    );
    cross(`${side}-entry`, x, midZ, `${side}-street`, "z", 6.2, 3);
  }

  const compact = span < 78;
  const lots = Math.max(6, Math.floor((span - 4) / 9.5));
  const ids = [...new Set(homeIds)].sort();
  const rows = Math.max(2, Math.ceil(ids.length / (lots * 2)));
  for (let row = 0; row < rows; row++) {
    const z = back - 10 - row * 12.5;
    for (let column = 0; column < lots; column++) {
      const x = left + (column + 0.5) * (span / lots);
      const residentialId = `res-${row}-${column}`;
      const style = hashSeed(`${seed}:${residentialId}`);
      add(
        residentialId,
        (row * lots + column) % 3 === 0 ? "house" : "apartment",
        parcel(x, z, 5.8 + (style % 3) * 0.55, 6.6 + ((style >>> 5) % 2) * 0.7),
      );
      sidewalks.push(parcel(x, z + 4.35, 2, 2.5));
      if (column % 2 === 0) trees.push([x + 3.5, 0, z + 3.7]);
    }
    if (row > 0)
      addRoad(
        `res-street-${row}`,
        "x",
        parcel(midX, z + 6.6, span + 6, 4.4),
        false,
      );
  }

  const residential = entities.filter(
    ({ kind }) => kind === "house" || kind === "apartment",
  );
  const units = residential.flatMap((entity) =>
    Array.from({ length: entity.capacity }, (_, unit) => ({ entity, unit })),
  );
  const occupied = new Set<number>();
  const homes: Neighborhood["homes"] = Object.fromEntries(
    ids.map((id) => {
      let slot = hashSeed(`${seed}:${id}`) % units.length;
      while (occupied.has(slot)) slot = (slot + 1) % units.length;
      occupied.add(slot);
      const { entity, unit } = units[slot];
      const [x, y, z] = entity.entrance.position;
      return [
        id,
        {
          entityId: entity.id,
          unit,
          position: [x + (unit - (entity.capacity - 1) / 2) * 0.27, y, z],
        },
      ];
    }),
  );

  const frontKinds = [
    "convenienceStore",
    "cafe",
    "restaurant",
    "vacantShop",
    "restaurant",
    "vacantShop",
    ...(!compact ? (["restaurant"] as const) : []),
  ] as const;
  const retailSpan = span * 0.73;
  const frontage = retailSpan / frontKinds.length;
  const retailDepth = 7.15;
  const destinations: Neighborhood["destinations"] = {
    convenienceStore: [],
    cafe: [],
    restaurant: [],
    park: [],
  };
  frontKinds.forEach((kind, index) => {
    const x = left + (index + 0.5) * frontage;
    const shop = add(
      `shop-${index}`,
      kind,
      parcel(x, front + 10.6, Math.min(8.2, frontage - 1.3), retailDepth),
      -1,
    );
    if (kind !== "vacantShop") destinations[kind].push(shop.entrance.position);
    sidewalks.push(parcel(x, front + 5.75, 2, 3.1));
  });
  const park = add(
    "park-east",
    "park",
    parcel(
      left + retailSpan + (span - retailSpan) / 2,
      front + 12.8,
      span - retailSpan - 2.4,
      15.6,
    ),
    -1,
  );
  destinations.park.push(park.entrance.position);
  add(
    "public-parking",
    "parking",
    parcel(left - 12.2, midZ + 3.6, 12, 17.6),
    1,
  );

  const stations: Record<string, TownPoint> = {};
  for (const { id, x } of buildings) {
    const transit = add(
      `bus-${id}`,
      "busStop",
      parcel(x - 4.3, front - 5.1, 4.4, 1.6),
      -1,
    );
    stations[id] = transit.entrance.position;
    add(`metro-${id}`, "subway", parcel(x + 4.1, front - 5.45, 3.4, 2.2), -1);
    sidewalks.push(
      parcel(x, (maxZ + front - 3.8) / 2, 2.6, front - 3.8 - maxZ),
    );
    cross(
      `transit-${id}`,
      x,
      front,
      "front-avenue",
      "x",
      7.2,
      hashSeed(id) % 12,
    );
  }

  for (let x = left; x <= right; x += 7.6) {
    if (!buildings.some(({ x: bx }) => Math.abs(bx - x) < 5))
      trees.push([x, 0, front - 5.35]);
    lamps.push([x + 0.65, 0, front + 4.65], [x, 0, back - 4.35]);
  }
  for (let z = back + 8; z < front - 6; z += 8.2) {
    trees.push([left + 5.2, 0, z], [right - 5.2, 0, z]);
    lamps.push([left - 4.1, 0, z], [right + 4.1, 0, z]);
  }

  return {
    seed,
    bounds: {
      minX: left - 21,
      maxX: right + 17,
      minZ: back - 17 - (rows - 1) * 12.5,
      maxZ: front + 24.5,
    },
    roads,
    sidewalks,
    crossings,
    entities,
    trees,
    lamps,
    homes,
    stations,
    destinations,
  };
}
