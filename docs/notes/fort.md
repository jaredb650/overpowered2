# The fort

Piece 6 of `docs/proposals/outpost-defense.md`: the Outpost Defense map. Files: `src/world/map/fort/`. Outpost Defense plays here
(`docs/notes/contracts.md`, Outpost Defense): its shops are `FORT_SHOPS`, hires take `FORT_POSTS`, the wave director brings men from
`FORT_SPAWNS` and machines up `FORT_LANES`, enemy mortar teams use `FORT_MORTARS`, and the player's own use the mortar posts.

| URL | What |
|---|---|
| `/?map=fort&autostart=1` | Outpost Defense (the fort is its map now) |
| `/?map=fort&contract=crucible&autostart=1` | The swarm on the fort |
| `/?map=fort&contract=outpost&autostart=1` | Human squads |
| `/?map=fort&contract=outpost&allies=6&autostart=1` | With six allies round the player in the core |
| `/?sandbox=map&map=fort&view=overview` | Fly camera. Views below |

Views: `overview`, `high`, `core`, `infirmary`, `middle`, `armoury`, `outer`, `barracks`; inside the shops `barracksShop`, `armouryShop`,
`infirmaryShop`; on the walls `catwalk`, `crenel`, `gun`, `tower`, `towerOut`, `gate`, `gateIn`, `middleGate`, `wallOut`; the nooks
`motorPool`, `waterTower`, `comms`, `hqRoof`; the field `field`, `fieldWide`, and one a side from outside: `north`, `east`, `south`, `west`.

