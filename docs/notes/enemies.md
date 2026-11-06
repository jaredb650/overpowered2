# Enemies, AI, waves, bosses

`src/enemies/`. `createEnemies(ctx)` and `createWaves(ctx)` come from `index.ts`. Sandbox: `/?sandbox=arena`.

The human faction of the Outpost contract lives in `src/enemies/outpost/`, with its own notes in `docs/notes/outpost.md`.

## Public API

`ctx.enemies` (`EnemySystem`, concrete class `EnemyManager`):

```ts
ctx.enemies.alive;                                  // readonly EnemyInstance[]
ctx.enemies.remaining;                              // alive plus queued in this wave
ctx.enemies.spawn('husk', position);                // null at the cap of 48
ctx.enemies.raycast(origin, dir, maxDist);          // from a ring of 16 hits: do not keep one past the frame
ctx.enemies.raycastAll(origin, dir, maxDist, limit);
ctx.enemies.query(center, radius, out);
ctx.enemies.applyDamage(enemy, damage);             // the only way damage reaches an enemy
ctx.enemies.killAll(source);
```

`ctx.waves` (`WaveSystem`): `wave`, `phase`, `nextWaveIn`, `start()`. `Waves.jumpTo(n)` skips to a wave, for tests.

Events out: `enemy:spawned`, `enemy:hit`, `enemy:killed`, `enemy:severed`, `wave:start`, `wave:clear`. There is one kill path,
`DamageModel.kill`, and it picks one death: gib, slice, headshot, crash, boss death or ragdoll.

**Blast rings.** `blast.ts`, one table for every contract, read through `d.reach` and `d.blastKind`. How far out a body stood picks the ring, and how much of its health the blast took shapes the roll inside it.

| Ring | Grenade, share of radius | What happens |
|---|---|---|
| Fireball | under 0.22 | Gib, if the blast kills it |
| Maim | 0.22 to 0.62 | One roll per body: waist, head, limbs, arm and leg, arm, burn, flesh. Usually fatal or nearly so |
| Toss | 0.62 to 1 | Thrown, limb, scorch, dazed. Capped at 55% of max health, so a healthy body lives and gets up |

Machines roll `parts` and `sparks`, and nothing else. Bosses skip the rings. Each outcome rolled in a blast divides its own weight by 1 plus `repeat`, so a crowd cannot all go one way. `BLAST.cuts` caps limbs per blast at 12, because each costs 3 to 5 ms of mesh cutting in one frame. A kill from a shotgun pellet of 100 N·s or more in the trunk tears the waist 35% of the time.

Over 100 simulated blasts on a crowd of 12, 1200 bodies: thrown 14%, burn 9%, scorch 9%, flesh 9%, head 8%, arm and leg 8%, arm 8%, dazed 8%, limb 7%, gib 7%, limbs 7%, waist 5%. No blast had under 6 kinds or over 4 of one kind.

Reads from other systems: `world.nav`, `world.objects` (`hazardAt`, `padAt`, `setReactorState`), `gore`, `combat`, `characters`,
`progression.isActive('ghost')`. No change to `src/core/gameplay.ts` was needed.

## How it fits together

| File | Job |
|---|---|
| `data.ts` | The cast. One row per enemy: stats, voice, footfall, plates, behaviours, attacks. `waveScale` |
| `brain.ts` | Utility AI. Behaviours own the legs, attacks own the hands, and they run side by side |
| `behaviours.ts`, `roles.ts`, `attacks.ts` | The parts a row is built from. `roles.ts` is what only one enemy does |
| `bosses.ts` | Juggernaut and Titan: phases, damage rules, deaths. Same brain, plus a `BossController` |
| `damage.ts` | Order of a hit: ward, shield, tank, region, plate, boss filter, health, limb pool |
| `reactions.ts` | What a hit that does not kill does to a body: flinch, stagger, fall or thrown |
| `movement.ts` | Flow field steering, separation, ground following, jump links, pads |
| `contact.ts` | The player running into a body |
| `director.ts` | Attack tokens and gaps, ray budget, squads, barks |
| `spawner.ts`, `waves.ts` | Entrances, composition tables, the queue |
| `armor.ts`, `telegraph.ts` | Plate meshes and debris, every warning visual |

Maimed states have no special cases. They are behaviours and attacks whose score or `requires` reads `e.maim`, so a lost limb
changes what is available on the next think.

## Decisions worth knowing

- **Contact deals no damage.** Every hit the player takes is a telegraphed attack. A running player shoulders light bodies
  aside and staggers them. Middling ones (Riot, Burner) cancel the inward part of the player's motion in a bump, and can be leaned
  through. A player standing in a body is bumped out. `player.push` cancels a slide, dash or wall run, so a bump is only used on feet
  or in free flight, and those moves pass through light bodies. It also lifts the player off the floor, so called every frame it
  stacks into a throw: it is one bump, `NUDGE_GAP` apart, shared by all bodies.
