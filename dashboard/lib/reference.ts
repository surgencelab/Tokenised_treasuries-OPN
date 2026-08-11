// External reference totals used ONLY for the coverage panel, never for our
// own metrics. Source: rwa.xyz asset pages. Refresh alongside NAV reference.
export const REFERENCE_AS_OF = "2026-07-15";

// Product-level total AUM across ALL chains (incl. non-EVM) per rwa.xyz.
export const RWA_XYZ_TOTALS: Record<string, number> = {
  BUIDL: 2_870_081_690, // includes BUIDL-I and non-EVM (Aptos, Solana)
  USYC: 3_002_962_961,
  USDY: 2_160_733_533,
  BENJI: 763_815_232, // majority on Stellar (non-EVM)
  USTB: 694_499_588,
  OUSG: 480_497_056,
  TBILL: 213_285_369,
  WTGXX: 764_970_638,
};
