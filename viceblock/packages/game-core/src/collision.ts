/**
 * Physical contact between the things that move: car on car, car on person.
 * Before this existed the player drove through traffic and crowds like a
 * ghost, which is the single most obvious way an open-world city stops
 * feeling like one.
 */

export const COLLISION_CONFIG = {
  /** Cars are treated as circles this wide for contact tests. */
  carRadius: 13,
  pedestrianRadius: 7,
  /** Bounce: 0 is a dead thud, 1 is billiard balls. Cars are mostly thud. */
  restitution: 0.35,
  /** Damage per unit of closing speed, split by mass share. */
  ramDamagePerSpeed: 0.22,
  /** Below this closing speed a touch is just a nudge, not damage. */
  minDamageSpeed: 26,
  /** Below this a car brushing a pedestrian only shoves them aside. */
  minPedestrianHarmSpeed: 34,
  /** Damage to a person per unit of impact speed above the harm threshold. */
  pedestrianDamagePerSpeed: 0.85,
  pedestrianKnockback: 1.35,
};

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Heavier vehicles shrug off impacts and shove lighter ones aside. */
  mass: number;
}

export interface CarCollision {
  /** Unit vector from a to b. */
  nx: number;
  ny: number;
  /** Overlap depth in world units; used to push the pair apart. */
  depth: number;
  /** Speed at which the two closed on each other. */
  closing: number;
  a: { vx: number; vy: number };
  b: { vx: number; vy: number };
  damageA: number;
  damageB: number;
}

/**
 * Resolve one car-on-car contact. Returns null when the pair is not touching
 * or is already separating, so callers can skip the bookkeeping.
 */
export function resolveCarCollision(a: Body, b: Body, radius = COLLISION_CONFIG.carRadius): CarCollision | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = radius * 2;
  if (dist >= minDist) return null;
  // Perfectly stacked bodies have no contact normal; pick one arbitrarily.
  const nx = dist > 1e-4 ? dx / dist : 1;
  const ny = dist > 1e-4 ? dy / dist : 0;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel > 0) return null;

  const totalMass = a.mass + b.mass;
  const impulse = (-(1 + COLLISION_CONFIG.restitution) * rel) / (1 / a.mass + 1 / b.mass);
  const closing = -rel;
  const damage = closing > COLLISION_CONFIG.minDamageSpeed ? (closing - COLLISION_CONFIG.minDamageSpeed) * COLLISION_CONFIG.ramDamagePerSpeed : 0;
  return {
    nx,
    ny,
    depth: minDist - dist,
    closing,
    a: { vx: a.vx - (impulse / a.mass) * nx, vy: a.vy - (impulse / a.mass) * ny },
    b: { vx: b.vx + (impulse / b.mass) * nx, vy: b.vy + (impulse / b.mass) * ny },
    // The lighter car comes off worse, the way it should.
    damageA: Math.round(damage * (b.mass / totalMass) * 2),
    damageB: Math.round(damage * (a.mass / totalMass) * 2),
  };
}

export interface PedestrianHit {
  damage: number;
  /** Speed the body is thrown at, along the car's direction of travel. */
  knockback: number;
  lethal: boolean;
}

/** What happens when a moving car reaches a person. */
export function pedestrianImpact(speed: number, health: number): PedestrianHit {
  if (speed < COLLISION_CONFIG.minPedestrianHarmSpeed) {
    return { damage: 0, knockback: speed * 0.6, lethal: false };
  }
  const over = speed - COLLISION_CONFIG.minPedestrianHarmSpeed;
  const damage = Math.round(12 + over * COLLISION_CONFIG.pedestrianDamagePerSpeed);
  return { damage, knockback: speed * COLLISION_CONFIG.pedestrianKnockback, lethal: damage >= health };
}
