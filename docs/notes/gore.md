# Gore and ragdolls

`src/gore/`, `src/physics/`, sandbox at `/?sandbox=gore&scenario=<name>`.

Scenarios: `ragdoll limbs crawl headshot explosion slice shootcorpse stairs stress rigs idle`. `rigs` works on any rig, including skitter and drone. Add `arch=trooper` for another
archetype, `dummy=1` for the capsule TestDummy, `cam=x,y,z,tx,ty,tz` for the camera. Time is fixed at 1/60, so runs repeat.
`window.__gore` has `hold()`, `step(n)` and `sheet(frames, columns)`, which draws a contact sheet over the page.

Side by side, hard limits on the left and muscles on the right under identical input: `limit` (slow motion, with a plot
of the knee), `zerog`, `fall`, `stairsab`, `blast`, `lineup` (ten each way, hard row at the back). Then `collapse` (dropped,
collapsing, collapsing on the move) and `twitch` (both on muscles, still on the left, twitching on the right).
Add `hold=1` to start paused at frame 0, so a sheet is exact however long the page took to load. `muscles=0` turns the
layer off everywhere, in any scenario and in the game itself.

```
node tools/shot.mjs --url "/?sandbox=gore&scenario=blast&hold=1" --wait 9000 --out tools/out/blast.png \
  --eval "window.__gore.sheet([20,26,35,52,90,180],3)"
```

Tests: `npx vitest run src/gore`. `muscles.test.ts`, `ragdoll.test.ts` and `forces.test.ts` drive real Rapier ragdolls headless. `forces.test.ts` reads the weapon tables, so a retune must stay inside its bands. Under
heavy load add `--testTimeout=60000`: the first test to touch WebAssembly can pass 5 s at low priority.

## How to use it

