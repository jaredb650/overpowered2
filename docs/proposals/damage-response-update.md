# Damage response update: the plan

2026-11-18, against `coop-overhaul` at `808949f`. No game code was changed. This is an update plan, not an overhaul: almost
every step turns on, retunes or connects something that is already built.

The findings behind it, with every number, source and what I saw, are in
[docs/research/damage-response-research.md](../research/damage-response-research.md). Earlier proposals this builds on:
[gore-ragdoll-proposals.md](gore-ragdoll-proposals.md).

Sizes are **small**, **medium** or **large**. No day counts. "Each screen" means every player's machine works it out for
itself from the small hit and kill events it already gets, which is how gore runs in co-op now.

---

## 1. One page

**The six biggest holes.**

1. **Most hits get a 3° to 10° nod that lasts a third of a second, leaning straight away from you**, so from the gun it is
   foreshortened to nearly nothing. A struck arm moves 1.5°. A Brute moves 3°. The reaction you like (the body on its
   muscles, rocked by every round) exists, but only starts past a threshold. A Trooper under the SMG is dead 0.15 s after the
   first round, before he gets there.
2. **Rockets and grenades can never crack a torso.** The trunk cracks into 3 to 6 pieces with a ribcage and four organs only
   above a force of 420. A rocket's force is at most 84. So every rocket kill is the small version: two pieces, two organs,
   no ribs. The best torso work in the game is never seen.
3. **The gib happens behind the fireball.** For 0.2 s an opaque fireball covers the body. At double gravity the pieces are
   on the floor 0.3 s after that. You see a man, fire, then small dark things on the ground. The pieces are the right
   volume (48 litres of trunk in, 41 to 48 out); you just never see them leave.
4. **A man killed with the flamethrower leaves a clean, unburnt body.** Char rises with seconds spent burning (3.5 s to
   full), and the flamethrower kills a Trooper in 0.27 s. Then the fire goes out on the frame he dies, and he gets a red
   blood pool. A man who burns slowly turns an even brown all over at once, and the corpse does nothing more.
5. **The mess does not last a wave.** All blood shares one ring of 2,048 decals with bullet holes. It was full at the 28th
   kill; after that every new stain erases an old one. Meat is gone in 14 s, organs in 28 s. Corpses stop at 40 and the
   oldest sinks while you watch.
6. **Bodies cannot stack.** A body at rest has no collider, so the next one falls through it. Forty-six kills on one spot
   made a flat carpet one body deep.

**What I would do first** (batch 1, all small or medium, no new systems):

| # | Step | You will see |
|---|---|---|
| R1 | Every hit shows | a twist, a dropped shoulder, the struck arm or leg thrown back, on every enemy, from the first round |
| R2 | Hand to the wound, hurt posture | a hand goes to every real wound; a hurt enemy carries himself hurt |
| G1 | Rockets crack the trunk | 3 to 6 torso pieces, a ribcage and four organs from every rocket and grenade kill |
| G2 | Show the break | pieces come out of the fireball, hang, land near, and read against the floor |
| F1 | Fire that finishes the job | a flamethrower kill is charred; the corpse burns on, then smoulders; soot under it, not blood |
| P1 | The mess stays, quick version | four times the blood before anything is erased; meat and organs stay; corpses pile; none sink in view |
| M0 | Measure | nothing: real budgets for batch 2 and 3 |

**Then** (batch 2): the centrepiece, **R3, the struck part goes physical** for a third of a second on the nearest enemies, so
animation, powered ragdoll and limp ragdoll are blended by a weight instead of switched. With it: footprints, bloody weapon
and hands, drips, squashy organs you can step on, fire that spreads from where it touched and eats the skin.

**Later** (batch 3): blood kept in a floor texture so it never has to go; corpses baked and batched for 150 or more; wear you
can see on every limb before it comes off (the part of Dead Island 2's system we can have).

**Is "state of the art" reachable?** For a browser game, yes, and section 9 says what that means. Dead Island 2's free
cutting of living bodies and real fluid blood are out of reach. Killing Floor 2's whole-match mess, Red Dead's "every shot
is answered" on the enemies near you, and Fallout's readable gibs are all within reach of what is already built.

**What only you can answer** is in section 10. The two that change the most: should a hit spoil an enemy's aim (it makes the
game easier), and should bodies and blood stay for the whole match by default.

---

## 2. Why it feels the way it does

Short version of the research, complaint by complaint. Line numbers are at `808949f`.

