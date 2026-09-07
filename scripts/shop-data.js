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
