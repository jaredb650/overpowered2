# Proposal: the armour and headshot feedback update

Status: idea, not scheduled. Written 2026-11-13 from the owner's notes. Nothing here is built.
Open questions are marked **Q** with the default the build would use.

## The goal

You should be able to *hear and feel* what every shot did, without looking: armour stopped it, armour let some through,
armour broke, the headshot didn't kill, the headshot killed. Today most of that is either silent or reported the same way.
Heavy weapons should feel like what they are: the Sabot punches through everything, the Piledriver shreds armour, a rocket
on a plated man crunches all of it.

## What the game does today

- Plates are real pools over body parts and fly off when spent. Brutes and Juggernauts wear them in The Crucible;
  campaign and Endless Humans soldiers wear a chest plate and/or a helmet by role (`enemies/wounds/armour.ts`).
- **Helmets already are plates** that fly off like the others. But the plate is an extra slab on top of the helmet
  painted into the character, so after it flies he still looks helmeted.
- The Commander's "heavy helmets" order triples the helmet plate's hit points and adds a visor. The visor is decoration.
- Every armour outcome gets the same blue hit marker and the same positional clank.
- Every headshot, fatal or not, gets the same big yellow spark burst and the same "watermelon" headshot sound
  (`weapons/Combat.ts`). Only the hit marker differs (head versus kill).
- The armour rule differs by mode. In The Crucible a plate soaks up to its hit points and the overflow goes through at
  half. In the campaign a round under 60 damage is stopped outright, even the one that breaks the plate.
- The Sabot skips plates and riot shields without touching them, so there is nothing to see or hear when it does.
- Armoured vehicles take nothing from any bullet, the Sabot included.
- A direct rocket or shell on a plated enemy does double damage and skips the plates. It has no sound of its own.

## 1. Three armour outcomes, three cues

Every hit on armour lands in one of three outcomes. Each has its own small 2D sound (heard the same wherever you are,
quiet, like the hit-marker tick) on top of the positional sound, and its own variant of the blue marker.

| Outcome | What happened | Sound | Marker |
|---|---|---|---|
| **Stopped** | The armour took the whole round | A bright metal ping or ricochet | The blue diamond, as today |
| **Through** | The armour took some and the rest reached the man | A duller thunk with a crack under it | The blue diamond with a white body tick inside |
| **Broken** | The shot destroyed the piece | A loud metal snap | The blue diamond bursting outwards |

"Broken" can come with "through" or with "stopped". When both apply, play broken, which is the bigger news.

## 2. A ballistic class for every round

Armour stops rounds by class, not only by damage numbers. One rule for every mode, replacing the two rules today.

| Class | Weapons (default) | Against a helmet or plate |
|---|---|---|
| **Light** | SMG, Rivet, shotgun and Thresher pellets, Trommel | **Stopped** while the piece has hit points left. Chips it down. A grazing shotgun blast is saved by the helmet |
| **Medium** | Harrow, Judge | **Saves him once.** The round is stopped, but the piece is destroyed on the spot and flies off dramatically |
| **Heavy** | Piledriver, autocannon, stakes | **Through.** The piece is destroyed and part of the damage gets in |
| **Armour-piercing** | Sabot | **Always broken, full damage through.** See section 4 |

- **Q1.** Is the weapon list in the table right? There is no player assault rifle; the Harrow is the closest.
- **Q2.** Does the rule apply in The Crucible too (Brutes and Juggernauts), or only to human soldiers? Default: everywhere,
  except that bosses keep their current plates and phases.

## 3. Helmets you can see come off

- The helmet you see on a soldier is the armour. When it breaks it comes off his head in two or three pieces, and his
  bare head is left.
- The Commander's "heavy helmets" order gives them a visibly different, heavier helmet with a visor, and the extra hit
  points live in that helmet. It still breaks the same way: in Endless Humans, the order means you need a medium round
  or two light ones to the same head before your headshots land.
- Plates on the chest work the same way they do today, with the new cues.
- **Risk to check before costing.** The helmet that is painted into the character model would have to come off with the
  plate. If the model cannot hide its helmet, the plate has to become the whole helmet instead. Neither is checked yet.
- **Q3.** Do helmets come to The Crucible's human-looking enemies (Trooper, Gunner, Rocketeer)? Default: no, armour stays
  a campaign and Endless Humans thing plus the Brute and Juggernaut.

## 4. Headshots you can read

The yellow spark burst is gone from every headshot. It is carried over from the first game and does not fit the look.

| | Sound | Effect | Marker |
|---|---|---|---|
| **Headshot, not fatal** | A sharp crack | None of its own; the normal wound and blood | Head marker, as today |
| **Headshot, fatal** | The current headshot sound | A small red puff, like a smoke puff of mist, not a spray. Head bursts on big guns stay as they are | Kill marker, as today |
| **Headshot on a helmet** | The armour cue from section 1 | The helmet's own break or ping | The armour marker |

The point is the double tap: you pop a head, hear the crack and not the kill sound, and put a second round in him as he
falls.

## 5. The guns that should feel special

- **Sabot.** Always gives the **broken** cue on armour: the plate or helmet it passes through is destroyed, not skipped.
  A Sabot headshot through a helmet plays broken and the fatal headshot sound on top of each other. Through a riot
  shield it punches a visible hole.
- **Sabot against vehicles.** It is the only bullet that hurts armour. On plain hull it does little. On a weak point
  (engine, tracks, turret on a tank; cockpit, tail, rotor on a helicopter) it does real damage, but never enough to
  kill a tank in three shots. A tank takes 4 to 5 direct rockets today (1000 health).
  - **Q4.** How many Sabot shots should a tank take on its weak point? Default: about 8 to the engine, never fewer than
    6. Plain hull: about a tenth of a rocket.
  - **Q5.** A Sabot shot into a helicopter cockpit: a big chunk or a kill? Default: a big chunk, about a third.
- **Piledriver.** Shreds armour. Plates and helmets take double from it, so in a crowd you hear a stream of breaks and
  watch pieces come off. It still does nothing to vehicles.
- **Direct rocket or shell on a plated enemy.** Every plate he wears blows off at once with a heavy armour-crunch sound,
  on top of the body going. On a boss only the plate that was hit goes, so a single rocket cannot skip the Juggernaut's
  phases.

## 6. Left out

- Ricochets that fly off and can hit someone else.
- New armour on enemies that have none today (unless Q3 says otherwise).
- Damage to vehicles from any bullet but the Sabot.

## 7. Pieces, for costing later

Rough sizes only, not measured against the code.

| Piece | Size |
|---|---|
| Three armour outcomes reported by the damage model, with 2D sounds and three marker variants | Small to medium |
| Ballistic classes and one rule for every mode | Medium |
| Headshot rework: no yellow sparks, crack versus kill sound, red puff | Small |
| Helmets as the real helmet, coming off in pieces; a heavy helmet look | Medium to large (depends on the character model risk) |
| Sabot destroys what it passes; hole in riot shields | Small |
| Sabot against vehicles with weak points | Small to medium |
| Piledriver double against armour | Small |
| Direct rocket strips all plates, with the crunch | Small |
| New sounds (ping, thunk, snap, crunch, crack, puff) | Medium; these are new sound files, from the library or made, not ElevenLabs |
