# The Distraint Frame

Stage 3 of `docs/proposals/mission-2-plan.md` (section 3 is the design): the Frame as a toy on the Test Range, on a stand-in body
of boxes. Stage 4 bakes its body, stage 5 makes what it breaks and what breaks it. Files: `src/frame/`.

**Try it:** `/?map=range&frame=1`. Every run starts in a Frame at the player's spawn. Add `&frameturn=free` to take the turn limit
off and compare (question 2).

| Key | Does |
|---|---|
| WASD | Walk, relative to the view: 7 m/s ahead, 4.5 back, 5 sideways |
| Mouse | Look. Free within 80 degrees of the legs; past that the mouse drags the whole Frame round at 140 degrees a second |
| Space | Jets: up about 7 m in 0.8 s, hold to hover up to 1.5 s. Fuel fills in 3 s on the ground. A launch with WASD held is thrown that way at 3 m/s, and the jets steer at full control while lit (half with them off) |
| Crouch (Ctrl, C) in the air | Stomp: down at 30 m/s. From 4 m or more, the big slam at twice the size |
| Shift | Charge: 0.7 s at 16 m/s, two charges, each back 4 s after. Re-plants the legs under the view |
| F | Backhand: a 120 degree arc in front, 5.5 m from the hull's middle, 200, once a second |
| LMB | Rotary cannon (left arm) |
| RMB, R | 40 mm (right arm), and R for its round: HE, AP, FLAK |
| G, held | Paint for the rocket pod; let go to fire all six |
| Q | Smoke and flares, three a beat |
| Wheel | Zoom x2 |

There is no way out by key (`noWayOut`), as the plan's default has it. Death or a new run takes the player out.

**As a call-in** (key K, combo 35, `progression/callins/frameDrop.ts`): it lands on its jets 9 m ahead of the player, stands empty
(`Frame.stand`), and E within 4.5 m boards it with `board(feet, yaw, 45)`. When the seat's 45 s run down, `update` calls `leave()`,
the player is put down beside it and the Frame is gone. See "The AA sentry and the Frame" in `docs/notes/progression.md`.

## Files

| File | Holds |
|---|---|
| `data.ts` | Every number (`FRAME`), the seat's plan (`framePlan`), the URL flags |
| `controller.ts` | `Walker`: the legs. A kinematic walker on Rapier, no physics body |
| `seat.ts` | `Frame`: the gunner's seat on a walking mount. Keys to intent, the walker, the pose, the seat, the guns, the blows, the feel |
| `weapons.ts` | The four clocks (`Rotary`, `Cannon`, `Pod`, `Smoke`), `FrameGuns` that fires them, and the blows (`stomp`, `shove`, `backhand`, `crush`) |
| `cockpit.ts` | The stand-in: the cockpit near-model, the two arm guns' specs, the hull and legs, `FRAME_PLACES` |
| `*.test.ts` | Controller on real Rapier, weapons' clocks and blows, the seat |

Outside `src/frame/`: the `frame` tone in `src/vehicles/hud.ts` and `gunner.css`, two fields on `GunnerSeat` (`legs`, `marks`),
`Heat` takes any gun with the three heat numbers, `player.carry(feet)` (`contracts.ts`, `Player.ts`), and the call-in manager owns the
Frame beside the mounted guns (`callIns.frame`, `progression.frame`).

## How it works

