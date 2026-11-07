# The Outpost: the mission plan

The single plan for the campaign mission in docs/DESIGN.md section 22. Everyone building the map, the vehicles, the AI, the cutscenes and the voices builds to this. Where this and the code disagree, the code in `src/campaign/missions/` is what plays, and a test fails if the words here drift from it.

- **The mission as rows:** `src/campaign/missions/outpost.ts`, `outpost.places.ts`, `outpost.lines.ts`.
- **The numbers every jump must keep:** `src/campaign/parkour.ts`, proved on the real controller by `parkour.test.ts`.
- **Play it:** Campaign on the menu, or `/?contract=campaign&autostart=1`, with `&beat=<id>` for anywhere. `/?mission=stub&map=killhouse&autostart=1` is the smallest mission there is.

## 1. The shape of it

You are sent to kill one man and everyone who reports to him. The Council bills you for the helicopter. The Commander has done this before: he killed the last contractor, kept his boots, and tells you so. You find that contractor's wreck and his launcher, and that is how you beat the armour. You spend the first half locked out and the second half locked in, on a route that spirals inward and upward round the tower he is sitting in, until you are standing on his roof looking back over everything you burned.

Two ideas carry the whole thing:

- **He is better than you until you learn.** Every stage opens with him ahead. He narrates what his men are about to do, and they do it. The player wins by learning something new, and each time he notices, out loud. That is section 16.5 at mission scale, and it is the F.E.A.R. lesson: an enemy feels clever when it says what it is doing and the level lets it happen.
- **Locked out, then locked in.** Gates are the mission's main verb. The main gate slams in your face. A tank plugs it. You jam it open with the wreck of that tank. The blast door shuts behind you and the line turns: "Let's see how you like it."

### Pacing

First-time play, without deaths, is about 28 minutes. Deaths add a few minutes, and a strong player will do it in about 20. Intensity out of 10, so the rises and the breaths can be seen:

```
 min  beat                 intensity
 0:00 briefing             ##                   dread, dry comedy
 1:00 insertion            #######              the power trip
 3:15 lockout               ####                suddenly small
 4:45 softskins             ######              you can do this
 7:45 breather              ##                  breath
 8:05 heavy                 #########           you cannot do this
 9:35 wreck                 ######              the run for it
10:50 turn                  ##########          payback, the peak of the outside
13:50 breach                #####               the sprint
14:50 barracks              #######             it got quiet and dark
17:20 coolant               ###                 breath, a puzzle
18:05 gallery               ####                alone, a wall
19:05 mess                  ########            the held breath, then all of it
20:35 armoury               ##                  breath, a reward
21:05 plates                ########            the wall of steel
22:50 stack                 #########           up
24:35 commander             ##########          the peak of everything
27:20 ending                #                   the invoice
```

Rule for anyone tuning this: never two 8s without a 4 between them, except the last climb, and the climb is short.

## 2. The site on paper

x runs east, z runs south, y is up, the apron's floor is y 0, and north is -z. A yaw of 0 looks north. The site is 220 m across, and everything a player walks on is inside it. `outpost.places.ts` holds every coordinate below as data.

```
        x:  -110        -78       -40        0        40        78        110
  z:-110     +------------------------------------------------------------+
             |  berm, never walked                                        |
  z: -92     |          T3+===================north wall=============+T4   |
             |            :  ring yard: seen from the air only       :    |
  z: -80     |            :  +----------------------------------+    :    |
             |            :  | COOLANT    WAR ROOM    MESS HALL  |    :    |
  z: -66     |            :  | HALL       (y 10)                 |    :    |
             |            :  |            +------+               |    :    |
  z: -46     |            :  |            |      |               |    :    |
             |  west      G3 | BARRACKS   |STACK | GUARD ARMOURY |    G2 east
  z: -30     |  road      :  | two        |      | PLATE HALL    |    :  road
             |            :  | corridors  +------+               |    :    |
  z: -26     |            :  |            |SALLY |               |    :    |
  z: -12     |            :  +------------[D1]-------------------+    :    |
             |            :     GATE YARD: sandbags, x -30..30        :    |
  z: +12     |          T5+======T1=======[ G1 ]=======T2============+T6   |
             |                                     guardhouse             |
  z: +34     | ==============PERIMETER ROAD========+=========ROAD======== |
             |                 cover line C        |                      |
  z: +42     |                                     |                      |
             |    pump house      cover line B     |      fuel farm       |
  z: +54     |                                     |                      |
             |                    cover line A     |                      |
  z: +70     |        +---------+                                         |
             |        | LZ CUT  |                                 THE     |
  z: +86     |        | y -3    |                                 WRECK   |
             |        +---------+                                         |
  z:+110     +------------------------------------------------------------+
```

### Outside: the apron

| Place | Centre (x, z) | Size | What it is for |
|---|---|---|---|
| LZ Cut | -32, 86 | 34 x 26, floor y -3 | A sunken pad. Revetment walls of exactly 3.0 m on all sides and its ramp blocked by a wrecked truck, so the only way out is a mantle |
| Cover line A | z 70 | HESCO at x -60..-34, -6..20, 40..66 | First cover north of the cut |
| Cover line B | z 54 | HESCO at x -40..-12, 14..44 | Staggered against A, so no straight run north |
| Cover line C | z 42 | Jersey barriers at x -66..-20, 20..66 | Lines the road. The gap in the middle is the Gate Lane |
| Perimeter Road | z 34 | 9 m wide, x -110..110 | Every vehicle comes along it. Trucks stop at x 26 and -26. Tanks stop at x 48 and -48 |
| Gate spur | x 0 | 14 m wide, z 12..34 | The road up to the main gate, and the long look at it |
| Guardhouse | 24, 24 | 12 x 8, roof 3.4 m | Door at each end, so it is a loop as well as cover. Shotgun and ammo inside |
| Pump House | -60, 50 | 14 x 10, roof 3.6 m | Roof is reachable by a mantle. The Judge sits there, off the path |
| Fuel Farm | 60, 52 | 2 tanks, 12 barrels | Beside the east road, so a truck can be set off with a bullet |
| The Wreck | 84, 84 | Hull 20 x 8, deck exactly y 4.2 | The dead contractor's dropship (`dropship` in the kit). SE corner, the far end of the map from the LZ |
| Berms | map edge | 3 to 4 m high | Hide the road entries at x 110 and -110, so vehicles arrive and are not just there |

