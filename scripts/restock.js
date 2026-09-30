import { MODULE_ID, ORIGIN } from "./constants.js";
import { getShopConfig, setShopGold } from "./shop-data.js";
import { toCopper } from "./currency.js";
import { passesKeywords } from "./keywords.js";

function matchesFilters(item, filters, keywordMatch) {
  if (filters.types?.length && !filters.types.includes(item.type)) return false;

  const rarity = item.system?.rarity || "";
  if (filters.rarities?.length && !filters.rarities.includes(rarity)) return false;

  return passesKeywords(item.name, filters.includeKeywords, filters.excludeKeywords, keywordMatch);
}

/** Pull the current candidate pool from every compendium configured on the shop. */
export async function getFilteredPool(config) {
  const pool = [];
  for (const packId of config.compendiums) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const docs = await pack.getDocuments();
    for (const doc of docs) {
      // F3 (0.6.0): pack contents (the Tinderbox inside Explorer's Pack)
      // would shelve with a link to a container that isn't there, and a
      // 0-price item would be free to buy. Both skipped unless turned off.
      if (config.skipContainedItems !== false && doc.system?.container) continue;
      if (config.skipZeroPriceItems !== false && itemCostCopper(doc) <= 0) continue;
      if (matchesFilters(doc, config.filters, config.keywordMatch)) pool.push(doc);
    }
  }
  return pool;
}

/**
 * An item's price converted to exact whole copper. Deliberately doesn't
 * use dnd5e's own price.valueInGP — that getter floors to a whole gold
 * piece internally, which would silently zero out anything priced under
 * 1 gp (a 7 cp item, say).
 */
function itemCostCopper(item) {
  return toCopper(item.system?.price?.value ?? 0, item.system?.price?.denomination ?? "gp");
}

/**
 * Manual restock: tops up existing compendium-sourced stock, fills empty
 * slots up to targetStockCount from the filtered pool, resets shop gold to
 * startingGold. Player-sold and manually-placed items are untouched.
 */
export async function restockShop(actor) {
  const config = getShopConfig(actor);

  const compendiumItems = actor.items.filter(
    (i) => i.getFlag(MODULE_ID, "origin") === ORIGIN.COMPENDIUM
  );

  const toppedUp = [];
  for (const item of compendiumItems) {
    const current = item.system.quantity ?? 0;
    if (current < config.maxQuantityPerItem) {
      await item.update({ "system.quantity": config.maxQuantityPerItem });
      toppedUp.push(item.name);
    }
  }

  const needed = Math.max(0, config.targetStockCount - compendiumItems.length);
  const added = [];

  if (needed > 0) {
    const pool = await getFilteredPool(config);
    const stockedSourceUuids = new Set(
      compendiumItems.map((i) => i.getFlag(MODULE_ID, "sourceUuid")).filter(Boolean)
    );
    const candidates = pool.filter((doc) => !stockedSourceUuids.has(doc.uuid));

    // Shuffle and take what's needed.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const picks = candidates.slice(0, needed);

    if (picks.length) {
      const itemData = picks.map((doc) => {
        const data = doc.toObject();
        data.system.quantity = config.maxQuantityPerItem;
        data.flags = data.flags ?? {};
        data.flags[MODULE_ID] = { origin: ORIGIN.COMPENDIUM, sourceUuid: doc.uuid };
        return data;
      });
      const created = await actor.createEmbeddedDocuments("Item", itemData);
      added.push(...created.map((i) => i.name));
    }
  }

  await setShopGold(actor, config.startingGold);

  return { toppedUp, added, goldReset: config.startingGold };
}

/** Manual override: hand-place a specific item into the shop, bypassing filters entirely. */
export async function addManualItem(actor, sourceItem, quantity = 1) {
  const data = sourceItem.toObject();
  data.system.quantity = quantity;
  data.flags = data.flags ?? {};
  data.flags[MODULE_ID] = { origin: ORIGIN.MANUAL };
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

export { itemCostCopper };
