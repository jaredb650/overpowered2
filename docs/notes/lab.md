# Test Range and dev controls

`src/lab/`, flags in `src/core/devflags.ts`. `Game.ts` loads the lab only on `/?map=range` or with `?dev=1`, so a normal run never downloads it.

## How to use it

| Where | What you get |
|---|---|
| `/?map=range` | The Test Range. No menu, no waves. Perks start off, god mode and every weapon start on |
| `/?dev=1` | The real game with the same panel. Add `&autostart=1` to skip the menus |
| `/?map=killhouse&dev=1` | Any map, the same way |

| Key | Does |
|---|---|
| F1 or backquote | Panel. On a Mac keyboard F1 is usually `fn`+F1, which is why backquote is there too. Esc also closes it |
| Click | Takes the mouse back |
| P | Pause the world. The player keeps moving, so you can walk round a frozen body and fire into it |
| . | Step one frame of 1/60 s |
| [ and ] | World speed down and up by half |
| O | Spawn the selected type at the crosshair |
| K, L | Kill all. Clear corpses, limbs, chunks, blood and plates |

Settings live in localStorage, one copy for the range and one for `?dev=1`, so a test never leaks into a run.

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
| Run into a pack, 11 husks and a Brute | Husks shouldered aside, slides round the Brute, carries on 13 m past it |
| Ringed by 8 husks and 2 Brutes, AI on | Out and 17.5 m clear in 4 s |

## Checks

```
node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-check.mjs --wait 500 --timeout 170 --out tools/out/labcheck.png
node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-contact.mjs --wait 500 --timeout 150 --out tools/out/contact.png
THROW_REPS=3 node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-throw.mjs --wait 500 --timeout 290 --out tools/out/throw.png
node tools/shot.mjs --url "/?map=range" --script tools/scripts/lab-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 120 --out tools/out/seq.png
```

```
REACT=stagger,fall,trip node tools/shot.mjs --url "/?map=range" --script tools/scripts/react-seq.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 200 --out tools/out/react.png
node tools/shot.mjs --url "/?map=range" --script tools/scripts/react-chaos.mjs --wait 500 --timeout 120 --out tools/out/chaos.png
```

`react-seq` steps world frames and writes one contact sheet per reaction, `tools/out/react-<case>.png`. Cases: `stagger stagleg trip fall fallback rise riseback thrown thrownup dance husk maimed oneleg noleg`. `react-chaos` runs 24 bodies with AI on under blasts and fire, and reports bodies that never get up.

`lab-check` drives everything with real keys, real pointer lock and all 16 types. Its reload for the settings check can cancel a music fetch, which shows up as one `requestfailed`.

## Known limitations

- **Nobody has played this.** Every number above is a bot, and the throws were judged from numbers and stills.
- **The spawn list only knows `ctx.enemies.spawn`.** Bosses arrive without their drop-in entrance, and they play their full death, blast included, on Kill all.
- **Solid is a circle, `contactRadius`.** It suits a torso. A Titan's stride reaches past 1.3 m, so its feet can still pass through the player's view.
- **Riot and Burner are not solid** at `mass` 0.35 and 0.2. Move `SOLID_MASS` or their rows if they should be.
- **The 20 fps figures for contact are worked out, not measured.** Only 30 and 60 fps were run.
- **Living knockback changed shape.** `SHOVE_GAIN` keeps the SMG and rockets where they were by the arithmetic, and a pellet at range pushes about 1.6 times harder. It has not been tried in a wave.
