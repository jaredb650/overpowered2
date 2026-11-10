# Gore and ragdolls

`src/gore/`, `src/physics/`, sandbox at `/?sandbox=gore&scenario=<name>`.

Scenarios: `ragdoll limbs crawl headshot explosion slice shootcorpse stairs stress rigs idle`. `rigs` works on any rig, including skitter and drone. Add `arch=trooper` for another
archetype, `dummy=1` for the capsule TestDummy, `cam=x,y,z,tx,ty,tz` for the camera. Time is fixed at 1/60, so runs repeat.
`window.__gore` has `hold()`, `step(n)` and `sheet(frames, columns)`, which draws a contact sheet over the page.

Side by side, hard limits on the left and muscles on the right under identical input: `limit` (slow motion, with a plot
of the knee), `zerog`, `fall`, `stairsab`, `blast`, `lineup` (ten each way, hard row at the back). Then `collapse` (dropped,
collapsing, collapsing on the move) and `twitch` (both on muscles, still on the left, twitching on the right).
Add `hold=1` to start paused at frame 0, so a sheet is exact however long the page took to load. `muscles=0` turns the
layer off everywhere, in any scenario and in the game itself. `weight` is four Troopers in profile shot from in front:
dropped, a lethal headshot, an SMG collapse and a Judge round to the chest. `weight=0` puts back the bodies from before the
weight pass, everywhere, the game included: feet on their soles, a collapse holding up a third of its weight, a twitching
headshot, a stumbling body that staggers on from a round in the head, and a death that keeps only its stride. Two fixes
stay on either way: a collapse's stagger and topple come in over 0.2 s, and far bodies are seeded at their true speed.
`raggrav=0.75` (0.5 to 1, left out it is 1) is the tempo dial, everywhere, the game included: bodies fall under that share
of gravity, and what throws them is slowed by its square root so that they land as far. See Forces.

```
node tools/shot.mjs --url "/?sandbox=gore&scenario=blast&hold=1" --wait 9000 --out tools/out/blast.png \
  --eval "window.__gore.sheet([20,26,35,52,90,180],3)"
```

Tests: `npx vitest run src/gore`, one file at a time on a busy machine. `muscles.test.ts`, `ragdoll.test.ts`, `weight.test.ts`,
`knockdown.test.ts` and `forces.test.ts` drive real Rapier ragdolls headless. `forces.test.ts` reads the weapon tables, so a retune must stay inside its bands. Under
heavy load add `--testTimeout=60000`: the first test to touch WebAssembly can pass 5 s at low priority.

The weight probe measures how bodies fall: `PROBE=<sections> nice npx vitest run tools/scripts/ragweight.test.ts --testTimeout=60000`.
Sections and their switches are in the header of `tools/scripts/ragweight.probe.ts`, and each lands in `tools/out/ragweight/`.
Trust six-heading means, and several rounds of them: the animator starts every body at a random phase.

## How to use it

