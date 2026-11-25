# Endless War — Master Design & Architecture Plan

A massive, nonstop combined-arms war mode (`map: 'endless_war'`, `contract: 'endless_war'`) set on an overcast, war-torn muddy front divided by a wide river and fortified choke points. No waves, no downtimes, no victory screen — just escalating total war until the enemy eventually overwhelms your base.

---

## 1. Core Experience & Pillars

1. **Massive Scale (Biggest Map in the Game — Packed With Terrain, Never Empty):**
   - **Ground battlefield (`navBounds`):** **`480 m wide × 720 m long`** (`345,600 m²` — **~2.8× Badlands' ground area** and **over 2× the push length** from Friendly FOB to Enemy Fortress).
   - **Flyable airspace (`bounds`):** **`2,200 m × 2,200 m`**, ceiling **`y = 380 m`** (**~39× Badlands' airspace**, larger than Halcyon/Strait), with storm-swept valley ridges and river continuation extending visually out to `±2,600 m` inside the camera's `3,600 m` far plane.
   - **Voxel Lighting (`lightBounds`):** Covers the full `480 m × 72 m × 720 m` battlefield at `lightCell = 3.6 m` (`[134, 20, 200]`, cleanly within `LightVolume`'s `[200, 48, 200]` hard cap).
   - **No empty wasteland:** Every 80–100 m belt is filled with mud trenches, shell craters, wrecked armor, ruined bridgehead buildings, dragon's teeth, bunkers, ridges, and fortified enemy assets so pushing north feels like a real multi-stage military campaign.
2. **No Waves, No Downtimes:**
   - Combat runs continuously from second 0. Both armies pour troops, armor, choppers, and jets into the front nonstop.
3. **Autonomous Friendly Army (Zero Micromanagement):**
   - Your friendly forces spawn, advance, hold trenches, cross bridges, and exploit breakthroughs **entirely on their own**. You are a frontline ace / hero unit (foot soldier, Distraint Frame pilot, tank commander, or fighter/bomber pilot) — not an RTS babysitter.
   - A **War Command Console** inside Friendly FOB lets you spend earned combat credits on big **reinforcement boosts** (armored spearheads, airborne drops, jet/bomber wings, artillery barrages) to swing momentum.
4. **Pushing Past the River = Real Momentum:**
   - Fighting past the midpoint river bridges lets you reach and destroy **enemy strategic facilities** (fuel depots, artillery batteries, radar/AA nets, motor pools, airfield towers).
   - Blowing them up **cripples enemy capabilities**, pays huge credit bounties, and triggers a **Momentum Surge** that pushes your entire friendly army deeper north behind you.
5. **True Endless Escalation & Inevitable Defeat:**
   - There is **no victory screen**. An unstoppable **Threat Level** ramps continuously over time — eventually throwing relentless multi-lane tank columns, attack choppers, enemy jets, Juggernauts, and Titans until the enemy breaks your line and storms your base.
   - **Infinite player respawn** at Friendly FOB (`~4 s` redeploy).
   - **Lose condition:** Friendly FOB Command Core is destroyed. The FOB is heavily armored with strong automated perimeter defenses so you never have to babysit it — it only falls once your friendly army is wiped out and the enemy overwhelms your gates.

---

## 2. Atmosphere & Battlefield Layout (`480 m × 720 m` Ground / `2,200 m` Sky)

### Visual Vibe — Overcast Mud & Concrete War Front
- New **`'overcast'` atmosphere preset** in `src/render/Renderer.ts`:
  - Heavy storm-gray overcast sky dome with a high volumetric cloud deck (`y = 220–290 m`) for jets to climb into and dive out of.
  - Rain-soaked dark mud, wet concrete trenches, blasted tree stumps, burning tank wrecks with dark smoke plumes, and crisp moody fog so distant mountains fade naturally while gunfire, tracers, artillery flashes, and fiery explosions pop dramatically.

### Battlefield Map (`z = +360` South Friendly FOB → `z = -360` North Enemy Fortress)

```text
                      z = -360  [ NORTH: ENEMY FORTRESS "IRON BASTION" ]
   x = -240 +-------------------------------------------------------------------+ x = +240
            |  [MOTOR POOL]*        [CITADEL BARRACKS]      [AIRFIELD TOWER]*   |  Sector 4:
            |  (Enemy Tanks)        (Heavy Garrison)        (Choppers & Jets)   |  Enemy
            |  [Flak/SAMs]      ==== GATE W / C / E ====    [Runway & Helipads] |  Fortress
            +-------------------------------------------------------------------+  z = -255
            |                                                                   |
            |  [FUEL & AMMO]*       [ARTILLERY RIDGE]*      [RADAR & AA NET]*   |  Sector 3:
            |  (West Compound)      (Mortar Batteries)      (East Hill SAMs)    |  North
            |  [Trenches & Wire]    [Concrete Bunkers]      [Pillboxes & AA]    |  Defense
            |  [North Bridgehead]   [Center Tank Traps]     [East Dam Overlook] |  Belt
   z = -30  +======[ W ]=================[ C ]===================[ E ]==========+
   RIVER    ~~~~~~~~| |~~~~~~~~~~~~~~~~~~~| |~~~~~~~~~~~~~~~~~~~~~| |~~~~~~~~~~~~  THE RIVER
   (60 m)   ~~~~ [RAIL &] ~~~~~~~~~~~ [HIGHWAY] ~~~~~~~~~~~~~ [BROKEN DAM] ~~~~~~  (Midpoint
   z = +30  +======[PONTOON]=============[BRIDGE]================[& FORD]=======+   Chokepoint)
            |  [Ruined Mill]        [Bridgehead Ruins]      [Flooded Quarry]    |  Sector 2:
            |  [Dragon's Teeth]     [Wrecked Convoy]        [Rocky Embankment]  |  South
            |  [West Trench Line]---[Center Mud Trenches]---[East Bunker Line]  |  Front &
            |  (Duckboards, Firing Steps, Shell Craters, Barbed-Wire Lanes)     |  Trenches
            +-------------------------------------------------------------------+  z = +255
            |  [CIWS/SAM]    === GATE W ==== GATE C ==== GATE E ===  [CIWS/SAM] |  Sector 1:
            |  [Runway Strip]    [Motor Pool & Frame Terminal]  [War Command]   |  Friendly
            |  [Vehicle Pad]     [FOB COMMAND CORE (25k HP)]    [Procurement]   |  FOB
   x = -240 +-------------------------------------------------------------------+ x = +240
                      z = +360  [ SOUTH: FRIENDLY FOB "VANGUARD" ]

   * = Destructible Enemy Strategic Facility (disables enemy capability + triggers Momentum Surge)
```

### Layered Choke Points & Terrain Design

Armies cannot simply bulldoze in a straight line — every sector funnels and intensifies combat:

1. **Sector 1 — Friendly FOB "Vanguard" (`z = +255..+355`):**
   - Reinforced concrete perimeter wall with 3 wide armored gates (`24 m` clear each) and 4 automated **CIWS / SAM defense turrets** on corner bastions.
   - **FOB Command Core** (`25,000 HP`, heavy armored bunker at center-south) — the lose-condition objective.
   - **Free Motor Pool & Frame Terminal** (reuses `BadlandsTerminalUi` + `BadlandsTerminalController`) with a concrete staging pad and clear **160 m north-facing concrete airstrip** along the west wing for effortless jet takeoffs.
   - **Always-Open Procurement Pod** right beside the staging pad (buy weapons, mods, implants, brain chips, and Frame parts mid-battle with zero downtime).
   - **War Command Console** right next to the terminal to call paid reinforcement boosts.

2. **Sector 2 — South Trench Belt & River Approaches (`z = +30..+255`):**
   - **Mud Trench Network (`z = +155..+230`):** Interlocking zig-zag trenches (`~1.4 m` deep with wood duckboards, sandbag parapets, firing steps, and sloped tank-crossing causeways) plus shell craters and low concrete pillboxes. Gives your autonomous friendly infantry natural cover to hold back enemy breakthroughs.
   - **Bridgehead Approaches (`z = +35..+150`):** Ruined village buildings, wrecked armor hulks, and anti-tank dragon's teeth funneling armored columns onto the 3 river crossings.

3. **The River — Midpoint Choke Point (`z = -30..+30`, `~60 m` wide):**
   - Wide, dark, sunken river cutting completely East-West across the map (`water surface at y = -3 m`, steep mud banks). Ground infantry & conventional vehicles cannot walk through the deep river bed, so `NavGraph` and vehicle lane routes **naturally funnel both armies across 3 tactical crossings** (while aircraft fly freely above and the Distraint Frame can jump-jet across):
     - **West Crossing — Shattered Rail & Pontoon Bridge (`x ≈ -145`, `18 m` wide):** Flanked by ruined stone piers and derailed boxcars. Great for infantry/mech pushes and flanking armor.
     - **Center Crossing — Main Highway Bridge (`x ≈ 0`, `28 m` wide):** Massive 4-lane concrete viaduct dotted with concrete jersey barriers, burned tank hulks, and bunker pillboxes at both ends. Primary armored meat-grinder.
     - **East Crossing — Broken Dam & Rocky Ford (`x ≈ +145`, `20 m` wide):** Cracked concrete spillway with shallow rocky vehicle ford and ruined turbine walls. Tight ambush corridor with elevated embankments.

4. **Sector 3 — North Enemy Defense Belt (`z = -35..-255`):**
   - **North Bridgehead Fortifications (`z = -35..-120`):** Concrete pillboxes, interlocking enemy trenches, sandbag MG nests, and anti-tank obstacles overlooking the 3 bridges.
   - **Mid-North Strategic Sabotage Belt (`z = -125..-245`):** Three fortified compounds housing the first wave of destructible enemy assets:
     - **West:** Forward Fuel & Ammo Depot (surrounded by explosive fuel tanks & blast walls).
     - **Center Ridge:** Artillery & Mortar Battery (elevated berm shelling the river bridges).
     - **East Hill:** Radar & AA Network (radar dome + SAM batteries & flak towers guarding the airspace).

5. **Sector 4 — Enemy Fortress "Iron Bastion" (`z = -255..-355`):**
   - Deep concrete stronghold behind blast walls, flak towers, and fortified gates housing the heavy production facilities:
     - **West Yard:** Enemy Armored Motor Pool (tank bays & heavy convoy staging).
     - **Center Citadel:** Enemy Barracks & Command Bunker (infantry & elite Juggernaut/Titan staging).
     - **East Apron:** Enemy Airfield Control Tower & Helipads (attack choppers, fast-ropers, and jet sorties).

---

## 3. How Everything Wires Together (Frontline Momentum Loop)

This is the core state machine tying **autonomous armies + river choke points + strategic sabotage + War Command boosts + endless escalation** into one seamless war simulation:

```text
  [ Autonomous Friendlies ]  <==== FIGHT AT ====>  [ Autonomous Enemies ]
         ^       |                FRONTLINE               |       ^
         |       |           (South -> Bridges            |       |
   War Command   |            -> North Belt)              |   Unstoppable
   Console       |                   |                    |   Threat Curve
   Boosts        |     Player & Friendlies Push Past      |   (1 -> 2 -> ... ∞)
         ^       |         the River Bridges              |       |
         |       v                   v                    v       |
  [ Player Earns CR ] <--- [ Destroy Enemy Facilities ] --+--> [ Cripples Enemy
  (Kills + Sabotage)       (Triggers MOMENTUM SURGE:           Capability for
                            Friendlies Rally Deeper +          90-150s Until
                            Free Breakthrough Wave!)           Rebuilt Stronger ]
```

### A. Dynamic Frontline Anchor & Automatic Rally Advancement
- The director tracks control across **3 River Bridgeheads** (`West Bridge`, `Center Bridge`, `East Ford`) and **2 North Footholds** (`North Trenches`, `Fortress Gates`) purely by unit presence (friendly vs enemy troops/vehicles + player). No manual orders needed.
- **Friendly Rally Point automatically advances** as you take ground:
  - Default: Friendlies rally at the **South Trench Line** and assault the **River Bridges**.
  - Holding **2+ Bridges**: Friendlies establish a **River Bridgehead** — autonomous reinforcements rally right at the north side of the bridges and start pushing into the North Defense Belt (`+15%` passive friendly spawn tempo).
  - Holding **North Foothold**: Friendlies surge into Sector 3 & 4 to tie down enemy defenders while you hit their heavy facilities.
- If the enemy pushes you back across the river, friendlies automatically fall back to defend the **South Trench Line**, and finally the **FOB Gates**.

### B. Strategic Sabotage & "Momentum Surge"
Whenever you blow up one of the **5 Enemy Strategic Facilities** (with C4/rockets on foot, a tank cannon, your Distraint Frame, or a bombing pass from an A-10 / B-1B Lancer):

| Enemy Facility | Location | Immediate Capability Cut | Bounty | Rebuild Time |
|---|---|---|---|---|
| **Fuel & Ammo Depot** | Sector 3 West | `-25%` enemy spawn cadence across all lanes + huge chain blast clearing nearby hostiles | `+1,500 CR` | `120 s` |
| **Artillery & Mortar Battery** | Sector 3 Center | Stops enemy indirect mortar/artillery shelling on the bridges & trenches | `+1,500 CR` | `120 s` |
| **Radar & AA Network** | Sector 3 East | Disables enemy SAM/Flak umbrella & doubles delay between enemy jet sorties | `+1,800 CR` | `120 s` |
| **Armored Motor Pool** | Sector 4 West | Halts enemy tanks, guntrucks, and armored convoy spawns | `+2,500 CR` | `140 s` |
| **Airfield Control Tower** | Sector 4 East | Grounds enemy attack choppers, fast-ropers, and fighter-bombers | `+2,500 CR` | `140 s` |

- **MOMENTUM SURGE (The "Breakthrough" Feeling):**
  - Each destroyed facility immediately triggers a **30-second Momentum Surge** (HUD banner + horn/radio callout):
    - Autonomous friendly infantry & vehicle spawn rate jumps by **`+60%`**.
    - A free **Breakthrough Squad + Friendly Tank** immediately launches across the nearest held bridge to exploit the gap you just tore open.
    - Stacking 2–3 destroyed facilities at once lets your army genuinely roll over the north half of the map — until the next **Threat Escalation Surge** hits and the enemy airlifts engineers/reserves to rebuild and counter-attack harder!

---

## 4. Endless Threat Escalation Curve (No Victory — Inevitable Overwhelm)

A continuous **Threat Level** (`THREAT 1 → 2 → 3 → ... → ∞`) climbs steadily over elapsed match time (roughly **1 Threat Level every ~100 seconds**, plus a small threat bump whenever you demolish deep Sector 4 fortress assets so the enemy responds with heavier reserves).

| Threat Level | Approx. Time | Enemy Force Composition & Behavior |
|---|---|---|
| **Threat 1–2** | `0:00–3:30` | Saltblood infantry warbands, Jackal technicals, troop trucks, occasional light tanks, Valkyrie fast-ropers. Even back-and-forth fight at the river bridges. |
| **Threat 3–4** | `3:30–7:00` | Multi-tank armored columns pushing Center & East crossings, Artillery Battery shelling bridges, Kestrel attack choppers, SAM/Flak active, first **Juggernauts** leading bridge assaults. |
| **Threat 5–6** | `7:00–10:30` | Hostile **combat jet airstrikes**, paratrooper drops behind your river line, dual armored columns hitting two bridges simultaneously, first **Titans** stomping down the highway bridge. |
| **Threat 7–9** | `10:30–15:30` | Relentless combined-arms surges: stacked tanks + gunships + hostile jets + multiple Juggernauts & Titans overlapping. Sabotaging facilities and spending War Command credits are essential to stay in the fight. |
| **Threat 10+** | `15:30+` | **Apocalypse Scaling (Uncapped):** Enemy reinforcement cooldowns shrink, rebuild timers shorten, enemy armor/elite density and health/damage scale steadily upward every level until even maxed-out players get driven back across the river into a desperate last stand at FOB Vanguard. |

### Performance-Safe Active Entity Caps (Smooth 60+ FPS)
Even at Threat 15, the engine stays fast by ramping **unit quality, tier mix, and replacement speed** rather than overflowing entity limits:
- **Enemy infantry:** `26–36` active (safely under `EnemyManager`'s `MAX_ALIVE = 48`, leaving headroom for vehicle crews, paratroopers, Juggernauts, and Titans).
- **Friendly infantry:** `14–18` baseline (up to `24` during Momentum Surges or Airborne Platoon boosts).
- **Vehicles & Aircraft:** `5–7` active enemy vehicles/choppers/jets + `4–6` active friendly AI vehicles/choppers/jets (briefly higher during player-called Spearhead / Air Wing boosts).
- **Smart Lane Routing:** Ground troops & armor follow West / Center / East lane waypoints converging on the active frontline so combatants stay concentrated in dramatic firefights rather than getting lost across `720 m`.

---

## 5. War Command Console (Reinforcement Boosts — Not Micromanagement)

Located in Friendly FOB right next to the free **Motor Pool & Frame Terminal** (and accessible via a quick **[F] War Command** radio keybind once earned so you don't even have to fly back to base mid-push if you prefer — configurable/optional!).

All autonomous friendly forces spawn for **free** automatically. The War Command Console is purely for spending your combat & sabotage credits on **heavy momentum pushes**:

| Boost | Cost | Cooldown | Effect |
|---|---|---|---|
| **Armored Spearhead** | `2,000 CR` | `75 s` | Launches **3 friendly Aegis MBTs + 2 Bastion 6×6 guntrucks** rolling straight up the Center Highway Bridge. |
| **Airborne Platoon Drop** | `1,500 CR` | `60 s` | **2 friendly Valkyrie choppers** fly over the river and fast-rope a **10-man veteran squad** (rocketeers, gunners, shields, medics) right onto the active frontline. |
| **Fighter & Bomber Strike Wing** | `2,500 CR` | `90 s` | Launches a wing of **friendly AI combat jets + Kestrel gunships** to sweep enemy aircraft and bomb North armor & emplacements for 60 s. |
| **Rolling Artillery Barrage** | `1,800 CR` | `65 s` | Calls heavy off-map howitzer salvos pounding enemy positions along the active frontline & north bridgeheads. |
| **Total Mobilization** | `2,200 CR` | `90 s` | Doubles autonomous friendly infantry & armor spawn rate across all 3 lanes for 60 s. |
| **FOB Repair & Defense Overdrive** | `2,000 CR` | `90 s` | Restores `+25%` FOB Command Core HP and overclocks FOB perimeter CIWS/SAM fire rate for 45 s. |

---

## 6. Friendly FOB Defense, Respawns & End-of-War Debrief

- **Infinite Player Respawns:** If you die, a crisp **4-second "REDEPLOYING TO FOB VANGUARD"** overlay plays while the battle continues seamlessly — then you spawn back inside Friendly FOB with full health and instant access to Procurement and the free Vehicle & Frame Terminal.
- **Tough, No-Babysit Friendly FOB:**
  - **FOB Command Core:** `25,000 HP` inside an armored inner bunker + 4 automated **CIWS / SAM perimeter towers** + dedicated FOB gate garrison.
  - Stray enemies or small raids get shredded automatically; the FOB only takes meaningful damage once your frontline collapses and heavy enemy forces (tanks, Titans, choppers, warbands) storm the base perimeter.
  - A subtle FOB integrity bar only pulses red/warns you when enemies actually breach Sector 1 (`z > +220`) or damage the Core.
- **Loss Screen (End-of-War Debrief):**
  - When FOB Command Core hits `0 HP`, the base detonates and displays your war record:
    - **Time Survived** & **Peak Threat Level**
    - **Deepest Frontline Push** (*South Trenches* → *River Bridges* → *North Defense Belt* → *Iron Bastion Gates*)
    - **Enemy Facilities Sabotaged**
    - **Kills / Armor & Aircraft Destroyed / Reinforcements Called / Credits Earned**

---

## 7. Reusable Existing Engine Systems

| Needed System | Existing Codebase Module |
|---|---|
| Autonomous friendly infantry (riflemen, gunners, rocketeers, shields, medics) | `src/allies/` (`AllySystem`) |
| Autonomous friendly tanks, guntrucks, choppers fighting enemy armor | `src/vehicles/drive/aiDriver.ts` (`AiVehicleFleet`) |
| Friendly & enemy AI fighter jets | `src/campaign/crossfire/airWing.ts` & `src/enemies/badlands/airstrike.ts` |
| Enemy squads, convoys, tanks, choppers, paratroopers, Juggernauts, Titans | `src/enemies/outpost/`, `src/enemies/vehicles/`, `src/enemies/rooftop/paratroopers.ts`, `src/enemies/EnemyManager.ts` |
| Destructible SAMs, Flak Towers, Radar Domes, Mortar Pits | `src/campaign/crossfire/baseDefense.ts` (`BaseDefenseSystem`) |
| Destructible strategic facilities & chain explosions | `src/world/destruction/` (`DestructionManager`) |
| Free sandbox Motor Pool & Distraint Frame Terminal | `src/enemies/badlands/terminalUi.ts` (already built!) |
| Automated Friendly FOB CIWS / SAM perimeter turrets | `src/enemies/dogfight/carrier.ts` |

---

## 8. Phased Implementation Plan

1. **Phase 1 — Overcast Atmosphere & Giant War Front Map (`src/world/map/endlessWar/`):**
   - Add `'overcast'` atmosphere preset in `src/render/Renderer.ts`.
   - Author `plan.ts` & `index.ts` for the `480 × 720 m` ground front + `2,200 × 2,200 m` airspace: Friendly FOB Vanguard (with runway, Motor Pool & Frame Terminal, Procurement, War Command Console), South Trench Network, 60 m River with 3 distinct bridges (West Rail/Pontoon, Center Highway, East Broken Dam/Ford), North Bridgehead Bunkers, 5 Strategic Facility compounds, and North Enemy Fortress Iron Bastion.
   - Verify `LightVolume`, `NavGraph` build time/connectivity across all 3 bridges, and triangle/collider budgets via map tests.
2. **Phase 2 — Frontline War Director & Endless Escalation (`src/enemies/endlessWar/`):**
   - Implement continuous population-capped spawners for both Friendly (`AllySystem` + `AiVehicleFleet`) and Enemy (`EnemyManager` + `VehicleSystem` + choppers/jets/paratroopers) along West/Center/East lane waypoints.
   - Implement dynamic Bridgehead / Frontline Anchor tracking so friendly rally points advance automatically as you take the bridges and push north.
   - Implement uncapped Threat Escalation curve (1 → ∞) + infinite 4-second player respawn + Friendly FOB Command Core & automated perimeter CIWS/SAM defense.
3. **Phase 3 — Strategic Facilities & Momentum Surges:**
   - Wire the 5 destructible enemy facilities (Fuel Depot, Artillery Battery, Radar/AA Net, Motor Pool, Airfield Tower) with capability debuffs, rebuild timers, big credit payouts, and 30-second **Momentum Surges** that propel your friendly army forward.
4. **Phase 4 — War Command Console, Sandbox Terminal & War HUD:**
   - Wire the free Motor Pool & Frame Terminal (reusing `BadlandsTerminalController`) and the new **War Command Console** UI (all 6 reinforcement boosts + optional field-radio shortcut).
   - Add dedicated War Front HUD strip (Frontline Tug-of-War bar, Threat Level meter, active Sabotage/Momentum banners, FOB integrity alert) and End-of-War Debrief screen.
5. **Phase 5 — Contract Registration, Co-op Wiring & Verification:**
   - Register `endless_war` map & contract in solo and co-op lobbies, write automated unit/integration tests for map geometry, nav connectivity across all 3 river bridges, Threat escalation, facility sabotage debuffs, War Command boosts, and FOB loss condition.
