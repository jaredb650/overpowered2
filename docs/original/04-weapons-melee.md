# 04: Sword combat, perk hooks, ammo HUD, autocannon zoom

Source: `index.html`, slice lines 4465-5156, plus the code it depends on. All line numbers refer to `index.html`.

**How to read the evidence**

- **[run]** means the behaviour was executed. The real `WeaponSystem` class, the real sword input block (lines 8093-8147) and the real `ParticleSystem` were loaded from the source under a fake clock, with stubbed THREE and DOM, and with the real per-frame order. Default is 60 Hz.
- Anything untagged was read from source, or is plain arithmetic on source values.
- The game was **not played**, and the `sounds/` folder was not available. Section 12 ("why it feels good") is analysis of the code, not playtest evidence. What each sample sounds like is unknown.

---

## 1. Key facts

- Melee resolves **instantly on input**: damage, blood and hit sounds land on the frame of the click. The swing animation is cosmetic and plays afterwards. Only the heavy finisher is delayed (200 ms).
- There are four real sword attacks: three chained light swings, an area sweep (RMB) and a heavy finisher (RMB buffered during swing 2 or 3). Three directional slashes exist in code but cannot be reached.
- Enemy HP tops out at 100 and never scales, so **area (100) and finisher (125 minimum) kill every enemy type in one hit**.
- There is no hit-stop, no slash trail, no FOV kick, no camera lunge, no hit marker, no enemy flinch, no time-scale change on any sword event.
- Zoom is an instant FOV cut from 75 to 30 plus a DOM overlay. It has no gameplay effect beyond magnification, and it does not touch sensitivity.

---

## 2. Sword definition

`weapons.sword`, lines 3108-3123.

| Field | Value | Notes |
|---|---|---|
| `damage` | 75 | Base for light swings |
| `fireRate` | 0.25 s | Effectively redundant: equals the shortest swing |
| `meleeRange` | 5 | Old comment: was 3 |
| `swingAngle` | 120° | Full arc, tested as +/-60°. Old comment: was 90 |
| `screenShake` | 0.01 | Light swings, only on hit |
| `recoilAmount` | 0 | No weapon recoil |
| `isAutomatic` | false | Needs trigger release for a fresh swing, but the buffer bypasses this (see 4.3) |
| `isMelee` | true | |
| `soundName` | `swordSwing` | Unused; `performMeleeAttack` hard-codes sounds |
| `maxAmmo`, `currentAmmo`, `reloadTime`, `projectileCount`, `spread` | 0 | |

Key: Digit5 (line 7412). No gating, no draw animation, no equip time. README says key 4; that is stale.

### Sword state fields (lines 3145-3190)

| Field | Value | Status |
|---|---|---|
| `swingDuration` | 0.2 initial | Overwritten per attack |
| `windUpDuration` | 0.3 s | Drives the pose only, no gameplay effect |
| `areaSwingDuration` | 0.4 s | |
| `swordCombo.comboWindow` | 0.7 s | Start-to-start |
| `swordCombo.inputBufferTime` | 0.3 | **Never read.** The 0.7 progress threshold is hard-coded at line 3869 |
| `swordCombo.heavyFinisherReady` | false | Written once at 8129, **never read**, never cleared |
| `swordCombo.directionalInput` | null | Always null in practice (see 13) |

### Viewmodel (`createSwordModel`, lines 3640-3700)

All `MeshBasicMaterial`, so unlit. `renderOrder` 999. The group's own position and rotation are overwritten every frame.

| Part | Geometry | Local position | Colour |
|---|---|---|---|
| Blade | Box 0.02 x 1.0 x 0.08, DoubleSide | (0, 0.5, 0) | `0xc0c0c0` |
| Edge | Box 0.01 x 1.0 x 0.04 | (0, 0.5, 0) | `0xe0e0e0` |
| Hilt | Cylinder r 0.02, h 0.2, 8 seg | (0, -0.05, 0) | `0x8b4513` |
| Guard | Box 0.03 x 0.03 x 0.25 | (0, 0.05, 0) | `0x696969` |
| Pommel | Sphere r 0.04 | (0, -0.15, 0) | `0x8b4513` |

Runtime placement (lines 4000-4012): `weaponOffset` (0.35, -0.25, -0.6) plus `swingOffset.position`, rotated by the camera quaternion. Rotation is camera rotation (order YXZ) plus `swingOffset.rotation`, plus Y offset -0.15.

---

## 3. Input routing and frame order

Order inside `updateGame`:

1. `player.update` (7924): `handleMouseLook` reads the mouse delta and **zeroes it** (5398).
2. `weaponSystem.update(scaledDelta)` (8043): advances swing state, ends swings, fires queued attacks.
3. If LMB is down and pointer is locked: `shoot()` -> `canShoot()` -> `performMeleeAttack()` (8046-8089). Passes **`GameManager`**.
4. Sword block (8094-8147): directional tracking, buffering, RMB wind-up and release. Passes **`FPSGame`**.
5. Autocannon zoom block (8150-8160).
6. `particleSystem.update(scaledDelta)` (8630), then render (8694).

`canShoot` gates for melee (4177-4195): not swinging, not winding up, not area-swinging, `now - lastShotTime >= 0.25`, and `triggerReleased`.

Both buttons are polled per frame as level state, not edge events. LMB is `isMousePressed()`, RMB is `isRightButtonDown()`.

### States and transitions

| From | Trigger | To |
|---|---|---|
| Idle | LMB, `canShoot` passes | Swinging (combo stage from `count`) |
| Idle | RMB down | Winding up |
| Swinging, `canCombo` true | LMB down, nothing queued | Queue `light` |
| Swinging, `canCombo` true | RMB down, `count >= 1`, nothing queued, LMB not down | Queue `heavy` |
| Swinging, swing ends | `light` queued | Next swing, same frame |
| Swinging, swing ends | `heavy` queued | Heavy finisher, same frame |
| Swinging, swing ends | Nothing queued | Idle, pose snaps to zero, `canCombo` cleared |
| Winding up | RMB released | Area swing, damage applied immediately |
| Area swing | 0.4 s elapsed | Idle |
| Any sword state | Weapon switch | All flags cleared, `count` 0, queue dropped, pose zeroed (3773-3794) |

