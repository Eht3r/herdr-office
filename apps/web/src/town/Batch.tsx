import { useLayoutEffect, useRef } from "react";
import { Color, type InstancedMesh, Object3D } from "three";
import type { Point3 } from "../layout/campusLayout.ts";

export interface Piece {
  at: Point3;
  size: Point3;
  color: string;
  yaw?: number;
}

export function Batch({
  pieces,
  form = "box",
  emissive = false,
  roughness = 0.86,
  shadow = true,
}: {
  pieces: Piece[];
  form?: "box" | "round" | "post";
  emissive?: boolean;
  roughness?: number;
  shadow?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new Object3D();
    const color = new Color();
    for (const [index, piece] of pieces.entries()) {
      dummy.position.set(...piece.at);
      dummy.scale.set(...piece.size);
      dummy.rotation.set(0, piece.yaw ?? 0, 0);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(index, dummy.matrix);
      mesh.current.setColorAt(index, color.set(piece.color));
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [pieces]);
  if (!pieces.length) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, pieces.length]}
      castShadow={shadow}
      receiveShadow={!emissive}
    >
      {form === "round" ? (
        <icosahedronGeometry args={[1, 0]} />
      ) : form === "post" ? (
        <cylinderGeometry args={[0.5, 0.53, 1, 7]} />
      ) : (
        <boxGeometry />
      )}
      {emissive ? (
        <meshBasicMaterial toneMapped={false} />
      ) : (
        <meshStandardMaterial roughness={roughness} flatShading />
      )}
    </instancedMesh>
  );
}
