import { describe, expect, it } from "vitest";
import { TILE } from "@viceblock/shared";
import { blocked, buildSouthside, Cell } from "../game/world";

describe("world spawn points", () => {
  it("the post-arrest release spot outside the precinct is walkable", () => {
    const world = buildSouthside();
    const precinct = world.landmarks.find((l) => l.id === "police");
    expect(precinct).toBeDefined();
    const x = (precinct!.doorX + 0.5) * TILE;
    const z = (precinct!.doorY + 3.5) * TILE;
    expect(blocked(world, x, z, 7)).toBe(false);
    // And the player must be able to step in at least one direction.
    const canMove =
      !blocked(world, x + 20, z, 7) || !blocked(world, x - 20, z, 7) || !blocked(world, x, z + 20, 7) || !blocked(world, x, z - 20, 7);
    expect(canMove).toBe(true);
  });

  it("the chainline mirage parking spot is walkable road", () => {
    const world = buildSouthside();
    expect(blocked(world, 15 * TILE, 65.5 * TILE, 12)).toBe(false);
  });

  it("player spawn is walkable", () => {
    const world = buildSouthside();
    expect(blocked(world, world.spawnX, world.spawnY, 7)).toBe(false);
  });

  it("Southside is a built district, not empty dirt lots", () => {
    const world = buildSouthside();
    let buildings = 0;
    for (const c of world.cells) if (c === Cell.Building) buildings++;
    expect(buildings).toBeGreaterThan(1800);
  });

  it("Rico stands well clear of spawn so he cannot clip into the player", () => {
    const world = buildSouthside();
    const ricoX = 29.5 * TILE;
    const ricoZ = 49.2 * TILE;
    expect(Math.hypot(ricoX - world.spawnX, ricoZ - world.spawnY)).toBeGreaterThan(200);
  });
});
