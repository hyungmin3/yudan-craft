import type {
  GameMode,
  InventorySlot,
  ItemId,
  WorldMeta,
} from "../game/contracts";
import { itemLabel } from "../data/catalog";
import { getItemIconDataUrl } from "../render/voxelArt";

const PLAYER_HOTBAR_SIZE = 9;

export interface HotbarView {
  itemId: ItemId | null;
  count: number;
  selected: boolean;
}

export interface HudState {
  health: number;
  mode: GameMode;
  dimension: string;
  biome: string;
  coords: string;
  dayPeriod: string;
  selectedLabel: string;
  selectedItemId: ItemId | null;
  breakProgress: number;
  hotbar: HotbarView[];
  flightAvailable: boolean;
  isFlying: boolean;
}

export interface OverlayAction {
  id: string;
  label: string;
  disabled?: boolean;
  description?: string;
}

export interface OverlayLegendItem {
  label: string;
  detail?: string;
  tone?: string;
}

export interface OverlayRecipeCard {
  actionId: string;
  title: string;
  resultItemId: ItemId;
  resultCount: number;
  ingredients: Array<{ itemId: ItemId; count: number }>;
  grid: Array<ItemId | null>;
  disabled?: boolean;
}

export interface OverlayModel {
  title: string;
  subtitle?: string;
  actions?: OverlayAction[];
  playerSlots?: Array<InventorySlot | null>;
  chestSlots?: Array<InventorySlot | null>;
  creativeSlots?: Array<InventorySlot | null>;
  footer?: string;
  lines?: string[];
  imageSrc?: string;
  imageAlt?: string;
  legend?: OverlayLegendItem[];
  recipes?: OverlayRecipeCard[];
  layout?: "default" | "split";
  selectedHotbarIndex?: number;
  selectedSlotContainer?: "player" | "chest" | "creative";
  selectedSlotIndex?: number;
  closable?: boolean;
}

type CreateWorldHandler = (payload: {
  name: string;
  seed: string;
  mode: GameMode;
}) => void;

export class HudController {
  readonly root: HTMLElement;
  readonly appShellEl: HTMLElement;
  readonly canvasMount: HTMLElement;
  readonly messageEl: HTMLElement;
  readonly hudEl: HTMLElement;
  readonly overlayEl: HTMLElement;
  readonly menuEl: HTMLElement;
  readonly worldListEl: HTMLElement;
  readonly hotbarEl: HTMLElement;
  readonly statsEl: HTMLElement;
  readonly selectedItemEl: HTMLElement;
  readonly breakBarEl: HTMLElement;
  readonly menuButtonEl: HTMLButtonElement;
  readonly mobileHudEl: HTMLElement;
  readonly jumpButtonEl: HTMLButtonElement;
  readonly descendButtonEl: HTMLButtonElement;
  readonly loadingEl: HTMLElement;
  readonly loadingLabelEl: HTMLElement;

