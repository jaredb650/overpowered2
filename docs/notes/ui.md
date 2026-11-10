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
`enemy:hit`, `enemy:killed`, `enemy:severed`, `perk:start`, `callin:used`, `combo:changed`, `comms:line`.

## The weapon strip

One cell per number key, not per weapon. A key that holds a family (`src/weapons/families.ts`) shows the member the key draws now, from `weapons.slotMember(slot)`, and carries a pip per member in its corner: filled for the one in the cell, hollow outlines for the others, dim for one not owned. Under the weapon's name, `arm-family` lists the family's owned members with the one in hand lit and the key that steps through them; it is empty for a weapon alone on its key. `HudState.member` falls back to the family's first weapon when the weapon system cannot say.

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
| Death beat, Run again guard | `DEATH_BEAT`, `GAME_OVER_HOLD` in `Hud.ts` |
| Lock retries | `LOCK_RETRY_FOR`, `LOCK_RETRY_EVERY` in `Hud.ts` |
| Score roll | `ROLL_RATE` in `hud/tally.ts` |
| Tach | `MAX_SPEED` in `hud/tach.ts`. Its marks read `MOVE.runSpeed`, `OVERDRIVE_MIN_SPEED` and the top of `SCORE.speedTiers` |
| Combo heat | `HEAT` in `hud/combo.ts` |
| Perk motion | One keyframe per id in `css/perks.css`. Slowmo is still on purpose |
| Enemy reveal | `REVEAL_AT` in `hud/stragglers.ts`, 3 |
| Comms feed | `CommsFeed` in `hud/feed.ts`: line cap and life. `COMMS_FEAR` in `Hud.ts` |
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
- **Audio aborts show as `requestfailed` in the harness.** `audio/music/*.mp3 net::ERR_ABORTED` appears whenever a track is swapped while still
  streaming. It is the player dropping an element, not a console error.

## Testing

```
/?sandbox=ui&state=full|lowhealth|perks|boss|targeting|danger|scope|stragglers|long|clean
/?sandbox=ui&screen=loading|splash|menu|guide|settings|pause|gameover
```

Screen sizes tried: 1920x1080 and 1280x720.

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