**Machine-gun lanes.** Three lanes run north to south across the apron: West (x -60..-20), Gate (x -20..20) and East (x 20..60). Towers T1 at (-40, 12) and T2 at (40, 12) look straight down the outer two, 70 m to the cut. Cover lines A, B and C are staggered so each lane can be crossed by bounds but never in one run. A man on T2 sees the Guardhouse's south door and the whole East lane. That is the lesson of the apron: stop running up the middle.

**The wall.** Perimeter x -78..78, z -92..12. 6 m high and 2.4 m thick, with a walkway at y 5. Towers are 5 m square with a platform at y 9: T1, T2 on the south wall and T3 to T6 at the corners. Only the south wall and its towers need to be near-detail. Everything north of the Gate Yard outside the citadel is seen only from the air, at 30 m and up.

| Gate | Where | Width | Used for |
|---|---|---|---|
| G1 main gate | 0, 12 | 14 m, 6 high, two leaves | Slams in `lockout`. Opens 60% for Bulwark in `turn`. Jammed by the wreck after that |
| G2 east | 78, -30 | 10 m | Decoration for the fly-by. Never opens |
| G3 west | -78, -30 | 10 m | Decoration for the fly-by. Never opens |

### The Gate Yard

x -30..30, z -12..10, walled off from the ring yard by blast walls at x -30 and 30. Two sandbag nests at (-14, -6) and (14, -6). The blast door D1 is at (0, -12), 6 m wide and 3.6 m high. The run from the gate to the door is 22 m, deliberately open: that is the slide lesson's run-up.

### Inside: the citadel

x -58..58, z -80..-12. Ground level y 0. Below it, the service level at y -5. The wings are one storey with a roof at y 5. The Stack rises through the middle to a roof at y 14.

The route spirals clockwise: south, west, north, east, then the centre and up. Slit windows from the barracks, the Coolant Hall and the Plate Hall look into the Stack, so the player keeps catching sight of the tower they are circling, with the War Room lit at the top of it.

| Room | Box (x, z) | Level | Notes |
|---|---|---|---|
| Sally Hall | -10..10, -26..-14 | 0 | Three shut doors. West opens for the raid, east opens behind the player later, north stays shut |
| South Corridor | -56..-10, -19..-16 | 0 | 3 m wide, 46 m long, dead straight. A machine gun at the far end owns it |
| North Corridor | -56..-12, -44..-41 | 0 | Parallel to the south one |
| Bunk rooms 1 to 4 | x -22..-12, -33..-23, -44..-34, -56..-45; z -41..-19 | 0 | A door onto each corridor. This is the flanking loop, and it works for both sides |
| Coolant Hall | -56..-14, -78..-46 | 0, open to y 12 | Near platform x -40..-28, z -50..-46, far platform north of z -68, an 18 m gap over a pit at y -6. The side walls are out of reach of the platform, so they cannot be run. Stairs down to the gallery along the far lip, x -24..-14, arriving side-on at the east end of the near deck |
| Cable Gallery | -24..24, -78..-71 | -5, ceiling at -2 | Near deck x -24..-11, far deck x 11..24, a 22 m gap. Headroom exactly 3.0 m. North wall lit along its length. The trench goes down to y -12, with stairs back to the near deck only |
| Mess Hall | 14..56, -78..-46 | 0 | Open floor, overturned tables. Kitchen along the north side is the side route. Stairs up from the gallery arrive in the kitchen |
| East Corridor | 12..56, -44..-41 | 0 | Links the Mess, the Armoury and the Guard Room |
| Armoury | 30..56, -40..-33 | 0 | The breather. Autocannon, health, armour. South door opens onto the Plate Hall |
| Guard Room | 12..29, -40..-33 | 0 | The other way into the Plate Hall, so the room has a loop |
| Plate Hall | 12..56, -32..-16 | 0 | 44 x 16, one long clear hall, the only room built for rockets |
| The Stack | -10..10, -64..-28 | -5 to 14 | The vertical section. Switchback stairs on both long walls, catwalk landings at y 0, 5, 10, and a 5 m wide wall-kick shaft in the north-east corner as the fast way up |
| War Room | -16..16, -78..-66 | 10 | Glass along its south side, looking down the Stack. The player sees him before they can reach him. The middle 6 m pane is the door `warGlass`, which goes as the fight starts. A partition at x -11 hides the stairs to the roof behind `warRoomStairs` |
| Comms Roof | -24..24, -78..-28 | 14 | Open sky, for his mortars. The mast stands at (0, -74), so `roofMast` at (0, -70) is clear ground in front of it. Looks south over the Gate Yard and the whole apron |

**Loops for flanking.** The apron's three lanes. The Guardhouse. Barracks: two corridors joined by four rooms. Mess Hall and kitchen. East Corridor, Armoury, Plate Hall and Guard Room. The Stack's two stairs. No fight inside happens in a room with one way in, because a loop is what lets a squad do something the player can hear coming.

**Sightlines.** Outside, 70 m. In corridors, 46 m along one line and nothing across it. In rooms, 15 to 25 m. Only the Plate Hall and the roof are long inside.

