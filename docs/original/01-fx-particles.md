# OVERPOWERED original: FX, particles, bullets

Spec of `index.html` lines 880-2045: `ObjectPool` (880), `Bullet` (919), `ParticleSystem` (1189). Call sites elsewhere in the file are included wherever they decide what the player sees.

**Evidence labels**

- **[sim]**: measured by running the original class source, unmodified, headless against real three.js r128 at dt = 1/60.
- **[read]**: taken from the source. No label means [read].
- **[analysis]**: my interpretation of why something feels a certain way. Nothing was playtested in a live browser for this document.

Volumes in tables are the config value. Effective volume is config x 0.5 master (`AudioManager.volume`, line 490). Nothing here uses positional audio: every FX `play()` call omits `position`.

---

## 1. The five facts that matter most

1. **The look is unlit flat colour, not glow.** Every live effect is `MeshBasicMaterial` with no texture. There is no additive blending, no bloom, no lights on FX, no post-processing, and no working emissive. Every `emissive` in the file is silently ignored (section 9, B2).
2. **The "white flash frame" does not exist.** The nearest things are a 1 px wireframe sphere at 25% opacity, rings that tint to white in their last frames, and the sword finisher's white chips. Muzzle flashes are yellow/orange.
3. **Explosion chips are fully opaque and leave by shrinking, not fading.** `transparent: false`, so the `opacity = alpha` write does nothing and only `scale = alpha` is visible. Colour stays at 100% saturation until the chip is gone.
4. **`createBloodJet` throws a ReferenceError on every call** (line 1496, `safePosition` is not defined) [sim]. The 30 droplets appear, then the exception fires. That breaks non-lethal headshots, shotgun and autocannon head kills, and most of dismemberment. See section 9, B1. The gore the player has been seeing is the broken version.
5. **Nothing is pooled except bullets.** Each particle allocates its own geometry, material and mesh, and is one draw call. A Hellfire rocket creates 360 of each in one frame plus 720 `console.warn` calls [sim].

---

## 2. Render context

| Item | Value |
|---|---|
| three.js | r128, `cdnjs .../three.js/r128/three.min.js` (line 474) |
| Clear colour / fog | `0x87CEEB` sky blue; `THREE.Fog(0x87CEEB, 50, 200)` |
| Camera | FOV 75, near 0.1, far 1000, Euler order `YXZ` |
| Renderer | `antialias: true`, pixel ratio capped at 2, PCF shadows |
| Tone mapping / output | Not set, so r128 defaults: `NoToneMapping`, `LinearEncoding`. Hex values reach the screen 1:1 |
| Lights | `AmbientLight(0x404040, 0.6)`, `DirectionalLight(0xffffff, 0.8)` |
| World materials | `MeshLambertMaterial`: ground `0x4a5d23` (200x200 plane at y=0), walls `0x8B4513`, obstacles `0x666666`, crates `0xDEB887`, pillars `0x708090` |
| FX materials | `MeshBasicMaterial` only (one dead `SpriteMaterial`). Default `fog: true`, so distant FX wash to sky past 50 units |
| Not used anywhere | `AdditiveBlending`, any `blending:` key, `Points`, `Line`, `PointLight`, `EffectComposer`, textures on FX, `depthTest` overrides |
| Sim step | `dt = min(realDt, 0.1)`; `scaledDt = dt * timeScale` (1.0, or 0.25 in SLOWMO). Bullets, particles, smoke and `weaponSystem.update` all use `scaledDt` |

**Order inside `updateGame` (7916):** player, perks, `weaponSystem.update` (8043, this is where shake is applied), shooting (8089), bullets + collisions (8163), enemies, enemy bullets, pickups, waves, `particleSystem.update` (8630), `updateSmokeParticles` (8634). Then `animate()` renders (8694).

Consequences:
- A particle spawned during the bullet loop gets one update before its first render. Ring frame 1 is already scale 11.7, not 1.
- Shake added during the bullet loop first applies on the *next* frame, so the shake lands one frame after the particles and sound.

---

## 3. Why it feels punchy [analysis]

Ranked by how much I think each contributes. The mechanisms are all in the code; the ranking is judgment.

| # | Quality | Mechanism in the code | Sequel consequence |
|---|---|---|---|
| 1 | **Hot flat colour on a cool background** | Unlit `0xffff00 / 0xffaa00 / 0xff6600 / 0xff0000` against `0x87CEEB` sky and dim Lambert world. Roughly complementary hues, and lighting never dulls the FX | Additive blending on a bright sky would clip toward white and lose hue. Keep normal blending and `toneMapped: false`, or a dark scene changes the whole equation |
| 2 | **Zero attack time** | Every particle spawns at full size and full colour on the impact frame, same frame as the sound. No ramp-in anywhere | Never ease in. Peak on frame 1 |
| 3 | **Exit by shrink, not fade** | Opaque chips: `scale = life/maxLife`. Area falls with the square, so a chip is at 25% area at half life. A free ease-out with no muddy translucent phase | Keep opaque chips and shrink them |
| 4 | **Hard faceted silhouettes** | `SphereGeometry(r,4,4)` is a 24-triangle angular gem. Smoke and sparks are unrotated cubes. Flat shading means no gradient inside the outline | Do not smooth these. Do not swap in soft sprites |
| 5 | **Stacked time constants** | Shock 0.1 s, sparks 0.5 s, chips 1.0 s, smoke 1-2 s. Reads like an audio envelope: crack, body, tail | Keep the ratio even if you retune values |
| 6 | **Colour layering, not colour over life** | 2-4 separate `createExplosion` calls at one origin. Each chip stays one flat colour for its whole life | Per-particle fixed colour picked from a palette, no gradients |
| 7 | **Fast, heavy ballistics** | Gravity -20 (ragdolls use -9.8), upward-only spawn velocity, so chips burst and fall in a clean dome | Keep gravity near 2x "real" |
| 8 | **Clean cut-off** | Non-Hellfire chips have fixed life 1.0, so a whole burst hits zero on the same frame. No stragglers | Do not randomise chip life |
| 9 | **Directional gore** | Jet speed = `dir * 15..20` plus only +-1.5..4 of jitter. A tight stream, not a puff. Explosive-kill spurts point away from the blast | Keep the base-speed to jitter ratio near 5:1 |
| 10 | **Very short, big shake** | 50 ms, new random pitch+roll each frame, no decay curve. 2-3 frames of snap, no rumble | Short and hard beats long and soft |
| 11 | **Sound layers on one frame** | Three headshot samples at once (0.75 / 0.5625 / 0.75) | Layer, do not sequence |
| 12 | **Accidents that help** | The exception in B1 drops a frame on some head hits: a one-frame hit-stop nobody designed. Trail cadence is wall-clock, so SLOWMO packs rings 4x denser | Reproduce these on purpose (section 10) |

