import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Employee } from "@herdr-office/core";
import { expect, it, vi } from "vitest";
import { detectScreenUsage, readUsageMember, UsageMonitor } from "./usage.ts";

const time = Date.parse("2026-01-08T13:00:00+09:00");
const employee = (machineId: string, address: string): Employee => ({
  machineId,
  address,
  status: "blocked",
  agent: "codex",
  name: null,
  cwd: "/workspace",
  parent: null,
  labels: {},
  turn: 1,
  title: "",
  spaceId: "example",
});

it("extracts only the top-level usage member even if its name appears in nested objects", () => {
  const raw =
    '{"other":{"usage-bar.snapshot":"ignore","quote":"}\\""},"usage-bar.snapshot":{"codex":{"windows":[]}}}';
  expect(readUsageMember(raw)).toEqual({ codex: { windows: [] } });
  expect(
    readUsageMember('{"other":{"usage-bar.snapshot":"ignore"}}'),
  ).toBeNull();
});

it("detects terminal limits and understands relative and company-local reset times", () => {
  expect(
    detectScreenUsage(
      "Usage limit reached. Resets in 1h 20m.",
      time,
      "Asia/Seoul",
    ),
  ).toEqual({
    usedPct: 100,
    exhausted: true,
    resetAt: time + 80 * 60_000,
  });
  expect(
    detectScreenUsage(
      "You've hit your usage limit. Resets at 3:30pm",
      time,
      "Asia/Seoul",
    )?.resetAt,
  ).toBe(time + 150 * 60_000);
  expect(
    detectScreenUsage(
      "❯ What does it mean if the usage limit was reached?",
      time,
      "Asia/Seoul",
    ),
  ).toBeUndefined();
});

it("aggregates local windows by latest exhausted reset and shares screen fallback only by machine and provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "herdr-usage-"));
  const file = join(dir, "shared.json");
  const hour = 3_600_000;
  writeFileSync(
    file,
    JSON.stringify({
      "usage-bar.snapshot": {
        codex: {
          windows: [
            { used: 100, reset: (time + hour) / 1000 },
            { used: 100, reset: new Date(time + 2 * hour).toISOString() },
            { used: 70, reset: time + 12 * hour },
          ],
        },
      },
    }),
  );
  const monitor = new UsageMonitor("Asia/Seoul", file);
  monitor.start();
  try {
    await vi.waitFor(() =>
      expect(monitor.usageFor(employee("local", "t1"), time)).toEqual({
        usedPct: 100,
        exhausted: true,
        resetAt: time + 2 * hour,
      }),
    );
    monitor.observeScreen(
      employee("remote", "remote/t1"),
      "Usage limit exceeded; resets in 2h",
      time,
    );
    expect(
      monitor.usageFor(employee("remote", "remote/t2"), time).exhausted,
    ).toBe(true);
    expect(
      monitor.usageFor(employee("another", "another/t2"), time).exhausted,
    ).toBe(false);
    expect(
      monitor.usageFor(employee("remote", "remote/t2"), time + 3 * hour)
        .exhausted,
    ).toBe(false);
  } finally {
    monitor.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
