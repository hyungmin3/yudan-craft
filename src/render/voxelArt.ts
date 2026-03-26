import * as THREE from "three";
import { BLOCK_DEFS, ITEM_DEFS } from "../data/catalog";
import {
  BLOCK_IDS,
  type BlockId,
  type ItemId,
} from "../game/contracts";

export const TILE_SIZE = 16;
export const ATLAS_COLUMNS = 16;
const FACE_VARIANTS = ["top", "side", "bottom"] as const;
type FaceVariant = (typeof FACE_VARIANTS)[number];

type Rgb = { r: number; g: number; b: number };

type Rect = { u0: number; v0: number; u1: number; v1: number };

const BLOCK_TEXTURE_IDS = BLOCK_IDS.filter((blockId) => blockId !== "air");
const BLOCK_FACE_KEYS = BLOCK_TEXTURE_IDS.flatMap((blockId) =>
  FACE_VARIANTS.map((variant) => `${blockId}:${variant}`),
);
const ATLAS_ROWS = Math.ceil(BLOCK_FACE_KEYS.length / ATLAS_COLUMNS);
const FACE_INDEX_BY_KEY = new Map(BLOCK_FACE_KEYS.map((key, index) => [key, index]));

const BLOCK_ICON_CACHE = new Map<string, HTMLCanvasElement>();
const ITEM_ICON_CACHE = new Map<ItemId, string>();
const ITEM_TEXTURE_CACHE = new Map<ItemId, THREE.CanvasTexture>();
let atlasTextureCache: THREE.CanvasTexture | null = null;
const MATERIAL_COLORS = {
  wood: { light: 0xd9b07b, dark: 0x7a5131 },
  stone: { light: 0xb7bcc5, dark: 0x68707c },
  iron: { light: 0xe0ddd7, dark: 0x8f949d },
  gold: { light: 0xffd867, dark: 0xba8b1f },
  diamond: { light: 0x9dfdf4, dark: 0x1cb4b6 },
  netherite: { light: 0x645f6f, dark: 0x292633 },
} as const;

export function getBlockFaceUv(blockId: BlockId, normalY: number): Rect {
  const variant = resolveFaceVariant(normalY);
  const index = FACE_INDEX_BY_KEY.get(`${blockId}:${variant}`) ?? 0;
  return tileRect(index);
}

