# Damage response: the holes in our system, and how the best games do it

> Research only, 2026-11-18, against `coop-overhaul` at `808949f`. No game code was changed. The plan built from this is
> [docs/proposals/damage-response-update.md](../proposals/damage-response-update.md): that is the one to read first.
>
> This builds on three earlier documents and does not repeat them: [gore-audit.md](gore-audit.md) (what exists, caps, costs),
> [gore-techniques.md](gore-techniques.md) and [ragdoll-techniques.md](ragdoll-techniques.md) (a wide survey of other games).
> The long reference for the system as built is [docs/notes/gore.md](../notes/gore.md).

The owner's six complaints, and one addition, are the frame:

1. Hits are not all answered; animation and ragdoll feel like an on/off switch, where Red Dead is a gradient.
2. A destroyed torso "just kind of disappears"; Fallout's pieces are the size of what was destroyed.
3. Dead Island 2's FLESH system: what is it, and what of it can we do?
4. Blood is not plentiful or interactive enough; organs should be squishy.
5. Burning is "phoned in" and touches none of the other systems.
6. The system is complex but "punching under its weight class".
7. (Added) Killing Floor 2: can the mess stay, and bodies stack, without wrecking performance?

Part A is what our code does today and what I saw it do. Part B is how other games do each thing, with sources, and whether it
fits this game. Words used: a **flinch** is the animated lean after a hit; a **powered ragdoll** is a physical body whose joints
are driven toward an animation pose (ours is called "muscles" in the code).

---

## Part A. Our system today

### A0. How I looked

- **Code:** `src/enemies/damage.ts`, `reactions.ts`, `EnemyManager.ts`, `behaviours.ts`; `src/characters/animation/HumanoidAnimator.ts`;
  `src/gore/` (`index.ts`, `torso.ts`, `chunks.ts`, `organs.ts`, `blood.ts`, `rag.ts`, `sliced.ts`, `rope.ts`, `spurt.ts`);
  `src/characters/material.ts`; `src/render/Decals.ts`; `src/fx/`; `src/weapons/Flames.ts`, `Combat.ts`, `data.ts`.
- **Looking:** 26 frame sequences on the Test Range (`/?map=range`), stepped on world frames (60 a second) so a loaded machine
  cannot change them, at 1280x720. Hits went through the real damage model (`ctx.enemies.applyDamage`, `ctx.combat.explode`,
  `ctx.enemies.afflict`) with each weapon's real damage and force. Each run also recorded, per frame, how far the chest, head,
  struck limb and hips moved from where they were before the hit. The images were written to a git-ignored folder on the dev
  machine and are described here, not linked.
- **Not done:** I did not play it, hear it, or watch it in motion at full speed. Every "what I saw" below is from stills on a
  lit test floor, which is brighter than the game's maps. Timings were not taken: the machine ran at a load of 65 to 70 on 32
  cores. Draw calls and triangle counts are exact counts from one frame, not speeds.

### A1. The numbers that frame everything

Enemy health is low next to weapon damage, on purpose (the player is overpowered).

| Enemy | Health | SMG rounds (25) to kill | Time at the SMG's 0.075 s a round |
|---|---|---|---|
| Husk | 50 | 2 | 0.08 s |
| Trooper | 70 | 3 | 0.15 s |
| Gunner | 90 | 4 | 0.23 s |
| Brute | 260, plus plates | 11 or more | 0.8 s or more |

(`src/enemies/data.ts:132-180`, `src/weapons/data.ts:252-256`. The Crucible scales health by wave, `EnemyManager.ts:282`.)

**This is the first finding.** A Trooper under SMG fire is dead in 0.15 s. Our flinch peaks at 0.1 s. A reaction that needs
time to be read does not get that time while the enemy is alive, so most of what the player reads as "the response" has to
happen either at once, on the frame of the hit, or in the death. Red Dead's enemies live through several shots over seconds;
ours mostly do not. The fix is not to make enemies tougher. It is to make the first frame of every hit bigger and to make
the death carry the shots that caused it.

### A2. Complaint 1: what a hit that does not kill does today

One function answers every non-lethal hit: `DamageModel.react` (`src/enemies/damage.ts:1245`). What follows is the whole ladder.

**Step 1, always: the flinch.** `char.anim.flinch(bone, dir, size)` (`damage.ts:1256`, `:1326`). Size is
`0.2 + 2.2 x share of health`, at most 1.4 (`damage.ts:128-133`). It kicks four damped springs (spine, chest, head, pelvis)
and one per arm (`HumanoidAnimator.ts:449-471`). It is animation only: no physics. The body also flashes (`hitFlash`),
gets bloodier, gets a small push (`damage.ts:1271`), and a blood puff (added this week).

**Step 2: shock adds up and is rolled.** `chooseReaction` (`src/enemies/reactions.ts:139`) adds
`(force / mass + 1.1 x share of health) x a factor for where it landed` to `e.shock`, which fades at 1.3 a second
(`EnemyManager.ts:49`). An arm counts half, a forearm a third (`reactions.ts:64-66`). Then:

| Level | When (a Trooper) | What plays | Physics? |
|---|---|---|---|
| flinch | always | springs, 0.35 s | no |
| stagger | chance rises from shock 0.53, certain at 0.9 (`reactions.ts:184`) | quick steps for 0.45 to 1.05 s (`damage.ts:1366`) | only if strong, near and seen, below |
| stagger on its muscles | stagger strength 0.35 or more, within 20 m, in view, full detail, both legs, at most 6 at once (`damage.ts:59`, `:1383-1398`, `gore/index.ts:102`) | the whole body goes onto the powered ragdoll, follows the stagger, catches itself or falls | yes, all of it |
| fall | chance rises from shock 1.3 | stumble, then a knockdown and a get-up | yes |
| felled | any real round to the head it lives through (`reactions.ts:101`) | straight to the floor | yes |
| thrown | a blast | thrown, gets up | yes |

**Step 3: a cooldown.** After any stagger, nothing above a flinch can happen for 0.9 s (1.3 s undead, 1.6 s heavy)
(`reactions.ts:41-51`, `:171`). The comment says why: "otherwise an SMG holds a body in place for as long as the magazine
lasts".