```ts
const hit = ctx.gore.raycastCharacter(char, origin, dir, maxDist);  // CapsuleHit | null

ctx.gore.wound(char, damage, severity);           // leaves the mark of a hit. Call it for lethal hits too, before the death. True if a limb broke
ctx.gore.sever(char, 'armL', damage, velocity);   // alive or dead. null if already gone or not severable
ctx.gore.ragdoll(char, { impulses, velocity });   // death. Gore owns the instance from here
ctx.gore.collapse(char, { duration, velocity, hit });  // death with time in it. Muscles fade out, then it drops
ctx.gore.knockdown(char, options);                // ragdoll without dying. False if it cannot: stagger it instead
ctx.gore.downed(char);                            // that body, while gore has it. Null once it is yours again
ctx.gore.headshot(char, damage, velocity);        // death. Limp on this frame, at the speed it was going, still once down
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
14.1), or anything shot dead on the swarm's contract. A lethal headshot never uses it. Gore takes ownership at once and runs the animator for you, so call it
at the moment the enemy stops being an enemy, and stop driving it.

| Option | Default | |
|---|---|---|
| `duration` | 1.7 | Seconds from the first weakness to limp, 0.3 to 5. Upper body goes in the first half |
| `velocity` | none | What it was moving at. Its feet stumble on with it |
| `twitch` | 0, or 1 if headless | Twitching once it is down, 0..1 |

- It needs legs on the ground. Airborne, call `ragdoll`: it holds the hips where the animation had them, so it would hang.
- Past `GoreTuning.maxCollapses` (4), on a body with no legs, on a drone, or with `?muscles=0`, it is a plain ragdoll.
- A blast, a pin or a repeat `ragdoll` makes it give up, four times faster. A hit does by its strength, from no faster for a bullet to the same for a heavy one, and a lost limb about halfway. See Taking rounds below.
- A round in the head, or losing the head, ends it on that frame: `Rag.goLimp`, which calls `MuscleState.giveUp`. The whole round lands on the head, with nothing carried to the feet and no flinch underneath, and it falls under its full weight.
- The spine's muscles hand the trunk's weight down to the hips, and the hold and the legs carry it (`MuscleTuning.trunkCut` 0), so it sinks from its first frame. Arms and head still carry their own weight. The stagger and the topple come in over 0.2 s each, on the collapse's own clock, so a hurried one gets all of both.
- `damage.ts` passes `deathVelocity(e)` here, to `ragdoll` and `headshot`, and to `sever` for the limb: the stride, plus up to 0.6 m/s of reel and knockback (`DEATH_CARRY`), and in the air the stride and how fast it was falling. What the rounds of this frame added does not count, since the body has not stepped with it. A body killed mid-stagger stumbles on the way it was going.
- `hit: { bone, point, dir, force }` is the shot that did it: it lands on the bone, the body staggers on along `dir`, a hand goes to the wound, and a shot leg gives way first. `damage.ts` calls this for bullets of 30 N·s or less, fire, shock and bleeding out, on a body with both legs under it.

`ragdoll` takes four more options. `limp: true` is every muscle gone on this frame, so no tone arrives and nothing eases the fall: a lethal headshot. `twitch` is 0..1, and is 1 by itself on a body with no head, so a
decapitation needs nothing, except on a limp one: a lethal headshot drops like a sack and lies still (`GoreTuning.headshotTwitch`, 0).
`damage.ts` passes 0 for its own headshot deaths as well. `impact: { dir, strength }` throws the limbs: left out, it is worked out from `impulses`, so
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

- Past `GoreTuning.maxKnockdowns` (12, so that a grenade in a crowd of 12 throws all it leaves alive), on a rig whose animator has no `getUp`, or with muscles off, it returns false. `DamageModel` staggers instead.
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

Muscles add `collapse`, `knockdown`, `downed`, and `impact`, `twitch`, `muscles` and `limp` on `RagdollOptions`, from `muscles.ts` by module augmentation. `getUp.ts` adds the optional reaction members to `CharacterAnimation`.
The rig gains `JointDef.role`, `BoneDef.relax` and `BoneDef.collider`. `Physics` gains `OWN_BLAST`. `measureAnimVelocity`
calls an animator's optional `catchUp` first, which `HumanoidAnimator` has.

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
| `GoreTuning` | `index.ts` | Caps, settle speed and time, sink, heartbeat, hit-stop, a headshot's twitch, whole-body share and lift of a hit, limb share of force, gib launch, corpse limb health, crawl time |
| `MuscleTuning` | `muscles.ts` | Everything in the muscle layer: ligaments, the knee's stop, resting pose, impact spin, collapse timing and how much of the trunk it holds up, twitching, jolts |
| `ReflexTuning` | `reflex.ts` | A living body off its feet: strength by phase, when it counts as landed, how it braces |
| `relax`, `role`, `collider` | `rig.ts` | Resting pose per joint, what each joint is for, and what a bone rests on where that is not its hit capsule |
| `RagTuning` | `rag.ts` | The tempo dial (`gravityScale`) and when a body killed in the air takes it, joint damping, death tone, hard limit strength and fade-in, rest damping, collider slimming, heel feet, speed clamps, blast lift, how far a broken joint opens |
| `swingShape()` | `rag.ts` | Asymmetric hip and shoulder reach |
| `BloodTuning` | `blood.ts` | Rays per frame (24), droplet and pool caps, smear spacing |
| `ChunkTuning` | `chunks.ts` | Slots per kind, live bodies (72), linger, bounce |
| `SliceTuning` | `sliced.ts` | Hold before the halves part, slide speed, half cap |
| `CrawlTuning` | `crawl.ts` | Stroke time, reach, haul, lift |

## Forces

Measured throws per weapon are in `docs/notes/lab.md`. A body is 85 kg, and gravity is 19, twice the real thing, which is the fact everything below comes back to.

- **The tempo dial**, `RagTuning.gravityScale`, `?raggrav=`. At 19 m/s² every fall plays 1.41 times faster than real, which is
  how a body half the size falls at real gravity, the miniature effect. The dial lets a body fall under less: 0.75 is 14.25 m/s²,
  0.6 is 11.4. It is 1 until the owner chooses, and at 1 nothing changes: every death below runs the same to the last bit of every
  bone, on a fixed random stream, against the code before the dial. Under it:
  - each part of a chain is created at `Rag.gravity`, and every gravity write (a collapse's, a reflex's, `letGo`, `endCollapse`,
    sliced halves) multiplies by it, so a muscle's cut is a share of the dial's weight;
  - what moves a body is slowed by `Rag.throwScale`, the square root, because range is v²/g: `radialImpulse` and its ceiling,
    `shove` and its ceiling, a round's share on the bone (`applyImpulse`), a limb's spin (`kick`), `tip` (a knockdown's
    topple), a collapse's `toppleSpeed`, and a gib's limbs. The throw lands as far and stays in the air longer, 1.29 times at
    0.6. As first built, with rounds at full speed on the bone and friction raised, Judge kills sat back on their heels for
    0.3 to 0.6 s at 0.6, and the SMG walked a corpse 0.51 m against 0.28 at 1 (0.22 now);
  - muscles are sized for the weight that acts (`bind`), so holding up, standing, the resting pull and a twitch keep their
    share of it, and a crawling top half lifts that share;
  - speeds that count as a landing are read as they would be at full gravity: `ReflexTuning.landSpeed` and `stunThud`, the
    landing sounds (`hear`, a limb's splat, a half's thud), so nothing is quieter for falling slower. `ImpactTuning` is untouched,
    because chunks report through it too;
  - friction is not touched, 0.72 at every dial. Grip comes down with the weight, 14.4 m/s² at 1 to 8.7 at 0.6, as it would,
    so a throw slowed by the square root slides about as far: a rocket at 2 m throws a corpse 6.4 m at 0.6 against 5.7 at 1
    in the forces test, and 6.6 against 6.4 in the game. Raised to hold grip (`min(1.2, 0.72 / dial)`), a collapse's feet
    measured no better, nor with it raised only while the collapse runs; it sat a Judge kill on its heels longer (0.29 to
    0.58 s at 0.6 against 0.11 to 0.34, rounds unscaled) and stopped a thrown body 13% short in the sandbox;
  - a chain seeded faster than `loftSpeed` (2 m/s) up or down was killed in the air. It keeps full gravity until the floor
    gives back `landThud` (0.5 m/s) of upward speed in a frame, then takes the dial, with its muscles reweighed
    (`setGravity`). Gravity only takes upward speed away, so a long frame cannot read as a landing, and a frame in which gore
    pushed the chain (`Rag.pushed`: a round, a shove, a blast, a kick, a pin) is not read at all. A limb cut from a chain takes
    that chain's state, not its own seed's. A Leaper falls at 28 m/s² while it lives, and slowed the moment it died it would
    hang;
  - not scaled: a round's jolts, which are torque across joints and cannot move a body as a whole, so scaled they only made a
    dying body dance less (knockdown.test, 'jerks a dying body about'); the speed a body had when it died (see Known
    limitations); chunks, which keep world gravity and their speeds.
- **A hit** is `force` newton-seconds. `Gore.push` puts it on the struck bone, except that from 20 N·s to 90 N·s a growing share, up to `bodyShare`, moves the whole body through `Rag.shove`. Rocking a limb is what a bullet is for, so a bullet stays on the bone. All of a hard hit on one bone only folds a standing body at the knees: 288 N·s to the chest moved the hips 0.2 m.
- **Feet stop a standing body within 0.3 m** at under 3 m/s. Friction with all the weight on them is 14.4 m/s²: Rapier averages the body's 0.72 with the floor's 0.8. Under the tempo dial grip and speed come down together, so the distance holds. That is why hard hits have `bodyLift`, and why blasts aim `blastLift` metres high. Without them, more force only shows as limbs.
- **Shove has a ceiling**, `maxShoveSpeed`, so six pellets in one frame cannot add up to a rocket.
- **A blast** throws through `Rag.radialImpulse`, in one line and under one ceiling for the chain, `maxBlastSpeed`. `Combat.blast` calls `radialImpulse` after the damage, so a body the blast kills is thrown like any other. Before, a rocket 2 m away moved a corpse 3.1 m and a body it killed 1.2 m. The current throws are in `docs/notes/lab.md`.
- **`Physics.radialImpulse`** sets a light piece's speed from what is left of the blast, not from its mass: `DEBRIS_SPEED` per point, up to 16 m/s. On a 0.2 kg chunk any strength at all ran into a mass-based cap, so by the arithmetic a Juggernaut's footstep fired chunks in flight at the same speed as a rocket. Negative strength, which is how Black Sun pulls, works the same way.
- **A limb cut by a blast is not thrown by it again.** `Gore.blast` skips anything younger than one frame. Otherwise a rocket's direct hit gave five limbs their launch speed and then, by the arithmetic on the old numbers, about 30 m/s on top.
- `DevFlags.force` scales all of this, the ceilings included.

## How it works

- `Rag` is any bone chain driven by bodies: a whole body, an arm, a top half. A body's frame is its bone's world frame, so
  joint anchors are trivial and limits read straight off relative rotation.
- Bones are driven by **rotation only**, down from the chain root. Solver stretch cannot reach the mesh.
- Velocity seeding steps the animation 1/90 s ahead, differences the pose and restores it. No per-frame tracking of the living.
  A far body first spends the frames its level of detail saved up (`catchUp`), and the step poses at the detail it was
  drawn at. Before, a planted foot drawn under a root that had moved on read as metres a second, and bodies at LOD 1 and 2
  were seeded up to 1.7 times too fast. Now the worst seeded bone of a running Trooper is within 6% at every level.
- Feet rest on a ball under the ankle, `BoneDef.collider`, not on their hit capsule, so a dead shin cannot stand on its
  sole. The foot keeps its mass, and hits, cuts and slices still read the capsule. `RagTuning.heelFeet`.
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
- **Collapse.** The animator runs against a ghost root, and joints track what it writes. The spine hands the trunk's weight
  to the hips, and the hold and the legs carry it, so the body sinks from the first frame. See Collapse and twitching above.
- **Twitching.** Sine-squared torque bursts and whole-body spasms, on a schedule. They fade by getting rarer and shorter,
  because a limb on the floor does not stir at all below its own weight.

Tone lasts about 3 s after death and then nothing is pulling on the body. Below 0.35 m/s a ligament can only brake, so a
body has to come to rest. A corpse shot awake moves, but has no tone left.

### What has to stay true

Each of these was found the hard way. All but the two marked are guarded by a test, in `muscles.test.ts` unless another is
named, checked by breaking each one on purpose in a copy and seeing the test fail.

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
- **A working muscle carries its own weight** (`knockdown.test.ts`, 'a body lying down reaches its wound', on real Rapier). The drive's implicit step is sized for one light body, so its held torque is far under what lifts an arm. Collapses and reflexes both turn gravity down on a driven arm or head. It was why a body lay perfectly still. Lying on its back, the wrist gets to 0.24 to 0.31 m of a wound on the thigh with it, and 0.55 to 0.66 m without. The trunk is the exception: in a collapse its weight goes onto the hips, where the hold and the legs carry it, and that is what makes a dying body heavy. Left on the chest, it pitched the chest over the hold and turned the hips up to 1.1 rad off the animation's, which 'tracks the animation steadily' (limit 1) caught one run in ten; on the hips the worst of 40 bodies is 0.58.
- **Nothing a hit does to the animation may land in one frame** (no test). If the same burst kills, `measureAnimVelocity` reads the jump as speed. Arms snapping to a flail seeded 14 m/s. The hop gait snapping in put the hips 9 cm sideways, read as 8 m/s, which threw a body with a blown-off leg 2.8 m across the blast. That one is the owner's "ridiculous" throw, and it was there on kills too. Everything in `stumble` and the hop now eases in, and so do a collapse's stagger and topple, over 0.2 s.
- **A ragdoll's speed is read with the body plan held** (`muscles.test.ts`, on a real `hidden`). `measureAnimVelocity` steps the animator with `probing`, which skips `refreshPlan`, because a limb that went this frame is not motion. Without it the difference is read over 1/90 s, so 13 cm is 12 m/s. A burst head started every body at about 12 m/s in a random direction with most joints at the 18 rad/s clamp, and it hit the floor in 0.19 s, faster than gravity. Two arms in one blast read as 2.4 m/s on the whole body. The animator's old headless walk was the worst of it, and is gone: nothing living has no head.
- **In a collapse, the hold takes the reaction.** With every joint's reaction landing on the hips they thrash. While
  support lasts each body answers to one controller, and as it fades the reaction moves onto the parent, so what is left at
  the end are true joint torques with real weight on them.
- **Legs keep their gravity during a collapse** (`weight.test.ts`). Feet need weight on the floor for friction. Over three
  rounds of six bodies at different headings, the median foot got 0.07 m from where it stood in the first 0.6 s with it, and
  0.28 to 0.43 m without. One body facing one way does not show this, so the test takes several, and the median, because the
  death stumble now and then lurches a whole body 0.3 to 0.6 m whatever its feet do.
- **A dead foot rests on its heel** (`weight.test.ts`). On the whole sole a dead shin stood up by itself like a boot, and a
  body squatted on its heels for 0.5 to 1.2 s before it went over, a Brute up to 3.3 s. On a ball under the ankle the shin
  tips and the knees go: down in 0.3 s. Only the collider changed, so mass, hits, cuts and slices are as they were. It holds
  on the tempo dial too, at 0.75 and 0.6, over five rounds of six with the times stretched by the dial's pace (weight.test,
  'on the tempo dial'). With rounds on the bone at full speed and friction raised to hold grip, as the dial was first built,
  Judge kills sat on their heels 0.46 to 0.66 s at 0.6, and that build fails it every run.
- **Every chain's gravity write multiplies by the chain's share of it** (`ragdoll.test.ts`, 'no part outweighs the dial'). One
  that writes a plain number snaps that part back to full gravity under the tempo dial. Through a knockdown, getting up, dying
  on the floor, a collapse to its end and one ended by a head round, at 0.6, no jointed part goes over the dial and no chain
  weighs more than the dial allows. The hips of a collapse go over on purpose, carrying the trunk, so they are held to the
  chain's total. Each of the six writes, and the body's creation, broken on its own in a copy: the test fails on every one. Not
  covered: the two writes in `sliced.ts` (a half's hold and its release) and the crawler's lift, which no test runs on the dial.
- **A body killed in the air falls at full gravity until only the floor stops it** (`ragdoll.test.ts`, two tests). Without
  it, a Leaper shot falling at 28 m/s² would drop to 11.4 the frame it died, and hang. In the game, killed 2.2 m up and falling
  at 6 m/s, its hips reach the floor 0.27 s after the kill at 1 and 0.6 alike. Read as any loss of the chain's momentum, as it
  was first built, a body killed rising took the dial 2.3 m up at 30 fps and stayed in the air a third longer, and a round
  against a falling one's motion did the same; a limb cut from a body thrown on the dial went back to full gravity. In a copy,
  the second test fails with the old landing check, with pushed frames read, and with a limb deciding from its own seed.

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
| Weight pass, plain deaths (drop, headshot, Judge), Trooper and Brute, six headings, three rounds each in two sessions, against `?weight=0` | On its heels 0 to 0.01 s against 0.5 to 3.3 (a Brute's Judge death 0.5 to 1.2, see Known limitations). Knees down 0.27 to 0.31 s against 1.0 to 2.3. Hips on the floor 0.28 to 0.33 s against 0.34 to 0.45. First 0.25 s at -14.9 to -15.6 m/s² against -12.7 to -13.5. At rest 0.9 to 1.8 s against 1.1 to 2.0. Head to foot at rest, Trooper, 0.75 m against 0.96 |
| Weight pass, SMG collapses of 0.85, 1.1 and 1.4 s, plain and shot in the chest, Trooper and Brute, six rounds of six headings, same | Gravity over the first second 0.93 to 0.97 of full against 0.53 to 0.74. Weight cut 5 to 8% against 35 to 42%. First 0.25 s at -2.3 to -4.6 m/s² against -1.7 to -3.3. Fastest fall 1.75 to 2.26 m/s against 2.06 to 2.83. Knees 0.35 m down at 0.13 to 0.15 s against 0.20 to 0.32. Hips on the floor at 0.98 s for 1.1 s, against 0.97 to 1.03. Feet at rest 0.19 to 0.29 m from where they stood (Brute 0.30 to 0.47) against 0.26 to 0.48 (0.36 to 0.56) |
| Lethal headshot once down, husk, Trooper, Brute | Hips rise at most 0.03 m after 1 s, against 0.21 to 0.41. Head, hands and feet move 0.02 to 0.3 m between them against 2 to 4.4. Frozen at 1.3 to 1.6 s against 5 |
| Judge kills frozen with a knee above 0.25 m, 18 per round, two sessions | 1, 2, 2 and 1, 0, 0, all Brutes, against 4, 2, 4 and 3, 4, 5, from all three archetypes |
| Worst seeded bone, Trooper running at 3.8 and 2.2 m/s, mean of 48 frames | LOD 0 6.4 and 4.2 m/s, LOD 1 6.3 and 4.3, LOD 2 6.0 and 4.0. Before: LOD 1 8.5 and 6.4, LOD 2 10.4 and 9.3 |
| `react-chaos`, weight pass against `?weight=0`, three runs each, load 5 to 7 | Physics step peak 7.9 to 10.2 ms against 6.8 to 10.1, CPU 4.9 to 5.8 ms a frame against 4.1 to 6.0: no difference past the noise. Every survivor back up, no console errors. Once more after the trunk's weight moved to the hips, load 2: 10.1 ms and 5.5 ms, the same |
| Tempo dial at 1, against the code before it | Twenty-one deaths (drop, a running headshot, Judge and SMG collapse with a head round, on three archetypes; knockdowns by topple and blast; rocket, point-blank shotgun, sever, gib, killed falling and rising, a waist cut and its crawl), every bone every 0.1 s, the landing sounds and the loose limbs, on a fixed random stream: identical to the bit. The same run at 0.75 moves bones by 0.16 to 1.25 m, so it would show a difference. Again after the fix round (rounds and spin on the dial, plain friction, the landing check), with a second harness that hashes every rigid body every frame across the same twenty-one: identical |
| Tempo dial, plain deaths (drop, a still headshot, Judge), Trooper and Brute, six headings, six rounds at 1, 0.75 and 0.6, `PROBE=tempo` | Hips on the floor 0.28 to 0.36 s, 0.33 to 0.48, 0.38 to 0.51. First 0.25 s at -14.8 to -15.7 m/s², -11.0 to -11.7, -8.7 to -9.2. Knees down 0.26 to 0.31 s, 0.30 to 0.36, 0.33 to 0.39. At rest 0.7 to 1.9 s, 0.8 to 2.0, 1.0 to 2.0. Hips rebound up to 0.06 m on a Trooper at 1, 0.09 at 0.75, 0.12 at 0.6; a Brute's up to 0.13, 0.18, 0.20. Slide once lying up to 0.23 m at 1 (a Brute's Judge kill), 0.20 at 0.75 and 0.6. A Trooper never on its heels; a Brute's Judge kill 0.85, 1.03, 1.83 s on average, which is its knees up at rest (Known limitations) |
| Tempo dial, SMG collapses of 1.1 s shot in the chest, three rounds of six headings per round, same | Feet in the first 0.6 s, median: Trooper 0.13 m at 1, 0.18 at 0.75, 0.23 at 0.6 (rounds 0.20 to 0.29); Brute 0.14, 0.14, 0.18 (rounds 0.13 to 0.22). Feet at rest: Trooper 0.25, 0.28, 0.33 m; Brute 0.34, 0.41, 0.41, single rounds up to 0.55. At rest by 1.9 to 2.9 s at every dial |
| Tempo dial, body killed 1.2 m up falling at 6 m/s, same | Hips on the floor at 0.22 to 0.23 s at every dial: full gravity until it lands |
| Tempo dial, body killed rising at 6 m/s from 1 m, 30 fps | Takes the dial on landing, hips 0.14 m up, and is down at 0.767 s at 0.6 as at 1. As first built it took the dial 0.10 s after the kill, 2.29 m up, and came down at 1.000 s |
| Tempo dial, the forces test's own measures (deterministic) at 1, 0.75, 0.6 | Rocket at 2 m 5.71, 5.79, 6.43 m, peak 9.4, 8.7, 7.6 m/s. Rocket at 5 m 3.16, 3.08, 3.10. Nuke 5.49, 5.33, 5.08. Point-blank shotgun 1.84, 1.86, 1.97. SMG 1.5 s on a corpse 0.28, 0.17, 0.22 m (0.41 and 0.51 with rounds at full speed). Force dial 0 leaves 0.12, 0.03, 0.03 |
| Tempo dial, `knockdown.test.ts` and `weight.test.ts` run whole on the dial, one file at a time | knockdown at 0.6: 1 failure in 80 runs, 'jerks a dying body about' at a ratio of 1.21 against 1.3 (with jolts slowed too, 4 in 60, and as first built 2 in 33, the SMG walking a collapse 3.6 to 4.5 m); at 0.75, 8 of 8. weight at 0.75 and 0.6: about one run in four fails, in 'lies flat', 'lies still' or 'legs keep their gravity' (Known limitations); its heels on the dial, five rounds, pass 35 runs of 35 |
| `react-chaos`, tempo dial 1 against 0.6, alternating, load 2.5 to 12 | Physics step peak 6.9 to 10.4 ms over five runs at 1, and 8.1 to 9.6 over five of seven at 0.6. The other two peaked at 23.5 and 26.8, both while the load ran 7 to 12 with another process holding a core. CPU 3.9 to 7.0 ms a frame against 3.9 to 6.3. Every survivor back up in all twelve, no console errors. After the fix round, load 1.5 to 3.5: 9.7 ms against 9.8, every survivor up, no errors |

## Known limitations

- **A limp body running at 3.8 m/s can vault its planted leg.** Hips stay near 0.6 m for about 0.2 s before it goes down, and it can read as a held stride. Judged from a sheet, not in motion, so it needs someone to watch it. The heel did not change it: shot in the head on the range at 2.7 to 3.2 m/s, the hips were still 0.48 to 0.55 m up 18 frames later, and headless at 3.8 m/s they average 0.57 against 0.48 on the sole.
- **A dead body ends folded on its knees.** It drops through them in 0.3 s and lies back over its shins: head to foot 0.75 m on a Trooper, against 0.96 when it sat on its heels first. A stop at the knee's folded end, 0.1 to 0.35 rad past the rig limit, and a braking zone before it were tried: none laid a body out any longer, and every one propped bodies in a kneel for up to a second. The `sweep` section of the weight probe has the numbers.
- **A Brute killed by a Judge round can freeze with its knees up**, none to two in 18. Lying back, its folded legs are lifted with its thighs, and they stay there. The probe counts this as sitting on its heels.
- **Under the tempo dial more bodies end with a knee up.** At rest with a knee above 0.25 m, of 84 probe deaths a round: 4 to
  8 at 1, 7 to 11 at 0.75, 9 to 14 at 0.6. Nearly all are Brutes (Judge kills and collapses), and a Brute killed in the air
  can come to rest propped with its hips 0.36 to 0.43 m up (two in six rounds at 0.75, never at 1). The cause is the
  resting-pose pull, `neutralCap`, which holds the legs toward the microgravity pose: with it off, 0 of 84 at 1 and 1 of 84
  at 0.6, and nothing propped. Scaling its rate, the ligaments, the joint damping or the settle speeds with the dial changed
  nothing past the noise. Not changed: the pull is how every body settles, so it is the owner's call. It is also why the
  Brute above freezes with its knees up.
- **`weight.test.ts` holds only at 1 for lying flat and lying still.** Run whole on the dial, the file fails about one run in
  four at 0.75 and 0.6: 'lies flat', a dropped Trooper ending with a knee 0.28 to 0.39 m up (the pull above); 'a lethal
  headshot lies still', its hips 0.032 to 0.043 m above where they end, or 0.63 m of motion, after 1 s; now and then 'legs
  keep their gravity during a collapse', 0.165 m against 0.16 (the skate below). The headshot is mostly its window: a fall
  at 0.6 takes 1.29 times as long, and counted from 1.3 s it passes 24 bodies of 24 at 0.6. Only the heels are run on the
  dial in the suite. A default below 1 needs these, and `muscles.test.ts` 'falls at the speed of gravity', made to know the
  dial.
- **A body keeps the speed it died with, and under the dial it falls for longer, so it goes further.** Killed moving at 2 m/s,
  the hips travel 0.95 m at 1, 1.01 at 0.75 and 1.17 at 0.6, 12 bodies each; standing still, 0.12, 0.15 and 0.19. Holding grip
  makes no difference: it is the time in the air. A Brute killed in the air with 2 m/s across slides 0.32 m once lying at 1
  and 0.56 at 0.6. Slowing that speed at death would hold it, at the cost of a body visibly losing a quarter of its speed the
  frame it dies; not done, the owner's call. It is the likely reason a point-blank shotgun goes a little further in the game
  at 0.6: 2.67 m on average over 23 kills against 2.29 at 1 in the same sessions (medians 2.52 and 2.33), where the pellets'
  push is already in the body's speed when the last one kills it. Headless, where it is not, the same kill goes 1.97 against
  1.84.
- **Feet skate more in a collapse under the dial**: a median of 0.18 m in the first 0.6 s at 0.75 and 0.23 at 0.6 on a Trooper,
  against 0.13 at 1, and 0.18 at 0.6 on a Brute against 0.14. A collapse is held up by muscles and a hold on the hips that
  work on the clock, not on gravity, and the feet under them carry less weight. Grip held, at 1.2 and 1.73, or raised only
  while the collapse runs, measured no better.
- **'Jerks a dying body about' is close to its line at 0.6.** Rounds land slowed on the dial, the quiet collapse they are
  compared with does not, so the ratio falls from about 2.3 at 1 to about 1.9 against a line of 1.3: one run in 80 failed, at
  1.21.
- **Not everything that throws a body knows the dial.** Call-ins (the nuke's front, Black Sun) push what they find directly,
  chunks and corpses alike, so under the dial they throw a corpse up to 1/dial as far. `Physics.radialImpulse` throws
  hard-limit bodies (`muscles=0`) at full speed, and sliced halves too, which then fall on the dial, so a blast near the
  halves of a sword kill sends them up to 1/dial as far. Loose limbs (0.62) and sliced halves (0.7) keep their friction, and
  halves their slide speed, so they slide a little further.
- **The end of a collapse steps harder by the probe's measure.** The largest change in the fall's acceleration from 0.6 of the
  way to its fastest is 3.4 to 8.1 m/s² as a six-round mean, against 2.9 to 4.5 with `?weight=0`; single bodies range from 2
  to 15, so only many rounds say anything. The worst is the 0.85 s Trooper collapse. The hips come down steadily from the
  first frame, and in the last 0.3 s of a 1.1 s collapse they fall 0.30 m against 0.51 (0.39 against 0.47 at 0.85 s), so
  less is left for the end. Not looked into.
- **A Brute collapse can still skate**: its feet end 0.30 to 0.47 m from where it stood, against 0.36 to 0.56 before.
- **The death stumble can lurch a whole body** 0.3 to 0.6 m in the first 0.2 s of a collapse, feet and all, about one collapse in nine. It was there before the weight pass. Not looked into.
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
- **The library pools 96 instances per archetype** and takes the oldest back when it runs out. Gore detects that and lets
  go, so a corpse whose instance went back simply disappears. 48 live enemies plus 40 corpses of one archetype is 88, inside it.
- Pools grow as stacked decals, since `DecalSystem` has no resize. 5 per corpse.
- **`Physics.radialImpulse` moves what it finds.** It collects bodies inside Rapier's query and applies the impulses afterwards. A chunk at rest has given back its body, so a blast only reaches chunks in flight.
- **Get-ups assume flat ground.** Feet and hands are keyed relative to the root, and the root sits on the floor under the chest. On a ramp or stairs a foot will sink or float a little. Not tried. A body beside a wall can stand with the wall inside its stand point, and `trackProgress` walks it out.
- **A burn emitter sits on the chest bone** (`EnemyManager`), so it goes down with the body. Only a rig with no chest carries
  it on the root at chest height, and there the flames ride above a body that is down.
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
- **Ankles ease to rest visually only.** The foot's collider is a ball under the ankle, fixed to the shin, and the visible
  foot reaches about 0.21 m ahead of it with nothing under it, so toes can dip into the floor on a body lying face down.
  Stairs looked right in the sandbox sheets; slopes were not tried. Spine and neck are merged too, and take their curve from
  the chest and head joints.
- **Drones occasionally hit the time limit** and freeze at 7 s instead of about 2.3 s. Seen a few times in long sequences,
  never in 13 isolated runs. On hard limits they always do.
- Rapier's JS API allocates a little inside some calls. Gore passes target objects everywhere it can, but spawning a chain
  allocates descriptors. That happens per event, never per frame.
