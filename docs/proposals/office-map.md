# The Office: Regional Processing Office 9

A survival map for both modes: The Crucible (swarm waves) and Endless Humans (squads). The owner asked for a big indoor and outdoor
map with parkour outside, lots of close quarters, and an office that comes apart in a shootout. It is a branch of the Office of
Societal Compliance (docs/campaign/STORY.md): the two-storey podium of a tower, the plaza in front of it, its car park, its service
yard and the alley behind. `?map=office`, or Play / Survival / Office in the menu.

Files: `src/world/map/office/` (plan, shell, outside, rooms, parkour, index), `src/world/breakables.ts` (the destructible props),
tests beside them.

## Layout

x runs east, z runs south, y up. Floors: ground 0, upstairs 4.4, roof 8.8. Those three are the nav levels: a desk, a planter, a
scaffold tier or an AC unit is never floor. Every wall is centred on a whole metre, so the nav cells either side of it are both
blocked and no drop link can cross it (`nav.ts` makes drops two cells out with no wall test).

```
 z -42 ======================== BUREAU ARCHIVE (blank wall, 24 m) =============================================
       |  BACK ALLEY  dumpsters, condensers, gas meters (explode), a van         fire escape 0 > 4.4 > 8.8     |
 z -19 |   +---------------------------------------------------------+                                      |
       |   |SERVER  |COPY  |STAIR|LIFT|SUPPLY |                       |  12 m gap  +---------------------+  |
 SERVICE   | (dark) |      |  A  |    |       |   CUBICLE FARM        |  sign to   |  CAR PARK           |  |
  YARD     +--d-----+--d---+--d--+-dd-+--d----+   (ground)            |  wall-run  |  P0 0, P1 4.4,      |  |
 generator |============ NORTH CORRIDOR =======                       |  on        |  P2 8.8 (open roof) |  |
 fuel tank +--d-----+--d---+                  d                       |  <=====>   |  ramps both sides   |  |
 gas line  | BREAK  |RECORDS|     LOBBY       |                       | skybridge  |                     |  |
 scaffold  | ROOM   +--d---+   reception      |                       | at 4.4     |                     |  |
 (west     d        |WAITING|  turnstiles     |                       |            |                     |  |
  face)    |        |       |                 |                       |            |                     |  |
 z  18     +--------+-------+---[ENTRANCE]----+-----d-----------------+            +---------------------+  |
       |          planters   canopy  gondola        PLAZA   fountain   monument                            |
       |   benches                                                                                           |
 z  46 |------------------------------------- STREET: parked cars, bus shelter ------------------------------|
 z  60 ======================== shop fronts (blank) ==========================================================
       x -70          x -28                    x 0                   x 28        x 40                 x 70
```

Upstairs (4.4) on the same shell: the Director's office over the server room, the print room, the stair gallery, the IT room,
the north corridor, two executive offices in the west strip, two glass meeting rooms beside them, and an L-shaped open office of
cubicle pods over the lobby and the east wing. Roof (8.8): AC units, vents, skylights over the open office, the roof stair, the
lift's machine room, and the tower (a blank glass shaft from 8.8 to 60 m over the west half, out of bounds) with a window
washer's gondola on its south face.

| Room | Floor | Box (x0, z0, x1, z1) | Ways in |
|---|---|---|---|
| Server room | 0 | -28, -18, -14, -6 | corridor, copy room. No windows, lit by rack LEDs: the dark fight |
| Copy room / Print room | 0 / 4.4 | -14, -18, -4, -6 | corridor, server room, alley door (ground) |
| Stair A | 0 to 4.4 | -4, -18, 2, -6 | corridor both floors. Flight on the west side, gallery on the east |
| Lift shaft | 0 to 12 | 2, -18, 6, -14 | open doors at 0, 4.4 and the roof. A 3.7 m chimney to climb |
| Supply / IT | 0 / 4.4 | 6, -18, 14, -6 | corridor; supply has an alley door |
| North corridor | both | -28, -6, 14, -2 | opens east into the cubicles and south into the lobby / open office |
| Break room | 0 | -28, -2, -14, 18 | corridor, records, waiting, yard door |
| Records, Waiting | 0 | -14, -2, -4, 8 and -14, 8, -4, 18 | corridor, break room, lobby |
| Lobby | 0 | -4, -2, 14, 18 | open to the corridor, the entrance (6 m), cubicles |
| Cubicle farm | 0 | 14, -18, 28, 18 | corridor, lobby, two car park doors, plaza door |
| Director, Exec 2 and 3 | 4.4 | west strip | corridor, suites, broken bays onto the scaffold |
| Meeting A, B (glass) | 4.4 | -14, -2, -4, 18 | glass doors to the open office and the execs |
| Open office | 4.4 | -4, -2, 28, 18 and 14, -18, 28, -2 | corridor, skybridge, fire escape, gondola window, roof stair |

Outside, all open sky: the plaza and street (south), the service yard (west), the alley (north), the car park's roof, and the
building's roof. Doors are 2.4 m (the lobby's openings wider), corridors 4 m, aisles between pods 3 m: wide enough that a pack
of husks does not jam, narrow enough that every room is a corner fight.

## Loops

- **Ground ring:** lobby, corridor, break room, yard, plaza, lobby. Every room off the corridor has two ways out.
- **East loop:** cubicles, car park P0, ramp to P1, skybridge to the open office, stair A, corridor, cubicles.
- **North loop:** corridor, copy room, alley door, alley, fire escape to the open office, stair A.
- **Roof loop:** roof stair, roof, fire escape down, alley, any door in. Skylights drop back into the open office.
- **Parkour loops (players only):** the plaza climb, the scaffold, the rooftop gap, all ending at a broken window back inside.

