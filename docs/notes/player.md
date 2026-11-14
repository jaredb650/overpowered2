# Player notes: input, movement, camera

Owned files: `src/input/**`, `src/player/**`, `src/sandbox/movement.ts`, `tools/scripts/movement-*`, `tools/scripts/parkour-live.mjs`. The first-person body layer is `src/player/moveAnim.ts`: see "The body in first person" below.

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
  `mantling`, `vaulting`, `dashCharges` (0..2, fractional while refilling), `stridePhase`, `groundSurface`. On the class only: `mantleProgress`, `mantleTopY`, `vaultProgress`, `kickSide`.
- `moveAnim`: the body layer's pose for this frame (`MovePose` in contracts). CameraRig and the viewmodel rig read it. Nothing else should need to.
- Motion: `launch(v)` replaces vertical speed and adds horizontal. `push(v)` adds on all axes. `teleport(p, yaw?)` clears motion.
- Health: `takeDamage`, `heal(amount, overheal?)`, `addArmor`. Armor absorbs 2/3 of a hit; `true` and `hazard` damage skip it.
  Health pickups are stims carried in `progression.stims`, injected on the stim key (Y): see Stims in `docs/notes/progression.md`.
- `modifiers`: `speed`, `jump`, `damageTaken`, `invulnerable`, `infiniteDash`. `reset()` restores them in place.
- `holdToHop`: off by default. On, holding Space hops on every landing. No menu writes it yet: see Known limitations.

**CameraRig** (`CameraRig`). Only this writes `render.camera`, `render.viewCamera` and `audio.setListener`.

- `addTrauma(0..1)`: trauma takes the max of current and new. Amplitude is trauma squared, 0.09 rad of pitch at 1. The
  offset holds for 50 ms and then snaps to a new value, so it is the first game's snap with a decay.
- `kick(pitch, yaw, roll)`, `fovPunch(degrees, seconds)`, `setZoom(fov | null)`, `setBaseFov(degrees)`, `fov`.
- Listens to player events itself: landing dip, slam, dash, slide, mantle and hit shake need no calls.
- Every term on top of the look decays to exactly 0 (`settle`, and a rest threshold in `springStep`), so a level view is level.

**Seats.** `player.park(feet)` holds the body for a vehicle seat: no input, no motion, and `takeDamage`, `launch` and `push` all do nothing. The view it was left with is kept, and it reads as grounded. It also clears the body layer, which nothing steps in a seat: a slide's legs or a hand off the weapon would otherwise wait there and play out on the way out. `player.unpark(grace)` gives it back, untouchable for `grace` seconds. Look is still consumed while parked, because `input.frameLook` is what the seat aims with. `camera.setSeat(view)` hands the camera to a `SeatView`, with kicks and shake on top scaled by `view.shake`, and null gives it back. `camera.syncSeat()` places it at once, for shots fired before the rig's turn in the frame. Both `reset()`s clear all of this. Tests: `park.test.ts`.

**Events.** `player:jumped` now has `wall` and `bounce` flags. `player:slam` is `{ impact, position, radius }`, where `impact`
is meters fallen. New: `player:slamstart`, `player:mantle { height }`, `player:vault { height, seconds }`.

## Using it from gameplay code

```ts
ctx.player.launch(new THREE.Vector3(0, 30, -14));              // jump pad
ctx.player.modifiers.speed = 2;                                 // Berserk
ctx.camera.addTrauma(0.6);                                      // explosion nearby
if (ctx.player.state === 'wallrun') score.style('wallrun');
const sway = ctx.input.frameLook.x;                             // weapon sway
```

Two guns slow the player by writing `velocity` after the player has moved: the rotary cannon and the heavy machine gun on key 8,
through `src/weapons/handling.ts`. It holds an ordinary run and an ordinary jump to a share of run speed, and reads `dashing`,
`sliding`, `wallRunning`, `mantling`, `vaulting` and `slamming` so that it clamps nothing during a move, and nothing above 1.5 times
run speed. What a move leaves under that (`dashExit`, `dashKeep`) bleeds down to the cap at `TUNING.handling.carry` rather than
being cut the frame the move ends. `docs/notes/weapons.md`, "Heavy guns slow the player". `?slow=0` takes it out.

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

