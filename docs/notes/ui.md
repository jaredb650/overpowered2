# HUD and menus

`src/ui/**`, sandbox at `/?sandbox=ui`. `createHud(ctx)` from `src/ui/index.ts`. Everything is DOM and CSS except the minimap canvas.
`1rem` is 16 px at 1920x1080 and follows the smaller of width and height (`css/base.css`), so one layout serves 1280x720 to 4K.

## Public API

`HudSystem` from `core/gameplay.ts`: `banner`, `feed`, `hitMarker`, `floatText`, `marker`, `loading`, `showScreen`.

- `banner(text, sub, color)`: text starting `WAVE` takes the full-width band, anything else a stamp. Stamps stack three deep, and a
  repeat of the same text is dropped while it is up.
- `marker(pos, label, color)` returns a remover. Pool of 24, oldest out. A remover held past a reuse does nothing.
- `seat(panel)` puts up a `SeatPanel` and sets `.seated` on the HUD, which hides the on-foot widgets (the rule is in `src/vehicles/gunner.css`). Score, feeds, combo, banners, minimap and hit markers stay. `panel.update()` runs after the camera, so its brackets sit on this frame's picture. Null brings the HUD back. The panel lives inside the HUD, so pause hides it too.
- `Hud` adds `startRun()`, `resume()`, `pause()`, `quitToMenu()`, and reads the game through `window.__op2.game` (`GameHost`).

The HUD reads the game once a frame in `state.ts`, the only file that knows field names. It listens for `game:state`, `run:start`,
`player:damaged`, `player:died`, `weapon:fired`, `weapon:unlocked`, `wave:start`, `wave:clear`, `callin:ready`, `score:gain`,
`enemy:hit`, `enemy:killed`, `enemy:severed`, `perk:start`, `callin:used`, `combo:changed`, `comms:line`, `music:track`.

**Track name.** `hud/nowplaying.ts` shows the name of the track that has just started, top centre above the boss bar, for 7 s: `OST` and
the title for the game's own soundtrack, `LOCAL` for one of the owner's placeholder songs. It hangs on the UI root, after the screens,
so it shows over the menu as well as in a run, and it never takes a click. It rests at opacity 0 and one Web Animation is the only thing
that shows it, so nothing has to hide it again. Its CSS is `css/nowplaying.css`, imported by the widget. Audio decides what plays:
see "Music" in `docs/notes/audio.md`.

## Main menu background

`ui/backdrop/`. Behind the splash, the main menu, the guide and the settings: the contractor (the player, `contractor` in
`docs/notes/characters.md`) sitting in the open door of the Packmule at dusk with a cigar. The Crucible's rules keep the map
flythrough, because they are about that map. Pause and game over show the frozen run as before. `?menubg=map` puts the flythrough back
on every screen.

| File | Job |
|---|---|
| `MenuBackdrop.ts` | Lifecycle, camera, framing, the cabin sound. Owned by `Hud`, driven from `Hud.updateBackdrop` every frame |
| `rhythm.ts` | `backdropMode` (the switch) and `SmokeRhythm`: when he draws, how hot the tip is, the exhale, looks, weight shifts. No three.js, tested |
| `smoker.ts` | The pose, written on the bones with the characters' two-bone IK, and the cigar |
| `cabin.ts` | The real airframe (`UTILITY_AIRFRAME.build`) and M134, a bulkhead console, two swinging grab straps, the lights. Menu-only fittings that make the doorway an aircraft's: hazard stripes on the sill, a seal, rivets and a yellow grab handle on the forward post, a pedestal under the gun's pintle and an ammunition can at the end of its feed chute |
| `outside.ts` | Sky, cloud deck sliding aft at 46 m/s with town lights in its gaps, peaks at the horizon, and 76 soft billboards in one draw: cloud heads standing out of the deck and scraps of cloud passing close by. Four shader draws, no textures |
| `smoke.ts` | 160 soft points: the curl off the tip, pulled out of the door by the slipstream, and the exhales |

**What has to stay true.**

- **It is drawn instead of the world, not over it.** `Renderer.backdrop` (see `docs/notes/render.md`) skips shadows, the light volume, AO,
  fog, SSR and decals while it is set, so the menu costs 28 draws and 18k triangles instead of 110 to 190 draws and 300k to 550k.
