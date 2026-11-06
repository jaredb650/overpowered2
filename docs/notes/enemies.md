# Enemies, AI, waves, bosses

`src/enemies/`. `createEnemies(ctx)` and `createWaves(ctx)` come from `index.ts`. Sandbox: `/?sandbox=arena`.

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
| `movement.ts` | Flow field steering, separation, ground following, jump links, pads |
| `contact.ts` | The player running into a body |
| `director.ts` | Attack tokens and gaps, ray budget, squads, barks |
| `spawner.ts`, `waves.ts` | Entrances, composition tables, the queue |
| `armor.ts`, `telegraph.ts` | Plate meshes and debris, every warning visual |

Maimed states have no special cases. They are behaviours and attacks whose score or `requires` reads `e.maim`, so a lost limb
changes what is available on the next think.

## Decisions worth knowing

- **Contact deals no damage.** Every hit the player takes is a telegraphed attack. A running player shoulders light bodies
  aside and staggers them. Heavies (`mass`, `contactRadius`) cancel the inward part of the player's motion, so they are slid
  around. A player standing in a body is bumped out. `player.push` cancels a slide, dash or wall run, so it is only used on feet
  or in free flight, and those moves pass through everything. It also lifts the player off the floor, so called every frame it
  stacks into a throw: it is one bump, `NUDGE_GAP` apart, shared by all bodies.
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
| `contact.ts` | `SHOVE_SPEED`, `SHOVE_FORCE`, `SHOVE_STAGGER`, `EASE_OUT`, `NUDGE_GAP` |
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

## Sandbox

`/?sandbox=arena&spawn=husk,brute&count=10&dist=25`, or `&waves=1&wave=5` for the real director. `&god=1` keeps the player alive.
`window.__arena` has `spawn`, `hit`, `maim`, `clear`, `freeze`, `near`, `list`, `teleport`, `look`, `setWave`, `stats`.
`clear()` fires no kill events, so scenarios do not earn perks. `killAll` does, and perks repaint the screen in later shots.
