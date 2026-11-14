# Holdfast

Stage 7 of `docs/proposals/mission-2-plan.md`: Foreclosure's map, a squatters' free port in a dead shipyard on the salt flats of Brine.
Files: `src/world/map/holdfast/`; every place the mission names is in `src/campaign/missions/foreclosure.places.ts`.

| URL | What |
|---|---|
| `/?contract=foreclosure&autostart=1` (or `/?map=holdfast`) | Foreclosure on Holdfast. `&beat=<id>` starts from a beat |
| `/?sandbox=map&map=holdfast&view=overview` | Fly camera. Views below |

Views: `overview`, `high`, `ac130` and `ac130East` (on the gunship's orbit), `lz`, `shanties`, `trench`, `fuel`, `gate`, `wallOut`,
`gunPad`, `step`, `mainStreet`, `lane`, `saltLane`, `saltStreet`, `square`, `squareHigh`, `roof`, `craneStreet`, `stacksFoot`, `stacksA`,
`chimney`, `stacksTop`, `stacksEnd`, `aisle`, `grandad`, `craneCab`, `craneLeg`, `quay`, `slip`, `slipFloor`, `flak`, `harbourWalk`,
`westRoad`, `westGate`, `pans`, `pansWide`, `cannery`.

| File | Holds |
|---|---|
| `plan.ts` | Every number and the data other systems read. No three.js |
| `ground.ts` | Salt, the Pans, the sea, the dry dock's hole, the salt dyke, wrecks on the Flats, the invisible walls |
| `town.ts` | The walls and gates, wall guns, firing steps; the outer shanties (shacks, trench, fuel farm, roof guns); the Market and the Square; cover for the battles. `clearOf()` keeps scattered dressing off roads, Frame routes, marks, spawns and firing lines |
| `yard.ts` | The stacks, the chimney, the gantry crane and its cab, the quay and its crane, the Slip, the harbour wall and flak tower, the boat shed, the cannery |
| `props.ts` | Painted terraces and shanties, stalls, awnings, bunting, bulbs, banners, flags, braziers, loudspeakers, hulls |
| `index.ts` | Stages, zones, spawns, views |
| `holdfast-map.test.ts` | The proof |

## The layout

x east, z south, north is -z; the salt at y 0. About 330 by 235 m inside the invisible walls (x -166..163, z -112.5..122), salt to the
horizon west and south, sea north and east.

```
 z -112  sea ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 z -105  |  harbour wall, walk at 4 m ---- FLAK TOWER (x 12..28, 24 m) ------ caisson ------|
         |  west    tower   BOAT SHED        quay     THE SLIP (x 84..152, floor -6,        |
 THE     |  road    road    (x 30..62)       crane    ramps S, W, E; caisson N)        east |
 PANS    |   |                               (deck 6)                                  quay |
 (white, W  =====================  QUAY APRON z -56..-44 (Grandad at the aisle's mouth)  ===|
 salt,   A  gantry crane over the west stacks, cab at 22 m                          |  quay|
 Old     L  WEST STACKS (parkour)  | CRANE AISLE |  E1 (7.8, stairs)  E2   | QUAY   |canne-|
 Mother's L  C2 7.8 / C1 10.4 / gap |  x 50.5..62.5 | snipers on its edge     | ROAD   |ry    |
 loop)   |  B 10.4 + chimney / A 5.2 |  12 m        |                         |x110-125|      |
 west    |  barricade, cul-de-sac      CRANE STREET z 8..15 ================================ |
 gate at |  MARKET: blocks w1..w6 | THE SQUARE (x 58..82) | blocks e1..e8, SALT STREET z 26..32
 z -20 ->|  lanes 4 m, terraces    |  fountain, loudspeaker |  QUAY STREET x 116..122          |
 z 50    |==== the south wall, 3 m: guns at x 40 and 100, MAIN GATE x 67..73, breach at 55 ====|
 dyke    |  OUTER SHANTIES: trench (x 30..58), roof guns, sniper's shack, fuel farm (x 140..161)
 (7 m)   |  THE FLATS: LZ (40, 95), wrecks, two tracks for the technicals, the flats road at z 113
 z 122   -------------------------------------------------------------------------------------
```

What changed from the plan's paper layout (section 5): the town wall runs on to the sea at x 163, and a salt dyke (7 m, no climb) carries
it south to the map's edge, so the Pans are reached only through the west gate. Grandad's hide is the crane aisle's north mouth on the
quay apron (the mark is still `quayRoad`), because a tank on the quay road at x 117 cannot see down an aisle at x 56. The Slip is
x 84..152, z -92..-56; the flak tower stands on the harbour wall at x 12..28.

## The places, area by area

- **The Flats.** White salt crust, the LZ ring and H at (40, 95), kept clear (the test drops rays on it). A beached trawler, a dead skiff,
  three burnt trucks. The flats road along z 113; two tracks for technicals from the south edge to the gate's apron (`westTrack`,
  `eastTrack`, routes `technicalWest`, `technicalEast`).