**What dies on its feet.** A kill by a bullet of 30 N·s or less, on a standing body with both legs, goes to `gore.collapse`:
the body dies on its feet over 0.85 to 1.4 s on its muscles (`damage.ts:109-112`, `:1202-1224`). At most 4 at once
(`gore/index.ts:86`); the fifth is a plain ragdoll. This is the "active ragdoll" the owner sees arrive late.

#### What I measured (one round, frame by frame)

| Hit | Level | Chest leans | Struck limb moves | Back to rest | What changes on screen |
|---|---|---|---|---|---|
| SMG, Trooper chest | flinch | 10.4° at 0.10 s | | 0.37 s | pink flash, small puff, a few floor spots |
| Pistol (Rivet), Trooper chest | flinch | 11.1° | | 0.38 s | the same |
| SMG, Trooper upper arm | flinch | 3.4° | **arm 1.5°**, hand 5 cm | 0.28 s | puff and spray; the pose does not visibly change |
| SMG, Trooper thigh | flinch | 3.3° | thigh 2.8° | 0.28 s | the same |
| SMG, Gunner chest | flinch | 7.9° | | 0.35 s | |
| SMG, Brute chest (plate) | flinch | **2.8°**, head moves 3 cm | | 0.28 s | nothing I could see in 18 frames, from the side or the front |
| Judge, Brute chest (plate) | flinch | 4.9° | | 0.32 s | barely |
| 12-damage round, Trooper head | felled | goes to the floor in 0.4 s, lies | | gets up | a full knockdown |

Held fire:

- **SMG on a Trooper** (a round every 5 frames): round 1 flinch, round 2 stagger and onto its muscles, round 3 dead. The body
  was on its muscles for 5 frames (0.08 s) before it died. Everything before death took 10 frames.
- **SMG on a Brute:** the first three rounds were stopped by a plate, each a 1° to 6° nod. The fourth staggered it onto its
  muscles, and from then on **every round visibly rocked it**: the chest swung between 12° and 28° for over a second and the
  body was walked back 0.97 m. That is the reaction the owner wants. It exists. It only starts after the threshold.
- **Shotgun on a Brute at 2.6 m:** onto its muscles from the first shell, 22° of lean, stepped back 0.74 m, recovered standing
  at 1.2 s. Good.

#### Why it reads as a switch

1. **Below the stagger threshold nothing is physical, and above it everything is.** The flinch is springs on four spine
   bones. The next step up hands the whole body to the ragdoll. There is nothing between: no struck arm thrown back, no
   shoulder turned, no single step, no dropping to a knee.
2. **The flinch is small and gets smaller with size.** 10° on a Trooper, 3° on a Brute, 1.5° on a struck arm. It was made
   smaller on purpose in the weight pass (the comment at `damage.ts:122-128`: it was 0.26 rad and "rang past rest"), and
   damped to 0.8 of critical (`HumanoidAnimator.ts:40-48`). That fixed a wobble and cost the read.
3. **The flinch leans along the shot, which is along the player's line of sight.** `flinch` pitches the body away from the
   round (`HumanoidAnimator.ts:458`). From the shooter's seat a lean straight away is foreshortened to almost nothing. In my
   front-on sequences of an SMG burst the body looks upright until its arms fly out at death. What reads from the shooter's
   seat is sideways motion: a twist, a dropped shoulder, a sidestep, a knee giving, an arm flung out.
4. **An arm or leg hit moves the arm or leg hardly at all.** The arm spring gets a kick (`HumanoidAnimator.ts:469-470`) but
   the measured swing was 1.5°. Red Dead's most recognisable reaction is the struck limb going loose.
5. **The cooldown mutes sustained fire.** For 0.9 to 1.6 s after a stagger only flinches play, unless the body is still on its
   muscles.
6. **A flinch changes nothing the enemy does.** It only raises `pressure` (`damage.ts:1264`). A man hit in the gun arm keeps
   aiming. Only a stagger cancels an attack (`damage.ts:1608`).
7. **The clutch and the guard are skipped on a flinch.** `holdWound` (hand to the wound) and `guard` (arms up) run only for a
   stagger or more: the early return at `damage.ts:1330-1333` comes before them (`:1334-1337`). Euphoria's reach-for-wound
   plays 0.2 s after every shot.
8. **Gates.** The physical stagger needs the enemy within 20 m, in view, at full detail, at most 6 at once
   (`damage.ts:53`, `:1384`; `gore/index.ts:97-102`). Past those, it is the animated stagger.
9. **Time.** See A1. For the common enemies the whole pre-death ladder is over in a quarter of a second.

What is already right, and should be kept: the head knockdown, the stagger on muscles, the death on its feet, hits landing on
a dying or downed body (`gore.md`, "Taking rounds"), and the zero-pop handovers. The gradient the owner asks for is mostly a
matter of **reaching these earlier and for shorter times**, not building something new.

### A3. Complaint 2: where a destroyed torso goes

**The pieces exist and their volume is right.** A gib calls `breakTrunk` (`gore/index.ts:1580`), which throws pieces of a kit
cut once per archetype from the real trunk mesh (`gore/torso.ts`). I measured the Trooper's kit in the page:

| Break | Pieces (litres) | Total |
|---|---|---|
| Waist tear | chest 33.8, pelvis 14.7 | 48.5 |
| Crack, 3 | 26.8, 4.6, 14.7 | 46.1 |
| Crack, 5 | 12.5, 11.8, 1.9, 2.3, 14.7 | 43.2 |
| Crack, 6 | 12.5, 11.8, 1.9, 2.3, 2.2, 10.5 | 41.2 |

Loose meat is 3 to 10 cm lumps, most near 3 cm, about a tenth of a litre each, 6 to 13 of them (`gore/index.ts:1699-1709`).
Organs are 6 to 10 cm (`gore/index.ts:213`).

**So why does it read as disappearing? Five reasons, in the order I would fix them.**

