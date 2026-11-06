# Weapons and combat

`src/weapons/**` except `viewmodels/`, sandbox at `/?sandbox=range`. `createCombat(ctx)` and `createWeapons(ctx)` from `src/weapons/index.ts`.

| File | What it is |
|---|---|
| `data.ts` | Every number. `WEAPONS`, `TUNING`, `SWORD`, `EXPLOSIONS`, `HIT_STOP`. Tune here; the code reads this and nothing else |
| `Weapons.ts` | Input to shots: fire modes, reload, scope, grenades, ammo fallbacks. All on `time.playerDt` |
| `Sword.ts` | The chain, wind-up, sweep, finisher, guard, lunge, slices |
| `Combat.ts` | Hit resolution: rays, `strike` (the one door to `enemies.applyDamage`), blasts, the blast queue |
| `Projectiles.ts`, `ProjectileVisuals.ts` | Swept projectiles, 256 pool, oldest out. One InstancedMesh per shape |
| `Flames.ts` | The invisible bodies inside the fire you see. 160 pool |
| `Feel.ts` | Shake units and hit-stop pacing |

## Using it

```ts
ctx.combat.fireRay(origin, dir, { damage: 40, source: 'sentinel', team: 'player', tracer: 'bullet' });  // ShotResult
ctx.combat.spawnProjectile({ origin, velocity, kind: 'rocket', team: 'enemy', damage, source, explosion: {...} });
ctx.combat.explode(point, { radius: 8, damage: 100, kind: 'rocket', source: 'airstrike', team: 'player' });
ctx.combat.enemyMuzzle(muzzle, dir, 'enemy');

ctx.weapons.give('lance');          // unlocks, or tops up 50% of max reserve if already owned
ctx.weapons.addAmmo(0.25);          // fraction of max reserve, every weapon
ctx.weapons.modifiers.damage = 2;   // progression rewrites all of these every frame, so write them there, not here
```

Rules for callers:

- **`explode` may be deferred.** Called from inside a blast (a kill setting off a tank) it queues for 70 ms, so a stack ripples and the blast in progress keeps its scratch. Queue is capped at 48.
- **A blast damages first, then throws.** `blast` calls `physics.radialImpulse` after `blastEnemies`, so what it kills is thrown with what was already dead.
- `team` on a blast decides self-damage rules. `team: 'player'` caps damage to the player at the table's `selfCap`. Enemy blasts are not capped.
- `ShotResult` and `ExplosionSpec` objects are reused. Read them straight away.
- Enemy shots go through the sword's guard automatically, in `fireRay` and in projectile sweeps.

## Contract additions

All additive, in `src/core/gameplay.ts`.

- `ShotResult.kills`, enemies killed by this shot.
- `ShotSpec.cleave`, kills split along the line of the shot, up to this many.
- `ExplosionSpec.worldObject`, set by combat's own `world:explosion` handler. Skips FX, sound and neighbour damage, because the world did those.

Also `Combat.wakeCorpse(hit, dir)` on the concrete class, for projectiles.

One change outside this system: `Player.rideGround` in `src/player/Player.ts` adds `world.objects.platformVelocity` to position while grounded, swept so a wall stops it. Added to position rather than velocity, so the deck's speed never reads as the player's own. `docs/notes/player.md` and `world.md` still say moving geometry does not carry the player; their owners should drop that line. `Weapons.ts` also imports the plain `MOVE` table from `src/player/tuning.ts`.

## How things work

**Muzzle flash.** `fx.muzzleFlash` lifts a flash near the camera into the view scene through `render.camera`, which `CameraRig` has not moved yet when weapons run, while `viewmodel.muzzle` is already placed for the player's new pose. So the flash was off by one frame of motion. That was the star in `playtest-t45.png`. It was the player's own gun, not an enemy: the star was yellow with 5 points and one petal, which is the `smg` recipe, and enemies use red-orange.

`Weapons.flashPoint` hands fx the muzzle's offset applied to the camera as it stands, so fx's lift lands exactly on the gun. **The `view` parameter is not the fix on its own**: with `view` true, `muzzleFlash` still uses `position` for the light, wisp and sparks, so they appear at view-scene coordinates, near the world origin. `flashPoint` undoes the same maths as the rig's private `toWorld`, using the pose `Weapons.update` records for it. If `toWorld` changes, this drifts by a few centimeters of bob rather than breaking.

Pixels from the gun at 1280x720, median / max, from `RL_GROUP=view`. Old is the world point passed straight to fx.

| Motion | Speed | Flash, old | Flash, now | Tracer start | Casing start |
|---|---|---|---|---|---|
| Still | 0 | 0 / 0 | 0 / 0 | 1.6 / 4.2 | 3.3 / 8.4 |
| Running | 12.5 | 42 / 53 | 0 / 0 | 4.5 / 6.9 | 9.8 / 11.9 |
| Strafing | 12.5 | 197 / 299 | 0 / 0 | 3.9 / 5.9 | 7.3 / 14 |
| Strafing and flicking | 12.5 | 163 / 285 | 0 / 0 | 5.8 / 11 | 8.6 / 17 |
| In the air | 30 | 406 / 477 | 0 / 0 | 3.9 / 70 | 10.6 / 91 |

