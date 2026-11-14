# Allies: friendly soldiers

`src/allies/`, on `ctx.allies`. Outpost Defense piece 2 (`docs/proposals/outpost-defense.md`) and the hive mission's Bailiffs
(`docs/notes/hive-mission-plan.md`, stage 2). A reusable system: nothing here knows about a mode or a mission. With no allies spawned
it costs one length check a frame.

## Try it

| Where | What |
|---|---|
| `/?map=range&contract=outpost&allies=6&foes=5` | Six allies posted 7 m ahead of the spawn, an enemy squad 32 m out. `&breach=1` marks a breach 14 m ahead for the riot line |
| Lab panel (F1), section ALLIES | Squad of 6 or 8, one of each type at the crosshair, an enemy squad 32 m ahead, breach at the crosshair, down the nearest, clear |
| `window.__allies` | `squad(n)`, `spawn(type)`, `foes(n)`, `breachAhead()`, `breachAtCrosshair()`, `downNearest()`, `clear()`, `.system` |

Without `&contract=outpost` the enemies are the swarm, who never target allies (see Rough). Scripts:

```
node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/allies-check.mjs --wait 500 --timeout 150 --dpr 2 --w 1440 --h 900 --out tools/out/allies/check.png
ALLIES=8 FOES=7 BREACH=1 node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/allies-fight.mjs --wait 500 --timeout 150 --dpr 2 --w 1440 --h 900 --out tools/out/allies/fight.png
node tools/shot.mjs --url "/?map=range&contract=outpost&allies=6&foes=5" --script tools/scripts/allies-live.mjs --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900 --out tools/out/allies/live.png
```

`allies-check` is one man standing still: green crosshair, CHECK FIRE, tap and hold E, down and revive. `allies-fight` is a timeline of
a squad fight. `allies-live` is everything in one run, plus the frame cost of eight.

## Public API

```ts
const allies = ctx.allies;                       // AllySystem
allies.spawn('rifleman', at, post?, radius?, yaw?);
allies.spawnSquad(count, center, yaw, ahead?, types?);
allies.setOrder(a, 'follow' | 'post'); allies.toggle(a); allies.toggleSquad();
allies.markBreach(point, yawOut); allies.clearBreach();
allies.playerRevive(a);                          // spends one of the player's stims
allies.hurt(a, amount, point, dir, bone, region, type, source);
allies.raycast(origin, dir, max);                // the crosshair's test
allies.focusDistance;                            // metres to the man E would address, or Infinity
allies.allies;                                   // Ally[]: up or down. The dead leave the list
```

Events (`events.ts`): `ally:order`, `ally:down`, `ally:revived`, `ally:dead`, `ally:checkFire`. Nothing listens yet; they are for a voice
bank, a roster on the HUD and the mode's economy. Allies have no lines.

## Files

| File | Job |
|---|---|
| `data.ts` | `ALLY_TYPES` (body, health, gun, stance, band), `ALLY` (the lab's squad of 8, `maxAlive` 20 for Outpost Defense's cap, timings, reaches), `ALLY_SOURCE`, colours |
| `rules.ts` | Plain arithmetic: follow slots, `crosshairRead`, `prefersAlly`, the `OrderKey` gesture, `takeHit`, `revive`, `reviveCost` |
| `ally.ts` | One man. His body is an `Enemy` struct that is never in `enemies.alive` |
| `index.ts` | `AllySystem`: spawning, thinking, steering, firing, hurt/down/revive/dead, the enemy's foes, rays and CHECK FIRE |
| `fire.ts` | Their guns and rockets |
| `orders.ts` | The E key and its prompts |
| `props.ts` | The pack frame, aerial, beacon and bands |
| `lab.ts` | URL flags, `window.__allies`, the lab section |

## What is reused

- **Bodies and animation:** the enemy's archetypes through `ctx.characters.spawn`, posed with `setPosture` and `setLocomotion` like a
  soldier. Rifleman `trooper`, machine gunner `brute`, sniper `sniper`, rocketeer `rocketeer`, shotgunner `gunner`, riot `riot`, medic `warden`.
