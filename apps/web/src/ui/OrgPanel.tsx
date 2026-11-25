import type {
  Building,
  Department,
  Employee,
  Organization,
} from "@herdr-office/core";
import { useEffect, useState } from "react";
import { departmentKey, groupKey } from "../layout/campusLayout.ts";
import type { Focus } from "../scene/Campus.tsx";
import { useOffice } from "../state/officeStore.ts";
import { activityOf, isTownPlace, notesOf } from "./activity.ts";
import {
  employeeName,
  employeeProvider,
  employeeRole,
  employeeStatus,
} from "./employee.ts";
import { PlacementEditor } from "./PlacementEditor.tsx";

interface OrgActions {
  /** The owner may edit settings; public visitors only watch. */
  owner: boolean;
  sites: string[];
  focus: Focus;
  selected: string | null;
  onBuilding: (id: string) => void;
  onOffice: (buildingId: string, key: string) => void;
  onEmployee: (buildingId: string, address: string) => void;
}

export interface SelectedEmployee {
  employee: Employee;
  department: Department;
}

function DepartmentRow({
  department,
  buildingId,
  actions,
}: {
  department: Department;
  buildingId: string;
  actions: OrgActions;
}) {
  const key = departmentKey(department.id);
  const focused = actions.focus.kind === "office" && actions.focus.key === key;
  return (
    <li>
      <button
        type="button"
        className="team-row"
        aria-pressed={focused}
        onClick={() => actions.onOffice(buildingId, key)}
      >
        <span className="room-mark" aria-hidden="true" />
        <span>{department.name}</span>
        <span className="member-count">
          {department.vacantSince === null
            ? department.employees.length
            : "빈 사무실"}
        </span>
      </button>
      {department.employees.length > 0 && (
        <ul className="team-members">
          {department.employees.map((employee) => {
            const leader = employee.address === department.leadAddress;
            return (
              <li key={employee.address}>
                <button
                  type="button"
                  className="member-row"
                  aria-pressed={actions.selected === employee.address}
                  onClick={() =>
                    actions.onEmployee(buildingId, employee.address)
                  }
                >
                  <span
                    className="provider-mark"
                    data-provider={employeeProvider(employee)}
                    aria-hidden="true"
                  />
                  <span>{employeeName(employee)}</span>
                  <span className="member-role">
                    {employeeRole(employee, leader)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {department.departments.length > 0 && (
        <ul className="org-children">
          {department.departments.map((child) => (
            <DepartmentRow
              key={child.id}
              department={child}
              buildingId={buildingId}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function BuildingTree({
  building,
  actions,
}: {
  building: Building;
  actions: OrgActions;
}) {
  const [editing, setEditing] = useState(false);
  const site = building.site ?? building.name;
  return (
    <li className="building-tree">
      <div className="building-heading">
        <button
          className="building-row"
          type="button"
          aria-pressed={
            actions.focus.kind === "building" &&
            actions.focus.id === building.id
          }
          onClick={() => actions.onBuilding(building.id)}
        >
          <span className="building-mark" aria-hidden="true" />
          <span>
            <strong>{site}</strong>
            {building.roomName && (
              <span className="building-room"> · {building.roomName}</span>
            )}
          </span>
        </button>
        {actions.owner && !editing && (
          <button
            className="building-edit"
            type="button"
            aria-label={`${site} 건물 설정`}
            onClick={() => setEditing(true)}
          >
            설정
          </button>
        )}
      </div>
      {editing && (
        <PlacementEditor
          building={building}
          sites={actions.sites}
          onDone={() => setEditing(false)}
        />
      )}
      <ul className="building-children">
        {building.departments.map((department) => (
          <DepartmentRow
            key={department.id}
            department={department}
            buildingId={building.id}
            actions={actions}
          />
        ))}
        {building.groups.map((group) => {
          const key = groupKey(building.id, group.id);
          return (
            <li key={key}>
              <button
                className="team-row"
                type="button"
                aria-pressed={
                  actions.focus.kind === "office" && actions.focus.key === key
                }
                onClick={() => actions.onOffice(building.id, key)}
              >
                <span className="room-mark" aria-hidden="true" />
                <span>{group.name}</span>
                <span className="member-count">그룹</span>
              </button>
              <ul className="org-children">
                {group.departments.map((department) => (
                  <DepartmentRow
                    key={department.id}
                    department={department}
                    buildingId={building.id}
                    actions={actions}
                  />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** Re-render every few seconds so "what they are doing now" stays current. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function AgentCard({
  selected,
  nameOf,
  onClose,
  onLocate,
}: {
  selected: SelectedEmployee;
  nameOf: (address: string) => string;
  onClose: () => void;
  onLocate: (buildingId: string | null, town: boolean) => void;
}) {
  const { employee, department } = selected;
  const timeline = useOffice((state) => state.timeline);
  const received = useOffice((state) => state.timelineReceivedAt);
  const now =
    useNow(2000) + (timeline && received ? timeline.at - received : 0);
  const activity = activityOf(timeline, employee.address, now);
  const inbox = notesOf(timeline, employee.address);
  return (
    <section className="agent-card" aria-labelledby="agent-heading">
      <div className="agent-card-top">
        <div
          className="agent-avatar"
          data-provider={employeeProvider(employee)}
          aria-hidden="true"
        >
          {employeeName(employee).slice(0, 2)}
        </div>
        <div className="agent-identity">
          <h3 id="agent-heading">{employeeName(employee)}</h3>
          <p>
            {department.name} /{" "}
            {employeeRole(
              employee,
              department.leadAddress === employee.address,
            )}
          </p>
        </div>
        <button
          type="button"
          className="close-detail"
          aria-label="직원 카드 닫기"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <dl className="agent-fields">
        <div>
          <dt>상태</dt>
          <dd data-state={employee.status ?? "unknown"}>
            {employeeStatus(employee)}
          </dd>
        </div>
        <div>
          <dt>터미널</dt>
          <dd>{employee.address.split("/").at(-1)}</dd>
        </div>
        <div>
          <dt>작업 제목</dt>
          <dd>{employee.title || "제목 없음"}</dd>
        </div>
        <div>
          <dt>지금</dt>
          <dd>{activity.doing}</dd>
        </div>
      </dl>
      {activity.place && (
        <button
          type="button"
          className="locate-button"
          onClick={() =>
            onLocate(
              activity.place?.buildingId ?? null,
              activity.place ? isTownPlace(activity.place) : false,
            )
          }
        >
          지금 있는 곳 보기
        </button>
      )}
      {inbox.count > 0 && (
        <section className="note-list" aria-label="받은 쪽지">
          <h4>책상 위 쪽지 {inbox.count}개</h4>
          {inbox.notes.length ? (
            <ul>
              {[...inbox.notes].reverse().map((note) => (
                <li key={`${note.fromId}:${note.at}`}>
                  <strong>{nameOf(note.fromId)}</strong>
                  <time dateTime={new Date(note.at).toISOString()}>
                    {new Intl.DateTimeFormat("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(note.at)}
                  </time>
                  <p>{note.line || "(내용 비공개)"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note-hidden">쪽지 내용은 소유자만 볼 수 있습니다.</p>
          )}
        </section>
      )}
    </section>
  );
}

export function OrgPanel({
  open,
  organization,
  actions,
  loading,
  selected,
  onClose,
  onLocate,
}: {
  open: boolean;
  organization: Organization;
  actions: OrgActions;
  loading: boolean;
  selected: SelectedEmployee | undefined;
  onClose: () => void;
  onLocate: (buildingId: string | null, town: boolean) => void;
}) {
  return (
    <aside
      id="org-panel"
      className="org-panel"
      data-open={open}
      aria-labelledby="org-heading"
    >
      <div className="panel-heading">
        <h2 id="org-heading">조직도</h2>
        {!loading && <span>{buildingCount(organization)}</span>}
      </div>
      {selected && (
        <AgentCard
          selected={selected}
          nameOf={(address) => nameOf(organization, address)}
          onClose={onClose}
          onLocate={onLocate}
        />
      )}
      {loading ? (
        <p className="panel-empty" role="status">
          조직도를 불러오는 중입니다.
        </p>
      ) : organization.buildings.length ? (
        <ul className="org-list">
          {organization.buildings.map((building) => (
            <BuildingTree
              key={building.id}
              building={building}
              actions={actions}
            />
          ))}
        </ul>
      ) : (
        <p className="panel-empty">연결된 건물이 없습니다.</p>
      )}
    </aside>
  );
}

/** "2개 건물", or "1개 건물 · 공간 2개" when machines share a building. */
export function buildingCount(organization: Organization): string {
  const rooms = organization.buildings.length;
  const sites = new Set(
    organization.buildings.map((building) => building.site ?? building.name),
  ).size;
  return sites === rooms
    ? `${sites}개 건물`
    : `${sites}개 건물 · 공간 ${rooms}개`;
}

function nameOf(organization: Organization, address: string): string {
  const walk = (departments: Department[]): string | null => {
    for (const department of departments) {
      const found = department.employees.find((e) => e.address === address);
      if (found) return employeeName(found);
      const nested = walk(department.departments);
      if (nested) return nested;
    }
    return null;
  };
  for (const building of organization.buildings) {
    const found = walk([
      ...building.departments,
      ...building.groups.flatMap(({ departments }) => departments),
    ]);
    if (found) return found;
  }
  return "동료";
}
