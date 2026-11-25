import { type Action, seoul, townGen, weatherKind } from "@herdr-office/core";
import { expect, it } from "vitest";
import { computeCampusLayout } from "../layout/campusLayout.ts";
import { atmosphere } from "../weather/atmosphere.ts";
import { previewWeather } from "../weather/useWeather.ts";
import {
  actionFrame,
  interpolateRoute,
  routePlanner,
  waypointPosition,
} from "./playback.ts";

const layout = computeCampusLayout({
  buildings: [{ id: "local", name: "HQ", departments: [], groups: [] }],
});
const town = townGen({
  campus: layout.bounds,
  buildings: [{ id: "local", x: 0 }],
  homeIds: ["home-t1"],
  seed: "example",
});

it("locates house, transit and campus entrances and resumes a moving action at the server midpoint", () => {
  const action: Action = {
    id: "one",
    employeeId: "t1",
    kind: "commuteIn",
    from: { kind: "home", homeId: "home-t1" },
    to: { kind: "entrance", buildingId: "local" },
    startAt: 80_000,
    durationMs: 40_000,
    props: {},
    line: "",
  };
  const resolve = (key: Action["from"]) =>
    waypointPosition(key, action.employeeId, layout, town, new Map());
  expect(resolve({ kind: "station", buildingId: "local" })).toEqual(
    town.stations.local,
  );
  const from = resolve(action.from);
  const to = resolve(action.to);
  const path = routePlanner(town, layout)(from, to);
  expect(path.points.length).toBeGreaterThan(2);
  expect(interpolateRoute(path, 0).point).toEqual(from);
  expect(interpolateRoute(path, 1).point).toEqual(to);
  const frame = actionFrame([action], 100_000);
  expect(frame).toMatchObject({ active: action, progress: 0.5 });
  expect(interpolateRoute(path, frame.progress).point).not.toEqual(from);
  expect(actionFrame([action], 120_000)).toEqual({ last: action, progress: 1 });
});

it("uses the company zone and accepts deterministic time and weather previews", () => {
  const day = Date.parse("2026-11-25T13:00:00+09:00");
  const night = Date.parse("2026-11-25T22:00:00+09:00");
  expect(atmosphere(day, seoul, "clear", 0)).toMatchObject({
    hour: 13,
    night: false,
  });
  expect(atmosphere(night, seoul, "snow", 80)).toMatchObject({
    night: true,
    clouds: 0.8,
  });
  expect(previewWeather("?time=bad&weather=storm")).toEqual({
    time: null,
    kind: "storm",
  });
  expect([0, 3, 45, 61, 75, 95].map(weatherKind)).toEqual([
    "clear",
    "cloudy",
    "fog",
    "rain",
    "snow",
    "storm",
  ]);
});
