# 05. Player: input, movement, camera, health, perks, killstreaks

Source: `index.html` lines 5157-6936 (`InputManager`, `Player`), plus everything those classes touch elsewhere in the file. All line numbers refer to `index.html`.

**Evidence labels.** Numbers marked **[measured]** came from running the verbatim `InputManager` and `Player` source in Node against stubbed `THREE`/DOM/audio and a virtual clock, at a fixed timestep (60 fps unless stated). The call-in tests also ran the real `canShoot` and the real `updateGame` shooting branch. Everything else is from reading the code. Nothing here was played in a real browser, so anything that depends on browser behaviour says so.

`fps-game.html` (older version): movement, physics and collision code is identical, with the same constants. The only deleted line in its `Player` is a comment. It has no airstrike or warthog. `index.html` is a strict superset, so nothing is lost by ignoring the old file.

---

## 1. Key findings

1. **Ground speed is low, and air speed is 3.35x higher.** Sprint tops out at 13.6 u/s on the ground and 45.6 u/s in the air. Both come from the same thrust; only the drag differs (0.85 vs 0.95 per frame). This is the whole reason bunny-hopping feels good. See section 5.
2. **`maxSpeed = 30` does not cap movement.** It only caps the slide's starting velocity. Nothing caps air speed.
3. **The slide is broken.** It ends on its second frame. Pressing crouch drops `height` to 0.9, which makes the player "airborne", and "airborne without Space held" is a slide-end condition. What players feel is a 22 u/s burst that decays through air drag. See section 7.
4. **The 1.8x air-to-slide bonus can never fire.** `justLanded` is always false. **[measured: 0 hits]**
5. **Call-in targeting lasts one frame.** One click both starts targeting and fires the strike. The preview ring and corridor are effectively never seen. See section 14.
6. **Aiming above the horizon sends the strike to world origin (0,0,0).**
7. **The airstrike finisher kills the player anywhere within 20 u.** The preview ring shows 12 u.
8. **Shell explosions with no living enemies throw a `TypeError`.** `onWaveComplete()` is called but does not exist.
9. **The perk ladder is the best system here.** At 2 kills/s a streak chains 5 rewards in 7 seconds. See section 12.

---

## 2. Input (`InputManager`, 5157-5244)

State: `keys[e.code]` booleans, and `mouse {deltaX, deltaY, leftButton, rightButton}`.

| Action | Binding | Handler | Notes |
|---|---|---|---|
| Move | W A S D | `isKeyPressed` polled | Normalised, so diagonals give no bonus. **[measured: W+A sprint 13.60]** |
| Sprint | `ShiftLeft` only | polled | ShiftRight does nothing. No stamina. Works in every direction and in the air |
| Crouch/slide | `KeyC` hold | polled | **Not listed anywhere in the UI** (menu or guide) |
| Jump | `Space` | polled | Also restarts on game over (7374) |
| Fire / alt | LMB / RMB | polled | `contextmenu` suppressed |
| Reload | R | `handleKeyDown` 7365 | Inner `PAUSED` branch is unreachable, so "Press R to restart" on the pause screen does nothing |
| Weapons | 1 SMG, 2 shotgun, 3 rocket, 4 autocannon, 5 sword | 7385-7413 | Only in `PLAYING` |
| Airstrike | X | 7405 | Silent no-op unless `airstrikeAvailable` |
| Warthog | Z | 7415 | Silent no-op unless `warthogStrikeAvailable` |
| Pause | Esc | 7362 | See note below |
| Debug | F = FPS, G = debug text | 7379-7384 | Debug shows position, health, velocity |

Mouse look: `rotation.y -= dx * 0.002`, `rotation.x -= dy * 0.002`, pitch clamped to exactly +/-pi/2. No smoothing, no sensitivity setting, and no scaling while zoomed.

Problems:

- **`mousemove` assigns the delta instead of accumulating it** (5179). If two events arrive between frames, the first is lost. Browser event coalescing may hide this; not tested.
- **`handleMouseLook` resets the delta at the top of the frame**, and `weaponSystem.update` reads it later in the same frame, so it always sees zero. Weapon sway (4039-4048) and sword directional input (8095-8101) are therefore dead.
- `keys` is never cleared on blur or pointer-lock loss, so keys can stick.
- `pointerlockchange` only sets a flag. Losing the lock does not pause the game: `handleMovement` and `handleMouseLook` return early while physics and enemies keep running. Whether Esc reaches `keydown` while pointer-locked depends on the browser; not tested. Clicking re-acquires the lock (8715-8729).

---

## 3. Frame order

`animate()`: `deltaTime = clock delta`, clamped to `min(dt, 0.1)`. Then `updateGame(dt)`:

```
timeScale read; scaledDt = dt * timeScale
player.update(dt):                 // real time, never scaled
  wasInAir = !isGrounded
  handleMouseLook -> handleMovement -> handlePhysics -> handleCollisions
  handleHealthRegen -> updateCamera -> handleFootsteps
perk updates (BT, Hellfire, Adrenaline, Berserk, Slowmo)
targeting visuals -> death check
weaponSystem.update(scaledDt)
LMB branch: callAirstrike | callWarthogStrike | weaponSystem.shoot
bullets(scaledDt) -> enemies(scaledDt) -> enemy bullets(scaledDt)
pickups(dt) -> waves(scaledDt) -> particles(scaledDt)
```

Consequences:

- `isGrounded` in `handleMovement` is last frame's value. Friction in `handlePhysics` uses whatever `handleMovement` left, so a jump on the frame after landing skips ground friction completely (section 6).
- Integration is semi-implicit Euler: velocity changes first, then `position += v * dt`.
- `position` is the **eye point**, not the feet. `height` is eye height above the y=0 plane. There is no separate body.

---

## 4. Movement constants

| Field | Value | Actual meaning |
|---|---|---|
| `speed` | 8 | **Not a speed.** Thrust = `speed * 10` u/s^2 |
| `sprintMultiplier` | 1.8 | Multiplies thrust. Ignored while crouched |
| crouch multiplier | 0.4 | Hard-coded, 5605 |
| `jumpForce` | 8 | `velocity.y` set directly |
| `gravity` | -25 | Applied every frame, including when grounded |
| `friction` | 0.85 | Per 1/60 s: `v *= 0.85^(dt*60)` |
| `airFriction` | 0.95 | Same form. Applies to x and z only |
| `standingHeight` / `crouchHeight` | 1.8 / 0.9 | Eye height |
| player radius | 0.5 | Local constant in collision |
| `slideSpeed` | 15 | Minimum slide base speed |
| `slideMinSpeed` | 2 | End threshold, after 0.5 s |
| `slideHopWindow` | 0.3 s | Chain window |
| `maxSpeed` | 30 | Slide start cap only |
| `baseFOV` | 75 | |
| start position | (0, 2, 0) | Falls 0.2 u and plays the land sound at startup |

