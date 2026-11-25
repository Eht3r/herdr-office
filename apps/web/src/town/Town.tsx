import type { Neighborhood, TownEntity } from "@herdr-office/core";
import { useMemo } from "react";
import type { Point3 } from "../layout/campusLayout.ts";
import { SceneLabel } from "../scene/SceneLabels.tsx";
import type { Atmosphere } from "../weather/atmosphere.ts";
import { Batch, type Piece } from "./Batch.tsx";
import { Traffic } from "./Traffic.tsx";

/** Countryside width as a multiple of the town size. */
const OUTSKIRTS = 24;

const colors = {
  land: "#9aac91",
  outskirts: "#8fa386",
  base: "#728877",
  road: "#56626b",
  rainRoad: "#384e60",
  snowRoad: "#7c8d96",
  pavement: "#c4c9be",
  white: "#f5f3df",
  snow: "#e7eef0",
  turf: "#82a47a",
  paths: "#d8c7a6",
  leaf: "#65896d",
  lightLeaf: "#85a27c",
  wood: "#8c725e",
  trim: "#424e55",
  glass: "#87b4c2",
  warm: "#ffd383",
  darkGlass: "#527286",
  pond: "#82b4b9",
};

const roof = ["#987365", "#56747c", "#8d7770", "#6c817e"];
const residences = [
  "#d2ab8c",
  "#c0bc9c",
  "#b3bfc6",
  "#c6adad",
  "#a6b8ab",
  "#d9c2a0",
];
const awnings = ["#bc755c", "#648e8c", "#ad9766", "#7e879e"];

const put = (
  target: Piece[],
  color: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
) => target.push({ color, at: [x, y, z], size: [width, height, depth] });

