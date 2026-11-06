# Player notes: input, movement, camera

Owned files: `src/input/**`, `src/player/**`, `src/sandbox/movement.ts`, `tools/scripts/movement-*`.

## Public API

```ts
import { createInput } from '../input';                       // createInput(canvas): Input
import { createPlayer, createCameraRig, MOVE, VIEW, FEEDBACK } from '../player';
```

`Game` builds all three. Update order: `player.update()` with gameplay, `camera.update()` after progression,
`input.endFrame()` last. `Player.reset()` spawns at `world.playerSpawns[0]`.

**Input** (`InputSystem`). Polled actions. `pressed` and `released` last one frame.

- `simulate(action, down)` and `simulateLook(dx, dy)` drive everything without pointer lock. Simulated state survives blur.
- `consumeLook()` belongs to the player. Everything else reads `input.frameLook` (this frame's motion, consumes nothing).
- Rebinding: `bindingsFor`, `labelFor`, `rebind`, `conflicts`, `resetBindings`, `captureNext`. Stored in `localStorage`.
- Added actions: `callinWarthog`, `callinDoorGunner` (J), `callinChopper` (H), `callinOrbital`, `callinBlackSun`, `callinNuke`. `streak` is the airstrike key (X).
- Losing pointer lock fires `pressed('pause')`, because Chrome swallows the Esc keydown that ended the lock.

**Player** (`PlayerSystem`). `position` and `eye` are interpolated for display, `velocity` is the simulated velocity.

- Read: `speed` (horizontal, and it is what the feet really cover: see "Walls"), `state`, `grounded`, `sliding`, `crouched`, `wallRunning`, `wallSide`, `dashing`, `slamming`,
  `mantling`, `dashCharges` (0..2, fractional while refilling), `stridePhase`, `groundSurface`.
- Motion: `launch(v)` replaces vertical speed and adds horizontal. `push(v)` adds on all axes. `teleport(p, yaw?)` clears motion.
- Health: `takeDamage`, `heal(amount, overheal?)`, `addArmor`. Armor absorbs 2/3 of a hit; `true` and `hazard` damage skip it.
- `modifiers`: `speed`, `jump`, `damageTaken`, `invulnerable`, `infiniteDash`. `reset()` restores them in place.
- `holdToHop`: off by default. On, holding Space hops on every landing. No menu writes it yet: see Known limitations.

**CameraRig** (`CameraRig`). Only this writes `render.camera`, `render.viewCamera` and `audio.setListener`.

- `addTrauma(0..1)`: trauma takes the max of current and new. Amplitude is trauma squared, 0.09 rad of pitch at 1. The
  offset holds for 50 ms and then snaps to a new value, so it is the first game's snap with a decay.
- `kick(pitch, yaw, roll)`, `fovPunch(degrees, seconds)`, `setZoom(fov | null)`, `setBaseFov(degrees)`, `fov`.
- Listens to player events itself: landing dip, slam, dash, slide, mantle and hit shake need no calls.
- Every term on top of the look decays to exactly 0 (`settle`, and a rest threshold in `springStep`), so a level view is level.

**Seats.** `player.park(feet)` holds the body for a vehicle seat: no input, no motion, and `takeDamage`, `launch` and `push` all do nothing. The view it was left with is kept, and it reads as grounded. `player.unpark(grace)` gives it back, untouchable for `grace` seconds. Look is still consumed while parked, because `input.frameLook` is what the seat aims with. `camera.setSeat(view)` hands the camera to a `SeatView`, with kicks and shake on top scaled by `view.shake`, and null gives it back. `camera.syncSeat()` places it at once, for shots fired before the rig's turn in the frame. Both `reset()`s clear all of this. Tests: `park.test.ts`.

**Events.** `player:jumped` now has `wall` and `bounce` flags. `player:slam` is `{ impact, position, radius }`, where `impact`
is meters fallen. New: `player:slamstart`, `player:mantle { height }`.

## Using it from gameplay code

```ts
ctx.player.launch(new THREE.Vector3(0, 30, -14));              // jump pad
ctx.player.modifiers.speed = 2;                                 // Berserk
ctx.camera.addTrauma(0.6);                                      // explosion nearby
if (ctx.player.state === 'wallrun') score.style('wallrun');
const sway = ctx.input.frameLook.x;                             // weapon sway
```

## How movement works

DESIGN section 13 overrides section 6: normal running is planted, and speed is something the player chooses and earns.

Fixed 120 Hz ticks on `time.playerDt` with the frame's mouse motion spread across its ticks. Input edges are latched per
frame and spent by the next tick.

**Why it was slippery.** Three causes worked together, and only the first is a matter of speed:

1. `landGrace` switched friction off after every landing, and `overspeedDecel` was 34. Holding Space made that the normal
   state, so the player spent most of a run in a friction-free bounce.
2. One acceleration did everything. `approachVector` moved velocity toward the wish at 100 m/s^2, so killing the old
   direction and building the new one shared a budget: 2.1 m of drift through a 90 degree turn.
3. Slide (52 m), dash (exit 24 against a run of 17) and strafing (52 m/s) all left the player faster than the ground
   could scrub off, in rooms a tenth of that size.

**Ground.** Speed along the wish and speed across it are separate jobs. `groundAccel` builds along it, 0 to run in 0.18 s.
`groundGrip` kills everything else at 240 m/s^2, which is what removes drift. Above run speed `overspeedDecel` scrubs at
75 m/s^2. There is no friction-free window any more. Friction starts on touchdown, and a hop in time restores the speed the
landing took: `hopVx/hopVz` hold it for `landGrace`, and `jumpBuffer` covers the press before touchdown. Anything else lands
with a stumble (`landWeight*`) that scales with impact and is gone in 0.14 s.

**Air**, in order of priority:

- **W + strafe** is Quake's accelerate. Speed gain only, turning slowly.
- **Strafe alone** is CPMA's: tiny wish speed, huge acceleration. Hard turns, smaller gain.
- **W alone** steers velocity toward the view at constant speed, so nobody has to know strafing to fly straight.
- **Below run speed** the air is responsive, so a standing jump goes somewhere.
- **Past `softCap`** drag pulls speed back, which sets the strafe ceiling near 27 m/s. Pads and blasts set `flung`, which
  skips the drag until landing, because pads are aimed.

**Nothing happens by accident.** Holding Space jumps once. Holding crouch does not slide: only a press does, or a press in
the air too low to slam, which queues for the landing. A wall run needs all of: `wallRunMinAir` off the ground, W held, moving
along the wall, keys steering 9 to 53 degrees into it, and `wallRunAhead` meters of wall still in front. A wall kick needs
`wallKickMinInto` toward the wall, so a press beside a wall stays a double jump. Mantling only happens in the air, so the
player must jump to climb. The old beside-the-velocity wall scan is gone: a wall run starts from real contact.

**Walls.** Two bugs here cost more than any tuning, and both showed up as "stuck on things":

- `slideAlong` charged a tick for the distance to the hit, not the distance moved. It stops `skin / dn` short of a surface,
  which at a shallow angle is about a whole tick of motion, so the tick was spent standing still. At 6 degrees that left
  12% of the speed, while `player.speed` still read 12.4. Now only distance covered costs time. A hit that moves nothing
  still clips velocity, so the next iteration makes progress, and `MAX_SLIDE_ITERATIONS` bounds the rest.
- `groundGrip` measures against the wish, but a wall forces velocity along itself, so past about 15 degrees grip read the
  slide as drift and scrubbed it: 1.5 m/s at 45 degrees against an ideal 8.8. `clipAgainst` now records the wall in
  `wallPressN`, and `groundForces` measures against what the wall leaves of the wish, in the ground plane. The push into the
  wall stays in the velocity, so contact holds and the collision removes it, and the wish is whole the moment the wall ends.

Result: leaning into any wall gives run speed times cos(lean), and `player.speed` reports that. Speed is post-collision, so
it matches ground covered, with two known exceptions under Known limitations.

Collide-and-slide runs up to 5 iterations, with Quake's plane clipping and crease handling. A surface can mean five things
before it means "slide along it": stair or curb (step up, keeps velocity), real ramp (redirect, keeps speed), ledge
(mantle), wall (wall run), ceiling (clip). Ledge lips give the capsule a tilted normal, so every tilted contact gets a second
look with a ray. Taken at face value that normal launches the player off every stair. A step-up that still hits something
above step height is a ledge and is refused: the capsule's round bottom used to roll up edges of nearly a meter.

**Rapier query accuracy.** Capsule casts overshoot on large colliders: about 6 mm on a 300 m box, 5 cm on 600 m, 25 cm on
2 km, and any cast that starts in penetration may report nothing. So the ground check is ray-first (rays are exact), every
sweep hit is refined with a ray along the normal, overlap tests use a slightly smaller capsule, and `depenetrate` catches
anything left. See `findFloor`, `refineContact` and `collide.ts`.

**View.** Mouse look is raw: `Input.onMouseMove` adds `movementX/Y` with `unadjustedMovement`, `Player.update` multiplies by
`sensitivity * lookScale`, and `CameraRig.update` writes that into `camera.rotation` the same frame. Nothing smooths or damps
it, and a test holds that to 12 places. `lookScale` is 1 unless scoped. There is no strafe roll, because any roll on foot reads as
a tilted crosshair. Only slides, wall runs, kicks, shake and death roll, and all of them return to exactly 0.

## Tuning knobs

`MOVE`, `VIEW` and `FEEDBACK` all live in `src/player/tuning.ts`, as plain mutable objects, so `__movement.MOVE.airAccel = 1`
works live in the sandbox.

| Want | Change |
|---|---|
| Faster or slower on foot | `runSpeed`. Keep `airWishSpeed` equal to it |
| Heavier push-off | `groundAccel`. 70 is 0.18 s to run speed; the limit is 0.25 s |
| More or less drift in turns | `groundGrip` |
| Stop distance | `stopDecel` |
| Faster return from overspeed | `overspeedDecel` |
| Landing weight | `landWeightSlow`, `landWeightTime`, `VIEW.dipPerImpact`, `VIEW.landNod` |
| Jump arc | `gravity`, `jumpSpeed`. Height is `jumpSpeed^2 / (2 * gravity)` |
| Forgiveness for late hops | `landGrace`, `jumpBuffer` |
| Strafe gain | `airAccel`. Perfect gain is `airAccel * airWishSpeed^2 / speed` m/s per second |
| Air speed ceiling | `softCap`, `softDrag`. Perfect strafing settles near 27 m/s |
| Sharper air turns | `sideAccel`, `sideWishSpeed`. W-only steer: `airControl` |
| Slide length | `slideFriction`, `slideOverDrag`, `slideEndSpeed`. Downhill: `slideGravity` |
| Dash | `dashSpeed`, `dashTime`, `dashExit`, `dashKeep` |
| Wall run strictness | `wallRunMinAir`, `wallRunWishMin/Max`, `wallRunWishAlong`, `wallRunAhead`, `wallRunMaxInto` |
| Wall run length | `wallRunHold`, `wallRunMax`, `wallRunFallScale`, `wallRunSpeed`. Kick: `wallKick*` |
| Mantle | `mantleReach`, `mantleFacing`, `mantleRiseSpeed` |
| Ramp stickiness | `snapMaxSeparation`, `snapDown` |
| Speed feel | `VIEW.fovSpeedAdd`, `fovSpeedFrom`, `fovSpeedFull`, `FEEDBACK.speedLinesFrom/Full` |
| Head motion | `VIEW.bobHeight`, `bobSide`, `dipOmega`, `dipZeta` |
| Footsteps | `strideBase`, `strideFromSpeed`, `FEEDBACK.footstepPitch` |

`VIEW.wallRoll`: the roll follows Titanfall, with the head tipping away so the wall rolls under the feet. DESIGN says "rolls
toward the wall". Flip the sign of `wallRoll` for the literal reading.

## Measured

From the bots, on real Rapier, in Chrome and in Node. Feel rows are at 240 fps for resolution. Before is the build the owner
played. Bots cannot judge feel: these are distances and times, not a verdict.

| Mechanic | Before | After | Target |
|---|---|---|---|
| Run speed, time to it | 17, 0.18 s | 12.5, 0.18 s | 11-13, 0.25 s or less |
| Stop time, distance | 0.16 s, 1.39 m | 0.13 s, 0.83 m | |
| Reversal (W to S, A to D) | 0.34 s, overrun 1.52 m | 0.23 s, overrun 0.38 m | |
| Drift after a 90 degree turn | 2.11 m in 0.24 s | 0.38 m in 0.06 s | almost none |
| Landing at 28 m/s, W held, back to a run | 0.38 s, 8.8 m | 0.20 s, 4.0 m | about 0.25 s |
| Landing with no keys, skate | 2.38 m | 0.83 m | |
| Held Space, 3 s | 5 jumps | 1 jump | timed skill |
| Hop 30 / 50 / 100 / 200 ms late, from 24 m/s | n/a | 24 / 24 / 15.3 / 12.5 | window, then friction |
| Timed hops, W only | 0 m/s lost | 0 m/s lost | |
| Strafe, near-perfect, 10 hops | 17 to 52.2 | 12.5 to 26.8 | 26-30 |
| Strafe, steady hand at 60 degrees/s | 35.7 | 23.7 | |
| Strafe key alone, near-perfect | 46.2 | 25.3 | |
| Slide on flat | 52 m, 3.8 s | 13.8 m, 1.2 s | 12-16 m |
| Slide downhill 20 degrees, peak | 29.5 | 25 | keeps gain |
| Dash exit, peak, press to full stop | 24, 34, 11.4 m | 13, 26, 4 m | near run speed |
| Jump, double jump | 1.93 m, 3.67 m | 1.38 m, 2.54 m | about 1.4 m |
| Air time | 0.73 s | 0.57 s | heavier |
| Wall lean 6 degrees, real / reported | 14.9 / 16.9 | 12.4 / 12.4 | |
| Wall lean 45 degrees, real / reported | 10.4 / 12.0 | 8.84 / 8.84 | |
| Wall runs from a jump while hugging a wall | 1 | 0 | none by accident |
| Unasked climb, running at a 1.2 m crate | 1 | 0 | none |
| Mantle from a jump, 2.4 m block, rise speed | 0.08 s, 15.3 m/s | 0.18 s, 7 m/s | no yank |
| Speed FOV at run / at 27 m/s | +4.2 / +8.4 | 0 / +5.5 | at most +6 |
| Strafe roll, peak | 1.6 degrees | 0 | tiny or zero |
| Roll left over, after any motion | up to 0.016 degrees | exactly 0 | exactly 0 |

Wall lean at 12.5 m/s with each fix applied, real / reported: 6 degrees 1.45 / 12.43 before both, 12.43 / 12.44 after the
`slideAlong` fix, 12.43 / 12.43 after both. 45 degrees: 1.09 / 1.51, then 1.3 / 1.49, then 8.84 / 8.84. Every lean from 1 to 75
degrees matches run speed times cos(lean) to 0.02 m/s.

Chain: run 12.5, slide 13.7, jump 13.7, wall run 13.2 then 15, kick 18, dash 26, 18, slam, slide 20. No link drops below run speed.

| Other | Result |
|---|---|
| Wall run | gravity-free 0.93 s, 1.45 s and 21.6 m in total, 1.35 m lost, exit 14.4 |
| Corridor zig-zag, 5 m wide, 6 kicks | 12.8, 18.0, 18.8, 19.5, 20.0, 20.5, 20.9 |
| Mantle | 0.8 to 3.2 m from a jump at 12.5 m/s, none from the ground |
| Stairs at run speed | minimum 12.49, zero air frames |
| Curbs 8 to 44 cm at 12.5 and 40 m/s | no speed spike, peak vy 0 |
| Fired at a wall at 60 and 150 m/s | no tunnelling |
| Flat-ground exploit loops | jump-slam-slide 18, dash-jump 18, slide-hop 19.4. All below strafing |
| Frame rate | strafe 26.7 / 26.8 / 26.9 at 30 / 60 / 144 fps, and the planted-feet numbers agree within 0.12 m |

From a full run: a jump clears 7.3 m, jump and double jump 14 m, plus one dash 19.1 m, plus two dashes 23.8 m.

**Kill House, real map:** 6 degree lean along the ring and court walls holds 12.4 m/s real and reported. Every door from both
sides passes (796 of 796), 71 wall runs with no catches, 0 frames inside geometry. The lean carries the capsule 0.4 m into a
door gap, so it bumps the next jamb, a real collision, and recovers within 0.1 s.

CPU is about 0.2 ms per frame for the whole player on the course. A tick costs one ray plus one or two capsule casts.

## Contract changes

All additive, in `src/core/contracts.ts`:

- `Action`: `callinWarthog`, `callinOrbital`, `callinBlackSun`, `callinNuke`.
- `InputSystem`: `frameLook`, `bindingsFor`, `labelFor`, `rebind`, `conflicts`, `resetBindings`, `captureNext`.
- `CameraRig`: `fov`, `setBaseFov`.
- `PlayerSystem`: `push`, `speed`, `state`, `crouched`, `slamming`, `mantling`, `dashCharges`, `groundSurface`, `wallSide`,
  `stridePhase`, `sensitivity`, `invertY`, `lookScale`. `heal` gained an optional `overheal`.
- `PlayerModifiers.infiniteDash`, new type `PlayerMoveState`.
- `Player.holdToHop` is on the class only, not on `PlayerSystem`.
- `GameEvents`: `player:jumped` flags, `player:slam` radius, `player:slamstart`, `player:mantle`.

## Known limitations

- **This tuning has not been played by a human.** Every number comes from bots. `runSpeed`, `groundAccel`, `groundGrip`,
  `landWeightSlow` and `dipPerImpact` deserve hands first. All of it is live-tunable in the sandbox.
- **Other systems still assume the old numbers.** Not owned here, each one line: `PLAYER_GRAVITY = 28` in `world/objects.ts`
  and `GRAVITY` in `world/verify.ts`, so pads aimed for 28 now land short. `TUNING.groundSpeed = 17` in `weapons/data.ts`, so
  the Buzzsaw slows the player less than intended. `GROUND_TOP`, `REDLINE` and the 60 m/s dial in `ui/hud/tach.ts`.
  `overdriveFloorSpeed` 17 and `overdriveTopSpeed` 45, `OVERDRIVE_MIN_SPEED` 25 and `speedTiers` in `progression/data.ts`:
  25 m/s is now close to the strafe ceiling, and tiers above 20 need a pad or a blast. The 45 m/s in `ui/hud/crosshair.ts`
  and `smoothstep(13, 46)` in `audio/foley.ts`. Crucible gaps were tuned for 17 m/s: the 18 m ring gap now needs a dash.
- **Hold-to-hop has no menu entry.** `Player.holdToHop` works and is tested. `ui/settings.ts` needs one line beside `invertY`.
- **`player.speed` during a mantle** keeps saying how fast the player was going for the 0.1 to 0.3 s climb, on purpose, so
  readouts and Overdrive do not blink to zero. Horizontal position does not change in that time.
- **`player.speed` in an inside corner** flickers between 0 and about 1 m/s, averaging 0.2, while real motion is 0. The second
  wall is inside the skin gap, so a tick can end before it clips. Nothing that reads speed reacts to that little.
- **Players pass through enemies.** The capsule only collides with `CG.World`. To change it, set `MOVE.collisionMask`, but
  enemy colliders would then need to stop the capsule without snagging it at 40 m/s.
- **Crushers push out through the stuck check**, which takes 3 ticks. Moving decks carry the player through `rideGround`,
  and that motion is not in `velocity` or `speed`.
- **A head-on wall hit stops the player**, unless the wall can be mantled. That is deliberate but it is the one remaining
  place momentum simply ends. An overhang lip clips speed the same way.
- **Slam damage lives in `feedback.ts`** (`slamEnemies`, type `crush`, source `slam`, 30 to 140 by height). No other system
  handled the base shockwave, so it is here. Move it if enemies grow their own handler.
- **Ctrl+W closes the tab** on Windows and Linux with Ctrl as the slide key, and a page cannot stop that. While locked,
  `beforeunload` asks first, and in fullscreen `navigator.keyboard.lock` blocks it. C is the safe binding.
- **Rapier allocates a small hit object per cast.** Two or three per tick, not avoidable from JS. Everything of ours is reused.
- **One stray fall** in a first 120 s map run ended at (80, -39, -105), under solid floor, and it did not repeat in 600 s of
  the later run. The origin was not found. `rescueIfLost` brings a player back to a spawn 25 m below the world bounds.

## Testing

```
npx vitest run src/player src/input                               # 75 tests, real Rapier, no browser
npx tsx tools/scripts/movement-headless.ts [bot...] [--fps 60]     # bot numbers in about a second
node tools/shot.mjs --url "/?sandbox=movement" --script tools/scripts/movement-bot.mjs --out tools/out/movement.png --wait 500
node tools/shot.mjs --url "/?sandbox=movement&map=killhouse&seconds=120" --script tools/scripts/movement-map.mjs --out tools/out/movement-map.png --wait 500
node tools/shot.mjs --url "/?sandbox=map&map=killhouse" --script tools/scripts/movement-killhouse.mjs --out tools/out/kh-move.png --wait 1500 --timeout 280
node tools/shot.mjs --url "/?autostart=1&map=killhouse" --dpr 2 --w 1440 --h 900 --script tools/scripts/movement-live.mjs --out tools/out/live.png --wait 500 --timeout 200
```

Bots `feel` (planted feet), `wallslide` (real progress against reported speed at every lean), `roll` (camera.rotation.z) and
`intent` (nothing by accident) are the ones to rerun after changing the ground numbers. Run `feel` with `--fps 240`.

Bots live in `src/player/testkit/bots.ts` and touch the game only through `input.simulate`. In the sandbox click to play: keys
1-0 pick a lane, R restarts it, T runs the chain bot. `?map=killhouse` or `?map=crucible` plays on a real map.