### Where each move is taught

Every size here comes from `src/campaign/parkour.ts`, and `parkour.test.ts` puts it under the real controller with bots sweeping every timing. Do not change one by eye.

| Move | Place | Size | What cannot do it | What can | Measured |
|---|---|---|---|---|---|
| **Mantle** | LZ Cut walls | Ledge 3.0 m | Running at it. No move lifts a player who did not jump | One jump, forward held | Passes |
| **Double jump** | The Wreck's hull | Ledge 4.2 m | One jump | Two jumps from a stand at the hull, or from a run that leaves the ground 5 m or more out | From a run that leaves the ground within 4 m, the second press is a wall kick and throws the player off. The hint says to stand close |
| **Slide** | Blast door D1 | Door 3.6 m high, shuts in 2.8 s, trigger line 22 m out | A full run, and a run with both dashes: the leaf is below standing height when they arrive | A slide pressed anywhere in the last 9 m | Passes. A closing door never buries a body already under it |
| **Dash** | Coolant Hall | Gap 18 m | Double jump, at any timing | Double jump and one dash | Passes |
| **Wall run** | Cable Gallery | Gap 22 m, headroom 3.0 m | Every jump and both dashes at any timing: the longest flights are low and flat, and the ceiling takes their arc away | Wall run, jump off, jump again, from anywhere in the last 8 m of the deck, on a line of 0.3 to 0.4 rad, with about half a second of slack on the moment of leaving. A wall run alone makes it only from the very lip | Passes |
| **All of it** | The Stack's shaft | 5 m wide | Nothing: the stairs are always there | Wall kicks up the shaft, the fast way, for those who want it | Zig-zag proved by `wallBot`, not on this geometry |

Three things a map builder must keep:

- **The gallery's height is the lesson.** Raise the ceiling to 3.2 m and a two-dash flight crosses 24 m. Lower it under 2.8 m and a wall run starts losing its head on the roof. Nothing hangs from that ceiling.
- **Keep run-ups short of a strafe.** All of these were measured from a run at 12.5 m/s. A long enough approach for strafe-jumping at 24 m/s beats any of them. Fifteen metres of approach is plenty.
- **A fall is not a death.** Each gap has stairs back up within 10 m of the bottom. The Coolant pit and the gallery floor sting and do not kill. A lesson the player fails should cost seconds.

A rocket jump will probably beat the Coolant gap. It costs health and it is earned, so that stays. Nobody has measured it. The player has no rockets at the wreck, and the gallery's ceiling should stop one there.

### Explosives against armour

The rule in `SHAPED_CHARGE`: a rocket's direct hit on a body with a plate left does double and goes through the plates, and its splash on that body does 40%. Unarmoured bodies take the blast as written. It is taught three times, each harder.

1. **Bullets do nothing.** Door gun in `insertion`: the M134 sparks off the parked tank while the pilot and the Commander both say so. Then again on foot in `heavy`, with the armour hit marker and "You're knocking. Nobody's home."
2. **Direct hits, on a big target.** `turn`: two tanks and a chopper. Only a direct hit counts, and a near miss visibly does nothing. Tracks stop a tank, which is the player's first small win.
3. **Direct on the plate, splash on the rest.** `plates`, the Plate Hall: two heavy machine gunners walk abreast down a 16 m hall, with four unplated men spread behind them. A rocket on the floor near a heavy does almost nothing, and the same blast takes the men behind him apart. A rocket on his chest drops him. The hall is long and clear so the player has time to try both and see the difference, and the third squad coming through the Guard Room ends any idea of standing still to think.

For that third lesson the men behind must have no plate, so `plate.back` is a squad with `light: true`: their carriers and helmets come off as they spawn, and a rocket's splash takes them as written. A real rocket fired at the floor by the line left a brute untouched and a light rifleman on 29 of 122.

## 3. Weapons

Starts with few, finds the rest. Each one arrives as the answer to something the player has just failed at.

| Weapon | When | Where | Why there |
|---|---|---|---|
| Door gun (M134) | `insertion` | The Packmule | Power fantasy, gone the moment it is over |
| SMG, sword | Start | Issued | Enough to feel underpowered. Sword is the character's own |
| Shotgun, 2 grenades | `softskins` | Guardhouse, (24, 24) | Lies in the path of the first close rush, and the Guardhouse is where a player goes to get out of Tower Two's fire |
| Judge | `softskins`, optional | Pump House roof, (-60, 3.6, 50) | The reward for trying the mantle somewhere nobody told you to |
| **Rocket launcher** | `wreck` | The Wreck's deck, (84, 4.2, 84) | The one find that matters. It is across the whole map from the LZ, under tank fire, up a ledge only the double jump reaches, on the body of the last contractor |
| Kiln | `mess`, optional | Mess Hall kitchen, (50, -74) | A flamethrower in a kitchen, for those who look |
| Autocannon | `armoury` | Armoury, (44, -37) | The reward for the raid, and the second shaped charge, right before the fight that wants one |

A checkpoint promises a kit (`KIT` in `outpost.ts`), so nobody can restart without the gun the next fight needs, and ammo is refilled at every restart. Optional weapons, once taken, stay through every restart. Grenades: 2 with the shotgun, 3 from the raid on. Call-ins and streaks earned in play stay available. They are part of how this game feels, and the Commander has answers for them.

## 4. Beat by beat

Each beat's id is what `?beat=` takes. Lengths are for a first-time player. Men are EnemyIds: `trooper` rifle, `gunner` shotgun, `brute` machine gun, `rocketeer`, `sniper`, `riot` shield, `warden` medic. Never more than 18 hostile at once: anything over waits outside the wire.

### Council briefing: `briefing`