LMB wins if both buttons are down (`if` / `else if`, lines 8107 and 8119), so holding both always queues light.

---

## 4. Combo chain

### 4.1 Attack table

| Attack | Trigger | Duration | Multiplier | Damage | x2 Blood Thirst | Swing sounds |
|---|---|---|---|---|---|---|
| `combo1` (down chop) | `count` 0 | 0.25 s | 1.0 | 75 | 150 | `swordSwing` |
| `combo2` (diagonal up) | `count` 1 | 0.30 s | 1.25 | 93.75 | 187.5 | `swordSwing` |
| `combo3` (power sweep) | `count` 2 | 0.35 s | 1.5 | 112.5 | 225 | `swordSwing` + `swordHit2` |
| `heavyFinisher` | RMB buffered | 0.35 s | n/a (own damage) | see 6 | **not boosted** | `swordSwing` + `swordSlam` |
| `upSlash`, `leftSlash`, `rightSlash` | Unreachable | 0.25 s | 1.0 | 75 | 150 | `swordSwing` |

Damage figures confirmed **[run]**: 75, 93.75, 112.5 and 150, 187.5, 225.

`swordHit2` on `combo3` plays on every swing as an "extra woosh", so a whiffed third swing sounds like a contact.

### 4.2 Counter rules

- `count` advances only at **swing end**: `count = (count + 1) % 3` (line 3878). It is still 0 during swing 1, 1 during swing 2, 2 during swing 3.
- Timeout is checked only when the next attack starts: `now - lastAttackTime > 0.7` resets to 0. `lastAttackTime` is the previous swing's **start**, so a separate click must land within about 450 ms of a `combo1` ending. **[run]**: 583 ms start-to-start advanced to `combo2`; 717 ms reset to `combo1`.
- Area attack and finisher do not update `lastAttackTime` or `lastShotTime`.

### 4.3 Buffering

| Situation | Window | Length |
|---|---|---|
| First swing of a chain (started from idle) | Progress >= 0.7 | Last 75 / 90 / 105 ms of a 250 / 300 / 350 ms swing |
| Any swing started from the queue | **Entire swing** | `canCombo` is never cleared when chaining |

- **[run]**: a tap at 100 ms into a fresh `combo1` is dropped. A tap held across the 70% point is queued. On a chained `combo2`, `canCombo` is already true at progress 0.11 and a tap queues at 0.22.
- The button must be physically down on a frame inside the window. Nothing remembers an earlier click.
- The queued object carries `time` (8110, 8122), which is never read, so a queued attack cannot expire.
- **Holding LMB loops the combo forever [run]**: `combo1 -> combo2 -> combo3 -> combo1...` with a 0.90-0.95 s cycle. The buffer never checks `triggerReleased`. `isAutomatic: false` only applies to the first swing.

### 4.4 Light attack resolution (`performMeleeAttack`, lines 4795-4984)

1. Early out if winding up or area-swinging.
2. Set `lastShotTime`, apply combo timeout, choose attack, set `currentAttack` and `lastAttackTime`.
3. Start the swing, play swing sounds.
4. Loop enemies in reverse array order, skipping inactive ones.
5. Hit test: `camera.position.distanceTo(enemy.position) <= 5`, then `acos(look . toEnemy) <= 60°`.
6. Per hit, in order: `swordHit1`, `swordHit2`, `enemyHit`; 15 particles `0xff4444` at `enemy.position + size * 0.5` up; 10% `enemyGrunt`; `enemy.takeDamage(75 * combo * bloodThirst)`.
7. Per kill, in order: `enemyDie`; 1/6 `enemyDeathGrunt`; if `damage >= 100`, `createDismemberment(enemy.position, 'melee', dir)` in try/catch; `addScore(scoreValue)`; `addKill`; `registerKill`; `registerSwordKill`; feed `Enemy eliminated +N`; 30% pickup roll, then 50/50 health or ammo.
8. After the loop, if anything was hit: `addScreenShake(0.01)`.

No target cap. No line-of-sight check. No head or body distinction. The function always returns `[]`; `hitEnemies` is used only for the shake check, and `enemiesKilledCount` is unused.

Dead enemies are removed by the main loop (8516), which also updates the enemy count.

---

## 5. Wind-up and area attack

### 5.1 Wind-up (`startWindUp`, 4498-4506)

Starts when RMB is down, the player is not swinging, `canCombo` is false, and not already winding up or area-swinging (8134-8137). Sets `isWindingUp`, records the time, clears swing flags.

- Holding has no time limit. The pose ramps linearly over 0.3 s then holds indefinitely.
- LMB is blocked while winding up. Movement is not slowed.
- **The charge does nothing.** `performAreaAttack` never reads wind-up progress. A one-frame RMB tap deals the full 100 **[run]**.
- If you press RMB on a swing that cannot queue a finisher (swing 1), you start a wind-up when the swing ends **[run]**.

### 5.2 Area attack (`performAreaAttack`, 4667-4793)

Fires on RMB release (8138-8140). All damage is applied on that frame.

| Parameter | Value |
|---|---|
| Range | 8 (3D, eye to enemy origin) |
| Arc | 160° (+/-80°) |
| Damage | 100, x2 under Blood Thirst = 200 |
| Knockback | Instant 10-unit teleport along `toEnemy`, including its Y component |
| Lock-out | 0.4 s, blocks LMB and RMB |
| Repeat rate | About 450 ms per attack with spammed RMB at 60 Hz **[run]** |
| Shake | 0.15, **always, even on a whiff [run]** |

