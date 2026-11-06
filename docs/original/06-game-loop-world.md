# 06. Game loop and world

Covers `index.html` lines 6937-7082 (`WaveSystem`, `GameManager`) and 7231-8769 (`FPSGame` and page boot). Line numbers refer to `index.html`. The engine is three.js r128 from cdnjs (line 474), with no post-processing and no other libraries.

**How to read this.** Everything here comes from reading the code. The game was not run. "Derived" marks a number worked out from the code rather than written in it. Where the result depends on browser behaviour, the text says so. Sections 15 and 16 include design reading, which is interpretation and is labelled as such.

## 1. At a glance

- **Arena:** 98 x 98 units inside four walls at +/-50, with 5 fixed obstacles and 15 random props. 24 collision boxes in total.
- **Waves:** `10 + 2 * wave` enemies, 1 spawn per second, 5 s gap after the last kill. No alive cap. Endless.
- **Difficulty:** wave count, type mix (final at wave 5) and enemy weapons (waves 10/15/20). Enemy HP, speed and damage never scale.
- **Score:** 100/150/200 per kill, +50 per headshot hit, x2 on the sword finisher. No combo multiplier, no wave bonus.
- **Time:** the only time manipulation is SLOWMO (0.25x for 5 s). There is no hit-stop anywhere. `grep -i 'hitstop|freeze'` finds nothing.
- **Explosions:** linear falloff from 100% at the centre to 50% at the edge, measured to the enemy's feet, with no line-of-sight test. Three handlers: rocket, shell and sword finisher.
- **Feel:** all feedback for an event fires in one frame. Nothing is staged or delayed. Layer durations provide the time spread.
- **Biggest trap:** bullet-kill ragdolls fall at about 8x gravity and explosive gibs at about 4x because `destroy()` runs twice. The double run is a bug, and it is also part of the current feel (section 13.3).

## 2. Boot and state machine

`GameState` (line 478): `splash`, `menu`, `playing`, `paused`, `game_over`.

Constructor order (7261-7265): `init()` (scene, camera, renderer, lights), `createEnvironment()`, `setupGameSystems()`, `bindEvents()`, `animate()`. The game is created on `window` `load` (8699).

`setupGameSystems` wires, in order: InputManager, AudioManager, SoundtrackManager, Player, WeaponSystem (Player and WeaponSystem get references to each other), ParticleSystem, `window.currentGame = this` (ragdolls read it for blood), WaveSystem, GameManager, UIManager, then two bullet pools.

| Pool | Initial size | Notes |
|---|---|---|
| `bulletPool` | 100 | Player bullets, rockets, shells, airstrike and Warthog projectiles |
| `enemyBulletPool` | 50 | Created red (`0xff0000`). Pistol, SMG and shotgun shots set their own colour |

Pools grow without limit (`createFn` on empty). Each `Bullet` adds 3 hidden meshes to the scene at construction, so 450 idle meshes exist at boot (derived).

### Transitions

| From | Trigger | To | Side effects |
|---|---|---|---|
| SPLASH | Click on `#splashScreen` | MENU | `menu_select`, starts menu music. This first gesture is what the comment at 7307 waits for |
| MENU | Start button sets `shouldStartGame`, requests pointer lock. `animate` polls until locked | PLAYING | `startGame()` |
| PLAYING | Esc | PAUSED | Releases lock, pauses music, shows `#pauseScreen` |
| PAUSED | Esc, or any click | PLAYING | Re-requests lock, resumes music |
| PLAYING | `player.isDead()` in `updateGame` | GAME_OVER | `endGame()`: release lock, menu music, high-score check, stats screen |
| GAME_OVER | Space | PLAYING | `startGame()`, but no pointer-lock request (section 17) |
| GAME_OVER | Esc | MENU | `showMenu()` |

If lock is lost while PLAYING, a document click re-requests it (8716-8729). There is no `pointerlockchange` handler that pauses. Whether Esc reaches `keydown` while pointer lock is active varies by browser and was not tested. The sequel should pause on `pointerlockchange`.

### Keys (`handleKeyDown`, 7360)

| Key | State | Action |
|---|---|---|
| Esc | PLAYING / PAUSED / GAME_OVER | Pause / resume / menu |
| R | PLAYING | Reload |
| Space | GAME_OVER | Restart |
| F, G | Any | Toggle FPS counter, debug panel |
| 1, 2, 3, 4, 5 | PLAYING | SMG, shotgun, rocket, autocannon, sword |
| X | PLAYING, airstrike available | Equip walkie-talkie |
| Z | PLAYING, Warthog available | Equip Warthog designator |

### `startGame()` (7437)

| Resets | Does not reset |
|---|---|
| Score, kills, HUD | Player position, velocity, look direction |
| Player health to max | Current weapon, `isReloading` |
| SMG 30, shotgun 6, rocket 1, reserve 90 | Autocannon ammo |
| Enemies (via `destroy()`, so they ragdoll) | Perk flags and timers (they expire through wall clock) |
| Pickups | `comboKillCount`, `killTimes`, `headshotTimes` |
| Both bullet pools | Airstrike and Warthog availability, cooldowns, HUD badges |
| New `WaveSystem`, wave 1 starts | `pickupSpawnTimer`, particles, ragdolls |
| Easy music | Pending strike `setTimeout`s (no `clearTimeout` exists in the file) |

### GameManager and end of run

Stats screen: Final Score, Kills, Wave Reached, `NEW HIGH SCORE!` in `#ffff00` when beaten, High Score. High score is stored in `localStorage['fps_highscore']` and only written in `endGame`. The `localStorage` calls are unguarded.

## 3. Renderer, camera, lighting

| Setting | Value |
|---|---|
| Camera | Perspective, FOV 75, near 0.1, far 1000 |
| Renderer | `antialias: true`, `powerPreference: "high-performance"` |
| Pixel ratio | `min(devicePixelRatio, 2)` |
| Clear colour | `0x87CEEB` (matches fog) |
| Shadows | Enabled, `THREE.PCFShadowMap` |
| Fog | `THREE.Fog(0x87CEEB, 50, 200)` |

| Light | Colour | Intensity | Setup |
|---|---|---|---|
| Ambient | `0x404040` | 0.6 | None |
| Directional | `0xffffff` | 0.8 | Position (50, 100, 50), default target at origin, casts shadow |

Shadow camera: 2048 x 2048, near 0.5, far 500, orthographic +/-100 on both axes, about 0.098 units per texel (derived).

These are the only two lights in the game. No Point, Spot or Hemisphere lights exist and no tone mapping or colour space is set. Explosions, muzzle flashes and tracers light nothing. Fog barely registers: 0-13% at the walls from the centre, 59% corner to corner (derived).

`onWindowResize` updates aspect and renderer size only.

## 4. Map

### Layout

Top-down, north (-z) at top. One character is 2 units across and 4 units down. `P` is the player spawn, digits are the obstacles below.

