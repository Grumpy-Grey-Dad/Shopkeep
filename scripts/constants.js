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
  sellBackPercent: 50
};
