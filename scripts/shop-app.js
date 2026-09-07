import { MODULE_ID, SHOP_TYPES, SUGGESTED_SERVICES } from "./constants.js";
import {
  getShopConfig,
  setShopConfig,
  getShopGold,
  enableShop,
  getPendingRequests,
  getPendingOrders
} from "./shop-data.js";
import { restockShop, addManualItem, priceInGp } from "./restock.js";
import { buyItem, sellItem, sellPayout } from "./transactions.js";
import { useService, approveRequest, denyRequest, fulfillOrder } from "./services.js";

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
      permissions: { drop: () => game.user.isGM },
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
      saveConfig: ShopApp.#onSaveConfig,
      useService: ShopApp.#onUseService,
      addService: ShopApp.#onAddService,
      removeService: ShopApp.#onRemoveService,
      loadSuggestedServices: ShopApp.#onLoadSuggestedServices,
      approveRequest: ShopApp.#onApproveRequest,
      denyRequest: ShopApp.#onDenyRequest,
      fulfillOrder: ShopApp.#onFulfillOrder
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

    // Service rows save field-by-field on change, spreadsheet-style —
    // there's no fixed set of services to name as form fields the way
    // compendium/filter checkboxes are, since the list is GM-editable and
    // variable-length.
    this.element.querySelectorAll("[data-service-field]").forEach((el) => {
      el.addEventListener("change", (ev) => this._onServiceFieldChange(ev));
    });
  }

  async _onServiceFieldChange(event) {
    if (!game.user.isGM) return;
    const el = event.currentTarget;
    const { serviceId, serviceField } = el.dataset;
    const config = getShopConfig(this.actor);
    const services = config.services.map((s) => ({ ...s }));
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;

    if (el.type === "checkbox") {
      service[serviceField] = el.checked;
    } else if (serviceField === "rollTableIds") {
      service[serviceField] = Array.from(el.selectedOptions).map((o) => o.value);
    } else if (["cost", "dc", "leadTimeDays"].includes(serviceField)) {
      service[serviceField] = Number(el.value) || 0;
    } else {
      service[serviceField] = el.value;
    }

    await setShopConfig(this.actor, { services });
    this.render();
  }

  async _prepareContext(_options) {
    const config = getShopConfig(this.actor);
    // GM-only, deliberately not tied to this.isEditable: players need
    // Owner permission on the shop actor for buy/sell writes to go
    // through at all under Foundry's own permission rules, so "has Owner"
    // can't double as "should see the management console" or every buyer
    // would get GM controls the moment they're able to transact.
    const canManage = game.user.isGM;

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
            price: sellPayout(i, 1, config),
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

    // Only real PCs, never the shop itself or any other NPC that happens
    // to have player-facing permission (the shop has to, for players to
    // open it at all — that doesn't make it something to "act as").
    const playerActors = canManage
      ? game.actors.filter((a) => a.hasPlayerOwner && a.type === "character")
      : [];

    const worldTables = canManage
      ? game.tables.contents.map((t) => ({ id: t.id, name: t.name }))
      : [];

    const services = (config.services ?? []).map((s) => ({
      ...s,
      linkedTableNames: (s.rollTableIds ?? [])
        .map((id) => game.tables.get(id)?.name)
        .filter(Boolean)
    }));

    // What a non-GM sees: only enabled services, plus whether the GM will
    // need to weigh in before it actually happens.
    const visibleServices = services
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        cost: s.cost ?? 0,
        needsApproval: !!s.alwaysFlag || (s.resolutionType === "rolltable" && (s.rollTableIds?.length ?? 0) > 1)
      }));

    const pendingRequests = canManage ? getPendingRequests(this.actor) : [];
    const pendingOrders = canManage ? getPendingOrders(this.actor) : [];

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
      sellable,
      shopTypes: SHOP_TYPES,
      worldTables,
      services,
      visibleServices,
      pendingRequests,
      pendingOrders
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
    if (!game.user.isGM) return;
    await enableShop(this.actor);
    this.render();
  }

  static async #onRestock() {
    if (!game.user.isGM) return;
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
        game.user.isGM
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
        game.user.isGM
          ? "Pick an acting character first."
          : "You don't have a character assigned — ask your GM to set one in Player Configuration."
      );
    }
    const item = seller.items.get(itemId);
    if (item?.system.equipped) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Sell Equipped Item?" },
        content: `<p><strong>${item.name}</strong> is currently equipped. Sell it anyway?</p>`
      });
      if (!confirmed) return;
    }

    const result = await sellItem(this.actor, seller, itemId, 1);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onRemoveItem(_event, target) {
    if (!game.user.isGM) return;
    const itemId = target.dataset.itemId;
    await this.actor.items.get(itemId)?.delete();
    this.render();
  }

  static async #onSaveConfig(event) {
    if (!game.user.isGM) return;
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
      sellBackPercent: Number(getValue("sellBackPercent")) || 50,
      shopType: getValue("shopType"),
      typeLock: form.querySelector('[name="typeLock"]')?.checked ?? false
    });

    ui.notifications.info("Shop configuration saved.");
    this.render();
  }

  static async #onUseService(_event, target) {
    const serviceId = target.dataset.serviceId;
    const actorActor = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    if (!actorActor) {
      return ui.notifications.warn(
        game.user.isGM
          ? "Pick an acting character first."
          : "You don't have a character assigned — ask your GM to set one in Player Configuration."
      );
    }
    const result = await useService(this.actor, actorActor, serviceId);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onAddService() {
    if (!game.user.isGM) return;
    const config = getShopConfig(this.actor);
    const services = [
      ...config.services,
      {
        id: foundry.utils.randomID(),
        name: "New Service",
        resolutionType: "instant",
        cost: 0,
        dc: 10,
        leadTimeDays: 1,
        alwaysFlag: false,
        enabled: true,
        rollTableIds: []
      }
    ];
    await setShopConfig(this.actor, { services });
    this.render();
  }

  static async #onRemoveService(_event, target) {
    if (!game.user.isGM) return;
    const serviceId = target.dataset.serviceId;
    const config = getShopConfig(this.actor);
    await setShopConfig(this.actor, { services: config.services.filter((s) => s.id !== serviceId) });
    this.render();
  }

  static async #onLoadSuggestedServices() {
    if (!game.user.isGM) return;
    const config = getShopConfig(this.actor);
    const suggested = SUGGESTED_SERVICES[config.shopType];
    if (!suggested) return ui.notifications.warn("Pick a Shop Type first.");

    const existingNames = new Set(config.services.map((s) => s.name));
    const additions = suggested
      .filter((s) => !existingNames.has(s.name))
      .map((s) => ({
        id: foundry.utils.randomID(),
        resolutionType: "instant",
        cost: 0,
        dc: 10,
        leadTimeDays: 1,
        alwaysFlag: false,
        enabled: true,
        rollTableIds: [],
        ...s
      }));

    if (!additions.length) return ui.notifications.info("Nothing new to add — already present.");
    await setShopConfig(this.actor, { services: [...config.services, ...additions] });
    ui.notifications.info(`Added ${additions.length} suggested service(s).`);
    this.render();
  }

  static async #onApproveRequest(_event, target) {
    if (!game.user.isGM) return;
    const requestId = target.dataset.requestId;
    const request = getPendingRequests(this.actor).find((r) => r.id === requestId);
    const config = getShopConfig(this.actor);
    const service = config.services.find((s) => s.id === request?.serviceId);

    let chosenTableId = null;
    if (service?.resolutionType === "rolltable" && (service.rollTableIds?.length ?? 0) > 1) {
      const options = service.rollTableIds
        .map((id) => game.tables.get(id))
        .filter(Boolean)
        .map((t) => `<option value="${t.id}">${t.name}</option>`)
        .join("");
      chosenTableId = await foundry.applications.api.DialogV2.prompt({
        window: { title: "Choose a Roll Table" },
        content: `<p>Which table should this draw from?</p><select name="table">${options}</select>`,
        ok: {
          label: "Draw",
          callback: (_ev, button) => button.form.elements.table.value
        }
      });
      if (!chosenTableId) return;
    }

    const result = await approveRequest(this.actor, requestId, chosenTableId);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    this.render();
  }

  static async #onDenyRequest(_event, target) {
    if (!game.user.isGM) return;
    const requestId = target.dataset.requestId;
    const result = await denyRequest(this.actor, requestId);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    this.render();
  }

  static async #onFulfillOrder(_event, target) {
    if (!game.user.isGM) return;
    const orderId = target.dataset.orderId;
    const result = await fulfillOrder(this.actor, orderId);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    this.render();
  }
}
