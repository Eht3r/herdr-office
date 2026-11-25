import type {
  Building,
  Department,
  Employee,
  Organization,
} from "@herdr-office/core";
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  CAMPUS_ORIGIN,
  computeCampusLayout,
  type Rect,
  waypointKinds,
} from "./campusLayout.ts";

const lead: Employee = {
  address: "t1",
  machineId: "local",
  spaceId: "parent",
  name: "Example",
  cwd: "/workspace",
  agent: "codex",
  status: "working",
  turn: 0,
  title: "",
  parent: null,
  labels: {},
};

function department(id: string, details: Partial<Department> = {}): Department {
  return {
    id,
    name: id,
    machineId: "local",
    folder: "/workspace",
    employees: [],
    vacantSince: null,
    leadAddress: null,
    departments: [],
    ...details,
  };
}

function building(id: string, departments: Department[]): Building {
  return { id, name: id, departments, groups: [] };
}

function coordinates(org: Organization): Record<string, Rect> {
  return Object.fromEntries(
    computeCampusLayout(org).buildings.flatMap(({ offices }) =>
      offices.map(({ key, bounds }) => [key, bounds]),
    ),
  );
}

describe("computeCampusLayout", () => {
  it("keeps existing offices in their plots when another plot becomes available or occupied", () => {
    const base = [department("qa"), department("development")];
    const initial = coordinates({ buildings: [building("local", base)] });
    const extended = coordinates({
      buildings: [building("local", [department("tools"), ...base])],
    });
    for (const [key, location] of Object.entries(initial))
      expect(extended[key]).toEqual(location);
    expect(
      coordinates({ buildings: [building("local", [...base].reverse())] }),
    ).toEqual(initial);
  });

  it("places independent buildings side by side with a bridge and external entrance waypoints", () => {
    const layout = computeCampusLayout({
      buildings: [
        building("remote", [department("infra")]),
        building("local", []),
      ],
    });
    expect(layout.origin).toEqual(CAMPUS_ORIGIN);
    expect(layout.buildings.map(({ id }) => id)).toEqual(["local", "remote"]);
    const [left, right] = layout.buildings.map(({ bounds }) =>
      boundsOf(bounds),
    );
    expect(left.maxX).toBeLessThan(right.minX);
    const bridge = boundsOf(layout.walkways[0]);
    expect(bridge.minX).toBeLessThanOrEqual(left.maxX);
    expect(bridge.maxX).toBeGreaterThanOrEqual(right.minX);
    for (const { bounds, waypoints } of layout.buildings) {
      expect(waypoints.entrance[2]).toBeGreaterThan(boundsOf(bounds).maxZ);
      expect(waypoints.entrance[2]).toBeLessThan(layout.bounds.maxZ);
      expect(Object.keys(waypoints).sort()).toEqual([...waypointKinds].sort());
    }
  });

  it("nests rooms within parent bounds and reserves a lead's separate desk", () => {
    const data = building("local", [
      department("parent", {
        employees: [lead, { ...lead, address: "t2" }],
        leadAddress: lead.address,
        departments: [department("child"), department("sibling")],
      }),
    ]);
    const parent = computeCampusLayout({ buildings: [data] }).buildings[0]
      .offices[0];
    const parentBounds = boundsOf(parent.bounds);
    const workspace = boundsOf(parent.workspace as Rect);
    for (const child of parent.offices) {
      const childBounds = boundsOf(child.bounds);
      expect(childBounds.minX).toBeGreaterThan(parentBounds.minX);
      expect(childBounds.maxX).toBeLessThan(parentBounds.maxX);
      expect(childBounds.minZ).toBeGreaterThan(parentBounds.minZ);
      expect(childBounds.maxZ).toBeLessThan(workspace.minZ);
    }
    const leadDesk = parent.desks.find(({ lead }) => lead);
    expect(leadDesk?.employee?.address).toBe("t1");
    expect(leadDesk?.position[0]).toBeGreaterThan(parent.desks[0].position[0]);
  });

  it("gives groups no desk and leaves a vacant department furnished but unstaffed", () => {
    const data = building("local", []);
    data.groups = [
      {
        id: "group",
        name: "Group",
        departments: [department("vacant", { vacantSince: 100 })],
      },
    ];
    const group = computeCampusLayout({ buildings: [data] }).buildings[0]
      .offices[0];
    expect(group.workspace).toBeNull();
    expect(group.desks).toEqual([]);
    expect(group.offices[0]).toMatchObject({ vacant: true });
    expect(group.offices[0].desks.length).toBeGreaterThan(0);
    expect(
      group.offices[0].desks.every(({ employee }) => employee === undefined),
    ).toBe(true);
  });
});
