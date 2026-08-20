import { describe, expect, it } from "vitest";
import { DRIVING_CONFIG, maxSpeedFor, speedoKmh, stepCar, type CarMotion, type DriveParams } from "../src/driving";
import { isDrifting, THRILL_CONFIG } from "../src/thrill";
import { vehicleById } from "../src/vehicles";

function paramsFor(id: string, grip = 1, power = 1): DriveParams {
  const def = vehicleById(id);
  return { acceleration: def.acceleration, topSpeed: def.topSpeed, handling: def.handling, braking: def.braking, grip, power };
}

/** Runs the car flat out and returns its speed after `seconds`. */
function floorIt(id: string, seconds: number, grip = 1): number {
  const params = paramsFor(id, grip);
  let m: CarMotion = { heading: 0, vx: 0, vy: 0 };
  for (let t = 0; t < seconds; t += 1 / 60) {
    m = stepCar(m, { throttle: 1, steer: 0, handbrake: false }, params, 1 / 60);
  }
  return Math.hypot(m.vx, m.vy);
}

describe("car acceleration", () => {
  it("reaches most of its top speed instead of crawling", () => {
    const params = paramsFor("sparrow");
    const speed = floorIt("sparrow", 12);
    expect(speed).toBeGreaterThan(maxSpeedFor(params) * 0.9);
  });

  it("never exceeds its top speed", () => {
    const params = paramsFor("mirage");
    expect(floorIt("mirage", 30)).toBeLessThanOrEqual(maxSpeedFor(params) + 1e-6);
  });

  it("keeps the stat sheet honest: a sports car out-accelerates a compact", () => {
    expect(floorIt("mirage", 3)).toBeGreaterThan(floorIt("sparrow", 3));
  });

  it("reads out roughly the car's rated top speed on the speedometer", () => {
    const rated = vehicleById("sparrow").topSpeed;
    const shown = speedoKmh(floorIt("sparrow", 20));
    expect(shown).toBeGreaterThan(rated * 0.85);
    expect(shown).toBeLessThan(rated * 1.15);
  });

  it("loses speed on a slick surface", () => {
    expect(floorIt("sparrow", 12, 0.6)).toBeLessThan(floorIt("sparrow", 12, 1));
  });
});

describe("coasting and braking", () => {
  it("coasts down slowly rather than stopping dead", () => {
    const params = paramsFor("sparrow");
    let m: CarMotion = { heading: 0, vx: 100, vy: 0 };
    for (let t = 0; t < 1; t += 1 / 60) m = stepCar(m, { throttle: 0, steer: 0, handbrake: false }, params, 1 / 60);
    expect(m.vx).toBeLessThan(100);
    expect(m.vx).toBeGreaterThan(50);
  });

  it("brakes far harder than it coasts", () => {
    const params = paramsFor("sparrow");
    let coast: CarMotion = { heading: 0, vx: 100, vy: 0 };
    let brake: CarMotion = { heading: 0, vx: 100, vy: 0 };
    for (let t = 0; t < 0.5; t += 1 / 60) {
      coast = stepCar(coast, { throttle: 0, steer: 0, handbrake: false }, params, 1 / 60);
      brake = stepCar(brake, { throttle: -1, steer: 0, handbrake: false }, params, 1 / 60);
    }
    expect(brake.vx).toBeLessThan(coast.vx);
  });

  it("reverses from a standstill", () => {
    const params = paramsFor("sparrow");
    let m: CarMotion = { heading: 0, vx: 0, vy: 0 };
    for (let t = 0; t < 1; t += 1 / 60) m = stepCar(m, { throttle: -1, steer: 0, handbrake: false }, params, 1 / 60);
    expect(m.vx).toBeLessThan(0);
  });
});

