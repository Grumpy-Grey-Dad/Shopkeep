import { getShopConfig, getPendingRequests, setPendingRequests } from "./shop-data.js";
import { resolveServiceRequest } from "./services.js";
import { resolveHaggleRequest } from "./haggle.js";
import { notifyActorOwner } from "./notify.js";

function requestLabel(request) {
  return request.kind === "haggle" ? `haggling over ${request.itemName}` : request.serviceName;
}

/**
 * Single approval queue shared by both always-flagged services and
 * flagged haggle attempts — one place for the GM to review, rather than
 * two separate panels for what's mechanically the same "needs a human
 * decision" moment. Dispatches on request.kind.
 */
export async function approveRequest(shopActor, requestId, extra = {}) {
  const requests = getPendingRequests(shopActor);
  const request = requests.find((r) => r.id === requestId);
  if (!request) return { ok: false, message: "Request no longer exists." };

  const actorActor = game.actors.get(request.actorId);
  if (!actorActor) {
    await setPendingRequests(shopActor, requests.filter((r) => r.id !== requestId));
    return { ok: false, message: "The requesting character no longer exists." };
  }

  const config = getShopConfig(shopActor);
  const result =
    request.kind === "haggle"
      ? await resolveHaggleRequest(shopActor, actorActor, request, config)
      : await resolveServiceRequest(shopActor, actorActor, request, config, extra.chosenTableId);

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
  const label = requestLabel(request);
  if (actorActor) {
    await notifyActorOwner(
      actorActor,
      `Your request for <strong>${label}</strong> at <strong>${shopActor.name}</strong> was denied.`
    );
  }
  await setPendingRequests(shopActor, requests.filter((r) => r.id !== requestId));
  return { ok: true, message: `Denied ${label} for ${request.actorName}.` };
}
