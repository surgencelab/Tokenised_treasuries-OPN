// Data-viz series palette, assigned by product size order.
export const SYMBOL_COLORS: Record<string, string> = {
  BUIDL: "#2563eb",
  "BUIDL-I": "#7ea4f5",
  USYC: "#0891b2",
  USDY: "#7c3aed",
  BENJI: "#22c55e",
  USTB: "#e8912d",
  OUSG: "#db2777",
  TBILL: "#84cc16",
  WTGXX: "#94a3b8",
};

export const CHAIN_LABELS: Record<string, string> = {
  ethereum: "Ethereum",
  bnb: "BNB Chain",
  avalanche: "Avalanche",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  base: "Base",
  mantle: "Mantle",
  stellar: "Stellar",
  solana: "Solana",
  aptos: "Aptos",
  sui: "Sui",
  noble: "Noble",
  xrpl: "XRP Ledger",
  plume: "Plume",
  sei: "Sei",
};

export function symbolColor(symbol: string): string {
  return SYMBOL_COLORS[symbol] ?? "#6b7280";
}

// chain-brand-leaning colors, tamed to sit inside the institutional palette
export const CHAIN_COLORS: Record<string, string> = {
  ethereum: "#627eea",
  bnb: "#f0b90b",
  stellar: "#14b8a6",
  avalanche: "#e84142",
  solana: "#9a6bff",
  sei: "#db2777",
  xrpl: "#93c5fd",
  arbitrum: "#28a0f0",
  base: "#2c6bed",
  polygon: "#8247e5",
  optimism: "#ff0420",
  aptos: "#06b6d4",
  sui: "#38bdf8",
  noble: "#65a30d",
  mantle: "#64748b",
  plume: "#db2777",
};

export function chainColor(chain: string): string {
  return CHAIN_COLORS[chain] ?? "#9aa3af";
}
