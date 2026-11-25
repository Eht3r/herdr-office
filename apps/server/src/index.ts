import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpeechExposure } from "@herdr-office/core";
import { accessOptionsFromEnv, createAccess } from "./access.ts";
import { createApp } from "./app.ts";
import { CompanyCalendar, defaultSchedule } from "./calendar.ts";
import { OrganizationStore } from "./db/OrganizationStore.ts";
import { HcClient } from "./hc/HcClient.ts";
import { defaultAbsenceThresholds } from "./sim/absence.ts";
import { Planner } from "./sim/Planner.ts";
import { Simulation } from "./sim/Simulation.ts";
import { SimulationStore } from "./sim/SimulationStore.ts";
import {
  configuredHours,
  configuredTeamHours,
  WorkHours,
} from "./sim/WorkHours.ts";
import { Company } from "./state/Company.ts";
import { configuredTownSeed, TownSociety } from "./town/TownSociety.ts";
import { fundingFromEnv, TownStore } from "./town/TownStore.ts";
import { UsageMonitor } from "./usage.ts";
import { CompanyWeather, companyWeatherLocation } from "./weather.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dbFile = resolve(
  process.env.OFFICE_DB ?? resolve(repoRoot, ".office-data/office.sqlite"),
);
mkdirSync(dirname(dbFile), { recursive: true });
const store = new OrganizationStore(dbFile);
const simulationStore = new SimulationStore(dbFile);
const company = new Company(new HcClient(), () => ({
  groups: store.listGroups(),
  overrides: store.listOverrides(),
  defaultWhenUnknown: store.defaultWhenUnknown(),
  placements: store.listPlacements(),
}));
const schedule = {
  ...defaultSchedule,
  timeZone: process.env.OFFICE_TIME_ZONE ?? defaultSchedule.timeZone,
  country: process.env.OFFICE_COUNTRY ?? defaultSchedule.country,
  enabled: process.env.OFFICE_WORK_HOURS_ENABLED !== "false",
};
const calendar = new CompanyCalendar(schedule);
const hours = new WorkHours(
  simulationStore,
  schedule.enabled,
  process.env.OFFICE_LEARN_HOURS === "true",
  configuredHours(process.env.OFFICE_COMPANY_HOURS),
  configuredTeamHours(process.env.OFFICE_TEAM_HOURS),
);
const exposures: SpeechExposure[] = ["status", "title", "messages", "raw"];
const exposure = exposures.find(
  (mode) => mode === process.env.OFFICE_SPEECH_EXPOSURE,
);
const numberOr = (value: string | undefined, fallback: number) =>
  value === undefined ? fallback : Number(value) * 60_000;
const remoteWork =
  process.env.OFFICE_REMOTE_WORK === "none" ? "none" : "afterHours";
const planner = new Planner(simulationStore, hours, {
  exposure,
  remoteWork,
  thresholds: {
    napMs: numberOr(
      process.env.OFFICE_ABSENCE_NAP_MINUTES,
      defaultAbsenceThresholds.napMs,
    ),
    sleepMs: numberOr(
      process.env.OFFICE_ABSENCE_SLEEP_MINUTES,
      defaultAbsenceThresholds.sleepMs,
    ),
    leaveMs: numberOr(
      process.env.OFFICE_ABSENCE_LEAVE_MINUTES,
      defaultAbsenceThresholds.leaveMs,
    ),
  },
});
const simulation = new Simulation(
  planner,
  calendar,
  new UsageMonitor(schedule.timeZone),
  simulationStore,
);
const weather = new CompanyWeather(
  companyWeatherLocation(
    process.env.OFFICE_LATITUDE,
    process.env.OFFICE_LONGITUDE,
    schedule.timeZone,
  ),
);
const town = new TownSociety(
  configuredTownSeed(),
  new TownStore(dbFile, fundingFromEnv(process.env)),
  calendar,
  weather,
);
const app = await createApp(company, store, simulation, weather, {
  town,
  access: createAccess(accessOptionsFromEnv(process.env)),
  webRoot: resolve(repoRoot, "apps/web/dist"),
  detailedSpeech: (exposure ?? "status") !== "status",
});

try {
  const address = await app.listen({
    // Loopback by default: only this machine can reach (and drive) the office.
    host: process.env.OFFICE_HOST ?? "127.0.0.1",
    port: Number(process.env.OFFICE_PORT ?? 3000),
  });
  console.info(`Herdr Office API listening on ${address}`);
  company.start();
  simulation.start();
  town.start();
} catch (error) {
  await app.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}
