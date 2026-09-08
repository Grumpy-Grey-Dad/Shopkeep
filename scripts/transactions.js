import { MODULE_ID, ORIGIN } from "./constants.js";
import { getShopConfig } from "./shop-data.js";
import { itemCostCopper } from "./restock.js";
import { canAfford, payCost, receivePayment, copperToDisplay } from "./currency.js";

/** What the shop actually pays for a player-sold item, in whole copper —
 *  shared by the display and the real transaction so they can't drift. */
export function sellPayoutCopper(item, quantity, config) {
  const percent = config.sellBackPercent ?? 50;
  return Math.round((itemCostCopper(item) * quantity * percent) / 100);
}

export async function buyItem(shopActor, buyerActor, itemId, quantity = 1) {
  const item = shopActor.items.get(itemId);
  if (!item) return { ok: false, message: "Item no longer in stock." };

  const available = item.system.quantity ?? 0;
  if (quantity > available) return { ok: false, message: `Only ${available} in stock.` };

  const cost = itemCostCopper(item) * quantity;
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

  return { ok: true, message: `${buyerActor.name} bought ${quantity}x ${item.name} for ${copperToDisplay(cost)}.` };
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
  const payout = sellPayoutCopper(item, quantity, config);

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

  return {
    ok: true,
    message: `${sellerActor.name} sold ${quantity}x ${item.name} for ${copperToDisplay(payout)}.`
  };
}
