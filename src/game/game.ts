import * as THREE from "three";
import { BIOME_DEFS, MOB_DEFS, BLOCK_DEFS, ITEM_DEFS, WORLD_GEN_CONFIG } from "../data/catalog";
import type {
  BlockEntityData,
  BlockId,
  DimensionId,
  GameMode,
  InputProfile,
  ItemId,
  PlayerState,
  WorldMeta,
} from "./contracts";
import { HudController, type OverlayLegendItem, type OverlayModel, type OverlayRecipeCard } from "../ui/hud";
import { createItemIconTexture, createVoxelAtlasTexture } from "../render/voxelArt";
import {
  HOTBAR_SIZE,
  IndexedDbSaveRepository,
  VoxelWorld,
  addItemToInventory,
  buildChunkGeometry,
  clamp,
  clonePlayerState,
  countInventoryItem,
  craftRecipeInInventory,
  createInitialWorldMeta,
  createWorldSave,
  getBiomeLabel,
  getCraftingOptions,
  getDimensionLabel,
  getFurnaceOptions,
  getHeldItemId,
  isBlockPlaceable,
  removeItemsFromInventory,
  transferInventorySlot,
  serializeWorldSave,
  smeltRecipeInInventory,
} from "./logic";

interface MobEntity {
  id: string;
  mobId: keyof typeof MOB_DEFS;
  dimension: DimensionId;
  mesh: THREE.Group;
  health: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  aggressive: boolean;
  attackCooldown: number;
  wanderTimer: number;
  heading: THREE.Vector3;
}

interface DroppedItemEntity {
  id: string;
  itemId: ItemId;
  count: number;
  dimension: DimensionId;
  mesh: THREE.Sprite;
  position: THREE.Vector3;
  baseY: number;
  age: number;
  pickupDelay: number;
  phase: number;
}

type OverlayState =
  | { kind: "inventory" }
  | { kind: "crafting" }
  | { kind: "furnace" }
  | { kind: "chest"; key: string }
  | { kind: "gameover"; hardcore: boolean }
  | { kind: "ending" }
  | { kind: "map" }
  | null;

type BlockTarget = {
  kind: "block";
  blockId: BlockId;
  block: THREE.Vector3;
  place: THREE.Vector3;
};

type MobTarget = {
  kind: "mob";
  mob: MobEntity;
};

class RuntimeInput implements InputProfile {
  moveX = 0;
  moveZ = 0;
  lookX = 0;
  lookY = 0;
  jump = false;
  descend = false;
  breakHeld = false;
  placePressed = false;
  interactPressed = false;
  attackPressed = false;
  inventoryPressed = false;
  mapPressed = false;
  toggleFlightPressed = false;
  selectedHotbar: number | null = null;
  hotbarScrollDelta = 0;
  pointerLocked = false;

