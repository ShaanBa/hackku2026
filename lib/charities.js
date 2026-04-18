// Preset charity list. Chosen at goal creation time and frozen on the goal
// document. On fail, EscrowFinish moves the stake directly from the user
// escrow to the charity's XRPL address (Option B in SCHEMA.md).
//
// For the hackathon demo we intentionally map every charity to the same
// testnet address (XRPL_CHARITY_ADDRESS). Swap them out for distinct
// testnet wallets before the final demo for a more compelling narrative.

const FALLBACK_ADDRESS = process.env.XRPL_CHARITY_ADDRESS || "";

export const CHARITIES = [
  {
    id: "redcross",
    name: "American Red Cross",
    description: "Disaster relief and humanitarian aid.",
    address: FALLBACK_ADDRESS,
  },
  {
    id: "unicef",
    name: "UNICEF",
    description: "Children's emergency relief worldwide.",
    address: FALLBACK_ADDRESS,
  },
  {
    id: "wwf",
    name: "World Wildlife Fund",
    description: "Wildlife conservation.",
    address: FALLBACK_ADDRESS,
  },
  {
    id: "feeding_america",
    name: "Feeding America",
    description: "Hunger relief across the US.",
    address: FALLBACK_ADDRESS,
  },
];

export function getCharityById(id) {
  if (typeof id !== "string") return null;
  return CHARITIES.find((c) => c.id === id) || null;
}

export function listCharitiesPublic() {
  return CHARITIES.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));
}