```
###################################################
#                                                 #
#                                                 #
#                                                 #
#                                                 #
#                4444444                          #
#                                 111             #
#                                 111             #
#                                 111             #
#                                 111             #
#                                                 #
#                                                 #
#                        P             555        #
#                                      555        #
#                                                 #
#          2222                                   #
#                                                 #
#                                                 #
#                              3333               #
#                              3333               #
#                                                 #
#                                                 #
#                                                 #
#                                                 #
#                                                 #
###################################################
```

### Fixed geometry

Ground: `PlaneGeometry(200, 200)`, Lambert `0x4a5d23`, receives shadows. It extends to +/-100, past the walls.

| Wall (Lambert `0x8B4513`) | Centre | Size x,y,z | Extent |
|---|---|---|---|
| North | (0, 2.5, -50) | 100, 5, 2 | z -51 to -49 |
| South | (0, 2.5, 50) | 100, 5, 2 | z 49 to 51 |
| West | (-50, 2.5, 0) | 2, 5, 100 | x -51 to -49 |
| East | (50, 2.5, 0) | 2, 5, 100 | x 49 to 51 |

Playable interior is x,z in [-49, 49], or +/-48.5 for the player centre after the 0.5 radius (derived).

| # (Lambert `0x666666`) | Centre | Size x,y,z | x range | z range | Top |
|---|---|---|---|---|---|
| 1 | (20, 2, -20) | 4, 4, 15 | 18 to 22 | -27.5 to -12.5 | 4 |
| 2 | (-25, 2, 10) | 8, 4, 4 | -29 to -21 | 8 to 12 | 4 |
| 3 | (15, 2, 25) | 6, 4, 6 | 12 to 18 | 22 to 28 | 4 |
| 4 | (-10, 2, -30) | 12, 4, 4 | -16 to -4 | -32 to -28 | 4 |
| 5 | (30, 1.5, 0) | 4, 3, 8 | 28 to 32 | -4 to 4 | 3 |

### Random props

Rolled with unseeded `Math.random` once per page load, so the layout changes on reload and stays fixed across restarts. There are no overlap checks, so props can land on the spawn point, on obstacles or on each other.

| Prop | Count | Geometry | Placement | Material |
|---|---|---|---|---|
| Crate | 10 | Cube, side `1 + rand * 1.5` (1 to 2.5) | x,z in +/-40, y = side / 2, random Y rotation | Lambert `0xDEB887` |
| Pillar | 5 | `CylinderGeometry(1, 1.5, 8, 8)` | x,z in +/-30, y = 4 | Lambert `0x708090` |

All meshes cast and receive shadows. All 24 go in `collisionObjects`.

### Collision behaviour

- Every test builds `new THREE.Box3().setFromObject(obj)`, so all collision is world-axis AABB. A rotated crate collides as a box up to 41% wider than it looks (derived, sqrt 2).
- **Player:** ground clamp at `y = height` (1.8 standing, 0.9 crouching), then XZ push-out against each box expanded by 0.5. Nothing can be stood on. Jump apex is +1.28, so eye height peaks at 3.08 (derived). That is below every wall and obstacle top after expansion (5.5, 4.5, 3.5). A player above a crate falls through its top and is pushed out sideways.
- **Enemies:** no collision at all. They walk straight through everything. There is no pathfinding.
- **Projectiles:** point-in-AABB test. See sections 10 and 11.

### Scale reference

| Measure | Value |
|---|---|
| Spawn | (0, 2, 0) facing -z, settles at y 1.8 |
| Enemy spawn box | x,z in +/-40, at least 15 from player |
| Enemy engagement | Shoots inside 30, holds at 15, backs away below 13 |
| Crossing the arena | 12.3 s at nominal 8 u/s, 6.8 s sprinting at 14.4 u/s (derived, ignores acceleration) |

Minimap (`drawMinimap`, called from `animate`): 150 px canvas, 1 px per unit, centred on world origin, so it shows +/-75 and the arena uses the middle 100 px. It draws the player, heading, enemies and pickups, but no walls or obstacles. It is mirrored: forward (-z) draws downward while +x draws right.

## 5. Waves

`WaveSystem` constants:

| Field | Value | Meaning |
|---|---|---|
| `currentWave` | 1 | |
| `enemiesPerWave` | 10 | Base count |
| `enemySpawnRate` | 1 | An interval in seconds despite the name |
| `nextWaveDelay` | 5 | Seconds after the wave clears |

`update()` runs every frame and returns an enemy type to spawn, or null:

```
if not waveActive:
    if enemies empty and now - waveCompleteTime >= 5: nextWave()
    return null
if spawned >= target and enemies empty: completeWave(); return null
if spawned < target and now - lastSpawnTime >= 1:
    lastSpawnTime = now; spawned++; return rollType()
return null
```

`now` is `performance.now() / 1000`. The `deltaTime` argument is ignored.

**Count:** `10 + floor(wave * 2)`.

**Type roll:**

```
if wave >= 5 and rand < 0.3: type 2
else if wave >= 3 and rand < 0.4: type 1
else: type 0
```

| Wave | Enemies | Cumulative | Type 0 / 1 / 2 | Avg HP | Total HP | Avg score | Kill score | Cumulative score |
|---|---|---|---|---|---|---|---|---|
| 1 | 12 | 12 | 100 / 0 / 0 | 50 | 600 | 100 | 1,200 | 1,200 |
| 2 | 14 | 26 | 100 / 0 / 0 | 50 | 700 | 100 | 1,400 | 2,600 |
| 3 | 16 | 42 | 60 / 40 / 0 | 60 | 960 | 120 | 1,920 | 4,520 |
| 4 | 18 | 60 | 60 / 40 / 0 | 60 | 1,080 | 120 | 2,160 | 6,680 |
| 5 | 20 | 80 | 42 / 28 / 30 | 72 | 1,440 | 144 | 2,880 | 9,560 |
| 10 | 30 | 210 | 42 / 28 / 30 | 72 | 2,160 | 144 | 4,320 | 28,280 |
| 15 | 40 | 390 | 42 / 28 / 30 | 72 | 2,880 | 144 | 5,760 | 54,200 |
| 20 | 50 | 620 | 42 / 28 / 30 | 72 | 3,600 | 144 | 7,200 | 87,320 |
| 30 | 70 | 1,230 | 42 / 28 / 30 | 72 | 5,040 | 144 | 10,080 | 175,160 |

Percentages and averages are derived expectations. Scores exclude headshot bonuses.

### Pacing

- **Rhythm:** first spawn 1 s after the wave starts, last spawn at N seconds, then 5 s after the final kill the next wave begins. Quiet time between last kill and next spawn is 6 s.
- **What escalates:** count every wave, type mix at 3 and 5, enemy weapons at 10, 15 and 20 (section 6), hard music on reaching wave 10 exactly (`nextWave`, 6994).
- **What never escalates:** HP, speed, damage, spawn rate and the wave delay. From wave 20 the only remaining growth is count.
- **No ceremony:** a new wave has no banner, sound or stinger. Only the HUD number changes. Clearing a wave shows nothing.
- **HUD:** `#enemyCount` shows enemies alive, not enemies remaining in the wave.

