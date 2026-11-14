# Plan: wound and gore sounds

Status: idea, not scheduled. Written 2026-11-14 at the owner's request: the armour cues made armour readable by ear, and
flesh should be as readable. The owner is generating the sounds. Nothing here is built.

## What the game can do to a body

**Soldiers (campaign, Endless Humans): anatomy.** `src/enemies/wounds`, `docs/notes/wounds.md`. A hit finds a zone and
fires `enemy:wounded` with it:

| Zone | Label | What happens |
|---|---|---|
| Thigh, knee, shin | KNEECAPPED | Limp; enough wear destroys the leg |
| Inner thigh | FEMORAL | Hand clamped on it, blood jets, down in about 9 s |
| Hand | DISARMED | Gun drops |
| Arm, shoulder | ARM SHOT | The arm really hangs (fractured) |
| Lung | LUNG SHOT | Mortal at once, coughs blood, no sprint, no voice |
| Heart | HEART SHOT | Dead |
| Gut | GUT SHOT | Hunched, screams every 4 s |
| Carotid | CAROTID | Down at once, jets, no voice, gone in 3 s |
| Spine | SPINED | Legs fail, drags himself by the arms |
| Pelvis | PELVIS | Legs fail, drags |
| Head | (dead), or RINGING on a glance | A glance stuns him for 2.4 s |

Conditions (`enemy:condition`): wounded, mortal (3 to 6 s left on his feet), downed (bleeding out on the floor), dead.

**Everyone, soldiers and the swarm: gore.** Limbs severed (`enemy:severed`), heads burst or taken off, bodies torn at
the waist or blown apart, blast outcomes (`blast.ts`: gib, waist, head, limbs, arm, burn, flesh, thrown, dazed), burning,
knockdowns and get-ups, ragdoll landings (`gore:impact`).

## What already has a sound

- Every body hit: `bullet_body` (wet hit at the body), `hit_punch` (weight), `hit_confirm` (a 2D crunch, synthesized).
- Severing: `limb_sever`, with `bone_snap`, `flesh_tear`, `blood_spurt` under it.
- Head kill: the first game's headshot stack, `head_pop`, `vox_gurgle`, and now `headshot_puff` and `headshot_crack`.
- Gib: `blood_splatter`, `blood_spill`. Landings: body, limb, head and organ falls on metal or concrete.
- Voices: pain, scream, choke, gurgle.
- A burning body: `flame_burn_loop`.

So a hit sounds the same wherever it lands, and nothing tells the player by ear that a man is mortal, bleeding out, or
that the femoral was hit. That is the gap.

## The idea: two layers, like the armour cues

1. **2D confirmations**, quiet and immediate, heard wherever the player is: how bad the wound is. Three tiers, so the ear
   learns them fast.
2. **World sounds** at the body: what exactly happened to it, and what the body is doing now.

## The sounds

Each has a description to generate from. "2D" plays the same wherever the player is; "world" comes from the body.
Lengths are what fits the moment; takes are how many variants stop it repeating.

### Tier 1: the most feedback for the fewest files

| # | Id | When | Where | Length | Takes | What it should sound like |
|---|---|---|---|---|---|---|
| 1 | `wound_minor` | A wound that slows him: kneecap, arm, hand | 2D | 0.15 s | 3 | A short, dull, meaty thump with a little wet tick on top. Not a crunch, not bone |
| 2 | `wound_crippling` | A wound that ends his fight: femoral, gut, lung, spine, pelvis | 2D | 0.25 s | 3 | Heavier and wetter than minor: a deep, soft impact with a short wet tear after it. Clearly worse than #1 |
| 3 | `wound_mortal` | He is now mortal or down and bleeding out, from any cause | 2D | 0.4 s | 2 | A low, sinking thud with a falling tone under it, like the floor dropping away. The sound of "he's done, he just doesn't know it" |
| 4 | `kill_body` | A body shot that kills (not the head) | 2D | 0.3 s | 3 | A heavy, final, wet thump. Should sit alongside `headshot_puff` as its body-shot partner |
| 5 | `head_burst` | A head bursts | world | 0.5 s | 3 | A wet, explosive pop with a skull crack inside it and a spatter tail. Bigger and wetter than a headshot |
| 6 | `decapitate` | A head is taken off clean (blade, heavy round at the neck) | world | 0.5 s | 2 | A fast, wet cutting chop through bone, then a short gush |
| 7 | `sever_arm` | An arm comes off | world | 0.4 s | 3 | Wet rip with a sharp bone snap, lighter than a leg |
| 8 | `sever_leg` | A leg comes off | world | 0.5 s | 3 | Heavier rip and a thick bone break, more meat |
| 9 | `tear_waist` | A body torn in two at the waist | world | 0.8 s | 2 | A long, heavy, wet tearing rip, then a slop of insides hitting the floor |
| 10 | `gib_burst` | A body blown apart | world | 0.7 s | 3 | A meaty burst: wet explosion of flesh with chunks slapping down after it. No fire |