  private onCreateWorld: CreateWorldHandler | null = null;
  private onLoadWorld: ((worldId: string) => void) | null = null;
  private onDeleteWorld: ((worldId: string) => void) | null = null;
  private onOverlayAction: ((actionId: string) => void) | null = null;
  private onOverlaySlotClick:
    | ((container: "player" | "chest" | "creative", index: number) => void)
    | null = null;
  private onHotbarSelect: ((index: number) => void) | null = null;
  private onMenu: (() => void | Promise<void>) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = this.template();
    this.appShellEl = this.require(".app-shell");
    this.canvasMount = this.require("#canvas-mount");
    this.messageEl = this.require("#message-banner");
    this.hudEl = this.require("#hud");
    this.overlayEl = this.require("#overlay");
    this.menuEl = this.require("#menu");
    this.worldListEl = this.require("#world-list");
    this.hotbarEl = this.require("#hotbar");
    this.statsEl = this.require("#hud-stats");
    this.selectedItemEl = this.require("#selected-item-pill");
    this.breakBarEl = this.require("#break-bar-fill");
    this.menuButtonEl = this.require<HTMLButtonElement>("#hud-menu-button");
    this.mobileHudEl = this.require("#mobile-hud");
    this.jumpButtonEl = this.require<HTMLButtonElement>("#mobile-jump");
    this.descendButtonEl = this.require<HTMLButtonElement>("#mobile-descend");
    this.loadingEl = this.require("#loading-screen");
    this.loadingLabelEl = this.require("#loading-label");
    this.bindMenuForm();
    this.menuButtonEl.onclick = () => {
      void this.onMenu?.();
    };
    this.showHud(false);
    this.showOverlay(null);
    this.showMobileHud(false);
    this.showLoading(null);
    this.showMenu(true);
  }

  bindMenuHandlers(handlers: {
    onCreateWorld: CreateWorldHandler;
    onLoadWorld: (worldId: string) => void;
    onDeleteWorld: (worldId: string) => void;
  }): void {
    this.onCreateWorld = handlers.onCreateWorld;
    this.onLoadWorld = handlers.onLoadWorld;
    this.onDeleteWorld = handlers.onDeleteWorld;
  }

  bindHudHandlers(handlers: {
    onOverlayAction: (actionId: string) => void;
    onOverlaySlotClick: (container: "player" | "chest" | "creative", index: number) => void;
    onHotbarSelect: (index: number) => void;
    onMenu: () => void | Promise<void>;
  }): void {
    this.onOverlayAction = handlers.onOverlayAction;
    this.onOverlaySlotClick = handlers.onOverlaySlotClick;
    this.onHotbarSelect = handlers.onHotbarSelect;
    this.onMenu = handlers.onMenu;
  }

  renderWorldList(worlds: WorldMeta[]): void {
    if (worlds.length === 0) {
      this.worldListEl.innerHTML =
        '<div class="world-empty">No saved worlds yet. Create one to begin.</div>';
      return;
    }

    this.worldListEl.innerHTML = worlds
      .map((world) => {
        const locked = world.locked ? "world-card--locked" : "";
        return `
          <article class="world-card ${locked}">
            <div>
              <h3>${world.name}</h3>
              <p>Mode: ${world.mode} | Seed: ${world.seed}</p>
              <p>Last played: ${new Date(world.lastPlayedAt).toLocaleString("ko-KR")}</p>
            </div>
            <div class="world-card__actions">
              <button data-load-world="${world.id}" ${
                world.locked ? "disabled" : ""
              }>Open</button>
              <button class="ghost" data-delete-world="${world.id}">Delete</button>
            </div>
          </article>
        `;
      })
      .join("");

    for (const button of this.worldListEl.querySelectorAll<HTMLButtonElement>(
      "[data-load-world]",
    )) {
      button.onclick = () => {
        const worldId = button.dataset.loadWorld;
        if (worldId && this.onLoadWorld) {
          this.onLoadWorld(worldId);
        }
      };
    }

    for (const button of this.worldListEl.querySelectorAll<HTMLButtonElement>(
      "[data-delete-world]",
    )) {
      button.onclick = () => {
        const worldId = button.dataset.deleteWorld;
        if (worldId && this.onDeleteWorld) {
          this.onDeleteWorld(worldId);
        }
      };
    }
  }

  showMenu(visible: boolean): void {
    this.menuEl.hidden = !visible;
    this.menuEl.style.display = visible ? "grid" : "none";
    this.canvasMount.style.pointerEvents = visible ? "none" : "auto";
  }

  showHud(visible: boolean): void {
    this.hudEl.hidden = !visible;
    this.hudEl.style.display = visible ? "block" : "none";
  }

  showMobileHud(visible: boolean): void {
    this.mobileHudEl.hidden = !visible;
    this.mobileHudEl.style.display = visible ? "grid" : "none";
  }

  showLoading(message: string | null): void {
    const visible = Boolean(message);
    this.loadingEl.hidden = !visible;
    this.loadingEl.style.display = visible ? "grid" : "none";
    this.loadingLabelEl.textContent = message ?? "";
  }

  setMessage(text: string): void {
    this.messageEl.textContent = text;
    this.messageEl.classList.toggle("message-banner--visible", Boolean(text));
  }

  updateHud(state: HudState): void {
    this.statsEl.innerHTML = `
      <span>${state.mode.toUpperCase()}</span>
      <span>${state.dimension}</span>
      <span>${state.biome}</span>
      <span>${state.dayPeriod}</span>
      <span>${state.coords}</span>
      <span>HP ${Math.max(0, Math.round(state.health))}</span>
    `;

    this.selectedItemEl.innerHTML = `
      ${this.iconMarkup(state.selectedItemId, state.selectedLabel, "item-icon--selected")}
      <span>${state.selectedLabel}</span>
    `;

    this.breakBarEl.style.width = `${Math.round(state.breakProgress * 100)}%`;

    this.jumpButtonEl.textContent = state.flightAvailable && state.isFlying ? "Fly Up" : "Jump";
    this.descendButtonEl.textContent = state.flightAvailable && state.isFlying ? "Fly Down" : "Sneak";
    this.jumpButtonEl.classList.toggle("is-flight-active", state.flightAvailable && state.isFlying);
    this.descendButtonEl.classList.toggle("is-flight-active", state.flightAvailable && state.isFlying);

    this.hotbarEl.innerHTML = state.hotbar
      .map((slot, index) => {
        const label = slot.itemId ? itemLabel(slot.itemId) : "Empty";
        return `
          <button
            class="hotbar-slot ${slot.selected ? "is-selected" : ""}"
            data-hotbar-index="${index}"
            title="${label}"
          >
            <span class="hotbar-slot__index">${index + 1}</span>
            <span class="hotbar-slot__iconwrap">
              ${this.iconMarkup(slot.itemId, label, "item-icon--hotbar")}
              <span class="hotbar-slot__count">${slot.count > 1 ? slot.count : ""}</span>
            </span>
          </button>
        `;
      })
      .join("");

    for (const button of this.hotbarEl.querySelectorAll<HTMLButtonElement>(
      "[data-hotbar-index]",
    )) {
      this.bindPress(button, () => {
        const raw = button.dataset.hotbarIndex;
        if (raw && this.onHotbarSelect) {
          this.onHotbarSelect(Number(raw));
        }
      });
    }
  }

  showOverlay(model: OverlayModel | null): void {
    if (!model) {
      this.appShellEl.classList.remove("has-overlay");
      this.overlayEl.hidden = true;
      this.overlayEl.style.display = "none";
      this.overlayEl.innerHTML = "";
      this.overlayEl.onclick = null;
      this.overlayEl.ontouchstart = null;
      this.overlayEl.ontouchmove = null;
      this.overlayEl.ontouchcancel = null;
      this.overlayEl.ontouchend = null;
      return;
    }

    const actionsMarkup = (model.actions ?? [])
      .map(
        (action) => `
          <button
            type="button"
            class="overlay-action"
            data-overlay-action="${action.id}"
            ${action.disabled ? "disabled" : ""}
            title="${action.description ?? ""}"
          >
            ${action.label}
          </button>
        `,
      )
      .join("");

    const playerMarkup = model.playerSlots
      ? this.slotGridMarkup(
          model.playerSlots,
          "player",
          "Player Inventory",
          model.selectedHotbarIndex,
          model.selectedSlotContainer,
          model.selectedSlotIndex,
        )
      : "";
    const chestMarkup = model.chestSlots
      ? this.slotGridMarkup(
          model.chestSlots,
          "chest",
          "Chest",
          model.selectedHotbarIndex,
          model.selectedSlotContainer,
          model.selectedSlotIndex,
        )
      : "";
    const creativeMarkup = model.creativeSlots
      ? this.slotGridMarkup(
          model.creativeSlots,
          "creative",
          "Creative Items",
          model.selectedHotbarIndex,
          model.selectedSlotContainer,
          model.selectedSlotIndex,
        )
      : "";
    const closeMarkup = model.closable
      ? '<button type="button" class="overlay-close" data-overlay-action="close">Close</button>'
      : "";
    const linesMarkup = model.lines?.length
      ? `<ul class="overlay-list">${model.lines.map((line) => `<li>${line}</li>`).join("")}</ul>`
      : "";
    const mediaMarkup = model.imageSrc
      ? `
        <figure class="overlay-media">
          <img src="${model.imageSrc}" alt="${model.imageAlt ?? model.title}" draggable="false" />
        </figure>
      `
      : "";
    const legendMarkup = model.legend?.length
      ? `
        <div class="overlay-legend">
          ${model.legend
            .map(
              (entry) => `
                <div class="overlay-legend__item">
                  <span class="overlay-legend__tone" style="background:${entry.tone ?? "#8f7344"}"></span>
                  <div>
                    <strong>${entry.label}</strong>
                    ${entry.detail ? `<p>${entry.detail}</p>` : ""}
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      `
      : "";
    const recipeMarkup = model.recipes?.length
      ? `<div class="recipe-cards">${model.recipes.map((recipe) => this.recipeCardMarkup(recipe)).join("")}</div>`
      : "";
    const actionsBlock = actionsMarkup
      ? `<div class="overlay-actions">${actionsMarkup}</div>`
      : "";

    const useSplit = model.layout === "split";
    const bodyMarkup = useSplit
      ? `
        <div class="overlay-card__body overlay-card__body--split">
          <div class="overlay-pane overlay-pane--primary">
            ${mediaMarkup}
            ${legendMarkup}
            ${creativeMarkup}
            ${recipeMarkup}
          </div>
          <div class="overlay-pane overlay-pane--secondary">
            ${playerMarkup}
            ${chestMarkup}
            ${linesMarkup}
            ${actionsBlock}
          </div>
        </div>
      `
      : `
        <div class="overlay-card__body">
          ${mediaMarkup}
          ${legendMarkup}
          ${creativeMarkup}
          ${recipeMarkup}
          ${playerMarkup}
          ${chestMarkup}
          ${linesMarkup}
          ${actionsBlock}
        </div>
      `;

    this.appShellEl.classList.add("has-overlay");
    this.overlayEl.hidden = false;
    this.overlayEl.style.display = "grid";
    this.overlayEl.innerHTML = `
      <section class="overlay-card">
        <header class="overlay-card__header">
          <div>
            <h2>${model.title}</h2>
            ${model.subtitle ? `<p>${model.subtitle}</p>` : ""}
          </div>
          ${closeMarkup}
        </header>
        ${bodyMarkup}
        ${model.footer ? `<footer>${model.footer}</footer>` : ""}
      </section>
    `;

    this.bindOverlayInteractions();
  }

  private recipeCardMarkup(recipe: OverlayRecipeCard): string {
    const resultLabel = itemLabel(recipe.resultItemId);
    return `
      <article class="recipe-card ${recipe.disabled ? "is-disabled" : ""}">
        <div class="recipe-card__preview">
          <div class="recipe-grid">${this.recipeGridMarkup(recipe.grid)}</div>
          <div class="recipe-card__arrow">&rarr;</div>
          <div class="recipe-card__result">
            ${this.iconMarkup(recipe.resultItemId, resultLabel, "item-icon--recipe-result")}
            <strong>${resultLabel}</strong>
            <span>x${recipe.resultCount}</span>
          </div>
        </div>
        <div class="recipe-card__ingredients">
          ${recipe.ingredients
            .map((ingredient) => this.ingredientTokenMarkup(ingredient.itemId, ingredient.count))
            .join("")}
        </div>
        <button type="button" class="overlay-action recipe-card__button" data-overlay-action="${recipe.actionId}" ${
          recipe.disabled ? "disabled" : ""
        }>
          Craft ${resultLabel}
        </button>
      </article>
    `;
  }

  private recipeGridMarkup(grid: Array<ItemId | null>): string {
    return grid
      .map((itemId) => {
        const label = itemId ? itemLabel(itemId) : "Empty";
        return `
          <span class="recipe-grid__cell ${itemId ? "is-filled" : ""}">
            ${this.iconMarkup(itemId, label, "item-icon--recipe")}
          </span>
        `;
      })
      .join("");
  }

  private bindOverlayInteractions(): void {
    let touchIdentifier: number | null = null;
    let touchTarget: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let swallowNextClick = false;

    const resolveActionElement = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) {
        return null;
      }
      return target.closest<HTMLElement>("[data-overlay-action], [data-slot-container]");
    };

    const activateActionElement = (element: HTMLElement): void => {
      const actionId = element.dataset.overlayAction;
      if (actionId && this.onOverlayAction) {
        this.onOverlayAction(actionId);
        return;
      }
      const container = element.dataset.slotContainer;
      const rawIndex = element.dataset.slotIndex;
      if (
        this.onOverlaySlotClick &&
        rawIndex &&
        (container === "player" || container === "chest" || container === "creative")
      ) {
        this.onOverlaySlotClick(container, Number(rawIndex));
      }
    };

    const resetTouch = (): void => {
      touchIdentifier = null;
      touchTarget = null;
      moved = false;
    };

    this.overlayEl.ontouchstart = (event) => {
      const element = resolveActionElement(event.target);
      const touch = event.changedTouches[0];
      if (!element || !touch) {
        return;
      }
      touchIdentifier = touch.identifier;
      touchTarget = element;
      startX = touch.clientX;
      startY = touch.clientY;
      moved = false;
    };
    this.overlayEl.ontouchmove = (event) => {
      const touch = Array.from(event.changedTouches).find((entry) => entry.identifier === touchIdentifier);
      if (!touch) {
        return;
      }
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 12) {
        moved = true;
      }
    };
    this.overlayEl.ontouchcancel = () => {
      resetTouch();
    };
    this.overlayEl.ontouchend = (event) => {
      const touch = Array.from(event.changedTouches).find((entry) => entry.identifier === touchIdentifier);
      const element = resolveActionElement(event.target);
      if (!touch || !element || element !== touchTarget) {
        resetTouch();
        return;
      }
      const shouldActivate = !moved;
      resetTouch();
      if (!shouldActivate) {
        return;
      }
      swallowNextClick = true;
      activateActionElement(element);
    };
    this.overlayEl.onclick = (event) => {
      const element = resolveActionElement(event.target);
      if (!element) {
        return;
      }
      if (swallowNextClick) {
        swallowNextClick = false;
        return;
      }
      activateActionElement(element);
    };
  }

  private bindPress(button: HTMLButtonElement, onActivate: () => void): void {
    let touchIdentifier: number | null = null;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let swallowNextClick = false;

    const resetTouch = () => {
      touchIdentifier = null;
      moved = false;
    };

    button.type = "button";
    button.ontouchstart = (event) => {
      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }
      touchIdentifier = touch.identifier;
      startX = touch.clientX;
      startY = touch.clientY;
      moved = false;
      event.stopPropagation();
    };
    button.ontouchmove = (event) => {
      const touch = Array.from(event.changedTouches).find((entry) => entry.identifier === touchIdentifier);
      if (!touch) {
        return;
      }
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 12) {
        moved = true;
      }
    };
    button.ontouchcancel = () => {
      resetTouch();
    };
    button.ontouchend = (event) => {
      const touch = Array.from(event.changedTouches).find((entry) => entry.identifier === touchIdentifier);
      if (!touch) {
        return;
      }
      event.stopPropagation();
      const shouldActivate = !moved;
      resetTouch();
      if (!shouldActivate) {
        return;
      }
      swallowNextClick = true;
      onActivate();
    };
    button.onclick = (event) => {
      event.stopPropagation();
      if (swallowNextClick) {
        swallowNextClick = false;
        return;
      }
      onActivate();
    };
  }

  private ingredientTokenMarkup(itemId: ItemId, count: number): string {
    const label = itemLabel(itemId);
    return `
      <span class="ingredient-token">
        ${this.iconMarkup(itemId, label, "item-icon--ingredient")}
        <span>${label} x${count}</span>
      </span>
    `;
  }

  private slotButtonMarkup(
    slot: InventorySlot | null,
    container: "player" | "chest" | "creative",
    index: number,
    compact = false,
    selectedHotbarIndex?: number,
    selectedSlotContainer?: "player" | "chest" | "creative",
    selectedSlotIndex?: number,
  ): string {
    const label = slot ? itemLabel(slot.itemId) : "Empty Slot";
    const activeHotbarClass =
      container === "player" && index === selectedHotbarIndex
        ? " inventory-slot--selected-hotbar"
        : "";
    const transferSelectedClass =
      container === selectedSlotContainer && index === selectedSlotIndex
        ? " inventory-slot--transfer-selected"
        : "";
    const compactClass = compact ? " inventory-slot--compact" : "";
    return `
      <button
        type="button"
        class="inventory-slot ${slot ? "inventory-slot--filled" : ""}${activeHotbarClass}${transferSelectedClass}${compactClass}"
        data-slot-container="${container}"
        data-slot-index="${index}"
        title="${label}"
      >
        <span class="inventory-slot__content">
          ${this.iconMarkup(slot?.itemId ?? null, label, compact ? "item-icon--slot item-icon--slot-compact" : "item-icon--slot")}
          ${compact ? "" : `<span class="inventory-slot__name">${slot ? label : "Empty Slot"}</span>`}
        </span>
        <span>${slot && slot.count > 1 ? slot.count : ""}</span>
      </button>
    `;
  }

  private slotGridMarkup(
    slots: Array<InventorySlot | null>,
    container: "player" | "chest" | "creative",
    title: string,
    selectedHotbarIndex?: number,
    selectedSlotContainer?: "player" | "chest" | "creative",
    selectedSlotIndex?: number,
  ): string {
    if (container === "player") {
      const hotbarCards = slots
        .slice(0, PLAYER_HOTBAR_SIZE)
        .map((slot, index) =>
          this.slotButtonMarkup(
            slot,
            container,
            index,
            true,
            selectedHotbarIndex,
            selectedSlotContainer,
            selectedSlotIndex,
          ),
        )
        .join("");
      const backpackCards = slots
        .slice(PLAYER_HOTBAR_SIZE)
        .map((slot, index) =>
          this.slotButtonMarkup(
            slot,
            container,
            PLAYER_HOTBAR_SIZE + index,
            false,
            selectedHotbarIndex,
            selectedSlotContainer,
            selectedSlotIndex,
          ),
        )
        .join("");

      return `
        <section class="slot-panel slot-panel--player">
          <h3>${title}</h3>
          <div class="slot-panel__section">
            <h4>Hotbar</h4>
            <div class="slot-grid slot-grid--hotbar">${hotbarCards}</div>
          </div>
          <div class="slot-panel__section">
            <h4>Backpack</h4>
            <div class="slot-grid slot-grid--player">${backpackCards}</div>
          </div>
        </section>
      `;
    }

    const cards = slots
      .map((slot, index) =>
        this.slotButtonMarkup(
          slot,
          container,
          index,
          false,
          selectedHotbarIndex,
          selectedSlotContainer,
          selectedSlotIndex,
        ),
      )
      .join("");
    const gridClass = container === "creative" ? "slot-grid slot-grid--creative" : "slot-grid";
    const panelClass = container === "creative" ? "slot-panel slot-panel--creative" : "slot-panel";

    return `
      <section class="${panelClass}">
        <h3>${title}</h3>
        <div class="${gridClass}">${cards}</div>
      </section>
    `;
  }

  private iconMarkup(itemId: ItemId | null, label: string, extraClass = ""): string {
    if (!itemId) {
      return `<span class="item-icon item-icon--empty ${extraClass}" aria-hidden="true"></span>`;
    }
    return `<img class="item-icon ${extraClass}" src="${getItemIconDataUrl(itemId)}" alt="${label}" draggable="false" />`;
  }

  private bindMenuForm(): void {
    const form = this.require<HTMLFormElement>("#create-world-form");
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!this.onCreateWorld) {
        return;
      }

      const data = new FormData(form);
      const name = String(data.get("world-name") ?? "").trim();
      const seed = String(data.get("world-seed") ?? "").trim();
      const mode = String(data.get("world-mode") ?? "survival") as GameMode;

      this.onCreateWorld({
        name: name || "New World",
        seed: seed || crypto.randomUUID().slice(0, 8),
        mode,
      });
    };
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing UI element: ${selector}`);
    }
    return element;
  }

  private template(): string {
    return `
      <div class="app-shell">
        <div id="canvas-mount" class="canvas-mount"></div>
        <div id="message-banner" class="message-banner"></div>

        <section id="menu" class="menu-screen">
          <div class="menu-screen__panel">
            <div class="menu-screen__hero">
              <span class="eyebrow">VOXEL SANDBOX</span>
              <h1>YUDAN CRAFT</h1>
              <p>Lightweight browser voxel sandbox with survival, crafting, and dimension travel.</p>
            </div>

            <div class="menu-columns">
              <section>
                <h2>Worlds</h2>
                <div id="world-list" class="world-list"></div>
              </section>

              <section>
                <h2>Create New World</h2>
                <form id="create-world-form" class="world-form">
                  <label>
                    <span>World Name</span>
                    <input
                      name="world-name"
                      type="text"
                      placeholder="Yudan Realm"
                      autocomplete="off"
                    />
                  </label>

                  <label>
                    <span>Seed</span>
                    <input
                      name="world-seed"
                      type="text"
                      placeholder="Leave blank for random"
                      autocomplete="off"
                    />
                  </label>

                  <label>
                    <span>Mode</span>
                    <select name="world-mode">
                      <option value="survival">Survival</option>
                      <option value="creative">Creative</option>
                      <option value="hardcore">Hardcore</option>
                    </select>
                  </label>

                  <button type="submit">Create World</button>
                </form>
              </section>
            </div>
          </div>
        </section>

        <section id="hud" class="game-hud" hidden>
            <button id="hud-menu-button" class="hud-menu-button" type="button">Menu</button>
            <div id="hud-stats" class="hud-stats"></div>
            <div id="selected-item-pill" class="selected-item-pill"></div>
            <div class="break-bar"><div id="break-bar-fill"></div></div>
            <div class="crosshair"></div>
            <div id="hotbar" class="hotbar"></div>
          </section>

        <section id="overlay" class="overlay" hidden></section>

        <section id="mobile-hud" class="mobile-hud" hidden>
          <div id="mobile-look-area" class="mobile-look-area"></div>
          <div class="mobile-left">
            <div class="mobile-pad">
              <span class="mobile-pad__label">Move</span>
              <div id="mobile-joystick" class="joystick">
                <div id="mobile-joystick-thumb" class="joystick__thumb"></div>
              </div>
            </div>
          </div>
          <div class="mobile-right">
            <div class="mobile-actions">
              <button id="mobile-jump">Jump</button>
              <button id="mobile-descend">Sneak</button>
              <button id="mobile-inventory">Bag</button>
              <button id="mobile-map">Map</button>
            </div>
          </div>
        </section>

        <section id="loading-screen" class="loading-screen" hidden>
          <div class="loading-card">
            <p id="loading-label">Loading world...</p>
            <div class="loading-bar"><div></div></div>
          </div>
        </section>
      </div>
    `;
  }
}


















