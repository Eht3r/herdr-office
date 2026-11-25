import {
  type Employee,
  providerFor,
  seededEmployeeName,
} from "@herdr-office/core";

export function employeeRole(employee: Employee, lead = false): string {
  if (lead) return "팀장";
  const role =
    employee.labels["team.role"] ??
    Object.entries(employee.labels).find(([key]) => key.endsWith(".role"))?.[1];
  if (role === "dev") return "개발";
  if (role === "assist") return "어시스트";
  if (role === "engineer") return "엔지니어";
  if (role) return role;
  return employee.agent ? "팀원" : "셸";
}

export function employeeName(employee: Employee): string {
  return (
    employee.name || seededEmployeeName(employee.spaceId, employee.address)
  );
}

export function employeeProvider(
  employee: Employee,
): "claude" | "codex" | "cursor" | "other" {
  return providerFor(employee.agent) ?? "other";
}

export function employeeStatus(employee: Employee): string {
  switch (employee.status) {
    case "working":
      return "작업 중";
    case "blocked":
      return "확인 필요";
    case "done":
      return "완료";
    case "idle":
      return "대기";
    case "error":
      return "오류";
    default:
      return "상태 없음";
  }
}
