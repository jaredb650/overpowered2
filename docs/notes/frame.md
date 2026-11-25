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

## Loadout & Part Catalogue (Overhaul v2 · 2026-11-25)

The Frame is built from **9 customizable slots** (`src/frame/loadout.ts`, zero Three.js), configured in the **Bureau Hangar Garage** (`src/ui/screens/frameLoadout.ts` + `src/ui/css/frameGarage.css` + live orbit/zoom 3D turntable in `src/ui/screens/framePreview.ts`) with 6 one-click quick-build presets (`BUREAU STANDARD`, `CYBER SAMURAI`, `NAPALM JUGGERNAUT`, `HOVER GUNSLINGER`, `DRIFT WRECKER`, `CHITIN SKIFF`) and saved in `op2.frame.loadout.v1`. All parts are currently free.

**The default** (`DEFAULT_FRAME_LOADOUT`) remains the original Distraint Frame: 20 mm Rotary left, 40 mm Autocannon right, Six-tube Missile Pod, Standard Legs, Standard Cockpit, Standard Visor Head, Standard Engine, Tactical Smoke, Bureau Slate paint (`frameStats` multipliers all `1`). Campaign story beats (`board`, `kneel`) still build the default Frame; Foreclosure's `installWeapon('howitzer105')` swaps only the right arm. Call-ins (`frameDrop.ts`) and `/?map=range&frame=1` wear the saved loadout.

### Arm Weapons (`LMB` left / `RMB` right · tap `1` left ammo / tap `2` right ammo · `R` reload) — 14 Weapons

| Id | Name | Numbers & Behavior |
|---|---|---|
| `rotaryL/R` | **20 mm Vulcan Rotary** | 6 barrels; 0.25 s spin-up; 24 rds/s STD (`68` dmg, 0.7 m burst) / 16 rds/s AIRBURST (tap `1`/`2`); ~6.7 s to overheat, 2.2 s vent. |
| `cannonL/R` | **40 mm Autocannon** | 10-shell mag, 0.28 s cadence, 3.8 s reload; HE / AP / FLAK cycled on tap `1`/`2` independently per arm. |
| `howitzerL/R` | **105 mm Howitzer** | 1-shell breech, 3.1 s auto-reload; monolithic shell with 22 m shockwave knockdown. |
| `vulcan30L/R` | **30 mm Rotary Cannon** | 3 barrels in rounded triangle; 0.35 s spin-up, 14 rds/s; ~5.0 s continuous fire to overheat, 2.5 s vent; HE / AP / FLAK cycled on tap `1`/`2`. |
| `beamL/R` | **Red Beam** | Hold 1.6 s to charge (walk ×0.6); release fires 1.0 s continuous 1.4 m beam to 180 m piercing 3 walls, 900 dmg to bosses, 9.0 s cooldown. |
| `clusterL/R` | **Bomblet Cannon** | 1-shell breech, 3.6 s reload; bursts 7 m short of first enemy/wall, throwing 28 wall-bouncing bomblets across ~14 m × 9 m. |
| `shotgunL/R` | **Mech Shotgun** | 6-shell tube, 0.42 s semi-auto, 26 heavy pellets in 5.5° cone, 85 dmg/pellet to 25 m, interruptible shell-by-shell reload. |
| `grenadeL/R` | **60 mm Grenade Launcher** | 6-round rotary drum, 0.52 s cadence, 2.9 s reload. Tap `1`/`2` switches **HE** (7.5 m, 290 dmg + concussive impulse) and **NAPALM** (8.5 m burning zone for 10 s + 42 DPS + 150 direct impact). |
| `swordL/R` | **Plasma Energy Sword** | Zero-ammo heat-gated energy broadsword with live ignited plasma blade. Tap `1`/`2` switches **CLEAVE** (tap = 2-hit 160° horizontal lunge sweep, 9 m, 420 dmg; hold = 360° whirlwind, 10 m, 680 dmg) and **BEAM WAVE** (vertical crescent wave projectile to 38 m piercing enemies, 320 dmg). |
| `bunkerL/R` | **Pile Bunker** | Hydraulic melee spike. Tap = quick jab (6 m, 450 dmg, 1.4 s cd); hold 0.65 s = super-heated detonation thrust (7.5 m, 1,450 dmg + 6 m concussive cone, 3.8 s cd). |
| `shieldL/R` | **Energy Pulse Shield** | Projected translucent hexagonal barrier (`850 HP` heat capacity). Hold to block frontal 110° damage (`75%` reduction + `90%` parry window in first 0.4 s + pulse shockwave on parry). |
| `flamerL/R` | **Thermite Flamethrower** | Continuous pressurized stream to 24 m; 100-unit fuel tank; ignites enemies & leaves 6 s burning puddles; ignores armor. |
| `plasmaL/R` | **Plasma Rifle** | Semi-auto bolt (3.2/s, 4.5 m plasma bubble, 130 dmg + stagger). Hold 0.9 s for **Supercharge** (10 m plasma sphere, 480 dmg + 3 s plasma DoT). |
| `railL/R` | **Linear Rail Rifle** | Precision electromagnetics (14-rd mag). Tap = 180 dmg hitscan (2.8/s); hold 0.8 s = 620 dmg hyper-velocity slug piercing 5 targets + 1 wall. |

