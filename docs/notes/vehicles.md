# Enemy vehicles

`src/enemies/vehicles/`, sections 17 and 22 of DESIGN.md, `docs/campaign/MISSION.md` for where they go. `EnemyManager.vehicles` builds only on the Outpost, a mission or the Test Range. On the swarm it is null and nothing here runs. The header of each file says what it holds.

## What is built

| Kind | Name in play | Bullets | Dies to | Weapons |
|---|---|---|---|---|
| `humvee` | Scout car | Count, cab goes through to the driver | About a magazine, one rocket, a grenade or two | Roof gun with a real gunner |
| `truck` | Troop truck | Count, as above | The same, a little more | Roof gun with a real gunner, men out of the back |
| `tank` | Main battle tank | Sparks and the armour marker | Direct rockets and shells. Five on the hull, measured with the real launcher, and three on the engine | Laid main gun, roof gun |
| `chopper` | Attack helicopter | Nothing, but the door gun counts on tail, rotor and cockpit | Tail or rotor off, one perfect autocannon round in the cockpit, or enough of anything else that is direct | Chin gun, rocket salvos |

**Locational damage.** Each part in `data.ts` is a box and a real collider, so what the bullet stops on is what took the hit.

| Part | Breaks at | What it does |
|---|---|---|
| Track | 190 | Stops the tank where it is. The turret still fights |
| Engine | 420 | Top speed 45%, reload 1.6 times longer, burns 14 health a second |
| Turret | 460 | Ring jammed: 22% traverse, and the roof gun goes |
| Tail | 200 | Spins and comes down over about 4 s |
| Rotor | 420 | Drops like a stone. Two rockets, because its box is wide and a near miss from below lands on it |
| Cockpit | none | 1.6 times, and 5 times on top for an aimed shell |

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
own scene with plain materials, so a change to the cabin, the door or the gun shows in the menu's background as well. It adds a lining over the
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