**Answers to the specific guesses:**

- *Wireframe rings?* Mostly a misnomer. The "wireframe ring" is a solid thin annulus, and only on 30mm shells. The true wireframe is the shockwave sphere.
- *Pure-white flash frames?* No, none exist.
- *Fast scale-out?* Yes, for the shockwave (6 frames, radius 6.25) and rings (5 visible frames, 102x).
- *Hard-edged shapes?* Yes, probably the single most distinctive trait after colour.

---

## 4. ObjectPool (880-916)

| Method | Behaviour |
|---|---|
| `constructor(createFn, resetFn, initialSize = 50)` | Eagerly creates `initialSize` objects into `pool` |
| `get()` | `pool.pop()`, or `createFn()` if empty. **Unbounded growth, no cap.** Pushes to `active` |
| `release(obj)` | `indexOf` in `active`. If found: splice, `resetFn`, push to `pool`. Double release is safely ignored. O(n) |
| `releaseAll()` | Loops `release(active[0])`. Called on game start only |

Instances: `bulletPool` size 100, `enemyBulletPool` size 50 (ball recoloured `0xff0000` at creation). **Only bullets use it. Particles never touch it.**

Each Bullet owns 4 meshes with private geometry and material, so 150 bullets means 600 meshes, 600 geometries, 600 materials. 450 of those meshes sit invisible in the scene from construction [sim: 3 children per bullet after ctor].

---

## 5. Bullet (919-1186)

### 5.1 Meshes

| Field | Geometry | Material | In scene |
|---|---|---|---|
| `mesh` | `SphereGeometry(0.05, 4, 4)` | Basic `0xffff00`, opaque | On first `fire()`, never removed |
| `rocketMesh` | `CylinderGeometry(0.08, 0.06, 0.3, 6)` | Basic `0xff6600`, opaque | From ctor |
| `shellMesh` | `CylinderGeometry(0.05, 0.05, 1.5, 6)` | Basic `0xffff00`. `emissive` / `emissiveIntensity: 2` ignored | From ctor |
| `shellCone` | `ConeGeometry(0.3, 1.2, 8)` | Basic `0xffffff`, transparent, opacity 0.15, `depthWrite: false` | From ctor |
| `shellGlow` | **Never created.** 8 references, all guarded no-ops | | |

Orientation: `lookAt(pos + dir)` then `rotateX(PI/2)`. Rockets and shells orient once at fire; the path is straight, so that holds. The cone is re-aimed every frame. Its tip points forward and its base trails: centre 0.8 behind the shell, tip at -0.2, base at -1.4. It wraps the shell's rear half like a pale bow shock.

### 5.2 Projectile table

| Projectile | Speed | Damage | Visual | Trail | Set at |
|---|---|---|---|---|---|
| Player SMG round | 100 | 25 | Yellow ball | None | 4322, 4355 |
| Shotgun pellet | 100 | 20 x 6 pellets (12/18/36 with perks), spread 0.1 | Yellow ball | None | 4322 |
| Rocket | 40 | 100, blast 8 | `rocketMesh` | Grey cubes 0.35 | 4336 |
| Hellfire bullet | 100 | x1.25, blast 2 | `rocketMesh` (it sets `isRocket`) | Grey cubes 0.35 (falls into regular branch) | 4344 |
| Hellfire rocket (perk) | 40 | 100, blast 20, instakill in radius | `rocketMesh` | Orange cubes 0.4, plus 50% amber 0.3 | 4338 |
| Airstrike rocket (15 at 100 ms) | 50 | 100, blast 6 | `rocketMesh` | Big grey cubes 1.0 | 6646 |
| Airstrike finale | 60 | 99999, blast 20 | `rocketMesh` | Hellfire smoke | 6676 |
| 30mm autocannon | 200 | 99999, blast 5 | Shell + cone | Rings + small cubes | 4326 |
| 30mm Warthog (50 at 50 ms) | 200 | 150, blast 5 | Shell + cone | Rings + small cubes | 6871 |
| Enemy pistol | 30 | 5 | Red ball | None | 2436 |
| Enemy SMG | 40 | 4 | Cyan ball `0x00ffff` | None | 2436 |
| Enemy shotgun pellet | 35 | 3, spread 0.15 | Orange ball `0xffaa00` | None | 2409 |
| Enemy rocket | 20 | 30, blast 5 | `rocketMesh` | Grey cubes 0.35 | 2423 |

Lifetime is 5 s for all (scaled time). A bullet that times out just vanishes: rockets do not detonate.

### 5.3 Tracers: there are none

No line, streak, beam or trail exists for normal bullets (`grep -i tracer` is empty in both files). The "tracer" is the 0.05-radius yellow ball itself.

- It spawns at `camera.position + forward * 0.5`, at the crosshair and **not at the muzzle**.
- It moves 1.67 units before its first render at 60 fps.
- At ~2.2 units it projects to roughly 30 px across at 1080p (derived), then shrinks fast. At SMG rate (20 shots/s) this reads as a stream of yellow diamonds racing down the view axis.

The 30mm shell is the only projectile that reads as a beam, and even it moves 3.33 units per frame with a 1.5-long body, so it is a strobing dash.

### 5.4 Trail cadence

Rings and cubes use `performance.now()` (wall clock), so they do **not** follow `timeScale`. Bullet and particle ages do. `smokeInterval = 0.06`; shell cubes use half that.

| Case [sim] | Rings/s | Cubes/s | Ring spacing | Peak rings alive | Peak cubes alive |
|---|---|---|---|---|---|
| 30mm, 60 fps | 15 | 30 | 13.3 u | 2 | 60 |
| 30mm, 144 fps | 16 | 29 | 12.5 u | 2 | 58 |
| 30mm, 30 fps | 15 | 30 | 13.3 u | 1 | 59 |
| **30mm, 60 fps, SLOWMO** | 15 | 30 | **3.33 u** | **6** | 90 |
| Rocket, 60 fps | | 15 | | | 15 |
| Rocket, 60 fps, SLOWMO | | 15 | | | 45 |
| Warthog strafe, 60 fps (assumes 0.35 s flight) | | | | ~10 | **466** |

Spawn offsets behind the projectile: ring 0.2, shell cube 0.3, rocket cube 0.3.

