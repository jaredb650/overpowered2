# The Distraint Frame

Persistent Bureau heavy walker (`4000 HP`, no time limit) with sculpted bevelled armor, first-person cockpit with progressive canopy cracks,
and full vehicle disembark/re-board (`E`). Files: `src/frame/`.

**Try it:** `/?map=range&frame=1`. Every run starts in a Frame at the player's spawn. Add `&frameturn=free` to take the turn limit
off and compare.

| Key | Does |
|---|---|
| WASD | Walk, relative to the view: 7 m/s ahead, 4.5 back, 5 sideways (walking continuously tramples enemies hugging the ankles) |
| Mouse | Look. Free within 80 degrees of the legs; past that the mouse drags the whole Frame round at 140 degrees a second |
| Space | Jets: up about 7 m in 0.8 s, hold to hover up to 1.5 s. Fuel fills in 3 s on the ground. A launch with WASD held is thrown that way at 3 m/s, and the jets steer at full control while lit (half with them off) |
| Crouch (Ctrl, C) in the air | Stomp: down at 32 m/s. From 4 m or more, the big slam (16 m ring, 240..60 damage, 12 m knockdown) |
| Shift | Charge: 0.75 s at 18 m/s, two charges, each back 3.5 s after. Re-plants the legs under the view |
| F | Alternating 2-arm melee sweep: 190 degree front arc to 7.2 m PLUS a 4 m 360 degree close-proximity sweep around the legs (340 damage, 1100 force, close gib, 0.72 s cooldown) |
| LMB | 20 mm six-barrel Vulcan rotary cannon (left arm; the loadout may fit another arm weapon) |
| RMB, R | 40 mm autocannon (right arm; likewise), and R cycles HE, AP, FLAK |
| G, held | Paint for the 6-tube shoulder rocket pod; let go to fire all six |
| Q | Regenerating smoke wall, flares, and a 6.5 m concussive pulse around the legs |
| E | Disembark safely beside the Frame (leaving it parked with preserved HP and position) or climb back in within 5.2 m |
| Wheel | Zoom x2 |

**As a call-in** (key K, combo 35, `progression/callins/frameDrop.ts`): it lands on its jets 9 m ahead of the player and calls
`Frame.deploy(feet, yaw)`. There is no call-in timer and no despawn timer: it remains parked with a HUD marker (`DISTRAINT 4 · XX%`)
and `[E] BOARD` prompt until destroyed (`0 HP` triggers an explosion and safely ejects the pilot if inside).

## Loadout (owner, 2026-11-22)

The Frame is built from parts, one per slot, as the contractor wears implants: `src/frame/loadout.ts` (data and rules, no three.js),
tested in `loadout.test.ts`, `seat.test.ts` ("the loadout") and `progression/callins/copies.test.ts`. Chosen on the Frame loadout screen
(`src/ui/screens/frameLoadout.ts`, `docs/notes/ui.md`) and kept in this browser (`op2.frame.loadout.v1`).

