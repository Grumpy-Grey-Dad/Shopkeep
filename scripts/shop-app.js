import {
  MODULE_ID,
  SHOP_TYPES,
  SUGGESTED_SERVICES,
  CURRENCY_DENOMINATIONS,
  THEFT_CONSEQUENCE_MODES
} from "./constants.js";
import {
  getShopConfig,
  setShopConfig,
  enableShop,
  getPendingRequests,
  getPendingOrders,
  getFlaggedEvents,
  getStanding,
  setStanding,
  adjustStanding,
  getStandingTier,
  recordVisitSession,
  STANDING_TIER_RANK,
  resetHaggleAttempts,
  getBannedActorIds,
  unbanActor
} from "./shop-data.js";
import { restockShop, addManualItem, itemCostCopper } from "./restock.js";
import { buyItem, sellItem, sellPayoutCopper } from "./transactions.js";
import { useService, fulfillOrder, serviceCostCopper } from "./services.js";
import { attemptHaggle } from "./haggle.js";
import { attemptTheft, acknowledgeFlaggedEvent } from "./theft.js";
import { spawnGuard } from "./consequence.js";
import { approveRequest, denyRequest } from "./requests.js";
import { copperToDisplay, actorTotalCopper } from "./currency.js";

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
      fulfillOrder: ShopApp.#onFulfillOrder,
      haggle: ShopApp.#onHaggle,
      resetHaggleCounts: ShopApp.#onResetHaggleCounts,
      theft: ShopApp.#onTheft,
      acknowledgeFlaggedEvent: ShopApp.#onAcknowledgeFlaggedEvent,
      spawnGuard: ShopApp.#onSpawnGuard,
      unbanActor: ShopApp.#onUnbanActor
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/shop-app.hbs` }
  };

  get title() {
    return `Shop: ${this.actor.name}`;
  }

  /**
   * Fires once per app instance, before the first _onRender — the
   * natural "opened the shop" check point. Awards the visit bump only if
   * this player's socket session (game.socket.session.sessionId) hasn't
   * already been credited at this shop — closing and reopening the
   * window within the same connection doesn't re-trigger it, only an
   * actual reconnect (reload, relaunching Foundry for the next game
   * session) does. A player's own actingActor is already resolved by the
   * time this runs (set in the constructor / _prepareContext), so this
   * only fires for an actual player opening their own character's shop
   * window — never for a GM's management console, or a GM testing as a
   * picked character (that selection triggers a normal, non-first render).
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    if (game.user.isGM) return;
    const actingActor = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    if (!actingActor) return;
    const config = getShopConfig(this.actor);
    if (!config.standingPerVisit) return;
    // Falls back to game.user.id if the socket session isn't available for
    // some reason — safer to under-grant (at most once ever) than to leave
    // the visit bump farmable.
    const sessionId = game.socket?.session?.sessionId ?? game.socket?.id ?? game.user.id;
    const isNewVisit = await recordVisitSession(this.actor, actingActor.id, sessionId);
    if (!isNewVisit) return;
    await adjustStanding(this.actor, actingActor.id, config.standingPerVisit);
    this.render();
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

    this.element.querySelectorAll("[data-standing-actor-id]").forEach((el) => {
      el.addEventListener("change", (ev) => this._onStandingChange(ev));
    });

    this.element.querySelectorAll("[data-stock-tier-item-id]").forEach((el) => {
      el.addEventListener("change", (ev) => this._onStockTierChange(ev));
    });
  }

  async _onStandingChange(event) {
    if (!game.user.isGM) return;
    const el = event.currentTarget;
    await setStanding(this.actor, el.dataset.standingActorId, Number(el.value) || 0);
    this.render();
  }

  async _onStockTierChange(event) {
    if (!game.user.isGM) return;
    const el = event.currentTarget;
    const item = this.actor.items.get(el.dataset.stockTierItemId);
    if (!item) return;
    if (el.value) await item.setFlag(MODULE_ID, "requiredTier", el.value);
    else await item.unsetFlag(MODULE_ID, "requiredTier");
    this.render();
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
    } else if (serviceField === "cost.value") {
      service.cost = { ...service.cost, value: Number(el.value) || 0 };
    } else if (serviceField === "cost.denomination") {
      service.cost = { ...service.cost, denomination: el.value };
    } else if (["dc", "leadTimeDays"].includes(serviceField)) {
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

    // GMs/owners pick who they're acting as; a regular player always acts
    // as their own assigned character — no dropdown, no impersonation.
    // Resolved before the stock list below since gated stock needs to
    // know the acting player's own standing tier to filter by.
    let actingActor;
    if (canManage) {
      actingActor = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    } else {
      actingActor = game.user.character ?? null;
      this.actingActorId = actingActor?.id ?? null;
    }

    const currentStanding = actingActor ? getStanding(this.actor, actingActor.id) : 0;
    const currentTier = getStandingTier(config, currentStanding);

    // Shown price already reflects the acting player's own passive tier
    // discount (if any) — otherwise a Friendly/Cooperative customer would
    // see a listed price that's simply wrong for what they're about to
    // pay, since that discount applies automatically without them having
    // to haggle for it.
    const tierDiscountedCopper = (baseCopper) =>
      Math.round((baseCopper * (100 - currentTier.discountPercent)) / 100);
    const tierPremiumCopper = (baseCopper) =>
      Math.round((baseCopper * (100 + currentTier.discountPercent)) / 100);

    const stock = this.actor.items.contents
      .map((i) => {
        const requiredTier = i.getFlag(MODULE_ID, "requiredTier") || "";
        return {
          id: i.id,
          name: i.name,
          img: i.img,
          price: copperToDisplay(tierDiscountedCopper(itemCostCopper(i))),
          quantity: i.system.quantity ?? 0,
          rarity: i.system.rarity || "",
          origin: i.getFlag(MODULE_ID, "origin") || "unknown",
          requiredTier,
          // GMs always see gated stock (with a control to manage the
          // gate); a player only sees it once their own standing tier
          // meets it.
          locked: !!requiredTier && STANDING_TIER_RANK[requiredTier] > STANDING_TIER_RANK[currentTier.key]
        };
      })
      .filter((i) => canManage || !i.locked)
      .sort((a, b) => a.name.localeCompare(b.name));

    const sellable = [];
    if (actingActor) {
      for (const i of actingActor.items) {
        if (config.buyList.includes(i.type)) {
          sellable.push({
            id: i.id,
            name: i.name,
            img: i.img,
            price: copperToDisplay(tierPremiumCopper(sellPayoutCopper(i, 1, config))),
            quantity: i.system.quantity ?? 1
          });
        }
      }
    }

    const itemTypes = ["weapon", "equipment", "consumable", "tool", "loot", "container"];
    // "" (blank) is how ordinary mundane gear is actually tagged in
    // dnd5e — "common" specifically means the weakest tier of MAGIC item,
    // not "non-magical." Exposing blank as its own checkbox stops that
    // mislabeling from silently filtering a mundane-goods shop to zero.
    const rarities = ["", ...Object.keys(CONFIG.DND5E?.itemRarity ?? {})];

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

    const haggleSkills = canManage
      ? Object.entries(CONFIG.DND5E?.skills ?? {}).map(([key, s]) => ({ key, label: s.label }))
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
        cost: copperToDisplay(serviceCostCopper(s)),
        needsApproval: !!s.alwaysFlag || (s.resolutionType === "rolltable" && (s.rollTableIds?.length ?? 0) > 1)
      }));

    const pendingRequests = canManage ? getPendingRequests(this.actor) : [];
    const pendingOrders = canManage ? getPendingOrders(this.actor) : [];
    const flaggedEvents = canManage
      ? getFlaggedEvents(this.actor).map((e) => ({ ...e, showSpawnGuard: config.theftConsequenceMode === "guard" }))
      : [];

    // The acting player's own standing with this merchant — never anyone
    // else's. GMs additionally get a full roster to review/adjust.
    const standing = actingActor ? currentStanding : null;
    const standingTierLabel = actingActor ? currentTier.label : null;
    const bannedActorIds = getBannedActorIds(this.actor);
    const allStanding = canManage
      ? playerActors.map((a) => {
          const value = getStanding(this.actor, a.id);
          return {
            id: a.id,
            name: a.name,
            value,
            tierLabel: getStandingTier(config, value).label,
            banned: bannedActorIds.includes(a.id)
          };
        })
      : [];

    const guardActors = canManage ? game.actors.filter((a) => a.type === "npc").map((a) => ({ id: a.id, name: a.name })) : [];

    return {
      actor: this.actor,
      canManage,
      config,
      gold: copperToDisplay(actorTotalCopper(this.actor)),
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
      haggleSkills,
      services,
      visibleServices,
      pendingRequests,
      pendingOrders,
      flaggedEvents,
      currencyDenominations: CURRENCY_DENOMINATIONS,
      standing,
      standingTierLabel,
      standingTierOptions: [
        { key: "", label: "None" },
        { key: "friendly", label: "Friendly" },
        { key: "cooperative", label: "Cooperative" }
      ],
      allStanding,
      guardActors,
      theftConsequenceModes: THEFT_CONSEQUENCE_MODES,
      patrolActive: !!game.modules.get("patrol")?.active
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
    const config = getShopConfig(this.actor);
    const discountPercent = getStandingTier(config, getStanding(this.actor, buyer.id)).discountPercent;
    const result = await buyItem(this.actor, buyer, itemId, 1, discountPercent);
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

    const config = getShopConfig(this.actor);
    const premiumPercent = getStandingTier(config, getStanding(this.actor, seller.id)).discountPercent;
    const result = await sellItem(this.actor, seller, itemId, 1, premiumPercent);
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
      typeLock: form.querySelector('[name="typeLock"]')?.checked ?? false,
      haggleSkill: getValue("haggleSkill") || "per",
      haggleDC: Number(getValue("haggleDC")) || 10,
      haggleDiscountPercent: Number(getValue("haggleDiscountPercent")) || 0,
      standingPerPurchase: Number(getValue("standingPerPurchase")) || 0,
      standingPerVisit: Number(getValue("standingPerVisit")) || 0,
      standingPerHaggleSuccess: Number(getValue("standingPerHaggleSuccess")) || 0,
      standingPerHaggleRepeat: Number(getValue("standingPerHaggleRepeat")) || 0,
      standingFriendlyThreshold: Number(getValue("standingFriendlyThreshold")) || 0,
      standingFriendlyDiscountPercent: Number(getValue("standingFriendlyDiscountPercent")) || 0,
      standingCooperativeThreshold: Number(getValue("standingCooperativeThreshold")) || 0,
      standingCooperativeDiscountPercent: Number(getValue("standingCooperativeDiscountPercent")) || 0,
      flagGoldThreshold: {
        value: Number(getValue("flagGoldThresholdValue")) || 0,
        denomination: getValue("flagGoldThresholdDenomination") || "gp"
      },
      theftSkill: getValue("theftSkill") || "slt",
      theftDC: Number(getValue("theftDC")) || 10,
      standingPerFailedTheft: Number(getValue("standingPerFailedTheft")) || 0,
      theftConsequenceMode: getValue("theftConsequenceMode") || "merchant",
      guardActorId: getValue("guardActorId") || "",
      hostileStandingFloor: Number(getValue("hostileStandingFloor")) || 0,
      suspectedWindowSeconds: Number(getValue("suspectedWindowSeconds")) || 60
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
        cost: { value: 0, denomination: "gp" },
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
    // Read the dropdown's current selection, not the last-saved config —
    // picking a type and loading its services are two different buttons,
    // so the type may not have been saved yet when this one is clicked.
    const shopType = this.element.querySelector('[name="shopType"]')?.value;
    const suggested = SUGGESTED_SERVICES[shopType];
    if (!suggested) return ui.notifications.warn("Pick a Shop Type first.");

    const config = getShopConfig(this.actor);
    const existingNames = new Set(config.services.map((s) => s.name));
    const additions = suggested
      .filter((s) => !existingNames.has(s.name))
      .map((s) => ({
        id: foundry.utils.randomID(),
        resolutionType: "instant",
        cost: { value: 0, denomination: "gp" },
        dc: 10,
        leadTimeDays: 1,
        alwaysFlag: false,
        enabled: true,
        rollTableIds: [],
        ...s
      }));

    if (!additions.length) {
      // Still persist the type selection even if there's nothing new to
      // add, so it doesn't appear to "not have saved" on next render.
      await setShopConfig(this.actor, { shopType });
      return ui.notifications.info("Nothing new to add — already present.");
    }
    await setShopConfig(this.actor, { shopType, services: [...config.services, ...additions] });
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

    const result = await approveRequest(this.actor, requestId, { chosenTableId });
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

  static async #onHaggle(_event, target) {
    const { itemId, direction } = target.dataset;
    const actorActor = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    if (!actorActor) {
      return ui.notifications.warn(
        game.user.isGM
          ? "Pick an acting character first."
          : "You don't have a character assigned — ask your GM to set one in Player Configuration."
      );
    }
    const result = await attemptHaggle(this.actor, actorActor, itemId, direction);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onResetHaggleCounts() {
    if (!game.user.isGM) return;
    await resetHaggleAttempts(this.actor);
    ui.notifications.info("Haggle counts reset for this visit.");
    this.render();
  }

  static async #onTheft(_event, target) {
    const itemId = target.dataset.itemId;
    const actorActor = this.actingActorId ? game.actors.get(this.actingActorId) : null;
    if (!actorActor) {
      return ui.notifications.warn(
        game.user.isGM
          ? "Pick an acting character first."
          : "You don't have a character assigned — ask your GM to set one in Player Configuration."
      );
    }
    const result = await attemptTheft(this.actor, actorActor, itemId);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
    if (result.ok) this.render();
  }

  static async #onAcknowledgeFlaggedEvent(_event, target) {
    if (!game.user.isGM) return;
    const eventId = target.dataset.eventId;
    await acknowledgeFlaggedEvent(this.actor, eventId);
    this.render();
  }

  static async #onSpawnGuard(_event, target) {
    if (!game.user.isGM) return;
    const actorActor = game.actors.get(target.dataset.actorId);
    if (!actorActor) return ui.notifications.warn("That character no longer exists.");
    const result = await spawnGuard(this.actor, actorActor);
    ui.notifications[result.ok ? "info" : "warn"](result.message);
  }

  static async #onUnbanActor(_event, target) {
    if (!game.user.isGM) return;
    await unbanActor(this.actor, target.dataset.actorId);
    ui.notifications.info("Ban lifted.");
    this.render();
  }
}