Per-frame movement (5586-5612, 5694-5711):

```
dir = normalize(WASD)                       // velocity untouched if no key
S = speed                                   // 8
if adrenaline: S = 7.5 * (1 + 0.1*stacks)   // replaces 8, does not multiply it
if berserk:    S *= 1.15
if sprinting:  S *= 1.8   else if crouching: S *= 0.4
v.xz += dir * S * dt * 10                   // SAME thrust on ground and in air
v.y  += -25 * dt
v.xz *= (grounded ? 0.85 : 0.95) ^ (dt*60)  // skipped while sliding
position += v * dt
```

There is no acceleration cap, no wish-direction projection and no Quake-style strafe gain. Air control equals ground control. Speed is thrust against drag:

`v_max = f * (S*10*dt) / (1 - f)`, where `f` is the per-frame drag. At 60 fps that is `0.944*S` on the ground and `3.167*S` in the air.

### Measured speeds, 60 fps

| State | Thrust u/s^2 | Drag | Top speed u/s | Time to cross arena (97 u) |
|---|---|---|---|---|
| Crouch walk, ground | 32 | 0.85 | 3.02 | 32 s |
| Walk, ground | 80 | 0.85 | **7.56** | 12.8 s |
| Sprint, ground | 144 | 0.85 | **13.60** | 7.1 s |
| Crouch, air | 32 | 0.95 | 10.1 (computed) | n/a |
| Walk, air (hop chain) | 80 | 0.95 | **25.33** | 3.8 s |
| Sprint, air (hop chain) | 144 | 0.95 | **45.60** | 2.1 s |

Base enemy speed is 2 to 3 u/s (2059-2061), for scale.

Time to 90% of top speed on the ground: 0.25 s. Stopping to 10%: 0.25 s. Both are the same at walk and sprint, because the time constant comes only from friction. **[measured]**

### With perks, 60 fps [measured]

| Perk state | Walk | Sprint | Hop-chain peak |
|---|---|---|---|
| None | 7.56 | 13.60 | 45.60 |
| Adrenaline x1 | 7.79 | 14.02 | not run |
| Adrenaline x2 | 8.50 | 15.30 | not run |
| Adrenaline x3 | 9.21 | 16.57 | 55.57 |
| Berserk | 8.69 | 15.64 | 52.44 |
| Adrenaline x3 + Berserk | 10.59 | 19.06 | 63.91 |

Adrenaline's base is 7.5 while `speed` is 8, so the advertised +10% at x1 is really +3.1%, x2 is +12.5%, and x3 is +21.9%.

### Frame-rate dependence [measured]

| FPS | Walk | Sprint | Hop-chain sprint | Real slide duration | Real slide distance |
|---|---|---|---|---|---|
| 30 | 6.94 | 12.50 | 44.4 | 1.43 s | 16.97 u |
| 60 | 7.56 | 13.60 | 45.6 | 1.05 s | 11.50 u |
| 120 | 7.88 | 14.18 | not run | not run | not run |
| 144 | 7.93 | 14.27 | 46.3 | 0.63 s | 6.30 u |
| 240 | 8.04 | 14.47 | 46.5 | 0.50 s | 4.19 u |

The ground and air drift comes from integration order. The slide problem is much worse: its friction (`*= 0.98` etc.) and steering have no `dt` at all, so a real slide at 240 fps lasts half as long and covers 36% of the distance. FOV lerp and roll decay are also per-frame.

---

## 5. What limits speed

This answers the "decent if you bunny-hop, should be faster paced" feedback.

### The limits, in order of impact

1. **Ground friction, 0.85 per frame.** Removes 15% of velocity per frame, and it is the main cap. Sprint settles at 13.6 u/s, 3.35x below the same thrust in air. That ratio is entirely `(1-0.85)/(1-0.95) * (0.95/0.85)`.
2. **Ground thrust.** `speed = 8` and `sprintMultiplier = 1.8` give 144 u/s^2. Ground top speed is linear in both.
3. **The slide does not work.** The one mechanic built to raise ground speed lasts a frame, and holding C afterwards drops you to 3.02 u/s. Sprint then C-hold covers 7.6 u in 0.8 s; plain sprint covers 10.9 u. **[measured]** Sliding is currently slower than not sliding.
4. **Air drag, 0.95 per frame.** This is the real global ceiling (45.6 u/s) and it means **there is no momentum.** Speed is held up only by holding W. Release W after a jump and speed falls from 45.6 to 6.8 u/s by landing, covering 12.3 u. **[measured]** It feels like thrust, not inertia.
5. **Manual jump.** Holding Space jumps once only (`canJump` needs a release). **[measured: 1 jump in 5 s]** The chain has to be played by hand.
6. **Walls.** Contact zeroes the velocity component along the push axis instantly. The arena is about 97 u across, or 2.1 s at hop speed, so hitting walls is the practical limit at high speed.
7. **`maxSpeed = 30` is not a limit** on normal, air or hop movement. It appears only at slide start and in FOV/tilt ratios. Do not treat 30 as the design ceiling.

### Perception limits

Speed is also under-communicated, which makes the game feel slower than the numbers say. At 45 u/s the view is identical to walking:

- FOV changes only on slide start, slide end and slide-hop. There is no FOV response to velocity or sprint.
- No head bob, landing dip, speed lines, wind audio or viewmodel response. Nothing outside `Player` reads `isMoving`, `isSprinting` or `velocity`, except the debug readout.

### How bunny-hopping behaves [measured]

| Pattern (W+Shift, 60 fps, 10 s) | Average | Peak | Minimum |
|---|---|---|---|
| Sprint only | 13.60 | 13.60 | 13.60 |
| Hop, buffered (0 ground frames) | 44.59 | 45.60 | 45.54 |
| Hop, 1 ground frame (17 ms) | 42.27 | 44.82 | 40.13 |
| Hop, 3 ground frames (50 ms) | 38.73 | 43.67 | 32.06 |
| Hop, 6 ground frames (100 ms) | 35.13 | 42.60 | 24.54 |
| Hop, 12 ground frames (200 ms) | 31.17 | 41.61 | 17.58 |
| Hop, 30 ground frames (500 ms) | 25.61 | 41.07 | 13.81 |
| Walk hop, buffered | 24.77 | 25.33 | 25.30 |

