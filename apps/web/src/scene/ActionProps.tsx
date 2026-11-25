import type { CommuteMode } from "@herdr-office/core";
import { Box } from "./Primitives.tsx";
import { scene } from "./palette.ts";

export function VehicleModel({ mode }: { mode: CommuteMode }) {
  const bus = mode === "bus";
  const subway = mode === "subway";
  const bicycle = mode === "bicycle";
  if (mode === "walk" || mode === "run") return null;
  if (bicycle)
    return (
      <group>
        {[-0.68, 0.68].map((z) => (
          <mesh key={z} position={[0, 0.25, z]} rotation={[0, Math.PI / 2, 0]}>
            <torusGeometry args={[0.24, 0.047, 5, 12]} />
            <meshStandardMaterial color="#354b55" />
          </mesh>
        ))}
        <Box
          position={[0, 0.39, 0.01]}
          size={[0.12, 0.2, 1.4]}
          color="#c67858"
        />
        <Box
          position={[0, 0.62, -0.52]}
          size={[0.43, 0.09, 0.1]}
          color="#537080"
        />
      </group>
    );
  const color = bus
    ? "#578e83"
    : subway
      ? "#7d98af"
      : mode === "taxi"
        ? "#dfb662"
        : "#c48167";
  const width = bus || subway ? 1.65 : 1.23;
  const length = bus ? 4.6 : subway ? 4.3 : 2.65;
  const height = bus || subway ? 1.26 : 0.62;
  return (
    <group>
      <Box
        position={[0, height * 0.3 + 0.19, 0]}
        size={[width, height * 0.73, length]}
        color={color}
      />
      <Box
        position={[0, height * 0.75 + 0.18, 0.075]}
        size={[width * 0.83, height * 0.3, length * 0.77]}
        color="#9ab8c2"
      />
      {[-1, 1].flatMap((side) =>
        [-1, 1].map((row) => (
          <Box
            key={`${side}:${row}`}
            position={[width * 0.44 * side, 0.15, length * 0.3 * row]}
            size={[0.22, 0.29, 0.38]}
            color="#405362"
          />
        )),
      )}
      <Box
        position={[0, 0.49, -length * 0.505]}
        size={[width * 0.69, 0.11, 0.045]}
        color="#f5dea6"
        glowing
      />
    </group>
  );
}

export function ActorProps({
  item,
  call,
  remote,
}: {
  item: string;
  call: boolean;
  remote: boolean;
}) {
  if (call || item === "laptop" || remote)
    return (
      <group position={[0.05, 0, -0.5]}>
        <Box
          position={[0, 0.72, -0.1]}
          size={[0.74, 0.05, 0.45]}
          color={scene.monitor}
        />
        <Box
          position={[0, 0.93, -0.29]}
          size={[0.75, 0.42, 0.085]}
          color={scene.monitor}
        />
        <Box
          position={[0, 0.94, -0.242]}
          size={[0.63, 0.31, 0.017]}
          color={call ? "#9e9ad2" : scene.screen}
          glowing
        />
        {call && (
          <>
            <Box
              position={[-0.12, 0.924, -0.225]}
              size={[0.18, 0.13, 0.024]}
              color="#678996"
            />
            <Box
              position={[-0.12, 1.02, -0.225]}
              size={[0.1, 0.11, 0.024]}
              color="#edc19a"
            />
            <Box
              position={[0.18, 0.93, -0.225]}
              size={[0.16, 0.18, 0.023]}
              color="#c1dce4"
            />
          </>
        )}
      </group>
    );
  const object = propShape(item);
  return object ? (
    <Box
      position={[0.19, 0.81, -0.32]}
      size={object.size}
      color={object.color}
    />
  ) : null;
}

function propShape(
  item: string,
): { size: [number, number, number]; color: string } | null {
  if (/phone|camera|controller|earbuds/iu.test(item))
    return { size: [0.13, 0.19, 0.065], color: "#526d89" };
  if (/cup|mug|coffee|tea|water/iu.test(item))
    return { size: [0.14, 0.21, 0.14], color: "#8ca5a0" };
  if (/snack|cookie|fruit|meal|cake|nuts|treat/iu.test(item))
    return { size: [0.32, 0.09, 0.28], color: "#dfaf74" };
  if (/note|book|ereader|paper|card|calendar|pencil/iu.test(item))
    return { size: [0.27, 0.07, 0.34], color: "#e6d3ab" };
  if (/battery/iu.test(item))
    return {
      size: [0.18, 0.32, 0.21],
      color: item.endsWith("Red") ? "#d4705a" : "#e3bf6b",
    };
  if (item && item !== "none")
    return { size: [0.23, 0.19, 0.21], color: "#b4a9b5" };
  return null;
}
