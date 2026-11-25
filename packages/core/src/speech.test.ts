import { expect, it } from "vitest";
import { classifyIntent, statusLine, toSpeech } from "./speech.ts";

it.each([
  ["[사무실 배치] 1단계 작업 지시", "instruction"],
  ["새 메뉴를 구현해 주세요", "instruction"],
  ["[테스트] 구현 완료했습니다", "report"],
  ["이 동작을 재현할 수 있을까요?", "question"],
  ["설치에서 막혔어요", "blocked"],
  ["[PR #14] 검토 부탁드립니다", "review"],
  ["[조직도] 수정 요청 2건", "revision"],
  ["승인합니다. 계속 진행해 주세요", "approval"],
  ["좋은 아침입니다!", "greeting"],
  ["Deployment failed with error", "blocked"],
])("classifies %s", (body, expected) =>
  expect(classifyIntent(body)).toBe(expected),
);

it("uses a sanitized topic only above status exposure and provides status reactions", () => {
  const message = {
    from: "t1",
    to: "t2",
    at: 123,
    body: "[사무실 배치] 검토 부탁드립니다. TOKEN=example",
  };
  expect(toSpeech(message, { exposure: "messages" })).toMatchObject({
    intent: "review",
    topic: "사무실 배치",
  });
  const status = toSpeech(message, {
    exposure: "status",
    recipientRole: "lead",
  });
  expect(status.topic).toBeNull();
  expect(status.line).toContain("팀장님");
  expect(status.line).not.toContain("사무실 배치");
  expect(
    toSpeech(
      { ...message, body: "[TOKEN=example] 구현" },
      { exposure: "messages" },
    ).line,
  ).not.toContain("example");
  expect(statusLine("done")).toBe("끝!");
});
