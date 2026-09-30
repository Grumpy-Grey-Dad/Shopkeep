import { MODULE_ID } from "./constants.js";
import { ShopApp } from "./shop-app.js";
import { copperToDisplay } from "./currency.js";
import { registerPatrolIntegration } from "./patrol-integration.js";
import { initSocketRelay } from "./socket-relay.js";
import { QUEST_ITEM_FLAG, isQuestItem } from "./trade-rules.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  game.modules.get(MODULE_ID).api = { ShopApp };
  Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
  Handlebars.registerHelper("eq", (a, b) => String(a) === String(b));
  Handlebars.registerHelper("formatCopper", (copper) => copperToDisplay(copper));

  // Registers ShopApp as a selectable sheet for NPC actors (via the
  // actor's own "Configure Sheet" control). This is what lets a player
  // actually open a shop themselves — double-clicking a shop's token (or
  // opening it from the Actors directory) resolves to ShopApp instead of
  // the normal NPC sheet, once a GM has picked "Shop" for that actor.
  // Permission gating (who can view/edit) is handled by DocumentSheetV2.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, ShopApp, {
    types: ["npc"],
    label: "Shop",
    makeDefault: false
  });
});

// Registering the custom "Suspected" status effect has to wait until
// "ready" — dnd5e rebuilds CONFIG.statusEffects wholesale after "init"
// runs, which would silently discard an entry pushed too early (caught
// live: a push during "init" was gone by the time theft.js needed it).
Hooks.once("ready", () => {
  registerPatrolIntegration();
  initSocketRelay();
});

/**
 * GM-only quick-launch: adds a "Shop" entry to the header menu of the
 * normal NPC sheet, so a GM can peek at Shop mode without switching that
 * actor's actual default sheet away from its stat block. Independent of
 * the sheet registration above — this never changes what a player sees.
 */
Hooks.on("getHeaderControlsNPCActorSheet", (app, controls) => {
  app.options.actions.valoriaOpenShop = () => new ShopApp({ document: app.actor }).render(true);
  controls.unshift({
    icon: "fa-solid fa-store",
    label: "Shop",
    action: "valoriaOpenShop",
    visible: game.user.isGM
  });
});

/**
 * M1 (0.5.4): GM-only "Quest item (can't be sold)" checkbox on every item
 * sheet. Ticking it sets flags.valoria-shops.questItem, and no shop will
 * buy the item (see trade-rules.js). Zero-value items are already refused
 * without it; this is for quest items that carry a price. Players never
 * see the control.
 */
Hooks.on("renderItemSheet5e", (app, element) => {
  if (!game.user.isGM) return;
  const item = app.document;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!item || !root) return;
  root.querySelector(".vs-quest-toggle")?.remove();
  const host = root.querySelector(".sheet-header .identity-info") ?? root.querySelector(".sheet-header");
  if (!host) return;
  const label = document.createElement("label");
  label.className = "vs-quest-toggle";
  label.title = "Valoria Shops: no shop will buy this item (GM only)";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = isQuestItem(item);
  box.disabled = !app.isEditable;
  box.addEventListener("change", async (event) => {
    event.stopPropagation();
    if (event.currentTarget.checked) await item.setFlag(MODULE_ID, QUEST_ITEM_FLAG, true);
    else await item.unsetFlag(MODULE_ID, QUEST_ITEM_FLAG);
  });
  label.append(box, document.createTextNode(" Quest item (can't be sold)"));
  host.append(label);
});
