# Progression: streaks, perks, call-ins, powerups, pickups, score

`src/progression/`. `createProgression(ctx)` from `index.ts`. Sandbox: `/?sandbox=progression`.

| File | What it is |
|---|---|
| `data.ts` | Every number. Tune here |
| `index.ts` | The kill flow: counters, ladder, style gate, assists, frame update, reset |
| `perks.ts` | Activation, countdowns, stacking, the one writer of `weapons.modifiers` and `player.modifiers`, grade choice |
| `counters.ts` | `TimeWindow` (sliding) and `Combo` (gap-based) |
| `score.ts` | Scoring, style labels, multi-kills, high score |
| `chains.ts`, `frost.ts`, `sentinels.ts` | Chain Storm and Chain Reaction, Frost Nova, the drones. The drones (Sentinels) are off the combo ladder since 2026-11-13: nothing grants them in a run, and the guide hides them. `COMBO_PERKS` in `data.ts` says how to put them back |
| `callins/manager.ts` | Ownership, cooldowns, keys, the holster, running strikes |
| `callins/targeting.ts` | Aim solve, confirm, cancel, the Warthog drag |
| `callins/ground.ts` | `GroundRing`, `GroundStrip` and `GroundProbe` |
| `callins/bodies.ts` | `BodyQuery`: bodies in a ball, and waking resting corpses |
| `callins/airstrike.ts`, `warthog.ts`, `orbital.ts`, `blacksun.ts`, `nuke.ts` | The strikes. `ordnance.ts` is the hero missiles |
| `callins/ac130.ts`, `ac130Guns.ts`, `ac130Rounds.ts`, `ac130Model.ts`, `ac130Data.ts` | The gunship: stages and impacts, fire control, what is in the air, the airframe, its numbers |
| `callins/airframe.ts`, `radio.ts` | Shared by aircraft call-ins. See "Building another aircraft" |
| `callins/gunnerStrike.ts`, `attackChopper.ts`, `doorGunner.ts`, `heliData.ts` | The two helicopters: the flight they share, each one's flying and guns, their numbers |
| `src/vehicles/seat.ts` | The gunner's seat: the view, the parked body, aiming, marking enemies, always handing control back |
| `src/vehicles/emplacement.ts` | Mounted guns on the ground, manned through the same seat. See the end of `vehicles.md` |
| `src/vehicles/emplacement.ts` | Mounted guns on the ground, manned through the same seat. See the end of `vehicles.md` |
| `src/vehicles/pilot.ts`, `skyline.ts`, `targets.ts` | The Harrow's autopilot, the height of the map, finding the fight |
| `src/vehicles/hud.ts`, `gunner.css` | The overlay that replaces the on-foot HUD in a seat |
| `src/vehicles/attackModel.ts`, `utilityModel.ts`, `guns.ts`, `loft.ts` | Both airframes, the M134 and the chin cannon, the hull lofter |
| `pickups/pickups.ts`, `pods.ts`, `models.ts` | Drops, map items, capsules, drop pods |

## Public API

The contract is `ProgressionSystem` in `core/gameplay.ts`.

One meaning widened: `targeting` also stays set to `'orbital'` while the beam is being steered. The viewmodel polls it to hold the designator up and the HUD keeps its reticle.

Events out: `perk:start`, `perk:end`, `callin:ready`, `callin:used`, `combo:changed`, `score:gain`, `pickup:collected`. Events in: `enemy:killed`, `enemy:hit`, `enemy:severed`, `enemy:executed`, `wave:clear`, `player:slam`, `player:died`, `run:end`.

## The rules, all in `data.ts`

**Clocks.** Perks, combo, windows, strike timelines and pickups run on `realDt`, as the first game's wall clock did. Ordnance and the Black Sun's pull run on `dt`. Sentinels run on `playerDt`. All of it stops with `update()`, so pause holds it.

