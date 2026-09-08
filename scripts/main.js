import { MODULE_ID } from "./constants.js";
import { ShopApp } from "./shop-app.js";
import { copperToDisplay } from "./currency.js";

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
