import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { CompanyCalendar, defaultSchedule } from "./calendar.ts";
import { OrganizationStore } from "./db/OrganizationStore.ts";
import { HcClient } from "./hc/HcClient.ts";
import { SettingsStore } from "./settings/SettingsStore.ts";
import { Planner } from "./sim/Planner.ts";
import { Simulation } from "./sim/Simulation.ts";
import { SimulationStore } from "./sim/SimulationStore.ts";
import { WorkHours } from "./sim/WorkHours.ts";
import { Company } from "./state/Company.ts";
import { configuredTownSeed, TownSociety } from "./town/TownSociety.ts";
import { fundingFromEnv, TownStore } from "./town/TownStore.ts";
import { UsageMonitor } from "./usage.ts";
import { CompanyWeather } from "./weather.ts";

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
const settings = new SettingsStore(dbFile, process.env);
const calendar = new CompanyCalendar();
const hours = new WorkHours(simulationStore, true, false);
const planner = new Planner(simulationStore, hours, {
  exposure: "raw",
  collectSpeech: true,
  mask: settings.mask,
});
const usage = new UsageMonitor(defaultSchedule.timeZone);
const simulation = new Simulation(planner, calendar, usage, simulationStore);
const { latitude, longitude, timeZone } = settings.get().company;
const weather = new CompanyWeather({ latitude, longitude, timeZone });
const configure = (value: ReturnType<SettingsStore["get"]>) => {
  const { company, work } = value;
  calendar.schedule = {
    ...defaultSchedule,
    timeZone: company.timeZone,
    country: company.country,
    enabled: work.enabled,
  };
  hours.configure(work.enabled, work.learn, work.company, work.teams);
  usage.setTimeZone(company.timeZone);
  planner.configure(work.remoteWork, {
    napMs: work.absence.nap * 60_000,
    sleepMs: work.absence.sleep * 60_000,
    leaveMs: work.absence.leave * 60_000,
  });
  weather.setLocation({
    latitude: company.latitude,
    longitude: company.longitude,
    timeZone: company.timeZone,
  });
};
configure(settings.get());
// Test aid: shift only the neighborhood clock (e.g. +300 to see daytime streets at night).
const townClockOffsetMs =
  Number(process.env.OFFICE_TOWN_CLOCK_OFFSET_MINUTES ?? 0) * 60_000 || 0;
const town = new TownSociety(
  configuredTownSeed(),
  new TownStore(dbFile, fundingFromEnv(process.env)),
  calendar,
  weather,
  () => Date.now() + townClockOffsetMs,
);
const app = await createApp(company, store, simulation, weather, {
  town,
  settings,
  onSettings: configure,
  webRoot: resolve(repoRoot, "apps/web/dist"),
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