- **Its materials are plain three.js.** Anything patched by `materials.patch` reads the map's light volume and the world camera, which this
  scene is not in. The body uses `characters.plainMaterial('contractor')`. There are no shadow maps: `sunThroughDoor` (in `cabin.ts`) gives the
  sun the doorway's shape analytically, so only what the low sun can reach through the door is lit by it. A new lit material in the cabin needs it.
- **Freed when a run starts, kept when hidden.** Leaving for the rules screen hides it and keeps it. `state === 'playing'` disposes all of it,
  the contractor's model included (`characters.unload`), and the next menu builds it again: the cabin at once, the body when its model has
  loaded, under a 1.4 s fade from black. A load that finishes after the run started is thrown away.
- **Framing is a lens shift, not an aim.** `framing()` in `MenuBackdrop.ts` puts the camera's aim between the end of the menu list
  (`FREE.left`, 20 rem) and the start of the notice (`FREE.right`, 53.4 rem), above the wordmark (`FREE.bottom`, 25 rem), from those rem
  numbers and the same `rem` rule as `css/base.css`. If the menu's layout moves, move those three numbers. On the splash the wordmark is
  centred, so `framing(w, h, 'splash')` raises the aim until his head, chest and resting cigar hand sit above it (`SPLASH_HALF`, 10.5 rem,
  from `screens.css`); on the click the view tilts down to the menu's framing over `SETTLE` (1.6 s), and cuts when still.
- **Still frame.** `?menubg=still` or `prefers-reduced-motion: reduce` freeze it on a held pose. It moves at every graphics quality, Low included (the owner asked for that). The renderer draws a still
  backdrop three times and then not at all until the window is resized, so the menu costs nothing.
