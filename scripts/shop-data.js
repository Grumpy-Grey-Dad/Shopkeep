import { MODULE_ID, DEFAULT_SHOP_CONFIG } from "./constants.js";

/**
 * Phase 1 simplification: shop gold is tracked purely in gp via the shop
 * actor's own system.currency.gp field (reuses the sheet's existing
 * currency display instead of a shadow number). Other denominations are
 * not modeled for shop transactions yet.
 */

export function isShop(actor) {
  return !!actor?.getFlag(MODULE_ID, "config")?.enabled;
}

export function getShopConfig(actor) {
  const stored = actor?.getFlag(MODULE_ID, "config") ?? {};
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_SHOP_CONFIG), stored, { inplace: false });
}

export async function setShopConfig(actor, patch) {
  const merged = foundry.utils.mergeObject(getShopConfig(actor), patch, { inplace: false });
  return actor.setFlag(MODULE_ID, "config", merged);
}

export async function enableShop(actor) {
  return setShopConfig(actor, { enabled: true });
}

export function getShopGold(actor) {
  return actor?.system?.currency?.gp ?? 0;
}

export async function setShopGold(actor, gp) {
  return actor.update({ "system.currency.gp": Math.max(0, Math.round(gp)) });
}

/**
 * Requests awaiting GM approval — either because the service is always
 * flagged, or because a rolltable service has more than one linked table
 * and the GM needs to pick which pool to draw from.
 */
export function getPendingRequests(actor) {
  return actor?.getFlag(MODULE_ID, "pendingRequests") ?? [];
}

export async function setPendingRequests(actor, requests) {
  return actor.setFlag(MODULE_ID, "pendingRequests", requests);
}

/** Time-delay orders awaiting manual GM fulfillment. */
export function getPendingOrders(actor) {
  return actor?.getFlag(MODULE_ID, "pendingOrders") ?? [];
}

export async function setPendingOrders(actor, orders) {
  return actor.setFlag(MODULE_ID, "pendingOrders", orders);
}

/**
 * Failed-theft notifications for the GM to review and narrate. Distinct
 * from pendingRequests on purpose: a pending request is "something is
 * waiting for a decision before it happens," but a theft attempt has
 * already resolved (roll and standing hit both already applied) by the
 * time this is created — the GM isn't approving anything, just being
 * told to go narrate the in-fiction consequence, which is why this gets
 * its own array with its own "Acknowledge" action instead of Approve/Deny.
 */
export function getFlaggedEvents(actor) {
  return actor?.getFlag(MODULE_ID, "flaggedEvents") ?? [];
}

export async function setFlaggedEvents(actor, events) {
  return actor.setFlag(MODULE_ID, "flaggedEvents", events);
}

/**
 * Players this merchant refuses to deal with — set by the "merchant
 * reacts" and "merchant turns hostile" theft consequences. Blocks
 * buy/sell/haggle only, per the spec's own wording; a banned player can
 * still attempt theft (being banned as a customer doesn't stop someone
 * trying a five-finger discount).
 */
export function getBannedActorIds(actor) {
  return actor?.getFlag(MODULE_ID, "bannedActorIds") ?? [];
}

export async function setBannedActorIds(actor, ids) {
  return actor.setFlag(MODULE_ID, "bannedActorIds", ids);
}

export function isBanned(actor, playerActorId) {
  return getBannedActorIds(actor).includes(playerActorId);
}

export async function banActor(actor, playerActorId) {
  const ids = getBannedActorIds(actor);
  if (!ids.includes(playerActorId)) await setBannedActorIds(actor, [...ids, playerActorId]);
}

export async function unbanActor(actor, playerActorId) {
  await setBannedActorIds(actor, getBannedActorIds(actor).filter((id) => id !== playerActorId));
}

/**
 * Per-NPC standing: {[playerActorId]: number}, stored on the merchant's
 * own Actor document. This already satisfies the spec's "keyed to the
 * merchant's base Actor ID, not the token" requirement by construction —
 * the module only ever reads/writes via the Actor (this.actor in
 * ShopApp), never a Token, so there's no separate token-vs-actor data to
 * drift apart in the first place.
 */
export function getAllStanding(actor) {
  return actor?.getFlag(MODULE_ID, "standing") ?? {};
}

export function getStanding(actor, playerActorId) {
  return getAllStanding(actor)[playerActorId] ?? 0;
}

export async function setStanding(actor, playerActorId, value) {
  return actor.setFlag(MODULE_ID, "standing", { ...getAllStanding(actor), [playerActorId]: value });
}

export async function adjustStanding(actor, playerActorId, delta) {
  if (!delta) return;
  return setStanding(actor, playerActorId, getStanding(actor, playerActorId) + delta);
}

export const STANDING_TIER_RANK = { "": 0, friendly: 1, cooperative: 2 };

/**
 * Passive demeanor tier for a given standing value — drives both the
 * merchant's displayed attitude and the automatic price break on ordinary
 * (non-haggled) buy/sell. Independent of the ban/hostile system: a banned
 * actor can still numerically sit in "Cooperative" range (e.g. after a GM
 * manually edits the number) without that lifting the ban — isBanned is
 * checked separately wherever it matters.
 */
export function getStandingTier(config, standing) {
  if (standing >= config.standingCooperativeThreshold) {
    return { key: "cooperative", label: "Cooperative", discountPercent: config.standingCooperativeDiscountPercent };
  }
  if (standing >= config.standingFriendlyThreshold) {
    return { key: "friendly", label: "Friendly", discountPercent: config.standingFriendlyDiscountPercent };
  }
  return { key: "", label: "Neutral", discountPercent: 0 };
}

/**
 * How many times each player has haggled at this shop since the GM last
 * reset it. There's no way for the module to know when a "visit" starts
 * or ends on its own (no calendar integration exists, per the spec's own
 * note on time-delay orders) — so this is a GM-triggered reset, same
 * philosophy as Restock, rather than something the module tries to guess
 * from window open/close.
 */
export function getHaggleAttempts(actor) {
  return actor?.getFlag(MODULE_ID, "haggleAttempts") ?? {};
}

export async function recordHaggleAttempt(actor, playerActorId) {
  const attempts = getHaggleAttempts(actor);
  const wasFirstThisVisit = !attempts[playerActorId];
  await actor.setFlag(MODULE_ID, "haggleAttempts", {
    ...attempts,
    [playerActorId]: (attempts[playerActorId] ?? 0) + 1
  });
  return wasFirstThisVisit;
}

export async function resetHaggleAttempts(actor) {
  // setFlag(..., {}) would NOT clear this — Foundry deep-merges plain
  // object flag values by default, so merging {} onto an existing map
  // changes nothing (unlike the pendingRequests/pendingOrders arrays
  // elsewhere in this file, which Foundry always replaces wholesale).
  // unsetFlag actually removes the stored value entirely.
  return actor.unsetFlag(MODULE_ID, "haggleAttempts");
}