1. **A rocket or a grenade never cracks a trunk.** The break is chosen by force: at or under 420 it is always a waist tear
   (`torso.ts:28`, `:79`). A blast's force is `0.875 x impulse x radius x falloff` (`Combat.ts:1158`, `weapons/data.ts:634`):
   a rocket (impulse 12, radius 8) gives at most **84**, a grenade 74. Only the nuke and the boss deaths (900, 2400) pass
   420. In my runs every rocket kill gave exactly two trunk pieces, two organs, one strand of gut and **no ribcage**. The
   crack, the six-piece ribcage and the four organs, the best part of the torso work, are in practice never seen. The test
   suite checks the rule (`torso.test.ts:43`) but not that any weapon reaches it.
2. **The fireball hides the break.** In the rocket sequence an opaque fireball about 3 m wide covers the body from frame 1 to
   frame 13 (0.2 s). When it thins, the pieces are already on the ground. The player sees a man, then fire, then small things
   on the floor. The one moment that would say "he came apart" is never drawn.
3. **Nothing hangs in the air.** Gravity is 19 m/s², twice real (`gore.md`, "Forces"). Trunk pieces are thrown at up to 7 m/s
   (`torso.ts:37`) and land in 0.3 to 0.5 s. Fallout's pieces tumble at eye height for about a second.
4. **Standing to lying.** A 1.85 m figure against a wall becomes pieces lying flat, seen at a shallow angle. At 8.5 m the
   remains covered roughly a tenth of the screen area the man did. The pieces are also dark (the suit's dark skin outside,
   torn faces that only "glow faintly") on a dark floor.
5. **They do go.** Meat shrinks away after 14 s, organs and ribs after 28 s (`chunks.ts:30`), loose gut after 30 s
   (`rope.ts:27`). Trunk pieces share a cap of 28 with sword halves (`sliced.ts:22`). Past three gibs in one frame a gib is
   the small version (`torso.ts:35`).

Also seen: the five limbs of a gibbed body (head, arms, legs) are real, full-size, skinned pieces and do stay
(`gore/index.ts:1479-1504`). The size gap is between them and the meat: nothing is the size of a forearm or a fist except the
four organs.

### A4. Complaint 4: blood

What blood does after it leaves a body today:

| Thing | Today | Limit |
|---|---|---|
| Puff on impact | one per round, one big and up to 3 small per shotgun blast (`gore/blood.ts:40-44`) | none in practice |
| Spray in the air | lit strands, a ring of 1200 (`fx/layers/blood.ts`) | 6 sprays a frame (`blood.ts:32`) |
| Stains where drops land | yes, placed where the drop arrives | 24 rays a frame, 96 queued (`blood.ts:16-18`) |
| Wall behind a kill | a cone of stains along the shot | the same budget |
| Runs down walls | yes, from a stain of 16 cm or more (`Decals.ts:26`) | |
| Pools | 3 stacked decals that grow, when a body comes to rest (`gore/index.ts:997-1003`) | 24 growing at once |
| Dripping wounds | 32 at once, 4 to 17 s each | 6 drops a frame |
| Smears | a dragged or shot corpse, a crawling man | |
| Arterial spurts | from stumps and burst heads, on a heartbeat | 8 at once |
| On the body | skin gets wetter, runs down from wounds | |
| On the player's lens | within 3 m | |
| Drying | darkens over 5 to 70 s (`Decals.ts:141`) | |
| **Footprints** | **none**, player or enemy | |
| **On the weapon or hands** | **none** | |
| **Flow to low ground, over edges, down stairs** | **none**; a pool is a round decal where the body lay | |
| **Drips from ceilings or ledges** | **none** | |
| **Splash when something lands in a pool** | **none** | |
| **A corpse lying in a pool getting bloodier** | **none** | |

**What I saw.** Blood itself reads well. A close shotgun kill gave a wide red puff in front, long streaks on the floor behind,
and a pool: it looks like a hit. Ten kills in one spot left a floor of saturated red splats, streaks and pools that looks
plentiful by any standard. A single SMG round, though, left a small puff and three to six coin-sized spots that arrive half a
second later. So "more blood" is mostly about **the single hit and the first second**, and "more interactive" is the six
missing rows above. One defect seen: where pools stack, the overlapping decals show horizontal stripes at their edge
(depth-fighting between stacked quads), at least at 1280x720.

**The persistence limit is the real cap on "plentiful".** All stains share one ring of 2048 with bullet holes and scorches
(`Decals.ts:6`). In my run the ring held 1,020 decals after 10 kills (two of them rockets), then about 57 more per SMG kill,
and was **full at the 28th kill**. From then on every new stain erases the oldest. See A7.

### A5. Complaint 4: organs

- **Which exist:** lung, liver, heart, stomach as loose pieces (`organs.ts`, `chunks.ts:20-24`); a ribcage in six fragments;
  gut as rope strands (`rope.ts`, 14 at once); a burst head's cranium, jaw, brain and eyes. Inside the body there is a
  modelled interior (ribs, spine, lungs, heart, liver, stomach, bowel) seen through wounds (`characters/anatomy/`).
- **When they appear:** only on a gib or a blow-out (`gore/index.ts:1617-1644`, `:1685-1688`). Never from an ordinary kill.
  And since rockets never crack a trunk (A3), a rocket throws two organs, not four, and no ribs.
- **Are they physical?** Each is a rigid body on a box while it moves, then a still instance. They collide with the world
  only: the player, enemies and bullets pass through them (`chunks.ts:1-5`). They wobble once when they land
  (`chunks.ts:450-472`): a sine squash for about 0.6 s. That is the only squish.
- **What I saw:** at 5 m they are pink-red blobs the size of a fist, readable as "organ" only close up; at 8.5 m they are
  dots. Thrown organs are not removed from the body's interior, so a blown-out chest still shows its lungs.

### A6. Complaint 5: burning

What fire does today:

1. `ignite` sets a timer, `e.burning` (`damage.ts:754`). Every 0.25 s it takes `3 + 3% of max health` and lights anyone
   within 2.4 m (`EnemyManager.ts:636-654`).