| Trail call | Colour | Size | Lifetime |
|---|---|---|---|
| Shell ring | Argument `0xffff00` (ignored, see 7.1) | r 0.005 | 0.1 |
| Shell cube | `0xaaaaaa` | 0.1 | 2.0 |
| Regular rocket | `0xcccccc` | 0.35 | 1.0 |
| Airstrike rocket | `0xcccccc` | 1.0 | 1.8 |
| Hellfire rocket | `0xff6600` | 0.4 | 1.2 |
| Hellfire rocket, 50% extra | `0xffaa00` | 0.3 | 0.8 |

Rocket trails are dotted, not continuous: at 40 u/s a cube spawns every ~2.67 units. **That gap is a large part of the look** [analysis]. The trail reads as separate chunky puffs.

### 5.5 Collision (lines 8163-8507, summary)

| Item | Value |
|---|---|
| Samples per frame | 1 for everything except 30mm, which uses 4 (current position plus t = .25/.5/.75 lerp) |
| Head hit | Distance to head world position < `0.45 * enemy.size` (0.675-1.01) |
| Body hit | Distance to `enemy.position + (0, 0.8*size, 0)` < `0.8 * size` |
| Ground | `bulletPos.y <= 0` |
| Walls | `Box3.setFromObject(obj).containsPoint(pos)`, rebuilt per bullet per object per frame |

Normal bullets are not swept. At 100 u/s they step 1.67 u at 60 fps and 3.33 u at 30 fps, while the head sphere on the smallest enemy is 1.35 across. So bullets can skip the head between samples, more often at low frame rates. `previousPosition` is stored for all bullets and used only for shells.

### 5.6 `reset()`

Clears flags, `speed = 100`, timers and `previousPosition`. Does **not** clear `damage`, `weapon`, `shellBlastRadius` or colour. Those are rewritten at fire, except that airstrike and Warthog bullets never write `weapon`, so a stale value survives. Harmless today because rockets and shells exit before `weapon` is read.

---

## 6. Shared update rules

Two arrays with two update functions.

### 6.1 `update(dt)` for `particles` (1960)

Runs in this order per particle:

1. `life -= dt`. If `life <= 0`: remove, dispose geometry and material, splice.
2. `isShockwave`: expansion only (see 7.4), then `continue`.
3. Gravity: `v.y += gravity * dt` if `gravity` is defined (0 means none), otherwise **default -20**.
4. `isGiblet`: tumble plus bounce (see 7.11).
5. `alpha = life / maxLife`.
6. `isMist && expandRate`: `scale = 1 + (1 - alpha) * expandRate`.
7. `position += v * dt`.
8. `material.opacity = alpha`. **Unconditional.** Overwrites any starting opacity on frame 1, and does nothing when `transparent` is false.
9. Unless `isMist`, `isGiblet` or `isBlood`: `scale = alpha`.

There is no drag and no floor collision except for giblets. Particles fall through the ground, where the plane hides them. Hidden-by-ground is effectively the cull for ground-level bursts.

### 6.2 Resulting curves, per particle type

| Particle | `transparent` | Visible opacity | Scale | Gravity |
|---|---|---|---|---|
| Explosion, normal | false | Always 1 | 1 to 0 linear | -20 |
| Explosion, Hellfire | true | 1 to 0 linear (0.9 start is overwritten) | 1 to 0 linear | -20 |
| Spark | false | Always 1 | 1 to 0 linear | -20 |
| Blood jet droplet | false | Always 1 | (0.67-1) to 0 | -15 |
| Massive spurt | true | (0.5-1) to 0 | Constant | -20 |
| Blood droplet | true | (0.75-1) to 0 | Constant | -12 |
| Head gib | true | 1 to 0 over 3 s | Constant | -30 |
| Head mist | true | 1 to 0 over 0.6 s (0.6 start overwritten) | Constant | -20 (default) |
| Lingering mist (dead) | true | (0.5-1) to 0 (0.3 start overwritten) | (1-2) to 3 | 0 |

### 6.3 `updateSmokeParticles(dt)` for `smokeParticles` (1282)

Handles rings and cubes, using `age` counting up (the other array counts `life` down). Formulas in 7.1 and 7.2.

---

## 7. Effect recipes

### 7.1 "Wireframe" ring (`createWireframeRing`, 1196)

Not wireframe. A thin solid annulus used only by the 30mm shell trail.

| Property | Value |
|---|---|
| Geometry | `RingGeometry(r*0.9, r, 8)`, r = 0.005. An **octagon** (16 tris); the "perfect circle" comment is wrong |
| Material | Basic, transparent, opacity 0.5, `depthWrite: false`, `DoubleSide` |
| Orientation | Perpendicular to travel. Static: no motion, no spin |
| Lifetime | 0.1 s |
| Scale | `pow(1 + ageRatio * 25, 1.5)`, 1 to 132.6 |
| Colour | `setRGB(1, 1, ageRatio)`: yellow to white. **Overrides the `color` argument** |
| Opacity | 0.5 until 80% of life, then linear to 0 |
| Cap | If `smokeParticles.length > 50`, evict the oldest ring before spawning |

Per frame at 60 fps [sim]:

| Frame | Scale | Outer radius | Band width | Opacity | Blue channel |
|---|---|---|---|---|---|
| 1 | 11.7 | 0.059 | 0.006 | 0.50 | 0.17 |
| 2 | 28.5 | 0.143 | 0.014 | 0.50 | 0.33 |
| 3 | 49.6 | 0.248 | 0.025 | 0.50 | 0.50 |
| 4 | 74.3 | 0.371 | 0.037 | 0.50 | 0.67 |
| 5 | 102.0 | 0.510 | 0.051 | 0.42 | 0.83 |
| 6 | 132.6 | 0.663 | 0.066 | 0.00 | 1.00 |

So 5 visible frames, and it effectively pops off from 0.42. In SLOWMO: 24 frames, with rings 3.33 u apart and 6 alive, which makes a dense coil [sim].

**Punch** [analysis]: slightly accelerating growth from a near-zero start, thin bright lines, and big gaps between rings (13 u) that read as supersonic pulses rather than a smoke line. It is a small effect, final radius 0.5, so it needs the shell's speed to matter.

**Jank:** colour argument ignored. `initialRadius` stored and unused. The cap counts cubes but evicts only rings, so the thing causing the overflow is uncapped. I expected eviction to thin rings out during a Warthog strafe, and it does not: the ring count held at ~10, about the natural population [sim].

### 7.2 Smoke cube (`createSmokeParticle`, 1246)

| Property | Value |
|---|---|
| Geometry | `BoxGeometry(size, size, size)`. **Cubes**, never rotated, always axis-aligned |
| Material | Basic, transparent, opacity 0.6, `depthWrite: false` |
| Defaults | Colour `0x888888`, size 0.5, lifetime 1.0 |
| Spawn jitter | +-0.05 per axis |
| Velocity | x, z: +-0.25; y: 0.5 to 1.5 |
| Drag | `v *= 0.98` **per frame** (frame-rate dependent: 0.298/s at 60 fps, 0.055/s at 144 fps) |
| Scale | `1 + ageRatio * 1.5`, 1 to 2.5 |
| Opacity | `0.6 * (1 - ageRatio)` |
| Cap | None |