describe("grip and drift", () => {
  /** Angle between where the nose points and where the car is actually going. */
  function slip(m: CarMotion): number {
    const len = Math.hypot(m.vx, m.vy);
    if (len < 1e-6) return 0;
    const dot = (Math.cos(m.heading) * m.vx + Math.sin(m.heading) * m.vy) / len;
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  it("slides when the handbrake breaks traction, tracks straight without it", () => {
    const params = paramsFor("ironback");
    let gripped: CarMotion = { heading: 0, vx: 120, vy: 0 };
    let sliding: CarMotion = { heading: 0, vx: 120, vy: 0 };
    for (let t = 0; t < 0.8; t += 1 / 60) {
      gripped = stepCar(gripped, { throttle: 1, steer: 1, handbrake: false }, params, 1 / 60);
      sliding = stepCar(sliding, { throttle: 1, steer: 1, handbrake: true }, params, 1 / 60);
    }
    expect(slip(sliding)).toBeGreaterThan(slip(gripped));
  });

  it("recovers from a slide once the wheels bite again", () => {
    const params = paramsFor("ironback");
    let m: CarMotion = { heading: 0, vx: 90, vy: 60 };
    const before = slip(m);
    for (let t = 0; t < 1; t += 1 / 60) m = stepCar(m, { throttle: 0.5, steer: 0, handbrake: false }, params, 1 / 60);
    expect(slip(m)).toBeLessThan(before);
  });

  it("holds a slide long enough to score a drift", () => {
    const params = paramsFor("sparrow", 0.92);
    let m: CarMotion = { heading: 0, vx: 0, vy: 0 };
    for (let t = 0; t < 8; t += 1 / 60) m = stepCar(m, { throttle: 1, steer: 0, handbrake: false }, params, 1 / 60);
    let held = 0;
    for (let t = 0; t < 1.8; t += 1 / 60) {
      m = stepCar(m, { throttle: 1, steer: 1, handbrake: true }, params, 1 / 60);
      held = isDrifting(Math.hypot(m.vx, m.vy), Math.cos(m.heading), Math.sin(m.heading), m.vx, m.vy) ? held + 1 / 60 : 0;
    }
    expect(held).toBeGreaterThan(THRILL_CONFIG.minDrift);
  });

  it("a normal turn stays gripped and does not count as a drift", () => {
    const params = paramsFor("sparrow", 0.92);
    let m: CarMotion = { heading: 0, vx: 0, vy: 0 };
    for (let t = 0; t < 8; t += 1 / 60) m = stepCar(m, { throttle: 1, steer: 0, handbrake: false }, params, 1 / 60);
    let drifted = false;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      m = stepCar(m, { throttle: 1, steer: 1, handbrake: false }, params, 1 / 60);
      drifted ||= isDrifting(Math.hypot(m.vx, m.vy), Math.cos(m.heading), Math.sin(m.heading), m.vx, m.vy);
    }
    expect(drifted).toBe(false);
  });

  it("barely steers at a standstill", () => {
    const params = paramsFor("sparrow");
    const parked = stepCar({ heading: 0, vx: 0, vy: 0 }, { throttle: 0, steer: 1, handbrake: false }, params, 1 / 60);
    const rolling = stepCar({ heading: 0, vx: 120, vy: 0 }, { throttle: 0, steer: 1, handbrake: false }, params, 1 / 60);
    expect(Math.abs(parked.heading)).toBeLessThan(Math.abs(rolling.heading));
  });

  it("is frame-rate independent within a few percent", () => {
    const params = paramsFor("sparrow");
    let fast: CarMotion = { heading: 0, vx: 0, vy: 0 };
    let slow: CarMotion = { heading: 0, vx: 0, vy: 0 };
    for (let t = 0; t < 4; t += 1 / 120) fast = stepCar(fast, { throttle: 1, steer: 0, handbrake: false }, params, 1 / 120);
    for (let t = 0; t < 4; t += 1 / 30) slow = stepCar(slow, { throttle: 1, steer: 0, handbrake: false }, params, 1 / 30);
    expect(Math.abs(fast.vx - slow.vx) / fast.vx).toBeLessThan(0.06);
  });
});

describe("speedometer", () => {
  it("reads zero when parked and rises with speed", () => {
    expect(speedoKmh(0)).toBe(0);
    expect(speedoKmh(100)).toBe(Math.round(100 * DRIVING_CONFIG.speedoScale));
  });
});
