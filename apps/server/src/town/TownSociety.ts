import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { hostname } from "node:os";
import {
  type Action,
  applyTownShops,
  type BusinessKind,
  businessKinds,
  chooseVenue,
  computeCampusLayout,
  type Department,
  employeeHomeId,
  hashSeed,
  type Neighborhood,
  type OfficeSnapshot,
  retailSlot,
  type Timeline,
  type TownAction,
  type TownFrame,
  type TownPoint,
  townGen,
  venueGroup,
  weatherKind,
} from "@herdr-office/core";
import type { CompanyCalendar, WorkDay } from "../calendar.ts";
import type { CompanyWeather } from "../weather.ts";
import {
  type Business,
  type BusinessRules,
  businessHours,
  createBusiness,
  defaultRules,
  openNow,
  receiveDelivery,
  rollBusiness,
} from "./business.ts";
import { neighborhoodEvents } from "./events.ts";
import {
  generateResidents,
  planResident,
  type ResidentPost,
  type ResidentProfile,
} from "./residents.ts";
import type { TownStore } from "./TownStore.ts";

export function configuredTownSeed(): string {
  return (
    process.env.OFFICE_TOWN_SEED ??
    createHash("sha256").update(hostname()).digest("hex").slice(0, 18)
  );
}

const minute = 60_000;
const dayMs = 86_400_000;

interface Worker {
  id: string;
  name: string;
}
type ShopTeam = {
  owner?: ResidentProfile;
  staff: ResidentProfile[];
  post?: ResidentPost;
};