At 1.0 s life a cube rises about 0.5 units at 60 fps [sim, vy0 = 0.86].

**Punch** [analysis]: stylised cube puffs match the hard-edged chips, and spacing makes the trail look like discrete beats. Unrotated cubes are the most obviously "low-fi" element here, and that consistency is part of the style.

**Jank:** drag per frame. `initialSize` unused. New geometry and material per puff.

### 7.3 Explosion chips (`createExplosion`, 1341)

The workhorse. **Most of what players read as blood, impact and fire is this one function.**

| Property | Normal | Hellfire (`isHellfire = true`) |
|---|---|---|
| Defaults | Colour `0xff4444`, count 20 | |
| Geometry | `SphereGeometry(0.1, 4, 4)`, 24 tris | `SphereGeometry(r, 4, 4)`, r = 0.25-1.0 (`(0.1 + rand*0.3) * 2.5`) |
| Material | Basic, **opaque**, opacity 1 | Basic, transparent, 0.9 (overwritten to alpha) |
| Velocity x, z | Uniform +-5 | Uniform +-9 |
| Velocity y | Uniform 0-10 | Uniform 0-18 |
| Mean / max speed [sim] | 6.66 / 11.9 | 12.0 / 21.3 |
| Life | 1.0, fixed | 1.5, fixed |
| Gravity | -20 (default) | -20 (default) |
| Frames alive at 60 fps [sim] | 60 | 91 |
| Max height above origin [sim] | 2.42 | 7.95 |
| Max horizontal reach [sim] | 6.85 | 18.95 |

Details:
- All chips spawn at exactly one point: no position jitter.
- Velocity is sampled from a box, not a sphere, so the burst is a squared-off upward dome with nothing going down at spawn.
- Scale on frame 15/30/45 is 0.75/0.50/0.25 (normal), 0.83/0.67/0.50 (Hellfire) [sim].

**Punch** [analysis]: see section 3 rows 1-4, 6-8. Note the visual reach roughly matches the blast: rocket 6.85 vs radius 8, Hellfire 18.95 vs radius 20.

**Jank:**
- 2 `console.warn` per chip from `emissive` / `emissiveIntensity` on Basic material [sim: 40 per 20-chip burst].
- `particle.isHellfire` is never read.
- Normal-mode opacity writes are no-ops.
- Chips at enemies spawn at `enemy.position` (ground level, y=0), so blast-hit blood erupts from the feet, and low chips immediately go under the floor.

### 7.4 Shockwave (`createShockwave`, 1380)

The only real wireframe in the game.

| Property | Rocket | 30mm (`sizeMult 0.5`) | Hellfire |
|---|---|---|---|
| Geometry | `SphereGeometry(0.5, 16, 8)`, 224 tris | same | same |
| Material | Basic white, **`wireframe: true`**, transparent, opacity 0.25, `DoubleSide` | same | same |
| `expandSpeed` | 120 | 60 | 200 (`sizeMult` ignored) |
| `maxSize` | 15 | 7.5 | 60 (`sizeMult` ignored) |
| Life | 0.1 | 0.1 | 0.15 |
| Visible frames at 60 fps [sim] | 6 | 6 | 9 |
| Final world radius [sim] | **6.25** | **3.25** | **15.25** |
| Final opacity [sim] | 0.076 | 0.062 | **0.185** |
| Blast radius, for scale | 8 | 5 | 20 |

Formula: `currentSize += expandSpeed * dt`; `scale = currentSize`; `opacity = 0.25 * (1 - (currentSize/maxSize)^2)`. World radius is `0.5 * currentSize`. Starts at `currentSize` 0.5, no gravity or motion.

Per frame, rocket [sim]: R = 1.25, 2.25, 3.25, 4.25, 5.25, 6.25; opacity .243, .228, .203, .170, .128, .076.

In SLOWMO: 24 frames (rocket), 35 frames (Hellfire), same final radius [sim].

**Punch** [analysis]: the expansion rate is about 60 u/s of apparent radius, and from close range the lines sweep across the whole view. WebGL lines are 1 px, and with 25% opacity it never hides the chips. It is a subliminal "something just passed through you" that registers as force rather than as an object. It is subtle, and I would expect removing it to be noticed as a loss of snap more than as a missing object.

**Jank:**
- `maxSize` is never reached: life ends first. The `currentSize <= maxSize` guard never fails.
- Hellfire cuts off at 0.185 opacity, so it pops rather than fades.
- Line width is 1 device pixel, so at pixel ratio 2 it is thinner on retina screens.

### 7.5 Spark (`createSpark`, 1406)

| Property | Value |
|---|---|
| Geometry | `BoxGeometry(0.05, 0.05, 0.05)`, not rotated |
| Material | Basic, opaque, default colour `0xffff00`. `emissive` / `emissiveIntensity: 2` ignored |
| Velocity | Passed by caller |
| Life | 0.5 fixed |
| Gravity | -20 |
| Scale | 1 to 0 |

Callers: 30mm blast 20 sparks `0xffff00` with x,z +-10, y 0-10. Sword finisher 30 sparks `0xffffff` with x,z +-15, y 0-20.

**Punch** [analysis]: sparks are the fastest and shortest-lived part of a burst, so they give it a second tempo over the slower chips. Only those two callers use them. Rockets have none.

### 7.6 Muzzle flash

**`createMuzzleFlash` (1428) is dead code.** Both call sites are commented out (2482, 4369). For the record: `ConeGeometry(0.2, 1, 4)`, `0xffaa00`, opacity 0.8, `lookAt` along direction, removed by `setTimeout` 100 ms.

**The live flash is a mesh on each weapon model**, toggled in `WeaponSystem.shoot` (4240):

| Weapon | Geometry | Colour | Position (group local) | Timing |
|---|---|---|---|---|
| SMG (and left SMG in BERSERK) | `SphereGeometry(0.1, 8, 8)` | `0xffff00` | (0, .03, -.55) | Opacity 1 for 50 ms, then 0 |
| Shotgun | `SphereGeometry(0.15, 8, 8)` | `0xffaa00` | (0, .05, -.65) | Same |
| Rocket | `SphereGeometry(0.2, 8, 8)` | `0xff6600` | (0, 0, -.75) | Same |
| Autocannon | `CylinderGeometry(0.5, 0.125, 1.0, 8)`, rotated X 90° | `0xffaa00` then `0xffff00` | (0, 0, -3.3) | See below |