export function createVoxelAtlasTexture(): THREE.CanvasTexture {
  if (atlasTextureCache) {
    return atlasTextureCache;
  }

  const canvas = createCanvas(ATLAS_COLUMNS * TILE_SIZE, ATLAS_ROWS * TILE_SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const blockId of BLOCK_TEXTURE_IDS) {
    for (const variant of FACE_VARIANTS) {
      const index = FACE_INDEX_BY_KEY.get(`${blockId}:${variant}`) ?? 0;
      const { x, y } = tileOrigin(index);
      ctx.drawImage(getBlockFaceCanvas(blockId, variant), x, y);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  atlasTextureCache = texture;
  return texture;
}

export function getItemIconDataUrl(itemId: ItemId): string {
  const cached = ITEM_ICON_CACHE.get(itemId);
  if (cached) {
    return cached;
  }

  const canvas = createCanvas(32, 32);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 32, 32);
  paintItemIcon(ctx, itemId, 32);
  const dataUrl = canvas.toDataURL("image/png");
  ITEM_ICON_CACHE.set(itemId, dataUrl);
  return dataUrl;
}

export function createItemIconTexture(itemId: ItemId): THREE.CanvasTexture {
  const cached = ITEM_TEXTURE_CACHE.get(itemId);
  if (cached) {
    return cached;
  }

  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);
  paintItemIcon(ctx, itemId, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  ITEM_TEXTURE_CACHE.set(itemId, texture);
  return texture;
}

function tileRect(index: number): Rect {
  const column = index % ATLAS_COLUMNS;
  const row = Math.floor(index / ATLAS_COLUMNS);
  const flippedRow = ATLAS_ROWS - 1 - row;
  const stepU = 1 / ATLAS_COLUMNS;
  const stepV = 1 / ATLAS_ROWS;
  const padU = 0.45 / (ATLAS_COLUMNS * TILE_SIZE);
  const padV = 0.45 / (ATLAS_ROWS * TILE_SIZE);
  return {
    u0: column * stepU + padU,
    v0: flippedRow * stepV + padV,
    u1: (column + 1) * stepU - padU,
    v1: (flippedRow + 1) * stepV - padV,
  };
}

function tileOrigin(index: number): { x: number; y: number } {
  return {
    x: (index % ATLAS_COLUMNS) * TILE_SIZE,
    y: Math.floor(index / ATLAS_COLUMNS) * TILE_SIZE,
  };
}

function resolveFaceVariant(normalY: number): FaceVariant {
  if (normalY > 0) {
    return "top";
  }
  if (normalY < 0) {
    return "bottom";
  }
  return "side";
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error("Canvas rendering requires a browser environment");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getBlockFaceCanvas(blockId: BlockId, variant: FaceVariant): HTMLCanvasElement {
  const key = `${blockId}:${variant}`;
  const cached = BLOCK_ICON_CACHE.get(key);
  if (cached) {
    return cached;
  }
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable");
  }
  ctx.imageSmoothingEnabled = false;
  paintBlockFace(ctx, blockId, variant, TILE_SIZE);
  BLOCK_ICON_CACHE.set(key, canvas);
  return canvas;
}

function paintBlockFace(
  ctx: CanvasRenderingContext2D,
  blockId: BlockId,
  variant: FaceVariant,
  size: number,
): void {
  const baseHex = faceHex(blockId, variant);
  const base = rgb(baseHex);
  fillRect(ctx, 0, 0, size, size, baseHex);

  switch (blockId) {
    case "grass":
      if (variant === "bottom") {
        paintSoil(ctx, size, 0x7a4c2b, 0x5d331c, 0x906239);
      } else if (variant === "side") {
        paintSoil(ctx, size, 0x7a4c2b, 0x5d331c, 0x906239);
        fillRect(ctx, 0, 0, size, Math.ceil(size * 0.28), 0x6eb84d);
        scatter(ctx, `${blockId}:${variant}:grass`, size, [0x7ecc52, 0x54893b], 28, 1, 2, 0, 0, size, Math.ceil(size * 0.36));
      } else {
        fillRect(ctx, 0, 0, size, size, 0x6bb84c);
        scatter(ctx, `${blockId}:${variant}`, size, [0x8ed75f, 0x4f7f35, 0x7dcb50], 48, 1, 2);
      }
      break;
    case "dirt":
      paintSoil(ctx, size, 0x7a4c2b, 0x5d331c, 0x906239);
      break;
    case "stone":
      paintStone(ctx, size, base, `${blockId}:${variant}`, false);
      break;
    case "cobblestone":
      paintCobble(ctx, size, `${blockId}:${variant}`);
      break;
    case "oak_log":
      if (variant === "side") {
        paintBark(ctx, size);
      } else {
        paintLogTop(ctx, size);
      }
      break;
    case "oak_leaves":
      paintLeaves(ctx, size, `${blockId}:${variant}`);
      break;
    case "oak_planks":
      paintPlanks(ctx, size, 0xb18851, 0x9f7745, 0xd1aa74);
      break;
    case "sand":
      paintSoftMineral(ctx, size, 0xd6c680, 0xc8b46d, 0xe7d89e, `${blockId}:${variant}`);
      break;
    case "snow":
      paintSoftMineral(ctx, size, 0xf2fbff, 0xdfeef5, 0xffffff, `${blockId}:${variant}`);
      break;
    case "obsidian":
      paintGlassStone(ctx, size, 0x28163d, 0x4e2f75, 0x12091f, `${blockId}:${variant}`);
      break;
    case "portal":
      paintPortal(ctx, size, 0x42146f, 0x9f6fff, 0x18072d, `${blockId}:${variant}`);
      break;
    case "end_portal":
      paintPortal(ctx, size, 0x0f1d31, 0x2d7c92, 0x02070f, `${blockId}:${variant}`);
      break;
    case "diamond_block":
      paintCrystal(ctx, size, 0x52f6e1, 0x1db8ba, 0xbffcf7, `${blockId}:${variant}`);
      break;
    case "netherrack":
      paintStone(ctx, size, rgb(0x7c2c2b), `${blockId}:${variant}`, true);
      break;
    case "end_stone":
      paintSoftMineral(ctx, size, 0xdbd6a8, 0xc2bc84, 0xf1ecc1, `${blockId}:${variant}`);
      break;
    case "moonstone_ore":
      paintOre(ctx, size, 0x737b86, 0x8dc3ff, `${blockId}:${variant}`);
      break;
    case "coal_ore":
      paintOre(ctx, size, 0x737b86, 0x2d2d2d, `${blockId}:${variant}`);
      break;
    case "iron_ore":
      paintOre(ctx, size, 0x737b86, 0xb3805d, `${blockId}:${variant}`);
      break;
    case "lapis_ore":
      paintOre(ctx, size, 0x737b86, 0x4164cb, `${blockId}:${variant}`);
      break;
    case "gold_ore":
      paintOre(ctx, size, 0x737b86, 0xc7a63c, `${blockId}:${variant}`);
      break;
    case "redstone_ore":
      paintOre(ctx, size, 0x737b86, 0xcb3d35, `${blockId}:${variant}`);
      break;
    case "diamond_ore":
      paintOre(ctx, size, 0x737b86, 0x5fe8df, `${blockId}:${variant}`);
      break;
    case "emerald_ore":
      paintOre(ctx, size, 0x737b86, 0x3ddf62, `${blockId}:${variant}`);
      break;
    case "amethyst_block":
      paintCrystal(ctx, size, 0xb39bff, 0x7251d2, 0xe5deff, `${blockId}:${variant}`);
      break;
    case "fossil_block":
      paintBone(ctx, size, `${blockId}:${variant}`);
      break;
    case "ancient_debris":
      paintPlanks(ctx, size, 0x7e4e2f, 0x4b2915, 0xaa7449);
      scatter(ctx, `${blockId}:${variant}`, size, [0x2b2226, 0xbc8b55], 18, 1, 2);
      break;
    case "chest":
      paintChest(ctx, size, false);
      break;
    case "crafting_table":
      paintCraftingTable(ctx, size, variant);
      break;
    case "furnace":
      paintFurnace(ctx, size, variant);
      break;
    case "stone_bricks":
      paintBrickLike(ctx, size, 0x8a8f97, 0x686d74, 0xa8adb6, false);
      break;
    case "school_brick":
      paintBrickLike(ctx, size, 0xd58a50, 0xa25b2e, 0xf0b77c, true);
      break;
    case "bedrock":
      paintStone(ctx, size, rgb(0x1f1f23), `${blockId}:${variant}`, true);
      break;
    case "portal_frame":
      paintPortalFrame(ctx, size, variant);
      break;
    case "torch":
      paintTorchBlock(ctx, size, variant);
      break;
    case "glowstone":
      paintGlowstone(ctx, size, `${blockId}:${variant}`);
      break;
    default:
      paintStone(ctx, size, base, `${blockId}:${variant}`, false);
      break;
  }
}

function paintItemIcon(ctx: CanvasRenderingContext2D, itemId: ItemId, size: number): void {
  if (itemId === "torch") {
    paintTorchIcon(ctx, size);
    return;
  }
  const itemDef = ITEM_DEFS[itemId];
  if (itemDef.blockId) {
    paintBlockItemIcon(ctx, itemDef.blockId, size);
    return;
  }

  switch (itemId) {
    case "coal":
      paintMineralIcon(ctx, size, [0x101114, 0x2c2f36, 0x676d78]);
      break;
    case "raw_iron":
      paintMineralIcon(ctx, size, [0xe3b993, 0xbf8557, 0x7d5130]);
      break;
    case "raw_gold":
      paintMineralIcon(ctx, size, [0xffe48b, 0xecb84a, 0x9a6b17]);
      break;
    case "iron_ingot":
      paintBarIcon(ctx, size, [0xe0ddd7, 0xb6bcc4, 0x7e8793]);
      break;
    case "gold_ingot":
      paintBarIcon(ctx, size, [0xffe078, 0xf4b93b, 0xa86d12]);
      break;
    case "diamond":
      paintGemIcon(ctx, size, [0x91fff2, 0x37d2cc, 0x0f7c87]);
      break;
    case "emerald":
      paintGemIcon(ctx, size, [0x7aff93, 0x2fc95b, 0x0d7a2b]);
      break;
    case "redstone":
      paintGemIcon(ctx, size, [0xff8676, 0xdb3328, 0x6a0d09]);
      break;
    case "lapis":
      paintGemIcon(ctx, size, [0x90abff, 0x4768d8, 0x142968]);
      break;
    case "moonstone_shard":
      paintGemIcon(ctx, size, [0xd7eeff, 0x7fb8ff, 0x2b5cb2]);
      break;
    case "netherite_scrap":
      paintMineralIcon(ctx, size, [0x8e7b6f, 0x5c433d, 0x24191c]);
      break;
    case "netherite_ingot":
      paintBarIcon(ctx, size, [0x8b8394, 0x4b4657, 0x1d1a25]);
      break;
    case "stick":
      paintStickIcon(ctx, size);
      break;
    case "eye_of_ender":
      paintEyeIcon(ctx, size);
      break;
    case "flint_and_steel":
      paintFlintAndSteelIcon(ctx, size);
      break;
    case "wooden_pickaxe":
      paintPickaxeIcon(ctx, size, MATERIAL_COLORS.wood.light, MATERIAL_COLORS.wood.dark);
      break;
    case "stone_pickaxe":
      paintPickaxeIcon(ctx, size, MATERIAL_COLORS.stone.light, MATERIAL_COLORS.wood.dark);
      break;
    case "iron_pickaxe":
      paintPickaxeIcon(ctx, size, MATERIAL_COLORS.iron.light, MATERIAL_COLORS.wood.dark);
      break;
    case "diamond_pickaxe":
      paintPickaxeIcon(ctx, size, MATERIAL_COLORS.diamond.light, MATERIAL_COLORS.wood.dark);
      break;
    case "netherite_pickaxe":
      paintPickaxeIcon(ctx, size, MATERIAL_COLORS.netherite.light, MATERIAL_COLORS.wood.dark);
      break;
    case "wooden_shovel":
      paintShovelIcon(ctx, size, MATERIAL_COLORS.wood.light, MATERIAL_COLORS.wood.dark);
      break;
    case "stone_shovel":
      paintShovelIcon(ctx, size, MATERIAL_COLORS.stone.light, MATERIAL_COLORS.wood.dark);
      break;
    case "iron_shovel":
      paintShovelIcon(ctx, size, MATERIAL_COLORS.iron.light, MATERIAL_COLORS.wood.dark);
      break;
    case "diamond_shovel":
      paintShovelIcon(ctx, size, MATERIAL_COLORS.diamond.light, MATERIAL_COLORS.wood.dark);
      break;
    case "netherite_shovel":
      paintShovelIcon(ctx, size, MATERIAL_COLORS.netherite.light, MATERIAL_COLORS.wood.dark);
      break;
    case "wooden_axe":
      paintAxeIcon(ctx, size, MATERIAL_COLORS.wood.light, MATERIAL_COLORS.wood.dark);
      break;
    case "stone_axe":
      paintAxeIcon(ctx, size, MATERIAL_COLORS.stone.light, MATERIAL_COLORS.wood.dark);
      break;
    case "iron_axe":
      paintAxeIcon(ctx, size, MATERIAL_COLORS.iron.light, MATERIAL_COLORS.wood.dark);
      break;
    case "diamond_axe":
      paintAxeIcon(ctx, size, MATERIAL_COLORS.diamond.light, MATERIAL_COLORS.wood.dark);
      break;
    case "netherite_axe":
      paintAxeIcon(ctx, size, MATERIAL_COLORS.netherite.light, MATERIAL_COLORS.wood.dark);
      break;
    case "wooden_sword":
      paintSwordIcon(ctx, size, MATERIAL_COLORS.wood.light, MATERIAL_COLORS.wood.dark);
      break;
    case "stone_sword":
      paintSwordIcon(ctx, size, MATERIAL_COLORS.stone.light, MATERIAL_COLORS.wood.dark);
      break;
    case "iron_sword":
      paintSwordIcon(ctx, size, MATERIAL_COLORS.iron.light, MATERIAL_COLORS.wood.dark);
      break;
    case "diamond_sword":
      paintSwordIcon(ctx, size, MATERIAL_COLORS.diamond.light, MATERIAL_COLORS.wood.dark);
      break;
    case "netherite_sword":
      paintSwordIcon(ctx, size, MATERIAL_COLORS.netherite.light, MATERIAL_COLORS.wood.dark);
      break;
    default:
      paintGemIcon(ctx, size, [0xd8d8d8, 0x888888, 0x333333]);
      break;
  }
}

function paintBlockItemIcon(ctx: CanvasRenderingContext2D, blockId: BlockId, size: number): void {
  const shadow = 4;
  fillRect(ctx, 6, 7, size - 12, size - 12, 0x2d2118);
  ctx.drawImage(getBlockFaceCanvas(blockId, "side"), 7, 7, size - 14, size - 14);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(getBlockFaceCanvas(blockId, "top"), 7, 4, size - 14, Math.floor((size - 14) * 0.36));
  ctx.globalAlpha = 1;
  strokeRect(ctx, 6, 6, size - 12, size - 12, 0xf8ecd9);
  fillRect(ctx, 6, size - shadow - 1, size - 12, shadow + 1, 0x000000, 0.16);
}

function paintSoil(ctx: CanvasRenderingContext2D, size: number, base: number, dark: number, light: number): void {
  fillRect(ctx, 0, 0, size, size, base);
  scatter(ctx, `soil:${base}`, size, [dark, light, darken(base, 0.14)], 52, 1, 2);
}

function paintStone(ctx: CanvasRenderingContext2D, size: number, base: Rgb, seed: string, rugged: boolean): void {
  fillRect(ctx, 0, 0, size, size, toHex(base));
  scatter(ctx, `${seed}:stone`, size, [darkenRgb(base, 0.18), lightenRgb(base, 0.12), darkenRgb(base, 0.32)], rugged ? 56 : 36, 1, 2);
  if (rugged) {
    for (let y = 2; y < size; y += 4) {
      fillRect(ctx, 0, y, size, 1, darken(toHex(base), 0.12), 0.16);
    }
  }
}

function paintCobble(ctx: CanvasRenderingContext2D, size: number, seed: string): void {
  fillRect(ctx, 0, 0, size, size, 0x6a7078);
  const random = seeded(seed);
  for (let index = 0; index < 12; index += 1) {
    const x = Math.floor(random() * (size - 4));
    const y = Math.floor(random() * (size - 4));
    const w = 3 + Math.floor(random() * 4);
    const h = 3 + Math.floor(random() * 4);
    fillRect(ctx, x, y, w, h, random() > 0.5 ? 0x808791 : 0x555b63);
    strokeRect(ctx, x, y, w, h, 0x43484f);
  }
}

function paintBark(ctx: CanvasRenderingContext2D, size: number): void {
  fillRect(ctx, 0, 0, size, size, 0x865c34);
  for (let x = 1; x < size; x += 3) {
    fillRect(ctx, x, 0, 1, size, 0x694223);
  }
  scatter(ctx, "bark", size, [0x9f7648, 0x5c3820], 18, 1, 1);
}

function paintLogTop(ctx: CanvasRenderingContext2D, size: number): void {
  fillRect(ctx, 0, 0, size, size, 0xcdb57d);
  strokeRect(ctx, 1, 1, size - 2, size - 2, 0x8b6136);
  strokeRect(ctx, 4, 4, size - 8, size - 8, 0xaa8a57);
  strokeRect(ctx, 6, 6, size - 12, size - 12, 0x8b6136);
  fillRect(ctx, Math.floor(size / 2) - 1, Math.floor(size / 2) - 1, 2, 2, 0x7b532e);
}

function paintLeaves(ctx: CanvasRenderingContext2D, size: number, seed: string): void {
  ctx.clearRect(0, 0, size, size);
  fillRect(ctx, 0, 0, size, size, 0x3f7a3d, 0.92);
  scatter(ctx, `${seed}:leaves`, size, [0x5fa14d, 0x2b592d, 0x79b861], 60, 1, 2);
  const random = seeded(`${seed}:holes`);
  for (let index = 0; index < 12; index += 1) {
    fillRect(ctx, Math.floor(random() * size), Math.floor(random() * size), 1 + Math.floor(random() * 2), 1 + Math.floor(random() * 2), 0x000000, 0);
  }
}

function paintPlanks(ctx: CanvasRenderingContext2D, size: number, base: number, dark: number, light: number): void {
  fillRect(ctx, 0, 0, size, size, base);
  for (let y = 3; y < size; y += 5) {
    fillRect(ctx, 0, y, size, 1, dark);
  }
  for (let x = 2; x < size; x += 6) {
    fillRect(ctx, x, 0, 1, size, dark, 0.22);
  }
  scatter(ctx, `planks:${base}`, size, [light, dark], 18, 1, 1);
}

function paintSoftMineral(ctx: CanvasRenderingContext2D, size: number, base: number, dark: number, light: number, seed: string): void {
  fillRect(ctx, 0, 0, size, size, base);
  scatter(ctx, `${seed}:soft`, size, [dark, light], 44, 1, 2);
}

function paintGlassStone(ctx: CanvasRenderingContext2D, size: number, base: number, vein: number, dark: number, seed: string): void {
  fillRect(ctx, 0, 0, size, size, base);
  scatter(ctx, `${seed}:glass`, size, [dark, vein, lighten(base, 0.1)], 24, 1, 2);
  for (let x = 1; x < size; x += 5) {
    fillRect(ctx, x, 0, 1, size, vein, 0.2);
  }
}

function paintPortal(ctx: CanvasRenderingContext2D, size: number, base: number, glow: number, dark: number, seed: string): void {
  fillRect(ctx, 0, 0, size, size, base);
  const random = seeded(seed);
  for (let row = 0; row < size; row += 2) {
    const offset = Math.floor(random() * 3);
    fillRect(ctx, 0, row, size, 1, random() > 0.5 ? glow : dark, 0.32 + random() * 0.28);
    fillRect(ctx, offset, row + 1, Math.max(3, size - offset * 2), 1, glow, 0.14 + random() * 0.18);
  }
}

function paintCrystal(ctx: CanvasRenderingContext2D, size: number, base: number, dark: number, light: number, seed: string): void {
  fillRect(ctx, 0, 0, size, size, base);
  scatter(ctx, `${seed}:crystal`, size, [light, dark], 26, 1, 2);
  for (let offset = 2; offset < size; offset += 5) {
    fillRect(ctx, offset, 0, 1, size, light, 0.18);
  }
}

function paintOre(ctx: CanvasRenderingContext2D, size: number, stone: number, ore: number, seed: string): void {
  paintStone(ctx, size, rgb(stone), `${seed}:ore-base`, false);
  scatter(ctx, `${seed}:ore`, size, [ore, lighten(ore, 0.18), darken(ore, 0.24)], 20, 2, 3);
}

function paintBone(ctx: CanvasRenderingContext2D, size: number, seed: string): void {
  fillRect(ctx, 0, 0, size, size, 0xcfc0a2);
  scatter(ctx, `${seed}:bone`, size, [0xe4d9c1, 0x9d8f77], 28, 1, 2);
  fillRect(ctx, 2, Math.floor(size / 2) - 1, size - 4, 2, 0xf7efd9, 0.8);
}

function paintChest(ctx: CanvasRenderingContext2D, size: number, dark: boolean): void {
  fillRect(ctx, 0, 0, size, size, dark ? 0x684422 : 0x8f5c27);
  fillRect(ctx, 0, Math.floor(size * 0.4), size, 2, 0x4a2c12);
  fillRect(ctx, 0, Math.floor(size * 0.36), size, 1, 0xc89659, 0.6);
  fillRect(ctx, Math.floor(size / 2) - 1, Math.floor(size * 0.45), 2, 4, 0xd8c689);
  strokeRect(ctx, 1, 1, size - 2, size - 2, 0x4a2c12);
}

function paintCraftingTable(ctx: CanvasRenderingContext2D, size: number, variant: FaceVariant): void {
  if (variant === "top") {
    fillRect(ctx, 0, 0, size, size, 0xa97d49);
    for (let y = 0; y < size; y += 4) {
      fillRect(ctx, 0, y, size, 1, 0x6f4824);
    }
    for (let x = 0; x < size; x += 4) {
      fillRect(ctx, x, 0, 1, size, 0x6f4824);
    }
  } else {
    paintPlanks(ctx, size, 0x8a6035, 0x5c3a1f, 0xba8c57);
    fillRect(ctx, 2, 2, size - 4, 3, 0x6b4725, 0.7);
  }
}

function paintFurnace(ctx: CanvasRenderingContext2D, size: number, variant: FaceVariant): void {
  paintStone(ctx, size, rgb(0x696c70), `furnace:${variant}`, false);
  if (variant === "side") {
    fillRect(ctx, 3, 3, size - 6, 4, 0x4d5156);
    fillRect(ctx, 4, 9, size - 8, size - 13, 0x2c2d30);
    strokeRect(ctx, 3, 8, size - 6, size - 11, 0x90959d);
  }
}

function paintBrickLike(ctx: CanvasRenderingContext2D, size: number, base: number, mortar: number, accent: number, vertical: boolean): void {
  fillRect(ctx, 0, 0, size, size, base);
  for (let y = 4; y < size; y += 5) {
    fillRect(ctx, 0, y, size, 1, mortar);
  }
  for (let row = 0; row < size; row += 5) {
    const offset = row % 10 === 0 ? 0 : Math.floor(size / 3);
    for (let x = offset; x < size; x += Math.floor(size / 2)) {
      fillRect(ctx, x, row, 1, 4, mortar);
    }
  }
  if (vertical) {
    fillRect(ctx, 1, 1, size - 2, 1, accent, 0.3);
  }
}

function paintPortalFrame(ctx: CanvasRenderingContext2D, size: number, variant: FaceVariant): void {
  fillRect(ctx, 0, 0, size, size, 0x739c63);
  strokeRect(ctx, 1, 1, size - 2, size - 2, 0x466440);
  if (variant === "top") {
    fillRect(ctx, 4, 4, size - 8, size - 8, 0x1f2d1a);
  } else {
    fillRect(ctx, 3, 3, size - 6, 4, 0x8db07a, 0.6);
  }
}

function paintGlowstone(ctx: CanvasRenderingContext2D, size: number, seed: string): void {
  fillRect(ctx, 0, 0, size, size, 0xffd65a);
  scatter(ctx, `${seed}:glow`, size, [0xfff0a4, 0xe89d16, 0xffc92a], 46, 1, 2);
}
function paintTorchBlock(ctx: CanvasRenderingContext2D, size: number, variant: FaceVariant): void {
  fillRect(ctx, 0, 0, size, size, 0x000000, 0);
  const shaftColor = variant === "top" ? 0x9b6935 : 0x7d4d27;
  fillRect(ctx, Math.floor(size / 2) - 1, 4, 3, size - 6, shaftColor);
  fillRect(ctx, Math.floor(size / 2) - 2, 2, 5, 4, 0xffd36b);
  fillRect(ctx, Math.floor(size / 2) - 1, 1, 3, 2, 0xfff3b0);
  fillRect(ctx, Math.floor(size / 2) - 3, 6, 1, 3, 0xffb247, 0.55);
  fillRect(ctx, Math.floor(size / 2) + 2, 6, 1, 3, 0xffb247, 0.55);
}

function paintGemIcon(ctx: CanvasRenderingContext2D, size: number, palette: [number, number, number]): void {
  fillRect(ctx, 11, 5, 10, 3, palette[0]);
  fillRect(ctx, 8, 8, 16, 10, palette[1]);
  fillRect(ctx, 10, 18, 12, 7, palette[2]);
  fillRect(ctx, 13, 25, 6, 2, palette[0]);
}

function paintMineralIcon(ctx: CanvasRenderingContext2D, size: number, palette: [number, number, number]): void {
  fillRect(ctx, 8, 12, 8, 8, palette[1]);
  fillRect(ctx, 14, 9, 10, 10, palette[0]);
  fillRect(ctx, 11, 17, 13, 8, palette[2]);
  fillRect(ctx, 18, 18, 5, 4, palette[0]);
}

function paintBarIcon(ctx: CanvasRenderingContext2D, size: number, palette: [number, number, number]): void {
  fillRect(ctx, 6, 12, 20, 8, palette[1]);
  fillRect(ctx, 8, 10, 16, 4, palette[0]);
  fillRect(ctx, 8, 20, 16, 2, palette[2]);
  strokeRect(ctx, 6, 12, 20, 8, palette[2]);
}

function paintStickIcon(ctx: CanvasRenderingContext2D, size: number): void {
  fillRect(ctx, 9, 22, 4, 4, 0x5d331c);
  fillRect(ctx, 12, 18, 4, 4, 0x7e4d2b);
  fillRect(ctx, 15, 14, 4, 4, 0x99643c);
  fillRect(ctx, 18, 10, 4, 4, 0xb98458);
}
function paintTorchIcon(ctx: CanvasRenderingContext2D, size: number): void {
  fillRect(ctx, 13, 19, 4, 9, 0x8d5a2e);
  fillRect(ctx, 12, 14, 6, 6, 0xffcc63);
  fillRect(ctx, 13, 10, 4, 5, 0xff9f3e);
  fillRect(ctx, 14, 7, 2, 4, 0xfff1a8);
  fillRect(ctx, 10, 16, 2, 3, 0xffa13f, 0.5);
  fillRect(ctx, 18, 16, 2, 3, 0xffa13f, 0.5);
}

function paintEyeIcon(ctx: CanvasRenderingContext2D, size: number): void {
  fillRect(ctx, 7, 11, 18, 10, 0xe0d6aa);
  fillRect(ctx, 9, 13, 14, 6, 0x76b35f);
  fillRect(ctx, 14, 13, 4, 6, 0x243120);
  fillRect(ctx, 10, 21, 12, 4, 0xb0a167);
}

function paintFlintAndSteelIcon(ctx: CanvasRenderingContext2D, size: number): void {
  fillRect(ctx, 8, 16, 12, 4, 0x6f4d2f);
  fillRect(ctx, 12, 10, 10, 6, 0xbfc4cc);
  fillRect(ctx, 18, 7, 6, 5, 0x565b63);
  fillRect(ctx, 14, 20, 8, 4, 0xd3d9e0);
}

function paintPickaxeIcon(ctx: CanvasRenderingContext2D, size: number, head: number, handle: number): void {
  fillRect(ctx, 14, 10, 4, 16, handle);
  fillRect(ctx, 8, 7, 16, 4, head);
  fillRect(ctx, 6, 9, 4, 4, head);
  fillRect(ctx, 22, 9, 4, 4, head);
}

function paintSwordIcon(ctx: CanvasRenderingContext2D, size: number, blade: number, handle: number): void {
  fillRect(ctx, 14, 6, 4, 16, blade);
  fillRect(ctx, 12, 10, 8, 4, blade);
  fillRect(ctx, 11, 20, 10, 3, handle);
  fillRect(ctx, 14, 23, 4, 6, handle);
}

function paintShovelIcon(ctx: CanvasRenderingContext2D, size: number, head: number, handle: number): void {
  fillRect(ctx, 14, 9, 4, 18, handle);
  fillRect(ctx, 11, 6, 10, 7, head);
  fillRect(ctx, 12, 13, 8, 3, head);
}

function paintAxeIcon(ctx: CanvasRenderingContext2D, size: number, head: number, handle: number): void {
  fillRect(ctx, 14, 8, 4, 19, handle);
  fillRect(ctx, 10, 6, 10, 6, head);
  fillRect(ctx, 8, 10, 7, 6, head);
  fillRect(ctx, 18, 8, 3, 4, lighten(head, 0.18));
}

function scatter(
  ctx: CanvasRenderingContext2D,
  seed: string,
  size: number,
  palette: Array<number | Rgb>,
  count: number,
  minSize: number,
  maxSize: number,
  insetX = 0,
  insetY = 0,
  regionWidth = size,
  regionHeight = size,
): void {
  const random = seeded(seed);
  for (let index = 0; index < count; index += 1) {
    const blockSize = minSize + Math.floor(random() * (maxSize - minSize + 1));
    const x = insetX + Math.floor(random() * Math.max(1, regionWidth - blockSize + 1));
    const y = insetY + Math.floor(random() * Math.max(1, regionHeight - blockSize + 1));
    const color = palette[Math.floor(random() * palette.length)] ?? palette[0] ?? 0xffffff;
    fillRect(ctx, x, y, blockSize, blockSize, typeof color === "number" ? color : toHex(color));
  }
}

function fillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number | string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = typeof color === "number" ? `#${color.toString(16).padStart(6, "0")}` : color;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

function strokeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number | string,
  alpha = 1,
): void {
  fillRect(ctx, x, y, width, 1, color, alpha);
  fillRect(ctx, x, y + height - 1, width, 1, color, alpha);
  fillRect(ctx, x, y, 1, height, color, alpha);
  fillRect(ctx, x + width - 1, y, 1, height, color, alpha);
}