- **Sound.** `heli_rotor_loop` at volume 0.07 and pitch 0.78, 2D, from the first click (the splash's click is what lets audio start) until the
  menu goes. Asked again each second until the synth has the loop ready.

## The weapon strip

One cell per number key, not per weapon. A key that holds a family (`src/weapons/families.ts`) shows the member the key draws now, from `weapons.slotMember(slot)`, and carries a pip per member in its corner: filled for the one in the cell, hollow outlines for the others, dim for one not owned. Under the weapon's name, `arm-family` lists the family's owned members with the one in hand lit and the key that steps through them; it is empty for a weapon alone on its key. `HudState.member` falls back to the family's first weapon when the weapon system cannot say.

## The charge bar

Under the crosshair, `xh-charge` in `hud/crosshair.ts`: the rotary cannon's spin and the Lance's charge, from `HudState.charge`. It is the only spin readout now: the cannon's reticle used to turn with the barrels (`spins`), which was a saw on the HUD, and is four fat blocks that every round throws wide. The Piledriver's is long bars to either side. For a weapon whose `mode` is `charge` (the Lance) it is staged, from `TUNING.lance.stages` (`docs/notes/weapons.md`, "The Lance"): a notch on the bar at each stage short of full, and the bar's own classes say what letting go fires. It is grey while that is only a plasma ball (`staged`), cyan from the first stage (`s1`, then `s2`), and white in an amber frame at full (`full`). One `Flag` a stage, so a class is written when a stage is crossed and not every frame. With `?lance=old` there are no stages and the bar is the plain one.

## Lock markers

`hud/locks.ts`, inside the crosshair. While the Quiver's trigger is held, `weapons.paint` (a `PaintView`) lists its marks, and each painted target gets a corner bracket sat on its `center` plus `aimLift`, projected through `render.camera` every frame, with `x2` to `x4` beside it when spares are stacked on it, and `LOCK n/4` under the crosshair. A bracket pops when it gains a mark. The brackets turn amber and the label with them when every mark is laid. Four pooled elements, positioned by `transform` only, nothing built while painting. A target behind the eye is hidden, one off screen is held at the edge. The crosshair itself is a seeker's box for the Quiver and four short bars for the Thresher (`RETICLES` in `hud/crosshair.ts`). Key 5's four wear the sword's arcs, drawn in for the Shiv (`gap` -9), the Prybar (-4) and the Cosh (-6, on a dot), out for the Spade (5); the guide's text for each reads its reach from `MELEE`. Measured live: four brackets and `LOCK 4/4` on a five-man arc, `x4` on a lone Juggernaut (`tools/out/swarm/live-paint-full.png`, `live-stack-juggernaut.png`).

## Flow

`core/Game.ts` knows states. `Hud.ts` owns the moves between them.

| From | Trigger | To | Notes |
|---|---|---|---|
| page load | | loading | `ui/boot.ts`, before anything heavy is fetched |
| loading | boot done | splash | The click is the audio gesture |
| splash | click, Enter, Space | menu | |
| menu | Play, on the page's contract | playing | `startRun`: run starts at once, the lock lands a moment later. Edges from the press are dropped, so it cannot jump or fire on frame one |
| menu | Play, on another contract | page load, then splash | The splash reads `Click to deploy` and that click goes straight into the run. See `docs/notes/contracts.md` |
| playing | Esc, or the lock going for any reason | paused | `updateLock` watches `input.locked`, so Alt-Tab and anything else counts, not only `pressed('pause')` |
| paused | Resume, Enter | playing | Stays paused until the lock is really back. Retries for 1.7 s to get past Chrome's refusal right after Esc |
| paused | Esc | playing, or a hint | Esc is not a gesture to Chrome. With no live gesture the hint says to click; with a recent click it resumes |
| playing | death | gameover | 1.5 s beat at 0.3x, `run:end`, then the report. Input is ignored for 0.8 s so a jump or a burst at the moment of death cannot hit Run again |
| gameover | Run again, Space | playing | Requests the lock, unlike the first game |
| gameover, paused | Menu, Esc, Quit | menu | `Game.clearRun` empties the map and resets post, so no frozen enemy or red vignette stands in the flythrough |

If the first lock never lands, the run pauses with a hint. If a browser has never granted one, the second Resume plays on without it.
A lock that lands after the player paused is released at once, so a pause screen can never swallow the cursor.

## Loading

`Game.ts` imports `ui/boot.ts` first and keeps Physics and every system behind dynamic imports, so the screen's graph is a few small
files. `dom.ts` must stay free of anything that reaches three.js for that reason. First label at about 90 ms on a warm server.

`createCtx` and `Game.init` report through `BOOT` in `Game.ts`, sized from measured time so the bar moves steadily. The light bake
is two thirds of a boot and reports nothing, so it is a `Crawl`: a linear compositor transition toward the next checkpoint over
`LIGHT_SECONDS`, and the bar cannot pass it. Under load the bar reaches the limit and waits. The stripes never stop, because they
are a compositor animation and survive a blocked main thread. `performance.mark('boot:<label>')` gives the timeline in DevTools.

## Tuning knobs

| Want | Where |
|---|---|
| Boot bar pacing | `BOOT`, `LIGHT_SECONDS` in `core/Game.ts`. `CREEP` in `screens/loading.ts` |
| Flythrough | `CUTS` in `screens/flythrough.ts`, keyed by map id. `SHOT_SECONDS`, `FLY_FOV`. A map with no entry gets one dolly per zone |
| Menu render rate | One line in `Game.frame`: half rate on the menu, quarter behind pause and game over |
| Menu background: which screens | `HELI_SCREENS` in `Hud.ts` |
| Menu background: camera | `EYE`, `AIM`, `FOV`, `FREE` in `backdrop/MenuBackdrop.ts`. Drift and handheld amounts in `placeCamera` |
| Menu background: smoking | `DRAG`, `EVERY`, `LOOK`, `SHIFT`, `EMBER` in `backdrop/rhythm.ts`. The pose is `POSE` in `backdrop/smoker.ts` |
| Menu background: light and sky | `SKY`, `SUN_DIR`, `AIRSPEED` in `backdrop/outside.ts`. `SUN_LUX`, `FLICKER_HZ`, the gun's parking angle in `backdrop/cabin.ts` |
| Death beat, Run again guard | `DEATH_BEAT`, `GAME_OVER_HOLD` in `Hud.ts` |
| Lock retries | `LOCK_RETRY_FOR`, `LOCK_RETRY_EVERY` in `Hud.ts` |
| Score roll | `ROLL_RATE` in `hud/tally.ts` |
| Tach | `MAX_SPEED` in `hud/tach.ts`. Its marks read `MOVE.runSpeed`, `OVERDRIVE_MIN_SPEED` and the top of `SCORE.speedTiers` |
| Combo heat | `HEAT` in `hud/combo.ts` |
| Perk motion | One keyframe per id in `css/perks.css`. Slowmo is still on purpose |
| Enemy reveal | `REVEAL_AT` in `hud/stragglers.ts`, 3 |
| Comms feed | `CommsFeed` in `hud/feed.ts`: line cap and life. `COMMS_FEAR` in `Hud.ts` |
| Track name | `SHOWN` and `FRAMES` in `hud/nowplaying.ts`, `.np` in `css/nowplaying.css` |
| Stims | `.vit-stim`, `.st-*` in `css/hud.css`, built in `hud/vitals.ts`: the key, one pip per stim (`STIM.max`), and INJECT blinking under 35% health with a stim ready and none going. Pips dim while one goes in |
| Contract notice | Copy in `contracts/data.ts`, layout `.mm-brief` and `.nt-*` in `css/screens.css`. It has to end above the wordmark |
| Minimap | `NEAR_RANGE`, `FAR_RANGE`, `FAR_SPEED`, `REDRAW` in `hud/minimap.ts` |
| Gore levels | `GORE_TABLE` in `settings.ts` |
| Guide copy | `data.ts`. Numbers come from `MOVE`, `WEAPONS`, `TUNING`, `EFFECTS`, `WINDOWS`, `STACK`, `SCORE`, so a retune updates the guide. Enemy first waves are copied from `ROSTER`, which is not exported |

## Settings

Stored in `op2.settings.v1`, sanitized on load. They apply and save the moment they change. Bindings live in `op2.bindings.v1`, owned by input.

| Setting | Goes to |
|---|---|
| Sensitivity | `player.sensitivity`, 0.002 x the slider |
| Field of view | `camera.setBaseFov`. Speed and zoom compose on top |
| Invert mouse, hold jump to hop | `player.invertY`, `player.holdToHop` |
| Volumes | `audio.setVolumes` |
| Quality | `render.setQuality`, 0 to 3. Recompiles shaders when the light count changes, so it hitches once |
| Gore | `GoreTuning`, `BloodTuning`, `ChunkTuning`, written live. See the limitation below |
| Keys | `input.rebind`, `captureNext`. Rows show every key on an action |

## Known limitations

- **Gore level changes what stays, not the spray.** It sets corpse and limb caps, stump time, blood reaching the floor and chunk linger.
  The blood a hit sprays is a fixed recipe in fx, with no scale to set. Excessive cannot raise the caps, which are the design's hard limits,
  so it buys time and makes corpses come apart sooner. A blood scale in fx would finish this.
- **Weapon keys 1 to 0 and the wheel's bindings are not all on the Keys page.** Next and previous are. Slots are listed as fixed in the guide.
- **Esc in real Chrome is unproven.** Headless Chrome does grant pointer lock, and everything else in the table ran on real clicks and keys, but
  headless delivers the Esc keydown to the page, where desktop Chrome swallows it and ends the lock itself. That path was exercised by
  `document.exitPointerLock()`, which goes through the same `pointerlockchange`. Chrome's cooldown of about 1.25 s after a real Esc does not
  happen headless, so the retry loop has only run with immediate success.
- **Hit markers fire on the frame of the call,** and the 0.15 to 0.36 s life is too short for a screenshot in the real game. Their look was checked in the
  sandbox with the decay stopped, and the calls were counted in the real game.
- **The flythrough's cuts are hand-framed for The Crucible** and will need another look if the map moves. The Kill House uses the zone fallback.
- **Fog is temporal,** so a hard cut may smear for a frame or two. Not seen in stills, not checked in motion.
- **A perk's grade fades out over a second or two after quitting to the menu.** `PerkRunner.clear` starts a timed release, which the renderer's
  instant reset does not cut short, and post runs on render calls, so at the menu's half rate it fades at half speed. Quit during Berserk and the first cut
  starts red.
- **The menu background has not been watched in motion by a person.** Drags, exhales, looks, the rotor flicker on the sun, the straps, the
  passing cloud and the smoke were checked by tests and held-pose stills, not by eye at speed. The cabin loop's level was read from the mixer, not heard.
- **The door gun is mostly behind the Play/Guide/Settings list at 16:10 and 16:9.** It shows whole only on wider screens. The main rotor is
  never in frame: from the cabin floor it is above the top of the door.
- **The menu background has no depth of field.** The pipeline has none; the cloud deck is drawn without its finest octave so the outside is soft.
- **His jaw and mouth are the bake's stock human head** under the helmet's visor. They read at menu size; close up they are plain.
- **The first few frames after load draw the map,** under the loading screen and the splash, before the helicopter takes over: the FX and
  character warm-ups need world frames (`BACKDROP_AFTER` in `render/Renderer.ts`).
- **Audio aborts show as `requestfailed` in the harness.** `audio/music/*.mp3` or `audio/ost/*.mp3` with `net::ERR_ABORTED` appears whenever a track is swapped while still
  streaming. It is the player dropping an element, not a console error.

## Testing

```
/?sandbox=ui&state=full|lowhealth|perks|boss|targeting|danger|scope|stragglers|long|clean
/?sandbox=ui&screen=loading|splash|menu|guide|settings|pause|gameover
```

Screen sizes tried: 1920x1080 and 1280x720.

The menu background on its own: `/?sandbox=backdrop`, with `&mode=still`, `&hand=1&look=0&exhale=0&ember=1&shift=0` to hold parts of
the pose, `&t=` to run the clock ahead. In the game, `tools/scripts/menu-backdrop.mjs` (`MB_STEPS=shots,time,trip,screens`, header has the
command) reaches the menu with a real click and takes screenshots, frame and GPU-synced render timings, and menu to run round trips with
three's memory counts. `src/ui/backdrop/backdrop.test.ts` covers the switch, the rhythm, the framing (menu and splash), the tilt between them,
the cigar at the lips and the cleanup. `&cam=close` (or `side`) and `&dist=` in the sandbox put a close camera on his head, for checking the helmet.

## Verified

All in real headless Chrome through `tools/shot.mjs`, zero console errors. Runs under battery saver held Chrome at 30 Hz, so frame numbers are not
meaningful here. The scripts lived in the session scratchpad, not in the repo.

| Thing | How | Result |
|---|---|---|
| Boot | Real load at 1920x1080 | First contentful paint 96 ms, down from 1740. 9 s to splash. Bar and number track within 3 points, 32% at 3 s, 85% at 8.6 s |
| Menu path | `page.mouse`, `page.keyboard`: splash, Play, Esc, Resume, Enter, death, Run again by Space and by click, Quit to menu, third run, Restart run | Every state, lock and screen as in the table above |
| Lock | Headless Chrome grants it | `pointerLockElement` is the canvas after a real click. `exitPointerLock` pauses. Mouse moved the view and W moved the player, 9.6 m in 0.8 s |
| Death mash | Space and a click in the first 0.3 s of game over | Ignored. Space after 0.8 s restarts |
| Real death | Stood at 1 HP in wave 1 | Killed by husk, report shown, Menu clears the map, 0 enemies alive |
| Dirty death | Scoped, in slow-mo, with perks, call-ins and a capsule | Second run: FOV back, scale 1, no perks, chips, markers, scope or feed, score 0, easy music playing |
| Settings | Slider drag, arrow keys, row clicks, the arrow glyph, key capture, then a page reload | Every value reached its system and came back after reload. Defaults and Reset keys restore. LMB capture no longer re-enters capture |
| Rebinding | Reload to T | Guide and Settings show T. Real fire then T reloads |
| HUD against state | Bot plus grants at both sizes, DOM read against ctx | Wave, left, score, health, ammo, combo, multiplier, perks with times, chips, boss, tach all agree |
| Reveal | 2 husks left in the real game | Tracked markers with distance, pulse on the minimap |
| Contract select, sonar chip, comms feed | See `docs/notes/contracts.md` | |
| Menu background | `tools/scripts/menu-backdrop.mjs`, dpr 2, at 1440x900, 2100x900 and 1280x720, and `?menubg=map` and `?menubg=still` | Subject between the list and the notice at all three, and above the wordmark on the splash. With the helmet, cloud heads and fittings (2026-11-10): `render()` with the GPU's work 2.7 to 2.8 ms against 7.2 to 7.3 for the flythrough measured back to back, CPU per render 0.5 ms (p50) against 2.6, 28 draws and 18.5k triangles against 188 and 536k. Three round trips: menu 291/99/121 then 292/99/122 twice (geometries/textures/programs), run 275/95/110 each time, so nothing grows. Guide and settings keep the helicopter, the rules show the map. Only aborted mp3 requests in the console |
| Track name | `tools/scripts/music-live.mjs` at 1440x900, dpr 2: a real click on the splash, then the DOM and a screenshot | `OST Clerical Violence` top centre over the menu, opacity 1 two seconds after the track started. In a run (`?autostart=1`) it shows top centre at opacity 1, clear of the wave counter and minimap. Not looked at beside the boss bar |
