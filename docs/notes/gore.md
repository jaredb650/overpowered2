# Gore and ragdolls

`src/gore/`, `src/physics/`, sandbox at `/?sandbox=gore&scenario=<name>`.

Scenarios: `ragdoll limbs crawl headshot explosion slice shootcorpse stairs stress rigs idle`. `rigs` works on any rig, including skitter and drone. Add `arch=trooper` for another
archetype, `dummy=1` for the capsule TestDummy, `cam=x,y,z,tx,ty,tz` for the camera. Time is fixed at 1/60, so runs repeat.
`window.__gore` has `hold()`, `step(n)` and `sheet(frames, columns)`, which draws a contact sheet over the page.

Side by side, hard limits on the left and muscles on the right under identical input: `limit` (slow motion, with a plot
of the knee), `zerog`, `fall`, `stairsab`, `blast`, `lineup` (ten each way, hard row at the back), `collapse`, `twitch`.
Add `hold=1` to start paused at frame 0, so a sheet is exact however long the page took to load. `muscles=0` turns the
layer off everywhere, in any scenario and in the game itself.

```
node tools/shot.mjs --url "/?sandbox=gore&scenario=blast&hold=1" --wait 9000 --out tools/out/blast.png \
  --eval "window.__gore.sheet([20,26,35,52,90,180],3)"
```

Tests: `npx vitest run src/gore`. `muscles.test.ts` and `ragdoll.test.ts` drive real Rapier ragdolls headless. Under
heavy load add `--testTimeout=60000`: the first test to touch WebAssembly can pass 5 s at low priority.

## How to use it

```ts
const hit = ctx.gore.raycastCharacter(char, origin, dir, maxDist);  // CapsuleHit | null

ctx.gore.sever(char, 'armL', damage, velocity);   // alive or dead. null if already gone or not severable
ctx.gore.ragdoll(char, { impulses, velocity });   // death. Gore owns the instance from here
ctx.gore.collapse(char, { duration, velocity });  // death with time in it. Muscles fade out, then it drops
ctx.gore.headshot(char, damage, velocity);        // death. Holds a beat, then collapses by itself
ctx.gore.gib(char, center, force);                // death. Releases the instance
ctx.gore.slice(char, point, normal, damage);      // death. Releases the instance

const corpse = ctx.gore.raycastCorpses(origin, dir, maxDist);       // ragdolls, corpses, limbs, sliced halves
ctx.gore.damageCorpse(corpse, damage);            // wakes it, pushes it, can sever or burst it
ctx.gore.pin(corpse, wallPoint);                  // drags the struck bone to the wall and nails it there
```

Rules for callers:

- **One death path.** Once a character has gone through `ragdoll`, `collapse`, `headshot`, `gib` or `slice`, gore owns it.
  Stop calling `anim.update` and never `release()` it. `gore.owns(char)` tells you. Repeat death calls are absorbed, except
  that `ragdoll` on a body still collapsing makes it drop now.
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

### Collapse and twitching

`collapse(char, options)` is for anyone dying on their feet: a mortal enemy at the end of its bleed-out (`docs/DESIGN.md`
14.1), and the headshot, which uses it by itself. Gore takes ownership at once and runs the animator for you, so call it
at the moment the enemy stops being an enemy, and stop driving it.

| Option | Default | |
|---|---|---|
| `duration` | 1.7 | Seconds from the first weakness to limp, 0.3 to 5. Upper body goes in the first half |
| `velocity` | none | What it was moving at. Its feet stumble on with it |
| `twitch` | 0, or 1 if headless | Twitching once it is down, 0..1 |

- It needs legs on the ground. Airborne, call `ragdoll`: it holds the hips where the animation had them, so it would hang.
- Past `GoreTuning.maxCollapses` (4), on a body with no legs, on a drone, or with `?muscles=0`, it is a plain ragdoll.
- A hit, a blast, a pin, a cut or a repeat `ragdoll` makes it give up, four times faster.

