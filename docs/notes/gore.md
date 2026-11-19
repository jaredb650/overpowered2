# Gore and ragdolls

`src/gore/`, `src/physics/`, sandbox at `/?sandbox=gore&scenario=<name>`.

Scenarios: `ragdoll limbs crawl headshot headpartial explosion slice shootcorpse stairs stress rigs idle`, and the torso
breaks: `crack blowout guts spurt ribcage`. `rigs` works on any rig, including skitter and drone. Add `arch=trooper` for another
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
of gravity, and what throws them is slowed by its square root so that they land as far. See Forces. `mass=0` puts back hits
from before they knew the mass of what they hit, everywhere, the game included: a round's jolt and a blast's spin as big on a
Juggernaut as on a Trooper, up to 9 m/s from one round on a limb, the bigger living flinch on springs that rang past rest, and
a ragdoll budget that froze the oldest body whatever it was doing. See Taking rounds and The ragdoll budget. `knock` is three
husks knocked over alive at frame 20 and back up: a body check, a head hit that knocks one cold, and a rocket's blast 3 m in
front of one facing the camera. `knock=0` puts back knockdowns from before they could be run over, everywhere, the game
included: running into a body only staggers it, only a shotgun or a heavy round to the head floors it and nothing knocks it
cold, a braced hand holds stiff, the arms carry their own weight in a fall, and a thrown body's hands leave its face after
0.2 s. See Knockdown and getting up. `struggle=0` puts back getting up from before a body fought its way up, everywhere, the
game included: it gathers to the first frame of the clip and the animation does all of it, over the whole rise, and a body on
its way up is put back down only by a head hit, a blast or being run into. `stand=0` puts back falls from before a living body
lost its balance on its muscles, everywhere, the game included: the animation staggers it, then 0.16 to 0.42 s later a
knockdown tips it over with its legs and spine locked. It also puts back staggers from before a body caught its balance on
its muscles (`stand.ts`): every stagger is the animation's, on its springs.

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
ctx.gore.headshot(char, damage, velocity, outcome); // death. Limp on this frame, at the speed it was going, still once down
ctx.gore.headPellets(char, damage);               // pellets of this frame's blast on that head so far, counting this one
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
- A killing headshot's `outcome` (`HeadOutcome`, decided by `headOutcome` in `src/enemies/damage.ts`, plan in
  `docs/proposals/partial-head-wounds.md`): `hole`, the head stays on; `burst`; `partial`; `off`, whole. A bullet never
  takes a head off: under 40 a hole, 40 or more a partial wound on the Trooper, Gunner, Husk and Brute and a burst on the
  rest, and a burst for the very
  damaging (autocannon, Sabot, the Judge within 8 m, 4 pellets of one blast on one head, `HEAD_VOLLEY`). Left out, the
  outcome is a blast's: a burst at 40 or more, else off whole. On a body gore already has (down, rising, dead) a burst
  cuts the head out of the ragdoll where it lies. A club leaves the head; the katana's slice plane still takes it.
