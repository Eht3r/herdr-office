import { expect, it } from "vitest";
import { townGen } from "./townGen.ts";

const campus = { minX: -22, maxX: 65, minZ: -12, maxZ: 14 };
const buildings = [
  { id: "local", x: 0 },
  { id: "remote", x: 43 },
];
const options = {
  campus,
  buildings,
  homeIds: ["home-t1", "home-t3", "home-remote-t5"],
  seed: "company-one",
};

it("produces the same neighborhood and unique occupied units from the same company seed", () => {
  const town = townGen(options);
  expect(
    townGen({ ...options, homeIds: [...options.homeIds].reverse() }),
  ).toEqual(town);
  expect(
    townGen({ ...options, seed: "company-two" }).entities.map(
      ({ name }) => name,
    ),
  ).not.toEqual(town.entities.map(({ name }) => name));
  expect(new Set(town.entities.map(({ id }) => id)).size).toBe(
    town.entities.length,
  );
  expect(new Set(town.entities.map(({ name }) => name)).size).toBe(
    town.entities.length,
  );
  expect(
    new Set(
      Object.values(town.homes).map(
        ({ entityId, unit }) => `${entityId}:${unit}`,
      ),
    ).size,
  ).toBe(options.homeIds.length);
  for (const home of Object.values(town.homes)) {
    const building = town.entities.find(({ id }) => id === home.entityId);
    expect(building?.entrance.kind).toBe("home");
    expect(home.unit).toBeLessThan(building?.capacity ?? 0);
  }
});

it("exports usable entities outside the business block and connects transit and retail to the road grid", () => {
  const town = townGen(options);
  expect(town.roads.length).toBeGreaterThan(4);
  expect(town.crossings).toHaveLength(8);
  expect(Object.keys(town.stations)).toEqual(["local", "remote"]);
  expect(town.destinations.restaurant).toHaveLength(3);
  expect(
    town.entities.filter(({ kind }) => kind === "vacantShop"),
  ).toHaveLength(2);
  expect(town.entities.filter(({ kind }) => kind === "subway")).toHaveLength(2);
  for (const {
    parcel: { x, z, width, depth },
    entrance,
    capacity,
  } of town.entities) {
    expect(
      x + width / 2 <= campus.minX ||
        x - width / 2 >= campus.maxX ||
        z + depth / 2 <= campus.minZ ||
        z - depth / 2 >= campus.maxZ,
    ).toBe(true);
    expect(entrance.position[0]).toBeGreaterThan(town.bounds.minX);
    expect(entrance.position[2]).toBeLessThan(town.bounds.maxZ);
    expect(capacity).toBeGreaterThan(0);
  }
});
