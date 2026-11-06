# 07. UI, HUD and audio

Source: `index.html` lines 1-486 (HTML, CSS), 487-879 (`AudioManager`, `SoundtrackManager`), 7083-7230 (`UIManager`), plus the notification functions in `Player` (5938-6524, 6894-6929) and every call site that touches the DOM or plays a sound. All line numbers refer to `index.html` unless stated.

**Evidence labels.** **[measured]** means I ran the unmodified `index.html` in a real Chromium page (Electron build, Chrome/152, three.js r128 from the CDN, `public/audio/sfx` served as `sounds/`, viewports 1280x800 and 1094x800) and read the result from the DOM, the console or a screenshot. Everything else comes from reading the code. **Nothing was listened to.** Lengths come from `afinfo` on the files in `public/audio`, and any remark about how something sounds is inference. Two things could not be tested: Esc under pointer lock on a real keyboard, and autoplay suspension (the test page's `AudioContext` started as `running`).

---

## 1. Key findings

1. **There are no hit markers and no crosshair feedback at all.** The crosshair is one static `div` that no script touches. README's "crosshair with hit markers", "combo counter" and "regeneration indicator" do not exist. Hit confirmation is carried by audio, particles, the enemy health bar and the kill feed.
2. **There is no settings screen.** No volume, sensitivity or key rebinding. `SoundtrackManager.setVolume` and `stop` are never called. The "how to play" screen is the `GAME GUIDE` overlay.
3. **All audio is non-spatial.** `play(name, position)` has distance falloff, but no call site passes a position. An enemy 60 u away is as loud as one at your feet. There is no panning. The falloff path also corrupts volumes if it ever runs **[measured]**.
4. **Non-lethal headshots are audio-only because of a crash.** `createBloodJet` throws before the score, feed line, `registerHeadshot` and damage run. Three sounds and a yellow burst fire, then the frame aborts with the enemy unhurt **[measured]**. See section 12.3. This corrects doc 05, which says any headshot hit counts toward Slowmo.
5. **Shotgun and autocannon head kills lose the kill credit** for the same reason: no `enemyDie` on the shell path, no score value, no `registerKill`, and the shell never explodes **[measured]**.
6. **One easy track can never play.** Its filename contains `#`, so the URL is cut at the fragment. There is no `error` handler, so the music simply stops until the next state change **[measured]**.
7. **The kill feed breaks after the first strike unlock.** `showAirstrikePopup` injects a second `@keyframes fadeInOut`, which replaces the feed's animation. Lines jump 150 px left and fade from 1.6 s instead of 3.6 s **[measured]**.
8. **The kill feed overlaps the minimap by default.** Feed top 100, minimap bottom 180, same right edge **[measured]**.
9. **Slowmo stretches SFX and leaves music alone.** All 208 `Audio` elements go to rate 0.25, including sounds already playing. `preservesPitch` stays at its default `true` **[measured]**, so this should be a time-stretch and not a pitch drop. The README's "pitch modulation" is unconfirmed. Web Audio's `playbackRate` will behave differently.
10. **The `perk_slowmo` exemption is defeated:** the stinger runs at 0.25 like everything else **[measured]**.
11. **`sounds/30mmshell_flyby.mp3` does not match the file on disk** (`30mmShell_flyBy.mp3`). It works only on a case-insensitive filesystem.
12. **Scope overlay, perk labels and strike chips draw above the pause and game-over screens** **[measured]**.
13. **`fps-game.html` has no UI or audio feature that `index.html` lacks**, apart from one-click start and a kill feed that cannot be corrupted. See section 20.

---

## 2. Visual style

The look is a terminal-style debug HUD. There are no images, no icon fonts and no web fonts.

| Property | Value |
|---|---|
| Font | `'Courier New', monospace` on `body` and `.hud`. `<button>` does not inherit it, so START GAME and GAME GUIDE render in the UA sans-serif **[measured]** |
| Reset | `* { margin:0; padding:0; box-sizing:border-box }` |
| Body | `background:#000; overflow:hidden` |
| Text legibility | Drop shadows, typically `2px 2px 4px rgba(0,0,0,0.8)`. No panels behind most HUD text |

**Palette**

| Colour | Use |
|---|---|
| `#00ff00` | Titles, ammo, player on minimap, Adrenaline, Warthog, FPS and debug text, START button |
| `#ffff00` | Subtitles, reserve ammo, `RELOADING...`, pickups on minimap, `NEW HIGH SCORE!` |
| `#ff6600` | Guide headings, Hellfire, Airstrike, GAME GUIDE button |
| `#ff0000` | Blood Thirst, Berserk, ammo empty, CLOSE GUIDE button |
| `#ffaa00` | Ammo low |
| `#00ffff` | Slowmo |
| `#ff00ff` | Berserk in the guide only. The real label is red |
| `#ff4444` | Enemies on minimap |
| `#aaa`, `#888` | Secondary text, weapon name, "Click Anywhere" |

**Z-index ladder**

| z | Element | Notes |
|---|---|---|
| 50 | `.weapon-display` | Dead CSS. No element uses it |
| 98 | `.damage-flash` | Inside `.hud`'s stacking context, so it paints over HUD siblings |
| 99 | `.hud` | `pointer-events:none` |
| 100 | `.crosshair` | |
| 200 | Splash, menu, pause, game over | |
| 999 | Scope overlay | **Above** pause and game over |
| 1000 | Perk labels, popups, chips, targeting text | **Above** pause, game over and menu |
| 2000 | `#guideScreen` | |

**Animations**

| Name | Defined at | Keyframes | Used by |
|---|---|---|---|
| `fadeInOut` (A) | CSS 173 | 0% opacity 0, `translateX(100px)`; 10% and 90% opacity 1, `translateX(0)`; 100% opacity 0, `translateX(-100px)` | `.kill-message`, `4s ease` |
| `fadeInOut` (B) | Injected 6475 and 6512 | 0% opacity 0, `translateX(-50%) scale(0.8)`; 20% opacity 1, `scale(1.1)`; 40% opacity 1, `scale(1)`; 100% opacity 0, `scale(1)` | Strike popups, `3s ease-out`. **Replaces A everywhere** |
| `pulse` (A) | CSS 180 | Opacity 0.5, 1, 0.5 | "Click Anywhere", `2s infinite` |
| `pulse` (B) | Injected 5964 | `translateX(-50%) scale(1)` to `scale(1.1)` | Blood Thirst, `0.5s ease-in-out infinite alternate` |
| `pulse` (C) | Injected 6300 | scale 1, 1.1, 1 with `translateX(-50%)` | Berserk, `0.5s infinite`. **Wins once injected** |
| `speedPulse` | Injected 6090 | `scale(1) rotate(-2deg)` to `scale(1.05) rotate(2deg)` | Adrenaline, `0.3s ease-in-out infinite alternate` |
| `fireFlicker` | Injected 6194 | `scale(1)`, `brightness(1)` to `scale(1.05)`, `brightness(1.3)` | Hellfire, `0.3s ease-in-out infinite alternate` |

Later `@keyframes` with the same name win across the whole document. **[measured]** rule order after everything fired: `main:fadeInOut, main:pulse, bloodThirstStyle:pulse, hellfireStyle:fireFlicker, adrenalineStyle:speedPulse, berserkStyle:pulse, airstrikePopupStyle:fadeInOut`.

Other transitions: `.health-bar` width `0.3s ease`, `.damage-flash` opacity `0.1s ease`.

---

## 3. Screens and flow

`GameState` (478): `splash`, `menu`, `playing`, `paused`, `game_over`. The renderer draws every frame in every state, so the arena is visible through each overlay. HUD text also shows faintly behind them.

| From | Trigger | To | Music | SFX |
|---|---|---|---|---|
| Load | `load` event | SPLASH | None | None |
| SPLASH | Click on `#splashScreen` | MENU | `startMenuMusicIfNeeded` | `menu_select` |
| MENU | START GAME | PLAYING, once pointer lock is true | `switchToEasy` | `menu_select` |
| MENU | GAME GUIDE | Stays MENU, overlay shown | Unchanged | `menu_select` |
| Guide | CLOSE GUIDE | Overlay hidden | Unchanged | `menu_select` |
| PLAYING | Esc `keydown` | PAUSED | `pause()` | None |
| PAUSED | Esc, or any click | PLAYING | `resume()` | None |
| PLAYING | `player.isDead()` | GAME_OVER | `switchToMenu` | None. No death sound beyond the last `playerHit` |
| GAME_OVER | Space | PLAYING | `switchToEasy` | None |
| GAME_OVER | Esc | MENU | Keeps playing | None |

`showSplash()` is never called. The splash exists for one reason: its click is the user gesture that unlocks autoplay (comment at 7307).

Start sequence: the button sets `shouldStartGame = true` and requests pointer lock. `animate()` in MENU starts the game when both the flag and `isPointerLocked` are true. If the lock is refused, nothing happens and nothing tells the player.

### 3.1 Splash (353-358)

`.menu-screen` with inline `display:flex; cursor:pointer`. Background `rgba(0,0,0,0.9)`, centred.

- `OVERPOWERED`, `.menu-title` overridden to 72px, margin-bottom 50px, `#00ff00`, bold, `text-shadow: 3px 3px 6px rgba(0,0,0,0.8)`
- `Click Anywhere`, 24px, `#888`, `pulse 2s infinite`

### 3.2 Main menu (361-385)

| Element | Style | Text |
|---|---|---|
| Title | 48px bold `#00ff00`, margin-bottom 30 | `OVERPOWERED` |
| Subtitle | 24px `#ffff00`, margin-bottom 40 | `Unleash Chaos. Survive the Onslaught.` |
| Instructions | 16px centred, line-height 1.6, max-width 600 | Three lines, below |
| Controls | 14px `#aaa`, margin-top 30, centred | Five groups, below |
| START GAME | `padding:15px 30px; font-size:20px; margin:10px; background:#00ff00; color:#000; border:none` | |
| GAME GUIDE | Same, `background:#ff6600; color:#fff` | |

There are no hover, focus or active styles. High score is not shown here.

```
Survive endless waves of enemies with an arsenal of devastating weapons!
Chain kills to unlock PERKS and call in AIRSTRIKES for maximum destruction.
Collect health and ammo pickups to stay in the fight.

MOVEMENT: WASD - Move | Mouse - Look | Space - Jump | Shift - Sprint
COMBAT:   Left Click - Fire | Right Click - Alt Fire/Zoom | R - Reload
WEAPONS:  1 - SMG | 2 - Shotgun | 3 - Rocket | 4 - Autocannon | 5 - Sword
STRIKES:  X - Airstrike | Z - Warthog Strike
SYSTEM:   ESC - Pause | F - FPS Counter | G - Debug
```

`C` (crouch and slide) is not listed anywhere.

### 3.3 Game guide, the "how to play" (408-472)

Fixed full-screen, `background:rgba(0,0,0,0.95)`, `overflow-y:auto`, `padding:20px`, content `max-width:800px`. `h1` 48px `#00ff00` centred. `h2` `#ff6600` with `border-bottom: 2px solid #ff6600`. Content is 1148 px tall on an 800 px viewport, so it scrolls **[measured]**. Only CLOSE GUIDE closes it (`#ff0000`, white text). Esc does nothing, because `handleEscapeKey` has no MENU case. The menu shows through faintly at 95% **[measured]**.

```
PERKS SYSTEM
BLOOD THIRST (#ffff00) - 4 kills in 5 seconds
  Infinite ammo for 10 seconds / 2x damage multiplier
HELLFIRE (#ff0000) - 10 kills in 10 seconds
  All bullets become explosive for 5 seconds / Instakill damage
BERSERK (#ff00ff) - 15 kill combo
  3x shotgun pellets / Increased fire rate for 10 seconds / 15% movement speed boost
SLOWMO (#00ffff) - 3 headshots in 3 seconds
  Time slows to 25% speed / You move at normal speed for 5 seconds
ADRENALINE (#00ff00) - 3 sword kills in 3 seconds
  10% speed boost per stack (up to 3 stacks) / Each stack lasts 5 seconds / New stacks refresh the timer

AIRSTRIKES
AIRSTRIKE (#ff6600) - 8 kill combo
  Press X to activate targeting / Click to call in 15 rockets + 1 hellfire missile / 30 second cooldown
WARTHOG STRIKE (#00ff00) - 12 kill combo
  Press Z to activate targeting / Click to call in A-10 Warthog gun run
  Fires 50 explosive 30mm shells / 45 second cooldown

WEAPON TIPS
SMG - High fire rate, reliable damage
SHOTGUN - Devastating at close range, headshots decapitate
ROCKET - Area damage, great for groups
AUTOCANNON - 30mm explosive rounds, right-click to zoom, headshots decapitate
SWORD - Combo attacks, right-click for heavy slam

SURVIVAL TIPS
Chain headshots to trigger SLOWMO
Use sword for Adrenaline speed boost
Save airstrikes for overwhelming waves
Combo perks stack for devastating power
Keep moving - enemies spawn from all directions
Collect pickups quickly before they disappear
```

### 3.4 Pause (399-405)

`.pause-screen`, `rgba(0,0,0,0.8)`. `PAUSED` title, then `Press ESC to resume` and `Press R to restart`. **The second line is false:** the `KeyR` case only runs inside `state === PLAYING`, so its inner `PAUSED` branch is unreachable (7366-7367). Clicking anywhere resumes, which is undocumented. SFX already playing are not paused. Perk timers and strike `setTimeout`s keep running in real time.

### 3.5 Game over (388-396, `endGame` 7499)

`.game-over-screen`, `rgba(255,0,0,0.9)`. Title stays green and subtitle stays yellow, on red. `.menu-controls` `#aaa` on red is hard to read **[measured]**.

```
GAME OVER
You have been eliminated
Final Score: N
Kills: N
Wave Reached: N
NEW HIGH SCORE!        (only when beaten, #ffff00)
High Score: N
Press SPACE to restart
Press ESC to return to menu
```

High score is stored in `localStorage` under `fps_highscore`, read at startup and written by `checkHighScore`. `Space` restarts without requesting pointer lock: state is PLAYING with `isPointerLocked === false` **[measured]**, so the player has no mouse until they click (8716-8729 re-acquires).

### 3.6 Settings

There is none. Fixed values: SFX master 0.5, music 0.3, `mouseSensitivity` 0.002. No fullscreen toggle, no pause menu buttons, no way back to the menu from pause.

---

## 4. HUD layout

```
+------------------------------------------------------------------+
| Score: 0              FPS: 60 (top 30, hidden)        +--------+ |
| Wave: 1               BLOOD THIRST [9.9s]  top 80     |        | |
| Enemies: 0            HELLFIRE [4.9s]      top 110    | mini   | |
|                       ADRENALINE/BERSERK   top 140    | map    | |
|                       SLOWMO [4.9s]        top 170    +--------+ |
| debug panel top 200   AIRSTRIKE READY!     top 200               |
|                                                 kill feed starts |
|                              -+-                top 100 right 30 |
|                                                 and overlaps map |
|                                                                  |
|                       RELOADING...         bottom 100        SMG |
| [WARTHOG [Z]] [AIRSTRIKE [X]]  bottom 60                      30 |
| [=====100=====]                bottom 30                      90 |
+------------------------------------------------------------------+
```

| Element | ID | Position | Style | Behaviour |
|---|---|---|---|---|
| Stats | `scoreDisplay`, `waveDisplay`, `enemyCount` | top 30, left 30 | 16px white, shadow | `Score:`, `Wave:`, `Enemies:`. Instant updates, no count-up |
| Health frame | `.health-bar-container` | bottom 30, left 30, 200x20 | `rgba(255,0,0,0.3)` fill, 2px `#fff` border, radius 10 | Inner area 196x16 **[measured]** |
| Health fill | `healthBar` | | `linear-gradient(90deg,#ff0000,#ffff00 50%,#00ff00)`, radius 8, width `0.3s ease` | Width = HP%. The gradient is **compressed**, so low health still shows red-to-green **[measured]** |
| Health number | `healthText` | Centred on bar | 12px bold white | `Math.ceil(health)` |
| Weapon name | `weaponName` | bottom 30, right 30 | 14px `#aaa`, margin-bottom 5 | SMG, SHOTGUN, ROCKET, SWORD, AIRSTRIKE, A10 WARTHOG, AUTO CANNON |
| Magazine | `currentAmmo` | Under name | 36px bold, colour-coded | Table below |
| Reserve | `reserveAmmo` | Under magazine | 18px `#ffff00` | Shared pool |
| Reload | `reloadIndicator` | bottom 100, centred | 18px bold `#ffff00` | Static `RELOADING...`. No progress bar. Same spot as the targeting text |
| FPS | `fpsCounter` | top 30, centred | 14px bold `#00ff00` | F toggles in any state. Updates once per second |
| Debug | `debugInfo` | top 200, left 30 | 12px monospace `#00ff00`, `rgba(0,0,0,0.7)`, padding 10, radius 5 | G toggles. Position, health, enemies, active bullets, velocity. Updates only during `updateGame` |

**Ammo text and colour** (`updateAmmoDisplay`, 4986)

| State | Magazine text | Reserve text |
|---|---|---|
| Sword | `-` | `-` |
| Walkie-talkie, Warthog | `READY` | `-` |
| Blood Thirst | `∞` | `∞` |
| Otherwise | Number | Number |

Colour from `currentAmmo / maxAmmo`: exactly 0 is `#ff0000`, at most 0.33 is `#ffaa00`, otherwise `#00ff00`.

| Weapon | Orange at | Red at |
|---|---|---|
| SMG (30) | 9 or fewer | 0 |
| Shotgun (6) | 1 (2/6 is 0.333, above the threshold) | 0 |
| Rocket (1) | Never | 0 |
| Autocannon (5) | 1 | 0 |

The sword gives `0/0 = NaN`, which falls through to green.

**World-space UI: enemy health bars** (`createHealthBar` 2247). Two `PlaneGeometry(1, 0.1)` planes at `size + 0.5` above the enemy, background `0x440000`, billboarded with `lookAt(player)`. Fill colour: above 60% `0x00ff00`, above 30% `0xffff00`, else `0xff0000`. This is the only per-hit visual that shows exact damage, and it hides the moment the enemy dies. Enemies do not flash when hit.

---

## 5. Crosshair, hit markers and scope

**Crosshair** (24-60). One `div.crosshair`, centred, z 100. No script ever selects it.

| Part | Geometry | Colour |
|---|---|---|
| Dot | 4x4 px, round | `#fff`, opacity 0.8, `box-shadow: 0 0 0 1px rgba(0,0,0,0.5)` |
| Horizontal | 20x1 px, `left:-8px` | `#fff`, opacity 0.6 |
| Vertical | 1x20 px, `top:-8px` | `#fff`, opacity 0.6 |

The lines sit inside the dot's opacity group, so they render at 0.48. They run through the dot, with no gap. There is no spread, no firing reaction, no colour change over enemies, and it does not hide for the sword or in the scope.

**Hit markers:** none exist in code.

**Scope overlay** (`createScopeOverlay`, 5073), created lazily on the first autocannon right-click:

| Part | Value |
|---|---|
| Layer | Fixed, full-screen, `pointer-events:none`, z 999 |
| Reticle | 200x200 px centred. Lines 2 px `rgba(255,0,0,0.7)`, 4 px dot `rgba(255,0,0,0.9)` |
| Vignette | `radial-gradient(circle, transparent 30%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0.8) 100%)` |
| FOV | 75 to 30, an instant cut with no ease |
| Sound | `autocannon_zoom` on both toggle in and out, 0.35, 0.23 s |
| Cleared by | Weapon switch (`clearZoom`). **Not** by pause or death |

The white crosshair stays visible under the red reticle.

---

## 6. Damage feedback

Only two calls reach `player.takeDamage`: enemy bullets (8562) and blasts (7903, which includes the player's own rockets at half damage). Enemy melee deals no damage.

| Layer | Detail |
|---|---|
| Screen flash | `#damageFlash`: `radial-gradient(circle, transparent 30%, rgba(255,0,0,0.3) 100%)`. Opacity to 1 over 100 ms, `setTimeout` 200 ms, back to 0 over 100 ms. About 300 ms total. Peak is only 30% red, at the edges |
| Sound | `playerHit`: `enemy_hit.mp3` at 0.30, on its own pool. The same sample as hitting an enemy, but louder |
| Health bar | Width eases over 0.3 s, number snaps |
| Particles | Bullets only: `createExplosion(playerPos, 0xff0000, 10)` at the **eye point** (8563). Opaque red blobs burst around the camera and can cover much of the screen **[measured]**. This is the strongest damage cue in the game, and it looks accidental |

Missing: direction indicator, camera kick, low-health state, heartbeat, death sound or animation. Timers are not cancelled, so a hit at t=0 followed by one at t=150 ms fades at t=200 ms and shortens the second flash.

During Berserk, `takeDamage` returns first: no flash, no sound, no bar change. The eye-point particles at 8563 still spawn, because they sit outside `takeDamage`.

**Screen shake, full table.** Details are in doc 03. Radians, `+/- intensity/2` on pitch and roll, 50 ms unless noted. `addScreenShake` overwrites, so it does not stack.

| Source | Intensity |
|---|---|
| SMG shot | 0.004 |
| Shotgun shot | 0.02 |
| Rocket shot | 0.04 |
| Autocannon shot | 0.03 |
| Sword hit (only if it connects) | 0.01 |
| Shell explosion | 0.03 |
| Rocket or Hellfire bullet explosion | 0.06 |
| Sword area attack (even on a whiff) | 0.15 |
| Heavy finisher explosion | 0.15 |
| Hellfire rocket | 0.24 for 100 ms |

---

## 7. Kill feed

`UIManager.addKillMessage` (7095). Container: fixed, top 100, right 30, 300 wide, 14px white. Line: `rgba(0,0,0,0.7)`, padding `5px 10px`, margin `2px 0`, radius 5. New lines append at the bottom. Maximum 5, oldest removed. `setTimeout` removes after 4000 ms. `textContent`, so it is injection-safe.

It is an event log, with no killer or victim. Every string:

| Text | Trigger | Line |
|---|---|---|
| `Enemy eliminated +{score}` | Kill by bullet, sword, explosion | 4955, 7768, 7882, 8288, 8422 |
| `HEADSHOT! +50` | Headshot that gets past `createBloodJet` | 8256, 8354 |
| `HEAVY FINISHER! +{score*2}` | Heavy finisher kill | 4635 |
| `Area Attack Kill! +{score}` | Area swing kill | 4764 |
| `Health restored +30` | Health pickup | 8598 |
| `Ammo collected +30` | Ammo pickup | 8601 |

A clean headshot kill writes two lines. Perks, waves and strikes write nothing.

**Normal timing (keyframes A):** 0.4 s fade and slide in from +100 px, 3.2 s hold, 0.4 s fade and slide to -100 px.

**After the first strike unlock (keyframes B)** **[measured]:** opacity 1 at 1 s, 0.13 at 3 s. Rect at 1 s moves from left 950, right 1250 to left 791, right 1109 at 1280 wide. `translateX(-50%)` of a 300 px line is -150 px. Lines start at scale 0.8, overshoot to 1.1, settle at 1, and fade from 40%.

The default feed overlaps the minimap's lower 80 px and paints over it **[measured]**. The bug moves the feed almost clear of the map, so the broken state happens to look better placed.

---

## 8. Minimap

`UIManager.drawMinimap` (7158), called from `animate()` while PLAYING. Canvas 150x150. CSS: top 30, right 30, `rgba(0,0,0,0.7)`, 2px `#fff` border, radius 10. Under `box-sizing:border-box` the content box is 146x146, so the bitmap is scaled by 0.973 **[measured]**.

| Item | Draw |
|---|---|
| Scale | 1 px per world unit, centred on world origin, north fixed. Shows +/-75, and the arena fills the middle |
| Background | `fillRect` `rgba(0,0,0,0.8)` |
| Frame | `strokeRect(1,1,148,148)`, `#ffffff`, 1 px |
| Player | `#00ff00` circle r=3 |
| Heading | `#00ff00` line, width 2, 10 units long |
| Enemies | `#ff4444` circles r=2 (`enemy.active` only) |
| Pickups | `#ffff00` circles r=1.5. Health and ammo look the same |
| Mapping | `x = 75 + wx`, `y = 75 - wz` |

Behaviour worth knowing:

- **Accidental radar trails.** The "clear" uses an 80% alpha fill, so old pixels decay by 0.2 each frame. **[measured]** A green pixel goes 255, 51, 10, 2, 0: a 3-4 frame ghost. Background alpha builds 204, 245, 253, 255, so the CSS background ends up hidden.
- **Heading is mirrored.** Yaw 0 looks down -z, and the line draws **downward** **[measured]**. +x still draws right, so the map is flipped against the player's sense of forward.
- No walls or obstacles, no fog of war, no enemy type difference. It is fixed to the world, so it neither rotates nor follows the player.
- Allocates a `Vector3` and `Euler` every frame.

---

## 9. Perk and strike notifications

All built with inline `cssText` in `Player`, appended to `body`, lazily created then reused. Timers tick each frame from `updateX`. Common: fixed, `left:50%`, `translateX(-50%)`, bold, z 1000.

| Perk | `id` | Top | Size | Colour | Text shadow | Animation | First frame | Afterwards |
|---|---|---|---|---|---|---|---|---|
| Blood Thirst | `bloodThirstUI` | 80 | 24 | `#ff0000` | `2px 2px 4px rgba(0,0,0,.8), 0 0 20px rgba(255,0,0,.5)` | `pulse .5s ease-in-out infinite alternate` | `BLOOD THIRST` | `BLOOD THIRST [9.9s]` |
| Hellfire | `hellfireUI` | 110 | 24 | `#ff6600` | `2px 2px 4px rgba(0,0,0,.8), 0 0 20px rgba(255,165,0,.7)` | `fireFlicker .3s ease-in-out infinite alternate` | `HELLFIRE` | `HELLFIRE [4.9s]` |
| Adrenaline | `adrenalineUI` | 140 | 24 | `#00ff00` | `2px 2px 4px rgba(0,0,0,.8), 0 0 20px rgba(0,255,0,.5)` | `speedPulse .3s ease-in-out infinite alternate` | `ADRENALINE` | `ADRENALINE x2 [4.9s]` (`xN` from 2 stacks) |
| Berserk | `berserkUI` | 140 | 32 | `#ff0000` | `0 0 10px #ff0000, 0 0 20px #ff0000` | `pulse .5s infinite` | `BERSERK ACTIVATED!` | `BERSERK! 9.9s` |
| Slowmo | `slowmoUI` | 170 | 24 | `#00ffff` | `0 0 10px #00ffff` | None | `SLOWMO ACTIVATED!` | `SLOWMO [4.9s]` |

Only the first three set `pointer-events:none`. The "ACTIVATED!" strings last one frame, because the timer update overwrites them. Labels simply appear and disappear with `display`, with no enter or exit motion. Perk end has no sound.

**Measured boxes at 1280 wide:** Blood Thirst 80-107, Hellfire 110-137, Adrenaline 137-170, Berserk 140-176, Slowmo 170-197. **Adrenaline and Berserk draw on top of each other, and the text becomes unreadable** **[measured]**. Slowmo touches Berserk.

**Ready popups** (`showAirstrikePopup` 6452, `showWarthogPopup` 6489). Top 200, 28px bold, `fadeInOut 3s ease-out`, removed by `setTimeout` at 3000 ms. New element per call.

| Text | Colour | Shadow |
|---|---|---|
| `AIRSTRIKE READY!` | `#ff6600` | `0 0 10px #ff6600, 0 0 20px #ff3300` |
| `WARTHOG STRIKE READY!` | `#00ff00` | `0 0 10px #00ff00, 0 0 20px #00aa00` |

Same top, so they overlap if both unlock on one kill. Timing: 0.6 s pop in with overshoot, 0.6 s settle, 1.8 s fade.

**Availability chips** (6397, 6429). Above the health bar, bottom 60. `rgba(0,0,0,0.7)`, padding `5px 10px`, radius 5, 14px bold span.

| Text | Colour and border | Left |
|---|---|---|
| `WARTHOG [Z]` | `#00ff00` | Always 30 |
| `AIRSTRIKE [X]` | `#ff6600` | 30, or 150 while Warthog is shown |

Removed only by using the strike. They survive restart, along with availability itself.

**Targeting text.** Bottom 100, centred, 20px, shadow `2px 2px 4px rgba(0,0,0,0.8)`, z 1000. `Click to call airstrike at location` in `#ff6600`, `Click to call A10 Warthog gun run` in `#00ff00`. Per doc 05 the click that starts targeting also confirms it, so this text exists for about one frame.

---

## 10. AudioManager (487-716)

| Property | Value |
|---|---|
| Backend | One HTML5 `Audio` per voice. Web Audio is used only for the `pickup` beep |
| Master | `volume = 0.5`, baked into each element at creation. No setter |
| Pool | 4 voices per key: `new Audio` plus 3 `cloneNode()`. Round-robin `currentIndex`. **208 elements total** **[measured]** |
| Preload | `preload='auto'` |
| Voice stealing | Reusing a voice sets `currentTime` and plays, cutting whatever it held |
| Rate | `globalPlaybackRate`, 1.0 or 0.25 |
| Pitch variation | **None.** Variation comes only from choosing between files or from chance |
| Spatial | **None in practice** |

`play(soundName, position = null)` dispatch: `'pickup'` to `playPickup`, `'footstep'` to `playFootstep`, `'bulletHit'` to `playRandomBulletHit` (one of 4), else the pool. Unknown names fail silently.

Special cases inside the pool's `play`:

- Path containing `enemy_headshot3`: start at `currentTime = 1.0`, skipping a second of silence.
- Path containing `perk_slowmo`: force rate 1.0, which is immediately overwritten (section 14).

**The unused positional path** (661-686). Worth keeping as a design record: full volume to 5 u, linear falloff to 50 u, floor at 10%, silent past 50. It has two bugs. It derives the base from `instances[0].volume`, which it mutates. **[measured]** Four calls at 27.5 u took volumes from `[0.2, 0.2, 0.2, 0.2]` to `[0.1, 0.05, 0.05, 0.05]`, permanently. It also skips the `enemy_headshot3` and `perk_slowmo` rules. `setPlayerPosition` runs every frame for nothing. The comment at 7714, "globally (no distance falloff)", describes every sound in the game.

**Procedural sounds.**

| Sound | Graph | Envelope |
|---|---|---|
| `pickup` | Default sine. 400 Hz, 800 Hz at +0.1 s, 1200 Hz at +0.2 s (stepped) | Gain 0.15, exponential to 0.001 over 0.3 s |
| `footstep` | Sawtooth 80 Hz, lowpass 200 Hz | Gain 0.05 to 0.001 over 0.1 s. **Dead**, never called |

`AudioContext` is created at load and never explicitly resumed. Whether the pickup beep works before a gesture-started node depends on the browser. Pickup ignores slowmo.

**Limits.** Effective volume must stay at or below 1, or assigning `audio.volume` throws. With master 0.5 the loudest is 0.8. Raising master above 0.625 would crash `createSound` on `30mmshell_explode` (defined 1.6). Defined volumes above 1 only work because of the 0.5.

In the test run, several sounds issued a network request on first play despite `preload='auto'` (status 206) **[measured]**. I did not investigate this. Real-host latency is unknown.

---

## 11. Every sound

Effective = defined x 0.5, confirmed against `instance.volume` **[measured]**. File paths are relative to `sounds/`. Length is the file's duration.

**Weapons**

| Key | File | Def | Eff | Len s | Trigger |
|---|---|---|---|---|---|
| `shoot` | `smg_fire.mp3` | 0.3 | 0.15 | 0.72 | SMG shot (`soundName`) |
| `shotgun` | `shotgun_fire.mp3` | 0.32 | 0.16 | 1.27 | Shotgun shot, once per blast |
| `rocket` | `rocket_fire.mp3` | 0.4 | 0.20 | 2.02 | Rocket shot |
| `autocannon_fire` | `autocannon_fire.mp3` | 1.05 | 0.525 | 3.62 | Autocannon. Direct voice control, **stopped after 500 ms** (4372-4388) |
| `autocannon_fire2` | `autocannon_fire2.wav` | 0.79 | 0.395 | 2.55 | Layered on the same shot, played in full |
| `autocannon_zoom` | `autocannon_zoom.wav` | 0.7 | 0.35 | 0.23 | Scope in and out |
| `reload` | `smg_reload.mp3` | 0.4 | 0.20 | 0.84 | `startReload`, **all weapons** |
| `swordSwing` | `sword_swing.mp3` | 0.5 | 0.25 | 0.39 | Every swing, area attack, finisher |
| `swordHit1` | `sword_hit1.mp3` | 0.6 | 0.30 | 1.25 | Per enemy hit |
| `swordHit2` | `sword_hit2.mp3` | 0.6 | 0.30 | 1.06 | Per enemy hit, and as the extra whoosh on `combo3` and `heavyFinisher` (4854) |
| `swordSlam` | `sword_slam.mp3` | 0.7 | 0.35 | 0.73 | Queued heavy finisher (3897) |

**Perk shot layers** (per trigger pull, 4407-4419, after the base sound)

| Key | File | Def | Eff | Len s | Trigger |
|---|---|---|---|---|---|
| `bloodthirstyShot` | `bloodthirsty_shot.mp3` | 1.0 | 0.50 | 1.68 | Blood Thirst active |
| `berserkShot` | `berserk_shot.mp3` | 0.7 | 0.35 | 0.63 | Berserk active |
| `hellfireShot` | `hellfire_shot.mp3` | 0.6 | 0.30 | 0.82 | Hellfire active |

These do not play for melee: `performMeleeAttack` returns before this code.

**Explosions**

| Key | File | Def | Eff | Len s | Trigger |
|---|---|---|---|---|---|
| `rocketExplosion` | `rocket_explosion.mp3` | 0.5 | 0.25 | 1.54 | Rocket blast, heavy finisher. Also under the Hellfire rocket |
| `hellfireBulletExplode` | `hellfirebullet_explode.mp3` | 0.5 | 0.25 | 3.02 | Hellfire bullet blast (replaces `rocketExplosion`) |
| `hellfireRocketExplode` | `hellfirerocket_explode.mp3` | 1.4 | 0.70 | 4.58 | Hellfire rocket and airstrike finisher |
| `30mmshell_explode` | `30mmshell_explode.mp3` | 1.6 | 0.80 | 2.11 | Each shell impact. **Loudest sound in the game** |

**Enemies and impacts**

| Key | File | Def | Eff | Len s | Trigger |
|---|---|---|---|---|---|
| `enemyHit` | `enemy_hit.mp3` | 0.4 | 0.20 | 1.32 | Body hit, sword hit, each enemy in a blast |
| `enemyGrunt` | `enemy_grunt.mp3` | 0.4 | 0.20 | 0.94 | 10% on body or sword hit |
| `enemyDie` | `enemy_die.mp3` | 0.5 | 0.25 | 1.87 | Every kill path except the 30mm crash |
| `enemyDeathGrunt` | `enemy_deathgrunt.mp3` | 0.5 | 0.25 | 1.15 | 1/6 on bullet, shell and sword kills |
| `enemyExplode` | `enemy_explode.mp3` | 0.5 | 0.25 | 3.66 | Explosive kill, when `shouldPlayExplodeSound` (50%, 2786) |
| `enemyHeadshot` | `enemy_headshot.mp3` | 0.75 | 0.375 | 1.65 | Headshot, layer 1 |
| `enemyHeadshot2` | `enemy_headshot2.mp3` | 0.5625 | 0.281 | 1.06 | Headshot, layer 2 |
| `enemyHeadshot3` | `enemy_headshot3.mp3` | 0.75 | 0.375 | 6.09 (5.09 heard) | Headshot, layer 3, from 1.0 s |
| `enemyShoot` | `enemy_shoot.mp3` | 0.15 | 0.075 | 2.50 | Every enemy shot, any distance |
| `bulletWhizz` | `bullet_whizz.mp3` | 0.4 | 0.20 | 3.74 | Enemy bullet within 3 u, once per bullet (`hasWhizzed`) |
| `bulletHit1` | `bullet_hit1.mp3` | 0.3 | 0.15 | 1.90 | Random 1 of 4 via `'bulletHit'`: ground or wall hit, player or enemy bullet |
| `bulletHit2` | `bullet_hit2.mp3` | 0.3 | 0.15 | 0.98 | Same |
| `bulletHit3` | `bulltet_hit3.mp3` (typo on disk, in code too) | 0.3 | 0.15 | 1.90 | Same |
| `bulletHit4` | `bullet_hit4.mp3` | 0.3 | 0.15 | 1.90 | Same |

**Perk stingers**

| Key | File | Def | Eff | Len s | Trigger |
|---|---|---|---|---|---|
| `perkBloodthirsty` | `perk_bloodthirsty.mp3` | 0.7 | 0.35 | 3.55 | Blood Thirst on |
| `perkHellfire` | `perk_hellfire.mp3` | 0.8 | 0.40 | 4.56 | Hellfire on |
| `perkAdrenaline` | `perk_adrenaline.mp3` | 0.7 | 0.35 | 1.94 | First Adrenaline and each new stack. Silent at max stacks |
| `perkBerserk1` | `perk_berserk1.mp3` | 0.8 | 0.40 | 8.10 | Berserk on, simultaneous |
| `perkBerserk2` | `perk_berserk2.mp3` | 1.2 | 0.60 | 4.78 | Berserk on, simultaneous |
| `perkBerserk3` | `perk_berserk3.mp3` | 0.8 | 0.40 | 4.99 | Berserk on, simultaneous |
| `perkSlowmo` | `perk_slowmo.mp3` | 0.8 | 0.40 | 3.47 | Slowmo on, at rate 0.25 |
| `perkAirstrike` | `perk_airstrike.mp3` | 0.8 | 0.40 | 4.49 | Airstrike **and** Warthog ready ("for now", 6418) |

**Strikes**

| Key | File | Def | Eff | Len s | Trigger |
|---|---|---|---|---|---|
| `walkieTalkieFire` | `walkietalkie_fire.mp3` | 0.7 | 0.35 | 0.38 | Strike called |
| `airstrikeActivate` | `airstrike_activate.mp3` | 1.0 | 0.50 | 6.05 | Strike confirmed, +3 s airstrike, +2 s Warthog |
| `30mmshell_flyby` | `30mmshell_flyby.mp3` (see section 15) | 0.5 | 0.25 | 0.94 | Each shell spawn, 20 Hz |
| `warthog_flyby` | `warthog_flyby.wav` | 0.8 | 0.40, forced to **0.80** | 8.77 | +6.5 s. All voices set to `min(1, 0.8*2*0.5)` before play (6831) |

**Player and UI**

| Key | File | Def | Eff | Len s | Trigger |
|---|---|---|---|---|---|
| `playerHit` | `enemy_hit.mp3` | 0.6 | 0.30 | 1.32 | `takeDamage` |
| `player_footstep1` | `player_footstep1.mp3` | 0.2 | 0.10 | 0.44 | Random 1 of 3. 0.5 s walk, 0.35 s sprint, 0.7 s crouch |
| `player_footstep2` | `player_footstep2.mp3` | 0.2 | 0.10 | 0.42 | Same |
| `player_footstep3` | `player_footstep3.mp3` | 0.2 | 0.10 | 0.39 | Same |
| `player_jump` | `player_jump.mp3` | 0.3 | 0.15 | 0.37 | Jump |
| `player_land` | `player_land.mp3` | 0.3 | 0.15 | 0.60 | Landing |
| `slide_ground` | `slide_ground.mp3` | 0.5 | 0.25 | 1.73 | Slide start, never stopped early |
| `menu_select` | `menu_select.wav` | 0.7 | 0.35 | 0.25 | Splash, START, GUIDE, CLOSE |
| `pickup` | Procedural | | 0.15 | 0.30 | Any pickup |
| `footstep` | Procedural | | 0.05 | 0.10 | **Never called** |

**Events with no sound:** weapon switch, dry fire, wave start or clear, game over, perk expiry, low health, hover on buttons, kill confirmation as a distinct cue, enemy footsteps.

**Voice stealing at speed.** SMG at 20 shots/s reuses each voice every 0.2 s, so only the first 200 ms of the 0.72 s file is heard. In Berserk (fire rate x0.75) it is 150 ms. The shell cascade has the same property, which doc 05 notes is deliberate for the "BRRRT".

---

## 12. What stacks on one event

### 12.1 Trigger pull

Same frame, in code order: ammo decrement, recoil, shake, muzzle flash (50 ms, or 100 ms with shrink for autocannon), pellets or bullets spawn, base sound, perk layers, HUD ammo. With all three perks active on SMG, four sounds stack: 0.15 + 0.50 + 0.35 + 0.30. **The Blood Thirst layer is over 3x louder than the SMG itself**, so a buffed gun sounds like a different weapon.

Autocannon: `autocannon_fire` (0.525, first 500 ms) plus `autocannon_fire2` (0.395, full 2.55 s) plus shake 0.03, recoil 0.15, a two-stage flash and any perk layers.

### 12.2 Body hit

`createExplosion(torso, 0xff4444, 15)`, `enemyHit` (0.20), 10% `enemyGrunt` (0.20), health bar update.

### 12.3 Headshot, as it really runs

Code order (8336-8357): yellow burst `createExplosion(head, 0xffff00, 20)`, three sound layers, blood jet **if non-lethal**, +50, feed line, `registerHeadshot`, then damage x2.

**[measured]** One bullet on one enemy, one `updateGame` call:

| Case | Throws | Sounds | Score | Feed | Headshots counted | Kills | Enemy |
|---|---|---|---|---|---|---|---|
| SMG, non-lethal | **Yes** | 3 layers | 0 | None | 0 | 0 | HP unchanged, bullet still alive |
| SMG, lethal | No | 3 layers + `enemyDie` | 150 | `HEADSHOT! +50`, `Enemy eliminated +100` | 1 | 1 | Dead |
| Shotgun, lethal | **Yes** | 3 layers + `enemyDie` | 50 | `HEADSHOT! +50` | 1 | **0** | Dead, no kill credit |
| 30mm | **Yes** | 3 layers | 50 | `HEADSHOT! +50` | 1 | **0** | Dead, no credit, no shell explosion, bullet still alive |

Cause: `createBloodJet` throws `ReferenceError: safePosition is not defined` (doc 01, B1), directly at 8349, and via `createHeadRemoval` at 8275 and 8394. The lethal SMG path also reaches it, but through `createDismemberment` inside a `try` (8406).

Consequences:

- A throw abandons the rest of `updateGame` and skips that frame's render. The rAF loop survives, because `requestAnimationFrame` is called first.
- `willKill` is `damage*2 >= hp`, against 50, 75 and 100 HP. At base damage an SMG head hit (50) is lethal on a full-HP type 0 only, and a shotgun pellet (40) is non-lethal on every full-HP enemy. Blood Thirst doubles both.
- So Slowmo in practice counts lethal headshots plus shell and shotgun head kills. Doc 05's "any headshot hit" is true of the intent, not the behaviour.
- My test used a near-stationary bullet. At real speed the surviving bullet moves on, so I did not establish how often it re-triggers.

**The intended stack on a clean head kill** (what the sequel should reproduce), all in one frame:

| # | Channel | Effect |
|---|---|---|
| 1 | Particles | 20 yellow burst particles at the head |
| 2 | Audio | `enemyHeadshot` 0.375 + `enemyHeadshot2` 0.281 + `enemyHeadshot3` 0.375, tail up to 5.09 s |
| 3 | Score | +50 |
| 4 | Feed | `HEADSHOT! +50` |
| 5 | Perk | `registerHeadshot`, maybe Slowmo in this frame |
| 6 | Audio | `enemyDie` 0.25, 1/6 `enemyDeathGrunt` 0.25 |
| 7 | Gore | Decapitation (shotgun, autocannon) or dismemberment |
| 8 | Score | +`scoreValue` |
| 9 | Perk | `registerKill`: any of 5 unlocks may fire |
| 10 | Feed | `Enemy eliminated +N` |
| 11 | World | 30% pickup drop |

There is **no** shake, hit-stop, time-scale change, FOV change or crosshair response on a headshot. The weight comes from three audio layers and gore.

### 12.4 Explosions

| Event | Audio | Particles | Shake |
|---|---|---|---|
| Rocket | `rocketExplosion` 0.25 | 50 + 30, shockwave | 0.06 |
| Hellfire bullet | `hellfireBulletExplode` 0.25 | 12 + 8 | 0.06 |
| Hellfire rocket | `rocketExplosion` 0.25 + `hellfireRocketExplode` 0.70 | 120 + 100 + 80 + 60, big shockwave | 0.24, 100 ms |
| 30mm shell | `30mmshell_explode` 0.80 | 25 + 15, 20 sparks, half shockwave | 0.03 |

Per enemy in the blast: `enemyHit`, 10 red particles. If killed: `enemyDie`, 50% `enemyExplode`, feed line. Many enemies in one blast retrigger the same 4 voices in one frame, so extra kills add no loudness.

### 12.5 Sword

| Event | Sounds | Other |
|---|---|---|
| Light swing | `swordSwing` | Shake 0.01 if it connects |
| `combo3` | `swordSwing` + `swordHit2` | |
| Each enemy hit | `swordHit1` + `swordHit2` + `enemyHit`, 10% `enemyGrunt` | 15 red particles |
| Kill | `enemyDie`, 1/6 `enemyDeathGrunt` | Feed |
| Area attack | `swordSwing`, then hits as above | Shake 0.15 always, 25 particles per hit, 30 on kill |
| Heavy finisher, t=0 | `swordSwing` + `swordSlam` | |
| Heavy finisher, +200 ms | `rocketExplosion` | White 60 + 40 + 30, 30 white sparks, shockwave, shake 0.15, `HEAVY FINISHER!` feed lines |

### 12.6 Perk activation

| Perk | Audio | HUD | Gameplay in same frame |
|---|---|---|---|
| Blood Thirst | `perkBloodthirsty` 0.35 | Label, ammo shows `∞` | All magazines filled |
| Hellfire | `perkHellfire` 0.40 | Label | |
| Adrenaline | `perkAdrenaline` 0.35 | Label | |
| Berserk | Three stingers, sum 1.40, up to 8.1 s | Largest label | Akimbo SMG appears, invulnerable |
| Slowmo | `perkSlowmo` 0.40 at rate 0.25 | Label | Time 0.25, all SFX 0.25 |

A chain on one kill can fire several at once. There is no ducking or priority, so stingers overlap the gunfire.

### 12.7 Strike audio timelines

All `setTimeout`, wall-clock: slowmo does not slow them and pause does not stop them. Flight times are computed from speed and height.

**Airstrike**

| t (s) | Event |
|---|---|
| 0 | `walkieTalkieFire` 0.35. Pulsing `0xff6600` ring appears |
| 3.0 | `airstrikeActivate` 0.50 |
| 4.0-5.4 | 15 rockets, one per 100 ms |
| about 4.6-6.1 | Rocket impacts: `rocketExplosion`, shake 0.06 |
| 6.0 | Ring removed (comment says 5 s) |
| 6.5 | Finisher spawns at height 35, speed 60 |
| about 7.1 | Impact: `rocketExplosion` + `hellfireRocketExplode`, shake 0.24 for 100 ms |

**Warthog**

| t (s) | Event |
|---|---|
| 0 | `walkieTalkieFire`. Green corridor pulses |
| 2.0 | `airstrikeActivate` 0.50 |
| 4.0-6.45 | 50 shells, 50 ms apart, each with `30mmshell_flyby` 0.25 |
| about 4.3-6.7 | Impacts at 20 Hz: `30mmshell_explode` 0.80, shake 0.03 |
| 6.5 | `warthog_flyby` 0.80, 8.77 s long. Plays **after** the shells, like a jet outrunning its sound |

### 12.8 Small events

| Event | Stack |
|---|---|
| Pickup | Procedural rising 3-note beep, feed line, heal 30 or ammo 30 |
| Reload | `reload`, `RELOADING...`, magazine animation. Colour updates on completion |
| Enemy bullet near miss | `bulletWhizz` 0.20 under 3 u. No visual |
| Wave change | Number changes. **No banner, no sound.** Wave 10 cuts to hard music, the only "wave" feedback in the game |

---

## 13. Soundtrack (719-877)

`SoundtrackManager`: one `Audio` at a time, created fresh per track. Volume **0.3 absolute**, not multiplied by the 0.5 master, so nominally twice the SMG. States: `menu`, `easy`, `hard`.

| Moment | Call | Result |
|---|---|---|
| Splash click, first time | `startMenuMusicIfNeeded` | Menu track |
| Start game | `switchToEasy` | Easy track |
| Reaching wave 10 exactly (6994) | `switchToHard` | Hard track |
| Pause and resume | `pause()`, `resume()` | Same track continues |
| Death | `switchToMenu` | Menu track from 0 |
| Esc to menu | `startMenuMusicIfNeeded` | No-op, keeps playing |
| Restart | `switchToEasy` | **Always easy, even after wave 10+** |
| Track ends | `ended` listener | New random track, same state |

Every change is a hard cut: `pause()`, `currentTime = 0`, new `Audio`, `play()`. No crossfade, no ducking, no stingers. The first `play()` of each `new Audio` loads the file from scratch, so there can be a gap. Music is never preloaded. Menu is one track, which re-rolls itself at end, so it effectively loops with a gap.

**Selection.** Random from tracks not in `recentlyPlayed[state]`. History capped at `floor(n/2)`: 6 of 13 easy, 5 of 11 hard, so a track cannot repeat within that many picks. The "all recently played" branch needs history >= n-1, which the cap makes unreachable for these lists. It also assigns a new array while the local `recentList` still points at the old one.

**Failure mode.** There is no `error` listener. A failed load logs a warning, `ended` never fires and the music stays silent until the next state change **[measured for the `#` track]**.

**Track list.** Original path, then the file in this repo. Lengths are from the repo's MP3s.

| State | `soundtrack/...` | `public/audio/music/...` | Len s |
|---|---|---|---|
| menu | `menu/15. The Acolyte — Neurotoxin.flac` | `menu/15-the-acolyte-neurotoxin.mp3` | 377 |
| easy | `easy/01-bad_boy_pete-who_is_better.mp3` | `easy/01-bad-boy-pete-who-is-better.mp3` | 425 |
| easy | `easy/01-grady_g-turn_the_bass_up_(original_mix).mp3` | `easy/01-grady-g-turn-the-bass-up-original-mix.mp3` | 418 |
| easy | `easy/01-minor_dott_and_metal_ed-enter_the_darkness__d.a.v.e._the_drummers_acid_remix.mp3` | `easy/01-minor-dott-and-metal-ed-enter-the-darkness-d-a-v-e-the-dr.mp3` | 420 |
| easy | `easy/03-bad_boy_pete-hard_roller_darkness.mp3` | `easy/03-bad-boy-pete-hard-roller-darkness.mp3` | 423 |
| easy | `easy/Bad Boy Pete - Tougher Than Tough (Original Mix).mp3` | `easy/bad-boy-pete-tougher-than-tough-original-mix.mp3` | 346 |
| easy | `easy/DOGMA ( UK ) - Geordie Stomp (Original Mix).mp3` | `easy/dogma-uk-geordie-stomp-original-mix.mp3` | 353 |
| easy | `easy/Mortal Sins - Banshee (Original Mix).mp3` | `easy/mortal-sins-banshee-original-mix.mp3` | 348 |
| easy | `easy/Mortal Sins - Gunfight (Original Mix).mp3` | `easy/mortal-sins-gunfight-original-mix.mp3` | 354 |
| easy | `easy/Mortal Sins - I Will Find U (Original Mix).mp3` | `easy/mortal-sins-i-will-find-u-original-mix.mp3` | 326 |
| easy | `easy/Mortal Sins - Nightshift (Original Mix).mp3` | `easy/mortal-sins-nightshift-original-mix.mp3` | 360 |
| easy | `easy/Mortal Sins - Pandemonium (Original Mix).mp3` | `easy/mortal-sins-pandemonium-original-mix.mp3` | 372 |
| easy | `easy/Mortal Sins - Poltergeist (Original Mix).mp3` | `easy/mortal-sins-poltergeist-original-mix.mp3` | 367 |
| easy | `easy/Various - Tense Trax #02 - 02 - Bad Boy Pete - My Pain Is Forever.mp3` **broken** | `easy/various-tense-trax-02-02-bad-boy-pete-my-pain-is-forever.mp3` | 428 |
| hard | `hard/09. Some More.mp3` | `hard/09-some-more.mp3` | 506 |
| hard | `hard/Alek Szahala - Balag Lamarà.mp3` | `hard/alek-szahala-balag-lamara.mp3` | 539 |
| hard | `hard/Alek Szahala - Caballo.mp3` | `hard/alek-szahala-caballo.mp3` | 406 |
| hard | `hard/Alek Szahala - Invitation.mp3` | `hard/alek-szahala-invitation.mp3` | 400 |
| hard | `hard/Alek Szahala - Unicorn Grove.mp3` | `hard/alek-szahala-unicorn-grove.mp3` | 448 |
| hard | `hard/Alek_Szahala_-_Freezing_Clouds.wav` | `hard/alek-szahala-freezing-clouds.mp3` | 578 |
| hard | `hard/Are Am Eye Kronos Remix.mp3` | `hard/are-am-eye-kronos-remix.mp3` | 401 |
| hard | `hard/HDIZE1043_2009_06_23_Hybridize_Substanced_-_Freeform_Mercury_Mastered_320k_44k_mp3.mp3` | `hard/hdize1043-2009-06-23-hybridize-substanced-freeform-mercury-m.mp3` | 425 |
| hard | `hard/Hollow (Meka Remaster).wav` | `hard/hollow-meka-remaster.mp3` | 488 |
| hard | `hard/Mirage(Meka Remaster).wav` | `hard/mirage-meka-remaster.mp3` | 357 |
| hard | `hard/Mortality(Meka Remaster).wav` | `hard/mortality-meka-remaster.mp3` | 378 |

Tracks run 5.4 to 9.6 minutes, so a short run may never reach a second track.

**The `#` track.** `new Audio('... Tense Trax #02 ...')` resolves to path `/soundtrack/easy/Various%20-%20Tense%20Trax%20` with the rest as a URL fragment. With the real file placed at the exact path, the server received that truncated path, returned 404, and `play()` rejected with `NotSupportedError`, `error.code` 4 **[measured]**. It is a 1 in 13 chance at game start. It was rolled at game start in my test: `currentTrack.error.code` was 4 and nothing retried. The fix is `encodeURIComponent`, or the slugged filename already in `public/audio/music`.

---

## 14. Slowmo and audio

`activateSlowmo` (6342): `play('perkSlowmo')`, then `setGlobalPlaybackRate(0.25)`. `deactivateSlowmo`: rate back to 1.0. Duration 5 s real time. Hard cut in and out, with no ramp.

| Thing | During Slowmo |
|---|---|
| All pooled SFX, including already playing | Rate 0.25 **[measured]** |
| New SFX | Rate 0.25 via `play()`. Autocannon's direct path also reads the global rate |
| `perk_slowmo` | Rate 0.25 **[measured]**, despite the exemption at 595, because the loop in `setGlobalPlaybackRate` runs after `play` and has no exception |
| Music | Rate 1, unaffected **[measured]** |
| `pickup` beep | Unaffected, Web Audio |
| Pitch | `preservesPitch` never set. Default `true` **[measured]**, so browsers should stretch without dropping pitch. Not auditioned |
| Autocannon 500 ms cut | Wall-clock `setTimeout`, so only 125 ms of sample plays |
| Reload | 1 s real time, but its sound takes 3.36 s |
| Screen shake | Duration uses scaled time, so a 50 ms shake lasts 200 ms |

Stinger arithmetic: 5 s at 0.25 consumes 1.25 s of the 3.47 s file. The last 2.22 s plays at full speed after Slowmo ends, so the stinger's tail lands on the return to normal time. It is unknown whether that was intended. It may sound better than the "fixed" version.

**Bug:** dying in Slowmo leaves the rate at 0.25, because `updateSlowmo` runs only in `updateGame`. `menu_select` on the next screens plays at quarter speed. It clears after a restart, the first time `updateSlowmo` runs past the end time.

---

## 15. File paths

| Kind | Original (relative to the page) | This repo |
|---|---|---|
| SFX | `sounds/<file>` | `public/audio/sfx/<file>` |
| Music | `soundtrack/{menu,easy,hard}/<file>` | `public/audio/music/{menu,easy,hard}/<slug>.mp3`, plus `public/audio/music/manifest.json` (`file`, `title` per state) |
| three.js | `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` | |

The original repo snapshot in the scratch directory holds only `index.html`, `fps-game.html` and `README.md`, so `public/audio` is the only audio I could inspect. I cannot confirm it is byte-identical to what the game shipped with. Music was re-encoded: `.flac` and `.wav` sources are `.mp3` here.

Compared case-sensitively against `public/audio/sfx`:

| Issue | Detail |
|---|---|
| Case mismatch | Code: `30mmshell_flyby.mp3`. Disk: `30mmShell_flyBy.mp3`. Loads on default macOS volumes **[measured: no error]**. On a case-sensitive host it 404s, and every Warthog shell loses its flyby |
| Filename typo | `bulltet_hit3.mp3` is misspelled in both places, so it works |
| Not referenced by either HTML file | `222.mp3` (2.16 s), `3333.mp3` (7.25 s), `asdf.mp3` (3.05 s), `frfff.mp3` (1.33 s). Contents unknown |
| Same file, two keys | `enemy_hit.mp3` as `enemyHit` and `playerHit` |

---

## 16. Why it feels good

My reading of the code. These are design judgements, not playtest results.

1. **Layers where other games use louder samples.** A headshot is three samples, a buffed shot up to four, Berserk three stingers, autocannon two. Each event has more going on without one sample dominating.
2. **Buffs change the gun's voice.** The Blood Thirst layer at 0.50 sits over a 0.15 SMG. You hear the perk on every trigger pull, so the state reads without looking at the HUD.
3. **The loudest things are the rewards.** 0.80 shell, 0.70 Hellfire rocket and 0.60 Berserk stinger against a 0.15 SMG. The mix leaves headroom for the payoffs.
4. **Colour-coded countdowns.** Each perk owns a colour and a line, with a tenth-of-a-second timer. Several active at once reads as a stacked power meter, and the ticking adds urgency.
5. **Strikes are told as a short story.** Radio call, delay, confirmation, delay, impacts, then the jet noise after the shells have landed. The waiting is what makes the payoff land.
6. **Fast retrigger as texture.** Cutting samples at 20 Hz through 4 voices gives the SMG and shell cascade their stutter for free.
7. **Slowmo drags what is already playing.** Sounds in flight stretch at once, while music stays at full speed, which keeps tempo under the effect.
8. **Hard cut to hard music at wave 10** works as an unannounced escalation, and is the only wave feedback that exists.
9. **Short shake, frequent.** 50 ms snaps never get in the way of aiming.
10. **Random death grunts** at 1/6 and 10% keep repeated kills from sounding identical without any pitch work.

---

## 17. Broken or janky

| # | Problem | Cause | Evidence |
|---|---|---|---|
| 1 | Non-lethal headshots do nothing but sound | `createBloodJet` throws before score, feed, count, damage | Measured |
| 2 | Shotgun and 30mm head kills uncredited; shell does not explode | Same throw via `createHeadRemoval`, outside `try` | Measured |
| 3 | Thrown frames skip render | Exception leaves `animate` before `renderer.render` | Read |
| 4 | Tense Trax track never loads, music stops | `#` in URL, no `error` handler | Measured |
| 5 | Kill feed animation replaced after first strike unlock | Duplicate `@keyframes fadeInOut` | Measured |
| 6 | `pulse` defined 3 times | Berserk's version wins, so Blood Thirst's timing changes after the first Berserk | Measured |
| 7 | Kill feed overlaps minimap | Top 100 vs bottom 180, same right edge | Measured |
| 8 | Adrenaline and Berserk labels overlap | Both top 140 | Measured |
| 9 | Airstrike and Warthog popups overlap if unlocked together | Both top 200 | Read |
| 10 | Scope, perk labels, chips above pause and game over | z 999 and 1000 vs 200, no cleanup | Measured |
| 11 | Labels frozen on game over and on the menu after it | `updateX` stops, nothing hides them | Read |
| 12 | Scope stays after death, FOV stays 30 | `endGame` does not call `clearZoom` | Read |
| 13 | Space restart leaves pointer unlocked | `startGame` never requests it | Measured |
| 14 | "Press R to restart" does nothing | Unreachable branch at 7367 | Read |
| 15 | Esc resume may fail to re-lock | Lock requested from a key that may not count as activation, retried only on click. Untested | Unverified |
| 16 | Esc while locked may not pause | Browser may consume it, `pointerlockchange` only sets a flag. Untested | Unverified |
| 17 | Spatial audio dead | No caller passes `position` | Read |
| 18 | Positional path corrupts volumes | Reads base from a voice it mutates | Measured |
| 19 | `perk_slowmo` exemption defeated | Rate loop has no exception | Measured |
| 20 | Rate stuck at 0.25 after dying in Slowmo | `updateSlowmo` does not run | Read |
| 21 | `30mmshell_flyby.mp3` case mismatch | Filename on disk differs | Checked |
| 22 | Restart always uses easy music | `startGame` | Read |
| 23 | No crossfades, track gaps | New element per track, no preload | Read |
| 24 | `Recently played` reset branch dead and buggy | Cap below threshold, stale local | Read |
| 25 | Minimap trails, mirrored heading, no walls | 0.8 alpha "clear", `-z` draws down | Measured |
| 26 | Health gradient compresses instead of shifting colour | Gradient sized to fill width | Measured |
| 27 | Flash timers not cancelled | One `setTimeout` per hit | Read |
| 28 | `ACTIVATED!` text shows one frame | Timer update overwrites | Read |
| 29 | Sword ammo colour from `NaN` | `0/0` | Read |
| 30 | Debug panel collapses to run-on text | Newlines with `white-space: normal` | Measured |
| 31 | First FPS reading after toggling is wrong | Counters do not run while hidden | Read |
| 32 | Buttons ignore the UI font, no hover or focus | `<button>` does not inherit, no CSS | Measured |
| 33 | Guide cannot be closed with Esc | No MENU case | Read |
| 34 | Same reload sound for all weapons, same ready sound for both strikes | Placeholders | Read |
| 35 | `AudioContext` never resumed | Relies on browser auto-resume | Read |
| 36 | Console spam: per-kill logs, and `emissive` warnings on `MeshBasicMaterial`, dozens per explosion | Lines 1358-1359 and 1413-1414 pass properties the material lacks | Measured |
| 37 | Perk timers and strikes run through pause | Wall-clock | Read |
| 38 | Master volume above 0.625 would throw | `audio.volume > 1` at `createSound` | Read |

### Dead code and unused styles

- `playFootstep`, the `footstep` and `pickup` entries (both `null`).
- Positional branch of `play`, and `setPlayerPosition`.
- `SoundtrackManager.stop` and `setVolume`.
- `showSplash`, `cancelAirstrikeTargeting`, `cancelWarthogStrikeTargeting`.
- `.weapon-display`. `.perk-message`, `.airstrike-ready`, `.warthog-ready`, `.menu-buttons`, `.guide-screen`, `.airstrike-instructions`, `.warthog-instructions` have no CSS.
- `onWaveComplete` is called at 7786 but does not exist (docs 05, 06).

---

## 18. Copy versus reality

**Guide** (extends doc 05's table)

| Claim | Reality |
|---|---|
| "Collect pickups quickly before they disappear" | `Pickup` has no lifetime. They never disappear |
| Berserk in `#ff00ff` | Label is `#ff0000` |
| Berserk features | Invulnerability is not listed |
| Hellfire "Instakill damage" | Rockets only |
| "Press X to activate targeting" | X equips, click starts and fires |
| "Each stack lasts 5 seconds" | One shared timer |
| Controls | `C` for crouch and slide missing |
| Pause: "Press R to restart" | Does nothing |

**README** (describes the old `fps-game.html`)

| Claim | Reality |
|---|---|
| "Crosshair with hit markers" | None |
| "Combo counter" | None. `comboKillCount` is never shown |
| "Health bar with regeneration indicator" | None |
| "Web Audio API - 3D spatial audio", "3D spatial sound" | HTML5 Audio, no spatial |
| "Audio pitch modulation" | Rate only. Pitch likely preserved |
| G: "Debug mode (collision boxes)" | Text panel only |
| "Enemies deal contact damage" | Only bullets and blasts reach `takeDamage` |
| "Health pickups restore 25 HP" | 30 |
| Adrenaline "doubles movement speed", Blood Thirst "5-kill streak" | See doc 05 |
| Controls: 4 = Sword, "Assault Rifle" | Stale |

---

## 19. Notes for the sequel

These are recommendations, not observations.

**Keep:** per-shot perk layers, the 3-layer headshot, the three-sample Berserk stinger, the strike radio sequence with the late jet noise, colour-owned countdown labels, the loud mix for rewards, the 3-state music plan, the splash gesture gate, random-file variation, and fast retrigger on the SMG and shells.

**Fix or add:**

- Use Web Audio with buffers and buses for SFX, music and UI. Add real distance falloff and panning. The original's 5 u / 50 u / 10% floor is a sensible start.
- Decide what Slowmo should sound like. `AudioBufferSourceNode.playbackRate` drops pitch; the original likely did not. Consider a ramp and a low-pass, and decide whether music should change.
- Handle load errors by skipping to the next track, and crossfade between states.
- Give every event a sound from the silent list: dry fire, weapon switch, wave start, perk expiry, death.
- Add hit markers and a headshot variant, with kill confirmation in the crosshair. This is the biggest feedback gap.
- Add a direction indicator and a low-health state. Decide whether the eye-point blood blobs should stay.
- Stack perk labels with layout instead of fixed tops, and clean up on state change.
- Use unique animation names, or scoped styles.
- Add settings: volume per bus, sensitivity, FOV.
- Rotate or correct the minimap, draw walls, and separate pickup types. Move the feed clear of it.
- Add a wave banner.
- Normalise filenames in a manifest: `30mmShell_flyBy.mp3`, `bulltet_hit3.mp3`.

---

## 20. `fps-game.html` versus `index.html`

Whitespace-insensitive diff: only **105 lines** of the old file differ, against 3005 added in the new one. Every class method in the old file still exists. I compared method lists, sound tables, CSS and HTML.

**UI and audio, old side.**

| Area | Result |
|---|---|
| CSS | Identical, except `index.html` adds `@keyframes pulse` |
| HUD markup | Identical |
| Sounds | 43 keys, all in `index.html` with the same files and volumes. `index.html` adds 11: `swordSlam`, `perkAirstrike`, `walkieTalkieFire`, `airstrikeActivate`, `autocannon_fire`, `autocannon_fire2`, `autocannon_zoom`, `30mmshell_flyby`, `30mmshell_explode`, `warthog_flyby`, `menu_select` |
| Music | None. No `SoundtrackManager` |
| Screens | Menu, pause, game over. No splash, no guide |
| `play()` | No `position` parameter |

**Things the old file has that `index.html` does not:**

| Old behaviour | Old line | Current |
|---|---|---|
| One-click start: any click while unlocked requests the lock, and MENU starts as soon as it is held | 3415-3419, 5832 | Splash, then START button |
| Menu line `Click anywhere to start playing!` | 359 | Gone |
| Kill feed animation always intact, because no strike popup exists to override it | | Broken after first unlock |
| Titles: `Complete 3D FPS Game`, `FPS SURVIVAL`, `Wave-Based Combat Arena` | 6, 348-349 | Rebranded `OVERPOWERED` |
| Menu copy: "Survive endless waves of enemies in this fast-paced FPS arena!", "Defeat enemies to earn points and progress through increasingly difficult waves.", "Collect health and ammo pickups to stay alive." | 351-353 | Rewritten |
| Delta clamp 1/30 | 5826 | 0.1 |
| `PCFSoftShadowMap` | 4939 | `PCFShadowMap` |
| `recoil.y -= recoilAmount` | 3011 | `+=`, "all weapons tip upward" |
| Single sine-sweep sword swing | 2853-2860 | Replaced by combo animations (doc 04) |
| Shockwave values, rocket smoke | 709-715, 803-807 | Retuned (doc 01) |
| `getMouseDelta` resets on read | 3449-3450 | Separate `resetMouseDelta`. Sway is dead in both (doc 03) |

Nothing here is worth restoring except possibly a faster path into the game. `createBloodJet`'s crash exists in both.