- **Steering:** `updateMovement` from `enemies/movement.ts` with an `AiWorld` of our own. `footbound` and `probeAt = Infinity` keep it off the
  director, and `flowUntil` is cleared every frame, because the flow field leads to the player.
- **Routes and cover:** the Outpost's `RouteFinder` and `CoverMap` when it runs, our own built once otherwise. Our bodies take uids from
  1,000,000, so a cover spot one of them claims never reads as an enemy's.
- **Wounds:** each hit goes through `resolveZone` and `Injuries.add`, so allies limp, hunch, bleed and lose speed by the same table as the
  enemy. What a hit means for life and death is `takeHit` (below), not the wound system's.
- **Gore:** `gore.wound` marks the body, `gore.ragdoll` takes the dead.

## The friendly rules

| Rule | How |
|---|---|
| The player's rounds pass through an ally | Allies are not in `enemies.alive`, so `Combat` never meets them (fact 11). `weapon:fired` is tested against allies for a green spark (`#3dff7a`), a flinch and CHECK FIRE, at most every 3 s |
| The player's blasts | Never hurt an ally: `physics.radialListeners` only flinches him |
| An ally's rounds never hurt the player or each other | `fire.ts` tests the world and `enemies.raycast` and nothing else, and hands hits to `enemies.applyDamage`. It holds a burst while the player stands within 0.75 m of the line |
| An ally's rockets | Burst in `fire.ts`, never `combat.explode`: no self damage, no push, no hit marker |
| An ally's kills pay nothing | `ALLY_SOURCE = /^ally_/`. `progression/index.ts` drops kills, hits, severs and wound points; `audio/reactions.ts` confirms nothing; the wound labels do not float (fact 10) |
| The crosshair | `crosshair.ts` asks `ctx.allies.raycast` beside `enemies.raycast`: the nearer wins, nothing shows through a wall, and an enemy in front of an ally is red (`crosshairRead`). Green is the `friendly` class, `--friend` |
| Nothing on the body is green | Pale pack frame, a whip aerial with a cold white beacon (amber while he is down), cyan helmet band and chest bar |

## How enemies fight them

The Outpost's squads stay built round the player. Every 0.4 s up to 8 enemy soldiers look for the nearest ally within 55 m that they can
see (one ray each) and set `Soldier.foe` when `prefersAlly` says so: the player out of their sight, or the ally nearer. `weapons.ts` then
fires the rifle, belt, pistol, carbine, shotgun and rocket at the foe through `Foe.shotAt` and `Foe.blast`. `shotAt` rolls a miss of
0.3 m plus 2.2% of the range times the shooter's nerve, and tests our bodies and the world. A riot shield stops what comes from the front.
An enemy rocket at an ally is the real projectile (it still hurts the player near it) plus a burst on allies when it arrives.

## A man's life

`takeHit` in `rules.ts`:

- **Up.** Damage comes off his health. A head hit is x1.6 (x0.6 glancing) and a heart hit x2: hard hits, not deaths, because he wears a
  helmet and is worth reviving. A spine, pelvis or carotid wound, or a destroyed leg, puts him down at once. One hit of 1.6x his health
  kills him where he stands.
- **Down** at 0 health: lies in the `downed` posture on 30% of his health for 45 s, beacon amber, MAN DOWN tag within 70 m. A hit that
  empties the pool kills him; so does the clock.
- **Revived** by the player (hold E 1.1 s, one stim from `ctx.progression.stims.spend()`) or a medic (3.5 s kneeling, three stims of his
  own): up on half health with his wounds cleared. On a page with no stim kit a revive is free.
- **Dead stays dead.** A ragdoll with his kit on until the corpse goes. Every spawn of any body strips it.

## Types

