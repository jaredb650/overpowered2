# Foreclosure: the mission as built

Mission 2 of the campaign, after the Outpost. The plan is `docs/proposals/mission-2-plan.md`; this file says what exists. Updated as
each stage lands.

## Where it stands (stages 6, 7 and 9: the plumbing, the map, beats 1 to 6)

All sixteen beats run end to end on Holdfast. Beats 1 to 6 are built (stage 9, below): the gunship fight over the landing, the Flats,
the wall, the market and the courier, with the war beside the player all the way. Beats 7 to 16 are still the skeleton's stand-ins. No
Old Mother yet; the Frame is stage 3's.

- **Play it:** `/?contract=foreclosure` on the dev server, or the menu's Foreclosure tab. From a beat: `&beat=<id>`, or the dev panel's
  **MISSION: FORECLOSURE, FROM A BEAT** buttons (F1), which reload the page on that beat with its checkpoint's kit.
- **Where:** Holdfast (stage 7, `docs/notes/holdfast.md`), the contract row's `map: 'holdfast'`. Every place is in
  `src/campaign/missions/foreclosure.places.ts`: `PLACES` names them all, `MARKS` is what the beats name today (plus every route's marks),
  and `BATTLES`, `OVERWATCH`, `ROUTES` (`technicalWest`, `technicalEast`, the Frame's `frameStacks`, `frameMarket`, `frameHarbour`,
  `frameWest`, `framePans`) are there for the beats to come. A beat that names a new place adds it to `NAMED` in that file.
- **Lock:** the row is shut in the menu until the Outpost is won (`opensAfter: 'outpost'`, `isShut` in `src/contracts/unlocks.ts`), and
  open on the dev server, as every lock is there. It is not `locked: true`, because that flag means "after the campaign" and
  `contracts.test.ts` pins the rows that carry it.
- **Words:** `foreclosure.lines.ts`, rows only, ids `mission.foreclosure.<council|harbour|radio>.<key>`. The Council's recorded
  `mission.council.brief.line` and its two redeploy takes are the Outpost's rows, by id. The Harbourmaster is her own speaker,
  `harbourmaster`: "The Harbourmaster, Holdfast port address" in the box, in amber on aubergine, her portrait the port's loudspeaker on
  its pole under bunting, rings coming off the horn while she talks (`ui/commander/portrait.ts`, `horn`). No PA tone under her yet.
  The war's call-outs are `CALLS`, ids `mission.foreclosure.call.<bureau|militia>.<kind>.<n>`, feed text only. Nothing is recorded.
- **Form numbers:** Foreclosure is 7742-F. Outpost Defense's notice, which also said 7742-F, is now 7742-G.

## The beats

| # | Beat | Checkpoint | What runs now | Ends on |
|---|---|---|---|---|
| 1 | `briefing` | none | The Council reads Form 7742-F over a stand-in film of Holdfast | the film |
| 2 | `overwatch` | `lz`, issued kit | **Built.** The gunship fight over the landing (below) | the lease running out |
| 3 | `landing` | `lz` | **Built.** The Flats on foot: E taught, a man sniped down and revived, two technicals, the shack sniper | shacks, sniper and both technicals |
| 4 | `wall` | `shanties` | **Built.** Enemy gunners on both wall guns, the breaching charge or the gate, the launcher on the kit | both gunners and a breach |
| 5 | `market` | `gate`, launcher | **Built.** Riot shields and a Warden in the lane, riflemen on three roofs, a brute, prisoners, a Bailiff lost | lane and roofs cleared |
| 6 | `courier` | none | **Built.** The fees, the courier shot down by the flak tower into the Slip, **call-ins held** | the courier in the ground |
| 7 | `stacks` | `square` | Five Bailiffs, snipers, a tank for Grandad, the optional Sabot | squad and tank cleared |
| 8 | `quay` | `quay` | Four Bailiffs, health and armour, the Thresher rack | the Thresher taken |
| 9 | `slip` | `slip`, + Thresher | Three small squads, one per side | 30 s and all three cleared |
| 10 | `mount` | `slip` | `frame kneel` | boarded |
| 11 | `foreclosure` | `frame`, in the Frame | Squad off, a technical and a tank | all cleared |
| 12 | `flak` | `harbour`, in the Frame | The tower's men | cleared |
| 13 | `pans` | none | **Call-ins open**, the Harbourmaster on Mother | the west gate zone |
| 14 | `mother` | `pans`, in the Frame | A tank stands in for Old Mother, two deck crew | Mother dead or 75 s: `frame eject` onto the deck |
| 15 | `deck` | `deck`, on foot | The autocannon rack, the crew | crew cleared |
| 16 | `ending` | `deck`, + autocannon | The Harbourmaster's last line, the Council's deductions, a film | finish |

Frame beats say `mission.foreclosure.council.replacement` after a restart ("Replacement Frame issued. The fee has been deducted.").

## Beats 1 to 6 (stage 9)

Played by `tools/scripts/foreclosure-live.mjs` (below) from the seat to the courier in one page, and by `foreclosure.test.ts`.

- **`overwatch`.** The gunship's circle is centred on the LZ itself (`boardCallIn('ac130', point)`, the skeleton's crosshair shortcut
  gone). From the first second there is plenty below: six of the 14th at the LZ and a second stick of three fighting into the east
  shanties (battle `flats`), four militia rushing the LZ across the open ground, more out of the shacks each time they thin, gunners on
  both roof guns (emplacements 2 and 3), both technicals driving their tracks, three in the trench (white phosphorus) with more coming
  back to it, the fuel farm's tanks with three men round them (the glide bomb), and a rocketeer at each end of the Flats who hunts the
  gunship, put back each time he is shot. The Council says the lease, the Harbourmaster waves and later asks Danno to put one up at
  "the gentleman"; a hint teaches flares on the lock tone. In the bot's runs three missiles launched and three flares answered them.