- **Where:** in engine, descending on the compound. Four camera moves in `cutscenes.briefing`. E skips.
- **Player:** watches.
- **Enemies:** none.
- **Next:** the shots end, or a skip.
- **Teaches:** the map, from above: wall, gate, tower, the man in the War Room. The third shot is the Stack and the last is a figure at the War Room glass, so the player has seen where they are going.
- **Length:** 1:00.
- **Job:** dread by bureaucracy. A form is read out and a man is added to an invoice.

> **Council** *(deadpan)*: Contractor. This is the Office of Societal Compliance. You are on a recorded line.
>
> **Council** *(deadpan)*: Form 7742-C. The garrison at The Outpost is in breach of Section 12, Continued Existence. A notice was displayed on their planet for the statutory thirty days.
>
> **Council** *(deadpan)*: Their commanding officer declined to sign for it. He has been added to the invoice.
>
> **Council** *(deadpan)*: You will remove him, and everyone who reports to him. Transport is included one way.
>
> **Council** *(deadpan)*: A previous contractor was assigned to this account. That file is closed. Please do not ask about the deposit.
>
> **Council** *(deadpan)*: The door gun is a courtesy. The Council thanks you for your continued compliance.

### Door gunner: `insertion`

- **Where:** the Packmule's left door, flying `routes.insertion`: in from the south-west, east along the apron, north up the east side, west behind the north wall, south down the west side, down into the cut. Anticlockwise, so the left door faces the wire. Hovers on the marks with a `hold`, about 2:15 in all.
- **Player:** mows down the defenders. Infinite belt, no way to die, no way to leave.
- **Enemies:** 27 over the lap, never all at once. `in.wall` 4 on the south wall, holding. `in.apron` 6. `in.yard` 4 and `in.road` 4 at the gate. `in.ring` 4 with a rocketeer. `in.north` 5.
- **Next:** the ride ends at the cut.
- **Teaches:** that these men scatter, drag each other and shoot back; and that bullets do nothing to the tank parked in the yard at (20, -6). That tank is Bulwark. The player will remember the spark, and will meet it again in the gate.
- **Length:** 2:15.
- **Job:** the power trip, so that losing it hurts. A missile takes it away.

> **Pilot** *(urgent)*: Two minutes to the wire. Door's yours, contractor. Anything on that compound is billable.
>
> **Commander** *(smug)*: Good afternoon. This is the Commander of this outpost. You are firing on a recognised military installation.
>
> **Commander** *(smug)*: A door gun. How traditional. All squads, get under something.
>
> **Pilot** *(urgent)*: That's armour in the yard. Save your belt, it just bounces.
>
> **Commander** *(smug)*: That is a main battle tank. You are not scratching the paint. Do carry on.
>
> **Pilot** *(urgent)*: Missile! Missile! We're hit! Putting her down outside the wire. Brace!
>
> **Commander** *(smug)*: There. Now we can talk properly.

### Landing and lock-out: `lockout`

- **Where:** the LZ Cut, then north up the Gate Lane to G1.
- **Player:** on foot for the first time, with an SMG, in a pit. Climbs out and runs for the open gate.
- **Enemies:** `lz.rim` 4 on the lip of the cut: trooper, gunner, trooper, brute. Whoever the door gun missed is swept off the map as the ride ends, so the player starts against four and not a garrison.
- **Next:** the player crosses the road, 22 m from the gate, and it slams in 1 s. A run with both dashes gets there too late. The lines play out and the trucks are called.
- **Teaches:** **mantle**. The cut's walls are 3 m and the ramp is blocked. Nothing else gets the player out.
- **Length:** 1:30.
- **Job:** suddenly small. After the door gun, one man with a small gun at the bottom of a hole. The gate shutting with the player still running at it is the mission's first punchline.

> **Pilot** *(urgent)*: This is as far as the rental goes. Good luck with the paperwork.
>
> **Commander** *(smug)*: You're on my ground now. I've read your file, contractor. You're not the first.
>
> **Commander** *(smug)*: Close the gate.
>
> **Commander** *(smug)*: We don't take deliveries after four.
>
> **Commander** *(orders)*: All stations, this is Command. One hostile, on foot, outside the wire. Send the trucks.
>
> **Council** *(deadpan)*: Your transport has been marked as damaged. This has been added to your account.

### Soft-skin reinforcements: `softskins`, then `breather`

- **Where:** the apron, from the gate south to the road. Two trucks from the east, then two from the west.
- **Player:** fights in the open under Tower Two, takes the Guardhouse and the shotgun, stops the trucks. Trucks die to bullets: shoot the driver, or a barrel at the Fuel Farm.
- **Enemies:** `soft.truck1` humvee with 3, `soft.truck2` truck with 5, then `soft.tower` one machine gun on T2. When two of the first eight are left, `soft.truck3` with 4 and `soft.truck4` with 4 including a rocketeer. 17 men and 4 vehicles.
- **Next:** both waves cleared. `breather` then holds for 18 s with pickups on the apron, and the Commander's first between-rounds box (`adapt`).
- **Teaches:** cover, the machine-gun lanes, and being flanked, by telling the player it is about to happen. Crews are people. The shotgun, by arriving as the first rush does.
- **Length:** 3:00, then 0:20.
- **Job:** you can do this. It should feel like a hard, fair, even fight, so the next beat lands.

> **Commander** *(smug)*: Two trucks on the east road. Light work. Try to keep up with them.
>
> **Commander** *(smug)*: You shot the driver. Good. That's what I'd have done.
>
> **Commander** *(smug)*: Bravo is going round your left. I'm telling you so that you can watch it happen.
>
> **Commander** *(smug)*: Tower Two has you. He'll stop when you stop.
>
> **Commander** *(irritated)*: West road. Everything we have with wheels.
>
> **Commander** *(irritated)*: Twelve men. I knew nine of them by name.
>
> **Council** *(deadpan)*: Your progress has been noted. Please retain your receipts.