12.5 m/s is the run speed since DESIGN section 13. An earlier run under the old 17 m/s tuning gave 223 / 363 old while strafing at 15 m/s. The 70 and 91 px in the air are single samples out of 7, and I did not find their cause. A landing frame's camera dip is my guess.

**Slash crescents.** The cut runs on the true swing plane, which is what `gore.slice` gets. But that plane contains the eye, so a crescent drawn on it is an invisible hairline from first person. `Sword.crescent` turns the drawn plane about the blade's direction, with its apex crossing the view. The trail you see is therefore not exactly where the cut is.

**Hit-stop.** `Feel.stop` drops any stop within `HIT_STOP.minGap` of the last, unless forced, so automatic fire does not stutter. `time.hitStop` takes the longest, so stops do not add up.

**Ammo.** The guns can run dry, the player cannot. In order:

1. A gun that empties plays the dry click and hands over after 0.2 s, by `TUNING.ammo.fallback`. Rockets are last, the sword is the end of the list. Drawing a dry gun on purpose does not bounce you off it; pulling its trigger does.
2. Every sword kill pays half a magazine into the last gun you held, or the gun in hand for a quick melee.
3. Every wave clear lifts each owned gun to 20% of max reserve. It is a floor, so a stocked gun gets nothing.

**Stake pins.** `gore.pin` needs a ragdoll, and a body killed through the head stands in a scripted hold without one. So `Projectiles.nail` ends the hold with `combat.wakeCorpse` and the pin goes in a frame later, for every stake. `pinReach` is 7.5 m because gore drags a bone at 26 m/s for 0.3 s; past that the bone stops short and the body hangs off the wall on nothing.

**Buzzsaw slowdown** is written to velocity, because progression rewrites `modifiers.speed` every frame, after weapons run. The player re-accelerates at 120 Hz between our once-a-frame clamps, so the clamp sits half a frame's regain below the target. It reads `MOVE.runSpeed` and `MOVE.groundAccel` directly, because a copy of those went stale when DESIGN section 13 retuned the ground.

**Lunge.** A dash at 30 m/s for 0.16 s toward the target, renewed every frame and homing on it. A single shove is worth about a meter once ground friction has had it (`15^2 / (2 * stopDecel)`).

**Slices cost about 5 ms each.** A sweep slices 3 kills per frame and the rest ragdoll. A full Lance shot splits the first 3.

Measured over 80 s of the real game, with the bot holding the trigger on the SMG and only collecting what it runs over: reserve fell from 360 to 180 by wave 2, then 5 ammo pickups took it to the 720 cap, across 59 kills and 3 waves. It never went dry. The old wave-2 dry-out came from a 240 reserve running out before the first pickup, with a bot that does not chase drops, so the fix there was the bigger SMG reserve and the fallbacks, not more drops. One pickup is 180 SMG rounds and the economy now leans generous. If that turns out too loose, cut `PICKUP.ammo` in progression before touching the reserves.

## Tuning

| Want | Change |
|---|---|
| Weapon stats, sound, kick, shake | `WEAPONS` row. `kick` is camera radians, `shake` is first-game intensity, `recoil` is viewmodel only |
| Ammo pressure | `reserve`, `maxReserve` per weapon, `TUNING.ammo` |
| Rocket jump | `TUNING.rocket.playerPush`, `selfDamage`. `EXPLOSIONS.rocket.selfCap` |
| Sword | `SWORD.chain[]`, `.area`, `.finisher`, `.lunge`, `.windup` |
| Blast feel | `EXPLOSIONS[kind]`: `shake`, `shakeRange`, `edgeDamage`, `gibZone`, `impulse`, `selfCap` |
| Push on bodies | `force` in each `WEAPONS` row, `TUNING.shotgun.pointBlankForce`, `TUNING.blastForce`, `EXPLOSIONS[kind].impulse`. Bands are in `src/gore/forces.test.ts`, the measured table in `docs/notes/lab.md` |
| Impact | `HIT_STOP`. 30 ms reads as a punch, 100 ms as a stumble |

## Testing

```
/?sandbox=range                 # stepped clock, stand-in enemies, every number exact at 30/60/144 fps
/?sandbox=range&only=sword      # tests whose name contains the text

RL_GROUP=guns node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk,trooper,smg,pistol,brute,minigun" \
  --script tools/scripts/range-live.mjs --wait 1000 --timeout 220 --out tools/out/rl-guns.png
```

`range-live.mjs` is the real game with waves off: real map, real enemies, real gore. Groups are `guns`, `heavy`, `sword`, `perks`, `view`, `world`. `RL_ONLY=a,b` reruns named steps. Kills in these runs trigger real perks, so a later step can be running under Blood Thirst.

## Verified

