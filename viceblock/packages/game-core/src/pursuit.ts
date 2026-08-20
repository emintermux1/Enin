/**
 * Police that drive. Foot officers can never catch a car, so without this a
 * pursuit ends the moment the player finds any vehicle. Cruisers use the same
 * `stepCar` physics the player does — they are not on rails and can be
 * out-driven, rammed, wrecked, or lost.
 */
import type { HeatLevel } from "@viceblock/shared";
import type { DriveInput } from "./driving";

export const PURSUIT_CONFIG = {
  /** Steering gain on heading error. Higher whips the wheel harder. */
  steerGain: 1.8,
  /** Above this heading error the driver lifts off rather than understeering wide. */
  easeOffAngle: 0.9,
  /** Cruisers back off the throttle inside this range so they shepherd rather than punt. */
  tailDistance: 40,
  /** Past this heading error the target is behind: brake and turn, do not plough on. */
  turnAroundAngle: 2,
  /** How far ahead of the target a cruiser aims, to cut the corner. */
  leadSeconds: 0.6,
  spawnDistance: 340,
  /** Beyond this a cruiser has lost the plot and is recycled. */
  despawnDistance: 1400,
};

/** How many cruisers a wanted level puts on the street. */
export function copCarsForHeat(level: HeatLevel): number {
  switch (level) {
    case 0:
    case 1:
      return 0;
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 3;
    case 5:
      return 4;
    default: {
      const _never: never = level;
      return _never;
    }
  }
}

export function normalizeAngleTo(a: number): number {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

export interface PursuitTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PursuitCar {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
}

/**
 * Steering and throttle for one cruiser chasing one target. Aims at where the
 * target is going, not where it is, and lifts off for corners it cannot take
 * flat — which is what gives the player room to break away on a tight line.
 */
export function pursuitInput(car: PursuitCar, target: PursuitTarget, dt = 1 / 60): DriveInput {
  void dt;
  const aimX = target.x + target.vx * PURSUIT_CONFIG.leadSeconds;
  const aimY = target.y + target.vy * PURSUIT_CONFIG.leadSeconds;
  const want = Math.atan2(aimY - car.y, aimX - car.x);
  const error = normalizeAngleTo(want - car.heading);
  const steer = Math.max(-1, Math.min(1, error * PURSUIT_CONFIG.steerGain));

  const distance = Math.hypot(target.x - car.x, target.y - car.y);
  const speed = Math.hypot(car.vx, car.vy);
  const closing = speed - Math.hypot(target.vx, target.vy);
  let throttle = 1;
  if (Math.abs(error) > PURSUIT_CONFIG.easeOffAngle && speed > 40) throttle = 0.15;
  // Overshooting and then wheeling around is what made early cruisers useless;
  // braking to match pace keeps them menacingly on the bumper instead.
  if (Math.abs(error) > PURSUIT_CONFIG.turnAroundAngle && speed > 60) throttle = -1;
  else if (distance < PURSUIT_CONFIG.tailDistance * 1.5 && closing > 25) throttle = -0.5;
  return { throttle, steer, handbrake: false };
}
