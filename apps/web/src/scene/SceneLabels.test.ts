import { describe, expect, it } from "vitest";
import { centeredRect, overlaps } from "./SceneLabels.tsx";

describe("label collision", () => {
  it("detects labels drawn on top of each other", () => {
    expect(
      overlaps(centeredRect(100, 100, 80, 20), centeredRect(130, 105, 80, 20)),
    ).toBe(true);
  });

  it("keeps labels that are apart", () => {
    expect(
      overlaps(centeredRect(100, 100, 80, 20), centeredRect(100, 140, 80, 20)),
    ).toBe(false);
  });
});