**Vault.** A jump pressed while running at waist-high cover goes over it on one hand instead of jumping: `tryVault` in
`Player.ts`. It needs all of: on the ground, W held, at least `vaultMinSpeed`, the run and the keys within about 40 degrees of
the cover's face, the face within `vaultReach`, a top 0.5 to 1.35 m up, an end to that top within `vaultMaxDepth`, walkable
floor behind it no higher than a step, and room for a crouched body over the top and on the far side. Anything else is a
jump as before: a platform, a wall, cover with something standing behind it, a walk up to it. Like a mantle it is scripted:
`pos` moves along a path, nothing collides, and `velocity` keeps saying the entry speed.
The feet go up over the top and down again, clipping the cover's corners on the way, which is why `endVault` checks for
overlap. The eye does not follow the feet: `vaultEye` carries the head across nearly level and down into a crouched landing,
because a head that rose and fell 1.2 m in a fifth of a second is a camera cut, not a vault. No landing event fires, so
there is no thud and no stumble. A launch, a death or a teleport ends it where it is.

Rules of the vault that must stay true, each held by `vault.test.ts`:

- **The body really covers ground at the entry speed, every tick.** `velocity` cannot show this, because the vault holds
  it constant: the tests measure position. The path is a whole number of ticks long at exactly that speed, and the tick
  that starts the vault is its first step. It used to last `max(vaultMinTime, path / speed)`, so a press close to the
  cover crossed at 8 m/s while the readout said 12.5.
- **`vaultMinTime` lengthens the path, never slows the body.** The hand needs its fifth of a second, so a vault from close
  in carries on past the cover until it has had it (`vaultEnd`). Where the far side has no room for that, the vault ends
  as soon as the body is clear and is simply shorter.
- **A lower far side is a fall, not part of the vault.** Floor more than `vaultStepDown` below the feet: the path ends
  level with where it began, in the air past the cover, the head leaves as it arrived, and the drop and its landing belong
  to the simulation. Carried down inside the path, a 1.4 m drop moved the eye 21 cm in one frame.
- **A jump pressed on the way over is a jump off the far side.** The press is held (`holdJump`) and the end of the path
  counts as ground for `coyote` seconds (`releaseJump`), so it is a ground jump and the double jump is kept. Left latched,
  it fired as a double jump on the tick the vault ended, with the feet on the floor.

Running into cover with no key does nothing, as before, so cover can still be stopped behind. `MOVE.vaultAuto` (off;
`?vault=auto`, or the lab panel) vaults from a run of `vaultAutoSpeed` straight into it with no key. `?vault=0` turns
vaulting off.

**Mantle, the top.** A climb ends beside the ledge, drops about a centimetre and is bumped onto it by the step logic: six
ticks in the air. A jump pressed in those ticks, or at any point during the climb, used to spend the double jump the
moment the climb ended. Now the end of a climb counts as ground for `mantleTopJump` seconds and a press made on the way
up is held for it, so it is a jump off the top with the double jump still to come. The body still ends where it always
did, so nothing that judges a climb by position changes.

`mantleCarry` would also take the six ticks away, by carrying the body in over the lip during the last third of the climb
(0.57 ends it standing on the ledge on the next tick). It is built and tested and **off by default**, because it moves
where a climb leaves the body and the campaign's lesson tests are pinned to that: see the campaign note under Known
limitations. A ledge too thin for the first ray, a rail or a 12 cm wall, gets a second ray just behind its face
(`mantleThin`) before it counts as a miss.

