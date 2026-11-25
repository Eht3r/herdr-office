import { hashSeed } from "./identity.ts";
import { redact } from "./redact.ts";
import type { OfficeMessage } from "./types.ts";

export type SpeechIntent =
  | "instruction"
  | "report"
  | "question"
  | "blocked"
  | "review"
  | "revision"
  | "approval"
  | "greeting";
export type SpeechExposure = "status" | "title" | "messages" | "raw";

const rules: [SpeechIntent, RegExp][] = [
  [
    "blocked",
    /막혔|막힘|차단|오류|실패|사용량.*소진|unavailable|blocked|\berror\b|\bfailed\b/iu,
  ],
  [
    "revision",
    /수정\s*(?:요청|부탁|해\s*주|해\s*줘)|보완\s*(?:요청|해\s*주|해\s*줘)|\b(?:please fix|revise|changes requested)\b/iu,
  ],
  [
    "review",
    /(?:리뷰|검토|review)\s*(?:요청|부탁|해\s*주|해\s*줘|please|request)|\b(?:please review|review request|take a look)\b/iu,
  ],
  [
    "approval",
    /승인(?:합니다|했|함|\.|\s|$)|진행\s*해도|리뷰\s*통과|\b(?:approved|go ahead|lgtm)\b/iu,
  ],
  [
    "report",
    /완료|끝냈|마쳤|테스트.{0,16}통과|보고드립니다|\b(?:done|completed|finished|passed)\b/iu,
  ],
  [
    "question",
    /[?？]|궁금|어떻게|알\s*수\s*있|\b(?:how|why|which|could you tell)\b/iu,
  ],
  [
    "instruction",
    /작업\s*지시|추가\s*요구|구현|부탁|진행|만들어|실행|확인해|\b(?:implement|please add|run|task|build)\b/iu,
  ],
];

export function classifyIntent(body: string): SpeechIntent {
  const first = body.trim().split(/\r?\n/u)[0] ?? "";
  return (
    rules.find(([, pattern]) => pattern.test(first))?.[0] ??
    rules.find(([, pattern]) => pattern.test(body))?.[0] ??
    "greeting"
  );
}

const lines: Record<SpeechIntent, [string, string]> = {
  instruction: ["이 일 좀 맡아줄래요?", "부탁할 일이 하나 있어요."],
  report: ["다 됐어요. 한번 봐주세요!", "작업 끝냈어요!"],
  question: ["잠깐 물어봐도 될까요?", "같이 확인해 줄 수 있어요?"],
  blocked: ["여기서 막혔어요. 같이 봐줄래요?", "이 부분에서 도움이 필요해요."],
  review: ["잠깐 검토 부탁해요.", "시간 될 때 한번 봐줄래요?"],
  revision: ["이 부분 조금만 고쳐줄래요?", "수정할 부분이 하나 있어요."],
  approval: ["좋아요. 그 방향으로 가요.", "확인했어요. 계속 진행해 주세요."],
  greeting: ["잠깐 이야기 좀 해요.", "안녕하세요!"],
};

function extractTopic(body: string): string {
  const first = redact(body).trim().split(/\r?\n/u)[0] ?? "";
  const topic =
    first.match(/\[([^\]]{2,})\]/u)?.[1] ??
    first.match(/(?:\bPR\s*#\d+|\b[\w-]+\.(?:tsx?|md|json|css)\b)/iu)?.[0] ??
    first;
  return [
    ...topic
      .replace(/[<>\p{Cc}]/gu, "")
      .replace(/\s+/gu, " ")
      .trim(),
  ]
    .slice(0, 20)
    .join("");
}

export function toSpeech(
  message: OfficeMessage,
  options: {
    exposure: SpeechExposure;
    recipientRole?: string;
  },
): { intent: SpeechIntent; topic: string | null; line: string } {
  const intent = classifyIntent(message.body);
  const topic =
    options.exposure === "status" ? null : extractTopic(message.body) || null;
  const line =
    lines[intent][hashSeed(`${message.from} ${message.to} ${message.at}`) % 2];
  const address = options.recipientRole === "lead" ? "팀장님, " : "";
  return {
    intent,
    topic,
    line: `${address}${topic ? `‘${topic}’ 건인데요. ` : ""}${line}`,
  };
}

export function statusLine(status: string | null): string {
  switch (status) {
    case "working":
      return "자, 시작해볼까.";
    case "blocked":
      return "음… 이거 왜 안 되지?";
    case "done":
      return "끝!";
    case "error":
      return "잠깐, 뭔가 잘못됐네.";
    default:
      return "";
  }
}
