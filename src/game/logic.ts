import * as THREE from "three";
import {
  BIOME_DEFS,
  BLOCK_DEFS,
  ITEM_DEFS,
  STRUCTURE_DEFS,
  WORLD_GEN_CONFIG,
} from "../data/catalog";
import { RECIPES } from "../data/recipes";
import { getBlockFaceUv } from "../render/voxelArt";
import {
  BLOCK_IDS,
  type BiomeId,
  type BlockEntityData,
  type BlockId,
  type ChunkProvider,
  type ChunkSnapshot,
  type CombatRules,
  type ContainerState,
  type CraftingRecipeDef,
  type DimensionId,
  type FurnaceRecipeDef,
  type GameMode,
  type InventoryState,
  type ItemId,
  type PlayerState,
  type PortalResolver,
  type SaveRepository,
  type Vec3Like,
  type WorldMeta,
  type WorldSave,
} from "./contracts";

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;
export const CHEST_SIZE = 27;
const WORLD_STORE = "worlds";

const BLOCK_INDEX_BY_ID = new Map<BlockId, number>(
  BLOCK_IDS.map((id, index) => [id, index]),
);

const FACE_DEFS = [
  {
    direction: new THREE.Vector3(0, 1, 0),
    shade: 1,
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
  },
  {
    direction: new THREE.Vector3(0, -1, 0),
    shade: 0.6,
    corners: [
      [0, 0, 1],
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
    ],
  },
  {
    direction: new THREE.Vector3(0, 0, 1),
    shade: 0.82,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    direction: new THREE.Vector3(0, 0, -1),
    shade: 0.82,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    direction: new THREE.Vector3(1, 0, 0),
    shade: 0.72,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    direction: new THREE.Vector3(-1, 0, 0),
    shade: 0.72,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
] as const;

export interface ChunkData {
  dimension: DimensionId;
  chunkX: number;
  chunkZ: number;
  blocks: Uint16Array;
  dirty: boolean;
  modified: boolean;
}

export interface SmeltableOption {
  recipe: FurnaceRecipeDef;
  canCraft: boolean;
}

export interface CraftableOption {
  recipe: CraftingRecipeDef;
  canCraft: boolean;
}

export function seedToNumber(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function hashNumbers(seed: number, ...values: number[]): number {
  let hash = seed | 0;
  for (const value of values) {
    hash = Math.imul(hash ^ (value | 0), 1597334677);
    hash ^= hash >>> 15;
  }
  return hash >>> 0;
}

function noise2(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);
  const a = hashNumbers(seed, x0, z0) / 0xffffffff;
  const b = hashNumbers(seed, x1, z0) / 0xffffffff;
  const c = hashNumbers(seed, x0, z1) / 0xffffffff;
  const d = hashNumbers(seed, x1, z1) / 0xffffffff;
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz) * 2 - 1;
}

function noise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const tx = smoothstep(x - xi);
  const ty = smoothstep(y - yi);
  const tz = smoothstep(z - zi);
  const sample = (sx: number, sy: number, sz: number) =>
    hashNumbers(seed, sx, sy, sz) / 0xffffffff;
  const c000 = sample(xi, yi, zi);
  const c100 = sample(xi + 1, yi, zi);
  const c010 = sample(xi, yi + 1, zi);
  const c110 = sample(xi + 1, yi + 1, zi);
  const c001 = sample(xi, yi, zi + 1);
  const c101 = sample(xi + 1, yi, zi + 1);
  const c011 = sample(xi, yi + 1, zi + 1);
  const c111 = sample(xi + 1, yi + 1, zi + 1);
  const x00 = lerp(c000, c100, tx);
  const x10 = lerp(c010, c110, tx);
  const x01 = lerp(c001, c101, tx);
  const x11 = lerp(c011, c111, tx);
  const y0 = lerp(x00, x10, ty);
  const y1 = lerp(x01, x11, ty);
  return lerp(y0, y1, tz) * 2 - 1;
}

function fbm2(
  seed: number,
  x: number,
  z: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += noise2(seed + octave * 97, x * frequency, z * frequency) * amplitude;
    normalizer += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total / normalizer;
}

function fbm3(seed: number, x: number, y: number, z: number, octaves = 3): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total +=
      noise3(seed + octave * 53, x * frequency, y * frequency, z * frequency) *
      amplitude;
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / normalizer;
}

function blockIndex(blockId: BlockId): number {
  return BLOCK_INDEX_BY_ID.get(blockId) ?? 0;
}

function blockIdFromIndex(index: number): BlockId {
  return BLOCK_IDS[index] ?? "air";
}

function makeChunkKey(dimension: DimensionId, chunkX: number, chunkZ: number): string {
  return `${dimension}:${chunkX}:${chunkZ}`;
}

function makeBlockEntityKey(
  dimension: DimensionId,
  x: number,
  y: number,
  z: number,
): string {
  return `${dimension}:${x}:${y}:${z}`;
}

function localIndex(x: number, y: number, z: number): number {
  return (
    y * WORLD_GEN_CONFIG.chunkSize * WORLD_GEN_CONFIG.chunkSize +
    z * WORLD_GEN_CONFIG.chunkSize +
    x
  );
}

export function createEmptyInventory(size = INVENTORY_SIZE): InventoryState {
  return { slots: Array.from({ length: size }, () => null) };
}

export function cloneInventory(inventory: InventoryState): InventoryState {
  return {
    slots: inventory.slots.map((slot) => (slot ? { ...slot } : null)),
  };
}

export function createEmptyContainer(size = CHEST_SIZE): ContainerState {
  return { slots: Array.from({ length: size }, () => null) };
}

export function countInventoryItem(
  inventory: InventoryState | ContainerState,
  itemId: ItemId,
): number {
  return inventory.slots.reduce((total, slot) => {
    if (!slot || slot.itemId !== itemId) {
      return total;
    }
    return total + slot.count;
  }, 0);
}

export function addItemToInventory(
  inventory: InventoryState | ContainerState,
  itemId: ItemId,
  count: number,
): number {
  let remaining = count;
  const itemDef = ITEM_DEFS[itemId];

  for (const slot of inventory.slots) {
    if (!slot || slot.itemId !== itemId) {
      continue;
    }
    const space = itemDef.maxStack - slot.count;
    if (space <= 0) {
      continue;
    }
    const amount = Math.min(space, remaining);
    slot.count += amount;
    remaining -= amount;
    if (remaining <= 0) {
      return 0;
    }
  }

  for (let index = 0; index < inventory.slots.length; index += 1) {
    if (inventory.slots[index]) {
      continue;
    }
    const amount = Math.min(itemDef.maxStack, remaining);
    inventory.slots[index] = { itemId, count: amount };
    remaining -= amount;
    if (remaining <= 0) {
      return 0;
    }
  }

  return remaining;
}

export function removeItemsFromInventory(
  inventory: InventoryState | ContainerState,
  itemId: ItemId,
  count: number,
): boolean {
  if (countInventoryItem(inventory, itemId) < count) {
    return false;
  }

  let remaining = count;
  for (let index = inventory.slots.length - 1; index >= 0; index -= 1) {
    const slot = inventory.slots[index];
    if (!slot || slot.itemId !== itemId) {
      continue;
    }
    const amount = Math.min(slot.count, remaining);
    slot.count -= amount;
    remaining -= amount;
    if (slot.count <= 0) {
      inventory.slots[index] = null;
    }
    if (remaining <= 0) {
      return true;
    }
  }
  return true;
}

