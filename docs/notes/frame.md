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
| LMB | Left arm weapon (default: 20 mm six-barrel Vulcan rotary cannon) |
| RMB | Right arm weapon (default: 40 mm autocannon) |
| 1 / 2 | Tap to cycle ammo/fire mode for the left arm (`1`) or right arm (`2`) independently |
| R | Manual reload for magazine/tube arm weapons (no longer cycles ammo) |
| G / V / B | Shoulder weapons 1 (`G`), 2 (`V`), and 3 (`B`, unlocked by Twin-Mount / Open Frame cockpits) |
| 3 / 4 / 5 | Tap to cycle shoulder ammo (e.g. Mortar Rack HE / WP / Cluster; `3` falls back to the first cycleable shoulder) |
| Q | Regenerating smoke wall, flares, and a 6.5 m concussive pulse around the legs |
| E | Disembark safely beside the Frame (leaving it parked with preserved HP and position) or climb back in within 5.2 m |
| Wheel | Zoom x2 |

**As a call-in** (key K, combo 35, `progression/callins/frameDrop.ts`): it lands on its jets 9 m ahead of the player and calls
`Frame.deploy(feet, yaw)`. There is no call-in timer and no despawn timer: it remains parked with a HUD marker (`DISTRAINT 4 · XX%`)
and `[E] BOARD` prompt until destroyed (`0 HP` triggers an explosion and safely ejects the pilot if inside).

## Loadout & Part Catalogue (2026-11-22)

The Frame is built from parts, one per slot (`src/frame/loadout.ts`, zero Three.js), chosen on the Frame Loadout screen (`src/ui/screens/frameLoadout.ts` + live rotating 3D preview in `src/ui/screens/framePreview.ts`) and saved in `op2.frame.loadout.v1`. All parts are currently free.

**The default** (`DEFAULT_FRAME_LOADOUT`) is the original Distraint Frame: 20 mm Rotary left, 40 mm Autocannon right, Six-tube Missile Pod, Standard Legs, Standard Cockpit, Standard Engine (`frameStats` multipliers all `1`). Campaign story beats (`board`, `kneel`) still build the default Frame; Foreclosure's `installWeapon('howitzer105')` swaps only the right arm. Call-ins (`frameDrop.ts`) and `/?map=range&frame=1` wear the saved loadout.

### Arm Weapons (`LMB` left / `RMB` right · tap `1` left ammo / tap `2` right ammo · `R` reload)

| Id | Name | Numbers & Behavior |
|---|---|---|
| `rotaryL/R` | **20 mm Vulcan Rotary** | 6 barrels; 0.25 s spin-up; 24 rds/s STD (`68` dmg, 0.7 m burst) / 16 rds/s AIRBURST (tap `1`/`2`); ~6.7 s to overheat, 2.2 s vent. |
| `cannonL/R` | **40 mm Autocannon** | 10-shell mag, 0.28 s cadence, 3.8 s reload; HE / AP / FLAK cycled on tap `1`/`2` independently per arm. |
| `howitzerL/R` | **105 mm Howitzer** | 1-shell breech, 3.1 s auto-reload; monolithic shell with 22 m shockwave knockdown. |
| `vulcan30L/R` | **30 mm Rotary Cannon** | 3 barrels in rounded triangle; 0.35 s spin-up, 14 rds/s; ~5.0 s continuous fire to overheat, 2.5 s vent; HE (3.0 m, 76.5 dmg) / AP (145 dmg, penetrates 1 body) / FLAK (8 proximity airburst pellets) cycled on tap `1`/`2`. |
| `beamL/R` | **Red Beam** | Hold 1.6 s to charge (walk slowed ×0.6; early release keeps half charge for 2.0 s). Release fires 1.0 s continuous 1.4 m red beam to 180 m piercing up to 3 walls: vaporizes enemies, scorches/ignites within 2.4 m edge, 900 dmg to bosses (`bossHit`), 9.0 s cooldown. |
| `clusterL/R` | **Bomblet Cannon** | 1-shell breech, 3.6 s reload; bursts 7 m short of first enemy/wall, throwing 28 wall-bouncing bomblets across ~14 m × 9 m rippling over 0.7 s (2.4 m, 70 dmg each). |
| `shotgunL/R` | **Mech Shotgun** | 6-shell tube, 0.42 s semi-auto, 26 heavy pellets in a 5.5° spread cone, 85 dmg/pellet up to 25 m (tapering to 25% at 85 m), heavy ragdoll push, 0.45 s shell-by-shell reload interruptible by firing. |

### Shoulder Weapons (`G` slot 1 / `V` slot 2 / `B` slot 3 · tap `3`/`4`/`5` cycle round)