- **The outer shanties.** Painted shacks (structures: a rocket flattens one) on a jittered grid, a few shanty houses, braziers, tyres.
  The **trench** (`TRENCH`, a 2.4 m walk between earth banks, zig-zag, gaps at the corners) for white phosphorus. Two **roof guns**
  (`ROOF_GUNS`: shanty houses with stairs and a mounted gun in sandbags on the roof). The **sniper's shack** (`sniperShack`). The **fuel
  farm** (`FUEL`: three tanks that are real explosive tanks, barrels, a berm): the glide bomb's target. The gate's approach is open ground.
- **The wall.** The plain 3 m wall kit from the dyke to the sea, a shut steel **main gate** (blown, or the charge beside it on the
  segment painted at x 55, `breach`), two painted gate towers with loudspeakers and the HOLDFAST sign. Two **wall guns** on timber pads
  (2.1 m) behind it, facing south (`spec.emplacements` 0 and 1). Timber **firing steps** at 1.7 m in four stretches, stairs up from the
  lane. The **west wall** runs north to the harbour wall with the **west gate** (8 m, a lift gate) at z -20.
- **The Market.** Fourteen blocks (`BLOCKS`) between lanes 4 m wide: each a terrace of painted houses (a different colour every 4 m,
  doors, lit windows, shutters, awnings) whose flat roof is a floor at 3 m with stairs up behind, and a row of shacks with alleys along
  its other face. The PORT OFFICE (block e5) is a tall house instead. Bunting and strings of bulbs across every lane, a lamp over each.
  **Salt Street** (6 m, east of the Square) and **Quay Street** are the Frame's way through; the lanes are the men's.
- **The Square.** 24 m of old tiles, stalls round its edges (`STALLS`, static until stage 5's `stall` takes them by position), a dry
  fountain with an anchor in it, the Harbourmaster's loudspeaker mast, bunting and bulbs criss-crossing it.
- **The stacks.** One collider a block (`STACKS`), painted containers drawn on the faces and top only. The **crane aisle**, 12 m, from
  Crane Street to the quay: almost no cover (one fallen container, a truck), the gantry's hook over it. Grandad at its north mouth between
  two sandbag cheeks. **E1** east of it, three high, stairs up its east face, the snipers' nests on its edge over the aisle (`stacksSniperA`,
  `stacksSniperB`). **The parkour route** is the west stacks (below). A barricade three high shuts the west road off from Crane Street,
  so the ground ways north are the aisle and the quay road (the long way round).
- **The gantry crane** spans the west stacks and the aisle at 20.5 to 22 m on a west leg (two plates with a chimney between) and an east
  column on E1. The **cab** with the Sabot (`craneCab`) sits on the girder at x 27..34.
- **The quay.** The apron (z -56..-44), floodlit, Grandad's road. The **quay crane**: a roofed deck at 6 m on four legs west of the Slip,
  stairs up from the apron, its boom out over the dock: the checkpoint over the quay (`quay`, `thresherRack`, `quayHealth`,
  `quayArmour`), reached on foot so the squad rejoins. The **quay road** up the stacks' east side; the **cannery** (a long painted shed)
  across it on the east quay.