**Wall run, the probe.** `wallStick` used to end the run on the first tick its capsule cast missed or came back with a
tilted normal. It now asks a ray at waist height before giving up, and allows `wallRunGrace` (0.05 s) with no wall at all.
See Known limitations: no case was found where this changes a run.

`?movefix=0` takes these three repairs back out (`mantleTopJump`, `mantleThin` and `wallRunGrace` all 0), for comparing
against the moves as they were.

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
| Mantle | `mantleReach`, `mantleFacing`, `mantleRiseSpeed`. The top: `mantleTopJump`, `mantleCarry` (off), `mantleCarryFrom`, `mantleThin` |
| Vault | `vault`, `vaultAuto`, `vaultMinSpeed`, `vaultAutoSpeed`, `vaultReach`, `vaultFacing`, `vaultMinRise`, `vaultMaxRise`, `vaultMaxDepth`, `vaultMaxDrop`, `vaultStepDown`. Shortest vault where there is room: `vaultMinTime`. Head path: `vaultEyeOver`, `vaultEyeLand` |
| Body animation | `ANIM` in `moveAnim.ts`. `ANIM.camera` is the comfort knob. Hand and leg placement: the targets in `MoveAnim.update` and `LEG_POSES` in `viewmodels/legs.ts` |
| Hands and boots, volume | `FEEDBACK.bodyVolume` |
| Ramp stickiness | `snapMaxSeparation`, `snapDown` |
| Speed feel | `VIEW.fovSpeedAdd`, `fovSpeedFrom`, `fovSpeedFull`, `FEEDBACK.speedLinesFrom/Full` |
| Head motion | `VIEW.bobHeight`, `bobSide`, `dipOmega`, `dipZeta` |
| Footsteps | `strideBase`, `strideFromSpeed`, `FEEDBACK.footstepPitch` |

## The body in first person

`src/player/moveAnim.ts`, one `MoveAnim` owned by the Player and stepped at the end of its frame. It reads movement state
and never changes it. It holds plain numbers, so `moveAnim.test.ts` drives it with a fake player. Three consumers:
CameraRig adds `camRoll`, `camX`, `camY`. The viewmodel rig adds `gun*` to the weapon, gives the left arm to `hand*` by
`handW`, and poses the legs from `legs*` (docs/notes/viewmodels.md).

Rules that must stay true, each held by a test:

- **No pitch and no yaw, for any move.** Shots leave from the eye along the look, not from the camera, so a pitched camera
  is a crosshair that lies. The layer has roll and offsets only, and the offsets are clamped to `ANIM.maxOffset` (9 cm of
  parallel shift, less than the landing dip already there). The old pitch kick on a mantle is gone while the layer is on.
- **Every channel returns to exactly 0.** Weights fade with a snap at 0.001 and springs rest at 1e-4, so the level-view
  test still reads exactly 0 a second after any move.
- **A move can be cut at any moment.** Curves set targets and springs follow them, so a throw mid-mantle or a slam out
  of a wall jump never shows as a jump in a channel. Roll is clamped to `ANIM.maxRoll` (4.6 degrees) whatever stacks.
- **A working gun is left alone.** The rig scales the weapon part to a fifth while firing, reloading, swinging or drawing,
  and keeps the left hand on the weapon through a reload, a swing, akimbo and anything the off-hand is doing. The first
  shot counts too: it brings the gun out of the pose at once, and the muzzle the weapon system is given for it is already
  there (`settleMuzzle` in the rig), so the flash does not start from a dipped gun.
- **Its sounds go with it.** Hands and boots are played through `MovementFeedback.body`, which is silent while the layer
  is off. The vault's own `vault_over` stays, because the vault has its own switch.

