# 03. Weapons core (WeaponSystem)

Source: `orig/index.html`, class `WeaponSystem` L3026-5154. The assigned slice is L3026-4464. References were followed into `AudioManager` (L487), `Bullet` (L919), `ParticleSystem` (L1189), `InputManager` (L5157), `Player` (L5247), and `FPSGame.updateGame` (L7916). All line numbers are `index.html` unless stated.

**Evidence labels**

| Label | Meaning |
|---|---|
| (none) | Read directly from the code |
| `[r128]` | Executed against the real three.js r128 build in JavaScriptCore, in isolation |
| `[sim]` | Python simulation using the game's constants. An estimate, not a measurement |
| `[analysis]` | Interpretation of why something feels the way it does |

The game itself was never run in a browser for this document. Nothing here is observed gameplay. Claims about runtime behaviour are derived from the code path.

---

## 1. The ten facts that matter most

1. There are **7 weapons plus 1 cosmetic model**: `smg`, `shotgun`, `rocket`, `autoCannon`, `sword`, `walkieTalkie` (airstrike), `warthogStrike`, and `smgLeft` (Berserk akimbo visual, no gameplay).
2. **Every weapon uses the same viewmodel mount**: offset `(0.35, -0.25, -0.6)`, yaw `-0.15`. Per-model placement in the `create*Model` functions is overwritten every frame and does nothing.
3. **There is no weapon bob, no working sway, no swap animation, no aim punch, and no weapon FOV kick.** The only viewmodel motion is recoil rotation, the reload animation, and sword swing offsets.
4. **Recoil is viewmodel-only.** It never moves the camera or the bullet. All guns except the shotgun are pixel-perfect.
5. **Screen shake is a 50 ms snap**, 2 frames at 60 Hz, applied to camera pitch and roll only. Later shakes replace earlier ones. They never add.
6. The **autocannon is a radial instakill**, not a "direct hit" instakill. Any impact, including ground and walls, deals at least 49,999 within radius 5. It costs 1 reserve round per shell and has no self-damage.
7. **Airstrike and Warthog targeting is effectively skipped.** The click that starts targeting also confirms it on the next frame.
8. **Sway and directional sword attacks are dead code.** The mouse delta is reset by `Player` before the weapon code reads it.
9. **Every autocannon shot throws two uncaught TypeErrors** (`material.emissive` does not exist on `MeshBasicMaterial`) `[r128]`. The visual still works because the throw comes after the visible changes.
10. Fire rate, reload and sword timing use **real time** (`performance.now()`), so they ignore SLOWMO. Bullets and shake duration use **scaled time**. Recoil decay is **per-frame**, so it depends on frame rate.

---

## 2. Master stat table

Exact values from `this.weapons` (L3036-3135). `fireRate` is seconds between shots.

| Key | HUD name | Key bind | Mag | Start | fireRate | RPM nominal | Reload (s) | Damage | Pellets | Spread | Recoil | Shake | Mode |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `smg` | SMG | 1 | 30 | 30 | 0.05 | 1200 | 1.0 | 25 | 1 | 0 | 0.02 | 0.004 | full auto |
| `shotgun` | SHOTGUN | 2 | 6 | 6 | 0.3 | 200 | 1.25 | 20 per pellet | 6 | 0.1 | 0.08 | 0.02 | semi |
| `rocket` | ROCKET | 3 | 1 | 1 | 0.5 | 120 (reload-gated) | 1.5 | 100 (blast only) | 1 | 0 | 0.12 | 0.04 | semi |
| `autoCannon` | AUTO CANNON | 4 | 5 | 5 | 0.15 | 400 | 1.0 | 99999 (blast) | 1 | 0 | 0.15 | 0.03 | semi + own limiter |
| `sword` | SWORD | 5 | 0 | 0 | 0.25 | n/a | 0 | 75 | 0 | 0 | 0 | 0.01 (on hit) | semi, hold chains |
| `walkieTalkie` | AIRSTRIKE | X (gated) | 1 | 0 | 1 | n/a | 0 (none) | 100 per rocket | n/a | 0 | undefined | 0 | single use |
| `warthogStrike` | A10 WARTHOG | Z (gated) | 1 | 0 | 1 | n/a | 0 (none) | 150 per shell | n/a | 0 | undefined | 0 | single use |

Extra fields:

| Key | Field | Value |
|---|---|---|
| `shotgun` | `isShotgun` | true |
| `rocket` | `isRocket`, `blastRadius`, `projectileSpeed` | true, 8, 40 |
| `autoCannon` | `isSemiAuto`, `bulletSpeed`, `bulletType`, `lastFireTime` | true, 200, `'30mmShell'`, 0 |
| `autoCannon` | shell blast radius (set in `shoot`, L4330) | 5 |
| `sword` | `isMelee`, `meleeRange`, `swingAngle` | true, 5, 120 (half-arc 60 degrees) |
| `walkieTalkie` | `isAirstrike` | true |
| `warthogStrike` | `isWarthogStrike` | true |

Shared ammo: `reserveAmmo` 90, `maxReserve` 120, one pool for all guns. Reserve is consumed one per round loaded, so a rocket or a 30mm shell costs the same as one SMG bullet.

Enemy reference (L2059-2061): HP 50 / 75 / 100, size 1.5 / 1.8 / 2.25. HP does not scale with wave.

| Weapon | Hits to kill 50 / 75 / 100 HP | Notes |
|---|---|---|
| SMG body (25) | 2 / 3 / 4 | |
| SMG head (50) | 1 / 2 / 2 | |
| Shotgun, all 6 pellets (120) | 1 / 1 / 1 | Each pellet resolves separately |
| Rocket direct | 1 / 1 / 2 | Mean blast about 90-93 on a direct hit `[sim]` |
| Autocannon | 1 / 1 / 1 | Anything within radius 5 |
| Sword combo1 (75) | 1 / 1 / 2 | |
| Sword area (100) | 1 / 1 / 1 | Always kills |

### Effective fire rate

The check is `now - lastShotTime >= rate`, sampled once per frame, so rates quantise to whole frames. `[sim]` with 0.3 ms timing jitter, holding or clicking at the limit:

| Weapon | Nominal /s | 60 Hz | 120 Hz | 144 Hz | 240 Hz |
|---|---|---|---|---|---|
| SMG | 20.00 | 16.75 | 18.23 | 18.00 | 19.08 |
| SMG + Berserk | 26.67 | 20.00 | 24.00 | 24.00 | 25.05 |
| Shotgun | 3.33 | 3.23 | 3.28 | 3.27 | 3.31 |
| Autocannon | 6.67 | 6.26 | 6.46 | 6.55 | 6.56 |

At 60 Hz, 3 frames is exactly 50.0 ms, so the SMG flips between 3 and 4 frames per shot. Berserk's nominal +33% is about +19% at 60 Hz. The code comment says "25% faster", but the interval drops 25% and the rate rises 33%.

---

## 3. Frame order and clocks

`FPSGame.updateGame(dt)`, with `dt` clamped to 0.1 s and `scaled = dt * player.timeScale`:

1. `player.update(dt)`: reads then **resets** mouse delta (L5392-5398), writes camera position, rotation and FOV.
2. Perk timers (real time).
3. Strike target visuals.
4. `weaponSystem.update(scaled, input)`: sword animation, viewmodel placement from camera, sway and recoil decay, camera shake, recoil applied to viewmodel, trigger latch, reload state.
5. If LMB held and pointer locked: confirm strike if targeting, else `weaponSystem.shoot(...)`.
6. Sword buffer and RMB logic, then autocannon RMB zoom edge detect.
7. Bullets `update(scaled)` plus collision.
8. Enemies, pickups, particles. Render happens after `updateGame` returns.

Consequences:

