import {
  type BusinessKind,
  businessKinds,
  hashSeed,
  type PublicMenuItem,
  type TownEntity,
} from "@herdr-office/core";

export interface Business {
  slotId: string;
  generation: number;
  kind: BusinessKind | null;
  name: string;
  date: string;
  slowDays: number;
  vacantSince: string | null;
  menu: PublicMenuItem[];
  deliveryAt: number | null;
  deliveryStartedAt: number | null;
  lastGreeting?: { text: string; until: number };
}

export interface BusinessRules {
  minDailySales: number;
  slowDays: number;
  vacantDays: number;
}
export const defaultRules: BusinessRules = {
  minDailySales: 6500,
  slowDays: 7,
  vacantDays: 2,
};

const catalogs: Record<BusinessKind, readonly [string, number][]> = {
  convenienceStore: [
    ["삼각 주먹밥", 1500],
    ["탄산수", 1200],
    ["과일 컵", 2700],
    ["간식 상자", 3200],
  ],
  cafe: [
    ["보리 라테", 4300],
    ["따뜻한 차", 3400],
    ["크림 스콘", 3800],
  ],
  restaurant: [
    ["구운 채소 덮밥", 7800],
    ["버섯 국수", 7200],
    ["제철 반상", 9900],
  ],
  bakery: [
    ["소금롤", 2800],
    ["밤 식빵", 5900],
    ["작은 파이", 3900],
  ],
  bookstore: [
    ["동네 산책 지도", 5500],
    ["여행 노트", 6200],
    ["소품집", 10900],
  ],
};
const names = [
  "누어곁",
  "오롯샘",
  "솔틈마루",
  "담빛솔",
  "모람귤",
  "따우들",
  "느루켠",
  "봄결틀",
  "해솔둔",
];
const suffixes: Record<BusinessKind, string> = {
  convenienceStore: "생활점",
  cafe: "찻집",
  restaurant: "식탁",
  bakery: "빵 공방",
  bookstore: "책방",
};

function items(seed: string, kind: BusinessKind): PublicMenuItem[] {
  return catalogs[kind].map(([name, price], index) => ({
    id: `${kind}-${index}`,
    name,
    price,
    stock: 4 + (hashSeed(`${seed}:${index}`) % 7),
  }));
}

export function createBusiness(
  slot: TownEntity,
  date: string,
  seed: string,
): Business {
  const kind = slot.kind === "vacantShop" ? null : (slot.kind as BusinessKind);
  return {
    slotId: slot.id,
    generation: 0,
    kind,
    name: slot.name,
    date,
    slowDays: 0,
    vacantSince: kind ? null : date,
    menu: kind ? items(`${seed}:${slot.id}`, kind) : [],
    deliveryAt: null,
    deliveryStartedAt: null,
  };
}

export function businessAccount(shop: Business): string {
  return `shop:${shop.slotId}:${shop.generation}`;
}

export function businessHours(
  kind: BusinessKind,
  weekend: boolean,
  holiday: boolean,
): [number, number] {
  const start = {
    convenienceStore: 420,
    cafe: 480,
    restaurant: 660,
    bakery: 450,
    bookstore: 630,
  }[kind];
  const end = {
    convenienceStore: 1440,
    cafe: 1260,
    restaurant: 1320,
    bakery: 1200,
    bookstore: 1230,
  }[kind];
  return [
    start + (holiday ? 60 : weekend && kind !== "convenienceStore" ? 30 : 0),
    end,
  ];
}

export function openNow(
  shop: Business,
  minute: number,
  weekend: boolean,
  holiday: boolean,
): boolean {
  if (!shop.kind) return false;
  const [opens, closes] = businessHours(shop.kind, weekend, holiday);
  return minute >= opens && minute < closes;
}

function chooseKind(
  wanted: Record<BusinessKind, number>,
  supply: Record<BusinessKind, number>,
  seed: string,
): BusinessKind {
  return [...businessKinds].sort(
    (a, b) =>
      (wanted[b] + 2) / (supply[b] + 1) - (wanted[a] + 2) / (supply[a] + 1) ||
      hashSeed(`${seed}:${a}`) - hashSeed(`${seed}:${b}`),
  )[0];
}

export function rollBusiness(
  shop: Business,
  input: {
    date: string;
    sales: number;
    seed: string;
    demand: Record<BusinessKind, number>;
    supply: Record<BusinessKind, number>;
    rules: BusinessRules;
  },
): { shop: Business; event?: "opening" | "closure" } {
  const { date, sales, seed, demand, supply, rules } = input;
  if (date <= shop.date) return { shop };
  if (shop.kind) {
    const slowDays = sales < rules.minDailySales ? shop.slowDays + 1 : 0;
    if (slowDays >= rules.slowDays) {
      return {
        shop: {
          ...shop,
          kind: null,
          menu: [],
          name: "빈 점포",
          date,
          slowDays,
          vacantSince: date,
          deliveryAt: null,
          deliveryStartedAt: null,
          lastGreeting: undefined,
        },
        event: "closure",
      };
    }
    return { shop: { ...shop, date, slowDays } };
  }
  const days =
    (Date.parse(date) - Date.parse(shop.vacantSince ?? date)) / 86_400_000;
  if (days < rules.vacantDays) return { shop: { ...shop, date } };
  const generation = shop.generation + 1;
  const tag = `${seed}:${shop.slotId}:${generation}`;
  const kind = chooseKind(demand, supply, tag);
  const name = `${names[hashSeed(tag) % names.length]} ${suffixes[kind]}`;
  return {
    shop: {
      ...shop,
      generation,
      kind,
      name,
      date,
      slowDays: 0,
      vacantSince: null,
      menu: items(tag, kind),
    },
    event: "opening",
  };
}

export function planDelivery(shop: Business, at: number): Business {
  if (
    !shop.kind ||
    shop.deliveryAt !== null ||
    !shop.menu.some(({ stock }) => stock === 0)
  )
    return shop;
  return {
    ...shop,
    deliveryStartedAt: at,
    deliveryAt: at + 35_000 + (hashSeed(shop.slotId) % 35_000),
  };
}

export function receiveDelivery(shop: Business, at: number): Business {
  if (!shop.kind || shop.deliveryAt === null || at < shop.deliveryAt)
    return shop;
  return {
    ...shop,
    deliveryAt: null,
    deliveryStartedAt: null,
    menu: shop.menu.map((item) => ({
      ...item,
      stock: Math.max(item.stock, 6 + (hashSeed(item.id) % 5)),
    })),
  };
}