Pacing interactions (derived):

- **A wave break always ends a kill combo.** The combo window is 5 s between kills and the minimum gap across a break is 6 s. Airstrike (8), Warthog (12) and Berserk (15) must therefore be earned inside one wave. Berserk needs wave 3 or later, because wave 1 has 12 enemies and wave 2 has 14.
- **The 1/s spawn rate caps kill rate unless enemies have banked up.** Hellfire (10 kills in 10 s) needs the player to match it exactly or to let enemies build up first. Holding back, then clearing a crowd with a rocket, is rewarded.

## 6. Spawn rules

### Enemies (`spawnEnemy`, 7672)

1. Roll x,z in +/-40 at y = 0.
2. Retry while within 15 units of the player, up to 20 attempts, then accept the last roll. The distance is 3D against eye position.
3. `new Enemy(scene, pos, type, wave)`, push, update HUD.

Not checked: obstacles and props, so enemies can spawn inside them. There is no spawn effect, sound or warm-up. `lastRangedAttackTime` starts at 0, so an enemy spawned within 30 units fires on its first update.

| Type | HP | Speed | Colour | Size | Score |
|---|---|---|---|---|---|
| 0 | 50 | 3 | `0xff4444` | 1.5 | 100 |
| 1 | 75 | 2.5 | `0x44ff44` | 1.8 | 150 |
| 2 | 100 | 2 | `0x4444ff` | 2.25 | 200 |

The `damage` field (10/15/20) is dead. Only `attack()` reads it and nothing calls that. Actual damage comes from the weapon below, independent of type.

Weapon assignment is in the `Enemy` constructor, rolled in order. Percentages are derived from the chained rolls:

| Wave | SMG | Rocket | Shotgun | 3-burst pistol | Pistol |
|---|---|---|---|---|---|
| 1-9 | 0 | 0 | 0 | 25.0 | 75.0 |
| 10-14 | 0 | 0 | 15.0 | 21.3 | 63.8 |
| 15-19 | 0 | 10.0 | 13.5 | 19.1 | 57.4 |
| 20+ | 10.0 | 9.0 | 12.2 | 17.2 | 51.6 |

| Weapon | Damage | Projectile speed | Cooldown |
|---|---|---|---|
| Pistol | 5 | 30 | 1.5 s |
| 3-burst | 5 | 30 | 1.5 s, 0.15 s between shots |
| Shotgun | 3 x 6 pellets | 35 | 2.5 s |
| Rocket | 30, radius 5 | 20 | 5 s |
| SMG | 4, 10-round burst | 40 | 4 s, 0.1 s between shots |

### Pickups

| Source | Chance | Type | Position | Cap |
|---|---|---|---|---|
| Kill drop | 30% per kill | 50% health, 50% ammo | `enemy.position` | None |
| Timed | Every 10 s, 70% chance | 60% ammo, 40% health | x,z in +/-40, y = 1 | Only if fewer than 3 pickups exist, counting kill drops |

| Field | Value |
|---|---|
| Collect radius | Under 2 units, 3D, pickup base position to player eye |
| Health | +30 HP, capped at 100, message `Health restored +30` |
| Ammo | +30 shared reserve, capped at 120, message `Ammo collected +30` |
| Sound | `pickup`, procedural 400/800/1200 Hz steps over 0.3 s |
| Despawn | Never |

Pickups are consumed even at full health or full reserve and always report +30. The timed spawn has no obstacle check. Since the radius uses eye height, a floor-level kill drop needs horizontal distance under 0.87, a y = 1 pickup under 1.83 (derived).

## 7. Score

| Event | Points | Feed message |
|---|---|---|
| Kill, any path except finisher | `scoreValue` (100/150/200) | `Enemy eliminated +N` |
| Sword area kill | `scoreValue` | `Area Attack Kill! +N` |
| Heavy finisher kill | `scoreValue * 2` | `HEAVY FINISHER! +N` |
| Headshot (player bullet or shell) | +50 per headshot hit, lethal or not | `HEADSHOT! +50` |

No combo multiplier, wave bonus, time bonus or accuracy bonus exists. The bonus is per hit, so each shotgun pellet to the head scores +50 and counts toward SLOWMO. A type 2 can give up to 3 headshot hits on one shot at 20 x 2 damage per pellet (derived).

Kill feed (`UIManager`): 5 entries maximum, each removed after 4 s. A headshot kill uses 2 lines, headshot first.

## 8. Time

### Delta time

`animate()` reads `THREE.Clock`, then `clampedDeltaTime = min(deltaTime, 0.1)`. Below 10 FPS the game slows down instead of stepping further. There is no fixed timestep. `requestAnimationFrame` is queued as the first line of `animate`, so an exception in a frame does not stop the loop.

### Hit-stop

None exists. Impacts never freeze or slow the game.

### SLOWMO

The only time scaling. Triggered by 3 headshots in 3 s, blocked while already active. Scale 0.25 for 5 s of real time, with an instant cut in and out and no ramp.

`updateGame` computes `scaledDeltaTime = deltaTime * player.getTimeScale()`. The code uses four clock domains:

| Domain | What runs on it | Speed in SLOWMO |
|---|---|---|
| Real `deltaTime` | Player movement, physics, health regen rate, pickup bob, timed pickup spawner | 100% |
| Scaled `deltaTime` | Bullets and rockets (including age), enemy movement and walk cycle, particles, smoke, shake duration | 25% |
| Wall clock (`performance.now`, `Date.now`) | Player fire rate, reload, sword swings and combo, enemy fire cooldowns, wave spawn and delay, perk durations, regen delay, projectile trail emission | 100% |
| Own loops (`setTimeout`, separate `requestAnimationFrame`) | Strike sequences, enemy recoil, ragdolls and gibs | 100% |

Effects that follow from this (derived):

- The player moves and fires at full rate against a world at quarter speed, so relative speed is 4x.
- Enemies keep firing at full rate while their bullets crawl, so shots bunch into visible streams at four times the density. The same happens to trails, which emit by wall clock.
- Spawning stays at 1/s. The comment at 8608 ("use scaled time for spawn timing") is false.
- `weaponSystem.update(scaledDeltaTime)` uses delta only for shake duration. The comment at 8042 ("scaled time for animations") is false. A 50 ms shake lasts 200 ms.
- Particles last four times longer: a 1 s explosion particle lasts 4 s.
- Ragdolls and gibs do not slow down.

### SLOWMO audio

`setGlobalPlaybackRate(0.25)` applies to every sound effect instance, including those already playing. Music is a separate `Audio` object and is unaffected. `preservesPitch` is never set, so by browser default sounds should stretch without dropping in pitch. That was not verified in the game. `perk_slowmo` is meant to be exempt, but `activateSlowmo` plays it first and then calls `setGlobalPlaybackRate`, which overwrites its rate to 0.25 (lines 6349-6351 and the loop in `setGlobalPlaybackRate`).