| Id | Name | Numbers & Behavior |
|---|---|---|
| `pod6` | **Six-tube Missile Pod** | Hold to paint up to 6 targets (0.11 s/mark to 200 m), release fires 6 homing missiles (145 direct, 115 in 4.2 m); tap fires 6 dumb; 8.5 s reload. |
| `stormPod` | **Metal Storm Pod** | Hold to paint up to 8 targets (0.5 s/mark) + 0.7 s charge after first lock; release snaps through painted targets in order (0.25 s, 120 rds × 30 dmg each, skipping dead/occluded), 7.5 s reload. |
| `mirv` | **MIRV Launcher** | Hold to place ground marker (up to 200 m); release launches straight up to +70 m, dives, and splits at 25 m into 8 homing sub-missiles targeting enemies within 22 m (5 m, 220 dmg each), 11 s reload. |
| `wireBomb` | **Guided Heavy Missile** | Slow 16 m/s agile missile steered live to crosshair (walk freely while guiding), detonates via `megaBlast` (26 m kill radius, 70 m wave-timed shockwave, condensation dome, delayed shake/ragdoll push/breakable ring/delayed boom), 28 s reload. |
| `mortarRack` | **Mortar Rack** | 6 rounds, 0.5 s cadence, 6.5 s reload; hold for landing circle (25–180 m, ~2.5 s flight at 100 m), release fires high arc. Tap `3`/`4`/`5` cycles **HE** (6 m, 260 dmg), **WP** (9 m white-hot burning patch for 14 s + white smoke plume), and **Cluster** (32 bomblets over 18 m circle). |
| `fpvHive` | **FPV Drone Hive** | 4-drone stock (rebuilds 1 every 4 s; pooled cap 4/mech, 16/co-op); launches 0.15 s apart (holding prefers crosshair targets); 28 m/s, 60 m search, distinct targets, 4 m / 200 dmg blast, 20 HP shootable. |
| `pointDefence` | **Point Defence** | Passive APS turret (no key): intercepts enemy rockets/grenades/mortars within 15 m (6 charges, 0.6 s cd, 3 s refill) + clips infantry within 6 m (12 dmg, 3/s). |
| `flareRack` | **Countermeasure Rack** | Passive upgrade to `Q` smoke: 6 charges (was 3), 7 s refill (was 14 s), 1.5× smoke wall + auto-flares on incoming enemy missile lock once every 5 s (free). |

### Legs (`src/frame/move/gait/`)

| Id | Name | Numbers & Behavior |
|---|---|---|
| `legsStandard` | **Standard Legs** | Baseline 7 m/s walker (`×1.0` all stats). |
| `legsSprinter` | **Sprinter Legs** | Reverse-jointed light gait: walk ×1.30, jet launch ×1.6, stomp ×0.6, leg armour ×0.7. |
| `legsHeavy` | **Pile-Driver Legs** | Heavy slow gait: walk ×0.75, jet launch ×0.5, stomp ring ×1.5 with damage/push ×2.2, leg armour ×1.6, knockback-immune. |
| `legsTreads` | **Treads** | Tank base: flat ×1.25, slopes/rubble ×0.6, hull turn ×0.5 (free turret aim), no hop (except flying engines), no aim sway, no stomp — crushes enemies driven over (300 dmg), hull armour ×1.2. |
| `legsSpider` | **Spider Legs** | 4-leg quadruped: walk ×1.0, strafe ×1.4, climbs 45° slopes and 2.2 m ledges, zero view recoil kick, replaces stomp with 360° 5 m leg sweep knockdown. |

### Cockpits (`src/frame/models/cockpit-*.ts`)

| Id | Name | Shoulders | Numbers & Behavior |
|---|---|---|---|
| `cockpitStandard` | **Standard Cockpit** | 1 | Standard armoured canopy (`×1.0`). |
| `cockpitTwin` | **Twin-Mount Cockpit** | 2 | Unlocks Shoulder 2 (`V`); thinner canopy cracks at ×0.7 damage. |
| `cockpitOpen` | **Open Frame** | 3 | Unlocks Shoulders 2 (`V`) & 3 (`B`); open roll-cage with no canopy — front/top hits on the exposed seat route directly to the pilot (`openSeat.ts`), hull ×0.9. |
| `cockpitSensor` | **Sensor Cockpit** | 1 | Thermal brain chip wall-seeing enemy outlines within 70 m (`cockpitSensor.ts`), shared in co-op; hull ×0.9. |

### Engines (`src/frame/move/drive/`)