2. **The look:** one emitter on the chest throws a flame puff every 0.05 s and an ember every 0.11 s
   (`EnemyManager.ts:662`, `fx/emitters.ts:289-302`), plus one sizzle sound. The skin's `burn` amount rises by time alone,
   to full in 3.5 s (`EnemyManager.ts:44`, `:666`). The shader blackens the skin through a noise pattern over the whole body
   at once, with an ember edge and cracks (`characters/material.ts:188-211`).
3. **Behaviour:** anyone not fireproof with two legs runs in circles playing the stagger clip (`behaviours.ts:351-371`).
   Campaign soldiers throw themselves down after 1.5 to 3 s and roll, which puts it out (`wounds/index.ts:543-547`,
   `gore/reflex.ts:698`). The nearest burning bodies get a voice (`audio/reactions.ts:449`).
4. **At death the fire goes out on that frame:** `stopEffects` stops the emitter (`EnemyManager.ts:1211-1216`).

**What I saw.**

- **Lit and left to burn (3.4 s to death):** a column of flat flame puffs; the suit turns an even, speckled brown over the
  whole body at once; he dies, and the flames stop within a few frames. The corpse is a uniform brown figure with the same
  outline as before: no smoke, no embers, no glow, nothing exposed. He curled up as he died, which looked good, but that was
  the ordinary death on its feet, not fire.
