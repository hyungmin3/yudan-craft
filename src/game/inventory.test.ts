import { describe, expect, it } from "vitest";
import {
  addItemToInventory,
  countInventoryItem,
  craftRecipeInInventory,
  createEmptyInventory,
  smeltRecipeInInventory,
} from "./logic";

describe("inventory systems", () => {
  it("crafts a crafting table from planks", () => {
    const inventory = createEmptyInventory();
    addItemToInventory(inventory, "oak_planks", 4);

    const crafted = craftRecipeInInventory(inventory, "crafting_table");

    expect(crafted).toBe(true);
    expect(countInventoryItem(inventory, "crafting_table")).toBe(1);
  });

  it("smelts iron ore when coal is available", () => {
    const inventory = createEmptyInventory();
    addItemToInventory(inventory, "iron_ore", 1);
    addItemToInventory(inventory, "coal", 1);

    const smelted = smeltRecipeInInventory(inventory, "iron_ingot_from_ore");

    expect(smelted).toBe(true);
    expect(countInventoryItem(inventory, "iron_ingot")).toBe(1);
  });
});
