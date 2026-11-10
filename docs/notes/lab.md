# Test Range and dev controls

`src/lab/`, flags in `src/core/devflags.ts`. `Game.ts` loads the lab on `/?map=range`, with `?dev=1` in any build, and on every page of the dev server unless `?dev=0`. A production build's normal run, the public site's, never downloads it.

On a dev server page that did not ask for it (no `?dev=1`, not the range) the lab is quiet until the panel is first opened: no hint, no hotkeys but F1 and backquote, and god mode, every weapon, world speed and the rest start off on each page load. Only the spawn type, AI mode and row size are remembered there.

## How to use it

| Where | What you get |
|---|---|
| `/?map=range` | The Test Range. No menu, no waves. Perks start off, god mode and every weapon start on |
| `/?dev=1` | The real game with the same panel. Add `&autostart=1` to skip the menus |
| `/?map=killhouse&dev=1` | Any map, the same way |
| Any page of the dev server | The panel, with every cheat off until ticked. `?dev=0` removes it |

| Key | Does |
|---|---|
| F1 or backquote | Panel. On a Mac keyboard F1 is usually `fn`+F1, which is why backquote is there too. Esc also closes it |
| Click | Takes the mouse back |
| P | Pause the world. The player keeps moving, so you can walk round a frozen body and fire into it |
| . | Step one frame of 1/60 s |
| [ and ] | World speed down and up by half |
| O | Spawn the selected type at the crosshair |
| K, L | Kill all. Clear corpses, limbs, chunks, blood and plates |

**Grants.** The panel has buttons for all 8 call-ins, straight to the inventory, every perk and powerup, and the combo. Each call-in is used with its usual key. Combos and perks start off on the range, so a combo set there shows but pays nothing until that box is ticked. Under `?dev=1` it is on: set 15, make a kill, and Airstrike, Warthog and Berserk arrive. A perk with `retrigger: 'ignore'` does nothing on a second press while it runs.

Settings live in localStorage, one copy for the range, one for `?dev=1` and one for the dev server's other pages, so a test never leaks into a run. God mode and every weapon hold through a restart, a mission's loadout and a checkpoint redeploy. A hotkey the player has bound to a game action is the game's, and with the panel open over a menu the menu does not hear the keys.

## How it fits together

| File | Job |
|---|---|
| `range.ts` | The map. Floor ruled every 5 m, ticks every metre |
| `index.ts` | Keys, time, player cheats, `window.__lab` for bots |
| `panel.ts` | The panel. Holds no state |
| `spawn.ts` | Crosshair placement, AI off, the walking route |
| `overlay.ts` | Aim readout, and how far the last kill was thrown |
| `settings.ts` | What persists, and writing it into `DevFlags` |

Gates: `damage.ts` picks the death, `Gore.gib` and `burstLimb` catch every other way to gib, `progression/index.ts` drops its three body events, `muscles.ts` reads the flag in `MuscleTuning.enabled`. `Physics.radialImpulse`, `Rag.applyImpulse`, `Rag.shove`, `impactStrength` and `Gore.gib` apply `DevFlags.force`.

- **AI off** clears the body's behaviours and attacks and sets `Enemy.dummy`, which skips crowd separation in `movement.ts`. Without that a body backs away as you walk up to it. Knockback still moves it.
- **Pause is a scale of zero, not `time.paused`.** `playerDt` ignores slow motion, so this is what leaves the player free. A step is one frame at a scale that makes it 1/60 s of world time.
- **The lab wraps `hud.pause`**, because the HUD reads a lost mouse as a pause. That is the only reach into `src/ui`.
- **The range thins the fog** through `render.fog`, and keeps it for the session.

## Forces, measured

Real game on the range, `tools/scripts/lab-throw.mjs`, Trooper, gibbing off so that everything leaves a body. Metres from where the enemy stood to the hips at rest. **A body that simply drops measures about 0.5 m.** Old is one run of each, new is the mean of three.

| Weapon | Old | New |
|---|---|---|
| SMG, kill at 8 m | 0.6 | 0.5 |
| SMG, 1.5 s on a corpse | **20.7**, at up to 64 m/s | 0.15 |
| Buzzsaw, kill at 8 m | 0.5 | 0.5 |
| Buzzsaw, 1.5 s on a corpse | 0.7 to 1.0 | 0.13 |
| Shotgun, 2 m | 0.8 | 1.06 (0.94 to 1.15) |
| Shotgun, 8 m | 1.2 | 0.6 (0.3 to 0.8 from where it died) |
| Judge, 8 m | 0.5 | 0.3 |
| Stakegun, 8 m, no wall | 0.9 | 0.6 |
| Autocannon, 10 m | 1.8 | 0.8 |
| Lance | Cuts the body in two | The same |
| Rocket, direct | 1.0 | 2.1, hips up to 2.5 m |
| Rocket, floor 2 m away | 1.2 | 2.8 |
| Rocket, floor 4 m away | Survives, 0.4 | Survives, 0.75 |
| Grenade, floor 2 m away | 1.1 | 2.1 |
| Rocket 2 m from a corpse | 3.1 | 1.9 |

