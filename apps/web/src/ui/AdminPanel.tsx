import {
  type Building,
  type Department,
  type ExposureLevel,
  exposureLevels,
  type Group,
  type HierarchyOverride,
  type HoursRule,
  type OfficeSettings,
  type Organization,
} from "@herdr-office/core";
import {
  cloneElement,
  type FormEvent,
  type ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { PlacementEditor } from "./PlacementEditor.tsx";

const sections = [
  ["company", "회사"],
  ["work", "근무"],
  ["org", "조직"],
  ["sharing", "공개"],
  ["security", "보안"],
] as const;
type Tab = (typeof sections)[number][0];
type Team = { id: string; name: string; site: string; machine: string };

const levels: Record<ExposureLevel, string> = {
  hidden: "숨김",
  status: "상태",
  title: "제목",
  messages: "메시지",
  raw: "원문",
};

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      result.message ?? `요청에 실패했습니다 (${response.status}).`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="admin-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id })}
    </div>
  );
}

function CompanyFields({
  value,
  change,
}: {
  value: OfficeSettings["company"];
  change: (value: OfficeSettings["company"]) => void;
}) {
  return (
    <div className="admin-grid">
      <Field label="회사 이름">
        <input
          required
          maxLength={100}
          value={value.name}
          onChange={(event) => change({ ...value, name: event.target.value })}
        />
      </Field>
      <Field label="시간대">
        <input
          required
          placeholder="Asia/Seoul"
          value={value.timeZone}
          onChange={(event) =>
            change({ ...value, timeZone: event.target.value })
          }
        />
      </Field>
      <Field label="위도">
        <input
          required
          type="number"
          step="any"
          min={-90}
          max={90}
          defaultValue={value.latitude}
          onChange={(event) =>
            change({ ...value, latitude: event.target.valueAsNumber })
          }
        />
      </Field>
      <Field label="경도">
        <input
          required
          type="number"
          step="any"
          min={-180}
          max={180}
          defaultValue={value.longitude}
          onChange={(event) =>
            change({ ...value, longitude: event.target.valueAsNumber })
          }
        />
      </Field>
      <Field label="국가 코드">
        <input
          required
          pattern="[A-Za-z]{2}"
          maxLength={2}
          placeholder="KR"
          value={value.country}
          onChange={(event) =>
            change({ ...value, country: event.target.value.toUpperCase() })
          }
        />
      </Field>
    </div>
  );
}

const week = [
  [1, "월요일"],
  [2, "화요일"],
  [3, "수요일"],
  [4, "목요일"],
  [5, "금요일"],
  [6, "토요일"],
  [0, "일요일"],
] as const;
const asTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function DayHours({
  day,
  label,
  rule,
  change,
  team,
}: {
  day: number;
  label: string;
  rule: HoursRule;
  change: (rule: HoursRule) => void;
  team: boolean;
}) {
  const range = rule[day];
  const mode = range === null ? "off" : range ? "hours" : "inherit";
  const [start, end] = range ?? [540, 1080];
  const minutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  return (
    <div className="admin-hours-row">
      <span>{label}</span>
      <select
        aria-label={`${label} 일정`}
        value={mode}
        onChange={(event) => {
          const next = { ...rule };
          if (event.target.value === "inherit") delete next[day];
          else next[day] = event.target.value === "off" ? null : [start, end];
          change(next);
        }}
      >
        <option value="inherit">
          {team ? "회사 설정 따르기" : "기본/학습 적용"}
        </option>
        <option value="off">휴무</option>
        <option value="hours">근무</option>
      </select>
      {mode === "hours" && (
        <>
          <input
            aria-label={`${label} 시작`}
            required
            pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
            defaultValue={asTime(start)}
            onChange={(event) => {
              if (event.currentTarget.validity.valid)
                change({ ...rule, [day]: [minutes(event.target.value), end] });
            }}
          />
          <input
            aria-label={`${label} 종료`}
            required
            pattern="(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00)"
            defaultValue={asTime(end)}
            onChange={(event) => {
              if (event.currentTarget.validity.valid)
                change({
                  ...rule,
                  [day]: [start, minutes(event.target.value)],
                });
            }}
          />
        </>
      )}
    </div>
  );
}