- **Killed by the flamethrower's own damage (9 a bite, 30 a second):** the Trooper was dead in 0.27 s. The char had reached
  6%. **The corpse was clean white**, lying in a small red blood pool, and the flames were gone. A man killed with a
  flamethrower leaves an unburnt body. This is the plainest hole in the system. (Each bite also asks for a local burn patch,
  `gore/wounds.ts:297`; none showed in my capture, which may be my harness's hit point rather than the game.)

**What fire does not touch:**

| System | Today |
|---|---|
| Char amount | by seconds alive and burning, not by fire damage taken; never rises after death |
| Corpse | fire stops at death; no burning corpse, no smoke, no light, no scorch on the floor; gets a red blood pool like any body (`gore/index.ts:999-1002`) |
| Skin and anatomy | skin never burns away; the interior is never shown by fire (only the Lance's vaporize eats the skin, `material.ts:190-199`) |
| Where it starts | nowhere: the pattern is the same noise over the whole body, wherever the flame touched |
| Flames | one emitter on the chest, whatever is burning; a severed burning limb has none |
| Ragdoll and muscles | a downed burning man rolls (good); nothing else: no tightening, no curl from heat |
| Gibs | pieces of a charred body are ordinary red meat |
| Morale | none: `outpost/morale.ts` has no entry for a man burning; only perks and call-ins spike dread |
| Zombies | a burning Husk forgets the fight and runs in circles like a man |
| Heat shimmer | a shimmer layer exists (`fx/layers/shimmer.ts`); burning bodies do not use it |

### A7. The addition: what limits persistence today

| Thing | Cap | What happens at the cap | Where |
|---|---|---|---|
| Corpses | 40 | the oldest sinks 1.2 m into the floor over 2.2 s, in view or not | `gore/index.ts:107`, `:911-920`, `:125-126` |
| Simulating ragdolls | 14 (soft) | the oldest at rest freezes | `gore/index.ts:73` |
| Loose limbs | 48, 22 simulating | the oldest sinks | `gore/index.ts:109-110` |
| Meat, organs, ribs | 96 meat, 10 to 16 per organ, 12 per rib kind | **shrink away after 14 s (28 s for organs and ribs)** | `chunks.ts:20-31` |
| Trunk pieces and sword halves | 28, hard cap 44 | the oldest sinks after 8 s in sight | `sliced.ts:22-24` |
| Gut strands | 14 | loose ones go after 30 s | `rope.ts:15`, `:27` |
| Decals, all kinds together | 2048 | the oldest is overwritten; no priority, no ageing out | `render/Decals.ts:6`, `:355` |
| Character instances | 96 per archetype, shared by the living and the dead | | `characters/CharacterLibrary.ts:29` |

**What a body at rest costs** (counted, one frame, Test Range, bodies within 5 m so at full detail):

- **About 7 draw calls and 56,000 triangles per corpse.** The empty range drew 63 calls and 137,000 triangles. With 14
  corpses it was 220 calls; with 26, 304; with 40, about 408 calls and 2.5 million triangles. A corpse is still a full
  skinned character. I did not break the seven draws down; going by `docs/notes/characters.md` ("Draws") they are the skin,
  the interior and the backing of an opened body, whatever gear it carries, and the shadow pass over again.
- **No physics.** A frozen body has no rigid bodies at all: `Rag.freeze` removes them (`gore/rag.ts:927-933`). A simulating
  one has 11. The world held 54 bodies with 4 ragdolls and chunks moving and 0 when everything had settled.
- **Level of detail** steps at 26 m and 60 m (`gore/index.ts:168-169`), one body checked per frame.

**Bodies do not stack.** Because a frozen body has no collider, the next body falls through it. I killed 46 men on one spot.
Every corpse's hips rested between 0.11 and 0.18 m off the floor. The result is a flat carpet of bodies about 3.5 m across and
one body deep, lying through each other. Two rockets among the first ten kills threw the earlier corpses 3 to 6 m apart, so
they did not even stay together. (Simulating bodies do collide with each other, `rag.ts:975-978`; it is only the resting ones
that are ghosts.)

**Blood does not last a wave.** The decal ring was full at the 28th kill (A4). In a Crucible wave the blood from the start of
the wave is being erased before the wave ends.

### A8. Complaint 6: where it punches under its weight

Things that are simulated and not seen, or fire and are hidden:

| Built | Why the player does not get it |
|---|---|
| The powered ragdoll that takes rounds standing up | starts only past a threshold most enemies do not live to reach |
| The cracked trunk, the ribcage, four organs | unreachable with rockets and grenades: 84 against a threshold of 420 |
| The gib itself | 0.2 s behind an opaque fireball, then on the floor in 0.3 s at double gravity |
| The flinch | leans along the player's line of sight; 1.5° on a struck arm; 3° on a Brute |
| Hand to the wound, arms up | only after a stagger, not after a hit |
| Dying on its feet | 4 at once; the fifth in a burst drops plain |
| The char shader with ember edges and cracks | never reached by the flamethrower, which kills in a quarter second |
| A modelled interior under every body | seen only through bullet-sized holes, never by fire, never by wear |
| Organs that wobble | 6 to 10 cm, world-only, gone in 28 s |
| Limb health that leads to a sever | invisible until the limb comes off: the arm looks whole at 5% |
| Blood placed where each drop lands | erased after about 27 kills |
| 40 corpses | flat, walk-through, and they sink while you watch |

Not checked: sound. I could not listen. The catalogue has wound tiers, screams, rips, gib rain and splats
(`docs/proposals/gore-sounds.md`); whether fire, organs and footsteps in blood have what they need is in the plan as a question.

---

## Part B. How the best games do it

Each section ends with **Fit**: whether it suits three.js r187 on WebGL2, Rapier 0.21, procedural bodies, up to 48 enemies,
pooled, no allocation in hot paths, 60 fps on a laptop, and co-op where each screen draws its own cosmetics.

### B1. "Every shot gets a reaction": Euphoria as Rockstar uses it

No technical paper on Euphoria's balance controller is public. The best window is the message set GTA V exposes to scripts,
which modders have documented with defaults ([Shot](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_shot_helper.html),
[ShotSnap](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_shot_snap_helper.html),
[ShotFallToKnees](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_shot_fall_to_knees_helper.html),
[ShotFromBehind](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_shot_from_behind_helper.html),
[ConfigureBullets](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_configure_bullets_helper.html),
[StaggerFall](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_stagger_fall_helper.html),
[BodyBalance](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_body_balance_helper.html)).
`ragdoll-techniques.md` section 2.1 lists the parameters. What matters for the owner's complaint is the shape of it:

1. **The body is physical before it is hurt badly.** A shot puts the character on a powered ragdoll at once, with a
   **balancer** holding it on its feet. Being shot and standing are the same state. There is no threshold to cross first.
2. **Looseness, then recovery.** Each bullet drops joint stiffness (`LoosenessAmount`, arms and legs to a floor of 0.1) and
   ramps it back over 0.4 s (`InitialWeaknessRampDuration`). The struck part swings because it is briefly limp, and the
   animation gets the body back because stiffness returns. This ramp is the gradient.
3. **A snap on top.** `ShotSnap`: "the character snaps in a prescribed way (decided by bullet direction)", optionally "only
   around the wounded part", with separate sizes for a body that is moving, balancing or in the air, done "with torques or
   with a change in the parts' angular velocity". That is an authored jolt, not left to the impulse alone.
4. **The impulse is shaped.** Spread over 0.1 s, half of it countered at the hips so the part moves and the body does not
   slide, weaker with each repeat (`ImpulseReductionPerShot`), capped in the air.
5. **Reach for the wound** 0.2 s after the shot, held for 2 s.
6. **Behaviours by where and how:** shot in the guts, from behind (the back arches), fall to knees (the balancer runs for a
   set time, then the legs bend at a set rate), stagger then fall (stiffness 13 falling to 8, 30% lost per step after two
   free steps).
7. **Tuned, not found.** Rockstar's art director on Max Payne 3: "Euphoria is basically a set of behaviours that you can
   tune", and enemies "respond uniquely to weapon hits depending on each weapon's force, angle of hit, animation pose, and
   environment" ([MCV](https://mcvuk.com/development-news/max-payne-3-dev-explains-euphoria-engine-tweaks/),
   [TechRadar](https://www.techradar.com/news/gaming/the-technology-of-max-payne-3-1082751)). RDR2 used it "to enhance the
   physics-based reactions of both humans and animals" ([Wccftech](https://wccftech.com/rockstar-euphoria-evolved-rdr2/)).

**Fit.** The balance controller is out of reach and we do not need it: `gore/stand.ts` already holds a body on its feet by
following the animation's own catch steps. Points 2, 3, 4 and 5 are tuning and a small amount of code on the muscle layer we
have. The missing piece is point 1: getting a body, or part of one, onto physics from the first hit.

### B2. The same result without Euphoria

| Technique | What it contributes | Source | Fit |
|---|---|---|---|
| Additive flinch on springs | the cheap layer every enemy gets; start at 6 to 10 Hz, damping 0.4 to 0.7, peak 10° to 25° | `ragdoll-techniques.md` 3.2a | have it; ours peaks at 3° to 10° and is damped 0.8 |
| Partial ragdoll by blend weight | the struck limb alone simulates: weight "quickly up to 1.0 and back to 0.0" | [Epic](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-driven-animation-in-unreal-engine) | yes, nearest enemies; **the missing middle step** |
| Kinematic root for a partial ragdoll | the parent follows the animation, the limb is free; robust | [Catto, Diablo 3](https://box2d.org/files/ErinCatto_Ragdolls_GDC2012.pdf) | yes; our `Rag` already builds any bone chain |
| Motors, velocities or constraints to follow an animation | three ways to make physics track a pose; Respawn shipped motors and drops to a free ragdoll when the hip cannot reach its target | [Jedi: Fallen Order](https://gamedeveloper.com/programming/leveraging-physical-animation-to-sell-force-powers-in-i-jedi-fallen-order-i-) | have it (muscles); the bail-out rule is worth copying |
| Strength + damping ratio per joint | a way to state drive strength that does not depend on mass | [Epic Physics Control](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/PhysicsControl/FPhysicsControlData) | have the equivalent |
| "Only active on contact, kinematic otherwise" | the state machine: animation by default, physics on a hit, blend back when settled | [Wobbledoll](https://80.lv/articles/wobbledoll-developing-an-advanced-full-body-ragdoll-system/) | yes; the plan's shape |
| Hit zones and reaction states matter as much as physics | "weapon feel is almost entirely hit reactions"; a leg shot is an instant stun that sets up the next shot; the thigh is split in two to favour the player | [Mattson, GDC 2024](https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/Mattson_Derek_ASecondShot_Notes.pdf) | yes; a design choice, see the plan's questions |
| Canned hit clips chosen by region and direction | what most shooters ship | [Game Developer](https://www.gamedeveloper.com/programming/the-role-of-animations-in-hit-effects) | no: we have no clip library and procedural is our strength |
| Machine-learned balance | full-body balancing learned offline | Wobbledoll, above | no |

Not found: a public talk on Hitman's, Half-Life: Alyx's or Trepang2's hit reactions. I searched and came back with nothing
usable, so they are not cited.

### B3. Dead Island 2's FLESH

There is no conference talk. What exists is interviews and a developer Q&A
([Game Informer](https://gameinformer.com/exclusive-interview/2023/01/30/how-dead-island-2s-flesh-system-procedurally-breaks-skin-and-bones),
[Kotaku on the Q&A](https://kotaku.com/ama-reddit-dead-island-2-weapons-flesh-system-ps5-xbox-1850415887),
[Kotaku](https://kotaku.com/dead-island-2-release-date-flesh-system-combat-ps5-pc-1850229441),
[The Loadout](https://www.theloadout.com/dead-island-2/realistic-zombies-gore-system),
[80.lv](https://80.lv/articles/dead-island-2-explained-gameplay-combat-mechanics),
[DualShockers](https://www.dualshockers.com/dead-island-2-developers-talk-flesh-system/)).

**What it is.**

- **Layers.** Every zombie shares one set-up, so damage anywhere goes "through the layers of skin, fat, muscle, and then break
  through to bones and the internal organs". The developers call the result "meat piñatas".
- **Two kinds of mesh.** "Zombies are built out of a surface mesh and a set of 'viscera' meshes. The viscera meshes are
  individual pieces that can be destroyed, or broken." The skin has real thickness. An early version had a solid core that
  could not be damaged; they changed it so a hole can go straight through, filled with destructible guts. The viscera is one
  shared asset, scaled per zombie type, with a few variations: the insides were made first.
- **Cutting.** "We dynamically split the mesh across a cutting plane, testing each triangle", then close the hole. Bones are
  "split into fixed pieces" while the skin is cut freely. Rules: a cut is always complete (no nearly-severed head), and some
  attachment to the spine always remains.
- **Progressive.** "Where the FLESH system really takes it forward is how it has this progressive effect": damage builds per
  place, by weapon, so the body is a readout of what was done to it.
- **Damage types.** Besides physical: shock, fire, caustic, bleed, tear, impact. "Fire takes a pure damage approach, shock
  will stun zombies in place, and caustic is more about damage over time." Players and reviewers describe flesh that chars
  under fire and melts off under caustic ([GameRant](https://gamerant.com/dead-island-2-all-status-effects-guide/),
  [a review](https://duuro.net/blog/dead-island-2-review)). I found no developer account of how the melt or char is drawn.
- **Budget.** Draw calls are split only when the viscera breaks apart. A freezing effect was cut because "we quickly maxed-out
  the number of textures we could look up in a single zombie material".
- **Why zombies only:** "so we could go super extreme with the gore without it getting too disturbing".

**What of it is cheap for us, because our bodies are procedural.**

| FLESH idea | For us | Why |
|---|---|---|
| Insides made first, shared, scaled per type | **have it** | the interior is built per archetype at load from the baked mesh (`anatomy/build.ts`), about 9,000 triangles, shared |
| Holes that show what is under | **have it** | wound slots cut the skin in the shader and reveal the interior by depth |
| **Progressive stripping by place** | **cheap, and the main thing to take** | we already keep a health pool per limb region and the shader already knows each pixel's region. One number per region (11 of them, three texels) can wear the skin away by a noise threshold inside that region and show the interior, the way the vaporize effect already eats skin. An arm at 20% would look it. |
| A second layer under the skin (fat, muscle) | cheap at bake time | bodies are baked from distance fields: a second shell a centimetre or two inside the skin is the same field at a different level. Not needed for a first version: the inner flesh body already stands in for it. |
| Different marks per damage type | partly have | hole, exit, crater, gash, burn, graze, dent exist. Missing: shock marks, and fire that does more than paint |
| Burning and melting as layer loss | cheap | the same wear number, driven by fire; see B6 |
| Bones in fixed pieces, breaks and bent limbs | have part | fractures with bone ends exist (`anatomy/fracture.ts`); bones do not come out as pieces |
| Free cutting of a living, skinned body anywhere | **out of reach** for an update | keeping skin weights through a cut is the hardest mesh work in the system (`gore-ragdoll-proposals.md`, B2) |
| Viscera pieces destroyed one by one inside the body | out of reach | needs the interior split into separately drawn, separately damaged parts per body |
| Jaws and eyes as living damage states | partly | partial heads exist for four archetypes; the rest burst |

**FLESH-lite, honestly:** keep our wounds and interior as they are, and add **wear you can see**: each region's skin thins,
tears and opens on the muscle and bone as its pool is spent, by bullets, blades, fire or blast, until it severs. That is the
"progressive effect" at the cost of three texels and a few shader lines, with no new models. It is not FLESH: nothing is cut
freely and the insides are not destroyed piece by piece.

### B4. Gibs that read as the body that was destroyed

- **Killing Floor 2 (M.E.A.T.):** 22 dismemberment points per enemy, up from 5, to give "substantially more variety"; dead
  bodies can still be taken apart ([Wikipedia](https://en.wikipedia.org/wiki/Killing_Floor_2),
  [GamesBeat](https://gamesbeat.com/developers-killing-floor-2-will-have-the-most-dynamic-video-game-gore-system-in-history-will-hit-early-access-with-gallery/)).
  The read comes from many joints letting go, each piece a recognisable part of that enemy.
- **Left 4 Dead 2:** wound pieces are separate small meshes revealed by cutting the body in the shader with an ellipsoid,
  limited to two wounds per body, 15 vertex and 7 pixel instructions
  ([Vlachos, GDC 2010](https://cdn.fastly.steamstatic.com/apps/valve/2010/gdc2010_vlachos_l4d2wounds.pdf)). We already do
  more than this.
- **Soldier of Fortune (GHOUL), Dead Space, Doom:** covered in `gore-techniques.md`. The common rule: pieces are parts of the
  victim's own model, with the inside drawn on every broken face.
- **Fallout 3, 4, New Vegas:** I could not find engine documentation, only modders' notes that the pieces are pre-made meshes
  per body part. What can be said from the games: the pieces are few and large (a whole limb, a torso section), keep the
  victim's own skin and clothes, are thrown slowly and upward, and the kill is often shown in slow motion, so they are in the
  air at eye height for a second.

**What makes pieces read, as a rule:** (1) they wear the victim's own surface; (2) there are big, medium and small ones, not
big and tiny; (3) the first third of a second is visible; (4) they spend time in the air; (5) they stay.

**Fit.** We already satisfy (1) and the big sizes: our trunk kit is cut from the real mesh and keeps 85% to 100% of its
volume (A3). We fail (3) and (4), partly (2), and (5). All four are tuning and small code, not new systems.

### B5. Blood that is plentiful and interactive

| Technique | Who | Fit |
|---|---|---|
| Blood kept in textures laid over the map instead of as separate decals | Killing Floor 2, see B7 | yes for floors; the route to "it never goes" |
| Decals drawn inside the world's own shader from a bounded list per area | Doom 2016 ([graphics study](https://www.adriancourreges.com/blog/2016/09/09/doom-2016-graphics-study)) | possible, a big change to the world shader; not needed |
| Screen-space decals that wrap over corners | Space Marine ([Kim](https://www.slideshare.net/blindrenderer/screen-space-decals-in-warhammer-40000-space-marine-14699854)) | possible; costs a depth read per decal pixel; our flat quads are cheaper and already look right |
| Real fluid particles | Killing Floor 2's FleX, on high-end NVIDIA cards only ([Tom's Hardware](https://www.tomshardware.com/news/nvidia-gameworks-flex-killing-floor,29392.html)) | no |
| Droplets flown in the shader, a ray for the lead drop only | common practice | have it (strands plus the stain queue) |
| Pools that grow | common | have it; ours do not flow or find low ground |
| Footprints from a wet state on the walker | common (a timer after stepping in blood, a decal per step) | yes, cheap: decals we already draw |
| Blood on the weapon and hands, drying | many melee games | yes; one wet value on the viewmodel's material |
| Heartbeat spurts | several | have it for stumps; not for wounds on the living |
| Drips from ceilings and ledges | several | yes; our dripping-wound emitter pinned to a world point |
| Red left in colour while the rest drains | Killing Floor 2's Zed Time ([Wikipedia](https://en.wikipedia.org/wiki/Killing_Floor_2)) | have the grade (`render/post/grades.ts`); a taste question already on file |

I searched for technical accounts of blood in The Last of Us Part II and Red Dead Redemption 2 and found only players'
observations (blood dries on clothes and washes off; a burnt arm on a Molotov victim,
[GameRant](https://gamerant.com/the-last-of-us-2-molotov-burn-detail/)). Nothing citable on how.

**Fit.** In a WebGL2 budget the answer is the one we already chose: particles in the air, decals where they land, and now a
texture for what must stay. No fluids.

### B6. Burning

- **Dead Island 2:** fire is one of the layer-stripping damage types; the body chars (B3).
- **Far Cry 2:** fire spreads as a front across a surface from where it started, cell by cell, and stops where it has already
  burnt ([interview with its programmer](https://gamedeveloper.com/game-platforms/interview-how-i-far-cry-2-i-s-fire-fuels-spreads)).
  On a body the same idea is a burn front that walks out from the point the flame touched.
- **The common recipe** (`gore-techniques.md` B12): a burn amount per body; albedo to black, roughness up; a thin glowing band
  where a noise pattern meets the threshold; embers and smoke; past a level the threshold also removes the top layer.

**What fire should do, taken together:** start where it touched and spread; redden, then split, then blacken; eat the skin
where it burns longest and show what is under; keep burning on the corpse, then smoulder; leave soot, not a pool; draw the
limbs up as a burnt body does; frighten the men who watch.

**Fit.** All of it is the shader and systems we have. We already have the char pattern with ember edge and cracks, a path
that eats the skin (the Lance's), an interior to show, a rest pose the muscles pull toward, and a morale table.

### B7. Organs and soft bodies

- **Position-based soft bodies** (Müller's method: a cloud of points held by distance and volume constraints) run in real
  time in the browser, but the published three.js versions lean on WebGPU compute
  ([Tetrament](https://github.com/zalo/Tetrament), which builds on the "Ten Minute Physics" material). On the CPU a 20-point
  blob is cheap; drawing it needs a mesh that deforms per organ, which breaks our one-draw-per-kind instancing.
- **Rapier has no soft bodies.** Springs between small rigid bodies can fake one (three or four balls per organ) at the cost
  of bodies we would rather spend on ragdolls.
- **Squash in the shader** is what reads at FPS distance: flatten along the surface normal on landing, bulge sideways, wobble
  on a spring, sag when at rest. We do the first once on landing.
- **Intestines as ropes:** we have them.

**What reads at 5 to 10 m:** size, wet shine, colour against the floor, and that it reacts when touched. Not true
deformation. **Fit:** bigger, shinier, shader squash, and make them hittable; no soft-body solver.

### B8. A mess that stays (the Killing Floor 2 question)

**How Killing Floor 2 keeps blood all match.** "Bloodstains are a permanent fixture on maps... Instead of the blood being
rendered as a texture that is projected onto objects in the world, they created a system which, in real-time, modifies
splatter map textures covering the map to display blood with little rendering overhead"
([Wikipedia](https://en.wikipedia.org/wiki/Killing_Floor_2), citing PC Gamer and Tripwire's developer diary). Tripwire's own
map-making guide says how it is laid out: every level mesh carries three sets of texture coordinates, the third "used for
splatter maps (persistent blood)", usually a copy of the lightmap set, and "planar UVs are what you're looking for in a good
splatter map", or the blood shows seams
([KF2 wiki](https://wiki.killingfloor2.com/index.php?title=Setting_Up_UV%27s_and_Mesh_Merging_%28Killing_Floor_2%29)).
Early coverage described the level as having a pre-bloodied layer that the blood "peels back" to
(`gore-techniques.md`). Config names players found include a cap on persistent splats per frame
([Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=440503910)). A forum guess that it thresholds a
low-resolution value to get a crisp edge is only a guess ([Tripwire forum](https://forums.tripwireinteractive.com/index.php?threads/killing-floor-blood-tech.106288/)).
I found no engineer's write-up.

**Why it is cheap:** a splat is written once into a texture and then costs nothing; the world's shader reads one more
texture. Ten thousand splats cost the same as one. Memory is fixed up front.

**Bodies.** Killing Floor 2 caps bodies per client (8, 12 or 15 by setting, `gore-audit.md`). Blood is what stays; corpses do
not. The usual ways other games keep many bodies:

| Technique | Source | Fit |
|---|---|---|
| Let the ragdoll settle, then stop simulating it | everyone | have it |
| Bake the settled pose into a plain mesh and stop skinning; swap back when woken | a Unity ragdoll culler found baking on sleep "such a small thing compared to the massive gain" ([project](https://awesome.ecosyste.ms/projects/github.com%2Fjoshcamas%2Funity-ragdoll-culler)); Unreal users snapshot the pose ([forum](https://forums.unrealengine.com/t/how-to-handle-dead-bodies-freezing-ragdolls-for-performance/46748)) | yes; we already have `bakePose` (1.3 to 2 ms) |
| Merge many static meshes into one draw | three.js `BatchedMesh`: "helps reduce the number of draw calls"; one material for the whole batch; uses the multi-draw extension and falls back to plain draws without it ([docs](https://threejs.org/docs/pages/BatchedMesh.html)) | yes for old, far corpses, with one shared material |
| Lower detail and no shadows for the settled | common | yes; our corpses keep full cost |
| Simple colliders on settled bodies so the next ones land on them | common | yes; ours have none |
| Paint into a texture in a surface's own flat coordinates | [three.js render targets](https://threejs.org/manual/en/rendertargets.html), [a WebGL mesh-painting demo](https://kristian-dixon.github.io//2024/11/28/Mesh-Painting-Demo.html) | yes; floors are flat, so world X and Z are the coordinates and nothing needs unwrapping |

### B9. What fits, in one table

| Idea | Fits? | Cost class | Co-op |
|---|---|---|---|
| Bigger, sideways, per-limb flinch on every hit | yes | free | each screen, from the hit event |
| Hand to the wound on every hit | yes | free | each screen |
| Struck part on physics for 0.3 to 0.6 s, nearest enemies | yes | a few rigid bodies per hit, capped | each screen; facts unchanged |
| Hits spoil aim | yes | none | **a fact: the host decides** |
| Trunk cracks for rockets; pieces seen, in the air, kept | yes | none to small | the break choice already travels with the kill |
| Wear you can see per region (FLESH-lite) | yes | three texels, an interior draw when open | each screen, from its own count of the pools |
| Fire that spreads, eats skin, burns the corpse | yes | shader lines, a few emitters | burning is already a synced status |
| Footprints, bloody weapon, drips, splashes | yes | decals we already have | each screen |
| Organs bigger, squashy, hittable | yes | none to small | each screen |
| Blood kept in a floor texture | yes | 4 to 16 MB of texture, one fetch | each screen keeps its own |
| Corpses baked and batched, with colliders | yes | bake time once, then cheaper than today | each screen keeps its own |
| Real fluids, soft-body solver, free cutting of living bodies, learned balance | no | | |

---

## Sources

Fetched or searched for this document:

- GTA V NaturalMotion message reference (community-documented): Shot, ShotSnap, ShotFallToKnees, ShotFromBehind, ShotInGuts,
  ConfigureBullets, StaggerFall, BodyBalance, at `nitanmarcel.github.io/shvdn-docs.github.io` (links in B1).
- Max Payne 3: [MCV](https://mcvuk.com/development-news/max-payne-3-dev-explains-euphoria-engine-tweaks/),
  [TechRadar](https://www.techradar.com/news/gaming/the-technology-of-max-payne-3-1082751). RDR2:
  [Wccftech](https://wccftech.com/rockstar-euphoria-evolved-rdr2/). [Euphoria, Wikipedia](https://en.wikipedia.org/wiki/Euphoria_(software)).
- Dead Island 2: Game Informer, Kotaku (two), The Loadout, 80.lv, DualShockers, GameRant, a review (links in B3);
  [Cultured Vultures](https://culturedvultures.com/dambuster-studios-talk-dead-island-2-interview/) for the sound work.
- Killing Floor 2: Wikipedia, the KF2 wiki's UV guide, GamesBeat, a Steam settings guide, a Tripwire forum thread (links in
  B4 and B8).
- Left 4 Dead 2: [Vlachos, GDC 2010](https://cdn.fastly.steamstatic.com/apps/valve/2010/gdc2010_vlachos_l4d2wounds.pdf).
- Far Cry 2 fire: [Game Developer interview](https://gamedeveloper.com/game-platforms/interview-how-i-far-cry-2-i-s-fire-fuels-spreads).
- three.js: [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html), [render targets](https://threejs.org/manual/en/rendertargets.html).
- Soft bodies: [Tetrament](https://github.com/zalo/Tetrament). Corpse baking: the Unity ragdoll culler and the Unreal forum
  thread (links in B8).

Carried over from the two earlier research documents, where the full source lists are: Unreal physics-driven animation, Jedi:
Fallen Order, Wobbledoll, Catto's Diablo 3 talk, Mattson's Last of Us Part II notes, the Doom 2016 graphics study, the Space
Marine decal talk.

## What I could not find or verify

- No conference talk or engineer's write-up on FLESH; no developer account of how its melting and charring are drawn.
- No engineer's account of Killing Floor 2's splatter maps beyond the map-maker's guide and the one-sentence summary.
- No technical source for Fallout's gibs, for blood or fire in The Last of Us Part II or Red Dead Redemption 2, or for hit
  reactions in Hitman, Half-Life: Alyx or Trepang2.
- No performance figures for soft bodies in plain JavaScript on WebGL2.
- In our own game: nothing was timed (the machine was overloaded); nothing was heard; nothing was watched in motion at full
  speed; the burn colours were seen on the bright test floor, not in a game map; the "no scorch patch from the flamethrower"
  observation may be my harness. Co-op was read in the code and notes, not run.
