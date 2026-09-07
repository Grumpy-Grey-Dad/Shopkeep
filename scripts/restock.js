import { MODULE_ID, ORIGIN } from "./constants.js";
import { getShopConfig, setShopGold } from "./shop-data.js";

function matchesFilters(item, filters) {
  if (filters.types?.length && !filters.types.includes(item.type)) return false;

  const rarity = item.system?.rarity || "";
  if (filters.rarities?.length && !filters.rarities.includes(rarity)) return false;

  const name = item.name.toLowerCase();
  const include = (filters.includeKeywords || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const exclude = (filters.excludeKeywords || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  if (include.length && !include.some((kw) => name.includes(kw))) return false;
  if (exclude.length && exclude.some((kw) => name.includes(kw))) return false;

  return true;
}

/** Pull the current candidate pool from every compendium configured on the shop. */
export async function getFilteredPool(config) {
  const pool = [];
  for (const packId of config.compendiums) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    const docs = await pack.getDocuments();
    for (const doc of docs) {
      if (matchesFilters(doc, config.filters)) pool.push(doc);
    }
  }
  return pool;
}

function priceInGp(item) {
  return item.system?.price?.valueInGP ?? item.system?.price?.value ?? 0;
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

export { priceInGp };
