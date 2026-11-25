import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  Color,
  type DirectionalLight,
  FogExp2,
  type Group,
  type InstancedMesh,
  Object3D,
  OrthographicCamera,
  Vector3,
} from "three";
import type { Bounds } from "../layout/campusLayout.ts";
import type { Atmosphere } from "./atmosphere.ts";

const random = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296;
const stars = new Float32Array(
  Array.from({ length: 145 }, (_, i) => [
    random(i * 7) - 0.5,
    random(i * 13 + 5) - 0.5,
    -0.06,
  ]).flat(),
);

function SkyBackdrop({ sky }: { sky: Atmosphere }) {
  const backdrop = useRef<Group>(null);
  const moon = useRef<Group>(null);
  const forward = useMemo(() => new Vector3(), []);
  const gradient = useMemo(
    () => ({
      upper: {
        value: new Color(sky.sky).lerp(
          new Color(sky.night ? "#10182a" : "#69a3c4"),
          sky.night ? 0.53 : 0.42 - sky.clouds * 0.18,
        ),
      },
      lower: {
        value: new Color(sky.sky).lerp(
          new Color(sky.night ? "#273955" : "#edf3e5"),
          0.42,
        ),
      },
    }),
    [sky.sky, sky.night, sky.clouds],
  );
  useFrame(({ camera, size }) => {
    if (!(camera instanceof OrthographicCamera) || !backdrop.current) return;
    camera.getWorldDirection(forward);
    backdrop.current.position
      .copy(camera.position)
      .addScaledVector(forward, 265);
    backdrop.current.quaternion.copy(camera.quaternion);
    const width = size.width / camera.zoom;
    const height = size.height / camera.zoom;
    backdrop.current.scale.set(width, height, 1);
    if (moon.current) {
      moon.current.position.x =
        0.33 + Math.sin((sky.moonAzimuth * Math.PI) / 180) * 0.07;
      moon.current.position.y =
        0.28 + Math.max(-15, Math.min(45, sky.moonAltitude)) * 0.001;
      moon.current.scale.set(1 / width, 1 / height, 1);
    }
  });
  return (
    <group ref={backdrop}>
      <mesh position={[0, 0, -0.2]} renderOrder={-100} frustumCulled={false}>
        <planeGeometry args={[1.015, 1.015]} />
        <shaderMaterial
          toneMapped={false}
          depthWrite={false}
          depthTest={false}
          uniforms={gradient}
          vertexShader={`varying vec2 coordinates;
            void main() { coordinates = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
          fragmentShader={`varying vec2 coordinates;
            uniform vec3 upper; uniform vec3 lower;
            void main() {
              gl_FragColor = vec4(mix(lower, upper, smoothstep(0.02, 0.96, coordinates.y)), 1.0);
              #include <colorspace_fragment>
            }`}
        />
      </mesh>
      {sky.night && (
        <points frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[stars, 3]} />
          </bufferGeometry>
          <pointsMaterial
            size={1.9}
            color="#e6e9dc"
            sizeAttenuation={false}
            transparent
            opacity={0.88 - sky.clouds * 0.63}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </points>
      )}
      {sky.night && sky.clouds < 0.74 && (
        <group ref={moon}>
          <mesh frustumCulled={false}>
            <circleGeometry args={[2.2, 32]} />
            <meshBasicMaterial color="#e6efec" fog={false} toneMapped={false} />
          </mesh>
          <mesh position={[0.74, 0.45, 0.012]} frustumCulled={false}>
            <circleGeometry args={[2, 32]} />
            <meshBasicMaterial color={sky.sky} fog={false} toneMapped={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}

export function Sky({
  sky,
  bounds,
  lowPerformance,
  reduceMotion,
}: {
  sky: Atmosphere;
  bounds: Bounds;
  lowPerformance: boolean;
  reduceMotion: boolean;
}) {
  const light = useRef<DirectionalLight>(null);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const target = useMemo(() => {
    const point = new Object3D();
    point.position.set(centerX, 0, centerZ);
    return point;
  }, [centerX, centerZ]);
  const shadow =
    Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.65;
  const fogDensity =
    sky.kind === "fog"
      ? 0.008
      : sky.kind === "storm"
        ? 0.0037
        : sky.kind === "rain"
          ? 0.0017
          : 0;
  const fog = useMemo(
    () => (fogDensity ? new FogExp2(sky.haze, fogDensity) : null),
    [sky.haze, fogDensity],
  );
  useFrame(({ clock }) => {
    if (!light.current) return;
    const cycle = clock.elapsedTime % 12.7;
    const flash =
      sky.kind === "storm" &&
      !reduceMotion &&
      (cycle < 0.12 || (cycle > 0.25 && cycle < 0.34));
    light.current.intensity = sky.sunlight + (flash ? 1.75 : 0);
  });
  return (
    <>
      <color attach="background" args={[sky.sky]} />
      {fog && <primitive attach="fog" object={fog} />}
      <hemisphereLight
        args={[
          sky.night ? "#a5bce8" : "#fff8eb",
          sky.night ? "#344e69" : "#a2b49a",
          sky.ambient,
        ]}
      />
      <primitive object={target} />
      <directionalLight
        ref={light}
        position={[
          centerX + 85 * sky.direction[0],
          85 * sky.direction[1],
          centerZ + 85 * sky.direction[2],
        ]}
        target={target}
        castShadow={!lowPerformance && sky.sunlight > 0.06}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadow}
        shadow-camera-right={shadow}
        shadow-camera-top={shadow}
        shadow-camera-bottom={-shadow}
        shadow-camera-far={270}
        shadow-normalBias={0.045}
        shadow-bias={-0.00012}
        color={sky.daylight < 0.55 ? "#ffd3ab" : "#fff1db"}
      />
      <SkyBackdrop sky={sky} />
    </>
  );
}

export function Clouds({
  sky,
  bounds,
  reduced,
}: {
  sky: Atmosphere;
  bounds: Bounds;
  reduced: boolean;
}) {
  const clouds = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const count = Math.min(
    reduced ? 10 : 40,
    Math.round(sky.clouds * (reduced ? 10 : 40)),
  );
  useFrame(({ clock }) => {
    if (!clouds.current) return;
    const width = bounds.maxX - bounds.minX + 24;
    const shift = reduced ? 0 : clock.elapsedTime * 0.19;
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        bounds.minX - 12 + ((random(i + 19) * width + shift) % width),
        12 + random(i * 3) * 5,
        bounds.minZ - 12 + random(i * 11) * 13,
      );
      dummy.scale.set(
        3.2 + random(i * 7) * 5.3,
        0.55 + random(i * 5) * 1.3,
        2.1 + random(i * 17) * 4,
      );
      dummy.updateMatrix();
      clouds.current.setMatrixAt(i, dummy.matrix);
    }
    clouds.current.instanceMatrix.needsUpdate = true;
  });
  if (!count) return null;
  return (
    <instancedMesh
      key={count}
      ref={clouds}
      args={[undefined, undefined, count]}
      frustumCulled={false}
    >
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial
        color={sky.night ? "#627093" : "#edf3f4"}
        transparent
        opacity={0.84}
        depthWrite={false}
        flatShading
      />
    </instancedMesh>
  );
}

export function Precipitation({
  sky,
  bounds,
  low,
  reduceMotion,
}: {
  sky: Atmosphere;
  bounds: Bounds;
  low: boolean;
  reduceMotion: boolean;
}) {
  const drops = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const snow = sky.kind === "snow";
  const active = snow || sky.kind === "rain" || sky.kind === "storm";
  const count = low ? 145 : snow ? 520 : 650;
  useFrame(({ clock }) => {
    if (!drops.current) return;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const height = 23;
    const t = reduceMotion ? 0 : clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const y =
        height - ((random(i * 5) * height + t * (snow ? 1.8 : 17)) % height);
      dummy.position.set(
        bounds.minX +
          random(i * 3 + 89) * spanX +
          Math.sin(t * 0.7 + i) * (snow ? 0.57 : 0.21),
        y,
        bounds.minZ + random(i * 13 + 21) * spanZ + y * (snow ? 0.03 : 0.15),
      );
      dummy.rotation.z = snow ? (i % 7) + t * 0.3 : -0.17;
      const size = 0.6 + random(i * 17) * 0.85;
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      drops.current.setMatrixAt(i, dummy.matrix);
    }
    drops.current.instanceMatrix.needsUpdate = true;
  });
  if (!active) return null;
  return (
    <instancedMesh
      key={`${snow}-${count}`}
      ref={drops}
      args={[undefined, undefined, count]}
      frustumCulled={false}
    >
      {snow ? (
        <icosahedronGeometry args={[0.17, 0]} />
      ) : (
        <boxGeometry args={[0.072, 1.16, 0.072]} />
      )}
      <meshBasicMaterial
        color={snow ? "#f6fbff" : "#bad5ed"}
        transparent
        opacity={snow ? 0.88 : 0.66}
        depthWrite={false}
      />
    </instancedMesh>
  );
}