### Tier 2: what exactly was hit

World sounds at the wound, layered under the hit.

| # | Id | When | Length | Takes | What it should sound like |
|---|---|---|---|---|---|
| 11 | `hit_bone` | KNEECAPPED, ARM SHOT, and any hit that fractures | 0.25 s | 3 | A sharp, dry bone crack under flesh. Not a stick: muffled by meat |
| 12 | `hit_artery` | FEMORAL, CAROTID | 0.5 s | 2 | A wet hit that turns into a high-pressure hiss and spurt |
| 13 | `hit_lung` | LUNG SHOT | 0.5 s | 2 | A wet thud with a sucking gasp after it, air through liquid |
| 14 | `hit_gut` | GUT SHOT | 0.35 s | 3 | A soft, deep, sloppy impact |
| 15 | `hit_heart` | HEART SHOT | 0.4 s | 2 | A deep, hollow thump that stops dead, then silence |
| 16 | `hit_spine` | SPINED, PELVIS | 0.35 s | 2 | A heavy crunch of bone, lower and thicker than `hit_bone` |
| 17 | `hit_hand` | DISARMED | 0.3 s | 2 | Small bones crunching, then the gun clattering on the floor (or two files: crunch, and `gun_drop`) |
| 18 | `head_glance` | RINGING, a glancing head hit | 0.3 s | 2 | A skin-and-skull scrape with a short high ringing tone, the enemy's ears ringing |

### Tier 3: what the body is doing now

Quiet, world, near the body only; at most a few at once.

| # | Id | When | Length | Takes | What it should sound like |
|---|---|---|---|---|---|
| 19 | `bleed_spurt_loop` | An arterial wound, while he lives | 1.5 s loop | 1 | Rhythmic pulsing spurts of liquid, about one a second, like a heartbeat pushing blood |
| 20 | `lung_breath_loop` | A lung shot, while he lives | 2 s loop | 1 | Wet, bubbling, laboured breathing |
| 21 | `blood_cough` | A lung shot, now and then | 0.6 s | 3 | A wet cough bringing up liquid |
| 22 | `crawl_drag` | A downed man dragging himself | 0.8 s | 3 | Cloth and gear dragged on the floor with a hand slap at the start of each pull |
| 23 | `death_rattle` | A man who bleeds out, his last breath | 1 s | 3 | A long, wet, shuddering exhale that stops |
| 24 | `flesh_sizzle_loop` | A burning body, under the fire | 2 s loop | 1 | Crackling, sizzling fat under the flame, so a burning man sounds different from a burning crate |
| 25 | `limb_fracture` | A bone breaks in a ragdoll landing or a knockdown | 0.2 s | 3 | A muffled snap inside a body, quieter than `hit_bone` |
| 26 | `organ_spill` | A gut wound opened by a blast, or a waist tear | 0.6 s | 2 | Heavy wet slop and slide onto the floor |

## Wiring

All from events that already fire; no system needs new state except the loops, which need a slot each like the burning
bodies' (`reactions.ts`, nearest 4 in 50 m).

| Sounds | Hook |
|---|---|
| 1, 2, 11 to 18 | `enemy:wounded` (its `zone`), in `audio/reactions.ts` |
| 3 | `enemy:condition` to mortal or downed |
| 4 | `enemy:killed` from a player's round, not a headshot, not a gib |
| 5, 6 | `enemy:killed` head kill: burst when gore bursts it, decapitate when the head pool goes |
| 7, 8 | `enemy:severed`, by region; they replace `limb_sever` and its layers or sit over them |
| 9, 10, 26 | `enemy:killed` with the blast outcome (`waist`, `gib`) |
| 19 to 23 | The wound system's clocks: a live bleeder, a lung, a crawl, the end of a bleed-out |
| 24 | Beside `flame_burn_loop` on a burning body |
| 25 | `gore:impact` when a limb breaks on landing |

**Levels**, set the way the armour cues were: measured, then on a ladder by meaning. The 2D tiers sit with the hit and
armour cues (minor near `armour_through`, crippling near `headshot_crack`, mortal and kill near `armour_broken`); the
world gore near the guns, the gib and the waist tear the loudest.

**The swarm** (husks and the rest) has no anatomy, so tiers 1 and 2's wound sounds are for soldiers. Everything from
the gore system (5 to 10, 24, 25) plays for the swarm too.

## Notes for generating

- Short and dry is better than long: the game adds its own reverb by distance.
- Start on the impact, with no lead-in.
- One sound per file, mono is fine.
- Several takes of anything that repeats (the 2D tiers, the hits) so a long fight does not sound like one sample.
