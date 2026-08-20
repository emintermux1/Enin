/**
 * Arcade car physics, split into forward and lateral velocity so the car can
 * be pushed sideways and claw its way back. The old model applied a braking
 * term every frame regardless of input, which held every car near walking
 * pace; here drag only bites when you are off the throttle, so a car actually
 * reaches the top speed printed on its stat sheet.
 */

export const DRIVING_CONFIG = {
  /** Fraction of a car's rated top speed reachable in world units per second. */
  topSpeedScale: 0.75,
  /** World units per second to km/h on the speedometer, so a flat-out car reads its rated top speed. */
  speedoScale: 1.33,
  /** Engine force fades as you approach top speed instead of slamming into a cap. */
  powerFade: 0.75,
  /** Coasting decay per second. Low: lifting off should not feel like an anchor. */
  coastDrag: 0.55,
  /** Deceleration under braking, as a fraction of the car's braking stat, in units per second squared. */
  brakeScale: 0.72,
  /** The handbrake scrubs speed while it slides; it must not stop the car dead. */
  handbrakeScale: 0.22,
  reverseScale: 0.45,
  /** How fast sideways motion is scrubbed off. Higher = the car tracks straight. */
  lateralGrip: 5.2,
  /** Handbrake breaks traction: this is what makes a slide possible. */
  handbrakeGrip: 0.85,
  handbrakeSteer: 1.9,
  /** Steering authority ramps in with speed so a parked car does not pirouette. */
  steerSpeedFloor: 0.3,
  steerFullSpeed: 60,
};

export interface DriveInput {
  /** -1 (reverse/brake) to 1 (throttle). */
  throttle: number;
  /** -1 to 1. */
  steer: number;
  handbrake: boolean;
}

export interface CarMotion {
  heading: number;
  vx: number;
  vy: number;
}

export interface DriveParams {
  acceleration: number;
  topSpeed: number;
  handling: number;
  braking: number;
  /** Combined surface and tire grip, 1 = dry asphalt on good tires. */
  grip: number;
  /** Engine health multiplier, 1 = healthy. */
  power: number;
}

export function maxSpeedFor(params: DriveParams): number {
  return params.topSpeed * DRIVING_CONFIG.topSpeedScale * params.power * (0.7 + params.grip * 0.3);
}

export function speedoKmh(speed: number): number {
  return Math.round(speed * DRIVING_CONFIG.speedoScale);
}

export function stepCar(motion: CarMotion, input: DriveInput, params: DriveParams, dt: number): CarMotion {
  const max = maxSpeedFor(params);
  const speedNow = Math.hypot(motion.vx, motion.vy);
  const rolling = motion.vx * Math.cos(motion.heading) + motion.vy * Math.sin(motion.heading);

  // Steer first: the nose turns, the momentum does not. The gap between the
  // two is the slip that grip then scrubs away — or does not, on the handbrake.
  const authority = Math.min(1, DRIVING_CONFIG.steerSpeedFloor + speedNow / DRIVING_CONFIG.steerFullSpeed);
  const heading =
    motion.heading +
    input.steer * params.handling * authority * (input.handbrake ? DRIVING_CONFIG.handbrakeSteer : 1) * dt * (rolling >= 0 ? 1 : -1);

  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  let forward = motion.vx * fx + motion.vy * fz;
  let lateral = motion.vx * -fz + motion.vy * fx;

  const throttle = Math.max(-1, Math.min(1, input.throttle));
  if (throttle > 0) {
    const fade = Math.max(0.15, 1 - (Math.max(0, forward) / max) * DRIVING_CONFIG.powerFade);
    forward += params.acceleration * params.power * fade * throttle * dt;
  } else if (throttle < 0) {
    if (forward > 1) {
      forward = Math.max(0, forward - params.braking * DRIVING_CONFIG.brakeScale * params.grip * -throttle * dt);
    } else {
      forward += params.acceleration * DRIVING_CONFIG.reverseScale * throttle * dt;
    }
  } else {
    forward -= forward * DRIVING_CONFIG.coastDrag * dt;
  }
  if (input.handbrake && forward > 0) {
    forward = Math.max(0, forward - params.braking * DRIVING_CONFIG.handbrakeScale * dt);
  }
  forward = Math.max(-max * 0.35, Math.min(max, forward));

  // Sideways motion bleeds off unless the handbrake has broken traction.
  const gripRate = input.handbrake ? DRIVING_CONFIG.handbrakeGrip : DRIVING_CONFIG.lateralGrip * params.grip;
  lateral -= lateral * Math.min(1, gripRate * dt);

  return {
    heading,
    vx: fx * forward + -fz * lateral,
    vy: fz * forward + fx * lateral,
  };
}