### Pause

Everything on wall clock keeps running while paused: perks expire, the wave delay elapses, regen delay passes. Strike `setTimeout`s fire and ragdoll loops keep animating. Scaled and real delta logic does stop.

## 9. Per-frame structure

### `animate()` (8647)

1. Queue the next frame.
2. Compute and clamp delta.
3. By state: MENU polls `shouldStartGame && isPointerLocked`. PLAYING calls `updateGame`. Others do nothing.
4. `uiManager.updateFPS`.
5. If PLAYING, draw the minimap.
6. `renderer.render` in every state.

### `updateGame(dt)` (7916)

| # | Lines | Step | Clock |
|---|---|---|---|
| 1 | 7917 | Return unless PLAYING | |
| 2 | 7920 | Compute `timeScale` and scaled delta | |
| 3 | 7924 | `player.update`: look, move, physics, collision, regen, camera, footsteps | Real |
| 4 | 7927 | `audioManager.setPlayerPosition` (no effect, section 17) | |
| 5 | 7930-7942 | Perk timers: Blood Thirst, Hellfire, Adrenaline, Berserk, Slowmo | Wall clock |
| 6 | 7945-7983 | Airstrike target ring | |
| 7 | 7986-8034 | Warthog target rectangle | |
| 8 | 8037 | If dead: `endGame()`, return | |
| 9 | 8043 | `weaponSystem.update` | Scaled, shake only |
| 10 | 8046-8091 | Left mouse with lock: call strike, or `weaponSystem.shoot` | Wall clock |
| 11 | 8094-8147 | Sword input: combo buffer, wind-up, area attack | Wall clock |
| 12 | 8150-8160 | Autocannon zoom toggle on right-click press | |
| 13 | 8163-8507 | Player projectiles: move, collide, resolve hits | Scaled |
| 14 | 8510-8520 | Enemy update, remove dead | Scaled |
| 15 | 8523-8586 | Enemy projectiles | Scaled |
| 16 | 8589-8606 | Pickups, collection | Real |
| 17 | 8609-8612 | `waveSystem.update`, spawn | Wall clock |
| 18 | 8615-8627 | Timed pickup spawner | Real |
| 19 | 8630-8635 | Particles and smoke | Scaled |
| 20 | 8638 | Debug panel | |

Order consequences:

- Damage taken in steps 13 to 15 ends the game on the next frame, at step 8.
- Shake set in a frame is applied on the next frame's step 9.
- Sword kills stay in `this.enemies` until step 14 removes them.

## 10. Player projectile loop (8163-8507)

Iterates a copy of `bulletPool.active` and skips any bullet with `active === false`. For each live bullet, `bullet.update(scaledDelta)` runs, then `numChecks` collision passes.

**Sub-stepping:** 4 for 30mm shells, 1 for everything else. Pass 0 tests the end position, then passes 1 to 3 lerp from `previousPosition` at t = 0.25, 0.5, 0.75. The furthest point is tested first.

**Order per pass:** enemies from last to first, then ground (`y <= 0`), then the 24 boxes.

### Hit tests

Head first. Head centre comes from `headMesh.getWorldPosition`, so it follows the model. The body sphere is computed from `enemy.position`.

| Type | Head radius `0.45 * size` | Head centre y | Body radius `0.8 * size` | Body centre y `0.8 * size` | Visual head top (derived) |
|---|---|---|---|---|---|
| 0 | 0.675 | 1.5 | 1.2 | 1.2 | 1.875 |
| 1 | 0.81 | 1.5 | 1.44 | 1.44 | 1.95 |
| 2 | 1.0125 | 1.5 | 1.8 | 1.8 | 2.06 |

Body part offsets are not multiplied by `size`, although their geometry is. So large enemies have heads sunk into their torsos and legs below ground, and the type 2 body sphere reaches y 3.6, well above the 2.06 model. Hit volumes are generous. A level shot from eye height 1.8 passes close to the head centre at 1.5 on every type, which is part of why headshots come easily.

### Resolution on enemy hit

1. **30mm shell** (8240): if headshot, run the shell headshot block (section 13). Then deactivate, hide meshes, `handleShellExplosion`, release, stop.
2. **`isRocket`** (8321), which includes Hellfire bullets: `handleRocketExplosion`, release, stop. **Rockets and Hellfire bullets therefore cannot score headshots or count toward SLOWMO.**
3. **Normal bullet** (8330): continue below.

Normal bullet sequence:

1. `finalDamage = bullet.damage`. `willKill = isHeadshot && finalDamage * 2 >= enemy.hp`.
2. Headshot: double damage, 20 x `0xffff00` at the head, `enemyHeadshot` + `enemyHeadshot2` + `enemyHeadshot3`, blood jet if not lethal, +50, feed, `registerHeadshot`.
3. Body: 15 x `0xff4444` at the torso point, `enemyHit`, 10% `enemyGrunt`.
4. `enemy.takeDamage`, release bullet.
5. If killed: kill flow (section 13).

### Impacts

| Surface | Bullet | Rocket or Hellfire bullet | 30mm shell |
|---|---|---|---|
| Ground | 8 x `0x888888` at y = 0, `bulletHit` | `handleRocketExplosion` | `handleShellExplosion` at y = 0 |
| Box | 8 x `0x888888`, `bulletHit` | `handleRocketExplosion` | `handleShellExplosion` |

`bulletHit` picks `bulletHit1` to `bulletHit4` at volume 0.3. There are no decals. Bullet speed is 100, lifetime 5 s of scaled time.

## 11. Enemy projectile loop (8523-8586)

No enemy-to-enemy collision. Order per bullet:

| Step | Condition | Result |
|---|---|---|
| Ground | `y <= 0` | Rocket: `handleRocketExplosion`, radius `blastRadius or 5`. Else 5 x `0xff4444`, `bulletHit`. Release |
| Near miss | Under 3 units, not yet played | `bulletWhizz`, once per bullet |
| Player hit | Under 1 unit from eye position | Rocket: explosion. Else `player.takeDamage`, 10 x `0xff0000` at the player's eye, release |
| Box | Inside any box | Rocket: explosion. Else 5 x `0xff4444`, `bulletHit`. Release |

The red burst spawns at the camera, so being hit puts particles in the player's face in addition to the DOM damage flash and `playerHit`.

## 12. Explosion model

### Formula

```
falloff = 1 - (distance / radius) * 0.5     // 1.0 at centre, 0.5 at edge
damage  = baseDamage * falloff              // inside radius only, <= inclusive
```

Applies to `handleRocketExplosion` (7790), `handleShellExplosion` (7713) and the sword finisher (4530).

- **Distance** is 3D to `enemy.position`, the feet, not the torso. Head-height blasts lose damage or miss.
- **No line-of-sight test.** Blasts pass through walls.
- **No knockback on survivors, and none on the player.** There is no rocket jumping. Only dead enemies move, through gib force.
- **Hellfire rockets skip falloff** against enemies and deal 99999.
- **Self-damage exists only in `handleRocketExplosion`:** `damage * falloff * 0.5`, unless Berserk is active.

