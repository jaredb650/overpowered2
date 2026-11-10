# Audio notes

Owned files: `src/audio/**`, `src/sandbox/audio.ts`, `public/audio/sfx/**`, `public/audio/ost/**`, `tools/music/**`, `docs/CREDITS.md`. The ids below are stable. `src/audio/audio.test.ts` fails if this list
falls behind the catalogue, or if any call site in `src/` uses an id that does not resolve.

## How to call it

```ts
ctx.audio.play('smg_fire');                                      // 2D (the player's own sounds)
ctx.audio.play('impact_metal', { position: hitPoint });          // 3D, distance filter and reverb are automatic
ctx.audio.play('vox_pain', { position, pitch: 1.2, pitchJitter: 0.1, volume: 0.8 });
ctx.audio.playOneOf(['vox_grunt', 'vox_pain'], { position });
const h = ctx.audio.startLoop('minigun_fire_loop', { volume: 0.9 });  // h.setVolume / setPitch / setPosition / stop()
h.stop(0.15);                                                    // fade seconds; safe to call twice
ctx.audio.duck(0.7, 2);                                          // manual music duck, rarely needed
```

Rules that matter when choosing an id:

- Omit `position` only for sounds that belong to the player's own body or to the UI. Everything else is 3D.
- Unknown ids log once and do nothing. They never throw. Every call is safe before unlock and before anything has loaded.
- The same id twice on one frame collapses to one voice (pellet impacts allow a few). Call freely; do not throttle.
- Ids with variants (see "x4") pick a variant themselves, avoiding the last one used. Do not number them.
- Volume is already balanced per id. Pass `volume` only to scale for gameplay reasons. 1 is the catalogue level.
- `impact_${surface}` exists for every `SurfaceKind`, `pickup_${kind}` for every `PickupKind`, `powerup_${id}` for
  every `PowerupId`, `perk_${id}` for every `PerkId`, so these can be built from strings.

## Handled automatically (do not play these yourself)

Audio reads `ctx.player`, `ctx.time`, `ctx.world` and listens to events, so nobody else has to:

- Music: `run:start` to easy, `wave:start` with wave >= 10 to hard, `game:state` menu and gameover to menu, pause to pause. Which
  track plays, and where the tracks come from, is under "Music". How the game's own tracks are made is under "Original soundtrack".
- Zone reverb and ambience beds, slow-mo pitch and filter (follows `ctx.time.slowmo`), low-health filter and heartbeat.
- Speed wind, slide loop, wall-run scrape, slam fall whistle: these follow the player's state each frame.
- Ducking: big ids carry their own duck. Calling `duck()` is only for moments with no big sound.
- When a run ends, every loop in the world fades out, whoever started it. The owner's handle goes dead, which is safe.
- `src/audio/reactions.ts` plays what follows from an event and has no other owner:

| Event | Sound |
|---|---|
| `fx:casing` | `casing_brass` (rifle a little lower), `casing_shotgun`, `casing_heavy`. Volume follows strength. Quiet bounces thin out under 50 ms apart |
| `enemy:hit` from the player | `hit_marker`, `hit_marker_head`, `hit_marker_armor`. Skips fire ticks |
| `enemy:hit` from a round of the player's own guns (`bullet`, `pellet`) on a body | `hit_punch` at the hit and `hit_confirm` in 2D, weighted by the round and played at the end of the frame. A machine gets a quieter, lower `hit_punch` and no confirm, and a kill has `hit_marker_kill` in place of the confirm. See "Body hits" |
| `enemy:killed` from the player | `hit_marker_kill` |
| `enemy:severed` on flesh | `bone_snap`, `flesh_tear` and `blood_spurt` under the enemies system's `limb_sever` |
| `enemy:killed` | `blood_splatter` and `blood_spill` on a gib, `head_pop` and `vox_gurgle` on a head kill |
| `gore:impact` | See "Landings" below |
| Burning enemies, nearest 4 in 50 m | `flame_burn_loop`, following the body |
| `combo:changed` to 0 from 3 or more | `combo_break` |
| `player:damaged` | `armor_hit`, `armor_break` when it runs out |
| `player:healed`, small steps | `heal_tick` |
| `game:state` | `ui_open` and `ui_close` around pause, `game_over` |
| Every 14 to 32 s, 22 to 45 m away | `metal_groan` in the Core, Foundry and Transit, `steam_burst` in the Refinery |

## Layered ids

One call, all layers start on the same audio frame.

| Id | Layers |
|---|---|
| `headshot` | `enemy_headshot` + `enemy_headshot2` + `enemy_headshot3`, at the original 0.75 / 0.5625 / 0.75 ratio. See "Headshot" below |
| `autocannon_shot` | `autocannon_fire` cut at 500 ms + `autocannon_fire2` in full, as in the first game |
| `hellfire_rocket_blast` | `rocket_explosion` + `hellfirerocket_explode` |
| `sword_contact` | `sword_flesh` |
| `machine_hit` | `machine_clang` cut at 220 ms, before its ring. A living drone or skitter struck |
| `perk_berserk` | `perk_berserk1` + `perk_berserk2` + `perk_berserk3` all at once, 0.4 / 0.6 / 0.4 as in the first game |
| `thresher_fire` | `shotgun_fire` at pitch 0.86, cut at 420 ms, volume 0.9 + `thresher_punch`. The drum shotgun: the pump's voice, lower and short enough for five a second |
| `quiver_fire` | `rocket_fire` at pitch 1.3, cut at 450 ms, volume 0.7 + `quiver_tube`. One tube of the four-barrel launcher |
| `blade_dash` | `sword_sweep` at pitch 1.35, cut at 300 ms. The katana's dash out of a run |
| `knife_swing` | `sword_swing` at pitch 1.5, cut at 160 ms, volume 0.55. The Shiv's cut and thrust, played lower for the thrust |
| `club_swing` | `sword_swing` at pitch 0.7, cut at 300 ms. The Prybar and the Cosh, the Cosh played at 1.1 to 1.3 |
| `spade_swing` | `sword_sweep` at pitch 0.62, cut at 500 ms. The Spade, face and edge |
| `knife_flesh` | `sword_flesh` at pitch 1.4, cut at 280 ms + `hit_punch` at 1.3, half volume |
| `club_hit` | `hit_punch` at 0.82 + `impact_metal` at 0.62, cut at 180 ms, a third volume. The bar on a body |
| `club_plate` | `metal_clang` at 0.9, cut at 300 ms + `hit_punch` at 0.7. The bar on armour |
| `spade_flat` | `hit_punch` at 0.66 + `metal_clang` at 0.72, cut at 420 ms. The face of the spade on anything |
| `spade_wall` | `metal_clang` at 0.8, cut at 500 ms + `impact_concrete` at 0.8 |
| `baton_hit` | `hit_punch` at 1.12 + `wet_slap` at 0.85, a third volume |

`ctx.audio.layer([{ id, volume, pitch, offset, delay, duration }, ...], options)` builds your own stack.

**Headshot.** The first game started `enemy_headshot3` at `currentTime = 1.0` to skip its leading silence. Here the load-time
trim does that for every caller, so no one passes `offset`, and passing one would skip the sound itself. Measured from the file
and from the live buffer in the real game: the silence ends at 0.80 s, not 1.0 s, and 0.80 s is what is cut. The 1.0 s skip also cut
the attack, which starts at 0.81 s and peaks at 0.71 by 0.85 s, entering at 0.46 instead. So the layer now hits harder than the
first game's, and the part the first game played lands 0.2 s later. Set `offset: 0.2` in a `layer` to hear the original. The three
samples have `perFrame: 1` because Combat plays `headshot` and gore plays the three layers on the same frame, and without it one
kill stacks twice.

## Landings

`gore:impact` is `{ position, strength, kind }`, declared in `src/gore/impacts.ts`. `reactions.ts` turns it into sound:

| Kind | Sound | Above strength 0.55, also |
|---|---|---|
| `body` | `body_fall_metal` on metal, grate or armor, otherwise `body_fall_concrete` | `flesh_slosh`. Above 0.7, three in ten also get `body_drag` |
| `limb` | `limb_thud` | `wet_slap` |
| `head` | `head_thud` | `wet_squelch` |
| `organ` | `wet_squelch`, or `organ_splat` above 0.55. About a third leave a `blood_drip` | |

Under gore's tempo dial (`?raggrav=`, `docs/notes/gore.md` Forces) a body falls slower and lands slower, so gore reports a body's, a limb's
and a sliced half's landing as it would have been at full gravity: `strength` and which landings are heard do not change with the dial.
Chunks keep world gravity and report as they land. `ImpactTuning` itself is untouched.

Volume runs 0.35 to 1 with strength, and pitch falls as strength rises. Only a `body` asks what it landed on, with one ray. A pile of bodies is capped
four ways: gore allows 6 events a frame, `reactions.ts` hears 9 a second with a burst of 5 and nothing past 55 m, the `flesh` family holds 6
voices, and thinning takes the rest when the mix is crowded.

## Body hits

A player's round on a living body is three layers, all starting on the frame of the hit:

| Layer | Who plays it | What it is | Where |
|---|---|---|---|
| `bullet_body` (`machine_hit` on a drone or skitter) | `Combat.strike` | The material: the owner's wet hit, or a plate clank | 3D, near 8 m, far 110 m (`machine_clang`: 10 m, 150 m) |
| `hit_punch` | `reactions.ts`, from `enemy:hit` | The weight: the `limb_thud` recordings pitched up, a 120-400 Hz punch with a 5 ms attack | 3D, near 12 m, far 160 m |
| `hit_confirm` | `reactions.ts`, from `enemy:hit` | The confirmation: `wet_slap`'s 1-4 kHz crunch. Flesh only, and not on a kill | 2D |