Per hit, in order: `swordHit1`, `swordHit2`, `enemyHit`; 25 particles `0xff4444` at body mid-height; teleport; damage.

Per kill, in order: `addScore(scoreValue || 100)`; `addKill`; `registerKill`; `registerSwordKill`; feed `Area Attack Kill! +N`; 30 particles `0xff0000` at `enemy.position`; `enemyDie`; 30% pickup roll.

Differences from a light hit: no 10% grunt, no 1/6 death grunt, no gore (`createDismemberment`) regardless of damage, and no combo interaction. Plays `swordSwing` once at the start, not `swordSlam`.

---

## 6. Heavy finisher

### 6.1 Getting it

Buffer RMB while `canCombo` is true, `isSwinging` is true and `count >= 1` (8119). In practice that means **during swing 2 or swing 3**. The source comment says "after at least 1 combo hit", but `count` is still 0 during swing 1 **[run]**. RMB in the gap between swings starts a wind-up instead.

Holding RMB through swing 2 works, because the check is level-triggered. Hits do not need to connect; whiffed swings count.

| Route | Finisher swing starts | Blast |
|---|---|---|
| `combo1, combo2, heavy` | 550 ms | 750 ms after the first swing **[run]** |
| `combo1, combo2, combo3, heavy` | 900 ms | 1100 ms |

### 6.2 Execution

Run from the swing-end branch of `update()` (3888-3905), not through `performMeleeAttack`. Sets `currentAttack`, sets `count = 0`, starts a 0.35 s swing, plays `swordSwing` and `swordSlam`. A 200 ms `setTimeout` then calls `performHeavyFinisherDamage` if the swing is still active. 200 ms is 57% through the swing, while the blade is mid-slam.

The timer is real time. Switching weapon inside the 200 ms cancels the blast but the slam sound has already played. At +100 ms there was no blast; at +250 ms the blast had fired **[run]**.

### 6.3 Blast (`performHeavyFinisherDamage`, `handleHeavyFinisherExplosion`, 4508-4665)

Centre: `camera.position + look * 3`, then `y = 0`. So it sits up to 3 units ahead on a level look, and directly underfoot when looking straight down.

| Parameter | Value |
|---|---|
| Radius | 8, spherical, around the centre |
| Damage | 250 at centre, falling linearly to 125 at the edge: `250 * (1 - d/8 * 0.5)` |
| Blood Thirst | **Not applied** |
| Score | `scoreValue * 2` |
| Player self-damage | None |
| Shake | 0.15, always fires |
| Line of sight | None; hits enemies behind the player, up to about 5 units back **[run]** |

Sequence at the blast:

1. `rocketExplosion`.
2. `createExplosion` x3 at centre: 60 `0xffffff`, 40 `0xcccccc`, 30 `0x888888`.
3. 30 white sparks: velocity x and z +/-15, y 0..20.
4. `createShockwave(position, false)`.
5. `addScreenShake(0.15)`.
6. Collect enemies in radius, then process each: `enemyHit`; 10 particles `0xff4444` at `enemy.position`.
7. Per kill: `enemyDie`; set `hp = 0`; `enemy.destroy(10, position)` which dismembers; 50% `enemyExplode`; `addScore(x2)`; `addKill`; `registerKill`; `registerSwordKill`; feed `HEAVY FINISHER! +N`; 30% pickup roll at the correct position; then splice from `enemies`.

Minimum damage is 125 and maximum enemy HP is 100, so everything in radius dies. The falloff and the `takeDamage` branch have no effect with current HP values.

The white palette is unique to this attack. Rockets use `0xff6600` and `0xffaa00` (7819-7820). The rocket explosion also uses 50 + 30 particles and shake 0.06, so the finisher is larger on both counts.

### 6.4 Dismemberment from the blast (`Enemy.dismember`, 2753-2832)

Kills pass `explosionForce = 10`, so each kill produces:

- 3 `createMassiveBloodSpurt` calls from `position + (0, 1, 0)` pointing away from the blast, direction jittered +/-0.15 on x and z and +0..0.3 on y. That is 120 particles per kill.
- All 6 body parts detach. Velocity is `dir * force` plus `force * 0.5` upward, with `force = 10 * max(0, 1 - dist/10)`. Spin is +/- `force`. Gravity -9.8, damping 0.98, bounce 0.3, friction 0.7, 5 s life, fade over the last 1 s.
- Blood trails: 2-3 droplets per emission while speed > 1, emission interval `max(0.03, 0.1 - speed * 0.01)` s, skipped if there are 400+ particles.

### 6.5 After the finisher

The swing-end code increments `count` on the finisher too, so **`count` ends at 1, not 0 [run]**. `lastAttackTime` still points at the swing before the finisher, which decides what happens next:

| Route into finisher | Elapsed at finisher end | Next buffered LMB |
|---|---|---|
| `combo2 -> heavy` | 650 ms, inside the window | `combo2` **[run]** |
| `combo3 -> heavy` | 700 ms + frames, outside | `combo1` **[run]** |

That creates an unintended **finisher loop**: tap LMB during the finisher, RMB during `combo2`, repeat. **[run]** Sustained for 6 s with 650-660 ms between finishers at 60, 144 and 240 Hz, and exactly 700 ms at 30 Hz. A finisher cannot chain directly into a finisher because `count` is 0 during it.

---

## 7. Hit geometry

| Attack | Origin | Reach | Arc |
|---|---|---|---|
| Light | Camera | 5 | 120° |
| Area | Camera | 8 | 160° |
| Finisher | Ground point up to 3 ahead | 8 radius | 360° |

Cones are true 3D, tested against `enemy.position` (the model origin, not its body), so pitch matters and enemy size is ignored.

