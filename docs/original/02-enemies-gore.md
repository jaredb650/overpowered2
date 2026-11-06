# 02: Enemies, gore and pickups

Reverse-engineered from `index.html` (8769 lines). Scope: `Enemy` and `Pickup` (lines 2048-3023), the bullet hit loop in `updateGame` (8162-8507), the explosion handlers (7713-7905), the gore emitters in `ParticleSystem` (1449-2044), and `WaveSystem` (6937-7024).

## How to read this

Each claim comes from one of two sources.

- **Read:** taken directly from the code. This is the default, and line numbers refer to `index.html`.
- **Measured:** marked **[M]**. I ran the game's own code, extracted verbatim by line range, in Node with real three.js r128 on a virtual clock that reproduces `requestAnimationFrame` ordering. There was no rendering and no audio.

Not tested: anything that needs a real browser, meaning how it looks, real frame times, and the sound files. The `sounds/` folder is not in the snapshot, so what the samples actually sound like is unknown. Interpretation is labelled as such.

`Enemy` and `Pickup` are byte-identical in the older `fps-game.html`. `WaveSystem` differs only by the wave 10 music switch. The `createBloodJet` bug below exists in both files.

## The five things that matter most

1. **`createBloodJet` always throws.** Line 1496 reads `safePosition`, which only exists inside `createDismemberment`. Every call adds its 30 droplets, then dies with a `ReferenceError` on the first mist particle. Most of the gore and headshot behaviour below follows from this one bug.
2. **A non-lethal headshot does nothing.** It plays the full yellow burst and triple sound, then the exception skips the damage, the +50 and the SLOWMO count. "HEADSHOT! +50" therefore only ever appears on a kill.
3. **Headshots depend on frame rate.** The head hit sphere sits entirely inside the body hit sphere. A headshot only registers when a bullet's per-frame step happens to jump over the outer shell. Aiming dead centre at a head gives 51-66% at 60 Hz, 2-31% at 120 Hz, and **0% during SLOWMO** [M].
4. **Dismemberment runs on top of a ragdoll.** Every explosive kill calls `takeDamage` (starts a ragdoll) and then `destroy(force, pos)` (starts dismemberment). Two physics loops then fight over the same parts, and the ragdoll's joint limits are applied to limbs that are already flying.
5. **Bullet kills ragdoll twice.** `takeDamage` calls `destroy()`, then line 8430 calls it again. Corpses get two stacked bodies and two loops, so they settle in 0.19 s instead of 0.31 s and vanish in 2.5 s instead of 5 s [M]. This accident is part of why bullet kills feel punchy.

---

## 1. Enemy types

Defined at 2058-2062. The labels are from comments in `getRandomEnemyType`.

| Type | Label | HP | Speed (u/s) | Body colour | Size | Score | `damage` (dead field) |
|---|---|---|---|---|---|---|---|
| 0 | Basic | 50 | 3.0 | `0xff4444` red | 1.5 | 100 | 10 |
| 1 | Medium | 75 | 2.5 | `0x44ff44` green | 1.8 | 150 | 15 |
| 2 | Strong | 100 | 2.0 | `0x4444ff` blue | 2.25 | 200 | 20 |

Shared by every type:

| Field | Value | Note |
|---|---|---|
| `attackRange` | 30 | Only fires inside this distance |
| Stop distance | 15 | Local constant in `update` |
| Back-away threshold | 13 | `stopDistance - 2` |
| `rangedDamage` | 5 | Same for all types. Tougher enemies do not hit harder |
| `projectileSpeed` | 30 | 20 for rockets |
| `isRanged` | always `true` | All "not ranged" branches are dead |

Hits to kill at full HP, ignoring perks:

| Weapon | T0 (50) | T1 (75) | T2 (100) |
|---|---|---|---|
| SMG body, 25 | 2 | 3 | 4 |
| Shotgun pellet body, 20 | 3 | 4 | 5 |
| Sword base, 75 | 1 | 1 | 2 |
| Sword area, 100 | 1 | 1 | 1 |

Enemies have **no hit reaction** on a non-lethal hit: no flinch, no flash, no knockback. Feedback is only particles, sound and the health bar.

## 2. Waves and spawning

| Rule | Value | Source |
|---|---|---|
| Enemies in wave N | `10 + floor(N * 2)` | 7003 |
| Spawn rate | 1 per second, wall clock | 6942, 6975 |
| Delay between waves | 5 s after the last enemy dies | 6947 |
| Cap on enemies alive | None | |
| HP, damage or speed scaling | **None.** Only count, type mix and weapon mix change | |
| Music | Switches to "hard" at wave 10 | 6994 |

Type mix (7006-7015, rolled in sequence):

| Wave | T0 | T1 | T2 |
|---|---|---|---|
| 1-2 | 100% | 0 | 0 |
| 3-4 | 60% | 40% | 0 |
| 5+ | 42% | 28% | 30% |

Weapon mix (2092-2117, rolled in sequence, and independent of type):

| Wave | Pistol | 3-burst | Shotgun | Rocket | SMG |
|---|---|---|---|---|---|
| 1-9 | 75% | 25% | | | |
| 10-14 | 63.75% | 21.25% | 15% | | |
| 15-19 | 57.38% | 19.13% | 13.5% | 10% | |
| 20+ | 51.64% | 17.21% | 12.15% | 9% | 10% |

Example sizes: wave 1 is 12 enemies, wave 5 is 20, wave 10 is 30, wave 20 is 50. Difficulty stops changing after wave 20 apart from +2 enemies per wave.

Spawning (7672-7700): random X and Z in ±40, y = 0, re-rolled up to 20 times if closer than 15 to the player. There is no check against walls or pillars, no spawn effect, and no warning. Arena walls are at ±50. Each spawn also writes a `console.log`.

## 3. Mesh construction

A `THREE.Group` at the enemy's feet, holding separate meshes (2126-2245). Geometry scales with `size` but **Y offsets do not**, so the proportions degrade as enemies get bigger.