| Slot | Parts today | What it decides |
|---|---|---|
| Left arm | `rotaryL`, `cannonL`, `howitzerL` | The weapon on LMB |
| Right arm | `rotaryR`, `cannonR`, `howitzerR` | The weapon on RMB |
| Shoulder (as many as the cockpit gives) | `pod6`, the six-tube pod | G. Today one shoulder; `frameStats().pod` turns the pod on |
| Legs | `legsStandard` | `LegStats`: walk, jump, stomp multipliers, gait. Walk and jump are read; stomp and gait are not yet |
| Cockpit | `cockpitStandard` | `CockpitStats.shoulders`: 1. A two-shoulder cockpit makes the loadout grow a shoulder slot (`shoulderSlots`) |
| Engine | `engineStandard` | `EngineStats`: speed (read, times the legs' walk), drive (`jets`, later `hover`/`flight`), dash (not read yet) |

**The default** (`DEFAULT_FRAME_LOADOUT`) is the Frame as it was: rotary left, 40 mm right, the pod, the standard legs, cockpit and
engine; every stat is exactly 1 (`frameStats`), so nothing moves differently. A mission's beat (`board`, `kneel`) still builds the
default; Foreclosure's `installWeapon('howitzer105')` swaps only the right arm of whatever is worn. A call-in (`frameDrop.ts`) reads the
saved loadout as it is called, wears it on the way down (`Frame.wear`) and lands as it (`deploy(feet, yaw, loadout)`). `?frame=1` boards
the saved loadout too, so the range is where one is tried.

**The arms.** `FrameGuns` (weapons.ts) has an `ArmMount` per side: the kind, its own rotary, cannon and howitzer clocks, the left on
`fire`, the right on `aim`. Hold 1 changes every rotary's round, R every cannon's (one bolt sound). The panel rows are per side
(`LMB ...`, `RMB ...`), and so is the status line. `guns.rotary`, `guns.cannon`, `guns.howitzer` are the ones an arm carries (the default's
side first). The models come from `ArmRack` (arms.ts): one `Gun` per side and kind, built on first wear; on the side it was not drawn
for, a model is the same one mirrored (`new Gun(..., mirror)`), so no new models. The standard two and the right howitzer are built at
once, as before.

**Co-op.** The pose ends with `kitIds(loadout)`: seven part numbers (places in `FRAME_PART_ORDER`, five single slots and two shoulders,
-1 for none), about 14 bytes more ten times a second. The puppet rebuilds its arms when a number changes; a bare 13-number pose is
the default Frame. The rotary firing flag is per side (`MECH_FIRING`, `MECH_FIRING_RIGHT`), a shell's news carries its arm as a ninth
number, and the puppet now flies the 105 mm too (before, a teammate's howitzer showed nothing). A teammate's call-in, while it is
falling, still shows the default arms: its loadout arrives with the first pose after it lands.

**Adding a part later.** 1. Append its id to `FRAME_PART_ORDER` (never reorder: the wire reads places). 2. Add its `FRAME_PARTS` row with
slot, name, `does`, `lore` and its stats (`legs`, `engine`, `cockpit`, or `side` + `arm`). 3. If it is a new arm weapon, add an
`ArmKind`, its clock and fire path in `FrameGuns` (`update`'s switch, `armRow`), its `GunSpec` in `arms.ts`, and the puppet's look
(`news('shell')`, `rotary`). 4. A shoulder part beyond the pod needs its own fire path and a place on the body (`FRAME_PLACES`). 5.
Legs or an engine that change movement: read the stat in `Walker` (as `speedScale` and `jumpScale` are), or add the gait. 6. Tests in
`loadout.test.ts`. The loadout screen lists every part in `FRAME_PARTS` by itself. Every part is free today; a priced part would want a
shop row (`contracts/shop/data.ts`) and an owned set, which do not exist yet.

## Files

| File | Holds |
|---|---|
| `data.ts` | Every number (`FRAME`), `FRAME.hull`, the seat's plan (`framePlan`), the URL flags |
| `controller.ts` | `Walker`: the legs. A kinematic walker on Rapier, no physics body |
| `seat.ts` | `Frame`: persistent vehicle lifecycle (`deploy`, `board`, `enter`, `leave`, `destroy`), hull armor (`4000 HP`, directional rear multiplier, canopy cracks), keys, walker, pose, guns, blows |
| `weapons.ts` | The four clocks (`Rotary`, `Cannon`, `Pod`, `Smoke` with recharge), `FrameGuns` (plus `idleUpdate` while parked), and the blows (`stomp`, `shove`, `backhand`, `crush`, `trample`, `smokePulse`) |
| `loadout.ts` | The loadout: parts, slots, stats, `normalizeLoadout`, `fitPart`, `kitIds`/`kitFrom`, storage |
| `arms.ts` | `ArmRack`: the arm gun models per side and kind, mirrored on the other side |
| `cockpit.ts` | Sculpted bevelled procedural Bureau mech (`prism()` hull, pauldrons, sensor mast, 6-tube missile pod, dorsal reactor slats, jet flame cones, reverse-jointed 3-toed legs, parked amber standby visor, first-person cockpit with 3 crack overlays, `ROTARY_ARM`, `CANNON_ARM` with melee strike-gauntlet) |
| `*.test.ts` | Controller on real Rapier, weapons' clocks and blows, persistent seat/hull lifecycle |

Outside `src/frame/`: the `frame` tone and Hull Integrity bar in `src/vehicles/hud.ts` and `gunner.css`, fields on `GunnerSeat`
(`legs`, `marks`, `hull`, `hullText`), `Heat`, `player.carry(feet)`, and `callIns.frame` / `progression.frame`.

## How it works

**The walker** (`controller.ts`). The body is a capsule (radius 1.5) from a step's height (1.2 m) over the feet to the hull's top
(6.2 m), so anything lower than a step is under it, not in its way. Walls stop the capsule and it slides along them; a contact on the
round of the capsule's end pushes straight out from the axis, so a wall just over step height is a wall. The ground is five rays,
under the middle and under four feet 0.95 m out, turned with the legs; the Frame stands on the highest walkable one. Each ray starts a
step over the feet, which is over where the feet were a tick before, so no fall at any speed passes a floor.

**Turning.** The walker is given where the mouse would put the view, before the legs hold it. Inside the arc the legs stay planted;
the mouse past the edge turns them at up to 140 degrees a second. Walking, the legs also come round under the view at 70 degrees a second.
`?frameturn=free`: no arc, the legs catch the view at once.

**The seat & hull** (`seat.ts`). A `GunnerSeat` with plan `framePlan()`: tone `frame`, `exposed`, `noWayOut: false`, `seconds: Infinity`,
`aimZooms: false`. `player.interceptor` routes every hit while piloted into `Frame.health` (`4000 HP`): small arms take `0.18x`,
snipers `0.45x`, heavy ordnance `1.0x`, and rear shots into the dorsal reactor slats take `1.5x`. Canopy cracks progress at 70%, 45%,
and 20% HP; at 0 HP `destroy()` explodes the Frame (12 m, 320 damage to nearby enemies) and safely ejects the pilot with 1.5 s grace.
Pressing `E` runs a multi-raycast `findExitSpot()` beside the mech and parks it in a standby crouch (amber visor, weapons cooling/reloading passively).

**The weapons** (`weapons.ts`). Each gun has its own clock, so the juggle is the game, as in the gunship.

| Gun | From | Numbers |
|---|---|---|
| Rotary, left arm | 20 mm Vulcan (`68` damage, `0.7 m` burst of `22`, through `1.5 m` of wall), `Heat` | 24 a second after 0.25 s spin; 160 rounds (~6.7 s) to `OVERHEAT`, 2.2 s to vent |
| 40 mm, right arm | `Magazine` and `Ac130Rounds`, brass casing ejection | 10 a magazine, 0.28 s apart, 3.8 s reload. HE / AP / FLAK at 145 m/s |
| Pod, right shoulder | `Painter` and missiles | Six tubes. Hold G: a mark every 0.11 s in a 0.26 rad cone to 200 m. Release: all six fire 0.08 s apart (145 direct, 115 in 4.2 m). 8.5 s reload |
| Smoke, Q | Flares, smoke wall, and close concussive pulse | 3 charges, 2.5 s lockout, 14 s per-charge recharge; clears enemies within 6.5 m (45 dmg, 620 force) |

**The blows.** All `crush` damage on `enemies.applyDamage`.

| Blow | What |
|---|---|
| Stomp from 4 m or more | 16 m ring, 240 at center falling to 60; everyone inside 12 m knocked off their feet (850 force) |
| Stomp from lower | 0.55x ring, damage, and push |
| Charge | Anyone within 3.2 m of front/hull, once per charge: 240, flung at 1150 |
| Backhand (F) | Alternating 2-arm sweep: 190° front arc to 7.2 m PLUS 4 m 360° close-proximity sweep around the legs: 340 damage, 1100 force, close gib |
| Foot / walking | Planted foot crushes within 2.0 m (450, gib); walking continuously tramples within 1.85 m (160 every 0.45 s) |

## Co-op: the Frame on other screens

A player in a Frame is drawn on every other screen as a **puppet** of it (`src/frame/puppet.ts` `FramePuppet`): the same `StandIn`
body and the two arm `Gun`s, seen from outside. When a pilot disembarks, `MECH_PARKED` keeps the puppet standing in its parked pose
while the remote pilot's body reappears on foot beside it (`occupied === false`, `deployed === true`). Sending `null` clears it on destruction.

- its **pose** ten times a second (`MechPose`, 13 numbers: feet, leg yaw, view yaw, stride, walk, the hull's sink and sway, the
  spot the guns are on, and flags for the rotary firing and the jets lit), and `null` as the player leaves it;
- a word for each **40 mm shell** (round, muzzle, the exact spot it flies to, seconds), each **pod missile** (from, velocity), the
  **stomp** (height), the **smoke** and the **backhand**.

The puppet eases onto each pose, plants its feet with dust and a footfall sound, turns its arms onto the pilot's sight, draws the
rotary's tracers at the gun's rate, flies the shells and missiles and bursts them for the look (`shellImpact`, `smokeScreen` and
`podMissile` in `weapons.ts` are shared with the real one), and hurts nothing: it is built on the call-ins' ghost context. Four
seconds without a pose and it is taken for empty. The pilot's own body (which rides in the cockpit) is not drawn while they are in
it (`RemotePlayer.hidden`). On the wire it is the `mech` event (`src/net/world/callins.ts`): about 95 bytes ten times a second.

For another system that needs to know where a teammate's Frame is: `ctx.progression.callinLink.mirror.frameOf(slot)` (its
`position`, `occupied`), and `inFrame(slot)`.

## Stage 4 & Stage 5: body, damage, destruction, and mission hooks (built)

- **Bevelled body & cockpit (`cockpit.ts`):** chamfered Bureau obsidian/slate hull with crimson stripes, reverse-joint legs with
  hydraulics, dual-state visor slit (crimson active / amber standby), dorsal jump-jet thruster cones, kneeling & collapse poses
  (`setPoseState`), slumping right-shoulder pod on damage, and a three-stage canopy crack overlay (`crackStage` 0–3) inside the cockpit.
- **Persistent Frame & locational armour (`parts.ts`, `parts.test.ts`, `seat.ts`):** persistent 4,000 HP vehicle you can exit and
  re-enter with `E` (preserving health, parts, and position), exploding with a safe emergency eject at 0 HP. Light small arms (`< 34`
  bullet) bounce harmlessly off the plate; heavy bullets chip armour (`0.18×`), snipers crack the canopy (`0.45×`), and directional
  routing resolves heavy ordnance onto `leftLeg` / `rightLeg` (900 HP each → `0.62×` speed + limp roll; both crippled → `0.42×`), `pod`
  (500 HP → shoulder rocket pod knocked offline), `canopy` (3 crack stages), and rear `reactor` (`1.5×` bonus damage). Live status
  renders on the Frame HUD schematic (`src/vehicles/{seat.ts,hud.ts,gunner.css}`).
- **Destruction & blows:** Frame stomp, charge, alternating 2-arm 360° melee, and foot crush smash Holdfast's destructible `'stall'`
  structures (`src/world/structures.ts`), stagger ground vehicles (`GroundVehicle.stagger`), toss vehicle wrecks (`Wreck.toss`), and
  stop charges against heavy tanks (`Walker.stopCharge`).
- **Kneel, board, eject, sappers & anti-air (`seat.ts`, `callins/antiAir.ts`):** `kneel(feet, yaw, done)` poses the crouching Frame for
  interactive `[E]` boarding with hydraulic rise + cockpit boot diagnostics; `ejectTo(dest, done)` launches a 25 m slow-motion apex arc
  onto Old Mother's deck; `attachSapper(5)` arms a beeping leg satchel cleared by stomp or backhand; `asAircraft()` lets enemy anti-air
  hunters lock the Frame with top-attack missiles broken by `Q` smoke/flares.
- **Standing dread (`enemies/outpost/index.ts`):** enemy morale reads the standing Frame's position and accelerates rout/surrender
  among nearby Holdfast militia.

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