Only `bullet` and `pellet` rounds from the player's own guns (`WEAPONS`) get the second and third, and those are strikes Combat plays aloud.
Sentinels and call-ins keep Combat's layer alone, so they never spend the gap a trigger pull needs. `reactions.ts` holds the frame's hit and
plays it from `update`, which runs after Weapons and Combat, so every pellet of a trigger pull has landed by then. A headshot is left to
`headshot`: it drops a body hit held on its frame, whichever pellet came first, and holds off body hits for one gap after. Combat's wet layer
still plays for a body pellet on that frame, as it always has. A blocked round is `impact_armor` alone. On a kill `hit_marker_kill` is the 2D
confirmation, as it already stood in for `hit_marker`, and the punch keeps the killing round's weight. A sever keeps its own layers on top.

**The dead.** Corpses and loose limbs (`gore/index.ts`) are struck on the same frames as the living, often by the same pellets, so they have
ids of their own and cannot take a living hit's start on the frame or its voices. Flesh gets `corpse_body` on every round, which is the old
`bullet_body` (`flesh` family, near 5 m, far 55 m, 0.42) at the old 0.4, or 0.3 on a limb. Under it, `corpse_punch` (the `limb_thud`
recordings, `flesh` family, priority 3, 2 voices) at 0.5 and pitch 1.3, or 0.4 and 1.5 on a limb, only for the player's guns. A wreck gets
`metal_clang` cut at 220 ms under the world's voices, from any source. The punch and the clank are spaced `CORPSE_KNOCK_GAP`, 70 ms, so a
rotary cannon's sweep over a pile of bodies is a beat like it is on the living.

**Weight.** `hitWeight` in `reactions.ts` reads the round's damage and push: 0 is 12 damage (the Buzzsaw's round, before it became the Trommel), 1 is 240 (a full Lance, a
stake), on a log scale. A pellet counts as four, because a shotgun blast is one hit to the ear and only its first pellet is played. Push
counts double, so a point-blank shotgun lands as one of the heaviest things in the game. Damage powerups make every round heavier.
`bodyHitLevels` turns the weight into levels. Heavier is louder and lower, and a lower punch is a longer one.

| Round | Weight | `hit_punch` volume, pitch | `hit_confirm` volume, pitch | Gap |
|---|---|---|---|---|
| A light round, 13 pushing with 6 (the old Buzzsaw; nothing fires it now) | 0.03 | 0.64, 1.54 | 0.56, 1.11 | 113 ms, about 9 a second of 50 |
| Trommel, 32 pushing with 34 | 0.58 | 0.96, 1.26 | 0.81, 0.99 | 70 ms, about 14 a second of its 25 |
| Piledriver, 90 pushing with 48 | 0.69 | 1.02, 1.20 | 0.86, 0.97 | 70 ms, every round of its 8 |
| SMG, 25 | 0.25 | 0.76, 1.43 | 0.66, 1.07 | 70 ms, every round |
| Shotgun, 20 a pellet | 0.63 | 0.99, 1.23 | 0.84, 0.98 | 70 ms, one hit a blast |
| Judge, 120 | 0.77 | 1.07, 1.17 | 0.90, 0.95 | 70 ms |
| Stakegun, 140 and push 110 | 0.97 | 1.18, 1.06 | 0.99, 0.91 | 70 ms |
| Full Lance, point-blank shotgun, autocannon shell | 1 | 1.20, 1.05 | 1.00, 0.90 | 70 ms |

A machine's `hit_punch` is 0.6 of that and 0.85 of the pitch, under the clank. Catalogue levels: `bullet_body` 0.38 (was 0.42, played at
0.8, so 1 dB louder up close), `hit_punch` 0.38, `hit_confirm` 0.15, `machine_clang` 0.42.

**Why hits were quiet.** Measured from the files with `analyze.ts`, mixed as the engine mixes them:

- Distance. `bullet_body` had `flesh`'s curve, near 5 m and far 55 m: 0.50 of point blank at 10 m, 0.23 at 20 m, 0.125 at 30 m, 0.064 at
  40 m, nothing past 55 m. Most fights are 10 to 40 m away.
- Level. Played at 0.8, and a mono 3D voice in front plays 3 dB down, so even point blank was 2.8 dB under the SMG shot. At 30 m it was
  20.9 dB under.
- Band. 64 to 75% of its energy is under 120 Hz, which laptop speakers barely play and where the SMG puts 62% of its own. Only 6 to 18% is
  in 120-400 Hz, which is the band the SMG leaves open (7%).
- Attack. 42 to 65 ms to reach 90% of peak, while the gun's 15 ms attack starts on the same frame. Its onset was inside the shot.
- Variants. Loudness 0.17 to 0.40 across the six, 7 dB apart under one level.
- Voices. It was in the `flesh` family with 15 landing packs, 6 voices between them. In a crowded mix a landing in the previous 90 ms
  thinned a hit as a repeat, and hits past about 35 m fell under the floor. Gunfire was not stealing them: it plays from the 2D pool,
  and only narrows the 3D budget by the few voices it holds.
- Machines got the flesh sample.

**After.** Perceived loudness (`loudness` in `analyze.ts`) against the SMG shot, all layers mixed, a 3D voice in front at -3 dB. No reverb or air
filter. dB:

| | 3 m | 10 m | 20 m | 30 m | 40 m | 60 m |
|---|---|---|---|---|---|---|
| Before, any round | -2.8 | -8.9 | -15.7 | -20.9 | -26.8 | silent |
| A light round, weight 0.03 (the old Buzzsaw) | -1.2 | -2.4 | -6.8 | -9.1 | -10.2 | -11.3 |
| SMG | -0.5 | -1.5 | -5.5 | -7.8 | -8.9 | -9.9 |
| Shotgun | +0.7 | +0.1 | -3.7 | -5.8 | -6.9 | -7.9 |
| Judge | +1.1 | +0.6 | -3.2 | -5.3 | -6.4 | -7.3 |
| Stakegun | +1.7 | +1.2 | -2.5 | -4.5 | -5.5 | -6.4 |

Every hit stays under its own gun: the shotgun shot is +4.3 dB and the Judge's +7.6 dB on this scale. `hit_confirm` alone is -10.6 dB for the
SMG and -7.0 dB for a stake, and the `headshot` stack is +3.7 dB, so a headshot still stands over any body hit. In the first 80 ms, where shot
and hit start together, an SMG hit at 30 m sat 18 to 26 dB under the shot in every band. It now sits 4.8 dB under in 120-400 Hz and 5.3 dB
under in 1-4 kHz, which is audible over it.

**Voices.** The three packs and `machine_clang` have no family, so landings cannot thin them or take their voices, and each allows one
start a frame: six pellets make one wet layer, one punch and one confirm, not six transients. A second wet layer on the blast's frame added
only level: at 4 m with music on it took the limiter to 1 to 3 dB of reduction on most blasts. Offline, a point-blank blast's pre-limiter
peak with one wet layer is back to what it was before body hits had layers (0.72 at worst over 400 blasts, against 0.84 before and 0.99 with
two). `reactions.ts` plays a living hit at most once a gap. Priorities: `bullet_body` and `machine_clang` 5, `hit_punch` 6, `hit_confirm` 7,
over landings and the dead (3 and 4) and under blasts and the headshot (8 and up). None is critical. `hit_confirm` plays from the 2D pool and
starts at 0.09 or more, over the full-mix floor of 0.04, so nothing thins it. Sustained SMG fire into bodies costs about 3 more voices than
before (`bullet_body` dropped from 4 voices to 3, its tail past 300 ms is under -30 dB).

`machine_clang` is `metal_clang`'s build under its own id. Doors, shutters, snares, a vehicle's ram and a wreck being shot play
`metal_clang` itself, which keeps the `impact` mix it always had (0.46, near 5 m, far 80 m, family `impact`).

**Kills and headshots.** Louder body hits leave less room over them. On the report's numbers, an SMG kill at 10 m (its punch, wet and
`hit_marker_kill`) is about 2 dB over a plain hit, where it was about 4 dB, and the in-game run measured a kill 1.5 dB over a hit against 6 dB
before, and a headshot 2.8 dB over against 7.7 (one to four events each). Taking the confirm off a kill clears `hit_marker_kill`'s 2D slot
but does not buy back level. Getting the old margin back would take a quieter hit or a louder kill marker, which then crowds the headshot.
That is a call for the owner's ears.

**How it was measured.** The MP3s were decoded with `afconvert` to 48 kHz float, cut by the bank's own silence trim, pitched by linear
resampling, matched with `trimFor`, mixed at the levels above and read with `analyze.ts`. The numbers for the untouched files agree with
`tools/out/audio-report.json` to 1% (`smg_fire` 0.439 against 0.444, `bullet_body` 1 0.398 against 0.397). `src/audio/audio.test.ts` repeats the
level sums from the report's measurements of the same recordings.

## Original samples

Id is the file name without extension. Aliases in brackets are the first game's keys, so its code reads across.

- **Weapons:** `smg_fire` (shoot), `smg_reload` (reload), `shotgun_fire` (shotgun), `rocket_fire` (rocket),
  `autocannon_fire`, `autocannon_fire2`, `autocannon_zoom`, `sword_swing` (swordSwing), `sword_hit1` (swordHit1),
  `sword_hit2` (swordHit2), `sword_slam` (swordSlam)
- **Perk shot layers:** `bloodthirsty_shot` (bloodthirstyShot), `berserk_shot` (berserkShot), `hellfire_shot` (hellfireShot)
- **Explosions:** `rocket_explosion` (rocketExplosion), `hellfirebullet_explode` (hellfireBulletExplode),
  `hellfirerocket_explode` (hellfireRocketExplode), `30mmshell_explode`, `enemy_explode` (enemyExplode)
- **Bullets:** `bullet_hit1`, `bullet_hit2`, `bulltet_hit3` (bullet_hit3), `bullet_hit4`, `bullet_whizz`,
  `30mmShell_flyBy` (30mmshell_flyby)
