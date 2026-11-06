# Audio notes

Owned files: `src/audio/**`, `src/sandbox/audio.ts`, `public/audio/sfx/**`, `docs/CREDITS.md`. The ids below are stable. `src/audio/audio.test.ts` fails if this list
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

- Music: `run:start` to easy, `wave:start` with wave >= 10 to hard, `game:state` menu and gameover to menu, pause to pause.
- Zone reverb and ambience beds, slow-mo pitch and filter (follows `ctx.time.slowmo`), low-health filter and heartbeat.
- Speed wind, slide loop, wall-run scrape, slam fall whistle: these follow the player's state each frame.
- Ducking: big ids carry their own duck. Calling `duck()` is only for moments with no big sound.
- When a run ends, every loop in the world fades out, whoever started it. The owner's handle goes dead, which is safe.
- `src/audio/reactions.ts` plays what follows from an event and has no other owner:

| Event | Sound |
|---|---|
| `fx:casing` | `casing_brass` (rifle a little lower), `casing_shotgun`, `casing_heavy`. Volume follows strength. Quiet bounces thin out under 50 ms apart |
| `enemy:hit` from the player | `hit_marker`, `hit_marker_head`, `hit_marker_armor`. Skips fire ticks |
| `enemy:killed` from the player | `hit_marker_kill` |
| `enemy:severed` on flesh | `bone_snap`, `flesh_tear` and `blood_spurt` under the enemies system's `limb_sever` |
| `enemy:killed` | `blood_splatter` on a gib, `head_pop` and `vox_gurgle` on a head kill |
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
| `sword_contact` | `sword_hit1` + `sword_hit2` + `enemy_hit` |
| `perk_berserk` | `perk_berserk1` + `perk_berserk2` + `perk_berserk3` all at once, 0.4 / 0.6 / 0.4 as in the first game |

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

Volume runs 0.35 to 1 with strength, and pitch falls as strength rises. Only a `body` asks what it landed on, with one ray. A pile of bodies is capped
four ways: gore allows 6 events a frame, `reactions.ts` hears 9 a second with a burst of 5 and nothing past 55 m, the `flesh` family holds 6
voices, and thinning takes the rest when the mix is crowded.

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

## Synthesized catalogue

Rendered at load. x4 means four rendered variants behind one id.

### Weapons

- **Judge:** `revolver_fire` x3, `revolver_cock`, `revolver_open`, `revolver_load`, `revolver_close`, `revolver_ricochet` (the head-to-head ricochet)
- **Lance:** `railgun_charge` (one-shot rise, 1.6 s), `railgun_charge_loop` (held at full), `railgun_ready`, `railgun_fire`, `railgun_fizzle` (released early), `railgun_beam` (fading beam hum, one-shot)
- **Buzzsaw:** `minigun_spinup` (1 s), `minigun_spin_loop` (barrels turning, no shots), `minigun_fire_loop` (50 rps barrage), `minigun_spindown`, `minigun_fire` x3 (single shot)
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
- **Debris:** `glass_break` x3, `metal_clang` x4, `concrete_crumble` x3

### Bodies

`limb_sever` x4, `bone_crack` x4, `gib_squelch` x4, `blood_splat` x4, `flesh_slice` x3, `head_pop` x3, `body_thud` x4,
`gib_land` x4, `blood_spurt` x3, `body_scrape`, `frozen_shatter` x3, `freeze_crackle`, `char_sizzle` x2

### Player

- **Movement:** `dash` x3, `double_jump`, `wall_kick`, `wallrun_start`, `wallrun_loop`, `slide_start`, `slide_loop`, `slide_stop`, `slam_start`, `slam_fall_loop`, `slam_impact` x2, `slam_bounce`, `mantle`, `jump_pad`, `land_hard`, `speed_wind_loop`
- **Footsteps:** `footstep_concrete`, `footstep_metal`, `footstep_grate`, `footstep_dirt`, `footstep_glass`, `footstep_flesh` (wet), all x4. `footstep_armor`, `footstep_energy` and `footstep_lava` alias to the nearest of these, so every `SurfaceKind` works
- **Health:** `player_hurt` x4, `player_hurt_heavy` x2, `player_death`, `armor_hit` x3, `armor_break`, `shield_hit` x3, `heal_tick`, `low_health_warn`, `heartbeat`, `heartbeat_loop`

### Enemies

- **Voices (formant synthesis, use `pitch` for size):** `vox_grunt` x4, `vox_pain` x4, `vox_scream` x4, `vox_death` x4, `vox_alert` x4, `vox_gurgle` x3, `vox_husk_growl` x4, `vox_husk_snarl` x3, `vox_brute_grunt` x3, `vox_stalker_hiss` x3, `vox_leaper_shriek` x3, `vox_bomber_cackle` x2, `vox_burner_breath` x2, `vox_warden_chant` x2, `vox_juggernaut_roar` x2, `vox_radio` x4 (trooper chatter), `vox_choke` x2 (headless or gut-shot)
- **Guns:** `enemy_pistol` x3, `enemy_smg` x3, `enemy_shotgun` x2, `enemy_minigun_loop`, `enemy_rocket_fire`, `sniper_charge`, `sniper_fire`, `sniper_laser_loop`
- **Melee:** `enemy_swing` x3, `enemy_lunge` x2, `enemy_blade` x3
- **Specials:** `riot_shield_hit` x3, `riot_shield_break`, `warden_shield_up`, `warden_shield_loop`, `warden_buff`, `bomber_beep`, `bomber_tank_hiss_loop`, `burner_flame_loop`, `enemy_spawn`, `armor_plate_off` x3, `leaper_pounce`, `leaper_cling`
- **Machines:** `drone_rotor_loop`, `drone_gun` x3, `drone_alert`, `drone_crash`, `skitter_legs_loop`, `skitter_step` x4, `skitter_chirp` x3, `skitter_explode` x2
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
- **Hit markers:** `hit_marker`, `hit_marker_head`, `hit_marker_kill`, `hit_marker_armor`
- **UI (ui bus, never slowed):** `ui_hover`, `ui_click`, `ui_back`, `ui_tick`, `ui_toggle`, `ui_slider`, `ui_error`, `ui_open`, `ui_close`, `ui_type`, `ui_confirm`