In the real game against real enemies, with `range-live.mjs`, zero console errors in every run. `/?sandbox=range` passes 167 of 167.

| Thing | Result |
|---|---|
| SMG | Live 18 rps through hit-stops and load, exact 20 at 30/60/144 fps in the range. Reload 1.08 s on the game clock, mag to 30 |
| Headshots | Yellow chips, `headshot` layer, 28 ms stop on a survivor, gore.headshot on a kill |
| Shotgun | Point-blank trooper: 2 limbs severed, then dead. Brute: armour blocked 4 pellets, dead in 5 shots |
| Judge | One headshot, 2 ricochets, 3 dead husks, all counted as headshots |
| Buzzsaw | 49 rps once spun, nothing before 0.44 s, limbs come off a brute. Held 10.3 m/s against a 10.5 target live. That target has since dropped to 7.75 with the run speed, and the new number is only checked in the range |
| Kiln | Trooper burning for 4 s, fire spread to the husk beside it, both died of it |
| Rocket | Trooper at 14 m gibbed. Jump plus rocket in open sky: 16.2 m peak, 13.5 HP. Reloads itself |
| Autocannon | FOV 90 to 30, look scale 0.268, scope overlay up, brute gibbed at 22 m with one shell, all restored on unscope |
| Lance | Full charge through a line: head kill and a body split in two, in one shot |
| Stakegun | Body kill: hanging 1.2 m off the floor, hips 0.16 m from the wall anchor 1.4 s later. Head kill pins. A severed forearm pins |
| Grenades | Thrown, 3 bounces, fuse, blast. Shot out of the air with the SMG |
| Sword chain | 75, 94, 113 damage. Every kill through gore.slice, on planes that follow the swing: lengthwise, diagonal, flat |
| Sweep and finisher | 5 kills in one sweep, 3 slices then ragdolls. Finisher blast 0.20 s after the press, 120 ms stop |
| Lunge | Standing 8.5 m from a brute: 30 m/s peak, 6.2 m covered, swing connected |
| Guard | Trooper firing for 6 s: 6 deflects, 0 damage |
| Quick melee | Sliced a husk from the SMG, gun back in hand, reserve fed exactly 15 |
| Dry guns | SMG ran out, click, hand-over to the only loaded gun. Wave clear lifted reserves to the floor. The sword as last resort is range-tested only |
| Lens blood | Fired on a kill at 3.3 m |
| Blood Thirst | 12 pellets of 40, 12 tracers, mag untouched, one layer sound per pull |
| Hellfire | SMG rounds burst. Rocket killed a brute, trooper and husk 24 m apart with one blast id |
| Berserk | Left 71, right 71, 112 rps live, flash on both muzzles, mag untouched |
| Barrels | One SMG burst chained 9 barrels and killed 4 husks. A rocket chained 3. No doubled fireball or sound |
| Crane | Player rode 6.4 m of deck with 11 cm of drift. Own velocity stays 0 |
| Whole game | `/?autostart=1`, bot cycling all ten slots for 40 s: 2412 frames, no errors, p50 16.7 ms, p99 33.4 ms, max 183 ms under a load average near 40 |

## Known limitations

- **Nobody has played this with hands.** Every result above is a script or a bot. Recoil, shake, stops and the sword's timing need a human pass.
- **Only the SMG has a viewmodel so far.** `viewmodels/models` builds `smg` and `smgLeft`, so every other weapon shows the SMG and fires from its muzzle. Flash and tracer alignment for the other nine is unverified, and so are reload, swing and draw animations.
- **Enemy flashes inside 3 m of the camera** still take fx's lift to the view scene, through the stale camera. They land up to a frame of motion off, on top of the viewmodel. Now that the player's gun does not need that rule, fx could drop it for anything but a `view` flash, once `view` keeps the world parts in world space.
- **Pickup weighting ignores dry guns when the sword is out.** `pickups.ts` reads `weapons.ammo()`, the weapon in hand, and the sword reports no reserve. So a player forced onto the blade gets no extra ammo drops. Sword kills feed the last gun regardless.
- **Buzzsaw slowdown lives on velocity.** A `moveScale` read by progression when it writes `modifiers.speed` would be cleaner, but that is not this system's file.
- **The crane does not pass its speed on.** Jump off a moving deck and you lose its 4 m/s. Riding drifted 11 cm over 6.4 m of travel.
- **The slash crescent is a stand-in for the cut**, tilted so it can be seen. See above.
- **Rockets hit twice on a direct hit**: the contact strike, then the blast. That is deliberate and only shows on targets that survive 100.
- **`fx.chips` on a headshot and gore's own headshot stack both run**, so a head kill has chips, sound and stops from both systems. It reads well, but it is two owners for one moment.
- **A large red disc with a white cross** appears on a brute at 5 m in `rl-heavy-stake-limb.png`. It is not weapons code. `telegraph.glint` in `src/enemies/telegraph.ts` is the likely source, but I did not trace this one. It may be worth a size check at point-blank.
