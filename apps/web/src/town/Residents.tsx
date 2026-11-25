import { hashSeed, type TownAction, type TownFrame } from "@herdr-office/core";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import {
  Color,
  type Group,
  type InstancedMesh,
  Object3D,
  Sphere,
  Vector3,
} from "three";
import { Box } from "../scene/Primitives.tsx";
import { SceneLabel } from "../scene/SceneLabels.tsx";
import { interpolateRoute, type PlaybackRoute } from "../sim/playback.ts";

const coats = [
  "#b86d58",
  "#4c7586",
  "#528474",
  "#a97c44",
  "#766c8b",
  "#a86482",
].map((color) => new Color(color));
const skins = ["#a96d4c", "#cc9874", "#e4b991"].map(
  (color) => new Color(color),
);

function current(actions: TownAction[], now: number): TownAction | undefined {
  return actions.find(
    ({ startAt, durationMs }) => startAt <= now && now < startAt + durationMs,
  );
}

function position(action: TownAction, now: number, point: Vector3) {
  const fraction = Math.max(
    0,
    Math.min(1, (now - action.startAt) / action.durationMs),
  );
  point.set(
    action.from[0] + (action.to[0] - action.from[0]) * fraction,
    action.from[1] + (action.to[1] - action.from[1]) * fraction,
    action.from[2] + (action.to[2] - action.from[2]) * fraction,
  );
}

export function Residents({
  frame,
  receivedAt,
  low,
  reduceMotion,
  select,
  routes,
}: {
  frame: TownFrame;
  receivedAt: number;
  low: boolean;
  reduceMotion: boolean;
  select: (id: string) => void;
  routes: (from: TownAction["from"], to: TownAction["to"]) => PlaybackRoute;
}) {
  const bodies = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  const umbrellas = useRef<InstancedMesh>(null);
  const hit = useRef<string[]>([]);
  const last = useRef(0);
  const cursor = useMemo(() => new Object3D(), []);
  const point = useMemo(() => new Vector3(), []);
  const clip = useMemo(() => new Vector3(), []);
  const limit = low ? 20 : 120;
  const cache = useMemo(
    () => ({ routes, walks: new Map<TownAction["id"], PlaybackRoute>() }),
    [routes],
  );
  const captureRadius = useMemo(
    () =>
      new Sphere(
        new Vector3(),
        Math.hypot(
          Math.max(
            Math.abs(frame.neighborhood.bounds.minX),
            Math.abs(frame.neighborhood.bounds.maxX),
          ),
          Math.max(
            Math.abs(frame.neighborhood.bounds.minZ),
            Math.abs(frame.neighborhood.bounds.maxZ),
          ),
        ) + 3,
      ),
    [frame.neighborhood],
  );

  useFrame(({ camera, clock }) => {
    if (!bodies.current || !heads.current || !umbrellas.current) return;
    const elapsed = clock.elapsedTime * 1000;
    if (elapsed - last.current < (low || reduceMotion ? 140 : 42)) return;
    last.current = elapsed;
    const now = frame.at + Date.now() - receivedAt;
    const meshes = [bodies.current, heads.current, umbrellas.current];
    const used = new Set<TownAction["id"]>();
    const locate = (action: TownAction): number => {
      if (action.kind !== "walk") {
        position(action, now, point);
        return 0;
      }
      used.add(action.id);
      let route = cache.walks.get(action.id);
      if (!route) {
        route = cache.routes(action.from, action.to);
        cache.walks.set(action.id, route);
      }
      const sample = interpolateRoute(
        route,
        (now - action.startAt) / action.durationMs,
      );
      point.set(...sample.point);
      return sample.angle;
    };
    const place = (
      mesh: InstancedMesh,
      index: number,
      height: number,
      sx: number,
      sy: number,
      sz: number,
      color: Color,
    ) => {
      cursor.position.copy(point);
      cursor.position.y += height;
      cursor.scale.set(sx, sy, sz);
      cursor.updateMatrix();
      mesh.setMatrixAt(index, cursor.matrix);
      mesh.setColorAt(index, color);
    };
    let count = 0;
    let covers = 0;
    const visible = [];
    for (const resident of frame.residents) {
      const action = current(resident.actions, now);
      if (!action || action.kind === "home" || action.kind === "rest") continue;
      const angle = locate(action);
      clip.copy(point).project(camera);
      // The camera is orthographic and parked far away, so its distance says
      // nothing about how close a person looks. Rank by nearness to the
      // middle of the screen instead and keep everyone in view.
      const distance = clip.x * clip.x + clip.y * clip.y;
      if (
        Math.abs(clip.x) > 1.12 ||
        Math.abs(clip.y) > 1.12 ||
        Math.abs(clip.z) > 1
      )
        continue;
      visible.push({
        resident,
        action,
        distance,
        angle,
        point: point.toArray(),
      });
    }
    visible.sort((a, b) => a.distance - b.distance);
    for (const { resident, action, angle, point: location } of visible.slice(
      0,
      limit,
    )) {
      point.set(...location);
      const hash = hashSeed(resident.id);
      const height =
        resident.age === "child" ? 0.68 : resident.age === "senior" ? 0.88 : 1;
      const sway =
        action.kind === "walk" && !low && !reduceMotion
          ? Math.sin(now / 96 + (hash % 22)) * 0.035
          : 0;
      cursor.rotation.y = angle;
      place(
        meshes[0],
        count,
        height * 0.43 + sway,
        0.34 * height,
        0.62 * height,
        0.27 * height,
        coats[hash % coats.length],
      );
      place(
        meshes[1],
        count,
        height * 0.87 + sway,
        0.17 * height,
        0.18 * height,
        0.17 * height,
        skins[hash % skins.length],
      );
      if (action.props.umbrella) {
        place(
          meshes[2],
          covers++,
          height * 1.22 + sway,
          0.51 * height,
          0.23,
          0.51 * height,
          coats[hash % coats.length],
        );
      }
      hit.current[count++] = resident.id;
    }
    for (const id of cache.walks.keys())
      if (!used.has(id)) cache.walks.delete(id);
    hit.current.length = count;
    meshes[0].count = count;
    meshes[1].count = count;
    meshes[2].count = covers;
    // Exposed for verification (e.g. low-performance mode draws fewer people).
    const drawn = String(count);
    if (document.body.dataset.townResidentsDrawn !== drawn)
      document.body.dataset.townResidentsDrawn = drawn;
    for (const mesh of meshes) {
      mesh.boundingSphere = captureRadius;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });
  const click = (event: ThreeEvent<MouseEvent>) => {
    const id = hit.current[event.instanceId ?? -1];
    if (!id) return;
    event.stopPropagation();
    select(id);
  };
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three.js hit mesh; the newspaper provides resident buttons. */}
      <instancedMesh
        key={`body-${limit}`}
        ref={bodies}
        args={[undefined, undefined, limit]}
        count={0}
        frustumCulled={false}
        onClick={click}
      >
        <boxGeometry />
        <meshStandardMaterial />
      </instancedMesh>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Three.js hit mesh; the newspaper provides resident buttons. */}
      <instancedMesh
        key={`head-${limit}`}
        ref={heads}
        args={[undefined, undefined, limit]}
        count={0}
        frustumCulled={false}
        onClick={click}
      >
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial />
      </instancedMesh>
      <instancedMesh
        key={`covers-${limit}`}
        ref={umbrellas}
        args={[undefined, undefined, limit]}
        count={0}
        frustumCulled={false}
      >
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial />
      </instancedMesh>
      {frame.deliveries.map((action) => (
        <Delivery
          key={action.id}
          action={action}
          timeOffset={frame.at - receivedAt}
        />
      ))}
    </>
  );
}

