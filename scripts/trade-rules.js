import { MODULE_ID, ORIGIN } from "./constants.js";
import { itemCostCopper } from "./restock.js";
import { passesKeywords } from "./keywords.js";

/*
 * What a shop will trade — one place, so the stock list, the Sell list and
 * every transaction path (buy, sell, haggle, theft, the player relay) can't
 * disagree with each other. Added in 0.5.4.
 */

/** S1: a shop only offers items the module itself put on the shelf —
 *  Restock (compendium), the shop window's drag-to-add (manual), or an
 *  item a player sold to it (sold). Anything else on the actor is the
 *  NPC's own statblock/gear (weapons, armour, feats, traits, spells) and is
 *  never for sale, so stock must always go on through the shop window. */
const STOCK_ORIGINS = new Set([ORIGIN.COMPENDIUM, ORIGIN.MANUAL, ORIGIN.SOLD]);

export function isShopStock(item) {
  return STOCK_ORIGINS.has(item?.getFlag?.(MODULE_ID, "origin"));
}

export function getShopStock(shopActor) {
  return shopActor.items.filter(isShopStock);
}

export const NOT_FOR_SALE_MESSAGE = "That isn't for sale.";

/** M1: quest items can't be sold to any shop. An item is refused if it's
 *  worth nothing (Romlim's papers, and anything else priced at 0), or if a
 *  GM has ticked "Quest item (can't be sold)" on its sheet (the flag below)
 *  for a quest item that does carry a price. */
export const QUEST_ITEM_FLAG = "questItem";

export function isQuestItem(item) {
  return !!item?.getFlag?.(MODULE_ID, QUEST_ITEM_FLAG);
}

export const NOT_BUYABLE_REASON = "Not something a shop will buy.";
export const OUT_OF_TRADE_REASON = "Not something this shop deals in.";

/** F2 (0.6.0): is `item` in this shop's trade? Item type must be on the
 *  Buy List; a loot item must also have one of the ticked loot sub-types
 *  (if any are ticked); and every item must pass the Buy List keywords
 *  (if any are set). The Sell list only lists items that pass. */
export function isInTrade(item, config) {
  if (!config.buyList?.length || !config.buyList.includes(item.type)) return false;
  if (item.type === "loot" && config.buyLootTypes?.length
    && !config.buyLootTypes.includes(item.system?.type?.value || "")) return false;
  return passesKeywords(item.name, config.buyIncludeKeywords, config.buyExcludeKeywords, config.keywordMatch);
}

/** Why this shop won't buy `item` from a player, or null if it will.
 *  Used by the Sell list (which hides the button and shows the reason) and
 *  by the sale itself, so a hidden button can't be bypassed. */
export function sellBlockReason(item, config) {
  if (!config.buyList?.length || !config.buyList.includes(item.type)) {
    return `This shop doesn't buy ${item.type} items.`;
  }
  if (!isInTrade(item, config)) return OUT_OF_TRADE_REASON;
  if (isQuestItem(item) || itemCostCopper(item) <= 0) return NOT_BUYABLE_REASON;
  return null;
}
