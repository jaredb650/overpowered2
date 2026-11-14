# Contracts, sonar and the comms feed

`src/contracts/`. Section 15 of DESIGN.md is the source of truth. `createContracts(ctx)` from `index.ts`, on `ctx.contracts`.

| File | What it is |
|---|---|
| `data.ts` | `CONTRACTS`, the Council's copy, `SONAR`. No three.js, so anything can read it |
| `select.ts` | `ACTIVE`: which contract and map this page runs. The URL rules, and the route to another contract |
| `scores.ts` | One high score per contract in localStorage |
| `sonar.ts` | Key T: cooldown, ping, reveal |
| `rewards.ts` | The back-shot bonus |
| `index.ts` | The system: `def`, `sonar`, frame update, reset |

## Adding a society

Add a row to `CONTRACTS`: map, faction, wave source, AI rule set, wound rules, rewards, briefing, score key. The menu, the high score table, the map choice and the URL all follow from the row. `ContractId` needs the new id, and a new rule set needs its id added to the union it belongs to. Nothing else in this folder changes.

## Reading the contract

```ts
import { ACTIVE } from '../contracts/select';   // from anywhere, at any time, including before systems exist
ACTIVE.def.ai === 'outpost';                    // also .waves, .wounds, .faction, .rewards
ctx.contracts.def;                              // the same row, from a system
ACTIVE.ranked;                                  // false on a map the contract does not own
```

`waves`, `ai` and `wounds` are ids. This folder does not implement them: the enemy systems choose their behaviour from them. The Crucible's row has to keep meaning exactly what the game did before contracts: `swarm`, `swarm`, `limbs`, and a back-shot multiplier of 1.

## URLs

| URL | Contract | Map | Scores |
|---|---|---|---|
| `/` | The Crucible | Crucible | Kept |
| `/?contract=campaign` | The Campaign: the Outpost mission | Outpost | Kept |
| `/?map=outpost` | The Campaign: nothing else plays there until it is beaten | Outpost | Kept |
| `/?contract=outpost` | Endless Humans. The id is older than the campaign | Kill House | Kept |
| `/?map=killhouse` | Endless Humans: the contract that plays there | Kill House | Kept |
| `/?map=crucible` | The Crucible | Crucible | Kept |
| `/?map=range` | The Crucible's rules. No contract owns it | Test Range | Not kept |
| `/?contract=defense` | Outpost Defense: the economy, shops and loadout. On the Test Range until the fort map lands | Test Range | Kept |
| `/?contract=crucible&map=killhouse` | The Crucible's rules | Kill House | Not kept |

`/` is always the default contract. There is no remembered choice, so the URL is the only state and a sandbox can never open on the wrong map.

## Outpost Defense

`src/contracts/defense/`, pieces 5, 7 and 8 of `docs/proposals/outpost-defense.md`. The contract row `defense` (`economy: true`, `map: 'fort'`)
under Endless Humans: its AI and wounds on the fort (`docs/notes/fort.md`), with its own wave director, credits, a loadout screen, three shops,
breaks and the player's mortar teams. Locked with Endless Humans until the campaign is beaten
(`?unlock=1`, or the dev server, opens it).