### Shoulder Weapons (`G` slot 1 / `V` slot 2 / `B` slot 3 · tap `3`/`4`/`5` cycle round) — 13 Weapons

| Id | Name | Numbers & Behavior |
|---|---|---|
| `pod6` | **Six-tube Missile Pod** | Hold to paint up to 6 targets (0.11 s/mark to 200 m), release fires 6 homing missiles (145 direct, 115 in 4.2 m); 8.5 s reload. |
| `stormPod` | **Metal Storm Pod** | Hold to paint up to 8 targets + 0.7 s charge; release snaps 120 rds × 30 dmg across painted targets, 7.5 s reload. |
| `mirv` | **MIRV Launcher** | Hold to place ground marker; launches to +70 m, dives, splits at 25 m into 8 homing sub-missiles (5 m, 220 dmg each), 11 s reload. |
| `wireBomb` | **Guided Heavy Missile** | Slow 16 m/s agile missile steered live to crosshair, detonates via `megaBlast` (26 m kill radius, 70 m shockwave), 28 s reload. |
| `mortarRack` | **Mortar Rack** | 6 rounds, high arc to 25–180 m. Tap `3`/`4`/`5` cycles **HE** (6 m, 260 dmg), **WP** (9 m white-hot burn for 14 s), and **Cluster** (32 bomblets). |
| `fpvHive` | **FPV Drone Hive** | 4-drone stock (rebuilds 1 every 4 s); 28 m/s autonomous seekers, 4 m / 200 dmg blast, 20 HP shootable. |
| `pointDefence` | **Point Defence** | Passive APS turret: intercepts enemy rockets/grenades/mortars within 15 m + clips infantry within 6 m. |
| `flareRack` | **Countermeasure Rack** | Passive upgrade to `Q`: double charges, half refill, 1.5× smoke wall + auto-flares on incoming missile lock. |
| `twinGrenade` | **Twin Shoulder Grenade Cannon** | Twin-barrel dual-arc mortar barrage; 2-shell burst (HE or Napalm cycled via `3`/`4`/`5`), 7.0 m splash, 4.5 s reload. |
| `laserOrbit` | **Laser Orbit Drones** | Deploys 2 glowing orbit pods circling the chassis for 14 s, auto-zapping nearest enemies within 35 m with crimson beams (55 dmg / 0.45 s), 12 s cd. |
| `arcNeedle` | **Arc Stun Needle** | Instant rail-dart (340 dmg + 6 m chain lightning stunning 4 nearby enemies for 2.5 s + boss weakspot bonus), 4.0 s cd. |
| `plasmaMissiles` | **Vertical Plasma VLS** | Fires 6 vertical plasma missiles arching down onto painted targets; creates overlapping 7 m plasma DoT fields (160 impact + 35 DPS for 4 s), 9.5 s reload. |
| `shoulderGatling` | **Shoulder Gatling** | Autonomous 18 rds/s 20 mm suppression rotary firing toward crosshair while tapped/held; shares own heat gauge (3.8 s continuous, 2.0 s vent). |

### Full-Body Chassis (`src/frame/models/chassis/` & `cockpit-*.ts`) — 8 Silhouettes

