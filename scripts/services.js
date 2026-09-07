import { MODULE_ID } from "./constants.js";
import {
  getShopConfig,
  getShopGold,
  setShopGold,
  getPendingRequests,
  setPendingRequests,
  getPendingOrders,
  setPendingOrders
} from "./shop-data.js";
import { buyerGp, setBuyerGp } from "./transactions.js";

function findService(config, serviceId) {
  return config.services.find((s) => s.id === serviceId);
}

function needsGmAttention(service) {
  if (service.alwaysFlag) return true;
  if (service.resolutionType === "rolltable" && (service.rollTableIds?.length ?? 0) > 1) return true;
  return false;
}

async function notifyGMs(content) {
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  return ChatMessage.create({ content, whisper: gmIds });
}

async function notifyActorOwner(actor, content) {
  const owners = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER")).map((u) => u.id);
  if (!owners.length) return null;
  return ChatMessage.create({ content, whisper: owners });
}

/** Executes a service that's already cleared any GM-approval requirement. */
async function resolveService(shopActor, actorActor, service) {
  if (service.resolutionType === "rolltable") {
    const tableId = service.rollTableIds?.[0];
    const table = tableId ? game.tables.get(tableId) : null;
    if (!table) {
      return { ok: false, message: `${service.name} has no valid Roll Table configured.` };
    }
    if (buyerGp(actorActor) < (service.cost ?? 0)) {
      return { ok: false, message: `${actorActor.name} can't afford ${service.name} (needs ${service.cost} gp).` };
    }
    if (service.cost) {
      await setBuyerGp(actorActor, buyerGp(actorActor) - service.cost);
      await setShopGold(shopActor, getShopGold(shopActor) + service.cost);
    }
    await table.draw({ displayChat: true });
    return { ok: true, message: `${actorActor.name} used ${service.name}.` };
  }

  if (buyerGp(actorActor) < (service.cost ?? 0)) {
    return { ok: false, message: `${actorActor.name} can't afford ${service.name} (needs ${service.cost} gp).` };
  }
  if (service.cost) {
    await setBuyerGp(actorActor, buyerGp(actorActor) - service.cost);
    await setShopGold(shopActor, getShopGold(shopActor) + service.cost);
  }

  if (service.resolutionType === "instant") {
    await ChatMessage.create({
      speaker: { alias: shopActor.name },
      content: `<strong>${actorActor.name}</strong> used <strong>${service.name}</strong>.`
    });
    return { ok: true, message: `${service.name} complete.` };
  }

  if (service.resolutionType === "roll") {
    const roll = await new Roll("1d20").evaluate();
    const dc = service.dc ?? 10;
    const success = roll.total >= dc;
    await roll.toMessage({
      speaker: { alias: shopActor.name },
      flavor: `${actorActor.name} attempts ${service.name} (DC ${dc}) — ${success ? "Success" : "Failure"}`
    });
    return { ok: true, message: `${service.name}: ${success ? "success" : "failure"} (rolled ${roll.total} vs DC ${dc}).` };
  }

  if (service.resolutionType === "time-delay") {
    const orders = getPendingOrders(shopActor);
    orders.push({
      id: foundry.utils.randomID(),
      serviceId: service.id,
      serviceName: service.name,
      actorId: actorActor.id,
      actorName: actorActor.name,
      leadTimeDays: service.leadTimeDays ?? 1,
      orderedAt: Date.now()
    });
    await setPendingOrders(shopActor, orders);
    await ChatMessage.create({
      speaker: { alias: shopActor.name },
      content: `<strong>${actorActor.name}</strong> ordered <strong>${service.name}</strong> (ready in ${service.leadTimeDays ?? 1} day(s), GM marks it fulfilled when ready).`
    });
    return { ok: true, message: `${service.name} ordered — ready in ${service.leadTimeDays ?? 1} day(s).` };
  }

  return { ok: false, message: `Unknown resolution type for ${service.name}.` };
}

/** Entry point for a player/GM clicking "Use" on a service. */
export async function useService(shopActor, actorActor, serviceId) {
  const config = getShopConfig(shopActor);
  const service = findService(config, serviceId);
  if (!service || !service.enabled) return { ok: false, message: "That service isn't available." };
  if (!actorActor) return { ok: false, message: "No acting character." };

  if (needsGmAttention(service)) {
    const requests = getPendingRequests(shopActor);
    requests.push({
      id: foundry.utils.randomID(),
      serviceId: service.id,
      serviceName: service.name,
      actorId: actorActor.id,
      actorName: actorActor.name,
      cost: service.cost ?? 0,
      requestedAt: Date.now()
    });
    await setPendingRequests(shopActor, requests);
    await notifyGMs(
      `<strong>${actorActor.name}</strong> is requesting <strong>${service.name}</strong> at ` +
        `<strong>${shopActor.name}</strong> — review it in the Shop window.`
    );
    return { ok: true, message: `Request sent — ${service.name} needs GM approval.` };
  }

  return resolveService(shopActor, actorActor, service);
}

export async function approveRequest(shopActor, requestId, chosenTableId = null) {
  const requests = getPendingRequests(shopActor);
  const request = requests.find((r) => r.id === requestId);
  if (!request) return { ok: false, message: "Request no longer exists." };

  const actorActor = game.actors.get(request.actorId);
  if (!actorActor) {
    await setPendingRequests(shopActor, requests.filter((r) => r.id !== requestId));
    return { ok: false, message: "The requesting character no longer exists." };
  }

  const config = getShopConfig(shopActor);
  let service = findService(config, request.serviceId);
  // Fall back to the request's own snapshot if the service was edited/removed since.
  if (!service) {
    service = { id: request.serviceId, name: request.serviceName, cost: request.cost, resolutionType: "instant" };
  }
  if (chosenTableId) {
    service = { ...service, rollTableIds: [chosenTableId] };
  }

  const result = await resolveService(shopActor, actorActor, service);
  // Only clear the request once it actually goes through — e.g. the
  // requester might no longer be able to afford it by approval time, and
  // silently dropping the request then would lose it with no way to
  // retry once they can.
  if (result.ok) {
    await setPendingRequests(shopActor, requests.filter((r) => r.id !== requestId));
  }
  return result;
}

export async function denyRequest(shopActor, requestId) {
  const requests = getPendingRequests(shopActor);
  const request = requests.find((r) => r.id === requestId);
  if (!request) return { ok: false, message: "Request no longer exists." };

  const actorActor = game.actors.get(request.actorId);
  if (actorActor) {
    await notifyActorOwner(
      actorActor,
      `Your request for <strong>${request.serviceName}</strong> at <strong>${shopActor.name}</strong> was denied.`
    );
  }
  await setPendingRequests(shopActor, requests.filter((r) => r.id !== requestId));
  return { ok: true, message: `Denied ${request.serviceName} for ${request.actorName}.` };
}

export async function fulfillOrder(shopActor, orderId) {
  const orders = getPendingOrders(shopActor);
  const order = orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, message: "Order no longer exists." };

  const actorActor = game.actors.get(order.actorId);
  await ChatMessage.create({
    speaker: { alias: shopActor.name },
    content: `<strong>${order.serviceName}</strong> for <strong>${order.actorName}</strong> is ready.`
  });
  if (actorActor) {
    await notifyActorOwner(
      actorActor,
      `Your order — <strong>${order.serviceName}</strong> at <strong>${shopActor.name}</strong> — is ready.`
    );
  }
  await setPendingOrders(shopActor, orders.filter((o) => o.id !== orderId));
  return { ok: true, message: `Marked ${order.serviceName} fulfilled.` };
}