Autocannon two-stage flash: t=0 scale 1.25, opacity 1, orange. t=50 ms scale 0.625, opacity 0.7, yellow. t=100 ms opacity 0, scale 1, orange.

All are binary on/off with no fade, using `setTimeout` (wall clock, unaffected by SLOWMO). Material is Basic, transparent, base opacity 0. There is no light attached.

**Punch** [analysis]: opacity 1 for 3 frames then gone. At SMG rate (50 ms) it strobes. The autocannon's size-and-colour step is the best flash here: a two-frame hard step, big orange to small yellow.

**Jank:**
- Each autocannon shot throws 2 uncaught TypeErrors, because `material.emissive` is undefined on Basic [sim] (lines 4254, 4265). The visuals still work because `emissive.setHex` comes after the lines that matter.
- If you swap weapons inside the 50 ms window, the timer resets the *new* weapon's flash and the old one stays at opacity 1 until next fired.

### 7.7 Blood jet (`createBloodJet`, 1449)

| Layer | Count | Geometry | Material | Velocity | Life | Gravity |
|---|---|---|---|---|---|---|
| Droplets | 30 | `SphereGeometry(0.08-0.20, 4, 4)` | Basic `0xcc0000`, opaque | `dir*15 + (+-1.5, 0-5, +-1.5)` | 0.8-1.2, `maxLife` 1.2 | -15 |
| Mist (**never appears**) | 10 | `SphereGeometry(0.15, 3, 3)` | Basic `0xff4444`, transparent | `dir*7.5 + (+-2.5, 0-3, +-2.5)` | 0.4 | -20 |

Droplet visual: opaque, starts at scale 0.67-1 because `life < maxLife`, shrinks to 0.

**The mist loop throws on its first iteration**, at `mist.mesh.position.copy(safePosition)`. So 30 droplets exist and then the caller gets a ReferenceError [sim].

Straight up (head removal), droplets peak at 9.1-13.2 units (mean 11.3) at death, and 28 of 30 are still rising when they die [sim]. It reads as a tall geyser about 10 units high that shrinks away in mid-air and never rains back down.

**Direction quirk:** callers pass `(bulletPos - headPos).normalize()`, which is **not** the bullet's velocity. The sample point can be before or past the head centre, so the spray can go back toward the shooter or forward through the head. This varies per hit.

**Punch** [analysis]: tight jet (15 speed vs 1.5 jitter), opaque deep red, and a mix of sizes.

### 7.8 Massive blood spurt (`createMassiveBloodSpurt`, 1502)

Called 3x per explosive kill (`Enemy.dismember`, 2781), so **120 particles per kill**.

| Property | Value |
|---|---|
| Count | 40 per call |
| Geometry | `SphereGeometry(r, 4, 3)`, 16 tris. i < 10: r 0.15-0.30 (chunks). Rest: r 0.08-0.16 |
| Material | Basic, transparent, opacity 0.9 (overwritten). Colour i < 5: `0xff0000`, rest `0xcc0000`. `emissive` ignored |
| Velocity | `dir*20 + (+-4, 0-10, +-4)`; i < 5 then x1.5 |
| Mean speed [sim] | First 5: 29.1. Rest: 20.9 |
| Spawn jitter | +-0.15 per axis |
| Life | 1.0-2.0, `maxLife` 2.0 |
| Gravity | -20 |
| Visual | `isBlood`: no shrink. Opacity starts at 0.49-0.99 [sim], fades linearly |

Direction from `Enemy.dismember`: `bodyCenter - explosionPos` normalised, plus x,z +-0.15 and y 0-0.3 jitter, renormalised per call. `bodyCenter` = enemy position, y + 1.

**Punch** [analysis]: blood streams radially away from the blast, so direction tells you where the force came from. The first 5 particles are bright, faster, and overtake the rest, giving the spray a leading edge.

### 7.9 Blood droplet (`createBloodDroplet`, 1555)

| Property | Value |
|---|---|
| Geometry | `SphereGeometry(0.08-0.20, 4, 3)` |
| Material | Basic, transparent, opacity 0.95 (overwritten). 30% `0xff0000`, 70% `0xcc0000`. `emissive` ignored |
| Velocity | `initialVelocity`, or x,z +-1, y 0-1 |
| Life | 1.5-2.0, `maxLife` 2.0 |
| Gravity | -12 |
| Visual | `isBlood`: no shrink. Opacity starts 0.75-1, fades linearly |

Only caller is the blood trail in `Enemy.simulateRagdollParts` (2854), for flying severed parts:

| Rule | Value |
|---|---|
| Emits when | Part speed > 1 |
| Interval | `max(0.03, 0.1 - speed*0.01)`, accumulated at fixed 1/60 per rAF |
| Per emission | 3 droplets if speed > 5, otherwise 2 |
| Position | Part position +-0.1 |
| Velocity | `part.velocity * (-0.2 .. -0.1)`, so slightly backward |
| Global gate | Skip while `particles.length >= 400` (the only particle cap in the game) |

Up to ~90 droplets/s per part (derived), ~540/s for 6 parts, until the 400 gate.

**Jank:** the trail runs on `requestAnimationFrame` with fixed 1/60 steps. It runs faster on high-refresh screens and ignores SLOWMO. `Enemy.takeDamage` already calls `destroy()`, so `destroy(10, pos)` afterwards runs a second time, and both rAF loops walk the same `ragdollParts` array. From reading the code, that looks like parts are integrated twice per frame, and `simulateRagdollParts` will throw on the whole-body entry at line 2914 (a `Group` has no `.material`) once its lifetime drops below 1, which would stop the trail loop. Not tested here; see the Enemy spec.

### 7.10 Lingering blood mist (`createLingeringBloodMist`, 1589): dead code

Only call is commented out at 7869 ("DISABLED blood mist - focusing on blood trails instead").

| Property | Value |
|---|---|
| Count | 8 |
| Type | `THREE.Sprite`, `SpriteMaterial` with **no map** (a flat solid square) |
| Colour | 70% `0x990000`, 30% `0x660000` |
| Intended opacity | 0.3 |
| Spawn offset | +-0.25 per axis |
| Velocity | Normalised (+-.5, +-.25 + .2, +-.5) x 1.5-3 |
| Life | 1.5-3.0, `maxLife` 3.0 |
| `expandRate` | 2.0, gravity 0 |

**Why it looked wrong, and very likely why it was disabled** [sim for the numbers, the motive is my inference]: after one frame, opacity is overwritten to 0.54-0.98 and scale jumps from 0.5-0.8 to 1.04-1.92. So 0.3-opacity "never solid" mist becomes nearly solid, untextured red squares. Fixing it needs a soft texture and an `opacity = startOpacity * alpha` curve.

