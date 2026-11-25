import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  type Employee,
  type EmployeeUsage,
  type Provider,
  providerFor,
} from "@herdr-office/core";
import { localTime } from "./calendar.ts";

const providers = ["claude", "codex", "cursor"] as const;
const minute = 60_000;
const noUsage: EmployeeUsage = {
  usedPct: null,
  resetAt: null,
  exhausted: false,
};
const usageKey = "usage-bar.snapshot";

function quotedEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  throw new SyntaxError("Unclosed JSON string");
}

// Skip unrelated values structurally and parse only the requested top-level member.
export function readUsageMember(text: string): unknown {
  let cursor = 0;
  const skipSpace = () => {
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor++;
  };
  skipSpace();
  if (text[cursor++] !== "{") return null;
  for (;;) {
    skipSpace();
    if (text[cursor] !== '"') return null;
    const keyEnd = quotedEnd(text, cursor);
    const key = JSON.parse(text.slice(cursor, keyEnd)) as string;
    cursor = keyEnd;
    skipSpace();
    if (text[cursor++] !== ":") return null;
    skipSpace();
    const begin = cursor;
    let depth = 0;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === '"') {
        cursor = quotedEnd(text, cursor);
        continue;
      }
      if (depth === 0 && (char === "," || char === "}")) break;
      if (char === "[" || char === "{") depth++;
      if (char === "]" || char === "}") depth--;
      cursor++;
    }
    if (key === usageKey) return JSON.parse(text.slice(begin, cursor));
    if (text[cursor++] !== ",") return null;
  }
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !/\d{4}-\d{2}-\d{2}T/u.test(value))
    return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

type WindowData = { usedPct: number; resetAt: number | null };

function summarize(windows: WindowData[]): EmployeeUsage | undefined {
  if (!windows.length) return undefined;
  const usedPct = Math.max(...windows.map((window) => window.usedPct));
  const resetTimes = windows
    .filter((window) =>
      usedPct >= 100 ? window.usedPct >= 100 : window.usedPct === usedPct,
    )
    .flatMap(({ resetAt }) => (resetAt === null ? [] : [resetAt]));
  return {
    usedPct,
    exhausted: usedPct >= 100,
    resetAt: resetTimes.length ? Math.max(...resetTimes) : null,
  };
}

function windowMap(value: unknown): Map<Provider, WindowData[]> {
  const result = new Map<Provider, WindowData[]>();
  if (!value || typeof value !== "object") return result;
  for (const provider of providers) {
    const data = (value as Partial<Record<Provider, unknown>>)[provider];
    if (
      !data ||
      typeof data !== "object" ||
      !("windows" in data) ||
      !Array.isArray(data.windows) ||
      ("error" in data && data.error)
    )
      continue;
    result.set(
      provider,
      data.windows.flatMap((window): WindowData[] =>
        window &&
        typeof window.used === "number" &&
        Number.isFinite(window.used)
          ? [
              {
                usedPct: Math.min(100, Math.max(0, window.used)),
                resetAt: timestamp(window.reset),
              },
            ]
          : [],
      ),
    );
  }
  return result;
}

