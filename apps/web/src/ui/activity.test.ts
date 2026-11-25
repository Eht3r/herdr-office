import type { Action, Timeline } from "@herdr-office/core";
import { describe, expect, it } from "vitest";
import { activityOf, isTownPlace, notesOf } from "./activity.ts";

const action = (over: Partial<Action>): Action => ({
  id: "a1",
  employeeId: "b/t1",
  kind: "break",
  from: { kind: "convenienceStore" },
  to: { kind: "convenienceStore" },
  startAt: 1000,
  durationMs: 1000,
  props: {},
  line: "편의점 잠깐 들렀다 올게요.",
  ...over,
});

const timeline = (
  actions: Action[],
  extra: Partial<Timeline> = {},
): Timeline => ({
  at: 0,
  today: null,
  usage: {},
  actions,
  ...extra,
});

describe("employee activity", () => {
  it("says where an employee who left the desk is", () => {
    const now = activityOf(timeline([action({})]), "b/t1", 1500);
    expect(now.doing).toContain("편의점");
    expect(now.place && isTownPlace(now.place)).toBe(true);
  });

  it("describes a walk as heading somewhere", () => {
    const walk = action({
      kind: "move",
      from: { kind: "desk" },
      to: { kind: "kitchenette" },
      line: "",
    });
    expect(activityOf(timeline([walk]), "b/t1", 1500).doing).toBe(
      "탕비실(으)로 가는 중",
    );
  });

  it("falls back to the last known position between actions", () => {
    const idle = timeline([], { positions: { "b/t1": { kind: "desk" } } });
    expect(activityOf(idle, "b/t1", 5000).doing).toBe("자기 자리에 있음");
  });

  it("reads the notes waiting on a desk", () => {
    const note = { fromId: "b/t2", line: "확인 부탁드려요", at: 10 };
    const inbox = timeline([], {
      notesByEmployee: { "b/t1": 1 },
      inboxByEmployee: { "b/t1": [note] },
    });
    expect(notesOf(inbox, "b/t1")).toEqual({ count: 1, notes: [note] });
  });
});