| Complaint | What happens today | Where |
|---|---|---|
| "Eats a couple of shots, then the active ragdoll kicks in" | Every hit gets a spring flinch on four spine bones: 10° on a Trooper, 3° on a Brute, 1.5° on a struck arm, gone in 0.37 s, leaning along your line of sight. Physics starts only at a stagger of strength 0.35, within 20 m, in view, 6 at once. After a stagger nothing above a flinch for 0.9 to 1.6 s. Hand-to-wound is skipped on a flinch. Dying on its feet is capped at 4. | `enemies/damage.ts:128-133`, `:1245`, `:1330-1337`, `:1383-1398`; `enemies/reactions.ts:41-51`, `:139-186`; `HumanoidAnimator.ts:449-471`; `gore/index.ts:86`, `:102` |
| "On and off switch" | Three owners of a body (the animator, the powered ragdoll, the limp ragdoll) and a hard hand-over between the first two. Below the line: no physics. Above it: all physics. | `damage.ts:1379`, `gore/stand.ts` |
| "Torso just disappears" | Force 84 against a threshold of 420; an opaque fireball for 13 frames; double gravity; dark pieces lying flat; meat gone in 14 s. | `gore/torso.ts:28`, `:79`; `weapons/Combat.ts:1158`; `gore/chunks.ts:30` |
| "Blood is not interactive" | It sprays, lands, runs down walls, pools and dries. It does not get on feet, weapons or hands, does not flow or drip from above, and nothing splashes in it. One SMG round leaves a small puff and three to six spots. | `gore/blood.ts:14-44`, `render/Decals.ts` |
| "More organs, squishy organs" | Four organs, 6 to 10 cm, only from a gib or blow-out, world-only collision, one wobble on landing, gone in 28 s. | `gore/index.ts:213`, `:1617-1644`; `gore/chunks.ts:450-472` |
| "Burning is phoned in" | A timer, one flame emitter on the chest, char by seconds alive. Fire stops at death. It touches nothing else: not the wounds, the interior, the corpse, the floor, the gibs, or morale. | `enemies/EnemyManager.ts:44`, `:636-669`, `:1211-1216`; `characters/material.ts:188-211` |
| "Punching under its weight" | See the list in section 8. | |

---

## 3. The centrepiece: a hit-response gradient

### The idea

Today a body belongs to one of three things, and a hit moves it between them at fixed lines. The change is to make it **one
dial** per body, fed by every hit, with three layers that are always added together.

**The dial** is the `shock` the game already keeps per enemy (`reactions.ts:139`): each hit adds to it by the weapon's push,
the share of health it took and where it landed; it fades in about a second. Nothing new is counted.

| Layer | What it is | Who gets it | Starts | Weight |
|---|---|---|---|---|
| **0. The flinch, done properly** | animation on springs: twist, shoulder, struck limb, a catch step, a knee | every enemy, every hit, any distance | the frame of the hit | size by the weapon and the dial |
| **1. The struck part on physics** | the hit arm, the head and neck, or the whole upper body becomes a powered ragdoll hung on the animated spine | the nearest 8 or so in view | the frame of the hit | a looseness that drops on each hit and comes back over 0.3 to 0.6 s |
| **2. The whole body on its muscles** | what exists now as "catching its balance" | the nearest 6 in view | when the dial passes the stagger line | the support it already has, which falls with each hit and step |
| **3. Limp** | the ragdoll, with tone fading | the dead, and the living knocked down | when support runs out, or death | tone fading over about 3 s (exists) |

A light hit is layer 0 plus a brief layer 1. A harder one lasts longer and is looser. Enough of them tip the dial into layer
2 with the upper body already swinging, so there is no visible hand-over. Layer 2 loses its feet into layer 3 as it does now.
Going back down is the same in reverse: looseness returns, the last few degrees are eased out over about 0.2 s, and the
animation has the body again.

This is how Rockstar's games do it in outline: a shot loosens the joints and a ramp brings stiffness back over 0.4 s, with a
"snap" by bullet direction on top and a hand to the wound 0.2 s later (research, B1). We do not need their balance
controller: `gore/stand.ts` already keeps a body on its feet.

### How a body recovers

- **Layer 0:** the springs settle. A hurt posture stays (R2).
- **Layer 1:** looseness climbs back to 1 at a fixed rate. When the part is within a few degrees of the animation and nearly
  still, its pose is blended out over 0.15 to 0.25 s and its rigid bodies go back to the pool.
- **Layer 2:** as now. It catches itself and is handed back standing, mid-stride (`gore/index.ts:777`), or goes over.
- **Layer 3 for the living:** as now. It fights its way up and the get-up clip finishes it.

### Enemies that keep fighting while maimed

- A layer 1 chain is built from the bones the body still has. The ragdoll code already skips severed parts.
- A crawling man or a top half gets layer 0 and layer 1 on what is left of his upper body. He has no feet to lose, so no
  layer 2, as now (`reactions.ts:151`).
- A weak or broken limb is looser to begin with and comes back slower, using the limb strengths the game already works out
  (`damage.ts:416`).
- The gun hand is followed harder than the rest, as the stumble already does (`HumanoidAnimator.ts:68`), so the gun does not
  flail.

### Co-op: the host decides facts, each screen moves its own bodies

- **Facts (the host):** health, the dial's level when it crosses a line (stagger, fall, felled, thrown), death and its kind.
  These already travel in the hit's answer and the kill.
- **Feel (each screen):** layer 0 and layer 1 are worked out from the hit event alone: where, which way, how hard, how much.
  Nothing is added to the wire. Two screens will show slightly different swings. That is already true of ragdolls.
- **One exception, if you want it:** "a hit spoils his aim" (R3b) changes how an enemy fights, so the host must decide it. It
  can: it sees the same hit. It would be one more bit on the hit's answer.
- **The budget is each machine's own.** A slower laptop puts fewer enemies on layer 1 and nobody else is affected.

---

## 4. Batch 1: recommended first

### R1. Every hit shows (size: small to medium)

