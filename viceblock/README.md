# VICEBLOCK

Playable 3D Southside slice of a browser crime sandbox (Babylon.js). Guest first. Wallet optional. Music is generated in the browser — it is not a missing file.

## Play

```bash
cd viceblock
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), name yourself, hit **ENTER SOUTHSIDE**.

### First ten minutes

1. Walk to **Rico's Hideout** (east of the walk-up).
2. Steal the marked **Kite Sparrow** by Coral Mart (`E`).
3. Drop it at **Maya's Garage**.
4. Rob **Coral Mart**. Cops are slow — break line of sight, hide in an alley, heat falls.
5. Smash a car enough (ram or shoot) and it can **explode**.
6. Talk to **Cupsey** on Chain Court and **Ansem** at the mural. They stay.

### Controls

| Desktop | Action |
| --- | --- |
| WASD | Walk / steer (camera-relative) |
| Shift | Sprint |
| Space | Jump on foot / handbrake in car |
| E | Interact / enter-exit car |
| Click | Shoot (after the mart job hands you a pistol) |
| Right-drag | Orbit camera |
| R | Cycle radio |
| F / Tab | Phone |
| H | AI assist |

Mobile: left stick move, right stick aim+fire (with cone aim assist), canvas drag orbits the camera, E button interacts. Sticks release on `pointerup`, `pointercancel`, blur, and tab hide so they cannot stick.

Gameplay tuning (police speed/spawn distances, aim assist cone and magnetism, vehicle damage stages, economy prices) lives in `packages/game-core/src/config.ts`.

Paste is forced to plain text. HUD strings are stripped of tags so HTML copy junk cannot render.

## Commands

| Script | What |
| --- | --- |
| `pnpm dev` | Web + presence server |
| `pnpm test` | Core + web unit tests |
| `pnpm build` | Production build |
| `pnpm start` | Serve built apps |

## Repo

```
viceblock/
  apps/web            Next.js shell + Babylon.js 3D engine (game3d/) + legacy 2D renderer (game/)
  apps/game-server    WebSocket presence
  packages/game-core  Shared sim (heat, economy, missions, aim assist, config)
  packages/shared     Types
  packages/database   Postgres schema (not required to play)
  docs/
```

Game first. Token later. `$VICE` is not minted by this slice.