function architecture(
  town: Neighborhood,
  sky: Atmosphere,
  litHomes: ReadonlySet<string>,
) {
  const solids: Piece[] = [];
  const wet: Piece[] = [];
  const light: Piece[] = [];
  const leaves: Piece[] = [];
  const cylinders: Piece[] = [];
  const { minX, maxX, minZ, maxZ } = town.bounds;
  const snow = sky.kind === "snow";
  const rain = sky.kind === "rain" || sky.kind === "storm";
  const night = sky.night;
  // Countryside runs far past the town so no view shows the map's edge.
  const reach = Math.max(maxX - minX, maxZ - minZ) * OUTSKIRTS;
  put(
    solids,
    snow ? colors.snow : colors.outskirts,
    (minX + maxX) / 2,
    -0.84,
    (minZ + maxZ) / 2,
    reach,
    0.95,
    reach,
  );
  put(
    solids,
    snow ? colors.snow : colors.land,
    (minX + maxX) / 2,
    -0.26,
    (minZ + maxZ) / 2,
    maxX - minX - 0.32,
    0.3,
    maxZ - minZ - 0.32,
  );

  for (const { x, z, width, depth } of town.sidewalks) {
    put(
      solids,
      snow ? "#d7e1e3" : colors.pavement,
      x,
      -0.035,
      z,
      width,
      0.13,
      depth,
    );
  }
  for (const {
    parcel: { x, z, width, depth },
    axis,
    major,
  } of town.roads) {
    put(
      wet,
      rain ? colors.rainRoad : snow ? colors.snowRoad : colors.road,
      x,
      -0.052,
      z,
      width,
      0.14,
      depth,
    );
    const length = axis === "x" ? width : depth;
    for (
      let offset = -length / 2 + 2.5;
      offset < length / 2 - 2.5;
      offset += major ? 4.1 : 5.6
    ) {
      const position = axis === "x" ? [x + offset, z] : [x, z + offset];
      put(
        solids,
        major ? "#e0cca0" : "#aab7b3",
        position[0],
        0.033,
        position[1],
        axis === "x" ? 1.6 : 0.12,
        0.022,
        axis === "x" ? 0.12 : 1.6,
      );
    }
  }
  for (const {
    position: [x, , z],
    width,
    axis,
  } of town.crossings) {
    for (
      let offset = -width / 2 + 0.5;
      offset <= width / 2 - 0.25;
      offset += 0.7
    ) {
      put(
        solids,
        colors.white,
        axis === "x" ? x : x + offset,
        0.058,
        axis === "x" ? z + offset : z,
        axis === "x" ? 2.3 : 0.38,
        0.026,
        axis === "x" ? 0.38 : 2.3,
      );
    }
  }

  const tree = ([x, , z]: Point3, index: number, scale = 1) => {
    const height = Math.min(2.4, 1.45 + (index % 7) * 0.16) * scale;
    put(
      cylinders,
      colors.wood,
      x,
      0.49 * scale,
      z,
      0.29 * scale,
      1.0 * scale,
      0.29 * scale,
    );
    put(
      leaves,
      snow ? "#d6e4e0" : index % 3 === 0 ? colors.lightLeaf : colors.leaf,
      x,
      height,
      z,
      0.91 * scale,
      1.03 * scale,
      0.92 * scale,
    );
    if (index % 3 === 0)
      put(
        leaves,
        snow ? colors.snow : "#91a879",
        x + 0.38 * scale,
        height + 0.51 * scale,
        z,
        0.62 * scale,
        0.66 * scale,
        0.6 * scale,
      );
  };
  town.trees.forEach((point, index) => {
    tree(point, index);
  });
  for (const [x, , z] of town.lamps) {
    put(cylinders, colors.trim, x, 1.42, z, 0.12, 2.84, 0.12);
    put(solids, colors.trim, x, 2.86, z + 0.2, 0.16, 0.13, 0.58);
    put(
      night ? light : solids,
      night ? colors.warm : colors.white,
      x,
      2.79,
      z + 0.42,
      0.21,
      0.1,
      0.37,
    );
    if (night) put(light, "#d4b584", x, -0.058, z + 0.42, 0.64, 0.008, 0.64);
  }

  for (const entity of town.entities) {
    const {
      kind,
      variant,
      parcel: { x, z, width, depth },
    } = entity;
    if (kind === "park") {
      put(
        solids,
        snow ? colors.snow : colors.turf,
        x,
        -0.025,
        z,
        width,
        0.14,
        depth,
      );
      put(solids, colors.paths, x, 0.054, z, 1.55, 0.04, depth);
      put(solids, colors.paths, x, 0.053, z, width * 0.84, 0.04, 1.25);
      put(
        solids,
        colors.pond,
        x + width * 0.23,
        0.033,
        z + 3,
        width * 0.26,
        0.05,
        3.3,
      );
      for (const [i, dx, dz] of [
        [0, -0.35, -0.34],
        [1, 0.37, -0.28],
        [2, -0.34, 0.28],
        [3, 0.37, 0.31],
        [4, -0.18, -0.22],
        [5, 0.27, -0.21],
      ]) {
        tree([x + dx * width, 0, z + dz * depth], i, 1.13);
      }
      for (const dx of [-0.18, 0.18]) {
        put(
          solids,
          colors.wood,
          x + dx * width,
          0.35,
          z - 1.1,
          1.75,
          0.19,
          0.6,
        );
        put(
          solids,
          colors.trim,
          x + dx * width,
          0.11,
          z - 1.1,
          1.4,
          0.22,
          0.46,
        );
      }
      continue;
    }
    if (kind === "parking") {
      put(wet, colors.road, x, 0, z, width, 0.14, depth);
      for (let i = 0; i < 6; i++) {
        const row = i < 3 ? -1 : 1;
        const position = x + ((i % 3) - 1) * 3.2;
        put(
          solids,
          colors.white,
          position - 1.3,
          0.08,
          z + row * 4.1,
          0.095,
          0.028,
          5,
        );
        if (i % 3 !== 1) {
          put(
            solids,
            residences[i],
            position,
            0.36,
            z + row * 4.1,
            1.35,
            0.51,
            2.8,
          );
          put(
            solids,
            colors.darkGlass,
            position,
            0.7,
            z + row * 4.1,
            1.18,
            0.23,
            1.5,
          );
        }
      }
      continue;
    }
    if (kind === "busStop" || kind === "subway") {
      put(solids, colors.pavement, x, 0.03, z, width + 0.4, 0.15, depth + 0.35);
      const height = kind === "busStop" ? 1.75 : 1.25;
      for (const side of [-1, 1])
        put(
          solids,
          colors.trim,
          x + side * (width / 2 - 0.2),
          height / 2,
          z,
          0.14,
          height,
          0.12,
        );
      put(
        solids,
        kind === "busStop" ? "#749287" : "#739eb2",
        x,
        height,
        z,
        width,
        0.19,
        depth,
      );
      put(
        solids,
        colors.glass,
        x,
        height / 2,
        z + depth * 0.48,
        width - 0.4,
        height - 0.25,
        0.095,
      );
      put(solids, colors.wood, x, 0.44, z + 0.47, width * 0.57, 0.13, 0.38);
      continue;
    }
    const home = kind === "house" || kind === "apartment";
    const height =
      kind === "apartment"
        ? 4.1 + (variant % 4) * 0.75
        : kind === "house"
          ? 2.65
          : 2.9 + (variant % 3) * 0.19;
    const warm = home && litHomes.has(entity.id);
    const wall = residences[variant % residences.length];
    const topper = snow ? colors.snow : roof[variant % roof.length];
    put(solids, colors.pavement, x, -0.03, z, width + 0.84, 0.13, depth + 0.84);
    put(solids, wall, x, height / 2, z, width * 0.89, height, depth * 0.84);
    put(solids, topper, x, height + 0.045, z, width * 0.99, 0.24, depth * 0.94);
    if (kind === "house") {
      put(solids, topper, x, height + 0.24, z, width * 0.75, 0.2, depth * 0.78);
      put(
        solids,
        topper,
        x,
        height + 0.43,
        z,
        width * 0.49,
        0.19,
        depth * 0.67,
      );
    } else if (kind === "apartment") {
      put(
        solids,
        topper,
        x - width * 0.19,
        height + 0.3,
        z + depth * 0.11,
        1.45,
        0.59,
        1.55,
      );
    }
    const rows = kind === "apartment" ? Math.floor(height / 1.18) : 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < (home ? 3 : 2); col++) {
        const count = home ? 3 : 2;
        const shift = (col - (count - 1) / 2) * width * (home ? 0.24 : 0.42);
        const on = home
          ? (warm && (row === rows - 1 || col === 1)) ||
            (night && (variant + row * 3 + col) % 4 === 0)
          : night && kind !== "vacantShop" && sky.hour < 23 && sky.hour >= 16;
        for (const side of [-1, 1]) {
          put(
            on ? light : solids,
            on
              ? colors.warm
              : night || kind === "vacantShop"
                ? colors.darkGlass
                : colors.glass,
            x + shift,
            (home ? 1.33 : 1.24) + row * 1.12,
            z + side * (depth * 0.422),
            width * (home ? 0.15 : 0.36),
            home ? 0.61 : 1.3,
            0.085,
          );
        }
      }
    }
    if (!home) {
      for (const side of [-1, 1]) {
        const trim =
          kind === "vacantShop" ? "#8e9892" : awnings[variant % awnings.length];
        put(
          solids,
          trim,
          x,
          2.11,
          z + side * (depth * 0.47),
          width * 0.94,
          0.18,
          0.83,
        );
        put(
          solids,
          "#e0d5bb",
          x - width * 0.23,
          2.13,
          z + side * (depth * 0.49),
          width * 0.17,
          0.19,
          0.84,
        );
      }
    }
  }

  return { solids, wet, light, leaves, cylinders };
}

