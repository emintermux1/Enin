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
2. Steal the marked **Kite Sparrow** by Coral Mart (`E`). A **Sparrow opens right up; the Mirage has an immobilizer** — you'll get a timing lockpick minigame, and snapping a pick trips the alarm.
3. Drop it at **Maya's Garage**. Maya also repairs engines/tires and wipes GPS trackers off stolen rides for $40.
4. Rob **Coral Mart**. The clerk is a witness — if a bystander gets the call out, units roll to your **last seen position**, not to you. Crimes with zero witnesses raise no heat at all.
5. Break line of sight and the cops sweep a shrinking **search zone** (drawn on the minimap). Swapping cars cuts their recognition range — they remember what you were driving.
6. Robbery loot is **hot goods**, not instant cash — fence it at the **Painted Door**. Your fence rate improves with repeat business.
7. Cornered on foot? Press **G to surrender**: 40 seconds in holding (bail $120) beats the $100 hospital bill, but contraband is confiscated.
8. Pull a **contract** from the phone (jobs tab) — server-generated pickup/drop jobs with server-validated rewards.
9. Watch the **NOVA NEWS** ticker: the world director fires armored trucks, rare gold Mirages, blackouts, storms, crackdowns, and race nights on a weighted no-repeat schedule.
10. Talk to **Cupsey** on Chain Court and **Ansem** at the mural. They stay.

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
| G | Surrender when cornered |
| H | AI assist |

Gamepad (Xbox/PS standard mapping): left stick moves, RT/R2 fires, A/Cross interacts, Y/Triangle phone, RB/R1 radio. A `PAD` badge appears in the HUD meta line when a pad is detected.

Mobile: left stick move, right stick aim+fire (with cone aim assist), canvas drag orbits the camera, E button interacts. Sticks release on `pointerup`, `pointercancel`, blur, and tab hide so they cannot stick.

Gameplay tuning (police speed/spawn distances, aim assist cone and magnetism, vehicle damage stages, economy prices) lives in `packages/game-core/src/config.ts`. Phase-2 systems (lockpick difficulty per security tier, witness report odds, fence rates, contract templates, world-event weights) live in `security.ts`, `crime.ts`, `contracts.ts`, and `director.ts` in the same package.

Server integrity: every reward writes an **audit log** entry (source, amount, reason, reference); contracts settle idempotently off a server-held seed (replays are rejected); and `apps/web/tests/integrity.test.ts` proves a player's balance survives a simulated server restart exactly.

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
  packages/game-core  Shared sim (heat/search zones, vehicles, economy, missions, aim assist,
                      lockpicking, witnesses/fence, contracts, world director, config)
  packages/shared     Types
  packages/database   Postgres schema (not required to play)
  docs/
```

Game first. Token later. `$VICE` is not minted by this slice.