| Part | Geometry | Local position | Material |
|---|---|---|---|
| Torso | Box `0.6s x 0.8s x 0.3s` | y 0.8 | Lambert, type colour |
| Head | Sphere r `0.25s`, 8x6 | y 1.5 | Lambert `0xffaa88` |
| Arms | Box `0.15s x 0.6s x 0.15s` | `(±0.45s, 0.8, 0)` | Lambert `0xffaa88` |
| Legs | Box `0.2s x 0.8s x 0.2s` | `(±0.2s, 0.4, 0)` | Lambert, type colour |
| Eyes | Sphere r 0.05, 4x4, not scaled | `(±0.08, 0.05, 0.2)` on head | Basic `0xffff00` |
| Gun | Cylinder (section 6), not scaled | `(0, -0.2, 0.15)` on right arm, `rotation.x = PI/2` | Basic |

All parts cast shadows. Nothing is shared between enemies, so each one costs 8 geometries and 4 materials, plus 2 of each for the health bar.

Resulting vertical extents:

| Part | T0 (1.5) | T1 (1.8) | T2 (2.25) |
|---|---|---|---|
| Legs | -0.20 to 1.00 | -0.32 to 1.12 | -0.50 to 1.30 |
| Torso | 0.20 to 1.40 | 0.08 to 1.52 | -0.10 to 1.70 |
| Head | 1.13 to 1.88 | 1.05 to 1.95 | 0.94 to 2.06 |
| Health bar y | 2.00 | 2.30 | 2.75 |

Problems with this construction:

- **Big enemies are squashed.** On T2 the head centre (1.5) sits below the torso top (1.7), and legs and torso go through the floor. T2 is only 10% taller than T0 even though it is 50% larger.
- **Eyes are invisible.** They reach at most 0.27 from the head centre, and the smallest head radius is 0.375. The code that "adds glowing eyes" produces nothing the player can see.
- **Limbs have no pivots.** Box geometry is centred, so every limb rotates around its own middle rather than a shoulder or hip. This affects walking and ragdoll alike.

## 4. AI

There is no pathfinding, obstacle avoidance, separation between enemies, or line-of-sight check. `update` (2271-2348) is a distance switch against the player's eye position.

| Distance to player | Action | Speed multiplier | T0 / T1 / T2 (u/s) |
|---|---|---|---|
| Over 30 | Walk toward, no firing | 1.0 | 3.0 / 2.5 / 2.0 |
| 15 to 30 | Walk toward and fire | 0.7 | 2.1 / 1.75 / 1.4 |
| 13 to 15 | Stand and fire | 0 | |
| Under 13 | Back away and fire | 0.5 | 1.5 / 1.25 / 1.0 |

The player moves at 8 u/s (14.4 sprinting), so enemies can never escape. Enemies pass through walls and pillars because `update` receives no collision data. Their bullets do collide, so they will happily fire into cover.

Every frame they also run `mesh.lookAt(player)` with no Y lock, so the whole body pitches toward the camera.

**Walk animation** (only while moving): `walkCycle += dt * 5`.

| Element | Formula |
|---|---|
| Legs | `rotation.x = ±sin(cycle) * 0.15`, `position.z = ±sin(cycle) * 0.1` |
| Left arm | `rotation.x = -walkAmount * 0.5` |
| Right arm | Not animated (it holds the gun) |
| Torso | `rotation.y = sin(cycle * 2) * 0.05` |

When enemies stop, limbs freeze mid-stride because nothing returns them to neutral.

### Floating and sinking (bug)

Movement uses a full 3D direction toward the player's eye (y = 1.8), and nothing clamps enemy Y. Enemies climb as they approach and dive as they retreat [M]:

| Scenario | Result |
|---|---|
| Spawn 38 away, player standing | Settles at y = **1.09** at distance 15, so the feet hover about 0.9 above the floor |
| Same, player held at y = 3.1 | Settles at y = 1.88 |
| Enemy on the floor, player 5 away | Backs away to y = **-2.61**, buried under the floor |
| Floated enemy, player rushes to 6 away | Sinks from 1.09 to 0.27 |

A buried enemy cannot be hit by bullets, because bullets are released at y <= 0 before they reach it. Its own shots also die instantly: one test shot produced `enemyShoot`, a ground puff, and no player damage [M]. Only blast damage reaches it, or the player can walk away so it climbs back. Any kill drop it leaves is underground too.

## 5. Health bars

Built at 2247-2269, updated at 2487-2500.

| Property | Value |
|---|---|
| Size | 1.0 x 0.1, the same for all types |
| Position | `(0, size + 0.5, 0)` on the enemy group |
| Background | `0x440000` |
| Fill above 60% | `0x00ff00` |
| Fill 30-60% | `0xffff00` |
| Fill at 30% or less | `0xff0000` |
| Anchoring | Left-anchored: `scale.x = pct`, `position.x = (1 - pct) * -0.5` |
| Facing | `lookAt(player)` every frame |
| Visibility | Always on, including at full HP. Removed instantly on death |

The fill and background are coplanar, so z-fighting is possible. I could not test that without rendering.

## 6. Ranged attacks

`attemptRangedAttack` (2350-2384) gates firing, and `fireProjectile` (2386-2485) creates the shots.

| Weapon | Shots per trigger | Gap | Cooldown | Damage | Speed | Colour | Gun mesh (r, length, colour) |
|---|---|---|---|---|---|---|---|
| Pistol | 1 | | 1.5 s | 5 | 30 | `0xff0000` | 0.03, 0.4, `0x222222` |
| 3-burst | 3 | 0.15 s | 1.5 s after last shot | 5 | 30 | `0xff0000` | 0.03, 0.4, `0x888888` |
| Shotgun | 6 pellets | | 2.5 s | 3 each | 35 | `0xffaa00` | 0.05, 0.35, `0x663300` |
| Rocket | 1 | | 5.0 s | 30 listed | 20 | Rocket mesh `0xff6600` | 0.08, 0.5, `0x444400` |
| SMG | 10 | 0.10 s | 4.0 s after last shot | 4 | 40 | `0x00ffff` | 0.04, 0.45, `0x333366` |