### 7.11 Head removal (`createHeadRemoval`, 1641)

Called for shotgun head kills (8394) and autocannon head kills (8275). Before it runs, `enemy.bodyParts.head.visible = false`. `position` = enemy position, y + 1.3.

**Chunks** (3, one of each):

| i | Geometry | Colour | Role |
|---|---|---|---|
| 0 | `SphereGeometry(g, 4, 3)` scaled (1, .8, .7) | `0xffaa88` | Skin/skull |
| 1 | `BoxGeometry(g*.8, g*1.2, g*.6)` | `0x992222` | Dark red "brain" |
| 2 | `SphereGeometry(g*.9, 3, 3)` | `0xcc0000` | Blood/tissue |

`g` = 0.26-0.37. Material: Basic, transparent, 0.95 (overwritten). Velocity x,z +-3, y 2-6, plus `forceDirection * 5`. Angular velocity +-2.5 rad/s per axis, `*= 0.98` per frame. Life 3.0. Gravity -30. Bounce at y = 0.2: `v.y *= -0.4`, `v.x, v.z *= 0.7`.

**Mist** (5): `SphereGeometry(0.2-0.4, 3, 2)`, 6 tris, `0x660000`, transparent. Velocity x,z +-1.5, y 1-3. Life 0.6, default gravity, no `expandRate`. Opacity 1 to 0 (the 0.6 start is overwritten). Faceted, so it reads as dark shards more than as mist.

**Fountain:** `createBloodJet(pos, (0,1,0))`, 30 droplets up, **then throws**.

Total before the throw: 38 particles [sim].

**Punch** [analysis]: three chunky pieces in different colours, including a skin-tone piece, make the head visibly come apart. The geyser sells it. The chunks tumble and bounce, the only FX with any "weight".

**Jank:**
- `bounces` / `maxBounces` are not set: `bounces++` gives NaN, and `NaN >= undefined` is false. The rest state never runs, so chunks rattle at floor height until they expire (92 velocity reversals across 3 chunks in ~3 s [sim]).
- The ReferenceError escapes uncaught to the game loop (see B1).

### 7.12 Dismemberment (`createDismemberment`, 1736)

**What the function does today.** Live code is the first ~30 lines. Everything after `return` at 1768 is a comment block.

| Step | Intended | Actually runs |
|---|---|---|
| `createExplosion(pos, 0xcc0000, 25)` | Yes | Yes |
| `createExplosion(pos, 0x880000, 15)` | Yes | Yes |
| Jet along `forceDirection` | 30 + 10 mist | 30, then throws |
| Side jet, `(-z, 0, x)` normalised | 30 + 10 mist | **Never** |
| `'explosive'`: `setTimeout(50 ms)` explosion `0xff0000` x20 | Yes | **Never**; also no caller passes `'explosive'` |
| `'headshot'`: upward jet | 30 + 10 mist | **Never** |

So every type actually gives 70 particles [sim]: 40 red chips plus one 30-droplet jet. Both callers wrap it in `try/catch` (4927, 8406), so the only sign is `console.warn('Dismemberment error ...')`.

Triggers: bullet kill when non-shotgun headshot, shotgun body kill within 10 units, or `finalDamage >= 150` (8400); sword kill with `damage >= 100` (4925). Rockets do not use this; they use `Enemy.dismember` (7.8).

**The original disabled design** (lines 1770-1957, commented out, comment says "DISABLED DUE TO CRASHES"):

| Type | Giblets | Splatter | Mist |
|---|---|---|---|
| explosive | 10-14 | 20 | 10 |
| headshot | 6-8 | 25 | 8 (+ extra jet) |
| melee | 8-11 | 15 | 6 |
| default | 7-9 | 12 | 5 |

| Layer | Geometry | Colour / material | Velocity | Life | Other |
|---|---|---|---|---|---|
| Giblets | Shared set: 30% `Box(.15)`, 30% `Sphere(.2,3,2)`, 25% `Cylinder(.08,.06,.4,4)` (limb, x1.2), 15% `Box(.25,.25,.2)`; scale 0.8-1.2 | 70% red `(0.8-1,0,0)`, 30% dark `(0.4-0.6,0,0)`, opacity .95 | x,z +-12.5, y 8-28, plus `force * (20 or 30 + 0-10)` | 2.5-4 (`maxLife` 4) | Gravity -30, spin +-7.5, 2-3 bounces, random start rotation, spawn +-.25, y +0-.5 |
| Splatter | `Sphere(.05-.2, 3, 2)` | `0xaa0000`, .9 | x,z +-12.5, y 0-20, plus `force * 15` | 1.5-2.5 | Gravity -20, `isBlood` |
| Mist | `Sphere(.3-.6, 3, 2)` | `0x660000`, .4 | x,z +-4, y 0-5 | 0.8 | `expandRate` 2.0 |

This version is more varied and heavier than what shipped, and worth reviving as the sequel's body gibs.

---

## 8. Event stacks

All spawns in a row happen on the same frame, in the listed order. "Chips" means `createExplosion` count. Shake column is the `addScreenShake` value.

### 8.1 Weapon impacts

| Event | Sound (config vol) | Particles | Shake |
|---|---|---|---|
| Bullet hits ground/wall | `bulletHit` random 1 of 4 (0.3) | 8 chips `0x888888` | None |
| Bullet hits body | `enemyHit` (0.4); 10% `enemyGrunt` (0.4) | 15 chips `0xff4444` at torso | None |
| Sword hit | `swordHit1` + `swordHit2` (0.6 each) + `enemyHit` | 15 chips `0xff4444` | 0.01, if anything hit |
| Sword area attack | same | 25 chips `0xff4444`; on kill 30 chips `0xff0000` | 0.15 |
| Enemy bullet hits ground/wall | `bulletHit` | 5 chips `0xff4444` | None |
| Enemy bullet hits player | `playerHit` (0.6, reuses `enemy_hit.mp3`) | 10 chips `0xff0000` **at the eye point**, plus CSS damage flash (radial red to `rgba(255,0,0,.3)`, opacity 1 for 200 ms, 0.1 s transition). During BERSERK the chips still spawn but no damage, flash or sound | None |

### 8.2 Explosions