### Variants: gameplay

BT is the Blood Thirst x2 damage multiplier, applied at fire time.

| Variant | Source | Radius | Enemy damage | Player damage | Gib force |
|---|---|---|---|---|---|
| Rocket | Launcher | 8 | 50-100 (BT 100-200) | 25-50 (BT 50-100) | 10 |
| Hellfire rocket | Launcher during Hellfire | 20 | 99999 flat | 25-50 (BT 50-100) | 10 |
| Hellfire bullet | SMG or shotgun during Hellfire | 2 | SMG 31.25, pellet 25, then falloff, BT x2 | Half of that | 10 |
| Airstrike rocket | 15 per call | 6 | 50-100 | 25-50 | 10 |
| Airstrike missile | 1 per call | 20 | 99999 flat | 25,000-50,000, lethal | 10 |
| Enemy rocket | Enemy | 5 | 15-30 to other enemies | 7.5-15 | 10 |
| 30mm, autocannon | Player | 5 | 99999 x falloff, always lethal | None | 5 |
| 30mm, Warthog | 50 per call | 5 | 75-150 | None | 5 |
| Heavy finisher | Sword | 8 | 125-250, no BT | None | 10 |

Derived:

- A rocket cannot one-shot a full-health type 2 without Blood Thirst, because the 100 maximum needs distance 0. A level shot at an enemy standing at y = 0 lands about 2.5 units from its feet, for about 84 damage.
- Rocket kills type 1 at full HP only within 4 units of the feet.
- Warthog shells kill a full-health type 2 only within 3.33 units.
- A Hellfire bullet 1.8 units above an enemy's feet deals 55%, about 17 from the SMG. That is less than a normal 25-damage bullet, and beyond 2 units it deals nothing even though the bullet registered a hit. Splash and floating enemies offset this.
- A Hellfire rocket at 15 units still costs the player about 31 HP.

### Variants: presentation

Volumes are configured values. Master volume 0.5 multiplies all of them, which is why values above 1 work. A sequel with master 1.0 cannot use them directly.

| Variant | Sounds | Particle layers | Extra | Shockwave | Shake |
|---|---|---|---|---|---|
| Rocket, airstrike rocket, enemy rocket | `rocketExplosion` 0.5 | 50 x `0xff6600`, 30 x `0xffaa00` | | Normal | 0.06 |
| Hellfire rocket, airstrike missile | `rocketExplosion` 0.5 + `hellfireRocketExplode` 1.4 | Hellfire mode: 120 x `0xffff00`, 100 x `0xffaa00`, 80 x `0xff6600`, 60 x `0xff0000` | | Hellfire | 0.24, 100 ms |
| Hellfire bullet | `hellfireBulletExplode` 0.5 | 12 x `0xff6600`, 8 x `0xffaa00` | | None | 0.06 |
| 30mm shell | `30mmshell_explode` 1.6 | 25 x `0xffff00`, 15 x `0xffaa00` | 20 sparks `0xffff00`, velocity x,z +/-10, y 0-10 | 0.5 scale | 0.03 |
| Heavy finisher | `rocketExplosion` 0.5 | 60 x `0xffffff`, 40 x `0xcccccc`, 30 x `0x888888` | 30 sparks `0xffffff`, velocity x,z +/-15, y 0-20 | Normal | 0.15 |

Per enemy inside any blast: `enemyHit` 0.4 and 10 x `0xff4444` at its feet.

Particle recipe (`createExplosion`, details in the particle doc):

| Mode | Size | Velocity x,z | Velocity y | Life | Fade |
|---|---|---|---|---|---|
| Normal | Radius 0.1 | +/-5 | 0 to 10 | 1 s | Shrinks only (material not transparent) |
| Hellfire | Radius 0.25 to 1.0 | +/-9 | 0 to 18 | 1.5 s | Shrinks and fades linearly with life |

Gravity is -20 for both. Sparks: 0.05 cube, life 0.5 s, gravity -20.

Shockwave: white wireframe sphere, geometry radius 0.5, 25% starting opacity, fading by `0.25 * (1 - progress^2)`.

| Type | Expand rate | `maxSize` | Life | Final scale (derived) | World radius (derived) | Actual blast radius |
|---|---|---|---|---|---|---|
| Normal | 120/s | 15 | 0.1 s | 12.5 | 6.25 | 8 |
| 0.5 scale | 60/s | 7.5 | 0.1 s | 6.5 | 3.25 | 5 |
| Hellfire | 200/s | 60 | 0.15 s | 30.5 | 15.25 | 20 |

`maxSize` is never reached because life ends first, so the ring pops out at 6-19% opacity instead of fading to zero. The visible shockwave always understates the real radius.

There is no light flash, FOV kick, decal, screen flash or post effect on any explosion. Shake and sound do not attenuate with distance, so an explosion at the far wall shakes and sounds the same as one at the player's feet.

### Screen shake

`addScreenShake(i)` **sets** intensity and sets duration to 50 ms. It does not add or take a maximum. Each frame while active: `(rand - 0.5) * intensity` is added to camera pitch and roll, never yaw, and a `setTimeout` of 16 ms subtracts it. At 60 Hz, a 50 ms shake covers 2-3 frames (derived).

| Source | Intensity | Peak | Duration |
|---|---|---|---|
| SMG shot | 0.004 | +/-0.002 rad | 50 ms |
| Sword hit | 0.01 | +/-0.005 | 50 ms |
| Shotgun shot | 0.02 | +/-0.01 | 50 ms |
| Autocannon shot, 30mm explosion | 0.03 | +/-0.015 | 50 ms |
| Rocket launch | 0.04 | +/-0.02 | 50 ms |
| Rocket and Hellfire bullet explosions | 0.06 | +/-0.03 (1.7 deg) | 50 ms |
| Sword area swing (even on a miss), heavy finisher | 0.15 | +/-0.075 (4.3 deg) | 50 ms |
| Hellfire rocket explosion | 0.24 | +/-0.12 (6.9 deg) | 100 ms |

Shots read `camera.quaternion`, which already includes shake, so shake moves real aim slightly.

## 13. Kill reward flow

### 13.1 Paths

There are seven separate copies of this logic, and they have drifted.

| Step | Bullet (8373) | Shell headshot (8264) | Shell blast (7756) | Rocket blast (7863) | Sword light (WS 4915) | Sword area (WS 4746) | Finisher (WS 4604) |
|---|---|---|---|---|---|---|---|
| `enemyDie` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| 1/6 `enemyDeathGrunt` | Yes | Yes | No | No | Yes | No | No |
| 50% `enemyExplode` | No | No | Yes | Yes | No | No | Yes |
| Destroy calls | 2 ragdolls | 1 ragdoll | Ragdoll + dismember (5) | Ragdoll + dismember (10) | 1 ragdoll | 1 ragdoll | Dismember (10) only |
| Particle gore | Conditional, below | Head removal | None extra | None extra | `createDismemberment('melee')` at damage 100+ | 30 x `0xff0000` | None extra |
| Score | Value | Value | Value | Value | Value | Value | Value x 2 |
| `registerKill` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `registerSwordKill` | No | No | No | No | Yes | Yes | Yes |
| Feed text | Eliminated | Eliminated | Eliminated | Eliminated | Eliminated | Area Attack Kill | HEAVY FINISHER |
| 30% pickup | Yes | Yes | Yes | Yes | Combo swings only (section 17) | Yes | Yes |

