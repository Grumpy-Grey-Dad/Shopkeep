import { getShopConfig, banActor, setStanding } from "./shop-data.js";

/** Mode 1 (default): no guard, no muscle — the merchant just won't deal
 *  with this player again. A ban is all this needs; nothing interactive. */
export async function applyMerchantReacts(shopActor, actorActor) {
  await banActor(shopActor, actorActor.id);
  await ChatMessage.create({
    speaker: { alias: shopActor.name },
    content: `<strong>${shopActor.name}</strong> refuses to deal with <strong>${actorActor.name}</strong> ever again.`
  });
}

/** Mode 3: a state change, not an automatic fight — the merchant isn't
 *  necessarily combat-capable. Disposition flips on every scene the
 *  merchant's token appears in (usually one), standing craters to a hard
 *  floor (not stacked on top of the ordinary failed-theft penalty), and
 *  the shop bans the player the same as "merchant reacts." */
export async function applyMerchantHostile(shopActor, actorActor, config) {
  await banActor(shopActor, actorActor.id);
  await setStanding(shopActor, actorActor.id, config.hostileStandingFloor);

  for (const scene of game.scenes) {
    const tokens = scene.tokens.filter((t) => t.actorId === shopActor.id);
    if (tokens.length) {
      await scene.updateEmbeddedDocuments(
        "Token",
        tokens.map((t) => ({ _id: t.id, disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE }))
      );
    }
  }

  await ChatMessage.create({
    speaker: { alias: shopActor.name },
    content: `<strong>${shopActor.name}</strong> turns hostile toward <strong>${actorActor.name}</strong>!`
  });
}

/**
 * Applied automatically the instant a theft fails, for the two
 * consequence modes that are pure state changes needing no live GM
 * input. "guard" mode is deliberately excluded here — placing a token
 * is an interactive action that has to happen on the GM's own client
 * when they're ready, not synchronously inside whoever's theft roll
 * failed (which might be a player's client). See spawnGuard() below,
 * triggered separately from the Flagged Events panel.
 */
export async function applyImmediateConsequence(shopActor, actorActor) {
  const config = getShopConfig(shopActor);
  if (config.theftConsequenceMode === "hostile") return applyMerchantHostile(shopActor, actorActor, config);
  if (config.theftConsequenceMode === "merchant") return applyMerchantReacts(shopActor, actorActor);
  // "guard" mode: nothing automatic here — see spawnGuard().
}

/**
 * Mode 2, GM-triggered from the Flagged Events panel whenever they're
 * ready. Uses Foundry's own built-in interactive token placement
 * (canvas.tokens.placeTokens) rather than a pre-configured spawn point —
 * that's a live "GM places it" moment that survives scene changes better
 * than baked-in coordinates would. Automation stops at "combat has
 * started and the guard is in position," per the spec's own principle —
 * running the actual fight stays with the GM.
 */
export async function spawnGuard(shopActor, actorActor) {
  const config = getShopConfig(shopActor);
  if (!config.guardActorId) {
    return { ok: false, message: "No guard actor configured for this shop — set one in Configuration." };
  }
  const guardActor = game.actors.get(config.guardActorId);
  if (!guardActor) {
    return { ok: false, message: "Configured guard actor could not be found." };
  }
  if (!canvas.ready || !canvas.scene) {
    return { ok: false, message: "No active scene to spawn the guard into." };
  }

  ui.notifications.info(`Click to place ${guardActor.name} on the canvas.`);
  const guardTokenDoc = await guardActor.getTokenDocument({}, { parent: canvas.scene });
  const [placedGuard] = await canvas.tokens.placeTokens([guardTokenDoc.toObject()]);
  if (!placedGuard) {
    return { ok: false, message: "Guard placement cancelled." };
  }

  const playerToken = canvas.scene.tokens.find((t) => t.actorId === actorActor.id);

  let combat = game.combat;
  if (!combat) combat = await Combat.create({ scene: canvas.scene.id });
  const combatants = [{ tokenId: placedGuard.id, actorId: guardActor.id }];
  if (playerToken) combatants.push({ tokenId: playerToken.id, actorId: actorActor.id });
  await combat.createEmbeddedDocuments("Combatant", combatants);
  await combat.rollAll();
  await combat.activate();

  await ChatMessage.create({
    speaker: { alias: shopActor.name },
    content:
      `<strong>${guardActor.name}</strong> has been called on <strong>${actorActor.name}</strong> — ` +
      `combat started, initiative rolled. The GM runs the fight from here.` +
      (playerToken ? "" : ` (No token for ${actorActor.name} was found in this scene to add to combat.)`)
  });

  return { ok: true, message: `${guardActor.name} placed and combat started.` };
}