- **`landing`.** On foot at the LZ with the six. The E hint (tap, hold: your squad only). At 14 s the shack sniper puts the rocketeer down
  (`call wound`), the hint says hold E on him, the Council prices the stim. The flats battle goes on with its counter-attacks; the beat
  ends on the shacks squad, the sniper (one rocket flattens his shack) and both technicals, not their crews (a crew that got out before a
  checkpoint is not put back by `ensure`, so `cleared` on it could never come true after a restart).
- **`wall`.** The flats battle is stopped; two more start: the 3rd Recoveries pinned in the trench under the west wall gun (`westWall`)
  and the 9th under the wall east of the gate (`eastStreet`). Militia gunners man both wall guns (`call crew`, war.ts) and work them on
  the player or on any Bailiff in the arc. Under the wall (zone `wallFoot`) or after 45 s, one of the player's own takes the breaching
  charge to the painted segment (`call charge`): CHARGE 10 counts down over him, "KEEP HIM ALIVE"; if he goes down another tries 5 s
  later; at 0 the segment and the one beside it are breached. Or the launcher on the 14th's kit and the gate's 400. Whichever goes
  first raises `war:breached` (`call watch`). The beat ends on both gunners dead and a breach.
- **`market`.** `westWall` stopped, `eastStreet` kept, `marketCorner` (the 9th holding the Square's east corner, the counter-attack out
  of the lanes) started. Riot, trooper, riot, Warden in the lane, riflemen on the west and east roofs and a sniper on the north, a brute
  and a trooper at 30 s. At 20 s a round off the north roof kills the shotgunner (`call lose`), the Harbourmaster: "That's one of yours,
  Bailiffs. We'll keep him warm." The first surrender brings the prisoner hint and the Council's "Detainees are billable".
- **`courier`.** The market's battles stopped, the sky shut, the 22nd holding the Square's north side (`squareCounter`). The Council
  reads the fees, the objective says watch the north, and the courier (the Packmule on a fixed flight, crewed: its door gun fires on the
  militia) comes in over the shanties, north over the Square, the flak tower's four guns walking tracers and airbursts onto it; it is
  hit over the stacks (`war:hit`: the radio's "Courier is hit!" and the Harbourmaster's "iron" line), burns down toward the Slip and
  the crash takes it into the dry dock. A column of smoke stands over the wreck (`call wreck`, also said by `stacks` for a restart
  there), the militia's counter-attack comes into the Square, and `war:downed` ends the beat.

### The war (`src/campaign/war.ts`)

Every beat has other Bailiff squads fighting their own battles beside the player's six: `flats` in the overwatch and landing, `westWall`
and `eastStreet` at the wall, `eastStreet` and `marketCorner` in the market, `squareCounter` in the Square. Each is a `battle` step
(three Bailiffs, two militia), its militia put back as a counter-attack each time the Bureau clears them (`counter` cues).

