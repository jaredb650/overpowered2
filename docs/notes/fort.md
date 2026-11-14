# The fort

Piece 6 of `docs/proposals/outpost-defense.md`: the Outpost Defense map, at `/?map=fort`. Files: `src/world/map/fort/`. No mode, no
waves and no shops run on it yet; it is the ground the economy and the wave director attach to.

| URL | What |
|---|---|
| `/?map=fort&autostart=1` | The default contract (the swarm) on the fort |
| `/?map=fort&contract=outpost&autostart=1` | Human squads |
| `/?map=fort&contract=outpost&allies=6&autostart=1` | With six allies round the player in the core |
| `/?sandbox=map&map=fort&view=overview` | Fly camera. Views: `overview`, `high`, `core`, `infirmary`, `middle`, `armoury`, `outer`, `barracks`, `catwalk`, `gun`, `tower`, `gate`, `gateIn`, `middleGate`, `field`, `fieldWide` |

| File | Holds |
|---|---|
| `plan.ts` | Every number, and all the data other systems read (below). No three.js |
| `rings.ts` | Walls, gates, ramparts and catwalks, bastions, gun pads, stairs |
| `buildings.ts` | The three shops, the magazine, the masts and the flag |
| `field.ts` | Ground, roads, the fence, tank traps, shacks, wrecks, mortar pits, landing zones |
| `index.ts` | Stages, zones, spawns, player spawns and views |
| `fort-map.test.ts` | The proof |

## The layout

```
 field to the fence at 114 m, nav to 120 m. Roads N-S (asphalt) and E-W (gravel), a track round the walls at 64 m
 +--------------------------- outer ring, 104 m square, yellow -----------------------------+
 | bastion             gate (N)  gun pad                                          bastion   |  4 gates, one mid-side, 6 m
 |    +------------- middle ring, 64 m square, blue ------------ bastion (NE)              |  2 gates, N at x 14, S at x -14
 |    |  armoury (N band)          gate (N, x 14)                    |                     |  2 gun pads, E and W
 |    |      +--- core, 28 m square, red ---+                         |                     |  2 gates, E and W
 |    |  gate|  infirmary   flag   mast     |gate                     |                     |
 |    |      |               magazine       |                         |                     |
 |    |      +------------------------------+                         |                     |
 |    bastion (SW)                gate (S, x -14)                     |                     |
 |        barracks (S band, west of the gate)                                              |
 +------------------------------------------------------------------------------------------+
```

x runs east, z south. Each ring is authored as its north side and turned (`rot`, `turnYaw`).

- **Walls** are the destructible segments (`spec.wall`), 4 m pillar to pillar: 184 segments in all. **Gates** are lift gates
  (`spec.wallGate(..., opens = true)`): they rise for the player or an ally within 4.5 m and drop once nobody friendly is within 6 m and
  the gap is clear. An enemy only gets through a shut gate by blowing it. See World, Walls, gates and shacks.
