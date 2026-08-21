import { describe, expect, it } from "vitest";
import { SPIDER_CONFIG, anchorUsable, initialLength, releaseSwing, stepAirborne, stepSwing, zipVelocity, type SwingState, type WebLine } from "../src/spider";

const still = (x = 0, y = 100, z = 0): SwingState => ({ x, y, z, vx: 0, vy: 0, vz: 0 });
const idle = { lean: 0, steer: 0, reel: false };

function swing(steps: number, input = idle, state = still(120, 100, 0), line: WebLine = { x: 0, y: 260, z: 0, length: 200 }) {
  let s = state;
  let l = line;
  for (let i = 0; i < steps; i++) {
    const out = stepSwing(s, l, input, 0, 1 / 60);
    s = out.state;
    l = out.line;
  }
  return { s, l };
}

describe("web swinging", () => {
  it("turns a fall into an arc instead of dropping straight down", () => {
    const { s } = swing(60);
    expect(Math.abs(s.vx)).toBeGreaterThan(40);
  });

  it("never lets the line stretch past its length", () => {
    const line: WebLine = { x: 0, y: 260, z: 0, length: 200 };
    let s = still(120, 100, 0);
    let l = line;
    for (let i = 0; i < 600; i++) {
      const out = stepSwing(s, l, { lean: 1, steer: 0.4, reel: false }, 0, 1 / 60);
      s = out.state;
      l = out.line;
      expect(Math.hypot(s.x - l.x, s.y - l.y, s.z - l.z)).toBeLessThanOrEqual(l.length + 0.01);
    }
  });

  it("swings back up the far side rather than bleeding out at the bottom", () => {
    const { s } = swing(45, { lean: 1, steer: 0, reel: false });
    const climbing = swing(120, { lean: 1, steer: 0, reel: false });
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(0);
    expect(climbing.s.y).toBeGreaterThan(60);
  });

  it("reels the line in but never past the minimum", () => {
    const { l } = swing(600, { lean: 0, steer: 0, reel: true });
    expect(l.length).toBe(SPIDER_CONFIG.minLength);
  });

  it("holds a speed ceiling so the city stays readable", () => {
    const { s } = swing(1200, { lean: 1, steer: 0, reel: true });
    expect(Math.hypot(s.vx, s.vy, s.vz)).toBeLessThanOrEqual(SPIDER_CONFIG.maxSpeed + 0.01);
  });

  it("converts an upward arc into height when you let go, and does nothing when you are already falling", () => {
    expect(releaseSwing({ ...still(), vy: 100 }).vy).toBe(100 + SPIDER_CONFIG.releaseBoost);
    expect(releaseSwing({ ...still(), vy: -100 }).vy).toBe(-100);
  });

  it("falls when nothing is attached, and steers where it is pushed", () => {
    let s = still(0, 400, 0);
    for (let i = 0; i < 60; i++) s = stepAirborne(s, { lean: 1, steer: 0, reel: false }, 0, 1 / 60);
    expect(s.y).toBeLessThan(400);
    expect(s.vx).toBeGreaterThan(0);
  });

  it("refuses anchors that are level with you or out of reach", () => {
    expect(anchorUsable(0, 0, 0, 100, 10, 0)).toBe(false);
    expect(anchorUsable(0, 0, 0, 100, 120, 0)).toBe(true);
    expect(anchorUsable(0, 0, 0, SPIDER_CONFIG.maxRange + 200, 120, 0)).toBe(false);
  });

  it("starts the line taut at the distance to the anchor, within limits", () => {
    expect(initialLength(0, 0, 0, 0, 300, 0)).toBe(300);
    expect(initialLength(0, 0, 0, 0, 10, 0)).toBe(SPIDER_CONFIG.minLength);
    expect(initialLength(0, 0, 0, 0, 5000, 0)).toBe(SPIDER_CONFIG.maxLength);
  });

  it("zips toward the anchor with a lift so you clear the lip", () => {
    const v = zipVelocity(0, 0, 0, 0, 300, 0);
    expect(v.vy).toBeGreaterThan(SPIDER_CONFIG.zipSpeed);
    expect(Math.abs(v.vx)).toBeLessThan(0.001);
  });
});
