import { describe, expect, it } from "vitest";
import { stepCar, type CarMotion, type DriveParams } from "../src/driving";
import { copCarsForHeat, PURSUIT_CONFIG, pursuitInput, type PursuitCar } from "../src/pursuit";
import { vehicleById } from "../src/vehicles";

const cruiser = vehicleById("ironback");
const params: DriveParams = {
  acceleration: cruiser.acceleration,
  topSpeed: cruiser.topSpeed,
  handling: cruiser.handling,
  braking: cruiser.braking,
  grip: 1,
  power: 1,
};

function car(over: Partial<PursuitCar> = {}): PursuitCar {
  return { x: 0, y: 0, heading: 0, vx: 0, vy: 0, ...over };
}

describe("cruiser count", () => {
  it("puts nobody in a car below two stars and scales up after", () => {
    expect(copCarsForHeat(0)).toBe(0);
    expect(copCarsForHeat(1)).toBe(0);
    expect(copCarsForHeat(2)).toBe(1);
    expect(copCarsForHeat(5)).toBeGreaterThan(copCarsForHeat(3));
  });
});

describe("pursuit steering", () => {
  it("steers toward a target off to one side", () => {
    const right = pursuitInput(car(), { x: 100, y: 100, vx: 0, vy: 0 });
    const left = pursuitInput(car(), { x: 100, y: -100, vx: 0, vy: 0 });
    expect(right.steer).toBeGreaterThan(0);
    expect(left.steer).toBeLessThan(0);
  });

  it("holds the wheel straight when already lined up", () => {
    expect(Math.abs(pursuitInput(car(), { x: 400, y: 0, vx: 0, vy: 0 }).steer)).toBeLessThan(0.01);
  });

  it("leads a moving target instead of aiming where it was", () => {
    const straightAt = pursuitInput(car(), { x: 300, y: 0, vx: 0, vy: 0 });
    const crossing = pursuitInput(car(), { x: 300, y: 0, vx: 0, vy: 200 });
    expect(Math.abs(crossing.steer)).toBeGreaterThan(Math.abs(straightAt.steer));
  });

  it("lifts off rather than understeering wide through a hard corner", () => {
    const hardCorner = pursuitInput(car({ vx: 140 }), { x: -50, y: 200, vx: 0, vy: 0 });
    expect(hardCorner.throttle).toBeLessThan(0.5);
  });

  it("brakes rather than punting the suspect when it closes too fast", () => {
    const tailing = pursuitInput(car({ vx: 120 }), { x: PURSUIT_CONFIG.tailDistance - 10, y: 0, vx: 40, vy: 0 });
    expect(tailing.throttle).toBeLessThan(0);
  });

  it("brakes to turn around instead of driving away from a target behind it", () => {
    const past = pursuitInput(car({ vx: 140 }), { x: -200, y: 0, vx: 0, vy: 0 });
    expect(past.throttle).toBeLessThan(0);
  });

  it("closes distance on a fleeing target over time", () => {
    let chase: CarMotion & { x: number; y: number } = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
    const target = { x: 400, y: 0, vx: 60, vy: 0 };
    for (let t = 0; t < 12; t += 1 / 60) {
      const input = pursuitInput({ ...chase }, target);
      const next = stepCar(chase, input, params, 1 / 60);
      chase = { ...next, x: chase.x + next.vx / 60, y: chase.y + next.vy / 60 };
      target.x += target.vx / 60;
    }
    expect(Math.hypot(target.x - chase.x, target.y - chase.y)).toBeLessThan(400);
  });

  it("cannot catch a car driven flat out in a straight line", () => {
    let chase: CarMotion & { x: number; y: number } = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 };
    const target = { x: 300, y: 0, vx: 200, vy: 0 };
    for (let t = 0; t < 12; t += 1 / 60) {
      const input = pursuitInput({ ...chase }, target);
      const next = stepCar(chase, input, params, 1 / 60);
      chase = { ...next, x: chase.x + next.vx / 60, y: chase.y + next.vy / 60 };
      target.x += target.vx / 60;
    }
    expect(target.x - chase.x).toBeGreaterThan(300);
  });
});