  private readonly keys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly mobile = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  private readonly joystick: HTMLElement;
  private readonly joystickThumb: HTMLElement;
  private readonly lookArea: HTMLElement;
  private joystickPointerId: number | null = null;
  private lookPointerId: number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private lastLookPoint = { x: 0, y: 0 };
  private lookStartPoint = { x: 0, y: 0 };
  private lastJumpTapAt = 0;
  private lastDesktopJumpTapAt = 0;
  private lookMoved = false;
  private holdTriggered = false;
  private holdTimer: number | null = null;
  private uiCaptured = true;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.canvas = canvas;
    this.canvas.style.touchAction = "none";
    this.joystick = root.querySelector<HTMLElement>("#mobile-joystick")!;
    this.joystickThumb = root.querySelector<HTMLElement>("#mobile-joystick-thumb")!;
    this.lookArea = root.querySelector<HTMLElement>("#mobile-look-area")!;
    this.bindDesktop(root);
    this.bindMobile(root);
  }

  setUiCaptured(captured: boolean): void {
    this.uiCaptured = captured;
    this.clearHoldTimer();
    this.breakHeld = false;
    if (captured && document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  consumeFrameState(): void {
    this.lookX = 0;
    this.lookY = 0;
    this.placePressed = false;
    this.interactPressed = false;
    this.attackPressed = false;
    this.inventoryPressed = false;
    this.mapPressed = false;
    this.toggleFlightPressed = false;
    this.selectedHotbar = null;
    this.hotbarScrollDelta = 0;
  }

  private bindDesktop(root: HTMLElement): void {
    window.addEventListener("keydown", (event) => {
      if (this.isEditableTarget(event.target)) {
        return;
      }
      const isRepeat = event.repeat;
      this.keys.add(event.code);
      if (event.code === "Space" && !isRepeat) {
        const now = performance.now();
        if (now - this.lastDesktopJumpTapAt < 320) this.toggleFlightPressed = true;
        this.lastDesktopJumpTapAt = now;
      }
      if (event.code === "KeyE") this.inventoryPressed = true;
      if (event.code === "KeyM") this.mapPressed = true;
      if (event.code === "KeyF") this.interactPressed = true;
      if (/Digit[1-9]/.test(event.code)) {
        this.selectedHotbar = Number(event.code.slice(-1)) - 1;
      }
    });
    window.addEventListener("keyup", (event) => {
      if (this.isEditableTarget(event.target)) {
        return;
      }
      this.keys.delete(event.code);
    });
    this.canvas.addEventListener("click", () => {
      if (!this.mobile && !this.uiCaptured && document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
      }
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        if (this.mobile || this.uiCaptured) return;
        event.preventDefault();
        this.hotbarScrollDelta += event.deltaY > 0 ? 1 : -1;
      },
      { passive: false },
    );
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener("mousemove", (event) => {
      if (!this.pointerLocked || this.uiCaptured) return;
      this.lookX += event.movementX;
      this.lookY += event.movementY;
    });
    window.addEventListener("mousedown", (event) => {
      if (this.isEditableTarget(event.target)) return;
      if (this.uiCaptured) return;
      if (event.button === 0) {
        this.breakHeld = true;
        this.attackPressed = true;
      }
      if (event.button === 2) this.placePressed = true;
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button === 0) this.breakHeld = false;
    });
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.breakHeld = false;
      this.clearHoldTimer();
    });
    root.addEventListener("pointerdown", (event) => {
      const hotbarButton = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-hotbar-index]");
      if (!hotbarButton) {
        return;
      }
      const raw = hotbarButton.dataset.hotbarIndex;
      if (raw) {
        this.selectedHotbar = Number(raw);
      }
    });
  }

  private bindMobile(root: HTMLElement): void {
    const jumpButton = root.querySelector<HTMLElement>("#mobile-jump")!;
    const descendButton = root.querySelector<HTMLElement>("#mobile-descend")!;
    const inventoryButton = root.querySelector<HTMLElement>("#mobile-inventory")!;
    const mapButton = root.querySelector<HTMLElement>("#mobile-map")!;

    jumpButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      jumpButton.setPointerCapture(event.pointerId);
      const now = performance.now();
      if (now - this.lastJumpTapAt < 320) {
        this.toggleFlightPressed = true;
      }
      this.lastJumpTapAt = now;
      this.jump = true;
    });
    const resetJump = () => {
      this.jump = false;
    };
    jumpButton.addEventListener("pointerup", resetJump);
    jumpButton.addEventListener("pointercancel", resetJump);

    descendButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      descendButton.setPointerCapture(event.pointerId);
      this.descend = true;
    });
    const resetDescend = () => {
      this.descend = false;
    };
    descendButton.addEventListener("pointerup", resetDescend);
    descendButton.addEventListener("pointercancel", resetDescend);

    inventoryButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      inventoryButton.setPointerCapture(event.pointerId);
      this.inventoryPressed = true;
    });

    mapButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      mapButton.setPointerCapture(event.pointerId);
      this.mapPressed = true;
    });

    this.joystick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.joystickPointerId = event.pointerId;
      const rect = this.joystick.getBoundingClientRect();
      this.joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.joystick.setPointerCapture(event.pointerId);
      this.updateJoystick(event.clientX, event.clientY);
    });
    this.joystick.addEventListener("pointermove", (event) => {
      event.preventDefault();
      if (event.pointerId !== this.joystickPointerId) return;
      this.updateJoystick(event.clientX, event.clientY);
    });
    const resetJoystick = () => {
      this.joystickPointerId = null;
      this.moveX = 0;
      this.moveZ = 0;
      this.joystickThumb.style.transform = "translate(0px, 0px)";
    };
    this.joystick.addEventListener("pointerup", resetJoystick);
    this.joystick.addEventListener("pointercancel", resetJoystick);

    this.lookArea.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (this.uiCaptured) return;
      this.lookPointerId = event.pointerId;
      this.lookStartPoint = { x: event.clientX, y: event.clientY };
      this.lastLookPoint = { x: event.clientX, y: event.clientY };
      this.lookMoved = false;
      this.holdTriggered = false;
      this.lookArea.setPointerCapture(event.pointerId);
      this.clearHoldTimer();
      this.holdTimer = window.setTimeout(() => {
        if (this.lookPointerId === event.pointerId && !this.lookMoved && !this.uiCaptured) {
          this.breakHeld = true;
          this.attackPressed = true;
          this.holdTriggered = true;
        }
      }, 260);
    });
    this.lookArea.addEventListener("pointermove", (event) => {
      event.preventDefault();
      if (event.pointerId !== this.lookPointerId || this.uiCaptured) return;
      const deltaX = event.clientX - this.lastLookPoint.x;
      const deltaY = event.clientY - this.lastLookPoint.y;
      this.lookX += deltaX;
      this.lookY += deltaY;
      this.lastLookPoint = { x: event.clientX, y: event.clientY };
      const distance = Math.hypot(
        event.clientX - this.lookStartPoint.x,
        event.clientY - this.lookStartPoint.y,
      );
      if (distance > 10) {
        this.lookMoved = true;
        this.clearHoldTimer();
      }
    });
    const resetLook = (event?: PointerEvent) => {
      if (event && event.pointerId !== this.lookPointerId) return;
      this.clearHoldTimer();
      if (!this.uiCaptured && !this.lookMoved && !this.holdTriggered) {
        this.placePressed = true;
        this.interactPressed = true;
        this.attackPressed = true;
      }
      this.breakHeld = false;
      this.lookPointerId = null;
      this.lookMoved = false;
      this.holdTriggered = false;
      this.lastLookPoint = { x: 0, y: 0 };
      this.lookStartPoint = { x: 0, y: 0 };
    };
    this.lookArea.addEventListener("pointerup", (event) => resetLook(event));
    this.lookArea.addEventListener("pointercancel", (event) => resetLook(event));
  }

  updateDerivedState(): void {
    if (!this.mobile) {
      const horizontal =
        (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
      const vertical =
        (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0);
      this.moveX = horizontal;
      this.moveZ = vertical;
      this.jump = this.keys.has("Space");
      this.descend = this.keys.has("ShiftLeft") || this.keys.has("ControlLeft");
    }
  }

  private updateJoystick(clientX: number, clientY: number): void {
    const dx = clientX - this.joystickCenter.x;
    const dy = clientY - this.joystickCenter.y;
    const radius = 44;
    const length = Math.min(radius, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const offsetX = Math.cos(angle) * length;
    const offsetY = Math.sin(angle) * length;
    this.joystickThumb.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    this.moveX = clamp(offsetX / radius, -1, 1);
    this.moveZ = clamp(offsetY / radius, -1, 1);
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return Boolean(target.closest("input, textarea, select, button, label"));
  }
}

export class YudanCraftGame {
  private readonly repository = new IndexedDbSaveRepository();
  private readonly ui: HudController;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly raycaster = new THREE.Raycaster();
  private readonly clock = new THREE.Clock();
  private readonly input: RuntimeInput;
  private readonly chunkMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, map: createVoxelAtlasTexture(), transparent: true, alphaTest: 0.18, side: THREE.DoubleSide });
  private readonly chunkMeshes = new Map<string, THREE.Mesh>();
  private readonly mobs: MobEntity[] = [];
  private readonly droppedItems: DroppedItemEntity[] = [];
  private readonly selectionOutline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01)),
    new THREE.LineBasicMaterial({ color: 0xf8f1cc }),
  );
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.6);
  private readonly sun = new THREE.DirectionalLight(0xfff4d6, 1.3);
  private readonly blockLights = Array.from({ length: 8 }, () => new THREE.PointLight(0xffd38a, 0, 14, 2));
  private readonly heldItemAnchor = new THREE.Group();
  private readonly mobile = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;

  private world: VoxelWorld | null = null;
  private meta: WorldMeta | null = null;
  private player: PlayerState | null = null;
  private overlayState: OverlayState = null;
  private overlaySelection: { container: "player" | "chest"; index: number } | null = null;
  private activeTarget: BlockTarget | MobTarget | null = null;
  private breakTargetKey = "";
  private breakProgress = 0;
  private saveAccumulator = 0;
  private portalCooldown = 0;
  private currentMessage = "";
  private messageUntil = 0;
  private ended = false;
  private heldItemMesh: THREE.Object3D | null = null;
  private heldItemId: ItemId | null = null;
  private heldItemSwingTime = 1;
  private heldItemSwingCooldown = 0;
  private heldItemSwingStyle: "use" | "break" = "use";
  private dayCycle = 0.3;
  private lightProbeCooldown = 0;

  constructor(root: HTMLElement) {
    this.ui = new HudController(root);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.enabled = false;
    this.ui.canvasMount.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x9fcbef);
    this.scene.add(this.camera);
    this.scene.add(this.ambient);
    this.sun.position.set(0.8, 1.4, 0.6);
    this.scene.add(this.sun);
    for (const light of this.blockLights) {
      light.visible = false;
      this.scene.add(light);
    }
    this.heldItemAnchor.position.set(0.58, -0.44, -0.88);
    this.camera.add(this.heldItemAnchor);
    this.selectionOutline.visible = false;
    this.scene.add(this.selectionOutline);
    this.input = new RuntimeInput(this.renderer.domElement, root);
    this.bindUi();
    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("beforeunload", () => {
      void this.persistCurrentWorld();
    });
    this.onResize();
  }

  async init(): Promise<void> {
    await this.refreshWorldList();
    this.ui.showMenu(true);
    this.ui.showHud(false);
    this.ui.showMobileHud(false);
    this.loop();
  }

  private bindUi(): void {
    this.ui.bindMenuHandlers({
      onCreateWorld: async ({ name, seed, mode }) => {
        this.ui.showLoading("Creating world...");
        try {
          const meta = createInitialWorldMeta(name, seed, mode);
          const save = createWorldSave(meta);
          await this.repository.createWorld(meta, save);
          await this.loadWorld(meta.id);
        } finally {
          this.ui.showLoading(null);
        }
      },
      onLoadWorld: async (worldId) => {
        this.ui.showLoading("Opening world...");
        try {
          await this.loadWorld(worldId);
        } finally {
          this.ui.showLoading(null);
        }
      },
      onDeleteWorld: async (worldId) => {
        await this.repository.deleteWorld(worldId);
        await this.refreshWorldList();
      },
    });

    this.ui.bindHudHandlers({
      onHotbarSelect: (index) => {
        if (this.player) this.player.selectedHotbarIndex = index;
      },
      onMenu: async () => {
        if (!this.world) return;
        this.ui.showLoading("Saving and returning to menu...");
        try {
          await this.returnToMenu();
        } finally {
          this.ui.showLoading(null);
        }
      },
      onOverlayAction: (actionId) => {
        void this.handleOverlayAction(actionId);
      },
      onOverlaySlotClick: (container, index) => {
        this.handleOverlaySlotClick(container, index);
      },
    });
  }

  private async refreshWorldList(): Promise<void> {
    this.ui.renderWorldList(await this.repository.listWorlds());
  }

  private async loadWorld(worldId: string): Promise<void> {
    const save = await this.repository.loadWorld(worldId);
    if (!save) return;
    if (save.meta.locked) {
      this.flashMessage("This hardcore world is locked.");
      await this.refreshWorldList();
      return;
    }

    this.world = new VoxelWorld(save);
    this.meta = { ...save.meta };
    this.player = clonePlayerState(save.player);
    this.player.position = { ...save.player.position };
    this.ui.showMenu(false);
    this.ui.showHud(true);
    this.ui.showMobileHud(this.mobile);
    this.overlayState = null;
    this.overlaySelection = null;
    this.ended = false;
    this.breakProgress = 0;
    this.breakTargetKey = "";
    this.dayCycle = 0.3;
    this.heldItemSwingTime = 1;
    this.heldItemSwingCooldown = 0;
    this.heldItemSwingStyle = "use";
    this.setUiCapture(false);
    this.disposeChunkMeshes();
    this.clearMobs();
    this.clearDroppedItems();
    this.spawnDragonIfNeeded();
    this.updateEnvironment();
    this.updateHeldItemModel();
    this.updateCameraTransform();
    this.ensureChunksAroundPlayer();
    this.updateTargetSelection();
    this.render();
    this.flashMessage("World ready. Tap or click the view to start.");
  }

  private async returnToMenu(): Promise<void> {
    await this.persistCurrentWorld();
    this.world = null;
    this.meta = null;
    this.player = null;
    this.overlayState = null;
    this.overlaySelection = null;
    this.activeTarget = null;
    this.breakProgress = 0;
    this.breakTargetKey = "";
    this.disposeChunkMeshes();
    this.clearMobs();
    this.clearDroppedItems();
    this.clearHeldItemModel();
    this.setUiCapture(true);
    this.ui.showOverlay(null);
    this.ui.showHud(false);
    this.ui.showMobileHud(false);
    this.ui.showMenu(true);
    await this.refreshWorldList();
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.input.updateDerivedState();
    this.updateMessageState();
    if (this.world && this.player) {
      this.updateGame(dt);
      this.render();
    }
    this.input.consumeFrameState();
  };

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private setUiCapture(captured: boolean): void {
    this.input.setUiCaptured(captured);
  }

  private flashMessage(message: string, durationMs = 2800): void {
    this.currentMessage = message;
    this.messageUntil = performance.now() + durationMs;
    this.ui.setMessage(message);
  }

  private updateMessageState(): void {
    if (this.currentMessage && performance.now() > this.messageUntil) {
      this.currentMessage = "";
      this.ui.setMessage("");
    }
  }

  private async persistCurrentWorld(): Promise<void> {
    if (!this.world || !this.meta || !this.player) return;
    this.meta.lastPlayedAt = new Date().toISOString();
    const save = serializeWorldSave(this.meta, this.player, this.world);
    await this.repository.saveWorld(save);
  }

  private async handleOverlayAction(actionId: string): Promise<void> {
    if (!this.player || !this.world || !this.meta) return;
    if (actionId === "close") {
      this.overlayState = null;
      this.overlaySelection = null;
      this.ui.showOverlay(null);
      this.setUiCapture(false);
      return;
    }
    if (actionId === "respawn") {
      this.respawnPlayer();
      return;
    }
    if (actionId === "menu") {
      await this.returnToMenu();
      return;
    }
    if (actionId.startsWith("craft:")) {
      if (craftRecipeInInventory(this.player.inventory, actionId.slice(6))) {
        this.flashMessage("Crafted.");
      }
      this.overlaySelection = null;
      this.renderOverlay();
      return;
    }
    if (actionId.startsWith("smelt:")) {
      if (smeltRecipeInInventory(this.player.inventory, actionId.slice(6))) {
        this.flashMessage("Smelted.");
      }
      this.overlaySelection = null;
      this.renderOverlay();
    }
  }

  private getOverlayContainerState(
    container: "player" | "chest",
  ): { slots: Array<{ itemId: ItemId; count: number } | null> } | null {
    if (!this.player || !this.world) return null;
    if (container === "player") {
      return this.player.inventory;
    }
    if (this.overlayState?.kind !== "chest") {
      return null;
    }
    const entity = this.world.blockEntities.get(this.overlayState.key);
    return entity?.inventory ?? null;
  }

  private getOverlaySlot(
    container: "player" | "chest",
    index: number,
  ): { itemId: ItemId; count: number } | null {
    return this.getOverlayContainerState(container)?.slots[index] ?? null;
  }

  private transferOverlaySelection(container: "player" | "chest", index: number): boolean {
    if (!this.overlaySelection) return false;
    const source = this.getOverlayContainerState(this.overlaySelection.container);
    const destination = this.getOverlayContainerState(container);
    if (!source || !destination) return false;
    return transferInventorySlot(source, this.overlaySelection.index, destination, index);
  }

  private handleOverlaySlotClick(container: "player" | "chest" | "creative", index: number): void {
    if (!this.player || !this.world || !this.overlayState) return;

    if (container === "creative") {
      if (this.overlayState.kind !== "inventory" || this.player.mode !== "creative") return;
      const slot = this.buildCreativeCatalogSlots()[index];
      if (!slot) return;
      const targetIndex = this.overlaySelection?.container === "player"
        ? this.overlaySelection.index
        : this.player.selectedHotbarIndex;
      this.giveCreativeItem(slot.itemId, targetIndex);
      this.overlaySelection = { container: "player", index: targetIndex };
      this.renderOverlay();
      return;
    }

    if (container === "chest" && this.overlayState.kind !== "chest") return;
    if (container === "player" && !["inventory", "crafting", "furnace", "chest"].includes(this.overlayState.kind)) return;

    if (!this.overlaySelection) {
      const clicked = this.getOverlaySlot(container, index);
      if (!clicked) return;
      this.overlaySelection = { container, index };
      this.renderOverlay();
      return;
    }

    if (this.overlaySelection.container === container && this.overlaySelection.index === index) {
      this.overlaySelection = null;
      this.renderOverlay();
      return;
    }

    this.transferOverlaySelection(container, index);
    this.overlaySelection = null;
    this.renderOverlay();
  }

  private updateGame(dt: number): void {
    const player = this.player!;
    this.saveAccumulator += dt;
    this.portalCooldown = Math.max(0, this.portalCooldown - dt);
    this.lightProbeCooldown = Math.max(0, this.lightProbeCooldown - dt);
    this.dayCycle = (this.dayCycle + dt / 300) % 1;
    this.heldItemSwingCooldown = Math.max(0, this.heldItemSwingCooldown - dt);
    this.heldItemSwingTime = Math.min(1, this.heldItemSwingTime + dt / (this.heldItemSwingStyle === "break" ? 0.16 : 0.22));

    if (this.input.selectedHotbar !== null) {
      player.selectedHotbarIndex = ((this.input.selectedHotbar % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    }
    if (this.input.hotbarScrollDelta !== 0) {
      player.selectedHotbarIndex =
        (player.selectedHotbarIndex + this.input.hotbarScrollDelta + HOTBAR_SIZE * 8) % HOTBAR_SIZE;
    }
    if (this.input.toggleFlightPressed && player.mode === "creative" && player.flightEnabled) {
      player.isFlying = !player.isFlying;
      player.velocity.y = 0;
      this.flashMessage(player.isFlying ? "Flight enabled." : "Flight disabled.", 1400);
    }
    if (this.input.mapPressed) {
      if (this.overlayState?.kind === "map") {
        this.overlayState = null;
        this.overlaySelection = null;
        this.ui.showOverlay(null);
        this.setUiCapture(false);
      } else {
        this.overlayState = { kind: "map" };
        this.overlaySelection = null;
        this.setUiCapture(true);
        this.renderOverlay();
      }
    }
    if (this.input.inventoryPressed) {
      if (this.overlayState) {
        this.overlayState = null;
        this.overlaySelection = null;
        this.ui.showOverlay(null);
        this.setUiCapture(false);
      } else {
        this.overlayState = { kind: "inventory" };
        this.overlaySelection = null;
        this.setUiCapture(true);
        this.renderOverlay();
      }
    }

    if (!this.overlayState) {
      this.updateCameraRotation(dt);
      this.updateMovement(dt);
      this.ensureChunksAroundPlayer();
      this.updateTargetSelection();
      this.handleInteractions(dt);
      this.updatePortals();
      this.spawnMobs(dt);
      this.updateMobs(dt);
    }

    this.updateEnvironment();
    this.updateCameraTransform();
    this.updateHeldItemModel();
    this.updateHeldItemPose();
    this.updateDroppedItems(dt);
    this.updateHud();

    if (this.saveAccumulator >= 5) {
      this.saveAccumulator = 0;
      void this.persistCurrentWorld();
    }
  }

  private updateCameraRotation(_dt: number): void {
    const player = this.player!;
    const sensitivity = 0.0025;
    player.yaw -= this.input.lookX * sensitivity;
    player.pitch = clamp(player.pitch - this.input.lookY * sensitivity, -1.45, 1.45);
  }

  private updateMovement(dt: number): void {
    const player = this.player!;
    const move = new THREE.Vector3(this.input.moveX, 0, this.input.moveZ);
    if (move.lengthSq() > 1) move.normalize();
    move.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

    const flying = player.mode === "creative" && player.flightEnabled && player.isFlying;
    const speed = flying ? 7.4 : player.mode === "creative" ? 6 : 4.8;
    const desiredVelocity = move.multiplyScalar(speed);
    player.velocity.x = desiredVelocity.x;
    player.velocity.z = desiredVelocity.z;

    if (flying) {
      player.velocity.y = (this.input.jump ? speed : 0) - (this.input.descend ? speed : 0);
    } else {
      player.velocity.y -= 20 * dt;
      if (this.isOnGround()) {
        player.velocity.y = Math.max(player.velocity.y, 0);
        if (this.input.jump) player.velocity.y = 7.4;
      }
    }

    this.moveHorizontal(player.velocity.x * dt, 0, flying);
    this.moveHorizontal(0, player.velocity.z * dt, flying);
    this.moveVertical(player.velocity.y * dt);
  }

  private moveHorizontal(dx: number, dz: number, flying: boolean): void {
    if (dx === 0 && dz === 0) return;
    const player = this.player!;
    const next = { ...player.position, x: player.position.x + dx, z: player.position.z + dz };
    if (!this.collides(next)) {
      player.position.x = next.x;
      player.position.z = next.z;
      return;
    }
    if (flying || !this.isOnGround()) return;

    const stepHeight = 1.05;
    const lifted = { ...player.position, y: player.position.y + stepHeight };
    if (this.collides(lifted)) return;
    const stepped = { ...lifted, x: lifted.x + dx, z: lifted.z + dz };
    if (this.collides(stepped)) return;

    player.position.x = stepped.x;
    player.position.y = stepped.y;
    player.position.z = stepped.z;
    player.velocity.y = 0;
    this.settlePlayer(stepHeight);
  }

  private moveVertical(dy: number): void {
    if (dy === 0) return;
    const player = this.player!;
    const next = { ...player.position, y: player.position.y + dy };
    if (!this.collides(next)) {
      player.position.y = next.y;
      return;
    }
    player.velocity.y = 0;
  }

  private settlePlayer(maxDrop: number): void {
    const player = this.player!;
    let remaining = maxDrop;
    while (remaining > 0) {
      const drop = Math.min(0.12, remaining);
      const next = { ...player.position, y: player.position.y - drop };
      if (this.collides(next)) break;
      player.position.y = next.y;
      remaining -= drop;
    }
  }

  private collides(position: { x: number; y: number; z: number }): boolean {
    const world = this.world!;
    const width = 0.33;
    const minX = Math.floor(position.x - width);
    const maxX = Math.floor(position.x + width);
    const minY = Math.floor(position.y);
    const maxY = Math.floor(position.y + 1.74);
    const minZ = Math.floor(position.z - width);
    const maxZ = Math.floor(position.z + width);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const blockId = world.getBlockId(this.player!.dimension, x, y, z);
          if (BLOCK_DEFS[blockId].solid && blockId !== "portal" && blockId !== "end_portal") {
            return true;
          }
        }
      }
    }
    return false;
  }

  private getInteractionReach(): number {
    return this.mobile ? 4.75 : 5.75;
  }

  private wouldBlockTrapPlayer(block: THREE.Vector3): boolean {
    const width = 0.33;
    const minX = this.player!.position.x - width;
    const maxX = this.player!.position.x + width;
    const minY = this.player!.position.y;
    const maxY = this.player!.position.y + 1.74;
    const minZ = this.player!.position.z - width;
    const maxZ = this.player!.position.z + width;
    return (
      block.x < maxX &&
      block.x + 1 > minX &&
      block.y < maxY &&
      block.y + 1 > minY &&
      block.z < maxZ &&
      block.z + 1 > minZ
    );
  }

  private isOnGround(position = this.player!.position): boolean {
    return this.collides({ ...position, y: position.y - 0.12 });
  }
  private updateCameraTransform(): void {
    const player = this.player!;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = player.yaw;
    this.camera.rotation.x = player.pitch;
    this.camera.position.set(player.position.x, player.position.y + 1.62, player.position.z);
  }

  private getDaylightAmount(): number {
    return clamp(Math.cos((this.dayCycle - 0.5) * Math.PI * 2) * 0.5 + 0.5, 0, 1);
  }

  private isNightTime(): boolean {
    return this.player?.dimension === "overworld" ? this.getDaylightAmount() < 0.33 : false;
  }

  private updateEnvironment(): void {
    if (!this.player || !this.world) {
      for (const light of this.blockLights) light.visible = false;
      return;
    }
    const background = this.scene.background instanceof THREE.Color ? this.scene.background : new THREE.Color();

    if (this.player.dimension === "nether") {
      background.setHex(0x3a1713);
      this.scene.background = background;
      this.ambient.intensity = 0.72;
      this.sun.intensity = 0.34;
      this.sun.color.setHex(0xff9d69);
      this.sun.position.set(0.3, 0.55, 0.3);
      this.updateNearbyBlockLights();
      return;
    }

    if (this.player.dimension === "end") {
      background.setHex(0x161826);
      this.scene.background = background;
      this.ambient.intensity = 0.6;
      this.sun.intensity = 0.3;
      this.sun.color.setHex(0xd9d1ff);
      this.sun.position.set(-0.25, 0.7, -0.45);
      this.updateNearbyBlockLights();
      return;
    }

    const daylight = this.getDaylightAmount();
    const depthRatio = clamp((WORLD_GEN_CONFIG.seaLevel + 16 - this.player.position.y) / 84, 0, 1);
    const caveBoost = depthRatio * 0.38;
    background.copy(new THREE.Color(0x22364e).lerp(new THREE.Color(0xa8d5f3), daylight));
    this.scene.background = background;
    this.ambient.intensity = 0.4 + daylight * 0.56 + caveBoost;
    this.sun.intensity = 0.18 + daylight * 1.16;
    this.sun.color.setHex(daylight < 0.38 ? 0xf4b06d : 0xfff4d6);
    const sunAngle = (this.dayCycle - 0.25) * Math.PI * 2;
    this.sun.position.set(Math.cos(sunAngle) * 1.25, Math.sin(sunAngle) * 1.55, 0.35);
    this.updateNearbyBlockLights();
  }

  private updateNearbyBlockLights(): void {
    if (!this.player || !this.world) {
      for (const light of this.blockLights) light.visible = false;
      return;
    }
    if (this.lightProbeCooldown > 0) {
      return;
    }
    this.lightProbeCooldown = 0.12;

    const centerX = Math.floor(this.player.position.x);
    const centerY = Math.floor(this.player.position.y + 1);
    const centerZ = Math.floor(this.player.position.z);
    const sources: Array<{ x: number; y: number; z: number; level: number; color: number; distance: number }> = [];

    for (let x = centerX - 12; x <= centerX + 12; x += 1) {
      for (let z = centerZ - 12; z <= centerZ + 12; z += 1) {
        for (let y = Math.max(1, centerY - 8); y <= Math.min(WORLD_GEN_CONFIG.worldHeight - 2, centerY + 9); y += 1) {
          const blockId = this.world.getBlockId(this.player.dimension, x, y, z);
          const lightLevel = BLOCK_DEFS[blockId].lightLevel ?? 0;
          if (lightLevel <= 0) continue;
          const distance = Math.hypot(x + 0.5 - this.player.position.x, y + 0.5 - this.player.position.y, z + 0.5 - this.player.position.z);
          if (distance > 14.5) continue;
          sources.push({
            x: x + 0.5,
            y: y + (blockId === "torch" ? 0.86 : 0.58),
            z: z + 0.5,
            level: lightLevel,
            color: blockId === "torch" ? 0xffd782 : 0xffe199,
            distance,
          });
        }
      }
    }

    sources.sort((left, right) => left.distance - right.distance || right.level - left.level);
    for (let index = 0; index < this.blockLights.length; index += 1) {
      const light = this.blockLights[index];
      const source = sources[index];
      if (!source) {
        light.visible = false;
        continue;
      }
      light.visible = true;
      light.position.set(source.x, source.y, source.z);
      light.color.setHex(source.color);
      light.intensity = 0.65 + source.level * 0.18;
      light.distance = 7 + source.level * 1.35;
      light.decay = 1.55;
    }
  }
  private clearHeldItemModel(): void {
    if (!this.heldItemMesh) {
      this.heldItemId = null;
      return;
    }

    this.heldItemMesh.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      if (Array.isArray(node.material)) {
        for (const material of node.material) material.dispose();
      } else {
        node.material.dispose();
      }
    });
    this.heldItemAnchor.remove(this.heldItemMesh);
    this.heldItemMesh = null;
    this.heldItemId = null;
  }

  private updateHeldItemModel(): void {
    const nextItemId = this.player ? getHeldItemId(this.player) : null;
    if (nextItemId === this.heldItemId) return;

    this.clearHeldItemModel();
    if (!nextItemId) return;

    const group = new THREE.Group();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.58),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthTest: false, depthWrite: false }),
    );
    shadow.position.set(0.04, -0.05, -0.02);
    shadow.renderOrder = 999;
    group.add(shadow);

    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.58),
      new THREE.MeshBasicMaterial({
        map: createItemIconTexture(nextItemId),
        transparent: true,
        alphaTest: 0.08,
        depthTest: false,
        depthWrite: false,
      }),
    );
    icon.position.z = 0.01;
    icon.renderOrder = 1000;
    group.add(icon);

    group.position.set(0.14, -0.02, 0);
    group.rotation.set(-0.36, -0.52, 0.08);
    this.heldItemAnchor.add(group);
    this.heldItemMesh = group;
    this.heldItemId = nextItemId;
  }

  private triggerHeldItemSwing(style: "use" | "break", force = false): void {
    if (!force && this.heldItemSwingCooldown > 0 && this.heldItemSwingStyle === style) {
      return;
    }
    this.heldItemSwingStyle = style;
    this.heldItemSwingTime = 0;
    this.heldItemSwingCooldown = style === "break" ? 0.14 : 0.2;
  }

  private updateHeldItemPose(): void {
    const visible = Boolean(this.player && this.heldItemMesh && !this.overlayState && this.player.health > 0);
    this.heldItemAnchor.visible = visible;
    if (!visible) return;

    const moveAmount = Math.min(1, Math.hypot(this.input.moveX, this.input.moveZ));
    const bobTime = performance.now() * 0.008;
    const swing = Math.sin(this.heldItemSwingTime * Math.PI);
    const swingDepth = this.heldItemSwingStyle === "break" ? 1 : 0.72;
    const swingX = (this.heldItemSwingStyle === "break" ? 0.08 : 0.11) * swing;
    const swingY = (this.heldItemSwingStyle === "break" ? -0.18 : -0.09) * swing;
    const swingZ = (this.heldItemSwingStyle === "break" ? 0.05 : 0.03) * swing;
    const rotX = (this.heldItemSwingStyle === "break" ? 0.92 : 0.58) * swing;
    const rotY = (this.heldItemSwingStyle === "break" ? -0.24 : -0.38) * swing;
    const rotZ = (this.heldItemSwingStyle === "break" ? 0.34 : 0.14) * swing;

    this.heldItemAnchor.position.set(
      0.58 + Math.sin(bobTime) * 0.035 * moveAmount + swingX,
      -0.44 - Math.abs(Math.cos(bobTime)) * 0.028 * moveAmount + swingY,
      -0.88 + swingZ,
    );
    this.heldItemAnchor.rotation.set(
      -0.08 + Math.sin(bobTime) * 0.02 * moveAmount + rotX,
      -0.16 + rotY,
      0.02 + rotZ,
    );
    this.heldItemAnchor.scale.setScalar(1 + swing * 0.04 * swingDepth);
  }

  private ensureChunksAroundPlayer(): void {
    const world = this.world!;
    const player = this.player!;
    const mobile = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
    const renderDistance = mobile ? 3 : 5;
    const centerChunkX = Math.floor(player.position.x / WORLD_GEN_CONFIG.chunkSize);
    const centerChunkZ = Math.floor(player.position.z / WORLD_GEN_CONFIG.chunkSize);
    const wanted = new Set<string>();

    for (let dx = -renderDistance; dx <= renderDistance; dx += 1) {
      for (let dz = -renderDistance; dz <= renderDistance; dz += 1) {
        if (dx * dx + dz * dz > renderDistance * renderDistance) continue;
        const chunk = world.ensureChunk(player.dimension, centerChunkX + dx, centerChunkZ + dz);
        const key = `${player.dimension}:${chunk.chunkX}:${chunk.chunkZ}`;
        wanted.add(key);
        if (!this.chunkMeshes.has(key) || chunk.dirty) {
          const geometry = buildChunkGeometry(world, chunk);
          const existing = this.chunkMeshes.get(key);
          if (existing) {
            this.scene.remove(existing);
            existing.geometry.dispose();
          }
          if (geometry) {
            const mesh = new THREE.Mesh(geometry, this.chunkMaterial);
            mesh.position.set(chunk.chunkX * WORLD_GEN_CONFIG.chunkSize, 0, chunk.chunkZ * WORLD_GEN_CONFIG.chunkSize);
            mesh.userData.chunkKey = key;
            this.chunkMeshes.set(key, mesh);
            this.scene.add(mesh);
          } else {
            this.chunkMeshes.delete(key);
          }
          chunk.dirty = false;
        }
      }
    }

    for (const [key, mesh] of this.chunkMeshes) {
      if (!wanted.has(key)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.chunkMeshes.delete(key);
      }
    }
  }

  private updateTargetSelection(): void {
    this.activeTarget = null;
    this.selectionOutline.visible = false;
    const chunkMeshes = [...this.chunkMeshes.values()];
    if (chunkMeshes.length === 0) return;
    this.raycaster.far = this.getInteractionReach();
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);

    const locateMobFromHit = (hit: THREE.Intersection<THREE.Object3D>) =>
      this.mobs.find(
        (entry) =>
          entry.mesh === hit.object ||
          entry.mesh.children.includes(hit.object as THREE.Object3D) ||
          entry.mesh.children.some((child) => child === hit.object || child.children.includes(hit.object as THREE.Object3D)),
      );

    const mobHit = this.raycaster
      .intersectObjects(this.mobs.map((mob) => mob.mesh), true)
      .find((hit) => locateMobFromHit(hit)?.dimension === this.player!.dimension);
    const blockHit = this.raycaster.intersectObjects(chunkMeshes, false)[0];

    if (mobHit && (!blockHit || mobHit.distance <= blockHit.distance)) {
      const mob = locateMobFromHit(mobHit);
      if (mob) {
        this.activeTarget = { kind: "mob", mob };
        return;
      }
    }

    if (!blockHit) return;
    const point = blockHit.point.clone().sub(blockHit.face?.normal.clone().multiplyScalar(0.01) ?? new THREE.Vector3());
    const block = point.floor();
    const place = blockHit.point
      .clone()
      .add(blockHit.face?.normal.clone().multiplyScalar(0.01) ?? new THREE.Vector3())
      .floor();
    const blockId = this.world!.getBlockId(this.player!.dimension, block.x, block.y, block.z);
    this.activeTarget = {
      kind: "block",
      blockId,
      block,
      place,
    };
    this.selectionOutline.visible = blockId !== "air";
    this.selectionOutline.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
  }

  private handleInteractions(dt: number): void {
    const player = this.player!;
    const world = this.world!;
    const heldItemId = getHeldItemId(player);

    if (this.activeTarget?.kind === "mob" && this.input.attackPressed) {
      this.triggerHeldItemSwing("break", true);
      const damage = world.getAttackDamage(heldItemId);
      const targetMobDef = MOB_DEFS[this.activeTarget.mob.mobId];
      this.activeTarget.mob.health -= damage;
      if (targetMobDef.behavior !== "passive") {
        this.activeTarget.mob.aggressive = true;
      }
      this.flashMessage(`${targetMobDef.name} took ${damage} damage.`);
      if (this.activeTarget.mob.health <= 0) this.removeMob(this.activeTarget.mob);
      return;
    }

    if (this.activeTarget?.kind === "block" && this.input.breakHeld) {
      const targetKey = `${this.activeTarget.block.x}:${this.activeTarget.block.y}:${this.activeTarget.block.z}`;
      const mining = world.canBreakBlock(this.activeTarget.blockId, heldItemId);
      if (!mining.allowed) {
        this.breakProgress = 0;
      } else {
        this.triggerHeldItemSwing("break");
        if (this.breakTargetKey !== targetKey) {
          this.breakTargetKey = targetKey;
          this.breakProgress = 0;
        }
        this.breakProgress += mining.speed * dt;
        if (this.breakProgress >= 1) {
          const drop = BLOCK_DEFS[this.activeTarget.blockId].dropItemId;
          world.setBlockId(player.dimension, this.activeTarget.block.x, this.activeTarget.block.y, this.activeTarget.block.z, "air");
          if (drop) {
            this.spawnDroppedItem(
              drop,
              1,
              player.dimension,
              new THREE.Vector3(
                this.activeTarget.block.x + 0.5 + (Math.random() - 0.5) * 0.18,
                this.activeTarget.block.y + 0.34,
                this.activeTarget.block.z + 0.5 + (Math.random() - 0.5) * 0.18,
              ),
            );
          }
          this.breakProgress = 0;
          this.breakTargetKey = "";
          this.flashMessage("Block broken.");
        }
      }
    } else {
      this.breakProgress = 0;
      this.breakTargetKey = "";
    }

    if (this.input.interactPressed) {
      this.triggerHeldItemSwing("use", true);
      if (heldItemId === "eye_of_ender" && !this.activeTarget) {
        const stronghold = world.locateStronghold();
        const dx = stronghold.x - player.position.x;
        const dz = stronghold.z - player.position.z;
        const eastWest = dx > 0 ? "east" : "west";
        const northSouth = dz > 0 ? "south" : "north";
        this.flashMessage(`Stronghold lies ${eastWest} / ${northSouth}.`);
        return;
      }
      if (this.activeTarget?.kind === "block") {
        const blockId = this.activeTarget.blockId;
        if (blockId === "chest") {
          this.overlayState = { kind: "chest", key: `${player.dimension}:${this.activeTarget.block.x}:${this.activeTarget.block.y}:${this.activeTarget.block.z}` };
          this.overlaySelection = null;
          this.setUiCapture(true);
          this.renderOverlay();
          return;
        }
        if (blockId === "crafting_table") {
          this.overlayState = { kind: "crafting" };
          this.overlaySelection = null;
          this.setUiCapture(true);
          this.renderOverlay();
          return;
        }
        if (blockId === "furnace") {
          this.overlayState = { kind: "furnace" };
          this.overlaySelection = null;
          this.setUiCapture(true);
          this.renderOverlay();
          return;
        }
      }
    }

    if (this.input.placePressed && this.activeTarget?.kind === "block") {
      if (heldItemId === "flint_and_steel" && this.activeTarget.blockId === "obsidian") {
        if (world.tryActivateNetherPortal(this.activeTarget.block)) {
          this.triggerHeldItemSwing("use", true);
          this.flashMessage("Nether portal activated.");
        }
        return;
      }
      if (heldItemId === "eye_of_ender" && this.activeTarget.blockId === "portal_frame") {
        if (world.tryFillEndPortalFrame(this.activeTarget.block)) {
          this.triggerHeldItemSwing("use", true);
          if (player.mode !== "creative") removeItemsFromInventory(player.inventory, "eye_of_ender", 1);
          this.flashMessage("End portal frame charged.");
        }
        return;
      }
      if (!isBlockPlaceable(heldItemId)) return;
      if (world.getBlockId(player.dimension, this.activeTarget.place.x, this.activeTarget.place.y, this.activeTarget.place.z) !== "air") return;
      if (this.wouldBlockTrapPlayer(this.activeTarget.place)) return;
      const blockId = ITEM_DEFS[heldItemId].blockId!;
      world.setBlockId(player.dimension, this.activeTarget.place.x, this.activeTarget.place.y, this.activeTarget.place.z, blockId);
      this.triggerHeldItemSwing("use", true);
      if (blockId === "chest") {
        world.blockEntities.set(
          `${player.dimension}:${this.activeTarget.place.x}:${this.activeTarget.place.y}:${this.activeTarget.place.z}`,
          {
            kind: "chest",
            dimension: player.dimension,
            x: this.activeTarget.place.x,
            y: this.activeTarget.place.y,
            z: this.activeTarget.place.z,
            inventory: { slots: Array.from({ length: 27 }, () => null) },
          } satisfies BlockEntityData,
        );
      }
      if (player.mode !== "creative") removeItemsFromInventory(player.inventory, heldItemId, 1);
    }
  }

  private updatePortals(): void {
    if (this.portalCooldown > 0) return;
    const player = this.player!;
    const world = this.world!;
    const feetBlock = world.getBlockId(player.dimension, Math.floor(player.position.x), Math.floor(player.position.y + 0.1), Math.floor(player.position.z));
    if (feetBlock === "portal") {
      if (player.dimension === "overworld") {
        player.dimension = "nether";
        player.position.x = Math.floor(player.position.x / 8) + 0.5;
        player.position.z = Math.floor(player.position.z / 8) + 0.5;
        player.position.y = world.findSurfaceY("nether", Math.floor(player.position.x), Math.floor(player.position.z)) + 2;
      } else if (player.dimension === "nether") {
        player.dimension = "overworld";
        player.position.x = Math.floor(player.position.x * 8) + 0.5;
        player.position.z = Math.floor(player.position.z * 8) + 0.5;
        player.position.y = world.findSurfaceY("overworld", Math.floor(player.position.x), Math.floor(player.position.z)) + 2;
      }
      this.portalCooldown = 2;
      this.disposeChunkMeshes();
      this.flashMessage(`Entered ${getDimensionLabel(player.dimension)}.`);
    }
    if (feetBlock === "end_portal" && player.dimension === "overworld") {
      player.dimension = "end";
      player.position = { x: 0.5, y: 56, z: 0.5 };
      this.portalCooldown = 2;
      this.disposeChunkMeshes();
      this.spawnDragonIfNeeded();
      this.flashMessage("Entered the End.");
    }
  }

  private canHostileMobAct(mob: MobEntity): boolean {
    if (mob.mobId === "ender_dragon") return true;
    if (mob.dimension !== "overworld") return true;
    return this.isNightTime();
  }

  private spawnMobs(dt: number): void {
    if (!this.world || !this.player) return;
    if (this.player.dimension === "overworld" && Math.random() < dt * 0.28 && this.trySpawnVillageVillager()) {
      return;
    }
    if (Math.random() > dt * 0.12) return;
    const current = this.mobs.filter((mob) => mob.dimension === this.player!.dimension && mob.mobId !== "villager");
    if (current.length >= 4) return;
    const ring = 12 + Math.random() * 16;
    const angle = Math.random() * Math.PI * 2;
    const x = Math.floor(this.player.position.x + Math.cos(angle) * ring);
    const z = Math.floor(this.player.position.z + Math.sin(angle) * ring);
    const y = this.world.findSurfaceY(this.player.dimension, x, z) + 1;
    if (this.world.getBlockId(this.player.dimension, x, y, z) !== "air") return;
    const biome = this.world.getBiomeId(this.player.dimension, x, z);
    let mobId: keyof typeof MOB_DEFS = "sheep";

    if (this.player.dimension === "nether") {
      mobId = Math.random() > 0.5 ? "zombie" : "creeper";
    } else if (this.player.dimension === "end") {
      return;
    } else if (biome === "diamond_land") {
      mobId = this.isNightTime() ? "zombie" : Math.random() > 0.5 ? "golem" : "cow";
    } else {
      const passivePool: Array<keyof typeof MOB_DEFS> = ["sheep", "pig", "cow", "chicken", "wolf"];
      const hostilePool: Array<keyof typeof MOB_DEFS> = ["zombie", "skeleton", "creeper", "spider"];
      const pool = this.isNightTime() ? [...passivePool, ...hostilePool, ...hostilePool] : passivePool;
      mobId = pool[Math.floor(Math.random() * pool.length)]!;
    }

    if (this.player.dimension === "overworld" && !this.isNightTime() && MOB_DEFS[mobId].behavior === "hostile") {
      return;
    }
    this.createMob(mobId, this.player.dimension, new THREE.Vector3(x + 0.5, y, z + 0.5));
  }

  private isVillagerSpawnGround(blockId: BlockId): boolean {
    return ["grass", "dirt", "sand", "snow", "cobblestone", "stone_bricks"].includes(blockId);
  }

  private findVillageSpawnPosition(village: { x: number; z: number }): THREE.Vector3 | null {
    if (!this.world) return null;
    const candidates: Array<[number, number]> = [
      [0, 0],
      [0, 3],
      [3, 0],
      [-3, 0],
      [-9, -11],
      [3, -11],
      [-7, 2],
      [5, 2],
      [-10, -8],
      [4, -8],
      [-8, 5],
      [6, 5],
    ];

    for (const [offsetX, offsetZ] of candidates) {
      const x = Math.floor(village.x + offsetX);
      const z = Math.floor(village.z + offsetZ);
      const groundY = this.world.findSurfaceY("overworld", x, z);
      const groundId = this.world.getBlockId("overworld", x, groundY, z);
      if (!this.isVillagerSpawnGround(groundId)) continue;
      if (this.world.getBlockId("overworld", x, groundY + 1, z) !== "air") continue;
      if (this.world.getBlockId("overworld", x, groundY + 2, z) !== "air") continue;
      return new THREE.Vector3(x + 0.5, groundY + 1, z + 0.5);
    }

    return null;
  }

  private trySpawnVillageVillager(): boolean {
    if (!this.world || !this.player || this.player.dimension !== "overworld") return false;
    const villages = this.world
      .getLandmarksNear("overworld", this.player.position, 72)
      .filter((landmark) => landmark.label === "Village");
    if (villages.length === 0) return false;

    for (const village of villages) {
      const localVillagers = this.mobs.filter(
        (mob) => mob.dimension === "overworld" && mob.mobId === "villager" && Math.hypot(mob.position.x - village.x, mob.position.z - village.z) < 22,
      );
      if (localVillagers.length >= 4) continue;

      const spawn = this.findVillageSpawnPosition(village);
      if (!spawn) continue;
      this.createMob("villager", "overworld", spawn);
      return true;
    }

    return false;
  }

  private updateMobs(dt: number): void {
    if (!this.player || !this.world) return;
    for (const mob of this.mobs) {
      mob.mesh.visible = mob.dimension === this.player.dimension;
      if (mob.dimension !== this.player.dimension) continue;
      mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);
      const toPlayer = new THREE.Vector3().subVectors(
        new THREE.Vector3(this.player.position.x, this.player.position.y, this.player.position.z),
        mob.position,
      );
      const distance = toPlayer.length();
      const def = MOB_DEFS[mob.mobId];
      const canActHostile = this.canHostileMobAct(mob);
      if (mob.mobId === "ender_dragon") {
        const time = performance.now() * 0.001;
        mob.position.set(Math.cos(time * 0.5) * 16, 62 + Math.sin(time * 0.8) * 3, Math.sin(time * 0.5) * 16);
        mob.heading.set(-Math.sin(time * 0.5), 0, Math.cos(time * 0.5));
      } else if ((def.behavior === "hostile" || mob.aggressive) && canActHostile) {
        if (distance < 18) {
          toPlayer.y = 0;
          if (toPlayer.lengthSq() > 0.01) {
            toPlayer.normalize();
            mob.heading.copy(toPlayer);
          }
          mob.position.addScaledVector(mob.heading, def.speed * dt);
          mob.position.y = this.world.findSurfaceY(mob.dimension, Math.floor(mob.position.x), Math.floor(mob.position.z)) + 1;
          if (distance < 1.7 && mob.attackCooldown <= 0 && this.player.mode !== "creative") {
            const damage = Math.max(1, Math.ceil(def.attack * (mob.mobId === "ender_dragon" ? 0.45 : 0.25)));
            this.player.health -= damage;
            mob.attackCooldown = mob.mobId === "ender_dragon" ? 2.2 : 2.1;
            this.flashMessage(`${def.name} hit for ${damage}.`);
          }
        }
      } else {
        if (def.behavior === "hostile" && !canActHostile) {
          mob.aggressive = false;
        }
        mob.wanderTimer -= dt;
        if (mob.wanderTimer <= 0) {
          mob.wanderTimer = 2.4 + Math.random() * 4.5;
          mob.heading.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        }
        mob.position.addScaledVector(mob.heading, def.speed * 0.3 * dt);
        mob.position.y = this.world.findSurfaceY(mob.dimension, Math.floor(mob.position.x), Math.floor(mob.position.z)) + 1;
      }
      if (mob.heading.lengthSq() > 0.001) {
        mob.mesh.rotation.y = Math.atan2(mob.heading.x, mob.heading.z);
      }
      mob.mesh.position.copy(mob.position);
    }

    if (this.player.health <= 0 && !this.overlayState) {
      const hardcore = this.player.mode === "hardcore";
      this.overlayState = { kind: "gameover", hardcore };
      if (hardcore && this.meta) this.meta.locked = true;
      this.setUiCapture(true);
      this.overlaySelection = null;
      this.renderOverlay();
    }
  }

  private createMob(mobId: keyof typeof MOB_DEFS, dimension: DimensionId, position: THREE.Vector3): void {
    const def = MOB_DEFS[mobId];
    const group = new THREE.Group();
    const base = new THREE.Color(def.color);
    const light = base.clone().lerp(new THREE.Color(0xffffff), 0.28).getHex();
    const dark = base.clone().multiplyScalar(0.62).getHex();
    const deep = base.clone().multiplyScalar(0.4).getHex();
    const cream = 0xf8e8c8;
    const eye = mobId === "ender_dragon" ? 0xc77dff : 0x111111;
    const addBox = (size: [number, number, number], pos: [number, number, number], color: number, emissive = 0): void => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        new THREE.MeshLambertMaterial({ color, emissive }),
      );
      mesh.position.set(pos[0], pos[1], pos[2]);
      group.add(mesh);
    };

    if (mobId === "sheep") {
      addBox([1.18, 0.82, 0.76], [0, 1.06, 0], light);
      addBox([0.48, 0.52, 0.56], [0.74, 1.08, 0], cream);
      for (const x of [-0.34, 0.34]) for (const z of [-0.22, 0.22]) addBox([0.16, 0.68, 0.16], [x, 0.34, z], deep);
    } else if (mobId === "pig") {
      addBox([1.1, 0.74, 0.72], [0, 1.02, 0], def.color);
      addBox([0.54, 0.48, 0.52], [0.72, 1.02, 0], light);
      addBox([0.18, 0.14, 0.36], [0.98, 0.98, 0], cream);
      for (const x of [-0.32, 0.32]) for (const z of [-0.22, 0.22]) addBox([0.16, 0.62, 0.16], [x, 0.31, z], dark);
    } else if (mobId === "cow") {
      addBox([1.18, 0.84, 0.76], [0, 1.08, 0], def.color);
      addBox([0.54, 0.58, 0.54], [0.76, 1.12, 0], dark);
      addBox([0.2, 0.14, 0.14], [0.96, 1.42, -0.16], cream);
      addBox([0.2, 0.14, 0.14], [0.96, 1.42, 0.16], cream);
      addBox([0.18, 0.18, 0.38], [1.02, 1.04, 0], cream);
      for (const x of [-0.34, 0.34]) for (const z of [-0.22, 0.22]) addBox([0.18, 0.74, 0.18], [x, 0.37, z], deep);
    } else if (mobId === "chicken") {
      addBox([0.62, 0.72, 0.58], [0, 0.98, 0], light);
      addBox([0.38, 0.38, 0.38], [0.36, 1.18, 0], light);
      addBox([0.16, 0.1, 0.2], [0.58, 1.12, 0], 0xf2b541);
      addBox([0.1, 0.22, 0.12], [0.48, 0.96, 0], 0xc94141);
      addBox([0.18, 0.52, 0.08], [-0.1, 0.26, -0.12], 0xf2b541);
      addBox([0.18, 0.52, 0.08], [-0.1, 0.26, 0.12], 0xf2b541);
    } else if (mobId === "wolf") {
      addBox([1.02, 0.62, 0.56], [0, 1, 0], def.color);
      addBox([0.46, 0.46, 0.46], [0.66, 1.08, 0], light);
      addBox([0.14, 0.18, 0.12], [0.72, 1.42, -0.12], deep);
      addBox([0.14, 0.18, 0.12], [0.72, 1.42, 0.12], deep);
      addBox([0.36, 0.12, 0.12], [-0.7, 1.12, 0], cream);
      for (const x of [-0.28, 0.28]) for (const z of [-0.18, 0.18]) addBox([0.14, 0.66, 0.14], [x, 0.33, z], dark);
    } else if (mobId === "villager") {
      addBox([0.62, 0.62, 0.62], [0, 1.74, 0], 0xd7b38c);
      addBox([0.76, 0.98, 0.46], [0, 1.02, 0], 0x8c5a2e);
      addBox([0.16, 0.78, 0.16], [-0.48, 1.02, 0], 0xd7b38c);
      addBox([0.16, 0.78, 0.16], [0.48, 1.02, 0], 0xd7b38c);
      addBox([0.24, 0.94, 0.24], [-0.16, 0.47, 0], 0x4b3c73);
      addBox([0.24, 0.94, 0.24], [0.16, 0.47, 0], 0x4b3c73);
      addBox([0.18, 0.16, 0.16], [0.18, 1.72, -0.31], 0x6f4b31);
    } else if (mobId === "golem") {
      addBox([0.92, 1.2, 0.62], [0, 1.5, 0], def.color);
      addBox([0.6, 0.6, 0.6], [0, 2.42, 0], light);
      addBox([0.22, 1, 0.22], [-0.68, 1.44, 0], dark);
      addBox([0.22, 1, 0.22], [0.68, 1.44, 0], dark);
      addBox([0.24, 1.08, 0.24], [-0.24, 0.54, 0], deep);
      addBox([0.24, 1.08, 0.24], [0.24, 0.54, 0], deep);
    } else if (mobId === "zombie") {
      addBox([0.62, 0.62, 0.62], [0, 1.72, 0], 0x68c06b);
      addBox([0.74, 0.9, 0.42], [0, 1.02, 0], 0x4ca067);
      addBox([0.18, 0.82, 0.18], [-0.52, 1.02, 0], 0x68c06b);
      addBox([0.18, 0.82, 0.18], [0.52, 1.02, 0], 0x68c06b);
      addBox([0.24, 0.96, 0.24], [-0.18, 0.48, 0], 0x345ca4);
      addBox([0.24, 0.96, 0.24], [0.18, 0.48, 0], 0x345ca4);
    } else if (mobId === "skeleton") {
      addBox([0.56, 0.56, 0.56], [0, 1.68, 0], light);
      addBox([0.6, 0.88, 0.3], [0, 1, 0], light);
      addBox([0.12, 0.92, 0.12], [-0.42, 1, 0], cream);
      addBox([0.12, 0.92, 0.12], [0.42, 1, 0], cream);
      addBox([0.14, 1, 0.14], [-0.14, 0.5, 0], cream);
      addBox([0.14, 1, 0.14], [0.14, 0.5, 0], cream);
    } else if (mobId === "creeper") {
      addBox([0.72, 0.96, 0.56], [0, 1.06, 0], def.color);
      addBox([0.64, 0.64, 0.64], [0, 1.9, 0], light);
      for (const x of [-0.22, 0.22]) for (const z of [-0.16, 0.16]) addBox([0.16, 0.42, 0.16], [x, 0.21, z], dark);
      addBox([0.12, 0.14, 0.04], [0.14, 1.92, -0.31], eye);
      addBox([0.12, 0.14, 0.04], [0.14, 1.92, 0.31], eye);
    } else if (mobId === "spider") {
      addBox([0.56, 0.38, 0.56], [0.34, 0.64, 0], deep);
      addBox([0.78, 0.34, 0.74], [-0.18, 0.56, 0], dark);
      for (const z of [-0.34, -0.12, 0.12, 0.34]) {
        addBox([0.58, 0.06, 0.06], [0.1, 0.42, z], light);
        addBox([0.58, 0.06, 0.06], [-0.48, 0.42, z], light);
      }
      addBox([0.08, 0.08, 0.04], [0.58, 0.68, -0.14], 0xff4a4a, 0x220000);
      addBox([0.08, 0.08, 0.04], [0.58, 0.68, 0.14], 0xff4a4a, 0x220000);
    } else {
      addBox([4.4, 1.16, 1.16], [0, 2.8, 0], def.color);
      addBox([1.3, 0.8, 0.9], [2.8, 3, 0], light);
      addBox([2.6, 0.12, 3.8], [-0.6, 2.96, -1.26], deep);
      addBox([2.6, 0.12, 3.8], [-0.6, 2.96, 1.26], deep);
      addBox([2.2, 0.24, 0.4], [-2.8, 2.82, 0], dark);
      addBox([1.4, 0.2, 0.32], [-4.2, 2.78, 0], light);
      addBox([0.28, 1.6, 0.28], [-0.9, 1.2, -0.42], dark);
      addBox([0.28, 1.6, 0.28], [-0.9, 1.2, 0.42], dark);
      addBox([0.28, 1.6, 0.28], [0.9, 1.2, -0.42], dark);
      addBox([0.28, 1.6, 0.28], [0.9, 1.2, 0.42], dark);
      addBox([0.12, 0.12, 0.08], [3.28, 3.12, -0.2], eye, 0x220033);
      addBox([0.12, 0.12, 0.08], [3.28, 3.12, 0.2], eye, 0x220033);
    }

    group.position.copy(position);
    this.scene.add(group);
    this.mobs.push({
      id: crypto.randomUUID(),
      mobId,
      dimension,
      mesh: group,
      health: def.health,
      position: position.clone(),
      velocity: new THREE.Vector3(),
      aggressive: def.behavior === "hostile" || mobId === "ender_dragon",
      attackCooldown: 0,
      wanderTimer: 1,
      heading: new THREE.Vector3(1, 0, 0),
    });
  }

  private spawnDragonIfNeeded(): void {
    if (this.mobs.some((mob) => mob.mobId === "ender_dragon")) return;
    this.createMob("ender_dragon", "end", new THREE.Vector3(14, 62, 0));
  }

  private removeMob(mob: MobEntity): void {
    this.scene.remove(mob.mesh);
    const index = this.mobs.indexOf(mob);
    if (index >= 0) this.mobs.splice(index, 1);
    if (mob.mobId === "ender_dragon") {
      this.ended = true;
      if (this.meta) this.meta.completed = true;
      this.overlayState = { kind: "ending" };
      this.setUiCapture(true);
      this.overlaySelection = null;
      this.renderOverlay();
    }
  }

  private respawnPlayer(): void {
    if (!this.player || !this.meta) return;
    if (this.player.mode === "hardcore") {
      void this.returnToMenu();
      return;
    }
    this.player.health = 20;
    this.player.isFlying = false;
    this.player.position = { ...this.player.respawnPosition };
    this.overlayState = null;
    this.overlaySelection = null;
    this.ui.showOverlay(null);
    this.setUiCapture(false);
  }

  private buildCreativeCatalogSlots(): Array<{ itemId: ItemId; count: number } | null> {
    return (Object.keys(ITEM_DEFS) as ItemId[]).map((itemId) => ({
      itemId,
      count: Math.min(64, ITEM_DEFS[itemId].maxStack),
    }));
  }

  private giveCreativeItem(itemId: ItemId, targetIndex = this.player?.selectedHotbarIndex ?? 0): void {
    if (!this.player) return;
    const selectedIndex = clamp(targetIndex, 0, this.player.inventory.slots.length - 1);
    this.player.inventory.slots[selectedIndex] = {
      itemId,
      count: Math.min(64, ITEM_DEFS[itemId].maxStack),
    };
  }

  private renderOverlay(): void {
    if (!this.player || !this.world || !this.meta || !this.overlayState) {
      this.ui.showOverlay(null);
      return;
    }

    let model: OverlayModel;
    if (this.overlayState.kind === "inventory") {
      if (this.player.mode === "creative") {
        model = {
          title: "Creative Inventory",
          subtitle: "Tap a player slot on the right to choose a target, then tap a creative item on the left.",
          playerSlots: this.player.inventory.slots,
          creativeSlots: this.buildCreativeCatalogSlots(),
          layout: "split",
          selectedHotbarIndex: this.player.selectedHotbarIndex,
          selectedSlotContainer: this.overlaySelection?.container,
          selectedSlotIndex: this.overlaySelection?.index,
          closable: true,
        };
      } else {
        model = {
          title: "Inventory",
          subtitle: "Tap a source slot, then tap a destination slot. Hotbar selection stays outside the inventory screen.",
          playerSlots: this.player.inventory.slots,
          recipes: this.buildCraftRecipeCards("inventory"),
          layout: "split",
          selectedHotbarIndex: this.player.selectedHotbarIndex,
          selectedSlotContainer: this.overlaySelection?.container,
          selectedSlotIndex: this.overlaySelection?.index,
          closable: true,
        };
      }
    } else if (this.overlayState.kind === "crafting") {
      model = {
        title: "Crafting Table",
        subtitle: "Left panel crafting recipes. On the right, tap a source slot, then its destination.",
        playerSlots: this.player.inventory.slots,
        recipes: this.buildCraftRecipeCards("crafting_table"),
        layout: "split",
        selectedHotbarIndex: this.player.selectedHotbarIndex,
        selectedSlotContainer: this.overlaySelection?.container,
        selectedSlotIndex: this.overlaySelection?.index,
        closable: true,
      };
    } else if (this.overlayState.kind === "furnace") {
      model = {
        title: "Furnace",
        subtitle: `Left panel smelting recipes. On the right, tap a source slot then a destination slot. Coal ready: ${countInventoryItem(this.player.inventory, "coal")}`,
        playerSlots: this.player.inventory.slots,
        recipes: this.buildFurnaceRecipeCards(),
        layout: "split",
        selectedHotbarIndex: this.player.selectedHotbarIndex,
        selectedSlotContainer: this.overlaySelection?.container,
        selectedSlotIndex: this.overlaySelection?.index,
        closable: true,
      };
    } else if (this.overlayState.kind === "chest") {
      const entity = this.world.blockEntities.get(this.overlayState.key);
      model = {
        title: "Chest",
        subtitle: "Tap a source slot, then tap its destination. Player inventory stays on top, chest storage below.",
        playerSlots: this.player.inventory.slots,
        chestSlots: entity?.inventory?.slots ?? [],
        selectedHotbarIndex: this.player.selectedHotbarIndex,
        selectedSlotContainer: this.overlaySelection?.container,
        selectedSlotIndex: this.overlaySelection?.index,
        closable: true,
      };
    } else if (this.overlayState.kind === "map") {
      model = this.buildMapOverlay();
    } else if (this.overlayState.kind === "gameover") {
      model = {
        title: "You Died",
        subtitle: this.overlayState.hardcore ? "Hardcore world locked." : "You can respawn.",
        actions: this.overlayState.hardcore
          ? [{ id: "menu", label: "Menu" }]
          : [{ id: "respawn", label: "Respawn" }, { id: "menu", label: "Menu" }],
      };
    } else {
      model = {
        title: "End Clear",
        subtitle: "The dragon is gone. You can keep exploring this world.",
        actions: [{ id: "close", label: "Keep Playing" }, { id: "menu", label: "Menu" }],
      };
    }
    this.ui.showOverlay(model);
  }
  private buildCraftRecipeCards(station: "inventory" | "crafting_table"): OverlayRecipeCard[] {
    return getCraftingOptions(this.player!.inventory, station).map((option) => ({
      actionId: `craft:${option.recipe.id}`,
      title: ITEM_DEFS[option.recipe.result.itemId].name,
      resultItemId: option.recipe.result.itemId,
      resultCount: option.recipe.result.count,
      ingredients: option.recipe.ingredients,
      grid: this.buildCraftPreviewGrid(option.recipe),
      disabled: !option.canCraft,
    }));
  }

  private buildFurnaceRecipeCards(): OverlayRecipeCard[] {
    return getFurnaceOptions(this.player!.inventory).map((option) => ({
      actionId: `smelt:${option.recipe.id}`,
      title: ITEM_DEFS[option.recipe.output.itemId].name,
      resultItemId: option.recipe.output.itemId,
      resultCount: option.recipe.output.count,
      ingredients: [
        { itemId: option.recipe.input, count: 1 },
        { itemId: "coal", count: option.recipe.fuelCost },
      ],
      grid: this.createPreviewGrid([
        [1, option.recipe.input],
        [7, "coal"],
      ]),
      disabled: !option.canCraft,
    }));
  }

  private createPreviewGrid(entries: Array<[number, ItemId]>): Array<ItemId | null> {
    const grid = Array.from({ length: 9 }, () => null as ItemId | null);
    for (const [index, itemId] of entries) {
      grid[index] = itemId;
    }
    return grid;
  }

  private fillGridFromIngredients(
    ingredients: Array<{ itemId: ItemId; count: number }>,
  ): Array<ItemId | null> {
    const grid = Array.from({ length: 9 }, () => null as ItemId | null);
    let cursor = 0;
    for (const ingredient of ingredients) {
      for (let count = 0; count < ingredient.count && cursor < grid.length; count += 1) {
        grid[cursor] = ingredient.itemId;
        cursor += 1;
      }
    }
    return grid;
  }

  private buildCraftPreviewGrid(recipe: {
    id: string;
    ingredients: Array<{ itemId: ItemId; count: number }>;
    result: { itemId: ItemId; count: number };
  }): Array<ItemId | null> {
    const primary = recipe.ingredients[0]?.itemId;
    const secondary = recipe.ingredients[1]?.itemId;
    if (recipe.result.itemId.endsWith("_pickaxe") && primary && secondary) {
      return this.createPreviewGrid([
        [0, primary], [1, primary], [2, primary],
        [4, secondary], [7, secondary],
      ]);
    }
    if (recipe.result.itemId.endsWith("_shovel") && primary && secondary) {
      return this.createPreviewGrid([[1, primary], [4, secondary], [7, secondary]]);
    }
    if (recipe.result.itemId.endsWith("_axe") && primary && secondary) {
      return this.createPreviewGrid([
        [0, primary], [1, primary], [3, primary],
        [4, secondary], [7, secondary],
      ]);
    }
    if (recipe.result.itemId.endsWith("_sword") && primary && secondary) {
      return this.createPreviewGrid([[1, primary], [4, primary], [7, secondary]]);
    }

    switch (recipe.id) {
      case "planks_from_log":
        return this.createPreviewGrid([[4, "oak_log"]]);
      case "sticks_from_planks":
        return this.createPreviewGrid([[1, "oak_planks"], [4, "oak_planks"]]);
      case "crafting_table":
      case "stone_bricks":
        return this.createPreviewGrid([
          [0, recipe.ingredients[0]!.itemId], [1, recipe.ingredients[0]!.itemId],
          [3, recipe.ingredients[0]!.itemId], [4, recipe.ingredients[0]!.itemId],
        ]);
      case "chest":
      case "furnace":
        return this.createPreviewGrid([
          [0, recipe.ingredients[0]!.itemId], [1, recipe.ingredients[0]!.itemId], [2, recipe.ingredients[0]!.itemId],
          [3, recipe.ingredients[0]!.itemId], [5, recipe.ingredients[0]!.itemId],
          [6, recipe.ingredients[0]!.itemId], [7, recipe.ingredients[0]!.itemId], [8, recipe.ingredients[0]!.itemId],
        ]);
      case "flint_and_steel":
        return this.createPreviewGrid([[1, "iron_ingot"], [3, "moonstone_shard"]]);
      case "eye_of_ender":
        return this.createPreviewGrid([[3, "moonstone_shard"], [4, "diamond"]]);
      case "torch":
        return this.createPreviewGrid([[1, "coal"], [4, "stick"]]);
      case "netherite_ingot":
        return this.createPreviewGrid([
          [0, "netherite_scrap"], [2, "netherite_scrap"], [6, "netherite_scrap"], [8, "netherite_scrap"],
          [1, "gold_ingot"], [3, "gold_ingot"], [5, "gold_ingot"], [7, "gold_ingot"],
        ]);
      default:
        return this.fillGridFromIngredients(recipe.ingredients);
    }
  }

  private buildMapOverlay(): OverlayModel {
    const player = this.player!;
    const world = this.world!;
    const radius = player.dimension === "overworld" ? 168 : 120;
    const landmarks = world
      .getLandmarksNear(player.dimension, player.position, radius * 1.25)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 12);

    return {
      title: "World Map",
      subtitle: `${getDimensionLabel(player.dimension)} terrain around your position`,
      imageSrc: this.renderMapImage(radius, landmarks),
      imageAlt: `${getDimensionLabel(player.dimension)} map`,
      legend: [
        {
          label: this.player!.dimension === "overworld" ? (this.isNightTime() ? "Night" : "Day") : "Timeless",
          detail: `Map scale ${radius * 2} blocks across`,
          tone: this.player!.dimension === "overworld" ? (this.isNightTime() ? "#294c92" : "#f0b66a") : "#8d7fd2",
        },
        ...landmarks.map((landmark) => ({
          label: landmark.label,
          detail: `${Math.round(landmark.distance)}m away`,
          tone: this.getLandmarkTone(landmark.label),
        } satisfies OverlayLegendItem)),
      ],
      closable: true,
    };
  }
  private renderMapImage(
    radius: number,
    landmarks: Array<{ label: string; x: number; y: number; z: number; distance: number }>,
  ): string {
    const world = this.world!;
    const player = this.player!;
    const size = 208;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return "";
    }
    ctx.imageSmoothingEnabled = false;

    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        const worldX = Math.floor(player.position.x + ((px + 0.5) / size - 0.5) * radius * 2);
        const worldZ = Math.floor(player.position.z + ((py + 0.5) / size - 0.5) * radius * 2);
        const surfaceY = world.findSurfaceY(player.dimension, worldX, worldZ);
        const blockId = world.getBlockId(player.dimension, worldX, surfaceY, worldZ);
        const biomeId = world.getBiomeId(player.dimension, worldX, worldZ);
        ctx.fillStyle = this.getMapColor(blockId, biomeId, surfaceY);
        ctx.fillRect(px, py, 1, 1);
      }
    }

    ctx.strokeStyle = "rgba(40, 31, 19, 0.72)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, size - 3, size - 3);

    for (const landmark of landmarks) {
      const mapX = Math.round(((landmark.x - player.position.x) / (radius * 2) + 0.5) * size);
      const mapY = Math.round(((landmark.z - player.position.z) / (radius * 2) + 0.5) * size);
      if (mapX < 0 || mapX >= size || mapY < 0 || mapY >= size) continue;
      ctx.fillStyle = this.getLandmarkTone(landmark.label);
      ctx.fillRect(mapX - 2, mapY - 2, 5, 5);
      ctx.fillStyle = "#1c1309";
      ctx.font = "bold 9px Trebuchet MS";
      ctx.fillText(landmark.label.slice(0, 1), mapX + 4, mapY + 3);
    }

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(player.yaw);
    ctx.fillStyle = "#fff8e7";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    return canvas.toDataURL("image/png");
  }

  private getMapColor(blockId: BlockId, biomeId: keyof typeof BIOME_DEFS, surfaceY: number): string {
    const biomeColor = biomeId in BIOME_DEFS ? BIOME_DEFS[biomeId].color : BLOCK_DEFS[blockId].color;
    const baseHex = blockId === "grass" || blockId === "oak_leaves"
      ? biomeColor
      : BLOCK_DEFS[blockId].topColor ?? BLOCK_DEFS[blockId].color;
    const shade = clamp(0.76 + (surfaceY - WORLD_GEN_CONFIG.seaLevel) / 88, 0.56, 1.14);
    const color = new THREE.Color(baseHex).multiplyScalar(shade);
    return `#${color.getHexString()}`;
  }

  private getLandmarkTone(label: string): string {
    if (label.includes("Village")) return "#4cae62";
    if (label.includes("School")) return "#4e8ec9";
    if (label.includes("Dungeon")) return "#9b4f36";
    if (label.includes("Stronghold")) return "#725d48";
    if (label.includes("Portal")) return "#8c63d8";
    return "#c98c48";
  }

  private updateHud(): void {
    if (!this.player || !this.world) return;
    const coords = `${Math.floor(this.player.position.x)}, ${Math.floor(this.player.position.y)}, ${Math.floor(this.player.position.z)}`;
    const biome = this.world.getBiomeId(this.player.dimension, Math.floor(this.player.position.x), Math.floor(this.player.position.z));
    const heldItemId = getHeldItemId(this.player);
    const dayPeriod = this.player.dimension === "overworld" ? (this.isNightTime() ? "Night" : "Day") : "Timeless";
    this.ui.updateHud({
      health: this.player.health,
      mode: this.player.mode,
      dimension: getDimensionLabel(this.player.dimension),
      biome: getBiomeLabel(biome),
      coords,
      dayPeriod,
      selectedLabel: heldItemId ? ITEM_DEFS[heldItemId].name : "Empty Hand",
      selectedItemId: heldItemId,
      breakProgress: this.breakProgress,
      flightAvailable: this.player.mode === "creative" && this.player.flightEnabled,
      isFlying: this.player.isFlying,
      hotbar: Array.from({ length: HOTBAR_SIZE }, (_, index) => {
        const slot = this.player!.inventory.slots[index];
        return {
          itemId: slot?.itemId ?? null,
          count: slot?.count ?? 0,
          selected: this.player!.selectedHotbarIndex === index,
        };
      }),
    });
  }
  private spawnDroppedItem(itemId: ItemId, count: number, dimension: DimensionId, position: THREE.Vector3): void {
    const mesh = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createItemIconTexture(itemId),
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
      }),
    );
    mesh.scale.set(0.84, 0.84, 0.84);
    mesh.renderOrder = 12;
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.droppedItems.push({
      id: crypto.randomUUID(),
      itemId,
      count,
      dimension,
      mesh,
      position: position.clone(),
      baseY: position.y,
      age: 0,
      pickupDelay: 0.42,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private updateDroppedItems(dt: number): void {
    if (!this.player) return;
    for (let index = this.droppedItems.length - 1; index >= 0; index -= 1) {
      const entity = this.droppedItems[index];
      entity.age += dt;
      entity.pickupDelay = Math.max(0, entity.pickupDelay - dt);
      const sameDimension = entity.dimension === this.player.dimension;
      entity.mesh.visible = sameDimension;
      entity.mesh.position.set(
        entity.position.x,
        entity.baseY + 0.06 + Math.sin(entity.age * 4.6 + entity.phase) * 0.06,
        entity.position.z,
      );
      if (entity.age > 45) {
        this.removeDroppedItemAt(index);
        continue;
      }
      if (!sameDimension || entity.pickupDelay > 0) continue;
      const pickupDistance = Math.hypot(
        entity.position.x - this.player.position.x,
        entity.baseY - this.player.position.y,
        entity.position.z - this.player.position.z,
      );
      if (pickupDistance > 1.45) continue;
      const remaining = addItemToInventory(this.player.inventory, entity.itemId, entity.count);
      if (remaining >= entity.count) continue;
      if (remaining > 0) {
        entity.count = remaining;
        continue;
      }
      this.removeDroppedItemAt(index);
    }
  }

  private removeDroppedItemAt(index: number): void {
    const entity = this.droppedItems[index];
    if (!entity) return;
    this.scene.remove(entity.mesh);
    entity.mesh.material.dispose();
    this.droppedItems.splice(index, 1);
  }

  private clearDroppedItems(): void {
    for (let index = this.droppedItems.length - 1; index >= 0; index -= 1) {
      this.removeDroppedItemAt(index);
    }
  }

  private clearMobs(): void {
    for (const mob of this.mobs) this.scene.remove(mob.mesh);
    this.mobs.length = 0;
  }

  private disposeChunkMeshes(): void {
    for (const mesh of this.chunkMeshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunkMeshes.clear();
  }
}




































