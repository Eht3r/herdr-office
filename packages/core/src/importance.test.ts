import { expect, it } from "vitest";
import {
  classifyImportance,
  type Importance,
  type ImportanceInput,
} from "./importance.ts";

it.each<[ImportanceInput, Importance]>([
  [{ text: "내일 안건을 확인했습니다." }, "normal"],
  [{ text: "P0 장애 hotfix 후 rollback 검토" }, "urgent"],
  [{ text: "QA FAIL 결과를 확인해주세요." }, "important"],
  [
    {
      text: "외부와 협업 요청",
      senderSpaceId: "alpha",
      recipientSpaceId: "beta",
    },
    "important",
  ],
  [{ text: "원인 검토 부탁드립니다", fromInfrastructure: true }, "important"],
  [{ text: "수정 요청", revisionCount: 2 }, "important"],
  [{ blockedMs: 15 * 60_000 }, "important"],
  [{ simultaneousInstructions: 2 }, "important"],
  [{ text: "긴급 장애", userPriority: "normal" }, "normal"],
  [{ text: "일반 업무", userPriority: "urgent" }, "urgent"],
])("classifies importance for %j", (input, expected) => {
  expect(classifyImportance(input)).toBe(expected);
});