| Id | Name | Shoulders | Numbers & Silhouette |
|---|---|---|---|
| `cockpitStandard` | **Standard Bureau** | 1 | Baseline chamfered Bureau obsidian/slate hull (`×1.0`). |
| `cockpitTwin` | **Twin-Mount** | 2 | Twin shoulder yoke unlocking Shoulder 2 (`V`); canopy cracks at ×0.7. |
| `cockpitOpen` | **Open Frame** | 3 | Roll-cage exoskeleton unlocking Shoulders 2 (`V`) & 3 (`B`); front/top seat hits pass to pilot (`openSeat.ts`), hull ×0.9. |
| `cockpitSensor` | **Sensor Recon** | 1 | Thermal brain chip wall-seeing enemy outlines to 70 m (`cockpitSensor.ts`); hull ×0.9. |
| `chassisKestrel` | **Kestrel Interceptor** | 2 | Forward-swept needle torso with glowing intake gills & rear wing-strakes. Hull ×0.82, walk ×1.18, dash cd ×0.80, energy charge ×1.15. |
| `chassisBastion` | **Bastion Juggernaut** | 2 | Massive sloped dreadnought hull with bulldozer chin prow & twin reactive shoulder shields. Hull ×1.45, walk ×0.86, recoil ×0.75. |
| `chassisValkyrie` | **Valkyrie Aero** | 2 | Sleek curved white/metallic high-altitude core with swept wing-fins & twin vector pods. Hull ×0.90, jet fuel ×1.35, air control ×1.30. |
| `chassisChitin` | **Chitin Bio-Core** | 3 | Layered organic overlapping carapace plates with pulsing bio-vents & 3-shoulder bio-mounts. Hull ×1.08, energy charge ×1.25, thermal visor 50 m. |

### Heads (`src/frame/models/heads/`) — 6 Sculpted Assemblies

| Id | Name | Stat & Look |
|---|---|---|
| `headStandard` | **Bureau Visor** | Baseline recessed armored slit visor (`×1.0`). |
| `headDuelist` | **V-Fin Duelist** | Swept ceremonial V-crest antenna, glowing visor slit, chin guard (+15% lock speed, +15% weakspot crit). |
| `headCyclops` | **Mono-Eye Cyclops** | Heavy rounded dome with glowing mono-eye scanning rail (+20% lock range, passive 40 m thermal). |
| `headStealth` | **Faceted Recon** | Low-profile angular stealth faceted hood (-35% enemy lock-on speed, +10% dash regen). |
| `headBunker` | **Bunker Turret** | Thick armored pillbox dome recessed into the collar (+400 flat hull HP, -25% canopy crack rate). |
| `headHalo` | **Seraph Crown** | Floating dual-ring energy halo crown with spire crest (+25% energy recharge, +15% Core Expansion radius). |

### Legs (`src/frame/move/gait/`) — 8 Locomotion Systems

| Id | Name | Numbers & Behavior |
|---|---|---|
| `legsStandard` | **Standard Legs** | Baseline 7 m/s walker (`×1.0` all stats). |
| `legsSprinter` | **Sprinter Legs** | Reverse-jointed light gait: walk ×1.30, jet launch ×1.6, stomp ×0.6, leg armour ×0.7. |
| `legsHeavy` | **Pile-Driver Legs** | Heavy slow gait: walk ×0.75, jet launch ×0.5, stomp ring ×1.5 with damage/push ×2.2, aimed mid-air slam, leg armour ×1.6, knockback-immune. |
| `legsTreads` | **Treads** | Tank base: flat ×1.25, slopes/rubble ×0.6, hull turn ×0.5, no hop, no aim sway, crushes enemies driven over (300 dmg), hull armour ×1.2. |
| `legsSpider` | **Spider Legs** | 4-leg quadruped: strafe ×1.4, climbs 45° slopes and 2.2 m ledges, zero view recoil kick, 360° 5 m leg sweep knockdown. |
| `legsHover` | **Mag-Skiff Hover Skirt** | Ground-effect hovercraft floating 0.65 m off the deck: walk ×1.35, strafe ×1.65, zero aim sway, glides over terrain & hazards, leg armour ×0.85. |
| `legsWheels` | **High-Speed Drift Wheels** | 4 rugged armored assault wheels: flat ×1.55, drift-boosts through corners (`Shift` power-slide leaves spark trails & knocks enemies aside for 260 dmg), zero hop. |
| `legsAeroQuad` | **Aero-Quad Hover Legs** | 4 articulated stabilizer legs with vector thrusters: hold `Space` in mid-air to lock altitude and strafe at 13 m/s as a hovering gun-platform (`hoverGunPlatform`), zero recoil while hovering. |