| File | Job |
|---|---|
| `defense/data.ts` | Every number: `ECONOMY` (budget, pay, breaks, squad cap, repair time), `WEAPON_PRICES`, `ALLY_PRICES`, `CALLIN_PRICES`, `MOUNT_PRICES`, `REPAIR_PRICES`, `STIM_PRICE`, `SHOPS` (health, rebuild) |
| `defense/economy.ts` | Pure rules over a `ShopView` snapshot: `offers(shop, view)` with each row's price and why it is shut, `checkLoadout`, `ShopState` |
| `defense/index.ts` | `Defense` on `ctx.contracts.defense`: credits, the counters in the world and E, buying, the break hook, shop loss, `window.__defense` and a DEFENSE lab section |
| `ui/screens/loadout.ts`, `ui/screens/shop.ts` | The two menus, on the settings sheet's rail and rows |
| `defense/waves.ts` | The wave plan as data: `planWave(wave)`, the boss order, `previewLine`, `DIRECTOR` (alive cap, men a wave, breaks) |
| `defense/director.ts` | `DefenseDirector`, `ctx.waves` on the fort: feeds squads from the fence, trucks and tanks up the lanes, helicopters, bosses, bombers |
| `defense/siege.ts` | What every attacker does: assault, sappers and their charges, engineers' sandbags and jump pads, enemy mortar teams, bosses at the walls, shop raids |
| `defense/field.ts` | The rules as arithmetic: rings and depth, `SATCHEL` and `satchelBlast`, `MortarCrew`, `pickMortarTarget` |
| `defense/shells.ts` | Mortar rounds in the air for both sides: thump, arc with a smoke trail, whistle, floor ring, landing |
| `defense/teams.ts` | The player's mortar teams (piece 8) |
| `ui/hud/defense.ts` | Credits, the next wave's line in a break with `L: START NOW`, the three shops (red while lost), under the wave plate |