### The heavy assault: `heavy`

- **Where:** the whole apron. Tanks stop on the road at x 48 and -48, looking north and south along the lanes. A hit on cover at a lane's end should bring cover down.
- **Player:** has no answer. Bullets spark off the armour. They survive, and move.
- **Enemies:** `heavy.tank1` from the east, `heavy.tank2` 16 s later from the west. `heavy.truck1` with 4. `heavy.towers` a brute and a sniper. Threat 4.
- **Next:** 26 s in the Council mentions the wreck. The beat ends when the player reaches the eastern apron.
- **Teaches:** that nothing the player owns works on armour. There is no way to win this beat, and the level says so through the hit marker and the Commander, so that **finding the explosive weapon matters**.
- **Length:** 1:30.
- **Job:** you cannot do this. The low point of the outside: the Commander stops pretending to be polite, and then the Council, of all people, helps.

> **Commander** *(irritated)*: Enough. All armour, roll out.
>
> **Commander** *(smug)*: That is a tank. I'd like you to look at it. Now look at your little gun.
>
> **Commander** *(smug)*: You're knocking. Nobody's home.
>
> **Council** *(deadpan)*: Contractor. Our records place a previous contractor's equipment in the south-east corner of the site. Retrieval is at your own risk. It is not covered.
>
> **Commander** *(irritated)*: I know where you're going. We buried him. We didn't bury his kit. I have always regretted that.

### Finding the explosive weapon: `wreck`

- **Where:** the far south-east corner. The wreck of the last contractor's dropship, burned out, with a body in a contractor's suit, bootless, on the deck beside the launcher.
- **Player:** gets to the hull with a tank firing on the open ground behind them. Double jumps to the deck, finds the body, takes the launcher.
- **Enemies:** both tanks still on the map. `wreck.guard` 3 men.
- **Next:** the player takes the rocket.
- **Teaches:** **double jump**. The deck is 4.2 m. One jump does not reach, and the hint says to press twice.
- **Length:** 1:15.
- **Job:** the turn. Everything has been a joke until the boots line. Then the player picks up a dead man's gun.

> **Commander** *(smug)*: That one lasted nine days. I kept his boots. They didn't fit.

### Turning it round: `turn`

- **Where:** the apron, from the wreck back north, finishing at the main gate.
- **Player:** kills both tanks, then the chopper, then Bulwark plugging the gate.
- **Enemies:** the tanks. `turn.chopper` as soon as one tank is dead, one enemy chopper at most. `turn.truck` with 4 including a medic. `turn.bulwark`, the third tank, reversed into G1 once the other armour is gone. Men `spread` out as the Commander's first scripted answer.
- **Next:** Bulwark dies in the gate mouth. Its wreck jams the leaves open, and that is the only way in.
- **Teaches:** **explosives against armour**, stages 2 of 3: direct hits, tracks, tail rotor. Ammo at the wreck and at the gate.
- **Length:** 3:00.
- **Job:** payback, the outside's peak. The Commander goes from irritated to rattled, one signed-out vehicle at a time.

> **Commander** *(irritated)*: Ah. Well. That does change the conversation.
>
> **Council** *(deadpan)*: Item recovered. Its previous owner's balance has been transferred to you.
>
> **Commander** *(irritated)*: All units, he has a launcher. Spread out. Do not bunch up.
>
> **Commander** *(irritated)*: That was forty tonnes. That was signed out in my name.
>
> **Commander** *(irritated)*: Get the bird up. Put it on his head.
>
> **Commander** *(rattled)*: Do you know what one of those costs? I do. It's on a form.
>
> **Commander** *(rattled)*: Back Bulwark into the gate. Nothing gets past Bulwark.

### The breach: `breach`

- **Where:** G1, past Bulwark's wreck, across the Gate Yard to the blast door.
- **Player:** breaks the sandbag nests and runs for the door, which starts to close as they cross the line 22 m out. Slides under.
- **Enemies:** `breach.west` trooper, brute, trooper. `breach.east` gunner, trooper, riot.
- **Next:** the player reaches Sally Hall, and anyone left in the yard is swept. If they miss, the door comes up to 40% (1.4 m) every 9 s, because the Commander still has men outside: never high enough to stand.
- **Teaches:** **slide**. Running and dashing both meet a leaf too low to stand under.
- **Length:** 1:00.
- **Job:** the sprint. The first time he panics, and the player is getting under the door as it shuts.

> **Commander** *(rattled)*: It's in the gate. The gate won't close. The gate will not close.
>
> **Council** *(deadpan)*: The Council reminds you that wreckage left in a public gateway may incur a fine.
>
> **Commander** *(rattled)*: Seal the citadel! Drop the blast door! Now, now, now!

### The raid, part one: `barracks`

- **Where:** Sally Hall, South Corridor, the bunk rooms, North Corridor.
- **Player:** gets locked in, and then the lights go. Fights through by torchlight and muzzle flash.
- **Enemies:** `bar.pin` brute and 2 troopers at the west end of the South Corridor. `bar.flank` 4 in the North Corridor who come through the bunks once the player is pinned. `bar.bunks` gunner, riot, trooper. `crossfire` fielded.
- **Next:** all clear and the player in the North Corridor, or the player on the Coolant Hall's near platform with men left behind them.
- **Teaches:** the loop. A straight corridor is a death trap, the bunks are the way round, and they know it too. Sonar earns its keep in the dark.
- **Length:** 2:30.
- **Job:** the mood turns. This is where the humans have to be scarier than anything in the swarm: quiet, dark, and a calm voice telling you the building goes in a circle.

