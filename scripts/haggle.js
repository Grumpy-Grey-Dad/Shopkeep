import { RARITY_RANK } from "./constants.js";
import { getShopConfig, getPendingRequests, setPendingRequests, adjustStanding, recordHaggleAttempt } from "./shop-data.js";
import { itemCostCopper } from "./restock.js";
import { toCopper } from "./currency.js";
import { buyItem, sellItem } from "./transactions.js";
import { notifyGMs } from "./notify.js";

/** Section 6's value-based flagging rule: above a GM-set gold threshold
 *  (measured against listed price) OR rare-or-better rarity. Rarity's
 *  threshold isn't configurable — the spec states it as a fixed rule,
 *  unlike the gold value. */
function isFlagged(item, config) {
  const valueCopper = itemCostCopper(item);
  const thresholdCopper = toCopper(config.flagGoldThreshold?.value ?? 0, config.flagGoldThreshold?.denomination ?? "gp");
  if (valueCopper >= thresholdCopper) return true;

  const rarity = item.system?.rarity || "";
  return RARITY_RANK.indexOf(rarity) >= RARITY_RANK.indexOf("rare");
}

function findItem(shopActor, actorActor, direction, itemId) {
  return direction === "buy" ? shopActor.items.get(itemId) : actorActor.items.get(itemId);
}

/** Rolls, applies standing, and — only on success — completes the
 *  purchase/sale at the haggled price. A failed attempt costs nothing
 *  but the standing consequence; the player can still use the normal
 *  Buy/Sell button afterward at the listed price. */
async function performHaggle(shopActor, actorActor, item, direction, config) {
  const wasFirstThisVisit = await recordHaggleAttempt(shopActor, actorActor.id);

  const rolls = await actorActor.rollSkill({ skill: config.haggleSkill }, { configure: false }, { create: false });
  const roll = rolls[0];
  const dc = config.haggleDC;
  const success = roll.total >= dc;

  // Both rules apply independently, per the spec's separate wording: a
  // successful haggle always earns the increase, and any non-first
  // attempt this visit always earns the repeat penalty — regardless of
  // whether that repeat attempt itself succeeds or fails.
  let standingDelta = 0;
  if (success) standingDelta += config.standingPerHaggleSuccess;
  if (!wasFirstThisVisit) standingDelta += config.standingPerHaggleRepeat;
  if (standingDelta) await adjustStanding(shopActor, actorActor.id, standingDelta);

  const skillLabel = CONFIG.DND5E.skills[config.haggleSkill]?.label ?? config.haggleSkill;
  await roll.toMessage({
    speaker: { alias: shopActor.name },
    flavor: `${actorActor.name} haggles over ${item.name} (${skillLabel}, DC ${dc}) — ${success ? "Success" : "Failure"}`
  });

  if (!success) {
    return { ok: true, message: `Haggle failed (rolled ${roll.total} vs DC ${dc}) — no discount.` };
  }

  // false = don't also award the ordinary per-purchase standing bump;
  // the haggle success/repeat deltas above already cover this transaction.
  const result =
    direction === "buy"
      ? await buyItem(shopActor, actorActor, item.id, 1, config.haggleDiscountPercent, false)
      : await sellItem(shopActor, actorActor, item.id, 1, config.haggleDiscountPercent);

  const verb = direction === "buy" ? "off" : "extra";
  return { ok: result.ok, message: `Haggle succeeded (${config.haggleDiscountPercent}% ${verb})! ${result.message}` };
}

/** Entry point for a player/GM clicking "Haggle" on a stock or sellable item. */
export async function attemptHaggle(shopActor, actorActor, itemId, direction) {
  if (!actorActor) return { ok: false, message: "No acting character." };
  const config = getShopConfig(shopActor);
  const item = findItem(shopActor, actorActor, direction, itemId);
  if (!item) return { ok: false, message: "Item not found." };

  if (isFlagged(item, config)) {
    const requests = getPendingRequests(shopActor);
    requests.push({
      id: foundry.utils.randomID(),
      kind: "haggle",
      direction,
      itemId: item.id,
      itemName: item.name,
      actorId: actorActor.id,
      actorName: actorActor.name,
      requestedAt: Date.now()
    });
    await setPendingRequests(shopActor, requests);
    await notifyGMs(
      `<strong>${actorActor.name}</strong> wants to haggle over <strong>${item.name}</strong> at ` +
        `<strong>${shopActor.name}</strong> — review it in the Shop window.`
    );
    return { ok: true, message: `Request sent — haggling over ${item.name} needs GM approval before it's attempted.` };
  }

  return performHaggle(shopActor, actorActor, item, direction, config);
}

/** Resolves a pending "haggle" request on GM approval — looked up by requests.js's generic dispatcher. */
export async function resolveHaggleRequest(shopActor, actorActor, request, config) {
  const item = findItem(shopActor, actorActor, request.direction, request.itemId);
  if (!item) return { ok: false, message: `${request.itemName} is no longer available.` };
  return performHaggle(shopActor, actorActor, item, request.direction, config);
}
