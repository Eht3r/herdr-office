import { type BuildingLayout, FLOOR_Y } from "../layout/campusLayout.ts";
import { Office } from "./Office.tsx";
import { Box, PottedPlant } from "./Primitives.tsx";
import { scene } from "./palette.ts";
import { wasDrag } from "./pointer.ts";
import { SceneLabel } from "./SceneLabels.tsx";

type Amenities = Pick<
  BuildingLayout["waypoints"],
  "kitchenette" | "restroom" | "lounge" | "sleepCapsules"
>;

const amenityLabels: Record<keyof Amenities, string> = {
  kitchenette: "탕비실",
  restroom: "화장실",
  lounge: "라운지",
  sleepCapsules: "수면 캡슐",
};

export function Building({
  building,
  appeared,
  focusKey,
  focusedBuilding,
  campus,
  reduceMotion,
  onBuilding,
  onOffice,
}: {
  building: BuildingLayout;
  appeared: ReadonlyMap<string, number>;
  focusKey: string | null;
  focusedBuilding: boolean;
  campus: boolean;
  reduceMotion: boolean;
  onBuilding: (id: string) => void;
  onOffice: (key: string) => void;
}) {
  const { x, z, width, depth } = building.bounds;
  const { entrance, elevator, rooftop, ...amenities } = building.waypoints;
  const front = z + depth / 2;
  const back = z - depth / 2;
  const title = building.site;
  const shared = building.sections > 1;
  const serverRoom = building.roomKind === "serverRoom";
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: The 3D mesh also has a native button.
    <group
      onClick={(event) => {
        event.stopPropagation();
        if (wasDrag(event)) return;
        onBuilding(building.id);
      }}
    >
      <Box
        position={[x, 0.25, z]}
        size={[width, 0.5, depth]}
        color={scene.building}
      />
      <Box
        position={[x, 0.51, z]}
        size={[width - 0.32, 0.16, depth - 0.3]}
        color={scene.stone}
      />
      <Box
        position={[x, 0.14, front + 1.18]}
        size={[5.8, 0.24, 2.35]}
        color={scene.stone}
      />
      <Box
        position={[x, 0.35, front + 0.23]}
        size={[5.2, 0.18, 0.73]}
        color={scene.frame}
      />
      <Box
        position={[x, 0.49, front - 0.08]}
        size={[4.6, 0.12, 0.6]}
        color={scene.frame}
      />
      <Box
        position={[x, 0.71, back + 0.08]}
        size={[width, 0.32, 0.2]}
        color={scene.trim}
      />
      <Box
        position={[x - width / 2 + 0.12, 0.73, z - 1.26]}
        size={[0.24, 0.34, depth - 2.5]}
        color={scene.trim}
      />

      {[-1.91, 1.91].map((offset) => (
        <Box
          key={offset}
          position={[x + offset, 1.51, front - 0.34]}
          size={[0.16, 1.82, 0.21]}
          color={scene.trim}
        />
      ))}
      <Box
        position={[x, 2.36, front - 0.34]}
        size={[4.2, 0.25, 0.5]}
        color={focusedBuilding ? scene.gold : scene.trim}
      />
      <Box
        position={elevator}
        size={[2.08, 0.08, 2.3]}
        color={scene.concrete}
      />
      <Box
        position={[elevator[0], 1.23, elevator[2] - 0.9]}
        size={[2.1, 1.29, 0.17]}
        color={scene.trim}
      />
      <Box
        position={[elevator[0], 1.21, elevator[2] - 0.79]}
        size={[1.75, 1.13, 0.06]}
        color={scene.glass}
      />
      <Box
        position={[elevator[0], 1.21, elevator[2] - 0.74]}
        size={[0.07, 1.13, 0.045]}
        color={scene.trim}
      />
      <PottedPlant position={[x - 2.72, FLOOR_Y, front - 0.85]} />
      <PottedPlant position={[x + 2.72, FLOOR_Y, front - 0.85]} />

      {Object.entries(amenities).map(([kind, [ax, ay, az]]) => (
        <group key={kind}>
          <Box
            position={[ax, ay + 0.02, az]}
            size={[4.02, 0.08, 3.5]}
            color={scene.concrete}
          />
          <Box
            position={[ax, ay + 0.045, az]}
            size={[3.74, 0.06, 3.22]}
            color={scene.carpet}
          />
          <Box
            position={[ax, ay + 0.27, az - 1.67]}
            size={[4.02, 0.5, 0.13]}
            color={scene.wall}
          />
          {focusedBuilding && !campus && (
            <SceneLabel position={[ax, ay + 0.42, az]} order={6}>
              <span className="amenity-label">
                {amenityLabels[kind as keyof Amenities]}
              </span>
            </SceneLabel>
          )}
        </group>
      ))}

      <Box
        position={[rooftop[0], FLOOR_Y + 1.05, rooftop[2]]}
        size={[1.8, 2.15, 3.32]}
        color={scene.wall}
      />
      <Box
        position={[rooftop[0], rooftop[1] - 0.04, rooftop[2]]}
        size={[2.01, 0.15, 3.5]}
        color={scene.trim}
      />
      {serverRoom &&
        building.availablePlots.map((plot) => (
          <ServerRacks key={`racks:${plot.x}:${plot.z}`} plot={plot} />
        ))}
      {!serverRoom &&
        building.availablePlots.map((plot) => (
          <group
            key={`${plot.x}:${plot.z}`}
            position={[plot.x, FLOOR_Y, plot.z]}
          >
            <Box
              position={[0, 0.035, 0]}
              size={[plot.width - 0.22, 0.08, plot.depth - 0.22]}
              color={scene.carpet}
            />
            <Box
              position={[0, 0.071, 0]}
              size={[1.35, 0.035, plot.depth - 0.22]}
              color={scene.stone}
            />
            {[-1, 1].map((side) => (
              <group key={side} position={[side * 2.68, 0, -1.85]}>
                <Box
                  position={[0, 0.16, 0]}
                  size={[2.9, 0.32, 2.3]}
                  color={scene.wall}
                />
                <Box
                  position={[0, 0.335, 0]}
                  size={[2.62, 0.04, 2.02]}
                  color={scene.leafLight}
                />
                <PottedPlant
                  position={[side * 0.49, 0.34, -0.2]}
                  scale={0.93}
                />
              </group>
            ))}
          </group>
        ))}
      {building.offices.map((office) => (
        <Office
          key={office.key}
          office={office}
          appeared={appeared}
          focusKey={focusKey}
          reduceMotion={reduceMotion}
          onOffice={onOffice}
        />
      ))}
      <SceneLabel
        position={[entrance[0], 0.33, entrance[2] + 0.49]}
        order={shared && building.section > 0 ? 8 : 10}
      >
        <button
          type="button"
          className="building-label"
          data-room={shared && building.section > 0}
          aria-label={
            shared ? `${title} ${building.roomName}` : `${title} 건물`
          }
          aria-pressed={focusedBuilding && !focusKey}
          onClick={() => onBuilding(building.id)}
        >
          {shared && building.section > 0
            ? building.roomName
            : shared
              ? `${title} · ${building.roomName}`
              : title}
        </button>
      </SceneLabel>
    </group>
  );
}

