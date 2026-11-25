import { describe, expect, it } from "vitest";
import { buildOrg, commonFolder, retainVacantTeams } from "./org.ts";
import type { Employee, Team } from "./types.ts";

const machines = [
  { id: "local", name: "Local" },
  { id: "remote", name: "Remote" },
];

function employee(address: string, fields: Partial<Employee> = {}): Employee {
  return {
    address,
    agent: "codex",
    name: null,
    cwd: "/workspace",
    labels: {},
    status: "working",
    spaceId: "example",
    machineId: "local",
    title: "",
    turn: 0,
    parent: null,
    ...fields,
  };
}

function team(
  id: string,
  folder: string,
  employees = [employee(id)],
  machineId = "local",
): Team {
  return { id, name: id, folder, machineId, employees, vacantSince: null };
}

const parent = team("parent", "/workspace/app/");
const child = team("child", "/workspace/app/feature");
const leaf = team("leaf", "/workspace/app/feature/leaf");
const sibling = team("sibling", "/workspace/app-tools");

describe("buildOrg", () => {
  it("uses the nearest ancestor by folder segments and keeps buildings independent", () => {
    const remote = team(
      "remote-team",
      "/workspace/app/feature/remote",
      [],
      "remote",
    );
    const { buildings } = buildOrg({
      machines,
      teams: [leaf, sibling, child, remote, parent],
    });
    expect(buildings[0].departments.map(({ id }) => id)).toEqual([
      "sibling",
      "parent",
    ]);
    expect(buildings[0].departments[1].departments[0].departments[0].id).toBe(
      "leaf",
    );
    expect(buildings[1].departments.map(({ id }) => id)).toEqual([
      "remote-team",
    ]);
  });

  it("keeps independent children at the root with their descendants", () => {
    const { buildings } = buildOrg({
      machines,
      teams: [parent, child, leaf],
      overrides: [
        { parentSpaceId: "parent", childSpaceId: "child", manages: false },
      ],
      messages: [{ parentSpaceId: "parent", childSpaceId: "child" }],
    });
    expect(buildings[0].departments.map(({ id }) => id)).toEqual([
      "parent",
      "child",
    ]);
    expect(buildings[0].departments[1].departments[0].id).toBe("leaf");
  });

  it("includes folder relationships backed by sent messages or parent links when the default is independent", () => {
    const linkedLeaf = {
      ...leaf,
      employees: [employee("leaf", { parent: "child" })],
    };
    const { buildings } = buildOrg({
      machines,
      teams: [parent, child, linkedLeaf],
      messages: [{ parentSpaceId: "parent", childSpaceId: "child" }],
      hierarchy: { defaultWhenUnknown: false },
    });
    expect(buildings[0].departments[0].departments[0].departments[0].id).toBe(
      "leaf",
    );
    expect(
      buildOrg({
        machines,
        teams: [parent, child],
        hierarchy: { defaultWhenUnknown: false },
      }).buildings[0].departments,
    ).toHaveLength(2);
  });

  it("moves grouped teams with descendants and ignores absent team IDs", () => {
    const { buildings } = buildOrg({
      machines,
      teams: [parent, child, leaf, sibling],
      groups: [
        {
          id: "group",
          name: "Group",
          spaceIds: ["child", "leaf", "sibling", "gone"],
        },
        { id: "empty", name: "Empty", spaceIds: ["also-gone"] },
      ],
    });
    expect(buildings[0].groups).toHaveLength(1);
    expect(buildings[0].groups[0].departments.map(({ id }) => id)).toEqual([
      "sibling",
      "child",
    ]);
    expect(buildings[0].groups[0].departments[1].departments[0].id).toBe(
      "leaf",
    );
    expect(buildings[0].departments[0].departments).toEqual([]);
  });

  it("recognizes alternate lead role labels, then parent roots, then agents", () => {
    const employees = [
      employee("shell", { agent: "zsh" }),
      employee("first"),
      employee("child", { parent: "root" }),
      employee("root"),
      employee("qa", { labels: { "qa.role": "lead" } }),
      employee("explicit", { labels: { "team.role": "lead" } }),
    ];
    const lead = (people: Employee[]) =>
      buildOrg({
        machines,
        teams: [team("test", "/workspace", people)],
      }).buildings[0].departments[0].leadAddress;
    expect(lead(employees)).toBe("explicit");
    expect(lead(employees.slice(0, -1))).toBe("qa");
    expect(lead(employees.slice(0, -2))).toBe("root");
    expect(lead(employees.slice(0, 2))).toBe("first");
  });

  it("keeps dissolved teams vacant for the grace period and revives returning teams", () => {
    const vacancy = retainVacantTeams([child], [parent], 100, 20);
    expect(vacancy.map(({ id, vacantSince }) => [id, vacantSince])).toEqual([
      ["child", null],
      ["parent", 100],
    ]);
    expect(vacancy[1].employees).toEqual([]);
    expect(retainVacantTeams([child], vacancy, 119, 20)).toHaveLength(2);
    expect(retainVacantTeams([child], vacancy, 120, 20)).toEqual([child]);
    expect(retainVacantTeams([parent, child], vacancy, 105, 20)).toEqual([
      parent,
      child,
    ]);
  });

  it("finds a common working folder without matching sibling prefixes", () => {
    expect(commonFolder(["/workspace/app/test", "/workspace/app/tools"])).toBe(
      "/workspace/app",
    );
    expect(commonFolder(["/workspace/app", "/workspace/apps"])).toBe(
      "/workspace",
    );
    expect(commonFolder(["relative"])).toBeNull();
  });
});

it.each(["/Users/example", "/home/example", "/root"])(
  "requires a manual override for a home folder %s to parent another team",
  (folder) => {
    const homeTeam = team("home", folder);
    const project = team("project", `${folder}/workspace/project`);
    const inputs = {
      machines,
      teams: [homeTeam, project],
      messages: [{ parentSpaceId: "home", childSpaceId: "project" }],
    };
    expect(
      buildOrg(inputs).buildings[0].departments.map(({ id }) => id),
    ).toEqual(["home", "project"]);
    expect(
      buildOrg({
        ...inputs,
        overrides: [
          { parentSpaceId: "home", childSpaceId: "project", manages: true },
        ],
      }).buildings[0].departments[0].departments[0].id,
    ).toBe("project");
  },
);
