import type {
  Department,
  Group,
  GroupDepartment,
  HierarchyOverride,
  Machine,
  ManagementEvidence,
  Organization,
  Team,
} from "./types.ts";
import { placementOf } from "./types.ts";

export const DEFAULT_VACANCY_MS = 10 * 60 * 1000;

export function retainVacantTeams(
  live: Team[],
  previous: Team[],
  now: number,
  vacancyMs = DEFAULT_VACANCY_MS,
): Team[] {
  const liveIds = new Set(live.map((team) => team.id));
  const vacant = previous.flatMap((team) => {
    if (liveIds.has(team.id)) return [];
    const vacantSince = team.vacantSince ?? now;
    return now - vacantSince < vacancyMs
      ? [{ ...team, employees: [], vacantSince }]
      : [];
  });
  return [...live, ...vacant];
}

function pathParts(path: string): string[] {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts;
}

export function commonFolder(paths: string[]): string | null {
  const folders = paths.filter((path) => path.startsWith("/")).map(pathParts);
  const [first, ...rest] = folders;
  if (!first) return null;
  const mismatch = first.findIndex((part, index) =>
    rest.some((folder) => folder[index] !== part),
  );
  return `/${first.slice(0, mismatch < 0 ? first.length : mismatch).join("/")}`;
}

export function isAgent(name: string | null | undefined): name is string {
  if (!name) return false;
  const program = name.split("/").at(-1)?.replace(/^-/, "");
  return (
    Boolean(program) &&
    ![
      "shell",
      "zsh",
      "bash",
      "fish",
      "sh",
      "dash",
      "ksh",
      "csh",
      "tcsh",
      "nu",
      "pwsh",
    ].includes(program ?? "")
  );
}

function isHomeFolder(parts: string[]): boolean {
  return (
    (parts.length === 1 && parts[0] === "root") ||
    (parts.length === 2 && (parts[0] === "Users" || parts[0] === "home"))
  );
}

function leadAddress(team: Team): string | null {
  const employees = team.employees;
  const addresses = new Set(employees.map(({ address }) => address));
  const parents = new Set(employees.map(({ parent }) => parent));
  const labeled =
    employees.find(({ labels }) => labels["team.role"] === "lead") ??
    employees.find(({ labels }) =>
      Object.entries(labels).some(
        ([key, value]) => key.endsWith(".role") && value === "lead",
      ),
    );
  const root = employees.find(
    ({ address, parent }) =>
      parents.has(address) && (!parent || !addresses.has(parent)),
  );
  const agent = employees.find(({ agent }) => isAgent(agent));
  return (labeled ?? root ?? agent)?.address ?? null;
}

export function evidenceKey(parent: string, child: string): string {
  return JSON.stringify([parent, child]);
}

export function buildOrg({
  machines,
  teams,
  groups = [],
  overrides = [],
  messages = [],
  hierarchy = {},
}: {
  machines: Machine[];
  teams: Team[];
  groups?: Group[];
  overrides?: HierarchyOverride[];
  messages?: ManagementEvidence[];
  hierarchy?: { defaultWhenUnknown?: boolean };
}): Organization {
  const manual = new Map(
    overrides.map((rule) => [
      evidenceKey(rule.parentSpaceId, rule.childSpaceId),
      rule.manages,
    ]),
  );
  const observed = new Set(
    messages.map((edge) => evidenceKey(edge.parentSpaceId, edge.childSpaceId)),
  );
  const byAddress = new Map(
    teams.flatMap((team) =>
      team.employees.map(({ address }) => [address, team.id] as const),
    ),
  );
  for (const team of teams) {
    for (const employee of team.employees) {
      const parentId = employee.parent && byAddress.get(employee.parent);
      if (parentId) observed.add(evidenceKey(parentId, team.id));
    }
  }

  const groupBySpace = new Map<string, Group>();
  for (const group of groups) {
    for (const id of group.spaceIds) {
      if (!groupBySpace.has(id)) groupBySpace.set(id, group);
    }
  }

  return {
    buildings: machines.map((machine) => {
      const departments: Department[] = [];
      const groupDepartments = new Map<string, GroupDepartment>();
      const local = teams.filter((team) => team.machineId === machine.id);
      const nodes = local.map<{ node: Department; folder: string[] | null }>(
        (team) => ({
          node: { ...team, leadAddress: leadAddress(team), departments: [] },
          folder: team.folder?.startsWith("/") ? pathParts(team.folder) : null,
        }),
      );
      nodes.sort((a, b) => (a.folder?.length ?? -1) - (b.folder?.length ?? -1));
      const containingGroups = new Map<string, string>();

      for (const { node, folder } of nodes) {
        const nearest =
          folder &&
          nodes.findLast(
            ({ folder: candidate, node: ancestor }) =>
              candidate &&
              (!isHomeFolder(candidate) ||
                manual.has(evidenceKey(ancestor.id, node.id))) &&
              candidate.length < folder.length &&
              candidate.every((part, index) => part === folder[index]),
          );
        const key = nearest && evidenceKey(nearest.node.id, node.id);
        const parent =
          key &&
          (manual.get(key) ??
            (observed.has(key) || (hierarchy.defaultWhenUnknown ?? true)))
            ? nearest.node
            : null;
        const group = groupBySpace.get(node.id);
        const inheritedGroup = parent && containingGroups.get(parent.id);

        if (group && group.id !== inheritedGroup) {
          let container = groupDepartments.get(group.id);
          if (!container) {
            container = { id: group.id, name: group.name, departments: [] };
            groupDepartments.set(group.id, container);
          }
          container.departments.push(node);
          containingGroups.set(node.id, group.id);
        } else if (parent) {
          parent.departments.push(node);
          if (inheritedGroup) containingGroups.set(node.id, inheritedGroup);
        } else {
          departments.push(node);
        }
      }

      return {
        ...machine,
        ...placementOf(machine),
        departments,
        groups: [...groupDepartments.values()],
      };
    }),
  };
}