- **One jump from a sprint reaches 41 u/s by landing.** The gain comes from time airborne, not chaining skill. Even a lazy hop with half a second on the ground doubles sprint speed.
- A late hop costs little on the next landing: 12 extra ground frames take you from 45.6 to 41.7.
- The peak is the same whichever direction you hold; there is no strafe mechanic to learn. W alone is optimal.
- Turning is forgiving. Snapping 90 degrees at 45.6 u/s: heading reaches 40 degrees in 0.2 s and 75 degrees in 0.5 s, with speed dipping to about 32. **[measured]**

### Knobs (reference, sprint at 60 fps)

| `friction` | 0.85 | 0.88 | 0.90 | 0.92 | 0.95 |
|---|---|---|---|---|---|
| Ground top speed | 13.6 | 17.6 | 21.6 | 27.6 | 45.6 |

Raising `speed` scales ground and air together (`speed = 12` gives 20.4 ground and 68.4 air), so the 3.35x gap remains. Changing ground friction alone is what narrows it.

---

## 6. Jump

| Property | Value |
|---|---|
| Launch | `velocity.y = 8`, requires `isGrounded && canJump` |
| Air time | 0.633 s at 60 fps **[measured]** (0.64 analytic) |
| Eye rise | 1.21 u at 60 fps, 1.15 at 30, 1.26 at 240 **[measured]** (1.28 analytic) |
| Sound | `player_jump` |
| Double jump, coyote time | None. There are no ledges anyway; the only floor is y=0 |

`canJump` becomes true on any frame Space is up (5662). That creates an accidental jump buffer:

1. Press Space on the ground: jump, `canJump = false`.
2. Release Space at any time in the air: `canJump = true`.
3. Press and hold Space before landing, at any point, with no timing window.
4. Frame L: touchdown, `isGrounded = true` at the end of the frame. That frame's physics used air drag.
5. Frame L+1: `handleMovement` jumps and sets `isGrounded = false` before `handlePhysics` runs, so air drag applies again.

**A buffered hop therefore takes zero ground-friction frames**, which is why chains sustain the full 45.6 u/s. Keep this if the sequel retains hopping. `player_land` and `player_jump` both fire every hop, 1 frame apart.

Jumping while crouched snaps to standing. If C is still held, crouch re-applies the next frame and air thrust becomes 0.4x.

---

## 7. Crouch and slide

### Crouch

- Hold `KeyC`. Sprint is disabled while crouching. Thrust is 0.4x.
- **Going down:** `height` drops 1.8 to 0.9 instantly, but the eye stays at 1.8, so the player falls under gravity for about 15 frames (0.27 s). This looks smooth by accident. During the fall `isGrounded` is **false**, so there is no jump, no footsteps, and air drag applies.
- **Going up:** the eye snaps from 0.9 to 1.8 in one frame. The comment at 5418 says "smoothly"; there is no smoothing either way.
- No ceiling check (there are no ceilings).

### Slide as designed

Entry, only when not already sliding:

| Entry | Condition | Multiplier | Status |
|---|---|---|---|
| Air to slide | `justLanded && isCrouching` | 1.8 | **Dead code** |
| Sprint to slide | Was sprinting, C just pressed, grounded | 1.5 | Works |
| Walk to slide | Was not sprinting, C just pressed, grounded, `isMoving` | 1.3 | Works |

Chain bonus when `now - lastSlideEndTime < 0.3 s`: `slideChainCount++`. Counts 1-2 give x1.1. Count 3 and up sets `inFlowState = true` and gives x1.2. Otherwise chain and flow reset.

Speed: `max(15, currentSpeed) * entry * chain`, direction = current velocity, capped at 30. Below 1 u/s the direction is `forward`, which is a bug (see below). Designed entries: walk 19.5, sprint 22.5; with chain 21.45 / 24.75; in flow 23.4 / 27.0.

Slide physics (per frame, no `dt`):

| `slideTimer` | Friction | Note |
|---|---|---|
| under 0.5 s | 0.98 | |
| 0.5 to 1.0 s | 0.95 | |
| over 1.0 s | 0.90 | |

Steering: `slideVelocity += dir * (0.1 + 0.1 * speed/30)` per frame.

End conditions: (speed < 2 and timer > 0.5) or C released or (not grounded and Space not held). On C release, normal velocity becomes `slideVelocity * 0.5`, so **releasing crouch halves your speed.**

Slide-hop: Space during a slide keeps `slideVelocity * p`, where `p` depends on `slideTimer/1.5`: 0.5 by default, 0.7 at 0.6 and up (0.9 s), 0.9 at 0.8 and up (1.2 s). Sets `targetFOV = 80`.

### Slide as it actually runs

The chain of failure:

1. Frame 0: C pressed, `height = 0.9`, slide starts. `isGrounded` is still true, so the end check passes. `velocity = slideVelocity`.
2. End of frame 0: `handleCollisions` sees `1.79 > 0.9` and sets `isGrounded = false`.
3. Frame 1: `!isGrounded && !Space` is true, so the slide ends. C is still held, so the velocity transfer is skipped and `velocity` keeps its value.
4. Player glides with air drag for 15 frames until touchdown at y=0.9, then ground friction and 0.4x thrust take over.

**[measured]** Trace, sprint at 13.6 then hold C, 60 fps:

| Frame | Sliding | Grounded | Eye y | Speed | Target FOV | Current FOV |
|---|---|---|---|---|---|---|
| 0 | yes | no | 1.793 | 22.05 | 86.25 | 76.13 |
| 1 | **no** | no | 1.779 | 20.95 | 75 | 76.01 |
| 4 | no | no | 1.696 | 19.41 | 75 | 75.74 |
| 8 | no | no | 1.488 | 17.69 | 75 | 75.48 |
| 12 | no | no | 1.168 | 16.28 | 75 | 75.32 |
| 15 | no | yes | 0.900 | 15.41 | 75 | 75.23 |

So the current "slide" is about 0.27 s at 15 to 22 u/s, then about 0.5 s of braking down to 3 u/s. It plays `slide_ground`, then `player_land` at touchdown. FOV peaks at only +1.13 degrees, and roll is a single snap (section 9).

