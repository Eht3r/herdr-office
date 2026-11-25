import type { ThreeElements } from "@react-three/fiber";
import type { Point3 } from "../layout/campusLayout.ts";
import { scene } from "./palette.ts";

type BoxProps = ThreeElements["mesh"] & {
  size: Point3;
  color: string;
  glowing?: boolean;
};

export function Box({ size, color, glowing = false, ...props }: BoxProps) {
  return (
    <mesh castShadow receiveShadow {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={glowing ? color : undefined}
        emissiveIntensity={0.65}
      />
    </mesh>
  );
}

export function PottedPlant({
  position,
  scale = 1,
}: {
  position: Point3;
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.18, 0.4, 7]} />
        <meshStandardMaterial color={scene.wood} />
      </mesh>
      <mesh position={[0, 0.55, 0]} castShadow>
        <icosahedronGeometry args={[0.32, 0]} />
        <meshStandardMaterial color={scene.leaf} />
      </mesh>
      <mesh position={[0.15, 0.7, 0.06]} castShadow>
        <icosahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color={scene.leafLight} />
      </mesh>
    </group>
  );
}

export function Tree({
  position,
  size = 1,
}: {
  position: Point3;
  size?: number;
}) {
  return (
    <group position={position} scale={size}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.19, 1.1, 6]} />
        <meshStandardMaterial color={scene.bark} />
      </mesh>
      <mesh position={[0, 1.5, 0]} scale={[1, 1.28, 0.92]} castShadow>
        <icosahedronGeometry args={[0.89, 0]} />
        <meshStandardMaterial color={scene.leaf} />
      </mesh>
      <mesh position={[-0.35, 1.85, 0.12]} castShadow>
        <icosahedronGeometry args={[0.55, 0]} />
        <meshStandardMaterial color={scene.leafLight} />
      </mesh>
    </group>
  );
}
