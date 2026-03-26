export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export const GAME_MODES = ["survival", "creative", "hardcore"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const DIMENSION_IDS = ["overworld", "nether", "end"] as const;
export type DimensionId = (typeof DIMENSION_IDS)[number];

export const BIOME_IDS = [
  "plains",
  "savanna",
  "desert",
  "snowy_tundra",
  "taiga",
  "mountains",
  "diamond_land",
  "nether_wastes",
  "the_end",
] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export const BLOCK_IDS = [
  "air",
  "grass",
  "dirt",
  "stone",
  "cobblestone",
  "oak_log",
  "oak_leaves",
  "oak_planks",
  "sand",
  "snow",
  "obsidian",
  "portal",
  "end_portal",
  "diamond_block",
  "netherrack",
  "end_stone",
  "moonstone_ore",
  "coal_ore",
  "iron_ore",
  "lapis_ore",
  "gold_ore",
  "redstone_ore",
  "diamond_ore",
  "emerald_ore",
  "amethyst_block",
  "fossil_block",
  "ancient_debris",
  "chest",
  "crafting_table",
  "furnace",
  "stone_bricks",
  "school_brick",
  "bedrock",
  "portal_frame",
  "torch",
  "glowstone",
] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

export const ITEM_IDS = [
  "grass",
  "dirt",
  "stone",
  "cobblestone",
  "oak_log",
  "oak_planks",
  "sand",
  "snow",
  "obsidian",
  "diamond_block",
  "netherrack",
  "end_stone",
  "amethyst_block",
  "fossil_block",
  "iron_ore",
  "gold_ore",
  "ancient_debris",
  "chest",
  "crafting_table",
  "furnace",
  "stone_bricks",
  "school_brick",
  "torch",
  "glowstone",
  "coal",
  "raw_iron",
  "raw_gold",
  "iron_ingot",
  "gold_ingot",
  "diamond",
  "emerald",
  "redstone",
  "lapis",
  "moonstone_shard",
  "netherite_scrap",
  "netherite_ingot",
  "stick",
  "eye_of_ender",
  "flint_and_steel",
  "wooden_pickaxe",
  "stone_pickaxe",
  "iron_pickaxe",
  "diamond_pickaxe",
  "netherite_pickaxe",
  "wooden_shovel",
  "stone_shovel",
  "iron_shovel",
  "diamond_shovel",
  "netherite_shovel",
  "wooden_axe",
  "stone_axe",
  "iron_axe",
  "diamond_axe",
  "netherite_axe",
  "wooden_sword",
  "stone_sword",
  "iron_sword",
  "diamond_sword",
  "netherite_sword",
] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const MOB_IDS = [
  "sheep",
  "pig",
  "cow",
  "chicken",
  "wolf",
  "villager",
  "golem",
  "zombie",
  "skeleton",
  "creeper",
  "spider",
  "ender_dragon",
] as const;
export type MobId = (typeof MOB_IDS)[number];

export const STRUCTURE_IDS = [
  "oak_tree",
  "village",
  "school",
  "dungeon",
  "stronghold",
] as const;
export type StructureId = (typeof STRUCTURE_IDS)[number];

export type ToolType = "pickaxe" | "shovel" | "axe" | "sword";
export type MobBehavior = "passive" | "neutral" | "hostile" | "boss";

export interface BlockDef {
  id: BlockId;
  name: string;
  solid: boolean;
  transparent?: boolean;
  placeable?: boolean;
  interactable?: boolean;
  portal?: boolean;
  lightLevel?: number;
  hardness: number;
  color: number;
  topColor?: number;
  sideColor?: number;
  bottomColor?: number;
  dropItemId?: ItemId;
  requiredTool?: ToolType;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  maxStack: number;
  blockId?: BlockId;
  toolType?: ToolType;
  miningPower?: number;
  attackDamage?: number;
  fuelValue?: number;
}

export interface CraftingRecipeDef {
  id: string;
  type: "crafting";
  station: "inventory" | "crafting_table";
  ingredients: Array<{ itemId: ItemId; count: number }>;
  result: { itemId: ItemId; count: number };
}

export interface FurnaceRecipeDef {
  id: string;
  type: "furnace";
  input: ItemId;
  output: { itemId: ItemId; count: number };
  fuelCost: number;
}

export type RecipeDef = CraftingRecipeDef | FurnaceRecipeDef;

export interface BiomeDef {
  id: BiomeId;
  name: string;
  topBlockId: BlockId;
  fillerBlockId: BlockId;
  treeChance: number;
  color: number;
}

export interface MobDef {
  id: MobId;
  name: string;
  behavior: MobBehavior;
  color: number;
  health: number;
  attack: number;
  speed: number;
  airborne?: boolean;
}

export interface StructureDef {
  id: StructureId;
  name: string;
  dimensions: Vec3Like;
}

export interface WorldGenConfig {
  chunkSize: number;
  worldHeight: number;
  seaLevel: number;
}

export interface InventorySlot {
  itemId: ItemId;
  count: number;
}

export interface InventoryState {
  slots: Array<InventorySlot | null>;
}

export interface ContainerState {
  slots: Array<InventorySlot | null>;
}

export interface PlayerState {
  position: Vec3Like;
  velocity: Vec3Like;
  yaw: number;
  pitch: number;
  dimension: DimensionId;
  mode: GameMode;
  health: number;
  hunger: number;
  selectedHotbarIndex: number;
  inventory: InventoryState;
  respawnPosition: Vec3Like;
  flightEnabled: boolean;
  isFlying: boolean;
}

export interface WorldMeta {
  id: string;
  name: string;
  seed: string;
  mode: GameMode;
  createdAt: string;
  lastPlayedAt: string;
  completed: boolean;
  locked: boolean;
}

export interface BlockEntityData {
  kind: "chest" | "furnace" | "portal_frame";
  dimension: DimensionId;
  x: number;
  y: number;
  z: number;
  inventory?: ContainerState;
  extra?: Record<string, number | boolean | string>;
}

export interface ChunkSnapshot {
  dimension: DimensionId;
  chunkX: number;
  chunkZ: number;
  blocks: number[];
}

export interface WorldSave {
  meta: WorldMeta;
  player: PlayerState;
  modifiedChunks: ChunkSnapshot[];
  blockEntities: BlockEntityData[];
}

export interface SaveRepository {
  listWorlds(): Promise<WorldMeta[]>;
  createWorld(meta: WorldMeta, save: WorldSave): Promise<void>;
  loadWorld(id: string): Promise<WorldSave | null>;
  saveWorld(save: WorldSave): Promise<void>;
  deleteWorld(id: string): Promise<void>;
}

export interface ChunkProvider {
  getBlockId(
    dimension: DimensionId,
    x: number,
    y: number,
    z: number,
  ): BlockId;
  setBlockId(
    dimension: DimensionId,
    x: number,
    y: number,
    z: number,
    blockId: BlockId,
  ): void;
}

export interface InputProfile {
  moveX: number;
  moveZ: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  descend: boolean;
  breakHeld: boolean;
  placePressed: boolean;
  interactPressed: boolean;
  attackPressed: boolean;
  inventoryPressed: boolean;
  mapPressed: boolean;
  toggleFlightPressed: boolean;
  pointerLocked: boolean;
  selectedHotbar: number | null;
  hotbarScrollDelta: number;
  consumeFrameState(): void;
}

export interface PortalResolver {
  tryActivateNetherPortal(position: Vec3Like): boolean;
  tryFillEndPortalFrame(position: Vec3Like): boolean;
}

export interface CombatRules {
  getAttackDamage(itemId: ItemId | null): number;
  canBreakBlock(
    blockId: BlockId,
    heldItemId: ItemId | null,
  ): { allowed: boolean; speed: number };
}