| Move | Camera | Weapon | Left hand | Legs | Sound added |
|---|---|---|---|---|---|
| Mantle | Roll toward the hand through the climb, a dip and counter-roll at the top | Dips down and away, muzzle low | On the ledge, coming down the screen as the body rises, then pushes off | | `hand_plant`, `boot_scuff` at the top |
| Vault | Roll and a shift over the planted hand, a dip on arrival. Head path is the Player's | Carried high, canted outward | Planted on the cover, sweeping back along the bottom of the view | Swing through on the right | `hand_plant`, `vault_over`, `boot_scuff` |
| Wall run | The rig's own roll, plus a shift away from the wall | The rig's own cant | Trails on a wall to the left, riding the stride | | `hand_plant` (left wall) |
| Wall jump | Roll and shove away from the wall | Shoved, when the wall is on its side | Pushes off a wall to the left | | `boot_scuff` |
| Slide | 1.7 degrees of lean, a drop on entry | A little more cant | Touches the floor on the way down | Out in front | `hand_plant`, a tenth of a second in |
| Slide-jump | A lift | Pops up out of the cant | | | |
| Double jump | A lift | Tucks in | | | `gear_rustle` |
| Hard landing | Extra dip, scaled from 10 to 26 m/s | Drops and recovers slowly, scaled the same | | | `gear_rustle` |
| Dash | Roll into a side dash, none straight ahead | Lags the other way | | | |
| Slam | A dip on impact | Driven down in the fall | To the ground on impact | | `hand_plant` |
| Long fall, ledge drop | A dip for the missing step | Floats up with fall speed | | | `boot_scuff` off the edge |

Jump and sprint are unchanged: the rig's own jump kick and run pose already cover them. Footfalls on a wall are the
footsteps that were there.

Off-switches: `?moveanim=0` removes the layer and its hand and boot sounds, and puts the mantle's old pitch kick back.
`?movecam=0` keeps hands, weapon and legs and drops the camera part. `?legs=0` hides the legs. The lab panel has all three
as boxes. With `?moveanim=0&vault=0&movefix=0` the moves are the ones from before the parkour pass. There was no reduced
shake or camera motion setting to honour: `ANIM.camera` is the knob a settings entry would write, 0 to 1.

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

**Parkour pass** (2026-11-10), headless at 120 fps unless it says live:

| | Before | After |
|---|---|---|
| Jump pressed 1.4 m from 1.1 m cover at 12.5 m/s | A jump over it | Vault: 2.6 m in 0.208 s, no landing event |
| Ground covered in a vault, press 0.6 to 1.8 m out, at 12.5 and at 20 m/s | n/a | The entry speed in every frame. Live on the range: 12.5 m/s real for presses 0.7, 1.0 and 1.5 m out |
| The same before the path was made whole ticks at the entry speed | n/a | 8.3 m/s from 0.6 m out, 10.3 from 1.0, and 8.6 to 13.4 at an entry of 20 |
| Eye through that vault | n/a | Up 0.14 m, then down to 1.42 m above the floor. Fastest it moves is 4 cm in a 120 Hz frame, 4.7 m/s |
| Vault off cover on the edge of a 1.4 m deck: fastest the eye moves inside the vault | n/a | 1.6 cm a frame, level. Then an ordinary fall and a landing at 9.3 m/s. It was 21 cm in one frame |
| Cover with a wall 1.5 m behind it, press 0.6 m out | A jump | A 0.15 s vault at 12.5 m/s |
| Jump pressed again during a vault | n/a | A ground jump off the far side, double jump kept. It was a double jump with the feet on the floor |
| Jump pressed during a climb | Double jump spent as the climb ends | A jump off the top, double jump kept |
| First shot half way up a climb: muzzle against its place at rest, live, shotgun | n/a | 2 cm. It was 20 cm low and 7 cm left |
| Vault over a 1.2 m crate 2 m deep | A jump | Over it at the entry speed |
| Run into cover, no key | Stops | Stops (vaults with `vaultAuto`) |
| After a mantle: ticks in the air, feet drop | 6, 13 mm | The same. 0 and 0 with `mantleCarry` 0.57, which is off |
| Camera pitch off the look in a mantle, live | 2.1 degrees | 0.6, all of it the landing nod that follows |
| Camera pitch or yaw added by the body layer | n/a | 0 |
| Most roll from the body layer, live: vault, mantle | n/a | 3.3, 1.6 degrees |
| Wall run on a 2 km wall, and on 4 m panels | 1.43 s | 1.43 s |

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
- **`player.speed` during a mantle or a vault** keeps saying how fast the player was going, on purpose, so readouts and
  Overdrive do not blink to zero. In a mantle horizontal position does not change in that time (unless `mantleCarry` is
  set). In a vault the body really covers that speed, tick for tick, and a test measures it by position.