export function moveInventoryStack(
  source: InventoryState | ContainerState,
  destination: InventoryState | ContainerState,
  index: number,
): void {
  const slot = source.slots[index];
  if (!slot) {
    return;
  }
  const remaining = addItemToInventory(destination, slot.itemId, slot.count);
  if (remaining <= 0) {
    source.slots[index] = null;
    return;
  }
  slot.count = remaining;
}
export function transferInventorySlot(
  source: InventoryState | ContainerState,
  sourceIndex: number,
  destination: InventoryState | ContainerState,
  destinationIndex: number,
): boolean {
  const sourceSlot = source.slots[sourceIndex];
  if (!sourceSlot) {
    return false;
  }
  if (source === destination && sourceIndex === destinationIndex) {
    return false;
  }

  const targetSlot = destination.slots[destinationIndex];
  if (!targetSlot) {
    destination.slots[destinationIndex] = { ...sourceSlot };
    source.slots[sourceIndex] = null;
    return true;
  }

  if (targetSlot.itemId === sourceSlot.itemId) {
    const maxStack = ITEM_DEFS[sourceSlot.itemId].maxStack;
    if (targetSlot.count < maxStack) {
      const moved = Math.min(maxStack - targetSlot.count, sourceSlot.count);
      targetSlot.count += moved;
      sourceSlot.count -= moved;
      if (sourceSlot.count <= 0) {
        source.slots[sourceIndex] = null;
      }
      return moved > 0;
    }
  }

  destination.slots[destinationIndex] = { ...sourceSlot };
  source.slots[sourceIndex] = { ...targetSlot };
  return true;
}

export function movePlayerInventorySlot(
  inventory: InventoryState,
  index: number,
  preferredHotbarIndex = 0,
): boolean {
  const source = inventory.slots[index];
  if (!source) {
    return false;
  }

  const movingToHotbar = index >= HOTBAR_SIZE;
  const destinationIndexes = movingToHotbar
    ? [preferredHotbarIndex, ...Array.from({ length: HOTBAR_SIZE }, (_, slotIndex) => slotIndex).filter((slotIndex) => slotIndex !== preferredHotbarIndex)]
    : Array.from({ length: inventory.slots.length - HOTBAR_SIZE }, (_, offset) => HOTBAR_SIZE + offset);
  const maxStack = ITEM_DEFS[source.itemId].maxStack;

  for (const destinationIndex of destinationIndexes) {
    if (destinationIndex === index) continue;
    const target = inventory.slots[destinationIndex];
    if (!target || target.itemId !== source.itemId || target.count >= maxStack) continue;
    const moved = Math.min(maxStack - target.count, source.count);
    target.count += moved;
    source.count -= moved;
    if (source.count <= 0) {
      inventory.slots[index] = null;
      return true;
    }
  }

  for (const destinationIndex of destinationIndexes) {
    if (destinationIndex === index) continue;
    if (inventory.slots[destinationIndex]) continue;
    inventory.slots[destinationIndex] = { ...source };
    inventory.slots[index] = null;
    return true;
  }

  if (!movingToHotbar) {
    return false;
  }

  const fallbackIndex = Math.max(0, Math.min(HOTBAR_SIZE - 1, preferredHotbarIndex));
  if (fallbackIndex === index || fallbackIndex >= inventory.slots.length) {
    return false;
  }

  const fallback = inventory.slots[fallbackIndex];
  inventory.slots[fallbackIndex] = { ...source };
  inventory.slots[index] = fallback ? { ...fallback } : null;
  return true;
}

export function getCraftingOptions(
  inventory: InventoryState,
  station: "inventory" | "crafting_table",
): CraftableOption[] {
  return RECIPES.filter(
    (recipe): recipe is CraftingRecipeDef =>
      recipe.type === "crafting" && recipe.station === station,
  ).map((recipe) => ({
    recipe,
    canCraft: recipe.ingredients.every(
      (ingredient) =>
        countInventoryItem(inventory, ingredient.itemId) >= ingredient.count,
    ),
  }));
}

export function craftRecipeInInventory(
  inventory: InventoryState,
  recipeId: string,
): boolean {
  const recipe = RECIPES.find(
    (candidate): candidate is CraftingRecipeDef =>
      candidate.type === "crafting" && candidate.id === recipeId,
  );
  if (!recipe) {
    return false;
  }
  if (
    !recipe.ingredients.every(
      (ingredient) =>
        countInventoryItem(inventory, ingredient.itemId) >= ingredient.count,
    )
  ) {
    return false;
  }
  for (const ingredient of recipe.ingredients) {
    removeItemsFromInventory(inventory, ingredient.itemId, ingredient.count);
  }
  addItemToInventory(inventory, recipe.result.itemId, recipe.result.count);
  return true;
}

export function getFurnaceOptions(
  inventory: InventoryState,
): SmeltableOption[] {
  return RECIPES.filter(
    (recipe): recipe is FurnaceRecipeDef => recipe.type === "furnace",
  ).map((recipe) => ({
    recipe,
    canCraft:
      countInventoryItem(inventory, recipe.input) >= 1 &&
      countInventoryItem(inventory, "coal") >= recipe.fuelCost,
  }));
}

export function smeltRecipeInInventory(
  inventory: InventoryState,
  recipeId: string,
): boolean {
  const recipe = RECIPES.find(
    (candidate): candidate is FurnaceRecipeDef =>
      candidate.type === "furnace" && candidate.id === recipeId,
  );
  if (!recipe) {
    return false;
  }
  if (
    countInventoryItem(inventory, recipe.input) < 1 ||
    countInventoryItem(inventory, "coal") < recipe.fuelCost
  ) {
    return false;
  }
  removeItemsFromInventory(inventory, recipe.input, 1);
  if (recipe.fuelCost > 0) {
    removeItemsFromInventory(inventory, "coal", recipe.fuelCost);
  }
  addItemToInventory(inventory, recipe.output.itemId, recipe.output.count);
  return true;
}

export function createStarterInventory(mode: GameMode): InventoryState {
  const inventory = createEmptyInventory();
  if (mode === "creative") {
    addItemToInventory(inventory, "grass", 64);
    addItemToInventory(inventory, "stone", 64);
    addItemToInventory(inventory, "oak_planks", 64);
    addItemToInventory(inventory, "obsidian", 32);
    addItemToInventory(inventory, "diamond_block", 64);
    addItemToInventory(inventory, "crafting_table", 4);
    addItemToInventory(inventory, "furnace", 4);
    addItemToInventory(inventory, "chest", 8);
    addItemToInventory(inventory, "flint_and_steel", 1);
    addItemToInventory(inventory, "eye_of_ender", 16);
    addItemToInventory(inventory, "diamond_pickaxe", 1);
    addItemToInventory(inventory, "diamond_sword", 1);
    addItemToInventory(inventory, "torch", 32);
    addItemToInventory(inventory, "moonstone_shard", 32);
    return inventory;
  }

  addItemToInventory(inventory, "oak_log", 12);
  addItemToInventory(inventory, "oak_planks", 16);
  addItemToInventory(inventory, "stick", 8);
  addItemToInventory(inventory, "wooden_pickaxe", 1);
  addItemToInventory(inventory, "wooden_sword", 1);
  addItemToInventory(inventory, "crafting_table", 1);
  addItemToInventory(inventory, "coal", 12);
  addItemToInventory(inventory, "torch", 8);
  addItemToInventory(inventory, "moonstone_shard", 4);
  return inventory;
}

export function createDefaultPlayerState(
  mode: GameMode,
  spawn: Vec3Like,
): PlayerState {
  return {
    position: { ...spawn },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    dimension: "overworld",
    mode,
    health: 20,
    hunger: 20,
    selectedHotbarIndex: 0,
    inventory: createStarterInventory(mode),
    respawnPosition: { ...spawn },
    flightEnabled: mode === "creative",
    isFlying: false,
  };
}

export function clonePlayerState(player: PlayerState): PlayerState {
  return {
    ...player,
    position: { ...player.position },
    velocity: { ...player.velocity },
    respawnPosition: { ...player.respawnPosition },
    inventory: cloneInventory(player.inventory),
    isFlying: player.isFlying ?? false,
  };
}

export function getHeldItemId(player: PlayerState): ItemId | null {
  return player.inventory.slots[player.selectedHotbarIndex]?.itemId ?? null;
}