- **You will see:** on any enemy, from the first round: the struck shoulder thrown back and the trunk twisting with it; a
  struck arm swinging 20° to 40° and the hand trailing; a leg hit dipping that knee and shifting the hips sideways; a
  glancing head hit snapping the head. A Brute moves less, but visibly (6° to 8° and a shoulder roll, where it now moves 3°).
  From the gun, the reaction goes sideways and down, not only away.
- **How:** in `HumanoidAnimator.flinch` (`:449-471`): add a twist about the spine by which side of the body was struck; a
  sideways hip shift; real swing on the arm chain (upper arm, forearm lagging, hand lagging more); a knee dip for leg hits
  (the buckle exists, `:495`); a floor on size per weapon class so health share alone cannot shrink it to nothing; a little
  less damping (about 0.6) so it lands and settles once. In `damage.ts:128-133`, size by the weapon's push as well as health
  share.
- **Risk:** low to medium. The flinch was made smaller and stiffer on purpose in the weight pass because it "rang past rest".
  This changes its shape more than its size, and must not bring the wobble back. Behind a URL switch for a side-by-side.
- **Cost:** none measurable: a few more springs per enemy. Checked with the existing frame-by-frame probe
  (`tools/scripts/react-seq.mjs`), which can print the peak angle per bone.
- **Co-op:** each screen. Nothing on the wire.

### R2. Hand to the wound, and a hurt posture (size: small)

- **You will see:** about 0.2 s after any real wound, the free hand goes to it and stays a second or two, even though he
  keeps fighting. Arms come up after a blast or a head glance. An enemy at a third of his health stands lower and guards
  the worst wound; one with a spent leg limps before it gives.
- **How:** `anim.holdWound` and `anim.guard` exist and work, but `respond` returns early on a plain flinch
  (`damage.ts:1330-1333`) before it reaches them (`:1334-1337`). Call them for flinches too, above a small share of health,
  with a short gap so the SMG does not re-trigger it every round. Feed the hunch and the limp from the limb strengths the
  game already computes for the ragdoll (`damage.ts:416`).
- **Risk:** low. Taste: with zombies it should stay off (they feel nothing: `pain: 0`, `reactions.ts:45`).
- **Cost:** none.
- **Co-op:** each screen.

### G1. Rockets and grenades crack the trunk (size: small)

- **You will see:** a rocket or grenade kill leaves three to six torso pieces with skin outside and ribs and spine on the
  broken faces, a whole ribcage in six fragments, four organs and a strand or two of gut. Today it leaves two pieces and
  two organs.
- **How:** `planGib` (`gore/torso.ts:79`) picks the small break when force is at or under `waistUnder`, 420 (`:28`). A
  blast's force is at most 84 for a rocket and 74 for a grenade (`Combat.ts:1158`). Choose the break by what killed him
  instead: a gib from a rocket, grenade, barrel or shell cracks (five or six pieces for the bigger blasts, three for the
  small ones); keep the one-in-five waist tears for variety. Add a test that a rocket kill cracks, since today's test
  checks the rule and not that any weapon can reach it.
- **Risk:** low. It is the look the torso work was built for.
- **Cost:** a full gib is 3 to 6 trunk pieces, 6 rib fragments and 4 organs where a waist tear is 2 and 2. The notes
  measured a full gib at 7 to 10 ms a call and +45 to +75 draw calls at peak (`docs/notes/gore.md`, "Measured"), and the
  first of a run at 42 to 72 ms. The first-gib stall should be fixed with this (it is Q1 in the earlier proposals: warm
  every gib material at load). The cap of three full gibs a frame stays (`torso.ts:35`).
- **Co-op:** the break choice already rides on the kill (`damage.torso`), so every screen cracks the same way.

### G2. Show the break (size: small to medium)

- **You will see:** the pieces come **out of** the fireball, tumbling, trailing blood, for most of a second, and land within
  a few metres. Torn faces are wet red and catch the light. Among the pieces are forearm-sized slabs with the victim's own
  suit on one side.
- **How:**
  1. Thin the fireball's core after its first two or three frames, or shorten it, so what leaves the body is seen
     (`fx/recipes/explosions.ts`).
  2. Throw trunk pieces up more than out, and give gib pieces (not ragdolls) about 0.55 of gravity for their first second.
     The ragdolls' tempo dial (`RagTuning.gravityScale`) shows the pattern; this is the same idea for pieces only.
  3. Brighten the torn faces and the organs: more saturated, a wet highlight. Art direction already says warm colour is for
     what the player does.
  4. Fill the size gap with 4 to 8 mid-size slabs: skin and suit on one face, meat on the other, cut from the kit at load.
- **Risk:** low for 1 to 3. Item 4 is model work under the quality bar (real form, torn edges, no boxes).
- **Cost:** none for 1 to 3. Item 4 adds a few instanced pieces per gib inside the existing cap of 72 moving pieces.
- **Co-op:** each screen.

### F1. Fire that finishes the job (size: small to medium)

- **You will see:** anyone killed by fire is charred, however fast it was. The corpse keeps burning for several seconds,
  blackening the rest of the way, lighting the floor around it. Then the flames die and it smoulders: thin smoke and a
  fading glow in the cracks for half a minute. Under it, soot and a scorch, not a red pool.