- Eye height is 1.8 standing, 0.9 crouched.
- `enemy.position.y` starts at 0 but is never clamped: enemies move along 3D vectors toward the player, so Y drifts. Ranged-AI behaviour belongs to the enemy spec.
- With an enemy origin at y = 0 and a level look from y = 1.8: light hits only between about 1.04 and 4.66 units horizontally. Standing nearly on top of the enemy and looking level **misses [run]**. For area the band is about 0.32 to 7.79.
- `acos` input is not clamped. A dot product a rounding error above 1 gives `NaN` and a miss. Theoretical; not observed.

Enemies retreat at 0.5x speed when closer than 13 units and hold at 13-15 (2280-2293). Players must rush them, which the slide and sprint support (walk 8, sprint 14.4).

### Damage against enemies

Enemy stats from lines 2058-2062. HP is never scaled by wave.

| Type | HP | Score | `combo1` 75 | `combo2` 93.75 | `combo3` 112.5 | Area 100 | Finisher |
|---|---|---|---|---|---|---|---|
| 0 | 50 | 100 | Kill | Kill | Kill | Kill | Kill, 200 pts |
| 1 | 75 | 150 | Kill | Kill | Kill | Kill | Kill, 300 pts |
| 2 | 100 | 200 | 25 left | 6.25 left | Kill | Kill | Kill, 400 pts |

Under Blood Thirst, every sword attack one-shots everything.

Sustained per-target output:

| Pattern | Output |
|---|---|
| Hold LMB | 281.25 per 0.90-0.95 s, about 300 DPS, in cone |
| RMB spam | 100 per 0.45 s, about 220 DPS, wider and longer |
| Finisher loop | 93.75 in cone plus 125-250 at radius 8, per 0.65 s |

---

## 8. Swing animation

`p` is progress 0-1 from `performance.now()`, so swings run in **real time, unaffected by SLOWMO**. `s = sin(p * PI)`. Rotation in radians, position in view units, negative Z is forward.

| Attack | rot.x | rot.y | rot.z | pos.x | pos.y | pos.z |
|---|---|---|---|---|---|---|
| `combo1` | `-1.4s` | 0 | `0.15s` | `-0.5s` | `-0.6s` | `-0.9s` |
| `combo2` | `1.2s - 0.6` | `0.8s` | `-0.3s` | `0.6s - 0.5` | `0.5s - 0.3` | `-0.7s` |
| `combo3` | `-0.8s` | `2(s - 0.5)` | `0.3s` | `-0.7s` | `-0.2s` | `-1.0s` |
| `upSlash` (dead) | `1.5s - 0.7` | 0 | 0 | `-0.2s` | `0.7s - 0.4` | `-0.6s` |
| `leftSlash` (dead) | -0.5 | `-1.2s` | `-0.4s` | `-0.8s` | -0.1 | `-0.7s` |
| `rightSlash` (dead) | -0.5 | `1.2s` | `0.4s` | `0.8s - 0.3` | -0.1 | `-0.7s` |

### Heavy finisher

| Phase | rot.x | rot.z | pos.x | pos.y | pos.z |
|---|---|---|---|---|---|
| Raise, `p < 0.2`, `c = min(3p, 1)` | `0.8c` | `0.2c` | `-0.2c` | `0.5c` | `0.2c` |
| Slam, `k = (p - 0.2) * 1.25` | `0.8 - 2.5k` | `0.2 - 0.3k` | `-0.2 - 0.5k` | `0.5 - 1.2k` | `0.2 - 1.4k` |

`rot.y` is 0 throughout. The blast at 200 ms lands at `p = 0.571`, `k = 0.464`, `rot.x = -0.36`. End pose at `k = 1`: rot.x -1.7, pos.y -0.7, pos.z -1.2.

### Wind-up and area swing

Wind-up is linear in `w = min(elapsed / 0.3, 1)`: rot (`0.3w`, `-0.8w`, `0.6w`), pos (`0.4w`, `0.2w`, `0.1w`).

Area swing, `p` over 0.4 s:

| Phase | rot.x | rot.y | rot.z | pos.x | pos.y | pos.z |
|---|---|---|---|---|---|---|
| Transition, `p < 0.2`, `t = p/0.2` (80 ms) | `0.3(1-t)` | `-0.8(1-0.5t)` | `0.6 + (-PI/2 - 0.6)t` | `0.4(1-0.5t)` | `0.2(1-t) - 0.05` | `0.1 - 0.3t` |
| Sweep, `u = (p-0.2)/0.8` (320 ms) | 0 | `-0.8 + 2*PI*u` | `-PI/2` | `0.2 - 1.7u` | -0.1 | `-0.4 - 0.2 sin(p*PI)` |

The blade lies flat and spins one full turn in 320 ms while crossing from right to left.

### Pose discontinuities

Every animation returns to zero with a hard snap, with no recovery blend. Other pops:

- `combo2` opens at rot.x -0.6, pos (-0.5, -0.3, 0). `combo3` opens at rot.y -1.0. Both jump there in one frame from idle.
- `combo3` is labelled a sweep, but `2(s - 0.5)` goes -1 to +1 and back to -1, so it is out-and-back.
- Finisher at `p = 0.2`: `c` is only 0.6, so rot.x jumps 0.48 to 0.8 and pos.y jumps 0.3 to 0.5.
- Area at `p = 0.2`: rot.y jumps -0.4 to -0.8, pos.z jumps -0.2 to about -0.52.
- Area always starts from the full wind-up pose, so a quick tap pops to it in one frame.

These pops may add perceived snap, but that is unverified.

---

## 9. FX data

### Particles

All are one new `Mesh` + geometry + material each, unpooled. There is no global cap and no ground collision. Life is in scaled time, so SLOWMO slows them. `alpha = life / maxLife`.