> **Commander** *(rattled)*: He went under it. Who taught him that?
>
> **Commander** *(smug)*: You've spent twenty minutes trying to get in here. Let's see how you like it.
>
> **Commander** *(hushed)*: Lights.
>
> **Commander** *(smug)*: Every corridor in this block goes round in a circle. My men know that. You don't.
>
> **Commander** *(orders)*: Contact south corridor. Pin him. Second team, through the bunks.

### The raid, part two: `coolant`

- **Where:** the Coolant Hall.
- **Player:** comes out onto a platform with the bridge gone.
- **Enemies:** `cool.sniper` one sniper on the far platform, so that standing at the lip thinking about it has a cost.
- **Next:** the player reaches the far platform.
- **Teaches:** **dash**. 18 m is beyond a double jump, which they learned at the wreck and will try first.
- **Length:** 0:45.
- **Job:** a breath, and a change of scale. A big dark room after the corridors.

> **Commander** *(irritated)*: You're still going. I'd hoped you'd be tired. Do you get tired?
>
> **Commander** *(irritated)*: The bridge went in the last audit. Nobody signed for the repair. Do enjoy the view.
>
> **Council** *(deadpan)*: Your movement suite includes a lateral burst. This is not a recommendation. It is a reminder that you were billed for it.

### The raid, part three: `gallery`

- **Where:** down the stairs to the Cable Gallery.
- **Player:** alone in a low concrete duct, a 22 m gap and a lit wall.
- **Enemies:** none. Nobody comes down here.
- **Next:** the player reaches the far deck.
- **Teaches:** **wall run**, and leaving a wall with a jump. The ceiling stops every flight the player has learned so far. The lit north wall is the only suggestion in the room.
- **Length:** 1:00.
- **Job:** silence, right when the player expects a fight. Then the Commander, for the first time, sounds frightened of what they are.

> **Commander** *(hushed)*: Nobody comes down here. I had the walkway taken out. There is no way across.
>
> **Council** *(deadpan)*: Your boots are rated for vertical surfaces. The Council accepts no liability for walls.
>
> **Commander** *(rattled)*: That was a wall. You ran on the wall. What are you?

### The raid, part four: `mess`

- **Where:** up the stairs into the kitchen, out onto the Mess Hall floor.
- **Player:** walks in. Nobody fires. Tables, a meal half eaten. They hear him tell the men to wait.
- **Enemies:** `mess.floor` 4 lying among the tables, `mess.west` 3, `mess.east` 3, under `orders: 'ambush'`. Ten men, all holding through being seen and walked past until "Now." Only a bullet or a man at arm's length breaks it early.
- **Next:** all three cleared.
- **Teaches:** that sonar and patience beat walking in. A ping shows them. A grenade before the word gets a head start. Those who go round by the kitchen find the Kiln and a flank.
- **Length:** 1:30.
- **Job:** the held breath. The F.E.A.R. ambush: he tells you it is coming, you still walk in, and it still works.

> **Commander** *(hushed)*: Everybody hold your fire. Let him come in. Let him sit down.
>
> **Commander** *(orders)*: Now.
>
> **Commander** *(rattled)*: They were eating in here yesterday.

### The raid, part five: `armoury`

- **Where:** East Corridor, the Armoury.
- **Player:** takes the autocannon, heals, reads the Commander's box.
- **Enemies:** none.
- **Next:** 4 s after the player takes it. The south door opens.
- **Teaches:** nothing. It is a reward.
- **Length:** 0:30.
- **Job:** the breath before the last push.

> **Commander** *(rattled)*: That's my armoury. Those are signed for. Put those back.
>
> **Council** *(deadpan)*: Ordnance recovered on site is not deducted from your fee. Take what you can carry.

### The raid, part six: `plates`

- **Where:** the Plate Hall. West door and Sally Hall's east door open.
- **Player:** faces a line of men walking down a long hall, and works out what a rocket does to them.
- **Enemies:** `plate.front` 2 brutes abreast. `plate.back` 2 riflemen, a medic and a shotgun behind them, all `light`. 12 s later `plate.round` brute, trooper, gunner through the Guard Room, on the player's flank.
- **Next:** all three cleared.
- **Teaches:** **explosives against armour**, stage 3. Direct on the plate, splash on the rest.
- **Length:** 1:45.
- **Job:** the wall of steel. The Commander's last good idea, and when it fails he stops being an officer.

> **Commander** *(rattled)*: Second Platoon. Full plate. Walk, do not run. Let him empty that thing into your chests.
>
> **Commander** *(rattled)*: Those plates cost more than you do.
>
> **Commander** *(cracked)*: Second Platoon? Second Platoon, report. Anybody.

### The climb: `stack`

- **Where:** the Stack, from the floor at y 0 up the landings to y 10. The way down to y -5 is open but only holds men.
- **Player:** climbs a shaft full of men firing down and across it.
- **Enemies:** `stack.base` 3 from below, `stack.lower` 4 with a rocketeer on the y 5 landing, `stack.upper` 4 with a sniper and a riot man at y 10. Each landing wakes as the one below falls. Threat 8.
- **Next:** the player reaches the top landing.
- **Teaches:** nothing new. It tests all of it: stairs for the careful, the wall-kick shaft for those who learned.
- **Length:** 1:45.
- **Job:** up. He is cracking, and he has stopped talking to anyone but you.

> **Commander** *(cracked)*: You're in the Stack. There is nothing above you but me.
>
> **Commander** *(cracked)*: Every man on every landing. Anyone who leaves his post, I'll shoot myself. I mean I'll shoot him. I mean, you know what I mean.
>
> **Commander** *(cracked)*: Fourteen months. I had fourteen months left. Do you know what a pension is?

### The Commander: `commander`