**After active ragdoll**, one to three runs each. Most rows held. These moved: SMG kill 0.8 to 1.0, because a body now takes about a second to die and is walked back by the rest of the burst, and SMG 1.5 s on a corpse 0.1 to 0.9 (was 0.15), from the jolts. Shotgun 2 m is 1.5 to 2.3 (was 1.06). That is not more force. It is that six pellets no longer cut a corpse in two at the waist, so the hips now travel with the rest of the body. Before, the number was measuring a pair of legs left behind. Rocket 4 m survivors are thrown up to 2 m (was 0.75), then get up.

Gibs, new only: from a rocket, the furthest limb lay 4.6 m out. Limbs peaked at 11.5 m/s and chunks at 13. A second rocket beside the limbs moved them up to 5.9 m at 12.2 m/s, and left chunks at rest alone. The old speeds were not measured.

Sword kills slice, so they have no throw to measure. The Kiln is 1 N·s.

**After the blast rings.** `impulse` 12 and `maxBlastSpeed` 10, up from the table above. Bullets did not change. Metres from where it stood to the hips at their furthest, three to eight samples each, real game.

| Case | Old | New |
|---|---|---|
| Rocket, floor 2 m away | 2.8 | 5.8 to 6.9, hips up to 2.3 m |
| Rocket, floor 4 m away, survivor | up to 2 | 3.2 to 4.2 |
| Rocket, floor 5.5 m away, survivor | not measured | 2.9 to 3.4 |
| Grenade, floor 2 m away | 2.1 | 4.8 |
| Grenade, floor 5 m away, survivor | not measured | 2.7 |
| Rocket 2 m from a corpse | 1.9 | 5.2 to 5.7 |
| Shotgun, 2 m | 1.5 to 2.3 | 1.2 to 2.4, one of ten at 4.8 |
| Shotgun, 8 m | 0.6 | 0.6 |
| SMG, kill at 8 m | 0.8 to 1.0 | 0.7 |

**After the weight pass** (2026-11-09). A death now keeps the stagger and knockback it was in, up to 0.6 m/s (`DEATH_CARRY` in `damage.ts`), and not what rounds of the same frame added. `?weight=0` keeps only the stride, as before. In one session, metres to the hips at rest, and from where it died:

| Case | Weight pass | `?weight=0` |
|---|---|---|
| SMG, kill at 8 m (9 and 8 runs) | 0.79 to 1.40, mean 1.12; 0.45 to 1.06 from death | 0.64 to 1.08, mean 0.84; 0.29 to 0.73 |
| Shotgun, 2 m (4 and 3 runs) | 1.59 to 3.24 | 1.44 to 2.84 |
| Shotgun, 8 m (4 and 3 runs) | 0.38 to 0.87 | 0.54 to 0.71 from death |

SMG rounds are six frames apart, so the same-frame rule never meets an SMG kill, and five of its nine runs predate it. Kept whole, as the weight pass first had it, the SMG kill at 8 m went 1.71 to 1.91 m (1.39 to 1.58 from death) against 1.00 to 1.21 on the code before it, because the Trooper staggers on the second round and dies on the third. Capped at 0.6 m/s but with the pellets of one shot still counted, the shotgun at 8 m went 0.75 to 1.06.