- **How:**
  1. Raise char by fire damage taken as well as by time (`EnemyManager.ts:665-667`), and on a death by fire set it to at
     least 0.85.
  2. Do not stop the flames at death (`EnemyManager.ts:1211-1216`): hand the emitter to the corpse for 4 to 8 s, raise char
     to 1 over that time, then switch to smoke puffs and a slow fade of the ember glow the shader already has
     (`characters/material.ts:200-210`).
  3. Flames from more than the chest: each puff picks a bone of the body, so a burning man is on fire all over and a
     severed burning limb burns too (`EnemyManager.ts:662`, `fx/recipes/misc.ts:364`).
  4. A burnt body leaves a scorch decal (the kind exists) when it comes to rest, and no blood pool
     (`gore/index.ts:997-1003`).
  5. A flickering light on the nearest few burning bodies (`render` dynamic lights exist) and the heat shimmer layer
     (`fx/layers/shimmer.ts`), which burning bodies do not use today.
- **Risk:** low. Pooled emitters and lights with hard caps; the nearest few only.
- **Cost:** a few more particles per burning body; at most 3 or 4 more dynamic lights. Measured as frame time with ten men
  alight in view.
- **Co-op:** burning is already a synced status. The corpse's afterburn is each screen's own.

### P1. The mess stays, quick version (size: medium)

- **You will see:** about four times as much blood before anything is erased, and bullet holes no longer erase blood. Meat,
  organs and ribs stay where they fell. Bodies land **on** bodies and heap. No corpse sinks while you look at it.
- **How:**
  1. **Decals:** split the single ring of 2,048 (`render/Decals.ts:6`) into rings by kind inside the same instanced mesh and
     enlarge it: about 6,000 for blood and pools, 1,500 for holes, scorches and cracks. Still one draw call. Skip a new
     small spot where the floor is already covered, so a soaked area stops spending slots.
  2. **Pieces:** stop shrinking meat, organs and ribs away after 14 and 28 s (`gore/chunks.ts:30`). A still piece is one
     instance in a draw that happens anyway; let it lie until its slot is needed, and raise the slots (meat 96 to about 250).
  3. **Corpses out of view first:** sink the oldest corpse that is off screen or far, and the oldest in view only past a
     hard cap. Halves already work this way (`gore/sliced.ts:22-24`). (This is Q2 in the earlier proposals.)
  4. **Stacking:** when a body freezes, leave it one or two fixed capsules (trunk and thighs) in the ragdoll's own collision
     group, so the next body rests on it (`gore/rag.ts:927-933`). They are removed if the body is woken, and never touch the
     player or the living.
- **Risk:** medium for 4: a body woken under a pile must not launch what lies on it; wake the pile gently or leave its
  colliders until the upper bodies wake. Low for the rest. The stripes seen where pools overlap should be fixed here too
  (a small depth offset per decal).
- **Cost:** decals: about 0.5 MB more buffer; the risk is overdraw where thousands overlap at a Retina screen's pixel count,
  which M0 measures. Fixed colliders: a few hundred at most, nearly free for the solver. Pieces: none.
- **Co-op:** each screen keeps its own mess. Nothing is synced, and a player who joins late sees a clean floor, as in
  Killing Floor 2.

### M0. Measure the real budgets (size: small)

Nothing here was timed for this plan: the machine was at twice its load. Before batch 2:

1. Frame time against corpses in view: 0, 20, 40, 80, with and without shadows and interiors, on the laptop target, using
   the GPU's own timers. I counted about 7 draw calls and 56,000 triangles per corpse at close range; this says which of the
   two hurts.
2. `bakePose` time per level of detail (for batch 3).
3. The physics step with 14 ragdolls landing on 100 and 200 fixed capsules.
4. Decal overdraw: 6,000 decals with a thousand overlapping in view at 1440x900 at double pixel density.
5. The physics step with 8 upper-body chains live (for R3). The notes give about 8 millionths of a second per body per
   sub-step for the muscles and 1.5 ms for 14 ragdolls and 22 limbs on the old Mac.

---

## 5. Batch 2

### R3. The struck part goes physical (size: large). The centrepiece's physical half.

- **You will see:** shoot an arm and it is thrown back for real, elbow bending, then pulled back to the gun. Shoot a shoulder
  and the upper body turns with it. Hold fire on a Brute and its chest and arms are rocked by each round from the first, the
  way they are now only after it staggers. A kill that follows carries that motion into the fall.
- **How:** a new call beside `knockdown`, for a living body the animator still owns. It takes a chain from a pool (an arm:
  3 bodies; head and neck: 2; the upper body from the chest up: 9), hangs it on the animated spine, and drives its joints
  toward the animated pose with the muscle layer, at a strength that drops with each hit and returns over 0.3 to 0.6 s. A
  directional snap is added on the struck part. When it is back and still, its pose is eased out and the chain is returned.
  If the dial crosses the stagger line while a chain is live, the existing whole-body hand-over takes it from the chain's
  pose and speeds. Death does the same. The pieces exist: `Rag` builds any bone chain, `stand.ts` pins a body to the
  animation, the muscles follow a pose, and velocity seeding removes the pop.
- **Limits:** the nearest 8 in view within about 25 m; others keep layer 0 only. The cooldown (`reactions.ts:171`) should
  stop repeat staggers, not this.
- **Risk:** high. It is the hand-over the owner already notices when it is wrong. It needs a URL switch, the frame-by-frame
  probe, and a playtest. It is also the step the earlier proposals called M4 and B1; this is the same work with a clearer
  target.