WS means the code is in `WeaponSystem`. Sword paths are detailed in the weapons doc.

### 13.2 Bullet kill gore rules (8382-8417)

| Condition | Effect |
|---|---|
| Headshot and shotgun | Hide head, `createHeadRemoval` at model origin + 1.3 y |
| Headshot, not shotgun | `createDismemberment(hitPos, 'headshot', dir)`: 6-8 giblets, 25 blood, 8 mist |
| Shotgun body shot, `distance < 10` | `createDismemberment(enemyPos, 'ballistic', dir)`: 7-9 giblets, 12 blood, 5 mist. Distance is bullet to enemy, so this is always true |
| `finalDamage >= 150` | Unreachable. Maximum is 100 (SMG with Blood Thirst and headshot) |
| Otherwise | Ragdoll only |

`dismember()` (explosive and finisher paths) spawns 3 `createMassiveBloodSpurt` jets at feet + 1 y, and detaches all 6 body parts with blood trails. Launch speed is `force * max(0, 1 - dist / 10)` away from the blast, plus `0.5 * force` upward.

### 13.3 Double destroy changes the feel

`takeDamage` calls `destroy()` when HP hits 0, and the kill paths then call `destroy` again (8430, 7760, 7874). Each call starts a separate `requestAnimationFrame` loop over the same `ragdollParts` array, stepping a fixed 1/60 per tick.

| Path | Loops | Entries | Effective gravity (derived) | Lifetime (derived, 60 Hz) |
|---|---|---|---|---|
| Bullet kill | 2 joint loops | 2 whole bodies on one mesh | About 8g, or 78 u/s^2 | 2.5 s |
| Rocket or shell kill | 1 joint + 1 parts loop | Body + 6 parts | About 4g for 2 s, then 1g | About 3 s |
| Sword, shell headshot | 1 joint loop | 1 body | 1g (9.8) | 5 s |
| Finisher | 1 parts loop | 6 parts | 1g | 5 s |

Effects of the double run:

- **Bullet kills:** bodies slam down and vanish quickly.
- **Explosive kills:** gibs travel at twice their nominal launch speed for the first 2 s.
- **Explosive limbs tumble less than they should.** The leftover whole-body entry keeps applying joint limits to the detached arms, legs and head, clamping their rotation.
- **The rocket path throws an uncaught `TypeError`.** At lifetime under 1 the parts loop reaches the whole-body entry, whose `mesh` is a `Group` with no `.material`, at line 2914. That kills the parts loop, so blood trails stop at about 2 s and the joint loop finishes alone. It happens once per explosive kill and has no other visible effect.

**Sequel warning:** fixing the double call without retuning makes bullet-kill ragdolls fall at 1/8 the current acceleration and last twice as long. If the current feel is wanted, set ragdoll gravity to about 78 and lifetime to 2.5 s on purpose. Because the step is fixed per tick, these loops also run about 2.4x faster on a 144 Hz display, so the feel on the author's machine is unknown.

### 13.4 Perk checks on every kill

`player.registerKill()`, in order (see the player doc):

| Order | Check | Trigger |
|---|---|---|
| 1 | Combo count | +1 if within 5 s of the last kill, else 1 |
| 2 | Airstrike | Combo at least 8, not held, 30 s cooldown over |
| 3 | Warthog | Combo at least 12, not held, 45 s cooldown over |
| 4 | Berserk | Combo at least 15, resets combo to 0 |
| 5 | Blood Thirst | 4 kills in 5 s |
| 6 | Hellfire | 10 kills in 10 s |

Multiple rewards can fire on one kill. A large rocket blast loops through kills in one frame, so its last kill can trigger several of them at once.

## 14. Strike calls

### Targeting

Both strikes are unlocked by combo, equipped with X or Z, and started by `weaponSystem.shoot`, which sets `isTargeting*` only. `updateGame` then renders the preview and calls the strike on left mouse press.

The two-stage design collapses. `shoot` runs while the button is down, and the next frame sees `isMousePressed()` still true with `isTargeting*` now set, so the strike is called immediately. The preview shows for about one frame unless the click lasted under one frame. Aim is therefore where the crosshair is at the moment of the click.

Target point: ray from screen centre onto plane y = 0.

| Preview | Geometry | Colour | Pulse |
|---|---|---|---|
| Airstrike ring | `RingGeometry(11.5, 12, 32)` at y 0.1 | `0xffff00` | `0.3 + sin(ms * 0.003) * 0.2` |
| Warthog rectangle | `PlaneGeometry(40, 3)` at y 0.1 | `0x00ff00` | `0.3 + sin(ms * 0.004) * 0.15` |

### Airstrike timeline (`callAirstrike`, 6566)

Awards no direct score. Kills route through the normal rocket path. Starts the 30 s cooldown and switches to the SMG.

| Time | Event |
|---|---|
| 0 s | `walkieTalkieFire`. Ground ring `RingGeometry(4.5, 5, 32)`, `0xff6600`, opacity `0.4 + sin(ms * 0.005) * 0.4` |
| 3 s | `airstrikeActivate` |
| 4.0-5.4 s | 15 rockets, 100 ms apart, random within radius 12, from y 30-35, speed 50, damage 100, radius 6, slight spread (+/-0.05), gray smoke size 1.0 |
| 6 s | Ring removed |
| 6.5 s | Hellfire missile at target, y 35, speed 60, damage 99999, radius 20 |
| About 7.1 s | Missile impact (derived) |

### Warthog timeline (`callWarthogStrike`, 6737)

Starts the 45 s cooldown and switches to the SMG. Corridor is 40 long, 3 wide, running perpendicular to view through the target.

| Time | Event |
|---|---|
| 0 s | `walkieTalkieFire`. Green corridor plane, opacity pulsing every 50 ms |
| 2 s | `airstrikeActivate`, pulse stops |
| 4.0-6.45 s | 50 shells, 50 ms apart, swept along the corridor with +/-1.5 spread. Each spawns at y 50, 20 back along the corridor, speed 200, damage 150, radius 5, plays `30mmshell_flyby` 0.5 |
| 6.5 s | `warthog_flyby` at 2x volume |
| 8.5 s | Corridor removed |

Shells dive at 68 degrees, not the 45 in the comment, with 0.27 s flight (derived). The flyby sound starts just after the last shell spawns, so the gun run is heard before the jet.

All strike timing uses `setTimeout`, so it ignores pause and SLOWMO and survives restart.

