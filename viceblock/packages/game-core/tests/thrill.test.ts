import { describe, expect, it } from "vitest";
import {
  comboMultiplier,
  driftValue,
  createThrill,
  hitStopSeconds,
  impactShake,
  isDrifting,
  nearMissValue,
  scoreStunt,
  speedCameraDistance,
  speedFov,
  THRILL_CONFIG,
  tickThrill,
} from "../src/thrill";

describe("near miss scoring", () => {
  it("pays nothing when crawling", () => {
    expect(nearMissValue(10, 8)).toBe(0);
  });

  it("pays nothing when the pass is not close", () => {
    expect(nearMissValue(120, THRILL_CONFIG.nearMissRadius + 1)).toBe(0);
  });

  it("pays more the closer and faster the pass", () => {
    const close = nearMissValue(120, 4);
    const wide = nearMissValue(120, 30);
    const slow = nearMissValue(60, 4);
    expect(close).toBeGreaterThan(wide);
    expect(close).toBeGreaterThan(slow);
  });

  it("pays more while wanted", () => {
    expect(nearMissValue(120, 6, 4)).toBeGreaterThan(nearMissValue(120, 6, 0));
  });
});

describe("drift scoring", () => {
  it("ignores flicks of the wheel", () => {
    expect(driftValue(THRILL_CONFIG.minDrift - 0.01)).toBe(0);
  });

  it("scales with how long the slide is held", () => {
    expect(driftValue(2)).toBeGreaterThan(driftValue(1));
  });

  it("detects a sideways car and not a straight one", () => {
    expect(isDrifting(120, 1, 0, 120, 0)).toBe(false);
    expect(isDrifting(120, 1, 0, 90, 80)).toBe(true);
  });

  it("needs speed and motion to count as a drift", () => {
    expect(isDrifting(10, 1, 0, 7, 7)).toBe(false);
    expect(isDrifting(120, 1, 0, 0, 0)).toBe(false);
  });
});

describe("combo meter", () => {
  it("multiplies later stunts in the same run", () => {
    let s = createThrill();
    const first = scoreStunt(s, 100);
    s = first.state;
    const second = scoreStunt(s, 100);
    expect(second.payout).toBeGreaterThan(first.payout);
  });

  it("caps the multiplier", () => {
    expect(comboMultiplier(THRILL_CONFIG.maxCombo + 20)).toBe(comboMultiplier(THRILL_CONFIG.maxCombo));
  });

  it("keeps a zero-value stunt out of the meter", () => {
    const s = createThrill();
    const r = scoreStunt(s, 0);
    expect(r.payout).toBe(0);
    expect(r.state.combo).toBe(0);
  });

  it("lapses after the window and reports the run", () => {
    const banked = scoreStunt(createThrill(), 100);
    const mid = tickThrill(banked.state, THRILL_CONFIG.comboWindow - 0.1);
    expect(mid.lapsed).toBeNull();
    expect(mid.state.combo).toBe(1);

    const done = tickThrill(mid.state, 1);
    expect(done.lapsed).toEqual({ combo: 1, cash: banked.payout });
    expect(done.state.combo).toBe(0);
    expect(done.state.pending).toBe(0);
  });

  it("remembers the best run across lapses", () => {
    let s = createThrill();
    s = scoreStunt(s, 50).state;
    s = scoreStunt(s, 50).state;
    const done = tickThrill(s, THRILL_CONFIG.comboWindow + 1);
    expect(done.state.best).toBe(2);
  });

  it("idles without a combo", () => {
    const r = tickThrill(createThrill(), 5);
    expect(r.lapsed).toBeNull();
    expect(r.state.combo).toBe(0);
  });
});

describe("speed framing", () => {
  it("widens the lens with speed", () => {
    expect(speedFov(1.08, 200, 200)).toBeGreaterThan(speedFov(1.08, 0, 200));
  });

  it("pushes the camera out with speed", () => {
    expect(speedCameraDistance(160, 200, 200)).toBeGreaterThan(speedCameraDistance(160, 0, 200));
  });

  it("survives a zero top speed", () => {
    expect(speedFov(1.08, 50, 0)).toBe(1.08);
    expect(speedCameraDistance(160, 50, 0)).toBe(160);
  });
});

describe("impact feedback", () => {
  it("freezes longer for bigger impacts", () => {
    expect(hitStopSeconds("explosion")).toBeGreaterThan(hitStopSeconds("hit"));
    expect(hitStopSeconds("shot")).toBe(0);
  });

  it("shakes harder for bigger impacts", () => {
    expect(impactShake("explosion")).toBeGreaterThan(impactShake("shot"));
  });
});