- **Enemies:** `enemy_hit` (enemyHit, playerHit), `enemy_grunt` (enemyGrunt), `enemy_die` (enemyDie),
  `enemy_deathgrunt` (enemyDeathGrunt), `enemy_headshot`, `enemy_headshot2`, `enemy_headshot3`, `enemy_shoot` (enemyShoot)
- **Call-ins:** `walkietalkie_fire` (walkieTalkieFire), `airstrike_activate` (airstrikeActivate), `warthog_flyby`
- **Perks:** `perk_bloodthirsty`, `perk_hellfire`, `perk_berserk1`, `perk_berserk2`, `perk_berserk3`, `perk_adrenaline`,
  `perk_slowmo`, `perk_airstrike` (camelCase keys also work, e.g. perkSlowmo)
- **Player:** `player_footstep1`, `player_footstep2`, `player_footstep3`, `player_jump`, `player_land`, `slide_ground`
- **UI:** `menu_select`
- **Unnamed in the first game:** `222`, `3333`, `asdf`, `frfff`

Random-pick groups: `bullet_hit` (the four samples), `sword_hit`, `player_footstep`.

## Sample packs

Real recordings from free libraries. Sources, authors and licences for every file are in `docs/CREDITS.md`. One id holds all its variants, and pitch
jitter sits on top. Each pack names a synthesized fallback, played if its files are missing or have not landed yet. Levels are matched
to the synth gore at load.

| Id | Variants | Fallback |
|---|---|---|
| `body_fall_concrete` | 5 | `body_thud` |
| `body_fall_metal` | 5 | `body_thud` |
| `limb_thud` | 5 | `gib_land` |
| `head_thud` | 4 | `body_thud` |
| `wet_slap` | 5 | `gib_land` |
| `organ_splat` | 5 | `gib_squelch` |
| `flesh_slosh` | 4 | `gib_squelch` |
| `wet_squelch` | 4 | `gib_squelch` |
| `bone_snap` | 4 | `bone_crack` |
| `flesh_tear` | 4 | `limb_sever` |
| `blood_drip` | 4 | `blood_spurt` |
| `blood_splatter` | 4 | `blood_splat` |
| `body_drag` | 3 | `body_scrape` |
| `bullet_body` | 6 | `blood_splat` |
| `hit_punch` | 5, the `limb_thud` recordings | `body_thud` |
| `hit_confirm` | 4, `wet_slap` 1 to 4 | `gib_land` |
| `corpse_body` | 6, the `bullet_body` recordings | `blood_splat` |
| `corpse_punch` | 5, the `limb_thud` recordings | `body_thud` |
| `sword_flesh` | 3 | `limb_sever` |
| `blood_spill` | 3 | `blood_spurt` |

## Synthesized catalogue

Rendered at load. x4 means four rendered variants behind one id.

### Weapons

- **Judge:** `revolver_fire` x3, `revolver_cock`, `revolver_open`, `revolver_load`, `revolver_close`, `revolver_ricochet` (the head-to-head ricochet)
- **Harrow, Rivet, Sabot:** `harrow_fire` x3 (rifle: crack, chest thump, a tail), `rivet_fire` x3 (pistol: all crack and slide), `sabot_fire` x2 (the cannon with a tearing dart and no shell at the far end)
- **Thresher:** `thresher_punch` x3 (the layer under `thresher_fire`: a chest punch and the bolt slamming home 50 ms on), `drum_out`, `drum_in` (a steel drum with shells rattling in it)
- **Quiver:** `quiver_tube` x3 (the layer under `quiver_fire`: a pop and a short tearing hiss), `quiver_load` x2 (a round into a tube, four a reload), and the seeker, all on the reward mix so they cut through a fight: `quiver_arm` (the trigger goes down), `quiver_lock` (one per mark, played at a pitch that rises 0.16 a mark), `quiver_full` (every mark laid), `quiver_cancel` (right click let go of the marks)
- **Lance:** `lance_plasma` x3 (a tap: the plasma ball leaving, a falling chirp over a soft thump), `railgun_charge_loop` (the charge: started at 0.42 of its pitch and bent up to 1 with the charge itself, so it is the rising tone and then the hum held at full), `lance_stage` (one tick as the charge reaches each stage, played 0.26 higher each time, on the reward mix), `railgun_ready` (the last stage), `railgun_fire` (the beam; a weaker stage plays it higher and quieter), `lance_thunder` x2 (the clap over a full beam: a crack, then two seconds of rolling thunder), `railgun_beam` (fading beam hum, one-shot), `railgun_fizzle` (right click let the charge go), `plasma_burst` x3 (a ball landing, or one link of the chain a beam leaves at every body it struck: a snap, a low thump and a sizzle, 3D, six voices, two starts a frame). `railgun_charge` (one-shot rise, 1.6 s) is the old gun's, heard only with `?lance=old`
- **Trommel (the 20 mm rotary cannon on key 8, id `buzzsaw`; the helicopter's door gun plays the same five):** `minigun_spinup` (the drive taking up the load, 0.9 s), `minigun_spin_loop` (barrels turning, written at full speed; `Weapons` turns its pitch from 0.45 to 1 and its level with the spin, so the rise is heard on the loop itself), `minigun_fire_loop` (25 rounds a second, each a crack, a report and a blow falling from 150 Hz to 55; its pitch follows the gun's rate, so it winds up into the roar), `minigun_spindown` (1.1 s of run-down from full spin and the cluster stopping; started part way in for a gun let go part way up), `minigun_fire` x3 (the last round and its roll-off, played as the barrage stops)
- **Cannon bursts:** `cannon_burst` x4 (a 20 mm round going off where it lands: a dry crack and a knock, 0.1 s, in 3D at the burst, up to 5 voices)
- **Piledriver (the heavy machine gun on key 8):** `piledriver_fire` x3 (a crack over a 56 Hz blow that takes 0.2 s to go, the bolt running home after it), `piledriver_charge` (the charging handle hauled back and let go, in its reload)
- **Kiln:** `flame_ignite`, `flame_loop`, `flame_stop`, `flame_burn_loop` (a burning body, 3D)
- **Stakegun:** `stake_fire`, `stake_reload`, `stake_hit_wall`, `stake_hit_flesh`, `stake_twang`
- **Grenades:** `grenade_pin`, `grenade_throw`, `grenade_bounce` x3, `grenade_explode` x2
- **Reload foley:** `reload_mag_out`, `reload_mag_in`, `reload_bolt`, `reload_shell_in` x3, `reload_pump`, `reload_rocket`, `reload_cell`
- **Handling:** `weapon_dry`, `weapon_draw`, `weapon_draw_heavy`, `weapon_draw_blade`, `weapon_holster`
- **Casings:** `casing_brass` x4, `casing_shotgun` x3, `casing_heavy` x3
- **Sword extras:** `sword_block` (raise guard), `sword_deflect` x3 (bullet blocked), `sword_windup` (heavy charge), `sword_sweep` (RMB area sweep)
- **Sentinels:** `sentinel_fire` x3, `sentinel_orbit_loop`

### Impacts and destruction

- **Surfaces:** `impact_concrete`, `impact_metal`, `impact_grate`, `impact_dirt`, `impact_glass`, `impact_flesh`, `impact_armor`, `impact_energy`, `impact_lava`, all x4
- **Ricochet:** `ricochet` x4, `bullet_flyby` x3 (near miss, complements `bullet_whizz`)
- **Explosions:** `explosion_barrel` x2, `explosion_tank`, `explosion_small` x3, `explosion_distant` x2, `explosion_debris` x3
- **Debris:** `glass_break` x3, `metal_clang` x4 (doors, shutters, snares, rams, a wreck being shot), `machine_clang` x4 (the same plate
  for a living machine being shot, through `machine_hit`), `concrete_crumble` x3

### Bodies

`limb_sever` x4, `bone_crack` x4, `gib_squelch` x4, `blood_splat` x4, `flesh_slice` x3, `head_pop` x3, `body_thud` x4,
`gib_land` x4, `blood_spurt` x3, `body_scrape`, `frozen_shatter` x3, `freeze_crackle`, `char_sizzle` x2

### Player

- **Movement:** `dash` x3, `double_jump`, `wall_kick`, `wallrun_start`, `wallrun_loop`, `slide_start`, `slide_loop`, `slide_stop`, `slam_start`, `slam_fall_loop`, `slam_impact` x2, `slam_bounce`, `mantle`, `jump_pad`, `land_hard`, `speed_wind_loop`
- **Hands and boots on a move, all quiet:** `hand_plant` x3 (ledge, cover, wall, the floor in a slam and a tenth of a second into a slide), `boot_scuff` x3 (top of a climb, far side of a vault, walking off an edge), `vault_over` (the body passing over cover), `gear_rustle` x3 (double jump tuck, hard landing). Played from `src/player/feedback.ts` through `body()`, which is silent under `?moveanim=0`: they are the sounds of the first-person body and go with it. `vault_over` stays, because the vault has its own switch
- **Footsteps:** `footstep_concrete`, `footstep_metal`, `footstep_grate`, `footstep_dirt`, `footstep_glass`, `footstep_flesh` (wet), all x4. `footstep_armor`, `footstep_energy` and `footstep_lava` alias to the nearest of these, so every `SurfaceKind` works
- **Health:** `player_hurt` x4, `player_hurt_heavy` x2, `player_death`, `armor_hit` x3, `armor_break`, `shield_hit` x3, `heal_tick`, `low_health_warn`, `heartbeat`, `heartbeat_loop`

### Enemies