The squads get flanks from these: any room can be reached two ways and every floor three. The swarm gets the same routes and
the open plaza, yard and car park to bunch in before a door.

## Parkour

Numbers from `docs/notes/player.md` and `campaign/parkour.ts`: jump 1.4 m high, a jump and mantle reaches 3 m, a jump and climb
5.5 m, run 12.5 m/s, a wall run up to 1.8 s at 15 m/s.

| Line | Moves |
|---|---|
| Plaza climb | planter (0.9) to the entrance canopy (3.9): jump and mantle. Canopy to the gondola (5.4): a 4 m gap, double jump. The gondola's broken window steps into the open office; or jump and climb to the parapet (9.8) |
| Scaffold | yard to tier 1 (2.2) to tier 2 (4.4, the broken bays into the executive offices) to tier 3 (6.6) to the parapet: four jump-and-mantles, a 4 m gap between the two bays of tier 2 |
| Rooftop gap | 12 m from the roof to the car park's roof. A run and one jump falls short; a double jump just makes it; the sign over the gap is the wall run that makes it easy. The skybridge's roof (8.0) below is the slow way |
| Lift shaft | a chimney 3.7 m wide from the ground to the machine room (12) |
| Tower gondola | an AC unit (11) to the gondola on the tower (13): jump and mantle. A perch over the roof and the plaza |

## Destructibles

`src/world/breakables.ts`: one system for every prop that breaks, owned by `world/objects.ts` beside the barrels and walls, so a
bullet (`damageExplosive`), a blast (`damageExplosivesInRadius`) and a chain all reach it the same way. Each kind is one instanced
mesh per material while whole and one for its wreck, so 14 kinds cost about 30 draw calls however many are placed.

| Kind | Health | When it goes |
|---|---|---|
| Monitor, computer | 12 | sparks, a zap, glass and plastic chips; a dead screen stays on the desk |
| Plant | 10 | the pot shatters, soil sprays, the plant lies in the dirt |
| Chair | knocked, 60 to break | a hit throws it (a real Rapier body), it tumbles and settles where it lands, and can be shot again; enough breaks it into pieces |
| Divider | 30 | falls in pieces, which are thrown by the next blast. The gap opens on the nav |
| Glass pane | 8 | shatters: shards, the sound, the hole opens on the nav |
| Microwave | 20 | sparks and a small pop (radius 2) |
| Water cooler | 20 | bursts: water, steam, a small pressure blast (radius 2.5) |
| Fire extinguisher | 15 | bursts: a white fog cloud and a pressure blast (radius 3) |
| Copier | 60 | explodes (radius 4.5): toner smoke and a flurry of paper |
| Vending machine | 120 | sparks at half, then explodes (radius 5): cans everywhere |
| Server rack | 90 | sparks at half, then explodes (radius 5); the burnt rack keeps sparking |
| Generator | 100 | explodes (radius 9), like a fuel tank |
| Gas line valve | 40 | explodes (radius 7); valves along one line set each other off |

Explosions raise `world:explosion` exactly as a barrel does, so Combat hurts enemies and the player and throws bodies, chairs and
debris; then, a beat later, they hurt every other world object in reach, so a copier sets off the cooler beside it and a row of
racks goes one after another. Barrels and tanks reach breakables the same way.

**Budget (8 GB M1, 60 fps).** Caps: 24 chairs moving at once (the oldest freezes where it is), debris shared with the walls
(90 bodies, 160 pieces a material), 64 queued chain links, one burning-rack spark per 0.4 s. Wrecks stay for the whole run; flying
pieces lie 16 s and shrink. Nothing is created while playing except Rapier bodies from fixed pools.

## Detail and budget

Static geometry merged by material (the kit's `Geo`), the props instanced, the lights baked into the light volume like every other
map. Targets, the Kill House's and the Outpost's numbers as the ceiling: under 300k static triangles, under 900 colliders, under
150 baked lights, under 200 draw calls in a busy wave.

Signage in the Bureau's voice: NOW SERVING 0000, PLEASE TAKE A NUMBER, COMPLIANCE IS MANDATORY, SMILE: YOU ARE BEING AUDITED,
FORMS MUST BE FILED IN TRIPLICATE, THE LIFT IS UNDER REVIEW, MORALE IS MONITORED.

## Modes

Both survival contracts play here. `ContractDef.alsoOn` lists maps a contract also runs on, with that map's own notice, so the
Crucible and Endless Humans keep their rules, shop, starting guns, waves and AI unchanged, and each keeps a separate high score on
the Office. The menu shows Play / Survival / Office / The Crucible and Endless Humans. Co-op's mode list gets both on the Office.

- **Waves:** authored entrances at the edges (street ends, yard, alley ends, car park), so both the swarm's spawner and the
  squads' gates come in from outside and work inward. Flyers enter high over the plaza, alley and car park.
- **Squads:** cover is derived from the map (`CoverMap`), doors are listed in the plan for room clearing.
- **Supply pod:** pickup spots on the plaza, yard, alley, both roofs: all open sky, at most about 70 m from anywhere.

## Stages

a. Blockout: shell, floors, stairs, outside, car park, collision, nav, spawns, both modes, registration and menu, tests.
b. Dressing: desks, counters, shelves, ceilings, lights, signage, materials.
c. Destructibles and explosives.
d. Parkour: scaffold, gondolas, sign, the lift shaft.
e. Minimap, lighting bake, performance.
