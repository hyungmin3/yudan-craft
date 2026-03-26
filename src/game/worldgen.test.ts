import { describe, expect, it } from "vitest";
import { createInitialWorldMeta, createWorldSave, VoxelWorld } from "./logic";

describe("world generation", () => {
  it("reproduces the same biome and surface for the same seed", () => {
    const meta = createInitialWorldMeta("Test", "seed-123", "survival");
    const save = createWorldSave(meta);
    const worldA = new VoxelWorld(save);
    const worldB = new VoxelWorld(save);

    const biomeA = worldA.getBiomeId("overworld", 64, 64);
    const biomeB = worldB.getBiomeId("overworld", 64, 64);
    const surfaceA = worldA.findSurfaceY("overworld", 64, 64);
    const surfaceB = worldB.findSurfaceY("overworld", 64, 64);

    expect(biomeA).toBe(biomeB);
    expect(surfaceA).toBe(surfaceB);
  });
});