- **The Slip.** The dry dock, floor at -6: ramps down from the south (the 14th's way in, and the Frame's way out), west and east; the
  caisson to the north under the harbour wall. Keel blocks to hold it from, tide marks on its walls, work lights. `frame` (112, -6, -82),
  `courierWreck`, `doorGun` (the courier's door gun, for stage 10), militia from `slipNorth` (the harbour quay), `slipEast`, `slipWest`.
- **The harbour wall and flak tower.** A sea wall with a walk at 4 m and a parapet, stairs up its town face at three places. The flak
  tower: 24 m of painted concrete with four gun mounts on its corners (`flakGun1..4`, drawn by `flakGuns()` in `yard.ts` until stage 11
  makes them breakable parts), a loudspeaker and a banner. The boat shed beside it, a rusting hull on its slipway.
- **The west gate and the Pans.** The west road (14 m) from the harbour quay to the gate. Outside, the Pans: white salt to the horizon,
  evaporation ponds as low ridges, Old Mother's ruts round her loop (`PANS.loop`, centre (-86, 0), 52 by 78 m), salt heaps, a dead
  crawler on the far side as a landmark, rags on poles.

The town is night like every map (the renderer's sky is global). Its colour is paint, dyed cloth and lit things: painted terraces,
containers in a dozen colours, awnings, bunting, orange, magenta and cyan bulbs, braziers. A daylight Holdfast is a renderer job.

## The mission's names (`foreclosure.places.ts`)

`PLACES` names every place; `MARKS` is the part the beats name today plus every route's marks (the validator refuses a mark nothing
names). A stage that names another place adds it to `NAMED` there.

| Export | What |
|---|---|
| Checkpoints | `lz`, `shanties`, `gate`, `square`, `quay`, `slip`, `frame`, `harbour`, `pans`, `deck` (the deck marks are on the Pans until Old Mother exists) |
| The beats' places | `outerShacks`, `sniperShack`, `wallGuns`, `wallGunWest`, `wallGunEast`, `breach`, `breachKit`, `eastBureau`, `eastMilitia`, `lanes`, `marketRoofWest`, `marketRoofEast`, `marketRoofNorth`, `stacks`, `stacksSniperA/B`, `quayRoad` (Grandad), `craneCab`, `thresherRack`, `quayHealth`, `quayArmour`, `slipNorth/East/West`, `doorGun`, `courierWreck`, `backStreet`, `backTank`, `flakTower`, `flakGun1..4`, `mother`, `deckCrew`, `deckGun` |
| `OVERWATCH` | The gunship's orbit (`over: 'lz'`, radius 160, altitude 185, as `docs/notes/progression.md`) and its targets: `outerShacks`, `sniperShack`, `trench`, `fuelDepot`, `roofGunWest`, `roofGunEast`, `aaWest`, `aaEast` (the anti-air teams), `openGround`, `techW1`, `techE1`, `wallGunWest`, `wallGunEast` |
| `BATTLES` | The war: `flats`, `eastStreet`, `westWall` (pinned by the west wall gun), `marketCorner`, `squareCounter` (the counter-attack into the Square), `quayRoad` (the long way round). Each `{ at, from }` as a `battle` step takes them |
| `ROUTES` | `technicalWest`, `technicalEast`; the Frame's `frameStacks` (out of the Slip, down the aisle to the Square), `frameMarket` (Salt Street, Quay Street, the quay road), `frameHarbour` (to the flak tower), `frameWest` (the west road, out of the gate), `framePans` (a loop on the salt) |
| The stacks | `stacksFoot`, `stacksClimbed`, `stacksTop`, `stacksEnd`, `aisleSouth`, `aisleNorth`, `aisleBureau` |
| `ZONES` | `westGate`, just outside it |

From `plan.ts`: `LEVEL` (the nav's floors: -6, 0, 1.7, 2.1, 3, 4, 6, 7.8), `STACKS`, `CHIMNEY`, `GANTRY`, `WALL_GUNS`, `ROOF_GUNS`,
`FUEL`, `TRENCH`, `STALLS`, `BLOCKS`, `ROADS`, `FRAME` (3.6 m), `HOLDFAST_SPAWNS` (twelve on foot in back lanes, yards and the harbour;
four flyers over the sea and the salt). `spec.emplacements`: the two wall guns, then the two roof guns.

## The stacks' parkour route

Its numbers are `PARKOUR.stacks` in `src/campaign/parkour.ts`; the map test plays it with the real Player on the map's own faces.

1. **Wall climb** from Crane Street up A's south face: two high, 5.2 m. Walking does not get up; a jump at it with W held is the climb.
2. **The chimney.** B is four high in two halves with a 1.5 m slot between them, opening onto A's top. B's outer faces refuse the climb
   (`Kit.noClimb`), so the slot is the only way up: wall to wall, a jump off each cling turning the view to the other wall (the bot does
   it in two to three climbs from the slot's floor). Climbable liners just proud of each face carry the hands.
3. **The gap**: 5 m between B and C1 at 10.4 m, a run and a jump. A row of single containers fills it below, so there is no alley.
4. **Down**: C1 to C2 (7.8) to the apron, behind Grandad, his roof hatch below you.
5. **Optional, the Sabot:** the gantry's west leg is a chimney from the ground to the girder at 22 m (eight or nine climbs); walk the
   girder to the cab.

No nav node stands on any stack top west of the aisle or on the crane: the tops are not levels, and the one at 7.8 (C2, the
barricade) is cut off and dropped. So the Bailiffs, who stay off jump links, take the aisle or the quay road.

## Proving it

```
nice npx vitest run src/world/map/holdfast/holdfast-map.test.ts --testTimeout=60000     # about 5 s
OP2_VIEWS=overview,ac130,ac130East,square,saltStreet,stacksTop,aisle,slip,flak,pans node tools/shot.mjs \
  --url "/?sandbox=map&map=holdfast" --script tools/scripts/fort-shots.mjs --out tools/out/holdfast/v.png --wait 2500 --dpr 2 --w 1440 --h 900 --timeout 280
node tools/shot.mjs --url "/?contract=foreclosure&beat=overwatch&autostart=1" --script tools/scripts/foreclosure-live.mjs \
  --out tools/out/holdfast/f.png --wait 500 --timeout 240 --dpr 2 --w 1440 --h 900
```

The test builds the real world and checks: the budget; every place on a floor, unburied, and every walking place on the nav; a way from
the LZ to every walking place once the gate is blown; the town shut to the Flats and the Pans while the gates are shut; spawns on floors
that reach the LZ; every battle 15 to 60 m across with a firing line eye to eye, cover within 3 m for a crouching man on both sides, and
a way between; every overwatch target seen from more than 60% of 24 points on the gunship's orbit; the roads clear at 0.5 and 2.4 m
across their width and the LZ clear; every Frame route swept by a box 3.6 m wide from a step's height (1.2 m) to 6.4 m, every 0.5 m,
meeting nothing that does not break, with no step over 1.2 m; the stacks built to `PARKOUR.stacks`; no nav on the west stacks or the
crane; a walk at A staying on the street; the climb onto A; B refusing a climb and a double jump from A, and the liners taking one; the
whole route over the top played (climb, chimney, gap, down to `stacksEnd`); the crane-leg chimney to the cab, which no nav reaches.

| Measure | Holdfast | For scale |
|---|---|---|
| Static | 221k triangles, 236 colliders (plus the structures' own), 93 baked lights, 135 structures (wall segments, two gates, the shacks) | Fort 217k, 986, 119 |
| Nav | 70k nodes, 0.45 to 0.5 s | Fort 50.9k |
| Build | 2.2 to 2.5 s all in, the light bake 1.6 to 2.2 s of it (360 m at 1.8 m cells, so the salt is lit to the horizon) | Fort 2.8 s |
| Draw calls, map sandbox | 55 to 70 (the Slip, the flak tower, the Pans), 107 to 170 (the market, the stacks, overview, the gunship's view); 80k to 305k triangles in view | Fort 98 to 229 |
| Real game | The overwatch, wall and stacks beats ran (`foreclosure-live.mjs`); draws were not read there | |

Frame rates in the harness at 2x are the harness's.

## Rough

- **Nobody has played it.** Distances, the aisle's emptiness, how far the snipers see, how the battles' cover sits: all guesses.
- **Night.** The renderer has one sky; a daylight town is not in reach of a map. The market is lit, but the shanties and the aisle are dark
  from the street. From the gunship the town reads by its lights and painted containers.
- **The 3 m walls can be mantled** (one jump, `PARKOUR.mantle`), as the plan's wall kit is. The wall guns shoot whoever does. The dyke and
  the barricade cannot.
- **Stalls are static** and listed in `STALLS` for stage 5's `stall` kind. Shack debris flies grey, not in its paint (`debris.ts` takes a
  single tint).
- **Shack placement is procedural** (a seeded grid filtered by `clearOf`), so moving a road or a mark moves shacks.
- **The flak guns are drawn static**; stage 11 makes them parts and should take `flakGuns()` out. The courier's wreck and its door gun are
  marks only. Old Mother's deck marks stand on the salt.
- **Old Mother's loop** is ruts and empty ground; nothing checks her 14 m width against the salt heaps (they are outside the loop).
- **Draw calls in the real game with men** were not measured; the sandbox's 170 at most leaves room under 450.
- **The east column of the gantry** stands on E1's top, among the snipers.