Approximate sustained damage per second if every shot lands: pistol 3.3, 3-burst 8.3, SMG 8.2, shotgun 7.2, rocket 2.7. The player has 100 HP and regenerates 5 HP/s after 3 s without damage.

Behaviour:

- **Aim:** straight at the player's current eye position. No lead and no inaccuracy, except the shotgun's ±0.075 per axis before normalising.
- **Dodging is the whole design.** At 30 u/s, a shot from 15-30 units takes 0.5-1.0 s to arrive, so moving sideways defeats nearly everything.
- **Origin:** `position + (0, size * 0.3, 0) + direction * size`. This does not line up with the gun model.
- **First shot:** instant on entering range, because `lastRangedAttackTime` starts at 0.
- **Telegraph:** only the `enemyShoot` sound (0.15), which has no distance falloff. The muzzle flash is commented out at 2482.
- **Recoil:** right arm `rotation.x -= 0.3` and gun `z -= 0.05`, both restored by `setTimeout` after 100 ms.

**SLOWMO mismatch:** cooldowns use `performance.now()`, not scaled time. During SLOWMO enemies keep firing at full rate while their bullets crawl at 25%, so bullet density in the air is about 4x normal.

### Enemy projectiles

The enemy bullet pool starts at 50 and grows on demand. Each shot uses a sphere of r 0.05 with no trail, the same size as a player bullet despite the "smaller" comment. Lifetime is 5 s of scaled time. The update loop is at 8522-8586.

| Event | Trigger | Result |
|---|---|---|
| Near miss | Within 3 of the eye, once per bullet | `bulletWhizz` (0.4) |
| Player hit | Within 1 of the eye | `player.takeDamage`, 10 particles `0xff0000` at the player |
| Ground or wall | y <= 0, or inside a collider box | 5 particles `0xff4444` and random `bulletHit1-4` (0.3) |
| Rocket, any hit | Same checks | `handleRocketExplosion(pos, 5, 30)` |

Enemy rockets use the normal rocket explosion: `rocketExplosion` sound, 50 + 30 particles, shockwave, shake 0.06. Consequences:

- Player damage runs through the self-damage formula, `30 * falloff * 0.5`, so the "high damage" rocket does at most **15**.
- The blast hurts other enemies, and the player gets the score and kill credit. This is usable as an accidental feature.

There is no `continue` after a player hit at 8555-8566, so a released bullet still runs the wall check. `reset()` has already cleared `isRocket`, so the worst case is a stray puff and hit sound at the bullet mesh's old position.

---

## 7. Hit detection

Bullets are tested as **points against two spheres** at the post-move position only, with no ray or swept test (8200-8236). The head is checked first.

| Check | Centre | Radius |
|---|---|---|
| Head | World position of the head mesh | `0.45 * size` |
| Body | `enemy.position + (0, 0.8 * size, 0)` | `0.8 * size` |

Regular bullets get 1 sample per frame. 30 mm shells get 4 per frame, tested in the order end of frame, then 25%, 50%, 75% (8179-8198). Rockets and Hellfire bullets explode on any hit, so **they can never headshot**.

| Type | Visual head r | Head hit r | Body hit r | Body hit centre y | Shell thickness at head centre | Headshots stop above |
|---|---|---|---|---|---|---|
| T0 | 0.375 | 0.675 | 1.20 | 1.20 | 0.49 | 205 Hz |
| T1 | 0.450 | 0.810 | 1.44 | 1.44 | 0.63 | 159 Hz |
| T2 | 0.563 | 1.013 | 1.80 | 1.80 | 0.76 | 131 Hz |

The hit head is 1.8x the visual radius, about 5.8x the volume. The "50% larger" comment compares it to an older 0.3 value, not to the visual head.

### Why headshots depend on frame rate

The head sphere is **entirely inside** the body sphere for all three types. A bullet coming from outside must cross the body-only shell first, and any sample landing in that shell is an immediate body hit that consumes the bullet. A headshot only registers if one step jumps the whole shell.

At 100 u/s a step is 1.67 units at 60 Hz, which is wider than every shell. At 120 Hz it is 0.83, at 144 Hz it is 0.69. SLOWMO scales it by 0.25, giving 0.42 at 60 Hz, thinner than every shell.

Chance of a headshot aiming at the exact centre of the visual head, enemy at distance 15 and y = 1.09 [M]:

| Weapon and refresh | T0 | T1 | T2 |
|---|---|---|---|
| SMG or shotgun, 60 Hz | 65.6% | 58.1% | 50.6% |
| SMG or shotgun, 120 Hz | 31.0% | 16.0% | 2.1% |
| SMG or shotgun, 144 Hz | 17.2% | 0% | 0% |
| SMG or shotgun, 60 Hz in SLOWMO | **0%** | **0%** | **0%** |
| Autocannon, 60 Hz | 53.2% | 52.5% | 60.7% |
| Autocannon, 120 Hz | 65.8% | 57.6% | 51.6% |
| Autocannon, 60 Hz in SLOWMO | 31.1% | 15.7% | 1.9% |

All remaining shots counted as body hits, none missed. I checked the model against the real game loop at four settings and it agreed within 2.4 points (for example T0 at 60 Hz: 65.6 modelled, 68.0 real).

Because SLOWMO is earned with headshots, this means the reward for three headshots switches off regular headshots for its 5 s duration.

For a fixed distance and steady frame rate, the outcome is deterministic. A dead-centre shot from one spot can register as a body hit every time, while the same shot from 0.4 units away connects with the head [M].

### Where the zones really are

Chance by aim height, T0 on the floor at 60 Hz [M]:

| Aim y | What is visually there | Head | Body | Miss |
|---|---|---|---|---|
| 0.8 | Torso | 0% | 100% | 0% |
| 1.1 | Upper torso | 51% | 49% | 0% |
| 1.4 | Top of torso | 58% | 42% | 0% |
| 1.7 | Head | 62% | 38% | 0% |
| 2.0 | Air above head | 52% | 48% | 0% |
| 2.3 | Air | 0% | 57% | 43% |

On T2 the head zone runs from y 0.5 to 2.3, which covers most of its torso. Its body sphere tops out at 3.6 while the model ends at 2.06, so 1.5 units of empty air counts as a body hit.