A +60% speed spike for a quarter of a second behaves like a short dash. It is possible that this accident, not the slide as written, is the part players like; that is a guess worth testing when tuning the sequel.

**The real slide can be reached by accident.** Holding Space through the first 0.27 s avoids the end condition. Jump, keep holding Space through landing (so `canJump` stays false), then press C. **[measured]** This gives the designed slide: 1.05 s and 11.5 u with W released, with FOV reaching 86.15. Speed samples: 19.5 at 0.1 s, 16.3 at 0.25 s, 11.7 at 0.5 s, 5.7 at 0.75 s, 2.5 at 1.0 s.

**Slide-hop timing is inverted.** Later hops get a bigger percentage of a much smaller speed. **[measured]** with 22.5 entry:

| Hop at | Slide speed | Tier | Speed after hop |
|---|---|---|---|
| 0.3 s | 15.64 | 0.5 | 7.28 |
| 0.5 s | 11.66 | 0.5 | 5.26 |
| 0.7 s | 6.63 | 0.5 | 2.99 |
| 0.9 s | 3.58 | 0.7 | 2.26 |
| 1.0 s | 2.50 | 0.7 | 1.49 |

The 0.9 "perfect" tier needs 1.2 s. At 60 fps the slide lasts 1.05 s with no input and 1.22 s with W held **[measured]**, so "perfect" is unreachable or lands at about 2 u/s. **Every slide-hop loses to a plain jump, which keeps 100%.** Same-frame C+Space turns 13.6 into 10.56.

**C-tap exploit.** Releasing C snaps to standing and re-grounds immediately, so re-pressing starts another slide at `max(15, v) * 1.5 * chain`. **[measured]**, sprint held, 5 s:

| Tap pattern | Rate | Average | Peak |
|---|---|---|---|
| 2 frames down, 2 up | 15 Hz | 28.08 | 29.40 |
| 3 down, 3 up | 10 Hz | 26.90 | 29.40 |
| 4 down, 8 up | 5 Hz | 23.44 | 29.40 |
| 6 down, 12 up | 3.3 Hz | 20.31 | 27.04 |

So tapping C about 3 times a second beats sprint by 50% with no jumping. It also spams `slide_ground` and `player_land` (about 17 plays each in that 5 s). It is the only way to reach the 30 cap on the ground, and the only reliable way into `inFlowState`.

**Standing slide goes backward.** The local `forward` is `(sin yaw, 0, cos yaw)`, which points **behind** the camera. Movement code compensates with `moveVector.sub(forward)`, but the stationary branch (5472-5476) uses it directly. Shift+C from rest launches you backward at 22 u/s. **[measured: vz = +22.05 at yaw 0]**

---

## 8. Collision

Ground (5718): infinite plane. If `position.y <= height`: clamp, and if `v.y < 0` zero it and ground the player. Otherwise `isGrounded = false`. No fall damage.

Obstacles (5736-5763): for each of 24 objects (4 walls, 5 blocks, 10 crates, 5 pillars), build a `Box3` from the mesh, expand by 0.5 on all axes, and test whether the **eye point** is inside. If it is, push out along the axis with the larger `|d/size|` and zero that velocity component. The other component is kept, so walls slide. **[measured: 20,-20 into a wall becomes 14.45, 0 next frame, with drag]**

Arena (7583-7670):

| Object | Layout |
|---|---|
| Walls | At +/-50, 2 thick, 5 high |
| Blocks | (20,2,-20) 4x4x15; (-25,2,10) 8x4x4; (15,2,25) 6x4x6; (-10,2,-30) 12x4x4; (30,1.5,0) 4x3x8 |
| Crates | 10, size random 1 to 2.5, random position in +/-40, random Y rotation |
| Pillars | 5, cylinder radius 1 to 1.5, 8 high, random in +/-30 |

Quirks:

- **Crates under 1.3 can be walked through while standing.** Box top is `size + 0.5` and the eye is at 1.8. **[measured]** That is about 20% of crates (uniform 1 to 2.5).
- Standing on anything is impossible. There is no top collision. Dropping onto a crate shoves you sideways to the nearest face in one frame.
- Peak eye height is 3.01, which clears any crate at the very top of a jump (top up to 3.0), but not blocks (3.5 or 4.5).
- Rotated crates and cylinders collide as axis-aligned boxes, so they are larger than they look.
- Single-step test, no sweep. At the 0.1 s dt clamp, tunnelling through a wall occurred on 22 of 50 start offsets (grounded test); none at 20 fps or above. **[measured]** A long frame at hop speed is the risk.
- 24 `Box3` plus 2 `Vector3` allocated per frame.

---

## 9. Camera

| Feature | Behaviour |
|---|---|
| Rotation order | `YXZ` |
| Position | Copied from `position` every frame, no offset |
| FOV (base 75) | Lerp `cur += (target-cur)*0.1` per frame, no `dt`. 90% in about 22 frames at 60 fps. Writes `camera.fov` only when `|cur-target| > 0.1` |
| FOV on slide start | `target = 75 + 15 * (slideSpeed/30)`, computed once. +15 maximum |
| FOV on slide end | `target = 75` |
| FOV on slide-hop | `target = 80`, comment says "briefly" but **nothing resets it** until the next slide ends. **[measured: still 79.91 five seconds later]** |
| Roll during slide | `sin(now*0.003) * (speed/30) * 0.1`: a 2.09 s wobble, up to 0.1 rad. Not a lean into the turn |
| Roll after slide | `rotation.z *= 0.9` per frame |
| Head bob | **None** |
| Landing dip | **None** |
| Sprint FOV | **None** |
| Weapon bob | **None** |
| Wall run, wall jump, dash, mantle | **None.** Grep confirms no such code. The only `bob` in the file is pickups |

In the broken slide, roll is set for one frame from an arbitrary sine phase, up to +/-0.0735 rad (4.2 degrees) at 22 u/s, then decays. Players get a random-direction camera jolt.

Interactions:

- Screen shake (4055-4075, weapon system): `+/- intensity/2` radians on pitch and roll for 50 ms. `addScreenShake` **overwrites** rather than adds, so a small shake can replace a big one. It undoes itself with a 16 ms `setTimeout` on a value `updateCamera` already overwrites, so pitch can get a tiny reverse kick; roll keeps a small residue that decays.
- Autocannon zoom writes `camera.fov = 30` directly. `Player.updateCamera` overwrites it whenever its own FOV is still moving, so a slide during zoom breaks zoom. Unzoom sets FOV to 75 even if the player's target is 80.