### World

`jump_pad_idle_loop`, `barrel_hiss_loop`, `crusher_slam`, `crusher_rise`, `electric_floor_loop`, `electric_zap` x3, `lava_loop`, `lava_burn`, `steam_burst`, `metal_groan` x3, `alarm_klaxon`, `amb_core`, `amb_foundry`, `amb_refinery`, `amb_scrapyard`, `amb_transit`, `amb_ring`. The `amb_*` beds run themselves.

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
2. `SoundBank` (`bank.ts`) does the rest as small jobs in `requestIdleCallback`: rooms first, then 68 sample ids, then 474 recipe variants
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
| Load speed against load cost | `RENDER_THREADS`, `DECODE_THREADS`, `*_PATIENCE_MS` in `bank.ts`. Order: `RENDER_TIERS` in `catalog.ts` |
| Casing density, hit marker spacing | `CASING_GAP`, `MARKER_GAP` in `reactions.ts` |

## Testing

```
npx vitest run src/audio
node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-report.mjs --wait 500   # writes tools/out/audio-report.json
node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-sheets.mjs --wait 200 --w 1248 --h 672
node tools/shot.mjs --url "/?sandbox=audio" --wait 30000                                                     # every id in order, then polyphony load
AS_LABEL=x node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/audio-stress.mjs --wait 1000 --timeout 178   # the real game under fire, writes tools/out/audio-stress-x.json
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
| Rooms | Each of the six zones sets its room and bed. T60 measures 3.7 / 6.7 / 1.7 / 0.8 / 2.7 / 1.0 s for core, foundry, refinery, scrapyard, transit, ring |
| Beds from real player state | `wallrun_loop` 0.36 on a real wall run. `slide_loop` 0.28. `speed_wind_loop` 0.50 at 42 m/s. `slam_fall_loop` 0.37 at -57 m/s. All stop with the state |
| Output in the soak | Peak 0.97 after the limiter and clipper. No NaN, no silent read while firing |
| Sample packs | 56 files, 0.38 MB. No clipped sample. First sound within 3 ms of the start. Lengths 0.13 to 1.2 s. Mix level 0.06 to 0.18, against 0.10 to 0.22 for the synth gore around them |
| `enemy_headshot3` | 0.799 s cut from the live buffer in the real game. Peak 0.71 kept |

## Known limitations

- **Nobody has heard any of this.** Every result above is a number. The mix and the character of each sound need ears. The packs most of all: none of them was chosen by listening.
- **`tools/shot.mjs` has no real audio device.** It runs Chrome with `--mute-audio`, so underruns are counted against a fake output. Whether the owner's crackle is gone can only be heard on the owner's machine.
- **Only Chrome was run.** The owner's browser is not known. Safari and Firefox have no `playbackStats`, so the governor reads the clock there, which is coarser.
- **`body_drag` is a slowed slug crawl,** because no free recording of a real drag turned up. Gore has no drag event, so it plays after three in ten hard landings.
- **`blood_drip` is rarely heard in a heavy fight.** It is quiet, so thinning takes it. That is by design.
- **CC BY 3.0 sounds need credit wherever the game ships.** `public/audio/sfx/gore/CREDITS.txt` goes out with the files, but a line in the game's own credits is better.
- **`[requestfailed] ... .mp3 net::ERR_ABORTED` appears in `tools/shot.mjs` reports** when a track that is still streaming is replaced. The
  harness counts it as an error. It is not a console error and the crossfade is unaffected.
- **Music needs a gesture.** With `?autostart=1` and no click, a normal browser stays silent until the first click or key. The harness
  allows autoplay, so the context reports `running` there before any gesture.
- **Ids no one plays yet:** `jump_pad_idle_loop`, `electric_floor_loop`, `lava_loop`, `barrel_hiss_loop` and `alarm_klaxon` need the world to
  start them, because `WorldObjects` exposes no positions. `warden_shield_loop`, `warden_buff`, `skitter_step`, `concrete_crumble`,
  `glass_break`, `metal_clang`, `bullet_flyby`, `shield_hit`, `sword_block`, `weapon_holster`, `minigun_fire`, `lightning_strike`,
  `electric_buzz_loop` and `powerup_idle_loop` wait for their owners.
- **Gore scales the headshot twice.** It passes 0.75 / 0.5625 / 0.75 on top of catalogue levels that already hold that ratio, so whenever
  gore's call lands first the layers are about 2.5 dB down and their ratio is off. `audio.play('headshot', { position })` is the right call.
- **A loop asked for in the first seconds can fail.** `startLoop` returns a dead handle until the id has rendered. In measured boots
  everything had rendered first, but a slow machine could reach this. Foley and beds retry. One-shot callers do not need to.
- **Not run:** Firefox's listener fallback and the `setTimeout` path for browsers without `requestIdleCallback`. `enumerateDevices` needs a
  secure context, so plain `http://` on a LAN address takes the blocking path. `localhost` and https are fine.
- **Thresholds in `foley.ts` date from a 17 m/s run speed.** `runSpeed` is 12.5 now. Wind still starts at 13 m/s, so running stays quiet
  and earned speed gets the wind, which suits the retune, but it has not been judged by ear.