| Type | Gun | Holds | Notes |
|---|---|---|---|
| Rifleman | 3 to 4 round bursts, 11 a round, 48 m | Patrols his post | Polished first: cover near his anchor, leans out to fire, crouches between bursts |
| Machine gunner | 10 to 18 round bursts, 55 m | Holds | Only fires standing still |
| Sniper | 70 a round, 90 m, 2 s between shots | Holds; cover spots score height | Bad inside 10 m: 4x spread and slower. Prefers snipers, rocketeers and far targets |
| Rocketeer | Rocket, 120 in 5 m, 60 m | Holds | Vehicles first (`enemies.vehicles.live`), then bosses and Brutes. Bad inside 8 m |
| Shotgunner | 8 pellets of 9, 16 m | Guards: patrols half his post | |
| Riot police | Pistol, 18 m | Holds; with a breach marked, forms a line across it | Shield stops rounds from the front. Line slots 1.05 m apart, square to the way out |
| Medic | Carbine, 34 m | Holds | Goes to the nearest downed ally within 32 m, revives him |

## Orders

Look at a man within 3.6 m and **tap E**: he follows, or goes back to his post. **Hold E** (0.55 s), on a man or with any ally within
60 m: if anyone is on his post the whole squad follows, otherwise all go back. **Hold E on a downed man** (1.1 s): a stim. Followers take a
fan behind the player 4 to 8 m back, run past 12 m off, and take cover within 7 m of their slot when they see something.

E is shared. A prisoner in reach and in view keeps it. A mounted gun yields to an ally the player is looking at
(`Emplacements.update` reads `ctx.allies.focusDistance`); otherwise a gun in reach takes the press.

## Measured

Real Chrome, 1440x900 at dpr 2, Test Range, `contract=outpost`, on the shared machine (load average 4 to 15).

- `allies-check`: crosshair `friendly` over a standing ally, the player's burst through him left him on 150 of 150, tap set `follow`,
  hold set the squad back to `post`, a downed man was revived on one stim (1 to 0) to 75 of 150.
- Six against five (before the head rule above): three allies down in the first 3 s, the medic revived all three by 18 s, five kills, no
  ally lost. Eight against seven with a breach: every enemy dead in about 22 s, no ally down, kills by sniper, rifles and the gun. Score and
  combo stayed 0 throughout.
- **Cost of eight in a fight:** `AllySystem.update` median 0.5 ms, p95 1.3 ms (one run); 0.1 to 0.8 ms sampled in the fight runs.
- **Cost of twenty on the fort** (Outpost Defense's cap, wave 5, 45 s, `defense-garrison.mjs`): median 0.2 ms, p95 1.4 ms, worst 4.2 ms;
  frames held 16.7 ms (p95 16.8). Thinks are staggered, so the median barely moves; the p95 is the bursts of sight rays. A light fight
  (3 of 20 firing): a wave that engages them all has not been measured.

## On the minimap

Every ally is a dot on the minimap in every mode that has them (`&allies=`, the fort): cyan, the helmet band's colour, round where
enemies are square; amber and pulsing while down, like his beacon; gone once dead (he leaves `allies`). Only those inside the map are
drawn. `ui/hud/minimap.ts` reads `ctx.allies.allies` directly.

## Rough

- **Nobody has played it.** Balance is bots and two fights. With the head rule a squad of eight beats seven enemies without a scratch.
- **Swarm enemies ignore allies.** Husks and the swarm's guns only ever choose the player. The plan's `prey` behaviour is not built.
- **Enemy grenades never hurt allies,** and the player's blasts only flinch them. Only enemy rockets aimed at an ally burst on allies.
- **An enemy shooting an ally still points his arms at the player** (`EnemyManager.animate`), and snaps his body round to fire.
- **Enemy squads still plan round the player.** They shoot allies they see, but flank and search for the player.
- **Enemy rounds aimed at the player pass through allies;** only rounds aimed at an ally can hit one.
- **Revive is a posture change:** he lies down and gets up by blending, with no get-up clip.
- **The riot line** is unverified by eye: the bench marked a breach, but no picture shows the line formed. No shield-up pose of its own.
- **The gunner seat's reticle** (`vehicles/hud.ts`) has no friendly or hostile class, and seat guns raise no `weapon:fired`, so no CHECK FIRE
  from a mounted gun.
- **Followers do not use jump links or pads,** and a player who parkours away loses them until he walks back.
- **Mortar teams** are a later piece.