- **Brutes, Juggernauts and Titans are solid** (`mass` of `SOLID_MASS` or more). Enemies are points on the nav graph and the
  player's capsule only sees the world, so `contact.ts` works on `player.velocity` and never on position: it removes what would
  carry the player in during the next frame, keeps the sideways part so a glancing run slides round, and walks any overlap back
  out. The move itself stays with the player's own sweep, so nothing can be pushed through a wall, and no height is added, so
  nothing can be thrown. It looks a frame ahead, or a dash at 20 fps steps most of the way through a Brute. Dash and wall run write
  their own velocity every tick, so those two are ended with `player.push`. A slide is stopped like a run. `slideRound` gives back
  the part of the keys that runs along the body, because `groundGrip` scrubs anything off the keys, and at 60 fps a run stuck fast
  to a round body. The player's own sweep does this for walls.
- **Nothing traps the player.** Deeper than `WEDGE_DEPTH` for `WEDGE_SECONDS`, which only a body and a wall closing together can
  do, solid bodies let go for `WEDGE_RELEASE`. Keep `WEDGE_DEPTH` above what holding a key can reach at low frame rates, or leaning
  on a Brute reads as wedged and the player walks through it. With `groundGrip` at 240 m/s² that is about 0.09 m at 30 fps and 0.14 m
  at 20 fps, at the present `OUT_RATE`.
- **Pads throw enemies with the pad's real velocity**, the arc the map was tuned for. Gravity is the same -28. An enemy that
  misses the pad's radius at the link's start leaps for the far end instead.
- **Stranded enemies come back as reinforcements.** A body in flow mode with no route gain of `PATH_GAIN` for `STRANDED_BLIND`
  seconds without sight, or `STRANDED_SIGHTED` with it for melee, re-enters through a spawn point if it also stayed put, or if it
  is more than `STRAGGLER_PATH` behind. Route gain alone is not enough: a player moving away lengthens the route of a body
  walking straight at them. Ranged enemies with sight, anything not in flow mode, and crawlers are exempt. `enemies.rescues` counts these.
- **A leap ends where it was aimed.** `leapTo` records the target, and when the flight time runs out the body stops over that
  spot and falls. Otherwise a long leap in a slow frame steps over a narrow landing and flies off the map. A body that falls
  past `FELL_OUT_Y` with no ground in reach is rescued, because nothing else would ever end it.
- **A tank the player did not set off is small** (`STRAY_TANK_*`). A chain of full tanks at the player's feet was a one-frame
  death for a kill they had no part in.
- **Bosses ignore hazards**, and an enemy in the air is above them. Lava and crushers kill through `DamageModel.kill` with the
  hazard as `source`, so progression's environment bonus applies. Electric floors jolt in 0.3 s ticks.
- **Body removal comes before a death's last act** in `updateDying`, so an exception in that blast cannot replay every frame.

## Hit reactions

One rule, in `reactions.ts`: `power = (force / body mass + damage / health) x region`, added to `Enemy.shock`, which fades at 1.3/s. Chance rises either side of each threshold, so sustained fire topples what one round would not. A blast ignores region. `DamageModel.respond` carries the answer out.

| Level | What happens |
|---|---|
| Flinch | The old spring flinch and a cry |
| Stagger | `e.reel` carries the body the way it was hit, the feet step after it, a hand goes to the wound or up to the face. No thinking while `e.stagger` lasts |
| Fall | A stagger, then 0.16 to 0.42 s later `gore.knockdown`, so it visibly fails to catch itself |
| Thrown | `gore.knockdown` at once, for a blast, and the blast does the throwing |

A shot leg at 2.2 m/s or more trips a body by `profile.trip`: it keeps its speed and falls forward. So does a leg more than 45% gone, at a stand. A head hit that does not kill always staggers. Getting up can only be interrupted by a blast.

| Profile | Stagger | Fall | Thrown | Lie, s | Rise, s | Cooldown |
|---|---|---|---|---|---|---|
| Flesh | 0.75 | 1.7 | 1 | 0.7 to 1.9 | 2.5 | 0.9 |
| Undead: Husk, Leaper, Bomber | 1.15 | 2.6 | 1.25 | 0.1 to 0.35 | 1.05 | 1.3 |
| Nimble: Stalker | 0.75 | 1.7 | 1 | 0.2 to 0.6 | 1.15 | 1.2 |
| Heavy: Brute | 0.8 | 2 | 1.1 | 0.8 to 1.6 | 3 | 1.6 |

Bosses and machines have no profile and stagger by `poise`, the old way. For scale, one SMG round in a Trooper's chest is about 0.66, so the second on its heels staggers it, and it dies on the third.

