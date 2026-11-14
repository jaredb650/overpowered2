# Enemy vehicles

`src/enemies/vehicles/`, sections 17 and 22 of DESIGN.md, `docs/campaign/MISSION.md` for where they go. `EnemyManager.vehicles` builds only on the Outpost, a mission or the Test Range. On the swarm it is null and nothing here runs. The header of each file says what it holds.

## What is built

| Kind | Name in play | Bullets | Dies to | Weapons |
|---|---|---|---|---|
| `humvee` | Scout car | Count, cab goes through to the driver | About a magazine, one rocket, a grenade or two | Roof gun with a real gunner |
| `truck` | Troop truck | Count, as above | The same, a little more | Roof gun with a real gunner, men out of the back |
| `tank` | Main battle tank | Sparks and the armour marker | Direct rockets and shells. Five on the hull, measured with the real launcher, and three on the engine | Laid main gun, roof gun |
| `chopper` | Attack helicopter | Nothing, but the door gun counts on tail, rotor and cockpit (`SKIN_BULLETS`, 0.22 of a round: 13 of its 60 now, 30 times a second, where the M134 did 4.8 sixty times) | Tail or rotor off, one perfect autocannon round in the cockpit, or enough of anything else that is direct | Chin gun, rocket salvos |

**Locational damage.** Each part in `data.ts` is a box and a real collider, so what the bullet stops on is what took the hit.

| Part | Breaks at | What it does |
|---|---|---|
| Track | 190 | Stops the tank where it is. The turret still fights |
| Engine | 420 | Top speed 45%, reload 1.6 times longer, burns 14 health a second |
| Turret | 460 | Ring jammed: 22% traverse, and the roof gun goes |
| Tail | 200 | Spins and comes down over about 4 s |
| Rotor | 420 | Drops like a stone. Two rockets, because its box is wide and a near miss from below lands on it |
| Cockpit | none | 1.6 times, and 5 times on top for an aimed shell |

**Weak points** (`weak` in `data.ts`, found by `Vehicle.weakAt` from where the round landed, not by a collider). A rocket or
shell direct hit, or a Sabot dart, that lands in one takes at least its share of the whole machine, plays
`vehicle_weak_point` and shows the broken-armour marker. The Sabot is the one bullet that hurts armour anywhere
(`SABOT_ON_ARMOUR`, a tenth of its 600); weak points are where it counts.

| Weak point | Where | Rockets to kill | Sabot darts | Also |
|---|---|---|---|---|
| Roof | The hatch on top of the turret, turning with it | 1 | 2 | "THROUGH THE HATCH" |
| Ring | The thin band under the turret's overhang | 2 | 4 | Locks the main gun: it stops turning, reloads 2.5 times slower and fires where it points. The roof gun still turns |
| Vents | The engine deck | 2 | 8 | |
| Pilot | The glass over the helicopter's pilot | 1 | 1 | "PILOT DOWN" |
| Tail rotor | The end of the tail boom | | | Takes the tail: it spins down |

A soft-skin at 28% health stops, its men get out, and it goes up 4.5 s later unless something finishes it first. Shooting the driver through the cab stops it dead with the horn stuck on.

## Using it

A mission orders them with the `vehicle` step. `state: 'parked'` is a machine with nobody in it and `state: 'wrecked'` is one that died before this beat: both go on nobody's books. `holds` drives the route tail first, keeps it there, and turns to the mark's `yaw`. A held tank's wreck has `keep`, so nothing clears it.

```ts
const v = ctx.enemies.vehicles;
v.spawnGround('truck', { x, y, z, route: [{ x, z, hold: 0 }], tag: null, crew: ['trooper'], crewTag: null, holds: false, holdYaw: NaN, parked: false });
v.spawnChopper(from, marks, null);      // replaces any chopper already up
v.describe();                           // one read of everything
```

`vehicle:destroyed` is the event. At most one chopper is alive: a mission's second order waits for the first to go. Eight ground vehicles at once and 14 wrecks, oldest first, except any with `keep`.

**Air to air.** `GunnerStrike.scan` flies the player's pilot at the enemy chopper when one is up. The enemy chopper drops 16 m under the player's aircraft and bursts of its gun cost him 1.2 s of seat time each.

**The ride.** A `ride` step with a route is `progression.boardFlight`, on `src/vehicles/flight.ts`: the Packmule follows the marks, calls `ride:<mark>`, cannot be left, and its belt never runs out. A mark with `hit: true` sets it on fire. The body waits at the last mark, and the aircraft stays there with its rotors running down.

**Painted by the Quiver.** `paintable(out)` lists every live vehicle and the chopper for the player's launcher, and a `Vehicle` is a `MissileTarget` as it stands: `center`, `alive`, and two getters, `aimLift` (half the roof height on the ground, 0 on the chopper, so a missile flies at the hull and not the wheel base) and `paintRadius` (its larger half extent, so its own hull is not cover in front of it on the line-of-sight ray, and so a spare mark prefers it). One salvo took a tank from 1000 to dead on the range: four direct hits at the shaped charge's double, 220 each, and their splash.

**Lab.** On `/?map=range` the panel has a row of vehicle buttons. AI off parks one at the crosshair to shoot at. AI on drives it in past the player, with men, shooting. `tools/scripts/vehicles-live.mjs` is the bot, with `VEHICLES_STEP` set to `models`, `fight`, `threat`, `wreck`, `air`, `dogfight` on the range or Kill House, and `soft`, `heavy`, `turn`, `insertion` on the real map.

