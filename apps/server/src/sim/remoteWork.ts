import type { Importance } from "@herdr-office/core";
import type { WorkDay } from "../calendar.ts";
import type { EmployeeState } from "./employeeState.ts";
import { atHome } from "./movement.ts";

export type RemoteWorkPolicy = "none" | "afterHours";

export function plannedRemote(
  policy: RemoteWorkPolicy,
  employee: EmployeeState,
  day: WorkDay,
  importance: Importance,
): boolean {
  return (
    policy === "afterHours" &&
    !day.workingHours &&
    importance === "normal" &&
    (atHome(employee) ||
      Boolean(employee.remoteActive && employee.position.kind === "park"))
  );
}