| Effect | Shape | Colour | Velocity | Gravity | Life | Fade |
|---|---|---|---|---|---|---|
| `createExplosion` (non-hellfire) | Sphere r 0.1, 4x4 | Per call | x, z +/-5; y 0..10 | -20 | 1.0 s | Scale = alpha. Opaque, so the opacity write has no effect |
| `createSpark` | Box 0.05 | Per call | Given | -20 | 0.5 s | Scale = alpha |
| `createShockwave` | Wireframe sphere r 0.5, 16x8, DoubleSide | `0xffffff`, opacity 0.25 | Scale +120/s, cap 15 | none | 0.1 s | `0.25 * (1 - progress^2)` |
| `createBloodJet` jet (30) | Sphere r 0.08-0.20 | `0xcc0000` | dir x 15, jitter x,z +/-1.5, y +0..5 | -15 | 0.8-1.2 s (max 1.2) | Scale = alpha |
| `createBloodJet` mist (10) | Sphere r 0.15 | `0xff4444`, opacity 0.6 | dir x 7.5, jitter x,z +/-2.5, y +0..3 | -20 | 0.4 s | **Never spawns, see 13** |
| `createMassiveBloodSpurt` (40) | First 10 r 0.15-0.30, rest r 0.08-0.16 | First 5 `0xff0000`, rest `0xcc0000` | dir x 20, jitter x,z +/-4, y +0..10; first 5 x1.5 | -20 | 1-2 s (max 2) | Opacity = alpha, no shrink |

The shockwave's 0.1 s life ends at scale 12.5 (radius about 6), before it reaches the cap of 15.

`createDismemberment(pos, 'melee', dir)` (1736) is a simplified replacement. A large block of giblet code below it is commented out as "DISABLED - Causing crashes". It intends 25 `0xcc0000` + 15 `0x880000` + two blood jets. It actually creates 70 of the intended 120 particles **[run]** because of the bug in 13. It spawns at `enemy.position`, the feet, not at mid-body.

### Sounds

Master volume is 0.5, so effective volume is base x 0.5. All sword sounds are non-positional. `HTMLAudio`, 4 instances per sound, round-robin, so a fifth simultaneous play restarts the oldest. Pitch follows `globalPlaybackRate`, which is 0.25 during SLOWMO.

| Key | File | Base | Effective |
|---|---|---|---|
| `swordSwing` | `sword_swing.mp3` | 0.5 | 0.25 |
| `swordHit1` | `sword_hit1.mp3` | 0.6 | 0.30 |
| `swordHit2` | `sword_hit2.mp3` | 0.6 | 0.30 |
| `swordSlam` | `sword_slam.mp3` | 0.7 | 0.35 |
| `enemyHit` | `enemy_hit.mp3` | 0.4 | 0.20 |
| `enemyGrunt` | `enemy_grunt.mp3` | 0.4 | 0.20 |
| `enemyDie` | `enemy_die.mp3` | 0.5 | 0.25 |
| `enemyDeathGrunt` | `enemy_deathgrunt.mp3` | 0.5 | 0.25 |
| `enemyExplode` | `enemy_explode.mp3` | 0.5 | 0.25 |
| `rocketExplosion` | `rocket_explosion.mp3` | 0.5 | 0.25 |
| `perkAdrenaline` | `perk_adrenaline.mp3` | 0.7 | 0.35 |
| `autocannon_zoom` | `autocannon_zoom.wav` | 0.7 | 0.35 |

### Screen shake (`addScreenShake`, 4456-4463; applied 4054-4076)

Sets `intensity` and `duration = 50`. Each frame while active: `rotation.x += (rand - 0.5) * intensity`, `rotation.z += (rand - 0.5) * intensity`. Peak offset per axis is `intensity / 2`. About 2-3 frames at 60 Hz.

| Source | Intensity | Peak |
|---|---|---|
| Sword light hit | 0.01 | 0.29° |
| Rocket fire | 0.04 | 1.15° |
| Rocket explosion | 0.06 | 1.72° |
| **Area, finisher** | **0.15** | **4.30°** |
| Hellfire rocket | 0.24 (100 ms) | 6.88° |

- It replaces rather than stacks, so a sword hit (0.01) during a bigger shake cuts that shake down.
- Duration counts down on scaled time, so it lasts 4x longer in SLOWMO.
- The viewmodel transform is computed **before** the shake (4005-4012 vs 4064), so the sword does not follow the camera on shake frames.
- `updateCamera` rewrites `rotation.x` every frame, so the 16 ms `setTimeout` undo is redundant on X. On Z, which only decays at x0.9 per frame, it does the real work.

---

## 10. What stacks on each event

All **t = 0** items land on the same frame unless noted.

### Light hit, no kill (`combo1`)

| Time | Event |
|---|---|
| 0 | `swordSwing`, `swordHit1`, `swordHit2`, `enemyHit` (4 samples) |
| 0 | 15 red particles, health bar drops, 10% `enemyGrunt` |
| +1 to +3 frames | Shake 0.01 |
| 0-250 ms | Chop animation, peak at 125 ms, so blood appears before the blade visually arrives |

### Third-hit kill (`combo3`, damage 112.5)

| Time | Event |
|---|---|
| 0 | `swordSwing`, `swordHit2`, `swordHit1`, `swordHit2`, `enemyHit`, `enemyDie` (6 samples); 10% and 1/6 extras |
| 0 | 15 + 40 particles, 30-particle jet at the feet |
| 0 | Ragdoll, score, kill-feed line, perk counters |
| +1 to +3 frames | Shake 0.01 |
| 0-350 ms | Sweep, then ragdoll runs 5 s |

Two `swordHit2` plays start together, so the same sample doubles up.

### Area kill