---

## 8. Damage and kill handling

Regular bullet damage is `bullet.damage`, doubled for a headshot (8331-8337). `bullet.damage` already includes `getDamageMultiplier()`, which is 2.0 under Blood Thirst and 1.0 otherwise. BERSERK does not change damage in the code.

A headshot is lethal when `bullet.damage * 2 >= enemy.hp`:

| Weapon | Lethal at HP | With Blood Thirst |
|---|---|---|
| SMG | 50 or less | 100 or less |
| Shotgun pellet | 40 or less | 80 or less |
| Autocannon | Always (`takeDamage(99999)`) | Always |

All kill paths:

| Path | Lines | Death calls | Body result | Extra effects | Score | Credited |
|---|---|---|---|---|---|---|
| Bullet to body | 8369, 8430 | `takeDamage`, `destroy()` | Double ragdoll | Death sounds only | Type score | Yes |
| Shotgun to body | same | same | Double ragdoll | Blood burst, at any range (bug) | Type score | Yes |
| Bullet to head, lethal | same | same | Double ragdoll, head stays on | Blood burst, 90 particles total | Type + 50 | Yes |
| Shotgun to head, lethal | 8383-8396 | `takeDamage` | Single ragdoll, head hidden | Exception mid-kill | **+50 only** | **No** |
| Autocannon to head | 8245-8299 | `takeDamage` | Single ragdoll, head hidden | Exception, shell flies on | **+50 only** | **No** |
| Autocannon blast | 7754-7760 | `takeDamage`, `destroy(5, pos)` | Ragdoll + dismember | 120 blood particles | Type score | Yes |
| Rocket, Hellfire, airstrike | 7861-7874 | `takeDamage`, `destroy(10, pos)` | Ragdoll + dismember | 120 blood particles | Type score | Yes |
| Sword combo | 4913 | `takeDamage` | Single ragdoll | Blood burst if damage is 100+ | Type score | Yes |
| Sword area | 4744 | `takeDamage` | Single ragdoll | 30 particles `0xff0000` | Type score | Yes |
| Heavy finisher | 4614-4618 | `destroy(10, pos)` only | **Clean dismember** | 120 blood particles | Type x 2 | Yes |

"Credited" means `addScore`, `addKill`, `registerKill`, the feed line and the 30% pickup roll. Enemies that skip this are still removed by the main loop at 8516, so waves progress normally. Bullet and sword combo kills play `enemyDie` (0.5) plus a 1 in 6 `enemyDeathGrunt` (0.5). Explosive and area kills play `enemyDie` only.

### How exceptions behave here

`animate()` schedules the next frame first (8648), so the game survives an uncaught error. The error skips everything left in `updateGame` plus the minimap and `renderer.render` for that frame: remaining bullets, enemy updates, enemy bullets, pickups, the wave system and particles. The player sees one repeated frame. Only `createDismemberment` is protected by `try/catch` (4927, 8406). The direct `createBloodJet` and `createHeadRemoval` calls are not.

---

## 9. Headshots: why they feel so good

Sounds below show the raw value from the sound table. The master volume of 0.5 is multiplied in at creation, so a 0.75 sound actually plays at 0.375.

### Exact stack for a lethal SMG headshot

Everything happens in **one frame** [M], in this order:

| # | Event | Detail |
|---|---|---|
| 1 | Yellow burst at head | 20 spheres `0xffff00`, r 0.1 |
| 2 | Triple sound | `enemyHeadshot` 0.75, `enemyHeadshot2` 0.5625, `enemyHeadshot3` 0.75 (starts 1.0 s into the file to skip silence) |
| 3 | Score | +50 and feed line `HEADSHOT! +50` |
| 4 | SLOWMO counter | `registerHeadshot()` |
| 5 | Death | `takeDamage`, health bar removed, ragdoll 1 starts |
| 6 | Death sounds | `enemyDie` 0.5, then 1 in 6 `enemyDeathGrunt` 0.5 |
| 7 | Blood burst | 25 x `0xcc0000`, 15 x `0x880000`, 30-droplet jet, then the caught exception |
| 8 | Kill credit | Type score, feed line `Enemy eliminated +N`, kill and combo counters |
| 9 | Pickup roll | 30% chance, 50/50 health or ammo |
| 10 | Second `destroy()` | Ragdoll 2 starts |

Then over time at 60 Hz:

| Time | What the player sees |
|---|---|
| 0 s | All of the above |
| 0.19 s | Corpse has finished moving [M] |
| 0.4 s | Both feed lines fully slid in |
| 0.8-1.2 s | Blood jet droplets shrink away |
| 1.0 s | Yellow and red bursts gone |
| 2.27 s | Corpse starts to fade [M] |
| 2.52 s | Corpse removed [M] |
| 4.0 s | Feed lines gone |

### Compared with other hits

| Event | Particles | Sound total (raw) | Feed lines | Score |
|---|---|---|---|---|
| Body hit | 15 `0xff4444` | 0.4, plus 10% chance of a 0.4 grunt | 0 | 0 |
| Body kill | 15 | 0.9 | 1 | Type |
| **Lethal headshot** | **90** | **2.56** | **2** | **Type + 50** |

### Why it works

1. **Big contrast.** A headshot kill has 6x the particles of a body hit and over 6x the summed sound level, and they land together. The summed figure is a rough guide because the samples are not available to measure.
2. **Colour coding.** Yellow is reserved for this moment among enemy impacts. Every other hit is red, so a headshot reads instantly even in a crowd.
3. **It always means a kill.** Because of the exception, the feed never says "HEADSHOT" unless the enemy died. Interpretation: this accidental rule gives the word real weight.
4. **The numbers line up.** SMG 25 x 2 = 50, exactly T0's HP. Every enemy in waves 1-2 and 42% after that die to one headshot, at 20 rounds per second.
5. **Zero delay.** Sound, particles, text and death all arrive in the same frame as the hit. Nothing waits on an animation.
6. **The body drops immediately.** The double ragdoll finishes in 0.19 s, against 0.31 s for a single one, and leaves the corpse tilted further (median 44 degrees vs 28) [M]. This applies to all bullet kills, and it is an accident.
7. **Forgiving hit zone.** It is 1.8x the visual radius and extends down into the upper torso, so shots slightly off still count.
8. **Uncertainty.** At 60 Hz, about half to two thirds of well-aimed head shots register, and the rest are ordinary body hits. Interpretation: an unpredictable reward can make a hit feel better, though it may equally read as unfairness to a sharp-eyed player.
9. **Two score lines.** Separate +50 and +100 entries stack in the feed (150-250 total).
10. **Long-term hook.** Three lethal headshots within 3 s triggers SLOWMO: 25% time scale for 5 s, audio rate 0.25, `perkSlowmo` (0.8) and a cyan banner.

