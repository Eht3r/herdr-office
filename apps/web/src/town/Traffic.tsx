import type { Crossing, Neighborhood, TownRoad } from "@herdr-office/core";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, type InstancedMesh, Object3D } from "three";
import type { Atmosphere } from "../weather/atmosphere.ts";
import { Batch, type Piece } from "./Batch.tsx";

const hues = ["#d38968", "#557e8e", "#e0c58a", "#779280", "#b8afb1", "#d8ded7"];
const signal = {
  red: new Color("#f77a58"),
  green: new Color("#70d295"),
  idle: new Color("#3b4a54"),
};

const phaseOf = (crossing: Crossing, seconds: number) =>
  (seconds + crossing.phase) % 25;
const crossingOpen = (crossing: Crossing, seconds: number) =>
  phaseOf(crossing, seconds) < 9;

function Signals({
  town,
  at,
  reduce,
}: {
  town: Neighborhood;
  at: number;
  reduce: boolean;
}) {
  const lights = useRef<InstancedMesh>(null);
  const pieces = useMemo(
    () =>
      town.crossings.map(({ axis, position: [x, , z], width }) => {
        return {
          x: x + (axis === "x" ? 1.62 : width * 0.5 + 0.55),
          z: z + (axis === "x" ? width * 0.5 + 0.55 : 1.62),
        };
      }),
    [town.crossings],
  );
  const bodies = useMemo(
    () =>
      pieces.flatMap(({ x, z }): Piece[] => [
        { at: [x, 1.18, z], size: [0.14, 2.35, 0.14], color: "#3e5457" },
        { at: [x, 2.25, z], size: [0.38, 0.69, 0.22], color: "#34444a" },
      ]),
    [pieces],
  );
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    if (!lights.current) return;
    const seconds = at / 1000 + (reduce ? 0 : clock.elapsedTime);
    for (const [index, { x, z }] of pieces.entries()) {
      const open = crossingOpen(town.crossings[index], seconds);
      for (let row = 0; row < 2; row++) {
        dummy.position.set(x, 2.13 + row * 0.22, z + 0.127);
        dummy.scale.setScalar(0.12);
        dummy.updateMatrix();
        lights.current.setMatrixAt(index * 2 + row, dummy.matrix);
        lights.current.setColorAt(
          index * 2 + row,
          row === 0
            ? open
              ? signal.green
              : signal.idle
            : open
              ? signal.idle
              : signal.red,
        );
      }
    }
    lights.current.instanceMatrix.needsUpdate = true;
    if (lights.current.instanceColor)
      lights.current.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <Batch pieces={bodies} shadow={false} />
      {pieces.length > 0 && (
        <instancedMesh
          ref={lights}
          args={[undefined, undefined, pieces.length * 2]}
          frustumCulled={false}
        >
          <sphereGeometry args={[1, 7, 4]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
    </>
  );
}

type Vehicle = {
  road: TownRoad;
  location: number;
  side: number;
  speed: number;
  bus: boolean;
};
type Pedestrian = {
  road: TownRoad;
  location: number;
  speed: number;
  side: number;
  crossing?: Crossing;
};

export function Traffic({
  town,
  sky,
  low,
  reduceMotion,
  showPedestrians,
}: {
  town: Neighborhood;
  sky: Atmosphere;
  low: boolean;
  reduceMotion: boolean;
  showPedestrians: boolean;
}) {
  const carBodies = useRef<InstancedMesh>(null);
  const carWindows = useRef<InstancedMesh>(null);
  const personBodies = useRef<InstancedMesh>(null);
  const personHeads = useRef<InstancedMesh>(null);
  const umbrellas = useRef<InstancedMesh>(null);
  const raining = sky.kind === "rain" || sky.kind === "storm";
  const rush =
    (sky.hour >= 7 && sky.hour < 10) || (sky.hour >= 16 && sky.hour < 20);
  const vehicles = useMemo(
    (): Vehicle[] =>
      Array.from(
        { length: low ? 4 : sky.night ? 5 : rush ? 13 : 9 },
        (_, index) => {
          const road = town.roads[index % Math.min(4, town.roads.length)];
          const length =
            road.axis === "x" ? road.parcel.width : road.parcel.depth;
          return {
            road,
            location: (0.22 + ((index * 37) % 73) / 100) * length,
            side: index % 3 === 0 ? -1 : 1,
            speed: 3.2 + (index % 4) * 0.5,
            bus: index === 0,
          };
        },
      ),
    [town, low, rush, sky.night],
  );
  const people = useMemo(
    (): Pedestrian[] =>
      Array.from(
        {
          length: !showPedestrians
            ? 0
            : low
              ? 5
              : sky.night
                ? 7
                : rush
                  ? 26
                  : 17,
        },
        (_, index) => {
          const road = town.roads[index % town.roads.length];
          const length =
            road.axis === "x" ? road.parcel.width : road.parcel.depth;
          return {
            road,
            location: (((index * 37 + 14) % 100) / 100) * length,
            speed: 0.67 + (index % 5) * 0.11,
            side: index % 2 === 0 ? -1 : 1,
            crossing:
              index % 5 === 0
                ? town.crossings[(index / 5) % town.crossings.length]
                : undefined,
          };
        },
      ),
    [town, low, rush, sky.night, showPedestrians],
  );
  const dummy = useMemo(() => new Object3D(), []);

  useLayoutEffect(() => {
    const paint = (
      mesh: InstancedMesh | null,
      count: number,
      offset: number,
    ) => {
      if (!mesh) return;
      const tint = new Color();
      for (let i = 0; i < count; i++)
        mesh.setColorAt(i, tint.set(hues[(i + offset) % hues.length]));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    paint(carBodies.current, vehicles.length, 0);
    paint(personBodies.current, people.length, 2);
    if (raining) paint(umbrellas.current, people.length, 3);
  }, [vehicles.length, people.length, raining]);

  const matrices = useMemo(
    () =>
      town.roads.map(
        (road) =>
          [
            road.id,
            town.crossings.filter(({ roadId }) => road.id === roadId),
          ] as const,
      ),
    [town],
  );
  useFrame(({ clock }, delta) => {
    const now = sky.at / 1000 + (reduceMotion ? 0 : clock.elapsedTime);
    const dt = reduceMotion ? 0 : Math.min(0.08, delta);
    const place = (
      mesh: InstancedMesh | null,
      index: number,
      x: number,
      y: number,
      z: number,
      width: number,
      height: number,
      depth: number,
      yaw = 0,
    ) => {
      if (!mesh) return;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    };
    for (const [i, item] of vehicles.entries()) {
      const { parcel, axis, id } = item.road;
      const horizontal = axis === "x";
      const length = horizontal ? parcel.width : parcel.depth;
      const coordinate =
        (horizontal ? parcel.x : parcel.z) - length / 2 + item.location;
      const cross = matrices.find(([roadId]) => roadId === id)?.[1];
      const stopped = cross?.some((entry) => {
        const distance =
          ((horizontal ? entry.position[0] : entry.position[2]) - coordinate) *
          item.side;
        return (
          distance >= 0.15 &&
          distance < (item.bus ? 6 : 3.4) &&
          crossingOpen(entry, now)
        );
      });
      if (!stopped)
        item.location =
          (item.location + item.side * item.speed * dt + length) % length;
      const along =
        (horizontal ? parcel.x : parcel.z) + item.location - length / 2;
      const lane =
        item.side * (horizontal ? parcel.depth : parcel.width) * 0.24;
      const x = horizontal ? along : parcel.x + lane;
      const z = horizontal ? parcel.z + lane : along;
      const lengthOfCar = item.bus ? 5.2 : 2.35;
      const width = item.bus ? 1.48 : 1.15;
      const yaw = horizontal ? Math.PI / 2 : 0;
      place(
        carBodies.current,
        i,
        x,
        0.42,
        z,
        width,
        item.bus ? 0.72 : 0.49,
        lengthOfCar,
        yaw,
      );
      place(
        carWindows.current,
        i,
        x,
        item.bus ? 0.92 : 0.72,
        z,
        width * 0.85,
        0.32,
        lengthOfCar * 0.69,
        yaw,
      );
    }
    for (const [i, item] of people.entries()) {
      const { parcel, axis } = item.road;
      const width = axis === "x" ? parcel.depth : parcel.width;
      const length = axis === "x" ? parcel.width : parcel.depth;
      let x: number;
      let z: number;
      if (item.crossing) {
        const crossing = item.crossing;
        const distance = crossing.width + 1.9;
        if (item.location > distance) item.location = item.location % distance;
        if (
          crossingOpen(crossing, now) ||
          (item.location > 0.7 && item.location < distance - 0.7)
        ) {
          item.location = (item.location + item.speed * 1.85 * dt) % distance;
        }
        const displacement = item.location - distance / 2;
        x =
          crossing.position[0] +
          (crossing.axis === "z" ? displacement : (i % 3) * 0.43);
        z =
          crossing.position[2] +
          (crossing.axis === "x" ? displacement : (i % 3) * 0.43);
      } else {
        item.location =
          (item.location + item.side * item.speed * dt + length) % length;
        const offset = item.side * (width / 2 + 0.8);
        const along = item.location - length / 2;
        x = parcel.x + (axis === "x" ? along : offset);
        z = parcel.z + (axis === "x" ? offset : along);
      }
      const bob = reduceMotion ? 0 : Math.sin(now * 11 + i) * 0.04;
      place(personBodies.current, i, x, 0.48 + bob, z, 0.27, 0.76, 0.23);
      place(personHeads.current, i, x, 1 + bob, z, 0.15, 0.16, 0.15);
      if (raining)
        place(umbrellas.current, i, x, 1.32 + bob, z, 0.53, 0.22, 0.53);
    }
    for (const mesh of [
      carBodies.current,
      carWindows.current,
      personBodies.current,
      personHeads.current,
      umbrellas.current,
    ]) {
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <Signals town={town} at={sky.at} reduce={reduceMotion} />
      <instancedMesh
        key={`cars-${vehicles.length}`}
        ref={carBodies}
        args={[undefined, undefined, vehicles.length]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshStandardMaterial />
      </instancedMesh>
      <instancedMesh
        key={`windows-${vehicles.length}`}
        ref={carWindows}
        args={[undefined, undefined, vehicles.length]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshStandardMaterial color={sky.night ? "#d9be83" : "#7697ab"} />
      </instancedMesh>
      <instancedMesh
        key={`people-${people.length}`}
        ref={personBodies}
        args={[undefined, undefined, people.length]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshStandardMaterial />
      </instancedMesh>
      <instancedMesh
        key={`heads-${people.length}`}
        ref={personHeads}
        args={[undefined, undefined, people.length]}
        frustumCulled={false}
      >
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#e9c1a3" />
      </instancedMesh>
      {raining && (
        <instancedMesh
          key={`umbrellas-${people.length}`}
          ref={umbrellas}
          args={[undefined, undefined, people.length]}
          frustumCulled={false}
        >
          <coneGeometry args={[1, 1, 7]} />
          <meshStandardMaterial flatShading />
        </instancedMesh>
      )}
    </>
  );
}
