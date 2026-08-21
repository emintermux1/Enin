import type { VehicleStats } from "@viceblock/shared";
import { VEHICLE_CONFIG } from "./config";

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
    security: "none",
  },
  {
    // A nod to the Tofas Sahin: a boxy rear-drive saloon that everyone's uncle
    // drove. Slow off the line, no brakes to speak of, and built like a safe.
    id: "sahin",
    name: "Tofa Sahin 1.6",
    category: "sedan",
    topSpeed: 172,
    acceleration: 96,
    handling: 0.78,
    braking: 150,
    durability: 145,
    traction: 0.72,
    seats: 4,
    security: "lock",
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
    security: "lock",
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
    security: "immobilizer",
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
    security: "none",
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
  /** Component damage: 1 = pristine, 0 = dead. */
  engine: number;
  tires: number;
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
    engine: 1,
    tires: 1,
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
  // Crashes chew the engine; sustained damage eventually shreds tires too.
  next.engine = Math.max(0.2, next.engine - amount * 0.004);
  if (highSpeedCrash) next.tires = Math.max(0.35, next.tires - 0.12);
  next.burning = next.health < nextHealthBurn(next);
  if (next.health <= 0) {
    next.explodeIn = next.explodeIn > 0 ? next.explodeIn : VEHICLE_CONFIG.explosionFuseSeconds;
  } else if (highSpeedCrash && next.health < durabilityOf(next.defId) * 0.3 && Math.random() < VEHICLE_CONFIG.explodeChanceOnHeavyCrash) {
    // A big hit only ends the car outright once it is already falling apart.
    next.health = 0;
    next.burning = true;
    next.explodeIn = VEHICLE_CONFIG.shortFuseSeconds;
  }
  return next;
}

function durabilityOf(defId: string): number {
  return vehicleById(defId).durability;
}

/**
 * Damage from driving into geometry. Scraping a wall at parking speed should
 * cost paint, not the car; only a real crash bites. Callers must rate-limit
 * this with `VEHICLE_CONFIG.bumpCooldownSeconds` so one wall is one hit.
 */
export function collisionDamage(speed: number): number {
  if (speed <= VEHICLE_CONFIG.crashSpeedThreshold) return Math.max(1, Math.round(speed * 0.04));
  return Math.round(10 + (speed - VEHICLE_CONFIG.crashSpeedThreshold) * 0.22);
}

/** Bullets can pop tires without needing to wreck the whole car. */
export function shootTire(v: VehicleRuntime): VehicleRuntime {
  return { ...v, tires: Math.max(0.3, v.tires - 0.35) };
}

/**
 * Damage stage for visuals: 0 normal, 1 damaged, 2 heavy, 3 wrecked.
 */
export function damageStage(v: VehicleRuntime): 0 | 1 | 2 | 3 {
  if (v.exploded || v.health <= 0) return 3;
  const ratio = v.health / vehicleById(v.defId).durability;
  if (ratio < 0.3) return 2;
  if (ratio < 0.65) return 1;
  return 0;
}

/** Engine damage cuts acceleration; tire damage cuts grip and top speed. */
export function performanceMultipliers(v: VehicleRuntime): { accel: number; top: number; grip: number } {
  return {
    accel: 0.45 + v.engine * 0.55,
    top: 0.6 + v.tires * 0.4,
    grip: 0.5 + v.tires * 0.5,
  };
}

export type Surface = "asphalt" | "wet-asphalt" | "grass" | "sand" | "gravel";

export function surfaceGrip(surface: Surface): number {
  switch (surface) {
    case "asphalt":
      return 1;
    case "wet-asphalt":
      return 0.74;
    case "grass":
      return 0.68;
    case "sand":
      return 0.55;
    case "gravel":
      return 0.8;
    default: {
      const _never: never = surface;
      return _never;
    }
  }
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