---

## 10. Footsteps, movement audio

`AudioManager.volume = 0.5` multiplies every defined volume. Each sound has 4 `Audio` instances, round-robin.

| Event | Sound | Defined | Effective |
|---|---|---|---|
| Footstep | `player_footstep1/2/3`, random | 0.2 | 0.10 |
| Jump | `player_jump` | 0.3 | 0.15 |
| Land | `player_land` | 0.3 | 0.15 |
| Slide start | `slide_ground` (never stopped) | 0.5 | 0.25 |
| Player hit | `playerHit` (`enemy_hit.mp3`) | 0.6 | 0.30 |

Footsteps: `isMoving && isGrounded && !isSliding`, at intervals of 0.5 s walk, 0.35 s sprint, 0.7 s crouch. Time-based, not distance-based. `isMoving` means a key is held, so running into a wall still plays steps. Sprint interval applies regardless of actual speed. `footstepInterval` is unused.

---

## 11. Health and damage

| Property | Value |
|---|---|
| Max health | 100 |
| Regen | 5 HP/s after 3 s without damage. Linear up to max |
| Full heal from 1 HP | 22.8 s total **[measured]** (first tick at 3.0 s) |
| Health pickup | +30 (8597), pickup radius 2 u from eye |
| Berserk | `takeDamage` returns immediately: no flash, no sound, no regen reset |

On hit (`takeDamage`, 5775): health reduced, `lastDamageTime` set, bar updated, flash, `playerHit`.

- Flash: `#damageFlash`, `radial-gradient(circle, transparent 30%, rgba(255,0,0,0.3) 100%)`, z-index 98. Opacity set to 1, then 0 after 200 ms, with `transition: opacity 0.1s ease`. Overlapping hits are not cancelled, so an earlier timer can cut a later flash short.
- Bar: 200x20 px at bottom-left (30, 30), `linear-gradient(90deg, #ff0000, #ffff00, #00ff00)` with `transition: width 0.3s ease`. Text is `Math.ceil(health)`. The gradient stretches with the bar, so low health is not recoloured.
- No hit direction indicator. No camera kick.

Self-damage comes through `handleRocketExplosion` (7896-7904): `damage * falloff * 0.5`, where `falloff = 1 - (d/r)*0.5`. Applies to player rockets, Hellfire bullets (2 u), airstrike rockets, and enemy rockets. Shell explosions do not hurt the player.

Regen, perk timers and cooldowns use `performance.now()`, so they run during pause.

---

## 12. Perks and killstreaks: overview

**The ladder.** Every kill calls `registerKill()`. This is the system's best feature: rewards escalate, each makes the next easier (Blood Thirst's 2x damage and bottomless ammo feed Hellfire and Berserk), and each has its own audio and HUD. **[measured]** At 1 kill per 0.5 s:

| Kill | Time | Unlocks |
|---|---|---|
| 4 | 1.5 s | Blood Thirst |
| 8 | 3.5 s | Airstrike ready |
| 10 | 4.5 s | Hellfire |
| 12 | 5.5 s | Warthog ready |
| 15 | 7.0 s | Berserk (combo resets to 0) |

All perks use independent flags, so all can run at once. Check order inside one kill: Airstrike, Warthog, Berserk, Blood Thirst, Hellfire.

**Counters:**

| Counter | Used by | Rule |
|---|---|---|
| `comboKillCount` | Airstrike, Warthog, Berserk | Gap-based: next kill within 5 s of the previous (`<=`), else reset to 1 |
| `killTimes` | Blood Thirst, Hellfire | Sliding window, pruned to 10 s, **not cleared on activation** |
| `swordKillTimes` | Adrenaline | Sliding 3 s, cleared on activation |
| `headshotTimes` | Slowmo | Sliding 3 s, cleared on activation |

Kill sources: bullets (8421), shell blast (7767), shell headshot (8287), rocket blast (7881), sword (4629, 4755, 4945). Sword kills also call `registerSwordKill`. Enemy rockets go through the same blast code, so an enemy killed by another enemy's rocket counts as your kill.

Because `killTimes` is not cleared, a perk re-arms on the first kill after it expires, if enough recent kills exist. At 0.8 s per kill Blood Thirst fired at 2.4, 12.8 and 23.2 s **[measured]**: about 96% uptime. Sustained killing keeps you in the buff.

| Perk | Trigger | Duration | Refresh while active | HUD |
|---|---|---|---|---|
| Blood Thirst | 4 kills in 5 s | 10 s | No | top 80, `#ff0000` |
| Hellfire | 10 kills in 10 s | 5 s | No | top 110, `#ff6600` |
| Adrenaline | 3 sword kills in 3 s | 5 s | Yes, stacks to 3 | top 140, `#00ff00` |
| Berserk | 15 combo | 10 s | No | top 140, `#ff0000` |
| Slowmo | 3 headshots in 3 s | 5 s | No | top 170, `#00ffff` |

Perk timers all use `performance.now()`, so durations are real time even during Slowmo.

---

## 13. Individual perks

Perk HUD labels are centred, bold, `z-index: 1000`, created lazily and reused. Each shows a live timer from the frame after activation.

### Blood Thirst

- **Activation:** `perkBloodthirsty` (eff. 0.35). Label `BLOOD THIRST`, then `BLOOD THIRST [9.9s]`. 24px, `text-shadow: 2px 2px 4px rgba(0,0,0,0.8), 0 0 20px rgba(255,0,0,0.5)`, `pulse 0.5s ease-in-out infinite alternate` (scale 1 to 1.1).
- All magazines filled instantly, including `walkieTalkie` and `warthogStrike` (harmless, since X/Z check the availability flags).
- `getDamageMultiplier()` = 2.0, applied to bullets (4320) and sword (4740, 4909). **Not** applied to airstrike or warthog.
- Bottomless magazine: `canShoot` skips the ammo check, `shoot` skips the decrement. HUD shows the infinity symbol for ammo and reserve.
- Shotgun pellets 6 to 12.
- Layers `bloodthirstyShot` (eff. 0.5) on every shot.

### Hellfire