**The main menu flies the Packmule too.** `src/ui/backdrop/cabin.ts` builds `UTILITY_AIRFRAME` and the `M134` spec from `src/vehicles/` into its
own scene with plain materials, so a change to the cabin, the door or the gun shows in the menu's background as well. The spec is still
named `M134`, and is the 20 mm rotary cannon since the door gun's rework: thicker barrels on a wider circle, in a muzzle clamp. It adds a lining over the
forward bulkhead, because the cabin's front wall and the nose's end cap share the plane z = 2.5 and fight where both can be seen from inside,
and some fittings only the menu has: hazard stripes on the sill, a seal and grab handle on the forward door post, and a pedestal from the
pintle down to the sill, with an ammunition can at the end of the feed chute. In the game the gunner holds the gun and nothing shows under
the pintle; parked and unmanned, it needed a stand.

## Why it is like this

- **No physics bodies.** A kinematic chassis along a route, with weight added by `Driver`: limited acceleration, a braking curve worked out from the road left, wheels that lag the driver, and a spring under the body. A tank a blast can shove is a tank that can leave the road and strand a mission.
- **Moved colliders, like the campaign's doors.** One per part, and they stay with the wreck as cover.
- **The roof gunner is a real soldier**, pinned to the seat with no brain, so he can be shot off it and gore works. If his legs go he falls off, and the gun stops.
- **The tank's gun is a rhythm.** Traverse, lay with the laser up, a window to move, fire. It remembers for 8 s, so hiding from it does not stop the shell.
- **Wrecks are shut doors to the soldiers.** `closeGround` takes the ground off the route graph. They are not in the cover map, which is built at load, so men do not choose to use one.
- **Men have no bodies.** `shoveFrom` moves them out of vehicles and wrecks.

## Not done

- No vehicle shows on the minimap, apart from a roof gunner.
- Drones and ATVs from section 17 are not built.
- Men in a truck are not visible until they get out.

# Mounted guns

`src/vehicles/emplacement.ts`. A heavy gun on a tripod behind a steel shield, that any map can place and anyone can man.
Piece 3 of `docs/proposals/outpost-defense.md`.

## Using it

- **A map** calls `spec.emplacement(x, y, z, yaw, arc = 1, level = 1)` in its author function: the tripod's foot, a facing as a
  camera's yaw (0 looks down -Z) and the radians it swings either way. The call-in manager builds them on the first run and
  they stay for every run after. The Test Range has two at (-5, 0, 10) and (5, 0, 10), facing down the field.
- **The lab:** `Mounted gun` (next to Kill all) puts one on the floor under the crosshair, facing away from the player.
  Pressed again with the crosshair on that gun, it goes up a level (1, 2, 3, 1).
- **The player** walks up (1.7 m of the gun or the spot behind it) and presses E (the prompt says `E MAN GUN`). Fire shoots,
  aim zooms, E leaves. The player's own gun is holstered while on it. Death, a new run or another seat empties it.
- **Code:** `CallInManager.emplacements` (an `Emplacements`) has `place(spec)` and `all`. Each `Emplacement` has `upgrade(level)`,
  `levelNumber`, `heat` and `occupant`.

## The gun

The player goes through the gunner's seat (`GunnerSeat` in `seat.ts`) with the plan's `exposed` set: the body is parked at the
spot behind the gun with `player.park(feet, true)`, which keeps it still but lets hits through. No shell, no silhouettes
through walls, no cut flash, no grace on the way out. The HUD is the gunner's overlay in tone `mount`: no clock, no sensor
readouts or brackets, the health bar stays up, and the bar under the sight is heat (`OVERHEAT` in red while locked out).

The shield is a steel box collider that swings with the gun. Enemy rounds stop on it, and the gunner's head and shoulders
(eye at 1.62 m) stand above every rung's plate, so he can be shot; blasts reach him as anywhere. Rounds leave the muzzle,
ahead of the shield, toward the point under the sight, or straight down the bore when the sight is on something within 4 m.
**The gun cannot be destroyed**, for now.

| Level | Gun | Rate | Damage | Heat | Shield (w, top) | Sound |
|---|---|---|---|---|---|---|
| 1 | M2 .50 (`HMG`) | 8/s | 70, 1.2 m pen | 64 rounds (8 s) to overheat | 1.1 m, 1.28 m | `hmg_shot` |
| 2 | M2A1 .50 | 11/s | 70, 1.2 m pen | 88 rounds (8 s) | 1.6 m, 1.36 m | `hmg_shot` pitched 1.1 |
| 3 | M134 rotary (the door gun's model) | 33/s after a 0.6 s spin-up | 32, 0.4 m pen | 200 rounds (6 s) | 1.6 m, 1.36 m | the `minigun_*` five, as the door gun plays them |

Heat (`Heat`): each round adds `heatPerShot`, off the trigger it falls at `cool` (0.25 to 0.3 a second). At 1 the gun locks out
(`steam_burst`, and `weapon_dry` on a pull) and vents at `vent` (0.33 to 0.4 a second) all the way to 0 before it fires again,
about 2.5 to 3 s. Ammunition never runs out. The numbers are `MOUNT_LEVELS`, data for a shop to sell.

## For allies

An AI mans a gun with `occupy(who)` (false if taken), points it with `aimAt(point)`, holds the trigger with `trigger(held)` and
gets off with `vacate(who)`. It stands at `standAt`. The gun swings toward the point at 2.5 rad/s inside its arc, and heat, the
arc and the rounds are the same code the player goes through. Its rounds are `team: 'player'`, source `emplacement`, so kills
by an ally on a gun count as the player's for now; the ally piece decides that. Nothing about the AI itself lives here.

## Not done

- The gun cannot be destroyed or knocked out, and enemies do not single out a manned gun.
- While seated, enemy grenade flashes and lens blood are skipped, because they read `player.parked`.
