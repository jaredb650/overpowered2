# Proposal: the armour, headshot and vehicle weak point update

Status: idea, not scheduled. Written 2026-11-13 from the owner's notes; the owner answered the first round the same
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
- **Risk to check before costing.** The helmet that is painted into the character model would have to come off with the
  plate. If the model cannot hide its helmet, the plate has to become the whole helmet instead. Neither is checked yet.

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
| **Roof** (top of the turret, the hatch) | Tiny, at the very top | **One rocket kills it** | 2 rounds (Q) |
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

## 9. Still open

- **Q.** Sabot rounds to kill a tank through the roof: 2? Default: 2.
- **Q.** Are rocket and Sabot weak-point hits the same for the Humvee and the truck? Default: no, soft-skins already die
  to one blast; the Sabot just does normal bullet damage to them.

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
| New sounds (tink, tunk, clang-dink, crunch, bone crack, puff) | Medium; new sound files from the library or made by hand, not ElevenLabs |
