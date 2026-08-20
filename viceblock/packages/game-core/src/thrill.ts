/**
 * Thrill: the reward layer that makes driving fast feel worth it. Near misses,
 * drifts and chase pressure feed one combo meter; the meter pays cash and
 * drives the camera kick, so the screen gets louder the harder you push.
 */

export const THRILL_CONFIG = {
  /** Below this speed nothing counts — parking next to a car is not a stunt. */
  minSpeed: 55,
  /** A pass closer than this scores; closer is worth more. */
  nearMissRadius: 34,
  nearMissBase: 12,
  /** Slip angle (radians) at which the car counts as sideways rather than sloppy. */
  driftAngle: 0.35,
  /** A slide has to hold this long before it pays, so twitchy steering earns nothing. */
  minDrift: 0.6,
  driftPerSecond: 55,
  /** Combo decays this fast once you stop doing anything interesting. */
  comboWindow: 4.5,
  maxCombo: 8,
  /** Heat multiplies payouts: stunting during a pursuit is the real game. */
  heatBonusPerLevel: 0.18,
} as const;

export interface ThrillState {
  combo: number;
  /** Seconds left before the combo lapses. */
  timer: number;
  /** Cash banked during the current combo, for the end-of-combo readout. */
  pending: number;
  best: number;
}

export function createThrill(): ThrillState {
  return { combo: 0, timer: 0, pending: 0, best: 0 };
}

/** Combo multiplier: 1x at no combo, then +0.5x a step, capped. */
export function comboMultiplier(combo: number): number {
  if (combo <= 0) return 1;
  return 1 + Math.min(combo, THRILL_CONFIG.maxCombo) * 0.5;
}

/** Cash for shaving past a car. Closer and faster both pay more. */
export function nearMissValue(speed: number, distance: number, heat = 0): number {
  if (speed < THRILL_CONFIG.minSpeed) return 0;
  if (distance > THRILL_CONFIG.nearMissRadius || distance < 0) return 0;
  const closeness = 1 - distance / THRILL_CONFIG.nearMissRadius;
  const speedFactor = Math.min(2.4, speed / THRILL_CONFIG.minSpeed);
  const heatFactor = 1 + Math.max(0, heat) * THRILL_CONFIG.heatBonusPerLevel;
  return Math.round(THRILL_CONFIG.nearMissBase * (0.5 + closeness) * speedFactor * heatFactor);
}

/** True while the car is travelling meaningfully sideways. */
export function isDrifting(speed: number, headingX: number, headingZ: number, vx: number, vz: number): boolean {
  if (speed < THRILL_CONFIG.minSpeed) return false;
  const len = Math.hypot(vx, vz);
  if (len < 1e-3) return false;
  const dot = (headingX * vx + headingZ * vz) / len;
  const slip = Math.acos(Math.max(-1, Math.min(1, dot)));
  return slip > THRILL_CONFIG.driftAngle;
}

/** Cash for holding a slide. Flicks of the wheel pay nothing. */
export function driftValue(seconds: number, heat = 0): number {
  if (seconds < THRILL_CONFIG.minDrift) return 0;
  const heatFactor = 1 + Math.max(0, heat) * THRILL_CONFIG.heatBonusPerLevel;
  return Math.round(seconds * THRILL_CONFIG.driftPerSecond * heatFactor);
}

/** Bank a stunt: bumps the combo, refreshes the window, returns the payout. */
export function scoreStunt(state: ThrillState, baseValue: number): { state: ThrillState; payout: number } {
  if (baseValue <= 0) return { state, payout: 0 };
  const combo = Math.min(THRILL_CONFIG.maxCombo, state.combo + 1);
  const payout = Math.round(baseValue * comboMultiplier(state.combo));
  return {
    state: {
      combo,
      timer: THRILL_CONFIG.comboWindow,
      pending: state.pending + payout,
      best: Math.max(state.best, combo),
    },
    payout,
  };
}

/** Let the combo lapse. `lapsed` is the run that just ended, for the toast. */
export function tickThrill(state: ThrillState, dt: number): { state: ThrillState; lapsed: { combo: number; cash: number } | null } {
  if (state.timer <= 0) return { state, lapsed: null };
  const timer = state.timer - dt;
  if (timer > 0) return { state: { ...state, timer }, lapsed: null };
  return {
    state: { combo: 0, timer: 0, pending: 0, best: state.best },
    lapsed: { combo: state.combo, cash: state.pending },
  };
}

/** Speed widens the lens so fast driving reads as fast, not just numerically faster. */
export function speedFov(baseFov: number, speed: number, topSpeed: number): number {
  if (topSpeed <= 0) return baseFov;
  const t = Math.max(0, Math.min(1, speed / topSpeed));
  return baseFov + t * 0.22;
}

/** Camera pushes out under speed so the car never fills the frame. */
export function speedCameraDistance(baseDistance: number, speed: number, topSpeed: number): number {
  if (topSpeed <= 0) return baseDistance;
  const t = Math.max(0, Math.min(1, speed / topSpeed));
  return baseDistance + t * 45;
}

export type ImpactKind = "shot" | "hit" | "kill" | "crash" | "explosion" | "wanted";

/** A brief freeze sells the impact far better than a louder sound does. */
export function hitStopSeconds(kind: ImpactKind): number {
  switch (kind) {
    case "shot":
      return 0;
    case "hit":
      return 0.045;
    case "kill":
      return 0.12;
    case "crash":
      return 0.08;
    case "explosion":
      return 0.16;
    case "wanted":
      return 0.1;
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}

export function impactShake(kind: ImpactKind): number {
  switch (kind) {
    case "shot":
      return 2.4;
    case "hit":
      return 3;
    case "kill":
      return 5;
    case "crash":
      return 7;
    case "explosion":
      return 12;
    case "wanted":
      return 6;
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}
