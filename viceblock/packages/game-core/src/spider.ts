/**
 * Web-slinging traversal: the pendulum a player hangs from, and the arc they
 * fly through after letting go.
 *
 * All of it is pure so the feel can be tuned and tested without a renderer.
 * Distances are world units (a street tile is 32) and velocities are units per
 * second, matching the ground movement speeds in `PLAYER_CONFIG`.
 */

export const SPIDER_CONFIG = {
  /** Falls faster than the on-foot jump arc: a swing needs weight. */
  gravity: 430,
  /** Air resistance per second, as a fraction of speed. */
  drag: 0.14,
  /** Steering authority with no line attached. */
  airControl: 210,
  /** Leaning into a swing is how you build speed across a rooftop. */
  pump: 260,
  /** Steering across the swing plane. */
  steer: 200,
  /** How fast the line is reeled in while the boost is held. */
  reelSpeed: 210,
  /** How fast a line that is too long for the drop below it hauls itself in. */
  autoReel: 340,
  /** The bottom of an arc should clear the street by this much. */
  groundClearance: 34,
  minLength: 48,
  maxLength: 560,
  /** Nothing beyond this can be webbed. */
  maxRange: 760,
  /** An anchor must be at least this far above you, or the swing is a faceplant. */
  minAnchorRise: 40,
  /**
   * Rise over horizontal reach: how steep a line has to be to be worth firing.
   * A shallow one is still allowed to bite because `reelToCeiling` hauls it in
   * as the arc starts; only a genuine tow rope is refused.
   */
  minSteepness: 0.38,
  /** Forward throw when a swing starts from a standstill. */
  launchSpeed: 200,
  launchLift: 200,
  /** Letting go at the bottom of an arc throws you up the far side. */
  releaseBoost: 120,
  /** A zip winches you toward the anchor at this speed. */
  zipSpeed: 560,
  /** How close to the target counts as having arrived. */
  zipArrive: 6,
  /**
   * Ceiling on swing speed. Roughly three times what a car does, which is the
   * point of the web, but slow enough that a district still takes a few arcs
   * to cross rather than one.
   */
  maxSpeed: 470,
  /** Vertical climb rate while clinging to a wall. */
  climbSpeed: 150,
  /** Push-off when you jump away from a wall. */
  wallJump: 320,
} as const;

export interface SwingState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface WebLine {
  x: number;
  y: number;
  z: number;
  length: number;
}

export interface SwingInput {
  /** Lean into the arc (+1) or drag your heels (-1): the pump. */
  lean: number;
  /** Steer across the swing plane. */
  steer: number;
  /** Reel the line in for speed and height. */
  reel: boolean;
}

function clampSpeed(s: SwingState): void {
  const speed = Math.hypot(s.vx, s.vy, s.vz);
  if (speed > SPIDER_CONFIG.maxSpeed) {
    const k = SPIDER_CONFIG.maxSpeed / speed;
    s.vx *= k;
    s.vy *= k;
    s.vz *= k;
  }
}

/** Horizontal heading of travel, falling back to `fallback` when barely moving. */
function travelHeading(s: SwingState, fallback: number): number {
  return Math.hypot(s.vx, s.vz) > 4 ? Math.atan2(s.vz, s.vx) : fallback;
}

/**
 * One step of hanging from a line. The line is inextensible: the player is
 * pulled back onto the sphere around the anchor and the outward part of their
 * velocity is spent, which is what turns a fall into an arc.
 */
export function stepSwing(state: SwingState, line: WebLine, input: SwingInput, heading: number, dt: number): { state: SwingState; line: WebLine } {
  const s = { ...state };
  const l = { ...line };

  s.vy -= SPIDER_CONFIG.gravity * dt;

  // Pump along the direction of travel, steer across it. Both are horizontal:
  // vertical input on a rope is the reel, not a shove.
  const dir = travelHeading(s, heading);
  const pump = input.lean * SPIDER_CONFIG.pump * dt;
  const steer = input.steer * SPIDER_CONFIG.steer * dt;
  s.vx += Math.cos(dir) * pump - Math.sin(dir) * steer;
  s.vz += Math.sin(dir) * pump + Math.cos(dir) * steer;

  if (input.reel) l.length = Math.max(SPIDER_CONFIG.minLength, l.length - SPIDER_CONFIG.reelSpeed * dt);

  const drag = Math.max(0, 1 - SPIDER_CONFIG.drag * dt);
  s.vx *= drag;
  s.vy *= drag;
  s.vz *= drag;

  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;

  let rx = s.x - l.x;
  let ry = s.y - l.y;
  let rz = s.z - l.z;
  const dist = Math.hypot(rx, ry, rz);
  if (dist > l.length && dist > 0.001) {
    rx /= dist;
    ry /= dist;
    rz /= dist;
    s.x = l.x + rx * l.length;
    s.y = l.y + ry * l.length;
    s.z = l.z + rz * l.length;
    const outward = s.vx * rx + s.vy * ry + s.vz * rz;
    if (outward > 0) {
      s.vx -= rx * outward;
      s.vy -= ry * outward;
      s.vz -= rz * outward;
    }
  }
  clampSpeed(s);
  return { state: s, line: l };
}

