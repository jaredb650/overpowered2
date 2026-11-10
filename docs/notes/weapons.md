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
| `families.ts` | Which weapons share a number key, and what the key, the wheel and a base weapon's unlock do about it. No state |
| `penetration.ts` | The budget a round spends on walls and bodies, and the probe that measures a wall. Hitscan and projectiles both ask here |
| `testkit.ts` | A firing range for Vitest: the real `Weapons` and `Combat` on real Rapier, stand-in enemies, a stepped clock |

## Using it

```ts
ctx.combat.fireRay(origin, dir, { damage: 40, source: 'sentinel', team: 'player', tracer: 'bullet' });  // ShotResult
ctx.combat.spawnProjectile({ origin, velocity, kind: 'rocket', team: 'enemy', damage, source, explosion: {...} });
ctx.combat.explode(point, { radius: 8, damage: 100, kind: 'rocket', source: 'airstrike', team: 'player' });
ctx.combat.enemyMuzzle(muzzle, dir, 'enemy');

ctx.weapons.give('lance');          // unlocks, or tops up 50% of max reserve if already owned
ctx.weapons.addAmmo(0.25);          // fraction of max reserve, every weapon
ctx.weapons.modifiers.damage = 2;   // progression rewrites all of these every frame, so write them there, not here

ctx.weapons.slotMember(1);          // 'smg' or 'harrow': what key 1 draws now
ctx.combat.fireRay(eye, dir, { damage: 50, source: 'harrow', team: 'player', penetrate: 0.5 });   // through a body or a sheet
ctx.combat.spawnProjectile({ ..., kind: 'bullet', penetrate: 3, bodyCost: 0.2 });                  // the same budget, with travel time
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

- `WeaponId` gains `harrow`, `rivet` and `sabot`. Every `Record<WeaponId, ...>` in the tree has them: `ui/data.ts`, `ui/icons.ts`, `ui/hud/crosshair.ts`.
- `WeaponSystem.slotMember(slot)`, optional so a stand-in weapon system need not have it.
- `ShotSpec.penetrate` was "walls up to this thick" and is now the budget described under Penetration. New beside it: `bodyCost`, `penetrateKeep`, `armorPiercing`, `falloff`, and `penetrateWalls`, which puts a round on the old per-wall rule and is how the Lance keeps it. `ProjectileSpec` gains `penetrate`, `bodyCost` and `armorPiercing`.
- `MuzzleKind` and `TracerKind` gain `carbine`, `pistol` and `sabot`, with rows in `src/fx/recipes/muzzle.ts`.
- `DamageInfo.reach` and `blastKind`, a blast's splash, which is what `src/enemies/blast.ts` rolls on. `DamageInfo.pierces`, a shaped charge's direct hit or an armour-piercing round on a plated body. `DamageInfo.armorPiercing`, an armour-piercing round on any body: `shieldStops` in `src/enemies/damage.ts` reads it and lets the round through a Riot's shield.
- `DecalKind` gains `exit`, the spall crater on the far side of a wall. It took the second bullet-hole cell of the atlas, so `bullet` has one variant now (`src/render/Decals.ts`, `materials/decalAtlas.glsl.ts`).

One change outside this system: `Player.rideGround` in `src/player/Player.ts` adds `world.objects.platformVelocity` to position while grounded, swept so a wall stops it. Added to position rather than velocity, so the deck's speed never reads as the player's own. `docs/notes/player.md` and `world.md` still say moving geometry does not carry the player; their owners should drop that line. `Weapons.ts` also imports the plain `MOVE` table from `src/player/tuning.ts`.

## Rules that must stay true

- **A round with no budget costs nothing.** `loadBudget` sets `left` to 0 and every penetration branch is behind `budget.left > 0`. One world ray per segment, as before: `penetration.test.ts` counts them.
- **One system, two callers.** `Combat.playerRay` and `Projectiles` both hold a `Budget` and call `passBody` and `passWall`. Do not give either its own rule for what a wall costs. The Lance's per-wall rule is a mode of the same `Budget` (`walls`), not a second system.
- **`severMult` is read through `canSever`.** A gun with `canSever: false` sends 0, whatever its `severMult`. Always Sever overrides both.
- **A family member is data.** See "Adding a family member". `Weapons.ts` picks the code that fires a gun by its row's `mode` and `round`, never by its id, and `families.ts` names no weapon at all.
- **The Lance is as it was.** Two walls, each up to 1.6 m, of anything, at no cost in damage, and through a vehicle's hull if it is thin enough. `penetration.test.ts` has five tests that hold it there. `?pierce=0` does not touch it, as it never did.
- **A Hellfire round bursts on the body it hits.** On every body it goes through, and where it stops. Not on a wall it passes.
- **An exit mark lies on the far face.** `exitWall` takes the face's normal from the probe, not the line of the shot. The decal pass cuts away anything that stands off the surface, so a mark laid along a slanted shot is a sliver.

## How things work

**Families.** Every weapon on one number key is a family, in `WEAPON_ORDER`, which is the order of the rows in `WEAPONS`. The key draws the member last held there; pressing it while holding one steps to the next owned member and wraps. Q is still the weapon before this one, whichever key it is on. The wheel walks keys, not weapons, and lands on the member last held on each, so a family is one notch. A member with a `base` is owned whenever its base is: `own()` adds it wherever a weapon is added (start of run, `give`, `setLoadout`), with a full magazine and its own reserve. Only the base raises the unlock banner; the member gets a line in the feed. Ammo is per member. A dry gun hands over to its family member before anything else: `TUNING.ammo.fallback` lists base weapons and `nextLoaded` tries each one's members straight after it. `?families=0` leaves each key with its first weapon.

| Key | Base | Member | The member's job |
|---|---|---|---|
| 1 | SMG | **Harrow**, battle rifle | 50 damage at 6.7 a second against 25 at 10: a third more damage a second, in bigger pieces. Full damage at any range, where the SMG now fades from 35 m to half at 80. Goes through one body or 0.5 m of cover. Kicks 3.6 times as hard. Takes limbs (`severMult` 1.8) |
| 4 | Autocannon | **Sabot**, the same cannon loaded with darts | Hitscan, 600 damage, no blast, through plates and through a Riot's shield. Budget 5 m, bodies at 0.12 m each. Same scope |
| 6 | Judge | **Rivet**, pistol | 30 damage as fast as the trigger (9.5 a second), 15 rounds, out in 0.1 s. Headshots times 3. Half damage past 55 m, and no limbs. The Judge is six slow verdicts, this is the gun that is already up |

**Adding a family member.** What it takes, in full:

1. Its id in the `WeaponId` union in `src/core/gameplay.ts`.
2. One row in `WEAPONS`, placed after its base, with the family's `slot` and `base: '<the base>'`. Where the row sits is its place on the key and on the wheel.
3. A viewmodel, and one line for it in `viewmodels/models/index.ts`.
4. `tsc` then names three UI rows it wants: `ui/data.ts` (guide text), `ui/icons.ts`, `ui/hud/crosshair.ts`.

Nothing else is needed. The dry-gun list takes a member after its base, `gore/wounds.ts` gives a gun with no `BITES` row the SMG's wound, the Commander says a gun with no entry in `WEAPON_WORDS` by its name, and the lab's "Draw a weapon" buttons and the guide's weapon page are built from the table.

The row decides how it fires. `mode` picks the trigger code: `auto`, `semi`, `charge` (the Lance's, with `TUNING.lance`), `spin` (the Buzzsaw's, with `TUNING.buzzsaw`, slowdown included), `stream`, `melee` (the `Sword` class). `round` picks what leaves the barrel when it is not a hitscan round: `rocket`, `shell`, `stake`. More than one pellet makes it a scatter gun, with the point-blank rule and the pellet perks. `headHops`, `scope`, `penetration`, `bodyCost`, `armorPiercing`, `falloff` and `canSever` are fields too. So a second gun on key 7 or 8 is a row with `mode: 'charge'` or `'spin'` and its own damage, rate, budget and tracer. It shares the spin-up or charge numbers and sounds of the first, which live in `TUNING`, not in the row: a member that needs its own will have to move those into the row. A second blade on key 5 swings with `SWORD`'s numbers for the same reason.

Weapon ids still written in `Weapons.ts`, each for a reason: `smg` for akimbo, because the left gun is an SMG viewmodel; `sword` as the end of the dry-gun list and as what a quick melee draws; and the hand a run starts with.

**Penetration.** A budget is meters of concrete, on `WeaponDef.penetration` for the guns and on the spec for anything else. A wall costs its measured thickness times `PENETRATION.surface` (steel 1.5, glass 0.2, a shield never). A body costs `PENETRATION.body`, 0.4, or the round's own `bodyCost`, and twice that if its armour or shield blocked the round. Damage falls in a line from all of it with the budget untouched to `keep`, 0.55, with it spent. Range and falloff are measured through the wall.

**An armour-piercing round and a shield.** `armorPiercing` on the row sets `DamageInfo.armorPiercing` on every body and `pierces` on a plated one. Plates do not stop it, and neither does a Riot's shield: before, the shield blocked the Sabot's dart outright and the dart went on to kill everyone behind the one man it could not hurt. A ward still takes the hit for its owner and the dart goes on, at twice the body cost.

**Hellfire Rounds on a round that goes through.** The perk's burst used to go off only where the round stopped. The Harrow and the Sabot go through the first body, so the burst landed on whatever was behind the target, or nowhere. Now a round with `blastRadius` bursts on every body its budget takes it through, as well as where it stops. A body it passes for free under `pierce`, which is the Lance's way, gets no burst, as before. A burst is a real blast and can kill the next man in line before the round reaches him; the round then passes a corpse and bursts nothing there.

`wallExit` measures a wall with reverse rays. Probes step 0.15 m into the wall along the shot and each looks back the way it came: a probe still inside a box reads a hit at zero distance, because the world's boxes are solid to rays, and the first probe in the open sees the far face behind it. That gives the exit point, the far face's normal and the thickness in one to twenty rays, only for a round that has a budget and has met a wall. Stepping from the near side is what makes it find the first wall's far face and not the next wall's: the old `findExit` cast one ray back from the full depth, and through two walls it found the second.

The exit is `Combat.exitWall`: the surface's own impact off the far face, an `exit` decal, a puff the colour of the wall thrown on along the shot, and for a round of impact scale 1.5 or more (the Sabot) a short light on the face. The `exit` decal is a spall crater: a small black hole in a ragged patch of pale broken material about four times as wide, with flakes past its rim. It is the only pale mark in the decal atlas, which is what makes it show on a wall in shadow, and it is what tells the two faces of a wall apart afterwards: a dark pinhole going in, a pale crater coming out. The quad is 0.3 m times the round's impact scale, so the Harrow's crater is about 18 cm across and the Sabot's 30. A body passed gets a blood burst out of its back (`exitBody`). The tracer is redrawn from each hole, which is why the Sabot's is fast: all its pieces are on screen at once. A vehicle is not cover: its part takes the round and the round ends.

Projectiles do the same through `sweepThrough` and `goThrough`. A round with a budget meets everyone on its step's line in order through `raycastAll`, so it cannot skip a body standing behind another inside one frame.

Normal walls in the maps are 0.6 to 1 m, outer walls 1.6. The Sabot goes through the range gallery's 0.3, 0.6, 1.0 and 1.6 m walls and a steel sheet in one shot, 3.65 m of budget, and still kills. `PENETRATION.maxWall`, 3 m, is the most any single wall can be.

**The Lance's rule.** A full charge is on the per-wall rule it had before budgets: `penetrateWalls: 2` with `penetrate: 1.6`. In `passWall` that means any wall up to 1.6 m thick is passed, whatever it is made of, an energy surface included, and costs one of the two walls and nothing else. No surface factor, no total, no damage lost (`penetrateKeep: 1`), and a vehicle's hull is a wall like any other to it. Bodies are its `pierce`, 24 of them, free (`bodyCost: Infinity` keeps the budget out of it). `?pierce=0` does not reach it. An earlier version of this work put the Lance on the metered budget, which stopped it in any steel wall over 1.07 m and made its 1.6 m a total across walls; that is gone.

What is still not the old Lance, all three in its favour or for show:

- **The probe.** It uses the stepped probe above, so it comes out of the first wall. The old single ray from 1.6 m in found the far face of the last wall inside that depth: two thin walls close together cost it one wall and it skipped anyone standing between them, and a thin wall with another solid starting 1.6 m behind it stopped it dead.
- **The exit.** It gets the crater and the puff. It had the surface's impact only.
- **Range through a wall** now counts the wall's thickness. Out of 800 m.

Cost, real game, 300 shots down the gallery through five walls and five Juggernauts, three runs on a shared machine: 0.02 to 0.05 ms a shot with no budget, 0.05 to 0.10 ms with the Harrow's, 0.16 to 0.60 ms with the Sabot's. The Sabot fires twice a second.

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

**Rocket fuse.** `PROXIMITY` goes off 1.25 m from a body's centre, for a skimming hit. That reaches further than a frame's flight plus the contact ray, so at 60 fps every straight shot went off short and no rocket ever touched anyone. `sweepEnemies` now looks `ON_COURSE` metres on, and a rocket that will land flies on and lands. A direct kill gibs, through `bursts`.

**Shaped charges.** `SHAPED_CHARGE` is the one table. On a body with armour left, `strike` multiplies a direct hit and sets `pierces`, so the plates are not touched, and `blastEnemies` cuts the splash. Everything else takes the blast as written. Measured with real rockets on a Brute: direct 200 through intact plates against 100 bare, splash at 3 m 32.5 against 81.3. An autocannon shell already kills what it hits, so on armour what matters is that it goes through, and that a boss takes 1800 instead of 900. Its splash is 105 on armour and the end of anything bare.

**Hit-stop.** `Feel.stop` drops any stop within `HIT_STOP.minGap` of the last, unless forced, so automatic fire does not stutter. `time.hitStop` takes the longest, so stops do not add up.

**Ammo.** The guns can run dry, the player cannot. In order:

1. A gun that empties plays the dry click and hands over after 0.2 s, by `TUNING.ammo.fallback`. Rockets are last, the sword is the end of the list. Drawing a dry gun on purpose does not bounce you off it; pulling its trigger does.
2. Every sword kill pays half a magazine into the last gun you held, or the gun in hand for a quick melee.
3. Every wave clear lifts each owned gun to 20% of max reserve. It is a floor, so a stocked gun gets nothing.

**Stake pins.** `gore.pin` needs a ragdoll that has stepped once, so `Projectiles.nail` queues the pin and it goes in a frame later, for every stake. `pinReach` is 7.5 m because gore drags a bone at 26 m/s for 0.3 s; past that the bone stops short and the body hangs off the wall on nothing.

**Buzzsaw slowdown** is written to velocity, because progression rewrites `modifiers.speed` every frame, after weapons run. The player re-accelerates at 120 Hz between our once-a-frame clamps, so the clamp sits half a frame's regain below the target. It reads `MOVE.runSpeed` and `MOVE.groundAccel` directly, because a copy of those went stale when DESIGN section 13 retuned the ground.

**Lunge.** A dash at 30 m/s for 0.16 s toward the target, renewed every frame and homing on it. A single shove is worth about a meter once ground friction has had it (`15^2 / (2 * stopDecel)`).

**Slices cost about 5 ms each.** A sweep slices 3 kills per frame and the rest ragdoll. A full Lance shot splits the first 3.

Measured over 80 s of the real game, with the bot holding the trigger on the SMG and only collecting what it runs over: reserve fell from 360 to 180 by wave 2, then 5 ammo pickups took it to the 720 cap, across 59 kills and 3 waves. It never went dry. The old wave-2 dry-out came from a 240 reserve running out before the first pickup, with a bot that does not chase drops, so the fix there was the bigger SMG reserve and the fallbacks, not more drops. One pickup is 180 SMG rounds and the economy now leans generous. If that turns out too loose, cut `PICKUP.ammo` in progression before touching the reserves.

## Tuning

| Want | Change |
|---|---|
| Weapon stats, sound, kick, shake | `WEAPONS` row. `kick` is camera radians, `shake` is first-game intensity, `recoil` is viewmodel only |
| Which gun takes limbs | `canSever` in its row, then `severMult` for how readily |
| What a gun goes through | `penetration` and `bodyCost` in its row. What things cost: `PENETRATION` |
| Reach | `falloff` in its row: `from`, `to`, `floor`. Unset is full damage at any range, which is every gun but the SMG (35 to 80 m, half) and the Rivet (25 to 55 m, half). `?reach=0` takes it out of every gun |
| A new family member | See "Adding a family member". Its key order is where its row sits in `WEAPONS` |
| What fires a gun | `mode` and `round` in its row |
| The Lance through walls | `TUNING.lance.penetration` (thickest wall) and `walls` (how many) |
| The exit crater | `EXIT_CRATER` and `EXIT_FLASH_SCALE` in `Combat.ts`. Its look: `exitHole` in `src/render/materials/decalAtlas.glsl.ts` |
| Ammo pressure | `reserve`, `maxReserve` per weapon, `TUNING.ammo` |
| Rocket jump | `TUNING.rocket.playerPush`, `selfDamage`. `EXPLOSIONS.rocket.selfCap` |
| Sword | `SWORD.chain[]`, `.area`, `.finisher`, `.lunge`, `.windup` |
| Blast feel | `EXPLOSIONS[kind]`: `shake`, `shakeRange`, `edgeDamage`, `impulse`, `selfCap` |
| What a blast does to a body | `BLAST` and `OUTCOMES` in `src/enemies/blast.ts` |
| Armour against rockets and shells | `SHAPED_CHARGE` |
| Push on bodies | `force` in each `WEAPONS` row, `TUNING.shotgun.pointBlankForce`, `TUNING.blastForce`, `EXPLOSIONS[kind].impulse`. Bands are in `src/gore/forces.test.ts`, the measured table in `docs/notes/lab.md` |
| Impact | `HIT_STOP`. 30 ms reads as a punch, 100 ms as a stumble |

## Testing

```
nice npx vitest run src/weapons/families.test.ts --testTimeout=60000      # 16: the table, the keys, the wheel, ownership, per-member ammo, the dry-gun order
nice npx vitest run src/weapons/penetration.test.ts --testTimeout=60000   # 48: budget, the per-wall rule, wall probe, hitscan, bursts, every gun, the Lance, projectiles at 30/60/144