## 15. What stacks on each event

Design reading: the common pattern is that every event fires everything in the same frame. Time spread comes from each layer's lifetime, not from scheduling.

### Layer lifetimes

| Layer | Lifetime |
|---|---|
| Shake | 50-100 ms |
| Shockwave | 100-150 ms |
| Sparks | 0.5 s |
| Particles | 1-1.5 s |
| Ragdoll and gibs | 2.5-5 s |
| Kill feed | 4 s |

### Body hit

Same frame: 15 x red, `enemyHit`, 10% grunt, health bar update.

### Headshot, non-lethal

Same frame: 20 x yellow, 3-layer headshot sound (0.75 + 0.5625 + 0.75, the third skipping 1 s of leading silence), blood jet, +50, feed line, SLOWMO count.

The yellow burst separates it from body hits at a glance. No shake. Colour and sound alone carry the distinction.

### Headshot kill (SMG)

Everything above except the jet, then in the same frame: `enemyDie`, 1/6 death grunt, 6-8 giblets, 25 blood, 8 mist, score, kill count, perk checks, feed line, 30% pickup, ragdoll.

This is up to 5 sounds in a frame, two score lines, and possibly a perk activation.

### Rocket blast with several enemies

Same frame, in order:

1. `rocketExplosion`, 80 particles, shockwave, shake.
2. Per enemy: `enemyHit`, 10 red particles, damage.
3. Per kill: `enemyDie`, 3 blood spurts, 6 flying parts with trails, 50% `enemyExplode`, score, feed line, perk checks, 30% pickup.
4. Player self-damage if inside the radius.

Sound uses 4 round-robin instances per name, so more than 4 simultaneous uses of one sound cut off the oldest.

### Hellfire rocket

The peak event. Two layered explosion sounds, 360 large fading particles in four colour bands from yellow core to red edge, a shockwave reaching 15 units, the largest shake (+/-6.9 degrees, double duration) and a 20-unit instakill. Allocating 360 meshes in one frame will also cause a hitch, though that was not measured.

### SLOWMO entry

On the third headshot: `perkSlowmo`, all sound effects drop to 0.25 rate including sounds already playing, the world drops to 0.25, and `SLOWMO ACTIVATED!` appears, then a live `SLOWMO [x.xs]` countdown.

### Taking damage

Bullet: `playerHit`, DOM damage flash (200 ms), 10 red particles at the eye. Near miss within 3 units plays `bulletWhizz`, one per bullet.

### Why it works (interpretation)

1. **Layering:** one event gets several sounds with different roles, instead of one big sample.
2. **Four channels on each kill:** audio, gore, numbers and perk progress all pay out together, so kills feel rewarded even when one channel is quiet.
3. **Clear hierarchy:** shake escalates about 60x from SMG (0.004) to Hellfire (0.24) and particle count from 15 to 360, so big moments read as big.
4. **Short shake:** 2-3 frames of snap gives punch without blurring aim.
5. **Generous hit volumes:** headshots land more often than the model suggests, feeding the most rewarding stack.
6. **Asymmetric SLOWMO:** the player stays at full speed in a slowed world.
7. **Fast body cleanup:** the snap-to-floor from the double destroy keeps the action readable, though by accident.

## 16. Cross-cutting game-feel logic in this slice

A sequel should move these out of the loop and into systems. They live here and not in the owning classes:

| Logic | Where | Natural owner |
|---|---|---|
| Hit detection, head and body volumes | 8205-8236 | Combat system |
| Headshot rule, x2 damage, +50, triple sound | 8245-8259, 8336-8358 | Combat system |
| Body hit grunt chance | 8365 | Enemy or audio |
| Dismemberment decision | 8382-8417 | Enemy or gore system |
| Kill rewards, seven copies | 7756, 7863, 8264, 8373, WS | One `onEnemyKilled(ctx)` |
| 30% drop and 50/50 type | Same seven places | Loot table |
| Explosion sound, particles, shake by type | 7713-7838 | Data-driven explosion table |
| Self-damage rule | 7896-7904 | Damage system |
| Near-miss whizz at 3 units | 8549 | Enemy projectile |
| Hit burst at player eye | 8563 | Player feedback |
| Impact particles and sounds | 8464, 8497, 8541, 8579 | Surface impact table |
| Sword combo buffering and wind-up input | 8094-8147 | Weapon system |
| Autocannon zoom toggle | 8150-8160 | Weapon system |
| Strike target previews and raycasts | 7945-8034, 8048-8087 | Strike system |
| Pickup values and messages | 8594-8602 | Pickup system |
| Time scale selection per subsystem | Whole of `updateGame` | One game clock |

## 17. Broken, janky and dead

Ordered by impact. All are from reading the code.

### Crashes and lost frames

| # | Lines | Problem | Result |
|---|---|---|---|
| 1 | 7786 | `this.onWaveComplete()` does not exist anywhere. It runs whenever a shell explosion leaves `enemies` empty: killing the last enemy, or any shell landing when none are alive | `TypeError` out of `updateGame`. The rest of the frame and the render are skipped. The loop survives because rAF was already queued. Wave logic still works by polling |
| 2 | 8315, 8455, 8488 | The same throw skips `bulletPool.release`, leaving the shell in `active` with `active = false` | One bullet leaks per throw until the next `releaseAll`. On the wall path (8478) `shellCone` is not hidden, so a faint cone stays frozen in the world |
| 3 | 7786 | Warthog shells landing after the last enemy dies hit this every time, up to 20 per second | Dropped frames during the strike's finale. Autocannon fire between waves does the same |
| 4 | 2914 | Group has no `.material` in the parts loop | Uncaught `TypeError` per explosive kill (section 13.3) |

### Feel-bearing bugs

Fix these on purpose and retune:

| # | Lines | Problem | Result |
|---|---|---|---|
| 5 | 8430, 7760, 7874 | `destroy` runs twice | Ragdoll speed and lifetime differ by kill type (section 13.3) |
| 6 | 2271-2348 | `Enemy.update` steers in 3D toward the player's eye and has no y clamp | Enemies leave the ground. Starting 40 units away they reach about y 1.1 at their 15-unit hold distance (derived), and rise when the player jumps. Backing away moves them down, and possibly below ground. This also shifts blast distance and hit volumes |
| 7 | 4456-4462 | `addScreenShake` overwrites | Last writer wins. A weak shake right after a strong one replaces it, for example an SMG shot (0.004) straight after a blast (0.06) |
| 8 | 4071 | The shake is undone by a 16 ms `setTimeout` while `updateCamera` also overwrites pitch every frame | The timer can land before or after the next frame, so pitch may get an inverse kick, and roll may keep a residue that decays at 0.9 per frame |
| 9 | 6349-6351 | `perk_slowmo` exemption is overwritten right after playing | The sound plays at 0.25 |

### Gameplay bugs

