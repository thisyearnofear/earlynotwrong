/**
 * Shared domain types for the Early, Not Wrong conviction framework.
 *
 * These types intentionally avoid UI, transport, or chain-specific concerns.
 * They describe the ledger of trades and the metrics derived from it.
 */
/**
 * Dual-layer archetype metadata: keep brand names for humans, always ship
 * `id` + `summary` so buyers don't have to decode "Iron Pillar" alone.
 */
export const ARCHETYPE_DESCRIPTIONS = {
    "Iron Pillar": {
        label: "Iron Pillar",
        id: "iron_pillar",
        summary: "Holds through drawdowns and captures upside",
    },
    "Profit Phantom": {
        label: "Profit Phantom",
        id: "profit_phantom",
        summary: "Takes profit early and leaves gains on the table",
    },
    "Exit Voyager": {
        label: "Exit Voyager",
        id: "exit_voyager",
        summary: "Frequent short holds with weak conviction",
    },
    "Diamond Hand": {
        label: "Diamond Hand",
        id: "diamond_hand",
        summary: "Holds long and rarely exits",
    },
};
/** Resolve brand archetype → id + plain-English summary. */
export function describeArchetype(archetype) {
    return ARCHETYPE_DESCRIPTIONS[archetype];
}