- Flash and sound land in the same frame as the click, because `shoot` runs before render.
- Recoil and shake from a shot appear **one frame later**, because `weaponSystem.update` already ran.
- The projectile is stepped once before its first render, so it first appears about 2.17 u out at 60 Hz (0.5 spawn offset + 1.67). A 30mm shell first appears about 3.83 u out.
- The viewmodel has no lag, because it is placed after the camera update.

| System | Clock | SLOWMO (0.25x) | While paused |
|---|---|---|---|
| Fire rate (`lastShotTime`) | `performance.now()` | Not slowed | Clock keeps running |
| Autocannon limiter | `Date.now()` | Not slowed | Clock keeps running |
| Reload progress | `performance.now()` | Not slowed | **Completes during pause** |
| Sword animation | `performance.now()` | Not slowed | Keeps running |
| Recoil and sway decay | Per frame | Not slowed | Stopped |
| Shake duration | `scaled` dt | **Lasts 4x longer** | Stopped |
| Bullets, particles | `scaled` dt | Slowed | Stopped |
| Muzzle flash timers, strike timers | `setTimeout` | Not slowed | **Keep running** |

During SLOWMO the player fires at full cadence while rounds move at quarter speed, so SMG rounds appear 4x denser in the air. `[analysis]` This is much of the bullet-time look and comes free from the mixed clocks.

---

## 4. Firing logic

### `canShoot(isMousePressed)` L4153-4198

Gate order:

1. Compute `effectiveFireRate`. Berserk: `smg` x0.75, `rocket` x0.5.
2. If `isSemiAuto`: reject if `Date.now() - lastFireTime < fireRate * 1000`.
3. Melee: reject if `isSwinging`, `isWindingUp`, `isAreaSwinging`, or inside fire rate.
4. Ranged: reject if `isReloading`, if empty and not Blood Thirst, or inside fire rate.
5. If not automatic: reject if `!triggerReleased`, otherwise set `triggerReleased = false` as a side effect.

`triggerReleased` becomes true in `update()` whenever LMB is up (L4083).

**Implicit input buffer, worth keeping.** The trigger latch is checked last. A press held during cooldown or reload is rejected before the latch is touched, so it fires on the first legal frame with no re-click. `[analysis]` This is part of why semi-auto weapons feel responsive.

`lastShotTime` is shared by all weapons while the rate comes from the current weapon, so swapping bypasses cooldowns (see section 13).

### `shoot(...)` L4200-4423, exact order

1. `canShoot` gate.
2. `walkieTalkie` or `warthogStrike`: start targeting, return. These do not set `lastShotTime`.
3. Melee: `performMeleeAttack`, return. No perk sound layers, no bullets.
4. `currentAmmo--` unless Blood Thirst.
5. `lastShotTime = now`.
6. Recoil: `recoil.x += (rand - 0.5) * recoilAmount`, `recoil.y += recoilAmount`.
7. `addScreenShake(weapon.screenShake)`.
8. Muzzle flash, plus left SMG flash if Berserk.
9. Direction: camera forward. `startPos = camera.position + forward * 0.5`, so **rounds leave the camera, not the muzzle**.
10. Shotgun pellet count from perks: 6 / 12 (BT) / 18 (Berserk) / 36 (both).
11. Per projectile: `bulletPool.get()`, spread, damage, type setup, `bullet.weapon = currentWeapon`, `fire()`.
12. Weapon sound, then perk layers in order: Blood Thirst, Berserk, Hellfire. Layers play **once per trigger pull**, not per pellet.
13. `updateAmmoDisplay()`.

Spread (L4313-4317), applied in **world** axes:

```js
direction.x += (Math.random() - 0.5) * spread;
direction.y += (Math.random() - 0.5) * spread;
direction.normalize();
```

Square pattern, half-angle 2.86 degrees when facing -Z. It collapses when facing +/-X (section 13).

Damage (L4320-4322): `weapon.damage * player.getDamageMultiplier()`, where the multiplier is 2.0 under Blood Thirst and 1.0 otherwise. Hellfire non-rocket bullets then multiply by 1.25.

### Projectile setup

| Type | Mesh (`Bullet.createMesh`) | Speed | Range (5 s life) | Trail | Blast | Flags |
|---|---|---|---|---|---|---|
| Normal round | Sphere r0.05, 4x4, `0xffff00` | 100 | 500 | none | none | |
| Rocket | Cyl r0.08/0.06 h0.3 6-seg, `0xff6600` | 40 | 200 | Smoke every >60 ms: `0xcccccc`, size 0.35, life 1.0 | 8 | `isRocket` |
| Hellfire rocket | same | 40 | 200 | Smoke `0xff6600` 0.4/1.2, plus 50% chance `0xffaa00` 0.3/0.8 | 20 | `isRocket`, `isHellfireRocket` |
| Hellfire bullet | **Rocket mesh** | 100 | 500 | Regular grey rocket smoke | 2 | `isRocket`, `isHellfireBullet` |
| 30mm shell | Cyl r0.05 h1.5 6-seg, `0xffff00`, plus white cone r0.3 h1.2 opacity 0.15 trailing 0.8 behind | 200 | 1000 | Rings every >60 ms, smoke every >30 ms | 5 | `is30mmShell` |
| Airstrike rocket | Rocket mesh | 50 | n/a | Smoke `0xcccccc` 1.0/1.8 | 6 | `isRocket`, `isAirstrikeRocket` |

No projectile has gravity, and no damage falls off with range. Bullet pool starts at 100 and grows on demand. Rocket and shell meshes are built for every pooled bullet, so each pooled bullet holds 4 meshes.

30mm rings: `createWireframeRing(pos, velocity, 0xffff00, 0.005, 0.1)`. They grow by `(1 + age*25)^1.5` (up to about 133x, radius about 0.66), go yellow to white, and fade in the last 20%. Smoke: `createSmokeParticle(pos, 0xaaaaaa, 0.1, 2.0)`.

Shells run 4 collision checks per frame: current position, then 25%, 50%, 75% between previous and current. Everything else runs 1, so a normal round moves 1.67 u per check at 60 Hz, and 10 u at the 100 ms clamp, where it can tunnel through enemies.

### Hit resolution summary

Hitboxes (L8205-8236): head sphere radius `0.45 * size` around the real head position, then body sphere radius `0.8 * size` around `y = 0.8 * size`.

| Round | Enemy hit | Headshot handling |
|---|---|---|
| Normal, pellet | Direct damage, consumed | x2 damage, +50, `registerHeadshot` |
| 30mm | Blast only on body hit | Immediate `takeDamage(99999)`, +50, `registerHeadshot`, decapitation, then blast |
| Rocket, Hellfire bullet | Blast only | **Ignored**: no x2, no +50, no SLOWMO progress |

Blast formula, shared by rockets and shells: `damage * (1 - distance/radius * 0.5)`, so 100% at centre and 50% at the edge. `distance` is measured to `enemy.position`, **the feet**.

Self-damage (rocket explosion only, L7896-7904): `damage * falloff * 0.5`. Shells and the sword finisher deal none. Berserk blocks all player damage.

---

## 5. Per-weapon sheets

All materials are `MeshBasicMaterial`. Vectors are local to the weapon group. Render order is 999, flash 1000, unless noted.

### 5.1 SMG (`smg`)

| Property | Value |
|---|---|
| Fire | Full auto, hold LMB. Perfect accuracy. 30 rounds last 1.5 s nominal |
| Sound | `shoot` |
| Flash | Sphere r0.1 yellow `0xffff00` at (0, 0.03, -0.55), 50 ms |
| Recoil | 0.02 rad up per shot, +/-0.01 rad yaw. Sustained fire settles near 0.09 rad (5.2 degrees) at 20 rounds/s |
| Reload | Drop 0-0.30 s, insert 0.30-0.70 s, rack 0.70-1.00 s |