/** One step of free flight: gravity, drag, and whatever steering you have left. */
export function stepAirborne(state: SwingState, input: SwingInput, heading: number, dt: number): SwingState {
  const s = { ...state };
  s.vy -= SPIDER_CONFIG.gravity * dt;
  const dir = travelHeading(s, heading);
  const push = input.lean * SPIDER_CONFIG.airControl * dt;
  const side = input.steer * SPIDER_CONFIG.airControl * dt;
  s.vx += Math.cos(dir) * push - Math.sin(dir) * side;
  s.vz += Math.sin(dir) * push + Math.cos(dir) * side;
  const drag = Math.max(0, 1 - SPIDER_CONFIG.drag * dt);
  s.vx *= drag;
  s.vy *= drag;
  s.vz *= drag;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;
  clampSpeed(s);
  return s;
}

/**
 * Letting go. Releasing while still swinging up converts the arc into height,
 * which is the whole trick of crossing a city by rope.
 */
export function releaseSwing(state: SwingState): SwingState {
  const s = { ...state };
  if (s.vy > 0) s.vy += SPIDER_CONFIG.releaseBoost;
  clampSpeed(s);
  return s;
}

/**
 * The longest line that still leaves an arc above the pavement. A pendulum
 * hangs at `anchorY - length` at its lowest point, so a line longer than the
 * anchor is high simply drags the player along the ground.
 */
export function lineCeiling(anchorY: number, groundY: number): number {
  return Math.max(SPIDER_CONFIG.minLength, anchorY - groundY - SPIDER_CONFIG.groundClearance);
}

/**
 * Hauls an over-long line in toward its ceiling. This is the swing gaining
 * height as it goes, and it is why a shot fired from street level ends up over
 * the rooftops instead of face down in the road.
 */
export function reelToCeiling(line: WebLine, ceiling: number, dt: number): WebLine {
  if (line.length <= ceiling) return line;
  return { ...line, length: Math.max(ceiling, line.length - SPIDER_CONFIG.autoReel * dt) };
}

/**
 * Whether a candidate anchor is worth firing at: high enough above the player
 * to swing under, and within reach.
 */
export function anchorUsable(px: number, py: number, pz: number, ax: number, ay: number, az: number, rise: number = SPIDER_CONFIG.minAnchorRise): boolean {
  const up = ay - py;
  if (up < rise) return false;
  const flat = Math.hypot(ax - px, az - pz);
  // Too shallow and the line is a tow rope, not a pendulum: you get dragged
  // along the road instead of swinging under the anchor.
  if (up < flat * SPIDER_CONFIG.minSteepness) return false;
  return Math.hypot(flat, up) <= SPIDER_CONFIG.maxRange;
}

/** Rope length to start a swing with: taut enough to bite immediately. */
export function initialLength(px: number, py: number, pz: number, ax: number, ay: number, az: number): number {
  const d = Math.hypot(ax - px, ay - py, az - pz);
  return Math.max(SPIDER_CONFIG.minLength, Math.min(SPIDER_CONFIG.maxLength, d));
}

/**
 * One step of a zip. The line goes taut and winches you in at a fixed speed
 * with gravity locked out, rather than throwing you at the anchor and hoping:
 * a shot fired at a roof has to end on that roof, every time, or the whole
 * move stops being a way up and becomes a coin toss.
 */
export function stepZip(state: SwingState, target: { x: number; y: number; z: number }, dt: number): { state: SwingState; arrived: boolean } {
  const dx = target.x - state.x;
  const dy = target.y - state.y;
  const dz = target.z - state.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  const vx = (dx / d) * SPIDER_CONFIG.zipSpeed;
  const vy = (dy / d) * SPIDER_CONFIG.zipSpeed;
  const vz = (dz / d) * SPIDER_CONFIG.zipSpeed;
  // Never travel past the anchor: the last step is only as long as the rope
  // that is left.
  const remaining = Math.max(0, d - SPIDER_CONFIG.zipArrive) / SPIDER_CONFIG.zipSpeed;
  const step = Math.min(dt, remaining);
  return {
    state: { x: state.x + vx * step, y: state.y + vy * step, z: state.z + vz * step, vx, vy, vz },
    arrived: remaining <= dt,
  };
}
