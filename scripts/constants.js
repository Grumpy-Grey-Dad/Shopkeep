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
  services: []
};

export const RESOLUTION_TYPES = ["instant", "roll", "time-delay", "rolltable"];

export const SHOP_TYPES = [
  "General Store / Inn",
  "Temple / Shrine",
  "Blacksmith / Armorer",
  "Alchemist / Apothecary",
  "Arcane Shop / Wizard's Tower",
  "Stable / Caravan Post",
  "Information Broker / Guild"
];

/**
 * Starter service lists per shop type, from the design spec. "Load
 * Suggested Services" adds these (skipping any name already present on
 * the shop) rather than replacing whatever the GM has already set up.
 * Costs/DCs/lead-times here are placeholder defaults — real numbers are
 * an open tuning value per the spec, meant to be adjusted per shop.
 */
export const SUGGESTED_SERVICES = {
  "General Store / Inn": [
    { name: "Room for the Night", resolutionType: "instant", cost: 1 },
    { name: "Meals / Provisions Restock", resolutionType: "instant", cost: 2 },
    { name: "Stabling for Mounts", resolutionType: "instant", cost: 1 },
    { name: "Message/Parcel Delivery", resolutionType: "time-delay", cost: 5, leadTimeDays: 3 }
  ],
  "Temple / Shrine": [
    { name: "Identify", resolutionType: "instant", cost: 20 },
    { name: "Healing (Cure Wounds)", resolutionType: "instant", cost: 25 },
    { name: "Remove Disease/Poison", resolutionType: "instant", cost: 50 },
    { name: "Restoration (Remove Curse)", resolutionType: "instant", cost: 100 },
    { name: "Blessing (Temporary Buff)", resolutionType: "instant", cost: 25 },
    { name: "Raise Dead / Resurrection", resolutionType: "instant", cost: 5000, alwaysFlag: true }
  ],
  "Blacksmith / Armorer": [
    { name: "Repair Weapon/Armor", resolutionType: "instant", cost: 5 },
    { name: "Sharpen/Maintain", resolutionType: "instant", cost: 5 },
    { name: "Custom Fitting", resolutionType: "time-delay", cost: 15, leadTimeDays: 1 },
    { name: "Rush Order", resolutionType: "time-delay", cost: 50, leadTimeDays: 1 }
  ],
  "Alchemist / Apothecary": [
    { name: "Brew-to-Order Potion", resolutionType: "time-delay", cost: 50, leadTimeDays: 2 },
    { name: "Antidote/Poison Cure", resolutionType: "instant", cost: 25 },
    { name: "Identify Unknown Substance", resolutionType: "roll", cost: 10, dc: 15 }
  ],
  "Arcane Shop / Wizard's Tower": [
    { name: "Identify Magic Item", resolutionType: "instant", cost: 20 },
    { name: "Scribe a Scroll", resolutionType: "time-delay", cost: 50, leadTimeDays: 3 },
    { name: "Attune-Assist / Appraisal", resolutionType: "instant", cost: 15 },
    { name: "Teleportation Circle Usage", resolutionType: "instant", cost: 100, alwaysFlag: true }
  ],
  "Stable / Caravan Post": [
    { name: "Mount Rental", resolutionType: "instant", cost: 5 },
    { name: "Wagon Repair", resolutionType: "instant", cost: 10 },
    { name: "Guide/Escort Hire", resolutionType: "time-delay", cost: 25, leadTimeDays: 1 }
  ],
  "Information Broker / Guild": [
    { name: "Rumor/Gossip", resolutionType: "rolltable", cost: 5, rollTableIds: [] },
    { name: "Bounty Board Access", resolutionType: "rolltable", cost: 0, rollTableIds: [] },
    { name: "Forgery/Documentation", resolutionType: "time-delay", cost: 100, leadTimeDays: 2, alwaysFlag: true }
  ]
};