**The walker** (`controller.ts`). The body is a capsule (radius 1.5) from a step's height (1.2 m) over the feet to the hull's top
(6.2 m), so anything lower than a step is under it, not in its way. Walls stop the capsule and it slides along them; a contact on the
round of the capsule's end pushes straight out from the axis, so a wall just over step height is a wall. The ground is five rays,
under the middle and under four feet 0.95 m out, turned with the legs; the Frame stands on the highest walkable one. Each ray starts a
step over the feet, which is over where the feet were a tick before, so no fall at any speed (the stomp's 30 m/s is 0.5 m a tick)
passes a floor. Walking, the rays reach a step down as well, so it walks down stairs and off a 1.2 m ledge; past that it falls.
Rising, a foot that catches a ledge lifts the Frame onto it and the climb goes on. Ticks are at most 1/60 s. `said` holds what
happened in the last update (plants, a landing, a stomp, a charge into a wall, jets lit, how far the legs turned, a step's height).

**Turning.** The walker is given where the mouse would put the view, before the legs hold it. Inside the arc the legs stay planted;
the mouse past the edge turns them at up to 140 degrees a second and anything it asks beyond that is lost, so the view never moves on
its own. Walking, the legs also come round under the view at 70 degrees a second. The seat clamps the view to the same arc round the
legs (`arcHalf`), so the two agree. `?frameturn=free`: no arc, the legs catch the view at once.

**The seat** (`seat.ts`). A `GunnerSeat` with plan `framePlan()`: tone `frame`, `exposed`, `noWayOut`, `aimZooms: false` (RMB is a
gun, the wheel zooms), its frame quaternion the legs' yaw. Every frame the walker moves, the stand-in is posed from it, and the seat
takes its view from the eye in the cockpit, so the arc, the zoom, the sight ray, the HUD and every way out are the seat's. The parked
body rides with its head in the cockpit (`player.carry`), where the enemy aims, and `player.interceptor` gives every hit on it to the
Frame (stage 3: the plates take everything).

**The feel.** The aim is never slowed or moved; the weight is in the feet and the eye. A plant every 0.7 s at a walk dips the hull
9 cm on a critically damped spring, kicks the view down 0.01 rad, and plays `land_hard` at 0.48 under `juggernaut_step` at 0.7; the
hull sways 7 cm side to side over a stride and the view rolls with it. Each plant pushes: the speed swells and sags 8% over a stride.
Acceleration is 1.1 s to 7 m/s and 0.6 s to stop. A step up or down moves the feet at once and the eye eases over it. A landing
sinks the hull by its speed; a stomp sinks it 1.3 m. The hip servos (`tank_turret_loop`) are heard while the legs come round.

**The weapons** (`weapons.ts`). Each gun has its own clock, so the juggle is the game, as in the gunship.

| Gun | From | Numbers |
|---|---|---|
| Rotary, left arm | The door gun's 20 mm round (60, a 0.6 m burst of 16, through 1.4 m of wall), the mounted gun's `Heat` and the minigun's five sounds | 20 a second after 0.3 s of spin; 140 rounds (about 7 s) to `OVERHEAT`, 2.5 s to vent. Fired from the eye along the sight, the tracer from the real muzzle |
| 40 mm, right arm | The gunship's `Magazine` and rounds (`Ac130Rounds`, its own instance), armed from the muzzle | 8 a magazine, 0.32 s apart, 4.5 s reload. HE 170 in 5 m; AP through 3 walls, then 320; FLAK bursts 2.5 m short and throws 14 pellets of 75. 130 m/s, so a shell is seen to fly |
| Pod, right shoulder | The Quiver's `Painter` and missiles | Six tubes. Hold G: a mark every 0.15 s in a 0.2 rad cone to 180 m. Let go: all six leave, 0.09 s apart, spares on the marks; a tap fires six dumb. 110 direct, 90 in 3.5 m. Then 10 s to reload |
| Smoke, Q | The gunship's flares (thrown from the back) and eight long clouds round the legs | Three a beat, 3 s lockout after each |

Sources are `frame_rotary`, `frame_40mm`, `frame_40mm_ap`, `frame_flak`, `frame_pod`, so kills are the player's and pay. None of it
hurts the player: the blasts take `selfDamage: 0` and `playerPush: 0`, and the interceptor takes the rest.

**The blows.** All `crush` damage on `enemies.applyDamage`.

| Blow | What |
|---|---|
| Stomp from 4 m or more | 14 m ring, 160 at the middle falling to 40; everyone inside 10 m is pushed up and out at 650 (the big slam's knock is 420). `fx.slam` at 3.2 (the big slam's 1.6, doubled), two rings of dust, chips, an 11 m crack, a radial impulse, `titan_stomp` |
| Stomp from lower | Half of all of it |
| Charge | Anyone within 2.4 m of the front of the hull, once each a charge: 150, flung along it and up at 900. A wall square on stops it dead, 0.3 s to recover |
| Backhand | 200 and a fling to the left at 750, with `fx.slash`; the right arm swings across |
| A planted foot | 400 and a gib to anyone within 1.4 m of it |

## For stage 4 (the body)

- Replace `StandIn` in `cockpit.ts`. Keep `pose(feet, legYaw, viewYaw, stride, walk, sink, sway, inside, eye)` or its equivalent:
  `stride` is in plants (left foot down on even, right on odd; `Walker.said.steps` counts them), `walk` is 0..1 of 7 m/s, `sink` the
  hull on its legs (the eye spring), `sway` along the torso's right. The legs turn with `legYaw`, the torso with `viewYaw`.
- `FRAME_PLACES` is where the eye (5.2 m over the feet, 0.9 m ahead of the hips), the two gun pivots, the pod's tubes and the jets
  are in torso space. The guns are world objects (`Gun`, `ROTARY_ARM`, `CANNON_ARM`), aimed at the sight each frame.
- The hull is hidden from inside (`inside`); the cockpit near-model is what the player sees. The canopy cracks belong in it.
- Boarding: `Frame.board(feet, yaw)` puts the player straight in. The kneel, the hatch, the climb and the camera tween go in front
  of it; the eject is `Frame.leave()` then `player.launch`. The campaign host's `frame` step (`campaign/host.ts`) is still a banner;
  `board` is `ctx.progression.frame.board(at, yaw)`.

## For stage 5 (breaking things)

- Hits: `Frame.hit` (the interceptor) returns true for everything and counts nothing. Map `PlayerDamage.from` and `type` to the
  parts there, and give the Frame its 4000 health. Part colliders must not be in `CG.World`: the sight, the rotary's rays and the
  walker's own casts are all on it.
- `crush` on structures: the stomp, the charge (`said.charged`, `charging`, `said.bumped`) and the foot (`crush`) are where to call
  `Combat.blast` with the new kind. A tank stopping a charge for 0.8 s is a `recover` on the walker.
- Smoke: `FrameGuns.smoke` counts the pops; anti-air needs the Frame as a ground `Aircraft` and a pop to break its lock.
- Dread: the Frame is a position (`walker.feet`) to put in `outpost/morale.ts`.

## Measured

All on 2026-11-14. Browser runs at dpr 2, 1440 x 900, through `tools/shot.mjs`:
`node tools/shot.mjs --url "/?map=range&frame=1" --script tools/scripts/frame-live.mjs --wait 500 --timeout 300 --dpr 2 --w 1440 --h 900 --out tools/out/frame/y.png`
(`FRAME_STEP=turn` for the turn check, add `&frameturn=free` to compare; `FRAME_STEP=stomp` for the knockdown count).

| Target | Result |
|---|---|
| 60 fps on the range with 18 enemies | 60 in all 24 samples over 12 s, 18 men fighting (AI on) round a Frame walking, turning and firing the rotary. CPU 2.5 to 4.4 ms a frame, 125 draws at most, 365k triangles |
| No fall through any floor in 300 s of random driving | `controller.test.ts`: 300 s at 60 Hz in a walled yard of 30 blocks 0.3 to 5.2 m tall, a 0.25 m deck on legs at 3 m (landed on, flown to every 20 s) and a ramp, with random keys, jets, stomps and charges. Never under the floor, never inside a block or the deck, never lost |
| A jet onto a 2.6 m container, 10 of 10 | `controller.test.ts`: 10 of 10, from ten starts 3 to 9 m back at up to 25 degrees off square, flown as a player would (jets and W until a foot is over the edge, then off W and hold the jets to brake) |
| A stomp from 4 m knocks everyone in 10 m down | Browser, `FRAME_STEP=stomp`: three stomps from 4.2 to 4.4 m into 12 men on a ring 2.5 to 9.6 m, at 4000 health so the knock and not the kill is counted: 12 of 12 down every time within a second (9 to 10 at 0.45 s; the rest were in the stagger that leads into a fall). Gore holds 12 living bodies down at once (`GoreTuning.maxKnockdowns`), so a stomp into more than that leaves the rest staggered |
| `?frameturn=free` works | `controller.test.ts` and the browser: a hard sweep took the legs 110 degrees round with the view held 80 degrees past them; with `free` the view went where the mouse put it and the legs trailed it by about 33 degrees at that sweep |

Other numbers: from rest, 0.9 s of W is under 6.5 m/s and 1.15 s is 7; 0.65 s stops it. Ten plants in 7 s at a walk. A charge covers
10.2 to 11.8 m. The jets put the feet 7.0 to 7.5 m up at 0.8 s. Screenshots: `tools/out/frame/y-*.png` (cockpit, walk, feet, rotary,
cannon, paint, pod, jet, stomp, charge, backhand, smoke, fight), `turn-turn.png`, `stomp-stomp4.png`.

## Rough

- The stand-in body is boxes and the legs swing, they do not plant: feet slide. Stage 4.
- Nothing hurts it, nothing it walks into breaks, and the parts outline on the HUD is not there yet. Stage 5.
- The legs turn the whole Frame only while the mouse pushes: a flick past the edge is cut to what 140 degrees a second allows. If it
  feels sticky, `?frameturn=free` is the other answer.
- Enemies aim at the cockpit (the carried body) and lead it as if it stood still: `player.velocity` is not the Frame's.
- From the cockpit the legs are under and behind the eye, so looking down shows the ground at the feet and not the feet.
- Score: the range runs with progression off, so kills there pay nothing; the sources are the player's elsewhere.