- **Cost:** at most about 72 rigid bodies with drives, roughly six or seven ragdolls' worth, on top of today's. Measured in
  M0 item 5, then in a crowd under fire.
- **Co-op:** each screen. No traffic.

### R3b. A hit spoils his aim (size: small; a design decision, off unless you say so)

- **You would see:** an enemy hit in the gun arm, or rocked hard, fires wide or late for the third of a second it takes him to
  recover. Today nothing short of a stagger touches an attack (`damage.ts:1608`).
- **Why it is separate:** it makes every gun a little better at suppressing, so it is balance, not gore. In co-op the host
  decides it.

### R4. Dying carries the shots (size: small)

- **You will see:** in a burst that kills six, all six die on their feet under your fire instead of four.
- **How:** raise `maxCollapses` from 4 (`gore/index.ts:86`) by what M0 allows. Let a kill that lands while a body is on its
  muscles keep the dying-on-its-feet drive instead of dropping to a plain ragdoll (`damage.ts:1202-1205` refuses a body that
  counts as down).
- **Risk:** low. **Cost:** each is a full ragdoll for about a second. **Co-op:** each screen.

### B1. More blood from one hit (size: small)

- **You will see:** a single round throws a visible spray out the far side and leaves a hand-sized mark and a short trail
  within a quarter second, not three coin spots at half a second. A man hit and still walking leaves a trail.
- **How:** per-hit counts and sizes in `gore/blood.ts` (`onHit`, `:297`) and the queue speed; a dripping wound on the
  living already exists (`bleed`), so lengthen and thicken it by the hit. Tie the amount to the gore setting.
- **Risk:** low. **Cost:** inside the per-frame budgets that already cap it (24 rays, 6 sprays, 6 drops a frame).
  **Co-op:** each screen.

### B2. Footprints (size: small to medium)

- **You will see:** walk or slide through a pool and you leave red prints that fade over a dozen steps; so do enemies. A
  slide leaves a long smear.
- **How:** a wet timer on the player and the nearest enemies, set when a foot lands on a pool; one decal per footfall while
  it lasts. Needs a print shape in the decal atlas. The smear exists (`blood.ts:336`).
- **Risk:** low. **Cost:** a few decals a second. **Co-op:** each screen, for the bodies it draws.

### B3. Blood on the weapon and hands (size: medium)

- **You will see:** after close kills the gun, the blade and the gloves are spattered, wet at first, drying darker.
- **How:** one wet value on the viewmodel's materials, raised by kills within a few metres and by melee, dried on the
  decals' curve. (M9 in the earlier proposals.)
- **Risk:** medium: the viewmodel is seen closer than anything else in the game. **Cost:** none. **Co-op:** own screen only.

### B4. Drips, splashes and soaked bodies (size: small each)

- **You will see:** blood on a ceiling or a ledge drips for a while. A body or a limb landing in a pool throws a splash. A
  corpse lying in a pool gets redder where it touches.
- **How:** the dripping-wound emitter pinned to a world point; a splash recipe on a landing inside a pool; raise the
  corpse's blood amount when it freezes on a pool.
- **Risk:** low. **Cost:** inside the drop budget. **Co-op:** each screen.

### O1. Organs you notice (size: medium)

- **You will see:** organs about half as big again, wet and bright against the floor. They squash when they land, sag when
  they rest and quiver when something lands near. Step on one and it bursts with a noise and a splat. Shoot one and it
  bursts. Walk into one and it rolls. With G1 there are four per rocket kill, not two, and a ribcage.
- **How:** sizes at `gore/index.ts:213`. Squash in the instance's own scale, driven by a spring per piece instead of the one
  sine on landing (`gore/chunks.ts:450-472`). A foot test against the 72 pieces a frame for the step and the kick. A ray
  test against still pieces for bullets. Remove a thrown organ from the body's interior so an opened chest is missing what
  flew out of it.
- **Risk:** low. Tone is yours to judge (question 7). **Cost:** 72 distance checks a frame. **Co-op:** each screen.

### F2. Fire spreads from where it touched, and eats the skin (size: medium)

- **You will see:** fire catches where the flame hit and walks across the body. Behind the glowing edge the skin reddens,
  splits and blackens. Where it burns longest the skin is gone and the muscle and ribs show, charred.