- **Activation:** `perkHellfire` (eff. 0.4). Label `HELLFIRE [x.xs]`. 24px, `fireFlicker 0.3s alternate` (scale 1 to 1.05, brightness 1 to 1.3), shadow `rgba(255,165,0,0.7)`.
- **Bullets** (SMG, shotgun pellets): `isRocket = true`, `blastRadius = 2`, `isHellfireBullet = true`, damage x1.25. Each impact: `hellfireBulletExplode` (eff. 0.25), 12 particles `#ff6600` + 8 `#ffaa00`, shake 0.06. No shockwave.
- **Rockets:** radius 8 x 2.5 = 20, `isHellfireRocket = true`, **instakill everything in radius.** `rocketExplosion` + `hellfireRocketExplode` (eff. 0.7) layered. Particles 120 `#ffff00`, 100 `#ffaa00`, 80 `#ff6600`, 60 `#ff0000` (360 total, the `isHellfire` set: 2.5x size, 1.8x speed, 1.5x life). Hellfire shockwave (max size 60, 200 u/s, 0.15 s). Shake 0.24 for 100 ms.
- Layers `hellfireShot` (eff. 0.3) per shot. Autocannon and sword unaffected.
- **Hellfire bullets are weaker on direct hits than normal bullets.** They take the rocket branch (8321), so they skip direct damage and the headshot path. Damage comes from a 2 u blast measured to `enemy.position`, which is at ground level. A torso hit about 1.5 u from the feet gets `falloff = 0.625`, so an SMG round deals about 25 x 1.25 x 0.625 = 19.5 instead of 25, and high hits on large enemies may be out of radius and deal nothing. (From reading, not run.) Hellfire also blocks Slowmo progress on those weapons, because no headshot can register.

### Adrenaline

- **Activation:** `perkAdrenaline` (eff. 0.35), on first activation and each new stack. No sound at max stacks.
- Only effect: move speed (section 4). Label `ADRENALINE`, then `ADRENALINE x2 [4.5s]`. 24px, `speedPulse 0.3s alternate` (scale 1 to 1.05, rotate -2 to 2 degrees).
- **Stacking [measured]:** kills 3, 6, 9 give stacks 1, 2, 3. Each trigger resets the timer to 5 s; it does not add. All stacks fall together at expiry.

### Berserk

- **Activation:** `perkBerserk1`, `2`, `3` all at once (eff. 0.4, 0.6, 0.4). Label `BERSERK ACTIVATED!`, 32px, `text-shadow: 0 0 10px #ff0000, 0 0 20px #ff0000`, pulsing.
- Invulnerable. Move speed x1.15.
- SMG interval x0.75 (0.05 to 0.0375 s). Rocket interval x0.5 (0.5 to 0.25 s), which only matters with Blood Thirst because the rocket magazine holds 1.
- Shotgun pellets 18 (36 with Blood Thirst).
- Akimbo SMG: left model and left muzzle flash only. **It fires no extra bullets.**
- Layers `berserkShot` (eff. 0.35) per shot.
- Combo resets to 0 on start and on end. **Ending Berserk wipes any combo built during it.**

### Slowmo

- **Trigger:** any headshot **hit**, not kill. Counted in bullet and shell paths only (8259, 8357). Sword and rockets cannot trigger it.
- **Activation:** `timeScale = 0.25`, `perkSlowmo` (eff. 0.4), global SFX rate 0.25. Label `SLOWMO ACTIVATED!`, then `SLOWMO [4.9s]`. 24px, shadow `0 0 10px #00ffff`, no animation.
- Hard cut in and out. No easing, FOV change or colour treatment. Takes effect next frame, since `timeScale` is read at the top of `updateGame`.
- Music is unaffected (`SoundtrackManager` is separate).

| System | During Slowmo |
|---|---|
| Player movement, look, regen | **Full speed** |
| Perk and cooldown timers | Real time |
| Player fire rate, reload, sword timing | Real time (`performance.now`) |
| Player and enemy bullets | 25% (a bullet at 100 u/s moves 25 u/s; hopping at 45 outruns your own bullets) |
| Enemy movement | 25% |
| **Enemy ranged fire cadence** | **Real time** (`performance.now`, 2353): enemies keep shooting at full rate |
| **Enemy spawn timing** | **Real time.** `waveSystem.update` ignores its `dt` and uses `performance.now` |
| Particles, smoke | 25% |
| Screen shake duration | 4x longer (scaled `dt`) |
| Pickups and pickup spawns | Real time |
| Call-in `setTimeout` steps | Real time, so rockets pile up mid-air as they fall at 25% |

**Bug:** `play()` exempts `perk_slowmo` from the rate change, but `activateSlowmo` calls `setGlobalPlaybackRate(0.25)` right after, which rewrites every instance including that one. The stinger plays at 0.25. Browsers default `preservesPitch` to true, so SFX likely stretch rather than drop in pitch; not tested.

---

## 14. Airstrike

### Unlock

Combo reaches 8, `airstrikeAvailable` false, cooldown over. `comboKillCount` is not consumed, so 12 and 15 remain reachable. If cooldown is running, the next kill after it ends unlocks.

Stack at unlock:

1. `airstrikeAvailable = true`, `perkAirstrike` (eff. 0.4).
2. Popup `AIRSTRIKE READY!`: 28px bold `#ff6600`, top 200, `text-shadow: 0 0 10px #ff6600, 0 0 20px #ff3300`, `fadeInOut 3s ease-out` (0% opacity 0 scale 0.8; 20% opacity 1 scale 1.1; 40% scale 1; 100% opacity 0). Removed at 3 s.
3. `walkieTalkie.currentAmmo = 1`.
4. HUD chip above the health bar: `AIRSTRIKE [X]`, 14px bold `#ff6600`, `rgba(0,0,0,0.7)` background, 1px `#ff6600` border, radius 5px, bottom 60, left 30 (or 150 if the warthog chip is showing).

### Calling it in: intended vs actual

Intended: press X to equip the walkie-talkie, see a ring on the ground, aim, click.

What happens **[measured]**, X then a normal 83 ms click:

1. X: `switchWeapon('walkieTalkie')`. HUD shows `AIRSTRIKE`, ammo `READY`. **No targeting yet.**
2. LMB frame 0: the `else` branch runs `shoot()`, which calls `startAirstrikeTargeting()`. Text `Click to call airstrike at location` appears.
3. LMB frame 1: mouse is still down and `isTargetingAirstrike` is true, so `callAirstrike()` fires at the crosshair.

**Targeting lasts 1 frame.** The aim is wherever the crosshair was when you clicked; the yellow ring exists for one frame. Only a click shorter than one frame enters real targeting mode, in which case a second click calls it **[measured]**.

Also, `canShoot` applies the walkie's `fireRate: 1` against `lastShotTime`, so clicking within 1 s of the last shot is ignored. Holding LMB after a shot delayed the strike to 1.03 s. **[measured]**

