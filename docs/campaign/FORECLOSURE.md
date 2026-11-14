# Foreclosure: the mission as built

Mission 2 of the campaign, after the Outpost. The plan is `docs/proposals/mission-2-plan.md`; this file says what exists. Updated as
each stage lands.

## Where it stands (stage 6, the plumbing)

The skeleton: all sixteen beats as rows that run end to end with stand-ins. No map, no Frame, no Old Mother yet.

- **Play it:** `/?contract=foreclosure` on the dev server, or the menu's Foreclosure tab. From a beat: `&beat=<id>`, or the dev panel's
  **MISSION: FORECLOSURE, FROM A BEAT** buttons (F1), which reload the page on that beat with its checkpoint's kit.
- **Where:** the Test Range stands in for Holdfast. Every place is a mark or zone in `src/campaign/missions/foreclosure.ts` named after
  the plan's places (`lz`, `gate`, `square`, `quay`, `slip`, `harbour`, `pans`, `deck`, ...). Stage 7 moves those names onto Holdfast and
  sets the contract row's `map`.
- **Lock:** the row is shut in the menu until the Outpost is won (`opensAfter: 'outpost'`, `isShut` in `src/contracts/unlocks.ts`), and
  open on the dev server, as every lock is there. It is not `locked: true`, because that flag means "after the campaign" and
  `contracts.test.ts` pins the rows that carry it.
- **Words:** `foreclosure.lines.ts`, rows only, ids `mission.foreclosure.<council|harbour|radio>.<key>`. The Council's recorded
  `mission.council.brief.line` and its two redeploy takes are the Outpost's rows, by id. The Harbourmaster speaks as `intercept` until
  she has her own speaker and PA tone.

## The beats

| # | Beat | Checkpoint | What runs now | Ends on |
|---|---|---|---|---|
| 1 | `briefing` | none | Council lines, a stand-in film over the range | the film |
| 2 | `overwatch` | `lz`, issued kit | Six Bailiffs at the LZ, four militia holding at the shacks, `sortie` over the LZ | the lease running out |
| 3 | `landing` | `lz` | The squad, militia (`ensure`d), a technical with crew, the E hint | `flats` and the technical's crew cleared |
| 4 | `wall` | `shanties` | Battle `eastStreet` starts, two gunners on the wall, the launcher rack | gunners cleared and the launcher taken |
| 5 | `market` | `gate`, launcher | `eastStreet` again with `ensure`, a riot line | `lanes` cleared |
| 6 | `courier` | none | `eastStreet` stopped, the fees, a banner for the crash, **call-ins held** | 4 s |
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
after a death in every beat, and from every beat; the squad and the sky at every checkpoint.

## For the next stages

- **Holdfast (7):** replace `MARKS` and `ZONES` by name, set `map` on the contract row (and `MAP_IDS` in `contracts/select.ts`), add
  routes for the technicals. The briefing and ending films are stand-ins over the range.
- **The Frame (3 to 5):** provide `frame(act, at, done)` through `campaign.provide`. `board` must cope with the player already in one:
  `mount` boards by `kneel`, then `foreclosure` opens with `board`. A death in the Frame is the player's death; the checkpoint's `board`
  gives the fresh one.
- **Beats 1 to 6 (9):** the real overwatch (eighteen men, technicals, anti-air, the gunship centred on the LZ: `boardCallIn` needs a
  point), enemy gunners on the wall guns, the breach, the market's dead Bailiff, the courier and flak tower. More battles with
  `battle`/`stop`; the far battle is not built.
- **Allies:** a held E (`toggleSquad`) orders every ally, battle squads included, and there is no public way to take a man off unseen
  (`GameHost.dismiss` reaches the private `release`). Both want a word with `src/allies`.
- **Form number:** Outpost Defense's notice also says Form 7742-F. The plan gives 7742-F to Foreclosure.
