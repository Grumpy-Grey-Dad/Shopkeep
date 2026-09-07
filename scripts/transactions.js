import { MODULE_ID, ORIGIN } from "./constants.js";
import { getShopConfig, getShopGold, setShopGold } from "./shop-data.js";
import { priceInGp } from "./restock.js";

/**
 * Phase 1 simplification: all currency is treated in gp. A buyer's
 * available funds are read from system.currency.gp only — copper/silver/
 * platinum on the buyer's sheet are not consolidated or spent.
 */
export function buyerGp(actor) {
  return actor?.system?.currency?.gp ?? 0;
}

export async function setBuyerGp(actor, gp) {
  return actor.update({ "system.currency.gp": Math.max(0, Math.round(gp)) });
}

/** What the shop actually pays for a player-sold item — shared by the
 *  transaction and by the UI, so the displayed price can never drift from
 *  what clicking Sell actually pays out. */
export function sellPayout(item, quantity, config) {
  const percent = config.sellBackPercent ?? 50;
  return Math.floor((priceInGp(item) * quantity * percent) / 100);
}

export async function buyItem(shopActor, buyerActor, itemId, quantity = 1) {
  const item = shopActor.items.get(itemId);
  if (!item) return { ok: false, message: "Item no longer in stock." };

  const available = item.system.quantity ?? 0;
  if (quantity > available) return { ok: false, message: `Only ${available} in stock.` };

  const cost = priceInGp(item) * quantity;
  if (buyerGp(buyerActor) < cost) {
    return { ok: false, message: `${buyerActor.name} can't afford this (needs ${cost} gp).` };
  }

  await setBuyerGp(buyerActor, buyerGp(buyerActor) - cost);
  await setShopGold(shopActor, getShopGold(shopActor) + cost);

  const data = item.toObject();
  data.system.quantity = quantity;
  delete data.flags?.[MODULE_ID];
  await buyerActor.createEmbeddedDocuments("Item", [data]);

  if (available - quantity <= 0) {
    await item.delete();
  } else {
    await item.update({ "system.quantity": available - quantity });
  }

  return { ok: true, message: `${buyerActor.name} bought ${quantity}x ${item.name} for ${cost} gp.` };
}

export async function sellItem(shopActor, sellerActor, itemId, quantity = 1) {
  const config = getShopConfig(shopActor);
  const item = sellerActor.items.get(itemId);
  if (!item) return { ok: false, message: "Item not found on seller." };

  if (!config.buyList.length || !config.buyList.includes(item.type)) {
    return { ok: false, message: `This shop doesn't buy ${item.type} items.` };
  }

  const available = item.system.quantity ?? 1;
  if (quantity > available) return { ok: false, message: `Seller only has ${available}.` };

  // D&D norm: shops pay a fraction of listed value buying from players.
  // Not in the original spec — added here as a sensible default, flagged
  // as an open tuning value (sellBackPercent, defaults 50).
  const payout = sellPayout(item, quantity, config);

  if (getShopGold(shopActor) < payout) {
    return { ok: false, message: "This shop can't afford to buy that right now." };
  }

  await setShopGold(shopActor, getShopGold(shopActor) - payout);
  await setBuyerGp(sellerActor, buyerGp(sellerActor) + payout);

  const data = item.toObject();
  data.system.quantity = quantity;
  data.flags = data.flags ?? {};
  data.flags[MODULE_ID] = { origin: ORIGIN.SOLD };
  await shopActor.createEmbeddedDocuments("Item", [data]);

  if (available - quantity <= 0) {
    await item.delete();
  } else {
    await item.update({ "system.quantity": available - quantity });
  }

  return { ok: true, message: `${sellerActor.name} sold ${quantity}x ${item.name} for ${payout} gp.` };
}