**First-game thresholds are untouched:** Blood Thirst 4 in 5 s, Hellfire 10 in 10 s, Airstrike combo 8, Warthog 12, Berserk 15, Adrenaline 3 sword kills in 3 s, SLOWMO 3 headshots in 3 s.

**Stacking.** Damage, fire rate, pellets and speed multiply across effects (`STACK`), with speed capped at 3.5x. Modifiers are rebuilt from the active list every frame, so nothing can go stale. Retrigger is per effect: `ignore` keeps the counter so the perk re-arms on the first kill after it ends (the first game's near-permanent Blood Thirst), `refresh` restarts it, `stack` adds and restarts (Adrenaline, to 3).

**Style perks changed from DESIGN section 9.** Pacing was the problem: a perfect bot fired five perks in 15 s of wave 1, and they crowded out the rewards at combo 20 and above.

| Perk | DESIGN | Now | Why |
|---|---|---|---|
| Butcher | 3 limbs in 2 s | 5 different bodies in 4 s, direct hits only | Husk limbs come off so easily it fired before the first kill |
| Skyfall | 3 airborne kills in 4 s | 4 in 6 s, each after 0.35 s off the ground | A plain hop lasts 0.57 s |
| Chain Reaction | 3 kills from one explosion | 4, and not under Hellfire | Rockets reach 3 in a swarm with no aiming, and Hellfire makes every round an explosion |
| Overdrive | 5 kills above 25 m/s | 5 in 10 s above 18 m/s, measured against `player.modifiers.speed` | Run speed fell to 12.5 and the strafe ceiling is about 27. Berserk's 25 m/s must not earn it |

`STYLE_GATE`: one style perk at most every 20 s, and each waits 30 s after it ends. The window keeps its kills while the gate is shut.

SLOWMO: hits on one head inside 0.35 s count once. At 10 rounds a second a burst is not three good shots.

**Assist kills.** Kills from `ASSIST_SOURCES` (the five strikes, sentinels, Chain Storm, Chain Reaction, drop pods) pay score and drops and keep the combo alive, but climb it at half rate and feed no perk window. Before this one Airstrike was worth up to 30 rungs, and a nuke's own bodies fired Berserk, Hellfire and Overdrive at once.

**Measured pacing**, real waves, real time, from the first kill. "Human" is a bot with 0.3 s reaction, aim error and eased turning. Still better than most people, and one run each.

| Bot | Perks in the first 15 s | Berserk | Best combo |
|---|---|---|---|
| Perfect aim, before | 5 | | |
| Perfect aim, now | 3 | 51 s | 17 |
| Human-like, now | 2 | 30 s | 16 |

**Geneva Suggestion.** `enemy:executed` pays `STYLE.geneva` on top of the kill, through the usual multipliers, and starts the `geneva` effect, which stacks to 5 and scales damage and fire rate per stack (`STACK.geneva*`). It has no grade and borrows `style_bonus` for its sound. See `docs/notes/contracts.md`.

**Grades.** One grade shows at a time, the highest in `GRADE_RANK`: Berserk, SLOWMO, Time Warp, Hellfire, Overdrive, Chain Storm, Blood Thirst, Butcher, Chain Reaction, Skyfall, Adrenaline. Sentinels and the other capsules have no grade. SLOWMO outranks Hellfire on purpose: see Known limitations. Death sets the `death` grade, which nothing else did.

## Call-ins

Key enters targeting, gun holstered, off hand up. A fresh click confirms, RMB cancels and keeps the call-in, the same key cancels, sky aim plays `callin_denied` and stays in targeting. The Warthog pins on press and confirms on release, so dragging sets the heading.

The walkie and designator are the viewmodel's `Offhand`, driven by `progression.targeting`. An earlier `HeldDevice` here drew a second one on top, so it was removed.

**Overlays are projected.** `GroundRing` and `GroundStrip` are volumes drawn from the inside that rebuild world position from `render.depthTexture`, so the footprint is exact on ramps, crates and walls. A draped grid stood up into a cone over any post. Walls in the footprint get 30% strength.

| Strike | Timeline after the click | Notes |
|---|---|---|
| Airstrike | Radio 0, cue 3, 15 rockets 4 to 5.4, finale fired 6.5, lands about 7.1 | Finale radius 20, instakill, only throws the player. Rockets start under any roof above their own landing point |
| Warthog | Cue 2, 50 shells 4 to 6.45, roar 6.5, jet overhead 6 | 60 m corridor, 1.2 m spacing. Each shell gets a clear line to its own impact, so an overhang cannot eat part of the run |
| Orbital | Pilot laser 0.9 s, beam 6 s | Steers at 34 m/s, 420 damage a second in 6 m. RMB lets go: the beam parks, burns out, and the gun comes back |
| AC-130 | Inbound 0 to 9, on station to 129, gone by 141 | Two minutes of escalating fire. See below |
| Black Sun | Grows 1 s, pulls to 6.2, collapses, implodes at 6.75 | Dragged by the feet, walls hold them, crush within 3.5 m from T+2.6. Corpses orbit at 10 m. Implosion radius 28, bodies leave at about 55 m/s. Uses `finisher`, so the nuke keeps its own recipe |
| Nuke | Siren 6 s, missile for the last 2.8 s, white, front at 105 m/s | Kills every enemy it reaches, bosses within a few frames despite their per-hit cap. Sky, ash, cloud and moonlight stay for 45 s, gone by 70 s |

Two traps, both fixed here, that any new blast or pull should know:

- **`combat.explode` on an exact floor point reaches nobody.** Its line-of-sight ray starts on the floor and stops there. Use `aboveFloor(p)` from `callins/shared.ts`.
- **Rapier drops impulses applied inside its query callback.** Use `BodyQuery`: collect, then push. Resting corpses have no body at all: `BodyQuery.wake` makes gore wake what its budget of 14 allows.

A ragdoll inherits `enemy.velocity` at death, so the nuke sets that just before the killing blow. It is the only throw that moves a whole body evenly.

Strike, overlay and aftermath shaders are compiled at load by unrendered stand-ins on layer 31. three's compile pass only walks visible objects, hence a layer and not `visible = false`. In the last measured run no custom shader compiled during a strike. Standard-material programs still appear on the first bodies of a run: at least some of those are gore's, which `docs/notes/fx.md` already flags.

## The AC-130

Key M, combo 28, cooldown 180 s, ring 34 m. Above the Orbital Lance because it outlasts everything on the ladder, below Chain Storm because two minutes of assist kills are what put Black Sun and the nuke in reach. That leaves 18 and 22 for the helicopters. The cooldown must outlast the 141 s flight, as there is one airframe.

Radius 160, altitude 185, a 33 s lap, drawn at 1.8x. All of it runs on the strike clock except the rounds, which fly on `dt`, so they pile up in SLOWMO like the airstrike's.

| Seconds on station | Line | Firing |
|---|---|---|
| 0 | TWO-FIVE TRACKING | 25mm bursts |
| 24 | FOUR-ZERO ONLINE | Plus 40mm strings of 5 |
| 54 | ONE-OH-FIVE UP | Plus 105mm salvos of 3, Hellfire, 40mm strings of 6 |
| 92 | ALL GUNS | Everything faster, 40mm strings of 8, 105mm salvos of 4 |

| Gun | Target | Rhythm |
|---|---|---|
| 25mm | Nearest with a clear line | 12 rounds a second in bursts. The aim is dragged at 11 m/s and never set, so the stream is seen to walk on and between targets |
| 40mm | Thickest knot | A string laid across the line of fire, 0.3 s apart |
| 105mm | Thickest knot over 9 m from the player | 2.7 s apart, 4.6 s in the air on a real arc, whistle for the last 2 s, bursts 5 m up so a wall does not save the room behind it |
| Hellfire | Most health and armour, bosses first | Drops, lights, dives from above |

Flares every 27 s and on arrival and departure. With nobody in the box for 7 s the 25mm rakes it anyway, so the siege never goes dead. The crew holds fire on anyone who has surrendered: killing a prisoner pays a perk, and that is the player's decision.

**Never harms the player.** Every blast is `selfDamage: 0, playerPush: 0`, and goes through `combat.explode` as a `worldObject`, because that is the only way to stop a shell setting off a map barrel, and a barrel's own blast does hurt. The flag leaves the look and sound to the caller, which is why each gun has its own and no `ExplosionKind` was added. So gunship fire never sets off barrels, on purpose.

**Keep the 49 degrees.** At 33 degrees a 4.2 m wall shadowed most of a 10 m room: 70% of the 25mm and every Hellfire hit a wall. A parabola's mean slope is its chord's, so curving the rounds cannot fix a shallow orbit: the launch would have to point up.

**Arming.** The ship flies outside both maps' invisible walls, so a round live from the muzzle bursts in mid-air on their outer faces. `FireControl.armRange` casts from the aim back up the path and returns how close to the aim the round goes live: just short of a low wall so it strikes, just under anything over 8 m so a roof cannot eat two minutes of fire, and otherwise only as far as the line was tested. It is measured from the start of each step: from the end, the first live step sweeps back through the roof it was meant to skip.

### Building another aircraft

```ts
const frame = new Airframe(materials, scene, SPEC);   // AirframeSpec: build(), rotors, mounts, optional strobe and scale
frame.fly(position, forward, roll);                   // call each frame. Negative roll dips the left wing
frame.update(dt);                                     // spins rotors, blinks the strobe
frame.mount('door', out);                             // a named mount in world space
const path = new OrbitPath(plan);                     // pure function of time: path.at(t), path.heading(t), path.roll(t)
path.begin(center, arriveAtAngle);
const engines = new EngineSound(ctx, plan);           // start(fade), update(position, swell, dt, listener?), stop(fade)
soundPoint(source, listener, range, out);             // one-shots from beyond the distance model, returns the true distance
new Radio(ctx, 'CALLSIGN', color).say('LINE');        // call radio.update(dt) each frame
```

`RotorSpec.axis` is `'y'` for a main rotor and `'x'` for a tail rotor. The Door Gunner's circle is an `OrbitPlan`. `Airframe.root` must stay parented to the scene, because `mount` reads its transform directly.

## The gunner's seats

Keys H and J, no mark to choose. Door Gunner at combo 18, Attack Chopper at 22: past Berserk, because a seat takes the player out of the fight for up to a minute, and the chopper higher because it has a second weapon and a pilot who goes to the fight. Both credit at the strike rate through `ASSIST_SOURCES`.

| | Attack Chopper (Harrow) | Door Gunner (Packmule) |
|---|---|---|
| Time, cooldown | 60 s, 150 s | 45 s, 120 s |
| Flight | `Autopilot`: runs in, circles the thickest knot, reverses every 13 to 26 s | `OrbitPath`, left-hand, centre sliding after the fight |
| Guns | LMB 30mm, 320 rounds at 10 a second. RMB rockets, 38. Both at once | LMB 20 mm rotary cannon, 1000 rounds at 30 a second, 0.5 s spin-up, every other one a tracer. 60 damage a round. Every round bursts where it lands and goes on through 1.4 m of roof or wall: the one gun with both (`docs/notes/weapons.md`, "The door gun"). `?doorgun=old` is the M134: 1800 at 60 a second, 22 a round, neither |
| Zoom | Wheel, x2.5 | RMB, x1.8 |
| Arc | 112 degrees either side of the nose | 69 degrees either side of the door |
| Picture | `thermal` grade: cold grey, only fire keeps colour | The normal grade, hot tracers on the cold map |

**The flight.** Key, 3 s watching it fly in from a chase camera, cut to the seat, fight, cut back, and the aircraft leaves over the next 10 s. E bails out. `GunnerStrike` outlives the seat, so `seat.leave` hands control back at once and the strike carries on until the aircraft has gone. `leave` is the one way out and undoes everything, so every exit is safe: rounds, time, E, death, a new run.

**The body** is parked by `player.park`, on the nearest honest floor if the player was in the air or on a hazard. Nothing can touch it. Enemies keep coming and claw at the wire shell, which is also what the `YOU` tag finds from the air. The player gets 2.5 s of grace on return, because that crowd is still standing there.

**The aim** is yaw and pitch in the world, read from `input.frameLook`. `lock` takes out most of the aircraft's own motion from the line of sight, so the reticle stays on a spot on the ground with the mouse still. Eye and gun both turn about the mount, so the gun holds its place on screen. The horizon takes a share of the bank from the aircraft's up vector, which is why a bank tips the view when looking ahead and pitches it when looking out of a door.

**Guns are world objects,** not viewmodels: they are seen from the ground too, and a tracer leaves the real muzzle. The aircraft flies over the top of the light volume, so they use `materials.nearby`, which has a little emissive. Without it the M134 was a black hole in the picture.

Traps found the hard way:

- **Anything flying needs `Skyline`.** A ray down and one ahead let the Harrow fly 22 m into the Crucible. The height grid is widened by a rotor's reach, and the Harrow reads it along its path and the Packmule around its whole circle, so a lap stays level. Measured clearance is now 18 m and 14 m at worst.
- **The strike runs before `CameraRig`.** A muzzle flash inside 3 m reads the camera's matrix, which was a frame old on a moving aircraft and put the flash metres off the barrel. `seat.update` ends with `camera.syncSeat()`.
- **Blasts near the body are not near the player.** `Combat.blast` shook and flashed the gunner's screen for every shell landing by the parked body, and every kill there splashed lens blood and paid POINT BLANK. `player.parked` now turns all of that off.
- **`clearance` on the Kill House is 5.** The Skyline reads the top of the invisible walls, 26 m, and at any more the pilot climbs to clear them every time he nears the edge.

### Adding a seat

Extend `GunnerStrike` with `fly`, `shoot` and `spent`. Give it a `HeliPlan` and a `Ride`, add a key, and add its source prefix to `ASSIST_SOURCES`. Air-to-air from DESIGN section 17 goes in `GunnerStrike.scan`: while an enemy chopper is up, write it into `fight`.

## Stims

`stims.ts`, numbers in `STIM` (`data.ts`). Health pickups are stims now, in every mode: the `health` pickup kind keeps its id (campaign
drops, the minimap, `pickup_health`) and its look, but collecting one puts a stim in the kit instead of healing. The kit holds 5, and a
run starts with 1. A full kit leaves the pickup lying there (`Pickups.wants`), the way a health pack used to wait at full health, and
kill drops roll a stim far less often while the kit is full. Mega Health is unchanged: a rare map prize that heals 100 past max at
once, and the Commander's bait. It stays because it is a different decision (go out and get it now) from a stim (spend one when you
choose), and the bait trap needs something worth walking into a crossfire for.