| Event | Sound | Chips | Extras | Shake |
|---|---|---|---|---|
| Rocket | `rocketExplosion` (0.5) | 50 `0xff6600` + 30 `0xffaa00` | Shockwave | 0.06 |
| Hellfire bullet | `hellfireBulletExplode` (0.5) | 12 `0xff6600` + 8 `0xffaa00` | No shockwave | 0.06 |
| Hellfire rocket | `rocketExplosion` (0.5) + `hellfireRocketExplode` (1.4) | 120 `0xffff00` + 100 `0xffaa00` + 80 `0xff6600` + 60 `0xff0000`, all Hellfire mode | Shockwave (Hellfire) | 0.24, 100 ms |
| 30mm shell | `30mmshell_explode` (1.6) | 25 `0xffff00` + 15 `0xffaa00` | 20 sparks, shockwave x0.5 | 0.03 |
| Sword heavy finisher | `rocketExplosion` (0.5) | 60 `0xffffff` + 40 `0xcccccc` + 30 `0x888888` | 30 white sparks, shockwave | 0.15 |

Per enemy in any blast: `enemyHit` + 10 chips `0xff4444` at its feet. Per kill: `enemyDie`, then `Enemy.dismember` = 3 massive spurts (120), flying parts with blood trails, 50% `enemyExplode` (0.5). Parts get `force = explosionForce * max(0, 1 - d/10)`, with `explosionForce` 10 (rocket, finisher) or 5 (shell).

Damage in the blast falls off as `1 - (d/radius)*0.5`. Sound and shake do not attenuate with distance: a rocket 100 units away shakes the same as one at your feet.

### 8.3 Shake table

`addScreenShake(i)` sets intensity and 50 ms duration. Each frame while `duration > 0`: `camera.rotation.x += (rand-.5)*i`, `camera.rotation.z += (rand-.5)*i`, undone by `setTimeout(16)`. No yaw, no decay within the duration.

| Source | Value | Peak per axis | Duration |
|---|---|---|---|
| SMG fire | 0.004 | +-0.002 rad (0.11°) | 50 ms |
| Sword hit | 0.01 | +-0.005 (0.29°) | 50 ms |
| Shotgun fire | 0.02 | +-0.01 (0.57°) | 50 ms |
| Autocannon fire / 30mm blast | 0.03 | +-0.015 (0.86°) | 50 ms |
| Rocket fire | 0.04 | +-0.02 (1.15°) | 50 ms |
| Rocket blast, Hellfire bullet | 0.06 | +-0.03 (1.72°) | 50 ms |
| Finisher, area attack | 0.15 | +-0.075 (4.3°) | 50 ms |
| Hellfire rocket | 0.24 | +-0.12 (6.9°) | 100 ms |

50 ms is 2-3 frames at 60 fps. Duration counts in scaled time, so SLOWMO stretches shake 4x.

**Last write wins:** `addScreenShake` overwrites rather than taking the max. SMG fire at 0.004 will replace a live 0.24 Hellfire shake on the next shot, and also resets the duration to 50.

The weapon models are positioned from the camera before shake is added (4005-4030 vs 4064), so the gun does not shake with the view, which adds apparent jolt [read, effect is analysis]. Pitch cannot drift because `updateCamera` sets `rotation.x` absolutely each frame.

### 8.4 Headshot: what happens, by case

Hit test: distance < `0.45 * size`. Damage: `bullet.damage * 2`. `willKill = damage*2 >= enemy.hp`.

Enemy HP is 50 / 75 / 100 and does not scale with wave. Before perk multipliers, SMG headshot = 50 and shotgun pellet headshot = 40.

**Case A: lethal headshot, not shotgun** (e.g. SMG on a 50 HP enemy). Runs clean:

| Order | What |
|---|---|
| 1 | 20 chips `0xffff00` at head |
| 2 | `enemyHeadshot` (0.75) + `enemyHeadshot2` (0.5625) + `enemyHeadshot3` (0.75, skips its first 1.0 s of silence), all same frame |
| 3 | +50 score, "HEADSHOT! +50" in kill feed |
| 4 | `registerHeadshot()`: 3 in 3 s triggers SLOWMO (timeScale .25 for 5 s, `perkSlowmo`, all audio playback rate .25) |
| 5 | `takeDamage` -> `destroy()` -> ragdoll |
| 6 | `enemyDie` (0.5), 1/6 chance `enemyDeathGrunt` (0.5) |
| 7 | `createDismemberment('headshot')`: 25 + 15 chips + 30 droplets, then the swallowed exception |
| 8 | Score, kill count, perk kill, "Enemy eliminated +N", 30% pickup |
| 9 | `enemy.destroy()` again (second ragdoll), splice |

That is 90 meshes on one frame. No shake beyond the weapon's own fire shake, no FOV change, no time-scale change (unless the third headshot), no crosshair hit marker. Kill feed entries slide in over 0.4 s and live 4 s.

**Case B: non-lethal headshot** (SMG on 75/100 HP, or shotgun pellet on anything above 40 HP). **Broken:**

| Order | What |
|---|---|
| 1 | 20 chips `0xffff00`, 3 headshot sounds |
| 2 | `createBloodJet`: 30 droplets, then uncaught ReferenceError |
| 3 | Rest of `updateGame` is abandoned. Enemies, particles, UI, minimap and `renderer.render` are all skipped for that frame |
| Skipped | **Damage, +50, "HEADSHOT!", `registerHeadshot`, bullet release** |

So a headshot on a full-health 75 or 100 HP enemy with the SMG does **zero damage**. The bullet flies on and may hit again next frame. The rAF was queued first (line 8648), so the game survives. `lastTime` was already updated, so the lost frame's time is simply gone: a real one-frame freeze of the simulation (the player's own update already ran).

**Case C: shotgun head kill.** Yellow chips, sounds, +50, `takeDamage` kills, head hidden, 38 particles, then uncaught throw. Kill score, kill count, perk streak, feed message and pickup roll are all skipped. The main loop removes the dead enemy next frame.

**Case D: autocannon head kill.** Same throw at 8275. `bullet.active` is still true and nothing released it, so **the shell keeps flying and explodes somewhere else later**, instead of at the head.

---

## 9. Broken, janky, dead

### Bugs (ranked)

