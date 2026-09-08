export const MODULE_ID = "valoria-shops";

export const ORIGIN = {
  COMPENDIUM: "compendium",
  SOLD: "sold",
  MANUAL: "manual"
};

export const DEFAULT_SHOP_CONFIG = {
  enabled: false,
  compendiums: [],
  filters: {
    types: [],
    rarities: [],
    includeKeywords: "",
    excludeKeywords: ""
  },
  startingGold: 0,
  currentGold: 0,
  buyList: [],
  targetStockCount: 10,
  maxQuantityPerItem: 3,
  sellBackPercent: 50,
  shopType: "",
  typeLock: false,
  services: [],
  // Standing point values are an explicitly open tuning value per the
  // spec — this is a starting default, not a fixed rule. Only the
  // purchase increment is wired up in Phase 3; haggle/theft increments
  // get their own config fields when those phases are built.
  standingPerPurchase: 1
};

export const RESOLUTION_TYPES = ["instant", "roll", "time-delay", "rolltable"];
export const CURRENCY_DENOMINATIONS = ["pp", "gp", "ep", "sp", "cp"];

export const SHOP_TYPES = [
  "General Store / Inn",
  "Temple / Shrine",
  "Blacksmith / Armorer",
  "Alchemist / Apothecary",
  "Arcane Shop / Wizard's Tower",
  "Stable / Caravan Post",
  "Information Broker / Guild"
];

const cost = (value, denomination) => ({ value, denomination });

/**
 * Starter service lists per shop type, from the design spec. "Load
 * Suggested Services" adds these (skipping any name already present on
 * the shop) rather than replacing whatever the GM has already set up.
 *
 * Costs marked "PHB" below are pulled directly from the 2024 PHB's own
 * Food/Drink/Lodging, Hirelings, and Spellcasting Services tables (via
 * the actual compendium content, not memory) — Identify/Cure Wounds/
 * Remove Curse/Bless/Raise Dead are priced as the Spellcasting Services
 * rate for that spell's level, since that's literally what they are.
 * Everything else has no real book price for a *service* version of it
 * (item prices exist, service prices generally don't) and is a flagged
 * placeholder — tune per shop.
 */
