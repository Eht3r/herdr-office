import { expect, it } from "vitest";
import { findPath } from "./path.ts";

it("finds a shortest cardinal route around an obstacle", () => {
  const grid = {
    width: 5,
    depth: 5,
    blocked: ({ x, z }: { x: number; z: number }) => x === 2 && z !== 4,
  };
  const start = { x: 0, z: 0 };
  const goal = { x: 4, z: 0 };
  const route = findPath(grid, start, goal);
  expect(route).toHaveLength(13);
  expect(route?.[0]).toEqual(start);
  expect(route?.at(-1)).toEqual(goal);
  expect(route?.every((point) => !grid.blocked(point))).toBe(true);
  expect(
    route?.slice(1).every((point, index) => {
      const previous = route[index];
      return (
        Math.abs(previous.x - point.x) + Math.abs(previous.z - point.z) === 1
      );
    }),
  ).toBe(true);
});

it("handles an unreachable goal, blocked or invalid endpoints, and a zero-length route", () => {
  const grid = {
    width: 3,
    depth: 3,
    blocked: ({ x }: { x: number }) => x === 1,
  };
  const start = { x: 0, z: 0 };
  expect(findPath(grid, start, { x: 2, z: 2 })).toBeNull();
  expect(findPath(grid, start, { x: 1, z: 0 })).toBeNull();
  expect(findPath(grid, start, { x: 0.5, z: 1 })).toBeNull();
  expect(findPath(grid, { x: -1, z: 1 }, start)).toBeNull();
  expect(findPath(grid, start, start)).toEqual([start]);
});