**On the tempo dial** (2026-11-10, `?raggrav=`, `docs/notes/gore.md` Forces). Bodies fall under that share of gravity, and what moves them (blasts, shoves, rounds, a limb's spin) is slowed by its square root, so they should land as far and stay up longer. Measured as the table above was, hips at their furthest from where the body stood, dial 1 and 0.6 alternating in one session, with a scratch copy of `lab-throw` that also times the flight: from the blast to the hips first back under 0.45 m after they rose past 0.85 m. Survivors are the one Trooper in the middle hit with 1 damage, which the blast's push does not depend on.

| Case | 1 | 0.6 |
|---|---|---|
| Rocket, floor 2 m away (9 bodies each) | 5.45 to 6.85, mean 6.38; in the air 0.91 s | 5.87 to 7.61, mean 6.56; 1.29 s |
| Rocket, floor 4 m away, survivor (3 each) | 4.63 to 4.92; 0.61 s | 4.58 to 4.91; 0.81 s |
| Grenade, floor 2 m away (9 each) | 4.11 to 5.53, mean 4.64; 0.75 s | 4.07 to 5.28, mean 4.83; 1.00 s |
| Shotgun, 2 m (23 each, three sessions) | 1.41 to 3.16, mean 2.29, median 2.33 | 1.47 to 5.81, mean 2.67, median 2.52 |
| Leaper killed 2.2 m up, falling at 6 m/s (3 each) | hips down at 0.27 s, frozen 1.3 to 1.4 s | 0.27 s, takes the dial at 0.30 s, frozen 1.6 to 1.8 s |

The blasts land where they did, inside the ±15% the plan asked, and fly 1.33 times as long (1.29 by the arithmetic; the rocket at 2 m reads 1.38 on its medians). The sandbox `blast` scenario, which is the same every run, throws its muscle body 5.84 m at 1, 6.21 at 0.75 and 6.35 at 0.6, in the air 1.15 and 1.29 times as long. The shotgun at 2 m goes 17% further on average at 0.6, 8% on the medians: the pellets' push is in the body's speed when it dies, and that speed is not slowed, so it carries for longer (gore.md, Known limitations). Against the rows above, which predate the weight pass, the rocket survivor at 4 m reads 4.8 m at 1 as well. A body killed in the air keeps full gravity until it lands, so the Leaper is down at the same moment at both.

**Hits with mass** (2026-11-10, `?mass=0` puts back what was before; `docs/notes/gore.md` Taking rounds and The ragdoll budget). Jolts and a blast's spin on the limbs come down with a body's mass, one round moves one limb by 6 m/s at most, and the living flinch is smaller and settles without rocking past rest. Stage 3 and `?mass=0` alternating, in two sessions; metres to the hips at rest.

| Case | Stage 3 | `?mass=0` |
|---|---|---|
| Shotgun, 2 m (28 and 12 runs) | 0.84 to 2.41, mean 1.78 | 1.34 to 4.00, mean 2.35 |
| SMG, kill at 8 m (12 each) | 0.87 to 1.66, mean 1.19 | 0.74 to 1.39, mean 1.07 |
| Rocket 2 m from a corpse (12 each) | 4.89 to 6.87, mean 5.54 | 5.22 to 5.95, mean 5.58 |
| SMG 1.5 s on a corpse (12 each) | 0.05 to 0.23 | 0.03 to 0.26 |

An independent session, 30 kills each way: the shotgun at 2 m 0.91 to 2.70, mean 1.86, median 1.84, against a mean of 2.43 and a median of 2.54 with `?mass=0`, 17 of those 30 over 2.4. So the band's "before" was already over it. The shotgun's drop is not the cap on one impulse (with it at 9 and 6 in one session: 1.75 and 1.91 against 1.79 and 1.89). On a Trooper the mass factors are 1, which leaves the smaller flinch of the shell's first pellets, read into the speed the body dies with. Sixteen of those runs had the cap set in the page through `tools/out/stage3/throw-imp.mjs`, a scratch wrapper. `BLAST_CROWD=16 blast-seq.mjs` reports what froze and where: with `?mass=0` four tries of eight froze a body standing the frame it died, now none.

**`lab-throw` under-reports survivors.** It measures at rest, and by then a body with AI off has got up and gone back to its post: the same rocket at 4 m reads 1.5 m there. Trust the table above for anyone who lived.

## Contact, measured

`tools/scripts/lab-contact.mjs`, about 60 fps, bot holding forward.

| Case | Result |
|---|---|
| Walk into Brute, Juggernaut, Titan from 14 m | Never through. Overlap at most 0.11 m. Leaning on one, the view moves 2 mm or less |
| The same at 30 fps, an earlier run | Overlap 0.13 m |
| Dash, slide into a Brute | Stopped, overlap 0.07 m |
| Run aimed 0.6 m off centre | Slides round at full speed, top 12.52 m/s |
| Jump at a Brute | Height 1.38 m, which is a plain jump. No throw |
| Spawned inside a Juggernaut at a wall | Walks out along the wall |
| Titan walks the player into a wall | Pinned for as long as the bot stands there, never through the wall, top speed 9.45 m/s. Sidestep works at once |
| Run into a pack, 11 husks and a Brute | Husks shouldered aside, slides round the Brute, carries on 13 m past it. On 2026-11-10, 12.5 m: the pack's front row leaves the run's line open, and the player meets only two husks of the second, 0.6 m to either side, closing at about 9 m/s, so none goes down with the body check either. A straight run can meet no more than those two: the front row is 1.2 m out, past a husk's 0.87 m reach. The run's slowest is the Brute's, 2.2 to 3.0 m/s either way (`slowest`) |
| Sprint at 12.5 m/s into a standing Trooper, and a Husk, 10 runs each (`CONTACT=knock`, 2026-11-10) | Down 10 of 10 each, the hips at rest 1.47 to 1.68 m along the run (mean 1.58) and 1.48 to 1.70 (1.58), within 0.16 m of its line; the player never under 12.5 m/s. With `?knock=0`, and on the code before, 0 of 10: staggered |
| Charge a pack from 23 m: six husks a hand's width either side of the line, five out to the sides, a Brute behind (`charge`) | Six down at once, the five aside untouched; carries on 12.5 m past the Brute. The physics step 0.9 ms median and 1.5 at the 90th percentile while they are down, 9.3 at the peak as the six chains start, against 0.2 with `?knock=0`, where nobody goes down. Six Troopers floored in one frame by shotgun pellets, which the code before does too, cost the same with `?knock=0`: 7.0 to 7.2 ms the first time in a session and 2.5 to 3.2 after, 1.0 median and 1.5 at the 90th percentile, against 7.3 to 9.1, 1.9 to 3.9, 1.1 and 1.4 (`tools/out/fix4/headseed.mjs`, `HS_MODE=cold`). The peak is six new chains, the first ones in a session; the stage adds knockdowns, not cost to each. Slowest through the pack, the Brute's: 2.95 m/s, 1.91 with `?knock=0` |
| Ringed by 8 husks and 2 Brutes, AI on | Out and 17.5 m clear in 4 s. 17.5 again with the body check, and 17.6 with `?knock=0` (21.5 in one earlier run of the code before) |

## Checks

```
node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-check.mjs --wait 500 --timeout 170 --out tools/out/labcheck.png
node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-contact.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 200 --out tools/out/contact.png
CONTACT=knock node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-contact.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 200 --out tools/out/knock.png
THROW_REPS=3 node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-throw.mjs --wait 500 --timeout 290 --out tools/out/throw.png
node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 120 --out tools/out/seq.png
```

```
REACT=stagger,fall,trip node tools/shot.mjs --url "/?map=range" --script tools/scripts/react-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 200 --out tools/out/react.png
node tools/shot.mjs --url "/?map=range" --script tools/scripts/react-chaos.mjs --wait 500 --timeout 120 --out tools/out/chaos.png
```

```
HEAD=stand,run,crouch node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/head-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --out tools/out/head.png
BLAST_TRIES=4 node tools/shot.mjs --url "/?map=range&contract=outpost" --script tools/scripts/blast-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 170 --out tools/out/blast.png
node tools/shot.mjs --url "/?map=range" --script tools/scripts/batch-check.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 150 --out tools/out/batch.png
node tools/shot.mjs --url "/?autostart=1" --script tools/scripts/batch-fight.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 120 --out tools/out/fight-swarm.png
```

`head-seq` is a lethal headshot on world frames, with world time beside each row. `blast-seq` is a grenade into a crowd of 12, a row per try. `batch-check` is the panel by real clicks, head knockdowns, shaped charges, the waist tear, machines and a big crowd, picked with `BATCH=`. `batch-fight` is a bot with real weapons and real input.

`react-seq` steps world frames and writes one contact sheet per reaction, `tools/out/react-<case>.png`. Cases: `stagger stagleg trip fall fallback rise riseback struggle struggleback huskup riseshot thrown thrownup dance husk maimed oneleg noleg`. `struggle`, `struggleback` and `huskup` start their sheet the frame a body starts to get up, so a sheet shows the push (or, with `&struggle=0`, the gather for the clip); `riseshot` puts four pellets that do not kill into a body half way through the face-down clip. `react-chaos` runs 24 bodies with AI on under blasts and fire, and reports bodies that never get up.

`lab-check` drives everything with real keys, real pointer lock and all 16 types. Its reload for the settings check can cancel a music fetch, which shows up as one `requestfailed`.

## Known limitations

- **Nobody has played this.** Every number above is a bot, and the throws were judged from numbers and stills.
- **The spawn list only knows `ctx.enemies.spawn`.** Bosses arrive without their drop-in entrance, and they play their full death, blast included, on Kill all.
- **Solid is a circle, `contactRadius`.** It suits a torso. A Titan's stride reaches past 1.3 m, so its feet can still pass through the player's view.
- **Riot and Burner are not solid** at `mass` 0.35 and 0.2. Move `SOLID_MASS` or their rows if they should be.
- **The 20 fps figures for contact are worked out, not measured.** Only 30 and 60 fps were run.
- **Living knockback changed shape.** `SHOVE_GAIN` keeps the SMG and rockets where they were by the arithmetic, and a pellet at range pushes about 1.6 times harder. It has not been tried in a wave.
