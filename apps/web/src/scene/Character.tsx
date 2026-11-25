import type { Employee } from "@herdr-office/core";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import {
  employeeName,
  employeeProvider,
  employeeRole,
  employeeStatus,
} from "../ui/employee.ts";
import { ActorProps } from "./ActionProps.tsx";
import { Box } from "./Primitives.tsx";
import { agentColors, scene } from "./palette.ts";
import { wasDrag } from "./pointer.ts";
import { SceneLabel } from "./SceneLabels.tsx";

export function Character({
  employee,
  lead,
  showLabel,
  selected,
  reduceMotion,
  onSelect,
  motion = "sit",
  item = "",
  remote = false,
}: {
  employee: Employee;
  lead: boolean;
  showLabel: boolean;
  selected: boolean;
  reduceMotion: boolean;
  onSelect: () => void;
  motion?: string;
  item?: string;
  remote?: boolean;
}) {
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  const body = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const animation = useRef({ status: employee.status, elapsed: 0 });
  const colors = agentColors[employeeProvider(employee)];

  useFrame(({ clock }, dt) => {
    if (!left.current || !right.current || !body.current) return;
    const state = animation.current;
    if (state.status !== employee.status) {
      state.status = employee.status;
      state.elapsed = 0;
    }
    state.elapsed += dt;
    const t = clock.elapsedTime;
    const walking =
      motion === "walk" || motion === "run" || motion === "exercise";
    const lying = motion === "lieDown";
    const work = motion === "type" || motion === "videocall";
    const occupiedHands = [
      "phone",
      "eat",
      "drink",
      "read",
      "call",
      "cook",
      "draw",
      "play",
    ].includes(motion);
    const blocked = employee.status === "blocked" && motion === "sit";
    const stretch =
      !reduceMotion &&
      (motion === "stretch" ||
        (employee.status === "done" && state.elapsed < 1.45))
        ? Math.sin(Math.PI * Math.min(1, state.elapsed / 1.45))
        : 0;
    const tics = reduceMotion ? 0 : Math.sin(t * (walking ? 10 : 16));
    const bite = !reduceMotion && occupiedHands ? 0.12 * Math.sin(t * 3) : 0;
    left.current.rotation.x = walking
      ? tics * 0.62
      : (work || occupiedHands ? 1.11 : 0.64) + (work ? tics * 0.19 : bite);
    right.current.rotation.x = walking
      ? -tics * 0.62
      : (work || occupiedHands ? 1.12 : 0.64) - (work ? tics * 0.19 : bite);
    left.current.rotation.z = 0.14 + stretch * 2.1;
    right.current.rotation.z = -0.14 - (blocked ? 1.1 : stretch * 2.1);
    body.current.position.set(
      0,
      lying ? 0.45 : walking ? 0.22 + Math.abs(tics) * 0.06 : stretch * 0.16,
      0,
    );
    body.current.rotation.x = lying ? -1.45 : 0;
    if (leftLeg.current && rightLeg.current) {
      leftLeg.current.rotation.x = walking ? -tics * 0.68 : -1.0;
      rightLeg.current.rotation.x = walking ? tics * 0.68 : -1.0;
    }
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The 3D mesh also has a native button.
    <group
      onClick={(event) => {
        event.stopPropagation();
        if (wasDrag(event)) return;
        onSelect();
      }}
    >
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[0.43, 0.52, 20]} />
          <meshBasicMaterial color={scene.gold} />
        </mesh>
      )}
      <group ref={body}>
        <group ref={leftLeg} position={[-0.135, 0.48, 0]}>
          <Box
            position={[0, -0.23, -0.045]}
            size={[0.19, 0.46, 0.22]}
            color={colors.hair}
          />
        </group>
        <group ref={rightLeg} position={[0.135, 0.48, 0]}>
          <Box
            position={[0, -0.23, -0.045]}
            size={[0.19, 0.46, 0.22]}
            color={colors.hair}
          />
        </group>
        <Box
          position={[0, 0.7, 0.02]}
          size={[0.5, 0.48, 0.35]}
          color={colors.coat}
        />
        <mesh position={[0, 1.12, -0.015]} scale={[1, 1.04, 0.9]} castShadow>
          <sphereGeometry args={[0.26, 9, 6]} />
          <meshStandardMaterial color={colors.face} flatShading />
        </mesh>
        <mesh position={[0, 1.29, 0.017]} scale={[1, 0.55, 0.87]} castShadow>
          <sphereGeometry args={[0.267, 9, 5]} />
          <meshStandardMaterial color={colors.hair} flatShading />
        </mesh>
        <group ref={left} position={[-0.29, 0.88, -0.03]}>
          <Box
            position={[0, -0.16, 0]}
            size={[0.14, 0.32, 0.15]}
            color={colors.coat}
          />
          <Box
            position={[0, -0.34, 0]}
            size={[0.13, 0.16, 0.14]}
            color={colors.face}
          />
        </group>
        <group ref={right} position={[0.29, 0.88, -0.03]}>
          <Box
            position={[0, -0.16, 0]}
            size={[0.14, 0.32, 0.15]}
            color={colors.coat}
          />
          <Box
            position={[0, -0.34, 0]}
            size={[0.13, 0.16, 0.14]}
            color={colors.face}
          />
        </group>
      </group>
      <ActorProps item={item} call={motion === "videocall"} remote={remote} />
      {employee.status === "blocked" && motion === "sit" && (
        <SceneLabel position={[0, 1.82, 0]} order={14}>
          <span className="blocked-symbol" aria-hidden="true">
            !
          </span>
        </SceneLabel>
      )}
      {(selected || showLabel) && (
        <SceneLabel position={[0, 1.52, 0]} order={13}>
          <button
            className="character-label"
            type="button"
            onClick={onSelect}
            aria-label={`${employeeName(employee)} ${employeeRole(employee, lead)} ${employeeStatus(employee)}`}
          >
            <strong>{employeeName(employee)}</strong>{" "}
            {employeeRole(employee, lead)}
          </button>
        </SceneLabel>
      )}
    </group>
  );
}
