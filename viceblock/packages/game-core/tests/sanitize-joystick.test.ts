import { describe, expect, it } from "vitest";
import { looksLikeMarkup, sanitizeText } from "../src/index";
import { beginStick, moveStick, releaseStick } from "../src/joystick";
import { applyVehicleDamage, createVehicleRuntime, tickVehicleExplosion } from "../src/vehicles";

describe("sanitize", () => {
  it("strips html paste junk", () => {
    expect(sanitizeText('<div class="x">Rico</div>')).toBe("Rico");
    expect(looksLikeMarkup("<span>hi</span>")).toBe(true);
  });
});

describe("joystick", () => {
  it("releases to a zero stick so it cannot stay stuck", () => {
    const a = beginStick(3, 40, 400);
    const b = moveStick(a, 3, 80, 400, 56);
    expect(b.dx).toBeGreaterThan(0.4);
    const c = releaseStick(b);
    expect(c.active).toBe(false);
    expect(c.dx).toBe(0);
    expect(c.pointerId).toBeNull();
  });

  it("ignores a second finger on an active stick", () => {
    const a = beginStick(1, 10, 10);
    const b = moveStick(a, 99, 90, 10, 56);
    expect(b.dx).toBe(0);
  });
});

describe("vehicle explosions", () => {
  it("can explode after lethal damage", () => {
    let v = createVehicleRuntime("sparrow", 0, 0, 0, "#c44");
    v = applyVehicleDamage(v, 999, false);
    expect(v.health).toBe(0);
    v = tickVehicleExplosion(v, 0.4);
    expect(v.exploded).toBe(true);
  });
});