| Time | Event |
|---|---|
| 0 (release) | `swordSwing`, `swordHit1`, `swordHit2`, `enemyHit`, `enemyDie` |
| 0 | 25 particles at the body, 30 particles about 10 units further away (see 13) |
| 0 | Ragdoll, score, feed line, perk counters |
| next frames | Shake 0.15 |
| 0-80 ms | Blade rotates flat |
| 80-400 ms | Full 360° spin across the screen |

### Finisher kill

| Time | Event |
|---|---|
| 0 | `swordSwing`, `swordSlam`, raise animation |
| 70 ms | Slam begins |
| **200 ms** | `rocketExplosion`, 130 white-grey particles, 30 sparks, shockwave, shake 0.15 |
| 200 ms, per enemy | `enemyHit`, `enemyDie`, 50% `enemyExplode`, 10 + 120 particles, 6 flying limbs with blood trails, double score, `HEAVY FINISHER! +N` |
| 350 ms | Swing ends |
| up to 5 s | Limbs settle and fade |

A four-enemy finisher creates about 681 particles in one tick, before blood trails: 161 at the centre plus 130 per enemy.

Kill feed: `.kill-message`, `fadeInOut` 4 s, slides in from +100 px over the first 10%, out to -100 px over the last 10%, maximum 5 lines.

---

## 11. Perk hooks

### WeaponSystem methods (4465-4496)

| Method | Effect |
|---|---|
| `activateBloodThirst` | Sets flag, fills `currentAmmo = maxAmmo` on **all** weapons, refreshes HUD |
| `deactivateBloodThirst` | Clears flag, refreshes HUD |
| `activateHellfire`, `deactivateHellfire` | Flag only |
| `activateBerserk`, `deactivateBerserk` | Flag only |

Filling all weapons also sets `walkieTalkie` and `warthogStrike` to 1. This is harmless because selecting them checks `player.airstrikeAvailable` or `warthogStrikeAvailable` (7406, 7416). Blood Thirst does not cancel a reload in progress: `canShoot` still blocks until it finishes. The reserve pool is unchanged.

Flags are consumed elsewhere:

| Flag | Consumers |
|---|---|
| `bloodThirstActive` | Skips ammo check and decrement, shotgun pellets x2, `bloodthirstyShot` layer, HUD `∞` |
| `hellfireActive` | Rocket blast x2.5, all other bullets become explosive (radius 2, damage x1.25), `hellfireShot` layer |
| `berserkActive` | SMG fire interval x0.75, rocket x0.5, akimbo SMG, shotgun pellets x3, `berserkShot` layer |

The shot layers are in `shoot()` after the melee return, so **the sword gets none of them**.

### What affects the sword

| Perk | Trigger | Sword effect |
|---|---|---|
| Blood Thirst | 4 kills in 5 s, lasts 10 s | Damage x2 on light and area, not the finisher. Every light kill now meets the `>= 100` gore threshold |
| Adrenaline | 3 sword kills in 3 s, 5 s, 3 stacks | Sword-exclusive. Speed `7.5 * (1 + 0.1 * stacks)`: 8.25, 9.0, 9.75 against a normal 8, so stack 1 is only +3%. Does not change swing speed. README's "doubles speed" is stale |
| Berserk | 15-kill combo, 10 s | Player-side only: invulnerable, +15% speed. No change to swing speed or damage |
| Hellfire | 10 kills in 10 s, 5 s | None |
| SLOWMO | 3 headshots in 3 s, 5 s, x0.25 | Sword cannot trigger it. During it, swings stay real-time while enemies run at 25%, so the sword is 4x faster relative to them. Sword audio drops to 0.25 rate |

All three sword attacks call `registerKill` then `registerSwordKill`. A single area swing or finisher that kills 3 enemies triggers Adrenaline in one frame; 4 also trigger Blood Thirst.

---

## 12. Why the melee should feel good

Code analysis only, not playtested.

1. **Zero latency.** Damage, blood and four sound layers happen on the frame the click is polled. There is no wind-up before contact on light swings, so the response feels attached to the finger.
2. **Generous contact.** A 5-unit, 120° cone against hit-all targeting means swings rarely whiff once you are close, and one swing can connect with a whole group.
3. **Sound density.** Each hit plays swing, two metal hits and a flesh hit together, then adds a death sound on kills. Sound multiplies per enemy, so hitting three enemies is audibly bigger than hitting one.
4. **Low time-to-kill.** 75 damage kills two of three enemy types in one hit, so most hits end in a ragdoll and a score line.
5. **Clear escalation.** Each swing is longer (0.25, 0.30, 0.35 s) and stronger (x1.0, x1.25, x1.5). The third has the largest forward thrust (1.0, against 0.9 and 0.7), the widest yaw (+/-1.0 rad) and an extra sound layer. Its 112.5 is the only base swing above the 100 gore threshold, so **gore is the reward for reaching hit three**.
6. **Forgiving rhythm.** Queued swings start on the exact frame the previous one ends, and hold-to-chain means a sloppy player still gets a fluent combo.
7. **The finisher reads as a punctuation mark.** It is the only sword event with anticipation: a raise, a 200 ms gap, then a white explosion that looks unlike every other blast, with 15x the shake of a normal hit, flying limbs, double score and capitalised kill text.
8. **Shake restraint.** Light hits barely shake (0.29°) and the big attacks are 15x stronger (4.3°), so the contrast makes the heavy attacks land.
9. **The perk loop.** Sword kills feed both general combos and an exclusive speed perk, which helps close the 13-15 unit gap enemies try to keep. Blood Thirst then promotes every kill to gore.
10. **Commitment choice.** Right mouse does two different things depending on timing: inside a combo it queues a slam, outside it charges a sweep.

Worth noting is what the feel does *not* rely on: no hit-stop, no slash trail, no camera lunge, no FOV punch, no flinch. All of those remain available to the sequel as added impact.

---

## 13. Broken, janky and dead code

### Bugs that change play

