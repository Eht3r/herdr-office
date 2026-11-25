import {
  type OfficeSnapshot,
  seoul,
  type Timeline,
  townGen,
} from "@herdr-office/core";
import { describe, expect, it } from "vitest";
import { CompanyCalendar } from "../calendar.ts";
import { CompanyWeather } from "../weather.ts";
import {
  createBusiness,
  defaultRules,
  openNow,
  planDelivery,
  receiveDelivery,
  rollBusiness,
} from "./business.ts";
import { neighborhoodEvents } from "./events.ts";
import { civilTime, generateResidents, planResident } from "./residents.ts";
import { TownSociety } from "./TownSociety.ts";
import { TownStore } from "./TownStore.ts";

const seed = "town-test";
const dates = [
  "2027-01-04",
  "2027-01-05",
  "2027-01-06",
  "2027-01-07",
  "2027-01-08",
  "2027-01-09",
  "2027-01-10",
  "2027-01-11",
  "2027-01-12",
  "2027-01-13",
];
const district = (homeIds: string[] = []) =>
  townGen({
    seed,
    homeIds,
    campus: { minX: -18, maxX: 18, minZ: -12, maxZ: 12 },
    buildings: [],
  });
const weekdays = {
  date: dates[0],
  weekday: 1,
  holidayNames: [] as string[],
  weather: "clear",
  timeZone: "Asia/Seoul",
} as const;
const goods = {
  convenienceStore: 0,
  cafe: 0,
  restaurant: 0,
  bakery: 0,
  bookstore: 0,
};