| Part | Geometry | Colour | Position | Rotation |
|---|---|---|---|---|
| body | Box 0.12 x 0.2 x 0.5 | `0x666666` | 0, 0, 0 | |
| barrel | Cyl r0.03 h0.4 8-seg | `0x444444` | 0, 0.03, -0.35 | x = pi/2 |
| grip | Box 0.06 x 0.12 x 0.1 | `0x555555` | 0, -0.12, 0.15 | z = -0.1 |
| magazine | Box 0.05 x 0.1 x 0.08 | `0x777777` | 0, -0.1, 0.05 | |
| muzzleFlash | Sphere r0.1 8x8 | `0xffff00`, opacity 0 | 0, 0.03, -0.55 | |

### 5.2 SMG akimbo (`smgLeft`, Berserk only)

Identical parts, except grip rotation z = +0.1 and all render orders 1000. Shown only while `currentWeapon === 'smg' && berserkActive`.

| Property | Value |
|---|---|
| Mount | Hard-coded (-0.35, -0.25, -0.6), yaw +0.15 |
| Gameplay effect | **None.** No extra bullet, ammo use or sound |
| Flash | Fires with the right flash, same frame, 50 ms. No alternating fire |
| Reload | Magazine animates. Gun does not tilt or rack |
| Recoil, sway | None. Applied to `weaponGroup` only |

### 5.3 Shotgun (`shotgun`)

| Property | Value |
|---|---|
| Fire | Semi. Ammo cost is 1 per shot regardless of pellet count |
| Pellets | 6 base, 12 Blood Thirst, 18 Berserk, 36 both |
| Damage | 20 per pellet, 120 max. No range falloff |
| Sound | `shotgun` |
| Flash | Sphere r0.15 `0xffaa00` at (0, 0.05, -0.65), 50 ms |
| Recoil | 0.08 rad up, +/-0.04 rad yaw |
| Reload | Whole-magazine, not per-shell. Phases at 0.375 / 0.875 / 1.25 s |
| Specials | Headshot kill decapitates. Body kill under 10 u dismembers |

| Part | Geometry | Colour | Position | Rotation |
|---|---|---|---|---|
| body | Box 0.15 x 0.22 x 0.6 | `0x4a4a4a` | 0, 0, 0 | |
| barrel1 | Cyl r0.035 h0.5 8-seg | `0x333333` | -0.04, 0.05, -0.4 | x = pi/2 |
| barrel2 | Clone of barrel1 | `0x333333` | 0.04, 0.05, -0.4 | x = pi/2 |
| stock | Box 0.1 x 0.15 x 0.3 | `0x654321` | 0, -0.05, 0.35 | |
| grip | Box 0.07 x 0.14 x 0.12 | `0x555555` | 0, -0.14, 0.1 | z = -0.15 |
| pump (the "magazine") | Box 0.12 x 0.08 x 0.12 | `0x777777` | 0, -0.05, -0.2 | |
| muzzleFlash | Sphere r0.15 8x8 | `0xffaa00`, opacity 0 | 0, 0.05, -0.65 | |

### 5.4 Rocket launcher (`rocket`)

| Property | Value |
|---|---|
| Fire | Semi, 1-round mag. Needs a manual R after every shot, so cadence is 1.5 s plus input time |
| Damage | Blast only. `damage: 100` is commented "direct" but there is no direct component. Mean about 90-93 on a body hit `[sim]` |
| Blast | Radius 8, self-damage up to 50 |
| Sound | Fire `rocket`, impact `rocketExplosion` |
| Flash | Sphere r0.2 `0xff6600` at (0, 0, -0.75), 50 ms |
| Recoil | 0.12 rad up (6.9 degrees), +/-0.06 rad yaw |
| Reload | Phases at 0.45 / 1.05 / 1.5 s, animating the shoulder rest |

| Part | Geometry | Colour | Position | Rotation |
|---|---|---|---|---|
| tube | Cyl r0.08 h0.8 8-seg | `0x2a4d2a` | 0, 0, -0.2 | x = pi/2 |
| frontCone | Cone r0.1 h0.15 8-seg | `0x1a1a1a` | 0, 0, -0.65 | x = pi/2 (tip points back, flared mouth) |
| exhaust | Cyl r0.09/0.07 h0.2 8-seg | `0x333333` | 0, 0, 0.25 | x = pi/2 |
| grip | Box 0.06 x 0.12 x 0.1 | `0x444444` | 0, -0.14, 0 | |
| shoulder (the "magazine") | Box 0.15 x 0.08 x 0.2 | `0x555555` | 0, -0.06, 0.35 | |
| sight | Box 0.03 x 0.06 x 0.1 | `0xff0000` | 0, 0.11, -0.1 | |
| muzzleFlash | Sphere r0.2 8x8 | `0xff6600`, opacity 0 | 0, 0, -0.75 | |

### 5.5 Autocannon (`autoCannon`)

| Property | Value |
|---|---|
| Fire | Semi, click-limited, 0.15 s minimum. 5 shells empty in 0.6 s |
| Damage | 99999 x perk multiplier, delivered as blast. Enemies within radius 5 take at least 49,999 |
| Self-damage | None |
| Sound | Custom path, section 9 |
| Flash | Two-stage, section 7 |
| Recoil | 0.15 rad up (8.6 degrees), +/-0.075 rad yaw. Largest in the game. Clicking at the limit reaches about 0.28 rad (16 degrees) |
| Zoom | RMB toggle, section 8 |
| Reload | Phases at 0.30 / 0.70 / 1.0 s |
| Specials | Headshot kill decapitates. Blast kills dismember with force 5 |

| Part | Geometry | Colour | Position | Rotation |
|---|---|---|---|---|
| barrel | Cyl r0.15 h2.5 8-seg | `0x2a2a2a` | 0, 0, -1.25 | x = pi/2 |
| brake | Box 0.5 x 0.3 x 0.1 | `0x1a1a1a` | 0, 0, -2.5 | |
| receiver | Box 0.28 x 0.5 x 0.3 | `0x3a3a3a` | 0, -0.1, 0 | |
| scope | Cyl r0.08 h0.6 6-seg | `0x1a1a1a` | 0, 0.3, -0.3 | x = pi/2 |
| scopeMount | Box 0.12 x 0.05 x 0.4 | `0x2a2a2a` | 0, 0.17, -0.3 | |
| bipod1 | Cyl r0.02 h0.5 4-seg | `0x2a2a2a` | -0.15, -0.4, -1.0 | z = 0.3 |
| bipod2 | Same geometry | `0x2a2a2a` | 0.15, -0.4, -1.0 | z = -0.3 |
| magazine | Box 0.1 x 0.3 x 0.2 | `0x2a2a2a` | 0, -0.35, 0.3 | |
| muzzleFlash | Cyl top r0.5, bottom r0.125, h1.0, 8-seg | `0xffaa00`, opacity 0 | 0, 0, -3.3 | x = pi/2 |

Render order is not set on this model (default 0). The authored group position `(0.7, -0.5, -1.2)`, yaw `-0.1` is dead: the model actually sits at the common mount, with its muzzle brake about 3.1 u ahead of the camera.

### 5.6 Sword (`sword`)

Hit logic is in L4795-4984, outside the assigned slice, and is summarised here. Swing curves are in the slice.