### What it does not use

Worth stating, because a sequel might assume otherwise. A single headshot has **no** screen shake, hit-stop, time-scale change, FOV kick or hit marker, and no decapitation on the SMG. The README's "hit markers" do not exist. The only shake at that moment is the gun's own firing shake (0.004).

### The other headshot cases

**Non-lethal headshot** (for example SMG on a full-HP T1 or T2):

1. Yellow burst and the triple sound play.
2. `createBloodJet` adds 30 droplets and throws.
3. Damage, +50, the feed line and the SLOWMO count are all skipped, and the bullet is not released.
4. Next frame the bullet moves on. It either triggers again, becomes a body hit, or leaves.

Measured on T2 [M]:

| Start offset | Headshot triggers | Dropped renders | Particles | HP after |
|---|---|---|---|---|
| 0.4 | 2 | 2 | 100 | **100, no damage at all** |
| 0.8 | 1 | 1 | 65 | 75, from a body hit next frame |

So T1 and T2 take no damage from head samples. They only die after enough body samples bring them into lethal range.

SMG held on the head at 20 rounds per second, perfect aim, distance 15 [M]. Shots fired includes about 3 still in the air at the moment of death, and time includes about 0.15 s of bullet flight:

| Target | Refresh | Shots fired | Time to kill | Head triggers | Chance of +50 | Dropped renders |
|---|---|---|---|---|---|---|
| T0 | 60 Hz | 3.4 | 0.15 s | 0.8 | 85% | 0 |
| T1 | 60 Hz | 4.9 | 0.23 s | 1.6 | 80% | 0.8 |
| T2 | 60 Hz | 6.2 | 0.29 s | 2.5 | 72% | 1.8 |
| T0 | 120 Hz | 3.7 | 0.17 s | 0.5 | 47% | 0 |
| T1 | 120 Hz | 4.8 | 0.23 s | 0.8 | 39% | 0.4 |
| T2 | 120 Hz | 6.0 | 0.28 s | 0.2 | 2% | 0.2 |

The SMG fires so fast that the wasted head samples barely slow a kill. At 60 Hz, a T2 kill usually still ends on a lethal headshot, after about 2.5 big effects. That means strong enemies get a run of yellow bursts and triple sounds as you hose them, which adds to the feel even though most of those hits do nothing.

**Shotgun.** The decapitation is real but broken. `createHeadRemoval` hides the head and adds 3 chunks, 5 mist particles and 30 droplets, then throws **inside the kill block**. The enemy dies with the +50 awarded and no kill credit, no feed line, no combo count and no pickup.

A pellet does 40 to the head, which does not kill a full-HP T0 (50). A head sample therefore does nothing, and the pellets stay grouped closely at short range. This makes close shotgun shots all-or-nothing [M]:

| Target | Distance | Killed | Credited | Decapitated | Average HP of survivors | Dropped renders per shot |
|---|---|---|---|---|---|---|
| T0 | 6 | 56.3% | 53.3% | 3.0% | 49.9 | 2.65 |
| T0 | 10 | 55.0% | 43.0% | 12.0% | 49.5 | 2.91 |
| T0 | 15 | 91.2% | 44.7% | 46.5% | 41.7 | 1.51 |
| T1 | 10 | 71.3% | 53.0% | 18.3% | 74.3 | 2.21 |
| T2 | 10 | 86.0% | 55.7% | 30.3% | 78.3 | 2.45 |

Each row is 600 volleys of 6 pellets at 60 Hz, aimed at the head, using the game's spread formula. Enemy y was 0.4 under 13 units and 1.0 beyond.

At 6 units, 44% of head-aimed volleys left a T0 alive with effectively no damage. Decapitated and credited add up to killed in every row, so **every decapitation in this test earned no kill credit**. Aiming at the body is more reliable than aiming at the head.

**Autocannon.** Head hits always kill, and the head is hidden, but the exception skips the shell's explosion, `enemyDie`, kill credit and pickup. The shell stays live and flies on. In one test it passed through the head at frame 5 and exploded on the ground 72 units further on at frame 26 [M].

---

## 10. Ragdoll

`createRagdoll` (2552) and `simulateRagdollWithJoints` (2639). This is not a real ragdoll: the whole enemy stays one rigid group that rotates around its **feet**, while limbs spin on the spot around their own centres inside it.

| Parameter | Value |
|---|---|
| Start velocity | x, z ±1.5, y 0.5 to 2.0 |
| Start spin | ±4 rad/s per axis |
| Lifetime | 5 s |
| Gravity | -9.8 |
| Linear damping | 0.99 per step |
| Spin damping | 0.9405 per step (0.99 x 0.95) |
| Joint damping | 0.96 per step |
| Ground | y = 0: `vy *= -0.2`, `vx, vz *= 0.6`, spin x 0.7, joints x 0.5 |
| Fade | Last 0.5 s, `opacity = lifetime * 2` |
| Timestep | Fixed 1/60 per `requestAnimationFrame` |

Joint limits (start speed in rad/s, limit in radians):

| Joint | Start speed x, y, z | Limit x, y, z |
|---|---|---|
| Arms | ±4, 0, ±4 | PI/2, 0, PI/3 |
| Legs | ±3, 0, ±2 | PI/3, 0, PI/6 |
| Head | ±2 each | PI/4 each |

Arms also get a tiny gravity term: `joint.angularVel.z += -9.8 * 0.05 * dt`.

