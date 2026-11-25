import { hashSeed } from "./identity.ts";
import type { Neighborhood, TownEntity, TownPoint } from "./townGen.ts";

export const businessKinds = [
  "convenienceStore",
  "cafe",
  "restaurant",
  "bakery",
  "bookstore",
] as const;
export type BusinessKind = (typeof businessKinds)[number];
export type ShopStatus = "open" | "closed" | "vacant";

export interface PublicMenuItem {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export interface TownShop {
  slotId: string;
  kind: BusinessKind | null;
  name: string;
  owner: string | null;
  staff: string[];
  status: ShopStatus;
  opensAt: number;
  closesAt: number;
  menu: PublicMenuItem[];
  todaySales: number;
  regulars: string[];
  greeting?: string;
  deliveryAt?: number;
}

export type ResidentAge = "child" | "young" | "adult" | "senior";
export type ResidentKind =
  | "home"
  | "walk"
  | "work"
  | "school"
  | "shop"
  | "park"
  | "festival"
  | "rest";

export interface TownAction {
  id: string;
  actorId: string;
  kind: ResidentKind | "delivery";
  from: TownPoint;
  to: TownPoint;
  startAt: number;
  durationMs: number;
  props: { umbrella?: boolean; shopId?: string };
}

export interface TownResident {
  id: string;
  name: string;
  age: ResidentAge;
  job: string;
  traits: string[];
  home: TownPoint;
  actions: TownAction[];
}

export interface TownStory {
  id: string;
  at: number;
  kind: "opening" | "closure" | "event" | "company" | "weather" | "local";
  title: string;
  body: string;
}

export interface TownDecoration {
  kind: "market" | "festival" | "season";
  color: string;
  name: string;
}

export interface TownFrame {
  at: number;
  date: string;
  layoutKey: string;
  neighborhood: Neighborhood;
  residents: TownResident[];
  shops: TownShop[];
  deliveries: TownAction[];
  news: TownStory[];
  decoration: TownDecoration;
}

export function retailSlot(entity: TownEntity): boolean {
  return (
    entity.kind === "convenienceStore" ||
    entity.kind === "cafe" ||
    entity.kind === "restaurant" ||
    entity.kind === "vacantShop"
  );
}

export function venueGroup(
  kind: BusinessKind,
): "convenienceStore" | "cafe" | "restaurant" {
  if (kind === "bookstore") return "convenienceStore";
  if (kind === "bakery") return "cafe";
  return kind;
}

export function chooseVenue<T>(id: string, candidates: T[]): T | undefined {
  return candidates[hashSeed(id) % candidates.length];
}

export function applyTownShops(
  town: Neighborhood,
  shops: Pick<TownShop, "slotId" | "kind" | "name">[],
): Neighborhood {
  const ids = new Map(shops.map((shop) => [shop.slotId, shop]));
  const destinations = {
    convenienceStore: [] as TownPoint[],
    cafe: [] as TownPoint[],
    restaurant: [] as TownPoint[],
    park: town.destinations.park,
  };
  const entities = town.entities.map((entity): TownEntity => {
    const shop = ids.get(entity.id);
    if (!shop) {
      if (retailSlot(entity) && entity.kind !== "vacantShop") {
        const kind = entity.kind as "convenienceStore" | "cafe" | "restaurant";
        destinations[kind].push(entity.entrance.position);
      }
      return entity;
    }
    const group = shop.kind ? venueGroup(shop.kind) : null;
    if (group) destinations[group].push(entity.entrance.position);
    return {
      ...entity,
      kind: shop.kind ?? "vacantShop",
      name: shop.name,
      entrance: { ...entity.entrance, kind: group ?? "site" },
    };
  });
  return { ...town, entities, destinations };
}
