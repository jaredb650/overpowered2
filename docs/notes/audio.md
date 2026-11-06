# Audio notes

Owned files: `src/audio/**`, `src/sandbox/audio.ts`. The ids below are stable. `src/audio/audio.test.ts` fails if this list
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
| `enemy:severed` on flesh | `bone_crack` and `blood_spurt` under the enemies system's `limb_sever` |
| `enemy:killed` | `blood_splat` on a gib, `head_pop` and `vox_gurgle` on a head kill |
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
`gib_land` x4, `blood_spurt` x3, `frozen_shatter` x3, `freeze_crackle`, `char_sizzle` x2

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

## How it loads

Nothing blocks the boot, and nothing has to wait for a sound.

1. The first `AudioContext` in a page blocks the main thread while the browser starts its audio service: 1.0 to 1.5 s here. The
   constructor calls `enumerateDevices()`, which starts that same service without blocking, and the context is made when it answers
   (or after 6 s). The context then takes under 10 ms. Until then every public method is a safe no-op that remembers music state,
   volumes and unlock.
2. `SoundBank` (`bank.ts`) does the rest as small jobs in `requestIdleCallback`: rooms first, then 55 samples, then 473 recipe variants
   in `renderRank` order: every id's first variant in a tier before spares, tiers by what a run reaches first.
3. Jobs that find no idle time run anyway after 250 ms during the boot and 60 ms after it, so loading always finishes.
4. A sound played before it has rendered is skipped and jumps the queue. `stats().missed` counts these.

## Tuning knobs

| Want | Change |
|---|---|
| Balance between kinds of sound | `MIX` in `mix.ts`, then `over` on a recipe or the third argument of `sample()` |
| Voice budget, HRTF budget | `VOICES_3D`, `VOICES_2D`, `VOICES_UI`, `MAX_HRTF`, `HRTF_RANGE` in `AudioEngine.ts` |
| Limiter, music level | `limiter` settings and `MUSIC_TRIM` in `mixer.ts` |
| Slow-mo filter, duck speed | `Mixer.update` |
| Room size | `ROOMS` in `reverb.ts`. `t60` is low, mid, high |
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
```

The tests read `tools/out/audio-report.json` for the level and envelope of every real render, and skip that part if the file is missing.
Run the report after changing a recipe.

## Measured

All in real Chrome at the harness's low priority, on the M1, in the real game unless it says otherwise.

| What | Result |
|---|---|
| First `AudioContext`, cold | 1020 to 1465 ms blocking. After the warm-up, 5 ms |
| Audio's blocking setup in a real boot | 14 to 17 ms, down from about 1400 ms |
| Sounds ready when the run starts | 278 of 278 synth ids, 55 of 55 samples, in a 10 to 12 s boot |
| Main-thread load work | 1.3 to 1.5 s, nearly all in idle gaps. 48 to 139 ms of it was forced during the boot. Longest job 45 to 91 ms |
| Plays lost to a sound not being ready | 0 |
| Warnings past Nyquist | 0, from 18 recipes that asked for 22 to 58 kHz |
| Per frame in a fight | `update` 0.12 ms average, 1.7 ms worst. `play` 0.18 ms average |
| Buffers in memory | 117 MB, 528 s of audio |
| Unknown ids in a fight | 0. Static scan of `src/`: 0 |
| Casings, 18 s fight | 139 to 192 bounces became 76 to 86 sounds |
| Slow-mo at 0.25 | `rocket_fire` rate 0.25, `perk_slowmo` rate 1, `amb_core` rate 0.25, music low-pass 420 Hz, all back to 1 and 20 kHz afterwards |
| Duck on `hellfire_rocket_blast` | Music gain 0.45 at 250 ms |
| Low health at 19 of 100 | Low-pass 1520 Hz, `heartbeat_loop` rate 1.39, limiter untouched by it |
| Music | Menu on splash click, easy on Play, hard at wave 10 (0.10 / 0.90 crossfade 0.6 s in), menu on quit and on game over. Pause holds the track at 51.40 s and resumes from there |
| Rooms | Each of the six zones sets its room and bed. T60 measures 3.7 / 6.7 / 1.7 / 0.8 / 2.7 / 1.0 s for core, foundry, refinery, scrapyard, transit, ring |
| Beds from real player state | `wallrun_loop` 0.36 on a real wall run. `slide_loop` 0.28. `speed_wind_loop` 0.50 at 42 m/s. `slam_fall_loop` 0.37 at -57 m/s. All stop with the state |
| Worst-case load, sandbox, 5 s | 78 voices, 3900 plays, 3.7 before the limiter and 0.95 after it, so nothing clips |
| `enemy_headshot3` | 0.799 s cut from the live buffer in the real game. Peak 0.71 kept |

## Known limitations

- **Nobody has heard any of this.** Every result above is a number. The mix and the character of each synthesized sound need ears.
- **`[requestfailed] ... .mp3 net::ERR_ABORTED` appears in `tools/shot.mjs` reports** when a track that is still streaming is replaced. The
  harness counts it as an error. It is not a console error and the crossfade is unaffected.
- **Music needs a gesture.** With `?autostart=1` and no click, a normal browser stays silent until the first click or key. The harness
  allows autoplay, so the context reports `running` there before any gesture.
- **Ids no one plays yet:** `jump_pad_idle_loop`, `electric_floor_loop`, `lava_loop`, `barrel_hiss_loop` and `alarm_klaxon` need the world to
  start them, because `WorldObjects` exposes no positions. `warden_shield_loop`, `warden_buff`, `skitter_step`, `gib_land`, `concrete_crumble`,
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