| # | Lines | Problem | Result |
|---|---|---|---|
| 10 | 8008-8025 | Warthog preview is rotated 90 degrees from the strike | The preview's long axis runs along the view direction, the strike across it (verified by matrix calculation). The comment claims perpendicular. Hidden in practice by #11 |
| 11 | 8046-8087 | Targeting collapses into one click (section 14) | Previews show for about a frame |
| 12 | 7958, 7999, 8061, 8078 | `if (targetPoint)` is always true, because `intersectPlane` returns null but `targetPoint` stays (0,0,0) | Aiming above the horizon sends the strike to the map centre |
| 13 | 6599 vs 7961 | Ground ring radius 5 vs preview 12, real rocket spread 12 + blast 6, missile 20 | The visible marker greatly understates the danger area |
| 14 | 7899-7903 | Self-damage uses raw `bullet.damage` | The airstrike missile deals 25,000+ to the player within 20 units, so it is an instant death inside an area bigger than the marker. Likely unintended |
| 15 | 7863-7892 | Enemy rockets use the player's handler | They damage other enemies, and those kills give the player score and combo. They also take the x0.5 self-damage path, so the "high damage" rocket deals only 7.5-15 |
| 16 | 8321 | Hellfire bullets take the rocket path | Hellfire removes headshots, so SLOWMO cannot trigger from them. Blast at feet distance can deal less than a normal bullet (section 12). They also render as orange rockets with gray smoke, since `isRocket` selects the rocket mesh |
| 17 | 8089, 4807 | First-swing melee receives `GameManager`, which has `addScore`, so `gameInstance` stays null | Kills on a first swing never drop pickups. Buffered combo swings pass `FPSGame` and do |
| 18 | 8096 | `player.update` resets mouse delta earlier in the frame | `getMouseDelta()` is always zero here, so `directionalInput` is never set and `upSlash`, `leftSlash`, `rightSlash` never occur |
| 19 | 8138 | Area attack triggers on release with no minimum hold | A tap of right-click gives the full 100-damage, 8-range attack. `windUpDuration` is animation only |
| 20 | 8399-8402 | Distance is bullet to enemy, always small | Close-range condition is always true |
| 21 | 8346-8357 | Headshot rewards are per pellet | Shotgun multi-hit gives multiple +50 and can trigger SLOWMO from one shot |
| 22 | 8181-8198 | Sub-steps test the end position first | Shells may collide with a further object before a nearer one |
| 23 | 8655 | Delta clamped at 0.1 with single-point tests for bullets | At 30 FPS a bullet moves 3.33 per frame, which is more than a wall's 2 thickness, so it can tunnel. Older file clamped at 1/30 |
| 24 | 8555-8566 | No `continue` after a player hit | The released bullet still runs the box test. If it is inside a box it plays a second impact |
| 25 | 7685 | No obstacle check | Enemies spawn inside geometry, and their bullets die immediately in that box |

### State and flow bugs

| # | Lines | Problem | Result |
|---|---|---|---|
| 26 | 7365-7372 | `KeyR` is inside `state === PLAYING` and then tests `PAUSED` | The pause screen's "Press R to restart" does nothing |
| 27 | 7374-7377 | Space restart does not request pointer lock | The run starts with look and movement disabled until a click |
| 28 | 7437 | Partial reset (section 2) | The next run starts where the player died. Held strikes carry over. Old strike timers can land in the new run |
| 29 | 7499 | Dying in SLOWMO leaves `globalPlaybackRate` at 0.25 | Menu sounds play at 0.25 until a new run's first frame |
| 30 | 6550, 6721 | Cancel functions never called, and `switchWeapon` does not clear targeting | If targeting does stick (very short click), it survives a weapon switch |
| 31 | Wall clock | Perks, wave timers and regen delay run during pause | Pausing burns perks and shortens the wave break |
| 32 | 7063, 7068 | Unguarded `localStorage` | Throws where storage is blocked, inside the constructor |
| 33 | 8665 | Failed pointer lock leaves `shouldStartGame` set | The game does not start, and a later lock starts it |

### Performance

| Lines | Issue |
|---|---|
| 8474, 8570, 5713 area | Fresh `Box3` from each of 24 objects, per bullet, per pass, per frame. Static boxes should be cached |
| 8201-8236 | No broad phase. Each bullet does `getWorldPosition` and several `clone()`s per enemy |
| 7947-7956 and siblings | New `Raycaster`, `Plane` and vectors each frame while targeting |
| 7697, `registerKill` | `console.log` on every spawn, and 2 per kill |
| Particles | One mesh, geometry and material per particle. There is no cap in `createExplosion`, only for blood trail droplets (under 400) |
| `createExplosion`, `createSpark` | `emissive` on `MeshBasicMaterial` is not a real property in r128: it does nothing and logs 2 warnings per particle, about 720 for one Hellfire rocket (derived) |
| 8689 | `getElementById` and `getContext` every frame |

### Dead code

| Item | Why |
|---|---|
| `setPlayerPosition` and positional branch in `AudioManager.play` | No call passes a position. All 81 `audioManager.play` calls are non-positional, so all sound is 2D at full volume despite the comment at 7926 |
| `onWaveComplete` call | Target missing |
| Hellfire branches at 8460 and 8493 | `isHellfireBullet` always comes with `isRocket`, caught one branch earlier |
| `finalDamage >= 150` | Unreachable |
| `shellGlow` | Never assigned |
| `headshotKilled` | Written only. Main loop cleans up through `isDead` |
| `heavyFinisherReady`, `inputBufferTime` | Written or declared only |
| `Enemy.attack`, `canAttack`, type `damage`, `enemyBullets` | Unused |
| `const bullets` at 8089 | Unused |
| `force` in finisher (WS 4600) | Computed, never applied. The "knockback" does not exist |
| `deltaTime` params to `waveSystem.update` and the perk updaters | Ignored |
| `cancelAirstrikeTargeting`, `cancelWarthogStrikeTargeting` | Never called |
| Blood mist block at 7866 | Commented out |

## 18. Older version (`fps-game.html`)

World and wave numbers are identical: same walls, obstacles, fog, wave formula, type rolls, hit radii, pickup rates and values.

| Area | Older | Current |
|---|---|---|
| First state | MENU | SPLASH |
| Music | None | `SoundtrackManager`, hard at wave 10 |
| `WaveSystem` | No game reference | Takes `game` |
| Delta clamp | 1/30 | 0.1 |
| Shadows | `PCFSoftShadowMap` | `PCFShadowMap` |
| Renderer | `antialias` only | Adds `powerPreference` |
| Projectile sub-steps | None | 4 for shells |
| Autocannon, Warthog, shell explosions | Absent | Present |
| Walkie-talkie airstrike weapon, sword combo | Absent | Present |
| Bullets | No `particleSystem`, no smoke trails | Smoke and ring trails |
| Weapon keys | 1-4 only | 1-5, X, Z |

The older file already has `handleRocketExplosion` with both Hellfire flags, and the same double destroy: `takeDamage` destroys at its line 1895, and kill paths destroy again at its lines 5397 and 5636. So the current ragdoll feel predates the newer features.
