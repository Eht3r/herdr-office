import type { AbsenceKind } from "@herdr-office/core";

export interface AbsenceThresholds {
  napMs: number;
  sleepMs: number;
  leaveMs: number;
}

export const defaultAbsenceThresholds: AbsenceThresholds = {
  napMs: 30 * 60_000,
  sleepMs: 5 * 3_600_000,
  leaveMs: 24 * 3_600_000,
};

export function classifyAbsence(
  remainingMs: number,
  thresholds = defaultAbsenceThresholds,
): AbsenceKind {
  if (remainingMs < thresholds.napMs) return "powerNap";
  if (remainingMs < thresholds.sleepMs) return "sleep";
  if (remainingMs < thresholds.leaveMs) return "earlyLeave";
  return "vacation";
}
