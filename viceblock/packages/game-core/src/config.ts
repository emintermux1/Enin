/** Central gameplay tuning. No magic numbers scattered in systems. */

export const POLICE_CONFIG = {
  /** Cop movement speed as a fraction of player sprint. Below 1 = escapable. */
  footSpeedRatio: 0.82,
  carSpeedRatio: 0.9,
  sightRange: 200,
  loseSightSeconds: [0, 3.2, 3.2, 5.5, 8, 8] as const,
  escalateAfterSeenSeconds: 14,
  maxAutoEscalateLevel: 3,
  minSpawnDistance: 240,
  maxSpawnDistance: 460,
  copShootMinHeat: 2,
  copShootChancePerTick: 0.012,
  /**
   * How close a cop gets before he is grabbing at you. Body separation used to
   * hold him at arm's length forever, so a foot chase had no ending: he could
   * neither arrest you nor lose you, and just walked behind you for the rest
   * of the session.
   */
  grabRange: 13,
  /**
   * Seconds a cop keeps hunting after his last sighting. When it runs out he
   * gives up and walks off the job, so one stray star cannot buy a permanent
   * shadow.
   */
  giveUpSeconds: 18,
  /** A cop this far away has lost the plot entirely and is recycled. */
  leashDistance: 1100,
};

export const AIM_ASSIST_CONFIG = {
  enabled: true,
  coneDegrees: 16,
  magnetism: 0.55,
  maxRange: 260,
  falloffStart: 160,
  pvpMagnetism: 0.25,
  slowdownNearTarget: 0.6,
};

export const VEHICLE_CONFIG = {
  /** Damage % thresholds for staged state. */
  smokeBelow: 0.4,
  fireBelow: 0.15,
  explodeChanceOnHeavyCrash: 0.18,
  crashSpeedThreshold: 70,
  /** One wall is one hit: collision damage cannot land again within this window. */
  bumpCooldownSeconds: 0.5,
  explosionFuseSeconds: 0.35,
  explosionDamageNear: 18,
  explosionDamageDriver: 28,
};

export const PLAYER_CONFIG = {
  walkSpeed: 108,
  sprintSpeed: 168,
  jumpVelocity: 7.2,
  gravity: 22,
  respawnMedicalFee: 80,
  radius: 8,
};

export const ECONOMY_CONFIG = {
  starterCash: 500,
  martRobbery: 180,
  jewelryRobbery: 420,
  gasRepairCost: 20,
};

export const WORLD_CONFIG = {
  hoursPerRealSecond: 1 / 240,
  weatherCycleSeconds: 240,
  presenceIntervalMs: 800,
  autosaveSeconds: 4,
};

export interface AimTarget {
  id: string;
  x: number;
  y: number;
  isPlayer: boolean;
}

/**
 * Cone-based aim assist: given shooter position and intended heading, pick the
 * best target inside the cone and return an adjusted heading pulled toward it.
 */
export function assistAim(
  originX: number,
  originY: number,
  heading: number,
  targets: AimTarget[],
  opts = AIM_ASSIST_CONFIG,
): { heading: number; targetId: string | null } {
  if (!opts.enabled || targets.length === 0) return { heading, targetId: null };
  const cone = (opts.coneDegrees * Math.PI) / 180;
  let best: AimTarget | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const dx = t.x - originX;
    const dy = t.y - originY;
    const dist = Math.hypot(dx, dy);
    if (dist > opts.maxRange || dist < 4) continue;
    const ang = Math.atan2(dy, dx);
    let diff = Math.abs(normalizeAngle(ang - heading));
    if (diff > cone) continue;
    const score = diff * 100 + dist * 0.2;
    if (score < bestScore) {
      bestScore = score;
      best = t;
      void diff;
    }
  }
  if (!best) return { heading, targetId: null };
  const dist = Math.hypot(best.x - originX, best.y - originY);
  let strength = best.isPlayer ? opts.pvpMagnetism : opts.magnetism;
  if (dist > opts.falloffStart) {
    strength *= Math.max(0, 1 - (dist - opts.falloffStart) / (opts.maxRange - opts.falloffStart));
  }
  const targetHeading = Math.atan2(best.y - originY, best.x - originX);
  const blended = heading + normalizeAngle(targetHeading - heading) * strength;
  return { heading: blended, targetId: best.id };
}

export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
