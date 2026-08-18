import type { VehicleStats } from "@viceblock/shared";

export const VEHICLES: VehicleStats[] = [
  {
    id: "sparrow",
    name: "Kite Sparrow",
    category: "compact",
    topSpeed: 210,
    acceleration: 118,
    handling: 0.92,
    braking: 210,
    durability: 110,
    traction: 0.86,
    seats: 2,
  },
  {
    id: "ironback",
    name: "Ironback 68",
    category: "muscle",
    topSpeed: 248,
    acceleration: 150,
    handling: 0.72,
    braking: 180,
    durability: 160,
    traction: 0.7,
    seats: 2,
  },
  {
    id: "mirage",
    name: "Vesper Mirage",
    category: "sports",
    topSpeed: 292,
    acceleration: 188,
    handling: 0.88,
    braking: 230,
    durability: 95,
    traction: 0.8,
    seats: 2,
  },
  {
    id: "needle",
    name: "Needle 250",
    category: "motorcycle",
    topSpeed: 268,
    acceleration: 210,
    handling: 1.05,
    braking: 200,
    durability: 55,
    traction: 0.62,
    seats: 1,
  },
];

export function vehicleById(id: string): VehicleStats {
  const found = VEHICLES.find((v) => v.id === id);
  if (!found) return VEHICLES[0];
  return found;
}

export interface VehicleRuntime {
  id: string;
  defId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  health: number;
  burning: boolean;
  exploded: boolean;
  explodeIn: number;
  stolen: boolean;
  registered: boolean;
  color: string;
}

export function createVehicleRuntime(
  defId: string,
  x: number,
  y: number,
  heading: number,
  color: string,
  stolen = false,
): VehicleRuntime {
  const def = vehicleById(defId);
  return {
    id: `${defId}-${Math.floor(x)}-${Math.floor(y)}`,
    defId,
    x,
    y,
    vx: 0,
    vy: 0,
    heading,
    health: def.durability,
    burning: false,
    exploded: false,
    explodeIn: 0,
    stolen,
    registered: false,
    color,
  };
}

export function applyVehicleDamage(v: VehicleRuntime, amount: number, highSpeedCrash: boolean): VehicleRuntime {
  if (v.exploded) return v;
  const next = { ...v };
  next.health = Math.max(0, next.health - amount);
  next.burning = next.health < nextHealthBurn(next);
  if (next.health <= 0) {
    next.explodeIn = next.explodeIn > 0 ? next.explodeIn : 0.35;
  } else if (highSpeedCrash && Math.random() < 0.18) {
    next.health = 0;
    next.burning = true;
    next.explodeIn = 0.15;
  }
  return next;
}

function nextHealthBurn(v: VehicleRuntime): number {
  return vehicleById(v.defId).durability * 0.28;
}

export function tickVehicleExplosion(v: VehicleRuntime, dt: number): VehicleRuntime {
  if (v.exploded || v.health > 0) return v;
  const next = { ...v, explodeIn: v.explodeIn - dt };
  if (next.explodeIn <= 0) next.exploded = true;
  return next;
}

export function explosionRadius(defId: string): number {
  return defId === "needle" ? 42 : 70;
}