describe("town society", () => {
  it("keeps the first residents stable as the company grows and reproduces the town from its seed", () => {
    const original = generateResidents(seed, 0);
    expect(original).toHaveLength(40);
    expect(generateResidents(seed, 100)).toHaveLength(120);
    expect(generateResidents(seed, 19).slice(0, 40)).toEqual(original);
    expect(generateResidents("other-town", 0)).not.toEqual(original);
    const homes = original.map(({ homeId }) => homeId);
    expect(district(homes)).toEqual(district([...homes].reverse()));
    expect(district(homes).homes[homes[0]]).toBeDefined();
  });

  it("schedules residents by local hour, weekday, holiday and weather", () => {
    const [person] = generateResidents(seed, 0);
    const town = district([person.homeId]);
    const plan = (day: Parameters<typeof planResident>[1]) =>
      planResident(person, day, town, undefined, [], seed).resident.actions;
    const active = (actions: ReturnType<typeof plan>, at: number) =>
      actions.find(
        ({ startAt, durationMs }) => startAt <= at && at < startAt + durationMs,
      )?.kind;
    expect(civilTime(dates[0], 12 * 60, "Asia/Seoul")).toBe(
      Date.parse("2027-01-04T03:00:00Z"),
    );
    expect(
      active(plan(weekdays), civilTime(dates[0], 2 * 60, weekdays.timeZone)),
    ).toBe("home");
    expect(
      active(plan(weekdays), civilTime(dates[0], 12 * 60, weekdays.timeZone)),
    ).toBe("work");
    expect(
      plan({ ...weekdays, date: dates[5], weekday: 6 }).map(({ kind }) => kind),
    ).toContain("festival");
    expect(
      plan({ ...weekdays, holidayNames: ["테스트 공휴일"] }).map(
        ({ kind }) => kind,
      ),
    ).not.toContain("work");
    const rain = plan({ ...weekdays, weather: "rain" });
    expect(rain.find(({ kind }) => kind === "walk")?.props.umbrella).toBe(true);
    expect(
      plan({ ...weekdays, weekday: 6, weather: "snow" }).some(
        ({ kind }) => kind === "festival",
      ),
    ).toBe(false);
  });

  it("moves a weak business through a vacancy into a demand-driven new opening", () => {
    const slot = district().entities.find(({ kind }) => kind === "cafe");
    if (!slot) throw new Error("Missing cafe fixture");
    const initial = createBusiness(slot, dates[0], seed);
    expect(openNow(initial, 500, false, false)).toBe(true);
    expect(openNow(initial, 500, true, false)).toBe(false);
    const roll = (shop: typeof initial, date: string, sales: number) =>
      rollBusiness(shop, {
        date,
        sales,
        seed,
        demand: { ...goods, bookstore: 40 },
        supply: goods,
        rules: defaultRules,
      });
    let shop = initial;
    for (const date of dates.slice(1, 7)) {
      const result = roll(shop, date, 1000);
      expect(result.event).toBeUndefined();
      shop = result.shop;
    }
    expect(roll(shop, dates[7], 8000).shop.slowDays).toBe(0);
    const closure = roll(shop, dates[7], 1000);
    expect(closure).toMatchObject({
      event: "closure",
      shop: { kind: null, menu: [] },
    });
    const firstVacantDay = roll(closure.shop, dates[8], 0);
    expect(firstVacantDay.event).toBeUndefined();
    const opening = roll(firstVacantDay.shop, dates[9], 0);
    expect(opening).toMatchObject({
      event: "opening",
      shop: { kind: "bookstore", generation: 1 },
    });
    expect(
      opening.shop.menu.every(({ stock, price }) => stock > 0 && price > 0),
    ).toBe(true);
  });

  it("settles SQLite wallet and sales exactly once, remembers regulars, and replenishes depleted stock", () => {
    const store = new TownStore(":memory:", {
      initial: 9000,
      weekly: 5000,
      reserve: 100_000,
    });
    try {
      const slot = district().entities.find(({ kind }) => kind === "cafe");
      if (!slot) throw new Error("Missing cafe fixture");
      const shop = createBusiness(slot, dates[0], seed);
      shop.menu[0].stock = 2;
      store.save(shop);
      const product = shop.menu[0];
      const receipt = {
        id: "visit-1",
        buyerId: "employee",
        name: "가상직원",
        actor: "employee",
        slotId: shop.slotId,
        date: dates[0],
        at: 123_000,
        productId: product.id,
      } as const;
      store.fund("employee", receipt.buyerId, dates[0], 0);
      expect(store.purchase(receipt)).toBe("sold");
      expect(store.purchase(receipt)).toBe("alreadyHandled");
      expect(store.purchase({ ...receipt, id: "visit-2" })).toBe("sold");
      expect(store.purchase({ ...receipt, id: "visit-3" })).toBe("unavailable");
      expect(
        store.purchase({
          ...receipt,
          id: "no-funds",
          buyerId: "unknown",
          productId: shop.menu[1].id,
        }),
      ).toBe("unavailable");
      expect(store.daySales(shop, dates[0])).toBe(product.price * 2);
      expect(store.balance("employee", receipt.buyerId)).toBe(
        9000 - product.price * 2,
      );
      expect(store.regulars(shop)).toEqual([receipt.name]);
      const [empty] = store.shops();
      expect(empty.lastGreeting?.text).toContain(receipt.name);
      expect(empty.deliveryAt).toBeGreaterThan(receipt.at);
      if (!empty.deliveryAt) throw new Error("Missing delivery");
      expect(receiveDelivery(empty, empty.deliveryAt - 1)).toEqual(empty);
      expect(
        receiveDelivery(empty, empty.deliveryAt).menu[0].stock,
      ).toBeGreaterThan(0);
      store.fund("employee", receipt.buyerId, dates[1], 0);
      expect(store.balance("employee", receipt.buyerId)).toBe(
        9000 - product.price * 2,
      );
      store.fund("employee", receipt.buyerId, dates[7], 0);
      expect(store.balance("employee", receipt.buyerId)).toBe(
        14_000 - product.price * 2,
      );
      expect(store.total()).toBe(100_000);
    } finally {
      store.close();
    }
  });

  it("settles a simulated employee visit without publishing the office action or wallet", async () => {
    const at = civilTime(dates[0], 12 * 60, weekdays.timeZone);
    const store = new TownStore(":memory:");
    const weather = new CompanyWeather(
      seoul,
      async () =>
        Response.json({
          current: {
            weather_code: 0,
            temperature_2m: 10,
            cloud_cover: 5,
            precipitation: 0,
            snowfall: 0,
          },
        }),
      () => at,
    );
    const engine = new TownSociety(
      seed,
      store,
      new CompanyCalendar(),
      weather,
      () => at,
    );
    try {
      const snapshot: OfficeSnapshot = {
        connected: true,
        revision: 1,
        organization: {
          buildings: [
            {
              id: "site",
              name: "가상 본사",
              groups: [],
              departments: [
                {
                  id: "team",
                  machineId: "site",
                  name: "가상 팀",
                  departments: [],
                  vacantSince: null,
                  folder: "/fake/private",
                  leadAddress: null,
                  employees: [
                    {
                      address: "fake-worker",
                      spaceId: "team",
                      machineId: "site",
                      name: "가상직원",
                      status: "working",
                      title: "INTERNAL_TASK_MARKER",
                      cwd: "/fake/private",
                      turn: 1,
                      agent: "codex",
                      parent: null,
                      labels: {},
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
      engine.observe(snapshot);
      const timeline: Timeline = {
        today: null,
        usage: {},
        at,
        actions: [
          {
            id: "private-action-id",
            employeeId: "fake-worker",
            kind: "break",
            from: { kind: "cafe", buildingId: "site" },
            to: { kind: "cafe", buildingId: "site" },
            startAt: at - 500,
            durationMs: 25_000,
            props: {},
            line: "INTERNAL_SPEECH_MARKER",
          },
        ],
      };
      engine.observeActions(timeline);
      await engine.tick();
      const frame = engine.frame();
      expect(frame).not.toBeNull();
      const string = JSON.stringify(frame);
      for (const field of [
        "/fake/private",
        "INTERNAL_TASK_MARKER",
        "INTERNAL_SPEECH_MARKER",
        "private-action-id",
        '"balance"',
      ]) {
        expect(string.includes(field), `Unexpected town field ${field}`).toBe(
          false,
        );
      }
      const sales =
        frame?.shops.find((shop) => shop.kind === "cafe")?.todaySales ?? 0;
      expect(sales).toBeGreaterThan(0);
      expect(store.balance("employee", "fake-worker")).toBe(55_000 - sales);
      await engine.tick();
      expect(engine.frame()?.shops).toEqual(frame?.shops);
    } finally {
      engine.stop();
    }
  });

  it("prints public event and weather copy from observable inputs", () => {
    const day = {
      ...weekdays,
      isWeekend: true,
      isHoliday: false,
      month: 1,
      minute: 720,
      scheduledStart: 540,
      scheduledEnd: 1080,
      scheduledDay: false,
      workingHours: false,
    };
    const clear = neighborhoodEvents(day, "clear", 1, 12, seed);
    const wet = neighborhoodEvents(day, "rain", 1, 12, seed);
    expect(clear.decoration.kind).toBe("market");
    expect(wet.stories.some(({ title }) => title === "버스 운행 지연")).toBe(
      true,
    );
    expect(wet.stories.length).toBeGreaterThan(clear.stories.length);
  });

  it("sends a delivery truck to a shop left with an empty shelf", () => {
    const slot = district().entities.find(({ kind }) => kind === "cafe");
    if (!slot) throw new Error("Missing cafe fixture");
    const shop = createBusiness(slot, dates[0], seed);
    expect(planDelivery(shop, 1000).deliveryAt).toBeNull();
    shop.menu[0].stock = 0;
    const planned = planDelivery(shop, 1000);
    expect(planned.deliveryStartedAt).toBe(1000);
    expect(planned.deliveryAt).toBeGreaterThan(1000);
    // A truck already on the way is not sent twice.
    expect(planDelivery(planned, 2000)).toBe(planned);
    const arrived = receiveDelivery(planned, planned.deliveryAt ?? 0);
    expect(arrived.menu.every(({ stock }) => stock > 0)).toBe(true);
  });
});
