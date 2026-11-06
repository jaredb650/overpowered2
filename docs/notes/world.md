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
 |  8 PLANT   ring/COURT   4 STREET |     halls 28 x 10.5 m, 5 to 6 exits each, a ramp along the shell
 |  7 TILES   6 PLYWOOD    5 SANDBAGS|    ring corridor 4.6 m wide, court 17 m square under the floodlight tower
 catwalk ring at 4.5 m on the ring walls, 4 ramps, each with a pier and a bridge
```

Why the plan looks the way it does:

- **It is a pinwheel so nothing lines up.** Each court door sits on the far side from the ring door it faces. Otherwise court, ring
  and yard doors fall on one radial line.
- **Ring doors stop at the court's corner.** Any further out and a line runs through two of them down the length of the corridor.
- **Divider doors are flush with the shell and in line with the ramp.** Sprint through one and you go straight up.
- **Corner rooms have centre cover above eye height.** The hall doors around a corner share one 45 degree line through that spot.
- **Corner gates are flush sally ports, not bays.** Opposite corners set the longest walk. A bay behind each added about 8 m.
- **Three T-walls per side.** A straight line can thread two but never three. Two more per side near the corners cut the worst yard
  line from 43 to 37 m, but they made a wedge around every shell corner, so they went.
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