function faceHex(blockId: BlockId, variant: FaceVariant): number {
  const def = BLOCK_DEFS[blockId];
  if (variant === "top" && def.topColor) {
    return def.topColor;
  }
  if (variant === "bottom" && def.bottomColor) {
    return def.bottomColor;
  }
  if (variant === "side" && def.sideColor) {
    return def.sideColor;
  }
  return def.color;
}

function seeded(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let value = Math.imul(hash ^ (hash >>> 15), 1 | hash);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex: number): Rgb {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

function toHex(color: Rgb): number {
  return ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff);
}

function lighten(hex: number, amount: number): number {
  return toHex(lightenRgb(rgb(hex), amount));
}

function darken(hex: number, amount: number): number {
  return toHex(darkenRgb(rgb(hex), amount));
}

function lightenRgb(color: Rgb, amount: number): Rgb {
  return {
    r: Math.min(255, Math.round(color.r + (255 - color.r) * amount)),
    g: Math.min(255, Math.round(color.g + (255 - color.g) * amount)),
    b: Math.min(255, Math.round(color.b + (255 - color.b) * amount)),
  };
}

function darkenRgb(color: Rgb, amount: number): Rgb {
  return {
    r: Math.max(0, Math.round(color.r * (1 - amount))),
    g: Math.max(0, Math.round(color.g * (1 - amount))),
    b: Math.max(0, Math.round(color.b * (1 - amount))),
  };
}





