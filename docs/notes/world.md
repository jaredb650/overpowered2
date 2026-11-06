# World

`createWorld(ctx)` in `src/world/index.ts`. Call `await world.build(onProgress)` once at load, after physics and render exist.
Then call `world.update()` once per frame in the world slot, and `world.reset()` on a new run. Sandbox: `/?sandbox=map`.

## Maps

`src/world/map/maps.ts` holds one `MapDef` row per map, and `World` only reads that row. `?map=crucible` or `?map=killhouse` picks one.
The default is `crucible`, the swarm game. The owner keeps both: the Kill House becomes the map of a tactical contract, picked from
the menu later. To pick it from code, change `selectMap()`. Add `&map=killhouse` to any sandbox that builds a world.

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