Measured at 60 Hz over many seeds [M]:

| Case | Rise | Settled by | Removed at | Median tilt | Tilt 90th percentile | Lying flat (over 70 degrees) |
|---|---|---|---|---|---|---|
| Single (sword kills) | 0.06 | 0.31 s | 5.02 s | 28 degrees | 50 degrees | 0% |
| Double (bullet kills) | 0.12 | 0.19 s | 2.52 s | 44 degrees | 71 degrees | 10% |

Enemies almost never fall over. They twitch into a frozen lean and stay standing, then fade. Only the group origin touches the ground, so rotated bodies can clip through the floor.

**Why double is faster.** Each loop steps every entry in the shared array. Two bodies and two loops means four integrations of the same mesh per frame, and each body's lifetime falls twice per frame. Effective gravity is about 8x at 60 Hz (78 u/s²), by calculation.

**Refresh rate.** The fixed 1/60 step per frame means a 120 Hz display runs ragdolls at double speed: single removal at 2.51 s, double at 1.26 s [M].

**Time.** These loops ignore pause and SLOWMO. Corpses keep moving while paused, and run at full speed in SLOWMO while blood slows down. On restart, `clearEnemies` calls `destroy()`, so all remaining enemies ragdoll into the new game.

---

## 11. Dismemberment: why it is janky

Two different things share this name.

| Function | Lines | What it does |
|---|---|---|
| `Enemy.dismember` | 2753-2832 | The real one: detaches body parts. Only reached through `destroy(force, pos)`, so explosions and the heavy finisher only |
| `ParticleSystem.createDismemberment` | 1736-1958 | A blood burst. Nothing is removed from the enemy. The real giblet code below its `return` is commented out as "DISABLED DUE TO CRASHES" |

Interpretation: those crashes may have been this same `safePosition` bug, because the disabled code also calls `createBloodJet`. Nothing proves that, and it was never retested.

### What `Enemy.dismember` intends

1. Remove the group from the scene.
2. Fire 3 blood jets from `position + (0, 1, 0)` away from the blast, with direction jitter of ±0.15 on x, z and +0-0.3 on y. Each is 40 particles, so 120 in total.
3. 50% chance to set `shouldPlayExplodeSound` (`enemyExplode`, 0.5).
4. For each of the 6 parts: take its world position, then move it from the group to the scene.
5. Launch each part at `direction * force + (0, force * 0.5, 0)`, where `force = F * max(0, 1 - distance / 10)`, with spin up to ±`force` rad/s per axis.
6. Lifetime 5 s, blood trail on, simulated by `simulateRagdollParts`.

`simulateRagdollParts` (2834-2952): gravity -9.8, linear damping 0.98, spin damping 0.931, ground `vy *= -0.3`, `vx, vz *= 0.7`, spin x 0.8, fade over the last 1 s.

Blood trail: below 1 u/s nothing emits. The interval is `max(0.03, 0.1 - speed * 0.01)`. Each emission is 3 droplets above 5 u/s and otherwise 2, with velocity `part.velocity * (-0.2 to -0.1)`. Emission stops entirely once 400 particles are live.

### What actually happens

Explosive kills run this order, and it causes most of the jank:

```
takeDamage(blast)   -> hp <= 0 -> destroy()         -> createRagdoll()  -> loop A starts
destroy(10, pos)                                    -> dismember()      -> loop B starts
```

`ragdollParts` now holds 7 entries (the hidden whole body plus 6 parts) and **both loops process all of them**.

| # | Cause | What the player sees | Lines |
|---|---|---|---|
| 1 | Two solvers on one array | Parts move at double speed, gravity is about 4x (by calculation), lifetime halves | 2536-2541, 7861-7874 |
| 2 | Hidden ragdoll entry keeps applying joint limits to `this.bodyParts`, which are now the flying parts | Limbs do not tumble. They snap to the limit and lock: arm rotation ends at exactly `(1.57, 0, -1.05)` = `(PI/2, 0, -PI/3)` [M] | 2665-2680 |
| 3 | Loop B reads `.material` on the group, which has none | Uncaught `TypeError` per enemy at about 2.0 s, and loop B dies [M]. Parts are removed at 3.0 s instead of 5.0 s [M] | 2914 |
| 4 | Group rotation is not copied to parts | On the blast frame every part snaps to world-axis orientation, losing the facing direction | 2807 |
| 5 | Parts are clamped by centre to y = 0 | Each part ends half sunk in the floor. A torso is half buried | 2897 |
| 6 | Force is tiny and hits zero at distance 10 | Blood at 20-30 u/s leaves limbs behind. Far from the blast, the body just collapses in place | 2803 |
| 7 | Limbs are plain boxes | No stumps or wound caps, gun stays on the arm, no flesh inside | 2146-2189 |
| 8 | Parts stop dead after landing | Everything is motionless by about 1 s, then waits for a fade | |
| 9 | Fixed step per frame | Speed changes with refresh rate, and ignores pause and SLOWMO. Blood slows in SLOWMO, limbs do not | 2848 |
| 10 | No pooling and a new geometry and material per particle | About 130 allocations per enemy in one frame, plus a `console.warn` pair per particle. Hitching is likely, but I did not time it in a browser | 1509-1552 |
| 11 | Blood trail gate at 400 particles | Trails vanish in multi-kills, when they would matter most. A 4-enemy rocket kill made 601 particles and **0** trail droplets [M] | 2866 |
| 12 | Only `isGiblet` particles collide | All blood falls through the floor. There are no decals or pools | 1996 |

Measured blast results for T0 with F = 10 [M]:

| Case | Torso rise | Head rise | Slide | Tumble | Trail droplets | Removed at |
|---|---|---|---|---|---|---|
| Rocket, 1 unit away | +1.6 | +3.0 | 5.4-7.0 | Limbs locked at joint limits | 226 | 3.0 s |
| Heavy finisher, 1 unit (clean path) | +1.5 | +2.7 | 5.0-6.0 | Free | 350 | 5.0 s |
| Rocket, 7.5 units | +0.07 | +0.08 | 1.1-1.4 | Barely | 38 | 3.0 s |
| Hellfire, 12 units | 0 | 0 | 0 | Twitch only | 22 | 3.0 s |