`ragdoll` takes three more options. `twitch` is 0..1, and is 1 by itself on a body with no head, so a headshot or a
decapitation needs nothing. `impact: { dir, strength }` throws the limbs: left out, it is worked out from `impulses`, so
existing calls already get it, scaled down for bullets. Pass it for a knockdown with no impulses. `muscles: false` puts one
body on hard limits, for comparison.

## Contract additions

Muscles add `collapse`, and `impact`, `twitch` and `muscles` on `RagdollOptions`, from `muscles.ts` by module augmentation.
The rig gains `JointDef.role` and `BoneDef.relax`. `Physics` gains `OWN_BLAST`.

The rest are additive, in `contracts.ts`. `PhysicsSystem`: `preStep`, `radialListeners`, `raycastInto`, `anchorBody`, `stepMs`.
`GoreSystem`: optional `velocity` on `sever` and `headshot`. `CorpseHit`: `bone`, `region`. `SeverResult`: `torso`, plus the
`TorsoHalf` interface. On the concrete `Gore`: `owns`, `blast`, `stats`, `limbCenter`.

## Tuning

| Knob | File | What it does |
|---|---|---|
| `GoreTuning` | `index.ts` | Caps, settle speed and time, sink, heartbeat, headshot hold and hit-stop, limb share of force, corpse limb health, crawl time |
| `MuscleTuning` | `muscles.ts` | Everything in the muscle layer: ligaments, resting pose, impact spin, collapse timing, twitching |
| `relax`, `role` | `rig.ts` | Resting pose per joint, and what each joint is for |
| `RagTuning` | `rag.ts` | Joint damping, death tone, hard limit strength and fade-in, rest damping, collider slimming, speed clamps |
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

## Muscles

`muscles.ts`, run from `Rag.preStep`. What makes a ragdoll read as heavy is tension: force in one limb arriving somewhere
else, and a body with a shape it wants to be. Five things, all on one layer.

- **Soft limits.** Damping and stiffness grow together across a zone inside each limit, and past it. Damping leads, so
  energy is lost and not given back. Knees and elbows use this too, with Rapier's hinge stop left behind it for what it
  cannot catch. Shoulders take up from shoulder height, which is most of what keeps arms from ending up overhead.
- **Neutral posture.** `relax` in the rig is the pose NASA measured in microgravity, varied per body. The pull is capped
  at 0.3 of the limb's own weight on the joint, so it can never lift it. It only shows in the air and in how bodies settle.
- **Rotational impact.** `kick` turns arms one way and legs the other about the joints they hang from.
- **Collapse.** The animator runs against a ghost root, and joints track what it writes. See below.
- **Twitching.** Sine-squared torque bursts and whole-body spasms, on a schedule. They fade by getting rarer and shorter,
  because a limb on the floor does not stir at all below its own weight.

Tone lasts about 3 s after death and then nothing is pulling on the body. Below 0.35 m/s a ligament can only brake, so a
body has to come to rest. A corpse shot awake moves, but has no tone left.

### What has to stay true

Each of these was found the hard way. All but the two marked are guarded by a test in `muscles.test.ts`, checked by
breaking each one on purpose in a copy and seeing the test fail.

- **A pre-step impulse has a gain limit.** Four solver iterations cannot pass a torque down a chain inside one step. A
  torque sized for a whole limb overshoots, reverses and pumps energy in: speeds of 30 m/s that never settled. So torques
  are sized from the free bodies either side of the joint.
- **Ligaments turn the child about its joint** (no test, and not essential). Most of a swinging limb's momentum is its
  centre of mass travelling, so `resist` gives the child a linear impulse too, in `RagPart.push`. Measured, that takes a
  quarter off how far an arm runs past its reach, 0.54 to 0.39 rad, and changes nothing else: a pure torque is as stable and
  settles the same. It is the only muscle that crosses into Rapier by itself, and only while a joint is in its zone.
- **Throw a limb as one piece.** Spinning only the upper arm leaves the forearm behind: the elbow whips round, hits its
  stop and drags the arm back the way it came. `spinLimb` turns the whole limb about the shoulder.
