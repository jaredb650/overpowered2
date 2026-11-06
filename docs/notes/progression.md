# Progression: streaks, perks, call-ins, powerups, pickups, score

`src/progression/`. `createProgression(ctx)` from `index.ts`. Sandbox: `/?sandbox=progression`.

| File | What it is |
|---|---|
| `data.ts` | Every number. Tune here |
| `index.ts` | The kill flow: counters, ladder, style gate, assists, frame update, reset |
| `perks.ts` | Activation, countdowns, stacking, the one writer of `weapons.modifiers` and `player.modifiers`, grade choice |
| `counters.ts` | `TimeWindow` (sliding) and `Combo` (gap-based) |
| `score.ts` | Scoring, style labels, multi-kills, high score |
| `chains.ts`, `frost.ts`, `sentinels.ts` | Chain Storm and Chain Reaction, Frost Nova, the drones |
| `callins/manager.ts` | Ownership, cooldowns, keys, the holster, running strikes |
| `callins/targeting.ts` | Aim solve, confirm, cancel, the Warthog drag |
| `callins/ground.ts` | `GroundRing`, `GroundStrip` and `GroundProbe` |
| `callins/bodies.ts` | `BodyQuery`: bodies in a ball, and waking resting corpses |
| `callins/airstrike.ts`, `warthog.ts`, `orbital.ts`, `blacksun.ts`, `nuke.ts` | The strikes. `ordnance.ts` is the hero missiles |
| `pickups/pickups.ts`, `pods.ts`, `models.ts` | Drops, map items, capsules, drop pods |

## Public API

The contract is `ProgressionSystem` in `core/gameplay.ts`. Nothing was added to `gameplay.ts`.

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

SLOWMO: hits on one head inside 0.35 s count once. At 20 rounds a second a burst is not three good shots.

**Assist kills.** Kills from `ASSIST_SOURCES` (the five strikes, sentinels, Chain Storm, Chain Reaction, drop pods) pay score and drops and keep the combo alive, but climb it at half rate and feed no perk window. Before this one Airstrike was worth up to 30 rungs, and a nuke's own bodies fired Berserk, Hellfire and Overdrive at once.

**Measured pacing**, real waves, real time, from the first kill. "Human" is a bot with 0.3 s reaction, aim error and eased turning. Still better than most people, and one run each.

| Bot | Perks in the first 15 s | Berserk | Best combo |
|---|---|---|---|
| Perfect aim, before | 5 | | |
| Perfect aim, now | 3 | 51 s | 17 |
| Human-like, now | 2 | 30 s | 16 |

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
| Black Sun | Grows 1 s, pulls to 6.2, collapses, implodes at 6.75 | Dragged by the feet, walls hold them, crush within 3.5 m from T+2.6. Corpses orbit at 10 m. Implosion radius 28, bodies leave at about 55 m/s. Uses `finisher`, so the nuke keeps its own recipe |
| Nuke | Siren 6 s, missile for the last 2.8 s, white, front at 105 m/s | Kills every enemy it reaches, bosses within a few frames despite their per-hit cap. Sky, ash, cloud and moonlight stay for 45 s, gone by 70 s |

Two traps, both fixed here, that any new blast or pull should know:

- **`combat.explode` on an exact floor point reaches nobody.** Its line-of-sight ray starts on the floor and stops there. Use `aboveFloor(p)` from `callins/shared.ts`.
- **Rapier drops impulses applied inside its query callback.** Use `BodyQuery`: collect, then push. Resting corpses have no body at all: `BodyQuery.wake` makes gore wake what its budget of 14 allows.

A ragdoll inherits `enemy.velocity` at death, so the nuke sets that just before the killing blow. It is the only throw that moves a whole body evenly.

Strike, overlay and aftermath shaders are compiled at load by unrendered stand-ins on layer 31. three's compile pass only walks visible objects, hence a layer and not `visible = false`. In the last measured run no custom shader compiled during a strike. Standard-material programs still appear on the first bodies of a run: at least some of those are gore's, which `docs/notes/fx.md` already flags.

## Pickups

Drops 30% per kill, weighted toward what the player lacks, capped at 24, expire in 28 s. Map items: 3 Mega Health and 3 Heavy Armor on `world.pickupSpots` by a stride that lands on the Kill House deck corners, respawning at 45 s and 35 s. Ambient supply every 10 s. Capsules first at 25 s, then every 32 to 48 s, from a shuffled bag of all ten, 30 s life, at least 35 m away, with a `hud.marker`. Pods every second wave clear, with the unlock order in `CACHE_ORDER`, then full resupply once the arsenal is complete.

## Tuning knobs

| Want | Change |
|---|---|
| Thresholds | `WINDOWS`, `COMBO_PERKS`, `CALLINS[id].combo`, `CHAIN_REACTION_KILLS`, `OVERDRIVE_MIN_SPEED` |
| Style perk rate | `STYLE_GATE` |
| How far strikes lift the combo | `ASSIST_COMBO_EVERY`, `ASSIST_SOURCES` |
| Which grade wins | `GRADE_RANK` |
| Screen punch per perk | `MINOR`, `MAJOR`, `HUGE` and the `moment` per effect |
| Strikes | `AIRSTRIKE`, `WARTHOG`, `ORBITAL`, `BLACK_SUN`, `NUKE` |
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
| Pickups | Mega 100 to 200 then decays, Heavy Armor +100, Health +25 and left alone at full health. Drops 13 in 40 kills, all on the floor |
| Caches | Wave 2 and wave 4 clears each sent a pod. `weapons.give` unlocked Judge then Lance |
| Perks | Sentinels killed 10 of 10, Chain Storm 10 of 12 by arc, Chain Reaction 9 of 10 by blast, Butcher severed, Skyfall slam, Overdrive follows speed, Adrenaline 1.45x at 3 stacks |
| Reset | Nuke sky, four strikes, ten effects, a pod and a capsule, then death, then a new run: every modifier neutral, time scale 1, grade neutral, moon restored, no extra scene objects, and nothing landed in the next 9 s |
| High score | 7725 in localStorage, read back after a reload. Now one per contract: see `docs/notes/contracts.md`. `op2_highscore` is The Crucible's |

## Known limitations

- **The Hellfire grade is too strong for this map, and only the render owner can fix it.** `gain [1.34, 0.86, 0.46]` multiplies a world lit cyan, which has no red to lift, so lit floors go teal and pale areas tan. That is the wash from `playtest-t15.png`. Ranking SLOWMO above it fixes the pair, but Hellfire alone still looks like that. Suggested: pull `gain` toward neutral and use `isolate` to keep orange, as Berserk does. Blood Thirst turns blue into pink for its whole 10 s in the same way, milder.
- **The HUD hint during steering** is the one in `CALLINS.orbital`, which covers both stages.
- **`DESIGN.md` section 13's AC-130, Attack Chopper and Door Gunner are not built.** They were not in this brief, and `CallInId` has no entries for them.
- **The nuke ring shows 90 m,** but the front reaches the whole map. There is no truthful ring for that.
- **Only 14 ragdolls simulate at once,** so a big pile feeds the Black Sun a few bodies at a time. Corpses past the budget stay down.
- **Nobody has played this with hands.** Every result is a script or a bot, and nothing here has been listened to. The pacing numbers are one run each. Frame time on the first strike of a run was not measured.
- **Skyfall and the speed tiers depend on `player.grounded` and `player.speed`** as the player system reports them. `wallRunning` counts as airborne for Skyfall.
