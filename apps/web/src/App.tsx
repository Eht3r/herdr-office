import {
  type Department,
  employeeHomeId,
  type Organization,
  townGen,
  type WeatherKind,
} from "@herdr-office/core";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { computeCampusLayout, findOffice } from "./layout/campusLayout.ts";
import type { Focus } from "./scene/Campus.tsx";
import { collectDesks } from "./sim/playback.ts";
import { AdminPanel } from "./ui/AdminPanel.tsx";
import { atmosphere } from "./weather/atmosphere.ts";
import { useWeather } from "./weather/useWeather.ts";

const Campus = lazy(() =>
  import("./scene/Campus.tsx").then(({ Campus }) => ({ default: Campus })),
);

import { subscribeOffice, useOffice } from "./state/officeStore.ts";
import { OrgPanel, type SelectedEmployee } from "./ui/OrgPanel.tsx";
import { TownPanel, type TownSelection } from "./ui/TownPanel.tsx";

const emptyOrganization: Organization = { buildings: [] };
const campusFocus: Focus = { kind: "campus" };
const tourFocus: Focus = { kind: "town" };
const skyLabels: Record<WeatherKind, string> = {
  clear: "맑음",
  cloudy: "흐림",
  rain: "비",
  snow: "눈",
  fog: "안개",
  storm: "뇌우",
};
const tourKey = "herdr-office.tour-seen";
function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(tourKey) === "1";
  } catch {
    return false;
  }
}

