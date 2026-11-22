# Foreclosure: the mission as built

Mission 2 of the campaign, after the Outpost. The plan is `docs/proposals/mission-2-plan.md`; this file says what exists. Updated as
each stage lands.

## Where it stands (all 16 sections built: stages 4, 5, 6, 7, 8, 9, 10, 11)

All sixteen sections run nose to tail on Holdfast with zero stand-ins: the AC-130 overwatch, the Flats, the breach at the wall, the
market, the courier shot down into the Slip, the crane stacks and Grandad, the Quay breather, the three-wave Slip boot hold with the
torn-off door gun and scrolling Bureau Terms & Conditions, the kneeling Distraint Frame board and rampage back through the town with
leg sappers and breakable stalls, the four-gun breakable Flak Tower on the harbour wall, the Pans reveal, the three-phase Old Mother
salt crawler boss fight culminating in hull-breach eject onto her walkable stern deck, and the Harbourmaster cuff-or-kill finale.

- **Play it:** `/?contract=foreclosure` on the dev server, or the menu's Foreclosure tab. From a section: `&beat=<id>`, or the dev
  panel's **MISSION: FORECLOSURE, FROM A BEAT** buttons (F1), which reload the page on that section with its checkpoint's kit.
- **Where:** Holdfast (`docs/notes/holdfast.md`), the contract row's `map: 'holdfast'`. Every place is in
  `src/campaign/missions/foreclosure.places.ts`: `PLACES`, `MARKS`, `BATTLES`, `OVERWATCH`, `ROUTES`, `SKY`, `SKY_ROUTES`.
- **Lock:** shut in the menu until the Outpost is won (`opensAfter: 'outpost'`, `isShut` in `src/contracts/unlocks.ts`), open on the
  dev server.
- **Words & PA:** `foreclosure.lines.ts`, ids `mission.foreclosure.<council|harbour|radio>.<key>`. The Harbourmaster speaks as
  `harbourmaster` ("The Harbourmaster, Holdfast port address", amber on aubergine, loudspeaker horn portrait) with a port-PA squelch
  (`walkietalkie_fire`, pitch `0.84`) before each transmission (`src/campaign/hud.ts`).
- **Story thread:** four Bureau red-goggles Wanted posters mounted along Holdfast's route (Main Gate, Market Square, Crane Aisle,
  Quay crane cab), paired with the Harbourmaster's `stacks.goggles` line connecting the contractor across eleven ports on Day 1.
- **Form numbers:** Foreclosure is 7742-F. Outpost Defense's notice is 7742-G.

## The sections

| # | Section | Checkpoint | What runs | Ends on |
|---|---|---|---|---|
| 1 | `briefing` | none | The Council reads Form 7742-F over the Holdfast flyover film | the film |
| 2 | `overwatch` | `lz`, issued kit | AC-130 gunship over the landing, technicals, roof guns, trench, fuel farm, AA hunters | the lease running out |
| 3 | `landing` | `lz` | The Flats on foot: E taught, rocketeer wounded and revived, two technicals, shack sniper | shacks, sniper and both technicals |
| 4 | `wall` | `shanties` | Enemy gunners on both wall guns, breaching charge or gate launcher | both gunners and a breach |
| 5 | `market` | `gate`, launcher | Riot shields, Warden, roof riflemen, brute, prisoners, shotgunner lost | lane and roofs cleared |
| 6 | `courier` | none | Fees, courier shot down by flak into the Slip, **call-ins held** | courier downed |
| 7 | `stacks` | `square` | Crane aisle & quay road Bailiffs, red-goggles reveal, twin stack snipers, Grandad tank, optional Sabot rack | aisle, snipers and Grandad cleared |
| 8 | `quay` | `quay` | Four Bailiffs, quay breather & resupply, Thresher rack | Thresher taken |
| 9 | `slip` | `slip`, + Thresher | Burning Packmule wreck, torn-off Lv.3 door gun emplacement, booting Frame + scrolling Bureau T&C HUD (85 s), 3 escalating waves (troopers → technical+truck → chopper+juggernaut) | `fc:booted` (100%) |
| 10 | `mount` | `slip` | Kneeling Distraint Frame (`frame kneel`) with open hatch; press E to climb in and play hydraulic rise + cockpit boot | boarded |
| 11 | `foreclosure` | `frame`, in Frame | Rampage back through stacks & market smashing destructible stalls, tossing wrecks, stomping/backhanding militia leg sappers (`fc.sappers:on`), technical, truck, tank | all cleared |
| 12 | `flak` | `harbour`, in Frame | Four articulated breakable twin-88 mm flak turrets (`FlakTower`, 500 HP each, G-paintable, live airburst salvos) + tower guard | `flak:cleared` (all 4 guns destroyed) |
| 13 | `pans` | none | **Call-ins open**, Old Mother revealed patrolling the salt pans (`fc.motherReveal`), Harbourmaster dares you out | `westGate` zone |
| 14 | `mother` | `pans`, in Frame | Three-phase Old Mother (`OldMother`): Phase 1 Hunt (break both 1500 HP tracks, dodge 20 m cutter sweeps, strip 700 HP turrets & 500 HP dorsal pod) → Phase 2 Drag → cutter seizes leg (`mother:seized`) → slow-mo 25 m `frame eject` onto deck | eject onto deck |
| 15 | `deck` | `deck`, on foot | Real walkable Rapier stern deck, cover crates, single Autocannon rack, deck crew, glowing 1200 HP Stern Engine (`mother:engine`) → unarmed Harbourmaster kneels on stern deck: press E to cuff (`fc:cuffed`) or shoot (`fc:killed`) | `fc:harbourDone` |
| 16 | `ending` | `deck`, + autocannon | Choice-aware Council response, deductions, Tallow notice, closing film | finish |

