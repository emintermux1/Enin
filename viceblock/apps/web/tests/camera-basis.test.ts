import { describe, expect, it } from "vitest";
import { cameraFromHeading, headingFromCamera } from "../game3d/runtime3d";

/**
 * The camera stores a yaw; everything else in the world stores a heading. They
 * are not the same number, and the conversion is not its own inverse the way
 * negation is. Getting that backwards is silent: the view still turns, just
 * mirrored, so reset-view aimed away from the player and the opening shot
 * framed the wrong side of the street.
 */
describe("camera yaw and world heading", () => {
  const angles = [0, 0.4, 1, Math.PI / 2, 2, 3, -0.7, -Math.PI / 2, -2.9];

  it("round-trips a heading through camera space", () => {
    for (const h of angles) expect(headingFromCamera(cameraFromHeading(h))).toBeCloseTo(h, 10);
  });

  it("round-trips a camera yaw through world space", () => {
    for (const y of angles) expect(cameraFromHeading(headingFromCamera(y))).toBeCloseTo(y, 10);
  });

  it("is not plain negation, which is what it used to be written as", () => {
    // Facing east, the two disagree by a half turn. Everywhere this was spelled
    // `heading - PI/2` the camera ended up looking the opposite way.
    expect(Math.abs(cameraFromHeading(0) - (0 - Math.PI / 2))).toBeCloseTo(Math.PI, 10);
  });
});