export function detectScreenUsage(
  screen: string,
  at: number,
  timeZone: string,
): EmployeeUsage | undefined {
  const line = screen
    .split(/\r?\n/u)
    .slice(-40)
    .findLast(
      (value) =>
        !/^\s*(?:[›❯]|<hc)/u.test(value) &&
        /(?:hit|reach(?:ed)?|exceed(?:ed)?|exhausted|used up|limit exceeded|too many requests|사용량.{0,10}소진|한도.{0,10}초과)/iu.test(
          value,
        ) &&
        /(?:usage|rate.limit|token|requests|message.limit|session.limit|quota|limit.{0,16}reset|한도|사용량)/iu.test(
          value,
        ),
    );
  if (!line) return undefined;
  const iso = line.match(
    /\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})/u,
  )?.[0];
  const relative = line.match(
    /(?:resets?|try again)\s+in\s+(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?/iu,
  );
  const time = line.match(
    /(?:resets?|try again)(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/iu,
  );
  let resetAt = timestamp(iso);
  if (resetAt === null && relative && (relative[1] || relative[2])) {
    resetAt =
      at + (Number(relative[1] ?? 0) * 60 + Number(relative[2] ?? 0)) * minute;
  }
  if (resetAt === null && time) {
    const hours = Number(time[1]);
    const minutes = Number(time[2] ?? 0);
    const meridiem = time[3]?.toLowerCase();
    if (minutes < 60 && (meridiem ? hours >= 1 && hours <= 12 : hours < 24)) {
      const end =
        (meridiem ? (hours % 12) + (meridiem === "pm" ? 12 : 0) : hours) * 60 +
        minutes;
      const current = localTime(at, timeZone).minute;
      resetAt =
        Math.floor(at / minute) * minute +
        ((end - current + 1440) % 1440 || 1440) * minute;
    }
  }
  if (resetAt !== null && resetAt <= at) return undefined;
  return { usedPct: 100, exhausted: true, resetAt };
}

export class UsageMonitor {
  private source = new Map<Provider, WindowData[]>();
  private readonly screen = new Map<string, Map<string, EmployeeUsage>>();
  private watcher?: FSWatcher;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;

  constructor(
    private readonly timeZone: string,
    private readonly path = join(
      homedir(),
      ".config",
      "herdr-app",
      "shared.json",
    ),
  ) {}

  start(): void {
    void this.reload();
    try {
      // Watch the directory to survive atomic replacement of the shared file.
      this.watcher = watch(
        dirname(this.path),
        { persistent: false },
        (_, filename) => {
          if (filename && filename !== basename(this.path)) return;
          clearTimeout(this.reloadTimer);
          this.reloadTimer = setTimeout(() => void this.reload(), 100);
        },
      );
      this.watcher.on("error", () => this.watcher?.close());
    } catch {
      // Headless cores may have no Herdr App directory.
    }
  }

  stop(): void {
    this.generation++;
    this.watcher?.close();
    clearTimeout(this.reloadTimer);
  }

  private async reload(): Promise<void> {
    const generation = ++this.generation;
    try {
      const input = await readFile(this.path, "utf8");
      if (generation === this.generation)
        this.source = windowMap(readUsageMember(input));
    } catch {
      if (generation === this.generation) this.source.clear();
    }
  }

  observeScreen(employee: Employee, screen: string, at: number): void {
    const provider = providerFor(employee.agent);
    if (!provider) return;
    const key = `${employee.machineId}/${provider}`;
    const detected = detectScreenUsage(screen, at, this.timeZone);
    const reports = this.screen.get(key) ?? new Map<string, EmployeeUsage>();
    if (detected) {
      const previous = reports.get(employee.address);
      // Keep the original estimate when the same countdown remains on screen.
      if (
        !previous ||
        previous.resetAt === null ||
        detected.resetAt === null ||
        Math.abs(previous.resetAt - detected.resetAt) > 5 * minute
      ) {
        reports.set(employee.address, detected);
      }
    } else if (
      employee.status === "working" ||
      employee.status === "done" ||
      employee.status === "idle"
    ) {
      reports.delete(employee.address);
    }
    if (reports.size) this.screen.set(key, reports);
    else this.screen.delete(key);
  }

  usageFor(employee: Employee, at: number): EmployeeUsage {
    const provider = providerFor(employee.agent);
    if (!provider) return noUsage;
    const active = (window: { resetAt: number | null }) =>
      window.resetAt === null || window.resetAt > at;
    const local = employee.machineId === "local" && this.source.get(provider);
    const direct = local ? summarize(local.filter(active)) : undefined;
    if (direct) return direct;
    const screen = this.screen.get(`${employee.machineId}/${provider}`);
    return (
      summarize(
        [...(screen?.values() ?? [])]
          .filter(active)
          .map(({ resetAt }) => ({ resetAt, usedPct: 100 })),
      ) ?? noUsage
    );
  }
}
