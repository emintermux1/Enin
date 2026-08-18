/**
 * Weapon definitions. Each weapon has a distinct personality — no single
 * option dominates: fists are silent, the pistol is accurate at range,
 * the SMG wins close-up damage-per-second but sprays wide.
 */
export type WeaponId = "fists" | "pistol" | "smg";

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  /** Seconds between shots/swings. */
  fireInterval: number;
  /** Random spread half-angle in radians. */
  spread: number;
  range: number;
  price: number;
  /** Radius in which the shot itself alerts witnesses. */
  noiseRadius: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: "fists", name: "Fists", damage: 14, fireInterval: 0.45, spread: 0, range: 26, price: 0, noiseRadius: 0 },
  { id: "pistol", name: "Street Pistol", damage: 34, fireInterval: 0.18, spread: 0.02, range: 260, price: 0, noiseRadius: 150 },
  { id: "smg", name: "Vector 9", damage: 15, fireInterval: 0.07, spread: 0.09, range: 190, price: 450, noiseRadius: 190 },
];

export function weaponById(id: WeaponId): WeaponDef {
  switch (id) {
    case "fists":
      return WEAPONS[0];
    case "pistol":
      return WEAPONS[1];
    case "smg":
      return WEAPONS[2];
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function weaponDps(def: WeaponDef): number {
  return def.damage / def.fireInterval;
}
