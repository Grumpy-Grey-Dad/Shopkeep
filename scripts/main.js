import { MODULE_ID } from "./constants.js";
import { ShopApp } from "./shop-app.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  game.modules.get(MODULE_ID).api = { ShopApp };
  Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
  Handlebars.registerHelper("eq", (a, b) => String(a) === String(b));
});

/**
 * Adds a "Shop" header button to the NPC actor sheet used by this dnd5e
 * build (NPCActorSheet). Header control clicks are dispatched through the
 * app's own options.actions map, so we inject both the control entry and
 * its handler on the actual rendered sheet instance.
 */
Hooks.on("getHeaderControlsNPCActorSheet", (app, controls) => {
  app.options.actions.valoriaOpenShop = () => new ShopApp(app.actor).render(true);
  controls.unshift({
    icon: "fa-solid fa-store",
    label: "Shop",
    action: "valoriaOpenShop",
    visible: game.user.isGM
  });
});