node tools/shot.mjs --url "/?map=range" --script tools/scripts/families-live.mjs --wait 500 --timeout 280 \
  --dpr 2 --w 1440 --h 900 --out tools/out/fam/live.png      # real keys and real enemies on the range's piercing gallery.
                                                             # FAM_ONLY=keys,gallery,holes,tracer,shield,hellfire,lance,reach,exits,cost
```

```
/?sandbox=range                 # stepped clock, stand-in enemies, every number exact at 30/60/144 fps
/?sandbox=range&only=sword      # tests whose name contains the text

RL_GROUP=guns node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk,trooper,smg,pistol,brute,minigun" \
  --script tools/scripts/range-live.mjs --wait 1000 --timeout 220 --out tools/out/rl-guns.png
```

`range-live.mjs` is the real game with waves off: real map, real enemies, real gore. Groups are `guns`, `heavy`, `sword`, `perks`, `view`, `world`. `RL_ONLY=a,b` reruns named steps. Kills in these runs trigger real perks, so a later step can be running under Blood Thirst.

## Verified

In the real game against real enemies, with `range-live.mjs`, zero console errors in every run. `/?sandbox=range` passes 202 of 202. Its SMG checks read the rate from the table now: they had been failing since the SMG went to 10 a second. Its dry-gun group checks the hand-over twice: to the Harrow, and with the Harrow dry too, to the shotgun, which is the semi-auto the re-armed press exists for.

Families and penetration, with `families-live.mjs` on the Test Range, real keys through pointer lock:

| Thing | Result |
|---|---|
| Keys | `1 1 1 2 1 4 4 6 6 Q 1` drew Harrow, SMG, Harrow, Shotgun, Harrow, Autocannon, Sabot, Judge, Rivet, Judge, Harrow |
| HUD | One cell per key, two pips on 1, 4 and 6, the held member's lit. Under the name: `1 SMG HARROW` |
| Sonar, then Sabot | Trooper drawn red through the 0.3 m wall. One shot killed all five in the gallery, behind 0.3, 0.6, 1.0 and 1.6 m of concrete and a steel sheet. Five Brutes the same |
| Harrow | Killed the Trooper behind the 0.3 m wall, nobody behind the 0.6 m one |
| SMG, Rivet | Nobody behind any wall |
| Autocannon | Shell burst on the first wall, nobody behind it hurt |
| A projectile with `penetrate: 5` | All five |
| Sabot at a Riot facing you, two Troopers behind him | All three dead: the Riot took the full 600. It took nothing before, and the two behind him died |
| Harrow at the same Riot | Blocked by the shield, as every round that is not armour-piercing |
| Hellfire Rounds from the real perk, a Trooper 8 m out | First burst 7.8 m out, on him, for the SMG, the Harrow and the Sabot. The Harrow and the Sabot went on and burst again where they stopped, 26 m out |
| Lance, full charge down the gallery | Bays behind the 0.3 and 0.6 m walls dead, the third wall stopped it. The gallery cannot tell its rule from a 1.6 m total; the tests can |
| Reach, one round each at 50 m | SMG 21, Harrow 50, Rivet 18 |
| Exits through the 0.3 m panel: three darts square on, at 32 and at 46 degrees, and one Harrow round | Four pale craters on the far face, round and whole at every angle, the Harrow's the smallest; from nearly edge on the 46 degree one lies flat. The near face has four dark pinholes. `tools/out/fam2/fix-exits-*.png` |
| `?families=0&pierce=0` | Keys stay on SMG, Autocannon, Judge. No gun goes through anything |

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
| Whole game, after families and penetration | `/?autostart=1` with nobody at the keys: booted on the default map, ran until the waves killed the player, no console errors. A boot check, not a fight |

## Known limitations

- **Nobody has played the three new guns.** Their numbers are a first guess from the tables: rate and damage against their siblings, kick and shake by ratio. The feel of the Harrow's kick, the Rivet's snap and the Sabot's weight is unjudged.
- **The SMG changed to give the Harrow its reach.** It was full damage at any range and now fades from 35 m to half at 80. The numbers are a guess nobody has played. `?reach=0` puts it back, and takes the Rivet's falloff with it.
- **The exit crater is the same pale grey on every wall.** It reads as broken concrete on concrete and as bare metal on steel, but it does not take the wall's own colour. Glass, grates, energy and lava get no crater. It was looked at on the range's panel wall only.
- **The Sabot's own shot was checked as stills.** Seven frames each of it and the autocannon, with nothing broken in them. Whether the longer stroke reads in motion is unjudged. Its reload and draw are the autocannon's.
- **A second spin, charge or melee member shares the first one's `TUNING`.** Spin-up, charge time, the sword's chain and their sounds are not in the row. See "Adding a family member".
- **The Commander has words for the three new guns and no recordings.** His line about a favourite weapon prints and is silent for them.
- **A trimesh is a skin to the probe.** A round is charged one step, 0.15 m, for each face. Walls are boxes; the ring decks are the trimeshes.
- **Two walls closer than 0.15 m count as one.**
- **Penetration and ricochet.** A round that can go through a wall does, and only bounces off one it cannot. Hellfire rounds burst on each body they go through and where the round stops, not at each wall. A projectile's own blast goes off only where it stops; no gun fires a penetrating projectile that carries one.
- **A ward takes a dart for its owner and the dart goes on.** It costs the round twice a body. Only the Riot's shield was changed. This one is read from the code, not run.
- **Enemy rounds never penetrate.** `enemyRay` takes no budget, and an enemy-team projectile with one would go through walls but is not swept against bodies that way. Only the player's guns set one today.

- **Nobody has played this with hands.** Every result above is a script or a bot. Recoil, shake, stops and the sword's timing need a human pass.
- **Only the SMG has a viewmodel so far.** `viewmodels/models` builds `smg` and `smgLeft`, so every other weapon shows the SMG and fires from its muzzle. Flash and tracer alignment for the other nine is unverified, and so are reload, swing and draw animations.
- **Enemy flashes inside 3 m of the camera** still take fx's lift to the view scene, through the stale camera. They land up to a frame of motion off, on top of the viewmodel. Now that the player's gun does not need that rule, fx could drop it for anything but a `view` flash, once `view` keeps the world parts in world space.
- **Pickup weighting ignores dry guns when the sword is out.** `pickups.ts` reads `weapons.ammo()`, the weapon in hand, and the sword reports no reserve. So a player forced onto the blade gets no extra ammo drops. Sword kills feed the last gun regardless.
- **Buzzsaw slowdown lives on velocity.** A `moveScale` read by progression when it writes `modifiers.speed` would be cleaner, but that is not this system's file.
- **The crane does not pass its speed on.** Jump off a moving deck and you lose its 4 m/s. Riding drifted 11 cm over 6.4 m of travel.
- **The slash crescent is a stand-in for the cut**, tilted so it can be seen. See above.
- **Rockets hit twice on a direct hit**: the contact strike, then the blast. That is deliberate and only shows on targets that survive 100. Before the fuse was fixed, that meant nothing: see Rocket fuse.
- **`fx.chips` on a headshot and gore's own headshot stack both run**, so a head kill has chips, sound and stops from both systems. It reads well, but it is two owners for one moment.
- **A large red disc with a white cross** appears on a brute at 5 m in `rl-heavy-stake-limb.png`. It is not weapons code. `telegraph.glint` in `src/enemies/telegraph.ts` is the likely source, but I did not trace this one. It may be worth a size check at point-blank.