- **The fronts hold.** The Outpost's squad brain plans round the player, so a battle's militia are taken off it (`squad.directed`) and
  ordered onto cover by their own ground with a shot at the Bureau's, where they fire on the Bailiffs (`soldier.foe`; a militiaman out
  of the player's sight now peeks toward the man he is shooting, `behaviours.ts`). Within 32 m of either side the player is in that
  fight, and the militia get their brain back.
- **Call-outs, both sides,** on the comms feed (`CALLS`): the Bureau's in green under the squad's name ("Rifleman, 9th Recoveries:
  Pushing left!"), contact, fire, man down, back up, killed, the charge, the breach, clear; Holdfast's in cyan ("Holdfast: Push them back
  to the water!"), contact, fire, the counter-attack, the gun. At most one every 2.6 s and one a front every 7 s, nothing from a fight
  over 140 m off, a casualty cutting in. The militia's own comms lines go on beside them.
- **Hold E is the player's own squad.** A battle's men are `detached` (`allies/ally.ts`): the hold leaves them to their fight, a tap
  still reaches one, a stim still revives one. Battles leave by `allies.dismiss` (new, public).
- **Gun crews.** A mounted gun manned by the enemy (`Emplacement.occupy(who, hostile)`) fires enemy rounds that meet only the player,
  at `HOSTILE_GUN` (6 a round, four times the spread); at a Bailiff the war puts his rounds in with `shotAt` at the gun's pace.

### Measured

Real Chrome, 1440x900 at dpr 2, `foreclosure-live.mjs` from the overwatch to the stacks in one page, a private server, the shared machine.

| Beat | Draws, at most | Triangles, at most | Men at most (theirs, ours, of ours another squad's), corpses | Frame |
|---|---|---|---|---|
| `overwatch`, from the seat | **480** | 1.38M | 18, 9 (3), 8 | 60 median, 58 at worst |
| `landing` | 445 | 1.14M | 9, 9 (3), 8 | 60 median |
| `wall` | 432 | 1.05M | 8, 12 (6), 8 | 60 throughout |
| `market` | 395 | 1.07M | 11, 12 (6), 8 | 60 median |
| `courier` | 372 | 0.96M | 2, 8 (3), 8 | 60 median |

The dips (8 to 18 fps for a sample) fall on the bot's screenshots, which stall the harness. `AllySystem.update` 0.1 to 1.4 ms (a 5.7 ms
spike once, in a run with the medics at work). In the bot's runs: three anti-air launches in the overwatch and three flares that beat them;
both wall guns manned, the charge set and the wall breached 10 to 22 s after the player stood under it; the market's shotgunner killed;
the courier down into the Slip and the stacks beat opened; 126 to 154 lines on the feed, a fifth of them the war's call-outs.

**Every man is about six draws and 15k triangles, dead or alive,** and the war doubles the men. Two measures brought it down from 589
draws and 1.59M triangles: a battle is three Bailiffs and two militia (a counter-attack two), and the mission keeps 8 corpses
(`Mission.corpses`, under the gore setting's 40). The landing sweeps the gunship's far targets (the fuel farm, the anti-air). The
gunship's view of the whole town with 18 men in it is still 30 over 450 at its worst: the next lever is fewer men under the gunship.

### Rough

- **Nobody has played it.** The bot is a god that watches each set piece and then clears the beat's tags. How hard the wall guns hit
  (`HOSTILE_GUN`), how long the battles last, how often the militia come back: all first numbers.
- **The bot flies the seat badly:** it swings onto knots and cycles the guns, but its kills are few. A player fills the minute and a half.
- **No wounded are dragged back.** Medics run to a downed man and revive him where he lies; the militia's own rescue lines are theirs.
- **The courier carries no Frame under it** (stage 4's body), and its crash is the helicopter's spin into the dock, not a slow burn-in.
  Its crew's door gun fires on the militia as it crosses.
- **A gunner faces where his body was walking,** not along the gun; his rifle is silent while he is on it.
- **Draws over 450 from the gunship** at its worst (above).
- **A restart in the courier beat** is a restart at the market's checkpoint, as the skeleton had it.

## The new steps (`src/campaign/types.ts`)

| Step | Does | Real game today |
|---|---|---|
| `sortie { over }` | The AC-130 flown by the player from the first second, no crew on the guns, nothing earned, over the mark. Holds until the lease ends | `place` then `boardCallIn('ac130')`. The gunship circles where the crosshair falls from the mark |
| `frame { act, at }` | `kneel`: a Frame waits on the mark, done when boarded. `board`: straight in, for a beat that starts in the Frame. `eject`: thrown out onto the mark. All hold until done | A stand-in: a banner, done at once (`eject` places the player). The Frame system replaces it with `campaign.provide({ frame })` |
| `roster { men, at? }` | The player's Bailiffs: survivors stay, up to the count; missing men join at the mark, following; extras leave unseen | `allies.spawnSquad`, `setOrder(follow)` |
| `callins { held }` | Shuts the sky: call-in keys refused with "HELD: AIRSPACE CLOSED", earned ones kept | `holdCallIns` on progression, `CallInManager.shut`, reset by a new run |
| `battle { id, bailiffs, at, militia, from, ensure? }` | A Bailiff squad posted at `at` facing `from`, militia holding at `from` until shot at, booked under `id` so `cleared: id` waits on the Bureau winning | `allies.spawnSquad` and the mission's own squad arrivals |
| `stop { battle }` | Both sides of a battle taken off unseen, the militia unscored | Bailiffs released, militia swept |

**Rule for restarts.** A restart is a rebuilt run with nobody in it and the sky open, so every checkpoint's beat says its own `roster` and
`callins`, and a battle that should still be going says it again with `ensure`. `foreclosure.test.ts` checks this: starting at each
checkpoint gives the squad and sky a play from the top had there.

## Tests

`src/campaign/missions/foreclosure.test.ts`: no dangling names; the plan's sixteen beats in order; line ids; a bot plays it from the top,
after a death in every beat, and from every beat (raising the `war:` signals the real game's systems raise); the squad and the sky at
every checkpoint. `src/campaign/war.test.ts`: the breach watch, a front's contact call-out under its squad name and out of earshot, every
call-out's id. `allies.test.ts`: a held E orders the player's own and leaves a detached man to his battle.

Live: `node tools/shot.mjs --url "/?contract=foreclosure&beat=overwatch&autostart=1" --script tools/scripts/foreclosure-live.mjs --out
tools/out/foreclosure1/f.png --wait 500 --timeout 800 --dpr 2 --w 1440 --h 900` (add `--port 5198` for a private server with no reloads):
the seat flown (guns cycled on the thickest knot, the glide bomb on the fuel farm, flares on every launch), then each beat watched and
cleared, the frame sampled every 2 s, the feed kept.

## For the next stages

- **Holdfast (7): built.** The marks are on the map; the films fly over it (still stand-in shots). For stage 9: `OVERWATCH` lists the
  gunship's targets round the LZ and the anti-air teams' spots (`aaWest`, `aaEast`); `BATTLES` the war's other fights, each with a firing
  line and cover proved; the wall guns are `spec.emplacements` 0 and 1, the roof guns 2 and 3; the technicals have routes. For stage 10:
  the parkour route's marks (`stacksFoot` to `stacksEnd`), Grandad at `quayRoad` (the aisle's north mouth), `doorGun`, `courierWreck`. For
  stage 8: `PANS.loop` and the deck marks, which stand on the salt until Old Mother exists. For stage 11: the flak tower's guns are drawn
  static (`flakGuns()` in `yard.ts`) at `flakGun1..4`.
- **The Frame (3 to 5):** provide `frame(act, at, done)` through `campaign.provide`. `board` must cope with the player already in one:
  `mount` boards by `kneel`, then `foreclosure` opens with `board`. A death in the Frame is the player's death; the checkpoint's `board`
  gives the fresh one.
- **Beats 1 to 6 (9): built** (above). For stage 10: `stacks` stops `squareCounter` and lights the wreck's smoke; the courier's
  flight is `SKY` and `SKY_ROUTES` in `foreclosure.places.ts` (out of `ROUTES`, which the map keeps its dressing off); the war's
  `battle`, `counter`, `posted` and `gunner` helpers in `foreclosure.ts` and the `call`s `crew`, `charge`, `watch`, `wound`, `lose`,
  `courier`, `wreck` in `host.ts` are there for the quay road and the Slip.