function TownSigns({ entities }: { entities: TownEntity[] }) {
  const labeled = new Set<string>();
  return entities
    .filter(({ kind }) => {
      if (
        ![
          "convenienceStore",
          "cafe",
          "restaurant",
          "park",
          "busStop",
          "parking",
        ].includes(kind) ||
        labeled.has(kind)
      )
        return false;
      labeled.add(kind);
      return true;
    })
    .map(({ id, name, kind, position: [x, , z] }) => (
      <SceneLabel
        key={id}
        position={[
          x,
          kind === "busStop" || kind === "subway"
            ? 2.1
            : kind === "park" || kind === "parking"
              ? 0.8
              : 3.66,
          z,
        ]}
        order={3}
      >
        <span className="town-label" data-kind={kind}>
          {name}
        </span>
      </SceneLabel>
    ));
}

export function Town({
  town,
  sky,
  showSigns,
  low,
  reduceMotion,
  litHomes,
}: {
  town: Neighborhood;
  sky: Atmosphere;
  showSigns: boolean;
  low: boolean;
  reduceMotion: boolean;
  litHomes: ReadonlySet<string>;
}) {
  const geometry = useMemo(
    () => architecture(town, sky, litHomes),
    [town, sky, litHomes],
  );
  return (
    <>
      <Batch pieces={geometry.solids} />
      <Batch
        pieces={geometry.wet}
        roughness={sky.kind === "rain" || sky.kind === "storm" ? 0.25 : 0.88}
        shadow={false}
      />
      <Batch pieces={geometry.leaves} form="round" />
      <Batch pieces={geometry.cylinders} form="post" />
      <Batch pieces={geometry.light} emissive shadow={false} />
      {showSigns && <TownSigns entities={town.entities} />}
      <Traffic town={town} sky={sky} low={low} reduceMotion={reduceMotion} />
    </>
  );
}