### Engines (`src/frame/move/drive/`) — 9 Propulsion Drives

| Id | Name | Drive | Numbers & Behavior |
|---|---|---|---|
| `engineStandard` | **Standard Engine** | `jets` | 7 m hop, 1.5 s hover, 2.3 s fuel, 2 × 18 m/s Shift charges (3.5 s refill). |
| `engineJet` | **Jump-Jet Engine** | `flight` | Walk ×1.2, unlimited-ceiling Space flight (14 m/s air), Shift 32 m/s jet blast, 4 s fuel. |
| `engineRotor` | **Rotor Engine** | `hover` | Walk ×0.9, Space climbs up to 14 m and hovers indefinitely at zero fuel cost (9 m/s strafe), ×1.25 hull dmg airborne. |
| `engineAfterburner` | **Afterburner** | `afterburner` | Shift airborne enters 48 m/s jet mode (7 s fuel, arms locked forward, crouch = ×1.5 dive-bomb stomp). |
| `engineOvercharge` | **Overcharge Engine** | `overcharge` | Walk ×1.45, 3 × 26 m/s Shift charges (2.5 s refill), weak hop (×0.5 fuel). |
| `engineDiesel` | **Long-Haul Engine** | `diesel` | Hold Shift for steady 11 m/s sustained run up to 12 s (tramples small enemies), ×1.3 hop fuel. |
| `engineBlink` | **Quick-Boost Blink** | `blink` | 4 micro-charges (1.4 s refill); `Shift` triggers instant 14 m burst with 0.25 s i-frame flash & plasma afterimage; walk ×1.12. |
| `engineRedline` | **Redline Overdrive** | `redline` | Draining fuel to 0% triggers a 4 s Redline Surge (+35% speed, +25% energy recharge, red exhaust trails) followed by rapid 70% refill. |
| `engineAssault` | **Assault Boost Core** | `assault` | Hold `Shift` to sprint forward at 36 m/s (consuming fuel) while firing BOTH arm weapons forward with 40% frontal damage reduction; releasing `Shift` into melee triggers a 550 dmg Boost Kick! |

### Core Expansions (`Q` key · `src/frame/expansions/`) — 5 Tactical Abilities

| Id | Name | Numbers & Behavior |
|---|---|---|
| `expSmoke` | **Tactical Smoke** | Classic regenerating smoke wall, flares, and 6.5 m concussive pulse around the legs. |
| `expNova` | **Assault Armor Nova** | 1.2 s charge then 18 m omnidirectional energy detonation (650 dmg + clears incoming projectiles + massive knockback), 22 s cd. |
| `expAegis` | **Pulse Armor Aegis** | Wraps the Frame in a 1,800 HP translucent energy overshield shell for 12 s; absorbs all hits cleanly, 28 s cd. |
| `expDome` | **Bunker Dome** | Drops a stationary 12 m geodesic force-field dome (`3,200 HP`, 15 s); allies shoot out, enemy fire blocked, 32 s cd. |
| `expTerminal` | **Terminal Overdrive** | Auto-triggers at 1 HP (or manual `Q` under 25% HP): 2 s invulnerability + 1,200 HP overshield + 14 m shockwave, once per 90 s. |

### Paint & Liveries (`src/frame/models/palette.ts`) — 10 Presets + Custom 4-Color Tint

`paintBureau` (Bureau Slate), `paintCrimson` (Crimson Ace), `paintArctic` (Arctic Ops), `paintHazard` (Hazard Demolition), `paintOlive` (Olive Drab), `paintStealth` (Stealth Obsidian), `paintCobalt` (Cobalt Vanguard), `paintDesert` (Desert Storm), `paintChrome` (Chrome Experimental), `paintToxic` (Toxic Hive) — plus live 4-color custom tint pickers (`primary`, `secondary`, `accent`, `glow`) that repaint every chassis, head, leg, engine, and weapon model in real time.