const RACK_SLOTS = [0, 1, 2, 3];

/** Rows of server racks with status lights, filling an unused plot. */
function ServerRacks({
  plot,
}: {
  plot: BuildingLayout["availablePlots"][number];
}) {
  const rows = [-plot.depth / 4, plot.depth / 4];
  const spacing = (plot.width - 1.6) / RACK_SLOTS.length;
  return (
    <group position={[plot.x, FLOOR_Y, plot.z]}>
      <Box
        position={[0, 0.035, 0]}
        size={[plot.width - 0.22, 0.08, plot.depth - 0.22]}
        color={scene.concrete}
      />
      {rows.flatMap((z) =>
        RACK_SLOTS.map((column) => {
          const x = -plot.width / 2 + 0.8 + (column + 0.5) * spacing;
          return (
            <group key={`${z}:${column}`} position={[x, 0, z]}>
              <Box
                position={[0, 0.95, 0]}
                size={[spacing * 0.82, 1.8, 1.1]}
                color={scene.trim}
              />
              {[0.5, 0.9, 1.3].map((y, light) => (
                <Box
                  key={y}
                  position={[0, y, 0.56]}
                  size={[spacing * 0.5, 0.06, 0.02]}
                  color={
                    (column + light) % 3 === 0 ? scene.gold : scene.leafLight
                  }
                />
              ))}
            </group>
          );
        }),
      )}
    </group>
  );
}