**While `e.downed`** gore has the body. `updateDowned` copies where it is into `e.position` and `e.center`, and nothing else runs but status: it can bleed, burn and be shot. `e.airborne` is set so crowds and contact ignore it. When `gore.downed` answers null, the root is where it stands, `e.rising` counts the clip down, and `e.stagger` covers the clip and the daze after it. Knockback and crowd separation stay off while rising, because the clip is keyed to the root.

**Section 14's wound states** are in `src/enemies/wounds`, see `docs/notes/wounds.md`. Only soldiers reach them: `DamageModel.apply` asks `WoundSystem.take` whether a hit kills, and every other body dies when its health is gone, as before.

## Tuning knobs

| Where | What |
|---|---|
| `data.ts` rows | HP, speed, poise, limb pools, attack numbers, `mass`, `contactRadius`, `footfall`, `voice` |
| `data.ts` `waveScale` | Health, damage and speed per wave |
| `waves.ts` | `ROSTER` (first wave, weight, pack, cap, escort), `COUNT_SCALE`, `BOSS_WAVE_ESCORT`, intermissions |
| `waves.ts` `rosterWeight` | How fast fodder gives way to older types |
| `director.ts` `setWave` | Simultaneous attackers and the gaps between them. This drives lethality more than raw damage |
| `EnemyManager.ts` `EVASION_FROM`, `EVASION_SPAN` | Speed to `evasion`, which every aimed attack reads. Full at 11.5 m/s, just under the player's 12.5 m/s run. Retune if `runSpeed` moves |
| `attacks.ts` `aimAtPlayer`, `SPEED_MISS`, `grazed` | Miss radius and the damage cut at speed |
| `spawner.ts` | `PATH_MIN`, `PATH_MAX`, `REUSE_SECONDS`, `DROP_HEIGHT` |
| `contact.ts` | `SOLID_MASS`, `OUT_RATE`, `OUT_MAX`, `CARRY_MAX`, `WEDGE_*`, `SHOVE_SPEED`, `SHOVE_FORCE`, `SHOVE_STAGGER`, `EASE_OUT`, `NUDGE_GAP` |
| `damage.ts` | `SHOVE_GAIN`, `SHOVE_MAX`: knockback on the living, from a hit's `force` over the body's health. `STAGGER_*`, `FALL_LEAD_*`, `REEL_GAIN`, `TOPPLE_*`, `DIES_ON_FEET*`, `COLLAPSE_*` |
| `reactions.ts` | `ReactionProfile` rows, `BODIES`, `REGION_SHOCK`, `SHOCK_PER_*`, `TRIP_SPEED`, `LEG_FAILS_FROM` |
| `EnemyManager.ts` | `PATH_GAIN`, `STRANDED_*`, `STRAGGLER_PATH`, `RESCUE_*`, `CHAR_SECONDS`, `BUFF_SECONDS`, `HAZARD_TICK` |

## Difficulty curve

Averages over 300 rolls of `composeWave`. Wave size is `(10 + 2 x wave) x COUNT_SCALE`, cut by `BOSS_WAVE_ESCORT` on boss waves.

| Wave | Size | New type | HP x | Damage x | Total HP |
|---|---|---|---|---|---|
| 1 | 24 | husk, trooper | 1.00 | 1.00 | 1,272 |
| 2 | 28 | gunner | 1.08 | 1.05 | 1,829 |
| 3 | 32 | bomber | 1.17 | 1.10 | 2,086 |
| 4 | 36 | brute | 1.25 | 1.15 | 2,950 |
| 5 | 18 | **Juggernaut** | 1.34 | 1.20 | 1,478 + boss |
| 6 | 44 | stalker | 1.43 | 1.25 | 4,082 |
| 7 | 48 | rocketeer | 1.51 | 1.30 | 4,742 |
| 8 | 52 | skitter | 1.60 | 1.35 | 4,440 |
| 9 | 56 | leaper | 1.68 | 1.40 | 5,830 |
| 10 | 27 | **Titan** | 1.77 | 1.45 | 2,974 + boss |
| 11 | 64 | riot | 1.85 | 1.50 | 7,983 |
| 12 | 68 | sniper | 1.94 | 1.55 | 8,456 |
| 13 | 72 | drone | 2.02 | 1.60 | 9,658 |
| 14 | 76 | burner | 2.10 | 1.65 | 10,863 |
| 15 | 36 | warden, 2 Juggernauts | 2.19 | 1.70 | 5,663 + bosses |

## Measured

The machine was shared the whole time, with load average 15 to 45. Treat every time and frame rate here as noisy.

**Fairness.** Real game at `/?autostart=1`, no god mode, bot never shoots. Moving means running a 75 m arc at about 12 m/s,
turning at each end, inside the fight.