The stim key (`stim`, Y by default) injects one: heal 30 (a health pack gave 25; a little more for the second it costs). The injection
is 1 s on the player's clock. `weapons.occupy(1)` stops and blocks fire, aim, reload, melee, grenades and switching, and a cooking
grenade is thrown. `holdSpeed` (the heavy guns' clamp) holds ground speed to 45% of run speed. The heal lands at 0.5 s, when the needle
goes in. Damage does not cancel it; dying does. Refused with `ui_error` and a feed line at full health or with none left. Ignored while
an injection runs, for 0.35 s after one, while seated or while aiming a call-in, so a double press does not spend two.
`stim:inject` starts the off hand's animation (`docs/notes/viewmodels.md`). Sounds: `stim_click` on the press, `stim_hiss` at the heal.

`progression.stims` is the `StimKit` contract: `count`, `max`, `injecting` (0..1 or -1), `give(n)`, `spend()`. **`spend()` is the hook
for reviving an ally** (Outpost Defense piece 2): it takes one stim and does nothing else, returning false when there is none. The
caller plays its own animation and sound. Nothing calls it yet. Test: `stims.test.ts`.

## Pickups

Drops 30% per kill, weighted toward what the player lacks, capped at 24, expire in 28 s. Map items: 3 Mega Health and 3 Heavy Armor on `world.pickupSpots` by a stride that lands on the Kill House deck corners, respawning at 45 s and 35 s. Ambient supply every 10 s. Capsules first at 25 s, then every 32 to 48 s, from a shuffled bag of all ten, 30 s life, at least 35 m away, with a `hud.marker`. Pods every second wave clear, with the unlock order in `CACHE_ORDER`, then full resupply once the arsenal is complete. A weapon's family members (`docs/notes/weapons.md`) come with it and are not in `CACHE_ORDER`: the Harrow, the Thresher and the Quiver are there from the start with the SMG, the shotgun and the rocket, the Rivet arrives in the Judge's cache, and the Piledriver in the cache that brings the Trommel, which `CACHE_ORDER` still calls `buzzsaw`. Key 4 starts with the Sabot. The explosive autocannon is its upgrade and is earned: it is second in `CACHE_ORDER` (Judge, Autocannon, Lance, Buzzsaw, Kiln, Stakegun), so the wave 4 pod brings it and everything after it comes one pod later than before. It was a starting weapon, so it comes early rather than last. `?slot4=old` takes it out of the list and makes it a starting weapon again. `weapons.give` and `setLoadout` do that themselves, so a mission that hands out the SMG hands out the Harrow.

## Tuning knobs

| Want | Change |
|---|---|
| Thresholds | `WINDOWS`, `COMBO_PERKS`, `CALLINS[id].combo`, `CHAIN_REACTION_KILLS`, `OVERDRIVE_MIN_SPEED` |
| Style perk rate | `STYLE_GATE` |
| How far strikes lift the combo | `ASSIST_COMBO_EVERY`, `ASSIST_SOURCES` |
| Which grade wins | `GRADE_RANK` |
| Screen punch per perk | `MINOR`, `MAJOR`, `HUGE` and the `moment` per effect |
| Strikes | `AIRSTRIKE`, `WARTHOG`, `ORBITAL`, `BLACK_SUN`, `NUKE`. The gunship is `AC130` in `callins/ac130Data.ts` |
| The helicopters | `ATTACK` and `DOOR` in `callins/heliData.ts`. Aim hold is `seat.lock`, the thermal picture is `thermal` in `render/post/grades.ts` |
| Score | `SCORE`, `STYLE`, `MULTI_KILLS`. Speed tiers follow the 12.5 run speed |
| Pickups | `PICKUP`, `CAPSULE`, `DROP_POD`, `MEGA`, `REGEN`, `FROST` |

## Verified

`/?sandbox=progression`: 116 of 116, on a simulated clock. Everything below is the real game with real enemies, zero console errors in every run. Scripted runs used a stepped clock, so load cannot change what is on screen.

| Thing | Result |
|---|---|
| All five call-ins, Crucible road, 18 enemies each | Key, cancel keeps the call-in, sky click rejected, click confirms, cooldown runs. Airstrike, Orbital (steered) and Nuke credited 18 of 18, Black Sun 17 or 18. Warthog 5 of 18: the pack crossed the corridor before the shells |
| Kill House | Orbital, Black Sun, Airstrike and Nuke killed 6, 10, 9 and 10 of 10 at 16 m. Warthog not run there |
| Black Sun | Corpses gathered at the hole, thrown from about 10 m to 35 m in 0.8 s |
| Nuke | The pack died about 88 m out and came to rest at 104 m on average, leaving at up to 28 m/s. Sky, cloud and burnt moonlight still up at T+25 |
| All ten powerups | Quad 4x and ends, Haste 1.5x, Vampire +12, Ricochet 3, Shock arced to a second brute, Ghost sends enemies to `lost` past 15 m, Magnet pulled an item in from 26 m, Regen, Frost froze 6 of 6 and the shot one shattered, Time Warp 0.25 then 1 |
| Pickups | Mega 100 to 200 then decays, Heavy Armor +100, Health +25 and left alone at full health. Drops 13 in 40 kills, all on the floor. (Before stims: a health pickup is now one stim) |
| Stims (Test Range, 2026-11-14) | Refused at full health. 28 to 58 at 0.50 s, one stim spent. Fire held through the second: 0 rounds, then 4 in the 0.3 s after |
| Caches | Wave 2 and wave 4 clears each sent a pod. `weapons.give` unlocked Judge then Lance (before the autocannon went second in the list) |
| Perks | Sentinels killed 10 of 10, Chain Storm 10 of 12 by arc, Chain Reaction 9 of 10 by blast, Butcher severed, Skyfall slam, Overdrive follows speed, Adrenaline 1.45x at 3 stacks |
| Reset | Nuke sky, four strikes, ten effects, a pod and a capsule, then death, then a new run: every modifier neutral, time scale 1, grade neutral, moon restored, no extra scene objects, and nothing landed in the next 9 s |
| High score | 7725 in localStorage, read back after a reload. Now one per contract: see `docs/notes/contracts.md`. `op2_highscore` is The Crucible's |
| AC-130, Kill House, real AI, stationary player, 6 extra enemies every 12 s (`tools/scripts/ac130-live.mjs`, `AC_MODE=full`) | 75 kills: 25mm 34, 40mm 24, 105mm 9, Hellfire 8. Wall hits: 25mm 52 of 653, 40mm 8 of 82, Hellfire 0 of 7, 105mm 5 of 11. All 37 radio lines in order. Airframe hidden at the end, cooldown still running |
| AC-130 never harms (`AC_MODE=safe`, Range) | Mortal player, husks only, in the box for 145 s: 106 kills, health 100 to 100, nothing from the ship reached `takeDamage`, all 13 pushes were husk melee. Run before the 105 bubble went from 14 m to 9 m, which does not touch the blast spec |
| AC-130 on the Crucible (`AC_MODE=roof`) | Under a 4 m Transit roof, final build: 96 kills in 100 s, with rounds arriving inside it. Scrapyard: 96 kills. The ship set off no barrels in either run, while Sentinels set off 3 nearby in an earlier one |
| AC-130 reset (`AC_MODE=reset`) | New run with six rounds in the air: airframe and rounds gone on the reset frame, no explosion or radio line in the next 12 s, cooldown 0, no strike left |
| AC-130 frame cost | All of progression during the siege: median 0.1 ms, p99 0.9 ms, worst 3 ms |
| Seats, full flights (`tools/scripts/seat-live.mjs`, a bot holding the sight on enemies) | Door Gunner, Kill House: 1800 rounds, WINCHESTER, control back, 16 kills. Attack Chopper, Crucible: 37 kills, combo to 19. Both maps and the Range, no console errors |
| Seat flying | Harrow on the Crucible: 56 m from the fight on average, bank to 27 degrees, clearance at worst 18 m. Packmule: 44 m, 17 degrees, 14 m |
| Seat safety (`SEAT_MODE=safe`) | Mortal player, husks on the body, every round fired: no damage event, health 100, then 18 m walked and 22 rounds fired on the real gun. Any later hit logs as `parked=false grace=0` |
| Seat exits (`SEAT_MODE=exits`), final build | E, death, new run and quit to menu all leave the body free, the panel gone and the gun drawn. Pause froze the clock and the seat carried on after resume |
| Seat frame cost, Crucible, Retina | Strike 0.2 ms, panel 0.07 ms, the x-ray pass 0.6 ms. Whole frame 7.6 ms CPU, not firing. Held fire measured 24.6 ms at 30 fps, against 12.9 on foot with nothing happening: that is explosions and ragdolls, and it is not a like-for-like comparison. Kill House, firing the M134: 16.7 ms frames at the median, 33 at p95 |

## Known limitations

- **The Hellfire grade is too strong for this map, and only the render owner can fix it.** `gain [1.34, 0.86, 0.46]` multiplies a world lit cyan, which has no red to lift, so lit floors go teal and pale areas tan. That is the wash from `playtest-t15.png`. Ranking SLOWMO above it fixes the pair, but Hellfire alone still looks like that. Suggested: pull `gain` toward neutral and use `isolate` to keep orange, as Berserk does. Blood Thirst turns blue into pink for its whole 10 s in the same way, milder.
- **The HUD hint during steering** is the one in `CALLINS.orbital`, which covers both stages.
- **Air-to-air from `DESIGN.md` section 17 is not built,** because no enemy chopper exists to fight. See "Adding a seat". Nothing can shoot the helicopters down either.
- **Nobody has flown a seat with hands.** Aim hold, sensitivity at zoom, pacing and how the bail key sits are all unjudged. The kill counts are a bot that cannot miss by aiming, and they say little about a person.
- **Neither helicopter has a sound of its own.** Rotors are `drone_rotor_loop` pitched down, the door gun plays the Trommel's loops (the `minigun_*` ids, rewritten for a 20 mm gun and turned to its 30 rounds a second), the cannon is the autocannon pitched up. None of it has been listened to.
- **Rounds aimed outward over a near wall still burst on the invisible containment.** The -0.36 rad pitch stop covers the map itself. Nothing tells a ray an invisible wall from a real one, and the fix is a flag from the world owner.
- **The sonar key still works in a seat.** It pings from the parked body and does nothing useful. One test of `player.parked` in `contracts/sonar.ts` would stop it.
- **The parked body still collects pickups** that land on it.
- **The nuke ring shows 90 m,** but the front reaches the whole map. There is no truthful ring for that.
- **Only 14 ragdolls simulate at once,** so a big pile feeds the Black Sun a few bodies at a time. Corpses past the budget stay down.
- **A swarm siege can carry the combo a long way by itself.** The half rate is the same as every strike, but it was built for strikes that last seconds. On the Crucible, with extra spawns and Sentinels and Chain Storm also running, a player who never fired reached combo 70 and earned Black Sun and the nuke. If that feels cheap, the place to change it is `ASSIST_COMBO_EVERY` or a rate for this source.
- **Gunship splash can still execute a prisoner,** which pays Geneva Suggestion: 4 to 8 grants a run with nobody else shooting. The crew only avoids aiming at them. `onExecuted` in `index.ts` has no `ASSIST_SOURCES` test, and one would close it.
- **Gunship hits tick the player's hit marker** for the whole two minutes, because `Combat.blast` and `audio/reactions.ts` do that for every player-team source. Harmless for a 3 s strike. Over a siege it may blur the player's own hit feedback.
- **The targeting HUD says DANGER CLOSE and turns the ring red** when the player stands in the box, though the ship cannot hurt them. On the Kill House that is nearly always. `Targeting.drawPreview` and `dangerClose` exclude the nuke the same way, a one-line change each.
- **The gunship has no sound of its own.** The engines are `drone_rotor_loop` at two low pitches, the 25mm is `enemy_minigun_loop` pitched down, and the rest are existing ids. A real turboprop drone and gun reports need recipes in `src/audio`.
- **Nobody has played this with hands.** Every result is a script or a bot, and nothing here has been listened to. The pacing numbers are one run each. Frame time on the first strike of a run was not measured.
- **Skyfall and the speed tiers depend on `player.grounded` and `player.speed`** as the player system reports them. `wallRunning` counts as airborne for Skyfall.