**Co-op wire.** `kitIds(loadout)` encodes 11 part indices into `FRAME_PART_ORDER` (`leftArm`, `rightArm`, `legs`, `cockpit`, `engine`, `shoulder0..2`, `head`, `expansion`, `paint`; `-1` for empty). Legacy 8-id, 7-id, and bare 13-number poses decode cleanly via `kitFrom()`. `MechPose` carries `MECH_FIRING`, `MECH_FIRING_RIGHT`, `MECH_JETS`, `MECH_PARKED`, `MECH_FLYING`, `MECH_HOVERING`, `MECH_JETMODE`, and `MECH_ARMS_LOCKED`. All v2 weapons & expansions replicate via `MechKind` wire notes (`grenade`, `sword`, `bunker`, `shield`, `flamer`, `plasma`, `rail`, `twinGrenade`, `laserOrbit`, `arcNeedle`, `plasmaMissiles`, `shoulderGatling`, `expNova`, `expAegis`, `expDome`, `expTerminal`).

## Files

| File | Holds |
|---|---|
| `data.ts` | Core constants (`FRAME`), `FRAME.hull`, `framePlan`, URL flags |
| `loadout.ts` | Full 78-part v2 catalogue (`FRAME_PART_ORDER`, `FRAME_PARTS`), 6 presets (`FRAME_PRESETS`), `MAX_SHOULDERS = 3`, `frameStats`, 11-id `kitIds`/`kitFrom`, storage |
| `arms/` | Arm weapon plug-in registry (`registry.ts`, `types.ts`, `shared.ts`) + 14 arm plug-ins (`rotary`, `cannon40`, `howitzer105`, `vulcan30`, `beam`, `cluster`, `shotgun`, `grenade`, `sword`, `bunker`, `shield`, `flamer`, `plasma`, `rail`) |
| `shoulders/` | Shoulder weapon plug-in registry (`registry.ts`, `types.ts`) + 13 shoulder plug-ins (`pod6`, `storm`, `mirv`, `wire`, `mortar`, `fpv`, `pointdef`, `flares`, `twinGrenade`, `laserOrbit`, `arcNeedle`, `plasmaMissiles`, `shoulderGatling`) |
| `move/` | Movement plug-in registry (`registry.ts`), 8 leg gaits (`gait/{walker,sprinter,heavy,treads,spider,hover,wheels,aeroQuad}.ts`), 9 engine drives (`drive/{jets,flight,hover,afterburner,overcharge,diesel,blink,redline,assault}.ts`) |
| `expansions/` | Core Expansion plug-ins (`nova.ts`, `aegis.ts`, `dome.ts`, `terminal.ts`, `visuals.ts`) |
| `models/` | Palette resolver (`palette.ts`), shared beveled primitives (`shared.ts`), 8 chassis (`chassis/` + `cockpit-*.ts`), 6 heads (`heads/`), all arm/shoulder/leg/engine 3D builders |
| `bomblets.ts` | Shared pooled wall-bouncing `bombletCarpet` used by Bomblet Cannon and Mortar Cluster |
| `cockpitSensor.ts`, `openSeat.ts` | Sensor Cockpit & Chitin Bio-Core Thermal outlines and Open Frame exposed seat hit routing |
| `controller.ts`, `seat.ts`, `weapons.ts`, `parts.ts`, `arms.ts`, `cockpit.ts`, `puppet.ts` | Walker physics, persistent Frame vehicle, 1P/3P camera (`X`/`Z`), weapon & expansion coordinator, locational armour, model assembly, co-op puppet |
| `src/fx/recipes/megaBlast.ts`, `megaBlastWave.ts`, `redBeam.ts` | Wave-timed 4-stage `megaBlast` explosion and pooled Red Beam FX |
| `src/ui/screens/frameLoadout.ts`, `framePreview.ts`, `src/ui/css/frameGarage.css` | 3-column Bureau Hangar Garage with 9-slot selector, 6 presets, live stat bars, custom 4-color paint picker, and interactive orbit/zoom 3D turntable |

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