export const SUGGESTED_SERVICES = {
  "General Store / Inn": [
    // PHB Food, Drink, and Lodging — Inn Stay per day, by lifestyle tier.
    { name: "Room (Squalid)", resolutionType: "instant", cost: cost(7, "cp") },
    { name: "Room (Poor)", resolutionType: "instant", cost: cost(1, "sp") },
    { name: "Room (Modest)", resolutionType: "instant", cost: cost(5, "sp") },
    { name: "Room (Comfortable)", resolutionType: "instant", cost: cost(8, "sp") },
    { name: "Room (Wealthy)", resolutionType: "instant", cost: cost(2, "gp") },
    { name: "Room (Aristocratic)", resolutionType: "instant", cost: cost(4, "gp") },
    // PHB Food, Drink, and Lodging — Meal, by lifestyle tier.
    { name: "Meal (Squalid)", resolutionType: "instant", cost: cost(1, "cp") },
    { name: "Meal (Poor)", resolutionType: "instant", cost: cost(2, "cp") },
    { name: "Meal (Modest)", resolutionType: "instant", cost: cost(1, "sp") },
    { name: "Meal (Comfortable)", resolutionType: "instant", cost: cost(2, "sp") },
    { name: "Meal (Wealthy)", resolutionType: "instant", cost: cost(3, "sp") },
    { name: "Meal (Aristocratic)", resolutionType: "instant", cost: cost(6, "sp") },
    // Placeholder — not in the PHB tables at all, tune per shop.
    { name: "Stabling for Mounts", resolutionType: "instant", cost: cost(1, "gp") },
    // PHB Hirelings — Messenger is 2cp/mile; this assumes a short local
    // errand (~25 miles) since the module has no distance input. Adjust
    // per actual route, or the GM can just multiply 2cp by the real
    // distance when configuring this for a specific delivery.
    { name: "Message/Parcel Delivery", resolutionType: "time-delay", cost: cost(5, "sp"), leadTimeDays: 3 }
  ],
  "Temple / Shrine": [
    // PHB Spellcasting Services rate for the spell actually being cast.
    { name: "Identify", resolutionType: "instant", cost: cost(50, "gp") }, // 1st-level spell
    { name: "Healing (Cure Wounds)", resolutionType: "instant", cost: cost(50, "gp") }, // 1st-level
    { name: "Remove Disease/Poison (Lesser Restoration)", resolutionType: "instant", cost: cost(200, "gp") }, // 2nd-level
    { name: "Restoration (Remove Curse)", resolutionType: "instant", cost: cost(300, "gp") }, // 3rd-level
    { name: "Blessing (Bless)", resolutionType: "instant", cost: cost(50, "gp") }, // 1st-level
    { name: "Raise Dead / Resurrection", resolutionType: "instant", cost: cost(2000, "gp"), alwaysFlag: true } // 5th-level
  ],
  "Blacksmith / Armorer": [
    // Placeholders — DMG crafting/repair rules key these off item value
    // and time, not a flat book price. Tune per shop.
    { name: "Repair Weapon/Armor", resolutionType: "instant", cost: cost(5, "gp") },
    { name: "Sharpen/Maintain", resolutionType: "instant", cost: cost(5, "gp") },
    { name: "Custom Fitting", resolutionType: "time-delay", cost: cost(15, "gp"), leadTimeDays: 1 },
    { name: "Rush Order", resolutionType: "time-delay", cost: cost(50, "gp"), leadTimeDays: 1 }
  ],
  "Alchemist / Apothecary": [
    // Placeholders — no book price for these as services specifically.
    { name: "Brew-to-Order Potion", resolutionType: "time-delay", cost: cost(50, "gp"), leadTimeDays: 2 },
    { name: "Antidote/Poison Cure", resolutionType: "instant", cost: cost(25, "gp") },
    { name: "Identify Unknown Substance", resolutionType: "roll", cost: cost(10, "gp"), dc: 15 }
  ],
  "Arcane Shop / Wizard's Tower": [
    { name: "Identify Magic Item", resolutionType: "instant", cost: cost(50, "gp") }, // PHB: Identify, 1st-level
    // Placeholder — scroll price is a Magic Item price-by-rarity question, not Spellcasting Services.
    { name: "Scribe a Scroll", resolutionType: "time-delay", cost: cost(50, "gp"), leadTimeDays: 3 },
    { name: "Attune-Assist / Appraisal", resolutionType: "instant", cost: cost(15, "gp") },
    // PHB Spellcasting Services: Teleportation Circle is a 5th-level spell.
    { name: "Teleportation Circle Usage", resolutionType: "instant", cost: cost(2000, "gp"), alwaysFlag: true }
  ],
  "Stable / Caravan Post": [
    // Placeholders — mount/wagon rental+repair have no flat book rate.
    { name: "Mount Rental", resolutionType: "instant", cost: cost(5, "gp") },
    { name: "Wagon Repair", resolutionType: "instant", cost: cost(10, "gp") },
    // PHB Hirelings: Skilled hireling, 2gp/day.
    { name: "Guide/Escort Hire", resolutionType: "time-delay", cost: cost(2, "gp"), leadTimeDays: 1 }
  ],
  "Information Broker / Guild": [
    // No book price — a paid tip is inherently a GM-set flavor cost.
    { name: "Rumor/Gossip", resolutionType: "rolltable", cost: cost(5, "gp"), rollTableIds: [] },
    { name: "Bounty Board Access", resolutionType: "rolltable", cost: cost(0, "gp"), rollTableIds: [] },
    { name: "Forgery/Documentation", resolutionType: "time-delay", cost: cost(100, "gp"), leadTimeDays: 2, alwaysFlag: true }
  ]
};