| Attack | Input | Duration | Damage | Reach | Sounds |
|---|---|---|---|---|---|
| combo1 downChop | LMB | 0.25 s | 75 | 5 u, 120 degrees | `swordSwing` |
| combo2 diagonal | Next LMB | 0.30 s | 93.75 (x1.25) | same | `swordSwing` |
| combo3 sweep | Next LMB | 0.35 s | 112.5 (x1.5) | same | `swordSwing` + `swordHit2` |
| Area attack | Hold then release RMB | 0.4 s swing, wind-up 0.3 s | 100 | 8 u, 160 degrees | `swordSwing` |
| Heavy finisher | RMB buffered during combo2 or combo3 | 0.35 s | 250 blast, radius 8, falloff to 125 | Ground point 3 u ahead | `swordSwing` + `swordSlam`, then `rocketExplosion` at 200 ms |

- Combo cycle is 0.9 s for 281.25 single-target damage, or 312.5 DPS, and cleaves everything in the arc.
- Combo window: 0.7 s since the last attack start. The counter advances at swing end.
- Buffer opens at 70% swing progress (`canCombo`). LMB is level-sensitive, so **holding LMB auto-chains the combo** past the semi-auto latch.
- **Damage lands on swing start, not contact.** All enemies in the arc are hit on the click frame. The finisher is the exception at 200 ms.
- Hit stack: `swordHit1` + `swordHit2` + `enemyHit`, 15 particles `0xff4444`, 10% `enemyGrunt`, shake 0.01 if anything was hit.
- Kill stack: `enemyDie`, 1/6 `enemyDeathGrunt`, dismember if damage is 100 or more (combo3, or any light hit under Blood Thirst), `registerKill` and `registerSwordKill`.
- Area hit stack: the same three hit sounds, 25 particles `0xff4444`. A kill adds 30 particles `0xff0000` at `enemy.position`. Shake 0.15 applies whether or not anything was hit.
- Blood Thirst doubles light and area damage but not the finisher.

| Part | Geometry | Colour | Position |
|---|---|---|---|
| blade | Box 0.02 x 1.0 x 0.08, DoubleSide | `0xc0c0c0` | 0, 0.5, 0 |
| edge | Box 0.01 x 1.0 x 0.04 | `0xe0e0e0` | 0, 0.5, 0 |
| hilt | Cyl r0.02 h0.2 8-seg | `0x8b4513` | 0, -0.05, 0 |
| guard | Box 0.03 x 0.03 x 0.25 | `0x696969` | 0, 0.05, 0 |
| pommel | Sphere r0.04 8x8 | `0x8b4513` | 0, -0.15, 0 |

Swing offsets, added to the mount. `s = sin(pi * progress)`, peak at 50% of the swing.

| Attack | rot x | rot y | rot z | pos x | pos y | pos z |
|---|---|---|---|---|---|---|
| combo1 | -1.4s | 0 | 0.15s | -0.5s | -0.6s | -0.9s |
| combo2 | 1.2s - 0.6 | 0.8s | -0.3s | 0.6s - 0.5 | 0.5s - 0.3 | -0.7s |
| combo3 | -0.8s | 2.0(s - 0.5) | 0.3s | -0.7s | -0.2s | -1.0s |
| upSlash (dead) | 1.5s - 0.7 | 0 | 0 | -0.2s | 0.7s - 0.4 | -0.6s |
| leftSlash (dead) | -0.5 | -1.2s | -0.4s | -0.8s | -0.1 | -0.7s |
| rightSlash (dead) | -0.5 | 1.2s | 0.4s | 0.8s - 0.3 | -0.1 | -0.7s |

Heavy finisher, by progress `p`:

| Phase | rot x | rot z | pos x | pos y | pos z |
|---|---|---|---|---|---|
| p < 0.2, `c = min(3p, 1)` | 0.8c | 0.2c | -0.2c | 0.5c | 0.2c |
| p >= 0.2, `m = (p - 0.2) * 1.25` | 0.8 - 2.5m | 0.2 - 0.3m | -0.2 - 0.5m | 0.5 - 1.2m | 0.2 - 1.4m |

Wind-up, linear with `w` over 0.3 s, held at full: rot (0.3w, -0.8w, 0.6w), pos (0.4w, 0.2w, 0.1w).

Area swing, by progress `p` over 0.4 s:

| Phase | Values |
|---|---|
| p < 0.2, `t = p / 0.2` | rot x `0.3(1-t)`, rot y `-0.8(1-0.5t)`, rot z `0.6 + (-pi/2 - 0.6)t`; pos x `0.4(1-0.5t)`, pos y `0.2(1-t) - 0.05`, pos z `0.1 - 0.3t` |
| p >= 0.2, `q = (p-0.2)/0.8` | rot x 0, rot y `-0.8 + 2*pi*q`, rot z `-pi/2`; pos x `0.2 - 1.7q`, pos y -0.1, pos z `-0.4 - 0.2*sin(pi*p)` |

### 5.7 Walkie-talkies (`walkieTalkie`, `warthogStrike`)

The two models differ only in button colour: `0xff0000` airstrike, `0x00ff00` Warthog.

| Part | Geometry | Colour | Position | Rotation |
|---|---|---|---|---|
| body | Box 0.08 x 0.15 x 0.04 | `0x333333` | 0, 0, 0 | |
| antenna | Cyl r0.005 h0.12 4-seg | `0x666666` | 0.02, 0.1, 0 | |
| screen | Box 0.06 x 0.08 x 0.001 | `0x222222` | 0, 0, 0.021 | |
| button | Cyl r0.01 h0.005 6-seg | red or green | 0, -0.04, 0.025 | x = pi/2 |

No flash, no magazine, no recoil, no render order. HUD shows `READY` and `-`. The authored position `(0.3, -0.3, -0.5)`, yaw `-0.3` is dead.

Availability comes from `player.airstrikeAvailable` / `warthogStrikeAvailable`, not `currentAmmo`. Unlock: 8-kill and 12-kill combos respectively, with at most 5 s between kills. Cooldowns are 30 s and 45 s.

Airstrike timeline from the confirming click (L6566-6696):

| t (s) | Event |
|---|---|
| 0 | `walkieTalkieFire`. Cooldown starts. Auto-switch to SMG. Ring r4.5-5 `0xff6600` at y 0.1, opacity `0.4 + sin(Date.now()*0.005)*0.4` |
| 3.0 | `airstrikeActivate` |
| 4.0-5.4 | 15 rockets, 100 ms apart. Random point within r12, y 30-35, speed 50, damage 100, blast 6, about +/-0.05 lateral drift |
| about 4.6 | First rocket lands (0.6-0.7 s flight) |
| 6.0 | Ring removed. The code comment says 5 s |
| 6.5 | Hellfire missile at exact centre, y 35, speed 60, damage 99999, blast 20 |
| about 7.08 | Missile lands. Full Hellfire explosion, instakill radius 20 |

Warthog timeline from the confirming click (L6737-6892):

| t (s) | Event |
|---|---|
| 0 | `walkieTalkieFire`. Cooldown starts. Auto-switch to SMG. Corridor marker 40 x 3 `0x00ff00`, opacity `0.2 + sin(t*8)*0.15` |
| 2.0 | `airstrikeActivate`. Marker pulse stops |
| 4.0-6.45 | 50 shells, 50 ms apart, each plays `30mmshell_flyby`. Damage 150, blast 5, speed 200 |
| about 4.27-6.72 | Impacts, 0.27 s flight. Each is a full shell explosion |
| 6.5 | `warthog_flyby` at 2x volume |
| 8.5 | Marker removed |

Shell geometry: 40 u corridor perpendicular to facing, lateral scatter +/-1.5, spawn at y 50 and 20 u back along the corridor. Approach is 68.2 degrees from horizontal, not the 45 in the comments. Any shell headshot uses the 99999 path.

`[analysis]` Having the flyby start after the shells land mimics the real A-10 effect, where the sound arrives after the impacts. The comment shows it was deliberately retimed from 2500 to 4500 ms. This delay is worth preserving.

---

## 6. Viewmodel system