- **Throw a body along one line.** `Physics.radialImpulse` gives every body the same impulse along its own line, which
  gives a forearm ten times the speed of the hips and fires shoulders out sideways. Muscle chains set `OWN_BLAST`, so Physics
  skips them and `Rag.radialImpulse` throws them, shared out by mass. This is what lets legs go forward at all. Hard-limit
  bodies keep the old behaviour, so `muscles=0` is a fair comparison.
- **Never give a sleeping body a velocity.** Rapier keeps it and reports it for good without moving the body, which then
  never settles. `Rag.preStep` skips a sleeping chain, and anything that means to move it wakes it.
- **A spring on a light limb against the floor bounces for as long as it is allowed**, and the bouncing resets the quiet
  timer that would have let it go. That is why ligaments only spring back above `limitElasticLow`.
- **In a collapse, the hold takes the reaction.** With every joint's reaction landing on the hips they thrash. While
  support lasts each body answers to one controller, and as it fades the reaction moves onto the parent, so what is left at
  the end are true joint torques with real weight on them.
- **Legs keep their gravity during a collapse** (no test). Feet need weight on the floor for friction. This mattered
  before the line above existed. With it in place, removing this no longer shows in foot slide, so it may be redundant.

## Measured

Shared 8 GB M1 under load average around 18, so treat these as upper bounds.

| What | Result |
|---|---|
| Physics step, 14 ragdolls + 22 live limbs, real husks, before muscles | median 1.5 ms, p90 1.8 ms, max 5.1 ms over 114 frames. An earlier run at higher load gave median 2.1, p90 3.4 |
| The same stress run, muscles against hard limits, same load | Chrome: median 4.6 ms against 4.3 ms, 92 frames each. The machine was far busier than the 1.5 ms above: compare these two with each other, not with that. In Node, interleaved, CPU time per step was 4.4 against 5.7, so inside the noise |
| `MuscleState.step` | About 8 µs of CPU per body per sub-step. Allocates about 1 byte per call, which is noise |
| Knee whipped into its limit at 18 rad/s, 1/240 s steps | Peak deceleration 3678 rad/s² hard, 447 with muscles. 892 and 365 at 1/60 s. Rebound 0.4 rad/s |
| Blast from the front, 14 frames on | Arms back 1.3 to 2.3 rad, against 0.3. Legs forward 0.3 to 0.9 rad, against 0.8 rad backward |
| Arms ending within 1 rad of straight up, 20 varied deaths | 0 of 20, against 6 of 20 |
| Frames to settle, same 20 deaths | Mean 113, against 106 |
| Weightless, mean joint error from resting pose | 0.86 rad down to under 0.12 in 6.5 s |
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
- **The enemy agent has not called `collapse` yet.** In the sandbox it runs on husks and in Node on the real animator. The
  mortal bleed-out path does not exist yet, so nothing has been tried against a real AI handing a body over.
- **A collapse assumes level ground.** The hips are held at the height they started, so one begun on stairs or at a ledge
  hovers until support fades, then drops. Not tried on stairs. Airborne, call `ragdoll`.
- **A very fast joint still reaches the hard stop.** Past about 30 rad/s the zone is used up in a step or two and the
  stop does the work: peak deceleration 1842 against 2161. Hits that hard are rare, and there the stop is what saves it.
- **The straight end of a hinge has a narrow stop:** 0.18 rad past the limit, not the wide margin of the folded end, because
  `knees and elbows only fold the way they fold` allows 0.25.
- **Arms can run past their reach** in a full blast, by 0.1 to 1 rad, before ligaments catch them.
- **Twitching varies a lot from body to body.** A burst can move a hand a few centimeters or, rarely, flop a limb 30 to
  40 cm. Judged from numbers and stills, not in motion, so it needs someone to watch it.
- **Ankles ease to rest visually only.** The foot's collider stays where it was at death, so a pointed foot can sit a
  little off the floor. Spine and neck are merged too, and take their curve from the chest and head joints.
- **Drones occasionally hit the time limit** and freeze at 7 s instead of about 2.3 s. Seen a few times in long sequences,
  never in 13 isolated runs. On hard limits they always do.
- Rapier's JS API allocates a little inside some calls. Gore passes target objects everywhere it can, but spawning a chain
  allocates descriptors. That happens per event, never per frame.