**Start it.** `/?contract=defense` (or `/?map=fort`), or Outpost Defense on the menu: the fort. `?contract=defense&map=range` is the old
Test Range stand-in (counters behind the spawn, Endless Humans' squads as waves, no mortar posts); a bare `?map=range` stays the lab's.

**How to play it.** Pick a primary and a secondary, deploy, and use the 20 s break: the Barracks is in the outer ring's south band, the
Armoury in the middle ring's north band, the Infirmary in the core's north-west corner; the minimap shows each as a lettered tile in its
colour (B, A, I; grey while lost; held on the rim when off the map, so it points the way), and every ally as a cyan dot (amber while down).
You start with a free garrison, `ECONOMY.startRiflemen` (6, two squads of three), already on six of the outer ring's twelve rifleman posts,
every other one (`startPosts`), so each side has two or one; on the range stand-in they stand in a 10 m ring round the rally point, facing
out. They are ordinary allies (E, revive, death) and count toward the squad cap. Walk in and press E at the counter. Hires gather
outside the Barracks door and walk to a post of their type (`FORT_POSTS`; riot police to `FORT_BREACH_POINTS`, and to any breach as it
opens). The break line says what the next wave brings; **L** starts it now (its countdown drops to 3 s). Hold the walls from the catwalks,
shoot the men with charges before they reach the wall, kill mortar crews in the field pits (a red `MORTAR` marker hangs over a manned one),
blow engineers' sandbags and jump pads, and repair walls from the Barracks between fights.

**Flow.** A new run opens the loadout over a paused game. Deploy arms the player (`weapons.setLoadout([primary, secondary, 'knife'], 0)`),
the budget left becomes credits, and the first break (20 s) starts. Walk up to a counter (2.6 m) and press E: the run pauses under its menu.
Enter or a click buys, Esc, E or Close goes back. A shop menu pauses the world, so shopping under fire costs the walk, not the clock.

**Credits.** `killPay`: 10 a kill, 15 a head, the player's and his call-ins'; an ally's pay nothing. `wavePay`: 125 + 25 per wave number when
a wave clears. Budget 1,600: the Harrow and the Rivet leave 300. Killing everything in waves 1 to 3 leaves 1,125, short of the rocketeer at
1,200; wave 4 takes it to about 1,490 (Q4; `economy.test.ts`).

| Shop | Sells | Lost means |
|---|---|---|
| Barracks | Rifleman 250, machine gunner 500, shotgunner 500, riot 750, medic 750, sniper 1,100, rocketeer 1,200; mortar team 1,200, one a mortar post (4 on the fort, outside the squad cap). Squad cap 20 with the free six, so 14 more can be hired, up or down, so a dead man frees his place. Repairs: wall 250 and gate 350 a stage, half for a chip, 4 s of work through `Structure.repair` | No troops, no repairs |
| Armoury | Weapons only in a break (a base brings its family member and is priced for both). Ammunition by gun: a box is half the most reserve, 50 to 90 for basic, 200 to 300 specialty, 260 to 450 explosive (the Quiver cheapest). Grenades 150. Mounted gun to level 2 for 700, 3 for 1,600. Call-ins 600 (airstrike) to 8,000 (nuke), any time, not while one is held or rearming | No weapons, special ammo, upgrades or call-ins |
| Infirmary | Stim 150 up to 5. Basic ammo 100: half a reserve for every basic gun | No stims, no resupply |

A lost shop (`damageShop(id, amount)`, `ShopState`, 1,500 health each) sells only its rebuild, in a break: barracks 2,500, armoury 3,000,
infirmary 3,500. Its sign and HUD chip go red and the banner says so. Attackers inside a ring shoot its shop: 10 a second each within 6 m of the
building (`FORT_SHOPS` target box), so four men take a shop in under 40 s.

**What else this contract turns off** (`economy` on the row): combo call-ins (`progression/index.ts` skips `offer`), weapon cache pods and kill
drops, and the wave-end ammo floor (`Weapons.ts`). Every mounted gun goes back to level 1 at a new run.

**The wave hook** (`DefenseWaves` in `defense/index.ts`). Whatever `ctx.waves` is on this contract: Defense reads `wave` and `phase`,
listens to `wave:start` and `wave:clear`, writes `nextWaveIn` once as each break begins, and calls `preview(wave)` and `breakSeconds(wave)`
if they exist. On the fort `createWaves` builds the `DefenseDirector`; on the range stand-in it is Endless Humans' `OutpostWaves`.

**The waves** (`waves.ts`). Humans only, endless. Each band keeps what came before it. Men on foot: 8 on wave 1, 2 more a wave, to 64,
fed through the fence 20 alive at most (`DIRECTOR.aliveCap`, under the game's 48); their health climbs with the wave (`waveScale`, 8.5% a
wave) and their rank odds with it. One or two sides of the fort early, three from wave 4, all four from 10.

| Wave | Who comes |
|---|---|
| 1 to 3 | Riflemen and shotgunners in squads of 4 or 5. 2, 2 and 3 of the riflemen carry satchel charges |
| 4 to 6 | Plus enemy mortar teams (1, 1, 2; two men each) and engineers (1, then one more every third wave, to 4) |
| 7 to 9 | Plus a troop truck (5 men) and a scout car (2) up the lanes, more later; rocketeers in the squads |
| 10 on | Plus bombers (2, one more every third wave, to 8), snipers and machine gunners in the squads |
| 5, 10, 15, 20, 25 | Tanks, attack helicopters, the Juggernaut, the Titan, then all four; 60% of a wave's men as escort |
| 30, 35, ... | The order again with one more of each (a second Titan every other round) |

Breaks: 20 s before wave 1, 30 s, 40 s before a boss wave. The break line is `previewLine` (`1 TANK, 12 men on foot, 1 with charges, ...`).

**The siege** (`siege.ts`). The Outpost's squad brain hunts a player it can route to; behind shut gates it stands at the fence. So every
man is in a directed squad and the siege gives each squad, read off its leader: the shop in its ring if it stands, else a way into the next
ring (a breached wall or blown gate, as a point inside it, or an engineer's jump pad), else cover 20 m out from that wall (7 m in a yard),
facing it. A squad with no way in for 30 s hands a rifleman a charge. In the player's ring, within 30 m of him, the squad brain takes over;
further off the siege walks them to cover near him. Routes go through `RouteFinder.find` with a bigger budget (30,000 nodes) and round
the ring's corners a leg at a time; men from trucks and gun seats are taken on as they appear.

- **Satchel charges** (`SATCHEL`): the sapper runs to the nearest standing wall or gate of the next ring (a gate counts 14 m nearer), kneels
  2.2 s, sets the Commander's charge model with its blink and a 5 m red ring on the floor, and runs back. 7 s later it wears the wall
  through `world.objects.damageExplosivesInRadius` (420: a gate in one, a wall stage in each) and blasts anyone there (70, 5 m). Shoot the
  carrier and there is no charge; shoot the charge and it pops early for 42, a chip on the wall.
- **Enemy mortar teams**: two men walk to a free `FORT_MORTARS` pit on their side. Standing still at the pit for 4 s sets up the tube (the
  Commander's model) and hangs `MORTAR` over it; then a salvo of 3 every 11 s, 60% on the player when he is inside the walls, else along
  the walls they face, each round 50 in 6 m with the red ring and the whistle. A crewman moving or knocked off the pit starts the setup
  over (`MortarCrew`); kill both, or blast the tube, and the team is done and its men join the assault.
- **Engineers**: over a damaged wall of the next ring with no pad yet, 5 s of work puts a jump pad 1.5 m out from it; any attacker taking that
  way is thrown onto the rampart (`leapTo`, 0.95 s, 4 m over). Otherwise, out in the field, a sandbag wall (3.2 by 1.15 m, a real collider)
  16 to 26 m out, that squads with no way in take cover behind. Two blasts take a sandbag wall, one a pad; a breach under a pad removes it.
- **Bosses and bombers** keep the swarm's brain. While they have no path to the player a `siege` behaviour walks them to the wall in the
  way: a bomber blows himself up against it (380 to the wall); a Juggernaut beats it for 70 a second, a Titan 140. Tanks drive up a lane to
  the track and shell (their shells count 4 times on walls); helicopters come one at a time from the air spawns and circle the fort.

**The Commander** is built with the Outpost but never asked to compose a wave or brief a break here, and `Person.arm` refuses an economy
contract, so he never comes down in person and nothing can end the run with CONTRACT FULFILLED.

**The radio** (`radio.ts`, on the fort; docs/notes/commander.md, "Outpost Defense: the radio"). His Kill House lines are off here. He threatens
in lines written for the fort (a wave, armour, the helicopter, a charge, a breach, a shop, a repair, his losses), and the Council, as the
player's handler, says what is coming and from which side: `Wave 4. Hostiles massing to the north and east.`, reinforcements by side,
each machine by the side it comes from, bosses, mortars, engineers, charges and breaches by ring and side, shops under attack and lost,
the wave cleared, ten seconds to the next. One speaker at a time; her warnings are never dropped. The player's own men call out on the
comms feed in green: `Breach! Outer wall, north side!`, contact by side, man down, reloading, a shop under attack. Text only: no line has
a recording.

**The player's mortar teams** (`teams.ts`, piece 8). Bought at the Barracks for 1,200, posted at the next free mortar post (four, in the
middle ring's yards): a tube, crates and a cyan beacon, no crew to fight anything. During a wave each fires every 8 to 13 s
(`TEAM_MORTAR`): `pickMortarTarget` weighs every enemy body and ground vehicle out in the field (1 each, 4 for a vehicle, plus the
square of the bodies within 7 m), adds 3.5 m of scatter and pushes the point out to 9 m past the outer wall's line; with nothing out
there a round still lands somewhere in the field. The round thumps out of the tube, climbs on a lit arc with a smoke trail, whistles and
lands as an ally's rocket does: enemies, vehicles, shacks and sandbags, never the player or his men. Its kills are `ally_mortar`, paid
nothing.

**Who is paid** (`paysFor` in `data.ts`): the player's kills and his call-ins'. Not an ally's (`ally_`), including an ally on a mounted gun
(the gun's rounds are `ally_emplacement` whenever the seat is not the player's, `gunSource` in `vehicles/emplacement.ts`) and the mortar
teams; not the enemy's own mortars, mines or charges.

**Dev.** `window.__defense` (`earn(n)`, `skipBreak()`, `startNow()`, `damageShop(id, n)`, `offers(id)`, `buy(id, act)`, `mortars`), the DEFENSE
lab section (+1000, skip break, hit each shop 500), `__op2.ctx.waves.jumpTo(n)` and `.describe()` (with `siege` in it), and
`tools/scripts/defense-live.mjs`:

```
node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/defense-live.mjs --wait 500 --timeout 280 --dpr 2 --w 1440 --h 900 --out tools/out/economy/live.png
DEFENSE_STEP=waves node tools/shot.mjs --url "/?contract=defense&autostart=1" --script tools/scripts/defense-live.mjs --wait 500 --timeout 900 --dpr 2 --w 1440 --h 900 --out tools/out/defense/w.png
```

A private server for long runs: `OP2_NO_HMR=1 npx vite --port <n>`, and `--port <n>` on `shot.mjs`; with HMR on, another agent's edit
reloads the page mid-run. Tests: `src/contracts/defense/director.test.ts` (the plan, charges on a real wall, mortar crews, the Commander,
the early start, who is paid, the player's mortars) and `economy.test.ts`.

**Verified** (2026-11-14, real Chrome at 1440x900, dpr 2, `defense-live.mjs` on a private server of the commit): the loadout by
keys (Judge picked, 50 left, back to the Rivet, Deploy: 300 credits, Harrow, Rivet and Shiv owned); the 20 s break with the plate's countdown,
the credits and the next-wave line; E at each counter; a rifleman hired (squad 1), an airstrike bought (held, banner READY), a stim (2);
credits 300 + 4,000 - 250 - 600 - 150 = 3,300; in wave 1 every weapon row read `Only in a break`; the infirmary lost (red sign, red chip,
banner) offered only its rebuild, `Only in a break`. Screens in `tools/out/economy/`.

**Garrison and the minimap** (2026-11-14, `defense-garrison.mjs`, dpr 2, 1440x900, the owner's dev server): six riflemen up at deploy,
at (-49, 20), (-13, 51) and the rest round the outer ring; the minimap with B, A and I and the cyan dots (`tools/out/defense2/g-start.png`),
one downed and amber on it (`g-down.png`). Then 14 hired to the cap of 20 (two more refused, `Squad full, 20`) and wave 5 for 45 s in god
mode: `AllySystem.update` median 0.2 ms, p95 1.4 ms, worst 4.2 ms over 2,712 frames; frames median 16.7, p95 16.8 ms (the harness's
60 Hz cap). A light fight: 3 of the 20 shooting at the end, 8 enemies alive.

**Verified, the waves** (2026-11-14, `DEFENSE_STEP=waves`, real Chrome 1440x900 dpr 2, a private no-HMR server; the bot holds the outer
catwalk with an aimbot, health and ammunition topped up, two mortar teams and four allies bought). Wave 1: sappers set charges on the north
wall; one blew a segment to damaged, a second breached it, the rest of the squad went in and shot at the Barracks (smoke run: 83 hits in 20 s).
Wave 4 with nobody shooting back (diagnosis run): squads from the west and south rounded the corners to a breach, raided the Barracks to
nothing in about 35 s, then hunted the player along the yard; the mortar team set up in its pit and fired 6 salvos; the engineer built a
pad over a damaged wall and three sandbag walls. Wave 5 under the bot: 5 men leapt over two pads, the tank drove up the north lane and
shelled, the Barracks fell at about 100 s. Wave 15: the Juggernaut dropped onto the field and walked to the wall; charges and pads kept
coming. The player's two teams fired 94 rounds over the run; none landed inside the walls. Frame cost in wave 5 (10 enemies, 4 allies, the
tank, shells in the air): 307 draw calls, 576k triangles, frames at the harness's 60 Hz cap (median and p95 16.7 ms); wave 15 with 22
enemies: 384 calls, 786k triangles. No console errors. Screens in `tools/out/defense/`.

**Rough.**
- **Nobody has played it, and the prices are first guesses** held to Q3 and Q4 by tests, not by feel.
- **A shop's menu pauses the world.** See the proposal's section on the build.
- **On the Test Range stand-in** the waves are Endless Humans' from the corner spawns, the counters are boxes, and hires share one rally point.
- **Mounted guns are reached through a cast** to the call-in manager's private `emplacements`, as the lab does. A public getter on
  progression would be cleaner.
- **Allies do not man the mounted guns.** A machine gunner posted on a gun stands behind it. If one ever mans it, its kills pay nothing.
- **The siege is tactics by hand.** Squads with no way in sit in cover until a charge, a pad or a 30 s stall gets them moving; engineers'
  sandbags are not in the cover map, and men go behind them by hand. The squad brain's flanks and grenades only come in near the player.
- **Shop raids are tracers and a number.** Men at a shop fire visible rounds at its wall and its health goes down; the building does not
  show wear, and nothing but the HUD chip and the banner says it is lost.
- **Enemy mortars land on allies without hurting them** (allies are hurt only by rounds aimed at them), and the player's mortar crews are
  a tube and a beacon, no men.
- **Bosses beat on a wall standing still**; there is no animation for it, only dust.

## Unlocks

Endless Humans has `locked: true`. `unlocks.ts` holds one flag, `op2_campaign_beaten` in localStorage, set when a mission with `unlocks` is won from its first beat. A win reached through `?beat=` beats nothing. `?unlock=1` opens it for that page and any it moves on to. The menu shows a shut contract and refuses to start it. A URL or `?autostart=1` still reaches it, because every bot and sandbox on the Kill House goes in that way.

## Changing contract is a page load

`World` builds one map at boot, and pulling a map out from under physics, nav, the light volume, the pickups and every pool is a far bigger job than a load of about 10 s. A reload also hands back all of the old map's GPU memory, which matters on 8 GB.

Pointer lock and audio both need a fresh gesture after a load, so the click cannot be saved. Instead Play sends the browser to `?contract=<id>&deploy=1`, and the splash reads `Click to deploy: <name>`. That one click unlocks audio, takes the mouse and starts the run. `takeDeploy` strips the flag, so a refresh shows the normal splash. Dev flags such as `?dev=1` survive the move. `map` and `autostart` do not.

## Sonar

Key T, action `sonar`, rebindable. `SONAR` in `data.ts` has every number.

Press, then `sonar:tap` raises the left hand. `tapLead` later the fingers land, the sound plays, the ring leaves and `sonar:ping` goes out. The ring crosses any map in 1.6 s, so it runs at about 60 m/s in the Kill House and 230 m/s at The Crucible. Enemies are lit as it reaches them, for the rest of 4 s, and fade over the last 0.7 s. The cooldown runs from the key press: 8 s, or 3 s at 3 or fewer `enemies.remaining`, and it shortens the moment the count falls. A press on cooldown plays `ui_error`.

It runs on `playerDt`: SLOWMO does not stretch it, a hit-stop does.

A hand holding a grenade or a device keeps it. The ping goes out without the tap.

Rendering is in `docs/notes/render.md`. The minimap pulses every enemy while the reveal runs. The chip is `ui/hud/sonar.ts`.

## Rewards

**Geneva Suggestion.** `enemy:executed`, from the Outpost, pays `STYLE.geneva` through the usual multipliers on top of the kill, and grants the `geneva` effect: 6 s, stacks to 5, +20% damage and +12% fire rate a stack. Numbers are in `progression/data.ts`.

**Back shots.** `enemy:backshot`, from the Outpost, pays `rewards.backShot - 1` of the hit again as a second hit on the same spot, through `enemies.applyDamage`. That way armour, limb pools and the kill all go through the damage model. A head hit is skipped: it has its own multiplier, and a second one would pay its score twice. A `BACK SHOT` label floats at most once a second.

It is a second hit and not a multiplier on the first because the first has already been dealt by the time the event goes out. A multiplier in the damage model would be cleaner if whoever owns that file wants it, and then `BackShots` can shrink to the label.

## Comms feed

`comms:line` (`CommsLine` in `enemies/outpost/events.ts`) goes to `CommsFeed` in `ui/hud/feed.ts`: four lines at most, six seconds each, above the sonar chip. The speaker shows, or the squad when the speaker is null. `fear`, `panic`, `surrender` and `squadGone` show amber, the player's own men (`ally`, Outpost Defense's `radio.ts`) green (`--friend`), everything else cold. Text only for now.

## Tuning knobs

| Want | Change |
|---|---|
| Sonar timing, range, colours | `SONAR` |
| How a silhouette looks | `SILHOUETTE_FRAG` in `render/XRay.ts` |
| How the ring looks | `SWEEP_FRAG` in `render/XRay.ts` |
| Tap pose | `TAP_*` in `weapons/viewmodels/offhand.ts`, `HANDS.tap` |
| Ping sound | `sonar_ping` in `audio/synth/recipes/rewards.ts` |
| Council copy | `briefing` rows and `NOTICE_*` in `data.ts` |
| Geneva | `STYLE.geneva`, `STACK.geneva*`, `EFFECTS.geneva` in `progression/data.ts` |
| Back shots | `rewards.backShot` on the contract |

## Verified

Real headless Chrome through `tools/shot.mjs` at `--dpr 2 --w 1440 --h 900`, on real clicks and keys unless noted. The machine was shared with other agents throughout, so no frame rate here means anything.

| Thing | How | Result |
|---|---|---|
| Contract select | Mouse, arrow keys, Enter | Tabs, notices and focus agree. Guide, Settings and Play all still reachable |
| High scores | Seeded both keys, read the menu, reloaded | The Outpost's record shows from a Crucible page, and each contract keeps its own key |
| Switching | Play with The Outpost selected, from `/` | Page load, `Click to deploy: The Outpost`, URL left as `?contract=outpost`, one click: playing, mouse locked, `def.id` outpost, map killhouse |
| Sonar key | Real T with the mouse locked | Ping fired. A second press during the cooldown changed nothing |
| Cooldown | Read from `ctx.contracts.sonar` | 8 with 18 left, 3 with 3 or fewer, and it fell the moment the count did |
| Reveal | 5 to 18 enemies, Kill House and Crucible | Red silhouettes through concrete, behind walls and on a lit wall. Not drawn over the gun |
| Geneva Suggestion | Raised `enemy:executed` from a script | +400, damage 1.2 then 1.4, fire rate 1.12 then 1.24, 2 stacks, 6 s, banner, feed and row all show |
| Back shots | `applyDamage` on a live soldier, so the Outpost's own check raised the event | 20 damage took 30 from behind, 20 from the front |
| Comms | Lines raised by script, and the Outpost's own | Speaker, squad fallback, amber for panic, wrapping |
| Guide | All seven tabs at 1280x720 | Every panel fits with no scroll |
| Sandboxes | `/?sandbox=progression`, `/?sandbox=ui` | 116 of 116. The UI sandbox shows the key cell as `sonar`, because its stub has no label for it |

**Cost.** With nothing lit, a frame pays one branch and no draw. With 18 husks lit at The Crucible, the whole frame between GPU syncs went from 8.0 to 8.15 ms, best of six, twice over. `render()` on the first ping peaked at 7 ms against 3 ms on the second, and both 1.4 s windows held 83 or 84 frames, so the first compile did not show up as a hitch here. A slower driver may differ.

## Known limitations

- **Nobody has played this with hands, and nothing here has been listened to.** The ping's level, the tap's timing and whether 4 s and 8 s feel right are all unjudged. The ring has only been seen in stills, held at a chosen radius.
- **The body only.** `highlight` is given `char.mesh`, so a carried gun or a riot shield does not show in the silhouette.
- **Far enemies are small.** At The Crucible a body 150 m away is a few red pixels. Nothing scales it up. The minimap pulse covers the distance, and with 3 left the HUD markers do.
- **Silhouettes leave during pause.** A paused frame runs no `update`, so nothing calls `highlight`. They are back on resume, and the clock has not moved.
- **SSR can catch a silhouette** on a wet floor, because SSR reads last frame's HDR image.
- **The ring only runs over surfaces.** Looking straight up in the open Kill House shows none of it.
- **`faction`, `waves` and `wounds` are read by nothing yet.** The Outpost keys off `ACTIVE.def.ai` for all of it, and swaps its wave loop in behind `ctx.waves`. They are in the table because a contract is defined by them, and the first second-faction contract will need to split them.