| Wave | Standing: dead at | First hit | Damage per second | Moving: outcome | Hits per shot, standing / moving | Damage per second |
|---|---|---|---|---|---|---|
| 1 | 24.4 s | 16.3 s | 12.4 | alive at 55 s, 23 taken | about 1.0 / 0.11 | 0.7 |
| 3 | 19.6 s | 13.7 s | 17.0 | alive at 55 s, 21 taken | 0.61 / 0.10 | 0.7 |
| 5 | 15.5 s | 8.5 s | 14.4 | dead at 37.8 s | 0.88 / 0.11 | 6.1 |

The wave 5 moving death is 131 of 142 damage from the Juggernaut, which the bot does not dodge. Hits per shot is rough: hits are
all damage events, melee and blasts included, while shots are only rays and projectiles, so it can pass 1. One run per cell, so
expect several seconds of spread.

**Reach.** Real waves at `/?autostart=1` against a passive player, 42 s of wall time per case. Game time is clamped at low frame
rates, so a loaded run covers less. A failure is a body with no route gain and no movement over its last 10 s.

| Player at | Run | Spawned | Engaged | Still walking | Stalled | Links crossed (pad flights) | Rescues |
|---|---|---|---|---|---|---|---|
| Ground, wave 4 | before leap-end change | 36 | 35 | 1 | 0 | 35 (22) | 0 |
| Ring Road, wave 4 | before | 36 | 29 | 7 | 0 | 14 (0) | 4 |
| Crown, wave 9 | before | 43 | 25 | 18 | 0 | 70 (66) | 9 |
| Ground, wave 4 | final code, slow window | 36 | 4 | 32 | 0 | 20 (16) | 0 |
| Ring Road, wave 4 | final code, slow window | 36 | 9 | 27 | 0 | 13 (1) | 0 |
| Crown, wave 9 | final code, slow window | 56 | 36 | 11 | 0 | 44 (25) | 2 |

The final-code window covered only 13 to 26 game seconds, so its engaged counts are low because time ran out, not because bodies
failed. Rescues there are the straggler rule moving bodies more than 110 m behind, not stuck ones: a group rescued from
(73, 0, -139) was followed alone and walked its 169 m route normally, pad flight included.

**Contact**, player at 12.5 m/s into still bodies: five husks, 4 staggered and thrown up to 2 m. Heavies: see `docs/notes/lab.md`.

**Maimed and bosses.** On the final code all nine maimed cases and the head pop chose the right behaviour and attack, and the
Juggernaut ran from landing to `wave:clear` with 69 footfalls and no console errors. The Titan's full fight (50 footfalls, four
attacks, `wave:clear`) ran before its floor-sink fix. Only its pose after losing all four limbs was rechecked after that.

## Known limitations

- **The Titan does not kneel.** Once both shins are gone the animator's body plan is `crawl` or `writhe`, which puts the hips on
  the floor. It reads as brought down, torso upright on its stumps. A real kneel needs a new plan in `HumanoidAnimator`.
- **Severed limbs stay white** if the body was flashing when they came off, which under rapid fire is nearly always. `SeveredPart`
  copies the flash texel in `copySurfaceTo` and nothing fades it. It is one line in `src/characters/Character.ts`.
- **Spawns can be seen.** 1 of 243 at the real rate. A spawn takes the fallback when every hidden point in range is cold.
- **Many spawns land past `PATH_MAX`.** Points inside the band run out or are in view, and the fallback prefers far to near.
- **Bodies clip big geometry.** Enemies are points on the nav graph, so a Titan in a tunnel goes through the ceiling. Landing
  sites need open sky, but the walk after that does not check.
- **Enemies do not avoid hazards.** Routes cross crushers and electric floors, so a wave loses the odd body on the way.
- **Pad and jump flights have no collision.** Pad arcs were swept for the player. Leaps are short, but one can clip a corner.
- **Not played by a human.** All of this comes from bots and scripted runs, and nobody has listened to the audio.
- **Written but never seen running:** burn panic, the Ghost `lost` behaviour, sniper relocation, a drone surviving a hit, the
  Warden buff fading, and the falling-body rescue.
- **60 fps at 48 alive is not verified.** The most tested was 42 alive, under load average 30: 67 ms frames, 519 draw calls and
  1.54M triangles, just over both budgets. Enemy CPU was 1.9 ms median, 6.4 ms p95, so the frame time is not the AI.

## Sandbox

`/?sandbox=arena&spawn=husk,brute&count=10&dist=25`, or `&waves=1&wave=5` for the real director. `&god=1` keeps the player alive.
`window.__arena` has `spawn`, `hit`, `maim`, `clear`, `freeze`, `near`, `list`, `teleport`, `look`, `setWave`, `stats`.
`clear()` fires no kill events, so scenarios do not earn perks. `killAll` does, and perks repaint the screen in later shots.
