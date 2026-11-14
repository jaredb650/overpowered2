# Weapons and combat

`src/weapons/**` except `viewmodels/`, sandbox at `/?sandbox=range`. `createCombat(ctx)` and `createWeapons(ctx)` from `src/weapons/index.ts`.

| File | What it is |
|---|---|
| `data.ts` | Every number. `WEAPONS`, `TUNING`, `SWORD`, `EXPLOSIONS`, `HIT_STOP`. Tune here; the code reads this and nothing else |
| `Weapons.ts` | Input to shots: fire modes, reload, scope, grenades, ammo fallbacks. All on `time.playerDt` |
| `melee/` | Key 5, the katana and the four beside it. `Melee.ts` swings all of them (chain, step, the katana's dash, wind-up, sweep, finisher, guard, slices); `sweep.ts` is what a swing touches, pure geometry; `data.ts` is `MELEE`, every swing and reach |
| `Combat.ts` | Hit resolution: rays, `strike` (the one door to `enemies.applyDamage`), blasts, the blast queue |
| `Projectiles.ts`, `ProjectileVisuals.ts` | Swept projectiles, 256 pool, oldest out. One InstancedMesh per shape |
| `Flames.ts` | The invisible bodies inside the fire you see. 160 pool |
| `Feel.ts` | Shake units and hit-stop pacing |
| `families.ts` | Which weapons share a number key, and what the key, the wheel and a base weapon's unlock do about it. No state |
| `swarm.ts` | The Quiver's mind: painting marks, filling a salvo, a missile's turn, weave and retarget. Pure functions and the `Painter`; no world |
| `lance.ts` | The Lance: the rules of its charge, the pool its plasma bursts wait in (`PlasmaChain`), and its trigger, beam and sweep (`Lance`). `Weapons` holds one and hands it a few closures (`LanceHost`) |
| `penetration.ts` | The budget a round spends on walls and bodies, and the probe that measures a wall. Hitscan and projectiles both ask here |
| `burst.ts` | A small cannon round going off where it lands: the look, the crack and the fragments. Never a blast. The Trommel's rounds and the door gun's |
| `handling.ts` | A gun too heavy to run with: the cap a row's `slow` puts on the player's speed, how it eases, and the moves it leaves alone |
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
ctx.weapons.paint;                  // the Quiver's marks while it is in hand (PaintView), else undefined
ctx.combat.spawnProjectile({ ..., kind: 'rocket', target, turnRate: 3.6, steerDelay: 0.14, weave: 0.1 }); // a guided missile
ctx.combat.fireRay(eye, dir, { damage: 50, source: 'harrow', team: 'player', penetrate: 0.5 });   // through a body or a sheet
ctx.combat.spawnProjectile({ ..., kind: 'bullet', penetrate: 3, bodyCost: 0.2 });                  // the same budget, with travel time
ctx.combat.fireRay(eye, dir, { damage: 32, source: 'buzzsaw', team: 'player', burst: { radius: 0.45, damage: 10 } }); // a 20 mm round: it bursts where it lands
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

- `WeaponId` gains `thresher` and `quiver` (this stream), after `harrow`, `rivet` and `sabot`. Every `Record<WeaponId, ...>` in the tree has them: `ui/data.ts`, `ui/icons.ts`, `ui/hud/crosshair.ts`.
- `WeaponSystem.slotMember(slot)`, optional so a stand-in weapon system need not have it.
- `ShotSpec.penetrate` was "walls up to this thick" and is now the budget described under Penetration. New beside it: `bodyCost`, `penetrateKeep`, `armorPiercing`, `falloff`, and `penetrateWalls`, which puts a round on the old per-wall rule and is how the Lance keeps it. `ProjectileSpec` gains `penetrate`, `bodyCost` and `armorPiercing`.
- `MuzzleKind` and `TracerKind` gain `carbine`, `pistol` and `sabot`, with rows in `src/fx/recipes/muzzle.ts`.
- `DamageInfo.reach` and `blastKind`, a blast's splash, which is what `src/enemies/blast.ts` rolls on. `DamageInfo.pierces`, a shaped charge's direct hit or an armour-piercing round on a plated body. `DamageInfo.armorPiercing`, an armour-piercing round on any body: `shieldStops` in `src/enemies/damage.ts` reads it and lets the round through a Riot's shield.
- **Quiver stream.** `MissileTarget` (anything a missile can be painted on: an enemy as it stands, a `Vehicle` through its new `aimLift` and `paintRadius` getters) and `PaintView` (what the HUD draws). `WeaponSystem.paint?`. `ProjectileSpec` gains `target`, `turnRate`, `steerDelay`, `weave`, `accel`, `topSpeed`, `size`; `ProjectileTrail` gains `swarm`; `MuzzleKind` gains `quiver`. `ViewmodelRig.muzzle(out, left, barrel?)` picks a barrel by socket `muzzle1`..`muzzle3`. `VehicleTargets.paintable?(out)` lists live vehicles and the chopper. In `data.ts`: `FireMode` gains `paint`, `WeaponDef` gains `climb`.
- **Melee stream.** `WeaponId` gains `knife`, `crowbar`, `shovel`, `baton`, after `sword`. `SwordMove` gains `heavy`, the right click of a melee weapon with no guard. Nothing else in the contract changed.
- **Lance stream.** `ShotSpec.struck`, a `StruckList` the caller owns: the ray adds each body it struck (`points`, `enemies`, `count`) and counts the walls it passed (`walls`), and passes over any body already in the list, so one round can be resolved in several rays. Unset, a ray does nothing new. `ExplosionKind` gains `plasmaBurst`, with rows in `EXPLOSIONS`, in `src/fx/recipes/explosions.ts` and in `BLAST.rings` (`src/enemies/blast.ts`). `ProjectileTrail` gains `plasma`. In `data.ts`: `ExplosionDef.noKillStop`, `LANCE_OLD`, `HIT_STOP.lanceShot`. `Weapons.lance` is public, for tests and the lab.
- `DecalKind` gains `exit`, the spall crater on the far side of a wall. It took the second bullet-hole cell of the atlas, so `bullet` has one variant now (`src/render/Decals.ts`, `materials/decalAtlas.glsl.ts`).
- **Key 8 stream.** `WeaponId` gains `piledriver`. `BurstSpec` (`radius`, `damage`, `scale`) and `ShotSpec.burst`: a round that bursts where it first strikes and where it stops. `FxSystem.burst?(position, normal, scale?)`, optional so a stand-in need not have it. `MuzzleKind` gains `rotary` and `hmg`. In `data.ts`, `WeaponDef` gains `burst`, `gib` (the chance a kill bursts the body) and `slow` (speed while it fires, as a share of run speed), and `TUNING` gains `handling` and `burst`. `Combat.bursts` is the `Bursts` instance, with `stats` for tests.

One change outside this system: `Player.rideGround` in `src/player/Player.ts` adds `world.objects.platformVelocity` to position while grounded, swept so a wall stops it. Added to position rather than velocity, so the deck's speed never reads as the player's own. `docs/notes/player.md` and `world.md` still say moving geometry does not carry the player; their owners should drop that line. `Weapons.ts` also imports the plain `MOVE` table from `src/player/tuning.ts`.

## Rules that must stay true

- **A round with no budget costs nothing.** `loadBudget` sets `left` to 0 and every penetration branch is behind `budget.left > 0`. One world ray per segment, as before: `penetration.test.ts` counts them.
- **One system, two callers.** `Combat.playerRay` and `Projectiles` both hold a `Budget` and call `passBody` and `passWall`. Do not give either its own rule for what a wall costs. The Lance's per-wall rule is a mode of the same `Budget` (`walls`), not a second system.
- **`severMult` is read through `canSever`.** A gun with `canSever: false` sends 0, whatever its `severMult`. Always Sever overrides both.
- **A family member is data.** See "Adding a family member". `Weapons.ts` picks the code that fires a gun by its row's `mode` and `round`, never by its id, and `families.ts` names no weapon at all.
- **The Lance's walls are as they were.** A full charge: two walls, each up to 1.6 m, of anything, at no cost in damage, and through a vehicle's hull if it is thin enough. `penetration.test.ts` has five tests that hold it there. `?pierce=0` does not touch it, as it never did. A weaker beam and a plasma ball go through no wall.
- **A tap is clean.** Nothing of the charge is shown or heard for `TUNING.lance.tapTime`, and a press let go before the first stage is always a ball, never a fizzle. Only right click fizzles.
- **No length of line is one frame's work.** A full beam strikes `sweep.perFrame` bodies a ray and one ray a frame, from `lance.tick()`; its bursts are booked into a fixed pool and set off `chain.perFrame` a frame. `tick` runs from `Weapons.update` before anything can return early, so a beam and its bursts finish whatever is in hand, holstered and dead included.
- **The shot every gun shares never keeps the Lance's list.** `step` sets `shot.struck` and `shot.skipCorpses` and clears both in a `finally`. A gun fired next must not add to the list or pass over corpses.
- **A sweep strikes corpses on its first ray only.** Every later ray sets `skipCorpses`: ahead of it lie the bodies the beam killed a frame before, and the old one-ray gun never struck its own kills twice.
- **The beam's FOV punch is the Lance's own zoom.** A charge narrows the view through `camera.setZoom`, and the camera's `fovPunch` sits under a zoom, so it would be lost while the zoom lets go. The Lance holds the zoom on the release: wide by the row's `fovPunch` times the stage's `weight` at once, back to where the charge began over `punchTime` on the real clock, then `setZoom(null)`. `cancel()` ends it, so a switch, reload, pause or death lets go of the view at once.
- **A plasma burst is quiet and never gibs.** `EXPLOSIONS.plasmaBurst` has no flash, no FOV punch and `noKillStop`, and its row in `BLAST.rings` has no fireball. Twenty go off in under a second.
- **The Lance's gore and reactions are data.** `force` on the ball, the beam's `severMult` and `cleave`, and the blast table's row for `plasmaBurst`. Nothing in `src/gore`, and one table row in `src/enemies/blast.ts`.
- **A Hellfire round bursts on the body it hits.** On every body it goes through, and where it stops. Not on a wall it passes.
- **An exit mark lies on the far face.** `exitWall` takes the face's normal from the probe, not the line of the shot. The decal pass cuts away anything that stands off the surface, so a mark laid along a slanted shot is a sliver.
- **A burst is never a blast.** `Bursts.at` must not call `explode`. A blast rolls every body in reach on the blast table, throws every ragdoll and chunk near it and punches the camera; a burst is `fx.burst`, `cannon_burst`, and a quiet bullet hit on bodies inside its radius other than the one the round struck. Fragments are `bullet` damage with no `reach` and no `blastKind`, so bodies answer them as they answer any light round. `heavy.test.ts` holds this.
- **Only the door gun has both.** On foot the Trommel bursts and goes through nothing, the Piledriver goes through and does not burst. The helicopter's door gun sets `burst` and `penetrate` on one spec, and is the only thing that does. `heavy.test.ts` checks the two rows.
- **A round bursts twice at most.** Where it first strikes anything, and where it stops if it went on. A round with Hellfire Rounds has that blast instead and no burst.
- **The slowdown leaves a move alone.** `holdSpeed` clamps nothing while the player dashes, slides, wall runs, climbs, vaults or slams, and nothing above 1.5 times run speed. What a move leaves under that (a dash's 13 m/s, a dash-jump's 18) bleeds down to the cap at `TUNING.handling.carry` and is never cut in one frame. An ordinary jump is held to the cap like the ground.
- **The rotary cannon's id is `buzzsaw`.** Saves, `CACHE_ORDER`, the dry-gun list, the Commander's lines and other streams' tests know it by that. Its name is a string in its row, and the Commander's word for it is `WEAPON_WORDS.buzzsaw`.

## How things work

**Families.** Every weapon on one number key is a family, in `WEAPON_ORDER`, which is the order of the rows in `WEAPONS`. The key draws the member last held there; pressing it while holding one steps to the next owned member and wraps. Q is still the weapon before this one, whichever key it is on. The wheel walks keys, not weapons, and lands on the member last held on each, so a family is one notch. A member with a `base` is owned whenever its base is: `own()` adds it wherever a weapon is added (start of run, `give`, `setLoadout`), with a full magazine and its own reserve. Only the base raises the unlock banner; the member gets a line in the feed. Ammo is per member. A dry gun hands over to its family member before anything else: `nextLoaded` tries the other guns on the dry gun's own key first, then `TUNING.ammo.fallback`, which lists base weapons, each one's members straight after it. Before the cross-check of 2026-11-10 the key came second, so with the Trommel owned (it heads the list) a dry Harrow went to the Trommel and not the SMG. `?families=0` leaves each key with its first weapon, and implies `?slot4=old`, so key 4 is the explosive autocannon from the start, as before families.

| Key | Base | Member | The member's job |
|---|---|---|---|
| 1 | SMG | **Harrow**, battle rifle | 50 damage at 500 a minute (8.3 a second) against 25 at 800 (13.3): a quarter more damage a second, in bigger pieces. Both rates set by the owner on 2026-11-13. Full damage at any range, where the SMG now fades from 35 m to half at 80. Goes through one body or 0.5 m of cover. Kicks 3.6 times as hard. Takes limbs (`severMult` 1.8) |
| 2 | Shotgun | **Thresher**, drum shotgun | Full auto, 5 shells a second, 20 in the drum. 4 pellets of 20 to the pump's 6, so the pump stays the hard single hit; its damage a second is about the pump's held, spread over a burst. Real climb (`climb`), a 2.7 s drum reload. Takes limbs like the pump (`severMult` 2.4, the point-blank rule) |
| 3 | Rocket | **Quiver**, four-tube box launcher | Hold to paint up to four marks, let go and four guided missiles leave a tube apart. See "The Quiver" |
| 4 | **Sabot**, the cannon loaded with darts | Autocannon, the explosive belt: the upgrade | The Sabot is first on the key and comes from the start: hitscan, 600 damage, no blast, through plates and through a Riot's shield, budget 5 m, bodies at 0.12 m each. The autocannon has no `base`: a weapon cache brings it, the second one, after wave 4 (`CACHE_ORDER`), and its feed line says "PRESS 4 AGAIN" |
| 5 | Sword | **Shiv** (`knife`), **Prybar** (`crowbar`), **Spade** (`shovel`), **Cosh** (`baton`) | Four swung weapons, all owned with the sword, in that order on the key. See "Key 5" |
| 6 | Judge | **Rivet**, pistol | 30 damage as fast as the trigger (9.5 a second), 15 rounds, out in 0.1 s. Headshots times 3. Half damage past 55 m, and no limbs. The Judge is six slow verdicts, this is the gun that is already up |
| 8 | **Trommel**, 20 mm rotary cannon (id `buzzsaw`) | **Piledriver**, heavy machine gun | 90 damage at 8.3 a second against 32 at 25: about the same damage a second, in rounds nearly three times as big. Goes through 2.4 m of wall and everyone in line at 0.3 m a body, where the Trommel goes through nothing. Takes off any limb it touches (`severMult` 5), and three kills in ten burst the body (`gib`). Kicks, climbs, and slows the player to 0.72 of a run where the Trommel's firing is 0.5. No burst. Arrives in the Trommel's cache. See "Key 8" |

**Adding a family member.** What it takes, in full:

1. Its id in the `WeaponId` union in `src/core/gameplay.ts`.
2. One row in `WEAPONS`, placed after its base, with the family's `slot` and `base: '<the base>'`. Where the row sits is its place on the key and on the wheel.
3. A viewmodel, and one line for it in `viewmodels/models/index.ts`.
4. `tsc` then names three UI rows it wants: `ui/data.ts` (guide text), `ui/icons.ts`, `ui/hud/crosshair.ts`.

A member with no `base` is earned on its own (the autocannon): it needs its own place in `CACHE_ORDER` and in `TUNING.ammo.fallback`. A loadout (`setLoadout`) sets each key to the first weapon it names there, so a mission written for the autocannon still draws it on 4.

Nothing else is needed. The dry-gun list takes a member after its base, `gore/wounds.ts` gives a gun with no `BITES` row the SMG's wound, the Commander says a gun with no entry in `WEAPON_WORDS` by its name, and the lab's "Draw a weapon" buttons and the guide's weapon page are built from the table.

The row decides how it fires. `mode` picks the trigger code: `auto`, `semi`, `charge` (the Lance's, with `TUNING.lance`), `spin` (the rotary cannon's, with `TUNING.buzzsaw`: spin-up, the climb of its rate, and the slowdown while spun), `stream`, `melee` (`melee/Melee.ts`, reading the weapon's row in `MELEE`). `round` picks what leaves the barrel when it is not a hitscan round: `rocket`, `shell`, `stake`. More than one pellet makes it a scatter gun, with the point-blank rule and the pellet perks. `headHops`, `scope`, `penetration`, `bodyCost`, `armorPiercing`, `falloff`, `canSever`, `burst`, `gib` and `slow` are fields too. So a second gun on key 7 or 8 is a row with `mode: 'charge'` or `'spin'` and its own damage, rate, budget and tracer. It shares the spin-up or charge numbers and sounds of the first, which live in `TUNING`, not in the row: a member that needs its own will have to move those into the row. A melee member is not like that: its swings, reach and what it does to a body are its own row in `MELEE` (`melee/data.ts`); only the katana has the guard, the charged sweep and the finisher, which stay `SWORD`'s.

Weapon ids still written in `Weapons.ts`, each for a reason: `smg` for akimbo, because the left gun is an SMG viewmodel; `sword` as the end of the dry-gun list; and the hand a run starts with. A quick melee swings whatever key 5 would draw (`slotMember(5)`), so with the Shiv last held there the melee key is a knife.

**The Quiver.** `mode: 'paint'` in its row; the rules are `swarm.ts` and the numbers `TUNING.quiver`.

- *Paint.* The press starts a `Painter` (`quiver_arm`). While the trigger is held a mark lands every `paintEvery` (0.2 s), the first 0.2 s after the press, so a tap leaves none. The mark goes on the unmarked target nearest the crosshair within `cone` (0.16 rad) and `range` (150 m) that a world ray reaches; with nobody new in view a spare stacks on a marked target still in view, a boss or a vehicle first (`heavy`: `isBoss`, or `paintRadius` over 1.5), else the nearest the crosshair. Each mark plays `quiver_lock` at a pitch that rises 0.16 a mark, and the fourth `quiver_full`. A marked target that dies drops its mark. The ray is only cast for targets in the cone, and only when a mark is due. Enemies come from `enemies.alive`, vehicles and the chopper from `vehicles.paintable`. Right click lets go of the marks and keeps the missiles (`quiver_cancel`).
- *Release.* Every missile gets a target: the live marks in the order painted, the spares on the same rule as a stacked mark. No live mark is a dumb salvo. The four leave `interval` (0.1 s) apart on the player's clock, tube 0 top left, 1 top right, 2 bottom left, 3 bottom right, each from its own muzzle socket with its own flash, sound, recoil and backblast (`Weapons.backblast`: smoke and sparks behind the shoulder). Each tube points `fan` off the crosshair, outward, and aimed ones a touch up, so the four leave in a fan; a dumb salvo is centred a little above the crosshair with `dumbSpread` on top, so the low pair does not go into the floor.
- *Flight.* `Projectiles.guide`: it leaves at 24 m/s and speeds up at 80 to 58. Straight for `steerDelay`, then it turns its nose at `turnRate` (3.6 rad/s, about a 16 m circle at full speed) toward its mark's `center` plus `aimLift`, weaving about that line by `weave` (0.1 rad side to side, half that up and down), fading inside 12 m. With no mark it weaves about a fixed `line`, its launch heading, never its current one, which would spiral. A mark that dies hands the missile to the nearest live enemy, vehicle or aircraft (`vehicles.paintable`) within `retargetRange` (45 m) and 70 degrees of its heading; with nobody it flies on straight. A guided missile's near-miss fuse is for its own mark only: it passes close by others and only a body square in its path stops it. The plain rocket's fuse is unchanged.
- *Blast.* Each is a small ROCKET: kind `rocket`, so the player's own blast follows the ROCKET's rules (self-damage, cap, rocket-jump push), 110 direct and 90 over `radius` 3.5 m against the ROCKET's 100 over 8, with the shaped charge on armour. Measured live: one salvo took 520 off a Juggernaut where four ROCKETs took 260, and killed a 1000-health tank from full.
- *Reload.* All four in one 2.8 s reload, which waits until the salvo has left.
- *Pooling.* Missiles are the projectile pool, trails the fx smoke pool, lock markers four pooled DOM elements (`ui/hud/locks.ts`). Nothing is built while painting or firing.

**The Thresher.** `mode: 'auto'` with `pellets` 4, so it is a scatter gun with the point-blank rule and the pellet perks like the pump. `climb` moves the aim itself, up 0.011 rad and up to 0.0035 to a side a shell, and does not spring back, so a held burst walks up for the player to pull down; `kick` springs back on top as for every gun. `?climb=0` takes the climb out. Its `force` is 16, the least that clears `BLAST.pointBlankForce` (100) once the point-blank rule has multiplied it, so a trunk kill up close can tear a body in two as the pump's can. Its gore and reactions are the pump's through the pellet type, with nothing added in `src/gore` or `src/enemies`.

**The Lance.** `mode: 'charge'`; the rules are `lance.ts` and the numbers `TUNING.lance`. `?lance=old` brings back the gun from before, fired by `Weapons.updateCharge` as it was, with its old row.

*What was wrong with it.* A tap did nothing: under 22% charge the release was a fizzle, so the gun had no quick shot at all. A press made during the wait after a shot was thrown away, held or not. A full charge was 420 damage for 0.85 s of hold, beside a Sabot that does 600 on a click, through armour, 2.2 times a second. The cell held four shots and a weak shot cost the same as a full one. The charge was a bar and a hum: its rising sound was 1.6 s long under a 0.85 s charge and was never stopped, nothing changed in steps, the view did not move. At the far end there was a thin line and, with two kills or more, a hit-stop.

| Let go | Fires | Of the cell's 12 | Damage | Goes through | A burst at each body |
|---|---|---|---|---|---|
| before 0.4 s | a plasma ball, 80 m/s | 1 | 60 on what it hits, 40 over 2.2 m | nothing | its own splash |
| from 0.4 s (30%) | beam I | 2 | 200 | 1 body | 1.8 m, 60 |
| from 0.75 s (65%) | beam II | 2 | 450 | 4 bodies | 2.2 m, 100 |
| from 1.1 s (full) | beam III | 3 | 1000 | 31 bodies, 2 walls of 1.6 m, plates and shields | 2.8 m, 160 |

- *The trigger.* The press comes from the same buffer the semi-autos use (`takePress`), and only once the wait after the last shot is over. So a click up to 0.14 s early fires when the gun is ready, and a press held through the wait, a reload or a draw starts charging the moment it can. The charge is nothing for `tapTime` (0.1 s), then a line to full over `chargeTime` (1 s). Letting go fires the last stage reached, or a ball under the first; a press and release inside one frame is a ball. Right click lets a charge go with `railgun_fizzle` and spends nothing, and the trigger has to be pressed again. Anything that ends a loop ends a charge without a shot: `Weapons.endContinuous` calls `lance.cancel()`, which covers a switch, a reload, a quick melee, a pause, a holster and death.
- *The cell.* Twelve: a ball takes 1, a beam 2, a full beam 3, so a cell is still four full shots, or twelve balls. The charge climbs only as far as the cell can pay for (`chargeCap`): with two left it stops at the second stage, with one left it does not start and the release is a ball. A bottomless magazine charges to full on nothing. 48 in reserve, 96 at most.
- *The ball.* A `plasma` projectile with the `plasma` trail, 60 direct as a bullet with `force` 95, and a `plasmaBurst` of 40 over 2.2 m where it stops. Its job is to put things off their feet: the direct hit is about 1.75 of shock on a Trooper, past its fall line, and the splash goes through the blast rings like any blast, which throws or dazes whoever stood beside. Plates stop it (a Brute's take both the hit and the splash) and it still goes over. 4.2 a second at most (`interval` 0.24).
- *The beam.* A hitscan ray with the stage's `pierce`, drawn as `fx.beam('rail')` at the stage's `width` for its `linger`. The full one is armour-piercing, splits up to 3 of its kills (`cleave`), and adds a wide sheath for 0.12 s and a bolt along metres 2.5 to 11 of it.
- *The sweep.* A full beam is not one ray. It strikes `sweep.perFrame` (3) bodies and stops on the last; the next frame `tick` fires on from that body's point with what is left of its bodies, walls and range, and so on down the line, one split kill a frame. The `StruckList` it hands every ray is what keeps a body that lived (a boss, a warded man) from being struck by the next ray too, and `skipCorpses` on every ray after the first keeps it off the bodies it has just killed; corpses that were already lying in the line are struck by the first ray only, so one lying beyond the first three bodies is passed over. A line of twenty is seven frames, inside the hit-stop the first ray starts. A weaker beam is one ray, and so is a full one under Hellfire Rounds or a ricochet perk, which would otherwise burst or bounce at the end of every piece.
- *The bursts.* Each ray books a burst for every body it struck, at `chain.first` (0.04 s) plus `chain.gap` (0.035 s) for each body before it, on the world clock from the moment of the shot. `tick` sets off those that are due, earliest first, `chain.perFrame` (2) a frame at most. Each is a real `combat.explode` of kind `plasmaBurst` with no damage to the player, a bolt to it from the body before, and a ring round the line of the beam. The world clock is what the hit-stop slows, so the line holds for the freeze and then ripples.
- *What a burst does to a body.* The existing blast table, on its `plasmaBurst` row: no fireball, so nobody is gibbed, a ring that maims out to 62% of the radius and a ring that throws past it. Live, the three bystanders of a column of eight all died, with four limbs off between them and one burned to death.
- *How it reads.* While charging: `railgun_charge_loop` started at 0.42 of its pitch and bent up to 1 with the charge, `lance_stage` at each stage, 0.26 higher each time, and `railgun_ready` at the last; the view narrows by up to 7 degrees (`fovPull`, through `camera.setZoom`, which also slows the look by up to 11%); the bar under the crosshair steps colour at each stage (`docs/notes/ui.md`); the capacitors and the shake are `docs/notes/viewmodels.md`. The full shot: `railgun_fire` and `railgun_beam` with `lance_thunder` over them, kick 0.075 rad, shake 0.14, an FOV punch of 7 thrown from the charged view (83 to 97 degrees in the frame of the shot, back to 90 over `punchTime`, 0.2 s; a weaker beam by its `weight`; for those 0.2 s the look is up to 13% faster, as the zoom sets it), chromatic and radial blur, a pale flash, and a forced hit-stop of 0.06 s plus 0.018 a kill up to 0.14 whenever it struck a body. It also takes 2.5 m/s off the player's velocity along the ground, which the feet cancel within a frame when standing and which only shows in the air.
- *Bosses.* No single hit takes more than 5% of a boss (`src/enemies/bosses.ts`), so a full beam is worth 130 on a Juggernaut and its burst goes into the plates. Against a boss the balls are the better use of a cell; the beam is for the crowd round it.
- *Pooling.* The bursts are a pool of 32 links, the struck list 32 points, the sweep one object, the ball's blast one spec the projectile pool copies from, and the ball is the projectile pool. Every FX layer a burst touches is a GPU ring. Nothing is allocated by a shot.

**Penetration.** A budget is meters of concrete, on `WeaponDef.penetration` for the guns and on the spec for anything else. A wall costs its measured thickness times `PENETRATION.surface` (steel 1.5, glass 0.2, a shield never). A body costs `PENETRATION.body`, 0.4, or the round's own `bodyCost`, and twice that if its armour or shield blocked the round. Damage falls in a line from all of it with the budget untouched to `keep`, 0.55, with it spent. Range and falloff are measured through the wall.

**An armour-piercing round and a shield.** `armorPiercing` on the row sets `DamageInfo.armorPiercing` on every body and `pierces` on a plated one. Plates do not stop it, and neither does a Riot's shield: before, the shield blocked the Sabot's dart outright and the dart went on to kill everyone behind the one man it could not hurt. A ward still takes the hit for its owner and the dart goes on, at twice the body cost.

**Hellfire Rounds on a round that goes through.** The perk's burst used to go off only where the round stopped. The Harrow and the Sabot go through the first body, so the burst landed on whatever was behind the target, or nowhere. Now a round with `blastRadius` bursts on every body its budget takes it through, as well as where it stops. A body it passes for free under `pierce`, which is the Lance's way, gets no burst, as before. A burst is a real blast and can kill the next man in line before the round reaches him; the round then passes a corpse and bursts nothing there.

`wallExit` measures a wall with reverse rays. Probes step 0.15 m into the wall along the shot and each looks back the way it came: a probe still inside a box reads a hit at zero distance, because the world's boxes are solid to rays, and the first probe in the open sees the far face behind it. That gives the exit point, the far face's normal and the thickness in one to twenty rays, only for a round that has a budget and has met a wall. Stepping from the near side is what makes it find the first wall's far face and not the next wall's: the old `findExit` cast one ray back from the full depth, and through two walls it found the second.

The exit is `Combat.exitWall`: the surface's own impact off the far face, an `exit` decal, a puff the colour of the wall thrown on along the shot, and for a round of impact scale 1.5 or more (the Sabot) a short light on the face. The `exit` decal is a spall crater: a small black hole in a ragged patch of pale broken material about four times as wide, with flakes past its rim. It is the only pale mark in the decal atlas, which is what makes it show on a wall in shadow, and it is what tells the two faces of a wall apart afterwards: a dark pinhole going in, a pale crater coming out. The quad is 0.3 m times the round's impact scale, so the Harrow's crater is about 18 cm across and the Sabot's 30. A body passed gets a blood burst out of its back (`exitBody`). The tracer is redrawn from each hole, which is why the Sabot's is fast: all its pieces are on screen at once. A vehicle is not cover: its part takes the round and the round ends.

Projectiles do the same through `sweepThrough` and `goThrough`. A round with a budget meets everyone on its step's line in order through `raycastAll`, so it cannot skip a body standing behind another inside one frame.

Normal walls in the maps are 0.6 to 1 m, outer walls 1.6. The Sabot goes through the range gallery's 0.3, 0.6, 1.0 and 1.6 m walls and a steel sheet in one shot, 3.65 m of budget, and still kills. `PENETRATION.maxWall`, 3 m, is the most any single wall can be.

**The Lance's rule.** A full charge is on the per-wall rule it had before budgets: `penetrateWalls: 2` with `penetrate: 1.6`. In `passWall` that means any wall up to 1.6 m thick is passed, whatever it is made of, an energy surface included, and costs one of the two walls and nothing else. No surface factor, no total, no damage lost (`penetrateKeep: 1`), and a vehicle's hull is a wall like any other to it. Bodies are its `pierce`, 31 of them at full charge (24 for the old gun), free (`bodyCost: Infinity` keeps the budget out of it). The two walls are counted across the rays of its sweep (`StruckList.walls`). `?pierce=0` does not reach it. An earlier version of this work put the Lance on the metered budget, which stopped it in any steel wall over 1.07 m and made its 1.6 m a total across walls; that is gone.

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

**Key 8.** The owner's words: no buzzsaw thing, thicker barrels, bigger bullets and not a super fast assault rifle, very small explosions, a lot of shake, and it slows you; and beside it a heavy machine gun that is slower, hits far harder a round, gibs more and is the one that goes through walls.

- *The Trommel* is the BUZZSAW reworked: a 20 mm rotary cannon. The saw was three things and all three are gone: the name, the sound (a 300 Hz sawtooth under a 50 Hz barrage, now a low drive and 25 blows a second; `docs/notes/audio.md`), and the look (thin barrels behind a red toothed disc, and a reticle that spun; `docs/notes/viewmodels.md`). 25 rounds a second for 50, 32 damage for 13, so 800 a second for 650. `force` 34 is over the 30 a body can die on its feet under and over the 15 that floors a body hit in the head, so what it kills is knocked down and a head hit that does not kill puts a man on the floor, where the Buzzsaw's 6 did neither: both come from the number in the row, through `src/enemies` as it stands. By the tables an arm is gone in one round on a Trooper in the swarm (83 against a pool of 35; `severMult` 2.6), and in two on the Outpost's men, whose limbs wear at 0.3. Big brass (`casing: 'cannon'`), a `heavy` tracer on every round, and the `rotary` flash. Belt of 120, 240 carried, 360 at most.
- *Its spin.* `TUNING.buzzsaw`: 0.7 s to full, firing from 0.8 of that (0.56 s), the rate climbing from 0.45 of full over the rest, 1.1 s to run down. Right click spins it with no round leaving, as before. `Weapons` turns the spin loop's pitch and level with the barrels and the fire loop's pitch with the rate, plays the run-down from part way in for a gun let go part way up, and plays `minigun_fire`, the last round's report, when the barrage stops.
- *Its shake.* 0.03 a round in the first game's units, which at 25 a second holds the camera at 0.41 trauma: about 0.9 degrees of pitch and 1.1 of roll, re-rolled every 50 ms. The SMG's is 0.004. A kick of 0.0042 rad a round that settles at about a quarter of a degree of climb, a little FOV punch on each, and the viewmodel's own hammering on top (`viewmodels.md`). Shake is on the view only: rounds leave along the look.
- *The Piledriver* is the row under it: `mode: 'auto'`, no spin. 90 damage every 0.12 s, pushing with 48 N·s. At `severMult` 5 a round is 450 on a corpse, over the 420 a dead waist lasts, so one round cuts a dead body in two and the next bursts a half; measured at 38, 48 and 85 N·s, what a round throws is the pieces it cut, as far at 38 as at 85, so 48 was chosen for the living: a Brute staggers on its second round, not on every one. It is a heavy round to everything that asks (60 or more): it carries on through a plate it breaks and knocks a body cold with a head hit it lives through. `kick` 0.016 and a real `climb`, a quarter of the Thresher's. 50 on the belt, 3 s to change it.

**Bursts.** `burst` in a row, `burst.ts` for the rule, `src/fx/recipes/cannon.ts` for the look. A 20 mm round goes off where it lands: a white core the size of a grapefruit with a few rays, a pop of fire about 20 cm across that is gone in a tenth of a second, sparks and a puff of dust, a short light for every other one, a scorch for one in three, and `cannon_burst` at the point. Fifteen particle records and two flash sprites, where the smallest explosion in the game, the Hellfire round's, is sixty and a 2 m fireball. Fragments reach `radius` (0.45 m) from the burst to a body's skin, taken as 0.25 m off the line from its feet to its head, and do `damage` (10) at the burst falling to half at the edge, as one quiet `bullet` strike with a push of 8 N·s; cover between the burst and the body stops them. The body the round itself struck gets the round and no fragments. Bodies have to be nearly touching for it to reach from one to the next: it is the look and the sound of an explosive round far more than it is splash, which is what was asked. `?burst=0` takes bursts out everywhere.

**The door gun** (`src/progression/callins/doorGunner.ts`, numbers in `heliData.ts`, `DOOR.gun`) is the one gun with both: `burst` and `penetrate` on the same spec. 30 rounds a second for 60 and 60 damage for 22, so a third more a second; 1.4 m of budget, which is a roof or an inner wall and the man under it; a burst half as big again as the one on foot, to be seen from the air. A penetrating round bursts on the first thing it strikes, wall or body, and again where it stops. `?doorgun=old` is the M134 as it was.

**Heavy guns slow the player** (`handling.ts`). `slow` in a row is ground speed while the gun fires, as a share of run speed: 0.5 for the Trommel, 0.72 for the Piledriver. The Trommel is also held to `TUNING.buzzsaw.moveSpeed`, 0.8, while its barrels turn with nothing leaving them. The cap eases in at `TUNING.handling.rise` from the first round and out at `fall` once `hold` has passed with none, so it comes on over about a tenth of a second and goes over a quarter. It is written to velocity, because progression rewrites `modifiers.speed` every frame, after weapons run. The player re-accelerates at 120 Hz between our once-a-frame clamps, so on the ground the clamp sits half a frame's regain below the target. It reads `MOVE.runSpeed` and `MOVE.groundAccel` directly, because a copy of those went stale when DESIGN section 13 retuned the ground.

What it leaves alone: a dash, a slide, a wall run, a climb, a vault and a slam, and any speed past 1.5 times a run (`TUNING.handling.leave`), which a pad, a blast or a slide hop put there. What a move leaves behind under that is carried, not cut: a dash ends at 13 m/s and a dash-jump at 18, and a hard clamp the frame after stopped the player dead where the move ended (the review measured 13 to 5.7 and 18 to 6.25 in one frame). Now speed a move left, or any speed over a run, bleeds down at `TUNING.handling.carry` (30 m/s a second) net of what the legs or a held key in the air give back, and the clamp takes over once it reaches the cap; `Handling.carrying` holds that from frame to frame. An ordinary jump is held to the cap as the ground is. The Buzzsaw only dragged gently in the air, and measured live that was no slowdown at all: the air gives speed back to a player under run speed faster than the drag took it, and a hop with the trigger held kept 12.5 m/s. `?slow=0` takes the whole thing out.

**`?slot8=old`** puts the BUZZSAW's row back (name, 50 rounds a second of 13, no bursts, its belt, its light shake, its spin times and its 0.62 while spun), its own model, its old wound, and takes the Piledriver off the key, even where the lab's arsenal hands every gun over (`families.ts` gives key 8 the Buzzsaw alone). The fire loop plays at the old 50 a second (its pitch reads the row's `interval`), and the Commander calls it the Buzzsaw again, with his recordings. The other sounds stay the new ones, and so do the handling rules above.

**Key 5.** One class, `melee/Melee.ts`, swings all five weapons; `equip(id)` picks the row of `MELEE` it reads. `?melee=old` (`MELEE_FOUR_ON` in `families.ts`) leaves the katana alone on the key. What a swing touches is `melee/sweep.ts`:

- *The slab.* A swing's plane holds the eye, the crosshair's line and the direction the blade crosses the screen (`sweep`), so every swing passes through what the crosshair is on. Inside the plane the blade covers `arc` radians centred on the crosshair, out to `reach` meters; out of the plane it is `width` thick either side. A thrust is a cone of `arc` along the crosshair. A body is an upright capsule (its feet, its height, its row's `radius` times 0.85), and `reach` is measured from the eye to the body's surface. Where it is struck is the point of its axis nearest the plane, and of those the nearest the crosshair, so a cut lands where the player aims; a ray from the eye at that point finds the bone and region. A body whose surface is within `pointBlank` (about 0.5 m) and not behind the eye is struck by any swing.
- *Reaching down.* A body wholly under the slab (a Skitter at the feet, a man on the floor) is met by the same swing aimed lower, at the top of the body, by no more than `REACH_DOWN` (0.8 rad). Its reach does not grow, nothing behind or above is reached by it, and a swing at a standing man is the same with it or without it. Without it every flat swing of the five passed over a Skitter at a walking look. A body that is `downed` is `DOWNED_HEIGHT` (0.6 m) tall to a swing, not its standing height.
- *Cover.* A world ray from the eye to the near side of the body. Anything behind a wall is safe, however close.
- *The step.* A body past a swing's reach but inside reach plus `step` (0.6 to 0.8 m) pulls the player in at `stepSpeed`, arriving 0.3 m inside reach as the step's time runs out; the swing stays live for its whole length while it does. Held through a chain, each swing steps again: the katana held 1 s walked 1.9 m and cut three bodies at 1.5, 2.5 and 3.5 m. Nothing is pulled from further.
- *Impact.* `impact` is the share of a swing before its blow lands, for the wind-up of a slow one (the Prybar's overhead at 0.38, the Spade's edge at 0.4). Unset is the frame of the click, as the katana's always are. The model winds up over the same share.
- *The katana's reach.* Each swing reaches 2.0, 2.1 and 2.2 m, and with its 0.8 m step 2.8 to 3.0 m to the front of a body. Its arcs are 115 to 143 degrees, its slab 0.5 m either side. Before this it was a 120 degree cone 5 m from the eye with anything within 1.7 m struck, behind included, and a lunge from 10 m on every swing: it cut at about 10 m standing still. `?blade=old` puts all of that back.
- *The katana's dash* (`KATANA.dash`), its own move: a swing while moving at 7 m/s or more along the crosshair (a run is 12.5) toward a body within 7 m and 22 degrees of it pulls at 30 m/s for up to 0.15 s, with a 5 degree FOV punch and `blade_dash`, and the swing stays live until it arrives. Standing still it never fires. Measured live: peak 30 m/s, the trooper cut on arrival; the same swing standing at 6.5 m moved the player 1 cm and touched nobody.
- *The charged sweep* (`SWORD.area`) is flat, 160 degrees, and reaches `KATANA.area.reach`, 3.2 m, 2.24 m on a tap; it was 8 m. The finisher is unchanged: a blast of radius 8, 3 m ahead.

| | Shiv (`knife`) | Prybar (`crowbar`) | Spade (`shovel`) | Cosh (`baton`) |
|---|---|---|---|---|
| Damage, type | 32, a cut | 60, a blow | 60 a blow with the face; 96 a cut with the edge | 10, a blow |
| Swings | 2, 0.17 s and 0.18 s | 2, 0.4 s and 0.44 s | 2 flat, 0.58 s and 0.62 s | 3, 0.23, 0.23, 0.3 s |
| Right click | thrust, 2.4 times | overhead, 1.75 times, waits 0.24 s | the edge, overhead, waits 0.29 s | a jab |
| Reach, step | 1.6 m, 0.6 | 1.9 m, 0.7 | 2.3 m, 0.7, and 150 degrees wide | 1.8 m, 0.6 |
| Push (`force`) | 25 | 110, 190 overhead | 300 | 95, 120 on the third, 150 the jab |
| Draw | 0.08 s | 0.2 s | 0.3 s | 0.12 s |
| Its point | 3 times on a back turned (`bonus.behind`, cos 0.3) or anyone reeling, falling, down or getting up | breaks the limb it lands on; through plate for 1.5 times | the face throws what it kills; the edge takes a head at the neck | knocks people down and barely hurts them |

How each gets there, all through the data a hit carries and the systems that already read it; nothing in `src/gore` or the ragdoll, reaction and wound code changed:

- *Where a flat club swing lands.* A ray at the middle of a Trooper at a walking look (pitch -0.12) meets his neck, which is the head region: a Prybar or Spade blow there killed him (60 times `headshotMult` 1.5) and burst his head. So a club's flat swing (`type: 'melee'`, not a thrust) casts its ray at the side the blow comes from, 0.55 then 0.3 of the body's radius out (`SIDE_BLOW`), and at the middle only if both pass the body. Live, the same blows now land on the arm on that side. A deliberate blow at the head is still a head blow.
- *Blows are `type: 'melee'`* with `severMult` 0, so no limb pool is worn and nothing is cut. Butcher (`alwaysSever`) does not change that: a blade under Butcher takes everything, a club still takes nothing. `gore/wounds.ts` already strains the struck bone by a melee hit's full damage, and `WoundTuning.breakAt` is 60 for a man-sized limb: one Prybar blow on an arm or leg breaks it, and a broken arm or leg is what `DamageModel.updateMaim` reads. Measured live: a Prybar blow on a Trooper's arm took 37 and broke it.
- *Staggers and knockdowns* are `src/enemies/reactions.ts` reading the push: a blow's `force` over the body's mass plus its share of health. A Cosh blow to the head floors a body whatever its health (`HEAD_KNOCK_FORCE`, 15 N·s). Measured live on a Trooper, one Cosh blow a third of a second: 55, 45, 32, 22, 12, dead, down from the first blow to the last. A head counts as a head for clubs and the Spade (`heads`); for the katana and the Shiv a head is the chest, as a sword cut always was.
- *The Shiv's bonus* reads the real enemy's `stagger`, `downed`, `rising` and `fallIn`, and its `yaw`, through a structural cast; nothing on `EnemyInstance` changed. Live: one cut on a Gunner's front, 32; on its back, dead.
- *The Prybar on plate* is the shaped charge's rule (`StrikeOptions.charge`): on a body with a plate left the blow is 1.5 times and goes through the plates. A Riot's shield still stops it. Live: a Brute took 98 from the overhead and had its arm broken.
- *The Spade's face* throws a body it kills with `Physics.radialImpulse` from 0.8 m behind the body along the swing, radius 1.8, strength 120 (`fling`), which is how a blast throws one, and gore's own listener carries the ragdoll. A single impulse on one bone is capped at 6 m/s (`RagTuning.maxImpulseSpeed`), which would barely move a body. Live: a Trooper killed by the face lay 2.7 to 2.9 m from where it stood (three runs), against 1.0 to 1.2 with the bone impulse alone and 1.8 to 2.3 for the shotgun at 2 m. It also throws any corpse or knocked-down body within that 1.8 m.
- *The Spade's edge* is a cut (`type: 'slash'`, `severMult` 1.2). On a kill where it struck the head, it sets `slicePlaneNormal` across the neck, from the neck bone toward the head, so `gore.slice` takes the head off there, whichever way the swing went (`beheads`). Live: every edge test reported the kill as sliced at the head.
- *A club kills and leaves the head on.* The one hook outside the weapons: in `DamageModel.lethal` (`src/enemies/damage.ts`), a head kill typed `'melee'` ragdolls the body limp, as a light round's head kill on an outpost body does, instead of going to `gore.headshot`, which bursts a head at 40 damage or more. Only key 5's blows strike an enemy typed `'melee'` (enemies hit the player with it, never each other), so no other weapon's kill changes. The Spade's edge still takes a head, with its slice plane, which is tested before this.
- *Kills on key 5 feed the last gun*, count for the Commander's melee habit and for Adrenaline (`progression/index.ts`), as sword kills did.

**Lunge** (`?blade=old` only). A dash at 30 m/s for 0.16 s toward the target, renewed every frame and homing on it. A single shove is worth about a meter once ground friction has had it (`15^2 / (2 * stopDecel)`).

**Slices cost about 5 ms each.** A sweep slices 3 kills per frame and the rest ragdoll. A full Lance shot splits 3, one a frame of its sweep.

Measured over 80 s of the real game, with the bot holding the trigger on the SMG and only collecting what it runs over: reserve fell from 360 to 180 by wave 2, then 5 ammo pickups took it to the 720 cap, across 59 kills and 3 waves. It never went dry. The old wave-2 dry-out came from a 240 reserve running out before the first pickup, with a bot that does not chase drops, so the fix there was the bigger SMG reserve and the fallbacks, not more drops. One pickup is 180 SMG rounds and the economy now leans generous. If that turns out too loose, cut `PICKUP.ammo` in progression before touching the reserves.

## Tuning

| Want | Change |
|---|---|
| Weapon stats, sound, kick, shake | `WEAPONS` row. `kick` is camera radians, `shake` is first-game intensity, `recoil` is viewmodel only |
| Which gun takes limbs | `canSever` in its row, then `severMult` for how readily |
| What a gun goes through | `penetration` and `bodyCost` in its row. What things cost: `PENETRATION` |
| Reach | `falloff` in its row: `from`, `to`, `floor`. Unset is full damage at any range, which is every gun but the SMG (35 to 80 m, half) and the Rivet (25 to 55 m, half). `?reach=0` takes it out of every gun |
| A new family member | See "Adding a family member". Its key order is where its row sits in `WEAPONS` |
| The Quiver | `TUNING.quiver`: mark rate, cone, turn rate, weave, speeds, blast. Damage and salvo gap in its row |
| The Thresher's climb | `climb` in its row. `?climb=0` takes it out |
| Key 4 as it was | `?slot4=old`: the autocannon first and from the start, the Sabot with it, no autocannon in a cache |
| The Trommel's rate, round, shake, kick | Its row, `buzzsaw`. Spin-up, run-down and the rate's climb: `TUNING.buzzsaw` |
| A burst | `burst` in the row: `radius`, fragment `damage`, `scale`. Fragment push and the shake of one nearby: `TUNING.burst`. Its look: `src/fx/recipes/cannon.ts`. `?burst=0` takes it out |
| How much a heavy gun slows the player | `slow` in its row, and `TUNING.buzzsaw.moveSpeed` for barrels turning. How fast it comes on, and the speed it leaves alone: `TUNING.handling`. `?slow=0` takes it out |
| How often the Piledriver bursts a body | `gib` in its row, a chance a round |
| The door gun | `DOOR.gun` in `src/progression/callins/heliData.ts`. `?doorgun=old` is the M134 |
| Key 8 as it was | `?slot8=old` |
| What fires a gun | `mode` and `round` in its row |
| The Lance through walls | `TUNING.lance.penetration` (thickest wall), and `walls` on the stage (how many; the old gun reads `TUNING.lance.walls`) |
| The Lance's charge | `TUNING.lance`: `tapTime`, `chargeTime`, and `at` on each of `stages` |
| What each stage fires | `stages[]`: `cost`, `damage` (a share of the row's), `pierce`, `walls`, `cleave`, `pierces`, `burst`, `burstDamage`, `weight`, `width`, `linger` |
| The plasma ball | `TUNING.lance.ball`: speed, damage, `force` (what floors a body), splash, size. Rate: `interval` in the row |
| The chain of bursts | `TUNING.lance.chain`: `first`, `gap`, `perFrame`. What a burst is: `EXPLOSIONS.plasmaBurst`, its look in `src/fx/recipes/explosions.ts`, what it does to a body in `BLAST.rings` |
| How many bodies a full beam strikes a frame | `TUNING.lance.sweep.perFrame`, and `cleave` for split kills a frame |
| The full shot's weight | The row's `kick`, `shake`, `fovPunch`, `recoil`; `HIT_STOP.lanceShot`, `lancePerExtraKill`, `lanceMax`; `TUNING.lance.fovPull`, `punchTime`, `push`, `recover` |
| The Lance as it was | `?lance=old` |
| The exit crater | `EXIT_CRATER` and `EXIT_FLASH_SCALE` in `Combat.ts`. Its look: `exitHole` in `src/render/materials/decalAtlas.glsl.ts` |
| Ammo pressure | `reserve`, `maxReserve` per weapon, `TUNING.ammo` |
| Rocket jump | `TUNING.rocket.playerPush`, `selfDamage`. `EXPLOSIONS.rocket.selfCap` |
| Key 5's swings and reach | `MELEE[id]` in `melee/data.ts`: `chain`, `heavy`, each swing's `reach`, `arc`, `width`, `impact`, `force`, `sever`, `fling`; `step`, `pointBlank`, `bonus`, `armour` per weapon. Damage, push and draw in the `WEAPONS` row |
| The katana's specials | `KATANA.dash`, `KATANA.area` in `melee/data.ts`; `SWORD.windup`, `.area` (damage, timing), `.finisher`. Its swings' timing and damage are still `SWORD.chain`. `?blade=old` is the reach before this |
| Blast feel | `EXPLOSIONS[kind]`: `shake`, `shakeRange`, `edgeDamage`, `impulse`, `selfCap` |
| What a blast does to a body | `BLAST` and `OUTCOMES` in `src/enemies/blast.ts` |
| Armour against rockets and shells | `SHAPED_CHARGE` |
| Push on bodies | `force` in each `WEAPONS` row, `TUNING.shotgun.pointBlankForce`, `TUNING.blastForce`, `EXPLOSIONS[kind].impulse`. Bands are in `src/gore/forces.test.ts`, the measured table in `docs/notes/lab.md` |
| Impact | `HIT_STOP`. 30 ms reads as a punch, 100 ms as a stumble |

## Testing

```
nice npx vitest run src/weapons/families.test.ts --testTimeout=60000      # 16: the table, the keys, the wheel, ownership, per-member ammo, the dry-gun order
nice npx vitest run src/weapons/swarm.test.ts --testTimeout=60000        # 26: painting, stacking, release, turn, retarget, weave, the fuse, the Quiver and Thresher on the range
nice npx vitest run src/weapons/penetration.test.ts --testTimeout=60000   # 48: budget, the per-wall rule, wall probe, hitscan, bursts, every gun, the Lance, projectiles at 30/60/144
nice npx vitest run src/weapons/heavy.test.ts --testTimeout=60000         # 33: key 8's table, the cannon's rate and bursts, fragments, the heavy machine gun through walls, the slowdown and its moves, the door gun
nice npx vitest run src/weapons/melee/sweep.test.ts --testTimeout=60000   # 24: reach, arc, slab, thrust, point blank, nothing behind, every swing of key 5 held to its reach, reaching down
nice npx vitest run src/weapons/melee/melee.test.ts --testTimeout=60000   # 18: the katana's reach, step, wall, dash and sweep on real Rapier; the four's damage, type, bonus (back, reeling, down), plate, chain, key 5, a Skitter at the feet, Butcher
nice npx vitest run src/weapons/lance.test.ts --testTimeout=60000         # 52: the charge and the cell, the chain's pool, a tap, each stage, the sweep and its corpses, the bursts at 30/60/144, walls, armour, the FOV punch, what cancels it

node tools/shot.mjs --url "/?map=range" --script tools/scripts/families-live.mjs --wait 500 --timeout 280 \
  --dpr 2 --w 1440 --h 900 --out tools/out/fam/live.png      # real keys and real enemies on the range's piercing gallery.
                                                             # FAM_ONLY=keys,gallery,holes,tracer,shield,hellfire,lance,reach,exits,cost
node tools/shot.mjs --url "/?map=range" --script tools/scripts/melee-live.mjs --wait 500 --timeout 300 \
  --dpr 2 --w 1440 --h 900 --out tools/out/melee/live.png   # key 5 on a line at 1.5 to 8 m, the dash, the bonus, a break, the fling, the edge
                                                             # MELEE_ONLY=keys,reach,four,back,baton,crowbar,fling,edge,dash
node tools/shot.mjs --url "/?map=range" --script tools/scripts/swarm-live.mjs --wait 500 --timeout 300 \
  --dpr 2 --w 1440 --h 900 --out tools/out/swarm/live.png    # keys, a five-man arc painted and killed, a Juggernaut, a tank, a tap, the Thresher
                                                             # SWARM_ONLY=keys,paint,stack,heavy,tank,tap,thresher
LANCE_ONLY=chain,partial node tools/shot.mjs --url "/?map=range" --script tools/scripts/lance-live.mjs --wait 500 --timeout 285 \
  --dpr 2 --w 1440 --h 900 --out tools/out/lance/live.png --quiet   # LANCE_ONLY=tap,stages,chain,partial,twenty,walls,heavy: two or three
                                                             # steps a run. Results in tools/out/lance/live.json, stills beside it.
                                                             # The same with "/?map=range&lance=old" drives the old gun (old-*.jpg)
```

`/?sandbox=range&only=quiver` and `&only=thresher` run their checks at 30, 60 and 144 fps. `&only=lance` runs the Lance's (38), and `&only=lance&lance=old` the old gun's (8).

```
/?sandbox=range                 # stepped clock, stand-in enemies, every number exact at 30/60/144 fps
/?sandbox=range&only=sword      # tests whose name contains the text

RL_GROUP=guns node tools/shot.mjs --url "/?sandbox=range&live=1&load=husk,trooper,smg,pistol,brute,minigun" \
  --script tools/scripts/range-live.mjs --wait 1000 --timeout 220 --out tools/out/rl-guns.png
```

`range-live.mjs` is the real game with waves off: real map, real enemies, real gore. Groups are `guns`, `heavy`, `sword`, `perks`, `view`, `world`. `RL_ONLY=a,b` reruns named steps. Kills in these runs trigger real perks, so a later step can be running under Blood Thirst.

```
node tools/shot.mjs --url "/?map=range" --script tools/scripts/heavy-live.mjs --wait 500 --timeout 290 \
  --dpr 2 --w 1440 --h 900 --out tools/out/heavy/live.png    # key 8 in the real game. HEAVY_ONLY=view,rotary,hmg,gallery,slow,cost,door
HEAVY_ONLY=doorwalls node tools/shot.mjs --url "/?map=killhouse&autostart=1" --script tools/scripts/heavy-live.mjs ...   # the door gun, sight held on men behind cover
node tools/shot.mjs --url "/?map=range&slot8=old&doorgun=old" --script tools/scripts/heavy-switches.mjs ...              # what the switches leave
```

A still at dpr 2 takes ten to twenty seconds on a busy machine and the game runs on while it is taken, so `heavy-live.mjs` times everything in the page and takes its stills after. Run it a few steps at a time: the whole list does not fit one 290 s slot.

## Verified

**Key 5, after review** (`tools/out/melee-fix-live.mjs`, Test Range, AI off, no console errors). A Trooper 1.9 m out at a walking look: the Prybar's first swing hit his left arm, 60, arm broken, 24 left; the Spade's face the same arm, broken, on the floor; the Cosh the arm for 10. Aimed at the head (pitch 0.02) the Prybar and Spade kill with the head on (`headOff` false), as does a Prybar kill at 30 health. A Skitter 1.2 m out at a walking look: one swing of each of the five struck and killed it (it had been 0 for the four and only the katana's first swing). The Cosh floored a Trooper in four blows and threw it 3.7 m; walked up to 1.3 m, one Shiv cut at a walking look took 96 (three times) and killed it. The Spade's edge at the head: sliced at the head, two of two. `sweep.test.ts` 24 of 24, `melee.test.ts` 18 of 18, `/?sandbox=range&only=sword` 68 of 68, `&only=melee` 38 of 38.

**Key 5** (melee stream). `sweep.test.ts` 16 of 16, `melee.test.ts` 15 of 15, `families.test.ts` 18 of 18. `/?sandbox=range` 315 of 315, its sword and melee groups at 30, 60 and 144 fps; `&only=sword&blade=old` 59 of 59 on the old reach. `melee-live.mjs` on the Test Range, real keys and mouse, Troopers with AI off at 1.5, 2.5, 3.5, 5 and 8 m to their fronts, no console errors:

| Thing | Result |
|---|---|
| Keys | `5` five times from the sword: Shiv, Prybar, Spade, Cosh, Sword. The HUD strip reads `5 SWORD SHIV PRYBAR SPADE COSH` |
| Katana held 1 s, standing | 1.5, 2.5 and 3.5 m sliced, 5 and 8 m untouched; the player stepped 1.9 m over three swings |
| The four, each held 1.2 s | Shiv and Prybar killed the first three, 5 and 8 m untouched. Spade: one dead, two at 31 and 28 with a bone broken each. Cosh: one dead, two on the floor |
| Dash | Running in from 9.4 m and swinging at 6.9: 30 m/s, cut on arrival. Standing at 6.5: no pull, nothing struck |
| Shiv | One cut, a Gunner's front: 90 to 58. Its back: dead |
| Prybar | A Trooper's arm: 37 and broken. A Brute, overhead: 98, arm broken, through its plate |
| Spade | Face kill: hips 2.94, 2.74, 2.94 m from where it stood. Edge at head height: sliced at the head, three of three |
| Cosh | A Trooper, a blow every 0.38 s: 55, 45, 32, 22, 12, dead, on the floor from the first |

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
| Buzzsaw, before its rework into the Trommel | 49 rps once spun, nothing before 0.44 s, limbs come off a brute. Held 10.3 m/s against a 10.5 target live. See "Key 8, measured" for the gun as it is |
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

**Quiver, Thresher and key 4**, measured. Unit tests and the range sandbox (230 of 230) on a stepped clock; `swarm-live.mjs` in the real game on the Test Range with real keys:

| Thing | Result |
|---|---|
| Keys | `3 3 3 2 2 4 4` drew Rocket, Quiver, Rocket, Shotgun, Thresher, Sabot, Sabot (no autocannon yet). After `give('autocannon')`: `4 4` drew Autocannon, Sabot. A fresh run owns no autocannon |
| Paint | Five Troopers in an arc 20 to 28 m out: marks 0, 1, 3, 4, 4 at 0.12, 0.37, 0.62, 0.87, 1.12 s held; four different targets, four brackets, `LOCK 4/4`. All four marked died in every run after the fuse fix, the fifth was untouched |
| Rate | First mark 0.2 s after the press plus a frame at 30, 60 and 144 fps; missiles 0.1 s apart (one 30 fps frame of slack on the first gap) |
| One target | A Juggernaut alone: `JJJJ`, the bracket reads `x4`. 2600 to 2080 from one salvo. Four ROCKETs on the same Juggernaut: 260 |
| Tank | Painted on its hull four times; 1000 to dead from one salvo |
| Tap | Four dumb missiles, none aimed |
| Thresher | 10 shells in 2 s at 30, 60 and 144 fps; climb 0.106 to 0.112 rad over the 2 s; 20 shells then the drum reload. Live: a Trooper at 9 m dead with two limbs off |
| Hitch | Worst frame across a salvo, Test Range at dpr 2 on a machine at load average 11 to 15: 23 to 62 ms on later salvos, 46 to 131 ms on the first of a page. A ROCKET's first blast of a page measured 78 to 204 ms the same way. Not separable from the machine's load; no repeatable spike of the Quiver's own |

**The Lance**, measured. `lance.test.ts` (48, 52 after review) and the range sandbox (38 of 38, and the old gun's 8 of 8 with `&lance=old`) on a stepped clock; `lance-live.mjs` in the real game on the Test Range, the trigger through `input.simulate` so a tap is a tap at any frame rate, Troopers with their AI off, on a machine at load average 7 to 35. Stills in `tools/out/lance/`.

| Thing | Result |
|---|---|
| A tap | One ball at 80 m/s for 1 of the cell, no charge shown. On a Trooper at 14 m: from 70 to 7, a limb off and on the floor. In two earlier runs it died, once gibbed, which the burst can no longer do. The Trooper 1.5 m beside it: 70 to 47. The one 5 m off: untouched |
| Eight taps, 0.25 s apart | Eight balls. Seven in a run at about 20 fps, where the two frames a tap takes push one past the 0.14 s buffer |
| A Brute, two balls | Plates 322 to 244, health 260 to 251, on the floor |
| The charge, held still at four levels | Bar grey at 22%, cyan at 47% (`s1`) and 85% (`s1 s2`), white in its frame at full. FOV 90, then 89.7, 88.5, 84.9, 83. Look scale 1 to 0.885. Both back the moment it fires |
| Full beam down eight Troopers, three more beside the line | All eight dead by the beam, over three frames. Bursts gone off 0.07, 0.14, 0.24 and 0.38 s after the shot: 2, 4, 7, 8. Beside the line, three runs: 3 dead with 4 limbs off, one of them burned; 2 dead and 1 on the floor with 5 limbs off; 3 dead with 9 limbs off. Each burst left one 1.4 m scorch on the floor, which is hard to make out under the bodies on the range's pale concrete. The old gun: eight dead, nobody beside touched |
| First stage, same column | 2 of the line dead, 2 bursts, 1 bystander hurt, cell 12 to 10 |
| Second stage | 5 of the line dead, 5 bursts, 2 bystanders hurt, cell 12 to 10 |
| Piercing gallery, full beam | The bays behind the 0.3 and 0.6 m walls dead with a burst in each, the third wall stopped it |
| A Brute and a Riot, one full beam each | Dead. The Brute had 260 health behind 322 of plates |
| A Juggernaut, one full beam | 2600 to 2470, which is the 5% a boss allows a single hit, and its plates took the burst |

What twenty cost. Twenty Troopers in line from 8 to 29.5 m and seven beside them, one full beam, the second volley of a page, frame p50 17 ms before the shot. Worst frame, and the ray or rays that did the killing:

| | Old gun, `?lance=old` | The sweep |
|---|---|---|
| Worst frame | 192 ms, the frame of the shot | 86 ms, the third of seven |
| The rays | one, 142 ms | seven: 11, 6, 67, 9, 8, 15 and 6 ms |
| Frames over 50 ms in the 2.4 s after | 3 | 2 |
| Frame p50 and p95 over those 2.4 s | 20.6, 40.7 ms | 24.7, 39.1 ms |
| The bursts | none | 20 over 20 frames: 50.7 ms in all, 5.4 ms the worst, never 2 in a frame here |
| Dead | 20, nobody beside | 20, and 6 of the 7 beside |
| The first volley of the page | 490 ms | 318 ms: rays 43, 24, 176, 19, 21, 15, 14 |

Before the sweep the new gun killed all twenty in one ray like the old: 362 ms against the old gun's 357 in the same hour, at load average 30. So the cost was never the bursts. It is what a death costs in `enemies` and `gore`, about 6 to 15 ms each here, and the sweep spreads it.

After review, two things changed: the later rays of the sweep no longer strike corpses (they had been striking the beam's own kills of a frame before, two or three at 1000 damage a ray), and the slow third ray was profiled. Same setup, load average about 8 (`tools/out/railgun-final/`):

| | First volley of the page | Second volley |
|---|---|---|
| Worst frame | 67 ms | 40 ms |
| Frames over 50 ms in the 2.4 s after | 1 | 0 |
| Frame p50 and p95 | 16.7, 25.3 ms | 16.6, 19.5 ms |
| The rays | 11.7, 7.3, 40.7, 5.3, 3.1, 2.8, 1.7 ms | 3.7, 6.1, 29.8, 2.5, 1.7, 2.0, 1.2 ms |
| Corpse hits by the beam, per ray | 0 in every ray | 0 in every ray |
| The bursts | 20, 33.4 ms in all, 4.4 worst | 20, 21.1 ms in all, 2.5 worst |
| Dead | 20 of 20 | 20 of 20 |

A sampled profile of a third run (rays 4.9, 3.5, 26.1, 2.3, 2.0, 1.8, 1.6 ms) put half the time inside the Lance's rays in `gore` cutting a body in two (`slice`, `cutMesh`), and most of the rest in the deaths themselves: a head kill, ragdolls being made, Rapier colliders. The third ray is the one with a cut and a head kill in it. All of that is gore and enemy code this work must not change; the Lance's lever on it is how many kills it cuts (`cleave`, 3).

**Key 8, measured.** `heavy.test.ts` on a stepped clock (33 of 33, with the carry after a dash and the Commander's word), the range sandbox's three cannon checks at 30, 60 and 144 fps (9 of 9), and `heavy-live.mjs` in the real game at dpr 2 with real pointer lock, on a machine whose load average ran from 16 to 84 while it was measured. Stills in `tools/out/heavy/`.

| Thing | Result |
|---|---|
| HUD | "Trommel", `8 TROMMEL PILEDRIVER` under it, two pips on key 8, the new icons (`live-view-buzzsaw-rest.png`) |
| Trommel, rate | 25.6 and 24.6 a second once spun, live. Nothing leaves before 0.56 s, then exactly its rate at 30, 60 and 144 fps in the tests |
| Trommel, bursts | 122 rounds and 122 bursts in one run, 149 and 149 in another: one each. No `fx.explosion` at any point. On the lab's nine, with its files 0.65 m apart, 3 fragments landed in 149 rounds; at 0.9 m apart, none |
| Trommel, the piercing gallery | Two seconds down the lane: all five bays untouched, 45 bursts on the first wall |
| Piledriver, one round | Down a file of three Troopers 1.3 m apart: three hits, three kills, in both runs. In the second the round had rolled its `gib` and all three burst |
| Piledriver, held | 8.9 a second counted from the first round. The aim climbed 0.051 rad in two seconds |
| Piledriver, the gallery | 1.5 s: the bays behind the 0.3, 0.6 and 1.0 m walls dead, the two behind the 1.6 m wall untouched. The first rounds stop in the third wall, 0.9 m of budget short after two bodies; once those are down the next ones reach the third bay |
| Speed, by ground covered, W held | Free 12.5. Trommel with the barrels turning 10.3 to 10.4 against a 10.0 target, firing 6.65 to 6.7 against 6.25. Piledriver firing 9.4 against 9.0. Both back at 12.5 after. The half metre over is this machine's 25 to 30 fps; the sandbox holds the average within 0.6 at 30, 60 and 144 |
| A hop as the trigger goes down | 12.3 m/s at take-off, 10.5 half a second later, which is the barrels' cap at that moment. Before the cap held in the air: 12.5 |
| 24 bodies with their AI on, six seconds a gun | SMG 216 frames, p50 33 ms, p95 67, physics step p50 1.6, p95 6.1, worst 75. Trommel 188 frames, p50 33, p95 67, step 2.1, 6.6 and 13; 27.5 bursts a second, 5 kills, 7 limbs. Piledriver 190 frames, p95 83, step 2.8, 7.2 and 44; 7 kills, 2 bodies burst, 5 limbs. An earlier pass of the same on a busier machine: Trommel 150 frames, p50 50, step p95 13, with 7 kills and 12 limbs |
| One burst, CPU | 0.05 to 0.19 ms, 300 timed with 24 Troopers standing by; the slow ones are the first batches |
| The Trommel into a bare wall, five seconds | With bursts 246 and 239 frames, without 269; p50 16.7 ms and p95 33 in all three. About one frame in ten, on a machine at a load average of 80, before the burst's light was cut to every other one. Not measured again after |
| Door gun, Test Range, fourteen Troopers | 30 rounds a second, 1.07 bursts a round, 12 of 14 dead in under ten seconds. Frames p50 16.7, p95 50, worst 300; step p50 1.2, p95 4.7 |
| Door gun, Kill House, sight held on men behind cover, 14 s | 73 hits, 67 of them on a body the gun had no line of sight to; 8 kills, 6 of them blind. 667 bursts. Frames p50 33, p95 67, worst 250; step 2.9, 7.4, worst 23 |
| `?slot8=old&doorgun=old` | "Buzzsaw", no Piledriver with it, 50.2 a second, no bursts, 8.0 m/s while firing (its 0.62), belt `M134 7.62 1800` |
| `?burst=0&slow=0` | Trommel 24.6 a second, no bursts, 12.5 m/s while firing |
| A dash with the Trommel firing, W held (`tools/out/minigun-final.mjs`) | 5.67 m/s before; the dash at 26; after it 13 down to 5.67 in about a quarter of a second, no frame losing more than 0.51 m/s. A dash-jump: 17.5 in the air down to 6.25 in about 0.35 s, no frame losing more than 0.92. Before the fix one frame took 13 to 5.7 |
| `react-chaos.mjs`'s crowd on `?map=range`, 7 s each, after the light was cut to every other burst | Chaos alone (24 bodies, AI on, a rocket blast every 0.45 s): p50 16.6 ms, p95 19.2, worst 38.6; step p50 1.0, p95 1.9, worst 9.1. With the Trommel held into it: 22.9 bursts a second, p50 16.6, p95 19.3, worst 26.7; step 1.3, 2.0, 2.3. With 60 door-gun bursts a second (scale 1.5) on top: p50 16.7, p95 18.5, worst 25.9; step 1.6, 2.7, 5.3. No console errors. Load average about 6 |
| `?map=range&slot8=old`, the arsenal on | Three presses of 8 all draw the Buzzsaw; the Piledriver is owned (the arsenal) and never reached |
| Throws, `lab-throw.mjs`, Trooper, gibbing off | Trommel: a kill at 8 m leaves the hips 1.04 to 1.18 m from where he stood; 1.5 s on a corpse moves it 0.8 to 1.1 m. Piledriver: a kill drops him where he stood, 0.11 to 0.16 m; 1.5 s on a corpse throws its cut pieces 1.6 to 7.2 m (`docs/notes/lab.md`) |
| The burst, beside the smallest explosion | `tools/out/heavy/fx-burst.png`: 15 live records against `hellfireBullet`'s 60, a 20 cm pop against a 2 m fireball |

## Known limitations

- **Nobody has played key 5's new reach or the four new weapons.** Every number is a first guess and every result is a test, a script or a still. The katana's reach, its step and the dash's speed and trigger, and each new weapon's timing, push and damage are the feel questions. Held, the katana steps again on every swing, so a held chain walks forward through a line; whether that reads as pressing an attack or as being dragged is unjudged.
- **The four new models were checked as stills** on the viewmodel sandbox's stepped clock (rest, draw, six frames of each swing), not in motion. The Shiv's backhand ends with the blade behind the fist, and the Prybar's and Spade's overheads bring the hand large into the top of the view while they wind up. Triangle counts were not measured.
- **The Spade's edge taking a head** is confirmed by the kill event (sliced, at the head) in five of five live tries, not by a still that shows the head off; `char.severed` does not list the head after a slice, and the reviewer's still showed a body standing with a bleeding neck stump.
- **The Cosh throws a floored body about 3.7 m**, past the Shiv's 2.2 m. The Shiv's bonus on a downed body is paid (96, live) only after walking up to it.
- **The side a flat club swing lands on** was measured on Troopers holding rifles. On a body with its arms elsewhere the side rays can pass it and the middle ray is used, which at a walking look is the neck.
- **The fling throws everything within 1.8 m** of a point just behind the body: another corpse, a downed body, debris.
- **Melee kills do not slice on a cut from the Shiv** and a knife never takes a limb (`canSever: false`). That is a choice, not a limit of the system.

- **Nobody has played key 8, or heard it.** Every number in the two rows, the spin times, both slowdowns, the burst's size and the door gun's rate and round are first guesses, and every result is a test, a script or a still. How much shake is too much is the first thing to judge: `shake` in the Trommel's row.
- **A burst's fragments seldom land.** 0.45 m to the skin means bodies nearly touching. The lab's three ranks stand 0.65 m apart for it.
- **The Piledriver rolls `gib` a round, not a body.** A round that kills three in a file bursts all three or none.
- **Hellfire Rounds on the Trommel are a real blast a round**, 25 a second, in place of its burst. The Buzzsaw's were 50.
- **`?slot8=old` is the old gun on the new rules.** It keeps the new sounds (the fire loop at the old rate), the cap in the air and the moves the cap leaves alone; a slide was dragged before and is not now.
- **A held strafe in the air can hold carried speed up.** The carry brakes against what `airAccelSlow` gives back with a key held; a player strafing hard after a dash-jump gains more than that and keeps some of the jump until he lands.
- **Enemy rounds do not burst.** `ShotSpec.burst` is read on the player's side of `fireRay` only.
- **The Commander's lines about the Trommel are text only.** `WEAPON_WORDS` calls it the Trommel, and his eight recorded takes (`cmd.weapon.*~buzzsaw`) say "Buzzsaw", so `UNVOICED_WEAPONS` in `enemies/commander/lines.ts` keeps them from playing: the box prints the line and the page is timed by its length. New takes for "Trommel" would put his voice back (record them as `~buzzsaw` and empty the set). `?slot8=old` plays the old takes again.

- **Nobody has played the Lance.** Every number is a first guess: the 0.4 s a tap may last, the three stages and their timing, 1000 damage, what each costs the cell, the bursts' size and pace, the kick and the hit-stop. Whether it is fun is the owner's to say.
- **From the gun, a line of bursts is seen end on.** They go off one behind another down the crosshair, so the ripple reads as a growing flash with rings round it; the line shows from the side (`live-chain-side-*.jpg`) and from the gun only when the beam crosses a crowd at an angle. The 'rail' beam's own rings are large on screen for the first metres, as they were.
- **Twenty deaths still cost what they cost.** The worst frame of a twenty-man beam was 40 ms on a warm page and 67 ms on the first volley, at load average 8 (86 and 318 before corpse hits were taken out of the later rays, at a heavier load). It lands inside the hit-stop. The slow ray is a body cut in two and a head kill in the same frame: gore's cost, not the Lance's. Fewer cuts (`cleave`) is the only lever here.
- **A corpse lying in the line beyond the first three bodies is not struck.** Only the sweep's first ray strikes corpses. The old gun struck up to three anywhere in the line.
- **The beam's FOV punch speeds up the look for 0.2 s.** It is a zoom wider than the view, and the camera scales the look with the zoom: up to 13% faster in the frame of the shot.
- **A beam under Hellfire Rounds or a ricochet perk is one ray**, so it kills the whole line in one frame, as the old gun did.
- **One ball does not always kill a Trooper.** 60 leaves it 10, and the splash then rolls on the blast table's ring that maims, which spares about half. It is on the floor either way.
- **The beam's shove is not felt on the ground.** The feet cancel 2.5 m/s inside a frame: measured 0. It is there in the air.
- **A full beam is worth 5% of a boss**, like every single hit. See "The Lance".
- **A weaker beam stops on plates**, as any round that is not armour-piercing. Only the full one goes through them.
- **`?lance=old` is the old gun's rules and numbers, not all of its look.** The gun in the hands keeps the new capacitor clip. The rules, the row, the guide text, the plain charge bar and the sounds are the old ones.
- **The Lance's new sounds have been measured, not heard.** `lance_plasma`, `lance_stage`, `lance_thunder` and `plasma_burst` are in the audio report; the charge is the old loop bent in pitch.
- **The ball's wake was not caught in a still.** The ball was (`live-ball-flight.jpg`, at the target); its sparks and ring pulses are read from the code.

- **Nobody has played the Quiver or the Thresher, or the new key 4.** Every number is a first guess and every result above is a test, a script or a still. The Quiver's mark rate, cone, turn rate and weave, the Thresher's climb and its damage a second against the pump's are the feel questions.
- **The Quiver's cone is 9 degrees either side of the crosshair.** Targets wider apart than that need the crosshair swept across them while held. The lab's "Quiver" button stands its five inside it.
- **Spares on a man who dies early are mostly wasted.** Four on one Trooper: the first kills him, and the rest retarget if someone is ahead of them in reach, or fly on. That is the rule as written; whether it reads well is unjudged.
- **The reload loads from the front, a round at a time,** and the face of the block is far up the view, so in stills the pushes are small on screen. Its draw and fire poses were checked as stills, not in motion.
- **Blast smoke reads as square sprites** in the stills of a salvo against the Test Range's sky (`salvo-air.png`). The ROCKET's blast shows the same squares faintly; four overlapping make them obvious. It is fx's smoke column, not touched here.

- **Nobody has played the three new guns.** Their numbers are a first guess from the tables: rate and damage against their siblings, kick and shake by ratio. The feel of the Harrow's kick, the Rivet's snap and the Sabot's weight is unjudged.
- **The SMG changed to give the Harrow its reach.** It was full damage at any range and now fades from 35 m to half at 80. The numbers are a guess nobody has played. `?reach=0` puts it back, and takes the Rivet's falloff with it.
- **The exit crater is the same pale grey on every wall.** It reads as broken concrete on concrete and as bare metal on steel, but it does not take the wall's own colour. Glass, grates, energy and lava get no crater. It was looked at on the range's panel wall only.
- **The Sabot's own shot was checked as stills.** Seven frames each of it and the autocannon, with nothing broken in them. Whether the longer stroke reads in motion is unjudged. Its reload and draw are the autocannon's.
- **A second spin or charge member shares the first one's `TUNING`.** Spin-up, charge time and their sounds are not in the row. A melee member has its own swings in `MELEE`. See "Adding a family member".
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
- **A heavy gun's slowdown lives on velocity.** A `moveScale` read by progression when it writes `modifiers.speed` would be cleaner, but that is not this system's file.
- **The crane does not pass its speed on.** Jump off a moving deck and you lose its 4 m/s. Riding drifted 11 cm over 6.4 m of travel.
- **The slash crescent is a stand-in for the cut**, tilted so it can be seen. See above.
- **Rockets hit twice on a direct hit**: the contact strike, then the blast. That is deliberate and only shows on targets that survive 100. Before the fuse was fixed, that meant nothing: see Rocket fuse.
- **`fx.chips` on a headshot and gore's own headshot stack both run**, so a head kill has chips, sound and stops from both systems. It reads well, but it is two owners for one moment.
- **A large red disc with a white cross** appears on a brute at 5 m in `rl-heavy-stake-limb.png`. It is not weapons code. `telegraph.glint` in `src/enemies/telegraph.ts` is the likely source, but I did not trace this one. It may be worth a size check at point-blank.