function subscribeMotionPreferences(notify: () => void): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function reduceMotionPreference(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findEmployee(
  departments: Department[],
  address: string,
): SelectedEmployee | undefined {
  for (const department of departments) {
    const employee = department.employees.find(
      (person) => person.address === address,
    );
    if (employee) return { employee, department };
    const found = findEmployee(department.departments, address);
    if (found) return found;
  }
}

export function App() {
  const snapshot = useOffice((state) => state.snapshot);
  const appeared = useOffice((state) => state.appeared);
  const connection = useOffice((state) => state.connection);
  const timeline = useOffice((state) => state.timeline);
  const timelineReceivedAt = useOffice((state) => state.timelineReceivedAt);
  const townFrame = useOffice((state) => state.townFrame);
  const townReceivedAt = useOffice((state) => state.townReceivedAt);
  const [townSelection, setTownSelection] = useState<TownSelection | null>(
    null,
  );
  const selectTown = useCallback(
    (selection: TownSelection) => setTownSelection(selection),
    [],
  );
  const weather = useWeather(snapshot?.settingsVersion);
  const [adminOpen, setAdminOpen] = useState(false);
  const previewVisitor =
    new URLSearchParams(window.location.search).get("view") === "public";
  const owner = snapshot?.viewer === "owner";
  const exitPreview = new URL(window.location.href);
  exitPreview.searchParams.delete("view");
  const [tour, setTour] = useState<"wide" | "approach" | "seen">(() =>
    tourSeen() || reduceMotionPreference() ? "seen" : "wide",
  );
  const [requested, setFocus] = useState<Focus>(campusFocus);
  const [sceneReady, setSceneReady] = useState(false);
  const sceneCreated = useCallback(() => setSceneReady(true), []);
  const [employeeAddress, setEmployee] = useState<string | null>(null);
  const [lowPerformance, setLowPerformance] = useState(false);
  // The map fills the screen; the org chart floats over it. Start open on wide screens.
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 900,
  );
  const reduceMotion = useSyncExternalStore(
    subscribeMotionPreferences,
    reduceMotionPreference,
    () => false,
  );
  const organization = snapshot?.organization ?? emptyOrganization;
  const campus = useMemo(
    () => computeCampusLayout(organization),
    [organization],
  );
  const seed = snapshot?.townSeed ?? "herdr-office";
  const homeIds = new Set([...collectDesks(campus).keys()].map(employeeHomeId));
  for (const point of [
    ...Object.values(timeline?.positions ?? {}),
    ...(timeline?.actions ?? []).flatMap(({ from, to }) => [from, to]),
  ]) {
    if (point.kind === "home" && point.homeId) homeIds.add(point.homeId);
  }
  const townInput = JSON.stringify({
    seed,
    campus: campus.bounds,
    buildings: campus.buildings.map(({ id, bounds }) => ({ id, x: bounds.x })),
    homeIds: [...homeIds].sort(),
  });
  const fallbackTown = useMemo(
    () => townGen(JSON.parse(townInput)),
    [townInput],
  );
  const town = townFrame?.neighborhood ?? fallbackTown;
  const { latitude, longitude, timeZone } = weather.reading.location;
  const sky = useMemo(
    () =>
      atmosphere(
        weather.at,
        { latitude, longitude, timeZone },
        weather.kind,
        weather.cloudCover,
      ),
    [
      weather.at,
      weather.kind,
      weather.cloudCover,
      latitude,
      longitude,
      timeZone,
    ],
  );
  const time = new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(weather.at);
  const finishTour = useCallback(() => {
    try {
      window.localStorage.setItem(tourKey, "1");
    } catch {}
    setTour("seen");
  }, []);
  const hasCampus = campus.buildings.length > 0;
  useEffect(() => {
    if (!hasCampus || !sceneReady || tour === "seen") return;
    if (reduceMotion) {
      finishTour();
      return;
    }
    const timer = window.setTimeout(
      () => (tour === "wide" ? setTour("approach") : finishTour()),
      tour === "wide" ? 1300 : 2100,
    );
    return () => window.clearTimeout(timer);
  }, [hasCampus, sceneReady, tour, reduceMotion, finishTour]);
  useEffect(subscribeOffice, []);

  const focusBuilding =
    requested.kind === "campus" || requested.kind === "town"
      ? undefined
      : campus.buildings.find(
          ({ id }) =>
            id ===
            (requested.kind === "office" ? requested.buildingId : requested.id),
        );
  const focusOffice =
    requested.kind === "office" && focusBuilding
      ? findOffice(focusBuilding.offices, requested.key)
      : undefined;
  const focus =
    tour === "wide"
      ? tourFocus
      : requested.kind === "campus" ||
          requested.kind === "town" ||
          (focusBuilding && (requested.kind !== "office" || focusOffice))
        ? requested
        : campusFocus;
  const selected = employeeAddress
    ? findEmployee(
        organization.buildings.flatMap((building) => [
          ...building.departments,
          ...building.groups.flatMap(({ departments }) => departments),
        ]),
        employeeAddress,
      )
    : undefined;

  const selectBuilding = useCallback(
    (id: string) => {
      finishTour();
      setFocus({ kind: "building", id });
    },
    [finishTour],
  );
  // Follow an employee who left their desk: to their building, or out into town.
  const locate = useCallback(
    (buildingId: string | null, town: boolean) => {
      finishTour();
      setFocus(
        town || !buildingId
          ? { kind: "town" }
          : { kind: "building", id: buildingId },
      );
    },
    [finishTour],
  );
  const selectOffice = useCallback(
    (buildingId: string, key: string) => {
      finishTour();
      setFocus({ kind: "office", buildingId, key });
    },
    [finishTour],
  );
  const selectEmployee = useCallback(
    (buildingId: string, address: string) => {
      finishTour();
      setEmployee(address);
      setFocus((current) =>
        current.kind === "campus" ||
        current.kind === "town" ||
        (current.kind === "building"
          ? current.id !== buildingId
          : current.buildingId !== buildingId)
          ? { kind: "building", id: buildingId }
          : current,
      );
    },
    [finishTour],
  );

  const live = connection === "open" && snapshot?.connected;
  const connectionTitle = live
    ? "실시간 연결"
    : connection === "connecting"
      ? "연결 중"
      : "연결 대기";
  const locationTitle = focusOffice?.name ?? focusBuilding?.name;
  return (
    <main className="office-shell">
      <header className="topbar">
        <div className="wordmark">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <h1>{snapshot?.companyName ?? "Herdr Office"}</h1>
        </div>
        <div className="header-actions">
          {owner && (
            <button
              className="performance"
              type="button"
              aria-haspopup="dialog"
              onClick={() => setAdminOpen(true)}
            >
              관리
            </button>
          )}
          {previewVisitor && (
            <a className="performance preview-exit" href={exitPreview.href}>
              공개 미리보기 종료
            </a>
          )}
          <span className="connection" data-live={Boolean(live)} role="status">
            {connectionTitle}
          </span>
          <button
            className="performance"
            type="button"
            aria-pressed={panelOpen}
            aria-controls="org-panel"
            onClick={() => {
              if (townSelection) {
                setTownSelection(null);
                setPanelOpen(true);
              } else setPanelOpen((open) => !open);
            }}
          >
            조직도
          </button>
          <button
            className="performance"
            type="button"
            aria-pressed={lowPerformance}
            onClick={() => setLowPerformance((enabled) => !enabled)}
          >
            <span className="toggle-track" aria-hidden="true" />
            저사양 모드
          </button>
        </div>
      </header>

      <div className="workspace">
        <section
          className="scene-panel"
          data-campus={focus.kind === "campus"}
          data-town={focus.kind === "town"}
          data-weather={sky.kind}
          data-night={sky.night}
          aria-label="3D 캠퍼스와 동네"
        >
          <div className="scene-header">
            <button
              className="campus-button"
              type="button"
              aria-pressed={focus.kind === "town"}
              onClick={() => {
                finishTour();
                setFocus({ kind: "town" });
                setEmployee(null);
              }}
            >
              동네 전체
            </button>
            <button
              className="campus-button"
              type="button"
              aria-pressed={focus.kind === "campus"}
              onClick={() => {
                finishTour();
                setFocus({ kind: "campus" });
                setEmployee(null);
              }}
            >
              캠퍼스 전체
            </button>
            {tour !== "seen" && (
              <button
                type="button"
                className="campus-button"
                onClick={finishTour}
              >
                건너뛰기
              </button>
            )}
            {focus.kind !== "campus" &&
              focus.kind !== "town" &&
              locationTitle && (
                <span className="current-location">{locationTitle}</span>
              )}
          </div>
          {townFrame && (
            <button
              className="town-news-button campus-button"
              type="button"
              aria-controls="town-panel"
              aria-pressed={townSelection?.kind === "news"}
              onClick={() => selectTown({ kind: "news" })}
            >
              동네 신문
            </button>
          )}
          <div className="scene-weather">
            <div className="weather-reading">
              <strong>{skyLabels[sky.kind]}</strong>
              <span>{time}</span>
              {!weather.previewing && weather.reading.current && (
                <span>{Math.round(weather.reading.current.temperature)}°C</span>
              )}
            </div>
            <fieldset className="weather-location" aria-label="날씨 기준 위치">
              <button
                type="button"
                aria-pressed={weather.mode === "company"}
                onClick={weather.useCompany}
              >
                회사 위치
              </button>
              <button
                type="button"
                aria-pressed={weather.mode === "visitor"}
                disabled={weather.mode === "locating"}
                onClick={weather.useVisitor}
              >
                {weather.mode === "locating" ? "위치 확인 중" : "내 위치"}
              </button>
            </fieldset>
          </div>
          {hasCampus ? (
            <div className="scene-canvas">
              <Suspense
                fallback={
                  <p className="scene-empty" role="status">
                    3D 동네를 여는 중입니다.
                  </p>
                }
              >
                <Campus
                  campus={campus}
                  town={town}
                  townFrame={townFrame}
                  townReceivedAt={townReceivedAt}
                  onTownSelect={selectTown}
                  sky={sky}
                  timeline={timeline}
                  timelineReceivedAt={timelineReceivedAt}
                  opening={tour !== "seen"}
                  onReady={sceneCreated}
                  focus={focus}
                  appeared={appeared}
                  lowPerformance={lowPerformance}
                  reduceMotion={reduceMotion}
                  employee={selected?.employee.address ?? null}
                  onBuilding={selectBuilding}
                  onOffice={selectOffice}
                  onEmployee={selectEmployee}
                />
              </Suspense>
            </div>
          ) : (
            <p className="scene-empty" role="status">
              {snapshot?.connected
                ? "표시할 건물이 없습니다."
                : "Herdr 연결을 기다리는 중입니다."}
            </p>
          )}
          <div className="scene-guide">
            드래그로 이동
            <span aria-hidden="true" />
            오른쪽 드래그 또는 두 손가락으로 회전
            <span aria-hidden="true" />
            스크롤 또는 핀치로 확대
          </div>
        </section>

        {townSelection && townFrame ? (
          <TownPanel
            frame={townFrame}
            selection={townSelection}
            select={selectTown}
            close={() => setTownSelection(null)}
          />
        ) : (
          <OrgPanel
            open={panelOpen || Boolean(selected)}
            organization={organization}
            loading={!snapshot}
            selected={selected}
            onClose={() => setEmployee(null)}
            onLocate={locate}
            actions={{
              owner,
              sites: [
                ...new Set(organization.buildings.map((b) => b.site ?? b.name)),
              ],
              focus,
              selected: selected?.employee.address ?? null,
              onBuilding: selectBuilding,
              onOffice: selectOffice,
              onEmployee: selectEmployee,
            }}
          />
        )}
      </div>
      {owner && adminOpen && (
        <AdminPanel
          organization={organization}
          close={() => setAdminOpen(false)}
        />
      )}
    </main>
  );
}
