import { classifyIntent } from "./speech.ts";

export const importanceLevels = ["normal", "important", "urgent"] as const;
export type Importance = (typeof importanceLevels)[number];

export interface ImportanceInput {
  text?: string;
  userPriority?: Importance;
  senderSpaceId?: string;
  recipientSpaceId?: string;
  fromInfrastructure?: boolean;
  revisionCount?: number;
  blockedMs?: number;
  simultaneousInstructions?: number;
}

export function classifyImportance(input: ImportanceInput): Importance {
  if (input.userPriority) return input.userPriority;
  const { text = "" } = input;
  if (
    /긴급|장애|서비스.{0,8}중단|\b(?:urgent|outage|hotfix|rollback|p0)\b/iu.test(
      text,
    )
  )
    return "urgent";
  const intent = classifyIntent(text);
  const request =
    ["instruction", "question", "review", "revision"].includes(intent) ||
    /요청|협업|\b(?:request|help)\b/iu.test(text);
  const crossTeam =
    input.senderSpaceId &&
    input.recipientSpaceId &&
    input.senderSpaceId !== input.recipientSpaceId;
  if (
    /보안|운영|배포|\b(?:security|production|deploy(?:ment)?|p1|qa\s+fail(?:ed)?)\b/iu.test(
      text,
    ) ||
    (request && (crossTeam || input.fromInfrastructure)) ||
    (input.revisionCount ?? 0) >= 2 ||
    (input.blockedMs ?? 0) >= 15 * 60_000 ||
    (input.simultaneousInstructions ?? 0) >= 2
  )
    return "important";
  return "normal";
}

export function highestImportance(...priorities: Importance[]): Importance {
  return importanceLevels[
    Math.max(
      0,
      ...priorities.map((priority) => importanceLevels.indexOf(priority)),
    )
  ];
}