| # | Problem | Cause | Evidence |
|---|---|---|---|
| 1 | **Direct-click kills never drop pickups** | `shoot()` passes `GameManager` (8089). It has `addScore`, so `gameInstance` is null and the 30% roll does nothing (4807, 4962). Queued swings pass `FPSGame`, so only those drop | **[run]** forced roll: direct 0 pickups, chained 1 |
| 2 | **Melee gore is cut short and throws every time** | `createBloodJet` uses `safePosition` (1496) but its parameter is `position`. `ReferenceError` after the 30 jet particles. Mist and the second jet never run. The melee try/catch (4927) hides it behind a console warning | **[run]** throws at 70 of 120 particles |
| 3 | **Same bug is unguarded on non-lethal headshots** | Line 8349 has no try/catch, so the error aborts the rest of `updateGame` and that frame's render. `animate` schedules rAF first (8648), so the game survives. This is probably the real origin of "DISABLED - Causing crashes" at 1737, but that is inference | Read |
| 4 | **Area death FX and pickups land about 10 units away** | Knockback moves `enemy.position` before damage. The kill leaves the mesh behind (`update` returns early for dead enemies), then FX and pickup use the moved position. Y moves too, so they can end up underground | **[run]** enemy at z -5, y 1: burst and pickup at z -14.87, y -0.58 |
| 5 | **Some area pickups cannot be collected** | Pickup range is 3D `< 2` from the eye (y 1.8). That pickup at y -0.58 is 2.38 below a standing player. Crouched (0.9) it works | Arithmetic on #4 |
| 6 | **Knockback never visibly affects a live enemy** | Area damage 100 equals max HP, so everything hit dies | Read |
| 7 | **Wind-up charge is fake** | Damage ignores `windUpDuration`. A tap equals a full charge | **[run]** |
| 8 | **Finisher loop** | `count` ends at 1 after a finisher, and `lastAttackTime` is not refreshed. Radius-8 nuke every 650 ms | **[run]** |
| 9 | **Hold LMB auto-combos** | Level-triggered buffer ignores `triggerReleased`. May be acceptable as a feature but contradicts `isAutomatic: false` | **[run]** |
| 10 | **"Last 30%" buffer applies only to the first swing** | `canCombo` is not cleared when a queued attack starts | **[run]** |
| 11 | **Finisher needs swing 2, not "1 combo hit"** | `count` advances at swing end | **[run]** |
| 12 | **Finisher ignores Blood Thirst** | Line 4559 uses a flat 250 | Read |
| 13 | **Finisher hits behind the player**; all melee passes through walls | Spherical blast, no line-of-sight test anywhere | **[run]**, read |
| 14 | **Finisher blast runs during pause** | `setTimeout` is real time and the guard only checks swing state | Read |

### Dead or unreachable

| Item | Why |
|---|---|
| Directional slashes (`upSlash`, `leftSlash`, `rightSlash`) | The delta is zeroed by `handleMouseLook` before line 8096 reads it, so the 2-px threshold is never met **[run]**. The same zeroing kills **weapon sway** at 4041. Even if fixed, the block would run on chained swings only, because `directionalInput` is nulled on idle frames. It would also replace the combo stage with x1.0 on every swing: the counterfactual run gave `combo1 rightSlash rightSlash...` **[run]** |
| `heavyFinisher` branches in `performMeleeAttack` (4852, 4901) | That function never sets this attack, so the x2.0 multiplier is dead |
| Finisher `force` vector (4599-4601) | Computed, never used |
| Finisher `takeDamage` branch (4646-4649) | Unreachable: 125 minimum beats 100 max HP |
| Finisher function params, `playerPos` | Only `gameInstance` is used |
| `hitEnemies` return from area, `enemiesKilledCount` | Ignored or unused |
| `inputBufferTime`, `heavyFinisherReady`, queued `.time`, `swordAnimations[].type`, sword `soundName` | Never read |
| Commented giblet block in `createDismemberment` | About 190 lines of disabled code (1770-1957). Melee values were 8-11 giblets, 15 splatters, 6 mist |

### Janky

- `swordSlam` plays 200 ms before the blast. Possibly intended if the sample has pre-roll, but the file was not available to check.
- Whiffing area or finisher still gives shake 0.15 **[run]**; whiffing a light swing gives none **[run]**. May be intended.
- `swordHit2` on `combo3` plays on a whiff.
- Weapon switch inside the finisher's first 200 ms leaves a slam sound with no blast **[run]**.
- Animation pops listed in section 8.
- Gore spawns at the feet because `enemy.position` is the origin, while hit blood uses mid-height.
- Sword kills ragdoll in a random direction: velocity +/-1.5 on x and z, not away from the player. No sense of being struck.
- `emissive` and `emissiveIntensity` are passed to `MeshBasicMaterial`, which does not support them. From memory of three r128, each one logs a console warning. That would be about 320 warnings per finisher from sparks and bursts. Not run here.
- Stale docs: README key bindings omit the autocannon and put the sword on 4. The in-game guide says "right-click for heavy slam" without explaining hold versus buffered timing.

---

## 14. Ammo HUD (`updateAmmoDisplay`, 4986-5033)

DOM targets: `#currentAmmo`, `#reserveAmmo`, `#weaponName`. Called on switch, shot, reload end, `addAmmo`, Blood Thirst on and off, and game start.

Checks run in this order, first match wins:

| Condition | `currentAmmo` text | `reserveAmmo` text |
|---|---|---|
| `isMelee` | `-` | `-` |
| `walkieTalkie` | `READY` | `-` |
| `warthogStrike` | `READY` | `-` |
| `bloodThirstActive` | `∞` | `∞` |
| Otherwise | Magazine count | Shared `reserveAmmo` |

Names: `SMG`, `SHOTGUN`, `ROCKET`, `SWORD`, `AIRSTRIKE`, `A10 WARTHOG`, `AUTO CANNON`, fallback `WEAPON`.

