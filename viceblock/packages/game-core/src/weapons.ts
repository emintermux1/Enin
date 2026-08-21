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
  /** Rounds per magazine. Fists have none and never reload. */
  magazine: number;
  reloadSeconds: number;
  /** Upward camera kick per shot, in radians. */
  recoil: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: "fists",
    name: "Fists",
    damage: 14,
    fireInterval: 0.45,
    spread: 0,
    range: 26,
    price: 0,
    noiseRadius: 0,
    magazine: 0,
    reloadSeconds: 0,
    recoil: 0,
  },
  {
    id: "pistol",
    name: "Street Pistol",
    damage: 34,
    fireInterval: 0.18,
    spread: 0.02,
    range: 260,
    price: 0,
    noiseRadius: 150,
    magazine: 12,
    reloadSeconds: 1.1,
    recoil: 0.055,
  },
  {
    id: "smg",
    name: "Vector 9",
    damage: 15,
    fireInterval: 0.07,
    spread: 0.09,
    range: 190,
    price: 450,
    noiseRadius: 190,
    magazine: 30,
    reloadSeconds: 1.7,
    recoil: 0.022,
  },
];

/** Aiming down the sights trades movement speed for a tighter group. */
export const AIM_CONFIG = {
  spreadScale: 0.38,
  /** Multiplier on walking speed while aiming. */
  moveScale: 0.55,
  /** Boom-length multiplier, to bring the shoulder camera in. */
  zoomScale: 0.55,
  /** Fraction of recoil recovered per second. */
  recoilRecovery: 3.4,
};

/**
 * Rounds pulled from the reserve when a magazine is refilled: never more than
 * the magazine holds, never more than is left in the pocket.
 */
export function reloadAmount(magazine: number, inMag: number, reserve: number): number {
  return Math.max(0, Math.min(magazine - inMag, reserve));
}

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
