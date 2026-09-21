import { MODULE_ID } from "./constants.js";
import { buyItem, sellItem } from "./transactions.js";
import { useService } from "./services.js";
import { attemptHaggle } from "./haggle.js";
import { attemptTheft } from "./theft.js";
import { recordVisitSession, adjustStanding } from "./shop-data.js";

/**
 * A non-Owner player triggering Buy/Sell/Haggle/Theft/Service/visit-bump
 * needs the shop actor written to, which Foundry only allows at Owner
 * level. Rather than granting every player Owner on every merchant (which
 * also puts the merchant in their Actors sidebar and lets them drag its
 * token), the player's client asks the table's active GM to perform the
 * write on its behalf, over this socket channel. Mirrors the same pattern
 * Campaign Codex's own Trade-In Counter/Item Containers widgets use
 * (confirmed live via console, see project memory) — this isn't a
 * Campaign-Codex-specific trick, just the standard fix for the problem.
 */
const SOCKET_NAME = `module.${MODULE_ID}`;
const RESPONSE_TIMEOUT_MS = 15000;

const pendingRequests = new Map();

/** Handlers run ONLY on the elected active-GM client — payload is plain,
 *  JSON-safe data (IDs, not live documents), looked up fresh here so a
 *  stale client-side reference can't be smuggled across the socket. */
const ACTIONS = {
  async buy({ shopActorId, buyerActorId, itemId, quantity, discountPercent, awardPurchaseStanding }) {
    const shopActor = game.actors.get(shopActorId);
    const buyerActor = game.actors.get(buyerActorId);
    if (!shopActor || !buyerActor) return { ok: false, message: "Actor no longer exists." };
    return buyItem(shopActor, buyerActor, itemId, quantity, discountPercent, awardPurchaseStanding);
  },
  async sell({ shopActorId, sellerActorId, itemId, quantity, premiumPercent }) {
    const shopActor = game.actors.get(shopActorId);
    const sellerActor = game.actors.get(sellerActorId);
    if (!shopActor || !sellerActor) return { ok: false, message: "Actor no longer exists." };
    return sellItem(shopActor, sellerActor, itemId, quantity, premiumPercent);
  },
  async useService({ shopActorId, actorActorId, serviceId }) {
    const shopActor = game.actors.get(shopActorId);
    const actorActor = game.actors.get(actorActorId);
    if (!shopActor || !actorActor) return { ok: false, message: "Actor no longer exists." };
    return useService(shopActor, actorActor, serviceId);
  },
  async haggle({ shopActorId, actorActorId, itemId, direction }) {
    const shopActor = game.actors.get(shopActorId);
    const actorActor = game.actors.get(actorActorId);
    if (!shopActor || !actorActor) return { ok: false, message: "Actor no longer exists." };
    return attemptHaggle(shopActor, actorActor, itemId, direction);
  },
  async theft({ shopActorId, actorActorId, itemId }) {
    const shopActor = game.actors.get(shopActorId);
    const actorActor = game.actors.get(actorActorId);
    if (!shopActor || !actorActor) return { ok: false, message: "Actor no longer exists." };
    return attemptTheft(shopActor, actorActor, itemId);
  },
  async visit({ shopActorId, actorActorId, sessionId, standingPerVisit }) {
    const shopActor = game.actors.get(shopActorId);
    const actorActor = game.actors.get(actorActorId);
    if (!shopActor || !actorActor) return { ok: false, message: "Actor no longer exists.", isNewVisit: false };
    const isNewVisit = await recordVisitSession(shopActor, actorActor.id, sessionId);
    if (isNewVisit && standingPerVisit) {
      await adjustStanding(shopActor, actorActor.id, standingPerVisit);
    }
    return { ok: true, isNewVisit };
  }
};

function isActiveGmClient() {
  return game.user.isGM && game.users.activeGM?.id === game.user.id;
}

async function handleSocketMessage(data) {
  if (!data || typeof data !== "object") return;

  if (data.type === "request") {
    if (!isActiveGmClient()) return; // exactly one client (the elected active GM) acts
    const handler = ACTIONS[data.action];
    let result;
    try {
      result = handler
        ? await handler(data.payload ?? {})
        : { ok: false, message: `Unknown shop action: ${data.action}` };
    } catch (error) {
      console.error(`${MODULE_ID} | Error handling relayed action "${data.action}":`, error);
      result = { ok: false, message: "Something went wrong on the GM's end — check the console." };
    }
    game.socket.emit(SOCKET_NAME, { type: "response", requestId: data.requestId, result });
    return;
  }

  if (data.type === "response") {
    const pending = pendingRequests.get(data.requestId);
    if (!pending) return; // not ours — every client sees every broadcast
    clearTimeout(pending.timer);
    pendingRequests.delete(data.requestId);
    pending.resolve(data.result);
  }
}

export function initSocketRelay() {
  game.socket.on(SOCKET_NAME, handleSocketMessage);
}

/** Player-side call: asks the active GM's client to run `action` with
 *  `payload` and resolves with its {ok, message} result. */
export function requestShopAction(action, payload) {
  if (!game.users.activeGM) {
    return Promise.resolve({
      ok: false,
      message: "No GM is currently connected to run that — try again once your GM is online."
    });
  }
  const requestId = foundry.utils.randomID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ ok: false, message: "Your GM's client didn't respond in time — try again." });
    }, RESPONSE_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve, timer });
    game.socket.emit(SOCKET_NAME, { type: "request", action, requestId, payload });
  });
}

/**
 * Runs `directFn` locally when the current user already has a fast, legal
 * path to it (GM, or already holds Owner on the shop actor — e.g. during
 * the transition period before Owner grants are revoked), otherwise
 * relays `action`/`payload` to the GM. Keeps every existing call site a
 * one-line change instead of duplicating the isGM/isOwner check everywhere.
 */
export function runShopAction(shopActor, action, payload, directFn) {
  if (game.user.isGM || shopActor.isOwner) return directFn();
  return requestShopAction(action, payload);
}
