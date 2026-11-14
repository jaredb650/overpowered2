# World

`createWorld(ctx)` in `src/world/index.ts`. Call `await world.build(onProgress)` once at load, after physics and render exist.
Then call `world.update()` once per frame in the world slot, and `world.reset()` on a new run. Sandbox: `/?sandbox=map`.

## Maps

`src/world/map/maps.ts` holds one `MapDef` row per map, and `World` only reads that row. `?map=crucible`, `?map=killhouse`, `?map=outpost` or `?map=fort` (Outpost Defense's fort: `docs/notes/fort.md`) picks one.
The default is `crucible`, the swarm game. The Kill House is the map of The Outpost contract, picked from the menu. `selectMap()` takes
the map from `ACTIVE` in `contracts/select.ts`: `docs/notes/contracts.md` has the URL rules. Add `&map=killhouse` to any sandbox that builds a world.

**"No climb" surfaces.** Wrap any builder calls in `kit.noClimb(() => ...)` and every collider they make refuses the player's
wall climb (`physics.markNoClimb(collider)` does it for one collider made outside the kit; `physics.climbable(collider)` reads it).
A jump at such a face still mantles if the ledge is in a jump's reach, and wall runs and kicks off it still work. Use it on a face
a lesson needs out of one jump's reach, since one jump plus a climb reaches a ledge about 5.5 m up (`docs/notes/player.md`).

# Walls, gates and shacks

Piece 4 of `docs/proposals/outpost-defense.md`. Reusable pieces any map places; the fort map will be built from them. Files:
`src/world/structures.ts` (everything), the builders in `src/world/map/spec.ts`, tests in `src/world/structures.test.ts`.
Try them on the Test Range (`/?map=range`): a run of four segments with a gate, from (-26, 0) to (-6, 0), and a plank and a sheet
shack outside it at (-10, -9) and (-22, -14). `spec.view('walls')` looks at it. The lab's `Wall segment` button puts one more across
the crosshair.

```ts
spec.wall(-26, 0, -18, 0);      // pillar centre to pillar centre: cut into segments about 4 m long, a pillar at every joint
spec.wallGate(-18, 0, -14, 0);  // a steel gate between two pillars. Runs that share an end share the pillar
spec.wall(-14, 0, -6, 0);       // optional last argument: the floor y, so a ring can stand on a terrace
spec.shack(-10, -9, 0.3, 'planks');   // or 'sheet'. 3.2 x 2.6 m, 2.3 m tall, door on its +Z side
```

`spec.wallGate(ax, az, bx, bz, y, true)` makes a **lift gate**: guides and a head beam over its pillars, and a leaf that rises 3.4 m
(no collider, nav open) while the player or an ally is within `GATE_OPEN` (4.5 m) of its middle, and drops once none is within
`GATE_SHUT` (6 m) and nobody stands in the gap. `objects.walls.setOpen(gate, open)` and `isOpen(gate)` drive it by hand (a mode can shut
the gates for a wave). Blown is blown, open or not; a repair brings it back shut. The fort's gates are all lift gates.

**Drawing.** Pieces are drawn in 72 m squares on the static map's grid, one mesh per material each, redrawn on the next `update` after
any piece in the square changes stage or a gate moves. The fort's 220 pieces are 55 to 67 meshes. A standing wall and its pillar
are all `concrete` (the caps are tinted), so the common case is one material.

A wall is 3 m tall and 0.5 m thick on 0.8 m pillars. `WALL.catwalk` (1.7 m) is the deck height for a walkway behind it: a standing
eye clears the top by about 0.3 m. The fort map builds the catwalk itself.

| Kind | Stages | Collision |
|---|---|---|
| Wall segment | intact (300), damaged (300), breached | Intact: one slab. Damaged: two loopholes at chest height you can shoot through, the top bitten down to 2.45 to 2.75 m, still no way through. Breached: stubs at each end and 0.22 m of rubble, a 2.5 m gap a body walks through |
| Gate | intact (400), breached | A 0.2 m steel leaf, then nothing: the leaf lies flat beside the gap, for show |
| Shack | intact (120), breached | One solid box (the boards are skin), then 0.22 m of rubble |

**What wears them.** Every blast goes through `Combat.blast`, which calls `world.objects.damageExplosivesInRadius`, so rockets,
grenades, tank shells, autocannon rounds, call-ins, enemy RPGs and bombers all reach them without any change in the weapons. A
barrel or tank going off wears them from `Objects.detonate`, because Combat skips the world for a blast the world set off. Each piece
takes the blast's damage scaled from 1 at its nearest point down to 0.4 at the edge of the radius. A tank shell (`tank_cannon`)
counts 4 times. Damage a stage cannot take carries into the next, so a big enough blast goes straight through. Small arms, melee and
flame reach the world through `damageExplosive`. That does nothing to walls and gates, and chips a shack at a quarter of the
damage; blasts count 1.5 times on a shack. Roughly: a player rocket against a wall face is a third of a stage, two enemy tank shells
take a stage, one rocket flattens a shack, five open a gate. Every stage change plays dust, chips and smoke, with
`concrete_crumble` and `explosion_debris` for a wall, `metal_groan` and `metal_clang` for a gate, `impact_metal` for a shack.
No new sound ids.

**Nav.** Pieces go up after the nav sample (`World.build` calls `objects.walls.attach(navGraph)`), so the floor under each one is on
the graph. `NavGraph.setBlocked` counts blockers per node in an oriented box: the flow field does not step onto a blocked node,
`locate` skips it, and `groundHeight` falls back to the physics ray there, which reports the wall, so a crowd pressing on it stops.
`RouteFinder` reads the same `blocked` array, so soldiers' and allies' routes close and open with it. A piece blocks a cell either
side of its line until it is breached; pillars stay blocked. Any change makes the next flow pass a full one, and that pass forgets
the nodes it could not reach, so nothing keeps a way through a wall that has just been repaired. This is cheaper than a nav link
per breach, and it works for a breach anywhere along a run.

**Repairs** (for the later shop). `ctx.world.objects.structures` lists every piece as a `Structure` (contracts.ts):

```ts
const piece = ctx.world.objects.structures![i]!;
piece.stage;            // 'intact' | 'damaged' | 'breached'
piece.health; piece.maxHealth;   // this stage's
piece.repair(4);        // up one stage over 4 s, or a chipped intact one topped up. False if whole or already under way
piece.repairing;        // 0..1, or -1
const off = piece.onStageChange((stage, from) => { /* riot police to the breach, a HUD marker */ });
```

Any damage stops a repair. The last moment of a repair out of a breach waits until nobody (player or enemy) stands in the gap.
`world.reset()` puts everything back up whole.

## Proving it

```
nice npx vitest run src/world/structures.test.ts --testTimeout=60000
node tools/shot.mjs --url "/?map=range" --script tools/scripts/walls-live.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/walls/x.png
```

The tests run real Rapier and a real nav graph: thresholds and carry-over, falloff and the tank multiplier, small arms against each
kind, rays and capsules through every stage, the flow field and RouteFinder across a wall that only the gate or a breach crosses,
opening on a breach and closing on repair, and repairs with listeners, interruption and an occupied gap. The live script wears a
segment with real blasts to damaged and breached, sends a husk through the breach (it walks the gap at x -19, not round the run's
end), flattens the plank shack with one rocket, blows the gate with five and repairs a breach. 0 console errors, 115 draw calls on
the range.

## Known limitations

- **Bullet holes and scorch marks stay where a wall was.** Decals have no clear-by-box, so they hang in the air over a breach.
- **Enemies have no collider.** One crowded into the band beside a stub can clip its edge by about 0.15 m. A repair waits for the gap
  to clear, but only checks the player and enemies, not ragdolls or allies.
- **Rubble is low enough to walk over but not exactly under the feet.** Enemies walk at the nav floor (0), 0.22 m into the rubble.
- **The minimap does not show pieces.** It is charted from the nav graph before they go up.
- **Blasts do not care which side they hit,** and do not need a line to the piece. A rocket in the yard wears the wall behind a shack.
- **One mesh per stage, not a gradual wear.** Within a stage the look does not change as health falls.
- **No ramps or jump pads over a damaged wall yet.** That is the engineers' job, in the wave director piece.
- **Tuning is a guess.** Health and the tank multiplier have not been played against real waves.

# The Kill House

A roofless concrete shoot house in a walled yard, 71 x 71 m inside the perimeter. Files: `src/world/map/killhouse/`.

`plan.ts` holds every number and is authored as one quarter turned four times. North side first, `rot(i, x, z)` carries it clockwise.

```
 yard, 8.4 m wide: 4 bay gates on the sides, 4 sally ports on the cut corners, 3 T-walls per side
 |  1 TYRES   2 LANES      3 CRATES |     corners 10.5 m square, 4 exits each
 |  8 PLANT   ring/COURT   4 STREET |     halls 28 x 10.5 m, 6 exits each, a ramp along the shell
 |  7 TILES   6 PLYWOOD    5 SANDBAGS|    ring corridor 4.6 m wide, court 17 m square under the floodlight tower
 catwalk ring at 4.5 m on the ring walls, 4 ramps, each with a pier and a bridge
```

Why the plan looks the way it does:

- **It is a pinwheel so nothing lines up.** Each court door sits on the far side from the ring door it faces. Otherwise court, ring
  and yard doors fall on one radial line.
- **Ring doors stop at the court's corner.** Any further out and a line runs through two of them down the length of the corridor.
- **Divider doors are flush with the shell and in line with the ramp.** Sprint through one and you go straight up.
- **Corner rooms have centre cover above eye height.** The hall doors around a corner share one 45 degree line through that spot.
- **Corner gates are flush sally ports, not bays.** Opposite corners are the two farthest places on the map, 82 m apart in a
  straight line, so a bay behind each only made the longest walk longer.
- **Corner rooms have a yard door on both outer walls and halls have one either side of the gate.** One door per hall put the
  longest walk at 98 m. Two brought it to 90.
- **Three T-walls per side.** A straight line can thread two but never three. Two more per side near the corners took the 95th
  percentile sightline from 35 m to 32 m, but they made a wedge around every shell corner, so they went.
- **The catwalk is a ring, with no arms out to the shell.** The arms were the far end of a 108 m walk to nowhere.
- **Cover is flush against a wall or at least 3 m clear of everything.** Nothing in between, because that gap is a nook.
- **Colliders are all boxes.** Panels, paint, plinths, target stands, pipes and rails have none. A wall's collider sits 6 cm proud of
  its core and everything visible fits inside that skin.
- **One floor collider** runs under the whole site, so no sprint crosses a seam.

Nav uses `levels: [0, deck]`, so cover tops and wall tops are not floor. A player standing on one seeds the flow field at the nearest
real floor. Spawns are authored in `killhouse/index.ts` (`spec.spawns`), not derived. The minimap is a vector plan (`spec.plan`), which
also lists every door, wall and block for the verifier.

## Proving it

```
nice -n 19 npx tsx tools/scripts/killhouse-headless.ts 300      # real Rapier and the real Player, no browser, about a minute
OP2_SKIP=1 OP2_VIEWS=room1,room2 node tools/shot.mjs --url "/?sandbox=map&map=killhouse" --script tools/scripts/killhouse-verify.mjs --out tools/out/kh.png --wait 1500
node tools/shot.mjs --url "/?map=killhouse&autostart=1" --dpr 2 --w 1440 --h 900 --script tools/scripts/killhouse-playtest.mjs --out tools/out/kh-play.png --wait 500 --timeout 240
```

`src/world/verify-killhouse.ts` holds the checks. `window.__op2.verify()`, `.sweep()` and `.fuzz(seconds)` run them in the sandbox.
`killhouse-read.mjs` stands enemies in the dark spots and `killhouse-boot.mjs` compares boot times between maps.

The table comes from the headless run. The same checks in real Chrome on the final build gave identical numbers.

| Check, real Rapier and the real Player at 12.5 m/s | Result |
|---|---|
| Colliders | 158, every one a box |
| Longest walk anywhere | 89 m walked, 94 m along the nav grid. Opposite yard corners, 82 m apart in a straight line |
| Longest route from any spawn to 19 spots on both levels | 87 m, 0 flow failures |
| Nav | 4507 nodes, floor 3604, deck 724, ramps 179. Nothing else counts as floor |
| Doors | 36. 24 at 4.00 m, 8 at 3.94 m (flush with the shell), 4 at 5.00 m |
| Narrowest gap anywhere on the floor | 3.04 m, none under 3 m. Gate bays and spots beside barrels are not counted |
| Runs through doors, both ways, 3 offsets, 5 angles to 40 degrees, with and without a dash | 1338 of 1338 got through, worst 0.06 s lost |
| Runs along every wall and block face, leaning 6 degrees in | 101, 0 catches, 0.83 of top speed made good |
| Runs out of each gate bay | 12 of 12 |
| Ramps foot to pier, deck ring end to end across its seams | 8 of 8, 0.89 of top speed at worst |
| Holes in the floor, rays out of the perimeter below 24 m | 0, 0 |
| Sightlines between standing eyes at least 18 m apart | 95% within 34 m, 13% over 30 m, longest 46 m. The long ones are slim lines through three doors |
| Pickups | 27, one or two in every space, 3 mega health spots on the deck corners, none stranded |
| Random hands, 6 seeds of 300 s | 0 frames inside geometry, 0 falls, 0 trapped, up to 7.7 m high |

Real game, waves 1 and 2. The bot holds a station for 30 s, then moves on. Far means over 30 m by path, counted among bodies at least
20 s old. `KH_PASSIVE=1` holds fire, because a bot that shoots kills nearly everything before it can be counted.

| Run | Result |
|---|---|
| Passive, 1280x720, 52 enemies | 0 seen at spawn, spawn path 29 m minimum and 53 m mean. Far at 20 s: 0, 3, 0, 0. Far at 30 s: 1, 1, 0, 0. Over 50 m: 0 |
| Shooting, 1440x900 at 2x, 61 enemies | Waves 1 and 2 cleared, wave 3 at 124 s. 0 stuck, 0 off the graph, 0 page errors. Spawn path 33 m minimum, 57 m mean |

Seen at spawn counts a clear line to the player's eye, whichever way they face. The shooting run scored 6 of 61, about one pack, and the
spawner allows entrances behind the camera, so that is not proof of a spawn in plain view. Earlier runs scored 0 of 84 and 0 of 52.

One far body was a trooper holding at range in a gate bay. The other stalled for at least 8 s against a door jamb, then recovered. No
body stood on a wall top or left the map. Before the `groundHeight` change a husk got stuck on a wall top.

Boot, back to back on the same loaded machine (load average about 15), real game, 1280x720:

| | Crucible | Kill House |
|---|---|---|
| Page load to playing | 24.2 s | 11.4 s |
| World build, all in | 20.6 s | 5.9 s |
| Light bake | 19.4 s | 5.4 s |
| Nav | 3.4 s | 0.2 s |
| Static triangles, colliders, baked lights | 661k, 1712, 281 | 128k, 150, 75 |

Timings swing widely with load: the same Kill House bake took 0.6 s on one quiet run. Compare within a run, not across runs.

## Tuning knobs

| Where | What |
|---|---|
| `killhouse/plan.ts` `KH` | Wall lines, heights, door widths, the corner cut. `chamfer` cannot go under 59 without the yard corner lane dropping below 4 m |
| `killhouse/plan.ts` `quarter` | Door positions. Change one and rerun the proof: the sightlines depend on doors not lining up |
| `killhouse/rooms.ts` `d.fill` | Room light. Keep it well off the walls, because a light 1.4 m from a wall burns a hot spot into it |
| `killhouse/index.ts` | Player spawns, drop points, flyer points and the named views |

## Known limitations

- **Feel has not been played by a human.** Every number here comes from bots. Whether it reads as weighty needs the owner's hands.
- **Frame rate is unproven.** Every run shared the machine with other agents. One 1x run held a 16.7 ms median, a 2x run under heavy load
  showed 50 ms. Neither says what an idle M1 does.
- **Bosses are untested here.** Only waves 1 to 3 have been run. A Juggernaut is 2.3 m wide and a Titan nearly 5 m, against 4 m lanes.
- **Sightlines overshoot the brief in places.** 13% of the long ones are over 30 m. They are slim lines through three doors, up to 46 m.
- **Enemies can leap onto a ramp from its open side.** 12 of about 300 tested routes use that vault. Everything else is a plain walk.
- **Players can stand on wall tops and cover.** Enemies path to the nearest real floor under them instead.
- **Enemies clip door jambs.** They have no collider and only check the floor every 0.3 m, so a crowd can push one a little way into a
  wall end, where it can stall until its unstick logic moves it. Doors flush with the shell have no stub to clip on that side.
- **The perimeter is invisible from 7.5 m to 26 m,** to contain rocket jumps. Rounds fired at that part of the sky hit nothing you can see.
- **Spawner path bands (40 to 80 m) were tuned for The Crucible.** They work here, but they are not this map's numbers. They belong to `src/enemies`.
- **`setReactorState` does nothing here,** because the map has no reactor.
- **Enemies treat wall tops and cover as no ground.** `groundHeight` returns NaN for a flat surface that is not a listed level, which
  is what stops anything leaping up to stand on a wall. A body that does come down on one falls through and is put back by the rescue
  below the floor.

# The Outpost

The mission's map, at `/?map=outpost`. Files: `src/world/map/outpost/`. docs/campaign/MISSION.md section 2 is the plan, `outpost.places.ts` has every mark, and `parkour.ts` has every size. To play it: `/?contract=outpost&map=outpost&mission=outpost&autostart=1`, with `&beat=<id>` for anywhere.

| File | Holds |
|---|---|
| `plan.ts` | Every number, the rooms, the roads, `carve` |
| `site.ts` | `Site`: walls as footprints, stairs, `barrier`, sandbags, crates. Everything below is built with it |
| `apron.ts`, `wall.ts` | Outside: the cut, the lanes, the wreck, the south wall, the towers, the Gate Yard |
| `citadel.ts`, `rooms.ts` | Slabs and walls of both wings, then what makes each room itself |
| `deep.ts` | The Coolant Hall and the gallery, where the lips are |
| `stack.ts` | The Stack, the War Room, the roof |
| `proof.ts`, `outpost-map.test.ts` | The proof sheet |

Why it is built the way it is:

- **A wall is a footprint.** `Site.wall` takes the rectangle a wall stands on, so a 1 m partition and the 4 m band beside the Stack are the same call. It breaks round its openings, and each side dresses itself from the room it faces.
- **Scripted doors take their holes from `DOORS`.** The door's collider comes from `campaign/doors.ts`. The map leaves the hole, with its head and jambs, and nav is sampled before any door exists, so every doorway is on the graph and `routes.setClosed` shuts it for walkers.
- **`Site.barrier` stops a player and nothing else.** It is `CG.Barrier`: on the player's mask only, off every ray, and it touches no body. The men on the south wall fire out over a line the player must not cross, which an ordinary invisible wall would stop. Bullets, rockets, nav and light all pass.
- **Everything over a gap hangs below the lip or has no collider.** The bridge stumps are steel you cannot stand on. The wreck is one box, with the wing and fin off it and no collider on them, because anything against the hull is a leg up that kills the lesson.
- **"No climb" where a climb would skip a lesson.** The wreck's hull (`apron.ts`), the pit's far wall (`citadel.ts`) and the trench's far deck end (`deep.ts`) are built inside `kit.noClimb`: one jump and a wall climb would reach all three.
- **The gallery's north wall is one box with no skin.** It is what gets run on. Its light is inside its face.
- **The deck is the whole run-up.** The stairs arrive side-on at the lip end, so a strafe has 13 m and not 23.
- **Nav joins two floors two cells apart, whatever stands between them.** `nav.ts` makes drop links with no wall test. A thin wall with a lower floor behind it gets one, which is why the near deck has a bank of cabinets along its south wall. Do not take them out without running the walk.
- **The wing roofs are at y 5.1,** because 5 is a nav level for the wall-walk and the Stack.
- **The barracks are baked in emergency red.** The door only opens after he says "Lights", so nobody ever sees them lit. Sally Hall stays white: see limitations.

## Proving it

```
nice -n 19 npx vitest run src/world/map/outpost --testTimeout=60000
nice -n 19 npx tsx tools/scripts/outpost-map-headless.ts build,static,parkour,sweep,fuzz 30     # the whole sheet as JSON, about a minute
OP2_SKIP=1 OP2_VIEWS=lanes,yard,coolant node tools/shot.mjs --url "/?sandbox=map&map=outpost" --script tools/scripts/killhouse-verify.mjs --out tools/out/op.png --wait 1500
OP2_BEAT=breach node tools/shot.mjs --url "/?contract=outpost&map=outpost&mission=outpost&beat=breach&autostart=1" --script tools/scripts/outpost-map-live.mjs --out tools/out/opl.png --wait 500 --dpr 2 --w 1440 --h 900
```

`index.ts` names 50 views, one or more per place. All of this is real Rapier and the real Player at 12.5 m/s, on the map itself. `parkour.test.ts` proves the numbers on bare boxes; this proves a wall skin or a stair has not broken them.

| Lesson | On the map | What cannot do it |
|---|---|---|
| Mantle | All four walls of the cut on one jump | Running at it. The ramp stops at the truck |
| Double jump | Two sides of the hull from a stand | One jump, from 1.2 to 4 m out on both sides |
| Mantle, optional | Pump House (3.6 m) and Guardhouse (3.4 m) roofs | |
| The gate | | A run with both dashes from the trigger reaches it shut |
| Slide | Pressed in the last 3, 6 and 9 m, real `Doors` on the real door | A run. A run with both dashes |
| Dash | 19 of 56 timings of a coarse sweep, from three lines through the door | Double jump at any timing, on all three lines. Run-up is 8.4 m, and that is enough |
| Wall run | 10 of 10 from 0.5 to 8 m before the lip, 3 of 4 on the moment of leaving | Every jump, one dash and two dashes. 168 timings of the last |
| Kick shaft | Kicks and double jumps reach the top landing | |

| Check | Result |
|---|---|
| Static | 257k triangles, 85 meshes, 457 colliders, every one a box, 131 baked lights |
| In the game | 151 to 196 draw calls and 370k to 505k triangles with men and vehicles on. 60 fps at 1280x720 with the swarm on it. Not a frame rate proof: see limitations |
| Nav | 37.7k nodes on 9 levels. Every mark on the graph and on a floor, and none buried. Every door has nav both sides, and a real hole at its full width and head |
| Roads | `spec.roads`. A tank's width swept along every ground route: nothing in the way |
| Cover | 2415 spots from the real `CoverMap`, at least 19 in every room |
| Tower lanes | From the mark, share of the lane a round reaches: 33% at 14 to 25 m, 100% at 25 to 40 m, 80% at 40 to 60 m. Past that it is cover |
| Doorways | 394 of 394 runs through, both ways, 3 offsets, 3 angles, nothing lost |
| Floors | 20 lines across every seam, 0.86 of top speed at worst, and that is a grazed table |
| Soldier routes | 26 legs of the raid, each walked by the real Player down `RouteFinder`'s route |
| No way round | With the doors shut, no walker gets past the gate, the blast door, the dash gap, the gallery, or from the barracks to the mess |
| Containment | 0 leaks, rays at 8 heights out of the apron, yard and roof |
| Random hands | 540 s from 18 places: 0 falls, 0 escapes, 0 wedged, 1 frame against a barrier on a berm |

Fuzz found the one real hole so far: a gap in the pit's east wall under the War Room block. It is why that run stays in the test.

Real game, 0 console errors at 1440x900 at 2x on `barracks`, `plates` and `commander`, and at 1280x720 on `breach`. The Crucible still builds 660,636 triangles and 1712 colliders, and the Kill House 127,744 and 150.

## Tuning knobs

| Where | What |
|---|---|
| `plan.ts` `ROOMS` | Room boxes, ceilings, floor, wall face and paint |
| `plan.ts` `GALLERY.trench` | Depth under the gallery. Seven metres, because a best climb reaches about five |
| `rooms.ts` red `s.lamp` and `s.fill` | How dark the barracks are. These are the first numbers to try if it plays too dark |
| `apron.ts` `coverLines` | The cover lines. Re-run the lanes after moving one |
| `wall.ts` `gunTower` | Keep the south kerb low, or the near half of the lane goes |

## Known limitations

- **Nobody has played it.** Every number is a bot. How dark the apron and the barracks are, and whether the lanes feel like lanes, need the owner's hands.
- **Frame rate is unproven.** Every run shared the machine, and 2x runs in the harness read 1 to 10 fps with 3 ms of CPU, which is the harness and not the map. The 1x run held 60.
- **An expert can beat the dash.** A chain of kicks and double jumps climbs the north-east corner of the pit to the far platform. It needs a move nothing has taught yet, so it stays, as a rocket jump does. Rocket jumps are not measured, though nothing can leave the route by one. The gallery cannot be climbed this way in the runs tried.
- **"Lights." has no moment.** Nothing provides `call('lights')`, so it warns in the console and Sally Hall stays white. The barracks are dark because they were baked so.
- **Men's routes cut stairwell edges.** `RouteFinder` pulls a route straight over a kerb. Men have no capsule, so they clip it. The walk bot has waypoints at two stair tops for that reason.
- **`setClosed` only closes nodes below y 2,** so the two War Room doors stay open to route-finding.
- **The flow field still has drop links through the Stack's shaft walls.** Soldiers do not use it. A swarm on this map would stall against them.
- **Doors are plain boxes.** `DoorDef.look` picks a material, and a leaf stretches its texture over its size. The gate's chevrons look good by luck.
- **The glass pane just goes.** It lifts in a quarter of a second with no shatter effect.
- **Everything north of the citadel is plain,** because it is only seen from the air at 30 m and up.

# The Crucible

## The map

About 320 m across, four main levels: lower -7/-8, ground 0, catwalk 8, Ring Road 14, plus the Crown at 30 and rooftops. Centre plan:

```
 Slag Yard  |  FOUNDRY  | Tank Farm
 TRANSIT    |   CORE    | REFINERY          X-shaped viaducts run from the Core rim to the Ring Road corners.
 Rail Yard  | SCRAPYARD | SE yard           A rounded-square Ring Road wraps everything.
```

Loops, so nothing dead-ends:

- **Ring Road** (y 14): 1 km speed loop. Banked corners, a 24 m outer wall to run on, a 16 m collapsed span on the south straight with kickers.
- **Colonnade** (y 0): the same loop underneath the road.
- **Catwalk ring** (y 8): Foundry catwalks, viaduct, Refinery rack, viaduct, Scrapyard conveyor, viaduct, Transit roof, viaduct. Never touches the ground.
- **Rim walkway** (y 8): circles the Core, tied to the Halo by four bridges.
- **Lower loop** (y -7): Foundry gallery, Refinery sump, Scrapyard pit, Transit trench, joined by tunnels, with four spokes to the arena doors.
- **Viaducts**: 107 m ramps, plus 28 m cuts through the rim to the arena floor. Slide from the Ring Road to the reactor in one line.

Zone ids: `core`, `foundry`, `refinery`, `scrapyard`, `transit`, `ring`.

Pad chain in the Core: arena floor to Halo to Crown, then the four Crown pads throw you to the Ring Road corners. Rim kickers lob you onto the Halo.

## API

Contract additions, all additive, in `src/core/contracts.ts`:

- `NavQuery.linkAhead(position, out, hops?)` returns `'walk' | 'drop' | 'jump' | 'pad'`, and writes the landing point to `out`.
- `WorldSystem.objects: WorldObjects`:
  - `isExplosive(collider)`, `damageExplosive(collider, amount, source)`, `damageExplosivesInRadius(center, radius, amount, source)`
  - `hazardAt(position)` returns a shared `HazardState` or null. `padAt(position, out)`. `platformVelocity(position, out)`. `setReactorState('stable' | 'unstable' | 'critical')`
- Events: `'world:explosion'` `{ position, radius, damage, kind, source }`, `'world:pad'` `{ position, velocity }`. `'world:hazard'` is emitted by crushers, lava and electric floors.

### For a gameplay programmer

```ts
// Weapons: a hit on the world might be a barrel.
const hit = ctx.physics.raycast(origin, dir, range);
if (hit && ctx.world.objects.damageExplosive(hit.collider, damage, 'smg')) { /* it was an explosive */ }
// Rockets and grenades, so barrels chain off blasts.
ctx.world.objects.damageExplosivesInRadius(point, radius, damage, 'rocket');
// Combat resolves the blast. The world plays the effects but deals no damage.
ctx.events.on('world:explosion', e => applyBlast(e.position, e.radius, e.damage, e.source));
// Enemies poll hazards. Player hazards, pads and ramps are handled by the world.
const h = ctx.world.objects.hazardAt(enemy.position);
if (h) enemy.damage(h.lethal ? 1e6 : h.dps * ctx.time.dt);
```

Nav: `world.update()` points the flow field at the player and advances it, so nobody needs to call `setTarget` unless they want a different target. `flowDirection` is allocation-free and returns a
horizontal unit vector, or false when off the graph. Call `navGraph.settle()` after a teleport if you need the field complete immediately.

## How it is built

- `kit/geo.ts`: primitives write straight into per-material, per-chunk typed-array buckets. World-space UVs at 1 m. Chunks per material are in `CHUNKS_ACROSS`.
- `kit/kit.ts`, `kit/props.ts`: architecture and props. Each call produces geometry and clean colliders together.
- `kit/voxels.ts`: 1 m occupancy grid. It serves `isSolid` for the light bake and a mip pyramid for voxel-cone vertex AO, sky occlusion and grime.
- `map/*.ts`: one file per zone, measured against `map/layout.ts`. Move a number there and the zones follow.
- `map/ground.ts`: marching squares over a signed distance field of holes, with greedy-rectangle colliders.
- `nav.ts`: rays and capsule tests per 1 m column, then a CSR graph. Flow field is a bucketed Dijkstra written in place, in slices of `budget` nodes.
- `verify.ts`: run `window.__op2.verify()` in the sandbox, or `tools/scripts/map-views.mjs` with `OP2_VERIFY=1`.

## Tuning knobs

| Where | What |
|---|---|
| `map/layout.ts` | Levels, ring size, bowl radius, viaduct span, hall size |
| `nav.ts` | `budget` nodes per frame, `NEAR_LIMIT`, `FULL_EVERY`, `MAX_DROP`, body size |
| `objects.ts` top | Barrel and tank HP, radius, damage, respawn. `ELECTRIC_DPS`. `PAD_COOLDOWN` |
| `map/spec.ts` `pad(...)` | Pads are aimed: give a target and an arc height, and speed is solved for gravity 28 |
| `k.light(x, y, z, color, intensity, radius)` | Irradiance is intensity / d^2 and fog scatters it. Large radii cost the bake about radius^4 |
| `kit/voxels.ts` `bakeBucket` | AO strength and grime |

## Verified

`tools/scripts/map-player.mjs` drives the real `Player` with real input at fixed steps. `OP2_VERIFY=1` adds the static checks. Last run:

- 35 of 35 pads land on target with the real Player, and the same 35 pass the ballistic capsule sweep.
- 41 anchors across every zone and level: all 1640 ordered pairs have a path. Longest is 490 m.
- Ring gap (18 m) and lava bridge gap (14 m) cleared with a running double jump at 17 m/s.
- Rim kicker traced at ground speed: leaves the lip at vy 20, peaks at 8.7 m, lands on the Halo at r 33.6.
- Ring straight, viaduct climb, stairs and spoke tunnel: run through with no stall. Stairs hold 16 m/s.
- 0 holes in the ground inside the wall, 0 rays escape the containment at five heights. Pickups and player spawns all sit on the graph.
- Nav: 148k nodes, 1.09M links. Flow field 0.5 ms per frame on average, 48 steering queries 0.02 ms in total.
- Explosives chain, crushers and electric floors cycle, `hazardAt` reports each.

Budgets at the widest view: 218 draw calls and 706k triangles, world objects included. 661k triangles of static map in 166 meshes, about 1700 colliders.
Load: 2.3 s for geometry, AO, nav, spawns and minimap. The light bake takes 6 s on an idle machine and up to 14 s while other work shares the CPU.
It runs in a worker alongside nav, so total load is about 7-8 s idle.

## Known limitations

- **The crane gantry does not carry the player yet.** `Player` keeps its position private. It needs to add `world.objects.platformVelocity(position, out)` while grounded. Until then the deck slides under your feet at up to 3.3 m/s.
- **Light bake is over the 6 s build target by itself**, and its cost grows with radius^4. 281 lights. Cut large radii first if load time matters.
- **Nothing is occluded.** Only frustum culling, so tunnels draw when in view through the ground. Triangles are well inside budget, so I did not add portals.
- **No mesh LOD.** Distant detail is carried by fog.
- **Rails have no collision**, on purpose. Bullets pass through them and enemies can walk off ledges, which the nav treats as drops.
- **Wall colliders sit 8 cm proud of the panels** so wall-running stays smooth. Decals on panels can float by that much at grazing angles.
- **Stair treads are visual.** Feet follow the ramp plane under them, so they hover a little on each step.
- **Rim kickers aim for ground speed.** Above about 25 m/s you overshoot the Halo and hit the reactor. That reads fine, but it is not a tuned line.
- **Crusher and gantry colliders are moved with `setTranslation`**, so they do not push bodies. The crusher kills through `hazardAt`. Ragdolls can clip through a falling head.
- **Enemy width:** nav clearance assumes a body about 0.8 m wide. `NavGraph.clearance` holds distance to edges, but `NavQuery` does not expose it, so very large enemies can catch on corners.
- **Spawn sightlines:** one or two ground/gate pairs still have a clear line by the verifier's ray, out of 126 spawns. The count moves slightly as the map changes. Air spawns are not line-of-sight tested.
- **Lava** is a static surface with the library's animated material. It has no flow direction or level change.
