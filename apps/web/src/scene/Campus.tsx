import type { TownFrame } from "@herdr-office/core";
import {
  employeeHomeId,
  type Neighborhood,
  type Timeline,
} from "@herdr-office/core";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ComponentRef,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MOUSE, OrthographicCamera, TOUCH, Vector3 } from "three";
import {
  type Bounds,
  type BuildingLayout,
  boundsOf,
  type CampusLayout,
  findOffice,
} from "../layout/campusLayout.ts";
import { Town } from "../town/Town.tsx";
import type { TownSelection } from "../ui/TownPanel.tsx";
import type { Atmosphere } from "../weather/atmosphere.ts";
import { Clouds, Precipitation, Sky } from "../weather/Sky.tsx";
import { Actors } from "./Actors.tsx";
import { Building } from "./Building.tsx";
import { Box, Tree } from "./Primitives.tsx";
import { scene } from "./palette.ts";
import { ActiveDesks, SceneNight } from "./SceneEnvironment.ts";
import {
  ProjectLabels,
  SceneLabelContext,
  SceneLabelOverlay,
  SceneLabelRegistry,
} from "./SceneLabels.tsx";

export type Focus =
  | { kind: "campus" }
  | { kind: "town" }
  | { kind: "building"; id: string }
  | { kind: "office"; buildingId: string; key: string };

const CAMERA_DISTANCE = 1500;
const viewingAngle = new Vector3(0.65, 1, 1.45).normalize();
const narrowCampusAngle = new Vector3(1.35, 1.1, 1.45).normalize();

/** Map-style controls: drag pans over the ground, right-drag rotates. */
const mouseButtons = {
  LEFT: MOUSE.PAN,
  MIDDLE: MOUSE.DOLLY,
  RIGHT: MOUSE.ROTATE,
};
const touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };

/** Keep the pan target over the map, moving the camera by the same amount. */
export function clampTarget(
  target: { x: number; z: number },
  limits: Bounds,
): { dx: number; dz: number } {
  const x = Math.min(limits.maxX, Math.max(limits.minX, target.x));
  const z = Math.min(limits.maxZ, Math.max(limits.minZ, target.z));
  return { dx: x - target.x, dz: z - target.z };
}

/**
 * The furthest zoom-out still shows only the map: the whole town fits with a
 * margin of countryside, never the edge of the world.
 */
export function minZoomFor(
  limits: Bounds,
  size: { width: number; height: number },
): number {
  const span = limits.maxX - limits.minX + (limits.maxZ - limits.minZ);
  return Math.max(
    0.6,
    Math.min(size.width / (span * 0.9), size.height / (span * 0.55)) * 0.7,
  );
}

function CameraRig({
  bounds,
  limits,
  preset,
  nearFocus,
  reduceMotion,
  opening,
}: {
  bounds: Bounds;
  limits: Bounds;
  preset: Focus;
  nearFocus: boolean;
  opening: boolean;
  reduceMotion: boolean;
}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera, size } = useThree();
  const { minX, maxX, minZ, maxZ } = bounds;
  const view = useMemo(() => {
    const angle =
      size.width < 520 && !nearFocus ? narrowCampusAngle : viewingAngle;
    const horizontalAxis = new Vector3(0, 1, 0).cross(angle).normalize();
    const verticalAxis = angle.clone().cross(horizontalAxis);
    const target = new Vector3(
      (minX + maxX) / 2,
      nearFocus ? 0.85 : 0,
      (minZ + maxZ) / 2,
    );
    const projected = [];
    for (const x of [minX, maxX]) {
      for (const z of [minZ, maxZ]) {
        for (const y of [0, nearFocus ? 2.5 : preset.kind === "town" ? 6 : 2.2])
          projected.push(new Vector3(x, y, z).sub(target));
      }
    }
    const width =
      Math.max(
        ...projected.map((point) => Math.abs(point.dot(horizontalAxis))),
      ) * 2;
    const height =
      Math.max(...projected.map((point) => Math.abs(point.dot(verticalAxis)))) *
      2;
    const padding = nearFocus ? 0.86 : preset.kind === "town" ? 0.96 : 0.96;
    const zoom = Math.max(
      0.2,
      Math.min(size.width / width, size.height / height) * padding,
    );
    return {
      target,
      // Far back: an orthographic view does not shrink with distance, and the
      // near plane must not clip the countryside in front of the camera.
      position: target.clone().addScaledVector(angle, CAMERA_DISTANCE),
      zoom,
      preset,
    };
  }, [minX, maxX, minZ, maxZ, size.width, size.height, nearFocus, preset]);

  const frame = useRef<{ target: typeof view | null; settled: boolean }>({
    target: null,
    settled: false,
  });
  useFrame((_, dt) => {
    if (!controls.current || !(camera instanceof OrthographicCamera)) return;
    const state = frame.current;
    const initializing = state.target === null;
    if (state.target !== view) {
      state.target = view;
      state.settled = false;
    }
    if (state.settled) return;
    const alpha =
      initializing || reduceMotion
        ? 1
        : 1 - Math.exp(-dt * (opening ? 2.5 : 8));
    controls.current.target.lerp(view.target, alpha);
    camera.position.lerp(view.position, alpha);
    camera.zoom += (view.zoom - camera.zoom) * alpha;
    camera.updateProjectionMatrix();
    controls.current.update();
    const settled =
      alpha === 1 ||
      (camera.position.distanceToSquared(view.position) < 0.002 &&
        controls.current.target.distanceToSquared(view.target) < 0.002 &&
        Math.abs(camera.zoom - view.zoom) < 0.02);
    state.settled = settled;
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={!reduceMotion}
      dampingFactor={0.11}
      enablePan
      // The map is large; a few wheel steps should reach street level.
      zoomSpeed={2}
      screenSpacePanning={false}
      mouseButtons={mouseButtons}
      touches={touches}
      // Once the person grabs the map, stop steering the camera toward the preset.
      onStart={() => {
        frame.current.settled = true;
      }}
      onChange={() => {
        const current = controls.current;
        if (!current) return;
        const { dx, dz } = clampTarget(current.target, limits);
        if (!dx && !dz) return;
        current.target.x += dx;
        current.target.z += dz;
        camera.position.x += dx;
        camera.position.z += dz;
      }}
      minPolarAngle={0.34}
      maxPolarAngle={1.26}
      minZoom={minZoomFor(limits, size)}
      maxZoom={220}
    />
  );
}

