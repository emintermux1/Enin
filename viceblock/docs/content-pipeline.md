# Content pipeline

Add missions in `packages/game-core/src/missions.ts` using objective types:

`GO_TO` `TALK_TO` `PICK_UP` `DELIVER` `KILL_TARGET` `ESCAPE_POLICE` `ENTER_VEHICLE` `WIN_RACE` `ROB_LOCATION`

Add vehicles in `packages/game-core/src/vehicles.ts`.
Add landmarks in `apps/web/game/world.ts`.
Named NPCs (Rico, Maya, Cupsey, Ansem, Marcus) live in `ViceblockRuntime3D.seedWorld`
in `apps/web/game3d/runtime3d.ts`, which is the only runtime.