Weapon groups are children of the **scene**, not the camera, and are repositioned each frame:

```js
offset = weaponOffset + swingOffset.position   // weaponOffset = (0.35, -0.25, -0.6)
offset.applyQuaternion(camera.quaternion)
weaponGroup.position = camera.position + offset
weaponGroup.rotation = camera.rotation         // Euler.copy keeps 'YXZ' [r128]
weaponGroup.rotation.x += swing.x + sway.y + recoil.y
weaponGroup.rotation.y += -0.15 + swing.y + sway.x + recoil.x
weaponGroup.rotation.z += swing.z
```

Camera: FOV 75, near 0.1, far 1000. There is no separate viewmodel pass, so depth test is on and guns can clip into walls and enemies. `renderOrder` 999 does not prevent that. There are no hand or arm models.

| Motion | Status | Detail |
|---|---|---|
| Bob | **Not implemented** | No bob on weapon or camera. The only bob in the file is on pickups |
| Sway | **Dead** | Code present, input always 0 (section 13) |
| Recoil | Works | Rotation only, section below |
| Reload | Works, SMG-specific | Section below |
| Swap | **Not implemented** | Instant visibility toggle, no sound, no draw time |
| Slide tilt | Inherited | Copied from camera roll |

Sway as coded: `sway += mouseDelta * 0.002`, then `sway *= 0.95` per frame.

### Recoil

Per shot: `recoil.y += amount` (muzzle up), `recoil.x += (rand - 0.5) * amount` (yaw). Decay `*= 0.92` per frame. No positional kickback. Pivot is the group origin. Not reset on swap.

| Weapon | Impulse rad (degrees) | Steady peak `[sim]` |
|---|---|---|
| SMG | 0.02 (1.15) | 0.090 (5.2) at 20/s, 0.071 (4.0) at 15/s |
| Shotgun | 0.08 (4.58) | 0.103 (5.9) |
| Rocket | 0.12 (6.88) | single shot |
| Autocannon | 0.15 (8.59) | 0.284 (16.3) |

Half-life is 8.3 frames: 139 ms at 60 Hz, 58 ms at 144 Hz.

### Reload (L4088-4150)

`p = elapsed / reloadTime`. Same animation for all guns.

| Phase | p range | `magazine.position.y` | Viewmodel |
|---|---|---|---|
| Drop | 0-0.3 | `-0.1 - 0.25 * (p/0.3)` | Tilt up, `rot.x += 0.2 * (p/0.3)` |
| Insert | 0.3-0.7 | `-0.35 + 0.25 * ((p-0.3)/0.4)` | Tilt returns, `rot.x += 0.2 * (1 - phase)` |
| Rack | 0.7-1.0 | `-0.1` | `weaponOffset.z = -0.6 + sin(pi * phase) * 0.1`, pulls toward camera |
| Done | p >= 1 | `-0.1` | `finishReload()`, z back to -0.6 |

The same mesh travels down and up. No magazine detaches. Reload sound is always `reload`. HUD shows `RELOADING...`. Partial and empty reloads take the same time, and a reload cannot start with zero reserve. **There is no auto-reload** and no dry-fire feedback. Only the R key calls `startReload`.

### Swap (`switchWeapon`, L3749-3798)

Instant, in this order: hide all models, show the new one, rebind `magazine` and `muzzleFlash`, cancel reload, clear zoom, cancel sword state, reset `weaponOffset` and `swingOffset`, update HUD. Key binds are 1-5, X, Z. There is no scroll-wheel switching, no previous-weapon key, and no block on swapping to an empty weapon.

---

## 7. Muzzle FX

All flashes are hard on/off meshes with no fade, parented to the weapon. No lights, no smoke, no shell casings. The particle muzzle flash is disabled (call commented out at L8367-8369).

| Weapon | Mesh | t = 0 | Later |
|---|---|---|---|
| SMG, left SMG | Sphere r0.1 `0xffff00` | Opacity 1 | 50 ms: opacity 0 |
| Shotgun | Sphere r0.15 `0xffaa00` | Opacity 1 | 50 ms: opacity 0 |
| Rocket | Sphere r0.2 `0xff6600` | Opacity 1 | 50 ms: opacity 0 |
| Autocannon | Cone, r0.5 to r0.125, h1.0 | Opacity 1, scale 1.25, `0xffaa00` | 50 ms: scale 0.625, opacity 0.7, `0xffff00`. 100 ms: opacity 0, scale 1, `0xffaa00` |

The autocannon cone's wide end faces the gun at z = -2.8 and its narrow end points away at z = -3.8 `[r128]`, leaving a gap in front of the brake (front face z = -2.55). At scale 1.25 the wide end is at z = -2.675.

`[analysis]` At SMG cadence the 50 ms off-timer and the next shot land at nearly the same moment, so the flash is close to continuous and whether it flickers depends on frame timing.

---

## 8. Zoom (autocannon only)

| Property | Value |
|---|---|
| Input | RMB rising edge toggles (`zoomTogglePressed`), only while holding the autocannon |
| FOV | 75 to 30, instant, no transition |
| Actual magnification | 2.86x. The comment says 2.5x |
| Sound | `autocannon_zoom` on both zoom in and zoom out |
| Clearing | `switchWeapon` only |
| Sensitivity | Unchanged at 0.002, so it feels 2.86x faster on screen |
| Viewmodel | **Stays visible**, never hidden while scoped |
| Firing, reload | Both allowed while scoped |

Scope overlay (`createScopeOverlay`, L5073), a fixed DOM layer at z-index 999:

| Element | Style |
|---|---|
| Crosshair box | 200 x 200 px, centred |
| Lines | 2 px, `rgba(255,0,0,0.7)` |
| Centre dot | 4 px round, `rgba(255,0,0,0.9)` |
| Vignette | `radial-gradient(circle, transparent 30%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0.8) 100%)` |

There is no scope mask. The normal HUD crosshair stays visible under the overlay.

---

## 9. Sound

Each sound has 4 round-robin `Audio` instances. Actual volume is `base * 0.5` (master). Fired through `audioManager.play` unless noted. A fifth overlapping play restarts the oldest instance.

| Event | Sound key | File | Base | Actual |
|---|---|---|---|---|
| SMG fire | `shoot` | `smg_fire.mp3` | 0.3 | 0.15 |
| Shotgun fire | `shotgun` | `shotgun_fire.mp3` | 0.32 | 0.16 |
| Rocket fire | `rocket` | `rocket_fire.mp3` | 0.4 | 0.2 |
| Autocannon layer 1 | `autocannon_fire` | `autocannon_fire.mp3` | 1.05 | 0.525 |
| Autocannon layer 2 | `autocannon_fire2` | `autocannon_fire2.wav` | 0.79 | 0.395 |
| Autocannon scope | `autocannon_zoom` | `autocannon_zoom.wav` | 0.7 | 0.35 |
| Reload, all guns | `reload` | `smg_reload.mp3` | 0.4 | 0.2 |
| Sword swing | `swordSwing` | `sword_swing.mp3` | 0.5 | 0.25 |
| Sword hit | `swordHit1`, `swordHit2` | `sword_hit1.mp3`, `sword_hit2.mp3` | 0.6 | 0.3 |
| Finisher | `swordSlam` | `sword_slam.mp3` | 0.7 | 0.35 |
| Rocket impact | `rocketExplosion` | `rocket_explosion.mp3` | 0.5 | 0.25 |
| Hellfire bullet impact | `hellfireBulletExplode` | `hellfirebullet_explode.mp3` | 0.5 | 0.25 |
| Hellfire rocket impact | `hellfireRocketExplode` | `hellfirerocket_explode.mp3` | 1.4 | 0.7 |
| Shell impact | `30mmshell_explode` | `30mmshell_explode.mp3` | 1.6 | 0.8 |
| Shell flyby | `30mmshell_flyby` | `30mmshell_flyby.mp3` | 0.5 | 0.25 |
| Blood Thirst layer | `bloodthirstyShot` | `bloodthirsty_shot.mp3` | 1.0 | 0.5 |
| Berserk layer | `berserkShot` | `berserk_shot.mp3` | 0.7 | 0.35 |
| Hellfire layer | `hellfireShot` | `hellfire_shot.mp3` | 0.6 | 0.3 |
| Strike radio | `walkieTalkieFire` | `walkietalkie_fire.mp3` | 0.7 | 0.35 |
| Strike confirm | `airstrikeActivate` | `airstrike_activate.mp3` | 1.0 | 0.5 |
| Warthog jet | `warthog_flyby` | `warthog_flyby.wav` | 0.8 | 0.8 (instances boosted 2x just before playing) |