function TeamPicker({
  teams,
  team,
  select,
  label = "팀",
}: {
  teams: Team[];
  team: string;
  select: (id: string) => void;
  label?: string;
}) {
  return (
    <Field label={label}>
      <select value={team} onChange={(event) => select(event.target.value)}>
        <option value="">팀 선택</option>
        {teams.map(({ id, name, site }) => (
          <option key={id} value={id}>
            {name} · {site}
          </option>
        ))}
      </select>
    </Field>
  );
}

function WorkFields({
  value,
  change,
  teams,
}: {
  value: OfficeSettings["work"];
  change: (value: OfficeSettings["work"]) => void;
  teams: Team[];
}) {
  const [team, setTeam] = useState("");
  return (
    <>
      <div className="admin-grid">
        <Field label="재택 정책">
          <select
            value={value.remoteWork}
            onChange={(event) =>
              change({
                ...value,
                remoteWork:
                  event.target.value === "none" ? "none" : "afterHours",
              })
            }
          >
            <option value="none">없음</option>
            <option value="afterHours">근무시간 외</option>
          </select>
        </Field>
        <div className="admin-checks">
          <label>
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(event) =>
                change({ ...value, enabled: event.target.checked })
              }
            />{" "}
            근무시간 적용
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.learn}
              onChange={(event) =>
                change({ ...value, learn: event.target.checked })
              }
            />{" "}
            근무시간 자동 학습
          </label>
        </div>
      </div>
      <fieldset className="admin-section">
        <legend>회사 근무시간</legend>
        {week.map(([day, label]) => (
          <DayHours
            key={day}
            day={day}
            label={label}
            rule={value.company}
            change={(company) => change({ ...value, company })}
            team={false}
          />
        ))}
      </fieldset>
      <fieldset className="admin-section">
        <legend>팀별 근무시간</legend>
        <TeamPicker teams={teams} team={team} select={setTeam} />
        {team &&
          week.map(([day, label]) => (
            <DayHours
              key={`${team}-${day}`}
              day={day}
              label={label}
              rule={value.teams[team] ?? {}}
              change={(rule) =>
                change({ ...value, teams: { ...value.teams, [team]: rule } })
              }
              team
            />
          ))}
      </fieldset>
      <fieldset className="admin-section admin-grid">
        <legend>사용량 소진 시 부재 기준</legend>
        {(
          [
            ["nap", "쪽잠"],
            ["sleep", "수면"],
            ["leave", "조기퇴근"],
          ] as const
        ).map(([key, title]) => (
          <Field key={key} label={`${title} (분)`}>
            <input
              required
              type="number"
              min={1}
              max={10080}
              step="any"
              value={
                Number.isFinite(value.absence[key]) ? value.absence[key] : ""
              }
              onChange={(event) =>
                change({
                  ...value,
                  absence: {
                    ...value.absence,
                    [key]: event.target.valueAsNumber,
                  },
                })
              }
            />
          </Field>
        ))}
      </fieldset>
    </>
  );
}