- **Where:** the War Room, then the Comms Roof.
- **Player:** breaks through the glass and fights him in the heavy suit. At 60% he goes up to the roof with the last of his men. Mortars come down on both of you.
- **Enemies:** the Commander in person (section 16.4), who calls shells on himself. At 60%, `boss.west` and `boss.east`, 3 men each, one with a rocket. Reactive lines from `IN_PERSON` play as they do now.
- **Next:** he dies. Every man left breaks.
- **Teaches:** nothing. The roof shows the player the whole apron, burning: that is the point of having it.
- **Length:** 2:45.
- **Job:** the peak of everything, then a man in a suit too big for him asking about a gift shop.

> **Commander** *(cracked)*: Right. I've had this sent up from stores. Stay exactly where you are.
>
> **Commander** *(cracked)*: Look at it. Look what you did to my yard.
>
> **Council** *(deadpan)*: Contractor. Please conclude. You are approaching your billable hours.

### The ending: `ending`

- **Where:** the roof, then the camera lifts away.
- **Player:** watches. His last words and the Council's receipt have the box for 8 s first, as they do today.
- **Next:** the shots end. Mission complete, the score screen, and **Endless humans on the Kill House** unlocks.
- **Length:** 0:45.
- **Job:** the invoice. A man has been removed from a register. The last line is the reason he is still talking to you in Endless.

> **Council** *(deadpan)*: Notice of Completion. Form 7742-C is discharged. The Outpost has been removed from the register.
>
> **Council** *(deadpan)*: Your fee has been calculated. Deductions: one helicopter, one gate, one previous contractor. Balance: see reverse.
>
> **Pilot** *(urgent)*: Contractor, this is Packmule 2-3. The Council says you can walk.
>
> **Council** *(deadpan)*: The Commander's service record has been retained. Deceased personnel remain eligible to serve at the Kill House.

### Dying

A death goes back to the last checkpoint. It is a replacement contractor, so the Council's fee of 10% comes off the score. The beat replays from the top, speeches are not repeated, the kit is the checkpoint's, and whatever was already dead stays dead. One of these plays, in turn:

> **Council** *(deadpan)*: Replacement contractor issued. The fee has been deducted.
>
> **Commander** *(smug)*: You again. Or another one of you. Does it matter?
>
> **Council** *(deadpan)*: Your replacement has been briefed. Please try to keep this one.
>
> **Commander** *(smug)*: We've done this part. I've told the men where you'll be.

## 5. The runner

`src/campaign/`. A mission is plain data, and `MissionRunner` plays it through one interface, `MissionHost`. With no mission on the page `ctx.campaign` is an empty object, so The Crucible runs as it did.

| File | What it is |
|---|---|
| `types.ts` | What a mission is made of, and `MissionHost` |
| `runner.ts`, `watch.ts` | Beats, scripts, triggers, radio, objectives, checkpoints |
| `validate.ts` | Finds what would fail in play. Runs at load and in tests |
| `host.ts` | `MissionHost` on the real game |
| `doors.ts`, `racks.ts`, `cutscene.ts`, `hud.ts` | Moving doors, weapons on the floor, camera shots, what shows on screen |
| `parkour.ts` | The sizes |
| `missions/` | `stub.ts`, `outpost.ts` and friends |
| `testkit.ts` | `FakeHost`, a pretend game for tests |

### A mission

```ts
const beat: Beat = {
  id: 'contact',
  title: 'Contact',
  checkpoint: { at: 'court', loadout: { weapons: ['smg', 'sword'], grenades: 0 } },
  start: [                                       // runs in order as the beat opens
    { do: 'say', line: 'stub.commander.contact' },
    { do: 'objective', id: 'clear', text: 'Kill them all' },
    { do: 'squad', tag: 'alpha', men: ['trooper', 'gunner', 'trooper', 'brute'], at: 'yardSouth', orders: 'hold' },
    { do: 'vehicle', tag: 'truck', kind: 'humvee', at: 'truckIn', route: 'truck', crew: ['trooper', 'trooper'], crewTag: 'crew' },
  ],
  cues: [{ when: { after: 3 }, run: [{ do: 'release', tag: 'alpha' }] }],   // reactions while the beat lasts
  until: { cleared: ['alpha', 'crew'] },         // then the next row
};
```

A beat opens by saving its checkpoint, then runs `start`. `cues` fire once each, or every time with `repeat`. `until` moves on to the next row. A script's steps run back to back, and only `wait`, `until`, a `say` with `wait`, a `door` with `wait`, `cutscene` and `ride` hold it up. Scripts stop with their beat. The radio does not.

**Triggers.** Clocks and counts start when the trigger is armed, and a repeating cue is armed afresh each time it fires, so a `signal` it waits on has to be raised again by its own script. `validateMission` says so if it is not.

| Trigger | True when |
|---|---|
| `{ zone: 'gate' }`, `{ zone, outside: true }` | The player's feet are in the box, or are not |
| `{ after: 12 }` | Seconds have passed |
| `{ kills: 3 }`, `{ kills, tag, by: 'rocket' }` | Kills since armed, of a tag, by a damage source starting with this |
| `{ cleared: 'alpha' }`, `{ cleared: [...] }` | Everything spawned under those tags is dead, fled or has given up, with nobody on their way in. Never true before something has spawned |
| `{ left: 2, tag }` | At most this many left |
| `{ below: 0.6, tag }` | The tag's first living body is at this share of health |
| `{ signal: 'name' }` | Someone raised it: a `signal` step, or `ctx.campaign.signal(name)` |
| `{ event: 'weapon:unlocked', where: { weapon: 'rocket' } }` | Any game event, compared field by field |
| `{ all: [...] }`, `{ any: [...] }` | Combines them |

**Steps.** `types.ts` has each one's fields.