| ID | Severity | Where | Problem |
|---|---|---|---|
| B1 | **Critical** | 1496 | `safePosition` undefined in `createBloodJet`. Affects 4 call paths (8.4 and 7.12). Present in the old file too (`fps-game.html:884`). The name comes from `createDismemberment`, so this looks like a copy-paste slip |
| B2 | High | 972, 1358, 1413, 1522, 1569, 2195, 3616, 4254, 4265 | `emissive` on `MeshBasicMaterial`. Ignored, with 2 `console.warn` per material: 40 per 20-chip burst, 720 per Hellfire rocket [sim]. `material.emissive.setHex` throws TypeError twice per autocannon shot. All "glow" intent in the code has no visual effect, so do not port it as if it did |
| B3 | Medium | 2037 | Unconditional `opacity = alpha` overrides all authored opacities (0.9, 0.95, 0.6, 0.3) on frame 1 |
| B4 | Medium | 1669-1694 | Head chunks lack `bounces` / `maxBounces`, giving NaN and no rest state |
| B5 | Medium | 8460, 8493 | `else if (bullet.isHellfireBullet)` is unreachable because Hellfire bullets have `isRocket = true`, caught by the branch above |
| B6 | Medium | 4461 | Shake is last-write-wins (8.3) |
| B7 | Low | 4270 | Stale muzzle flash on fast weapon swap |
| B8 | Low | Whole | `startGame` does not clear `particles` / `smokeParticles`. They freeze in place on pause or game over (the update stops, render continues) and resume after restart |

**"DISABLED - Causing crashes" (line 1737):** the author replaced the original dismemberment because of crashes. The only exception I can confirm in this path is B1, and B1 is still there in the replacement. It is plausible that B1 was the crash all along and the rewrite did not fix it, but that is inference. I cannot prove what the original crash was.

### Frame-rate and clock problems

| Issue | Where |
|---|---|
| `v *= 0.98` per frame on smoke; `angularVelocity *= 0.98` per frame on gibs | 1330, 2004 |
| Ragdolls and blood trails fixed at 1/60 per rAF: faster on high-refresh screens, ignore SLOWMO | 2648, 2848 |
| Trail cadence on wall clock while ages use scaled time. Happens to look good in SLOWMO, see 5.4 | 1084, 1115 |
| Flash and delayed effects via `setTimeout`: keep running during pause and SLOWMO | 1442, 1762, 4249 |
| Normal bullets not swept (5.5) | 8179 |

### Performance

- No particle pooling. Per particle: new geometry, material, mesh, one draw call, then dispose.
- Worst single frame found: Hellfire rocket, 360 of each plus 720 warnings, plus per-enemy chips and 120 per kill.
- Warthog strafe: 466 smoke cubes alive at once [sim], each its own draw call.
- Per-frame allocation: `velocity.clone()` per particle, per bullet; `position.clone()` per bullet.
- `scene.getObjectById` (recursive) once per `fire()`. Shotgun with perks is 36 per trigger pull.
- `Box3.setFromObject` per bullet per collider per frame (8474).
- Only caps in the game: ring eviction above 50, droplet gate at 400.

### Dead code

| Item | Status |
|---|---|
| `createMuzzleFlash` | No live callers |
| `createLingeringBloodMist` | No live callers |
| `createDismemberment` lines 1770-1957 | Commented out |
| `'explosive'` branch in `createDismemberment` | No caller passes it, and unreachable behind B1 anyway |
| `shellGlow` | Never created |
| `flybySoundPlaying` | Never set true |
| `isEnemyBullet` | Set, never read in a decision |
| `particle.isHellfire`, `smoke.initialSize`, `smoke.initialRadius` | Never read |
| `enemy.headshotKilled` | Set at 8297, never read |
| `currentSize <= maxSize` guard | Never fails (life ends first) |

---

## 10. Sequel notes

### What the player has actually been seeing

Fixing B1 **changes the look of the game**. Today's gore is the broken version:

| Fix | New visible effect |
|---|---|
| Blood jet mist runs | +10 pink-red translucent spheres per jet, at opacity 1 fading over 0.4 s |
| Dismemberment completes | +30 droplets side jet on every dismember; +30 up on headshots |
| Non-lethal headshots work | Enemies take damage, and the accidental freeze disappears |

Review these against the current look rather than assuming they are improvements. If the user loves today's feel, treat "40 chips + 30 droplets" as the baseline for a dismember.

### Keep

- Unlit flat colour, normal blending, no tone mapping on FX.
- Opaque chips that shrink to nothing, all ending on the same frame.
- 4-segment faceted spheres and unrotated cubes.
- Colour layering: 2-4 flat colours at one origin.
- Time ladder: 0.1 s / 0.5 s / 1 s / 1-2 s.
- Gravity -20 on debris, tight blood jets, spurts pointing away from the blast.
- 1 px wireframe shock sphere at 25% or less, reaching about 75% of the blast radius in 0.1 s.
- Dotted smoke trails, not continuous ribbons.
- 50 ms shake with new random offsets each frame, plus a triple-layered headshot sound.

### Make deliberate

- **Hit-stop:** add a real one (1-2 frames, scaled by event) to replace what the bug did by accident.
- **SLOWMO trail density:** keep rings on real time if you want the coil.
- **Shake:** take the max of current and new, instead of last-write-wins.

### Fix

- Swap to `InstancedMesh`: one per shape (chip, cube, droplet). Per-instance colour and scale. An opaque set covers chips and sparks. Translucent blood needs per-instance alpha, or a second, sorted set.
- A fixed ring-buffer pool per effect, with a hard cap, and oldest-out eviction per array.
- `v *= pow(0.98, dt*60)` style drag.
- All effect timing on the game clock unless deliberately real-time.
- Swept bullet collision.
- Real `maxBounces` on gibs.
- Pass the true bullet velocity for blood direction, or decide that the spray goes back toward the camera.
- Opacity curve as `startOpacity * alpha`, per effect.
- Add ground contact for blood if you want decals (none exist today; blood leaves no mark).

### Worth adding, none of it exists today [analysis]

Tracers for normal bullets, spawned from the muzzle. Sparks on rocket blasts. A hit marker. A soft-textured mist only if it can be made to match the hard-edged style. The commented-out giblet set (7.12).

---

## 11. Changes between `fps-game.html` and `index.html`

| Item | Old | New |
|---|---|---|
| `createWireframeRing`, `createSmokeParticle`, `createSpark`, `updateSmokeParticles` | Absent | Added |
| 30mm shell, cone, rings | Absent | Added |
| Rocket smoke trail | Stub: computes position, spawns nothing | Real cube trail |
| Shockwave Hellfire | speed 150, max 20, life 0.1 | speed 200, max 60, life 0.15 |
| Shockwave `sizeMult` | Absent | Added |
| `createExplosion`, all blood and head recipes, `createDismemberment`, `update()` | Identical | Identical (checked with `diff`) |
| `safePosition` bug | Present (884) | Present (1496) |

---

## Appendix: how the [sim] numbers were produced

Lines 880-2045 of `index.html` were loaded unmodified into Node with the exact r128 build from cdnjs, with a controllable `performance.now`, then stepped at dt = 1/60 (or 1/144, 1/30, and 1/60 x 0.25 for SLOWMO) and sampled. Rendering and audio were not run, so anything about screen pixels or frame drops in a browser is derived from code, not observed.
