import {
  classifyImportance,
  type Employee,
  highestImportance,
  type Importance,
  type SpeechIntent,
} from "@herdr-office/core";
import type { EmployeeState } from "./employeeState.ts";

const day = 86_400_000;
const batchWindow = 2 * 60_000;

export function applyTaskSignal(input: {
  sender: EmployeeState;
  recipient: EmployeeState;
  states: Map<string, EmployeeState>;
  senderIsLead: boolean;
  infrastructure: boolean;
  intent: SpeechIntent;
  body: string;
  at: number;
}): void {
  const {
    sender,
    recipient,
    states,
    senderIsLead,
    infrastructure,
    intent,
    body,
    at,
  } = input;
  if (intent === "revision") {
    recipient.revisionSignals = [
      ...(recipient.revisionSignals ?? [])
        .filter((time) => at - time < day)
        .slice(-7),
      at,
    ];
  }
  const directly = classifyImportance({
    text: body,
    senderSpaceId: sender.spaceId,
    recipientSpaceId: recipient.spaceId,
    fromInfrastructure: infrastructure,
    revisionCount: recipient.revisionSignals?.length,
  });
  markPriority(recipient, directly, at);
  if (
    !senderIsLead ||
    intent !== "instruction" ||
    sender.spaceId !== recipient.spaceId
  )
    return;
  sender.dispatches = [
    ...(sender.dispatches ?? [])
      .filter(
        (entry) =>
          at - entry.at <= batchWindow && entry.recipientId !== recipient.id,
      )
      .slice(-11),
    { recipientId: recipient.id, at },
  ];
  if (sender.dispatches.length < 2) return;
  for (const { recipientId } of sender.dispatches) {
    const colleague = states.get(recipientId);
    if (colleague?.present) markPriority(colleague, "important", at);
  }
}

function markPriority(
  state: EmployeeState,
  priority: Importance,
  at: number,
): void {
  if (priority === "normal") return;
  const current =
    state.priority && at - state.priority.at < day
      ? state.priority.value
      : "normal";
  state.priority = { value: highestImportance(current, priority), at };
}

export function taskImportance(
  state: EmployeeState,
  employee: Employee,
  at: number,
): Importance {
  const received =
    state.priority && at - state.priority.at < day
      ? state.priority.value
      : "normal";
  return highestImportance(
    received,
    classifyImportance({
      text:
        employee.status === "working" || employee.status === "blocked"
          ? employee.title
          : "",
      blockedMs: employee.status === "blocked" ? at - state.statusSince : 0,
      revisionCount: state.revisionSignals?.filter((time) => at - time < day)
        .length,
    }),
  );
}
