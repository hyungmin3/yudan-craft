import type { RecipeDef } from "../game/contracts";

export const RECIPES: RecipeDef[] = [
  {
    id: "planks_from_log",
    type: "crafting",
    station: "inventory",
    ingredients: [{ itemId: "oak_log", count: 1 }],
    result: { itemId: "oak_planks", count: 4 },
  },
  {
    id: "sticks_from_planks",
    type: "crafting",
    station: "inventory",
    ingredients: [{ itemId: "oak_planks", count: 2 }],
    result: { itemId: "stick", count: 4 },
  },
  {
    id: "torch",
    type: "crafting",
    station: "inventory",
    ingredients: [
      { itemId: "coal", count: 1 },
      { itemId: "stick", count: 1 },
    ],
    result: { itemId: "torch", count: 4 },
  },
  {
    id: "crafting_table",
    type: "crafting",
    station: "inventory",
    ingredients: [{ itemId: "oak_planks", count: 4 }],
    result: { itemId: "crafting_table", count: 1 },
  },
  {
    id: "chest",
    type: "crafting",
    station: "crafting_table",
    ingredients: [{ itemId: "oak_planks", count: 8 }],
    result: { itemId: "chest", count: 1 },
  },
  {
    id: "furnace",
    type: "crafting",
    station: "crafting_table",
    ingredients: [{ itemId: "cobblestone", count: 8 }],
    result: { itemId: "furnace", count: 1 },
  },
  {
    id: "wooden_pickaxe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "oak_planks", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "wooden_pickaxe", count: 1 },
  },
  {
    id: "stone_pickaxe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "cobblestone", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "stone_pickaxe", count: 1 },
  },
  {
    id: "iron_pickaxe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "iron_ingot", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "iron_pickaxe", count: 1 },
  },
  {
    id: "diamond_pickaxe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "diamond", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "diamond_pickaxe", count: 1 },
  },
  {
    id: "netherite_pickaxe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "netherite_ingot", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "netherite_pickaxe", count: 1 },
  },
  {
    id: "wooden_shovel",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "oak_planks", count: 1 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "wooden_shovel", count: 1 },
  },
  {
    id: "stone_shovel",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "cobblestone", count: 1 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "stone_shovel", count: 1 },
  },
  {
    id: "iron_shovel",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "iron_ingot", count: 1 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "iron_shovel", count: 1 },
  },
  {
    id: "diamond_shovel",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "diamond", count: 1 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "diamond_shovel", count: 1 },
  },
  {
    id: "netherite_shovel",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "netherite_ingot", count: 1 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "netherite_shovel", count: 1 },
  },
  {
    id: "wooden_axe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "oak_planks", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "wooden_axe", count: 1 },
  },
  {
    id: "stone_axe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "cobblestone", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "stone_axe", count: 1 },
  },
  {
    id: "iron_axe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "iron_ingot", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "iron_axe", count: 1 },
  },
  {
    id: "diamond_axe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "diamond", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "diamond_axe", count: 1 },
  },
  {
    id: "netherite_axe",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "netherite_ingot", count: 3 },
      { itemId: "stick", count: 2 },
    ],
    result: { itemId: "netherite_axe", count: 1 },
  },
  {
    id: "wooden_sword",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "oak_planks", count: 2 },
      { itemId: "stick", count: 1 },
    ],
    result: { itemId: "wooden_sword", count: 1 },
  },
  {
    id: "stone_sword",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "cobblestone", count: 2 },
      { itemId: "stick", count: 1 },
    ],
    result: { itemId: "stone_sword", count: 1 },
  },
  {
    id: "iron_sword",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "iron_ingot", count: 2 },
      { itemId: "stick", count: 1 },
    ],
    result: { itemId: "iron_sword", count: 1 },
  },
  {
    id: "diamond_sword",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "diamond", count: 2 },
      { itemId: "stick", count: 1 },
    ],
    result: { itemId: "diamond_sword", count: 1 },
  },
  {
    id: "netherite_sword",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "netherite_ingot", count: 2 },
      { itemId: "stick", count: 1 },
    ],
    result: { itemId: "netherite_sword", count: 1 },
  },
  {
    id: "flint_and_steel",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "iron_ingot", count: 1 },
      { itemId: "moonstone_shard", count: 1 },
    ],
    result: { itemId: "flint_and_steel", count: 1 },
  },
  {
    id: "eye_of_ender",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "moonstone_shard", count: 1 },
      { itemId: "diamond", count: 1 },
    ],
    result: { itemId: "eye_of_ender", count: 1 },
  },
  {
    id: "stone_bricks",
    type: "crafting",
    station: "crafting_table",
    ingredients: [{ itemId: "stone", count: 4 }],
    result: { itemId: "stone_bricks", count: 4 },
  },
  {
    id: "netherite_ingot",
    type: "crafting",
    station: "crafting_table",
    ingredients: [
      { itemId: "netherite_scrap", count: 4 },
      { itemId: "gold_ingot", count: 4 },
    ],
    result: { itemId: "netherite_ingot", count: 1 },
  },
  {
    id: "iron_ingot_from_raw_iron",
    type: "furnace",
    input: "raw_iron",
    output: { itemId: "iron_ingot", count: 1 },
    fuelCost: 1,
  },
  {
    id: "gold_ingot_from_raw_gold",
    type: "furnace",
    input: "raw_gold",
    output: { itemId: "gold_ingot", count: 1 },
    fuelCost: 1,
  },
  {
    id: "iron_ingot_from_ore",
    type: "furnace",
    input: "iron_ore",
    output: { itemId: "iron_ingot", count: 1 },
    fuelCost: 1,
  },
  {
    id: "gold_ingot_from_ore",
    type: "furnace",
    input: "gold_ore",
    output: { itemId: "gold_ingot", count: 1 },
    fuelCost: 1,
  },
  {
    id: "netherite_scrap_from_debris",
    type: "furnace",
    input: "ancient_debris",
    output: { itemId: "netherite_scrap", count: 1 },
    fuelCost: 2,
  },
];