- **Voices (formant synthesis, use `pitch` for size):** `vox_grunt` x4, `vox_pain` x4, `vox_scream` x4, `vox_death` x4, `vox_alert` x4, `vox_gurgle` x3, `vox_husk_growl` x4, `vox_husk_snarl` x3, `vox_brute_grunt` x3, `vox_stalker_hiss` x3, `vox_leaper_shriek` x3, `vox_bomber_cackle` x2, `vox_burner_breath` x2, `vox_warden_chant` x2, `vox_juggernaut_roar` x2, `vox_radio` x4 (trooper chatter), `vox_choke` x2 (headless or gut-shot)
- **Guns:** `enemy_pistol` x3, `enemy_smg` x3, `enemy_shotgun` x2, `enemy_minigun_loop`, `enemy_rocket_fire`, `sniper_charge`, `sniper_fire`, `sniper_laser_loop`
- **After a flashbang:** `ear_ring`
- **Melee:** `enemy_swing` x3, `enemy_lunge` x2, `enemy_blade` x3
- **Specials:** `riot_shield_hit` x3, `riot_shield_break`, `warden_shield_up`, `warden_shield_loop`, `warden_buff`, `bomber_beep`, `bomber_tank_hiss_loop`, `burner_flame_loop`, `enemy_spawn`, `armor_plate_off` x3, `leaper_pounce`, `leaper_cling`
- **Machines:** `drone_rotor_loop`, `drone_gun` x3, `drone_alert`, `drone_crash`, `skitter_legs_loop`, `skitter_step` x4, `skitter_chirp` x3, `skitter_explode` x2
- **Vehicles (`synth/recipes/vehicles.ts`):** `truck_engine_loop`, `tank_engine_loop`, `tank_tracks_loop`, `tank_turret_loop`, `tank_turret_stop`, `tank_lay`, `tank_cannon` x2, `track_snap`, `mounted_gun` x3, `gunship_gun` x3, `gunship_rotor_loop`, `gunship_turbine_loop`, `heli_rotor_loop`, `heli_turbine_loop`, `ac130_prop_loop`, `mortar_whistle` x3, `mortar_tube` x2, `lights_out`, `gunship_stricken`, `vehicle_horn`, `vehicle_fuel_leak`, `vehicle_explode` x2, `wreck_land` x2
- **Juggernaut:** `juggernaut_step` x3, `juggernaut_charge`, `juggernaut_slam`, `juggernaut_armor_break`
- **Titan:** `titan_step` x3, `titan_roar` x2, `titan_stomp`, `titan_limb_break`, `titan_fall`, `titan_charge`, `titan_beam_loop`

### Perks, call-ins, powerups