function Delivery({
  action,
  timeOffset,
}: {
  action: TownAction;
  timeOffset: number;
}) {
  const truck = useRef<Group>(null);
  // A label follows the truck while it drives, so it can be spotted from afar.
  const [driving, setDriving] = useState(false);
  useFrame(() => {
    if (!truck.current) return;
    const now = Date.now() + timeOffset;
    const active =
      now >= action.startAt && now < action.startAt + action.durationMs;
    truck.current.visible = active;
    if (active !== driving) setDriving(active);
    if (!active) return;
    position(action, now, truck.current.position);
    truck.current.rotation.y = Math.atan2(
      action.to[0] - action.from[0],
      action.to[2] - action.from[2],
    );
  });
  return (
    <group ref={truck} visible={false}>
      {driving && (
        <SceneLabel position={[0, 1.7, 0]} order={12}>
          <span className="truck-label">납품 트럭</span>
        </SceneLabel>
      )}
      <Box
        position={[0, 0.55, -0.34]}
        size={[1.05, 0.95, 1.36]}
        color="#eac78a"
      />
      <Box
        position={[0, 0.44, 0.64]}
        size={[0.93, 0.7, 0.62]}
        color="#758c9e"
      />
      <Box
        position={[0, 0.63, 0.96]}
        size={[0.76, 0.24, 0.04]}
        color="#d9e2d8"
      />
    </group>
  );
}
