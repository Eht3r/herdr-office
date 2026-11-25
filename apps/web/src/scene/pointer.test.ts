import { describe, expect, it } from "vitest";
import { clampTarget } from "./Campus.tsx";
import { wasDrag } from "./pointer.ts";

describe("map pointer", () => {
  it("treats a small wobble as a click and a real move as a drag", () => {
    expect(wasDrag({ delta: 2 })).toBe(false);
    expect(wasDrag({ delta: 40 })).toBe(true);
  });

  it("keeps the camera target over the map", () => {
    const limits = { minX: -10, maxX: 10, minZ: -5, maxZ: 5 };
    expect(clampTarget({ x: 3, z: 1 }, limits)).toEqual({ dx: 0, dz: 0 });
    expect(clampTarget({ x: 14, z: -9 }, limits)).toEqual({ dx: -4, dz: 4 });
  });
});
