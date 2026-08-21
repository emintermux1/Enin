import { describe, expect, it } from "vitest";
import { AIM_ASSIST_CONFIG, assistAim, normalizeAngle } from "../src/config";

describe("aim assist", () => {
  it("pulls heading toward a target inside the cone", () => {
    const r = assistAim(0, 0, 0.1, [{ id: "t", x: 100, y: 0, isPlayer: false }]);
    expect(r.targetId).toBe("t");
    expect(Math.abs(r.heading)).toBeLessThan(0.1);
  });

  it("ignores targets outside the cone", () => {
    const r = assistAim(0, 0, 0, [{ id: "t", x: 0, y: 100, isPlayer: false }]);
    expect(r.targetId).toBeNull();
    expect(r.heading).toBe(0);
  });

  it("uses weaker magnetism against players", () => {
    const npc = assistAim(0, 0, 0.2, [{ id: "n", x: 100, y: 0, isPlayer: false }]);
    const pvp = assistAim(0, 0, 0.2, [{ id: "p", x: 100, y: 0, isPlayer: true }]);
    expect(Math.abs(pvp.heading)).toBeGreaterThan(Math.abs(npc.heading));
  });

  it("fades at long range", () => {
    const far = assistAim(0, 0, 0.15, [{ id: "f", x: AIM_ASSIST_CONFIG.maxRange - 4, y: 0, isPlayer: false }]);
    const near = assistAim(0, 0, 0.15, [{ id: "n", x: 80, y: 0, isPlayer: false }]);
    expect(Math.abs(far.heading)).toBeGreaterThan(Math.abs(near.heading));
  });

  it("normalizes angles", () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
  });
});