- **The campaign's cable gallery can be crossed without a wall run, and its tests do not see it.** Found here, not caused
  here. On `campaign/parkour.test.ts`'s own lane, 46 of its 238 jump-and-dash timings end on the far deck, 37 of them by
  catching the far lip, with the mantle carry and without it. The tests pass because `across` reads the first frame the
  body stands, and a body on the lip has its centre up to 0.25 m short of the edge. The mantle carry is how it showed:
  at 0.57 it puts the centre past the edge and turns two tests there and one in `outpost-map.test.ts` red, and at 0.25 it
  stands the body on the lip of the LZ cut before `onTop` thinks it has arrived. So the carry is off until those tests
  judge a crossing a moment later than the first standing frame. The 2 m face below the gallery's far deck is what gets
  caught: a deeper drop, or a far lip that cannot be climbed, would close the hole. Not owned here.
- **The body layer has not been played by a human.** Placement was judged from frozen stills, at a few frames a second
  on a busy machine, never in motion. Timing is the part to distrust: a vault at a run is 0.2 s, and the hand has to
  arrive, plant and leave inside it.
- **A vault takes the jump.** Within reach of cover no deeper than 2.6 m, a jump press while running at it is a vault, so
  jumping onto a crate needs a start further back, or `?vault=0`. Nothing has been played to say whether that is right.
- **A vault from close in lands further out.** The path is never shorter than `vaultMinTime` of running where there is
  room: 2.5 m at a run, 4 m at 20 m/s. That is where running would have put the body anyway, but the player has no
  steering for that fifth of a second. `vaultMinTime` 0 ends every vault as soon as the body is clear of the cover.
- **The longer path is checked with rays, not a swept body.** Between the cover and the end of an extended vault, `vaultEnd`
  walks rays 0.3 m apart for anything standing above the way down, then tests the end for overlap. Something narrower
  than that, off the centre line, can be passed through on the way down. `endVault` pushes the body out if it ends inside.
- **Vaulting is still on a key, not automatic.** Running into cover with no key stops, as before. The no-key version is
  `?vault=auto` or the lab box. See DESIGN section 13 and "Nothing happens by accident" above for why it is not the default.
- **The wall run change fixed nothing that could be measured.** A 2 km wall and a wall of butted 4 m panels both ran 1.43 s
  with and without it. It is there for casts that start in penetration, which Rapier may answer with nothing.
- **The right hand never leaves the weapon.** A wall on the right gets no trailing hand and a mantle is one-handed.
- **A vault goes through bodies.** `enemies/contact.ts` only names the mantle, but its nudge needs `state` to be ground,
  crouch or air, so a vault is never pushed off its path, and a solid body's hold-off only writes a velocity the vault
  ignores. Light bodies are still shoved aside by the run. Read from the code, not played.
- **No comfort entry in the settings menu.** `ANIM.camera` and the URL flags exist. `ui/settings.ts` is not owned here.
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
npx vitest run src/player/movement.test.ts                         # one file at a time on this machine. Also moveMath, park, vault, moveAnim
node tools/shot.mjs --url "/?map=range" --script tools/scripts/parkour-live.mjs --dpr 2 --w 1440 --h 900 --wait 500 --timeout 280 --out tools/out/parkour/pk.png
                                                                    # every move on the range's strip, frozen mid-move. PK_WEAPON, PK_ONLY, PK_SHOTS=0
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
