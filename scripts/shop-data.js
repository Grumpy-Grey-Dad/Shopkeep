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
  return actor.setFlag(MODULE_ID, "haggleAttempts", {});
}