| File | Holds |
|---|---|
| `plan.ts` | Every number, and all the data other systems read (below). No three.js |
| `rings.ts` | Walls and gates, the catwalk gantry, guard towers, gatehouses, pillboxes, gun blockhouses, stairs |
| `buildings.ts` | The three shops (counter, keeper's floor, shelves), the magazine, the core's mast and flag |
| `base.ts` | Everything else inside the rings: motor pool, fuel point, mess tent, water tower, huts, helipad, HQ, containers, ammo dump, comms tower, vehicle bay, generators |
| `props.ts` | The fort's own props: huts, army trucks, fuel tanks, drums, tents, dishes, lattice masts, stair towers, craters, wire, rocks, dead trees, ruins, booths, barrier arms, sandbag nests, dragon's teeth, signboards, ammo stacks |
| `field.ts` | Ground, roads, the fence, and each side of the field (below) |
| `index.ts` | Stages, zones, spawns, player spawns and views |
| `fort-map.test.ts` | The proof |

## The layout

```
 field to the fence at 114 m, nav to 120 m. Roads N-S (asphalt) and E-W (gravel), a track round the walls at 64 m
 +--------------------------- outer ring, 104 m square, yellow -----------------------------+
 | tower      motor pool  fuel   GATE 1   pillbox   mess tent   gun      water tower  tower |  4 gates, one mid-side, 6 m
 |    +------------- middle ring, 64 m square, blue ------------ tower (NE)                  |  2 gates, N at x 14, S at x -14
 |    |  comms tower   armoury (N band)   GATE 5  pillbox            |   barracks huts      |  2 guns, E and W
 |    |      +--- core, 28 m square, red ---+                         |   helipad            |
 | ammo  gen-|  infirmary   flag   mast     |GATE 7      vehicle bay  |   huts (firing roof) |
 | dump  sets|               magazine       |                         |                      |
 |    |      +------------------------------+                         |                      |
 |    tower (SW)   hut           GATE 6                               |   container stack    |
 | trucks   barracks (shop)              GATE 3       HQ (firing roof)                         |
 +------------------------------------------------------------------------------------------+
```

x runs east, z south. Each ring is authored as its north side and turned (`rot`, `turnYaw`); `base.ts` is in world coordinates.

- **Walls** are the destructible segments (`spec.wall` with `FORT_WALL`), 4 m pillar to pillar, 5.65 m tall from the field and 0.8 m
  thick on 1 m pillars, with a battlement: in each segment a crenel 1 m wide between two merlons, and a loophole slit in every merlon.
  From the catwalk (3.8 m) the crenel's sill is 1.15 m up, so a crouching man (eye 0.86) is under it and a standing one (eye 1.62)
  fires over it; the merlons are 1.85 m, over a standing head; the slits run 1.30 to 1.67 m, at a standing eye. 184 segments, 8 gates.
  Health scales with length (structures.ts), so a breach costs what it did on the old 3 m wall: 300 + 300 for a 4 m segment.
- **Gates** are lift gates (`spec.wallGate(..., opens = true, FORT_WALL)`): they rise for the player or an ally within 4.5 m and drop
  once nobody friendly is within 6 m and the gap is clear. Each has a **gatehouse**: concrete piers either side of the passage under
  the catwalk, a roof braced out over the bridge, a lit `GATE n` sign (1 to 4 outer N, E, S, W; 5 and 6 middle N and S; 7 and 8 core E
  and W), a floodlight down the approach, chevrons and the number on the passage floor. Inside every outer and middle gate stands a
  concrete **pillbox** on the right of the passage, its slits across it and its door at the back.
- **The catwalk** is a steel gantry behind every wall, from the wall's back face (0.42 m in) to 3 m in, at `LEVEL.deck` 3.8: a grate deck
  on cross beams, a girder on the yard side carried by posts every 4 m with knee braces, a rail and a hazard edge, a cable tray, a
  stripe in the ring's colour, white caged lamps every 20 m. It runs unbroken round every ring, **over the gates too** (the bridge), and
  only the gun blockhouses cut it. It is open underneath: a breach opens under it into the yard, and the strip under it is shade and
  cover. Stairs from the yard: one beside each gate (left of its pier) and the ring's own (`RingDef.stairs`), 4.8 m runs.
- **Guard towers** in the corners of the outer ring (all four) and the middle ring (NE and SW): a concrete block to `LEVEL.tower` 7 m, on
  it a cabin with breast walls 1.1 m high, windows to 2.15 m on the two outer faces under a concrete lintel, a tin roof, sandbags in
  the corner window and a floodlight on the roof edge. Open steel stairs climb from the catwalk on both sides through gaps in the
  inner faces. Snipers' posts.
- **Mounted guns**: six, each on a concrete blockhouse under the catwalk whose top is a firing step at `LEVEL.gun` 4.3 m, with steel
  ramps up from the deck at each end, sandbagged cheeks either side of the gun and an ammunition box. In front of each the wall is a
  4 m **port** (`FORT_PORT`, the body only, 4.95 m), so the trunnion (5.5 m) sweeps over it. The gun's own shield (emplacement.ts) covers
  the gunner. One per side of the outer ring at x 26 (local), two on the middle ring (E and W).
- **Shops**: the barracks (outer ring, south band), the armoury (middle ring, north band) and the infirmary (core, north-west corner)
  with a sandbagged magazine in the core's south-east corner. Each is a walk-in box with one doorway, a lit sign and a band in its
  ring's colour. Inside, from the back wall (`COUNTER` in plan.ts): shelves of stock to 0.42 m, the **keeper's floor** (he stands at
  0.98 m, lit by his own lamp), then the counter from 1.55 to 2.25 m with a till on it, and the buyer at 2.9 m. The counter's right
  end stops short of the side wall under a hinged flap: the keeper's way round.

### Inside the rings

Every corner of the base is its own place, and several are a height to fight from (`LEVEL.roof` 3 m and `LEVEL.tower` 7 m are floors):

| Where | What | Fight from |
|---|---|---|
| Outer north | The motor pool: a three-bay shed, two army trucks in it, bay numbers, oil, tyres. The fuel point: two bowsers behind a sandbag berm, red drums, `FUEL POINT` and `NO SMOKING` boards, and three real explosive barrels. The mess tent: tables and benches under canvas. The water tower in the north-east corner. A floodlight mast. The road from gate 1 round to gate 5 | Motor pool roof (3 m, sandbag lip, stairs at its east end). Water tower platform (7 m, two flights, a landing, sandbags under the tank) |
| Outer east | Three barracks huts with lit windows, washing lines and duckboards between them. The helipad with corner lights and a windsock. A sheet shack | The south hut's roof (3 m, sandbags, stairs) |
| Outer south | HQ with a dish and a red lattice mast on its roof, parade lines, the barracks shop, a container stack (two on the ground, one across) with stairs to the lower roof, a floodlight mast | HQ roof (3 m). The containers (2.6 m, and 5.2 m by a mantle) |
| Outer west | The ammunition dump: three sandbag bays, an ammo stack under a camouflage net in each, `AMMO DUMP` and `NO SMOKING`. Two parked trucks, tyres, drums, a plank shack, a mast | |
| Middle | The comms tower (north-west: a cabin, a lattice mast and two dishes on a 7 m platform, cables to the armoury and the core). The vehicle bay (east: two bays, a truck). A hut (south). Two generators with drums and a cable (west). Two masts, two sandbag nests, a sheet shack | Comms platform (7 m). Vehicle bay roof (3 m) |
| Core | The infirmary with a dish on its roof, the magazine, the flag, a mast, a sandbag nest | |

### The field

Each side of the field is its own ground (`field.ts`, `THEMES`), authored in its turned frame. Shacks are per side too (`SHACKS`):

- **North, the road and the checkpoint.** The asphalt road in, a guard booth either side with its barrier arm raised, jersey barriers
  lining the road, a sign gantry over it (`CHECKPOINT`, `HALT`), street lamps, a burnt army truck and a burnt heavy truck, a container,
  sandbag nests, craters, and the tank traps under the walls.
- **East, the ruined village.** Seven ruined houses either side of the gravel road (block walls of uneven height with window and door
  holes, a two-storey corner with a floor slab hanging off it, the roof fallen in), fires still burning in three of them and a car
  burning in the street, rubble heaps, dead trees, a burnt truck, shacks among the houses.
- **South, the ditch and wire.** A spoil bank 1.3 m high either side of the road (a flat top that is no floor: men cross it at its gaps,
  ends and the road), wire in front of it on pickets with `MINES` boards, searchlights on poles at the bank's ends, fighting holes,
  shell craters everywhere, two burnt trucks, and dragon's teeth under the walls instead of tank traps.
- **West, the rocky rise.** A mesa with a flat top at `LEVEL.rise` 3.5 m (a floor: men stand on it), ramps up its west face and the face
  toward the fort, boulders round the others, a sandbag perch, a broken relay mast and a fire on top; an outcrop and boulders down
  the slope, dead trees, a burnt truck.

Common to all four: two enemy mortar pits, a painted landing zone, two burning drums (the east side's are in the village), the
shacks. Lanes, the track, the landing zones and the spawns are kept clear (the test sweeps them).

## The data (`plan.ts`)

All plain tuples `[x, y, z]` and camera yaws (0 looks north, down -z). The exports and their shapes are what they were before the
overhaul; `FortShop.keeper` is new.

| Export | What | Count |
|---|---|---|
| `FORT_SHOPS` | `{ id, ring, name, anchor, yaw, keeper, door, target }`. `anchor` is the floor where the buyer stands at the counter; `yaw` is the buyer's facing (toward the counter); `keeper: { pos, yaw }` is where the shopkeeper stands behind the counter, on the floor, facing the buyer (`yaw + π`); `target` is the building's box, for the shop's health and the attackers' aim | `barracks`, `armoury`, `infirmary` |
| `FORT_RALLY` | Where a new hire gathers: the yard outside the barracks door | 1 |
| `FORT_POSTS` | `{ id, type, ring, pos, yaw, gun? }`. Types: `rifleman` (catwalks, each at a crenel), `gunner` (the guns' seats, `gun` is the index in `spec.emplacements` and `FORT_GUNS`, and catwalk corners with no tower), `sniper` (in the guard towers), `rocketeer` (the crenel just past each gate), `shotgunner` (outside each shop door), `medic` (the core), `mortar` (the player's teams, middle ring yards) | 18, 8, 6, 8, 3, 1, 4 |
| `FORT_BREACH_POINTS` | `{ ring, pos }`: where riot police stand by, one a stretch of yard | 4 outer, 4 middle, 1 core |
| `FORT_GUNS` | `{ ring, pos, yaw, arc }` of the mounted guns, in `spec.emplacements` order | 6 |
| `FORT_SPAWNS.foot` | Infantry spawns at 104 to 108 m, facing the fort. Also the map's `spec.spawns` (ground) | 16 |
| `FORT_SPAWNS.vehicle` | `{ lane, pos, yaw }` at the start of each lane | 8 |
| `FORT_SPAWNS.air` | Flyers, 30 m up over the fence. Also `spec.spawns` (air) | 8 |
| `FORT_LANES` | `{ id, points, width }`: up each road to the track (14 m) and in from each corner (12 m) | 8 |
| `FORT_ROADS` | The same shape; also `spec.roads`. `north`, `east`, `south`, `west`, `track` | 5 |
| `FORT_LZ` | `{ pos, radius }` landing zones, 9 m clear | 4 |
| `FORT_MORTARS` | `{ pos, yaw }` enemy mortar spots, each behind a sandbag crescent, 30 to 40 m out from the outer wall | 8 |
| `RINGS`, `ring(id)`, `ringAt(x, z)` | The rings, and which ring a ground point is in (by the wall lines), or null in the field | |
| `LEVEL` | Floors: ground 0, deck 3.8, gun 4.3, tower 7, roof 3, rise 3.5. The nav's levels | |
| `FORT_WALL`, `FORT_PORT` | The walls' `WallStyle`s | |
| `wallRuns(r, side)`, `crenels(r, side)`, `crenelAt(r, side, u)` | A side's wall line as runs (battlement, port, gate) and where its crenels are | |
| `RAMPART`, `BASTION`, `STAIR`, `GUN_PAD`, `COUNTER` | The catwalk's depth (siege.ts reads it), the towers, the stairs, the gun steps, the shop counters | |

Zones: `fort-core`, `fort-middle`, `fort-outer`, `fort-field` (THE CORE, MIDDLE RING, OUTER RING, THE FIELD). Walls and gates:
`ctx.world.objects.structures`; `ctx.world.objects.walls.setOpen(gate, open)` and `isOpen(gate)` drive a lift gate by hand.

## Proving it

```
nice npx vitest run src/world/map/fort/fort-map.test.ts --testTimeout=60000     # about 4 s
OP2_VIEWS=overview,crenel,tower,north,east,south,west OP2_BLAST=1 OP2_WALL=1 node tools/shot.mjs --url "/?sandbox=map&map=fort" \
  --script tools/scripts/fort-shots.mjs --out tools/out/fort2/v.png --wait 2500 --dpr 2 --w 1440 --h 900 --timeout 280
node tools/shot.mjs --url "/?map=fort&allies=6&autostart=1" --script tools/scripts/fort-game.mjs --wait 500 --timeout 300 --dpr 2 --w 1440 --h 900 --out tools/out/fort2/g.png
```

The test builds the real world (Rapier, the nav sample, the walls up after it) and checks: the walls are over 5 m and a segment's
health is 75 a metre; every rifleman fires through his crenel standing, is under the sill crouched, has a merlon over his head a
step to the side and a slit at his eye; every 2 m of every catwalk (over the gates too) and every tower top is floor the core can
reach; with every gate shut nothing in the field reaches the outer yard, and opening each ring's gates in turn opens exactly that
ring; a breach in the north wall is a way in under the catwalk and its repair closes it; each shop's anchor is floor inside its own
building, in its ring, with the counter in front of it, and its keeper is floor inside, behind the counter from the buyer, facing him,
with standing room and a way round to the core; every post, breach point and the rally point is floor in its ring the core can reach;
every spawn is at least 30 m outside the outer wall with a way on foot to every outer gate; every mortar spot is floor with sandbags
toward the fort; lanes and roads swept at their full width at 0.5 and 2.4 m, and the landing zones, hit nothing.
`structures.test.ts` checks the debris: a shack's pieces fly away from the blast, settle on the floor, give their bodies back and
fade; the body cap holds; a blast throws resting wreckage again; a wall dropping a stage throws lumps.

| Measure | Fort | For scale |
|---|---|---|
| Static | 216k triangles, 979 colliders, 110 baked lights, 184 wall segments, 8 gates, 31 shacks | Outpost 257k, 457, 131. The old fort 96k, 259, 65 |
| Nav | 50.9k nodes, 0.44 s | Outpost 37.7k |
| Build | 2.8 s all in, the light bake 2.3 s of it | |
| Draw calls, map sandbox (no characters) | 98 (a tower, a crenel) to 229 (the field looking in), 210k to 410k triangles in view, CPU 1.3 to 4 ms | Old fort 142 to 188; Outpost sandbox 90 to 118 |
| Debris | One shack: 60 bodies, CPU 4 to 8 ms while they fly, then 0; four at once: the 90-body cap | |
| Draw calls, real game, 6 allies and a wave | see the last report | Old fort 155 to 245; Outpost 151 to 196 |

Frame rates in the harness at 2x are the harness's, not the map's; other agents' browsers were running.

## Rough

- **Nobody has played it.** The ring sizes, the lanes and how far out the spawns are are guesses for a siege, and the new walls
  change the fight: the field is now shot at from crenels, slits, towers, roofs and the water and comms towers.
- **A drop over the wall.** Walls go up after the nav sample, so the nav still has drop links from the catwalk's outer edge to the field
  beyond the wall line. A man on the catwalk who wants the field could take one and walk through the wall (enemies have no collider).
  Nothing sends anyone that way today; the enemy on the catwalk wants the player inside.
- **Engineers' jump pads** (siege.ts) land on the catwalk at `LEVEL.deck` behind a damaged wall; their arc was tuned for the 3 m wall
  and has not been watched over a 5.65 m one.
- **Lift gates pop up and down** in one frame, with a clang; no animation. The raised leaf (to 6.3 m) stands in front of the gatehouse
  bridge while it is up.
- **Towers, gun blockhouses, gatehouses, pillboxes and the base's buildings are not destructible.** Only walls, gates and shacks are.
- **Ground puddles** read as pale blotches from high up under the moon. They are the dirt material's wetness, as on every map.
- **The spoil bank's top is no floor,** so men go round it, not over; the player can stand on it.
- **Landing zones are only data and paint.** The enemy helicopter does not land, and nothing else uses them.
- **Engineers' sandbag walls are not in the cover map**, which is built at load. The siege sends men behind them by hand.
- **Colliders** are 979, over the old budget of 900 (the test allows 1300): the catwalk's posts, sandbags, crates and wire.