export class IndexedDbSaveRepository implements SaveRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async listWorlds(): Promise<WorldMeta[]> {
    const db = await this.openDb();
    const worlds = await new Promise<WorldSave[]>((resolve, reject) => {
      const transaction = db.transaction(WORLD_STORE, "readonly");
      const request = transaction.objectStore(WORLD_STORE).getAll();
      request.onsuccess = () => resolve(request.result as WorldSave[]);
      request.onerror = () => reject(request.error);
    });
    return worlds
      .map((world) => world.meta)
      .sort((left, right) => right.lastPlayedAt.localeCompare(left.lastPlayedAt));
  }

  async createWorld(meta: WorldMeta, save: WorldSave): Promise<void> {
    await this.put(meta.id, save);
  }

  async loadWorld(id: string): Promise<WorldSave | null> {
    const db = await this.openDb();
    return new Promise<WorldSave | null>((resolve, reject) => {
      const transaction = db.transaction(WORLD_STORE, "readonly");
      const request = transaction.objectStore(WORLD_STORE).get(id);
      request.onsuccess = () => resolve((request.result as WorldSave) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async saveWorld(save: WorldSave): Promise<void> {
    await this.put(save.meta.id, save);
  }

  async deleteWorld(id: string): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(WORLD_STORE, "readwrite");
      const request = transaction.objectStore(WORLD_STORE).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async put(id: string, save: WorldSave): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(WORLD_STORE, "readwrite");
      const request = transaction.objectStore(WORLD_STORE).put(save, id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("yudan-craft-db", 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(WORLD_STORE)) {
            db.createObjectStore(WORLD_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }
}

function createLootContainer(seed: number, salt: number): ContainerState {
  const container = createEmptyContainer();
  const options: ItemId[] = [
    "coal",
    "iron_ingot",
    "gold_ingot",
    "diamond",
    "moonstone_shard",
    "stick",
    "eye_of_ender",
  ];
  const slots = 5 + (hashNumbers(seed, salt) % 4);
  for (let index = 0; index < slots; index += 1) {
    const roll = hashNumbers(seed + salt, index, slots);
    const itemId = options[roll % options.length] ?? "coal";
    const count = 1 + (roll % (itemId === "diamond" || itemId === "eye_of_ender" ? 2 : 6));
    addItemToInventory(container, itemId, count);
  }
  return container;
}

function shouldCarveCave(seed: number, x: number, y: number, z: number): boolean {
  const caveValue = fbm3(seed + 301, x / 28, y / 20, z / 28, 4);
  return caveValue > 0.56 && y > 8 && y < WORLD_GEN_CONFIG.worldHeight - 28;
}

export function getBiomeIdAt(
  seed: number,
  dimension: DimensionId,
  x: number,
  z: number,
): BiomeId {
  if (dimension === "nether") {
    return "nether_wastes";
  }
  if (dimension === "end") {
    return "the_end";
  }

  const diamondSignal = fbm2(seed + 403, x / 260, z / 260, 3);
  if (diamondSignal > 0.62) {
    return "diamond_land";
  }

  const temperature = fbm2(seed + 101, x / 190, z / 190, 4);
  const moisture = fbm2(seed + 211, x / 210, z / 210, 4);
  const ridge = Math.abs(fbm2(seed + 311, x / 120, z / 120, 3));
  if (ridge > 0.58) {
    return "mountains";
  }
  if (temperature > 0.45 && moisture < -0.1) {
    return "desert";
  }
  if (temperature > 0.3 && moisture < 0.15) {
    return "savanna";
  }
  if (temperature < -0.18) {
    return "snowy_tundra";
  }
  if (moisture > 0.2) {
    return "taiga";
  }
  return "plains";
}

function getOverworldSurfaceHeight(seed: number, x: number, z: number, biome: BiomeId): number {
  const base = WORLD_GEN_CONFIG.seaLevel;
  const broad = fbm2(seed + 5, x / 180, z / 180, 5) * 18;
  const detail = fbm2(seed + 17, x / 55, z / 55, 3) * 6;
  let height = base + broad + detail;
  if (biome === "mountains") {
    height += 18 + Math.abs(fbm2(seed + 55, x / 44, z / 44, 4)) * 22;
  } else if (biome === "desert") {
    height += 2;
  } else if (biome === "snowy_tundra") {
    height += 4;
  } else if (biome === "diamond_land") {
    height += 8;
  }
  return Math.round(clamp(height, 92, WORLD_GEN_CONFIG.worldHeight - 12));
}

function getNetherSurfaceHeight(seed: number, x: number, z: number): number {
  const base = 38;
  const noise = fbm2(seed + 71, x / 120, z / 120, 4) * 16;
  return Math.round(clamp(base + noise, 24, 76));
}

function isAllowedVillageBiome(biome: BiomeId): boolean {
  return [
    "plains",
    "savanna",
    "desert",
    "snowy_tundra",
    "taiga",
    "diamond_land",
  ].includes(biome);
}

function strongholdOrigin(seed: number): Vec3Like {
  const offsetX = 220 + (seed % 80);
  const offsetZ = -180 - ((seed >>> 3) % 120);
  return { x: offsetX, y: 24, z: offsetZ };
}

function intersectsChunk(
  chunkX: number,
  chunkZ: number,
  originX: number,
  originZ: number,
  sizeX: number,
  sizeZ: number,
): boolean {
  const minX = chunkX * WORLD_GEN_CONFIG.chunkSize;
  const minZ = chunkZ * WORLD_GEN_CONFIG.chunkSize;
  const maxX = minX + WORLD_GEN_CONFIG.chunkSize - 1;
  const maxZ = minZ + WORLD_GEN_CONFIG.chunkSize - 1;
  return !(
    originX + sizeX < minX ||
    originZ + sizeZ < minZ ||
    originX > maxX ||
    originZ > maxZ
  );
}

export class VoxelWorld implements ChunkProvider, PortalResolver, CombatRules {
  readonly meta: WorldMeta;
  readonly seedNumber: number;
  readonly chunks = new Map<string, ChunkData>();
  readonly blockEntities = new Map<string, BlockEntityData>();
  readonly persistedSnapshots = new Map<string, ChunkSnapshot>();

  constructor(save: WorldSave) {
    this.meta = { ...save.meta };
    this.seedNumber = seedToNumber(save.meta.seed);
    for (const snapshot of save.modifiedChunks) {
      this.persistedSnapshots.set(
        makeChunkKey(snapshot.dimension, snapshot.chunkX, snapshot.chunkZ),
        snapshot,
      );
    }
    for (const entity of save.blockEntities) {
      this.blockEntities.set(
        makeBlockEntityKey(entity.dimension, entity.x, entity.y, entity.z),
        {
          ...entity,
          inventory: entity.inventory
            ? { slots: entity.inventory.slots.map((slot) => (slot ? { ...slot } : null)) }
            : undefined,
          extra: entity.extra ? { ...entity.extra } : undefined,
        },
      );
    }
  }

  getBlockId(dimension: DimensionId, x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= WORLD_GEN_CONFIG.worldHeight) {
      return "air";
    }
    const chunkX = Math.floor(x / WORLD_GEN_CONFIG.chunkSize);
    const chunkZ = Math.floor(z / WORLD_GEN_CONFIG.chunkSize);
    const chunk = this.ensureChunk(dimension, chunkX, chunkZ);
    const localX =
      ((x % WORLD_GEN_CONFIG.chunkSize) + WORLD_GEN_CONFIG.chunkSize) %
      WORLD_GEN_CONFIG.chunkSize;
    const localZ =
      ((z % WORLD_GEN_CONFIG.chunkSize) + WORLD_GEN_CONFIG.chunkSize) %
      WORLD_GEN_CONFIG.chunkSize;
    return blockIdFromIndex(chunk.blocks[localIndex(localX, y, localZ)] ?? 0);
  }

  setBlockId(
    dimension: DimensionId,
    x: number,
    y: number,
    z: number,
    blockId: BlockId,
  ): void {
    if (y < 0 || y >= WORLD_GEN_CONFIG.worldHeight) {
      return;
    }
    const chunkX = Math.floor(x / WORLD_GEN_CONFIG.chunkSize);
    const chunkZ = Math.floor(z / WORLD_GEN_CONFIG.chunkSize);
    const chunk = this.ensureChunk(dimension, chunkX, chunkZ);
    const localX =
      ((x % WORLD_GEN_CONFIG.chunkSize) + WORLD_GEN_CONFIG.chunkSize) %
      WORLD_GEN_CONFIG.chunkSize;
    const localZ =
      ((z % WORLD_GEN_CONFIG.chunkSize) + WORLD_GEN_CONFIG.chunkSize) %
      WORLD_GEN_CONFIG.chunkSize;
    chunk.blocks[localIndex(localX, y, localZ)] = blockIndex(blockId);
    chunk.dirty = true;
    chunk.modified = true;
    if (localX === 0) this.ensureChunk(dimension, chunkX - 1, chunkZ).dirty = true;
    if (localX === WORLD_GEN_CONFIG.chunkSize - 1) this.ensureChunk(dimension, chunkX + 1, chunkZ).dirty = true;
    if (localZ === 0) this.ensureChunk(dimension, chunkX, chunkZ - 1).dirty = true;
    if (localZ === WORLD_GEN_CONFIG.chunkSize - 1) this.ensureChunk(dimension, chunkX, chunkZ + 1).dirty = true;
    this.persistedSnapshots.set(
      makeChunkKey(dimension, chunkX, chunkZ),
      this.snapshotChunk(chunk),
    );
  }

  getBlockEntity(
    dimension: DimensionId,
    x: number,
    y: number,
    z: number,
  ): BlockEntityData | null {
    return this.blockEntities.get(makeBlockEntityKey(dimension, x, y, z)) ?? null;
  }

  listBlockEntities(): BlockEntityData[] {
    return [...this.blockEntities.values()].map((entity) => ({
      ...entity,
      inventory: entity.inventory
        ? { slots: entity.inventory.slots.map((slot) => (slot ? { ...slot } : null)) }
        : undefined,
      extra: entity.extra ? { ...entity.extra } : undefined,
    }));
  }

  snapshotModifiedChunks(): ChunkSnapshot[] {
    for (const chunk of this.chunks.values()) {
      if (chunk.modified) {
        this.persistedSnapshots.set(
          makeChunkKey(chunk.dimension, chunk.chunkX, chunk.chunkZ),
          this.snapshotChunk(chunk),
        );
      }
    }
    return [...this.persistedSnapshots.values()];
  }

  findSurfaceY(dimension: DimensionId, x: number, z: number): number {
    for (let y = WORLD_GEN_CONFIG.worldHeight - 2; y >= 1; y -= 1) {
      const blockId = this.getBlockId(dimension, x, y, z);
      if (BLOCK_DEFS[blockId].solid && blockId !== "portal" && blockId !== "end_portal") {
        return y;
      }
    }
    return WORLD_GEN_CONFIG.seaLevel;
  }

  getBiomeId(dimension: DimensionId, x: number, z: number): BiomeId {
    return getBiomeIdAt(this.seedNumber, dimension, x, z);
  }

  getSpawnPoint(): Vec3Like {
    const x = 8;
    const z = 8;
    return {
      x: x + 0.5,
      y: this.findSurfaceY("overworld", x, z) + 2,
      z: z + 0.5,
    };
  }

  locateStronghold(): Vec3Like {
    return strongholdOrigin(this.seedNumber);
  }

  getLandmarksNear(
    dimension: DimensionId,
    center: Vec3Like,
    radius = 256,
  ): Array<{ label: string; x: number; y: number; z: number; distance: number }> {
    const landmarks: Array<{ label: string; x: number; y: number; z: number; distance: number }> = [];
    const push = (label: string, x: number, y: number, z: number) => {
      const distance = Math.hypot(x - center.x, z - center.z);
      if (distance <= radius) {
        landmarks.push({ label, x, y, z, distance });
      }
    };

    if (dimension === "overworld") {
      const regionSize = 64;
      const startRegionX = Math.floor((center.x - radius - regionSize) / regionSize);
      const endRegionX = Math.floor((center.x + radius + regionSize) / regionSize);
      const startRegionZ = Math.floor((center.z - radius - regionSize) / regionSize);
      const endRegionZ = Math.floor((center.z + radius + regionSize) / regionSize);

      for (let regionX = startRegionX; regionX <= endRegionX; regionX += 1) {
        for (let regionZ = startRegionZ; regionZ <= endRegionZ; regionZ += 1) {
          const baseX = regionX * regionSize + (hashNumbers(this.seedNumber + 1301, regionX, regionZ) % 28);
          const baseZ = regionZ * regionSize + (hashNumbers(this.seedNumber + 1401, regionX, regionZ) % 28);
          const biome = getBiomeIdAt(this.seedNumber, "overworld", baseX, baseZ);
          const surfaceY = getOverworldSurfaceHeight(this.seedNumber, baseX, baseZ, biome);
          if (isAllowedVillageBiome(biome) && hashNumbers(this.seedNumber + 1501, regionX, regionZ) % 100 > 70) {
            push("Village", baseX + 14, surfaceY + 1, baseZ + 14);
          }
          if (biome === "plains" && hashNumbers(this.seedNumber + 1601, regionX, regionZ) % 100 > 80) {
            push("School", baseX + 18, surfaceY + 1, baseZ - 1);
          }
          if (hashNumbers(this.seedNumber + 1701, regionX, regionZ) % 100 > 74) {
            push("Dungeon", baseX + 3, 18 + (Math.abs(regionX + regionZ) % 10) + 1, baseZ + 3);
          }
        }
      }

      const stronghold = strongholdOrigin(this.seedNumber);
      push("Stronghold", stronghold.x + 5, stronghold.y + 1, stronghold.z + 5);
      push("End Portal", stronghold.x + 5, stronghold.y + 1, stronghold.z + 5);
    }

    for (const portal of this.findPortalAnchors(dimension, center, radius)) {
      push("Nether Portal", portal.x, portal.y, portal.z);
    }

    landmarks.sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label));
    return landmarks.slice(0, 16);
  }

  private findPortalAnchors(
    dimension: DimensionId,
    center: Vec3Like,
    radius: number,
  ): Array<Vec3Like> {
    const anchors: Vec3Like[] = [];
    const seen = new Set<string>();

    for (const chunk of this.chunks.values()) {
      if (chunk.dimension !== dimension) continue;
      const chunkCenterX = chunk.chunkX * WORLD_GEN_CONFIG.chunkSize + WORLD_GEN_CONFIG.chunkSize / 2;
      const chunkCenterZ = chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize + WORLD_GEN_CONFIG.chunkSize / 2;
      if (Math.abs(chunkCenterX - center.x) > radius + WORLD_GEN_CONFIG.chunkSize) continue;
      if (Math.abs(chunkCenterZ - center.z) > radius + WORLD_GEN_CONFIG.chunkSize) continue;

      let found: Vec3Like | null = null;
      for (let localX = 0; localX < WORLD_GEN_CONFIG.chunkSize && !found; localX += 1) {
        for (let localZ = 0; localZ < WORLD_GEN_CONFIG.chunkSize && !found; localZ += 1) {
          for (let y = 0; y < WORLD_GEN_CONFIG.worldHeight; y += 1) {
            if (blockIdFromIndex(chunk.blocks[localIndex(localX, y, localZ)] ?? 0) !== "portal") continue;
            found = {
              x: chunk.chunkX * WORLD_GEN_CONFIG.chunkSize + localX + 0.5,
              y: y + 0.5,
              z: chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize + localZ + 0.5,
            };
            break;
          }
        }
      }

      if (!found) continue;
      const distance = Math.hypot(found.x - center.x, found.z - center.z);
      if (distance > radius) continue;
      const key = `${Math.floor(found.x / 2)}:${Math.floor(found.y)}:${Math.floor(found.z / 2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push(found);
    }

    return anchors;
  }
  tryActivateNetherPortal(position: Vec3Like): boolean {
    const baseX = Math.floor(position.x);
    const baseY = Math.floor(position.y);
    const baseZ = Math.floor(position.z);
    const orientations: Array<"x" | "z"> = ["x", "z"];

    for (const orientation of orientations) {
      for (let offset = -3; offset <= 0; offset += 1) {
        for (let offsetY = -4; offsetY <= 0; offsetY += 1) {
          const originX = orientation === "x" ? baseX + offset : baseX;
          const originZ = orientation === "z" ? baseZ + offset : baseZ;
          const originY = baseY + offsetY;
          if (this.isValidPortalFrame(originX, originY, originZ, orientation)) {
            this.fillPortal(originX, originY, originZ, orientation);
            return true;
          }
        }
      }
    }
    return false;
  }

  tryFillEndPortalFrame(position: Vec3Like): boolean {
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    const entity = this.getBlockEntity("overworld", x, y, z);
    if (!entity || entity.kind !== "portal_frame" || entity.extra?.filled) {
      return false;
    }
    entity.extra = {
      ...entity.extra,
      filled: 1,
    };

    const centerX = Number(entity.extra?.centerX ?? x);
    const centerY = Number(entity.extra?.centerY ?? y);
    const centerZ = Number(entity.extra?.centerZ ?? z);
    let filled = 0;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        if (Math.abs(dx) + Math.abs(dz) !== 2) {
          continue;
        }
        const frame = this.getBlockEntity("overworld", centerX + dx, centerY, centerZ + dz);
        if (frame?.extra?.filled) {
          filled += 1;
        }
      }
    }
    if (filled >= 8) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          this.setBlockId("overworld", centerX + dx, centerY, centerZ + dz, "end_portal");
        }
      }
    }
    return true;
  }

  getAttackDamage(itemId: ItemId | null): number {
    if (!itemId) {
      return 2;
    }
    return ITEM_DEFS[itemId].attackDamage ?? 2;
  }

  canBreakBlock(
    blockId: BlockId,
    heldItemId: ItemId | null,
  ): { allowed: boolean; speed: number } {
    if (blockId === "air" || blockId === "bedrock" || blockId === "portal_frame") {
      return { allowed: false, speed: 0 };
    }
    const block = BLOCK_DEFS[blockId];
    const item = heldItemId ? ITEM_DEFS[heldItemId] : null;
    const matchesRequiredTool = !block.requiredTool || item?.toolType === block.requiredTool;
    const basePower = item?.miningPower ?? 0.9;
    const penalty = matchesRequiredTool ? 1 : item ? 0.22 : 0.16;
    const speed = Math.max(0.04, (basePower * penalty) / Math.max(block.hardness, 0.25));
    return { allowed: true, speed };
  }

  ensureChunk(dimension: DimensionId, chunkX: number, chunkZ: number): ChunkData {
    const key = makeChunkKey(dimension, chunkX, chunkZ);
    const existing = this.chunks.get(key);
    if (existing) {
      return existing;
    }

    const chunk = this.generateChunk(dimension, chunkX, chunkZ);
    const snapshot = this.persistedSnapshots.get(key);
    if (snapshot) {
      const mergedBlocks = new Uint16Array(chunk.blocks.length);
      mergedBlocks.set(chunk.blocks);
      const snapshotBlocks = Uint16Array.from(snapshot.blocks.slice(0, mergedBlocks.length));
      mergedBlocks.set(snapshotBlocks.subarray(0, Math.min(snapshotBlocks.length, mergedBlocks.length)));
      chunk.blocks = mergedBlocks;
      chunk.modified = true;
      chunk.dirty = true;
    }
    this.chunks.set(key, chunk);
    return chunk;
  }

  private snapshotChunk(chunk: ChunkData): ChunkSnapshot {
    return {
      dimension: chunk.dimension,
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      blocks: [...chunk.blocks],
    };
  }

  private isValidPortalFrame(
    originX: number,
    originY: number,
    originZ: number,
    orientation: "x" | "z",
  ): boolean {
    for (let width = 0; width < 4; width += 1) {
      for (let height = 0; height < 5; height += 1) {
        const x = orientation === "x" ? originX + width : originX;
        const z = orientation === "z" ? originZ + width : originZ;
        const y = originY + height;
        const border = width === 0 || width === 3 || height === 0 || height === 4;
        const blockId = this.getBlockId("overworld", x, y, z);
        if (border && blockId !== "obsidian") {
          return false;
        }
        if (!border && blockId !== "air" && blockId !== "portal") {
          return false;
        }
      }
    }
    return true;
  }

  private fillPortal(
    originX: number,
    originY: number,
    originZ: number,
    orientation: "x" | "z",
  ): void {
    for (let width = 1; width <= 2; width += 1) {
      for (let height = 1; height <= 3; height += 1) {
        const x = orientation === "x" ? originX + width : originX;
        const z = orientation === "z" ? originZ + width : originZ;
        this.setBlockId("overworld", x, originY + height, z, "portal");
      }
    }
  }

  private generateChunk(
    dimension: DimensionId,
    chunkX: number,
    chunkZ: number,
  ): ChunkData {
    const chunk: ChunkData = {
      dimension,
      chunkX,
      chunkZ,
      blocks: new Uint16Array(
        WORLD_GEN_CONFIG.chunkSize *
          WORLD_GEN_CONFIG.worldHeight *
          WORLD_GEN_CONFIG.chunkSize,
      ),
      dirty: true,
      modified: false,
    };

    for (let localX = 0; localX < WORLD_GEN_CONFIG.chunkSize; localX += 1) {
      for (let localZ = 0; localZ < WORLD_GEN_CONFIG.chunkSize; localZ += 1) {
        const worldX = chunkX * WORLD_GEN_CONFIG.chunkSize + localX;
        const worldZ = chunkZ * WORLD_GEN_CONFIG.chunkSize + localZ;
        if (dimension === "overworld") {
          this.fillOverworldColumn(chunk, localX, localZ, worldX, worldZ);
        } else if (dimension === "nether") {
          this.fillNetherColumn(chunk, localX, localZ, worldX, worldZ);
        } else {
          this.fillEndColumn(chunk, localX, localZ, worldX, worldZ);
        }
      }
    }

    if (dimension === "overworld") {
      this.decorateOverworldChunk(chunk);
      this.placeOverworldStructures(chunk);
    } else if (dimension === "nether") {
      this.placeNetherGlowstone(chunk);
    } else {
      this.placeEndStructures(chunk);
    }
    return chunk;
  }

  private fillOverworldColumn(
    chunk: ChunkData,
    localX: number,
    localZ: number,
    worldX: number,
    worldZ: number,
  ): void {
    const biome = getBiomeIdAt(this.seedNumber, "overworld", worldX, worldZ);
    const biomeDef = BIOME_DEFS[biome];
    const height = getOverworldSurfaceHeight(this.seedNumber, worldX, worldZ, biome);
    for (let y = 0; y <= height; y += 1) {
      let blockId: BlockId = "stone";
      if (y === 0) {
        blockId = "bedrock";
      } else if (shouldCarveCave(this.seedNumber, worldX, y, worldZ)) {
        continue;
      } else if (y === height) {
        blockId = biomeDef.topBlockId;
      } else if (y >= height - 3) {
        blockId = biomeDef.fillerBlockId;
      }

      if (blockId === "stone") {
        blockId = this.pickOreBlock(biome, worldX, y, worldZ) ?? blockId;
      }
      if (y > 16 && y < 72 && fbm3(this.seedNumber + 917, worldX / 14, y / 14, worldZ / 14, 2) > 0.58) {
        blockId = "amethyst_block";
      }
      if (y < 24 && hashNumbers(this.seedNumber + 619, worldX, y, worldZ) % 140 === 0) {
        blockId = "fossil_block";
      }
      this.setLocalBlock(chunk, localX, y, localZ, blockId);
    }
  }

  private fillNetherColumn(
    chunk: ChunkData,
    localX: number,
    localZ: number,
    worldX: number,
    worldZ: number,
  ): void {
    const height = getNetherSurfaceHeight(this.seedNumber, worldX, worldZ);
    for (let y = 0; y <= height; y += 1) {
      let blockId: BlockId = "netherrack";
      if (y === 0) {
        blockId = "bedrock";
      }
      if (y > 4 && y < height - 3 && shouldCarveCave(this.seedNumber + 1900, worldX, y, worldZ)) {
        continue;
      }
      if (y < 34 && hashNumbers(this.seedNumber + 2201, worldX, y, worldZ) % 58 === 0) {
        blockId = "ancient_debris";
      }
      this.setLocalBlock(chunk, localX, y, localZ, blockId);
    }
  }

  private fillEndColumn(
    chunk: ChunkData,
    localX: number,
    localZ: number,
    worldX: number,
    worldZ: number,
  ): void {
    const distance = Math.hypot(worldX, worldZ);
    const islandHeight =
      50 + fbm2(this.seedNumber + 2801, worldX / 80, worldZ / 80, 4) * 6 - distance / 90;
    if (islandHeight < 42 && distance > 80) {
      return;
    }
    const top = Math.round(clamp(islandHeight, 38, 66));
    for (let y = 0; y <= top; y += 1) {
      this.setLocalBlock(chunk, localX, y, localZ, y === 0 ? "bedrock" : "end_stone");
    }
  }

  private pickOreBlock(biome: BiomeId, x: number, y: number, z: number): BlockId | null {
    const veinRoll = (salt: number, scale: number) =>
      hashNumbers(this.seedNumber + salt, Math.floor(x / scale), Math.floor(y / scale), Math.floor(z / scale)) % 1000;
    const localRoll = (salt: number) => hashNumbers(this.seedNumber + salt + y * 17, x, y, z) % 1000;

    if (y > 84 && (veinRoll(401, 4) < 88 || localRoll(421) < 34)) return "moonstone_ore";
    if (y > 48 && (veinRoll(511, 4) < 180 || localRoll(521) < 60)) return "coal_ore";
    if (y > 26 && y < 126 && (veinRoll(611, 4) < 146 || localRoll(621) < 48)) return "iron_ore";
    if (y > 18 && y < 98 && (veinRoll(711, 4) < 118 || localRoll(721) < 34)) return "lapis_ore";
    if (y > 10 && y < 86 && (veinRoll(811, 4) < 148 || localRoll(821) < 42)) return "gold_ore";
    if (y > 8 && y < 60 && (veinRoll(911, 4) < 128 || localRoll(921) < 34)) return "redstone_ore";
    if (y > 4 && y < 58 && (veinRoll(1011, 4) < 148 || localRoll(1021) < 42)) return "diamond_ore";
    if (biome === "mountains" && y > 22 && y < 132 && (veinRoll(1111, 4) < 172 || localRoll(1121) < 44)) return "emerald_ore";
    return null;
  }
  private decorateOverworldChunk(chunk: ChunkData): void {
    for (let localX = 0; localX < WORLD_GEN_CONFIG.chunkSize; localX += 1) {
      for (let localZ = 0; localZ < WORLD_GEN_CONFIG.chunkSize; localZ += 1) {
        const worldX = chunk.chunkX * WORLD_GEN_CONFIG.chunkSize + localX;
        const worldZ = chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize + localZ;
        const biome = getBiomeIdAt(this.seedNumber, "overworld", worldX, worldZ);
        const surfaceY = this.findTopSolidInChunk(chunk, localX, localZ);
        if (surfaceY <= 0 || surfaceY >= WORLD_GEN_CONFIG.worldHeight - 8) {
          continue;
        }
        const surfaceBlockId = blockIdFromIndex(chunk.blocks[localIndex(localX, surfaceY, localZ)] ?? 0);
        const treeRoll = hashNumbers(this.seedNumber + 711, worldX, worldZ) / 0xffffffff;
        if (
          surfaceBlockId === BIOME_DEFS[biome].topBlockId &&
          treeRoll < BIOME_DEFS[biome].treeChance &&
          this.hasTreeClearance(chunk, localX, surfaceY + 1, localZ)
        ) {
          this.placeTree(chunk, worldX, surfaceY + 1, worldZ);
        }
      }
    }
  }

  private hasTreeClearance(
    chunk: ChunkData,
    localX: number,
    startY: number,
    localZ: number,
  ): boolean {
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        const checkX = localX + dx;
        const checkZ = localZ + dz;
        if (
          checkX < 0 ||
          checkX >= WORLD_GEN_CONFIG.chunkSize ||
          checkZ < 0 ||
          checkZ >= WORLD_GEN_CONFIG.chunkSize
        ) {
          continue;
        }
        for (let dy = 0; dy <= 5; dy += 1) {
          const blockId = blockIdFromIndex(
            chunk.blocks[localIndex(checkX, startY + dy, checkZ)] ?? 0,
          );
          if (blockId !== "air") {
            return false;
          }
        }
      }
    }
    return true;
  }

  private placeOverworldStructures(chunk: ChunkData): void {
    const regionSize = 64;
    const worldMinX = chunk.chunkX * WORLD_GEN_CONFIG.chunkSize;
    const worldMinZ = chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize;
    const worldMaxX = worldMinX + WORLD_GEN_CONFIG.chunkSize;
    const worldMaxZ = worldMinZ + WORLD_GEN_CONFIG.chunkSize;
    const startRegionX = Math.floor((worldMinX - regionSize) / regionSize);
    const endRegionX = Math.floor((worldMaxX + regionSize) / regionSize);
    const startRegionZ = Math.floor((worldMinZ - regionSize) / regionSize);
    const endRegionZ = Math.floor((worldMaxZ + regionSize) / regionSize);

    for (let regionX = startRegionX; regionX <= endRegionX; regionX += 1) {
      for (let regionZ = startRegionZ; regionZ <= endRegionZ; regionZ += 1) {
        const baseX = regionX * regionSize + (hashNumbers(this.seedNumber + 1301, regionX, regionZ) % 28);
        const baseZ = regionZ * regionSize + (hashNumbers(this.seedNumber + 1401, regionX, regionZ) % 28);
        const biome = getBiomeIdAt(this.seedNumber, "overworld", baseX, baseZ);
        const surfaceY = getOverworldSurfaceHeight(this.seedNumber, baseX, baseZ, biome);
        if (isAllowedVillageBiome(biome) && hashNumbers(this.seedNumber + 1501, regionX, regionZ) % 100 > 70) {
          this.placeVillage(chunk, baseX, surfaceY + 1, baseZ);
        }
        if (biome === "plains" && hashNumbers(this.seedNumber + 1601, regionX, regionZ) % 100 > 80) {
          this.placeSchool(chunk, baseX + 10, surfaceY + 1, baseZ - 6);
        }
        if (hashNumbers(this.seedNumber + 1701, regionX, regionZ) % 100 > 74) {
          this.placeDungeon(chunk, baseX, 18 + (Math.abs(regionX + regionZ) % 10), baseZ);
        }
      }
    }

    const stronghold = strongholdOrigin(this.seedNumber);
    if (intersectsChunk(chunk.chunkX, chunk.chunkZ, stronghold.x, stronghold.z, STRUCTURE_DEFS.stronghold.dimensions.x, STRUCTURE_DEFS.stronghold.dimensions.z)) {
      this.placeStronghold(chunk, stronghold.x, stronghold.y, stronghold.z);
    }
  }

  private placeNetherGlowstone(chunk: ChunkData): void {
    for (let localX = 0; localX < WORLD_GEN_CONFIG.chunkSize; localX += 1) {
      for (let localZ = 0; localZ < WORLD_GEN_CONFIG.chunkSize; localZ += 1) {
        const worldX = chunk.chunkX * WORLD_GEN_CONFIG.chunkSize + localX;
        const worldZ = chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize + localZ;
        if (hashNumbers(this.seedNumber + 2301, worldX, worldZ) % 220 !== 0) continue;
        const surface = this.findTopSolidInChunk(chunk, localX, localZ);
        for (let dy = 0; dy < 3; dy += 1) {
          this.setLocalBlock(chunk, localX, surface + 1 + dy, localZ, "glowstone");
        }
      }
    }
  }

  private placeEndStructures(chunk: ChunkData): void {
    if (!intersectsChunk(chunk.chunkX, chunk.chunkZ, -2, -2, 5, 5)) return;
    for (let x = -2; x <= 2; x += 1) {
      for (let z = -2; z <= 2; z += 1) {
        this.setWorldBlockInChunk(chunk, x, 54, z, "obsidian");
      }
    }
  }

  private placeTree(chunk: ChunkData, x: number, y: number, z: number): void {
    if (!intersectsChunk(chunk.chunkX, chunk.chunkZ, x - 2, z - 2, STRUCTURE_DEFS.oak_tree.dimensions.x, STRUCTURE_DEFS.oak_tree.dimensions.z)) return;
    for (let dy = 0; dy < 4; dy += 1) this.setWorldBlockInChunk(chunk, x, y + dy, z, "oak_log");
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dy = 2; dy <= 4; dy += 1) {
          if (Math.abs(dx) + Math.abs(dz) > 3) continue;
          this.setWorldBlockInChunk(chunk, x + dx, y + dy, z + dz, "oak_leaves");
        }
      }
    }
  }

  private placeVillage(chunk: ChunkData, x: number, y: number, z: number): void {
    if (!intersectsChunk(chunk.chunkX, chunk.chunkZ, x, z, STRUCTURE_DEFS.village.dimensions.x, STRUCTURE_DEFS.village.dimensions.z)) return;

    this.placeVillagePlaza(chunk, x + 14, y, z + 14);
    const houses = [
      { x: x + 2, z: z + 3, salt: x * 17 + z * 7 },
      { x: x + 14, z: z + 3, salt: x * 23 + z * 11 },
      { x: x + 4, z: z + 16, salt: x * 29 + z * 13 },
      { x: x + 16, z: z + 16, salt: x * 31 + z * 17 },
    ];

    for (const house of houses) {
      const biome = getBiomeIdAt(this.seedNumber, "overworld", house.x + 3, house.z + 3);
      const houseY = getOverworldSurfaceHeight(this.seedNumber, house.x + 3, house.z + 3, biome) + 1;
      this.placeSimpleHouse(chunk, house.x, houseY, house.z, house.salt);
    }
  }

  private placeSchool(chunk: ChunkData, x: number, y: number, z: number): void {
    if (!intersectsChunk(chunk.chunkX, chunk.chunkZ, x, z, STRUCTURE_DEFS.school.dimensions.x, STRUCTURE_DEFS.school.dimensions.z)) return;
    for (let dx = 0; dx < 16; dx += 1) for (let dz = 0; dz < 10; dz += 1) for (let dy = 0; dy < 6; dy += 1) {
      const edge = dx === 0 || dz === 0 || dx === 15 || dz === 9 || dy === 5;
      if (dy === 0) this.setWorldBlockInChunk(chunk, x + dx, y, z + dz, "oak_planks");
      else if (edge) this.setWorldBlockInChunk(chunk, x + dx, y + dy, z + dz, "school_brick");
    }
    this.placeChest(chunk, "overworld", x + 2, y + 1, z + 2, x * 7 + z);
  }

  private placeDungeon(chunk: ChunkData, x: number, y: number, z: number): void {
    if (!intersectsChunk(chunk.chunkX, chunk.chunkZ, x, z, STRUCTURE_DEFS.dungeon.dimensions.x, STRUCTURE_DEFS.dungeon.dimensions.z)) return;
    for (let dx = 0; dx < 7; dx += 1) for (let dz = 0; dz < 7; dz += 1) for (let dy = 0; dy < 4; dy += 1) {
      const edge = dx === 0 || dz === 0 || dx === 6 || dz === 6 || dy === 0 || dy === 3;
      this.setWorldBlockInChunk(chunk, x + dx, y + dy, z + dz, edge ? "cobblestone" : "air");
    }
    this.placeChest(chunk, "overworld", x + 1, y + 1, z + 1, x * 3 + z);
    this.placeChest(chunk, "overworld", x + 5, y + 1, z + 1, x * 5 + z);
    this.placeChest(chunk, "overworld", x + 3, y + 1, z + 5, x * 11 + z);
  }

  private placeStronghold(chunk: ChunkData, x: number, y: number, z: number): void {
    for (let dx = 0; dx < 11; dx += 1) for (let dz = 0; dz < 11; dz += 1) for (let dy = 0; dy < 4; dy += 1) {
      const edge = dx === 0 || dz === 0 || dx === 10 || dz === 10 || dy === 0 || dy === 3;
      this.setWorldBlockInChunk(chunk, x + dx, y + dy, z + dz, edge ? "stone_bricks" : "air");
    }
    const centerX = x + 5;
    const centerY = y + 1;
    const centerZ = z + 5;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        if (Math.abs(dx) + Math.abs(dz) !== 2) continue;
        this.setWorldBlockInChunk(chunk, centerX + dx, centerY, centerZ + dz, "portal_frame");
        this.ensureBlockEntity({
          kind: "portal_frame",
          dimension: "overworld",
          x: centerX + dx,
          y: centerY,
          z: centerZ + dz,
          extra: { filled: 0, centerX, centerY, centerZ },
        });
      }
    }
    this.placeChest(chunk, "overworld", x + 1, y + 1, z + 1, x * 19 + z);
  }

  private placeVillagePlaza(chunk: ChunkData, x: number, y: number, z: number): void {
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        this.setWorldBlockInChunk(chunk, x + dx, y - 1, z + dz, "cobblestone");
        this.setWorldBlockInChunk(chunk, x + dx, y, z + dz, Math.abs(dx) === 2 || Math.abs(dz) === 2 ? "stone_bricks" : "cobblestone");
      }
    }
    for (let dy = 1; dy <= 3; dy += 1) {
      this.setWorldBlockInChunk(chunk, x - 1, y + dy, z - 1, "oak_log");
      this.setWorldBlockInChunk(chunk, x + 1, y + dy, z - 1, "oak_log");
      this.setWorldBlockInChunk(chunk, x - 1, y + dy, z + 1, "oak_log");
      this.setWorldBlockInChunk(chunk, x + 1, y + dy, z + 1, "oak_log");
    }
    this.setWorldBlockInChunk(chunk, x, y + 3, z, "glowstone");
  }

  private placeSimpleHouse(chunk: ChunkData, x: number, y: number, z: number, salt: number): void {
    for (let dx = 0; dx < 7; dx += 1) {
      for (let dz = 0; dz < 7; dz += 1) {
        this.setWorldBlockInChunk(chunk, x + dx, y - 1, z + dz, "cobblestone");
        this.setWorldBlockInChunk(chunk, x + dx, y, z + dz, "oak_planks");
        this.setWorldBlockInChunk(chunk, x + dx, y + 4, z + dz, dx === 0 || dz === 0 || dx === 6 || dz === 6 ? "oak_log" : "oak_planks");
      }
    }

    for (let dy = 1; dy <= 3; dy += 1) {
      for (let dx = 0; dx < 7; dx += 1) {
        for (let dz = 0; dz < 7; dz += 1) {
          const wall = dx === 0 || dz === 0 || dx === 6 || dz === 6;
          this.setWorldBlockInChunk(chunk, x + dx, y + dy, z + dz, wall ? "oak_planks" : "air");
        }
      }
    }

    this.setWorldBlockInChunk(chunk, x + 3, y + 1, z, "air");
    this.setWorldBlockInChunk(chunk, x + 3, y + 2, z, "air");
    this.setWorldBlockInChunk(chunk, x + 2, y + 2, z, "air");
    this.setWorldBlockInChunk(chunk, x + 4, y + 2, z, "air");
    this.setWorldBlockInChunk(chunk, x + 1, y + 2, z + 2, "air");
    this.setWorldBlockInChunk(chunk, x + 5, y + 2, z + 2, "air");
    this.setWorldBlockInChunk(chunk, x + 1, y + 2, z + 4, "air");
    this.setWorldBlockInChunk(chunk, x + 5, y + 2, z + 4, "air");
    this.placeChest(chunk, "overworld", x + 1, y + 1, z + 5, salt);
  }

  private placeChest(
    chunk: ChunkData,
    dimension: DimensionId,
    x: number,
    y: number,
    z: number,
    salt: number,
  ): void {
    this.setWorldBlockInChunk(chunk, x, y, z, "chest");
    this.ensureBlockEntity({
      kind: "chest",
      dimension,
      x,
      y,
      z,
      inventory: createLootContainer(this.seedNumber + salt, salt),
    });
  }

  private ensureBlockEntity(entity: BlockEntityData): void {
    const key = makeBlockEntityKey(entity.dimension, entity.x, entity.y, entity.z);
    if (!this.blockEntities.has(key)) this.blockEntities.set(key, entity);
  }

  private setWorldBlockInChunk(
    chunk: ChunkData,
    worldX: number,
    worldY: number,
    worldZ: number,
    blockId: BlockId,
  ): void {
    if (worldY < 0 || worldY >= WORLD_GEN_CONFIG.worldHeight) return;
    const localX = worldX - chunk.chunkX * WORLD_GEN_CONFIG.chunkSize;
    const localZ = worldZ - chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize;
    if (localX < 0 || localX >= WORLD_GEN_CONFIG.chunkSize || localZ < 0 || localZ >= WORLD_GEN_CONFIG.chunkSize) return;
    this.setLocalBlock(chunk, localX, worldY, localZ, blockId);
  }

  private setLocalBlock(chunk: ChunkData, localX: number, y: number, localZ: number, blockId: BlockId): void {
    chunk.blocks[localIndex(localX, y, localZ)] = blockIndex(blockId);
  }

  private findTopSolidInChunk(chunk: ChunkData, localX: number, localZ: number): number {
    for (let y = WORLD_GEN_CONFIG.worldHeight - 2; y >= 1; y -= 1) {
      const blockId = blockIdFromIndex(chunk.blocks[localIndex(localX, y, localZ)] ?? 0);
      if (BLOCK_DEFS[blockId].solid) return y;
    }
    return 0;
  }
}

function selectFaceColor(blockId: BlockId, faceIndex: number): THREE.Color {
  const def = BLOCK_DEFS[blockId];
  const face = FACE_DEFS[faceIndex];
  let hex = def.color;
  if (face.direction.y > 0 && def.topColor) hex = def.topColor;
  else if (face.direction.y < 0 && def.bottomColor) hex = def.bottomColor;
  else if (def.sideColor) hex = def.sideColor;
  return new THREE.Color(hex).multiplyScalar(face.shade);
}

function appendPrismGeometry(
  world: VoxelWorld,
  chunk: ChunkData,
  blockId: BlockId,
  localX: number,
  y: number,
  localZ: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  cullAgainstWorld: boolean,
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
): void {
  const chunkOriginX = chunk.chunkX * WORLD_GEN_CONFIG.chunkSize;
  const chunkOriginZ = chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize;
  const worldX = chunkOriginX + localX;
  const worldZ = chunkOriginZ + localZ;
  const prismFaces = [
    [
      [minX, maxY, minZ],
      [minX, maxY, maxZ],
      [maxX, maxY, maxZ],
      [maxX, maxY, minZ],
    ],
    [
      [minX, minY, maxZ],
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, minY, maxZ],
    ],
    [
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ],
    ],
    [
      [maxX, minY, minZ],
      [minX, minY, minZ],
      [minX, maxY, minZ],
      [maxX, maxY, minZ],
    ],
    [
      [maxX, minY, maxZ],
      [maxX, minY, minZ],
      [maxX, maxY, minZ],
      [maxX, maxY, maxZ],
    ],
    [
      [minX, minY, minZ],
      [minX, minY, maxZ],
      [minX, maxY, maxZ],
      [minX, maxY, minZ],
    ],
  ] as const;

  for (let faceIndex = 0; faceIndex < FACE_DEFS.length; faceIndex += 1) {
    const face = FACE_DEFS[faceIndex];
    if (cullAgainstWorld) {
      const neighborId = world.getBlockId(
        chunk.dimension,
        worldX + face.direction.x,
        y + face.direction.y,
        worldZ + face.direction.z,
      );
      if (neighborId !== "air" && BLOCK_DEFS[neighborId].solid && !BLOCK_DEFS[neighborId].transparent) {
        continue;
      }
    }

    const color = selectFaceColor(blockId, faceIndex);
    const uv = getBlockFaceUv(blockId, face.direction.y);
    const quadUvs = [
      [uv.u0, uv.v1],
      [uv.u0, uv.v0],
      [uv.u1, uv.v0],
      [uv.u1, uv.v1],
    ] as const;
    const indices = [0, 1, 2, 0, 2, 3];
    for (const vertexIndex of indices) {
      const [vx, vy, vz] = prismFaces[faceIndex][vertexIndex] ?? [0, 0, 0];
      const [uu, vv] = quadUvs[vertexIndex] ?? [uv.u0, uv.v0];
      positions.push(localX + vx, y + vy, localZ + vz);
      normals.push(face.direction.x, face.direction.y, face.direction.z);
      colors.push(color.r, color.g, color.b);
      uvs.push(uu, vv);
    }
  }
}

function appendTorchGeometry(
  world: VoxelWorld,
  chunk: ChunkData,
  localX: number,
  y: number,
  localZ: number,
  positions: number[],
  normals: number[],
  colors: number[],
  uvs: number[],
): void {
  appendPrismGeometry(
    world,
    chunk,
    "torch",
    localX,
    y,
    localZ,
    0.43,
    0.06,
    0.43,
    0.57,
    0.86,
    0.57,
    false,
    positions,
    normals,
    colors,
    uvs,
  );
}

export function buildChunkGeometry(world: VoxelWorld, chunk: ChunkData): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];

  for (let localX = 0; localX < WORLD_GEN_CONFIG.chunkSize; localX += 1) {
    for (let localZ = 0; localZ < WORLD_GEN_CONFIG.chunkSize; localZ += 1) {
      for (let y = 0; y < WORLD_GEN_CONFIG.worldHeight; y += 1) {
        const currentId = blockIdFromIndex(chunk.blocks[localIndex(localX, y, localZ)] ?? 0);
        if (currentId === "air") continue;
        if (currentId === "torch") {
          appendTorchGeometry(world, chunk, localX, y, localZ, positions, normals, colors, uvs);
          continue;
        }
        appendPrismGeometry(
          world,
          chunk,
          currentId,
          localX,
          y,
          localZ,
          0,
          0,
          0,
          1,
          1,
          1,
          true,
          positions,
          normals,
          colors,
          uvs,
        );
      }
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createInitialWorldMeta(name: string, seed: string, mode: GameMode): WorldMeta {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    seed,
    mode,
    createdAt: now,
    lastPlayedAt: now,
    completed: false,
    locked: false,
  };
}

export function createWorldSave(meta: WorldMeta): WorldSave {
  const empty = new VoxelWorld({
    meta,
    player: createDefaultPlayerState(meta.mode, { x: 0, y: 0, z: 0 }),
    modifiedChunks: [],
    blockEntities: [],
  });
  const spawn = empty.getSpawnPoint();
  return {
    meta,
    player: createDefaultPlayerState(meta.mode, spawn),
    modifiedChunks: [],
    blockEntities: empty.listBlockEntities(),
  };
}

export function serializeWorldSave(meta: WorldMeta, player: PlayerState, world: VoxelWorld): WorldSave {
  return {
    meta,
    player: clonePlayerState(player),
    modifiedChunks: world.snapshotModifiedChunks(),
    blockEntities: world.listBlockEntities(),
  };
}

export function isBlockPlaceable(itemId: ItemId | null): itemId is ItemId {
  return Boolean(itemId && ITEM_DEFS[itemId].blockId);
}

export function getBiomeLabel(biomeId: BiomeId): string {
  return BIOME_DEFS[biomeId].name;
}

export function getDimensionLabel(dimension: DimensionId): string {
  if (dimension === "overworld") return "Overworld";
  if (dimension === "nether") return "Nether";
  return "End";
}

