Preview, if seen (7945-7983): `RingGeometry(11.5, 12, 32)`, `#ffff00`, y = 0.1, opacity `0.3 + sin(now*0.003)*0.2`. Ray from screen centre to the y=0 plane; walls do not block it.

**Sky aim:** `intersectPlane` returns null and leaves `targetPoint` at (0,0,0), but `if (targetPoint)` tests the vector object, which is always truthy. Strike lands at world origin. **[measured: player at 30,30, finisher at 0,0]**

### Timeline [measured]

T = 0 at the call.

| T (s) | Event |
|---|---|
| 0.0 | `walkieTalkieFire` (eff. 0.35). Flag cleared, 30 s cooldown starts, chip and text removed, ammo 0, **auto-switch to SMG** (no restore of previous weapon) |
| 0.0 | Orange ring on ground: `RingGeometry(4.5, 5, 32)`, `#ff6600`, opacity `0.4 + sin(now*0.005)*0.4` |
| 3.0 | `airstrikeActivate` (eff. 0.5) |
| 4.0 to 5.4 | 15 rockets, one per 100 ms |
| about 4.67 | First impact |
| 6.0 | Ring removed (comment says 5 s) |
| about 6.04 | Last rocket impact |
| 6.5 | Hellfire finisher launched |
| about 7.08 | **Finisher impact** |

| Projectile | Count | Spawn | Speed | Damage | Blast |
|---|---|---|---|---|---|
| Rocket | 15 | Target + polar offset, `radius = random*12` (centre-biased), y 30 to 35 | 50 | 100, falloff to 50% at edge | 6 |
| Finisher | 1 | Dead centre, y = 35 | 60 | 99999, instakill in radius | **20** |

Rocket direction: straight down with `+/-0.05` x/z jitter. Not affected by Blood Thirst.

Per-rocket impact: `rocketExplosion` (eff. 0.25), 50 `#ff6600` + 30 `#ffaa00` particles, shockwave (max 15, 120 u/s, 0.1 s), shake 0.06. Trail: `#cccccc` smoke, size 1.0, life 1.8, every 60 ms.

Finisher impact: identical to a Hellfire rocket (section 13): 360 particles, big shockwave, layered sounds, shake 0.24 for 100 ms. Trail is orange fiery smoke.

Every enemy hit in a blast adds `enemyHit`, 10 `#ff4444` particles, and on death `enemyDie`, dismemberment and pickup roll (30%).

**Why it works (interpretation):** about 4 seconds of anticipation with a pulsing marker and two audio cues, a rolling barrage of 15 impacts over 1.4 s, a gap of about 1 s, then the largest explosion the game has (identical to a Hellfire rocket).

### Issues

- **The finisher kills the player within 20 u** (99999 x falloff x 0.5, at least about 25,000), unless Berserk is active. The ring shows 12, then 5. Rockets deal 25 to 50 each to the player inside radius 6.
- After-call ring (radius 5) is smaller than the strike area (12) and the finisher radius (20). The 3x comment was applied to the preview only.
- `cancelAirstrikeTargeting` is never called. There is no cancel input.
- No cooldown display anywhere. X fails silently.
- `setTimeout`s and the ring's rAF loop ignore pause and restart. Rockets spawn during pause and hang until resume; a strike called before dying lands in the next game.
- Geometry and materials are not disposed.

---

## 15. Warthog strike

### Unlock

Combo reaches 12, available false, cooldown over. Plays `perkAirstrike` (same sound; comment says "for now"). Popup `WARTHOG STRIKE READY!` `#00ff00`, shadow `0 0 10px #00ff00, 0 0 20px #00aa00`, same animation. `warthogStrike.currentAmmo = 1`. Chip `WARTHOG [Z]` `#00ff00`, bottom 60, left 30. Moves the airstrike chip to left 150. Using the warthog moves it back.

### Calling it in

Same one-frame problem as section 14. Z equips a green-button walkie-talkie; click fires a frame later. HUD: `A10 WARTHOG`, `READY`. Text `Click to call A10 Warthog gun run`, `#00ff00`, 20px, bottom 100.

Direction is the camera look flattened to XZ. The run goes **across** your view, left to right.

Preview (7986-8034): `PlaneGeometry(40, 3)`, `#00ff00`, opacity `0.3 + sin(now*0.004)*0.15`. **It is rotated 90 degrees from the real corridor**: its long axis runs along your facing direction. **[measured at yaw 0, 30, 90]** The after-call rectangle is correct. In practice the preview is seen for one frame, but fixing targeting alone would expose this.

### Timeline [measured]

| T (s) | Event |
|---|---|
| 0.0 | `walkieTalkieFire`. Flag cleared, 45 s cooldown, UI removed, ammo 0, auto-switch to SMG |
| 0.0 | Green corridor `PlaneGeometry(40, 3)`, opacity `0.2 + sin(pulseTime*8)*0.15`, updated every 50 ms |
| 2.0 | `airstrikeActivate`. **Pulse stops**; rectangle freezes at its last opacity |
| 4.0 to 6.45 | 50 shells, one per 50 ms (20/s), with `30mmshell_flyby` per shell |
| about 4.27 | First impact |
| 6.5 | `warthog_flyby` at 2x (`min(1, 0.8*2*0.5)` = 0.8 effective) |
| about 6.72 | Last impact |
| 8.5 | Rectangle removed |

Shells land first and the engine sound follows, as with a real A-10 gun run.

| Shell property | Value |
|---|---|
| Count, rate | 50, 20/s |
| Corridor | 40 long, 3 wide, centred on target, perpendicular to facing |
| Spacing | 0.816 u along corridor, `+/-1.5` random across |
| Spawn | y = 50, and 20 u back along the run |
| Angle | **68.2 degrees below horizontal** (comment says 45) |
| Speed, flight | 200 u/s, 0.27 s |
| Damage | 150, falloff to 50% at edge, radius 5 |
| Collision | 4 sub-steps per frame |

Per-shell impact: `30mmshell_explode` (eff. 0.8), 25 `#ffff00` + 15 `#ffaa00` particles, 20 sparks, shockwave at 0.5 scale, shake 0.03. Per strike: 2000 explosion particles and 1000 sparks in 2.5 s, each one a new mesh, geometry and material.

Direct head hits use the autocannon path: instakill, three layered headshot sounds, +50, and `registerHeadshot()`, so **a gun run can trigger Slowmo.**

