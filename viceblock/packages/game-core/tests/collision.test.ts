import { describe, expect, it } from "vitest";
import { COLLISION_CONFIG, pedestrianImpact, resolveCarCollision, type Body } from "../src/collision";
import { crimeSeverity } from "../src/crime";

function car(over: Partial<Body>): Body {
  return { x: 0, y: 0, vx: 0, vy: 0, mass: 1200, ...over };
}

describe("car on car", () => {
  it("ignores cars that are not touching", () => {
    expect(resolveCarCollision(car({}), car({ x: 200 }))).toBeNull();
  });

  it("ignores a pair that is already separating", () => {
    const a = car({ vx: -50 });
    const b = car({ x: 20, vx: 50 });
    expect(resolveCarCollision(a, b)).toBeNull();
  });

  it("shoves the struck car along and slows the one doing the shoving", () => {
    const a = car({ vx: 120 });
    const b = car({ x: 20 });
    const hit = resolveCarCollision(a, b);
    expect(hit).not.toBeNull();
    expect(hit!.b.vx).toBeGreaterThan(0);
    expect(hit!.a.vx).toBeLessThan(120);
    expect(hit!.depth).toBeGreaterThan(0);
  });

  it("conserves momentum", () => {
    const a = car({ vx: 140 });
    const b = car({ x: 18, mass: 1800 });
    const hit = resolveCarCollision(a, b)!;
    const before = a.mass * a.vx + b.mass * b.vx;
    const after = a.mass * hit.a.vx + b.mass * hit.b.vx;
    expect(Math.abs(after - before)).toBeLessThan(1);
  });

  it("hurts the lighter car more", () => {
    const light = car({ vx: 160, mass: 900 });
    const heavy = car({ x: 20, mass: 2400 });
    const hit = resolveCarCollision(light, heavy)!;
    expect(hit.damageA).toBeGreaterThan(hit.damageB);
  });

  it("does no damage at parking-lot speeds", () => {
    const hit = resolveCarCollision(car({ vx: COLLISION_CONFIG.minDamageSpeed - 5 }), car({ x: 20 }))!;
    expect(hit.damageA).toBe(0);
    expect(hit.damageB).toBe(0);
  });

  it("still resolves cars spawned exactly on top of each other", () => {
    const hit = resolveCarCollision(car({ vx: 40 }), car({ vx: -40 }));
    expect(hit).not.toBeNull();
    expect(Number.isFinite(hit!.nx)).toBe(true);
    expect(hit!.depth).toBeGreaterThan(0);
  });
});

describe("car on pedestrian", () => {
  it("only shoves at crawling speed", () => {
    const hit = pedestrianImpact(COLLISION_CONFIG.minPedestrianHarmSpeed - 4, 30);
    expect(hit.damage).toBe(0);
    expect(hit.lethal).toBe(false);
    expect(hit.knockback).toBeGreaterThan(0);
  });

  it("kills at speed", () => {
    const hit = pedestrianImpact(120, 30);
    expect(hit.damage).toBeGreaterThan(30);
    expect(hit.lethal).toBe(true);
  });

  it("hurts more the faster the car", () => {
    expect(pedestrianImpact(140, 30).damage).toBeGreaterThan(pedestrianImpact(60, 30).damage);
  });

  it("throws the body harder the faster the car", () => {
    expect(pedestrianImpact(140, 30).knockback).toBeGreaterThan(pedestrianImpact(60, 30).knockback);
  });
});

describe("crime severity", () => {
  it("treats killing as worse than a hit and run, and both as worse than a shove", () => {
    expect(crimeSeverity("homicide")).toBeGreaterThan(crimeSeverity("hit-and-run"));
    expect(crimeSeverity("hit-and-run")).toBeGreaterThan(crimeSeverity("assault"));
  });
});
