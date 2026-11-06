# Gore and ragdolls

`src/gore/`, `src/physics/`, sandbox at `/?sandbox=gore&scenario=<name>`.

Scenarios: `ragdoll limbs crawl headshot explosion slice shootcorpse stairs stress rigs idle`. `rigs` works on any rig, including skitter and drone. Add `arch=trooper` for another
archetype, `dummy=1` for the capsule TestDummy, `cam=x,y,z,tx,ty,tz` for the camera. Time is fixed at 1/60, so runs repeat.
`window.__gore` has `hold()`, `step(n)` and `sheet(frames, columns)`, which draws a contact sheet over the page.

Tests: `npx vitest run src/gore`. 50 tests, 26 of them driving real Rapier ragdolls headless (`ragdoll.test.ts`).

## How to use it

```ts
const hit = ctx.gore.raycastCharacter(char, origin, dir, maxDist);  // CapsuleHit | null

ctx.gore.sever(char, 'armL', damage, velocity);   // alive or dead. null if already gone or not severable
ctx.gore.ragdoll(char, { impulses, velocity });   // death. Gore owns the instance from here
ctx.gore.headshot(char, damage, velocity);        // death. Holds a beat, then collapses by itself
ctx.gore.gib(char, center, force);                // death. Releases the instance
ctx.gore.slice(char, point, normal, damage);      // death. Releases the instance

const corpse = ctx.gore.raycastCorpses(origin, dir, maxDist);       // ragdolls, corpses, limbs, sliced halves
ctx.gore.damageCorpse(corpse, damage);            // wakes it, pushes it, can sever or burst it
ctx.gore.pin(corpse, wallPoint);                  // drags the struck bone to the wall and nails it there
```

Rules for callers:

- **One death path.** Once a character has gone through `ragdoll`, `headshot`, `gib` or `slice`, gore owns it. Stop calling
  `anim.update` and never `release()` it. `gore.owns(char)` tells you. Repeat death calls are absorbed.
- **Hits come from rings** (64 capsule, 16 corpse), so a shot loop can keep its best hit while it tests the next enemy. Do
  not hold one past the frame.
- `raycastCharacter` reads `bone.matrixWorld`, so it hits what was last rendered. It skips severed bones.
- `force` is newton-seconds everywhere. 0 takes a default for the damage type. `gib` launch speed is `force / 34`, clamped to 9-24 m/s.
- `physics.radialImpulse` is enough for blasts. Gore listens to it, wakes corpses in range and throws them, including bodies
  killed earlier in the same frame, which Rapier's queries cannot see yet.
- **Waist cut:** `sever(char, 'abdomen', ...)` on a living character returns `result.torso`, a `TorsoHalf`. The instance becomes
  the legs: ragdoll it. The top half drags itself at the player for about 7 s. `setTarget`, `kill`, `position`, `alive`.
- Headshot damage of 40 or more bursts the head, less pops it off whole. Both are kills. A non-lethal head removal is
  `sever(char, 'head', ...)`.

## Contract additions

All additive, in `contracts.ts`. `PhysicsSystem`: `preStep`, `radialListeners`, `raycastInto`, `anchorBody`, `stepMs`.
`GoreSystem`: optional `velocity` on `sever` and `headshot`. `CorpseHit`: `bone`, `region`. `SeverResult`: `torso`, plus the
`TorsoHalf` interface. On the concrete `Gore`: `owns`, `blast`, `stats`, `limbCenter`.

## Tuning

| Knob | File | What it does |
|---|---|---|
| `GoreTuning` | `index.ts` | Caps, settle speed and time, sink, heartbeat, headshot hold and hit-stop, limb share of force, corpse limb health, crawl time |
| `RagTuning` | `rag.ts` | Joint damping, death tone, limit strength and fade-in, rest damping, collider slimming, speed clamps |
| `swingShape()` | `rag.ts` | Asymmetric hip and shoulder reach |
| `BloodTuning` | `blood.ts` | Rays per frame (24), droplet and pool caps, smear spacing |
| `ChunkTuning` | `chunks.ts` | Slots per kind, live bodies (72), linger, bounce |
| `SliceTuning` | `sliced.ts` | Hold before the halves part, slide speed, half cap |
| `CrawlTuning` | `crawl.ts` | Stroke time, reach, haul, lift |

## How it works

- `Rag` is any bone chain driven by bodies: a whole body, an arm, a top half. A body's frame is its bone's world frame, so
  joint anchors are trivial and limits read straight off relative rotation.
- Bones are driven by **rotation only**, down from the chain root. Solver stretch cannot reach the mesh.
- Velocity seeding steps the animation 1/90 s ahead, differences the pose and restores it. No per-frame tracking of the living.
- Cone and twist limits are velocity-level corrections in `preStep`. They can only remove closing speed, so they cannot
  explode at any stiffness. They fade in over 0.25 s because a running stride starts past them.
- `Rag.jointGap()` and `stats().jointGap` report joint error, for checks.
- Self-collision inside one body is off through solver groups. Bodies do collide with each other, so piles work.
- Blood in the air is FX. `BloodField` flies invisible droplets alongside it and turns landings into decals, from one ray budget.

## Measured

Shared 8 GB M1 under load average around 18, so treat these as upper bounds.

| What | Result |
|---|---|
| Physics step, 14 ragdolls + 22 live limbs, real husks | median 1.5 ms, p90 1.8 ms, max 5.1 ms over 114 frames. An earlier run at higher load gave median 2.1, p90 3.4 |
| `cutMesh`, husk, about 9-12k triangles | best 2.9 ms in Chrome. Target was about 2 ms: **missed**. Best 1.8 ms in Node on a plain 12k mesh |
| `bakePose` (characters system) | best 1.3-2 ms, on top of the cut |
| Pose jump at death, real animator | 0 |
| Falls that settle by themselves | all 36 in the test, usually about 2 s |

## Known limitations

- **No self-collision within a body.** An arm can rest inside its own torso. Left off for budget. I did not try turning it on.
- **Velocity at death is close, not exact.** Position is continuous, but in a run cycle a bone can change speed in the first
  frame. Feet stopping on the floor is correct. One knee moved 12 cm in that frame, against 2 cm the frame before, in one of
  four samples. I did not find the cause.
- **Slice drops props.** `bakePose` is the body only, so a held gun vanishes on a slice. Ragdoll, sever and gib keep them.
- **Sliced halves are rigid** and take hits on a local bounding box, not the mesh. They cannot be severed further.
- **Loose limbs do not split.** A shot-off arm cannot lose its forearm afterwards. Enough damage bursts it into chunks. The
  same goes for a top half's arms: `SeveredLimb` has no `spawnSevered`.
- **The torso only crawls if cut alive.** A waist cut on a ragdoll or corpse gives an inert top half. It is humanoid-only.
- **Archetypes checked in the browser:** husk, trooper, juggernaut, skitter and drone, with no console errors. Skitter and drone
  spark and throw scrap instead of bleeding. The other archetypes share the humanoid rig but I did not run them. Unit tests use
  the TestDummy.
- **Bodies keep a stale recycled instance for one case.** The library pools 64 instances per archetype and takes the oldest
  back when it runs out. Gore detects that and lets go, but 48 live enemies plus 40 corpses of one archetype is 88, so a
  husk-heavy wave will lose corpses early. Raising the pool to 96 fixes it.
- Pools grow as stacked decals, since `DecalSystem` has no resize. 5 per corpse.
- Rapier's JS API allocates a little inside some calls. Gore passes target objects everywhere it can, but spawning a chain
  allocates descriptors. That happens per event, never per frame.