**Why it works (interpretation):** 50 plays at 20 Hz on 4 audio instances restart each instance every 200 ms, so any clip longer than that is cut off, giving a rapid stutter. The comment at 6848 says the 50 ms spacing is for a "rapid A10 gun sound". With 0.8 u spacing against a 5 u blast, a point on the corridor's centre line takes around 12 overlapping blasts, far above base enemy HP (50 to 100). It is also safe: shells never hurt the player.

### Issues

- **`handleShellExplosion` calls `this.onWaveComplete()` (7786), which does not exist.** Grep finds only that one call. When `enemies.length === 0` it throws `TypeError` mid-frame. Since `animate()` has already queued the next frame, the game continues, but that frame skips the rest of the update, the render, and `bulletPool.release` (the bullet stays in `active`). Once the last enemy dies, or on a run called between waves, each remaining shell throws. Expect stutter. (From reading, not run.) This also affects the autocannon.
- `setTimeout` chain has the same pause and restart problems as the airstrike.
- `cancelWarthogStrikeTargeting` is never called.

---

## 16. Bug list, ranked for the sequel

| # | Problem | Cause | Evidence |
|---|---|---|---|
| 1 | Slide ends on frame 2 | Crouch ungrounds player, and ungrounded ends slide (5417, 5522) | Measured |
| 2 | Air-to-slide never fires | `wasInAir` set from `isGrounded` just before the check | Measured |
| 3 | No momentum; air 3.35x ground | Same thrust, different drag | Measured |
| 4 | Targeting lasts 1 frame | Same LMB hold starts and confirms | Measured |
| 5 | Sky aim hits world origin | Return value of `intersectPlane` ignored | Measured |
| 6 | Shell explosions throw with 0 enemies | `onWaveComplete` undefined | Read |
| 7 | Finisher radius 20 kills player, ring shows 12 | Damage not exempted, ring mismatch | Read |
| 8 | `startGame` does not reset player | Only health and some ammo reset: position, velocity, FOV, perks, combos, cooldowns, availability, chips all persist | Read |
| 9 | Standing slide goes backward | `forward` is actually backward | Measured |
| 10 | Slide-hop always worse than a jump | Tiers reward late hops; "perfect" unreachable | Measured |
| 11 | FOV stuck at 80 after slide-hop | Nothing resets it | Measured |
| 12 | C-tap beats sprint | Stand-up re-grounds instantly | Measured |
| 13 | Slide physics frame-rate dependent | No `dt` | Measured |
| 14 | Warthog preview off by 90 degrees | Missing `+ pi/2` | Measured |
| 15 | Mouse delta overwritten; sway and directional sword dead | Assign vs accumulate; reset before read | Read |
| 16 | Perk timers, cooldowns, call-ins run through pause | Wall-clock time | Read |
| 17 | Slowmo: enemies shoot and spawn at full rate | `performance.now` in enemy and wave code | Read |
| 18 | Slowmo stinger slowed anyway | Exemption overwritten immediately | Read |
| 19 | Audio rate stuck at 0.25 if you die in Slowmo | `updateSlowmo` stops at game over | Read |
| 20 | Hellfire bullets weaker on direct hits | Rocket branch skips direct damage and headshots | Read |
| 21 | Adrenaline x1 is +3%, not +10% | `baseSpeed` 7.5 vs `speed` 8 | Measured |
| 22 | Small crates walk-through | Eye-point test | Measured |
| 23 | Adrenaline and Berserk labels overlap | Both top 140 | Read |
| 24 | `ACTIVATED!` text shows for 1 frame | Timer update overwrites next frame | Read |
| 25 | `@keyframes` name collisions | Injected `fadeInOut` replaces the kill-feed animation after the first call-in unlock, so kill messages shift and fade early. `pulse` defined 3 times | Read |
| 26 | Perk labels sit above game over | z-index 1000 vs 200, and no cleanup | Read |
| 27 | Pause-screen "R to restart" does nothing | Unreachable branch (7367) | Read |

### Dead code

- `momentumMultiplier`, `slideFriction`, `footstepInterval`: declared, never read.
- `wasGrounded`: assigned, never read.
- `inFlowState`: set, never read. Its only effect is the x1.2 at the moment it is set.
- `landingWithCrouch`, `justLanded`: always false.
- `cancelAirstrikeTargeting`, `cancelWarthogStrikeTargeting`: never called.
- `.perk-message` class: no CSS.
- Two `console.log` per kill in `registerKill`, plus logging around the flyby.

### Guide text vs reality

| Guide says | Reality |
|---|---|
| Hellfire: "Instakill damage" | Rockets only. Bullets are x1.25 blast |
| Hellfire: "All bullets explosive" | Not autocannon or sword |
| Berserk colour `#ff00ff` | On-screen colour is `#ff0000` |
| Berserk features | Invulnerability, the biggest effect, is not listed |
| "Press X to activate targeting" | X equips. Click starts and fires |
| Adrenaline: "Each stack lasts 5 seconds" | One shared timer. All stacks drop together |
| Slowmo: "Time slows" | Enemy fire and spawns do not |
| Controls list | C (crouch/slide) not mentioned anywhere |

---

## 17. Notes for the sequel

These are recommendations, not observations about the original.

**Keep:**

- The perk ladder thresholds and the snowball structure.
- Layered audio per shot while buffed: the player hears the perk on every trigger pull.
- Live countdown labels.
- Full-speed player in Slowmo.
- The call-in rhythm: radio cue, pause, escalating impacts, then finisher or engine roar.
- Warthog flyby arriving after impacts, and the fast retrigger on shell sounds.
- Zero-friction landing when a jump is already queued.
- Fast ground response (0.25 s to top speed).

**Fix first:**

- Decouple ground top speed from air speed and decide on real ceilings. Make drag `dt`-correct or use a fixed physics step.
- Rebuild crouch so grounded state does not depend on eye height. Separate feet position from eye height.
- Make air momentum persist when W is released, so hops reward flow, not holding a key.
- Tie FOV, audio and camera feedback to actual velocity, so speed is felt everywhere.
- Add the missing feel: landing dip, head or weapon bob, velocity-based FOV.
- Make targeting a proper mode: first click or key enters, a fresh press confirms, with a cancel. Show true blast radii. Reject sky aim.
- Run call-ins, perks and cooldowns on game time so they respect pause and restart.
- Reset all player state on new game.
- Give Slowmo a shared time source so enemy fire and spawns slow down too.