function focusBounds(
  campus: CampusLayout,
  town: Neighborhood,
  focus: Focus,
): Bounds {
  if (focus.kind === "town") return town.bounds;
  if (focus.kind === "campus") return campus.bounds;
  const building = campus.buildings.find(
    ({ id }) => id === (focus.kind === "office" ? focus.buildingId : focus.id),
  );
  if (!building) return campus.bounds;
  const office =
    focus.kind === "office"
      ? findOffice(building.offices, focus.key)
      : undefined;
  return boundsOf(
    office?.bounds ?? {
      ...building.bounds,
      z: building.bounds.z + 0.8,
      depth: building.bounds.depth + 1.6,
    },
  );
}

function Plantings({ building }: { building: BuildingLayout }) {
  const { minX, maxX, minZ, maxZ } = boundsOf(building.bounds);
  const { x } = building.bounds;
  return (
    <>
      <Tree position={[minX + 1.4, 0, maxZ + 2.12]} size={1.1} />
      <Tree position={[maxX - 1.4, 0, maxZ + 2.12]} size={1.04} />
      <Tree position={[minX - 1.4, 0, minZ - 0.5]} size={0.86} />
      <Tree position={[maxX + 1.4, 0, minZ - 0.3]} size={0.91} />
      <Box
        position={[x - 10.8, 0.02, maxZ + 1.15]}
        size={[12.1, 0.07, 1.08]}
        color={scene.stone}
      />
      <Box
        position={[x + 10.8, 0.02, maxZ + 1.15]}
        size={[12.1, 0.07, 1.08]}
        color={scene.stone}
      />
    </>
  );
}

export interface CampusProps {
  campus: CampusLayout;
  town: Neighborhood;
  townFrame: TownFrame | null;
  townReceivedAt: number;
  onTownSelect: (selection: TownSelection) => void;
  sky: Atmosphere;
  timeline: Timeline | null;
  timelineReceivedAt: number;
  opening: boolean;
  onReady: () => void;
  focus: Focus;
  appeared: ReadonlyMap<string, number>;
  lowPerformance: boolean;
  reduceMotion: boolean;
  employee: string | null;
  onBuilding: (id: string) => void;
  onOffice: (buildingId: string, key: string) => void;
  onEmployee: (buildingId: string, address: string) => void;
}

