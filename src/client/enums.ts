// Enum-like value sets. These const arrays double as runtime CLI choice
// validators and as TS union types.

/** Topic categories ("Ressorts") accepted by the news endpoint. */
export const RessortValues = [
  "inland",
  "ausland",
  "wirtschaft",
  "sport",
  "video",
  "investigativ",
  "wissen",
] as const;
export type Ressort = (typeof RessortValues)[number];

/**
 * Bundesland ids (1..16) used for the `regions` filter, in the order the API
 * documents them.
 */
export const RegionValues = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
] as const;
export type Region = (typeof RegionValues)[number];
