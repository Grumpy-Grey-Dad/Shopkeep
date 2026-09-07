import { MODULE_ID } from "./constants.js";
import { getShopConfig, setShopConfig, getShopGold, enableShop } from "./shop-data.js";
import { restockShop, addManualItem, priceInGp } from "./restock.js";
import { buyItem, sellItem } from "./transactions.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { DragDrop, TextEditor } = foundry.applications.ux;

export class ShopApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    this.actingActorId = game.user.character?.id ?? null;
    this.#dragDrop = new DragDrop.implementation({
      dropSelector: ".vs-drop-zone",
      permissions: { drop: () => game.user.isGM },
      callbacks: { drop: this._onDropItem.bind(this) }
    });
  }

  #dragDrop;

  static DEFAULT_OPTIONS = {
    id: "valoria-shop-app",
    tag: "form",
    window: { title: "Shop", icon: "fa-solid fa-store", resizable: true },
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

    const actingActor = this.actingActorId ? game.actors.get(this.actingActorId) : null;
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
    const packs = game.packs
      .filter((p) => p.documentName === "Item")
      .map((p) => ({
        id: p.collection,
        label: p.title,
        checked: config.compendiums.includes(p.collection)
      }));

    const playerActors = game.actors.filter((a) => a.hasPlayerOwner);

    return {
      actor: this.actor,
      isGM: game.user.isGM,
      config,
      gold: getShopGold(this.actor),
      stock,
      itemTypes,
      rarities,
      packs,
      playerActors,
      actingActorId: this.actingActorId,
      sellable
    };
  }

  async _onDropItem(event) {
    if (!game.user.isGM) return;
    const data = TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item") return;
    const item = await fromUuid(data.uuid);
    if (!item) return;
    await addManualItem(this.actor, item, 1);
    ui.notifications.info(`Added ${item.name} to ${this.actor.name}'s stock (manual override).`);
    this.render();
  }

  static async #onEnable() {
    await enableShop(this.actor);
    this.render();
  }

  static async #onRestock() {
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
    if (!buyer) return ui.notifications.warn("Pick an acting character first.");
    const result = await buyItem(this.actor, buyer, itemId, 1);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onSell(_event, target) {
    const itemId = target.dataset.itemId;
    const seller = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    if (!seller) return ui.notifications.warn("Pick an acting character first.");
    const result = await sellItem(this.actor, seller, itemId, 1);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onRemoveItem(_event, target) {
    const itemId = target.dataset.itemId;
    await this.actor.items.get(itemId)?.delete();
    this.render();
  }

  static async #onSaveConfig(event) {
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
