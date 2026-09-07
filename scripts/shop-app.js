import { MODULE_ID } from "./constants.js";
import { getShopConfig, setShopConfig, getShopGold, enableShop } from "./shop-data.js";
import { restockShop, addManualItem, priceInGp } from "./restock.js";
import { buyItem, sellItem } from "./transactions.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;
const { DragDrop, TextEditor } = foundry.applications.ux;

/**
 * Where a compendium pack actually comes from, matching the same logic
 * Foundry's own Compendium sidebar uses to label packs by source.
 */
function packSource(pack) {
  const { packageType, packageName } = pack.metadata;
  if (packageType === "system") return game.system.title;
  if (packageType === "module") return game.modules.get(packageName)?.title ?? packageName;
  return "World";
}

/**
 * Registered as a selectable sheet for NPC actors (Configure Sheet > Shop),
 * so opening a shop actor's sheet — including a player double-clicking its
 * token — can resolve to this instead of the normal NPC sheet. Permission
 * gating (view vs. edit) is handled by DocumentSheetV2 itself.
 */
export class ShopApp extends HandlebarsApplicationMixin(DocumentSheetV2) {
  constructor(options = {}) {
    super(options);
    this.actingActorId = game.user.character?.id ?? null;
    this.#dragDrop = new DragDrop.implementation({
      dropSelector: ".vs-drop-zone",
      permissions: { drop: () => this.isEditable },
      callbacks: { drop: this._onDropItem.bind(this) }
    });
  }

  #dragDrop;

  get actor() {
    return this.document;
  }

  static DEFAULT_OPTIONS = {
    id: "valoria-shop-app-{id}",
    window: { icon: "fa-solid fa-store", resizable: true },
    position: { width: 720, height: 780 },
    actions: {
      enable: ShopApp.#onEnable,
      restock: ShopApp.#onRestock,
      buy: ShopApp.#onBuy,
      sell: ShopApp.#onSell,
      removeItem: ShopApp.#onRemoveItem,
      saveConfig: ShopApp.#onSaveConfig
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/shop-app.hbs` }
  };

  get title() {
    return `Shop: ${this.actor.name}`;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#dragDrop.bind(this.element);
    this.element.querySelector('[name="actingActor"]')?.addEventListener("change", (ev) => {
      this.actingActorId = ev.target.value || null;
      this.render();
    });
  }

  async _prepareContext(_options) {
    const config = getShopConfig(this.actor);
    const canManage = this.isEditable;

    const stock = this.actor.items.contents
      .map((i) => ({
        id: i.id,
        name: i.name,
        img: i.img,
        price: priceInGp(i),
        quantity: i.system.quantity ?? 0,
        rarity: i.system.rarity || "",
        origin: i.getFlag(MODULE_ID, "origin") || "unknown"
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // GMs/owners pick who they're acting as; a regular player always acts
    // as their own assigned character — no dropdown, no impersonation.
    let actingActor;
    if (canManage) {
      actingActor = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    } else {
      actingActor = game.user.character ?? null;
      this.actingActorId = actingActor?.id ?? null;
    }

    const sellable = [];
    if (actingActor) {
      for (const i of actingActor.items) {
        if (config.buyList.includes(i.type)) {
          sellable.push({
            id: i.id,
            name: i.name,
            img: i.img,
            price: priceInGp(i),
            quantity: i.system.quantity ?? 1
          });
        }
      }
    }

    const itemTypes = ["weapon", "equipment", "consumable", "tool", "loot", "container"];
    const rarities = Object.keys(CONFIG.DND5E?.itemRarity ?? {});

    const packs = canManage
      ? game.packs
          .filter((p) => p.documentName === "Item")
          .map((p) => ({
            id: p.collection,
            label: p.title,
            source: packSource(p),
            checked: config.compendiums.includes(p.collection)
          }))
          .sort((a, b) => a.source.localeCompare(b.source) || a.label.localeCompare(b.label))
      : [];

    const playerActors = canManage ? game.actors.filter((a) => a.hasPlayerOwner) : [];

    return {
      actor: this.actor,
      canManage,
      config,
      gold: getShopGold(this.actor),
      stock,
      itemTypes,
      rarities,
      packs,
      playerActors,
      actingActorId: this.actingActorId,
      actingActor,
      sellable
    };
  }

  async _onDropItem(event) {
    if (!this.isEditable) return;
    const data = TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await fromUuid(data.uuid);
    if (!item) return;
    await addManualItem(this.actor, item, 1);
    ui.notifications.info(`Added ${item.name} to ${this.actor.name}'s stock (manual override).`);
    this.render();
  }

  static async #onEnable() {
    if (!this.isEditable) return;
    await enableShop(this.actor);
    this.render();
  }

  static async #onRestock() {
    if (!this.isEditable) return;
    const result = await restockShop(this.actor);
    ChatMessage.create({
      speaker: { alias: this.actor.name },
      content:
        `<strong>Restock complete.</strong><br>` +
        `Added: ${result.added.join(", ") || "none"}<br>` +
        `Topped up: ${result.toppedUp.join(", ") || "none"}<br>` +
        `Gold reset to ${result.goldReset} gp.`
    });
    this.render();
  }

  static async #onBuy(_event, target) {
    const itemId = target.dataset.itemId;
    const buyer = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    if (!buyer) {
      return ui.notifications.warn(
        this.isEditable
          ? "Pick an acting character first."
          : "You don't have a character assigned — ask your GM to set one in Player Configuration."
      );
    }
    const result = await buyItem(this.actor, buyer, itemId, 1);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onSell(_event, target) {
    const itemId = target.dataset.itemId;
    const seller = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    if (!seller) {
      return ui.notifications.warn(
        this.isEditable
          ? "Pick an acting character first."
          : "You don't have a character assigned — ask your GM to set one in Player Configuration."
      );
    }
    const result = await sellItem(this.actor, seller, itemId, 1);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onRemoveItem(_event, target) {
    if (!this.isEditable) return;
    const itemId = target.dataset.itemId;
    await this.actor.items.get(itemId)?.delete();
    this.render();
  }

  static async #onSaveConfig(event) {
    if (!this.isEditable) return;
    event.preventDefault();
    const form = this.element;

    const getChecked = (name) =>
      Array.from(form.querySelectorAll(`[name="${name}"]:checked`)).map((el) => el.value);
    const getValue = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";

    await setShopConfig(this.actor, {
      compendiums: getChecked("compendiums"),
      buyList: getChecked("buyList"),
      filters: {
        types: getChecked("filterTypes"),
        rarities: getChecked("filterRarities"),
        includeKeywords: getValue("includeKeywords"),
        excludeKeywords: getValue("excludeKeywords")
      },
      startingGold: Number(getValue("startingGold")) || 0,
      targetStockCount: Number(getValue("targetStockCount")) || 0,
      maxQuantityPerItem: Number(getValue("maxQuantityPerItem")) || 1,
      sellBackPercent: Number(getValue("sellBackPercent")) || 50
    });

    ui.notifications.info("Shop configuration saved.");
    this.render();
  }
}