Frame sections say `mission.foreclosure.council.replacement` after a restart ("Replacement Frame issued. The fee has been deducted.").

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

## Tests & verification

- `src/campaign/missions/foreclosure.test.ts`: no dangling names; all sixteen sections in order; line ids; bot playthrough from the top,
  after a death in every section, and from every section (raising `war:`, `fc:`, `flak:`, `mother:` signals); squad & sky parity at every
  checkpoint.
- `src/frame/parts.test.ts`: locational damage routing, small-arms immunity, rear reactor 2.5× criticals, leg crippling, pod destruction,
  canopy crack stages, hull destruction.
- `src/enemies/vehicles/crawler.test.ts`: Old Mother's 3-phase state machine (`dormant` → `hunt` → `drag` → `seizing` → `deck` → `dead`).
- `src/campaign/coop.test.ts` & `src/net/world/credit.test.ts`: co-op classification for all 11 `fc.*` calls and damage credit rules for
  all 6 new enemy/boss sources.
- Full repository suite: **3,125 passed, 0 failed** (`npx vitest run --testTimeout=60000`), `tsc --noEmit` clean, `npm run build` green,
  and two headless GPU Playwright visual passes (`1440×900 @ 2×`, 0 uncaught errors) across `slip`, `mount`, `foreclosure`, `flak`,
  `mother`, and `deck`.

## Mission-specific set pieces (`src/campaign/foreclosure.ts`)

- **Flak Tower (`src/enemies/vehicles/flakTower.ts`):** four articulated breakable twin-88 mm turrets at `FLAK_GUNS` (500 HP each,
  G-pod paintable, live airburst salvos, `flak:gun` / `flak:cleared` signals + roof cook-off). Static placeholder in `yard.ts` removed.
- **Old Mother (`src/enemies/vehicles/crawler.ts`):** 30 m × 14 m × 12 m painted salt crawler patrolling `PANS.loop` in `pans`,
  hunting in `mother` (break both 1,500 HP tracks, dodge 20 m bow cutter sweeps, strip 700 HP turrets & 500 HP dorsal pod), dragging and
  seizing the Frame (`mother:seized`) for a 25 m slow-motion eject onto her real walkable Rapier deck (`CRAWLER.deckY = 6.4`) with cover
  crates, a single live Autocannon rack, deck crew, and the glowing 1,200 HP Stern Engine (`mother:engine`).
- **The Slip (`fc.slipWreck`, `fc.slipBoot`, `fc.slipBootOff`):** burning crashed Packmule fuselage, usable Level-3 Minigun torn-off
  door gun emplacement at `doorGun`, posed booting Distraint Frame, and scrolling Bureau Terms & Conditions boot HUD (`fc:booted`).
- **Sappers & Harbourmaster (`fc.sappers`, `fc.surrender`):** militia sappers rush the Frame's legs during `foreclosure` with 5 s
  satchel charges cleared by stomp or backhand; once Old Mother's Stern Engine blows, the unarmed Harbourmaster kneels on the stern deck
  (`handsUp`) for `[E] CUFF HARBOURMASTER` (`fc:cuffed`) or lethal removal (`fc:killed`), driving choice-aware closing lines.