- **Perk stingers:** `perk_bloodthirst` (= `perk_bloodthirsty`), `perk_sentinels`, `perk_chainStorm`, `perk_butcher`, `perk_skyfall`, `perk_chainReaction`, `perk_overdrive`, `perk_warthog`, `perk_end`
- **Call-ins:** `callin_ready`, `callin_target_loop`, `callin_confirm`, `callin_cancel`, `callin_denied`, `missile_incoming` x3, `orbital_charge`, `orbital_beam_loop`, `orbital_strike`, `blacksun_open`, `blacksun_loop`, `blacksun_implode`, `nuke_siren`, `nuke_incoming`, `nuke_blast`, `nuke_tail`, `siren_loop`
- **Chain Storm:** `lightning_arc` x4, `lightning_strike` x3, `electric_buzz_loop`
- **Powerups:** `powerup_quad`, `powerup_haste`, `powerup_vampire`, `powerup_ricochet`, `powerup_shock`, `powerup_ghost`, `powerup_magnet`, `powerup_regen`, `powerup_frostNova`, `powerup_timeWarp`, `powerup_end`, `powerup_spawn`, `powerup_idle_loop`, `vampire_drain`, `magnet_pull`, `frost_nova_blast`, `time_warp_in`, `time_warp_out`
- **Pickups:** `pickup_health`, `pickup_ammo`, `pickup_armor`, `pickup_megaHealth`, `pickup_heavyArmor`, `pickup_weaponCache`, `pickup_grenade`, `pickup_generic` (the first game's 400/800/1200 Hz steps). `pickup_quad` and the other powerup kinds alias to `powerup_*`
- **Weapon cache:** `cache_incoming`, `cache_land`, `cache_open`, `weapon_unlock`

### Progress and UI

- **Waves:** `wave_start`, `wave_start_hard`, `wave_clear`, `wave_tick`, `boss_alarm`, `boss_intro`, `boss_death`
- **Score:** `combo_tick` (pass `pitch` for rising combos), `combo_tier`, `combo_break`, `multikill`, `style_bonus`, `score_tick`, `highscore`, `game_over`
- **Sonar:** `sonar_ping`
- **Hit markers:** `hit_marker`, `hit_marker_head`, `hit_marker_kill`, `hit_marker_armor`
- **UI (ui bus, never slowed):** `ui_hover`, `ui_click`, `ui_back`, `ui_tick`, `ui_toggle`, `ui_slider`, `ui_error`, `ui_open`, `ui_close`, `ui_type`, `ui_confirm`

### World

`jump_pad_idle_loop`, `barrel_hiss_loop`, `crusher_slam`, `crusher_rise`, `electric_floor_loop`, `electric_zap` x3, `lava_loop`, `lava_burn`, `steam_burst`, `metal_groan` x3, `alarm_klaxon`, `amb_core`, `amb_foundry`, `amb_refinery`, `amb_scrapyard`, `amb_transit`, `amb_ring`. The `amb_*` beds run themselves.

## Music

Three lists: `menu`, `easy` (a run's early waves) and `hard` (from wave 10). Each is built at load from two manifests of the same
shape, `{ "menu": [{ "file", "title" }], "easy": [...], "hard": [...] }`:

| Manifest | What it lists | In the repo | On the public site |
|---|---|---|---|
| `public/audio/ost/manifest.json` | The game's own soundtrack, `public/audio/ost/<list>/<slug>.mp3` | Yes, with the files | No: emptied, and the files removed, by `.github/workflows/pages.yml` before the build |
| `public/audio/music/manifest.json` | The owner's placeholder songs, which are commercial releases | The manifest only. `.gitignore` ignores everything else under `public/audio/music` | Emptied by `.github/workflows/pages.yml` before the build |

So this machine plays both and a push carries only the game's own tracks. **The public site plays no music at all**: the owner decided
on 2026-11-10 that it ships silent until the soundtrack is finished and heard, so the Pages build empties both manifests and deletes
the track files from the build. To let the public site play the game's own tracks again, take the two `ost` lines out of the
"No music on the public site" step. Vite copies `public/`
as it is and the player asks for both manifests under `import.meta.env.BASE_URL` (`./`), so the Pages build needs nothing else.

Rules that must stay true:

- Nothing under `public/audio/music` except its manifest is ever committed. `src/audio/music.test.ts` asks git.
- A track of the game's own lives in `public/audio/ost` and is put in that manifest by the renderer (`tools/music/render.ts`), never
  by hand into the placeholder manifest.
- Either manifest may be missing, empty or broken, and the other still plays.

**Order** (`playlist.ts`). The game's tracks and the placeholders take turns, each from its own shuffle bag, starting with one of the
game's. The same track never plays twice running unless it is the only one there is. At load the player asks the server for one
song of the placeholder manifest (a `HEAD` request, `sampleFile` in `playlist.ts`). If it is not there, or the answer is an HTML
page, the placeholders are left out for the session: that is a clone, which has the manifest and none of the songs, and it plays
the game's own tracks with no failed requests. A single file that will not load on a machine that has the rest is dropped for the
session after one attempt. A list with nothing in it borrows another (`FALLBACK`: easy from hard then menu, hard from easy then menu, menu from easy then
hard), and two states that share a list keep the track that is playing. That is why the public site, which has only menu tracks
until the run tracks are written, plays the menu tracks through a run.

**Flags.** `?music=ost` plays only the game's own tracks and never asks for the placeholder manifest, which is how to hear what the
public site will play. `?music=local` plays only the placeholders.

**Track name.** When a track really starts to sound, audio emits `music:track` `{ state, title, file, original }` (declared in
`music.ts`). The HUD shows the name top centre for 7 s, over the menu and in a run (`ui/hud/nowplaying.ts`): `OST` for the game's own,
`LOCAL` for a placeholder.

**Tracks.** Both menu tracks are rendered by `tools/music` from the song files named here. Numbers are ffmpeg's `ebur128` on the MP3.

| List | Title | File | Song file | Tempo, key | Length | Loudness, range, true peak |
|---|---|---|---|---|---|---|
| menu | Blue Hour Briefing | `audio/ost/menu/blue-hour-briefing.mp3` | `tools/music/songs/blue-hour-briefing.ts` | 172 BPM, F minor | 3:01, 3.37 MB | -8.4 LUFS, 7.9 LU, +1.7 dBFS |
| menu | Clerical Violence | `audio/ost/menu/clerical-violence.mp3` | `tools/music/songs/clerical-violence.ts` | 184 BPM, A minor | 3:10, 3.17 MB | -8.0 LUFS, 7.1 LU, +1.8 dBFS |

The menu placeholder they sit beside measures -7.9 LUFS, 7.1 LU, +1.9 dBFS.

## API

`createAudio(ctx)` returns an `AudioEngine`, which implements `AudioSystem` in `src/core/contracts.ts`: `play`, `playOneOf`, `layer`,
`startLoop`, `duck`, `music`, `setVolumes`, `setListener`, `unlock`, `has`. `LoopHandle` has `alive`, `setVolume`, `setPitch`,
`setPosition`, `stop`, and every method is safe after the voice is gone. `startLoop` returns a dead handle if the id has not rendered
yet, so anything started in the first seconds of a boot should retry on `!handle.alive`.

For tests and sandboxes only: `opened` and `ready` promises, `stats()`, `buffersOf(id)`, `levelOf(id)`, `leadTrim`, `setRoom(id)`,
`mixerForTests`, `musicForTests`.

For the F4 overlay: `window.__op2.audio` is `stats()`, and `window.__op2.stats().audio` is one line:

```
running clock 1.00 under 0% | voices 31/40 step 0 hrtf 1 loops 3 | thinned 212 refused 4 | duck 0.12 limit -3.8 dB
```

Read from left to right: the context's state, audio seconds per wall second, share of audio lost to underruns, voices in use against the budget,
the load step, then what the mix gave up. `debug.ts` shows only the fields it names, so the overlay needs one line added there by its owner:
`` `audio    ${stats.audio ?? '-'}` ``.

## Budget

`budget.ts` holds the rules. A healthy fight sits under 60% of the budget and none of this happens.

| When | What gives way, in order |
|---|---|
| Mix over 60% of the budget | Non-critical sounds below a rising level floor (`thinnedQuiet`), then repeats within a family (`thinnedRepeat`) |
| Budget spent | The weakest voice is cut for a stronger sound, or the weaker sound is refused (`droppedBudget`) |
| A family or id at its cap | Its weakest or oldest voice is retriggered, or the sound is refused (`droppedFamily`) |
| The render thread falling behind | The load governor drops from 40 voices to 28, then 18, and takes HRTF away. Voices past the budget fade out, one a frame. Six clean measurements, 12 s, give one step back |

**Critical** sounds skip every row above. They are the player's guns and gun loops, hit markers and other reward blips, headshot layers and `head_pop`, stingers,
the player's own hurt, and UI. A critical sound is never refused and never thinned, and only another critical sound can take its voice.

Priorities are in `MIX` in `mix.ts`, with the bands written out there.

## How it loads

Nothing blocks the boot, and nothing has to wait for a sound.

1. The first `AudioContext` in a page blocks the main thread while the browser starts its audio service: 1.0 to 1.5 s here. The
   constructor calls `enumerateDevices()`, which starts that same service without blocking, and the context is made when it answers
   (or after 6 s). The context then takes under 10 ms. Until then every public method is a safe no-op that remembers music state,
   volumes and unlock.
2. `SoundBank` (`bank.ts`) does the rest as small jobs in `requestIdleCallback`: rooms first, then 75 sample ids, then 513 recipe variants
   in `renderRank` order: every id's first variant in a tier before spares, tiers by what a run reaches first.
3. Jobs that find no idle time run anyway after 250 ms during the boot and 60 ms after it, so loading always finishes.
4. A sound played before it has rendered is skipped and jumps the queue. `stats().missed` counts these.

## Tuning knobs

| Want | Change |
|---|---|
| Balance between kinds of sound | `MIX` in `mix.ts`, then `over` on a recipe or the third argument of `sample()` |
| Voice budget, what counts as overload | `VOICE_BUDGETS`, `CLOCK_FLOOR`, `UNDERRUN_CEILING`, `CALM_WINDOWS` in `budget.ts` |
| How early and how hard a crowded mix thins | `THIN_FROM`, `FULL_FLOOR`, `FULL_REPEAT_GAP` in `budget.ts` |
| Pool sizes, HRTF | `VOICES_3D`, `VOICES_2D`, `VOICES_UI`, `HRTF_VOICES`, `HRTF_RANGE` in `AudioEngine.ts` |
| What must never drop | `critical` on a class in `mix.ts`, or in `over` on one sound |
| How many landings are heard | `LANDING_RATE`, `LANDING_BURST`, `LANDING_RANGE` in `reactions.ts`, `flesh` in `mix.ts` |
| Limiter, music level | `limiter` settings and `MUSIC_TRIM` in `mixer.ts` |
| Slow-mo filter, duck speed | `Mixer.update` |
| Room size | `ROOMS` in `reverb.ts`. `t60` is low, mid, high. `MAX_IMPULSE` is the longest tail |
| Distance | `attenuation`, `airCutoff`, `wetness` in `voices.ts`. Per sound: `near`, `far`, `send` |
| When health starts to sound bad | `HEALTH_DULL_START`, `HEALTH_DULL_FULL` in `foley.ts` |
| Crossfades | `FADE_INTO`, `TRACK_FADE` in `music.ts` |
| Which track comes next, what an empty list borrows | `Playlist`, `FALLBACK` in `playlist.ts` |
| How long the track name shows | `SHOWN` in `ui/hud/nowplaying.ts` |
| A track's loudness, ceiling, master EQ | `master` in its song file under `tools/music/songs`, then render it again |
| Largest MP3 a track may be | `MAX_BYTES`, `MAX_KBPS` in `tools/music/render.ts` |
| Load speed against load cost | `RENDER_THREADS`, `DECODE_THREADS`, `*_PATIENCE_MS` in `bank.ts`. Order: `RENDER_TIERS` in `catalog.ts` |
| Casing density, hit marker spacing | `CASING_GAP`, `MARKER_GAP` in `reactions.ts` |
| How heavy each round lands, body hit levels and spacing | `hitWeight`, `bodyHitLevels`, `HIT_GAP` in `reactions.ts`. Voices: `BODY_HIT` and the three packs in `catalog.ts`, `machine_clang`'s `over` |
| Rounds into the dead | `corpseSound` and `CORPSE_KNOCK_GAP` in `gore/index.ts`. Voices: `corpse_body` and `corpse_punch` in `catalog.ts` |

## Testing

```
npx vitest run src/audio
node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-report.mjs --wait 500   # writes tools/out/audio-report.json
node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-sheets.mjs --wait 200 --w 1248 --h 672
node tools/shot.mjs --url "/?sandbox=audio" --wait 30000                                                     # every id in order, then polyphony load
AS_LABEL=x node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/audio-stress.mjs --wait 1000 --timeout 178   # the real game under fire, writes tools/out/audio-stress-x.json
node tools/shot.mjs --url "/" --script tools/scripts/music-live.mjs --out tools/out/music/live.png --dpr 2 --w 1440 --h 900 --wait 1000 --timeout 170 --quiet   # the soundtrack: both manifests, the public build's one, the order, the track name
npx vitest run src/audio/music.test.ts          # playlist rules, and that the placeholder songs cannot be committed
npx vitest run tools/music/engine/engine.test.ts   # the offline renderer
node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-cost.mjs --wait 500 --timeout 175     # what each piece of the graph costs
```

**The soak is the test that matters.** The sandbox can only show that the rules work. Only the real game, with a moving player, shows what the
render thread pays. Read `underrunShare` and `clockRate`, not voices. Do not tap the graph with an AudioWorklet to measure it: that moves rendering to a worklet
thread and read as 99% capacity on an idle game. `tools/shot.mjs` runs Chrome with `--mute-audio`, so output goes to a fake device. Underruns are real there,
but nobody can hear them.

The tests read `tools/out/audio-report.json` for the level and envelope of every real render, and skip that part if the file is missing.
Run the report after changing a recipe.

## What was failing, and how it was found

The owner said the audio gave up in a big fight. It did, and the cause was none of the usual suspects.

**Cause.** Chrome renders a context's whole graph on one thread. Each frame, `update()` wrote `setTargetAtTime` to every moving 3D voice's filter, gain and
send, and `.value` to the panner and listener positions. All of those params were a-rate, the default. One automation event on an a-rate param puts Chrome on
its sample-accurate path: the biquad recomputes its coefficients for each of 128 samples and the panner its azimuth for each. A moving listener does that
to every panner at once. Measured offline, 48 moving voices cost 0.57 of real time, 0.88 with stereo sources, against 0.05 for the same voices standing still and 0.09
moving at k-rate.

**How it degraded.** Past about 35 voices with a moving player, on a machine with anything else to do, the thread needed more than a buffer's length for each buffer, so every callback came in late.
`ac.playbackStats` counts that as an underrun, about 170 a second, and a real device plays it as crackle. The audio clock then ran slow, down to 0.38 of real
time. Sounds lasted longer in real time while the game kept asking at the same rate, so voices rose to 70 and the thread fell further behind. That is the giving up.
It cleared when the shooting stopped or the machine freed up, so it came and went with the fight.

**Why the old numbers looked clean.** The sandbox's voices stood still with a still listener, so nothing was ever automated and the expensive path was never reached.
It also counted voices and level, which stay fine. It never read underruns or the clock.

**Ruled out, with logs.** Allocator starvation: 20 refusals in 130 s, and no must-play id was ever refused. Limiter or duck stuck low: both recover to 0 in a pause.
NaN at the output: 0 reads. Output going silent: 0 of 148 reads while firing. Loop leaks: 2 to 7 loops, stable. Voice leaks: voices fall to 1 in a pause. Context suspended
or interrupted: it stayed running. The 4x clipper: 0.1% of real time, so it stays. Node growth: `AudioBufferSource` nodes pile up to a few thousand and go at each
garbage collection, which is how they are meant to work.

**The fix.** Every param a frame writes is now k-rate, including the listener's. 3D voices fold to mono at their first node, with level compensated. HRTF lives on 3 fixed voices rather than being
switched per play, which rebuilt the panner under the render thread's lock. Distance is rewritten at 15 Hz per voice and only past a 3% change. Pools went from 48+32+10 to 32+18+6, under a budget of 40.
Impulses stop at 4 s. See "Budget" for what happens when the mix is full anyway.

## Measured

All in real Chrome at the harness's low priority, on the M1, in the real game unless it says otherwise.

Before and after, from `tools/scripts/audio-stress.mjs`, bot firing the SMG and Buzzsaw with perks, up to 48 enemies. Other agents shared the machine in every run, and it was busier for the
after runs: load average 29 to 40, against 13 to 27. The after runs also had music playing, and this before run did not.

| Firing, no CDP | Before | After |
|---|---|---|
| Seconds with over 3% underrun | 50 of 73 | 1 of 27, and 1 more on resuming from hidden |
| Underrun events in the run | 8748 | 261 and 631, in two runs |
| Slowest audio clock | 0.38 | 0.97, and 0.74 for one second on resume |
| Voices, mean and peak | 45, 69 | 31, 38 |
| Must-play sounds refused or thinned | 0 | 0 |
| Limiter, mean and worst | -6.5, -11.6 dB | -4.8, -10.5 dB |

With CDP on and music playing, render capacity fell from a mean of 0.82 and peak of 0.998 to 0.75 and 0.90. That run kept only 12 samples, because CDP's stream of node events delays
`page.evaluate`. An idle game reads 0.10 and a bare oscillator 0.004. Capacity in a real fight reads far higher here than the offline cost says, because this machine is shared and
nice 19. Read it as relative. The soak's "smg" phase is deliberately past anything a player reaches: 200 to 300 sound starts a second.

Pause, then a hidden tab, then back: voices drop to a few in a pause, the limiter and duck return to 0, the context goes to `suspended` and back to `running`, and sound continues. Requests made during the forced
hidden phase count as `notRunning`, and a really hidden tab does not ask.

A soak cannot run past 3 minutes here. Nothing in the logs grows with time, but an hour-long session has not been run.

| What | Result |
|---|---|
| First `AudioContext`, cold | 1020 to 1465 ms blocking. After the warm-up, 5 ms |
| Audio's blocking setup in a real boot | 14 to 17 ms, down from about 1400 ms |
| Sounds ready when the run starts | 279 of 279 synth ids, 68 of 68 sample ids |
| Main-thread load work | 1.3 to 1.5 s, nearly all in idle gaps. 48 to 139 ms of it was forced during the boot. Longest job 45 to 91 ms |
| Plays lost to a sound not being ready | 0 |
| Warnings past Nyquist | 0, from 18 recipes that asked for 22 to 58 kHz |
| Per frame in a fight | `update` 0.12 ms average, 1.7 ms worst. `play` 0.18 ms average |
| Buffers in memory | 121 MB, 553 s of audio |
| Unknown ids in a fight | 0. Static scan of `src/`: 0 |
| Casings, 18 s fight | 139 to 192 bounces became 76 to 86 sounds |
| Slow-mo at 0.25 | `rocket_fire` rate 0.25, `perk_slowmo` rate 1, `amb_core` rate 0.25, music low-pass 420 Hz, all back to 1 and 20 kHz afterwards |
| Duck on `hellfire_rocket_blast` | Music gain 0.45 at 250 ms |
| Low health at 19 of 100 | Low-pass 1520 Hz, `heartbeat_loop` rate 1.39, limiter untouched by it |
| Music | Menu on splash click, easy on Play, hard at wave 10 (0.10 / 0.90 crossfade 0.6 s in), menu on quit and on game over. Pause holds the track at 51.40 s and resumes from there |
| Soundtrack, this machine (`music-live.mjs`) | Nothing plays before the first click. After it a track of the game's own starts, 2.5 s of audio in 2.5 s, peak 0.64 to 0.80 at the deck in its first seconds. Menu list of 3 (2 of the game's): nine tracks in a row alternate game, placeholder, with no repeat. Easy 13 and hard 11, all placeholders, play as before |
| Soundtrack, placeholder manifest emptied as the public build does | Menu list is the 2 game tracks, which alternate. Easy and hard are empty and borrow them. No placeholder file is requested. Zero console errors |
| `?music=ost` | Lists hold only the game's tracks. The placeholder manifest is not requested |
| Track name | `OST Clerical Violence` top centre over the menu, opacity 1 two seconds in. In a run (`?autostart=1`) the `LOCAL` chip shows top centre at opacity 1, clear of the wave counter and the minimap |
| A clone: placeholder manifest, no songs (`tools/out/ost-fix/live.mjs`, every placeholder MP3 answered with Vite's HTML page) | One `HEAD` request for one song, then menu 2 of the game's tracks, easy and hard 0. Menu to easy to hard to menu keeps the playing track with 0 ms of silence. No failed loads, no warnings |
| Rooms | Each of the six zones sets its room and bed. T60 measures 3.7 / 6.7 / 1.7 / 0.8 / 2.7 / 1.0 s for core, foundry, refinery, scrapyard, transit, ring |
| Beds from real player state | `wallrun_loop` 0.36 on a real wall run. `slide_loop` 0.28. `speed_wind_loop` 0.50 at 42 m/s. `slam_fall_loop` 0.37 at -57 m/s. All stop with the state |
| Output in the soak | Peak 0.97 after the limiter and clipper. No NaN, no silent read while firing |
| Sample packs | 56 files, 0.38 MB. No clipped sample. First sound within 3 ms of the start. Lengths 0.13 to 1.2 s. Mix level 0.06 to 0.18, against 0.10 to 0.22 for the synth gore around them |
| `enemy_headshot3` | 0.799 s cut from the live buffer in the real game. Peak 0.71 kept |

## Original soundtrack: writing a track

Owned files: `tools/music/**`, `public/audio/ost/**`. A track is a TypeScript file that describes the song: patterns, notes,
automation. `tools/music/render.ts` runs it through an offline synth and sequencer in plain Node and writes the audio. Every sound
is synthesized. There are no samples, no network, and no dependencies beyond `tsx`, with `ffmpeg` and `lame` for files.

```
nice npx tsx tools/music/render.ts <slug>                  # whole song: MP3 into public/audio/ost/<list>/, its manifest line,
                                                           # WAV, report (.json) and spectrogram (.png) in tools/out/music
nice npx tsx tools/music/render.ts <slug> --draft          # whole song, nothing written under public/
nice npx tsx tools/music/render.ts <slug> --bars 24:40     # only those bars (end exclusive): seconds, for working on a part
nice npx tsx tools/music/render.ts <slug> --solo sub,pad   # only those tracks. Add --pic for a spectrogram of a part
nice npx tsx tools/music/analyze.ts <file> [--bpm n] [--pic]   # the same measurements for any audio file
# Flags may come before or after the slug.
nice npx vitest run tools/music/engine/engine.test.ts --testTimeout=60000
```

`tools/music/songs/<slug>.ts` default-exports `() => Song`. A slug starting with `_` never ships (`_selftest` is one of everything
the engine makes). Start from `blue-hour-briefing.ts`, which is the plainer of the two.

### Rules that must stay true

- **Same file, same bytes.** Nothing reads the clock or `Math.random`. Random choices come from `song.rng(label)` or a `seed`.
- **Positions on the timeline are beats, lengths given to instruments are seconds.** `song.bar(b, beat)` is a position in beats
  (bars count from 0), `song.s(beats)` is seconds. Notes inside a `line` are seconds from the start of that line.
- **Clips that are synthesized per note are added as functions**, `track.add(beat, () => tone(...))`, so they are made only when
  the track is mixed. A song never holds more than a few full-length buffers. Give a `key` when the same clip repeats (a drum hit,
  an arp note) and it is rendered once per track. Pre-rendered one-shots (`const K = kick()`) are added directly.
- **Effects work in place on stereo buffers.** An effect on a track is `(buf, ctx) => void`. Anything that follows the song uses the
  factories on `Song` (`duck`, `filter`, `vol`, `gate`), which line up with the bars even in a partial render.
- **The low end is one mono voice at a time.** One sub track, ducked by the kick, and everything else high-passed above it. The
  master makes everything under 120 Hz mono.
- **The master lands on `master.target` LUFS by itself.** Do not chase loudness with track faders. Read the limiter line of the
  report: a mean over about 1.5 dB or a maximum over about 4 dB means the mix is being crushed and needs balancing, not more push.
- **No samples, no downloads, no melodies from existing songs.** Reference tracks are measured, never copied.
- **Do not hand-edit `public/audio/ost/manifest.json`.** The renderer owns each song's line.

### The shape of a song file

```ts
import { Song, midi, line, chordOf, kick, snare, hits, breakKit, breakLoop, chop, reverb, type Patch } from '../engine';

const PAD: Patch = { osc: [{ wave: 'saw', voices: 7, detune: 17, spread: 0.9 }], amp: { a: 0.4, d: 1, s: 0.85, r: 1 },
  filter: { type: 'lp', cutoff: 2400, q: 0.6 }, hp: 250, gain: 0.16 };

export default function build(): Song {
  const song = new Song({ title: 'My Track', slug: 'my-track', list: 'easy', bpm: 150, bars: 112, key: 'A minor', master: { target: -7 } });
  const { s, bar } = song;
  song.section('intro', 0, 16);                               // named in the report, with its own level and band balance
  const hall = song.bus('hall', b => reverb(b, { decay: 3 }), -4);

  const drums = song.track('drums', { gain: -2 });            // a group: other tracks play into it
  const K = kick({ freq: 50, drive: 3 });
  const one = song.track('kick', { out: drums, gain: -3 });
  const kicks: number[] = [];
  for (let b = 16; b < 48; b++) for (const { step, level } of hits('x...x...x...x...')) {
    one.add(bar(b, step / 4), K, { gain: level });
    kicks.push(bar(b, step / 4));
  }
  const pad = song.track('pad', { gain: -6 }).send(hall, -8).fx(song.duck(kicks, { depth: 0.5, release: 0.2 }));
  for (let b = 0; b < 48; b += 4) pad.add(bar(b), () => chordOf(PAD, ['A3', 'C4', 'E4', 'G4'].map(midi), s(16)));
  return song;
}
```

### Timeline (`engine/song.ts`)

| | |
|---|---|
| `new Song({ title, slug, list, bpm, bars, key?, tail?, seed?, master? })` | `list` is `menu`, `easy` or `hard` and decides the folder and manifest list. `tail` is seconds of ring-out after the last bar, 2 by default |
| `song.bar(b, beat?)`, `song.s(beats)`, `song.rng(label)` | Beats at the start of bar `b`. Seconds. A seeded random stream (`next`, `bi`, `range`, `int`, `pick`, `chance`) |
| `song.track(name, { gain, pan, out, mute })` | `gain` is the fader in dB. `out` is another track to play into (a group), which then runs its own effects over the sum |
| `track.add(beat, clip, { gain, pan, key })` | `clip` is a buffer or a function returning one. `gain` is linear |
| `track.fx(...effects)` | Inserts, in order, before the fader |
| `track.send(bus, dB)` or `track.send(bus, lane)` | After the fader. A lane is linear gain |
| `song.bus(name, effect or [effects], dB)` | A send return into the master. Use reverbs and delays at their default `mix: 1` here |
| `song.lane([[beat, value, curve?], ...])` | Automation. `curve` says how the value arrives at that point: `lin` (default), `exp` (for Hz), `ease`, `hold`. `lane.at(beat)` reads it, for per-note values |
| `song.duck(beats, { depth, attack, hold, release, curve })` | Sidechain pump from a list of beats (the kicks). `depth` 0..1 |
| `song.filter(mode, hzOrLane, q, poles?)`, `song.vol(lane)`, `song.gate(pattern, stepBeats, { floor, duty, mix })` | A swept filter, level automation, a rhythmic gate locked to the grid |
| `song.section(name, fromBar, toBar)` | For the report only |
| `song.master` | `target` (LUFS), `ceiling` (dB, -1), `hp` (26), `monoBelow` (120), `eq` (bands), `glue` (a compressor or null), `clipKnee` (dB under the ceiling where the clipper starts, 0 for off), `width`, `limiter` |

The master chain is: mono lows, high-pass, EQ, glue compressor, gain to reach the target, soft clipper at twice the sample rate,
look-ahead limiter. The gain is found by trial, so the result is within 0.1 LU of `target`.

### Pitched sounds (`engine/synth.ts`)

A `Patch` is oscillators into a filter into an amp envelope. `line(patch, notes, opts)` plays a list of notes as one continuous
voice, `tone(patch, note, seconds, vel)` is one note, and `chordOf(patch, notes, seconds, vel, { strum })` stacks several. The same
three exist for FM as `fmLine`, `fmTone` and `chordOf` with an `FmPatch`.

| Patch field | |
|---|---|
| `osc: [{ wave, level, semi, cents, voices, detune, spread, pw, pwm, reset }]` | `wave`: `saw`, `square`, `pulse`, `tri`, `sine`, `noise`, band-limited. `voices` with `detune` (cents) and `spread` (0..1 stereo) is unison: 7 voices is a supersaw. `reset` starts every note at phase 0, for basses and acid |
| `amp: { a, d, s, r }` | Seconds, and sustain 0..1 |
| `filter: { type, cutoff, q, env, shape, key, lfo, drive, vel }` | `type`: `lp`, `hp`, `bp`, `notch` (state variable, 12 dB) or `ladder` (24 dB, saturating, `q` 0..1 is resonance). `env` is octaves of sweep by `shape`, an envelope of its own. `key` is key tracking, `lfo: { rate, depth }` is in octaves |
| `hp` | A fixed high-pass after the filter. Use it on everything that is not the bass |
| `pitchEnv: { semi, time }` | Starts off pitch and returns: a negative `semi` swoops up into the note, as a hoover does |
| `vibrato: { rate, cents, delay }`, `glide`, `glideAll` | `glide` is the seconds a slide takes |
| `drive`, `shape` | Saturation before the amp envelope: `tanh`, `soft`, `hard`, `fold`, `asym`, `diode` |
| `gain`, `velAmp`, `accent` | `accent` is the extra level and filter envelope of an accented note |

A note is `{ t, dur, note, vel?, slide?, accent? }`. `slide: true` ties into the note from the one before: no retrigger, and the
pitch glides by `glide`. The earlier note must end within 60 ms of it. That is how acid lines, sub slides and legato leads are
written. `opts.mod` takes `pitch(t)` (semitones), `cutoff(t)` (a multiplier) and `amp(t)` for anything else, such as a riser.

`FmPatch.ops` is a list of modulator-into-carrier pairs: `{ ratio, carrier, index, decay, sustain, fb, level, cents, pan }`.
`index` is the depth at the start of the note and falls to `sustain` of itself over `decay`. A pair at ratio 1 with a short, quiet
pair at ratio 11 to 14 is an electric piano. Ratio 3.5 with a fast decay is a bell. Feedback (`fb`) towards 1 turns it into a bass.

Starting points, all in the two song files: sub (`SUB`), reese and mid bass (`REESE`, `MID`), supersaw pad and strings (`PAD`,
`STRINGS`), soft lead (`LEAD`), rave stab (`STAB`), hoover (`HOOVER`), acid (`ACID`, in `clerical-violence.ts` and `_selftest.ts`),
plucked arp (`PLUCK`), electric piano and bell (`KEYS`, `PIANO`, `BELL`). `midi('F#1')`, `chord('A3', 'm9')`, `degree(root, scale, n)`,
`CHORDS` and `SCALES` are in `engine/core.ts`.

### Drums and one-shots (`engine/drums.ts`)

Each returns a buffer peaking at 1, so render once and place many times.

| | |
|---|---|
| `kick({ freq, punch, sweep, punch2, sweep2, hold, decay, click, drive, shape, lp, hp })` | `freq` is the resting pitch, `punch` the Hz above it at the first sample and `sweep` how fast that falls. `drive` 1 to 2 is clean, 4 to 6 is a hard techno kick, 10 and up with `shape: 'hard'` squares it into a hardcore kick: lengthen `hold` and `decay` for its tail |
| `kickRumble(kickBuffer, { dur, decay, lp, drive })` | The low rumble that follows a techno kick. Place it a sixteenth after each kick and duck it |
| `snare`, `clap`, `rim`, `hat` (`decay` 0.04 closed, 0.3 open), `ride`, `crash` (stereo), `tom`, `shaker`, `perc` | See the option types |
| `noiseSweep({ dur, from, to, levelFrom, levelTo, curve, tremFrom, tremTo })` | Risers and downlifters, stereo |
| `impact()`, `subDrop()` | The boom on a drop, and a sine falling through the lows |
| `reversed(buf)`, `repitch(buf, semitones)`, `dulled(buf, lpHz)` | A reversed crash ending on the drop, a snare roll that rises, a ghost note |

`hits('x...x.o.')` turns a pattern into `{ step, level }`. `X` is 1, `x` 0.8, `o` 0.5, `1`-`9` ninths, `.` a rest. Spaces and `|`
are ignored. `euclid(hits, steps, rotate)` makes an evenly spread pattern.

### Breaks (`engine/breaks.ts`)

`breakKit({ seed, kick, snare, hatDecay, hatMetal })` is an acoustic-sounding kit. `breakLoop(kit, spec)` plays one or two bars on
it, uneven as a drummer is (`swing`, `human`, `loose`), then glues it with a room, a compressor (`squash`), saturation (`drive`) and
optionally an old sampler's `crush`. The loop has no seam. `spec.bpm` is the tempo the drummer plays at: chopped at a faster song
tempo it comes out higher, as a sampled break does (136 into 184 is five semitones up).

`chop(loop, pattern, { bpm, step, slice, pitch })` resequences it. One token per `step` beats (0.5 by default, 0.25 for sixteenths),
and slice numbers count in the same unit from the start of the loop:

```
4      slice 4            _      hold the last slice      -      rest
4r     reversed           4x3    three hits in the step   4h     half the step, then a gap
4p-5   five semitones down       4x4u7   a four-hit roll rising seven semitones       4x4d12  falling
4g60   at 60% level
```

`parseChop(pattern)` gives the steps as objects, for editing by code: `clerical-violence.ts` rolls dice over them (`mutate`) while
keeping the backbeats in place. Layer a clean kick and snare over the break for weight, and high-pass the break at about 110 Hz.

### Effects (`engine/fx.ts`)

`eq(buf, bands)`, `filt(buf, mode, hzOrCurve, q, poles)`, `drive(buf, { amount, shape, lp, hpPre, mix, bias })`, `crush`,
`chorus(buf, { rate, depth, delay, mix, voices, feedback })` (a flanger with a short `delay` and `feedback`), `delay(buf, { time,
feedback, lp, hp, pingpong })`, `reverb(buf, { decay, size, damp, lowCut, predelay, hp })` (`size` 0.5 a room, 1 a plate, 1.8 a hall),
`compress(buf, { threshold, ratio, attack, release, knee, makeup, mix, key })`, `widen`, `monoBelow`, `autopan`, `softClip`, `limit`,
`fades`. `duckCurve` and `gateCurve` are what `song.duck` and `song.gate` are made of.

### Measuring

Nothing here can listen, so every pass ends in numbers and a picture. The render prints, and saves in `tools/out/music/<slug>.json`:

- **Each track**: clips, peak and RMS after its fader, CPU seconds. The quickest way to see that a part is 10 dB too quiet.
- **Master**: loudness, short-term maximum, range, peak, crest, how many dB it was pushed, what the glue and the limiter took. This
  crest is the WAV's. Encoding adds 2 to 3 dB of peak, so it reads 2.5 to 3 dB lower than the same track as an MP3.
- **Stereo**: correlation (1 is mono), side level, what is lost in mono.
- **Bands**: the share of the energy in seven bands, for the whole song and for each section.
- **4-bar RMS**: the arrangement as a row of numbers. A drop should stand 3 to 6 dB over the intro.
- **The MP3**, measured again by ffmpeg, which is the number that is matched against the list, and decoded for its sample peak and
  crest. Compare that crest, not the master's, with `analyze.ts` on a reference, which reads MP3s.

`tools/out/music/<slug>.png` is the spectrogram: open it. The meter agrees with ffmpeg's `ebur128` to 0.1 LU (`engine/meter.ts`).

What the placeholders measure (`analyze.ts` on their MP3s, so the crest is an MP3's), which is what "matches the list" means:

| List | Tracks | Loudness, LUFS | Range, LU | Crest, dB | Tempo, BPM | Length | Bands: sub, bass, low mid, mid, high mid, high, air |
|---|---|---|---|---|---|---|---|
| menu | 1 | -7.9 | 7.1 | 11.5 | about 174 (the estimator said 167) | 6:17 | -9.6, -3.6, -7.2, -8.8, -12.9, -13.4, -15.7 |
| easy | 13 | median -5.5, from -12.0 to -3.2 | 2.3 | 8.0 | 146 to 160 | 5:26 to 7:08 | -7.9, -2.6, -10.2, -13.1, -11.8, -15.1, -20.8 |
| hard | 11 | median -8.8, from -17.6 to -6.7 | 5.1 | 10.8 | 170 to 180 for most | 5:57 to 9:38 | -6.6, -3.6, -9.3, -10.3, -12.2, -15.3, -19.4 |

The two menu tracks against the menu reference, all three measured the same way, by `analyze.ts` on the MP3:

| | Blue Hour Briefing | Clerical Violence | Placeholder |
|---|---|---|---|
| Loudness, range | -8.4 LUFS, 7.9 LU | -8.0 LUFS, 7.1 LU | -7.9 LUFS, 7.1 LU |
| True peak, sample peak | +1.7, +1.2 dBFS | +1.8, +1.4 dBFS | +1.9, +1.2 dBFS |
| Crest | 12.2 dB | 12.0 dB | 11.5 dB |
| Stereo correlation, side, mono loss | 0.76, -8.6 dB, 0.57 dB | 0.73, -8.1 dB, 0.62 dB | 0.72, -7.8 dB, 0.66 dB |
| Bands | -10.0, -3.9, -6.8, -8.1, -12.7, -12.7, -16.0 | -9.3, -5.2, -5.8, -7.5, -12.0, -12.6, -16.1 | -9.6, -3.6, -7.2, -8.8, -12.9, -13.4, -15.7 |
| Limiter (from the render report) | 2.5 dB at most, 0.7 dB mean | 2.2 dB at most, 0.6 dB mean | |

How the two were made, as a starting balance (RMS of each track while it plays, after its fader): drums group -17, sub -16 to -18,
mid bass -22, pad -24 to -26, keys or stabs -22 to -24, lead -23, bell and arp -29 to -31, with the reverb return peaking near -12.
The first pass of both had the drums and sub right and everything else 6 to 8 dB too quiet, which read as a dark, narrow, drum-only
mix: mid band -12.5 where the reference has -8.8, and correlation 0.95. Blue Hour Briefing took five passes and Clerical Violence
four: balance, tone (pad cutoffs, low-mid clean-up, a tighter kick sweep, the stabs and lead brought back 1.5 dB), the half-bar gap
before the second drop and stereo width, then the master (an easier glue compressor, which raised the range from 6.4 to 8.4 LU).
A review pass then fixed wrong notes (below) and the width: pads widened to 1.7 and the master to 1.2 and 1.1 (`master.width`,
which acts above the 120 Hz mono split), which took the correlation from 0.85 and 0.81 to 0.76 and 0.73.

### Things that will catch you

- **lame turns the level down by itself**: to 0.95 at 160 kbps and under, 0.97 at 192, multiplied with any `--scale` given. The
  renderer measures the MP3 against the WAV and encodes again with the scale that cancels it. Without that every track comes out
  0.45 LU quieter than its master.
- **MP3 peaks overshoot a limited master by 2 to 3 dB.** A ceiling of -1.4 dBFS gave +1.7 and +1.8 dBFS true peak in the file, the
  same as the placeholder. The game plays music at 0.42 x 0.7 in float, so nothing clips.
- **Bitrate follows length**, to stay under 3.4 MB: 144 kbps at 3:01, 136 at 3:10. Past about 3:20 it drops under 128.
- **A line written for a minor chord plays wrong notes under a major one.** Both songs pick bass and acid notes as the chord's root
  plus an interval. Clerical Violence first did that with minor pentatonic steps under F and G as well, so its acid played Ab, Bb and
  Eb against a pad holding A and E. Its `inKey` and the two pentatonic sets now follow the chord, and Blue Hour Briefing's bass
  approach pulls a step back into F minor. Nothing measures this: replay the note choice of any generated line and count the notes
  outside the key (a soloed `--bars` render and a pitch-class spectrum confirm it).
- **A slide needs the note before it to reach it.** A gap of more than 60 ms retriggers instead.
- **`chordOf` and unison patches are stereo, most other things are mono** until an effect widens them. Pan mono clips with `add`'s `pan`.
- **Send amounts are after the fader.** Turning a track down turns its reverb down too.
- **A partial render masters what it is given.** Levels in a `--bars` or `--solo` render are not the levels in the song. Use them for
  the picture and the band balance, and read loudness from a full render.
- **The key estimate in `analyze.ts` is a guess** (it called F minor C minor). The tempo estimate is good to about 1 BPM on music with
  drums and has only been checked against a click and these renders.

### Speed

On the M1 with other work running: 181 s of audio in 16 to 21 s of CPU (Blue Hour Briefing, 20 tracks, 5,000 clips), 190 s in 19 to
25 s (Clerical Violence). A four-bar part renders in under a second. Supersaw pads are the most expensive thing (4 to 7 s a song),
then the master's trial passes. Memory stays near 500 MB.

## Known limitations

- **Nobody has heard any of this.** Every result above is a number. The mix and the character of each sound need ears. The packs most of all: none of them was chosen by listening.
- **That goes double for the soundtrack.** Both menu tracks were composed and mixed by measurement: loudness, band balance, stereo width and
  arrangement match the placeholder, and the spectrograms were read. Whether the tunes are good, the breaks feel right and the snares are
  pleasant is for the owner's ears. Every sound is a recipe in the song file, so anything disliked can be changed and rendered again in 20 s.
- **The public site has no run music of its own yet.** Only the menu list has game tracks, so on the public site a run borrows them. The
  early-wave and late-wave tracks are separate work.
- **The placeholder manifest is still tracked**, with the names of the owner's songs in it and none of the audio. The Pages build empties it.
  A build made any other way from a clone asks for one of the songs at load, finds it missing, and plays only the game's own tracks.
- **The renderer's reverb is one eight-line network with no modulation**, good for sends and not much else, and there is no time-stretch: a
  break slice played slower is also lower.
- **Key 8's sounds were balanced by measurement and have not been heard.** The Trommel's four are the old minigun ids with new recipes, which the door gun plays too. The first version of the spin sounds measured a centroid of 104 to 127 Hz with up to 87% of its energy under 120 Hz, a rumble a laptop cannot play, and was rebuilt: the report now reads `minigun_spin_loop` 264 Hz with 20% sub, `minigun_spinup` rising from 136 to 497, `minigun_spindown` falling from 344 to 118, `minigun_fire_loop` 548 Hz with 45% sub against the SMG shot's 621, `piledriver_fire` 450 Hz with 67% sub and 0.65 s long, `cannon_burst` 1.1 to 1.25 kHz and 0.2 s. Whether that is deep and violent, and whether a loop turned from 0.45 to 1 reads as a spin-up, is for ears. The fire loop is cut at 25 rounds a second and turned to the gun's rate, so the door gun's 30 play it a fifth sharp and `?slot8=old` plays it an octave up.
- **The body hits were tuned by measurement, in Node, with no browser run.** The pitch and level choices need the owner's ears, the Buzzsaw's
  beat of 9 most of all. `tools/out/audio-report.json` predates them: it has no line for `machine_clang`, so the "covers every synthesized
  id" check in `audio.test.ts` fails until the report is run again, and none for `hit_punch`, `hit_confirm`, `corpse_body` and
  `corpse_punch`. No existing render changed: `metal_clang` is back to its old mix, and `machine_clang` is its build under a new id.
- **`tools/shot.mjs` has no real audio device.** It runs Chrome with `--mute-audio`, so underruns are counted against a fake output. Whether the owner's crackle is gone can only be heard on the owner's machine.
- **Only Chrome was run.** The owner's browser is not known. Safari and Firefox have no `playbackStats`, so the governor reads the clock there, which is coarser.
- **`body_drag` is a slowed slug crawl,** because no free recording of a real drag turned up. Gore has no drag event, so it plays after three in ten hard landings.
- **`blood_drip` is rarely heard in a heavy fight.** It is quiet, so thinning takes it. That is by design.
- **CC BY 3.0 sounds need credit wherever the game ships.** `public/audio/sfx/gore/CREDITS.txt` goes out with the files, but a line in the game's own credits is better.
- **`[requestfailed] ... .mp3 net::ERR_ABORTED` appears in `tools/shot.mjs` reports** when a track that is still streaming is replaced (21 of them in one `music-live.mjs` run, which skips through 30 tracks). The
  harness counts it as an error. It is not a console error and the crossfade is unaffected.
- **Music needs a gesture.** With `?autostart=1` and no click, a normal browser stays silent until the first click or key. The harness
  allows autoplay, so the context reports `running` there before any gesture.
- **Ids no one plays yet:** `jump_pad_idle_loop`, `electric_floor_loop`, `lava_loop`, `barrel_hiss_loop` and `alarm_klaxon` need the world to
  start them, because `WorldObjects` exposes no positions. `warden_shield_loop`, `warden_buff`, `skitter_step`, `concrete_crumble`,
  `glass_break`, `bullet_flyby`, `shield_hit`, `sword_block`, `weapon_holster`, `minigun_fire`, `lightning_strike`,
  `electric_buzz_loop` and `powerup_idle_loop` wait for their owners.
- **Gore scales the headshot twice.** It passes 0.75 / 0.5625 / 0.75 on top of catalogue levels that already hold that ratio, so whenever
  gore's call lands first the layers are about 2.5 dB down and their ratio is off. `audio.play('headshot', { position })` is the right call.
- **A loop asked for in the first seconds can fail.** `startLoop` returns a dead handle until the id has rendered. In measured boots
  everything had rendered first, but a slow machine could reach this. Foley and beds retry. One-shot callers do not need to.
- **Not run:** Firefox's listener fallback and the `setTimeout` path for browsers without `requestIdleCallback`. `enumerateDevices` needs a
  secure context, so plain `http://` on a LAN address takes the blocking path. `localhost` and https are fine.
- **Thresholds in `foley.ts` date from a 17 m/s run speed.** `runSpeed` is 12.5 now. Wind still starts at 13 m/s, so running stays quiet
  and earned speed gets the wind, which suits the retune, but it has not been judged by ear.