| Id | Name | Drive | Numbers & Behavior |
|---|---|---|---|
| `engineStandard` | **Standard Engine** | `jets` | 7 m hop, 1.5 s hover, 2.3 s fuel, 2 × 18 m/s Shift charges (3.5 s refill). |
| `engineJet` | **Jump-Jet Engine** | `flight` | Walk ×1.2, unlimited-ceiling Space flight (14 m/s air), Shift 32 m/s 0.6 s omnidirectional jet blast (costs 1 s fuel), 4 s fuel (1.2 s delay, 3 s refill). |
| `engineRotor` | **Rotor Engine** | `hover` | Walk ×0.9, Space climbs up to 14 m and hovers indefinitely at zero fuel cost (9 m/s omnidirectional strafe), no Shift charge, ×1.25 hull damage while airborne. |
| `engineAfterburner` | **Afterburner** | `afterburner` | Normal walk/hop (no hover); Shift airborne enters 48 m/s jet mode (wings/legs folded, 70°/s turn cap, mouse pitch climb/dive, 7 s fuel, arms locked forward, crouch = ×1.5 dive-bomb stomp). |
| `engineOvercharge` | **Overcharge Engine** | `overcharge` | Walk ×1.45, 3 × 26 m/s 0.7 s Shift charges (2.5 s refill), weak hop (×0.5 fuel). |
| `engineDiesel` | **Long-Haul Engine** | `diesel` | Walk ×0.95, hold Shift for steady 11 m/s sustained run up to 12 s (tramples small enemies, refills in 4 s), normal hop (×1.3 fuel). |

**Co-op wire.** `kitIds(loadout)` encodes 8 part indices into `FRAME_PART_ORDER` (5 single slots + 3 shoulders, `-1` for empty; legacy 7-id and bare 13-number poses still decode cleanly). `MechPose` carries `MECH_FIRING`, `MECH_FIRING_RIGHT`, `MECH_JETS`, `MECH_PARKED`, `MECH_FLYING`, `MECH_HOVERING`, `MECH_JETMODE`, and `MECH_ARMS_LOCKED`. New arm/shoulder weapon FX dispatch via `MechKind` wire notes (`vulcan30`, `beam`, `cluster`, `shotgun`, `storm`, `mirv`, `wire`, `mortar`, `fpv`, `pointdef`) to each plug-in's `remoteNews` / `remoteFiring`.

## Files

| File | Holds |
|---|---|
| `data.ts` | Core constants (`FRAME`), `FRAME.hull`, `framePlan`, URL flags |
| `loadout.ts` | Full 37-part catalogue (`FRAME_PART_ORDER`, `FRAME_PARTS`), `MAX_SHOULDERS = 3`, `frameStats`, `kitIds`/`kitFrom`, storage |
| `arms/` | Arm weapon plug-in registry (`registry.ts`, `types.ts`, `shared.ts`) + `rotary.ts`, `cannon40.ts`, `howitzer105.ts`, `vulcan30.ts`, `beam.ts`, `cluster.ts`, `shotgun.ts` |
| `shoulders/` | Shoulder weapon plug-in registry (`registry.ts`, `types.ts`) + `pod6.ts`, `storm.ts`, `mirv.ts`, `wire.ts`, `mortar.ts`, `fpv.ts`, `pointdef.ts`, `flares.ts` |
| `move/` | Movement plug-in registry (`registry.ts`), leg gaits (`gait/{walker,sprinter,heavy,treads,spider}.ts`), engine drives (`drive/{jets,flight,hover,afterburner,overcharge,diesel}.ts`) |
| `models/` | Sculpted bevelled 3D models for every arm, shoulder, leg, cockpit, and engine (`shared.ts`, `shoulders.ts`, `engine-kit.ts`, per-part model files) |
| `bomblets.ts` | Shared pooled wall-bouncing `bombletCarpet` used by Bomblet Cannon and Mortar Cluster |
| `cockpitSensor.ts`, `openSeat.ts` | Sensor Cockpit 70 m Thermal outlines and Open Frame exposed seat hit routing |
| `controller.ts`, `seat.ts`, `weapons.ts`, `parts.ts`, `arms.ts`, `cockpit.ts`, `puppet.ts` | Walker physics, persistent Frame vehicle, gun/shoulder coordinator, locational armour, model assembly, co-op puppet |
| `src/fx/recipes/megaBlast.ts`, `megaBlastWave.ts`, `redBeam.ts` | Wave-timed 4-stage `megaBlast` explosion and pooled Red Beam FX |
| `src/ui/screens/frameLoadout.ts`, `framePreview.ts` | Frame Loadout screen with live stats, keybinds, and rotating 3D custom mech preview |

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