- **How:** give the burn an origin (one texel: a point in the body's rest pose) and let the edge the shader already draws
  (`characters/material.ts:200-210`) move outward from it. Past full char, let the burn remove skin by the same noise the
  Lance's vaporize uses (`:190-199`), and let the interior show there (`characters/anatomy/interior.ts`), tinted black.
- **Risk:** medium. An opened body costs one or two more draws; keep it to bodies at full detail.
- **Cost:** one texel and a few shader lines; the interior draw on the burnt few. **Co-op:** each screen; the origin comes
  from the hit that lit him, or the chest for a spread.

### F3. Fire meets the other systems (size: small each)

- **Posture:** a burnt corpse draws its arms and legs up as it chars, by raising the pull toward a flexed rest pose the
  muscles already have (`gore/muscles.ts`, the gut curl in `reflex.ts`).
- **Gibs:** pieces of a charred body are dark, by tinting the instances.
- **Morale:** watching a comrade burn costs the squad nerve. `outpost/morale.ts` has no entry for it today. This changes how
  soldiers fight, so it is your call (question 5).
- **Zombies:** a burning Husk keeps coming at you instead of running in circles like a man (`behaviours.ts:351`). Also
  yours (question 5).

---

## 6. Batch 3

### P2. Blood that never has to go (size: large)

- **You will see:** every drop spilled in a match is still on the floor at the end. Fresh blood is sharp and wet as now; old
  blood is dark and dry and stays.
- **How:** Killing Floor 2's method, which fits us better than it fit them. Their blood is written into textures laid over
  the map, not kept as separate decals, and their map guide says flat projections work best. Our floors are flat: world X
  and Z are the coordinates and nothing needs unwrapping. Keep one blood texture per floor level (the arena at 4 cm a pixel
  is 2048 x 2048: about 4 MB a level in one channel). When a decal is about to be overwritten, draw it once into that
  texture. The floor's shader reads the texture and shades it like dried blood. The decal ring then only ever holds the
  fresh ones.
- **Walls** stay on decals at first: after P1 they have the ring nearly to themselves.
- **Risk:** medium to high: it patches the world's floor material, and upper floors, stairs and ramps need a rule.
- **Cost:** 4 to 16 MB of texture by quality; one more texture read on floors; about one small draw into the texture per
  retired decal.
- **Co-op:** each screen keeps its own.

### P3. A hundred and fifty corpses (size: large)

- **You will see:** the dead of a whole match still there, in heaps where the fighting was.
- **How, in tiers:**

  | Tier | Which bodies | What it is | Rough cost each |
  |---|---|---|---|
  | 0 | the newest 12 to 16, near | as today: skinned, wounds, interior | about 7 draws |
  | 1 | settled, further or older | the same body with no shadow of its own (a soft dark patch under it), interior only up close | 2 to 3 draws |
  | 2 | old or far | pose baked into a plain low-detail mesh, all of them in one batched draw; the character instance goes back to the pool | a share of one draw |

  A tier 2 body remembers its pose, wounds and missing limbs (a few hundred numbers), so a rocket landing on a heap can turn
  the nearest few back into ragdolls, a few a frame. The colliders from P1 make the heaps real.
- **Risk:** high: the swap in and out must not pop, and the batched mesh needs one shared material.
- **Cost:** `bakePose` is 1.3 to 2 ms today (one body every few frames). 150 bodies at about 1,500 triangles is 225,000
  triangles in one draw, against 2.5 million and 400 draws for 40 bodies now. M0 sets the real caps.
- **A setting:** "Mess": Low (24 corpses, small rings, no floor texture), Standard (60, P1), Everything (150 or more, P2).
- **Co-op:** each screen keeps its own.

### W1. Wear you can see (size: large). The part of FLESH we can have.

- **You will see:** an arm that has taken half its damage looks it: skin torn through to red muscle. Near the end, bone
  shows. Then it comes off, where it was worn through. Fire, blades and blasts wear it in their own way.
- **How:** each of the 11 body regions already has a health pool that ends in a sever. Write those 11 numbers into three
  spare texels of the body's data texture; in the skin shader, wear the skin away inside a region by a noise threshold as
  its pool is spent, and let the interior show there. No new models: the interior exists, and the shader already knows each
  pixel's region.
- **Risk:** medium. It makes limb damage readable, which may change how players aim (they will finish limbs). The spare
  texels are nearly used up (10 left).
- **Cost:** three texels; the interior draw for worn bodies at full detail.
- **Co-op:** each screen wears its own copy from its own count of the pools, which it already keeps.

---

## 7. The whole plan, ordered by feel gained per unit of work

| Rank | Step | Size | Answers | Batch |
|---|---|---|---|---|
| 1 | G1 Rockets crack the trunk | small | 2, 4, 6 | 1 |
| 2 | R1 Every hit shows | small to medium | 1, 6 | 1 |
| 3 | F1 Fire that finishes the job | small to medium | 5 | 1 |
| 4 | R2 Hand to the wound, hurt posture | small | 1 | 1 |
| 5 | G2 Show the break | small to medium | 2 | 1 |
| 6 | P1 The mess stays, quick version | medium | 7, 4 | 1 |
| 7 | M0 Measure | small | all | 1 |
| 8 | R3 The struck part goes physical | large | 1 (the gradient) | 2 |
| 9 | B1 More blood from one hit | small | 4 | 2 |
| 10 | O1 Organs you notice | medium | 4 | 2 |
| 11 | R4 Dying carries the shots | small | 1 | 2 |
| 12 | B2 Footprints | small to medium | 4 | 2 |
| 13 | F2 Fire spreads and eats skin | medium | 5, 3 | 2 |
| 14 | B4 Drips, splashes, soaked bodies | small | 4 | 2 |
| 15 | F3 Fire meets the other systems | small each | 5 | 2 |
| 16 | B3 Blood on weapon and hands | medium | 4 | 2 |
| 17 | P2 Blood that never has to go | large | 7 | 3 |
| 18 | W1 Wear you can see | large | 3, 6 | 3 |
| 19 | P3 A hundred and fifty corpses | large | 7 | 3 |
| - | R3b A hit spoils his aim | small | 1 | when you decide |

R3 is the one that makes the "switch" a gradient. It ranks eighth only because it is large and risky; R1 and R2 are the
cheap two-thirds of the same improvement and should be judged first, since they tell us how loose R3 needs to be.

---

## 8. What I think

Asked plainly what would take this to the next level, as the model that read the code and looked at it:

**The system is not short of simulation. It is short of being seen.** Nearly every hole is something built and then hidden:

- **By a threshold.** The cracked torso (420 against 84). The powered ragdoll (a stagger most enemies do not live to reach).
  The char (3.5 s, against a 0.27 s kill).
- **By time.** A Trooper dies in 0.15 s. The gib is over in half a second at double gravity. Flames stop at death. Meat
  leaves in 14 s.
- **By the camera.** The flinch leans away from the gun. Pieces lie flat. The fireball covers the break.
- **By scale and colour.** Organs of 6 to 10 cm. Dark pieces on a dark floor. An arm at 5% health that looks whole.
- **By caps.** Four deaths on their feet. 2,048 decals. 40 bodies that cannot touch.

That is good news: it is why this can be an update. The most expensive things (muscles, an interior under every body, a cut
torso kit, placed blood) are done and work. I measured the Brute being rocked 12° to 28° by every round once on its muscles,
and the shotgun kill and the ten-kill floor look like a finished game. The work is to pull those moments forward to the first
hit and keep them on screen afterwards.

**The single most valuable change is G1**: one rule, and every rocket in the game starts showing the ribcage. **The one that
answers the owner's main complaint is R1 then R3.** **The one that would most change how a long session looks is P1 then
P2.**

Two cautions. First, the flinch was tuned down once already because it wobbled; R1 must change its shape, not just turn it
back up. Second, R3 is the hand-over the owner is most sensitive to. It should not ship until the frame-by-frame probe shows
no jump and he has played it behind a switch.

**Sound** I could not judge. Each of these needs its sound to land: a wet thud per hit by weapon, a squelch underfoot, a
crackle and a hiss from a smouldering body, the clatter of a ribcage. The catalogue should be checked against this list when
each step is built.

---

## 9. Is "state of the art" reachable here?

Honestly, in three parts.

**Reachable, and it would put this ahead of anything in a browser:**

- Every hit answered physically on the nearest enemies, blended by weight (R1 to R4).
- A torso that comes apart in pieces of its own volume, with ribs and organs, that you watch happen (G1, G2).
- A whole-match mess: all the blood, heaps of bodies, at a steady cost (P1 to P3). This is Killing Floor 2's headline
  feature, and its method suits our flat floors.
- Fire that consumes a body and leaves a different corpse (F1 to F3).
- Damage you can read on the body before the limb comes off (W1).

**Already at or past the big games:** wounds you can see into with a modelled interior, powered-ragdoll deaths with no pop,
blast outcomes that vary across a crowd. Few shipped games do all three.

**Not reachable in this stack, and I would not try:**

- Dead Island 2's free cutting of a living body at any point, and insides destroyed piece by piece. That needs models built
  for it from the ground up, as the owner guessed.
- Real fluid blood. It needed a high-end desktop card even in Killing Floor 2.
- Euphoria's balance intelligence: grabbing railings, catching a fall on a car bonnet. Ours follows the animation's own
  steps, which is enough on flat ground.

So: not Dead Island 2. But Red Dead's acknowledgement of every shot, Fallout's readable gibs and Killing Floor 2's
persistence, together, on bodies that already open up further than any of theirs. Nothing else in a browser is close to
that.

---

## 10. Questions only the owner can answer

1. **How big is too big for a flinch?** R1 aims for 20° to 40° on a struck limb and a clear twist on the trunk. Do you want
   it that strong on every round, or only on the heavier guns?
2. **Should a hit spoil an enemy's aim (R3b)?** It reads right and it makes the game easier. In co-op the host would decide it.
3. **Should the mess stay all match by default,** or clear at a wave break, or be a setting? (This was question 4 in the
   earlier proposals and is still open.)
4. **Should the player ever be slowed or lifted by a heap of bodies,** or always pass through as now? (The plan keeps
   passing through; only bodies rest on bodies.)
5. **Fire:** should watching a man burn break the squad's nerve? Should a burning zombie keep attacking instead of
   panicking? Should fire eat the skin to the muscle and bone, or stop at char?
6. **Gib hang time:** is slower, floatier gore right for a game this fast? It is only for the pieces, for about a second.
7. **Organs underfoot:** bursting them by stepping on them is funny or it is too much. Which?
8. **Wear you can see (W1):** do you want players to read limb damage and finish limbs on purpose? It will change how people
   shoot.
9. **The fireball:** may it be thinner or shorter so the body is seen coming apart? It is part of how explosions look now.

---

## 10a. The owner's answers (2026-11-18)

These are decisions. Where they differ from a step above, the answer wins.

1. **Flinch strength:** yes, a strong flinch on the struck limb for **every round**, not only heavy guns (R1 as written, at the top of its range).
2. **A hit spoils his aim:** **yes** (R3b is on). The host decides it in co-op.
3. **Bodies and blood staying:** a **setting** (stay all match / clear at wave break), not one fixed behaviour.
4. **Heaps of bodies:** walking through corpses should **push them aside as ragdolls**. Bodies neither block nor lift the player,
   and they are not walked through untouched either. This changes P1 and P3: a resting body must be able to wake when the player
   (or an enemy) pushes into it.
5. **Fire:** burning **chips away at morale faster** for those who watch it; **zombies are not unnerved by fire and keep
   attacking** while burning; fire **eats skin down to muscle and bone** (F2 goes all the way, not just char).
6. **Slower, floatier gib pieces for about a second:** undecided. Build it switchable and show a contact sheet and a clip of both
   before choosing.
7. **Organs that burst when stepped on:** **yes**, and use the burst as the way organs leave the world (an excuse to despawn them).
8. **Limbs:** keep them targetable **as they are now, to change what an enemy can do**: legs shot off means he crawls, an arm
   blown off means the sidearm or fleeing or surrender. Never weaken that. ("Readable" in the question meant visible wear on a
   limb before it comes off, W1; that is optional polish on top and must not change the rules.)
9. **Fireballs: keep them exactly as they are, they are perfect.** G2 must show the break **without** thinning or shortening the
   fireball: throw the pieces out past it, hang them, brighten the torn faces, add mid-size pieces.

Additions from the owner, same day:

- **8, readable limb damage: yes.** Damage to a limb should show that it is about to break or come off (W1 is wanted, not
  optional). It still must not change what shooting a limb does.
- **9, how you see the gib:** the fireballs look good now; the gibs should be **thrown with force out of them**. That is how the
  player gets to experience the gibbing. So G2's main lever is launch speed and direction out of the blast, not hang time.
- **Intestines must come free.** Today intestines are always attached to a bigger piece. Guts may still spill from a living or
  dying man, but on an **obliteration** (and in explosions) the guts **detach from the body**: thrown clear by the blast as
  their own pieces, and **draped over the environment** where they land (over ledges, railings, props, corpses). Find where the
  rope is anchored in `src/gore/` and add a free, unanchored rope (or one anchored only where it snags) to the trunk-crack and
  obliterate paths. This belongs with O1 (organs you notice) and G1/G2.

Status: not started. It is queued behind the co-op overhaul (the co-op gore lane is editing the same files); the owner says when.

## 11. Considered and rejected

| Idea | Why not |
|---|---|
| Make enemies tougher so reactions have time to play | It is the direct fix for "dead in 0.15 s", and it is balance. The player is meant to be overpowered. The plan spends the reaction on the first frame and in the death instead. |
| Canned hit-reaction clips by region and direction, as most shooters ship | We have no clip library and no animator; procedural is this game's strength. |
| Whole body on the powered ragdoll for every enemy at all times | Forty-eight full ragdolls with drives is far past the budget, and feet slide when the hips are free. Layer 1 keeps the hips animated on purpose. |
| A learned balance controller | Days of training and a network per character. Wrong class of cost for a browser. |
| A soft-body solver for organs | Needs a deforming mesh per organ, which breaks one-draw instancing. Squash in the shader reads the same at 5 m. |
| Real fluid blood, or screen-space fluid | No WebGL2 path worth its cost. |
| Projected or screen-space decals that wrap corners | Our flat quads are cheaper and already look right; the weakness is how many we keep, not how they are drawn. |
| Blood textures on walls as well as floors, now | Walls need a layout per wall. Floors give most of the look. Revisit after P2. |
| Free cutting of living, skinned bodies | The hardest mesh work in the system; the earlier proposals' B2. Not an update. |
| A second baked fat layer under the skin | Cheap at bake time, but the inner flesh body already reads as that layer. Only if W1 looks thin. |
| Hit-stop on every hit | Stutter in a fast shooter, and in co-op it does nothing. The earlier proposals' Q4 (severs, cuts and gibs only) still stands as a taste call. |
| An acid or melting damage type, because Dead Island 2 has one | The game has no acid weapon. It would be a weapon proposal, not a gore one. |
| Clearing corpses and blood on a timer to save cost | The opposite of what was asked. Tiers (P3) get the cost down without it. |

---

## 12. What was not checked

- **Nothing was timed.** The machine ran at about twice its load throughout. Draw calls, triangles, rigid bodies and decals
  are exact counts from single frames on the Test Range at 1280x720. Every cost above that is not one of those counts is an
  estimate or comes from `docs/notes/gore.md`.
- **Nothing was played, heard, or watched at full speed.** All looking was frame sequences on the bright test floor. Colours
  in a real map, especially the burnt body's brown and the dark pieces, need the owner's eye.
- **The flamethrower test** drove the damage model directly (fire bites of 9 at 30 a second). It did not fire the weapon, so
  the "clean corpse" result is certain for the char amount and less certain for local scorch marks.
- **Co-op** was read in the code and notes at `808949f`, not run. Layers 0 and 1 need nothing new on the wire because a
  guest already runs the same `react` for its own hits (`predict`) and for hits the host decided (`show`), from the round
  the `hitfx` event carries (`src/net/world/hits.ts`, `docs/notes/coop.md`, "Gore on every screen"). That was read, not
  proved in a two-page run.
- **The Crucible and the campaign in play.** Health scales by wave in the Crucible and campaign soldiers have their own
  wound rules, so "dead in 0.15 s" is the base case, not every case.
- **Web sources:** there is no technical talk on Dead Island 2's system or on Killing Floor 2's blood textures; both are
  described from interviews and a map-maker's guide. Fallout's gibs are described from the games, without a source.
