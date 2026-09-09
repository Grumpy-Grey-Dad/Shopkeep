import { MODULE_ID } from "./constants.js";
import { getShopConfig, adjustStanding, getFlaggedEvents, setFlaggedEvents, recordTransaction } from "./shop-data.js";
import { notifyGMs } from "./notify.js";
import { applyImmediateConsequence } from "./consequence.js";
import { markSuspected } from "./patrol-integration.js";

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function transferStolenItem(shopActor, actorActor, item) {
  const data = item.toObject();
  data.system.quantity = 1;
  delete data.flags?.[MODULE_ID];
  await actorActor.createEmbeddedDocuments("Item", [data]);

  const available = item.system.quantity ?? 1;
  if (available - 1 <= 0) {
    await item.delete();
  } else {
    await item.update({ "system.quantity": available - 1 });
  }
}

/**
 * Entry point for a player/GM clicking "Steal" on a specific stock item —
 * that click IS the spec's required "declare the target before rolling"
 * step, so no separate dialog is needed on top of it.
 */
export async function attemptTheft(shopActor, actorActor, itemId) {
  if (!actorActor) return { ok: false, message: "No acting character." };
  const targetItem = shopActor.items.get(itemId);
  if (!targetItem) return { ok: false, message: "Item no longer in stock." };

  const config = getShopConfig(shopActor);
  const rolls = await actorActor.rollSkill({ skill: config.theftSkill }, { configure: false }, { create: false });
  const roll = rolls[0];
  const dc = config.theftDC;
  const skillLabel = CONFIG.DND5E.skills[config.theftSkill]?.label ?? config.theftSkill;

  if (roll.total < dc) {
    // Only a *failed* attempt touches standing or gets flagged — a
    // successful theft (partial or clean) was never noticed by the
    // merchant, so there's nothing for them to react to.
    await adjustStanding(shopActor, actorActor.id, config.standingPerFailedTheft);

    const events = getFlaggedEvents(shopActor);
    const eventId = foundry.utils.randomID();
    events.push({
      id: eventId,
      actorId: actorActor.id,
      actorName: actorActor.name,
      itemName: targetItem.name,
      rollTotal: roll.total,
      dc,
      createdAt: Date.now()
    });
    await setFlaggedEvents(shopActor, events);

    // Optional Patrol integration — a no-op if Patrol isn't installed.
    // Marks the thief as "suspected" so a nearby patrol route that later
    // spots them can escalate this specific flagged event into a
    // confirmed sighting instead of a rumor the GM has to take on faith.
    await markSuspected(shopActor, actorActor, eventId, config.suspectedWindowSeconds);

    await roll.toMessage({
      speaker: { alias: shopActor.name },
      flavor: `${actorActor.name} attempts to steal ${targetItem.name} (${skillLabel}, DC ${dc}) — Caught!`
    });
    await notifyGMs(
      `<strong>${actorActor.name}</strong> was caught stealing <strong>${targetItem.name}</strong> from ` +
        `<strong>${shopActor.name}</strong> — narrate the consequence (see Flagged Events in the Shop window).`
    );

    // "merchant"/"hostile" modes are pure state changes and apply right
    // now; "guard" mode needs the GM to interactively place a token and
    // is triggered separately from the Flagged Events panel instead.
    await applyImmediateConsequence(shopActor, actorActor);

    const message = `Theft failed (rolled ${roll.total} vs DC ${dc}) — caught!`;
    await recordTransaction(shopActor, { kind: "Theft", actorId: actorActor.id, actorName: actorActor.name, message: `${actorActor.name}: ${message}` });
    return { ok: true, message };
  }

  const cleanSuccess = roll.total >= dc + 5;
  const stock = shopActor.items.contents;
  const grantedItem = cleanSuccess ? targetItem : (pickRandom(stock) ?? targetItem);

  await roll.toMessage({
    speaker: { alias: shopActor.name },
    flavor:
      `${actorActor.name} attempts to steal ${targetItem.name} (${skillLabel}, DC ${dc}) — ` +
      `${cleanSuccess ? "Clean success" : "Success (grabbed something else in the panic)"}`
  });

  await transferStolenItem(shopActor, actorActor, grantedItem);

  const message = cleanSuccess
    ? `Theft succeeded — got away with ${grantedItem.name}.`
    : `Theft succeeded, but grabbed ${grantedItem.name} instead of ${targetItem.name}.`;
  await recordTransaction(shopActor, { kind: "Theft", actorId: actorActor.id, actorName: actorActor.name, message: `${actorActor.name}: ${message}` });
  return { ok: true, message };
}

export async function acknowledgeFlaggedEvent(shopActor, eventId) {
  const events = getFlaggedEvents(shopActor);
  await setFlaggedEvents(shopActor, events.filter((e) => e.id !== eventId));
  return { ok: true, message: "Acknowledged." };
}