| Step | Does |
|---|---|
| `say` | Queues a line. Heard once a mission, unless `again` |
| `objective`, `done` | Puts one up, with an optional marker, and ticks it |
| `hint` | A teaching prompt. `{jump}` becomes the player's own key |
| `banner` | The HUD's stamp |
| `door` | `open` is a share. 0 shut, 1 open, 0.4 stopped there |
| `squad`, `release` | Men at a mark: `hunt`, `hold` (springs at 15 m, on being stared at, or on a shot) or `ambush` (a shot or arm's length only). `light` takes their plates off. `release` lets a holding squad go, as being shot at does |
| `sweep`, `place` | Takes everyone off the map, unseen and unscored. Puts the player on a mark |
| `vehicle`, `boss` | One body under a tag, crew under theirs |
| `give`, `grenades`, `rack`, `drop` | Hands over, or leaves on the map. A rack raises `took:<weapon>` |
| `wait`, `until`, `signal`, `goto`, `finish` | Flow |
| `cutscene`, `ride` | Hold the script until they end |
| `adapt`, `field`, `threat` | The Commander's box between rounds, one chosen answer, how hard they hit |
| `music` | The music state |
| `call` | Anything else: `{ do: 'call', name: 'lights', arg: 'emergency' }` |

`ensure: true` on `squad` or `vehicle` spawns only if the tag has nothing on its books. It is how a later beat says "these should be here by now" and still has them after a restart, and `validateMission` will tell you when you need it.

### Plugging a system in

The host has a plain fallback for everything, so the mission plays before your system exists. Replace what you own from your `init`:

```ts
ctx.campaign.provide({
  vehicle(order, at, route) {
    // Spawn it. Crew get out at the end of the route, under order.crewTag ?? order.tag.
    // When the vehicle is dead:   ctx.campaign.unitGone(order.tag, true, source);
    // When a crewman is gone:     ctx.campaign.unitGone(crewTag, killed, source);
  },
  ride(seat, route, done) { /* fly the route, raise signal(`ride:${markId}`) at each mark, call done() when the body is back */ },
  call(name, arg) { if (name === 'lights') setEmergencyLighting(arg); },
});
```

The one rule: **every body counted under a tag must end in exactly one `unitGone`**, or `cleared` waits for ever. The host does this for men on its own. A provider does it for whatever it spawned.

| Host method | Today's fallback | Owner to replace it |
|---|---|---|
| `squad` | Real squads through `Outpost.formSquad(size, at)`, one man at a time, waiting for room under the cap | Stays. `orders: 'hold'` is `squad.directed`, which is crude: see section 6 |
| `door` | Real moving colliders, off the route graph when shut, with hazard-paint boxes for looks | Map, for looks. Give the door a better material, keep the collider |
| `rack` | A glowing bar and a marker | Art |
| `cutscene` | Real, on `SeatView` keyframes | Extend, do not replace |
| `speak` | The Commander's box, with a recording if `public/audio/voice/manifest.json` lists the line id | Voices |
| `vehicle` | Real, from `VehicleSystem`. See docs/notes/vehicles.md | Vehicles |
| `ride` | Real. A route is flown as written. With no route, the ordinary Door Gunner call-in, circling for its 45 s | Vehicles |
| `boss` | `commander.person.summon()`: he falls from the sky as he does on the Kill House | Bosses |
| `call` | A console warning | Whoever owns the name: `lights`, `commanderToRoof` |

### Testing it

```
nice -n 19 npx vitest run src/campaign --testTimeout=60000
node tools/shot.mjs --url "/?mission=stub&map=killhouse&autostart=1" --script tools/scripts/campaign-live.mjs --out tools/out/campaign.png --wait 500 --timeout 140
```

`window.__op2.campaign.runner.describe()` reads everything: beat, deaths, objectives, tags, doors. `?beat=<id>` starts anywhere, with the checkpoint's kit and the doors as earlier beats left them.

## 6. Where it stands

Everything in sections 1 to 5 is built and has run in real Chrome on the real map, beat by beat, with a bot. `tools/scripts/mission-live.mjs` is that bot: `MISSION_STEP` takes `film`, `ride`, `lockout`, `soft`, `heavy`, `turn`, `breach`, `barracks`, `coolant`, `gallery`, `mess`, `armoury`, `plates`, `stack`, `boss`, `ending`, `pause`, `voice`, `unlock` and `menu`, and the header says how to run one. It teleports between the fights and kills what it has to, so it proves that every beat fires and hands on, not that any of it is any good. Nobody has played the raid.

What a player has found that the plan has not caught up with is in docs/NEXT.md.

**How the mission keeps its word.**
- `adapt` is the Commander's box with his read of the player, and the only answers it can announce are the ones that change men already in the fight (`WORKS_IN_FIGHT` in `commander/index.ts`). Mortars, snipers, mines and the rest are built into a wave, and a mission has no waves, so he does not promise them.
- His own shells come only on the roof and only on a player under open sky: `person.ts`. The staged fight also takes away the Juggernaut's charge, which runs straight and went over the Stack's rail and the roof's waist-high parapet in testing.
- The Commander walks after a player who hangs back, so he can come down from the roof again. The objective's marker stays on the mast.

**Still placeholder.**
- Doors are hazard paint. Racks are a glowing bar, and the launcher is not the shape of a launcher.
- The pilot's voice has not been chosen. `docs/voice/mission-script.md` has every take, and any line with no take stays a subtitle.
- `plate.front` walks at a brute's pace because a brute is slow. Nothing makes it march abreast.

**To add a take.** A file goes in `public/audio/voice/<line id>.mp3` and its name in `manifest.json`. `tools/scripts/voice-script.ts` rebuilds the script from `outpost.lines.ts`.
