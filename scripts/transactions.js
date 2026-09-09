import { MODULE_ID, ORIGIN } from "./constants.js";
import { getShopConfig, adjustStanding, isBanned, recordTransaction } from "./shop-data.js";
import { itemCostCopper } from "./restock.js";
import { canAfford, payCost, receivePayment, copperToDisplay } from "./currency.js";

/** What the shop actually pays for a player-sold item, in whole copper —
 *  shared by the display and the real transaction so they can't drift. */
export function sellPayoutCopper(item, quantity, config) {
  const percent = config.sellBackPercent ?? 50;
  return Math.round((itemCostCopper(item) * quantity * percent) / 100);
}

export async function buyItem(shopActor, buyerActor, itemId, quantity = 1, discountPercent = 0, awardPurchaseStanding = true) {
  if (isBanned(shopActor, buyerActor.id)) {
    return { ok: false, message: `${shopActor.name} refuses to deal with ${buyerActor.name}.` };
  }
  const item = shopActor.items.get(itemId);
  if (!item) return { ok: false, message: "Item no longer in stock." };

  const available = item.system.quantity ?? 0;
  if (quantity > available) return { ok: false, message: `Only ${available} in stock.` };

  const cost = Math.round((itemCostCopper(item) * quantity * (100 - discountPercent)) / 100);
  if (!canAfford(buyerActor, cost)) {
    return { ok: false, message: `${buyerActor.name} can't afford this (needs ${copperToDisplay(cost)}).` };
  }

  await payCost(buyerActor, cost);
  await receivePayment(shopActor, cost);

  const data = item.toObject();
  data.system.quantity = quantity;
  delete data.flags?.[MODULE_ID];
  await buyerActor.createEmbeddedDocuments("Item", [data]);

  if (available - quantity <= 0) {
    await item.delete();
  } else {
    await item.update({ "system.quantity": available - quantity });
  }

  // Flat per-transaction bump, not scaled by quantity — this rewards
  // being a repeat customer (the spec's own framing), not bulk-buying.
  // Suppressed for a haggle-driven purchase (awardPurchaseStanding=false)
  // — haggling already applies its own success/repeat standing deltas,
  // and a purchase that only happened because of a successful haggle
  // shouldn't also collect the ordinary customer bonus on top of that.
  if (awardPurchaseStanding) {
    const config = getShopConfig(shopActor);
    await adjustStanding(shopActor, buyerActor.id, config.standingPerPurchase);
  }

  const message = `${buyerActor.name} bought ${quantity}x ${item.name} for ${copperToDisplay(cost)}.`;
  await recordTransaction(shopActor, { kind: "Buy", actorId: buyerActor.id, actorName: buyerActor.name, message });
  return { ok: true, message };
}

export async function sellItem(shopActor, sellerActor, itemId, quantity = 1, premiumPercent = 0) {
  if (isBanned(shopActor, sellerActor.id)) {
    return { ok: false, message: `${shopActor.name} refuses to deal with ${sellerActor.name}.` };
  }
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
  // as an open tuning value (sellBackPercent, defaults 50). A successful
  // sell-haggle adds premiumPercent on top of that base payout.
  const payout = Math.round((sellPayoutCopper(item, quantity, config) * (100 + premiumPercent)) / 100);

  if (!canAfford(shopActor, payout)) {
    return { ok: false, message: "This shop can't afford to buy that right now." };
  }

  await payCost(shopActor, payout);
  await receivePayment(sellerActor, payout);

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

  const message = `${sellerActor.name} sold ${quantity}x ${item.name} for ${copperToDisplay(payout)}.`;
  await recordTransaction(shopActor, { kind: "Sell", actorId: sellerActor.id, actorName: sellerActor.name, message });
  return { ok: true, message };
}
