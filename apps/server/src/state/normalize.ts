import {
  commonFolder,
  type Employee,
  isAgent,
  redact,
  seededEmployeeName,
  type Team,
} from "@herdr-office/core";
import type { HcTerminal } from "../hc/HcClient.ts";

export const LOCAL_MACHINE = "local";
export const LAYOUT_DOCUMENT = "herdr-app";

export interface LayoutSpace {
  id: string;
  folder: string;
  name: string;
}

export function readLayout(value: unknown): LayoutSpace[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("spaces" in value) ||
    !Array.isArray(value.spaces)
  ) {
    return [];
  }
  return value.spaces.filter(
    (space): space is LayoutSpace =>
      Boolean(space) &&
      typeof space.id === "string" &&
      typeof space.folder === "string" &&
      typeof space.name === "string",
  );
}

// Some agents (such as Cursor CLI) do not publish an HC status record.
const agentPrograms = new Set([
  "agent",
  "claude",
  "codex",
  "cursor-agent",
  "gemini",
  "opencode",
]);

export function terminalAgent(terminal: HcTerminal): string | null {
  const reported = [terminal.agent, terminal.status?.app].find(isAgent);
  const program = [terminal.foreground?.name, terminal.foreground?.argv?.[0]]
    .map((name) => name?.split("/").at(-1))
    .find((name) => name && agentPrograms.has(name));
  return reported ?? program ?? null;
}

function mostCommonFolder(paths: string[]): string | null {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const folder = commonFolder([path]);
    if (folder) counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  const max = Math.max(0, ...counts.values());
  return commonFolder(
    [...counts].filter(([, count]) => count === max).map(([folder]) => folder),
  );
}

export function liveTeams(
  terminals: HcTerminal[],
  layouts: Map<string, LayoutSpace[]>,
): Team[] {
  const teams = new Map<string, Team>();
  for (const terminal of terminals) {
    const id = terminal.labels["herdr.space"];
    if (terminal.state !== "live" || !id) continue;
    const separator = terminal.address.lastIndexOf("/");
    const machineId =
      separator < 0 ? LOCAL_MACHINE : terminal.address.slice(0, separator);
    const employee: Employee = {
      address: terminal.address,
      machineId,
      spaceId: id,
      name: terminal.name || seededEmployeeName(id, terminal.address),
      cwd: terminal.cwd,
      agent: terminalAgent(terminal),
      status: terminal.status?.state ?? null,
      turn: terminal.turn ?? 0,
      title: redact(terminal.status?.title || terminal.title || ""),
      parent: terminal.parent ?? null,
      labels: Object.fromEntries(
        Object.entries(terminal.labels).filter(
          ([key]) =>
            key === "where" ||
            key.startsWith("herdr.") ||
            key.endsWith(".role"),
        ),
      ),
    };
    const team = teams.get(id);
    if (team) {
      team.employees.push(employee);
    } else {
      teams.set(id, {
        id,
        machineId,
        name: id,
        folder: null,
        vacantSince: null,
        employees: [employee],
      });
    }
  }

  return [...teams.values()].filter((team) => {
    const agents = team.employees.filter(({ agent }) => agent !== null);
    if (!agents.length) return false;
    const layout = layouts
      .get(team.machineId)
      ?.find(({ id }) => id === team.id);
    const where = team.employees.find(({ labels }) => labels.where)?.labels
      .where;
    const separator = where?.lastIndexOf(" / ") ?? -1;
    team.name =
      layout?.name ||
      (separator >= 0 ? where?.slice(0, separator) : where) ||
      team.id;
    team.folder =
      mostCommonFolder(agents.map(({ cwd }) => cwd)) ??
      mostCommonFolder(team.employees.map(({ cwd }) => cwd)) ??
      (layout?.folder || null);
    team.employees = agents;
    return true;
  });
}