function findWorkers(snapshot: OfficeSnapshot): Worker[] {
  const names = new Map<string, Worker>();
  const add = (department: Department) => {
    for (const employee of department.employees) {
      if (employee.agent && employee.name)
        names.set(employee.address, {
          id: employee.address,
          name: employee.name,
        });
    }
    department.departments.forEach(add);
  };
  for (const building of snapshot.organization.buildings) {
    building.departments.forEach(add);
    for (const group of building.groups) group.departments.forEach(add);
  }
  return [...names.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function staffShops(
  shops: Business[],
  population: ResidentProfile[],
  town: Neighborhood,
  day: WorkDay,
  seed: string,
): Map<string, ShopTeam> {
  const team = new Map<string, ShopTeam>();
  const available = population.filter(
    ({ age }) => age === "adult" || age === "young",
  );
  for (const shop of shops) {
    const entity = town.entities.find(({ id }) => id === shop.slotId);
    if (!shop.kind || !entity || !available.length) continue;
    const number =
      hashSeed(`${seed}:${shop.slotId}:${shop.generation}`) % available.length;
    const owner = available.splice(number, 1)[0];
    const staff = available.splice(
      number % Math.max(1, available.length),
      shop.kind === "restaurant" ? 2 : 1,
    );
    const [opensAt, closesAt] = businessHours(
      shop.kind,
      day.isWeekend,
      day.isHoliday,
    );
    team.set(shop.slotId, {
      owner,
      staff,
      post: {
        slotId: shop.slotId,
        business: shop.kind,
        name: shop.name,
        entrance: entity.entrance.position,
        opensAt,
        closesAt,
        owner: true,
      },
    });
  }
  return team;
}

function isPurchase(action: Action): action is Action & {
  to: { kind: "convenienceStore" | "cafe" | "restaurant" };
} {
  return (
    action.kind === "break" &&
    (action.to.kind === "convenienceStore" ||
      action.to.kind === "cafe" ||
      action.to.kind === "restaurant")
  );
}

export class TownSociety extends EventEmitter<{ town: [TownFrame] }> {
  private current?: TownFrame;
  private timer?: ReturnType<typeof setInterval>;
  private snapshot?: OfficeSnapshot;
  private workers: Worker[] = [];
  private timeline?: Timeline;
  private busy = false;
  private stopped = false;
  private district?: {
    key: string;
    town: Neighborhood;
    population: ResidentProfile[];
  };

  constructor(
    readonly seed: string,
    private readonly store: TownStore,
    private readonly calendar: CompanyCalendar,
    private readonly weather: CompanyWeather,
    private readonly clock = Date.now,
    private readonly rules: BusinessRules = defaultRules,
  ) {
    super();
  }

  observe(snapshot: OfficeSnapshot): void {
    if (!snapshot.connected || !snapshot.organization.buildings.length) return;
    this.snapshot = snapshot;
    this.workers = findWorkers(snapshot);
  }

  observeActions(timeline: Timeline): void {
    this.timeline = timeline;
  }
  frame(): TownFrame | null {
    return this.current ? { ...this.current, at: this.clock() } : null;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), 6_000);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.store.close();
  }

  async tick(): Promise<void> {
    if (this.busy || this.stopped || !this.snapshot) return;
    this.busy = true;
    try {
      const forecast = await this.weather.read();
      const at = this.clock();
      const day = await this.calendar.today(at);
      const snapshot = this.snapshot;
      if (this.stopped || !snapshot) return;
      const state = this.store.run(() =>
        this.simulate(
          snapshot,
          day,
          forecast.current ? weatherKind(forecast.current.code) : "clear",
          at,
        ),
      );
      this.current = state;
      this.emit("town", state);
    } catch (error) {
      console.error("Town simulation failed", error);
    } finally {
      this.busy = false;
    }
  }

  private region(snapshot: OfficeSnapshot, workers: Worker[]) {
    const campus = computeCampusLayout(snapshot.organization);
    const buildings = campus.buildings.map(({ id, bounds: { x } }) => ({
      id,
      x,
    }));
    const homes = workers.map(({ id }) => employeeHomeId(id));
    for (const action of this.timeline?.actions ?? []) {
      for (const point of [action.from, action.to]) {
        if (point.kind === "home" && point.homeId) homes.push(point.homeId);
      }
    }
    const key = JSON.stringify([
      campus.bounds,
      buildings,
      [...new Set(homes)].sort(),
    ]);
    if (this.district?.key !== key) {
      const population = generateResidents(this.seed, workers.length);
      this.district = {
        key,
        population,
        town: townGen({
          campus: campus.bounds,
          buildings,
          seed: this.seed,
          homeIds: [...homes, ...population.map(({ homeId }) => homeId)],
        }),
      };
    }
    return this.district;
  }

  private simulate(
    snapshot: OfficeSnapshot,
    day: WorkDay,
    weather: Parameters<typeof neighborhoodEvents>[1],
    at: number,
  ): TownFrame {
    const workers = this.workers;
    const { town, population, key } = this.region(snapshot, workers);
    const slots = town.entities.filter(retailSlot);
    const saved = new Map(
      this.store.shops().map((shop) => [shop.slotId, shop]),
    );
    const shops = slots.map(
      (slot) => saved.get(slot.id) ?? createBusiness(slot, day.date, this.seed),
    );
    const since = new Date(Date.parse(day.date) - 7 * dayMs)
      .toISOString()
      .slice(0, 10);
    const attempts = this.store.demand(since);
    const demand = Object.fromEntries(
      businessKinds.map((kind) => [
        kind,
        (attempts[kind] ?? 0) +
          (kind === "bakery" || kind === "bookstore"
            ? Math.round(population.length / (kind === "bakery" ? 6 : 11))
            : 0),
      ]),
    ) as Record<BusinessKind, number>;
    const supply = Object.fromEntries(
      businessKinds.map((kind) => [
        kind,
        shops.filter((shop) => shop.kind === kind).length,
      ]),
    ) as Record<BusinessKind, number>;
    let businesses = shops.map((previous) => {
      const result = rollBusiness(previous, {
        date: day.date,
        sales: this.store.daySales(previous, previous.date),
        demand,
        supply,
        seed: this.seed,
        rules: this.rules,
      });
      const next = receiveDelivery(result.shop, at);
      if (result.event) {
        if (previous.kind)
          supply[previous.kind] = Math.max(0, supply[previous.kind] - 1);
        if (next.kind) supply[next.kind]++;
        this.store.addStory(day.date, {
          id: `${day.date}:${next.slotId}:${result.event}`,
          kind: result.event,
          at,
          title:
            result.event === "opening"
              ? `${next.name} 문을 열었습니다`
              : `${previous.name} 영업 종료`,
          body:
            result.event === "opening"
              ? "동네 수요에 맞춘 새 점포가 들어섰습니다."
              : "해당 가게 자리는 다음 입점까지 비어 있습니다.",
        });
      }
      this.store.save(next);
      return next;
    });
    const neighborhood = applyTownShops(town, businesses);
    const teams = staffShops(
      businesses,
      population,
      neighborhood,
      day,
      this.seed,
    );
    const posts = [...teams.values()].flatMap(({ post }) =>
      post ? [post] : [],
    );
    const postFor = new Map<string, ResidentPost>();
    for (const { post, owner, staff } of teams.values()) {
      if (!post || !owner) continue;
      postFor.set(owner.id, post);
      for (const employee of staff)
        postFor.set(employee.id, { ...post, owner: false });
    }
    const times = new Map<number, number>();
    const roster = population.map((profile) =>
      planResident(
        profile,
        { ...day, weather },
        neighborhood,
        postFor.get(profile.id),
        posts,
        this.seed,
        times,
      ),
    );
    for (const worker of workers)
      this.store.fund("employee", worker.id, day.date, at);
    for (const person of population)
      this.store.fund("resident", person.id, day.date, at);

    const bySlot = new Map(
      businesses.map((business) => [business.slotId, business]),
    );
    for (const visit of roster.flatMap(({ visits }) => visits)) {
      if (at < visit.at || at - visit.at > 20 * minute) continue;
      this.sell(
        bySlot.get(visit.slotId),
        visit.id,
        visit.actorId,
        visit.name,
        "resident",
        day,
        visit.at,
      );
    }
    const byWorker = new Map(workers.map((worker) => [worker.id, worker]));
    for (const action of this.timeline?.actions ?? []) {
      if (
        at < action.startAt ||
        at >= action.startAt + action.durationMs ||
        !isPurchase(action)
      )
        continue;
      const worker = byWorker.get(action.employeeId);
      if (!worker) continue;
      const shop = chooseVenue(
        worker.id,
        businesses.filter(
          ({ kind }) => kind && venueGroup(kind) === action.to.kind,
        ),
      );
      this.sell(
        shop,
        action.id,
        worker.id,
        worker.name,
        "employee",
        day,
        action.startAt,
      );
    }

    const current = new Map(
      this.store.shops().map((shop) => [shop.slotId, shop]),
    );
    businesses = businesses.map((shop) => current.get(shop.slotId) ?? shop);
    const cue = neighborhoodEvents(day, weather, at, workers.length, this.seed);
    const news = [...this.store.news(day.date), ...cue.stories].sort(
      (a, b) => b.at - a.at || a.id.localeCompare(b.id),
    );
    const deliveries = businesses.flatMap((shop): TownAction[] => {
      if (shop.deliveryAt === null || shop.deliveryStartedAt === null)
        return [];
      const port = neighborhood.entities.find(({ id }) => id === shop.slotId)
        ?.entrance.position;
      if (!port) return [];
      const from: TownPoint = [neighborhood.bounds.minX + 5, 0.1, port[2] - 3];
      return [
        {
          id: `delivery:${shop.slotId}:${shop.deliveryAt}`,
          actorId: `truck:${shop.slotId}`,
          kind: "delivery",
          from,
          to: [port[0], 0.1, port[2] - 1.4],
          startAt: shop.deliveryStartedAt,
          durationMs: shop.deliveryAt - shop.deliveryStartedAt,
          props: { shopId: shop.slotId },
        },
      ];
    });
    return {
      at,
      date: day.date,
      layoutKey: createHash("sha256")
        .update(
          JSON.stringify([
            key,
            businesses.map(({ slotId, kind, name }) => [slotId, kind, name]),
          ]),
        )
        .digest("hex")
        .slice(0, 20),
      neighborhood,
      residents: roster.map(({ resident }) => ({
        ...resident,
        actions: resident.actions
          .filter(({ startAt, durationMs }) => startAt + durationMs > at)
          .slice(0, 3),
      })),
      shops: businesses.map((shop) => {
        const [opensAt, closesAt] = shop.kind
          ? businessHours(shop.kind, day.isWeekend, day.isHoliday)
          : [0, 0];
        const team = teams.get(shop.slotId);
        return {
          slotId: shop.slotId,
          kind: shop.kind,
          name: shop.name,
          owner: team?.owner?.name ?? null,
          staff: team?.staff.map(({ name }) => name) ?? [],
          opensAt,
          closesAt,
          status: shop.kind
            ? openNow(shop, day.minute, day.isWeekend, day.isHoliday)
              ? "open"
              : "closed"
            : "vacant",
          menu: shop.menu,
          todaySales: this.store.daySales(shop, day.date),
          regulars: this.store.regulars(shop),
          ...(shop.deliveryAt ? { deliveryAt: shop.deliveryAt } : {}),
          ...(shop.lastGreeting && at < shop.lastGreeting.until
            ? { greeting: shop.lastGreeting.text }
            : {}),
        };
      }),
      deliveries,
      news,
      decoration: cue.decoration,
    };
  }

  private sell(
    shop: Business | undefined,
    id: string,
    buyerId: string,
    name: string,
    actor: "resident" | "employee",
    day: WorkDay,
    at: number,
  ): void {
    if (!shop || !openNow(shop, day.minute, day.isWeekend, day.isHoliday))
      return;
    const item = chooseVenue(id, shop.menu);
    if (item)
      this.store.purchase({
        id,
        buyerId,
        name,
        actor,
        slotId: shop.slotId,
        date: day.date,
        at,
        productId: item.id,
      });
  }
}