```ts
const hit = ctx.gore.raycastCharacter(char, origin, dir, maxDist);  // CapsuleHit | null

ctx.gore.wound(char, damage, severity);           // leaves the mark of a hit. Call it for lethal hits too, before the death. True if a limb broke
ctx.gore.sever(char, 'armL', damage, velocity);   // alive or dead. null if already gone or not severable
ctx.gore.ragdoll(char, { impulses, velocity });   // death. Gore owns the instance from here
ctx.gore.collapse(char, { duration, velocity, hit });  // death with time in it. Muscles fade out, then it drops
ctx.gore.knockdown(char, options);                // ragdoll without dying. False if it cannot: stagger it instead
ctx.gore.downed(char);                            // that body, while gore has it. Null once it is yours again
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
- `force` is newton-seconds everywhere. 0 takes `DEFAULT_FORCE` in `contracts.ts`, one table for the living and the dead. `gib` launch speed is `force / 30`, clamped to 6-15 m/s. See Forces below.
- `physics.radialImpulse` is enough for blasts on bodies. Gore listens to it, wakes corpses in range and throws them,
  including bodies killed earlier in the same frame, which Rapier's queries cannot see yet. See Known limitations for
  everything else.
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
- A blast, a pin or a repeat `ragdoll` makes it give up, four times faster. A hit does by its strength, from no faster for a bullet to the same for a heavy one, and a lost limb about halfway. See Taking rounds below.
- `hit: { bone, point, dir, force }` is the shot that did it: it lands on the bone, the body staggers on along `dir`, a hand goes to the wound, and a shot leg gives way first. `damage.ts` calls this for bullets of 30 N·s or less, fire, shock and bleeding out, on a body with both legs under it.

`ragdoll` takes three more options. `twitch` is 0..1, and is 1 by itself on a body with no head, so a headshot or a
decapitation needs nothing. `impact: { dir, strength }` throws the limbs: left out, it is worked out from `impulses`, so
existing calls already get it, scaled down for bullets. Pass it for a knockdown with no impulses. `muscles: false` puts one
body on hard limits, for comparison.

### Knockdown and getting up

`knockdown(char, options)` is a ragdoll that comes back. Gore has the bones until the limbs are gathered, then hands the character back on the floor, already getting up, with `root` where it will stand. The caller keeps the character and reads `downed(char)` each frame: while it answers, `center` is where the hips are. Any death call ends it, and the body goes on falling from where it was.

| Option | | |
|---|---|---|
| `topple` | m/s on the upper body | Tips it over its feet. Legs and spine lock for 0.42 s, or a standing body folds at the knees and rolls over its own head. Leave it out for a blast, which throws by itself once `Physics.radialImpulse` finds the body |
| `impulses`, `impact`, `velocity` | as `ragdoll` | |
| `lie`, `rise` | seconds | On the floor, and to get up |
| `hurt` | 0..1 | Below `painFrom` it never clutches a wound. Above it the get-up strains and shakes |
| `wound` | `{ bone, point }` | Where a hand goes |

A further `knockdown` on a body that is down is a further hit: impulses land, a jolt goes in, the wait to get up lengthens, and a body that had begun to rise goes back to lying. Nothing starts over.

- Past `GoreTuning.maxKnockdowns` (6), on a rig whose animator has no `getUp`, or with muscles off, it returns false. `DamageModel` staggers instead.
- A knockdown is never frozen by the ragdoll budget, never sunk by the corpse budget, and `raycastCorpses` skips it, because it is still an enemy and enemies have their own ray test.
- `gore.clear()` does not release the living. They come back standing where they lay.

`reflex.ts` is what the body does in there, from joint roles, so a missing limb is a limb nobody moves. It writes poses into the muscle layer and touches no rigid body, so it cannot throw anything.

| Phase | Arms | Legs and spine |
|---|---|---|
| Fall | Hands to the face for 0.2 s if thrown. Wide and wheeling, then out and down toward the floor as it comes up, five times as strong as they need to hold themselves | Tucked and pedalling. Chin up going forward, tucked going back |
| Lying | One hand to the wound, the other curls on the belly | Knees draw up and stir, slowly |
| Gather | The first frame of the get-up | The same |

The handover: `Reflex` asks the animator to pose the first frame of the chosen clip, reads joint targets out of it, puts the bones back, and has 0.55 s to reach them physically. Then `handBack` works out yaw from how the body lies, puts the root so that the clip's hips land on the real hips, re-expresses the hips in the new frame, and the animator blends 0.42 s from that pose into the clip. Worst bone speed over the handover is under 0.14 m in a frame in the tests, and usually 0.02.

### Taking rounds

A body that is falling or dying answers every round, and nothing restarts.

- `MuscleState.jolt` is all torque across joints with its reaction on the parent, so it can jerk limbs against each other and cannot move the body as a whole. The struck limb turns away from the shot, joints up the chain follow with 40% kicking back the other way, and two random joints flinch. All one way, a stream of rounds just folds a body in half.
- Sized from each joint's own inertia and a target spin, so it cannot overshoot. Twelve pulses run at once, oldest out.
- On its feet, three quarters of a round goes into `CollapseDrive.drift`, so the feet carry it, and a body under fire is walked back. All of it on the chest bent the body 80 degrees backward over its held hips.
- The animation under a collapse flinches too, and the muscles carry that as well.
- Once it has let go a jolt is 35%, and 15% once tone has gone. At full strength an SMG walked a body 5 m along the floor in 3 s.
- A waist takes `corpseTrunkHealth` (420), not `corpseLimbHealth` (60). An SMG cut every body in two with its third round, because the chest counts toward the waist. It is also why a point blank shotgun's throw went up: see `docs/notes/lab.md`.

## Contract additions

Muscles add `collapse`, `knockdown`, `downed`, and `impact`, `twitch` and `muscles` on `RagdollOptions`, from `muscles.ts` by module augmentation. `getUp.ts` adds the optional reaction members to `CharacterAnimation`.
The rig gains `JointDef.role` and `BoneDef.relax`. `Physics` gains `OWN_BLAST`.

Wounds add `gore.wound`, and `wound`, `fracture`, `isFractured`, `skinMaterial`, `stress` and an optional `setLod` on `CharacterInstance`, `wound` and `isFractured` on `SeveredLimb`, and `WoundHit`. `RagSource` gains an optional `isFractured`, `Rag` gains `breakJoint`, `JointMuscle` gains `broken`.

The rest are additive, in `contracts.ts`. `PhysicsSystem`: `preStep`, `radialListeners`, `raycastInto`, `anchorBody`, `stepMs`.
`GoreSystem`: optional `velocity` on `sever` and `headshot`. `CorpseHit`: `bone`, `region`. `SeverResult`: `torso`, plus the
`TorsoHalf` interface. On the concrete `Gore`: `owns`, `blast`, `stats`, `limbCenter`.

## Wounds

`wounds.ts`, `WoundPlanner`: what a hit leaves on a body. How it is drawn is in `docs/notes/characters.md`. `DamageModel.apply` calls `gore.wound` the moment the health comes off, so a killing shot marks the body too, and `damageCorpse` does the same for the dead. Severity is the share of the body's health the hit took. A corpse counts as 100 health.

| Hit | Leaves |
|---|---|
| SMG, Buzzsaw | 1.25 cm hole. Stays in a trunk. Through a limb, a small exit |
| Judge | 1.45 cm hole, and a torn 5.5 cm exit on the far side of the capsule, as the ray leaves it |
| Stakegun, Lance | Bigger of the same |
| Autocannon | 4.5 cm crater, 11.5 cm exit, 13 cm deep |
| Shotgun | Up to 4.7 cm of crater per pellet close in, 1.15 cm holes by 10 m. Within 11 cm of each other at point blank they merge, so one shell leaves one crater |
| Rocket, grenade, anything `explosive` | Opens the trunk on the side facing the blast, up to 18.5 cm across and 15 cm deep, with a burn round it and 3 to 9 shrapnel holes. Arms held in front do not stop it. Under 16% of health it only burns and peppers |
| Sword | A gash 8.5 to 20 cm long along the line where the blade's plane meets the skin, about 1 cm wide |
| Fire | A burn patch on whatever the flame reached. Nothing removed. Whole-body burning is `setBurn`, unchanged |
| Melee, crush | Bruising, and a strain on the limb |
| Anything on a machine | Dents. No interior exists, and a Titan counts |

Breaking: each hit on a limb adds `damage x breaks` to `char.stress` for that joint, and past `breakAt` (60, times size squared) it goes. One Judge round breaks a forearm, a shotgun takes three close pellets, and an SMG about seven rounds. A forearm or shin hit snaps the elbow or knee the wrong way. An upper arm or thigh hit kills the shoulder or hip. Either way a hole opens and a bone end comes out through it. A blast strains whichever limbs its shrapnel found. `updateMaim` counts a broken limb as lost for the AI, except that a broken leg never takes `legs` to 0, because crawling needs a body the animator can see has lost them.

**Gore setting.** Low paints and opens nothing and breaks nothing. Full is as tuned. Excessive cuts 25% wider and limbs go 1.5 times sooner. Written from `applyGore` in `ui/settings.ts`.

## Tuning

| Knob | File | What it does |
|---|---|---|
| `WoundTuning`, `BITES` | `wounds.ts` | Gore level, what breaks a limb, pellet range and merging, each weapon's wound |
| `GoreTuning` | `index.ts` | Caps, settle speed and time, sink, heartbeat, headshot hold and hit-stop, whole-body share and lift of a hit, limb share of force, gib launch, corpse limb health, crawl time |
| `MuscleTuning` | `muscles.ts` | Everything in the muscle layer: ligaments, resting pose, impact spin, collapse timing, twitching, jolts |
| `ReflexTuning` | `reflex.ts` | A living body off its feet: strength by phase, when it counts as landed, how it braces |
| `relax`, `role` | `rig.ts` | Resting pose per joint, and what each joint is for |
| `RagTuning` | `rag.ts` | Joint damping, death tone, hard limit strength and fade-in, rest damping, collider slimming, speed clamps, blast lift, how far a broken joint opens |
| `swingShape()` | `rag.ts` | Asymmetric hip and shoulder reach |
| `BloodTuning` | `blood.ts` | Rays per frame (24), droplet and pool caps, smear spacing |
| `ChunkTuning` | `chunks.ts` | Slots per kind, live bodies (72), linger, bounce |
| `SliceTuning` | `sliced.ts` | Hold before the halves part, slide speed, half cap |
| `CrawlTuning` | `crawl.ts` | Stroke time, reach, haul, lift |

## Forces

Measured throws per weapon are in `docs/notes/lab.md`. A body is 85 kg, and gravity is 19, twice the real thing, which is the fact everything below comes back to.

- **A hit** is `force` newton-seconds. `Gore.push` puts it on the struck bone, except that from 20 N·s to 90 N·s a growing share, up to `bodyShare`, moves the whole body through `Rag.shove`. Rocking a limb is what a bullet is for, so a bullet stays on the bone. All of a hard hit on one bone only folds a standing body at the knees: 288 N·s to the chest moved the hips 0.2 m.
- **Feet stop a standing body within 0.3 m** at under 3 m/s. Friction with all the weight on them is 13.7 m/s². That is why hard hits have `bodyLift`, and why blasts aim `blastLift` metres high. Without them, more force only shows as limbs.
- **Shove has a ceiling**, `maxShoveSpeed`, so six pellets in one frame cannot add up to a rocket.
- **A blast** throws through `Rag.radialImpulse`, in one line and under one ceiling for the chain, `maxBlastSpeed`. `Combat.blast` calls `radialImpulse` after the damage, so a body the blast kills is thrown like any other. Before, a rocket 2 m away moved a corpse 3.1 m and a body it killed 1.2 m.
- **`Physics.radialImpulse`** sets a light piece's speed from what is left of the blast, not from its mass: `DEBRIS_SPEED` per point, up to 16 m/s. On a 0.2 kg chunk any strength at all ran into a mass-based cap, so by the arithmetic a Juggernaut's footstep fired chunks in flight at the same speed as a rocket. Negative strength, which is how Black Sun pulls, works the same way.
- **A limb cut by a blast is not thrown by it again.** `Gore.blast` skips anything younger than one frame. Otherwise a rocket's direct hit gave five limbs their launch speed and then, by the arithmetic on the old numbers, about 30 m/s on top.
- `DevFlags.force` scales all of this, the ceilings included.

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
- **Throw a body along one line.** An equal impulse on every body along its own line gives a forearm ten times the speed
  of the hips and fires shoulders out sideways. So on muscle chains `Rag.radialImpulse` uses one direction, shared out by
  mass, and they set `OWN_BLAST` so that `Gore.blast` throws them whatever their age. `kick` is what sends the legs forward,
  not this. Hard-limit bodies keep the old formula, each body along its own line, so compare `muscles=0` with care. The
  figures once here, 12.8 m/s and 9.7 m, were before the forces came down.
- **Never give a sleeping body a velocity.** Rapier keeps it and reports it for good without moving the body, which then
  never settles. `Rag.preStep` skips a sleeping chain, and anything that means to move it wakes it.
- **A spring on a light limb against the floor bounces for as long as it is allowed**, and the bouncing resets the quiet
  timer that would have let it go. That is why ligaments only spring back above `limitElasticLow`.
- **A working muscle carries its own weight** (`knockdown.test.ts`, by the hand reaching a wound). The drive's implicit step is sized for one light body, so its held torque is far under what lifts an arm. Collapses and reflexes both turn gravity down on a driven limb. It was why a body lay perfectly still.
- **Nothing a hit does to the animation may land in one frame** (no test). If the same burst kills, `measureAnimVelocity` reads the jump as speed. Arms snapping to a flail seeded 14 m/s. The hop gait snapping in put the hips 9 cm sideways, read as 8 m/s, which threw a body with a blown-off leg 2.8 m across the blast. That one is the owner's "ridiculous" throw, and it was there on kills too. Everything in `stumble` and the hop now eases in.
- **In a collapse, the hold takes the reaction.** With every joint's reaction landing on the hips they thrash. While
  support lasts each body answers to one controller, and as it fades the reaction moves onto the parent, so what is left at
  the end are true joint torques with real weight on them.
- **Legs keep their gravity during a collapse** (no test). Feet need weight on the floor for friction. Over three rounds of
  six bodies at different headings, feet slid 0.09 to 0.16 m in the first 0.6 s with it and 0.34 to 0.47 m without. One body
  facing one way does not show this, so a test needs several.

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
| Crowd under fire: 24 bodies, AI on, a blast every 0.45 s, `react-chaos` at Retina size | 10 knockdowns, peak 5 down and 7 ragdolls at once, physics step peak 6.7 ms, CPU 4.7 ms a frame, every survivor back on its feet, no console errors |
| Bone movement in one frame across a handover | 0.003 to 0.026 m in Node, over four headings |
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
- **`Physics.radialImpulse` moves what it finds.** It collects bodies inside Rapier's query and applies the impulses afterwards. A chunk at rest has given back its body, so a blast only reaches chunks in flight.
- **Get-ups assume flat ground.** Feet and hands are keyed relative to the root, and the root sits on the floor under the chest. On a ramp or stairs a foot will sink or float a little. Not tried. A body beside a wall can stand with the wall inside its stand point, and `trackProgress` walks it out.
- **A burn emitter sits on the root**, so on a burning body that is down the flames ride 1.2 m above it.
- **Knocked-down bodies have no collision with the player.** They are walked through, like crawlers.
- **A collapse assumes level ground.** The hips are held at the height they started, so one begun on stairs or at a ledge
  hovers until support fades, then drops. Not tried on stairs. Airborne, call `ragdoll`.
- **A very fast joint still reaches the hard stop.** Past about 30 rad/s the zone is used up in a step or two and the
  stop does the work: peak deceleration 1842 against 2161. Hits that hard are rare, and there the stop is what saves it.
- **The straight end of a hinge has a narrow stop:** 0.14 rad past the limit, not the wide margin of the folded end, because
  `knees and elbows only fold the way they fold` allows 0.25. It was 0.18, and that test sat on the edge of its noise: over
  10 headings the worst knee was 0.36 at 0.18, 0.31 at 0.14 and 0.25 at 0.12, but 0.12 fails the ordinary whip test.
- **Arms can run past their reach** in a full blast, by 0.1 to 1 rad, before ligaments catch them.
- **Twitching varies a lot from body to body.** A burst can move a hand a few centimeters or, rarely, flop a limb 30 to
  40 cm. Judged from numbers and stills, not in motion, so it needs someone to watch it.
- **Ankles ease to rest visually only.** The foot's collider stays where it was at death, so a pointed foot can sit a
  little off the floor. Spine and neck are merged too, and take their curve from the chest and head joints.
- **Drones occasionally hit the time limit** and freeze at 7 s instead of about 2.3 s. Seen a few times in long sequences,
  never in 13 isolated runs. On hard limits they always do.
- Rapier's JS API allocates a little inside some calls. Gore passes target objects everywhere it can, but spawning a chain
  allocates descriptors. That happens per event, never per frame.