Force by source:

| Source | F | Radius | Force at edge |
|---|---|---|---|
| Rocket | 10 | 8 | 2.0 |
| Enemy rocket | 10 | 5 | 5.0 |
| Hellfire bullet | 10 | 2 | 8.0 |
| Hellfire rocket | 10 | 20 | **0** beyond 10 units |
| Airstrike rocket | 10 | 6 | 4.0 |
| 30 mm shell | 5 | 5 | 2.5 |
| Heavy finisher | 10 | 8 | 2.0 |

The biggest explosion in the game therefore produces the weakest dismemberment over most of its area.

The heavy finisher is the only clean path because it sets `hp = 0` and calls `destroy` once. That proves the system mostly works when run alone, though problems 4-12 still apply to it. In that path the gun and eyes also never fade or get disposed, because loop B only touches `part.mesh`.

---

## 12. Gore particle reference

All are individual meshes with a new geometry and material. Common update rules (1960-2044):

- `alpha = life / maxLife`, applied to `opacity`. This overwrites any starting opacity, so stated values like 0.6 are lost after the first frame.
- Particles without `isMist`, `isGiblet` or `isBlood` also shrink: `scale = alpha`.
- Default gravity is -20.
- Only `isGiblet` collides with the ground, at y = 0.2.

| Emitter | Count | Size (r) | Colour | Velocity | Life | Gravity |
|---|---|---|---|---|---|---|
| `createExplosion` | Argument | 0.1 | Argument | x, z ±5, y 0-10 | 1.0 | -20 |
| `createBloodJet` droplets | 30 | 0.08-0.20 | `0xcc0000` | `dir * 15`, x, z ±1.5, y +0-5 | 0.8-1.2 | -15 |
| `createBloodJet` mist (never runs) | 10 | 0.15 | `0xff4444` | `dir * 7.5`, x, z ±2.5, y +0-3 | 0.4 | -20 |
| `createMassiveBloodSpurt` | 40 | First 10: 0.15-0.30, rest 0.08-0.16 | First 5 `0xff0000`, rest `0xcc0000` | `dir * 20`, x, z ±4, y +0-10, first 5 x1.5 | 1.0-2.0 | -20 |
| `createBloodDroplet` | 1 | 0.08-0.20 | 30% `0xff0000`, else `0xcc0000` | Passed in | 1.5-2.0 | -12 |
| `createHeadRemoval` chunks | 3 | 0.26-0.37 | `0xffaa88`, `0x992222`, `0xcc0000` | x, z ±3, y 2-6, plus `dir * 5` | 3.0 | -30 |
| `createHeadRemoval` mist | 5 | 0.2-0.4 | `0x660000` | x, z ±1.5, y 1-3 | 0.6 | -20 |
| `createLingeringBloodMist` (unused) | 8 sprites | Scale 0.5-0.8 | `0x990000`, `0x660000` | 1.5-3 outward | 1.5-3.0 | 0 |

Head chunks: a flattened sphere (scale 1, 0.8, 0.7), a box (0.8, 1.2, 0.6 of size), and a 3x3 sphere (0.9 of size). They spin at ±2.5 rad/s with x0.98 per tick, and bounce with `vy *= -0.4`, `vx, vz *= 0.7`.

`createDismemberment` as it actually runs: explosions of 25 x `0xcc0000` and 15 x `0x880000`, then one jet, then the exception. The side spray, upward headshot jet, and `'explosive'` delayed burst never execute.

---

## 13. Pickups

Class at 2960-3023. Handling at 8588-8627.

| Property | Health | Ammo |
|---|---|---|
| Mesh | Box 0.8 x 0.8 x 0.2 | Box 0.6 x 1.2 x 0.6 |
| Colour (unlit) | `0x00ff00` | `0xffff00` |
| Effect | `heal(30)`, capped at max HP | Reserve +30, capped at 120 |
| Feed text | `Health restored +30` | `Ammo collected +30` |

| Rule | Value |
|---|---|
| Spin | 2 rad/s |
| Bob | `sin(time * 3) * 0.3`, random start phase |
| Collect radius | Under 2, 3D, measured to the player's eye |
| Kill drop | 30% chance, 50/50 type, at `enemy.position` |
| Timed spawn | Every 10 s if fewer than 3 exist, 70% chance, 60% ammo / 40% health |
| Timed spawn position | x, z in ±40, y = 1, no wall check |
| Despawn | **Never** |
| Time scale | Unscaled, so unaffected by SLOWMO |
| Minimap | Yellow dot r 1.5 for both types |

Pickup sound (606-625, procedural): sine stepped 400 Hz, then 800 at 0.1 s, then 1200 at 0.2 s. Gain 0.15 decaying exponentially to 0.001 over 0.3 s.

Behaviour worth knowing:

- Pickups are always consumed, even at full health or full ammo.
- Because the check is 3D to eye height, reach varies by height:

| Pickup base y | Standing (eye 1.8) | Crouched (eye 0.9) |
|---|---|---|
| 1.0 | 1.83 | 2.00 |
| 0 | 0.87 | 1.79 |

- Kill drops inherit enemy Y, so they can hang in mid-air (y about 1.09) or spawn underground. A drop far enough below the floor can never be collected, and it permanently counts toward the limit of 3, which starves the timed spawner.
- Kill drops are not capped, so more than 3 pickups can exist at once.

---

## 14. Full bug list

Severity reflects impact on play.