Autocannon audio bypasses `play()` (L4372-4402): `autocannon_fire` is cut at 500 ms by `pause()` and rewind, and `autocannon_fire2` plays in full on top. The cut is real time, so in SLOWMO only about the first 125 ms of the sample is heard.

---

## 10. Screen shake

`addScreenShake(I)` (L4456) sets `intensity = I`, `duration = 50` ms. It **replaces** any active shake.

Each frame in `update()`: `duration -= scaledDt * 1000`. If still above 0, `shakeX` and `shakeY` are drawn from `(rand - 0.5) * I`, added to `camera.rotation.z` (roll) and `.x` (pitch). A 16 ms `setTimeout` subtracts them again. Yaw is never touched. Amplitude is `+/- I/2` radians, with no falloff during the shake and no distance scaling.

| Source | Intensity | Amplitude (degrees) | Duration |
|---|---|---|---|
| SMG fire | 0.004 | +/-0.11 | 50 ms |
| Sword hit | 0.01 | +/-0.29 | 50 ms |
| Shotgun fire | 0.02 | +/-0.57 | 50 ms |
| Autocannon fire | 0.03 | +/-0.86 | 50 ms |
| 30mm explosion | 0.03 | +/-0.86 | 50 ms |
| Rocket fire | 0.04 | +/-1.15 | 50 ms |
| Rocket or Hellfire **bullet** explosion | 0.06 | +/-1.72 | 50 ms |
| Sword area attack (even on a miss) | 0.15 | +/-4.30 | 50 ms |
| Heavy finisher | 0.15 | +/-4.30 | 50 ms |
| Hellfire rocket explosion | 0.24 | +/-6.88 | 100 ms |

Shaken frames `[sim]`: 50 ms is 2 frames at 60 Hz, 5 at 120 Hz, 7 at 144 Hz, and 12 under SLOWMO at 60 Hz. 100 ms is 5 at 60 Hz.

The camera's pitch offset affects the frame's shot because `shoot` reads the shaken quaternion, so shake adds small real pitch dispersion.

---

## 11. Perks that modify firing

| Perk | Trigger | Duration |
|---|---|---|
| Blood Thirst | 4 kills in 5 s | 10 s |
| Hellfire | 10 kills in 10 s | 5 s |
| Berserk | 15-kill combo, gaps at most 5 s | 10 s |

| Weapon | Blood Thirst | Hellfire | Berserk |
|---|---|---|---|
| All guns | Mags refilled on activation, no ammo use, HUD shows infinity, damage x2, layer sound | Layer sound | Layer sound. Player immune to all damage, +15% speed |
| SMG | 50 per bullet | Explosive, radius 2, base 31.25, rocket mesh | Rate x0.75 interval, left gun visual |
| Shotgun | 12 pellets of 40 | Each pellet explosive, radius 2, base 25 | 18 pellets |
| Rocket | Damage 200, cadence 0.5 s since reload is unnecessary | Radius 20, instakill vs enemies, massive FX | Interval 0.25 s. Only matters with Blood Thirst, since otherwise reload gates it |
| Autocannon | No ammo use | **No projectile effect**, layer sound still plays | **No rate change**, layer sound still plays |
| Sword | x2 light and area, not finisher | None | None |
| Strikes | None | None | None |

Stacked example: Blood Thirst + Berserk + Hellfire shotgun fires 36 explosive pellets of base 50 (20 x 2 x 1.25) per trigger pull, with no ammo use, and plays 4 sounds.

Stacked SMG plays 4 sounds per shot: `shoot`, `bloodthirstyShot`, `berserkShot`, `hellfireShot`.

**Hellfire bullets are usually weaker per hit than normal rounds at range.** They have no direct damage and no headshot bonus, and the radius-2 blast is measured to the enemy's feet. `[sim]` at 15 u, 60 Hz, mean per-hit damage:

| Enemy size | Aim at torso | Aim at head | Zero-damage hits, aiming at head |
|---|---|---|---|
| 1.5 | 23.5 | 18.7 | 0% |
| 1.8 | 23.0 | 16.7 | 9% |
| 2.25 | 22.1 | 12.7 | 29% |

Normal SMG deals 25 body, 50 head. Hellfire's value is splash, not single-target damage.

---

## 12. Event stacks: what fires, in what order

### Any gun, trigger pull

| When | What |
|---|---|
| Frame N | Ammo decrement and HUD update, flash on, fire sound and perk layers, projectile spawned and stepped |
| Frame N+1 | Viewmodel recoil visible, first shake frame |
| Frame N+2 | Second shake frame |
| +50 ms | Flash off, shake ends |
| +140 ms | Recoil at half (60 Hz) |

### Normal round headshot kill, one frame, in order (L8330-8433)

1. Damage x2.
2. `createExplosion(hit, 0xffff00, 20)`.
3. `enemyHeadshot` (0.75) + `enemyHeadshot2` (0.5625) + `enemyHeadshot3` (0.75, playback starts 1.0 s into the file).
4. Blood jet only if the hit is non-lethal.
5. +50 score, `HEADSHOT! +50`.
6. `registerHeadshot`. The third in 3 s starts SLOWMO: `timeScale` 0.25 and audio rate 0.25 for 5 s.
7. `takeDamage` runs ragdoll via `destroy()`.
8. `enemyDie` (0.5), 1/6 `enemyDeathGrunt` (0.5).
9. Shotgun: head hidden, `createHeadRemoval`. Other weapons: `createDismemberment(type 'headshot')`.
10. Score, kill count, `registerKill` (perk checks), `Enemy eliminated +N`.
11. 30% pickup, 50/50 health or ammo.

There is **no** hit-stop, hitmarker, camera effect or weapon reaction on a hit. The weight comes from three layered samples plus gore and the kill text. The crosshair is static.

Body hit: `createExplosion(hit, 0xff4444, 15)`, `enemyHit` (0.4), 10% `enemyGrunt`.

Miss on ground or wall: `createExplosion(pos, 0x888888, 8)`, `bulletHit` (random of 4, base 0.3).

### Rocket

| When | What |
|---|---|
| Fire | Sound, flash r0.2 for 50 ms, recoil 0.12, shake 0.04 |
| Flight | 40 u/s, grey smoke every 60 ms |
| Impact | `rocketExplosion`. Particles: 50 `0xff6600`, 30 `0xffaa00`. Shockwave: white wireframe sphere, opacity 0.25, 120 u/s to size 15, 0.1 s. Shake 0.06 |
| Per enemy in radius | `enemyHit`, 10 `0xff4444` particles |
| Per kill | `enemyDie`, `destroy(10, pos)` dismember, `enemyExplode` if flagged, score, 30% pickup |
| Player in radius | Self-damage, up to 50 |