Colour of `#currentAmmo` by `currentAmmo / maxAmmo`:

| Ratio | Colour |
|---|---|
| Exactly 0 | `#ff0000` |
| <= 0.33 | `#ffaa00` |
| Above | `#00ff00` |

Quirks:

- Sword is 0/0 = `NaN`, which fails both tests, so the dash is green.
- The colour logic runs on real ammo even when text says `READY` or `∞`. Blood Thirst shows green because it fills the magazine and stops decrementing.
- `#reloadIndicator` is shown and hidden by `showReloadIndicator` and `hideReloadIndicator` (5035-5041).

---

## 15. Autocannon zoom and scope

### Behaviour

Trigger: rising edge of RMB, only while the autocannon is selected, using `zoomTogglePressed` as the latch (8150-8160). Key Digit4, no unlock gate.

| Property | Value |
|---|---|
| `defaultFOV` | 75 |
| `zoomFOV` | 30 |
| Transition | Instant cut, no interpolation |
| Magnification | Source says 2.5x. True value is `tan(37.5°) / tan(15°)` = **2.86x** |
| Sound | `autocannon_zoom` on both zoom in and zoom out |
| `clearZoom` | Silent. Called only from `switchWeapon` (3769) |

Zoom changes nothing else: damage, fire rate, recoil and spread (already 0) are unaffected, and no code outside these methods reads `isZoomed`.

### Overlay (`createScopeOverlay`, 5073-5141)

Built lazily on first zoom, appended to `body`, then toggled by `display`. Never removed.

| Element | Spec |
|---|---|
| Root | `position: fixed`, full screen, `pointer-events: none`, `z-index: 999` |
| Crosshair box | 200 x 200 px, centred |
| Horizontal line | 100% x 2 px, `rgba(255, 0, 0, 0.7)` |
| Vertical line | 2 px x 100%, `rgba(255, 0, 0, 0.7)` |
| Centre dot | 4 x 4 px, round, `rgba(255, 0, 0, 0.9)` |
| Vignette | `radial-gradient(circle, transparent 30%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0.8) 100%)`, added after the crosshair so it paints above it |

### Problems

| Problem | Cause |
|---|---|
| **Sliding silently breaks zoom** | `Player.updateCamera` writes `camera.fov` whenever `currentFOV` is more than 0.1 from `targetFOV` (5814-5818). A slide sets a new target, so FOV returns to about 75-90 while the overlay stays up and `isZoomed` stays true. Nothing restores 30. Getting zoom back takes two RMB presses |
| **Zooming during a FOV settle fails** | Same write replaces 30 on the next frame |
| **Zoom-out ignores Player FOV** | Hard-sets 75 even if `Player.currentFOV` is 80. Line 5647 sets target +5 "briefly", but nothing resets it until the next slide ends |
| **No sensitivity scaling** | Stays 0.002 rad/px, so view motion on screen is 2.86x faster than unzoomed |
| **Viewmodel stays on** | Nothing hides it. By arithmetic the 2.5-unit barrel remains in frame at FOV 30, low on the right. No screenshot was taken |
| **Default crosshair stays on** | `.crosshair` (z-index 100) shows under the red reticle |
| **Overlay covers menus** | `endGame` and `pauseGame` do not clear zoom. z-index 999 sits above the pause and game-over screens (200). `startGame` does not clear it either, so zoom survives a restart |
| **Dead field** | `WeaponSystem.currentFOV` (3164) is never used |

---

## 16. Older version (`fps-game.html`)

Same base sword: 75 damage, `fireRate` 0.25, range 5, 120°, shake 0.01, same per-hit sound stack and 15-particle blood. `registerSwordKill` is present.

Missing entirely: combos, wind-up, area attack, finisher, RMB input, autocannon, zoom.

Its one swing was 0.2 s with `s = sin(p * PI)`: rot.y `0.8s`, rot.z `-0.3s`, pos.x `-0.4s`, pos.z `-0.3s`.

It also has the pickup bug in another form: it calls `this.spawnPickup` on `WeaponSystem`, a method that class does not define.

---

## 17. Guidance for the sequel

**Keep:** instant hit on light swings; the 3-stage escalation and durations; hit-all cone; layered per-enemy sound; the 15x contrast between light and heavy shake; the finisher's delayed, distinctly coloured blast; hold-to-chain if the design wants it; gore as a threshold reward.

**Decide deliberately:**

- Does wind-up charge actually matter? If so, scale damage, range or arc by `windUpProgress`, and set a minimum.
- Is the finisher loop a feature? If not, set `count = 0` after the swing-end increment and refresh `lastAttackTime`. Otherwise balance a 650 ms radius-8 nuke.
- Should Blood Thirst boost the finisher?
- Should swings stay real-time during SLOWMO?
- Should directional slashes exist? If so, accumulate mouse delta before it is consumed, and do not let direction erase the combo multiplier.

**Fix by construction:**

- Pass one game context object everywhere, so drops cannot depend on how an attack started.
- Test hits against body bounds, not model origin, and clamp the `acos` input.
- Add line-of-sight for melee.
- Replace position-teleport knockback with a real impulse, and take effect positions before moving anything.
- Use edge-triggered input with a timed buffer, cleared on each new swing.
- Run timers and animation on one game clock so pause and weapon switch behave.
- Make shake additive with decay rather than replace-on-write, and apply it to the viewmodel as well.
- Have one FOV owner that composes base, speed and zoom, and lerp the zoom.
- Scale sensitivity by `tan(fov/2)` when zoomed, hide the viewmodel and default crosshair, and clear zoom on pause and death.
- Pool particles and instance them.

**Add for impact (not in the original):** hit-stop on kills and heavies, a slash trail, directional ragdoll impulse, enemy flinch for survivors, a hit marker, and blend-out poses instead of the snap to idle.
