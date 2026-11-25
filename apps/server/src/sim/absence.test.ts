import { expect, it } from "vitest";
import {
  classifyAbsence,
  defaultAbsenceThresholds as limits,
} from "./absence.ts";

it.each([
  [0, "powerNap"],
  [limits.napMs - 1, "powerNap"],
  [limits.napMs, "sleep"],
  [limits.sleepMs - 1, "sleep"],
  [limits.sleepMs, "earlyLeave"],
  [limits.leaveMs - 1, "earlyLeave"],
  [limits.leaveMs, "vacation"],
  [limits.leaveMs * 4, "vacation"],
])("selects the absence at %i ms", (duration, expected) => {
  expect(classifyAbsence(duration)).toBe(expected);
});

it("allows installation-specific thresholds", () => {
  expect(classifyAbsence(12, { napMs: 5, sleepMs: 10, leaveMs: 15 })).toBe(
    "earlyLeave",
  );
});