Hellfire rocket impact: `rocketExplosion` + `hellfireRocketExplode`. Particles 120 `0xffff00`, 100 `0xffaa00`, 80 `0xff6600`, 60 `0xff0000`, with size x2.5, speed x1.8, life x1.5. Shockwave 200 u/s to size 60, 0.15 s. Shake 0.24 for 100 ms. Enemy blast damage 99999.

Hellfire bullet impact: `hellfireBulletExplode`. Particles 12 `0xff6600`, 8 `0xffaa00`. No shockwave. Shake 0.06.

### Autocannon

| When | What |
|---|---|
| Fire | Two sound layers, cone flash 1.25, recoil 0.15, shake 0.03 |
| +50 ms | Flash 0.625, yellow, opacity 0.7 |
| +100 ms | Flash off |
| Flight | 200 u/s, white cone, rings, smoke |
| Impact | `30mmshell_explode` (loudest sound in the game). Particles 25 `0xffff00`, 15 `0xffaa00`. 20 sparks `0xffff00`, velocity +/-10 xz, 0-10 y, gravity -20, life 0.5. Shockwave 60 u/s to size 7.5. Shake 0.03 |
| Per enemy in radius | `enemyHit`, 10 red particles, on kill `enemyDie` and `destroy(5, pos)` |

On a headshot, the headshot stack runs first (three headshot samples, 20 yellow particles, +50, decapitation), then the blast.

### Heavy finisher

| When | What |
|---|---|
| t = 0 | `swordSwing` + `swordSlam`, raise-then-slam animation |
| 200 ms | `rocketExplosion`, 60 `0xffffff` + 40 `0xcccccc` + 30 `0x888888` particles, 30 white sparks (+/-15 xz, 0-20 y), shockwave, shake 0.15 |
| Per enemy, radius 8 | `enemyHit`, 10 red particles, damage 250 falling to 125 |
| Per kill | `enemyDie`, `destroy(10, pos)`, **double score**, `HEAVY FINISHER! +N`, sword-kill credit, 30% pickup |

### Why it feels good `[analysis]`

- **Zero-delay feedback.** Flash, sound and projectile all land on the click frame, and melee damage lands instantly.
- **Big gun motion, no aim penalty.** Recoil is exaggerated on the viewmodel but never moves the aim, so weapons feel violent while staying precise. This suits the "overpowered" fantasy.
- **Snap, not rumble.** Two-frame shake reads as a punch rather than camera wobble, and intensity spans 60x from SMG to Hellfire rocket.
- **Fast settling.** The 139 ms recoil half-life returns the gun quickly, so each shot reads separately.
- **Tempo.** Comments show fire rates and reloads were deliberately halved from earlier values.
- **Layered audio as reward.** Each active perk adds an audible layer to every shot, so power is heard continuously. Headshots stack three samples.
- **Escalation.** Perks change a weapon's character, for example 6 to 36 pellets, or a rocket blast from 8 to 20.
- **Anticipation on strikes.** Radio call, 3 s wait, confirm, barrage, 1 s pause, finale. Delay is what makes the payoff land.

---

## 13. Broken, janky, half-finished

### High impact

| # | Issue | Why it fails | Lines |
|---|---|---|---|
| 1 | Weapon sway never happens | `Player.handleMouseLook` resets the delta before `weaponSystem.update` reads it in the same synchronous frame. Also dead in `fps-game.html`, where `getMouseDelta` self-resets and the player reads first | 5398, 4041 |
| 2 | Directional sword attacks unreachable | Same cause. `directionalInput` is never set, so `upSlash`, `leftSlash`, `rightSlash` never run | 8096, 4832 |
| 3 | Strike targeting skipped | `shoot` starts targeting on frame N. On frame N+1 the still-held button confirms it. Only a click under one frame enters real targeting. The preview shape is effectively never seen | 4207, 8046-8064 |
| 4 | Strike at sky goes to world origin | `intersectPlane` returns null, but `targetPoint` is always truthy and remains (0,0,0) `[r128]` | 8059-8061, 8076-8078 |
| 5 | Autocannon throws every shot | `material.emissive` is undefined on `MeshBasicMaterial`, so `.setHex` throws in both timers `[r128]`. Effects still display because colour and opacity are set first. `emissiveIntensity = 2` is skipped | 3616, 4254, 4265 |
| 6 | `onWaveComplete` does not exist | A shell explosion with zero enemies left throws from `updateGame`. The rest of that frame's update and render are skipped (`requestAnimationFrame` was already queued, so the game continues), and the bullet stays in `pool.active`, already marked inactive, until the next `releaseAll`. Can happen firing between waves or when killing the last enemy | 7786, 8315, 8455, 8488 |
| 7 | Autocannon balance | Instakill radius 5 from any impact, 400 RPM, no self-damage, 1 reserve per shell. Comment says "direct hit". Body hits have no direct path | 3096, 7747 |
| 8 | Airstrike finale can kill the player | Damage 99999 reaches the self-damage formula: at least 24,999 within radius 20, unless Berserk | 6676, 7899-7903 |
| 9 | Shotgun spread depends on compass direction | Noise is added to world X and Y. Facing +/-X gives 0 degrees of yaw spread, a vertical line. Facing -Z gives 2.86 degrees `[r128]` | 4313-4317 |
| 10 | Viewmodel placement is dead | `weaponGroup.position` and `.rotation` are overwritten each frame. Lost placements: autocannon "heavy weapon feel", sword angle, walkie hand position | 3546, 3628, 3686, 3737, 4006 |
| 11 | Reload animation assumes SMG magazine | Hard-coded y values. See table below | 4096-4146 |
| 12 | Zoom conflicts with speed FOV | `updateCamera` writes `camera.fov = currentFOV` whenever `currentFOV` differs from `targetFOV`, for example during a slide. Scoping while FOV is settling loses the zoom | 5814-5817 |
| 13 | Zoom survives death and restart | `clearZoom` is only called from `switchWeapon`. FOV 30 and the overlay persist | 3770 |

Reload animation effect per weapon:

| Weapon | Part | Rest y | After first reload | Result |
|---|---|---|---|---|
| SMG | magazine | -0.10 | -0.10 | Correct |
| Shotgun | pump | -0.05 | -0.10 | Permanent 0.05 drop |
| Rocket | shoulder rest | -0.06 | -0.10 | Permanent 0.04 drop |
| Autocannon | magazine | -0.35 | -0.10 | Snaps up, stays 0.25 too high |

### Medium impact

