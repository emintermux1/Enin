/**
 * Witness-driven crime reporting and the fence economy for stolen loot.
 * Crimes with no witnesses raise no heat; witnessed crimes are reported
 * after a believable delay instead of instant magical police knowledge.
 */
export type CrimeKind = "car-theft" | "robbery" | "gunfire" | "assault" | "lockpick-alarm" | "hit-and-run" | "homicide";

export interface CrimeReport {
  reported: boolean;
  /** Seconds until police actually receive the call. */
  delay: number;
  heatAdd: number;
}

export function crimeSeverity(kind: CrimeKind): number {
  switch (kind) {
    case "car-theft":
      return 1;
    case "robbery":
      return 2;
    case "gunfire":
      return 2;
    case "assault":
      return 1;
    case "lockpick-alarm":
      return 1;
    case "hit-and-run":
      return 2;
    case "homicide":
      return 3;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

/**
 * Decide whether a crime gets reported.
 * - Zero witnesses and no cop nearby: nothing happens. Empty alleys are safe.
 * - A cop who directly sees it: instant, full severity.
 * - Civilian witnesses: chance scales with crowd size; a caller takes ~3-6s
 *   to dial, giving the player a window to leave the scene.
 */
export function witnessReport(kind: CrimeKind, witnesses: number, copSaw: boolean, roll = Math.random()): CrimeReport {
  const severity = crimeSeverity(kind);
  if (copSaw) return { reported: true, delay: 0, heatAdd: severity };
  if (witnesses <= 0) return { reported: false, delay: 0, heatAdd: 0 };
  const chance = Math.min(0.95, 0.35 + witnesses * 0.18);
  if (roll > chance) return { reported: false, delay: 0, heatAdd: 0 };
  const delay = Math.max(2.5, 6 - witnesses * 0.6);
  return { reported: true, delay, heatAdd: severity };
}

/** Stolen loot carries origin — it must be fenced, not auto-converted to cash. */
export type LootOrigin = "store-robbery" | "jewelry" | "cargo" | "rare-vehicle" | "armored-truck";

export interface LootItem {
  origin: LootOrigin;
  value: number;
}

export function lootLabel(origin: LootOrigin): string {
  switch (origin) {
    case "store-robbery":
      return "Store cash bag";
    case "jewelry":
      return "Hot jewelry";
    case "cargo":
      return "Cargo package";
    case "rare-vehicle":
      return "Rare car papers";
    case "armored-truck":
      return "Armored truck case";
    default: {
      const _never: never = origin;
      return _never;
    }
  }
}

/** Fence pays below face value; reputation with the fence improves the cut. */
export function fenceRate(fenceRep: number): number {
  return Math.min(0.92, 0.68 + fenceRep * 0.04);
}

export function fenceValue(items: LootItem[], fenceRep: number): number {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return Math.round(total * fenceRate(fenceRep));
}