export const Campus = memo(function Campus({
  campus,
  town,
  sky,
  timeline,
  timelineReceivedAt,
  opening,
  townFrame,
  townReceivedAt,
  onTownSelect,
  onReady,
  focus,
  appeared,
  lowPerformance,
  reduceMotion,
  employee,
  onBuilding,
  onOffice,
  onEmployee,
}: CampusProps) {
  const { minX, maxX, minZ, maxZ } = campus.bounds;
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  const width = maxX - minX;
  const depth = maxZ - minZ;

  const [labels] = useState(() => new SceneLabelRegistry());
  const scopedBuilding =
    focus.kind === "campus" || focus.kind === "town"
      ? null
      : focus.kind === "building"
        ? focus.id
        : focus.buildingId;

  const [displayAt, setDisplayAt] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setDisplayAt(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);
  const correction =
    timeline && timelineReceivedAt ? timeline.at - timelineReceivedAt : 0;
  const now = displayAt + correction;
  const actualNow = useMemo(() => () => Date.now() + correction, [correction]);
  const activeFrames = (timeline?.actions ?? []).filter(
    ({ startAt, durationMs }) => startAt <= now && now < startAt + durationMs,
  );
  const homesKey = activeFrames
    .filter(({ props, to }) => props.remoteWork && to.kind === "home")
    .map(
      ({ to, employeeId }) =>
        town.homes[to.homeId ?? employeeHomeId(employeeId)]?.entityId ?? "",
    )
    .filter(Boolean)
    .sort()
    .join("|");
  const litHomes = useMemo(
    () => new Set(homesKey ? homesKey.split("|") : []),
    [homesKey],
  );
  const desksKey = activeFrames
    .filter(
      ({ from, to, kind }) =>
        from.kind === "desk" &&
        to.kind === "desk" &&
        (kind === "work" || kind === "overtime" || kind === "videocall"),
    )
    .map(({ employeeId }) => employeeId)
    .sort()
    .join("|");
  const hasTimeline = timeline !== null;
  const activeDesks = useMemo(
    () => (hasTimeline ? new Set(desksKey ? desksKey.split("|") : []) : null),
    [hasTimeline, desksKey],
  );

  return (
    <>
      <Canvas
        orthographic
        onCreated={onReady}
        shadows={!lowPerformance && "percentage"}
        dpr={lowPerformance ? 1 : [1, 1.65]}
        camera={{
          position: [45, 68, 94],
          zoom: 8,
          near: 1,
          far: CAMERA_DISTANCE * 3,
        }}
        fallback={
          <p className="scene-empty">
            이 브라우저에서 WebGL을 사용할 수 없습니다.
          </p>
        }
      >
        <SceneLabelContext.Provider value={labels}>
          <SceneNight.Provider value={sky.night}>
            <ActiveDesks.Provider value={activeDesks}>
              <Sky
                sky={sky}
                bounds={town.bounds}
                lowPerformance={lowPerformance}
                reduceMotion={reduceMotion}
              />
              <Town
                campus={campus}
                town={town}
                sky={sky}
                showSigns={focus.kind === "town"}
                frame={townFrame}
                receivedAt={townReceivedAt}
                select={onTownSelect}
                low={lowPerformance}
                reduceMotion={reduceMotion}
                litHomes={litHomes}
              />
              <Clouds
                sky={sky}
                bounds={town.bounds}
                reduced={lowPerformance || reduceMotion}
              />
              <Precipitation
                sky={sky}
                bounds={town.bounds}
                low={lowPerformance}
                reduceMotion={reduceMotion}
              />
              <Box
                position={[x, -0.45, z]}
                size={[width, 0.62, depth]}
                color={scene.earth}
              />
              <Box
                position={[x, -0.125, z]}
                size={[width - 0.35, 0.24, depth - 0.35]}
                color={sky.kind === "snow" ? "#dae7e7" : scene.lawn}
              />
              {campus.walkways.map((walkway) => (
                <group key={walkway.x} position={[walkway.x, 0, walkway.z]}>
                  <Box
                    position={[0, 0.28, 0]}
                    size={[walkway.width, 0.56, walkway.depth]}
                    color={scene.bridge}
                  />
                  <Box
                    position={[0, 0.58, 0]}
                    size={[walkway.width, 0.085, walkway.depth - 0.34]}
                    color={scene.concrete}
                  />
                  {[-1, 1].map((edge) => (
                    <Box
                      key={edge}
                      position={[0, 0.79, edge * (walkway.depth / 2 - 0.13)]}
                      size={[walkway.width, 0.14, 0.16]}
                      color={scene.trim}
                    />
                  ))}
                </group>
              ))}
              {campus.buildings.map((building) => (
                <group key={building.id}>
                  <Plantings building={building} />
                  <Building
                    building={building}
                    appeared={appeared}
                    focusKey={
                      focus.kind === "office" &&
                      focus.buildingId === building.id
                        ? focus.key
                        : null
                    }
                    focusedBuilding={scopedBuilding === building.id}
                    campus={focus.kind === "campus" || focus.kind === "town"}
                    reduceMotion={reduceMotion}
                    onBuilding={onBuilding}
                    onOffice={(key) => onOffice(building.id, key)}
                  />
                </group>
              ))}
              <Actors
                campus={campus}
                town={town}
                playback={{ timeline, now, actualNow }}
                selected={employee}
                building={scopedBuilding}
                reduceMotion={reduceMotion}
                onSelect={onEmployee}
              />
            </ActiveDesks.Provider>
          </SceneNight.Provider>
          <CameraRig
            bounds={focusBounds(campus, town, focus)}
            limits={town.bounds}
            opening={opening}
            preset={focus}
            nearFocus={focus.kind === "office" || focus.kind === "building"}
            reduceMotion={reduceMotion}
          />
          <ProjectLabels registry={labels} />
        </SceneLabelContext.Provider>
      </Canvas>
      <SceneLabelOverlay registry={labels} />
    </>
  );
});
