# Plan: armour and headshots

Covers armour feedback, headshot feedback and vehicle weak points.

Status: partly built, 2026-11-13. **Built:** section 1 (three outcomes, markers, sounds), section 4 except helmet
headshots on removable helmets, section 5 (Sabot deletes armour and pierces shields, Piledriver double, rocket strips all
plates), and the Sabot doing a share of its damage anywhere on an armoured vehicle (no weak points yet). The owner's
sound files are wired in, with new shots for the Sabot and the autocannon. **Built later the same day:** sections 2 and 7 (ballistic
classes, pellet counting, one rule everywhere, the Brute's plates halved).
**Not built:** section 3 (removable helmets), section 6's weak points and turret lock, section 8
(Crucible helmets).

Original status: idea, not scheduled. Written 2026-11-13 from the owner's notes; the owner answered the first round the same
day. Nothing here is built. Open questions are marked **Q** with the default the build would use.

## The goal

You should be able to *hear and feel* what every shot did, without looking: armour stopped it, armour let some through,
armour broke, the headshot didn't kill, the headshot killed. Heavy weapons should feel like what they are: the Sabot
deletes armour, the Piledriver shreds it, a rocket on a plated man crunches all of it. Vehicles stay strong, but have
real weak points that reward knowing where to aim.

## What the game does today

- Plates are real pools over body parts and fly off when spent. Brutes and Juggernauts wear them in The Crucible;
  campaign and Endless Humans soldiers wear a chest plate and/or a helmet by role (`enemies/wounds/armour.ts`).
- **Helmets already are plates** that fly off like the others. But the plate is an extra slab on top of the helmet
  painted into the character, so after it flies he still looks helmeted.
- The Commander's "heavy helmets" order triples the helmet plate's hit points and adds a visor. The visor is decoration.
- Every armour outcome gets the same blue hit marker and the same positional clank.
- Every headshot, fatal or not, gets the same big yellow spark burst and the same headshot sound (`weapons/Combat.ts`).
  Only the hit marker differs.
- The armour rule differs by mode (see section 7).
- The Sabot skips plates and riot shields without touching them, so there is nothing to see or hear when it does.
- Armoured vehicles take nothing from any bullet, the Sabot included.
- A direct rocket or shell on a plated enemy does double damage and skips the plates. It has no sound of its own.
- Tanks (1000 health) have parts: tracks (break one to stop it), rear engine (slows it), turret (breaking it jams the
  turret so it turns slowly). A roof machine gunner turns on his own. A tank takes 4 to 5 direct rockets.
  Helicopters (620) have a cockpit, a body, a tail and a rotor.

## 1. Three armour outcomes, three cues

Every hit on armour lands in one of three outcomes. Each has its own small 2D sound (heard the same wherever you are,
quiet, like the hit-marker tick) on top of the positional sound, and its own variant of the blue marker. **Every armour
sound is metal. None of them may sound like flesh or bone.**

| Outcome | What happened | Sound | Marker |
|---|---|---|---|
| **Stopped** | The armour took the whole round | A short, bright *tink* of a round glancing off steel, with a thin ricochet whine trailing off for a fifth of a second | The blue diamond, as today |
| **Through** | The armour took some and the rest reached the man | A heavier, duller *tunk*: a round punching a steel plate, with a muffled cloth-and-body thump under it (a thump, never a crack) | The blue diamond with a white body tick inside |
| **Broken** | The shot destroyed the piece | The loudest of the three: a sharp ringing *clang-dink* in the spirit of a classic shooter's helmet-headshot sound but heavier, followed by a rattle of loose metal pieces skittering away | The blue diamond bursting outwards |

"Broken" can come with "through" or with "stopped". When both apply, play broken, which is the bigger news.

## 2. A ballistic class for every round

Armour stops rounds by class, not only by damage numbers.

| Class | Weapons | Against a helmet or plate |
|---|---|---|
| **Light** | SMG, Rivet, Trommel, a single shotgun pellet | **Stopped** while the piece has hit points left. Chips it down |
| **Medium** | Harrow (the assault rifle), Judge | **Saves him once.** The round is stopped, but the piece is destroyed on the spot and flies off dramatically |
| **Heavy** | Piledriver, autocannon, stakes | **Through.** The piece is destroyed and part of the damage gets in |
| **Armour-piercing** | Sabot | **Deletes the piece, full damage through.** See section 5 |

**Shotguns count pellets.** The pellets from one blast that land on the same piece are counted together:

| Pellets on the piece | Counts as | What you see |
|---|---|---|
| 1 | Light | Bounces off: a spark and a visible ricochet |
| 2 | Medium | The helmet flies off; he lives |
| 3 or more (close to a full blast, point blank) | Heavy | The helmet breaks and damage gets in; can kill, or take the head |

At point blank, one or two pellets of a blast always visibly deflect off the helmet (spark and ricochet), even when the
rest go through. This applies to the shotgun (6 pellets) and the Thresher (4).

## 3. Helmets you can see come off

- The helmet you see on a soldier is the armour. When it breaks it comes off his head in two or three pieces, and his
  bare head is left.
- The Commander's "heavy helmets" order gives them a visibly different, heavier helmet with a visor, and the extra hit
  points live in that helmet. It still breaks the same way: the order means you need a medium round, two pellets, or
  several light rounds to the same head before your headshots land.
- Plates on the chest work the same way they do today, with the new cues.
- **Checked 2026-11-13: the painted helmet cannot be hidden, but it can be moved out of the body.**
  - The baker (`tools/bake`) builds each character as one signed-distance surface, so the helmet is fused into the head:
    there is no skull under it, only the helmet's outside. Hiding its triangles would leave a hole.
  - But archetypes already mount baked props on sockets (the Rocketeer's pack on `back`, every gun on `handR`), and the
    baker can bake a single model by name. So: take the `helmet(...)` call out of each helmeted body, bake it as its own
    prop with the same shape and materials, and mount it on a head socket. The body underneath then bakes as the bare head
    (`handsAndHead`). It looks the same as today until it comes off.
  - At runtime, the HELMET plate uses that prop as its mesh instead of the slab, so the existing plate debris throws the
    real helmet. In The Crucible the same prop is worn for looks and never comes off (no plate there).
  - Helmeted bodies: `trooper`, `rocketeer`, `riot` (all `helmet()` in `archetypes/soldiers.ts`) and `gunner` (its own
    iron bucket). Those are the campaign's rifle, rocket, shield and shotgun roles, which are exactly the roles that wear
    HELMET. The `contractor` has a helmet too but wears no plate.
  - Cost: **medium.** Four rebakes and four helmet props, a head socket, a plate mesh override, and a look at the bare
    heads, which nobody has seen (the Trooper's respirator and crest may need moving to the helmet). Splitting a helmet
    into two or three pieces is extra; one helmet flying off is the first step. The Commander's heavy helmet is the same
    prop, larger, with the visor that already exists.
- **Built 2026-11-13** (one helmet flying off; splitting it into pieces is still to do).
  - `trooperHelmet`, `gunnerHelmet`, `rocketeerHelmet`, `riotHelmet` in `tools/bake/props.ts` (`wornOnHead`), built by the
    same code as before in `archetypes/soldiers.ts` and mounted on a new `head` socket (the head bone's origin). The bodies
    bake with the bare rubber hood. The helmet takes the Trooper's crest fin and antenna, the Rocketeer's monocle and the
    Riot's dome visor; the Trooper's goggle slit and mouthpiece and the Rocketeer's respirator stay on the face.
  - `HELMET` has `worn: 'head'`: `fitPlates` uses the mounted helmet as the plate's mesh, so `PlateDebris` throws it, the
    cracked tip tips it forward, and a respawn puts it back. Hit points and regions are unchanged.
  - Heavy helmets scale it 1.1 alongside the visor. A burst head hides it as before; one already shot off is left alone and
    is not cloned onto a severed head.

## 4. Headshots you can read

The yellow spark burst is gone from every headshot. It is carried over from the first game and does not fit the look.

| | Sound | Effect | Marker |
|---|---|---|---|
| **Headshot on flesh, not fatal** (no helmet, or the helmet is already gone) | A dry bone crack: short, like a thick stick snapping, no wetness or splatter | None of its own; the normal wound and blood | Head marker, as today |
| **Headshot, fatal** | The current headshot sound | Its own effect: a small red puff, like a puff of smoke or mist, not a spray. Head bursts on big guns stay as they are | Kill marker, as today |
| **Headshot on a helmet** | Only the armour cues from section 1, never bone | The helmet's own ping or break | The armour marker |

The point is the double tap: you pop a head, hear the crack and not the kill sound, and put a second round in him as he
falls.

## 5. The guns that should feel special

- **Sabot.** Deletes any armour piece it hits and does full damage through it, always with the **broken** cue. A Sabot
  headshot through a helmet plays broken and the fatal headshot sound on top of each other. Through a riot shield it
  punches a visible hole.
- **Piledriver.** Shreds armour. Plates and helmets take double from it, so in a crowd you hear a stream of breaks and
  watch pieces come off. It still does nothing to vehicles.
- **Direct rocket or shell on a plated enemy.** Every plate he wears blows off at once with a heavy armour crunch (sheet
  steel crumpling and plates clattering away, under the explosion), on top of the body going. On a boss only the plate
  that was hit goes, so a single rocket cannot skip the Juggernaut's phases.

## 6. Vehicle weak points

Vehicles stay strong. The Sabot becomes the one bullet that hurts them anywhere, but only a little; the real damage is
in small weak points you have to aim for on purpose. Rockets and shells use the same weak points.

### Tank (1000 health)

| Weak point | Hitbox | Rocket (direct) | Sabot |
|---|---|---|---|
| **Roof** (top of the turret, the hatch) | Tiny, at the very top. Almost never hit in play: an Easter egg for the player who knows | **One rocket kills it** | 2 rounds |
| **Turret ring** (the joint between turret and hull) | A thin band all the way round. Hard to hit by accident | 2 rockets kill it. **Any hit locks the main gun** | 4 rounds kill it. Any hit locks the main gun |
| **Rear vents** (the engine) | The back deck | 2 rockets kill it | 8 rounds |
| **Tracks** | The sides, as today | Breaks a track and stops it, as today | Can break a track too |
| **Anywhere else** | | 4 to 5 rockets, as today | A little: about 25 rounds |

A **locked main gun** stays pointing where it was. Now and then the crew fires a desperate round wherever it points.
The roof machine gun still turns all the way round and keeps shooting at you. Today, breaking the turret only slows
how fast it turns.

### Attack helicopter (620 health)

| Weak point | Hitbox | Sabot | Rocket (direct) |
|---|---|---|---|
| **Pilot** | A small box inside the cockpit glass | **Kills the pilot; it goes down** | Kills it, as the cockpit shell does today |
| **Tail rotor** | A tiny box on the tail rotor itself | Critical: the tail is gone and it spins down | As today |
| **Anywhere else** | | A little: about two magazines (10 rounds) to bring it down | As today |

## 7. Q: one armour rule for every mode, or one per mode?

Today The Crucible soaks up to a plate's hit points and lets the overflow through at half; the campaign and Endless
Humans stop any round under 60 damage outright, even the round that breaks the plate.

| | One rule everywhere (the classes in section 2) | Keep a rule per mode |
|---|---|---|
| Learning | You learn each gun once. A cue always means the same thing | The same gun behaves differently between modes; the cues mean different things |
| Weapon identity | The Sabot, Piledriver and shotgun feel the same everywhere | Their identity is only fully there in one mode |
| Crucible balance | Changes a little. SMG rounds stop being able to leak through a Brute's plate, and plate hit points grow with the waves, so light guns get a bit weaker late. Needs a tuning pass on the Brute | No change |
| Bosses | Unaffected: they keep their own 5% cap per hit and their phases | Unaffected |
| Work | One rule, one set of tests | Two rules to keep in step with every new feature |

**Recommendation: one rule everywhere,** with bosses keeping their caps, and a tuning pass on the Brute's plate hit
points so the SMG still has a place against it. Default: that.

## 8. Q: helmets in The Crucible?

Today in The Crucible only the Brute and the Juggernaut wear armour.

| Option | For | Against |
|---|---|---|
| **No** (as today) | The Crucible stays a power fantasy against a swarm; SMG headshots always land; no new tuning | The headshot and armour cues barely appear in the game's main mode |
| **Yes, on everyone** | Every fight uses the new feedback | Swarms of helmeted Troopers make the SMG feel weak; more clutter; a real change in difficulty |
| **Yes, on some types** (Gunner and Rocketeer; Troopers never) | The dangerous enemies are the armoured ones, which tells you what to aim at; Troopers stay fodder | Still a difficulty change for those two |
| **From a later wave** | Armour becomes part of the difficulty ramp, like the Commander's order | One more thing to tune per wave |
| **As a Custom Crucible rule** | Players who want it turn it on | Most players never see it |

**Recommendation:** helmets on Gunners and Rocketeers only, starting from a mid wave, plus an on/off switch in the
Custom Crucible rules screen. Troopers never. Default: that, pending the owner's call.

## 9. Settled

- Sabot rounds through the tank roof: 2.
- The Humvee and the truck get no weak points. Soft-skins already die to one blast; the Sabot does normal bullet damage
  to them.

## 10. Left out

- Ricochets that fly off and can hit someone else (the deflected pellets are only for show).
- Damage to vehicles from any bullet but the Sabot.

## 11. Pieces, for costing later

Rough sizes only, not measured against the code.

| Piece | Size |
|---|---|
| Three armour outcomes reported by the damage model, with 2D sounds and three marker variants | Small to medium |
| Ballistic classes, one rule for every mode, Brute tuning pass | Medium |
| Shotgun pellet counting on a piece, deflected pellets for show | Small to medium |
| Headshot rework: no yellow sparks, bone crack versus kill sound, red puff | Small |
| Helmets as the real helmet, coming off in pieces; a heavy helmet look | Medium to large (depends on the character model risk) |
| Sabot deletes what it hits; hole in riot shields | Small |
| Piledriver double against armour; rocket strips all plates with the crunch | Small |
| Tank weak points (roof, ring, vents), the locked main gun, Sabot on tanks | Medium |
| Helicopter pilot and tail rotor hitboxes, Sabot on helicopters | Small to medium |
| Crucible helmets on Gunners and Rocketeers from a mid wave, with a rules switch | Small to medium |
| New sounds | Medium. The owner is sourcing the files; see section 12 |

## 12. Sound files to find

Today every armour sound in the game is synthesized at load (`impact_armor`, `armor_plate_off`, `hit_marker_armor`,
`ricochet` in `src/audio/synth/recipes`), and the headshot is the first game's three recordings stacked
(`enemy_headshot`, `2`, `3`). The new recordings replace or sit on top of those.

**What to get, for every file:**
- WAV or MP3, mono is fine. Silence trimmed from the start: the sound must hit on the first millisecond.
- 2 to 4 takes of each where the table says so, so repeated hits don't sound like one sample.
- A licence that allows use in a free public game. CC0 needs nothing; CC BY needs the author and link. Write down the
  author, licence and link for each file: they go into `docs/CREDITS.md` and a `CREDITS.txt` beside the files, the same
  way the gore sounds are credited. Nothing ripped from another game, Counter-Strike included: find something in that
  spirit.
- Drop them in a new folder, for example `public/audio/sfx/armour/`, with names that say what they are.

**"2D"** means it plays at the same volume wherever you stand, quietly, like a hit marker tick. **"In the world"** means
it comes from the enemy or the vehicle.

### Must have

| # | Sound | Plays when | Where | Length | Takes | What it should sound like |
|---|---|---|---|---|---|---|
| 1 | **Armour stopped** | A round is fully stopped by a plate or helmet | 2D | 0.15 to 0.3 s | 3 to 4 | A short, bright metal *tink*: a bullet glancing off steel, with a thin ricochet whine trailing away. Light, not a clang. Search: "bullet ricochet metal", "metal ping" |
| 2 | **Armour through** | Part of a round gets past a plate into the man | 2D | 0.2 to 0.35 s | 3 | A dull, heavier *tunk*: a round punching a thick steel plate, with a muffled thump of cloth and body underneath. No crack, no bone. Search: "bullet hit metal plate thud", "bullet impact steel heavy" |
| 3 | **Armour broken** | A shot destroys a plate or helmet; every Sabot hit on armour | 2D | 0.4 to 0.8 s | 2 to 3 | The loudest and most satisfying of the three: a sharp, ringing *clang-dink* of a helmet being hit hard, then a short rattle of loose metal pieces skittering. Must be all metal. Search: "helmet hit metal clang", "metal impact ring", "metal debris rattle" (the rattle can be a separate file layered on top) |
| 4 | **Armour crunch** | A direct rocket or shell blows every plate off an enemy | In the world | 0.6 to 1.2 s | 2 | Sheet steel crumpling and tearing, then plates clattering away, heavy and low. Plays under the explosion. Search: "metal crunch", "car crash metal crumple", "metal tear" |
| 5 | **Headshot crack** | A headshot on flesh that does not kill | 2D | 0.1 to 0.2 s | 3 | A dry bone crack: short and hard, like a thick stick snapping or a knuckle crack. No wetness, no splatter. Search: "bone crack", "bone break dry", "stick snap" |
| 6 | **Vehicle weak point** | A rocket or Sabot hits a tank's roof, turret ring or rear vents, or a helicopter's pilot or tail rotor | 2D | 0.3 to 0.5 s | 2 | A heavy, deep metal *clank* with a bright ring on top, so you know you found the spot. Bigger and lower than "armour broken". Search: "heavy metal impact", "anvil hit", "metal clang deep" |
| 7 | **Sabot on a vehicle** | A Sabot round hits any part of a tank or helicopter | In the world | 0.3 to 0.6 s | 2 to 3 | A dart punching through thick steel: a sharp, high crack of metal with a deep ring under it. Search: "bullet hit tank armor", "metal pierce impact", "armor penetration" |

### Good to have

Each has a fallback, so the update works without it.

| # | Sound | Plays when | Where | Length | Takes | What it should sound like | Without it |
|---|---|---|---|---|---|---|---|
| 8 | **Helmet clatter** | Helmet pieces land on the ground | In the world | 0.3 to 0.6 s | 3 | A light metal shell bouncing twice on concrete. Search: "helmet drop", "metal bowl drop" | The current synthesized plate sound |
| 9 | **Pellet deflect** | A shotgun pellet bounces off a helmet | In the world | 0.2 to 0.5 s | 3 to 4 | A quick bullet ricochet whine. Search: "ricochet" | The current synthesized ricochet |
| 10 | **Turret jammed** | A hit on the turret ring locks the main gun | In the world | 0.8 to 1.5 s | 1 | Heavy gears grinding and seizing with a metal screech. Search: "gear grind", "machine jam" | The callout text alone |
| 11 | **Cockpit glass** | A Sabot kills a helicopter's pilot | In the world | 0.3 to 0.6 s | 2 | Thick glass cracking and shattering. Search: "glass crack", "windshield shatter" | Sound 6 alone |
| 12 | **Riot shield punch** | A Sabot goes through a riot shield | In the world | 0.2 to 0.4 s | 2 | A dart punching through a thin metal sheet with a short tearing scrape. Search: "metal sheet pierce", "bullet through metal" | Sound 3 plus the current shield ring |
| 13 | **Headshot puff** | A fatal headshot, under the current headshot sound | 2D | 0.1 to 0.2 s | 2 | A soft wet *pff*: a burst of mist. Very quiet, only adds air to the existing sound. Search: "spray puff", "air puff" | The current headshot sound alone |

**Kept as they are:** the fatal headshot sound (the first game's stack), the explosions, the Juggernaut's armour break
roar, the tank's track snap and metal groan, and the helicopter's stricken sound.