| # | Issue | Why it fails | Lines |
|---|---|---|---|
| 14 | Swap bypasses cooldown | `lastShotTime` is global while the rate comes from the current weapon | 4186, 4229 |
| 15 | Muzzle flash stuck after fast swap | Timers read `this.muzzleFlash` when they fire. Swap within 50 ms and the old flash stays lit, seen again on return until that weapon fires. Within 100 ms of an autocannon shot, the new weapon's flash also gets its colour and scale changed | 4250, 4261, 4271 |
| 16 | Shakes replace each other | `addScreenShake` overwrites. An SMG shot (0.004) right after a Hellfire blast (0.24) cancels it | 4461-4462 |
| 17 | Hellfire bullets break expectations | Rocket mesh, no head bonus, no headshot credit, weaker per hit (section 11), self-damage risk, and a 0.06 shake per impact, 15x the SMG's own shake. The guide says "Instakill", which is only true for rockets | 4343-4349, 7836, 8321 |
| 18 | Non-queued sword kills never drop pickups | `shoot` passes `GameManager`, so `gameInstance` is null. Queued attacks pass `FPSGame` and do drop | 4807-4810, 4962, 8089, 8114 |
| 19 | Area attack has no charge requirement | Tapping RMB delivers the full 100 damage at release. Only gated by 0.4 s swing. It always kills, since max HP is 100 | 8135-8139, 4702 |
| 20 | Area knockback is a teleport with vertical component | `enemy.position += toEnemy * 10`, where `toEnemy` points down toward the feet. The mesh does not follow a dead enemy, so the death burst and pickup appear about 10 u away, possibly below ground. A pickup below ground may be uncollectable (2 u radius) | 4736-4737, 4769, 4779 |
| 21 | Cancelled reload leaves magazine displaced | `switchWeapon` does not restore it. Also, if Berserk ends mid-reload the left magazine stays displaced | 3765, 4100 |
| 22 | `startGame` is an incomplete reset | Resets SMG, shotgun, rocket and reserve only. Not autocannon ammo, current weapon, zoom, perks or strike availability | 7450-7453 |
| 23 | Frame-rate dependence | Recoil and sway decay per frame. Shake frame count varies. Fire rate quantises | 4047-4052 |
| 24 | Akimbo is cosmetic | No extra output. Left gun has no recoil and does not follow the rack | 4015-4037, 4079 |
| 25 | Warthog preview 90 degrees off | Preview long axis follows facing, while the real corridor is perpendicular `[r128]`. The post-click marker is correct | 8024 vs 6800 |
| 26 | Airstrike visuals disagree | Preview ring r11.5-12, post-click ring r4.5-5, real scatter r12 | 7961, 6599, 6632 |
| 27 | Scoped view keeps the gun on screen | `toggleZoom` never hides the viewmodel | 5043-5071 |
| 28 | Pause "R to restart" does nothing | Nested check `state === PAUSED` inside `state === PLAYING` can never pass | 7366-7368 |

### Low impact or dead code

| # | Item | Lines |
|---|---|---|
| 29 | `walkieTalkie.fireRate` is commented "not relevant" but blocks use for up to 1 s after the last shot | 3083, 4186 |
| 30 | `cancelAirstrikeTargeting`, `cancelWarthogStrikeTargeting` never called. Swapping does not cancel targeting | 6550, 6721 |
| 31 | `ParticleSystem.createMuzzleFlash` unused | 1428, 8367 |
| 32 | `shellGlow` referenced but never created | 1001, 8306 |
| 33 | Sword `edge` mesh sits fully inside `blade`, so it is not visible apart from possible end-cap z-fighting | 3654 |
| 34 | `swordCombo.inputBufferTime`, `heavyFinisherReady`, `swordAnimations[].type`, initial `swingDuration`, `WeaponSystem.currentFOV`, `screenShake.x/y` unused | 3149, 3164, 3176, 3178 |
| 35 | `heavyFinisher` branches in `performMeleeAttack` unreachable | 4852, 4901 |
| 36 | `canCombo` is not cleared on chain, so after the first chain the buffer spans the whole swing rather than the last 30% | 3881-3887 |
| 37 | Finisher comment says combo resets, but the swing-end increment leaves `count` at 1 | 3878, 3891 |
| 38 | Pops in swing curves. combo2 and combo3 start and end at non-zero offsets. Finisher jumps at p = 0.2 (`charge` peaks at 0.6, slam starts from 1.0). Area swing jumps at 20%. All attacks snap at the end | 3844-3860, 3974-3992 |
| 39 | Finisher applies no Blood Thirst multiplier | 4559 |
| 40 | `isSemiAuto` limiter duplicates `lastShotTime`, using a second clock | 4168-4174 |
| 41 | Blood Thirst's ammo bypass in `canShoot` is redundant, since mags are filled on activation | 4185, 4469 |
| 42 | `activateBloodThirst` also sets walkie and Warthog `currentAmmo` to 1. Harmless, because the key binds gate on availability flags | 4469 |
| 43 | Sword HUD colour computes 0/0 = NaN and falls through to green | 5024 |
| 44 | Melee angle uses camera-to-feet vector. Looking level, a target under 1.04 u horizontally is outside the 60 degree half-arc. Enemies hold 13-15 u, so this is rare | 4876-4879 |
| 45 | Warthog flyby boost permanently overwrites instance volumes. Harmless, since this is the only call site | 6830-6832 |
| 46 | Bullet kills and explosive kills call `destroy()` twice (`takeDamage`, then explicitly). Details belong in the enemy spec | 8369, 8430, 7861, 7874 |
| 47 | `perk_slowmo` is meant to stay at rate 1.0, but `setGlobalPlaybackRate(0.25)` runs right after it and sets all instances | 595, 6351 |

### Documentation drift

`README.md` describes the 4-weapon build and is wrong in several places. Treat code as the source of truth.

| README claim | Code |
|---|---|
| "Assault Rifle" | SMG |
| Key 4 = Sword | 4 = Autocannon, 5 = Sword |
| Blood Thirst: 5-kill streak, rapid-fire | 4 kills in 5 s, x2 damage, no fire-rate change |
| Hellfire: +25% blast damage and radius | Rocket radius x2.5, bullets x1.25 damage |
| Berserk: 3x fire rate, 5x damage, unlimited ammo, 2x speed | SMG x1.33 and rocket x2 nominal rate, 3x pellets, no damage change, no ammo effect, +15% speed |
| Adrenaline: doubles speed | +10% per stack, up to 3 stacks |

The in-game guide (L407-472) is closer but still says Hellfire is "Instakill damage" for all bullets.

---

## 14. Ammo and HUD

| Item | Value |
|---|---|
| Reload transfer | `min(maxAmmo - currentAmmo, reserveAmmo)` |
| Ammo pickup | +30 reserve, clamped to 120 |
| Kill drop | 30% chance, 50/50 health or ammo, so 15% ammo per eligible kill |
| Reserve value | 90 reserve is 3 SMG mags, or 15 shotgun mags, or 90 rockets, or 18 autocannon mags |

HUD elements `#weaponName`, `#currentAmmo`, `#reserveAmmo`, `#reloadIndicator`.

| State | Current | Reserve |
|---|---|---|
| Normal | Number | Number |
| Blood Thirst (guns) | infinity sign | infinity sign |
| Sword | `-` | `-` |
| Strikes | `READY` | `-` |

Colour of current ammo: `#ff0000` at 0%, `#ffaa00` at 33% or below, otherwise `#00ff00`.

Crosshair: 4 px white dot, opacity 0.8, with 20 px thin lines at opacity 0.6. It never reacts to firing or spread.

---

## 15. State inventory (constructor)

| Field | Initial | Purpose |
|---|---|---|
| `currentWeapon` | `'smg'` | |
| `lastShotTime` | 0 | Shared across all weapons |
| `isReloading`, `reloadStartTime` | false, 0 | |
| `triggerReleased` | true | Semi-auto latch |
| `isSwinging`, `swingProgress`, `swingStartTime`, `swingDuration` | false, 0, 0, 0.2 | |
| `isWindingUp`, `windUpDuration` | false, 0.3 | |
| `isAreaSwinging`, `areaSwingDuration` | false, 0.4 | |
| `isZoomed`, `defaultFOV`, `zoomFOV` | false, 75, 30 | |
| `swordCombo` | count 0, comboWindow 0.7 | See 5.6 |
| `bloodThirstActive`, `hellfireActive`, `berserkActive` | false | Mirrored from `Player` |
| `weaponSway`, `recoil` | {0, 0} | |
| `swayAmount` | 0.002 | |
| `screenShake` | zeros | |
| `weaponOffset`, `weaponRotationOffset` | set in `switchWeapon` | (0.35, -0.25, -0.6), Euler(0, -0.15, 0) |

Model build order: SMG (and left SMG), shotgun, rocket, walkie, Warthog, autocannon, sword. Then `switchWeapon('smg')`.

`fps-game.html` differences: only SMG, shotgun, rocket and sword, with the same stats for those four. No autocannon, strikes, zoom, akimbo, sword combo, area attack or finisher.
