/**
 * All shop money math happens in whole copper pieces (the smallest real
 * unit dnd5e defines) so nothing needs rounding except at input/display
 * time. Deducting/awarding coins reuses dnd5e's own CurrencyManager
 * (dnd5e.applications.CurrencyManager) rather than reimplementing
 * "breaking a gold piece into change" — that logic already exists,
 * is tested, and matches how the character sheet's own currency
 * converter behaves.
 */

const DENOMINATIONS = ["pp", "gp", "ep", "sp", "cp"];

function conversion(denomination) {
  return CONFIG.DND5E.currencies[denomination]?.conversion ?? 1;
}

/** How many whole copper pieces one unit of this denomination is worth. */
function copperPerUnit(denomination) {
  return 100 / conversion(denomination);
}

/** Converts a {value, denomination} price/cost into an exact whole-copper integer. */
export function toCopper(value, denomination) {
  return Math.round((value ?? 0) * copperPerUnit(denomination || "gp"));
}

/** A compact display string for a whole-copper amount, e.g. "2 gp, 3 sp". Display only — never mutates anything. */
export function copperToDisplay(totalCopper) {
  let remaining = Math.round(totalCopper ?? 0);
  if (!remaining) return "0 gp";
  const parts = [];
  for (const denom of DENOMINATIONS) {
    const perUnit = copperPerUnit(denom);
    const count = Math.floor(remaining / perUnit + 1e-9);
    if (count > 0) {
      parts.push(`${count} ${denom}`);
      remaining = Math.round(remaining - count * perUnit);
    }
  }
  return parts.length ? parts.join(", ") : "0 gp";
}

/** Total value an actor is currently holding, in whole copper. */
export function actorTotalCopper(actor) {
  const currency = actor?.system?.currency ?? {};
  return DENOMINATIONS.reduce((sum, denom) => sum + toCopper(currency[denom] ?? 0, denom), 0);
}

export function canAfford(actor, totalCopper) {
  return actorTotalCopper(actor) >= (totalCopper ?? 0);
}

/** Deducts an exact copper value, breaking higher coins into change as needed. Assumes canAfford() was already checked. */
export async function payCost(actor, totalCopper) {
  if (!totalCopper) return;
  // getActorCurrencyUpdates returns {system: {currency: {...}}, remainder, item} —
  // the update payload actually needed is the whole {system: {...}} object,
  // not just its inner "currency" key. (Mirrors dnd5e's own
  // CurrencyManager.deductActorCurrency, which keeps `system` nested when
  // it destructures out `item`/`remainder`.)
  const { item: _item, remainder: _remainder, ...updates } = dnd5e.applications.CurrencyManager.getActorCurrencyUpdates(
    actor,
    totalCopper,
    "cp",
    { makeChange: true }
  );
  await actor.update(updates);
}

/** Adds an exact copper value, then consolidates into the highest denominations so the sheet doesn't fill up with raw copper. */
export async function receivePayment(actor, totalCopper) {
  if (!totalCopper) return;
  // awardCurrency and convertCurrency/getActorCurrencyUpdates are on two
  // different dnd5e classes, not one — confirmed against the actual
  // running system, not assumed.
  await dnd5e.applications.Award.awardCurrency({ cp: totalCopper }, [actor]);
  await dnd5e.applications.CurrencyManager.convertCurrency(actor);
}