- **Catwalks.** Behind every wall is a rampart from 0.27 to 3.4 m in from the wall line, earth in wire baskets, its top a steel deck at
  `WALL.catwalk` (1.7 m) with a hazard edge and a rail on the yard side. It runs the whole perimeter of every ring. It is solid, so a breach
  opens onto its face: nav links any ledge up to 1.9 m both ways, so attackers vault onto the rampart and drop into the yard, and the
  player mantles. Stairs reach it from the yard beside every gate (down to the gate's passage) and once more on each side.
- **Bastions** stand in the corners of the outer ring (all four) and the middle ring (NE and SW): the rampart corner raised to 4.7 m,
  sandbags on the two outer edges, a tin roof and a floodlight. Stairs climb to them from the catwalk on both sides, so the walk runs
  over them. Snipers' posts.
- **Mounted guns**: six, each on a concrete pad 2.3 m high in the rampart with a ramp up from the catwalk at each end, so the trunnion
  (1.2 m over the foot) clears the 3 m wall: one per side of the outer ring at x 26 (local), two on the middle ring (E and W).
- **Shops**: the barracks (outer ring, south band), the armoury (middle ring, north band) and the infirmary (core, north-west corner)
  with a sandbagged magazine in the core's south-east corner. Each is a walk-in box with one doorway, a counter on the back wall, a lit
  sign and a band in its ring's colour. Each stands flush against a rampart, so nothing behind it is a nook.
- **The field**: tank traps 5 m out from the outer wall, seven shacks a side (planks and sheet), a burnt truck, a container, jersey
  barriers, tyres, two burning drums, two mortar pits and a painted landing zone a side. Lanes, the track and the landing zones are
  kept clear for a tank's width. A chain-link fence and an invisible wall to 40 m at 114 m.

## The data (`plan.ts`)

All plain tuples `[x, y, z]` and camera yaws (0 looks north, down -z).

| Export | What | Count |
|---|---|---|
| `FORT_SHOPS` | `{ id, ring, name, anchor, yaw, door, target }`. `anchor` is the floor where the buyer stands at the counter; `yaw` is the buyer's facing (toward the counter; the counter faces `yaw + π`); `target` is the building's box, for the shop's health and the attackers' aim | `barracks`, `armoury`, `infirmary` |
| `FORT_RALLY` | Where a new hire gathers: the yard outside the barracks door | 1 |
| `FORT_POSTS` | `{ id, type, ring, pos, yaw, gun? }`. Types: `rifleman` (catwalks), `gunner` (the guns' seats, `gun` is the index in `spec.emplacements` and `FORT_GUNS`, and rampart corners with no bastion), `sniper` (bastion tops), `rocketeer` (the rampart beside each gate), `shotgunner` (outside each shop door), `medic` (the core), `mortar` (the player's teams, middle ring yards) | 18, 8, 6, 8, 3, 1, 4 |
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
| `LEVEL` | Floors: ground 0, deck 1.7, gun 2.3, tower 4.7. The nav's levels | |

Zones: `fort-core`, `fort-middle`, `fort-outer`, `fort-field` (THE CORE, MIDDLE RING, OUTER RING, THE FIELD). Walls and gates:
`ctx.world.objects.structures`; `ctx.world.objects.walls.setOpen(gate, open)` and `isOpen(gate)` drive a lift gate by hand.

## Proving it

```
nice npx vitest run src/world/map/fort/fort-map.test.ts --testTimeout=60000     # about 4 s
OP2_SKIP=1 OP2_VIEWS=overview,catwalk,tower,field node tools/shot.mjs --url "/?sandbox=map&map=fort" --script tools/scripts/killhouse-verify.mjs --out tools/out/fort/v.png --wait 2500 --dpr 2 --w 1440 --h 900
```

The test builds the real world (Rapier, the nav sample, the walls up after it) and checks: every 2 m of every catwalk and every bastion
top is floor the core can reach; with every gate shut nothing in the field reaches the outer yard, and opening each ring's gates in turn
opens exactly that ring; a breach in the north wall is a way in over the rampart and its repair closes it; each shop's anchor is floor
inside its own building, in its ring, with the counter in front of it; every post, breach point and the rally point is floor in its ring
the core can reach; every spawn is at least 30 m outside the outer wall with a way on foot to every outer gate; every mortar spot is floor
with sandbags toward the fort; lanes and roads swept at their full width at 0.5 and 2.4 m, and the landing zones, hit nothing.

| Measure | Fort | For scale |
|---|---|---|
| Static | 96k triangles, 259 colliders, 65 baked lights, 184 wall segments, 8 gates, 28 shacks | Outpost 257k, 457, 131 |
| Nav | 50.4k nodes, 0.35 s | Outpost 37.7k |
| Build | 2.2 to 3.3 s all in, the light bake 2 to 3 s of it | |
| Draw calls, map sandbox (no characters) | 142 to 188, of which walls, gates and shacks 55 to 67 | Outpost sandbox 90 to 118 |
| Draw calls, real game, 6 allies and a wave | 155 to 245, 210k to 430k triangles, CPU 4 to 8 ms a frame | Outpost 151 to 196 |

Frame rates in the harness at 2x are the harness's (2 to 14 fps), not the map's; other agents' browsers were running.

## Rough

- **Nobody has played it.** The ring sizes, the lanes and how far out the spawns are are guesses for a siege. Spawns at 104 to 108 m are
  past the spawner's 40 to 80 m path band, so it picks the nearest of them; the wave director should pick its own from `FORT_SPAWNS`.
- **No catwalk over the gates.** The walk goes down the stairs, through the gate's passage and up the other side.
- **The rampart's yard face is vaultable everywhere** (1.7 m is under nav's 1.9 m jump), so attackers inside a ring climb onto the catwalk
  anywhere, and the player needs a mantle. That is what lets a breach be a way in at all.
- **Lift gates pop up and down** in one frame, with a clang; no animation. The auto rule counts the player and allies, not anyone else.
- **Bastions are not destructible.** Nor are gun pads, ramparts or shops; shop health is the economy's number, `target` only says where.
- **Ground puddles** read as pale blotches from high up under the moon. They are the dirt material's wetness, as on every map.
- **Four-fold symmetry.** Every side of the field is the north side turned, with small jitter on the shacks.
- **Mortar teams and landing zones are only data and paint.** Nothing uses them yet.
