import { MODULE_ID } from "./constants.js";
import { getFlaggedEvents, setFlaggedEvents } from "./shop-data.js";
import { notifyGMs } from "./notify.js";

/**
 * Optional integration with the free Patrol module
 * (github.com/theripper93/Patrol). Never a hard dependency — every
 * function here is a no-op if Patrol isn't installed/active, and the
 * shop's own flagged-event system (built in Phase 5) works identically
 * either way. This only ever adds specificity on top of that.
 */
const STATUS_ID = "valoria-suspected";

function patrolActive() {
  return !!game.modules.get("patrol")?.active;
}

/** Registers the custom "Suspected" status and the two Patrol hooks that upgrade a flagged event into a confirmed sighting. Call once at init. */
export function registerPatrolIntegration() {
  CONFIG.statusEffects.push({
    id: STATUS_ID,
    name: "Suspected (Valoria Shops)",
    img: "icons/svg/eye.svg"
  });

  Hooks.on("patrolAlerted", onPatrolNoticed);
  Hooks.on("patrolSpotted", onPatrolNoticed);
}

/**
 * Patrol's own hooks pass (patrolTokenPlaceable, enemyTokenPlaceable) —
 * confirmed directly against the actual installed module's source, not
 * assumed. Only ever fires against player-owned tokens on Patrol's own
 * side, so enemyToken here is always a PC in practice.
 */
async function onPatrolNoticed(patrolToken, enemyToken) {
  const enemyActor = enemyToken?.actor;
  if (!enemyActor) return;

  const suspectedUntil = enemyActor.getFlag(MODULE_ID, "suspectedUntil");
  if (!suspectedUntil || Date.now() > suspectedUntil) return; // not currently suspected of anything here

  const shopId = enemyActor.getFlag(MODULE_ID, "suspectedShopId");
  const eventId = enemyActor.getFlag(MODULE_ID, "suspectedEventId");
  const shop = shopId ? game.actors.get(shopId) : null;
  if (!shop) return;

  const events = getFlaggedEvents(shop);
  const event = events.find((e) => e.id === eventId);
  // Event may already be acknowledged/gone, or already confirmed by an
  // earlier hook firing (patrolAlerted then patrolSpotted for the same
  // incident) — either way, nothing left to upgrade.
  if (!event || event.patrolConfirmed) return;

  event.patrolConfirmed = true;
  event.patrolGuardName = patrolToken.name;
  await setFlaggedEvents(shop, events);

  await notifyGMs(
    `<strong>${patrolToken.name}</strong> actually has eyes on <strong>${enemyActor.name}</strong> right now — ` +
      `this is a confirmed sighting, not just a rumor (see Flagged Events at <strong>${shop.name}</strong>).`
  );

  // One escalation per incident is enough — clear the suspicion so a
  // second patrol hook (or the same guard on its next tick) doesn't
  // re-fire the notification for something already flagged.
  await enemyActor.unsetFlag(MODULE_ID, "suspectedUntil");
  await enemyActor.toggleStatusEffect(STATUS_ID, { active: false });
}

/** Called on a failed theft to mark the thief "suspected" for a short window, tied to the specific flagged event Patrol might later confirm. */
export async function markSuspected(shopActor, actorActor, eventId, windowSeconds) {
  if (!patrolActive()) return;
  await actorActor.setFlag(MODULE_ID, "suspectedUntil", Date.now() + windowSeconds * 1000);
  await actorActor.setFlag(MODULE_ID, "suspectedShopId", shopActor.id);
  await actorActor.setFlag(MODULE_ID, "suspectedEventId", eventId);
  await actorActor.toggleStatusEffect(STATUS_ID, { active: true });
}