| # | Severity | Bug | Lines | Effect |
|---|---|---|---|---|
| 1 | Critical | `safePosition` undefined in `createBloodJet` | 1496 | See sections 8, 9 and 12 |
| 2 | Critical | Head sphere inside body sphere | 8205-8236 | Frame-rate dependent headshots |
| 3 | Critical | SLOWMO step is thinner than the shell | 8170 | No regular headshots in SLOWMO |
| 4 | High | `destroy()` has no re-entry guard | 2506, 8430 | Double ragdoll |
| 5 | High | Ragdoll started before dismember | 7861-7874, 7754-7760 | Two solvers, locked limbs |
| 6 | High | `.material` read on a Group | 2914 | Uncaught `TypeError` per explosive kill |
| 7 | High | `this.onWaveComplete` does not exist | 7786 | Any shell explosion with no enemies left throws, before the bullet is released. The bullet stays in the pool's active list forever [M] |
| 8 | High | Enemy movement is 3D with no Y clamp | 2284-2302 | Floating and burying |
| 9 | Medium | Shotgun range check uses distance from bullet to enemy, not from player | 8399-8402 | Always true, so body kills burst at any range [M: 30 units] |
| 10 | Medium | Enemy cooldowns use wall clock | 2353 | Full fire rate in SLOWMO |
| 11 | Medium | Wave spawns use wall clock | 6974 | SLOWMO does not slow spawns, and `deltaTime` is ignored |
| 12 | Medium | Ragdoll physics on a separate `requestAnimationFrame` loop | 2645, 2845 | Tied to refresh rate, ignores pause and SLOWMO |
| 13 | Medium | No enemy collision or line of sight | 2271 | Walks through walls and fires into them |
| 14 | Medium | Enemy rocket routed through self-damage | 7902 | 30 becomes at most 15 |
| 15 | Medium | Area sword knockback changes `enemy.position` only | 4736 | Death particles and drops appear 10 units from the corpse |
| 16 | Low | Y offsets not scaled by size | 2148-2186 | Squashed large enemies |
| 17 | Low | Eyes inside head | 2202 | Invisible |
| 18 | Low | Limbs pivot at centre | 2146-2189 | Limbs swing around their middles |
| 19 | Low | `emissive` passed to `MeshBasicMaterial` | 1358, 1522, 1569, 2195 | Two `console.warn` per particle: 754 in one rocket kill, 1268 in a 4-kill [M] |
| 20 | Low | `createHeadRemoval` chunks have no `bounces` or `maxBounces` | 2014 | `NaN` counter, so chunks never settle |
| 21 | Low | No `continue` after enemy bullet hits player | 8555-8566 | Possible stray puff and hit sound |
| 22 | Low | `clearEnemies` uses `destroy()` | 7708 | Old enemies ragdoll into a new game |
| 23 | Low | Blood jet direction uses the sample point | 8349, 8411 | Spray often goes toward the shooter rather than out the far side |

## 15. Dead code

| Item | Lines | Why dead |
|---|---|---|
| `Enemy.attack`, `canAttack`, `lastAttackTime`, `attackCooldown`, `damage` | 2068, 2074-2075, 2513-2520 | Never called. There is no melee |
| `getDistanceToPlayer` | 2954 | Never called |
| `this.enemyBullets` | 2123 | Never used |
| All `!isRanged` branches | 2194, 2326 | `isRanged` is always true |
| `enemy.headshotKilled` | 8297 | Written, never read, and after the throw anyway |
| Autocannon headshot kill block after `createHeadRemoval` | 8278-8297 | Unreachable because of the throw |
| `createDismemberment` code after the first jet | 1754-1766 | Unreachable because of the throw |
| Original giblet code | 1770-1957 | Commented out |
| `finalDamage >= 150` | 8403 | Unreachable. Maximum is SMG 25 x 2 x 2 = 100, and shells and rockets exit earlier |
| `createLingeringBloodMist` | 1589 | Only caller commented out at 7869 |
| `createMuzzleFlash` for enemies | 2482 | Commented out |

## 16. Docs vs reality

| Claim | Where | Reality |
|---|---|---|
| "Advanced enemy AI with pathfinding" | README | Straight line through walls |
| "Enemies deal contact damage" | README | No melee exists |
| "Elite: faster and more aggressive" | README | Slowest type, same damage |
| "Health pickups restore 25 HP" | README | 30 |
| "Crosshair with hit markers" | README | None exist |
| "Object pooling for bullets and particles" | README | Bullets only |
| "BERSERK 5x damage" | README | No damage bonus in the code |
| "Audio pitch modulation" in SLOWMO | README | Sets `playbackRate` 0.25. `preservesPitch` is never set and browsers default it to true, so expect slowed audio rather than lowered pitch. Not tested |
| "Collect pickups quickly before they disappear" | In-game guide | They never disappear |
| "Headshots decapitate" | In-game guide | True visually, but with no kill credit |

---

## 17. Notes for the sequel

Keep these, because they carry the feel:

- All hit feedback on the same frame, with no waiting on animation.
- Three layered sounds for a headshot, and a large contrast against body hits.
- Yellow reserved for headshots.
- 25 x 2 = 50 HP style thresholds where one headshot exactly kills the basic enemy.
- A decisive, fast corpse response. Tune this deliberately rather than relying on a double-update bug.
- Slow, dodgeable, straight-fired projectiles, with a near-miss whizz at 3 units.
- Two feed lines for a headshot kill.

Decide deliberately, because these are accidents today:

- **Should non-lethal headshots exist?** The current game hides them, so "HEADSHOT" always means a kill. Fixing the bug naively makes the message appear on non-kills and adds real double damage, which changes both balance and feel. T1 and T2 would die much faster.
- **Headshot rate.** A swept test with the head checked first will make every aimed headshot land, much more than today's 50-66%. Consider tightening the hit radius from 1.8x visual.
- **Corpse timing.** To match current bullet kills, target about 0.2 s to settle and 2.5 s to removal.

Fix these by design:

- Use swept or ray tests for bullets, independent of frame rate and time scale.
- Run all physics in the main fixed-step loop, respecting pause and time scale.
- Have one death path with a guard, chosen once: ragdoll or dismember, never both.
- Bake world transforms when detaching parts, and give parts real collision extents.
- Build limbs on pivot groups at shoulders and hips, and scale all offsets with size.
- Clamp enemies to the ground and give them collision, line of sight and separation.
- Pool particles and share geometry and materials.
- Make dismember force scale with blast radius, so the biggest blast is also the most violent.
- Add blood floor collision or decals, and stumps on detached limbs.
- Add wave scaling beyond count, since today nothing changes after wave 20.