function ExposurePicker({
  label,
  value,
  change,
  inherit = false,
}: {
  label: string;
  value: ExposureLevel | "";
  change: (level: ExposureLevel | "") => void;
  inherit?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(event) =>
          change(
            exposureLevels.find((level) => level === event.target.value) ?? "",
          )
        }
      >
        {inherit && <option value="">기본 단계 따르기</option>}
        {exposureLevels.map((level) => (
          <option key={level} value={level}>
            {levels[level]}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SharingFields({
  value,
  change,
  teams,
}: {
  value: OfficeSettings["sharing"];
  change: (value: OfficeSettings["sharing"]) => void;
  teams: Team[];
}) {
  const [team, setTeam] = useState("");
  const update = (audience: "owner" | "public", level: ExposureLevel | "") => {
    const rule = { ...value.teams[team] };
    if (level) rule[audience] = level;
    else delete rule[audience];
    change({ ...value, teams: { ...value.teams, [team]: rule } });
  };
  const preview = new URL(window.location.href);
  preview.searchParams.set("view", "public");
  return (
    <>
      <fieldset className="admin-section">
        <legend>말풍선 기본 공개 단계</legend>
        <div className="admin-grid">
          <ExposurePicker
            label="소유자"
            value={value.speech.owner}
            change={(owner) =>
              owner && change({ ...value, speech: { ...value.speech, owner } })
            }
          />
          <ExposurePicker
            label="공개 방문자"
            value={value.speech.public}
            change={(level) =>
              level &&
              change({ ...value, speech: { ...value.speech, public: level } })
            }
          />
        </div>
        <p className="admin-hint">
          공개 방문자에게 ‘숨김’인 팀은 사무실만 표시됩니다. 메시지와 원문은
          대화 내용을 공개합니다.
        </p>
      </fieldset>
      <fieldset className="admin-section">
        <legend>팀별 공개 단계</legend>
        <TeamPicker teams={teams} team={team} select={setTeam} />
        {team && (
          <div className="admin-grid">
            <ExposurePicker
              label="팀 소유자"
              value={value.teams[team]?.owner ?? ""}
              inherit
              change={(level) => update("owner", level)}
            />
            <ExposurePicker
              label="팀 공개 방문자"
              value={value.teams[team]?.public ?? ""}
              inherit
              change={(level) => update("public", level)}
            />
          </div>
        )}
      </fieldset>
      <section className="admin-section" aria-labelledby="public-help">
        <h3 id="public-help">외부에서 접속하기</h3>
        <p className="admin-hint">
          HTTPS 터널 또는 리버스 프록시로 서버를 연결하고, 방문자가 사용하는
          도메인을 보안 탭의 공개 호스트에 등록하세요. WebSocket 경로{" "}
          <code>/ws</code>도 같은 호스트로 전달해야 실시간 지도가 동작합니다.
        </p>
        <a
          className="admin-preview"
          href={preview.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          공개 방문자 시점으로 보기 ↗
        </a>
      </section>
    </>
  );
}

const securityFields = [
  ["masks", "추가 마스킹 정규식", "demo-[A-Z0-9]+"],
  ["trustedNetworks", "신뢰 네트워크", "192.168.1.0/24"],
  ["allowedHosts", "허용 호스트", "office.internal"],
  ["publicHosts", "공개 호스트", "office.example.net"],
] as const;

function SecurityFields({
  value,
  change,
}: {
  value: OfficeSettings["security"];
  change: (value: OfficeSettings["security"]) => void;
}) {
  return (
    <>
      <p className="admin-hint">
        한 줄에 하나씩 입력하세요. 공개 호스트는 읽기 전용입니다. 정규식의
        그룹·선택·역참조는 지원하지 않습니다.
      </p>
      {securityFields.map(([key, label, placeholder]) => (
        <Field key={key} label={label}>
          <textarea
            rows={3}
            spellCheck={false}
            defaultValue={value[key].join("\n")}
            placeholder={placeholder}
            onChange={(event) =>
              change({
                ...value,
                [key]: event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      ))}
    </>
  );
}

function TeamsFields({
  teams,
  buildings,
}: {
  teams: Team[];
  buildings: Building[];
}) {
  const [buildingId, setBuilding] = useState("");
  const building = buildings.find(({ id }) => id === buildingId);
  const [groups, setGroups] = useState<Group[]>([]);
  const [rules, setRules] = useState<HierarchyOverride[]>([]);
  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [parent, setParent] = useState("");
  const [child, setChild] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all([
      request<Group[]>("/api/groups", "GET", undefined, signal),
      request<HierarchyOverride[]>(
        "/api/hierarchy/overrides",
        "GET",
        undefined,
        signal,
      ),
    ])
      .then(([groups, rules]) => {
        setGroups(groups);
        setRules(rules);
      })
      .catch((error: Error) => {
        if (!signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, []);
  const selectGroup = (id: string) => {
    const chosen = groups.find((group) => group.id === id);
    setGroupId(id);
    setName(chosen?.name ?? "");
    setMembers(chosen?.spaceIds ?? []);
    setMessage("");
  };
  const perform = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await operation();
      setMessage(success);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "변경을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void perform(async () => {
      const saved = await request<Group>(
        groupId ? `/api/groups/${encodeURIComponent(groupId)}` : "/api/groups",
        groupId ? "PUT" : "POST",
        { name, spaceIds: members },
      );
      setGroups((before) => [
        ...before.filter(({ id }) => id !== saved.id),
        saved,
      ]);
      setGroupId(saved.id);
    }, "그룹을 저장했습니다.");
  };
  const parentMachine = teams.find(({ id }) => id === parent)?.machine;
  const candidates = teams.filter(
    ({ id, machine }) => id !== parent && machine === parentMachine,
  );
  const pair = candidates.some(({ id }) => id === child);
  const override = rules.find(
    ({ parentSpaceId, childSpaceId }) =>
      parentSpaceId === parent && childSpaceId === child,
  );
  const overridePath = `/api/hierarchy/overrides/${encodeURIComponent(parent)}/${encodeURIComponent(child)}`;
  return (
    <>
      <section className="admin-section">
        <h3>건물 설정</h3>
        <Field label="수정할 건물">
          <select
            value={buildingId}
            onChange={(event) => setBuilding(event.target.value)}
          >
            <option value="">건물 선택</option>
            {buildings.map(({ id, site, name, roomName }) => (
              <option key={id} value={id}>
                {site ?? name}
                {roomName ? ` · ${roomName}` : ""}
              </option>
            ))}
          </select>
        </Field>
        {building && (
          <PlacementEditor
            key={building.id}
            building={building}
            sites={[
              ...new Set(buildings.map(({ site, name }) => site ?? name)),
            ]}
            onDone={() => setBuilding("")}
          />
        )}
      </section>
      <form onSubmit={save} className="admin-section">
        <h3>그룹 관리</h3>
        <div className="admin-grid">
          <Field label="그룹">
            <select
              value={groupId}
              onChange={(event) => selectGroup(event.target.value)}
            >
              <option value="">새 그룹</option>
              {groups.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="그룹 이름">
            <input
              required
              maxLength={128}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </div>
        <fieldset className="admin-team-checks">
          <legend>포함할 팀</legend>
          {teams.map(({ id, name, site }) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={members.includes(id)}
                onChange={(event) =>
                  setMembers(
                    event.target.checked
                      ? [...members, id]
                      : members.filter((member) => id !== member),
                  )
                }
              />{" "}
              {name} · {site}
            </label>
          ))}
        </fieldset>
        <div className="admin-actions">
          <button type="submit" disabled={busy}>
            그룹 저장
          </button>
          {groupId && (
            <button
              type="button"
              disabled={busy}
              className="admin-secondary"
              onClick={() =>
                void perform(async () => {
                  await request(
                    `/api/groups/${encodeURIComponent(groupId)}`,
                    "DELETE",
                  );
                  setGroups((before) =>
                    before.filter(({ id }) => id !== groupId),
                  );
                  selectGroup("");
                }, "그룹을 삭제했습니다.")
              }
            >
              그룹 삭제
            </button>
          )}
        </div>
      </form>
      <section className="admin-section">
        <h3>부서 관계</h3>
        <div className="admin-grid">
          <TeamPicker
            teams={teams}
            team={parent}
            select={setParent}
            label="상위 후보 부서"
          />
          <TeamPicker
            teams={candidates}
            team={pair ? child : ""}
            select={setChild}
            label="하위 후보 부서"
          />
        </div>
        <div className="admin-actions">
          {[true, false].map((manages) => (
            <button
              key={String(manages)}
              type="button"
              className="admin-secondary"
              aria-pressed={override?.manages === manages}
              disabled={!pair || busy}
              onClick={() =>
                void perform(async () => {
                  const saved = await request<HierarchyOverride>(
                    overridePath,
                    "PUT",
                    { manages },
                  );
                  setRules((before) => [
                    ...before.filter((rule) => rule !== override),
                    saved,
                  ]);
                }, "부서 관계를 저장했습니다.")
              }
            >
              {manages ? "관리함" : "독립"}
            </button>
          ))}
          {override && (
            <button
              type="button"
              className="admin-secondary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await request(overridePath, "DELETE");
                  setRules((before) =>
                    before.filter((rule) => rule !== override),
                  );
                }, "자동 판정으로 복구했습니다.")
              }
            >
              자동 판정
            </button>
          )}
        </div>
      </section>
      <p className="admin-feedback" role="status">
        {message}
      </p>
    </>
  );
}

function listTeams(organization: Organization): Team[] {
  const teams = new Map<string, Team>();
  for (const building of organization.buildings) {
    const add = (department: Department) => {
      teams.set(department.id, {
        id: department.id,
        name: department.name,
        machine: department.machineId,
        site: building.site ?? building.name,
      });
      department.departments.forEach(add);
    };
    building.departments.forEach(add);
    for (const group of building.groups) group.departments.forEach(add);
  }
  return [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export function AdminPanel({
  organization,
  close,
}: {
  organization: Organization;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("company");
  const [draft, setDraft] = useState<OfficeSettings | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const teams = listTeams(organization);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void request<OfficeSettings>(
      "/api/settings",
      "GET",
      undefined,
      controller.signal,
    )
      .then(setDraft)
      .catch((error: Error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, []);
  const update = <K extends keyof OfficeSettings>(
    key: K,
    value: OfficeSettings[K],
  ) => {
    setDraft((old) => (old ? { ...old, [key]: value } : old));
    setMessage("");
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || tab === "org") return;
    setSaving(true);
    setMessage("");
    try {
      const value = await request<OfficeSettings[typeof tab]>(
        `/api/settings/${tab}`,
        "PUT",
        draft[tab],
      );
      setDraft((old) => (old ? { ...old, [tab]: value } : old));
      setSavedVersion((version) => version + 1);
      setMessage("저장했습니다. 변경 사항을 적용했습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="admin-dialog"
      aria-labelledby="admin-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="admin-header">
        <h2 id="admin-heading">관리</h2>
        <button type="button" className="admin-secondary" onClick={close}>
          닫기
        </button>
      </header>
      <nav className="admin-tabs" aria-label="관리 메뉴">
        {sections.map(([key, name]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            disabled={saving}
            onClick={() => {
              setTab(key);
              setMessage("");
            }}
          >
            {name}
          </button>
        ))}
      </nav>
      <div className="admin-content">
        {tab === "org" ? (
          <TeamsFields teams={teams} buildings={organization.buildings} />
        ) : draft ? (
          <form onSubmit={save} className="admin-form">
            <div key={`${tab}-${savedVersion}`}>
              {tab === "company" && (
                <CompanyFields
                  value={draft.company}
                  change={(value) => update("company", value)}
                />
              )}
              {tab === "work" && (
                <WorkFields
                  value={draft.work}
                  teams={teams}
                  change={(value) => update("work", value)}
                />
              )}
              {tab === "sharing" && (
                <SharingFields
                  value={draft.sharing}
                  teams={teams}
                  change={(value) => update("sharing", value)}
                />
              )}
              {tab === "security" && (
                <SecurityFields
                  value={draft.security}
                  change={(value) => update("security", value)}
                />
              )}
            </div>
            <footer className="admin-footer">
              <p className="admin-feedback" role="status">
                {message}
              </p>
              <button type="submit" disabled={saving}>
                {saving ? "저장 중" : "변경 저장"}
              </button>
            </footer>
          </form>
        ) : (
          <p role="status">{message || "설정을 불러오는 중입니다."}</p>
        )}
      </div>
    </dialog>
  );
}
