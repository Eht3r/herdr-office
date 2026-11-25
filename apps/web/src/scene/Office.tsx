import { useFrame } from "@react-three/fiber";
import { useContext, useRef } from "react";
import type { Group } from "three";
import {
  type DeskLayout,
  FLOOR_Y,
  type OfficeLayout,
} from "../layout/campusLayout.ts";
import { Box, PottedPlant } from "./Primitives.tsx";
import { officeColors, scene } from "./palette.ts";
import { wasDrag } from "./pointer.ts";
import { ActiveDesks, SceneNight } from "./SceneEnvironment.ts";
import { SceneLabel } from "./SceneLabels.tsx";

function Desk({ desk, vacant }: { desk: DeskLayout; vacant: boolean }) {
  const { employee, position, scale, lead } = desk;
  const activeDesks = useContext(ActiveDesks);
  const working =
    employee &&
    (activeDesks?.has(employee.address) ?? employee.status === "working");
  const width = lead ? 1.88 : 1.52;
  const wood = vacant ? scene.inactive : lead ? scene.lead : scene.desk;
  return (
    <group
      position={[position[0], position[1] - FLOOR_Y, position[2]]}
      scale={scale}
    >
      {lead && (
        <Box
          position={[0, 0.025, 0.17]}
          size={[2.22, 0.045, 1.98]}
          color={scene.carpet}
        />
      )}
      <Box
        position={[0, 0.74, -0.33]}
        size={[width, 0.12, 0.88]}
        color={wood}
      />
      <Box
        position={[-width / 2 + 0.13, 0.34, -0.33]}
        size={[0.18, 0.68, 0.71]}
        color={wood}
      />
      <Box
        position={[width / 2 - 0.13, 0.34, -0.33]}
        size={[0.18, 0.68, 0.71]}
        color={wood}
      />
      <Box
        position={[0, 1.092, -0.57]}
        size={[0.86, 0.51, 0.095]}
        color={scene.monitor}
      />
      <Box
        position={[0, 1.097, -0.516]}
        size={[0.73, 0.399, 0.015]}
        color={working ? scene.screen : scene.offScreen}
        glowing={working}
        castShadow={false}
      />
      <Box
        position={[0, 0.87, -0.574]}
        size={[0.09, 0.25, 0.09]}
        color={scene.monitor}
      />
      <Box
        position={[0, 0.808, -0.55]}
        size={[0.34, 0.024, 0.23]}
        color={scene.monitor}
      />
      {!vacant && (
        <Box
          position={[0.02, 0.822, -0.13]}
          size={[0.49, 0.03, 0.16]}
          color={scene.key}
        />
      )}
      {lead && (
        <Box
          position={[0.63, 0.82, -0.1]}
          size={[0.29, 0.038, 0.31]}
          color={scene.clipboard}
        />
      )}
      <Box
        position={[0, 0.31, 0.51]}
        size={[0.56, 0.12, 0.55]}
        color={scene.chair}
      />
      <Box
        position={[0, 0.56, 0.77]}
        size={[0.54, 0.43, 0.13]}
        color={scene.chair}
      />
      <Box
        position={[0, 0.15, 0.51]}
        size={[0.13, 0.3, 0.13]}
        color={scene.trim}
      />
      <Box
        position={[0, 0.065, 0.51]}
        size={[0.43, 0.08, 0.41]}
        color={scene.trim}
      />
    </group>
  );
}

interface OfficeProps {
  office: OfficeLayout;
  appeared: ReadonlyMap<string, number>;
  focusKey: string | null;
  reduceMotion: boolean;
  onOffice: (key: string) => void;
}

export function Office({
  office,
  appeared,
  focusKey,
  reduceMotion,
  onOffice,
}: OfficeProps) {
  const ref = useRef<Group>(null);
  const night = useContext(SceneNight);
  const { x, z, width, depth } = office.bounds;
  const chosen = focusKey === office.key;
  const variation = office.key
    .split("")
    .reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const colors = officeColors[variation % officeColors.length];
  const wallHeight = Math.min(1.1, width * 0.27);
  const isGroup = office.kind === "group";
  const back = z - depth / 2;
  const birth = appeared.get(office.key);

  useFrame(() => {
    if (!ref.current) return;
    const progress =
      birth === undefined || reduceMotion
        ? 1
        : Math.max(0, Math.min(1, (Date.now() - birth) / 900));
    const rise = 1 - (1 - progress) ** 3;
    ref.current.position.y = FLOOR_Y - (1 - rise) * 0.7;
    ref.current.scale.y = 0.05 + rise * 0.95;
  });

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: The office also has a native button. */}
      <group
        ref={ref}
        position={[0, FLOOR_Y, 0]}
        onClick={(event) => {
          event.stopPropagation();
          if (wasDrag(event)) return;
          onOffice(office.key);
        }}
      >
        <Box
          position={[x, -0.15, z]}
          size={[width, 0.3, depth]}
          color={office.vacant ? scene.inactive : colors.tile}
        />
        <Box
          position={[x, -0.045, z + depth / 2 - 0.11]}
          size={[width, 0.12, 0.2]}
          color={chosen ? scene.gold : colors.edge}
        />
        <Box
          position={[x - width / 2 + 0.1, wallHeight / 2, z]}
          size={[0.2, wallHeight, depth]}
          color={office.vacant ? scene.inactive : scene.wall}
        />
        <Box
          position={[x, wallHeight / 2, back + 0.09]}
          size={[width, wallHeight, 0.18]}
          color={office.vacant ? scene.inactive : scene.wall}
        />
        {!isGroup && !office.offices.length && width > 4 && (
          <>
            <Box
              position={[x, wallHeight + 0.36, back + 0.09]}
              size={[width - 0.75, 0.82, 0.16]}
              color={office.vacant ? scene.inactive : scene.frame}
            />
            <Box
              position={[x, wallHeight + 0.36, back + 0.19]}
              size={[width - 0.96, 0.65, 0.055]}
              color={
                office.vacant ? scene.inactive : night ? "#e3bf84" : scene.glass
              }
              glowing={night && !office.vacant}
            />
            {[-0.28, 0, 0.28].map((fraction) => (
              <Box
                key={fraction}
                position={[
                  x + width * fraction,
                  wallHeight + 0.36,
                  back + 0.23,
                ]}
                size={[0.09, 0.73, 0.06]}
                color={office.vacant ? scene.inactive : scene.frame}
              />
            ))}
            {!office.vacant && (
              <PottedPlant position={[x - width / 2 + 0.62, 0, back + 0.66]} />
            )}
          </>
        )}
        {office.desks.map((desk, index) => (
          <Desk
            key={desk.employee?.address ?? `vacant-${index}`}
            desk={desk}
            vacant={office.vacant}
          />
        ))}
        {(!isGroup || chosen) && (
          <SceneLabel position={[x, 0.34, z + depth / 2 + 0.08]} order={9}>
            <button
              className="office-label"
              type="button"
              aria-pressed={chosen}
              onClick={() => onOffice(office.key)}
            >
              {office.name}
              {office.vacant && <span>빈 사무실</span>}
            </button>
          </SceneLabel>
        )}
      </group>
      {office.offices.map((child) => (
        <Office
          key={child.key}
          office={child}
          appeared={appeared}
          focusKey={focusKey}
          reduceMotion={reduceMotion}
          onOffice={onOffice}
        />
      ))}
    </>
  );
}