- A **partial** wound is a baked partial head standing in for the real one, on the archetypes in `PARTIAL_HEADS`
  (`src/gore/index.ts`: the Trooper, Gunner, Husk and Brute); the rest burst, as does one whose heads have not loaded yet, and `?headpartial=0`
  bursts them all. Two props per archetype, baked from his own head (`tools/bake/parts/headWreck.ts`, `partialHead` in
  `props.ts`): `<arch>HeadPartialSide`, his left side sheared off (mirrored for a round from his left), and
  `<arch>HeadPartialTop`, the crown and upper face blown open. Each head's measurements (outer crown and face, skull, the
  Brute's iron mask) and palette (the Husk's dead flesh) are `fitFor` in `headWreck.ts`; the cut planes are shared. A round within `PARTIAL_SIDE` of the head's sideways axis
  takes the side, anything else the top. `partialHead` loads them at `init` through `ctx.characters.prop` and mounts a clone
  with `Character.standIn(headBone, mesh)`: the head bone's bind inverse is collapsed for that body alone, so its skin
  (and the interior's) folds away while the bone stays, still hit, on the ragdoll, and still burst or shot off on the corpse;
  a severed head takes a clone of the stand-in with it (`SeveredPart.pose` shares the body's bind inverses). Reset puts the
  shared inverses back and drops the stand-in (`attachProp(..., untilReset)`). It also hides anything else still on the
  head bone, a helmet no plate threw. It still throws step 1's cranium shells, half a brain and meat, with blood. Sandbox:
  `scenario=headpartial&arch=<trooper|gunner|husk|brute>`, captured by `tools/scripts/headpartial-shots.mjs` (`HP_CHECK=1` also bursts and
  shoots off the heads and checks the reset). The sandbox has no player, so gore puts bodies on the far LOD, which draws no
  wounds: `setLod(0)` them before drawing.
- The burst is a kit of pieces that add up to a head, built in code in `chunks.ts` and scaled to the head's radius (x1.15):
  the cranium in three curved shells (bloodied bone outside, dark red inside), the jaw in two quarter rings, the brain in
  two halves, two eyes. They start where they sit in the head and fly out from its centre together, pushed along the
  shot. A soldier's helmet still on is thrown off first (`DamageModel.throwHelmet`); on a corpse it goes with the head.
- A corpse's head: pellets that bring this frame's blast to four on it, or wear it through, burst it; anything else that
  wears it through (`corpseLimbHealth`) shoots it off whole. A non-lethal head removal is `sever(char, 'head', ...)`.

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
- Past `GoreTuning.maxCollapses` (8 since the gore update's R4; 4 before, and with `?carry=0`), on a body with no legs, on a drone, or with `?muscles=0`, it is a plain ragdoll.
- **A kill on a body gore already has on its feet dies on its feet (R4, `?carry=0` or the dev panel's "Hits: dying carries shots").** `collapse` on a living body that is catching its balance or losing it (`downed(char).standing`) used to end the knockdown and drop it where it stood, and `damage.ts` never asked: `diesOnFeet` refused anything `downed`. That was the common case, not a corner: an SMG's second round staggers a Trooper onto its muscles and the third kills it, so of eight Troopers shot dead in a row none died on its feet. Now `Gore.dieStanding` turns the drive it was standing on into a death's (`MuscleState.dieOnFeet`): the same chain, the same joint targets from the same animator, nothing rebuilt. The hold under its hips is never stronger than its balance had left it (`CollapseDrive.cap`), its clock starts half way to where a death's hold begins to go (0.15 of `duration`), and the killing round lands as on any body dying on its feet (a quarter on the bone, the rest into where its feet are heading, a jolt, a hand to the wound). With no room it drops as before. Measured (`carry.test.ts`, a Trooper catching its balance killed 12 frames in, a 1.1 s death): hips on the floor 0.58 s after the kill against 0.23 s dropped; no bone's movement changes by more than 0.036 m in a frame over the hand-over. On the Test Range, eight Troopers killed by three SMG rounds each inside a third of a second (`HIT_VOLLEY=8 tools/scripts/hit-seq.mjs`): 8 on their feet at once against 0, each up 23 to 28 frames after its first round against 17 to 19; physics step median 0.9 ms against 0.7, worst 7.9 against 6.8.
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

`knockdown(char, options)` is a ragdoll that comes back. Gore has the bones until the body has pushed itself part of the way up, or gathered its limbs for the clip, then hands the character back already getting up, with `root` where it will stand. The caller keeps the character and reads `downed(char)` each frame: while it answers, `center` is where the hips are. Any death call ends it, and the body goes on falling from where it was.

| Option | | |
|---|---|---|
| `topple` | m/s on the upper body | Tips it over its feet. Legs and spine lock for 0.42 s, or a standing body folds at the knees and rolls over its own head. Leave it out for a blast, which throws by itself once `Physics.radialImpulse` finds the body, and for a body knocked down on its way up, which drops from the clip's pose |
| `impulses`, `impact`, `velocity` | as `ragdoll` | |
| `lie`, `rise` | seconds | On the floor, and for the clip. A body that fights its way up hands back part way through it, and the clip plays the rest over `rise`: `damage.ts` passes 0.73 of the old rise for a body with all four limbs |
| `hurt` | 0..1 | Below `painFrom` it never clutches a wound and pushes up in half the time, never giving out. Above it the get-up strains and shakes, and a third of the way to 1 and over it can give out (`giveOutChance`) |
| `wound` | `{ bone, point }` | Where a hand goes |
| `knockout` | boolean | Knocked cold by a head hit. The round snaps the head back on its neck from `wound.point` along `impact.dir`, the neck and arms go slack, and it goes over like a sack |
| `stumble` | `{ seconds, budget? }` | Losing its balance, not knocked off its feet. Needs no `topple`. With a `budget` it may catch it. See below |
| `cost` | 0..1 and over | On a further hit to a body catching its balance: the share of its health the hit took, which its budget pays for |
| `strength` | `LimbStrength` | What its wounds leave each limb, 0..1 (stage 8). There at once on the first call, eased in on a further hit. `setStrength(char, s)` changes it while gore has the body |
| `roll` | seconds | On fire: once down it rolls over and back for this long |

A further `knockdown` on a body that is down is a further hit: impulses land, a jolt goes in, the wait to get up lengthens, and a body that had begun to rise goes back to lying. Nothing starts over. Fighting its way up, what hits it adds up and fades at `knockFade` (7/s), and at `struggleKnock` (0.6) it is knocked back down: one SMG round (0.47) only rocks it, a second 0.1 s later, a shell's pellets together or a Judge round put it down.

Who calls it, in `damage.ts`: a fall, a trip, a blast, a head hit it lives through (`reactions.ts`, see `docs/notes/enemies.md` Hit reactions), and the body check, when the player runs into it (`contact.ts`, `DamageModel.bodyCheck`). The body check keeps at most 3.5 m/s of the player's speed in `velocity`, tips the body over along the run at 1.8 to 2.8 m/s and struck at the chest; a slide strikes the thigh, tips the upper body back at 1.2 m/s and throws the limbs back along the slide (`impact` 0.8 the other way), so the legs go on with the player and the body goes over backwards. A body check starts inside the enemy's own update, so `EnemyManager.updateEnemy` stops there when the body has gone down (What has to stay true).

- **Knocked cold.** `knockout` on a pellet or a heavy round to the head. One `jolt` on the head, as first planned, passes most of the round up the chain: the chest whipped back 0.6 to 0.8 rad on the hips in two frames, and the head, lagging it, read as a nod. So the round snaps the neck alone, `MuscleState.whip`, toward `ReflexTuning.koWhip` (24 rad/s) times the body's jolt share: 0.50 to 1.0 rad along the shot within 0.1 s. Then the head has no drive for `koHead` (0.25 s), the arms at most `koArm` (0.1) for `koSeconds` (0.6 s) with no brace and no guard, and legs and spine lock for `koPlank` (0.25 s) where a topple locks them 0.42 s. `damage.ts` makes it lie 1.5 times as long and get up dazed for its whole `daze`.
- **The brace gives.** Falling, the arms reach out and down for the floor at `braceGain` (5) times what holds them up. Once a hand's fingertips are `yieldReach` (0.08 m) off the floor with the chest still coming down, its elbow eases from `braceElbow` (0.3) to `yieldElbow` (1.3) over `yieldSeconds` (0.18 s) and the arm drops to `yieldGain` (2), so it bends and lets the weight through rather than propping the body on a straight arm.
- **Arms have weight in a fall.** `ReflexTuning.fallCarry` (0.5) is the share of a working arm's and head's gravity cut they keep while falling. At 1, as before, a falling arm weighed a quarter of itself.
- **A thrown body guards its face** while its hips are above `landHeight` of standing and it falls slower than `guardFalling` (2 m/s), for at most `guardHold` (0.6 s), then lets go over `guardFade` (0.25 s) to meet the floor. Before, it let go after 0.2 s whatever it was doing.
- **It fights its way up.** Face down or face up with both arms and both legs whole, it pushes itself on its own muscles to `struggleU` of the way through its clip: face down up on straight arms with its legs still out behind, a push-up (0.24, the prone clip's second key; the clip brings the knees under after), sat up face up (0.3). Joints drive to that frame's pose at `struggle` strength (arm 0.9, leg 0.7, spine 0.55, head 0.5), arms and legs at `pushGain` (4) times what holds them up; the legs come with the body, their pose eased from where they lay by how far up it has got. The effort builds over `pushSeconds` (0.7 s, or `pushUnhurt` 0.35 s for a body that feels nothing). Under the hips and between the shoulders the lift carries the rest (`MuscleState.lift`): an explicit vertical impulse each sub-step, never a joint torque, toward where the frame has them, rising with the effort, full `assistBand` (0.06 m) under them and nothing within `assistSlack` (0.03 m), and never more than `assistMax` (0.55) of the body's weight times the effort (all of it from half way) and the weaker of arms and legs as a share of their push. On top of it arms, legs and head carry their own weight by their drive, as on the floor (What has to stay true, a working muscle carries its own weight): at `struggle` strength another 0.36 of the body's weight, so at full effort about 0.9 of it is carried by help that is not the floor, against 0.19 to 0.26 lying. Up is hips and shoulders within `upReach` (0.08 m) of the frame and the chest within `upTilt` (0.5 rad) of its lean for `upHold` (0.15 s); it gathers there `upGather` (0.2 s) and is handed back at that point of the clip, which plays the rest. Not there in `upPatience` (2 s), it gathers for the clip's first frame as before. Short of a limb, or with one broken at the shoulder, elbow, hip or knee, it gathers for the clip as before: on one shin a body face down never got its hips past 0.21 m. Killed on its way up, the lift and the push stop on that frame (`Reflex.die`) and what it held fades over `dieSeconds` as a gather's would, so it drops under its own weight. Thrown by a blast while it pushes, the lift goes on the same sub-step and the legs get back their weight and their gain of 1 (`Reflex.thrown`), which the fall would otherwise leave at the push's.
- **Hurt, it gives out.** An attempt fails with chance `giveOutChance(hurt)`, `giveOut` (0.45) times `hurt - 1/3`: never for a body under a third hurt, a Husk included, 0.26 at 0.9. The owner's question 3; at 0.45 about a quarter to a third of the Troopers knocked down on the range give out at least once (31% of 96, Measured). It gives out `giveAt` (0.7 to 0.9) of the way up, or `giveLate` (0.5 s) after its effort is all there: the arms drop to `slumpArm` (0.15) with the elbows giving and the lift goes over `slumpSeconds` (0.25 s), so it drops under its own weight, lies `retryWait` (0.5 to 1.2 s) and tries again. After `maxTries` (3) attempts one has to succeed, so none gives out more than twice. Knocked back down by a hit, all of that at once.
- **Losing its balance** (`stumble`, `damage.ts` `fallFrom`: a fall, a trip or the wounds' `drop`, at full detail, in view and within 20 m). The body goes onto its muscles on the hit's frame and follows the stagger its animator was just given, on a `CollapseDrive` with `alive` set: the hold under the hips carries the trunk's weight and fades over `standFade.support` (0 to 0.7 of `seconds`), the legs over 0.35 to 1, spine 0.5 to 1, arms and head 0.7 to 1. The Reflex waits. Each frame `MuscleState.readBalance` reads where its weight is heading (the capture point, from the centre of mass and its speed over the drift the legs still carry) against the feet, and it loses its feet past `balanceLost` (1.6 steps of `stepReach` 0.55 m), a chest `tiltLost` (0.8 rad) off the one the stumble asks for, `hipGapLost` (0.3 m) off the animation's hips, under `sunkLost` (0.5) of its standing height, or at `seconds` (the fall's 0.16 to 0.42 s lead plus 0.35). Then the same chain falls under the Reflex (`offFeet`), every target eased from the stumble's over `offBlend` (0.2 s). A death on the way, a blast or a lost limb ends the stumble the same way (`loseFooting`). Past `maxStumbles` (4, inside `maxKnockdowns`) or on fewer than two shins it is refused and the caller uses the timer. `collapsing()` counts only deaths.
- **Catching its balance** (`stumble.budget`, `stand.ts`, `damage.ts` `standFrom`: a stagger of strength 0.35 or more, where a fall would be seen). The same drive with a `Stand` on it, and nothing fades on a clock. The body is held by the hold under the hips and by pins (`MuscleState.pinBody`): each ankle and the middle of the chest are pulled to where the animation has them, at the speed it moves them, so the feet take the animator's catch steps and the trunk stays over them. All of it is as strong as `Stand.support`, which eases at 8/s toward the lesser of its budget and its balance (1 at `balanceFrom` 0.6 steps of capture point error, 0 at `giveUp` 1.6); the hips' height is held in full throughout (`lift`). The budget starts at `standBudget(strength)` (0.9 to 0.55), and a catch step costs `perStep` (0.06), a hit `hitCost` (0.5) times its share of health, and a hit that changes the body's speed by 0.3 to 1.0 m/s that share of what is left, 0 to all of it. Such a hit also unpins hips, chest and feet sideways for `pinRegain` (0.35 s), and every hit leaves arms, spine and head loose in proportion (`startDrive` 0.25 at the hardest, back to `holdDrive` 0.85 over 0.2 s). It lands on the body in full with no lift, and about half its speed goes into the drift, so the feet go after it. It goes over, as above, past `giveUp`, with the line from its hips to its chest `abortTilt` (0.8 rad) off the animation's, its hips `knockOut` (0.3 m) from the animation's, sunk, with under `spent` (0.1) of its hold or more than `maxSteps` (5) catch steps taken, moving when `maxSeconds` (2.5) are up, or with no level ground under where the animation is walking it. At rest (under 0.45 m/s, chest turning under 0.6 rad/s, weight over its feet, hips within 0.1 m) for 0.2 s, at least 0.35 s in, it has caught itself: `handStanding` puts the root where the ghost is, leaves the bones as they are, and the animator blends out of that pose over 0.25 s (`blendFrom`), mid-stride. `handedBack(char)` then says `'stand'`, and the enemy has nothing to get up from. Refused past `maxStanding` (6, inside `maxKnockdowns`, apart from `maxStumbles`), on fewer than two shins, or with the ground under either foot more than 0.15 m off the root's: the animated stagger stands. `downed(char).standing` is true while a body is on its feet on either drive, and its animator is not to be flinched: the root is gore's.
- **Wounds set strength** (stage 8, `LimbStrength { legL, legR, armL, armR, trunk, neck }`, `?strength=0` for comparison). Each joint has a `strength`, 0..1, which multiplies its drive wherever one is written, so its stiffness, the weight it carries and the lift under a body fighting up go with it; a change eases in at `strengthRate` (5/s). `damage.ts` `strengthOf` works it out: in the Crucible from the limb pools, whole until 0.45 of a pool is gone and nothing when all of it is (the weaker of thigh and shin, upper arm and forearm), a broken limb 0.15; in the campaign from the wounds (`Injuries.strength`): a leg `1 - 0.8 × smoothstep(0, 0.75, wear)`, paralysed 0, an arm wound 0.2, a hand wound 0.6, a gut wound the trunk 0.6, ringing or concussed the neck 0.4. It goes with every `knockdown` and `collapse`, and `WoundSystem.syncBody` sends it each frame for a man gore has. What it does: a dying body's weaker leg gives first; catching its balance, the budget is `standBudget × strengthBudget` (half of it rests on the weaker leg, 0.7 of it for a dazed head, 1.3 times it for the undead), the weak knee is held giving in the animation it follows (`buckleLeg`: hips down and rolled toward it, foot planted), and every stagger is turned toward the weak side (a sideways push of 0.8 times what the wounds took off the weaker leg on the unit direction, up to 39°); a get-up gives out `0.4 × (1 - weaker leg)` more often unless it feels nothing; lying, a paralysed leg is driven at nothing and lies dead, a leg or belly wound gets both hands (an arm weaker than `reachFrom` 0.5 hangs, the other hand goes) at `clutchArm` 0.85, the shot leg is drawn up and held still while the other kicks, and a gut wound curls it (`gutCurl` 0.45, knees drawn up, spine at least `gutSpine` 0.3). On fire (`roll`), once down it rolls over and back every `rollEvery` (0.6 s), pushed for `rollPush` (0.3 s) at `rollSpin` (7 rad/s) about its trunk: momentum about the line it lies on, like `tip`, a capped cheat; it does not get up until it is done. Leg drive on a body catching its balance is not scaled: a weak drive did not follow the buckle (the knee bent 0.21 rad more than the right at 0.2 strength, against 0.50 whole).
- **Knocked down on its way up** (`damage.ts`, a rising body felled by a hit to anywhere but the head), it goes over with no `topple`, from the clip's pose under its own weight, at the speed the clip had it moving. A head hit on a rising body goes over as any head hit does: tipped along the round, and knocked cold with legs and spine locked.

- Past `GoreTuning.maxKnockdowns` (12, so that a grenade in a crowd of 12 throws all it leaves alive), on a rig whose animator has no `getUp`, or with muscles off, it returns false. `DamageModel` staggers instead.
- A knockdown is never frozen by the ragdoll budget, never sunk by the corpse budget, and `raycastCorpses` skips it, because it is still an enemy and enemies have their own ray test.
- `gore.clear()` does not release the living. They come back standing where they lay.

`reflex.ts` is what the body does in there, from joint roles, so a missing limb is a limb nobody moves. It writes poses into the muscle layer and touches no rigid body, so it cannot throw anything.

| Phase | Arms | Legs and spine |
|---|---|---|
| Fall | Hands to the face if thrown, until it comes down. Wide and wheeling, then out and down toward the floor as it comes up, five times as strong as they need to hold themselves, and once a hand is down the elbow gives. Slack if knocked cold | Tucked and pedalling. Chin up going forward, tucked going back. Knocked cold, the neck slack |
| Lying | One hand to the wound, the other curls on the belly; both to a leg or belly wound | Knees draw up and stir, slowly; a shot leg drawn up and still, a paralysed one dead, a gut wound curled with both knees up |
| Struggle | The frame it pushes for: hands planted face down, one behind face up, a gun hand hugging the gun. Giving out, they go weak and the elbows give | The same frame, legs eased into it as the body comes up |
| Gather | The frame it is handed back at: where the struggle got it, or the clip's first | The same |

The handover: `Reflex` asks the animator to pose the frame of the clip it will hand back at (`poseGetUpAt`, or `poseGetUpStart` for the first), reads joint targets out of it and where it has the hips and shoulders, puts the bones back, and reaches them physically: by pushing up, or in 0.55 s of gathering for the first frame. Then `handBack` works out yaw from how the body lies (handed back part way up, from the turn that puts that frame's hips where the real ones are, since a body sat up has its chest over its hips), puts the root so that the clip's hips land on the real hips, re-expresses the hips in the new frame, and the animator blends from that pose into the clip, 0.42 s into its first frame or 0.25 s part way. Worst bone speed over the handover is under 0.14 m in a frame in the tests, and usually 0.02 to 0.07.

### Taking rounds

A body that is falling or dying answers every round, and nothing restarts.

- `MuscleState.jolt` is all torque across joints with its reaction on the parent, so it can jerk limbs against each other and cannot move the body as a whole. The struck limb turns away from the shot, joints up the chain follow with 40% kicking back the other way, and two random joints flinch. All one way, a stream of rounds just folds a body in half.
- Sized from each joint's own inertia and a target spin, so it cannot overshoot. Twelve pulses run at once, oldest out.
- A target spin is blind to mass: the same round turned a Juggernaut's long arm as fast as a Trooper's. So a jolt is times
  `min(1.3, (85 / mass) ** MuscleTuning.joltMassExp)` (0.75): 1 for anything man-sized, 0.64 on a Brute (154 kg), 0.30 on a
  Juggernaut (433 kg). `joltOf` in `index.ts` takes the body's mass at every call, and a man's for the animation flinch under
  a collapse, which the animator sizes by build itself (`HumanoidAnimator.flinch`). A round's push on a lying Juggernaut moves
  its hands about a fifth as far as before, a Brute's half, a Trooper's and a Husk's the same. How long a round keeps a
  knocked-down body down (`Reflex.struck`) is not scaled.
- One impulse changes one body's speed by at most `RagTuning.maxImpulseSpeed`, 6 m/s (9 before): a 20 N·s round put 8.7 m/s
  on a 2.3 kg forearm and flipped it. The rest of a hard hit still moves the body through `Rag.shove`.
- On its feet, three quarters of a round goes into `CollapseDrive.drift`, so the feet carry it, and a body under fire is walked back. All of it on the chest bent the body 80 degrees backward over its held hips.
- The animation under a collapse flinches too, and the muscles carry that as well.
- Once it has let go a jolt is 35%, and 15% once tone has gone. At full strength an SMG walked a body 5 m along the floor in 3 s.
- A waist takes `corpseTrunkHealth` (420), not `corpseLimbHealth` (60). An SMG cut every body in two with its third round, because the chest counts toward the waist. It is also why a point blank shotgun's throw went up: see `docs/notes/lab.md`.
- **Since the gore update (2026-11-19) the living flinch is a different shape and size: `docs/notes/enemies.md`, "How a hit
  shows". What follows is the flinch before it, which `?flinch=0` puts back.** The living are the animator's, not gore's: a hit that does not kill flinches it on springs (`HumanoidAnimator.flinch`), at a
  size `damage.ts` works out from the share of health it took, `flinchSize`: 0.2 + 2.2 × share, at most 1.4 (0.35 + 3 × share
  and 1.6 before). The animator already sizes it by build, so mass is not counted twice. The springs under the spine, chest,
  head and pelvis (`FlinchSprings`) are damped to about 0.8 of critical (the head 0.6), against about half before: a round
  lands, leans and comes back without rocking past where it started. An SMG round tips a Trooper's chest 0.16 rad (0.26),
  a Husk's 0.24 (0.32), a Brute's 0.05 (0.08); a Judge round on a Trooper 0.23. The chest's spring also carries an enemy's
  own recoil (`play('shoot')`), which now settles the same way. A drone's and a skitter's flinch keep the old size: their
  animators size nothing by build, and their tilt springs were not retuned, so the smaller one was only a smaller reaction.

### The struck part on physics (not a ragdoll of gore's)

Since the gore update's R3 a living body's struck arm, head or upper body is simulated for 0.3 to 0.8 s after a hit, inside
its animator (`characters/animation/sway.ts`; `docs/notes/enemies.md`, "The struck part goes physical"). It makes no rigid
bodies and is not in any budget here. What gore does about it: `startRag` reads the bones as they stand and their speed
through `measureAnimVelocity`, which steps the animator and so the part, then calls `anim.easeSway(0.2)`; under a
`CollapseDrive` the animator goes on running, so what is left of the swing fades out of the joint targets.

### The ragdoll budget

`GoreTuning.maxRagdolls` (14) chains simulate at once; past it the budget freezes one. It used to freeze the oldest plain
ragdoll whatever it was doing, which with every knockdown and collapse running (12 and 4, which it can never freeze) was
whichever body had died that frame: a grenade into a crowd left bodies frozen standing, or in the air.

- It freezes, oldest first, a body at rest: dead, awake again, thrown or shot, or let go by its collapse, at least
  `freezeMinAge` (0.6 s) ago, and slower than `freezeSpeed` (1 m/s, `Rag.speed`, its fastest part). A chain pushed since it
  was last measured counts as moving.
- Then one that has kept a limb moving `overSeconds` (1 s) past that, once the body as a whole is under 1 m/s
  (`Rag.massSpeed`, its centre of mass). By then a grenade's throw has landed; a body still in the air, falling off a ledge
  or sliding is not frozen for it.
- Nothing younger ever freezes here. With nothing fit to freeze, bodies run over the budget, and `update` looks again every
  frame until it is back inside. A burst that kills six with sixteen unfreezable already running holds 22 chains for up to
  1.6 s.
- A throw or a round on a body already simulating starts its time again. Timed from its death alone, a second grenade 0.9 s
  after the first threw a corpse 2 m up and the budget froze it there at 1.6 s, 1.4 to 2.3 m up at 5 to 6 m/s; and a corpse
  under fire froze and woke every 0.6 s, a new blood pool and its chain rebuilt each time, since the frame's `measure` has
  cleared `pushed` by the time `update` looks again.
- The end of a collapse counts as a death: a body that took 1.7 s to die is just starting to fall.
- Those times are the body's own, stretched by the tempo dial's pace.
- A knockdown, a collapse still holding itself up, a staked body and the one just woken for a shot are never frozen here.
- There is no ceiling on how far over it a burst runs, bar `maxCorpses`; see Known limitations for what that costs. Two were
  tried, past 22 chains: freezing what was down on the floor whatever its speed froze bodies at 10 m/s the frame they hit
  the floor, and freezing what was down with only a limb moving cut a grenade into 30 by about a tenth (chain-frames over
  the budget) and froze arms mid-swing.
- `ragdoll.test.ts`, 'a blast at the cap freezes nothing in the air', guards it. The old budget fails it before the grenade,
  freezing the last two collapses the frame each starts (14 chains where 16 should be); a budget that freezes on age alone
  fails it with hips 1.5 m up at 0.6 s, and one that dates a collapse's body from its death fails it the frame the collapse
  ends. 'a body thrown or shot again starts its time over', last in the file, fails with the clock left at death (hips 1.4
  to 2.6 m up) and with a round not restarting it (the shot corpse asleep 12 frames of 90).

## Co-op: every screen makes its own (2026-11-18)

Nothing of gore crosses the wire. Each screen runs the damage model on its own copy of the body and calls this system as solo does
(`docs/notes/coop.md`, "Gore on every screen"). What that asks of gore:

- **`wound`, `headPellets`, `sever`, `knockdown`, the deaths** are called on a guest exactly as on the host, with the host's
  severity. Ragdolls, limbs, gibs, corpses, stains and pools are each machine's own and differ in where they land.
- **`DamageInfo.from`:** the shooter's eye when the shooter is not the local player. `gutShot` and the pellet wound's size
  (`WoundField.pellet`) measure range from it; without it they read `ctx.player.eye`, as before.
- **`damage.torso` and `damage.spill`** still carry the host's choice to the other screens (in the hit's `bits`), and `planGib`
  is seeded from the point, which is sent to the millimetre.
- **`rouse(char)`:** a living body on the floor gets up now (its `Reflex.lie` is over). A guest's copy lies for as long as the
  host's does, not by its own clock (`REPLICA_LIE`, 20 s, is only the backstop), and is roused when the host's is up.
- **Budgets** are the local machine's settings only. Nothing here reads whether it hosts.

## Contract additions

Muscles add `collapse`, `knockdown` (whose options carry `knockout`, `strength` and `roll`), `downed`, `handedBack`, `setStrength` and `LimbStrength`, and `impact`, `twitch`, `muscles` and `limp` on `RagdollOptions`, from `muscles.ts` by module augmentation. `getUp.ts` adds the optional reaction members to `CharacterAnimation`, `poseGetUpAt`, `blendFrom`, `buckleLeg` and `getUp`'s `startU` among them. `MuscleState.onLift` is a hook for tests.
The rig gains `JointDef.role`, `BoneDef.relax` and `BoneDef.collider`. `Physics` gains `OWN_BLAST`. `measureAnimVelocity`
calls an animator's optional `catchUp` first, which `HumanoidAnimator` has.

Wounds add `gore.wound`, and `wound`, `fracture`, `isFractured`, `skinMaterial`, `stress` and an optional `setLod` on `CharacterInstance`, `wound` and `isFractured` on `SeveredLimb`, and `WoundHit`. `RagSource` gains an optional `isFractured`, `Rag` gains `breakJoint`, `JointMuscle` gains `broken`.

The rest are additive, in `contracts.ts`. `PhysicsSystem`: `preStep`, `radialListeners`, `raycastInto`, `anchorBody`, `stepMs`.
`GoreSystem`: optional `velocity` on `sever` and `headshot`. `CorpseHit`: `bone`, `region`. `SeverResult`: `torso`, plus the
`TorsoHalf` interface. On the concrete `Gore`: `owns`, `blast`, `stats`, `limbCenter`.

## Torso breaks, organs, guts and spurts

`torso.ts`, `organs.ts`, `rope.ts`, `spurt.ts`. Proposal and audit: `docs/proposals/torso-gore.md`. Sandbox:
`scenario=crack|blowout|guts|spurt|ribcage`.

| Kill | What the trunk does |
|---|---|
| Any gib: a rocket, a grenade, a barrel, a shell, a round that obliterates, a frozen body, a boss's death. Four in five | **Crack**: capped pieces flying out from the trunk, **5 or 6** from a blast of force `TorsoTuning.bigFrom` (60) or more (every rocket and hand grenade; 6 for `sixShare` 0.4 of them, and always over `six` 1500), **3** from a smaller blast or anything that is not one. The whole ribcage (six fragments) bursts from where it sat, 4 organs, 5 slabs (below), 2 or 3 free strands of gut |
| The other fifth of gibs (`waistShare` 0.2) | **Waist tear**: chest and pelvis apart, liver and stomach, 3 slabs, 2 free strands of gut |
| A killing Sabot, Awl, Ultramag or Piledriver round in the chest or belly, or a shotgun from 3 m | **Blow-out**: the body stays and drops; its far side opened (two stacked craters, the interior shows ribs and spine), meat, two rib fragments and an organ thrown out along the round, gut left hanging from an opened belly |
| A head burst, a limb or head cut off, a partial head | **Spurt** from the stump (or the head's wound): a beating jet of blood, the Kiln's hose in blood |
| A shotgun in the belly from 4.5 m, a big round through it, a blast at belly height of 45% of health or more, alive or dead | A **loop of gut** hangs from the wound for as long as the body lasts, dragged behind when he crawls |
| A waist cut (sword, blast outcome `waist`) | A strand from each half; the top half drags its own |
| The Lance | Unchanged: it vaporizes |

Plates still on a body fly off before a gib or a blow-out (`DamageModel.platesOff`). Machines still scrap.

**The kit.** A trunk is never cut in a fight. `Gore.warm`, called by `Game` after the characters load, borrows one instance
of each flesh humanoid archetype, hides its head and limbs (their caps close the holes), bakes it in bind pose
(`bakePose(true)`), and cuts it with five fixed planes into every way it breaks (`buildKit`: about 6 to 28 ms an archetype,
157 ms for all thirteen at load). The faces are pushed in and out along their planes so they read as torn, with bone discs
for the spine, the ring of ribs and the sternum. A gib places each piece on its chest or hips bone (`placePiece`) and throws
it as a `SliceField` half with a convex hull; the geometry is the kit's and is shared, never disposed. `SliceField.warm`
draws one piece out of sight at load, so its programs compile there.

**The ribcage** (`buildRibcage`) is twelve rib pairs, costal cartilage, the sternum and a spine section in the chest bone's
frame, every rib broken at random near each end, so the six fragments fit back together. Off-white bone, blood in patches
and at the breaks, ribs about 2 cm by 1.2 cm so they read on the floor. Scaled to the body and widened to its chest (up to
1.4 times), they spawn in place and burst; each rests on a box of 0.8 of its own bounds, so it lies on the floor, not in it.

**Loose flesh** (`buildFlesh`): meat is a soft lumpy blob with a ragged flap or two, dark red to pink with fat and sinew
streaks, smooth-shaded and wet; gut a pale bent sausage; bone a splinter, marrow red at the break. Bursts throw mostly small
meat now (3 to 10 cm, most near 3), six of them with a broken trunk, so the pieces, ribs and organs carry the read.

**Guts** are verlet strands, 11 points 11.5 cm apart, drawn together as one tube mesh updated in place (`RopeField`). A strand
finds the floor under its middle four times a second, slides on it, and drops blood as its end drags. A loose one lies
14 s and shrinks away; a hanging one goes when its body leaves the scene. A gut-shot loop is held at both ends 28 cm apart
across the belly with 1.25 times the slack (`loopSlack`), so it hangs as a heavy U to the shins, and sways a little
(`sway`), most at its bottom.

**Spurts** (`SpurtField`) fire globs at 34 a second that fall under gravity, drawn by `fx.bloodHose` (`HoseLayer` with
`BLOOD_HOSE`), shaded in its shader as a round glossy rope: dark at the edges, brighter down the core, a tight highlight,
swelling and pinching along its length. The push beats (`heartbeat`), falls with the pressure over three quarters of
the stump's time, and stops. A
landing glob hands one of the blood field's own drops to the floor, which stains it.

**On the floor** (playtest, 2026-11-16: "they clip through the floor"). Measured in live Crucible waves at eye height on
concrete, raised metal, stairs and the grate, standing and lying bodies: no piece, strand or trunk piece ever ended under
the physics floor or fell through a concrete one, before or after. What hid them: trunk pieces, organs and ribs thrown at the
full gib launch (to 15 m/s) scattered 8 to 12 m, small and dark on a dark floor; meat and organs went after 14 s; and 7% of the
Crucible's floor is drawn 2 to 30 cm above its collider (rubber mats, steel plates, kerbs: a world issue, not fixed here),
which swallows what lands there. Now: trunk pieces, organs and ribs fly at most `TorsoTuning.pieceSpeed` (7 m/s) and land
near; organs and ribs lie twice the meat's linger; pieces, organs and ribs glow faintly in their own colour; every gore body
has CCD; nothing starts below the floor under the gib (`ChunkField.floor`, the trunk pieces lifted by their lowest corner);
chunks and organs rest on boxes from their own shape; trunk pieces' hulls take each piece's extreme points; halves past the cap
sink only after 8 s in sight (`minShown`, hard cap 44). Strands find the floor under each point in turn and ride a radius
above it, are 4 cm thick, paler, faintly lit and lie 30 s. The jet stains whatever it meets: 20 rays a frame along its globs,
one `bleedAt` a spurt per 0.08 s (a decapitation near a wall left 35 to 38 stains on the wall and floor in 5 s).

**What breaks a trunk (the gore update's G1, 2026-11-19).** The break used to be chosen by force over a line of 420, and a
blast's force on a body is `0.875 x impulse x radius x falloff`: 73 to 84 for a rocket's fireball, 65 to 74 for a grenade's,
46 to 74 for a barrel's. No weapon reached it, so every rocket kill was the waist tear and the crack was never seen. `planGib`
now chooses by what killed him and reads only what crosses the wire with the kill (the point, the source, the type, the force
rounded to a tenth), so every co-op screen makes the same plan. `torso.test.ts` checks every blast in the game from the
weapon tables, and `gibs.test.ts` that a rocket's kill really leaves the pieces.

**How the pieces leave (G2, `GibThrow` in `index.ts`).** The owner's rule: the fireball is not touched, the pieces are thrown
with force out of it, and nothing floats (every piece falls at the world's 19 m/s²). A rocket's fireball is about 3 m wide
and 2.5 m tall for 0.2 s with dark smoke in its place to 0.8 s, and at the old 3 to 7 m/s everything had landed inside it by
0.5 s. Now each piece heads out from the trunk's middle and on with the blast (`along` 0.3 of its heading is the blast's;
turned up to `fan` 1.1 rad either way; the small meat goes all round) and up hard:

| Piece | Out, m/s | Up, m/s | |
|---|---|---|---|
| trunk piece | 2.5 to 5.5 | 7.5 to 10.5 | spin to 10 rad/s |
| waist-tear half | 2.5 to 4 | 5 to 7.5 | a body's worth of weight each |
| limb, head | 2.5 to 6 | 6.5 to 10 | times the tempo dial's `throwScale` |
| ribcage fragment | 2.5 to 6.5 | 6 to 10.5 | |
| organ | 2.5 to 6 | 6.5 to 11 | |
| slab | 2.5 to 7 | 6.5 to 11 | |
| meat, viscera, bone | 1.5 to 8 | 3 to 11 | |
| loose gut | 2.5 to 6 | 6 to 9.5 | |

All times `power`, the square root of the kill's force over 80 kept to 0.85 to 1.35 (a rocket about 1, a boss the most). The
blast's direction is now the killing damage's own (`damage.dir`): `gib`'s `center` is the body's own middle on most calls and
said nothing of it, so before this everything went "up from the middle". Measured on the Test Range, a rocket at a Trooper's
feet: every trunk piece, limb and loose piece still in the air at 0.6 s (two trunk pieces and three limbs at 0.6 s before,
none at 0.8 s), trunk pieces down between 0.9 and 1.2 s, the middle piece 4.5 m from the blast and the furthest 8 m.
`?gibthrow=0` or the dev panel's "Gibs thrown out of the blast" puts the old launch back.

**The blood a piece trails (`trail.ts`).** A ribbon behind every trunk piece, limb (a gib's and one shot off a living man),
organ and slab while it flies faster than 2.2 m/s in its first 1.3 s: a chain of 7 globs left in its path every 0.05 s that
keep 0.3 of its speed and fall, drawn as one wet rope from the piece back along where it has been by the arterial spurts'
layer (`fx.bloodHose`; `SpurtField` appends the ribbons to its chain, and the layer takes 640 chain points where it took
256). 48 ribbons at once, the oldest given to the next piece. Meat of 5 cm and over and rib fragments leave strands instead
(`fx.gibTrail`, 5 a frame over everything). This, more than the pieces themselves, is what reads from 6 to 15 m: red arcs
out of the fire, each ending in a piece.

**Slabs (`slabs.ts`).** Between the trunk's pieces (2 to 27 litres) and the lumps of meat (a tenth of a litre) nothing was
the size of a forearm. A slab is a patch of the archetype's own skin and suit lifted off its trunk at load (six sites: both
sides of the chest, a shoulder blade, a flank, the belly, the small of the back), 25 to 33 cm long and 15 to 20 wide, the
skin's triangles split twice, cut to a torn, lobed outline, with a smooth lumpy layer of muscle 6 cm thick under it (in
bands, sinew streaks), and a lip where a line of fat shows under the skin. 1 to 3 litres each on a Trooper. One geometry in
two groups (the skin's material, the cut face's), drawn as instances by `ChunkField.register`, `SlabTuning.perShape` (6) of
each shape of each archetype in the world; a mesh is drawn once at load so its programs compile there, then only while one
of its pieces exists. A crack throws 5, a waist tear 3, a gib past the frame's full ones 2. Building them adds 10 to 20 ms
an archetype to the kit at load.

**Torn faces** (the cut face's material, `SliceField.cap`): roughness 0.22, full clearcoat and a breath of their own red
(`emissive 0x2c0406`), so they catch the light and are never black on a dark floor. The sword's cut shares it.

**The first gib.** On the Linux machine the first gib's call is 15 to 25 ms against about 3 for the rest, before and after
this work (first use of the limb pool and the code paths, not a shader). The slab meshes and the blood rope compile at load:
no program is compiled in the frame after the first gib (two were, the slabs' instanced skin and cut face, until
`ChunkField.register` waited for its own materials' draw and not a depth pass's). Probe: `tools/scripts/gib-cost.mjs`.

**The volume audit (the gore update, 2026-11-19).** The owner's rule: "the amount of gibs spawned by a destruction should
more or less match in size the destroyed part". Every way a body or a part of one is destroyed, on a Trooper on the Test
Range, litres removed against litres of pieces thrown (`tools/scripts/gib-seq.mjs` reports them: trunk pieces, slabs,
limb parts and loose pieces by their meshes' volume, whole limbs by their hit capsules, which run about 1.5 times the mesh).
His trunk is 48.5 litres, an arm 8.5 by capsule (5.8 by mesh), a leg 21.4 (14.2), the head and neck 11.3.

| Destruction | Removed | Thrown before | Thrown now | In the air at 0.6 s, before and now |
|---|---|---|---|---|
| Whole body burst: rocket, grenade, barrel, shell, a rocket's direct hit | trunk 48.5, limbs and head 82.6 | trunk 48.5 in 2 pieces, no ribs, 2 organs; **limbs 41 to 71**: a third of the limbs went as the forearm or shin alone and the upper arm or thigh was deleted | trunk 41 to 46 in 3 to 6 pieces, and 9 to 26 more in the ribcage, 4 organs, 5 slabs and meat; **limbs 71.1 every time** (whole, or in two real pieces at the lower joint when the limb budget has room) | 1 trunk piece of 2, 3 limbs of 5, 3 loose of 11; all 5 trunk pieces, 7 limbs of 7, 22 loose of 24 |
| A round that obliterates (the Trommel), a frozen body shattering | the same | the same, limbs 41 to 54 | trunk 46 in 3 pieces, ribs, organs, slabs; limbs 71.1 | as above |
| A body already cut at the waist, burst (the legs) | pelvis 14.7, legs | the legs, and **nothing of the pelvis** but 13 lumps | the kit's pelvis piece, the legs, one belly organ, no ribcage | |
| Head burst | head about 8.5 (its hit sphere) | 3.6: cranium in 3 shells, jaw in 2, brain in 2, 2 eyes, meat. The shells are thin, and together they are the size of the head | unchanged: it already tiles the head it came from | 4 of 12; unchanged |
| Partial head wound | part of the head | a baked partial head stays on the neck; 2 shells, half a brain, meat | unchanged | |
| Head off whole, a limb cut off, a waist cut, a blade's slice | the part | the part itself, real and whole (the slice: 129 litres in, 129 out in 4 halves) | unchanged | |
| A loose arm destroyed outright | 5.8 (mesh) | 5.2 as six lumps of meat and bone: the volume was there, the arm was not | **6.0: the arm in its four pieces** (two of the upper arm, the forearm, the hand with its wrist), cut from his own arm at load, and scraps | |
| A loose leg destroyed outright | 14.2 (mesh) | **4.5**, six lumps | **13.6: two pieces of thigh, the shin, the boot with a shin in it**, and scraps | |
| A top half (the crawler) destroyed | about 45 | **about 5**, six lumps | 31 as the chest's two pieces, and 17 more: ribs, lung and heart, the head's kit, both arms in their pieces; its guts drop free | |
| A shotgun's or a big round's blow-out | a crater in a body that stays | 3.0: meat, 2 rib fragments, an organ | the same pieces, the organ half as big again (4 to 7) | |
| The Lance, the energy blade's halves | everything | nothing, by design: it vaporizes | unchanged | |
| A machine (drone, skitter) | its hull, and its limbs | its limbs, and 12 scraps of 3 to 8 cm: the hull itself was nowhere | **its limbs, its hull in four pieces that fit together** (`buildWreck`, below), and 7 scraps | |

What is seen in the half second after is the launch's work (G2, above): before, most of it was on the floor inside the
fireball by then. The checks are in `gibs.test.ts` (a rocket's kill on real Rapier) and `ragdoll.test.ts` (a gib throws 5
to 7 limbs, never fewer than five). The table's numbers are the Trooper's; every archetype is below.

**The audit, every archetype (the fit pass, 2026-11-19).** One of each on the Test Range with a point of health left and
a rocket at its feet (`GIB=kill tools/scripts/gib-seq.mjs`, `GIB_ID` each in turn; the bosses with `GIB=killboss`, which
watches their own ten-second death). Litres: the kit and what is thrown as trunk pieces by mesh, limbs by their hit
capsules (about 1.5 times their mesh), the rest by mesh.

| Archetype | Trunk kit | Thrown as trunk pieces | Limbs, of the body's | Organs, ribs, slabs, meat | Loose gut |
|---|---|---|---|---|---|
| Husk | 34.0 | 34.2 in 5 | 59.3 of 59.2 | 15.8, 1.4, 7.7, 3.5 | 12.5 |
| Trooper | 41.2 | 43.2 in 5 | 71.1 of 71.1 | 18.5, 1.4, 5.9, 3.4 | 12.5 |
| Gunner | 94.8 | 96.2 in 5 | 100.0 of 100.0 | 13.2, 2.6, 7.4, 3.4 | 9.4 |
| Brute | 194.5 | 194.5 in 6 | 274.4 of 274.4 | 24.2, 7.0, 20.6, 3.9 | 15.2 |
| Stalker | 51.4 | 50.8 in 5 | 65.7 of 65.7 | 17.2, 1.7, 5.5, 4.4 | 9.9 |
| Rocketeer | 52.0 | 53.4 in 5 | 85.9 of 85.9 | 12.9, 2.0, 5.6, 10.2 | 13.3 |
| Sniper | 48.6 | 51.3 in 5 | 75.5 of 75.5 | 15.0, 1.9, **0.6**, 2.5 | 11.1 |
| Riot | 79.4 | 81.6 in 5 | 119.6 of 119.6 | 18.2, 3.6, 6.8, 4.3 | 14.9 |
| Leaper | 23.6 | 24.0 in 5 | 46.9 of 47.0 | 10.0, 1.2, 4.2, 3.2 | 11.1 |
| Bomber | 42.0 | 43.9 in 5 | 64.8 of 64.8 | 14.2, 1.3, 4.5, 3.4 | 11.8 |
| Burner | 74.9 | 78.9 in 5 | 109.6 of 109.6 | 12.7, 3.0, 7.8, 1.2 | 9.4 |
| Warden | 198.8 | 201.8 in 5 | 114.1 of 114.2 | 22.3, 3.6, 6.7, 2.1 | 31.9 |
| Juggernaut (boss) | 720.6 (waist) | 720.6 in 2 | 907.3 of 907.4 | 68.2 together | 42.5 |
| Skitter (machine) | hull 31.3 | 31.3 in 4 (was nothing) | every leg and the head (was 31.9 of 44.4) | 1.1 of scrap | |
| Drone (machine) | hull 48.8 | 48.8 in 4 (was nothing) | 92.7 of 92.8 | 1.0 of scrap | |
| Titan (boss, a machine) | hull 1,225 | 1,225 in 4 (was nothing) | 7,360 of 7,360 | 0.9 of scrap | |

What it found, and what was done:

- **Every flesh archetype adds up**: each trunk leaves as its own kit (the pieces come to the kit's volume, a few
  percent over where their torn faces are pushed out), and every limb leaves. Nothing was wrong there.
- **The machines' hulls were deleted**: fixed, `buildWreck` (above). **A skitter also lost two of its six legs** two
  bursts in three: its middle legs hang on what the humanoid list of limbs calls forearms, which a burst threw only when
  the dice split an "arm" in two. A machine's limbs are now thrown by bone, every one (`gibs.test.ts`).
- **The Sniper's slabs are scraps** (0.05 to 1.0 litre each, where a Trooper's are 0.6 to 2.8): a slab is the biggest
  island of trunk skin under its patch, and the Sniper's trunk is cut into many small islands (pouches, the cloak). Its
  burst still adds up without them (trunk, limbs, 15 litres of organs). Not fixed: it wants a slab that can span islands.
- **The bosses** die by their own sequence and burst at the end of it through the same `gib` (5 s in for the
  Juggernaut, 8 s for the Titan). The Juggernaut adds up as any flesh body does. **The Titan is a machine, and its hull
  was deleted** like the drone's: 1,225 litres of it gone, its six limbs and twelve scraps all that was left of the
  biggest thing in the game. It breaks into its hull's four pieces now.

**A machine's hull (`buildWreck` in `torso.ts`, `Gore.breakHull`).** The skitter and the drone have no trunk kit: no
flesh, no ribs. Their hull is cut at load like any kit, with every limb that leaves on its own folded away: in two
across its longest side and each half again across its next longest, the planes tilted and the breaks jagged, so four
closed pieces that fit together (`gibs.test.ts`: their volume is the hull's within 15%). A burst throws them as trunk
pieces are thrown (`SliceField.throwWreck`: the hull's own skin, a broken face of dark burnt metal and not of meat, a
trail of sparks, nothing pooling under it), and a round into one sparks. They count as trunk pieces in the caps.

**Limb parts (`buildLimb` in `torso.ts`, `Gore.cutLimbs`).** Each flesh humanoid's four limbs are cut at load into four
capped pieces each, as the trunk's kit is: the limb is every triangle of "trunk and this limb" that is not in "trunk alone"
(the armpit's skin joins an arm to the chest, so it cannot be found as an island), closed 6 cm below its joint (10 for a
leg), then cut at the middle of its upper part, just past the elbow or knee, and the middle of its lower part. They are
`ChunkField` kinds like the slabs (`part:<archetype>:<limb>:<n>`, 4 of each in the world), thrown from where each part of
the loose limb lies when it is destroyed (`burstLimb`). **Cost: 270 ms at load for all thirteen archetypes** on the Linux
machine (five bakes and three cuts a limb), on top of the kits' 160 and the slabs' 150 to 250.

**Free guts (`rope.ts`).** The owner: "on obliteration the guts should detach from the body and drape over the environment
or be thrown from explosions". Every burst now throws its strands free (2 or 3 for a crack, 2 for a waist tear; none hangs
off the pelvis's piece any more), at 2.5 to 6 m/s out and 6 to 9.5 up like the rest; guts already hanging out of a man when
he bursts, or out of a top half when it is destroyed, are let go and thrown too (`RopeField.drop(owner, velocity)`), where
they used to go with the body. A thrown strand's lead end leaves faster than its tail (0.55 to 1.45 of the throw along its length), so it strings out in
flight and comes down laid across what is there; as a coil it landed in a heap, and a heap drapes over nothing. A loose
strand **drapes**: each point rides the top of whatever is under it, as before, and
now a point that comes down on something standing `snagStep` (0.3 m) or more over the floor beside it (a ledge, a rail, a
crate, a parapet) is **caught** there, two points a strand at most, and the rest hangs off it; in flight two points a frame
are tested along their own step, so a strand thrown at a wall slaps it, wets it (`bleedAt`) and slides down. **A loose
strand lies on the dead as on anything else** (`DRAPE_ON` in `rope.ts`: its floor rays meet the world and `CG.Ragdoll`,
which is every body at rest by its fixed capsules, and a ragdoll or a trunk piece still moving); a heap 0.3 m or more
over the floor beside it catches a strand as a ledge does. A strand still hanging out of a body finds only the world.
Guts spilling from a living or dying man are unchanged.

**Organs you notice (`OrganTuning` in `chunks.ts`).** Half as big again (lung 15 cm, liver 14, stomach 11.7, heart 9),
brighter and wetter (roughness 0.1, a stronger glow, redder liver and heart). Each is soft: what it loses in speed on
landing goes into a spring (`stiff` 620, `damp` 11: about four beats a second, three or four of them) that squashes it
along the world's up and spreads it, whichever way it lies; at rest it sags a fifth flatter over half a second; it quivers
when a piece lands within 1.3 m; a player who walks into it kicks it along (within 0.5 m, at 0.9 of his speed and a little
aside, once every half second); and one **stepped on** (the feet within 20 cm of it and moving) or **shot** (it is in
`raycastCorpses`, so every gun that can hit a corpse can hit it) **bursts**: a splat on the floor, a puff, four scraps, a
squelch. Bursting is how an organ leaves the world: one whose slot is wanted bursts where it lies too. **The organ a
blow-out throws is gone from the chest it came out of** (`Character.takeOrgan`): the lung on the side the round left by,
the heart, the liver or the stomach. Each has a number in what is under the skin (`Organ` in `anatomy/build.ts`, above
the part in the vertex's code, as a shard has its joint), and the body's texels say which have gone, a bit each, in a
spare channel of fire's second texel (no texel spent: 5 are still free). It goes with a baked body's snapshot and with
a top half cut from the body, and ends at reset.

**Over the cap on moving pieces** (`ChunkTuning.maxBodies`, 72: three full gibs are exactly that), the oldest piece in
flight used to give its body up and stop where it was, which with pieces thrown high for a second was in mid-air, for good.
It now flies on without a body (`ChunkField.ghost`): along its own arc under the world's gravity to the floor under it,
bouncing off nothing, and rests there. `gibs.test.ts` bursts eight at once and finds nothing left above 0.6 m.

**Caps.** Organs: lung 16, liver, heart and stomach 10 each; ribcage fragments 12 of each kind, all inside `ChunkTuning.maxBodies`
(72 live bodies), oldest first. Trunk pieces count as halves (`SliceTuning.maxHalves`, 20 live, now shared with the sword).
Guts 14 strands, spurts 8, oldest given back. Past `TorsoTuning.fullPerFrame` (3) gibs in one frame a gib is three pieces, two
organs, a strand and no ribcage.

**Co-op.** The host's gore writes its choice on the damage before the events go out: `damage.torso` on a gib or blow-out,
`damage.spill` on the hit that hung the guts. A guest's replay honours them, and the rest of the plan is seeded from the
damage's point and source (`planGib`), so a guest throws the same pieces, organs, ribs and strands.

**Measured** (Crucible, wave 1, three gibs forced through the kill path and a rocket blast every 0.8 s, 24 s, dpr 2 at
1440x900, A/B against the old burst in the same build, two runs each, load from other agents high): gib call p50 9 to 10 ms
against 6 to 8, first gib of a run 42 to 72 ms against 43 to 50 (after the polish pass, two runs: p50 7.3 and 10.2 ms, first
48 and 57 ms); gore update p50 0.3 ms against 0.1, p95 1.6 to 2.0 against
1.3 to 1.6; frame p50 19.8 to 21.9 ms against 17.3 to 21.4, inside the run-to-run spread; draw calls peak +45 to +75.

## Wounds

`wounds.ts`, `WoundPlanner`: what a hit leaves on a body. How it is drawn is in `docs/notes/characters.md`. `DamageModel.apply` calls `gore.wound` the moment the health comes off, so a killing shot marks the body too, and `damageCorpse` does the same for the dead. Severity is the share of the body's health the hit took. A corpse counts as 100 health.

| Hit | Leaves |
|---|---|
| SMG (and the Buzzsaw, with `?slot8=old`) | 1.25 cm hole. Stays in a trunk. Through a limb, a small exit |
| Trommel, the 20 mm rotary cannon (source `buzzsaw`) | 3 cm crater, 8.5 cm exit, 11 cm deep: two thirds of the autocannon's. Works a limb toward breaking at 2 a point of damage, so one round breaks a joint. Its burst's fragments carry no bone and leave no mark |
| Piledriver | 1.8 cm hole and a torn 7.5 cm exit. Breaks at 2.2 a point |
| Judge | 1.45 cm hole, and a torn 5.5 cm exit on the far side of the capsule, as the ray leaves it |
| Stakegun, Lance | Bigger of the same |
| Autocannon | 4.5 cm crater, 11.5 cm exit, 13 cm deep |
| Shotgun | Up to 4.7 cm of crater per pellet close in, 1.15 cm holes by 10 m. Within 11 cm of each other at point blank they merge, so one shell leaves one crater |
| Rocket, grenade, anything `explosive` | Opens the trunk on the side facing the blast, up to 18.5 cm across and 15 cm deep, with a burn round it and 3 to 9 shrapnel holes. Arms held in front do not stop it. Under 16% of health it only burns and peppers |
| Sword | A gash 8.5 to 20 cm long along the line where the blade's plane meets the skin, about 1 cm wide |
| Fire | A burn patch on whatever the flame reached. Nothing removed. Whole-body burning is `setBurn`, unchanged |
| Melee, crush | Bruising, and a strain on the limb |
| Anything on a machine | Dents. No interior exists, and a Titan counts |

**Wear you can see (2026-11-19).** Beside the wounds a hit leaves, a limb's skin is torn through to muscle and then bone as its health pool is spent, so a player can see which limb is about to come off: `docs/notes/characters.md`, "Wear you can see". The damage model writes it (`enemies/damage.ts` `showWear`); gore neither reads nor writes it.

Breaking: each hit on a limb adds `damage x breaks` to `char.stress` for that joint, and past `breakAt` (60, times size squared) it goes. One Judge round breaks a forearm, a shotgun takes three close pellets, and an SMG about seven rounds. A forearm or shin hit snaps the elbow or knee the wrong way. An upper arm or thigh hit kills the shoulder or hip. Either way a hole opens and a bone end comes out through it. A blast strains whichever limbs its shrapnel found. `updateMaim` counts a broken limb as lost for the AI, except that a broken leg never takes `legs` to 0, because crawling needs a body the animator can see has lost them.

**Gore setting.** Low paints and opens nothing and breaks nothing. Full is as tuned. Excessive cuts 25% wider and limbs go 1.5 times sooner. How much stays on the floor is the "Mess" setting's (see "The mess that stays"). Written from `applyGore` in `ui/settings.ts`.

## Tuning

| Knob | File | What it does |
|---|---|---|
| `WoundTuning`, `BITES` | `wounds.ts` | Gore level, what breaks a limb, pellet range and merging, each weapon's wound. A new weapon id needs a row or it bites like the SMG: the Harrow has the Judge's, the Rivet the SMG's, the Sabot the Lance's |
| `GoreTuning` | `index.ts` | Caps, what the ragdoll budget may freeze and when, settle speed and time, sink, heartbeat, hit-stop, a headshot's twitch, whole-body share and lift of a hit, limb share of force, gib launch, corpse limb health, crawl time |
| `MuscleTuning` | `muscles.ts` | Everything in the muscle layer: ligaments, the knee's stop, resting pose, impact spin, collapse timing and how much of the trunk it holds up, twitching, jolts and how they and a blast's spin come down with mass |
| `FlinchSprings`, `flinchSize` | `HumanoidAnimator.ts`, `damage.ts` | The living flinch: the springs it rides on, and its size from the share of health a hit took |
| `ReflexTuning` | `reflex.ts` | A living body off its feet: strength by phase, when it counts as landed, how it braces and how the brace gives, how much of the arms' weight they carry in a fall, how long a thrown body guards its face, a knockout, and fighting up: how far, how hard, the lift and its cap, when it is up, how often a hurt body gives out (`giveOut`, the one knob for that) and what knocks it back down |
| `relax`, `role`, `collider` | `rig.ts` | Resting pose per joint, what each joint is for, and what a bone rests on where that is not its hit capsule |
| `RagTuning` | `rag.ts` | The tempo dial (`gravityScale`) and when a body killed in the air takes it, joint damping, death tone, hard limit strength and fade-in, rest damping, collider slimming, heel feet, speed clamps (one impulse on one body, a blast, a shove), blast lift, how far a broken joint opens |
| `swingShape()` | `rag.ts` | Asymmetric hip and shoulder reach |
| `BloodTuning` | `blood.ts` | Rays per frame (24), droplet and pool caps, smear spacing, the queued stains' speed, bleeders (32), drops (6) and sprays (6) a frame, how much wetter a hit makes a body |
| `ChunkTuning` | `chunks.ts` | Slots per kind, live bodies (72), linger, bounce |
| `SliceTuning` | `sliced.ts` | Hold before the halves part, slide speed, half cap |
| `CrawlTuning` | `crawl.ts` | Stroke time, reach, haul, lift |

## Blood that stays

`blood.ts`, `BloodField`, which `Gore` holds as `this.blood`. FX draws blood in the air; this decides where blood is left. The new parts
(2026-11-16), for anyone in gore who wants to leave blood:

```ts
blood.bleedAt(point, normal, amount);           // blood on a surface now, no ray: amount 1 is a hand-sized stain; a big one on a wall runs
blood.drip(point, velocity?, size?);            // one drop that falls and leaves a spot. False when the frame's 6 drops are spent
blood.bleed(bone, worldPoint, seconds, every?, owner?);  // a wound that drips for `seconds`, pinned to `bone`, slowing as it clots
blood.onHit(char, damage, severity, bone?, point?);      // what a round leaves outside a body; Gore calls it, see below
```

- `bleed` is the drip emitter: the point is kept in the bone's frame, so drops follow the body as it moves, falls and lies. `every` is the
  seconds between drops at first (0.4); they come up to three times slower and smaller as the wound ages. It stops by itself when `owner`
  (pass `char.root`) leaves the scene or is hidden. 32 at once, the oldest taken. Drops are `fx.bloodDrip`, a strand that lands as a stain,
  and all callers share `dripsPerFrame` (6), so a pile of bodies costs what six drops do.
- `bleedAt` puts a stain of `0.12 + 0.3 sqrt(amount)` m (quad edge) straight onto the surface. On a wall `decals.splat` grows a run down
  from it once it is 0.16 m or more. Use it where something wet touches a surface: a stump on the floor, an organ against a wall.
- `onHit` runs on every round into a living body (`Gore.wound`) and into the dead (`damageCorpse`), never on machines. It fires
  `fx.bloodSpray` at the hit along the shot with the round's `hitWeight` (`sprayOf`: bullets and pellets by weight, a blast radial, nothing
  for fire, shock or blades), makes the body wetter (`setBloodiness`, +0.1 and 1.1 times the share of health a hit took), and starts a
  dripping wound on the bone for 4 to 17 s. A shotgun's pellets on one body within 50 ms are one spray and one wound; they only add wet.
  `spraysPerFrame` (6) keeps a grenade into a crowd from spraying off every body.
- A co-op guest gets all of it from the wound event alone: `net/world.ts` calls `gore.wound` for each `hit`, which is all `onHit` needs. No
  extra traffic.
- Flying meat drips (`chunks.ts`): every piece but scrap and bone, three drops a second for its first 2.5 s, from the same budget.
- Wet bodies run: the skin shader stretches each wound's stain further down the body with bloodiness, to three times as far at 1, broken
  into rivulets (`op2RunWet` in `characters/anatomy/glsl.ts`, the stain in `characters/material.ts`).

Tests: `blood.test.ts` (spray classes, one spray a shotgun blast, the spray, bleeder and drop budgets, decal cap and runs). Renders:
`tools/scripts/gore-b.mjs` (scenes `spray runs pool wet drips bench`, header has the command) and `tools/scripts/gore-b-wet.mjs`.

**The impact puff (2026-11-18).** `BloodField.onHit` also fires `fx.bloodPuff` for every bullet and pellet (`puffOf`), on the
frame of the hit and before anything else it does: one for a round; for a shotgun's blast on one body one big one and up to
`BloodTuning.puffPellets` (3) small ones at its other pellets. It goes through `gore.wound` and `damageCorpse`, so the living,
the dying and corpses all give one, on every co-op screen, and a round a plate stopped gives none. The look and the numbers are
in `docs/notes/fx.md`, "The impact puff".

### Big stains (2026-11-19, the gore update)

The owner: the blood "is composed of a ton of small little decals... kind of detailed but lacks coverage". So a violent event
now lays **one or a few big stains at once** (`decals.big`, the compositions in `docs/notes/render.md`, "The decal sheet") and
the small traced drops are the detail on top of them and past their edge. All of it is in `BloodField` (`blood.ts`):

```ts
blood.burst(at, dir, size);        // a body came apart: one burst on the floor under `at`, thrown along `dir`
blood.fan(at, dir, size, delay?);  // a shot through a body: a fan on the floor past it, and a sheet on the wall behind
blood.sheetBehind(at, dir, size);  // the wall behind a killing shot, if one is within 3.2 m
blood.soak(at, size, along?);      // the patch a body soaks into the floor where it lies; the pool spreads from it
blood.drag(at, moveX, moveZ, len); // the long smear of a body sliding
blood.castOff(at, dir, len);       // a line of drops flung off a blade, on the floor below
blood.bigRay(kind, origin, dir, maxDist, size, along?, delay?, minor?);   // what they are all made of
```

| Event | What it lays | Where |
|---|---|---|
| A gib, an explosion kill (`fleshBurst`) | a `burst` 1.7 to 3 m under the body (by the push), 10 rays round it where there were 18 | `gore/index.ts` |
| Several die in one blast (within 0.25 s and 4.5 m) | the second lays a `ring` round them all (3 m and up); the later bursts are three quarters the size | `BloodField.burst` |
| A heavy round's blow-out, a point-blank shotgun kill (`blowOut`) | a `fan` 2.1 m along the shot and a `sheet` on the wall behind; 7 rays where there were 12 | `gore/index.ts` |
| A head bursting | a `fan` 1.5 m and a `sheet`; 5 rays where there were 9 | `gore/index.ts` |
| Any killing shot (`bleed`) | a `sheet` on the wall behind, within 3.2 m, two a frame | `gore/index.ts` |
| A body comes to rest | a `soak` 1.3 to 1.8 m, then the pool spreads out of it as before | `freezeBody` |
| A body thrown at over 3.2 m/s sliding | one `drag` 1.4 to 3.2 m in place of the next three small smears | the smear loop |
| A blade cuts a body in two | a `fan` 1.25 m along the cut and a cast-off line of drops | `gore/sliced.ts` |
| **Every bullet or pellet hit** (B1, more blood from one hit) | a `fan` 0.5 to 1.6 m by the round's weight on the floor past the body, 0.14 s after the hit, with the small stains (`minor`) | `BloodField.onHit` |

- **Rules.** Each is one ray in a queue of 16 (`BloodTuning.maxBig`), taken from the same per-frame budget as every other
  stain; a full queue drops the big stain and the drops still land. A sheet shrinks with the distance the blood flew (half at
  its full reach). Sizes scale with the gore setting (`BloodTuning.amount`: 0.65 Low, 1 Full, 1.3 Excessive).
- **Corners.** A decal is flat and is cut off where the surface leaves its plane (a wall's foot, a ledge). So a big floor
  stain probes ahead and to both sides (three rays), and where a wall stands inside its reach it lays a `sheet` low on that
  wall for what would have gone past the corner (`carryUpWalls`).
- **Budget.** A kill's big stains go in the `big` ring (256, kept longest); a single round's fan goes with the small stains
  (`minor`), or a magazine would push every burst out of that ring.
- **Co-op:** each screen lays its own from the events it already gets (`gore.wound`, the kill); nothing is sent.
- **Switches:** `?bigblood=0` (dev panel "Blood: big stains on a kill") leaves only the small drops; `?hitblood=0` ("Blood: a
  mark from every round") takes the per-hit fan away.
- Tests: `blood.test.ts`, "big stains". Scenes: `tools/scripts/decal-scenes.mjs` (the same seeded kills on any build).

### One look: flesh dries, and what a hard light does (the fit pass, 2026-11-19)

The six lanes each drew blood and flesh their own way. Seen together at night in The Crucible
(`tools/scripts/fit-look.mjs`), four things disagreed; each is one rule now.

- **Flesh dries, as the blood on the floor does.** A floor of stains that had dried dark was strewn with meat, torn
  faces and bodies as wet and bright as the second they were made. Loose pieces and cut faces: every piece's instance
  colour carries the world time it was made (`burnTint`'s green), and from 14 s after that over 75 s more (`DryTuning` in
  `cooked.ts`) its wet materials dull: darker, browner, rougher (0.56), a quarter of the clearcoat, 0.4 of their own
  red. Tacky, not matt. Bodies and limbs: gore dries the dead where they lie (`Gore.dryTheDead`, twice a second, six
  steps over the same times, each one write to the body's skin: `Character.setDry`), and the skin shader darkens and
  dulls the blood on the skin, each wound's stain and the flesh that wear or a wound has bared. A round into a dried
  corpse wets it again. A baked body is painted as dry as it was. `?dryflesh=0` (dev panel, "Flesh dries") turns all of
  it off. Not dried: what is inside a wound's hole (the modelled interior), and organs dry like any piece.
- **Bared flesh is lit by the light that reaches it** (`characters/material.ts`, `BARE`). Wear's torn flesh had a fixed
  warm fill so that red would read under this map's blue light; with a fixed fill a torn limb in a dark corner was the
  brightest thing on the screen at 20 m, a glowing orange, while the blood on the floor under it was nearly black. It
  is lit again by the brightness of what reaches it, as floor blood is (`opTint`), levelling off under a hard lamp.
  It still reads at 20 m (the night sheet), as a dark red in shadow.
- **Burnt things are dark whatever is shone on them** (`COAL`). Char's albedo is a hundredth, but the weapon light at
  two metres is bright enough to turn even that pale: a burnt-through corpse under it read as tan skin with wet red
  patches, raw and not burnt. What a burnt pixel gives back now levels off: char near black (0.035), the meat a fire
  bared a dark brown-red (0.08, and matt), bone a sooty grey (0.3). So a burnt body is black under any light, with its
  muscle and bone showing through, which is what the owner asked of a body that has clearly burned.
- **Blood on the floor stays red under the weapon light** (`render/decalShader.glsl.ts`). A stain lets a fifth of the
  floor through, and under the weapon light the floor is many times white: wet stains washed to pink, dried ones nearly
  away, and every drop's raised lip was ringed in white (the decal lane's "pale rims"). The harder the light, the less
  of the floor comes through a stain unreddened (its opacity rises with the light, where there is blood and not mist),
  and the glint off a lip levels off.

What was looked at and left: the colours themselves. Floor blood (wet 0.22 to 0.125 red, dry 0.115 to 0.05), the body's
stains (0.17 to 0.075), bared muscle (0.3 to 0.1), cut faces and the blood on the weapon are the same family of
saturated reds and read as one in the night frames; none was retuned.

### Blood that reacts (2026-11-19, the gore update's B1, B2, B4)

All of it is `BloodField` and `Tracks` (`blood.ts`, `tracks.ts`), from events the game already has; every screen makes its own
and nothing is sent.

- **A wounded man who walks leaves a trail.** Each dripping wound (`bleed`) remembers where its last drop fell. Once the
  wound is `trailFrom` (0.9 m) from there, a `trail` pattern is laid along the way he came (a line of five or six drops, one
  decal), whatever the wound's timer says; standing still he only drips, as before. Two wounds on one body are one trail.
  Inside the drip budget (6 a frame). `?hitblood=0` turns it off with the per-hit fan.
- **Wet spots.** A pool, and a kill's big stain on a floor (burst, soak, ring, fan), is remembered as wet for 75 s
  (`wetFor`; 32 spots, `wetAt(x, y, z)`): what a foot can step in and a falling piece can splash in.
- **Footprints** (`Tracks`). A foot that comes down in a wet spot is wet for 12 steps (`TrackTuning.steps`); each step
  after it leaves a boot print (`decals.print`, 0.38 m, left and right, toe the way he faces), each fainter than the last
  (`printThin`: the lugs thin out and drop away), then none. The player's steps are the stride his footstep sounds use
  (`stridePhase`); an enemy's are its animator's foot plants (`Gore.footfall`, from `CharacterLibrary.wireGround`; boots
  only, not machines, creatures or a crawler's hands). Enemy prints are rationed to 14 a second, within 30 m of the player;
  a foot too far or over the ration dries all the same. One ray and one decal a print.
- **A slide** through a wet spot picks blood up and lays it back as long smears, one every 0.7 m, each fainter
  (`decals.wipe`), two steps of blood a smear.
- **Drips from above.** Blood thrown onto a ceiling (a big stain, or a ray stain of 0.3 m and up) drips back down from
  there for 6 to 22 s, slower as it runs out (`dripFrom`, 16 at once). A pool laid within reach of a drop (four rays round
  it) runs over the edge: drops fall from the lip for 25 to 40 s, starting when the pool has spread that far.
- **Splashes.** Whatever stains the floor under it as it lands (a limb, a piece: `stainBelow`) throws a splash if that
  floor is a wet spot: a crown of strands (`fx.bloodHit` upward) and 4 to 8 drops that stain round it. Two a frame.
- **Soaked bodies.** A body that comes to rest in a wet spot that was there before it is as bloody as a body gets
  (`soakBody`, bloodiness 0.9), before it lays its own patch.
- Tests: `tracks.test.ts`; `blood.test.ts`, "blood that reacts". Scenes: `decal-scenes.mjs` `prints` and `walk`.
## Fire on bodies (`fire.ts`, the gore update's F1, 2026-11-19)

`FireField` (`gore.fire`) is one list of everything alight or smouldering: the living, corpses, and limbs cut from either. It only
draws; nothing in it hurts anything. Each screen runs its own from facts already sent (burning is a synced status, a death by
fire arrives as its damage type), so nothing of it is on the wire.

```ts
ctx.gore.alight?.(char, fireproof);   // a living body is on fire this frame: call it every frame it burns (EnemyManager.burnLook)
ctx.gore.burnOn?.(char, fireproof);   // it died burning or by fire: call before ragdoll/collapse/gib (DamageModel.kill)
gore.fire.sooted(charOrLimb);         // burnt enough (char 0.5) that it leaves soot where it lies, not blood
gore.fire.stats();                    // { alight, smouldering, licks } for checks
```

- **Flames come off the whole body.** Each lick is drawn at a random point on one of the rig's hit capsules still on the body,
  weighted by skin (length times radius), so a trunk burns more than a hand and a body that lost an arm has no fire where the
  arm was. 26 licks a second on a whole man (`rate`), sized by the capsule (20 cm on a wrist to 47 cm on a chest).
- **Living:** fed every frame by its owner; 0.2 s without a feed and the fire is out (`hold`). A charred man whose fire goes
  out smokes for 3 s (`putOut`).
- **Corpse:** `burnOn` makes it burn 5 to 8 s more (`corpseBurn`, longer the less charred it was), its char rising to 1 over
  that time, the flames dying down over the last 40% (`dieDown`). Then it smoulders for 30 s (`smoulder`): threads of smoke
  (2.4 a second falling to 0.25) and the ember glow in the cracks of its skin, `0.6 x (1 - k)^3`, so most of the glow is gone
  in the first 8 s. Then it is cold: black, with ash, for good. Only a body gore holds as a corpse burns on (`isCorpse`): one
  gibbed, sliced, vaporized or taken back by the library is dropped that frame.
- **Limbs:** `sever` and `gib` call `fire.split`: a limb off a burning or smoking body carries on as its own entry
  (`limbBurn` 3 to 5 s, then the same smoulder), with the body's char on its skin.
- **Soot for blood.** A sooted body leaves the decal sheet's own soot shape where it lies (`FireField.scorch`): one
  `soot` stain 1.3 times the mark's size, turned the way the body lies, a small `scorch` (0.55) for the burnt middle and a
  second `soot` off to one side; a limb or a piece (a mark under 0.9 m) leaves one `soot`. Laid 0.7 s after death once it
  is within 45 cm of the floor, or when it freezes. It gets no blood pool (`freezeBody`, `freezeLimb`) and smears no
  blood as it slides.
- **A burnt body is dry (`FireTuning.sootFrom`, char 0.5).** Past the soot line nothing red comes out of it, alive or
  dead: a round knocks ash and an ember or two out of it (`Gore.ashPuff`) where it would have thrown a puff and a spray;
  a limb cut from it has no blood trail, no ribbon and no spurt from either end, and thuds without a stain; a gut shot
  spills nothing and a blow-out throws dark meat; its organs crumble instead of splashing.
- **Light and heat.** The nearest 3 flaming things (`lights`) throw a flickering orange light: a `lights.flash` of 2.6 to 4.6
  cd, 6.5 m, every 0.11 to 0.2 s, each lasting 0.26 s, so about one and a half are alive per body. The nearest 3 also get a heat
  shimmer every 0.45 s. A burning corpse among the nearest 6 has an additive glow on the floor under it.
- **Caps.** 40 entries (`max`; a new fire past it takes the place of whatever is nearest cold, never of a living body's);
  the nearest 6 flaming things burn at the full rate and the rest at 45% (`near`, `farRate`); 300 licks a second over
  everything (`budget`), past which every fire thins alike.
- **It starts where it touched and burns through the skin (F2).** A flame that strikes a body gives the skin its
  origin (`DamageModel.run`: a fire hit with a bone, not the burn's own ticks); a body lit by something with no point (a
  napalm patch, the man beside him) catches at a random point on itself (`feed`). The skin's char then walks out from
  there (`docs/notes/characters.md`, "Burnt skin"). `FireField` also drives how far the fire is through the skin
  (`setBurnThrough`): alive, once the char is past 0.8 (`eatFrom`), 0.09 a second up to 0.4 (`eatAlive`, `eatAliveMax`:
  patches of bared muscle on a man who has burned for some seconds); a corpse goes on to 0.75 (`eatMax`) over the first
  85% of its burning, muscle over most of the trunk and bone where the fire caught; a limb leaves with what its body had
  and goes on to the same. Nothing fireproof is eaten.
- **A burning corpse draws up (F3).** Over the first 55% of its burning (`curlBy`) the nearest 4 burning corpses (`curls`)
  bend at the elbows (2 rad), knees (1.25), hips (0.75) and spine (0.3) (`curlPose`), through their own joint muscles:
  `FireField.drawUp` gives each named joint a flexed target and up to 0.9 of drive (`curlDrive`), and wakes the chain.
  Gore does not freeze a body while `fire.curling(char)` (`freezable`, and the settle check in `update`); 20% of the burn
  later (`curlHold`) it is let go and freezes as any body does, which is what holds the pose. Flesh humanoids only. A limb
  pinned under the body stays where it is.
- **A burnt body's pieces are burnt (F3, and the fit pass).** Every rigid piece of a body is drawn as an instance, and
  its instance colour says how burnt it is (`burnTint` in `fire.ts`: white is not at all). `Gore.gib`, `burstLimb` and
  `blowOut` set `chunks.char` to the body's char round their spawns. Three things read that colour: the skin's own
  material burns the piece as it burns a body, through the same noise, cold (`characters/material.ts`, "a rigid piece of
  a burnt body": the slabs' skin side, a limb's parts, the trunk's pieces, a blade's halves); the wet materials of loose
  meat, organs and every cut face cook to dry brown-black with no shine and no glow of their own (`cooked.ts`,
  `cookable`); and anything else is simply darkened. A piece off a body burnt past the soot line is **dry**
  (`Chunk.dry`, `Half.dry`): no ribbon, no strands, no drips, no stain where it lands. A dry body's burst throws no blood
  at all (no burst stain, jets, rays or pool, and no strands of gut): ash and embers where it burst and soot on the floor
  under it (`FireField.sootAt`). Limbs thrown off carry the body's skin and burn on, as before.
- **Burst or cut while it burns, the pieces burn on.** A trunk piece or a blade's half is a `BurningPiece` (`sliced.ts`
  `Half`): an instanced mesh of one when its body had any char or flames (`SliceField.meshFor`; a plain mesh otherwise,
  as before). `FireField.pieceOf(char, piece, share)` gives it its body's fire: flames off its own box for `limbBurn`
  (3 to 5 s) with its char rising to 1, then the same smoulder, and soot where it comes to rest. A blade through a
  burning man leaves two burning halves (0.6 of a body's fire each); a rocket through one throws his trunk's pieces out
  alight (0.35 each). A cold burnt corpse cut in two is two burnt, dry halves with no fire. The energy blade's
  vaporizing cut is unchanged.
- **Baked, a burnt body keeps what it had.** The far batch (below) paints into a baked body's vertices what the skin
  shader's far level would have drawn from its texels: char walking out from where the fire caught, the skin burnt
  through to cooked muscle and bone, and each limb's wear (`Character.bakeFar`). A body still smouldering when it is
  baked goes on smoking where it lies (`FireField.park`: threads of smoke off the points its capsules rest at), and has
  its fire back where it had got to when it is stood up again (`resume`); gone cold meanwhile, the glow its skin was
  baked with is put out. Its curl is its pose, which a bake keeps. What a baked body does not have is the glow in its
  cracks: a baked body has no texels to glow from, and most of that glow is gone 8 s into the smoulder.
- **The switch:** `DevFlags.fire` (`?fire=0`, and "New fire" in the dev panel) turns all of it off and gives fire as it was:
  a timer, one emitter on the chest, out at death, a blood pool. The skin's char is drawn by the new shader either way.

Where the char comes from is the enemies' side: `docs/notes/enemies.md`, "Burning". How the skin draws it:
`docs/notes/characters.md`, "Burnt skin".

Measured, Test Range at Retina size on the RTX 4090, whole frames with a GPU sync (`tools/scripts/fire-bench.mjs`): ten men
standing alight 4.97 to 5.54 ms a frame, ten corpses burning 5.44, the same ten not burning 5.02, fire as it was 4.78. The
spread between two runs of the same case on this shared machine (4.7 to 8.1 ms) is larger than any difference between cases.
Ten men alight are 203 licks a second, about 160 live particles (171 with the old emitters), 3 more draw calls (the light
pool's and the shimmer's), and no allocation after the first frame.

Looking at it: `tools/scripts/fire-look.mjs` is a trigger for `tools/sheet.mjs` (a man coated in napalm, the flamethrower's
own bites, a corpse, a cut arm, a burning Husk with its brain on, ten at once; from the player's eye at any distance),
`fire-probe.mjs` takes full-size stills at chosen times with the numbers behind them, `fire-bench.mjs` is the timing above.
`FIRE_TUNE='{"shimmers":0}'` changes `FireTuning` for one run.

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
- **A blast spins the limbs by the body's mass.** The throw is shared out by mass already, but `kick`, the spin a blast gives
  the limbs in `Gore.throwFromBlast`, was not: a rocket 3 m from a Juggernaut corpse sent its hands at 5.7 times the speed of
  its hips. It is times `min(1.3, (85 / mass) ** MuscleTuning.blastMassExp)` (1): a Brute's 0.55, a Juggernaut's 0.20, a man's
  1. Now 1.9 to 2.0 (1.76 to 1.81 for the right hand alone), a Brute's 1.7 against 2.0, a Husk's and a Trooper's 1.4 as
  before, over two sessions. Less of the blast goes into the arms, so a Juggernaut's hips go 9 to 12% faster, 1.53 to 1.54 m/s
  against 1.37 to 1.42. A loose limb spins as it did: it has no trunk to go with, and its rig's mass is the whole body's.
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

Each of these was found the hard way. All but the four marked are guarded by a test, in `muscles.test.ts` unless another is
named, checked by breaking each one on purpose in a copy and seeing the test fail.

- **A knockdown begun inside an enemy's own update ends that update** (no unit test; `lab-contact.mjs`, `CONTACT=knock`, in
  the game). The body check knocks a body down from `updateContact`, in the middle of `EnemyManager.updateEnemy`. Left to run
  on, the update placed and animated the body, the animator wrote the hips bone, and gore read the instance as one the library
  had taken back (`reclaimed`) and let go of it the same frame: in the game a sprint knocked down 0 of 20, though every
  `gore.knockdown` said yes. `updateEnemy` returns once `e.downed` is set, as it already did after a fall.
- **A round that knocks a head cold turns the neck alone** (`knockdown.test.ts`, 'knocked cold, the head snaps back'). A
  `jolt` on the head passes most of it up the chain, the chest whips back harder than the head, and the head lags into a nod:
  about 1 rad the wrong way against the chest in two frames. With no snap at all, as on the code before, the test reads
  -0.08 rad and fails.
- **Arms and legs cannot push a body up on their own; the lift does the rest, capped** (`knockdown.test.ts`, 'the lift never
  carries more than its share of the weight'). The gain limit holds a drive to what turns a light limb, so on joint torque
  alone a body face down got its hips 0.05 m off the floor in 2 s, and at the plan's literal cap (0.55 of the weight times
  the arm and leg drives, 0.39) not much more. The lift is an impulse, never a torque, and the hook reads it on every sub-step:
  at most 0.55 of the weight. With no cap the test fails; with no lift every struggle test fails. The hook reads the lift
  only: the limbs carrying their own weight add about 0.36 at `struggle` strength, as they did 0.19 to 0.26 lying.
- **A body killed on its way up drops under its own weight** (`knockdown.test.ts`, 'killed on its way up'). `Reflex.die` only
  starts the muscles fading, and the lift is a cheat, not a muscle: left to fade with the limbs it went on carrying 0.53 to
  0.11 of the weight for half a second and face down lifted the shoulders 0.1 m more after the death. It stops on the frame
  it dies, with the push's gain; with either left on the test fails.
- **A body thrown while it pushes falls with its legs' weight** (`knockdown.test.ts`, 'thrown while it pushes up'). The
  fall writes neither the legs' gain nor their gravity, so they kept the push's, four times the strength and 0.3 of their
  weight, for the whole flight. `Reflex.thrown` puts them back and lets the lift go.
- **A body that gives out has got most of the way up first** (`knockdown.test.ts`, 'fights its way up'). Timed by the effort
  as planned, the attempt gave out at 0.7 to 0.9 of it, when the lift had only just come in: the hips 0.07 m up, nothing to
  drop back from. It gives out by how far up it is; timed by the effort again, the test fails.
- **The legs come up with the body, not before it** (no unit test; the `struggle` sheet of `react-seq`). Driven to the
  frame's pose at once, a body face up swung its legs 0.5 to 0.67 m into the air before it sat up, a backward roll; eased in
  by how far up it is, its feet stay on the floor, 0.06 to 0.09 m.
- **One SMG round only rocks a body fighting up** (`knockdown.test.ts`, 'a hard hit while it fights up'). A struck body's
  strength is `joltOf`, on which one SMG round is 0.47, so the plan's `struggleKnock` of 0.3 put a body down for every round;
  at 0.3 the test fails.

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
- **A working muscle carries its own weight** (`knockdown.test.ts`, 'a body lying down reaches its wound', on real Rapier). The drive's implicit step is sized for one light body, so its held torque is far under what lifts an arm. Collapses and reflexes both turn gravity down on a driven arm or head. It was why a body lay perfectly still. Lying on its back, the wrist gets to 0.24 to 0.31 m of a wound on the thigh with it, and 0.55 to 0.66 m without. The trunk is the exception: in a collapse its weight goes onto the hips, where the hold and the legs carry it, and that is what makes a dying body heavy. Left on the chest, it pitched the chest over the hold and turned the hips up to 1.1 rad off the animation's, which 'tracks the animation steadily' (limit 1) caught one run in ten; on the hips the worst of 40 bodies is 0.58. Falling, a living body's arms and head keep half their cut (`ReflexTuning.fallCarry` 0.5), so they fall with some weight and still reach the floor; with none of it the elbows folded flat under the body and some forward falls rolled onto the back. On the floor they carry all of it again.
- **Nothing a hit does to the animation may land in one frame** (no test). If the same burst kills, `measureAnimVelocity` reads the jump as speed. Arms snapping to a flail seeded 14 m/s. The hop gait snapping in put the hips 9 cm sideways, read as 8 m/s, which threw a body with a blown-off leg 2.8 m across the blast. That one is the owner's "ridiculous" throw, and it was there on kills too. Everything in `stumble` and the hop now eases in, and so do a collapse's stagger and topple, over 0.2 s. A knockdown from the body check, a head hit, or a hit that fells a body on its way up skips the animator's flinch, and the head hit its guard: `DamageModel.respond` decides first, and flinches only a body that stays up. Flinched first, an SMG round to the head started the ragdoll's head at 15.5 rad/s against its parent, and a knocked-cold head snapped 0.74 to 0.80 rad in 0.1 s against 0.53 to 0.64 from the whip alone (in the game, `?map=range`, four each).
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
- **The ragdoll budget never freezes a body in the air, or one just dead** (`ragdoll.test.ts`, 'a blast at the cap freezes
  nothing in the air'). Twelve knockdowns and four collapses running and a grenade killing six: nothing freezes with its hips
  above 0.5 m, nothing the budget freezes is under 0.6 s into its fall, nor moving above 1 m/s before its time is up, and the
  end of a collapse starts that clock again. In a copy: the old budget, oldest out, fails it before the grenade, freezing the
  last two collapses the frame each starts; freezing on age alone fails it with hips 1.5 m up at 0.6 s; dating a collapse's
  body from its death fails it the frame the collapse ends. A second grenade 0.9 s later, and a corpse under fire with the
  budget over, start a body's time again ('a body thrown or shot again starts its time over'): with the clock left at death
  it fails with hips 1.4 to 2.6 m up, and with a round not restarting it the shot corpse sleeps 12 frames of 90. In the game,
  `BLAST_CROWD=16` `blast-seq.mjs`: with `?mass=0` two to four tries of eight froze a body standing, hips 0.86 to 0.91 m, the
  frame it died; now none of twelve, every freeze with hips at 0.19 m or lower and 0.62 s or more into its fall.

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
| Hits with mass, `PROBE=hitmass PROBE_ROUNDS=4`, 24 bodies a case, against the code before it in the same session | One SMG round on a body knocked down and lying 2.5 s, what the round adds to either hand's travel over 0.3 s (shot against unshot): Juggernaut 0.03 m against 0.15, Brute 0.03 against 0.08, Trooper 0.07 against 0.06, Husk 0.07 against 0.07. Shot 1.2 s after the knockdown, as the plan first measured, a Juggernaut's right hand moves 0.39 m against 0.43, but 0.42 unshot: that is the fall. One SMG round that lands on a lying corpse's forearm: the hand ends 0.01 to 0.02 m from where it lay on average, 0.09 at most, against 0.02 to 0.03 and 0.15. A second session, seeded, 36 bodies a case and 107 rays on the forearm: means 0.004 to 0.024 m, 0.175 at most (a Brute's) against 0.181, so this was inside 0.2 before as well. A Trooper's hand peaks at 0.48 m/s on average against 0.62, 1.4 at most against 1.9; a Brute's does not change (2.2 at most both ways), since its 4.2 kg forearm never reaches the 6 m/s ceiling from a 20 N·s round. A rocket 3 m from a corpse, fastest hand over fastest hips: Husk 1.35 against 1.36, Trooper 1.44 against 1.42, Brute 1.68 against 1.99, Juggernaut 1.98 against 5.69 (right hand alone 1.28, 1.35, 1.61, 1.81 against 1.29, 1.37, 1.89, 4.73); hips 8.57, 8.53, 4.55, 1.53 m/s against 8.58, 8.51, 4.50, 1.37. The seeded session: Husk 1.38, Brute 1.68, Juggernaut 1.93 against 1.37, 1.99, 5.13 (right hand 1.33, 1.59, 1.76 against 1.34, 1.80, 4.24); hips 8.61, 4.55, 1.54 against 8.60, 4.52, 1.42 |
| The living flinch, `PROBE=flinch`, against a twin not hit (exact) | One SMG round tips the chest: Trooper 0.164 rad against 0.257, Husk 0.242 against 0.322, Brute 0.045 against 0.076; a Judge round on a Trooper 0.233 against 0.289. Past rest the other way 0.001 rad, under 1%, against 14%. Within 0.02 rad of rest from 0.35 to 0.38 s against 0.42 |
| `forces.test.ts`'s own measures with the stage's knobs on and off (a logging copy, one session) | The same at every dial within a few hundredths: rocket at 2 m 4.47, 5.25 to 5.33, 5.34 to 5.42 m; point-blank shotgun 1.78, 1.81, 1.87; SMG 1.5 s on a corpse 0.28, 0.31, 0.81. Bullets on the test's 85 kg body are untouched, and the impulse ceiling does not reach its throws. The copy runs its bodies in another order from the file itself, so compare these with each other, not with the tempo row above |
| In the game, stage 3 against `?mass=0`, alternating, `lab-throw` | Shotgun at 2 m, 28 kills: 0.84 to 2.41 m, mean 1.78, against 1.34 to 4.00, mean 2.35, over 12. The impulse ceiling is not it (9 against 6 in one session: 1.75 and 1.91 against 1.79 and 1.89); the flinch of the shell's first pellets is (Known limitations). SMG kill at 8 m 0.87 to 1.66, mean 1.19, against 0.74 to 1.39, mean 1.07. Rocket 2 m from a corpse 4.89 to 6.87, mean 5.54, against 5.22 to 5.95, mean 5.58. SMG 1.5 s on a corpse 0.05 to 0.23 m against 0.03 to 0.26 |
| A grenade into 16, `BLAST_CROWD=16 blast-seq.mjs`, four tries each, Troopers and Husks, against `?mass=0` | Frozen standing the frame it died, hips 0.86 to 0.91 m: none of eight tries against four of eight (two of eight in a second session). Every freeze with hips at 0.18 m or lower, 0.62 s or more after the death. Peak chains 14 to 15. After the fix round, four tries on Troopers: none, every freeze at 0.19 m or lower and 0.63 s or more |
| `react-chaos`, stage 3 against `?mass=0`, alternating, load 3.5 to 8 | Physics step peak 7.6 to 10.6 ms, mean 8.8 over five, against 8.3 to 10.1, mean 9.4 over four. CPU 4.6 to 5.7 ms a frame against 4.8 to 8.1. Peak chains 11 to 13 against 11 to 14. Every survivor back up, no console errors. A second session, four each: 9.43 against 9.18 ms. After the fix round, three each at load 4 to 13: 7.4 to 9.0, mean 8.1, against 7.8 to 9.0, mean 8.6; every survivor up, no errors |
| The ragdoll budget over it, scratch probes in Node (`tools/out/fx`, the reviewer's in the session scratchpad) | Sixteen unfreezable running, a second grenade 0.9 or 1.1 s after the first: with the clock left at death a corpse froze 1.4 to 2.3 m up in five tries of five; now every freeze has its hips at 0.18 m or lower. One corpse shot every six frames for 4 s: 6 freezes, 7 wakes, 6 pools and 77 rigid bodies made, now 1 wake, 0 pools and 11, as with the budget not over. A grenade into 30 and 36 Troopers, two each: over 14 chains for 58 to 62 frames, 14 again by 1.0 to 1.2 s |
| Knocked over, a scratch probe on the `knockdown.test.ts` harness (`tools/out/knock/probe.test.ts`), Trooper, against a copy of the code before | Knocked cold, 8 rounds of 4 headings: the head turns 0.50 to 1.0 rad against the chest along the shot within 0.1 s; not knocked cold, -0.09 to -0.02, the head lagging the topple. With one `jolt` on the head the chest whipped back 0.6 to 0.8 rad on the hips in two frames and the head read -0.96 against it; with the neck alone at 11, 16 and 22 rad/s, 0.03 to 0.34, 0.10 to 0.64 and 0.40 to 1.00. Hands touch the floor before the chest in all 32 (0.27 to 0.38 s against 0.37 to 1.05) |
| The same, topples at 2 m/s over eight headings | Hands on the floor before the chest, per round of eight: 5, 6, 6 keeping all of the arms' cut in a fall (`fallCarry` 1, as before), 6 to 8 over ten rounds at 0.5, 7, 8, 8 at 0. At 0 the elbow of the first hand down is 2.15 to 2.47 rad 0.2 s on (medians at 1.7 and 2 m/s), and one or two forward falls in nine roll onto the back; at 0.5, 1.66 to 1.87, every forward fall prone. That elbow is 0.9 rad or more in 28 of 30 forward falls at 0.5. With the brace's give off, much the same (0.81 to 2.56 against 0.90 to 2.62 over nine); the chest's speed 0.1 s after the hand lands is 0.3 to 1.8 times its speed at the landing either way |
| The same, a survivor 3 m and 4 m from a rocket, ten each | A hand within 0.25 m of the head while the hips are above landing height: 0.22 to 0.38 s at 3 m (0.29 on average) and 0.12 to 0.25 at 4 m; on the code before, 0 to 0.32 (0.17) and 0 to 0.22. Both hands at once, at most 0.15 s either way. Not at all from the knockdown test's own blast (hips up to 1.0 m), either way |
| `react-chaos`, knocked over against `?knock=0`, alternating, five each, load 2.3 to 7.3 | Physics step peak 8.6 to 15.5 ms, mean 11.3 and median 10.3, against 9.1 to 12.2, 9.8 and 9.2. CPU 3.5 to 5.3 ms a frame, mean 4.5, against 3.5 to 6.3, 4.6. Knockdowns 23 to 27 a run against 14 to 23: the script's rounds to the head push with 22 N·s, which floors a body now. At most 14 chains either way. Every survivor back up, no console errors. Again with the head hits that floor a body skipping the animator's flinch and guard, three each, load 5.5 to 8.6: 8.2 to 9.7 ms, mean 9.1 and median 9.4, against 8.7 to 10.5, 9.3 and 8.8; CPU 4.9 against 6.0; knockdowns 19 to 28 against 18; every survivor up, no errors |
| A rocket survivor 4 m off, `tools/out/tempo/throw-tempo.mjs`, six each, alternating | 4.25 to 4.95 m, mean 4.58, in the air 0.58 s, against 4.54 to 4.94, 4.73 and 0.59 with `?knock=0` |
| Fighting up, a scratch probe on the `knockdown.test.ts` harness (`tools/out/struggle/probe.test.ts`), Trooper, eight headings at 2 m/s, hurt 0 and 0.9 | Sat up face up in 0.55 to 0.6 s unhurt and 0.73 to 0.75 hurt; up on straight arms face down in 0.73 to 1.13 s and 0.72 to 1.3, hips up to 0.29 to 0.31 m. A second probe (`tools/out/verify5`), 96 unhurt bodies over sixteen headings: face down 0.62 to 1.13 s (median 0.87), face up 0.55 to 1.17 (median 0.57), and the first probe's own section once 1.22 and 1.27 face up. Face up its feet stay 0.06 to 0.09 m off the floor, against 0.5 to 0.67 with the legs driven to the frame at once. Handover pops 0.039 to 0.079 m. On joint torque alone, before the lift, the hips rose 0.05 m in 2 s |
| The same, first attempt made to give out (`giveOut` 10, two tries), three rounds of the test's four headings | Gave out once, all twelve. The hips or shoulders, whichever rose more, which was the shoulders every time, rose 0.23 to 0.36 m and dropped 0.24 to 0.34; face down the hips alone rose 0.05 to 0.13 m before it gave out. Landing to standing 1.24 to 1.57 times the lie, gather and whole rise it took before. Pops 0.046 m at most. Unhurt, twelve: never gave out, one try each, face up 0.55 to 0.57 s (once 1.47, still rolling when it started), face down 0.73 to 1.13 |
| The same: the lift, and hits while fighting up | The lift carries at most 0.55 of the body's weight. Hit 70% of the way up face down: one SMG round, 3 of 3 carry on up; four pellets of a shell, 3 of 3 knocked back down and lying within 0.5 s, shoulders 0.10 to 0.25 m lower (0.09 to 0.25 over sixteen before the elbows gave on a knock), hips 0.16 m or lower. Twenty bodies at hurt 0.9: 6 first attempts gave out (5.1 expected at `giveOut` 0.45) |
| How often it gives out, in the game: `tools/out/struggle/rate.mjs`, the Test Range, AI on, each knockdown a fresh body put down by an SMG round to the head, a pellet to the head, a chest hit that falls and a 12.5 m/s body check in turn | Troopers, 72 knockdowns in three batches on different seeds: 28% gave out at least once (17, 33, 33%), 25% expected from their `hurt` (0.75 to 1); none more than twice; every one pushed up and got up; down 2.3 to 8.1 s. A fourth batch of 24 on another run: 42%, 6 of them twice. All 96: 31%. Husks, 12 and 12 more: none gave out, down 1.5 to 2.6 s |
| A body knocked down on its way up, `react-seq` `riseshot`: a shell's four pellets in the chest half way through the face-down clip | The head 0.64 to 0.20 m within 10 frames; the hips stay on its knees, 0.5 m, until frame 34, lying by 50. With `?struggle=0` it stays up and the clip plays on. Headless, felled half way up the face-down clip: hips under 0.25 m 41 to 56 frames on; with the arms and legs slack, or a 0.8 to 1.2 m/s topple, 31 to 89 |
| `react-chaos`, fighting up against `?struggle=0`, alternating, six each, load 2.9 to 5.5 | Physics step peak 9.6 to 15.4 ms, mean 11.5 and median 11.0, against 9.8 to 14.2, 11.35 and 11.2. Four more pairs on another run: 8.6 to 10.9 ms, mean 9.75, against 6.7 to 14.8, 10.05. Both inside the run-to-run spread. The script's CPU figure (3.8 to 7.2 ms against 3.7 to 6.4) is the last frame's, read once every body is up, so it says nothing of the struggle. At most 14 chains against 15. Every survivor back up, no console errors |

## The mess that stays (2026-11-19)

`mess.ts` (`MessField`, which `Gore` holds as `this.mess`), `Rag.freeze(true)` in `rag.ts`, the rings and the soak rule in
`render/Decals.ts`, `applyMess` in `ui/settings.ts`. Tests: `mess.test.ts`, `render/Decals.test.ts`. Judged with
`tools/scripts/mess-fight.mjs` (below). Every cap cites the next section.

**A body at rest is not a ghost.** When a chain freezes (`freezeBody`, `freezeLimb`), its rigid bodies leave the world as
before, and a **fixed capsule is left where each of its capsules lay**: the same shapes in the same places, in the
ragdolls' own collision group (`CG.Ragdoll` against `CG.Ragdoll | CG.Gib | CG.Debris`). So the next body lands on it
and a heap is as high as its bodies, and loose pieces lie on it (below). They meet nothing else: not the player (whose
capsule only sees `CG.World`), not the living, not a bullet, not the nav. A Trooper leaves 15. `Rag.resting`, `restCount`, `restMin`/`restMax` (a tight box round them),
`dropRest()`, `rest()`. `MessTuning.maxShapes` (2,600) is the most there may be; past it the oldest body at rest gives
its capsules up and is a ghost again.

**Waking.** `Rag.wake()` takes the fixed capsules away and puts dynamic bodies back at the same pose, so nothing lying on
the body is pushed: the shapes are the same. What wakes a body at rest:

- **A round or a blast**, as before (`damageCorpse`, `Gore.blast`).
- **The player walking into it** (`MessField.pushers`): the player is a standing cylinder 0.57 m wide and 1.8 m tall at
  their feet. A resting chain whose box and then whose bones it reaches is woken, at most `wakesPerFrame` (2), and may
  take the count of simulating chains `playerOver` (4) past the ragdoll budget for a moment. Every part of a simulating
  chain inside the cylinder is given speed away from its axis: `pushBase` (0.7 m/s) by how deep it is, plus `pushPerSpeed`
  (0.5) for each m/s the player closes on it, at most `pushMax` (5 m/s), with a fifth of it upward. **One way only**: a
  push adds speed up to that and never takes any, so nothing can be squeezed into flying. Standing on a body does nothing.
  The player is never moved, slowed or lifted: bodies are not in the player's collision world at all.
- **An enemy walking into it**, the same at `enemyPush` (0.4) of the strength, within 30 m of the player, and all the
  enemies together may wake one body at rest every `enemyWakeEvery` (0.6 s). At full strength with no limit a horde running
  down one lane ploughed every heap in it flat (150 kills on one spot: hips a hand's width off the floor, as before there
  were heaps).
- **A body landing on it** at `landSpeed` (2.2 m/s) or more: the heap gives under what falls on it.
- **Losing what it lay on** (`unrested`, `settleSupports`): when a chain's capsules leave the world (woken, sunk, gibbed,
  vaporized), each resting chain over it (boxes overlap, and its hips or its highest point are higher) waits to hear what
  became of it, and is woken to fall once that one has gone or moved `slipped` (0.14 m). So a body pulled from under a
  pile brings down what was on it, a few a frame, and one that only stirs brings down nothing.
- Loose **limbs** rest, heap and are pushed the same way. Loose **pieces** (meat, bone, ribs; not organs, which are
  theirs to burst) are kicked by the player (`ChunkField.kick`), and **trunk pieces and sword halves** shoved
  (`SliceField.shove`), a few a frame.

**What lies on the dead.** Loose pieces (meat, organs, ribs, slabs, a limb's parts) meet the world and bodies at rest
(`ChunkField.embody`: `CG.Debris` against `CG.World | CG.Ragdoll`, and of everything that is `Ragdoll` only a resting
body's fixed capsules will meet `Debris`), so what a gib throws over a heap lies on the heap. Trunk pieces and blade
halves always met them. A piece notes when it comes to rest on something that is not the world (`Chunk.perched`: a ray
from its middle as long as the piece, and 6 cm). When a resting body's capsules leave the world (`MessHost.unsettled`,
from the same `unrested` that lets a body fall off a heap), what lay in their box falls: each perched piece is put back
on physics where it lies (`ChunkField.unsettle`, 12 a call; over the cap on moving pieces it drops to the floor by
itself), a trunk piece or half there is woken (`SliceField.unsettle`), and a strand of gut is let go and finds its floor
again (`RopeField.unsettle`). With `?messrest=0` there is nothing to lie on, and everything falls to the floor as before.

**What a body at rest costs.** Its skeleton is not worked out again and its texture is sent only when something writes to
the texels after the bones (a wound, a burn: `stillSkeleton`, a checksum a frame). All but the newest `full` (8) are
**settled**: no shadow of their own, and beyond `nearDetail` (7 m) the next level of detail with nothing drawn under the
skin. A body is settled when nobody is looking, or once twice as many are full as should be.

**The caps** (`MessField.policy`, four times a second). Past `GoreTuning.maxCorpses` the oldest body the camera cannot
see goes first, at once. One in sight sinks only `hardOver` (12) past the cap. Loose limbs the same; trunk pieces and
halves go out of sight first (`SliceField.inView`). Loose pieces **no longer shrink away after 14 and 28 s**: a piece
lies until its slot is needed (`ChunkTuning.linger` Infinity), in `ChunkTuning.capacity` times `share` slots of its kind.

**Blood.** The rings are in `docs/notes/render.md`. A soaked spot stops spending slots (`Decals.soak`): the floor is cut
into half-metre cells, each counting its blood in layers; at `soak` layers a new small stain there takes the place of the
oldest stain the cell remembers, so the spot stays freshly wet and the ring stops filling from one place.

**The "Mess" setting** (Settings, Video; `MESS` in `mess.ts`; default **Standard**):

| | Low | Clear at wave break | Standard | Everything |
|---|---|---|---|---|
| Bodies kept | 40 | 120 | 120 | 200 |
| Drawn in full / drawn as characters at all (the rest are baked, see "Many more corpses") | 6 / 20 | 8 / 32 | 8 / 32 | 12 / 40 |
| Loose limbs | 24 | 48 | 48 | 64 |
| of them drawn as themselves at rest (the rest are baked, see "Loose limbs are baked too") | 6 | 12 | 12 | 20 |
| Trunk pieces and halves | 14 | 28 | 28 | 40 |
| Slots for pieces (meat) | 64 | 160 | 160 | 320 |
| Pieces lie | 20 s | until needed | until needed | until needed |
| Blood decals | 2,048 | 8,192 | 8,192 | 12,288 |
| Layers of blood on one spot | 4 | 6 | 6 | 10 |
| At the wave break | nothing | **the floor is swept** | nothing | nothing |
| The dead heap (a body at rest leaves its capsules) | **no** | yes | yes | yes |

"Clear at wave break" is Standard until `wave:clear`, then `Gore.sweep()`: the dead and their limbs sink, pieces shrink,
blood fades (`Decals.fadeOut`), over 2.2 s, with nothing popping. The old "Gore" setting no longer sets how many bodies,
limbs or pieces stay; it is how violently a body comes apart.

### What follows which setting (verify pass, 2026-11-19)

`applyLoad` in `ui/settings.ts` is the one place that writes the gore update's caps, from three hands (`GoreLoad` in
`gore/load.ts`). Tests: `ui/settings.test.ts`, `gore/load.test.ts`, `render/quality.test.ts`, `mess.test.ts` ("heaps
turned off"). **At High or Ultra quality with Mess at Standard, every number is the one its lane built.**

| Part | Follows | Low end |
|---|---|---|
| Bodies, limbs, pieces and blood kept; the wave-break sweep | **Mess** (the table above) | Low: 40 bodies, a fifth of the pieces' room, 2,048 stains |
| The dead heap (`HEAPS`, `MessTuning.heaps`, `leavesCapsules`) | **Mess** | Low: no capsules, bodies lie one deep as before the update |
| The decal sheet's size (`decalSheet`) | **Graphics quality** | Low and Medium: half size, 21 MB for 85 (`docs/notes/render.md`) |
| Floor tiles of old blood (`bloodTiles`) | **Graphics quality** | Medium 8 of 16, Low none |
| Big stains kept (`bigStains`, a share of Mess's `big`) | **Graphics quality** | Medium three quarters, Low half |
| Struck parts on physics at once (`swayBodies`, `SWAY.max`) | **Graphics quality** | Medium 5 of 8, Low 3 |
| Burning bodies that light the floor (`fireLights`) | **Graphics quality** | Medium 2 of 3, Low 1 |
| Limb wear, the flinch, the hand to the wound, blood on the gun | nothing | measured as free: painted in the skin's own shader, or a few bones of animation |

**The automatic step-down** (`LoadGovernor`, run once a frame from `Gore.update` by `stepLoad`). The game already
lowers its resolution when frames are missed (`render/DynamicResolution.ts`); that answers a slow GPU, and what the gore
update costs is on the processor (below, "The whole update: what it costs"). So when the smoothed frame interval stays
over 18.4 ms for two seconds **and** resolution is already at 0.8 or under, or has gone through its range and given up
(`DynamicResolution.starved`), a step is taken; a second six seconds later if frames are still missed; one is given back
after thirty seconds at 60, and that wait doubles (to four minutes) each time giving one back was followed by a miss.

| Step | What it takes |
|---|---|
| 1 | The heap's capsules: bodies coming to rest leave none, and the ones already down are shed two a frame, longest at rest first (`MessField.shed`), so a heap comes down in order (what lies on a body is woken, falls and rests without capsules). Corpses drawn as characters 32 to 19 and in full 8 to 6 (the rest are baked, out of sight or past 11 m as always). Struck parts on physics and fire's lights halved. A still piece shrinks away after 30 s (12 s at step 2), as it does at Mess Low |
| 2 | Dead bodies simulating at once 14 to 10, bodies dying on their feet at once 8 to 4, and enemies no longer wake the dead they walk into (the player's own push is never eased). Characters 13, in full 4. One struck part in four, one light |

A step never shortens a decal ring or retires pieces (only a setting does: `applyLoad(ctx, trim)`), so nothing leaves the
floor in front of the player but the heap settling. It is off wherever dynamic resolution is off (under automation, or
`?drs=0`), so a test's picture does not depend on the machine's load; `?drs=1` turns both on in a test. A new run starts
from the settings (`resetLoad`). Each screen eases its own in co-op: none of this is a rule of the game.

**Switches:** `?messrest=0` (bodies at rest keep no capsules: the flat carpet from before), `?messpush=0` (nothing at
rest is woken by being walked into) and `?messfar=0` (nothing is baked), all three also in the dev panel under BODIES.

**What each level costs** (the same 150-kill fight on one spot on the real clock, `MESS_LIVE=1`, on the development
machine, which holds its 60 Hz throughout; counted at the end of the fight, before the bodies in sight have been baked
down):

| | Low | Standard | Everything |
|---|---|---|---|
| Bodies on the floor: characters + baked | 28 + 10 | 77 + 41 | 90 + 47 |
| Frame interval: median / 95th / 99th, ms | 16.7 / 16.8 / 17.0 | 16.7 / 17.0 / 24.6 | 16.7 / 18.1 / 20.7 |
| Physics step: median / 95th / worst, ms | 1.6 / 3.3 / 6.8 | 1.8 / 3.9 / 6.9 | 1.7 / 3.6 / 9.0 |
| Gore's own update: median / 95th / worst, ms | 0.6 / 1.1 / 3.6 | 0.7 / 1.3 / 8.5 | 0.6 / 1.1 / 4.2 |
| Draw calls / triangles for the frame | 468 / 1.86 M | 678 / 4.20 M | 779 / 3.97 M |
| of which characters | 53 / 0.37 M | 233 / 1.93 M | 264 / 1.91 M |
| of which loose limbs | 67 / 0.24 M | 153 / 0.63 M | 199 / 0.83 M |
| of which loose pieces | 121 / 0.63 M | 107 / 1.03 M | 111 / 0.59 M |
| of which every baked body together | 1 / 0.03 M | 1 / 0.11 M | 1 / 0.12 M |
| Fixed capsules for the dead | 596 | 1,815 | 2,065 |
| Running through the heap: ragdolls awake, physics 95th | 6, 1.6 ms | 17, 3.4 ms | 14, 4.0 ms |
| Blood decals in the buffer | 2,048 | 8,192 | 12,288 |
| The far batch's arrays | 3.4 MB | 6.7 MB | 6.7 MB |

That Standard row is why `bakeOver` is 4: it was measured with bodies in sight left as characters until twelve past
their cap. With it at 4 the same fight still stops with 80 characters (4.87 M triangles in the frame, against 3.45 M for
the game before): during a long fight on one spot bodies are disturbed again before they have lain the 3 s a bake waits
for, and they are baked down to 36 only once the fighting stops. **That worst case is closed since the fit pass**
(467 draw calls and 2.71 M triangles after the same fight: "Loose limbs are baked too, and what a crowded heap costs",
below); the table above is P1's and is kept as its record.

**Why Standard is the default, and what is not known.** Once a floor has settled, Standard draws about what the game
before drew for its 40 corpses (36 characters, of which 28 settled, and every other body in one draw), with three times
the bodies and four times the blood. During a long fight on one spot it drew more than the game before did, by the
figures above, until the fit pass baked the limbs and hurried a crowded heap; it now draws less (2.71 M triangles
against 3.45 M). Low draws about half of what the game before drew (1.86 M triangles after the same fight, before the
fit pass). On the
development machine all three hold 60 Hz. **On the laptop nothing was measured**: if Standard drops frames there in a
heap, Low is the level that is cheaper than the game was.

**Co-op.** Each screen keeps its own mess and runs all of this on its own bodies, from positions it already has. Nothing
is sent. A pushed corpse is not in the same place on two screens, and never was: corpses do not block players or bullets
on any of them.

**How it is judged.** `tools/scripts/mess-fight.mjs` (header has the commands): a seeded bot on a frozen clock kills 30,
60 and 150 with the real guns, photographs the floor at each from three fixed cameras, then walks the player through
it and lays that out as two contact sheets (the player's eye, and from above). `MESS_CHOKE=1` is a chokepoint: one line,
no rockets, how high a heap gets. The same script runs on an old build for the "before".

| | Before (`66a33f1`) | After (Standard, every lane's work in) |
|---|---|---|
| A fight, 30 / 60 / 150 kills: bodies kept | 29 / 40 / 40 | 28 / 54 / 122 (42 of them baked) |
| The same: blood decals on the floor | 2,048 / 2,048 / 2,048, shared with every hole and full at the 14th kill | 4,995 / 8,454 / 8,852; the first is overwritten after about 40 kills |
| The same at 150: draw calls, triangles, one frame drawn | 640, 3.45 M, 5.08 ms | 838, 4.87 M, 5.18 ms (80 bodies still characters, 5 s after the last kill; they are baked down to 36) |
| A chokepoint, 20 / 46 / 80 kills: highest hips | 0.19 / 0.19 / 0.14 m | 0.26 / 0.37 / 0.63 m (0.32 / 0.70 / 0.88 in the first run of P1 alone) |
| The same at 80: bodies with hips over 0.35 m | 0 | 9 |
| The same: bodies kept | 20 / 40 / 40 | 20 / 46 / 80 (30 baked) |
| The same at 80: draw calls, triangles | 576, 3.31 M | 603, 2.95 M |
| Running through the heap: ragdolls awake at once | 0 (walked through untouched) | up to 18 |

## Many more corpses: the far batch (2026-11-19)

`far.ts` (`FarBatch`, which `Gore` holds as `this.far`), `Character.snapshot`, `restore` and `bakeFar`, the policy in
`MessField.farPolicy`. Tests: `mess.test.ts`, "the far batch". Proof: `tools/scripts/mess-far.mjs`.

Three ways a dead body is drawn, by age and by where the player is:

| | Which | What it is | Cost each, on the laptop (estimate) |
|---|---|---|---|
| Full | the newest `full` (8) | as it died: its own shadow, every level of detail, what is under its skin | 0.18 ms |
| Settled | the next, up to `drawn` (32) characters in all | still skeleton, no shadow of its own, coarser and closed up past 7 m | 0.06 ms |
| Baked | the rest, up to the cap on bodies | no character at all: its triangles in one shared mesh, one draw for all of them | 0.007 ms |

**Baking.** A settled body at rest for `bakeAfter` (3 s) is skinned once on the CPU at its coarsest level of detail (a
Trooper is 1,785 triangles) and written into a slot of one shared geometry, with its gear and any stand-in head as they
hang. The skin shader's own work is painted into the vertices, since a baked body has no texels to read: each wound's
stain to the shader's reach and its dark middle, a wet body's all-over darkening, char. Then its character goes back to
the library for the next enemy. One material draws every archetype (the characters' far material, which shades from the
vertices alone). Its chain and its fixed capsules stay in the world, so **a baked body is still part of its heap**.

**Standing up again.** `CorpseSnapshot` keeps what the bake cannot: where the body is, each bone's pose, what is cut off
it, the texels its wounds, blood, burns and wear live in, and copies of what it wore. `Gore.standUp` takes a fresh
character from the library, lays it out from the snapshot (`Character.restore`), hands it the same chain (`Rag.adopt`)
and takes the slot back: no bone is anywhere but where it was (0 m in the proof), and nothing enters or leaves the
physics world. It is at rest still; whoever asked wakes it. What asks:

- **A round** that would meet it (`raycastCorpses` stands up the baked body whose box the ray enters first).
- **A blast** (`Gore.blast`): the baked bodies it reaches, nearest first.
- **The player or an enemy walking into it, a body landing on it, or what it lay on going**, exactly as for any body
  at rest (the lists in `mess.ts` include the baked).
- At most 3 a frame for rounds and blasts, and the 2 a frame of every other wake.

**Which bodies are which** (`farPolicy`, four times a second). Past `drawn` characters the oldest settled bodies are
baked, two a look. With room, the nearest baked body is stood up. With neither, the nearest baked body and the furthest
drawn one change places when the baked one is `swapGain` (4 m) the nearer, so the bodies round the player are the drawn
ones. **Every one of those changes is made where it cannot be seen: out of the camera's sight, or at least `swapFar`
(11 m) from it.** A body in plain sight within 11 m is baked only when the characters are `bakeOver` (4) past their cap:
a heap of more than 36 killed in front of a player who never looks away, where the oldest bodies in it are baked as they lie. Past the cap on bodies, the oldest baked body
out of sight goes first of all. A burning body is not baked until its flames are out, and `gore.hold(char, seconds)`
keeps any body a character for as long as someone needs it to be.

**No pop** (`mess-far.mjs`: a row of six bodies photographed as characters, baked, and stood up again, the game stopped):

| Row at | Pixels that change when it is baked | And when it is stood up again, against the first picture |
|---|---|---|
| 6 m (in plain sight: only past 36 characters) | 5.7% of the crop round the bodies | 0.02% |
| 11 m (from here on, any time) | 2.5% | 0.15% |
| 18 m | 0.14% | 0.001% |

Stood up again a body is the body it was. Baked, it loses what the far level of detail always lost: the lit eye of a
visor, the weave on cloth, the ribs inside an opened chest (the hole is painted dark).

**Cost.** A bake is 0.2 to 0.3 ms (1 ms the first, while its tables are made), a stand-up 0.1 ms. Sixty mixed bodies in
view: **381 draw calls and 1.49 M triangles as characters, 126 and 0.50 M baked** (the empty map is 140 and 0.45 M): the
sixty are one draw of 110,180 triangles. The batch's arrays grow forty bodies at a time, 3.4 MB a step in the page and
again on the GPU, to 13.6 MB at 160.

**Switch:** `?messfar=0` (dev panel, "Far corpses baked"): nothing is baked, body or limb, and every body kept stays a character, as in P1.

### Loose limbs are baked too, and what a crowded heap costs (the fit pass, 2026-11-19)

After 150 kills on one spot at Standard the floor cost more than the game before the update did: 813 draw calls and
4.41 M triangles against 640 and 3.45 M (`mess-fight.mjs`, the same seeded fight). Of that, 48 loose limbs were 158 draws
and 0.61 M triangles, 28 trunk pieces 110 draws, the loose pieces 129 draws and 1.08 M, and 69 bodies were still
characters (2.04 M) because a body in a fight is disturbed again before it has lain the 3 s a bake waits for.

- **Limbs.** `Gore.farLimbs` is a second `FarBatch` with small slots (`FarTuning.limb`: 900 vertices and 800 triangles,
  72 slots, 24 at a time: 0.75 MB a step). A limb at rest is written into it at the body's coarsest level of detail
  (`SeveredPart.bakeFar`, the same `bakeSkin` a body uses, with its wounds, wear and char painted in, and what it holds:
  a hand keeps its gun or it is not baked), and **its own piece is only taken out of the scene, not given back**: the
  piece, its chain and its fixed capsules are kept, so a round, a boot or a blast finds it exactly as before and
  `unbakeLimb` puts it back as itself, on the frame, with nothing to restore. Not baked: one that burns or smokes, a top
  half trailing its guts or still crawling, one staked. The bake writes only the vertices a piece still has (`bakeSkin`
  packs them), so a limb takes a limb's room.
- **Which** (`MessField.limbBatch`, four times a second): one further than `swapFar` (11 m) is baked once it has lain
  `bakeAfter`; nearer, the `limbsDrawn` newest-and-nearest stay themselves (6 / 12 / 12 / 20 by level) and the rest are
  baked furthest first, out of sight before in it, and in it only `bakeOver` (4) past the number; a baked limb the player
  has come within 7 m of is put back when it is out of view and there is room.
- **Pieces and halves at rest cast no shadow** (`ChunkTuning.shadowFor`: a kind of piece casts one only while one of
  its pieces is in the air, and 1.5 s after; a half or trunk piece until it freezes). Every kind was drawn twice for the
  shadow of something a few centimetres high lying on the floor.
- **A crowded heap** (`MessField.crowded`: more bodies drawn as characters than the setting means to draw): settled
  bodies keep their finest level of detail and what is under their skin only within `nearCrowded` (4 m) where it is 7,
  and past `bakeOver` three times over (12) bodies are baked after 0.4 of `bakeAfter` (1.2 s) and four a look.

Measured, the same fight and the same chokepoint, before the fit pass and after (Standard, development machine):

| | Before | After | The game before the update |
|---|---|---|---|
| A fight, 150 kills on one spot: draw calls / triangles / one frame drawn | 813 / 4.41 M / 5.55 ms | **467 / 2.71 M / 2.87 ms** | 640 / 3.45 M / 5.08 ms |
| of which bodies as characters (how many) | 269 / 2.04 M (69) | 133 / 1.07 M (32) | |
| of which loose limbs | 158 / 0.61 M | 40 / 0.17 M (12 as themselves, 36 baked) | |
| of which trunk pieces and halves | 110 / 0.10 M | 56 / 0.05 M | |
| of which loose pieces | 129 / 1.08 M | 77 / 0.71 M | |
| A chokepoint, 80 kills: draw calls / triangles / one frame drawn | 583 / 2.98 M / 3.88 ms | 415 / 2.16 M / 2.95 ms | 576 / 3.31 M |
| The same: highest hips, bodies with hips over 35 cm | 0.68 m, 9 | 0.65 m, 13 | 0.14 m, 0 |

The heap is as high as it was: nothing here takes a capsule out of the world. Run again on the last build of the pass
(the fight plays out a little differently with every change to the dice): 463 draw calls, 2.59 M triangles, 2.81 ms,
highest hips 0.72 m; the chokepoint 419 / 2.09 M, highest hips 0.83 m.

### What a heap costs the physics step (the fit pass, 2026-11-19)

The verify lane's cost scene (`tools/scripts/gore-cost.mjs`: up to 48 alive in the Crucible, fought from one spot, real
time at 60 Hz) found the physics step at 5.0 ms a frame where the game before the update took 1.55. Measured here on a
45 s fight (a quarter fewer kills, so every number is lower), with Rapier's own profiler on (`world.profilerEnabled`):

- **It is not how many capsules lie in the world, and it is not the loose pieces.** A resting body keeping only its
  big shapes (4 or 5 of about 18: 2,820 colliders in the world where there were 3,890) took 3.4 ms against 3.4 to 3.5.
  A body landing on a heap waking nothing, 3.4. Loose pieces falling through the dead as they used to, 3.2 to 3.3, inside
  the run-to-run spread (3.1 to 3.5 on the same build). None of the three was kept.
- **How many chains are simulated is set by the ragdoll budget, with or without heaps**: 14.8 a frame (154 parts) with
  heaps and 13.6 (143) with `?messrest=0`. Bodies that lie on bodies are woken (120 to 170 times in 45 s: walked into,
  or what they lay on moved), and the budget freezes as many again.
- **What a heap adds is contacts**: one world step is 1.59 ms with heaps and 1.17 without, the solver 0.64 against 0.43
  and the narrow phase 0.39 against 0.31. A part lying on three capsules is three contacts where the floor was one.
- **And every step was being taken 1.57 times a frame.** `Physics.step` cut any frame longer than 1/60 s into two steps,
  and on a 60 Hz screen frames read 16.6 to 16.8 ms: more than half of them were a hair over and ran two steps of 8.4 ms,
  each costing as much as one whole one. This was so before the update too. A frame up to 6% over 1/60 s is one step now
  (`STEP_SLACK` in `src/physics/Physics.ts`, `physics/Physics.test.ts`; `?onestep=0` and the dev panel row "Physics: one
  step a 60 Hz frame" put it back). Every test, every seeded proof and every frozen-clock picture has always fed exactly
  1/60 s and taken one step, and so has a 120 or 144 Hz screen: this is the physics everything was tuned on.

| The 45 s fight, Standard, ms a frame | Physics step, mean (95th) | World steps a frame |
|---|---|---|
| Two steps (`?onestep=0`), five runs | 3.1 to 4.4, mean 3.6 (5.3 to 6.8) | 1.57 |
| One step, two runs | **2.1 and 2.5** (3.6) | 0.98 |
| Two steps, no capsules at rest (`?messrest=0`) | 2.2 and 2.3 (3.6 to 3.8) | 1.57 |

So the heap at one step a frame costs what no heap cost at two. It is still more than the old game, which gains the
same third. The spread between runs is wide (the machine is shared and the fight is played in real time); the verify
lane's 90 s scene is the one to quote for the whole update.

## The mess: measured budgets (M0, 2026-11-19)

Measured for the gore update on the development machine (i9-13900K, RTX 4090, load 7 to 9, game at its default quality,
which draws 1440x900 at dpr 2), with `tools/scripts/mess-m0.mjs` (the game stopped, the frame rendered between GPU syncs,
best of 8 rounds of 10 frames, variants round-robin) and `tools/scripts/mess-physics.probe.ts` (headless Rapier).
**There is no laptop here.** The laptop column is an estimate, and how it is made is under the tables. Every cap in "The
mess" below cites a row here.

**Corpses in view** (Troopers, Husks and Gunners lying in rows 4 to 25 m ahead, half of them opened by a shotgun round;
`ms` is the whole frame, `cpu` the script's share of it):

| Corpses | Frame ms | cpu ms | Draw calls | Triangles |
|---|---|---|---|---|
| 0 | 1.07 | 0.93 | 140 | 0.45 M |
| 20 | 2.21 | 2.10 | 264 | 1.34 M |
| 40 | 2.56 | 2.41 | 383 | 2.23 M |
| 80 | 3.95 | 3.66 | 596 | 3.82 M |
| 150 | 5.92 | 5.97 | 887 | 5.97 M |

The same 150 with one thing changed:

| Change | Frame ms | Draw calls | Triangles |
|---|---|---|---|
| as they are | 5.92 | 887 | 5.97 M |
| no body casts a shadow | 5.31 | 578 | 3.91 M |
| nothing under the skin drawn | 6.04 | 827 | 5.40 M |
| next level of detail (LOD 1) | 6.00 | 827 | 3.11 M |
| far level of detail (LOD 2) | 5.53 | 767 | 1.88 M |
| skeleton not worked out or sent again | 4.12 | 887 | 5.97 M |
| all of: LOD 1, no shadow, no interior, still skeleton ("tier 1") | 3.72 | 518 | 1.96 M |
| bodies hidden | 1.54 | 146 | 0.49 M |

- **A corpse costs 4.9 draw calls and 36,600 triangles** on average (5 and 44,000 for an opened one near, with its shadow),
  and **0.030 ms** of frame on this machine, **all of it the script's own work**, not the GPU's: three.js walks, sorts and
  submits each one, and every skeleton is worked out and its texture sent again every frame though the body lies still.
- **A still skeleton saves a third** (0.012 ms a body). Shadows are 2 draws and 13,700 triangles a body. Detail levels
  save triangles and no script time. Tier 1 as a whole is **0.0145 ms, 2.5 draws and 9,900 triangles a body**.
- `bakePose` (level 0, 10,700 to 12,600 vertices): best 1.1 to 1.3 ms, median 1.2 to 1.8, on a Husk, Trooper and Brute.
  The three levels of detail share one vertex buffer: 12,950 / 5,460 / 1,790 triangles on a Trooper.

**Decals** (the blood ring filled, all in view down a 40 m hall, then with the player standing on a 3 m spot where
they are all stacked, looking at their feet, so the stack fills the screen):

| Decals | Where | Frame ms | Without decals |
|---|---|---|---|
| 2,048 | spread over 40 m of floor | 1.04 | 1.09 |
| 8,192 | spread over 40 m of floor | 1.46 | 1.13 |
| 250 | stacked, filling the screen | 1.13 | 0.95 |
| 1,000 | stacked, filling the screen | 1.57 | 1.01 |
| 4,000 | stacked, filling the screen | 3.34 | 0.92 |
| 8,192 | stacked, filling the screen | 5.67 | 1.00 |

- Spread out, 8,192 decals cost 0.3 ms: the count is not what costs. **Stacked on screen they cost the GPU 0.57 ms a
  thousand** (the test's mix is about 0.7 m² a decal on 7 m² of floor, so a thousand is about a hundred layers: **0.006 ms
  a layer of a full screen**). Overdraw is the limit, so the rule that stops a soaked spot taking more is what holds it.

**Physics** (headless; fourteen ragdolls, the budget, dropped on a heap of fixed capsules in the ragdolls' own group; the
step over the two seconds of the landing):

| Fixed capsules | Median ms | 90th | Worst |
|---|---|---|---|
| 0 | 1.00 | 1.48 | 2.38 |
| 100 (3 a body) | 1.04 | 1.47 | 2.32 |
| 200 | 0.89 | 1.41 | 2.59 |
| 450 | 1.02 | 1.53 | 2.67 |
| 600 (15 a body) | 1.12 | 1.82 | 2.38 |
| 1,500 | 1.38 | 3.65 | 4.57 |
| 2,250 (150 bodies, every bone) | 1.30 | 2.04 | 2.90 |
| 4,500 | 4.10 | 4.88 | 8.11 |

- Fixed capsules are nearly free up to about 2,250: **a resting body can keep every bone's capsule**, not only its trunk
  and thighs, which is what lets it wake as a ragdoll in exactly the shape it lay in. Past 4,000 the step triples.

**The laptop estimate.** `docs/notes/render.md` timed the laptop (the 8 GB M1) at 7.5 to 9.9 ms for the map with eight
enemies and 12.3 to 15.6 ms with eighteen, both drawn stopped as here: about **0.5 ms a living body in view, at about
150,000 triangles each with its shadow and gear, so about 3.5 ms a million triangles**. The same eight Husks cost this
machine 0.32 ms, 0.04 each. So the laptop's GPU is what a body costs there, by triangles, and its script time is taken as
1.5 times this machine's. By that: a full corpse is about **0.18 ms** on the laptop (36,600 triangles and 0.03 ms of
script), a tier 1 corpse **0.06 ms**, and a baked far body in a shared draw (1,800 triangles, no script) **0.007 ms**.
Today's 40 full corpses all in view are about 7 ms there. A full-screen layer of decals is taken as 12 times this
machine's, 0.07 ms, so twenty layers under the player's feet are 1.4 ms.

## The whole update: what it costs (verify pass, 2026-11-19)

Measured on the final build (`00a6c7e`) against the game before the update (`d2e2f8a`, a second worktree and server) with
`tools/scripts/gore-cost.mjs` (`docs/notes/devtools.md`): a seeded bot fight in real time, every frame drawn at
1440x900 dpr 2, High quality, Mess at Standard, on the development machine (i9-13900K, RTX 4090, load 2 to 5).
**Heavy** is the worst case: up to 48 alive in the Crucible (men in Endless Humans), topped up at five a second and
fought from one spot so the heap grows, bullets, then rockets and grenades, then the Kiln, then bullets, about 420
kills in 75 s, then a walk through the heap. **Normal** is 16 alive, SMG and shotgun, moving. "Script" is the whole
frame's JavaScript, drawing calls included. Two runs of each heavy case, one of each normal. Raw runs:
`tools/out/gore-update/verify/cost/`.

**The physics step is taken twice on more than half of all 60 Hz frames** (fit, step 4). The fix is behind `?onestep=1`
and **off by default** (the lead's call); both are given.

| ms a frame (mean; 95th) | Before | Now, default | Now, `?onestep=1` |
|---|---|---|---|
| **Crucible heavy**: script | 10.3; 12.8 | **13.1; 17.2** | 12.1; 16.1 |
| physics step | 1.56; 2.65 | **5.14; 8.25** | 3.34; 4.5 |
| `gore.update` | 0.38 | 0.87 | 0.93 |
| `render()` | 6.7 | 5.7 | 6.3 |
| frame interval: mean; 95th; worst | 16.7; 16.8; 90 | 16.8; 17.8; 122 | 16.9; 18.0; 133 |
| frames over 16.9 ms | 1.1% | **9.4%** | 6.7% |
| draw calls: mean (most) | 691 (892) | 596 (1,083) | 627 (1,120) |
| triangles: mean (most) | 3.5 M (4.6 M) | 3.4 M (5.4 M) | 3.7 M (6.0 M) |
| walking the heap: script; physics | 10.2; 1.56 | 12.2; 4.94 | 11.2; 3.41 |
| **Endless Humans heavy**: script | 12.1; 14.7 | 11.6; 15.5 | 10.6; 13.6 |
| physics step | 1.81; 2.95 | 3.09; 4.8 | 2.18; 3.1 |
| draw calls; triangles | 908; 3.6 M | 822; 3.8 M | 762; 3.5 M |
| **Crucible normal**: script; physics | 10.0; 1.05 | 8.5; 1.85 | 8.5; 1.42 |
| draw calls; triangles | 504; 2.7 M | 438; 2.1 M | 464; 2.5 M |
| **Endless Humans normal**: script; physics | 7.3; 0.78 | 7.6; 1.57 | 7.0; 0.81 |

- **Drawing is cheaper than before the update** in every scene (fewer draw calls, the same or fewer triangles on
  average): corpses past 32 and loose limbs at rest are baked into two shared meshes, and a crowded heap is drawn
  coarser. The most triangles in one frame is higher (5.4 M against 4.6 M): a rocket in a crowd throws twice the pieces.
- **The cost is the physics step**, in the heap fight above all: 1.6 ms to 5.1 ms. Leaving one switch out at a time
  (on `bd37370`, before fit's last steps; script ms against 14.6 with all on): `?messrest=0` 11.6, `?messpush=0` 13.4,
  `?carry=0` 14.1; `?fire=0`, `?gibthrow=0`, the blood switches, the reaction switches and `?wear=0` are inside the
  noise between runs (about 1 ms); `?messfar=0` is 17.1, since baking is what pays for 120 bodies. So: bodies landing in
  a heap of resting capsules, enemies stirring the dead, and eight deaths on their feet at once.
- **The GPU's own time cannot be read on this machine**: the RTX 4090 is never what holds a frame (its timer reads 5 to
  7 ms in every case, which is the time the commands took to arrive). What a slower GPU pays is reasoned below.
- **Memory.** GPU 530 to 610 MB before, **660 to 780 MB now** (textures 475 to 550 to 600 to 685; buffers 21 to 48 to
  48 to 87). Of that: the decal sheet +43 MB, the floor tiles +6, the baked batches and cut pieces about +35 of buffers,
  and **about 100 to 130 MB of enemy skins that are now on the GPU from load**: the pieces cut from every archetype at
  load are meshes in the scene from the first frame, so each archetype's two 1024 textures are uploaded then, where the
  old game uploaded them when that enemy first appeared. In a long Crucible run both end the same; a mode with six kinds
  now holds all of them. Not fixed (the piece meshes are there so the first gib does not stall); it is the one thing
  here an 8 GB machine could feel. JS heap 54 to 65 MB before, 68 to 83 now. Low or Medium quality: 590 to 600 MB.
- **Load** (development server, page start to in play): Crucible 6.8 to 7.1 s before, 7.5 to 7.8 now; Endless Humans
  3.0 to 3.1 s, 3.9 now. About 0.75 s, as the lanes said.

**With the settings** (Crucible heavy, default physics): Mess at Low 9.3 ms script (physics 2.0, 489 draws, 2.5 M
triangles), under the old game's 10.3; Mess Low and quality Low 8.4 ms, 360 draws, 1.8 M triangles, 593 MB.

### A laptop, reasoned (there is none here)

**The processor.** `docs/notes/render.md` timed the owner's 8 GB M1 at 16.2 ms of script in an 18-husk Crucible fight
that takes this machine 7.8: about half this machine's speed. Chrome's own processor throttle at 2x and 4x, same scenes,
frames a second (fight; walking the heap):

| | Before | Now, as tests run it (no step-down) | Now, as a player gets it (dynamic resolution and the step-down on) | `?onestep=1`, as a player gets it |
|---|---|---|---|---|
| Normal fight, half speed | 58 | 59 | (no step taken) | 56 |
| Heavy fight, half speed | 46; 47 | 29; 26 | **53; 60** | 56; 59 |
| Heavy fight, quarter speed | 16; 20 | 13; 14 | 21; 26 | 21; 26 |

So on a processor like the M1's: **an ordinary fight is what it was; the heap fight would have halved the frame rate,
and with the automatic step-down it is better than the old game** (the step-down takes the heap's capsules, and what is
left draws less than the old game drew). On a machine a quarter of this one's speed the old game was at 16 and this is
at 21: neither is playable in the worst case, and Mess at Low with quality at Low is the setting for it.

**The GPU**, from counts, since nothing here can time one. The M1's own figures in `render.md` (9.5 to 9.9 ms for the
Crucible with eight enemies, 13.6 to 15.6 with eighteen at 2.7 M triangles) fit 5 ms plus 3.5 ms a million triangles.
- **Triangles:** normal 2.7 M before (about 14.5 ms there), 2.1 M now (12.4); heavy 3.5 M (17) and 3.4 M (17), with the
  worst frame 4.6 M (21) and 5.4 M (24). The heavy fight was over 60's budget on that GPU before the update and is
  still: the living are the bulk of it (48 within 26 m are all at full detail, 100,000 to 150,000 triangles each with
  shadow and kit), and that is the old game's, not the update's.
- **Fill:** four times the stains (8,700 against 2,048), up to 192 two-metre ones and sixteen floor tiles. The one view
  of the heap drawn with and without decals on this machine: 0.3 to 0.8 ms now against 0.5 before, which is inside its
  noise. By the mess lane's ratio (a layer costs a laptop twelve times what it costs here) that is 4 to 10 ms standing
  in the heap looking at the floor, against about 6 before: **the part of the update most likely to cost a laptop's
  GPU, and the least certain figure here.** It is fill, so dynamic resolution answers it (down to 38% of the pixels),
  the soak rule caps a spot at six layers, and Mess and quality scale it (2,048 stains and half the big ones at Low).
- **Burning bodies:** flames are particles in the transparent pass (0.1 to 0.5 ms here with a crowd alight) and three
  lights at most out of the preset's eight.
- **Memory:** above. About 0.2 GB more than the old game on a machine that shares 8 GB between everything.

**What a fresh install gets:** High quality, Mess at Standard, dynamic resolution and the step-down on. By these
figures a machine like the owner's M1 plays an ordinary fight as it did, and the worst case better than the old game
did (which did not hold 60 there either: 46). **Nothing here was run on a laptop.** The first things to check on one
are the heap fight with the dev overlay up, and memory with other programs open.

## Known limitations

The fit pass (2026-11-19):

- **A baked burnt body goes pale under the weapon light.** A baked body is vertex colours through the far material,
  which has no rule for char: within the light's reach it is lit like anything dark. Bodies are baked at 11 m and
  beyond or out of sight, where the weapon light is weak; one baked in plain sight in a crowded heap can show it.
- **Inside a wound's hole the old fixed fill is unchanged** (`anatomy/interior.ts`): the modelled interior still has
  its own warm light whatever reaches it, so in a dark corner a blown-out chest is brighter than the worn skin round
  it. Left: it is the look of wounds the owner has had since before the update.
- **A body that dies on its feet still ends folded on its knees.** Measured (`PROBE=pose`, six headings): four of six
  SMG collapses and six of six plain drops end with both knees folded right up (2.6 to 2.9 rad). The two knobs that
  exist (topple speed 1.6 to 2.6, the weak leg's lead 0.14 to 0.32) leave it at four of six. Varying it needs a real
  change (a leg that slides out from under) judged by eye, and was not cheap; not done.
- **Two heap tests hang on the dice** (`mess.test.ts`, the strand and the trunk piece on a heap): whether a piece
  thrown onto eight bodies lodges or rolls off depends on its spin. They pass on the suite's seed.

The mess (2026-11-19):

- **The laptop figures are an estimate.** Everything was measured on a desktop (i9-13900K, RTX 4090) and scaled from
  what `docs/notes/render.md` measured on the laptop. Whether Standard holds 60 there in a heap needs the laptop.
- **Trunk pieces and halves are not baked.** At rest they cast no shadow now (28 of them were 110 draws, and are 56),
  and they are 0.05 M triangles between them: one more batch for one more draw was not worth its code. A top half with
  its arms, head and kit is too big for a limb's slot and stays a piece.
- **A baked limb seen close is coarse.** It is the body's coarsest level of detail, a couple of hundred triangles: the
  policy keeps the twelve nearest as themselves and bakes in plain sight only past sixteen, furthest first, so the
  coarse ones are the far ones; one the player then walks up to is put back as soon as it is out of view.
- **A body baked in plain sight softens.** Past 36 characters in front of a player who never looks away the oldest are
  baked where they lie: at 6 m that changes 6% of the pixels round them (the far level's flat colour for the skin's
  weave, a visor's light gone, an opened chest painted dark). Stood up again they are exactly what they were.
- **A round stands a baked body up only if it passes within 14 cm of where one of its capsules lay.** One that only
  clips the edge of a limb goes through it without a mark.
- **Blood still runs out.** The other lanes now put about 170 to 200 decals on the floor a kill; 8,192 is about the
  last forty kills, and a soaked spot stops at 6 layers. The floor texture that would keep it all is agent "decals"'s
  P2, and `Decals.onRetire` is its hook.
- **Heaps are as high as round, slim capsules stack**: about a metre at a chokepoint after 80 kills. A body's capsules
  are slimmer than the body drawn (`RagTuning.colliderScale`), so stacked bodies sink into each other a little.
- **One body holds little up.** A piece that comes down on a single body mostly rolls off it: capsules are round. A
  heap holds pieces in the gaps between its bodies. A trunk piece or a half at rest keeps no shape of its own, so
  nothing lies on one of those.
- **The living still walk through a heap.** Enemies are points on the nav graph: they shove bodies a little and wake one
  now and then, and are never slowed by them. Nor is the player, by the owner's rule.
- **Bodies woken by a walk run past the ragdoll budget for a moment**: up to 18 chains awake running through a heap of
  80, physics 3.4 ms at the 95th percentile on this machine.


- **A body that falls from a stagger leans more than it steps.** On stage 6's drive (`stumble` with no budget) its physical feet get 0.15 to 0.3 m of a catch step the animation swings 0.56 m in 8 frames, so reeling backward it leans over its feet from about frame 8 and goes over. Leg gain did not change it. A body catching its balance has pins on its ankles and covers 0.87 to 1.03 of each step. The same pins on the fall cover 0.69 to 1.05, but then it ends by hip gap, not momentum, which two of stage 6's tests read otherwise; left off until the owner has seen both.
- **A body catching its balance is `downed` to everything else** for up to 2.5 s: it cannot attack, and melee gives it a downed body's low hit volume (`Melee.ts`, `DOWNED_HEIGHT`). Its ghost root does not collide, so it can reel through a neighbour, and into a wall it leaves its animation behind and goes over.

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
- **The ragdoll budget is not a hard cap.** Bodies that are fresh, or moving and inside their time, run over it: twelve
  knockdowns, four collapses and a grenade killing six hold 22 chains until the six are at rest, 1.5 s in the test, 1.6 s at
  most. A blast that kills more at once runs all of them for at least 0.6 s. The plan asked for at most 4 over for at most 1 s,
  but knockdowns and collapses are never frozen, so 16 of those plus 6 dead is 22 whatever the budget does, and the only way
  to hold 18 was to freeze four of the six in the air: with the plan's rule they froze 1.4 m up at 0.6 s. In `react-chaos`
  the peak stayed at 11 to 14 chains and the step peak did not rise. A big burst costs more: a grenade into 30 Troopers in
  Chrome held 26 to 27 chains for about 1.7 s, the physics step and gore's update together 5.3 to 5.9 ms at the 99th
  percentile against 4.1 to 4.2 with `?mass=0`. In Node, 30 to 36 killed by one grenade are back to 14 chains 1.0 to 1.2 s
  later, and the frame they die in is cheaper, 7.7 to 14.4 ms against 10.3 to 27.9 for 36, since the old budget froze 22 of
  them in it. The two ceilings tried are in The ragdoll budget. Not tried on the 8 GB M1 in a Crucible-sized wave.
- **A Husk's flinch is 0.242 rad**, against the plan's 0.24 at most, with the plan's own sizes. Left as specified.
- **The head's flinch spring still swings 6 to 8% past rest** (20 to 21% before). It is the plan's (160, 15), 0.59 of critical
  where the others are about 0.8; about (160, 21) would settle it, and would make a head hit's snap about a fifth smaller.
- **A Juggernaut's limbs still outrun its hips in a blast**: fastest hand 1.93 to 1.98 times its hips (1.76 to 1.81 for the
  right hand alone, which is what the plan measured), against the plan's 1.8. Spinning them less makes the hips faster, since
  less of the blast goes into the arms: already 9 to 12% at 1, and at 1.5 for the mass exponent the ratio is 1.63 with the
  hips 13% faster. The two targets pull against each other. In the sandbox `blast` sheet a Juggernaut holds one crouched pose,
  arms tucked, from 0.33 to 0.58 s before it goes down, where with `?mass=0` an arm swings out: heavier, or stiff, by eye.
- **The point-blank shotgun throws shorter in the game**, 1.78 to 1.86 m on average against 2.35 to 2.43 with `?mass=0` (28
  and 30 kills against 12 and 30). The impulse ceiling made no difference to it, and on a Trooper the mass factors are 1,
  which leaves the flinch: the first pellets of a shell flinch the living body on the frame the last one kills it, and the
  springs' speed is read into the speed it dies with (`measureAnimVelocity`). The flinch is smaller now. Not measured on its
  own. Inside the 1.2 to 2.4 m it was meant to stay in, on average; two to four kills in about thirty went under 1.2. The
  mean before was already over 2.4, so that band cannot say whether it got worse.
- **The tempo dial's 'only the floor ends a fall' test hangs on its draw.** Its blast from under a falling body lands with
  the hips over 0.6 m in 7 to 9 tries of 40, before stage 3 as well (`tools/out/fx/airblast.test.ts`, scratch), so it
  passes or fails by what ran before it in the file. 'a body thrown or shot again starts its time over' runs last for that.
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
- Pools grow as stacked decals, since `DecalSystem` has no resize: 3 per corpse, each spreading over about four seconds in the shader.
- **`Physics.radialImpulse` moves what it finds.** It collects bodies inside Rapier's query and applies the impulses afterwards. A chunk at rest has given back its body, so a blast only reaches chunks in flight.
- **Get-ups assume flat ground.** Feet and hands are keyed relative to the root, and the root sits on the floor under the chest. On a ramp or stairs a foot will sink or float a little. Not tried. A body beside a wall can stand with the wall inside its stand point, and `trackProgress` walks it out.
- **With `?fire=0` a burn emitter sits on the chest bone** (`EnemyManager`), so it goes down with the body. Only a rig with no
  chest carries it on the root at chest height, and there the flames ride above a body that is down. The new fire has no
  emitter: its flames come off the capsules.
- **A burnt corpse makes no sound.** The burning loop (`audio/reactions.ts`) follows living enemies only; a corpse burns and
  smoulders silently. Sound was left out of the gore update on purpose.
- **Knocked-down bodies have no collision with the player.** They are walked through, like crawlers.
- **A body check needs to land near the middle.** Its strength is how fast the player closes on the body, so at a 12.5 m/s run
  it goes over only when the player meets it within about 0.43 m of its middle; further out it is a glancing blow, and it
  staggers as before. The body's own speed toward the player does not count, so a husk running at the player is no easier to
  floor than one standing. In `lab-contact`'s 'run into a pack' the player meets two husks 0.6 m to either side at about 9 m/s
  and neither goes down; with six in the run's lane (`charge`) all six do. `CHECK_FROM`, `CHECK_MIN`, or the body's own
  speed in the closing, are the knobs, after the owner has charged a Crucible pack.
- **A braced fall does not slow the chest.** Five times what holds an arm up is a few kilograms against an 85 kg trunk, so
  the chest comes down through the hands' landing as fast or faster 0.1 s on (0.3 to 1.8 times its speed at the contact,
  mostly over 1, with the brace giving or not), and on a fall forward the body mostly lands on its knees first and settles
  onto its forearms. The plan's 30 to 60% slower is not met. What the give changes is the arm: on a straight one the elbow
  could lock and prop the body 0.3 s; now it bends. The arms bend under the weight either way in most falls, so its test also
  reads what the reflex asks of the landing hand's elbow: 1.0 to 1.3 rad in 4 to 6 falls of 8, where the stiff brace of
  `?knock=0` never asks past 0.47.
- **Knocked cold, the hands reach the floor before the chest**, in 32 of 32: slack arms at nine tenths of their weight hang
  at the hips, and a body that crumples drops onto them (hands at 0.27 to 0.38 s, chest at 0.37 to 1.05 s). The plan asked for
  the chest first in 3 of 4; a sack does not do that. What tells it from a plain knockdown is the head and arms, not the order.
  Nor does it land sooner: the chest is down 0.03 s later than the same knockdown not knocked cold, on average over eight
  headings (frame 29 against 27), and a fall forward can kneel 0.4 m up for half a second either way. Hanging the slack arms
  bent along the trunk, so one caught under the body would fold, made it 0.06 s later still and was left out
  (`tools/out/fix4/ko.test.ts`).
- **Only one hand reaches the face in the air**, and for 0.22 to 0.38 s at 3 m from a rocket (0.29 on average; 0 to 0.32 and
  0.17 before). The arms wake 0.07 s after the hit and are strong by about 0.2 s, and the arm on the blast's side is thrown
  away from the face; both hands at once, at most 0.15 s. Three times the strength while guarding added 0.07 s on average,
  inside the noise, and was left out. The knockdown test's own blast is too weak to get a hand there at all.
- **A body that falls on its side and gets up face up can lose a wrist for a frame**, 0.3 s into the clip: the left hand
  jumps 0.37 to 0.78 m. Three of 24 sideways knockdowns did it on the code before this stage, two of eight knocked cold here.
  It is in the get-up (`getUp.ts`, `HumanoidAnimator`), not gore, and not looked into. The four headings' handover test
  passes; the knocked-cold test does not check the handover for this reason.
- **Knockdowns are spent by a charge.** Six husks run over hold six of the twelve slots for about a second and a half, so a
  grenade straight after may only stagger some survivors.
- **Pushing up takes 0.55 to 1.3 s, unhurt or not.** The plan asked for 0.5 s for a body that feels nothing. Arms and legs
  carry little of the trunk (the gain limit), so it rises as fast as a lift capped at 0.55 of its weight lets it; stronger
  limbs (`pushGain` 4, 6, 8) and a stiffer or less damped lift changed it by less than the run-to-run spread. Face down it is
  0.62 to 1.13 s (median 0.87); face up, sitting up, mostly 0.55 to 0.6 s, but 1.17 to 1.27 now and then from a body still
  rolling when it starts. The test allows 1.5 s. Each knockdown spends that much longer on physics, inside `maxKnockdowns`.
  For the owner: by the tuning's arithmetic (the push, `upGather` and 0.73 of the rise, against a 0.55 s gather and all of
  it), a Husk takes about as long from landing to standing face up as when the clip did all of it, and about 0.2 s longer
  face down (median); not measured side by side.
- **Face down it pushes to a push-up, not to hands and knees.** The prone clip's key at 0.24 has the arms straight and the
  legs out behind, the ankles where they lay; the knees come under at 0.46, which the clip plays.
- **Pushing up, about 0.9 of the body's weight is carried by help** that is not the floor: the lift's 0.55 and 0.36 from
  arms, legs and head carrying their own weight at `struggle` strength (lying it is 0.19 to 0.26). Counted together under
  the cap, the lift would be left 0.19 of the weight, under the 0.39 at which a body face down got its hips 0.05 m up in
  2 s. For the owner: whether a body pushing up looks light.
- **A Trooper face down pushes with one arm.** In the clip's frame a gun hand hugs the gun, so the other arm and the lift do
  the work, and the shoulders come up on that side first.
- **Knocked down from its knees, it lies on its face with its hips on its knees** for about half a second before it goes
  flat (`react-seq` `riseshot`). A body kneeling rests on its shins; slack arms and legs, or a topple, did not bring the
  hips down sooner past the noise. The upper body is down within 10 frames.
- **A rising Trooper or Gunner hit by a shotgun usually dies.** Felling a body on its way up takes `profile.fall` of shock,
  about four pellets in the chest of a Trooper, 80 damage, more than the 70 it starts with. In the game a Trooper on 52 of
  70 and a Gunner on 72 of 90 both died to one shell. Health grows 8.5% a wave (`waveScale`), so later bodies, and any hit
  that leaves one alive, show the rule; the `riseshot` sheet puts the health back to full and uses 15-damage pellets to show
  it. A Brute's `fall` of 2 is out of a shell's reach.
- **A shell's first pellets still flinch a rising body** before the one that fells it, and `measureAnimVelocity` reads the
  springs into the speed it goes down at, as with the point-blank shotgun below. Not measured on its own.
- **A struggle that never gets there** gathers for the clip's first frame after `upPatience` (2 s), letting the lift go: the
  body drops, then the clip does all of it in the shortened rise. Not seen in any of the probe's runs since the shoulders'
  height replaced the chest's tilt as the test of being up. The same for a limb broken or cut off while it lies there:
  `damage.ts` shortens the rise when it is knocked down, from the limbs it has then (`pushesUp`, the joints `Reflex.canPush`
  reads), and only gore knows at the hand-back.
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
