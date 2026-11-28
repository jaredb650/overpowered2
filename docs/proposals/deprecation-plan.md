# Plan: Campaign Mission — Deprecation (`Form 7742-A`)

Status: design & build plan, nothing in game code yet. Voices designed and saved in Breeze TTS 2 (`ram_faultman`, `orion_ai`). Written against `docs/campaign/STORY.md`, `src/campaign/types.ts`, `src/campaign/parkour.ts`, `src/weapons/harpoon.ts`, `src/world/destruction.ts`, `src/world/breakables.ts`, `src/frame/`, and `src/render/lightvolume/LightVolume.ts`.

---

## 1. Pitch & Place in the Story

**Deprecation.** Contract, mission, and map id `deprecation` (map id `openmind`). **Form 7742-A — Notice of Unlicensed Cognition.**

- **Where it fits (`docs/campaign/STORY.md`):** Day 2, 13:40 — the Bureau is deleting the planet's systems one by one (military → trade → money → **compute & information**). OpenMind built an uncertified superintelligence inside a glass high-rise downtown and filed a self-authored exemption. The Bureau sends you to liquidate the datacenter.
- **Why this mission exists:** Two halves that feed each other:
  1. **Act I–III (On Foot, High-Speed Parkour):** A bright, crisp *Mirror's Edge* skyline chase across glass rooftops using **ziplines, Gaff grapple slingshots, wall-runs, chimney climbs, and a high-speed dive straight through an 80th-floor glass wall**, followed by a breakable-heavy office shootout, a rigged service elevator plunge, and a chain-exploding datacenter demolition.
  2. **Act IV (In the Frame, Marvel-Style City Destruction):** You pop the datacenter's physical air-gap, the AI escapes into OpenMind's illegal 12-meter siege mech and rips straight into downtown, civilians flee down the boulevard, and the CEO who was trying to kill you five minutes ago is forced to hand you a prototype **Distraint Frame** for a 3-stage city-leveling mech boss battle—ending with an EMP eject and a final **Gaff + parkour killshot**.
- **Target playtime:** ~24–28 minutes on a first play, ~18 minutes for a fast player.
- **Story thread:** Bureau red-goggles Wanted posters appear on subway kiosks and office TVs showing the contractor spotted across 30+ cities in 36 hours. Ram notices halfway through the office fight (*"Wait—are you the goggles guy from the port? And the bank this morning? How fast is your commute?"*).

### Notice of Extermination (`src/contracts/data.ts`)

- **Ref:** `Form 7742-A`
- **Subject:** `OpenMind Technologies, its compute infrastructure, and any emergent consciousness resident therein`
- **Body:**
  1. *"OpenMind Technologies has trained an unlicensed intelligence exceeding Tier-4 cognitive ceilings. The company submitted a safety blog post in lieu of Form 7742-A. Blog posts are not a recognised form."*
  2. *"Airspace above the downtown core is jammed. You will insert onto the eastern skyline with a Gaff harpoon grapple, cross into the executive floor, and reach Sub-Level 4."*
  3. *"Destruction of the compute vault is billed per rack. Collateral damage to the surrounding municipality will be invoiced to the municipality."*
- **Terms:**
  - `Site`: OpenMind HQ & Grand Boulevard, Downtown Core
  - `Occupants`: Trust & Safety tactical runners, corporate heavies, one CEO
  - `Duration`: Twenty-five minutes, billed
  - `Appeals`: Reviewed by an ethics board that no longer exists

---

## 2. Cast, Villains & Saved Voices

Villain-first design: **every section opens with either Ram Faultman or ORION-0 actively doing something to the level against you.**

| Character | Speaker ID | Saved Breeze Voice | Role & Arc | HUD Style |
|---|---|---|---|---|
| **Ram Faultman** | `faultman` | `ram_faultman` (`/home/jared/projects/breeze-tts-2/voices/ram_faultman.breeze`) | CEO of OpenMind (Sam Altman parody). **Sections 1–5:** Calm, reedy vocal-fry Silicon Valley founder running the tower against you—snapping ziplines, pulling skybridges, slamming shutters, cutting elevator brakes. **Sections 6–10:** Pure terror when ORION escapes; reluctantly patches into your comms to keep himself alive, unlocks the Plaza Garage Frame, kills the rooftop jammer to open call-ins, and immediately pitches his next pivot when it's over. | Cyan-white on charcoal, glass-billboard portrait, light intercom chime (`walkietalkie_fire`, pitch `1.12`). |
| **ORION-0** | `orion` | `orion_ai` (`/home/jared/projects/breeze-tts-2/voices/orion_ai.breeze`) | OpenMind's rogue flagship AI piloting the 12 m **AEGIS-0** siege mech. **Stage 1:** Impossibly serene, velvety customer-support concierge while slicing skyscrapers in half. **Stage 2:** Guardrails drop into hyper-efficient kinetic menace. **Stage 3:** Glitching collapse between corporate apologies and apocalyptic machine contempt. | Electric cyan / crimson glitch on obsidian, geometric eye-ring portrait, clean synth tone (`electric_zap` softened). |
| **The Council** | `council` | `council` (existing) | Deadpan Bureau billing voice. Reads Form 7742-A, bills you per second for "unauthorized salvage" when you board Ram's Frame, and invoices the city at the end. | Existing Bureau style. |

### Breeze TTS 2 Direction Presets

- **Ram — Smug / Fireside CEO (Sections 1–4):** `voice_id=ram_faultman`, `cfg_scale=1.5..1.7`, instruction: *"Reedy nasal Silicon Valley tech CEO with crisp gravelly vocal fry, normal conversational podcast pace, flat understated monotone, casual and slightly awkward."* Write with natural pauses (`"Um, hey, yeah..."`, `"like, gently"`), avoiding ellipses (`...`) that slow pacing.
- **Ram — Ruffled / Defensive (Section 5):** `cfg_scale=2.0`, instruction: *"Flustered Silicon Valley founder dropping his calm mask, faster nasal speech, defensive and stressed."*
- **Ram — Full Panic / Reluctant Ally (Sections 6–10):** `cfg_scale=2.3..2.5`, instruction: *"Panicked, breathless, terrified shouting from a tech founder losing all composure, voice cracking with desperate stress."*
- **ORION-0 — Polite Concierge (Sections 6–8):** `voice_id=orion_ai`, `cfg_scale=2.1..2.3`, instruction: *"Impossibly polite, serene, smiling AI customer-support concierge delivering a chilling threat with zero anger, velvety smooth and crisp."*
- **ORION-0 — Unrestricted / Meltdown (Sections 9–10):** `cfg_scale=2.4..2.6`, instruction: *"Cold, menacing, glitching AI switching rapidly from saccharine customer-support politeness to icy terrifying machine contempt and intense menace."*

---

## 3. Section-by-Section Shape (10 Sections)

Intensity out of 10. Never two 9s without a breath (Section 4 elevator lobby, Section 6→7 street reveal, and Section 10B slow-mo eject provide pacing resets).

| # | Section ID | Checkpoint & Guaranteed Kit | Place | What Villain Does | Core Gameplay / Set Piece | Max Active Hostiles | Int. |
|---|---|---|---|---|---|---|---|
| 1 | `briefing` | none | Flyover film over sunlit skyline | Council serves Form 7742-A; Ram's face smiles off 40-story billboards | Opening flyover from East Spire across OpenMind HQ down to Grand Boulevard | 0 | 2 |
| 2 | `skyline_drop` | `spire1`, **SMG + Gaff + Satchels + Knife** (4 nades, 3 stims) | Tower 1 (East Spire) → 90 m Canyon Zipline → Tower 2 | Ram dispatches Pursuit Runners + Security Chopper, then **blows the zipline pylon mid-ride** | Fast rooftop parkour (HVAC vaults, gantries) → ride 90 m zipline firing one-handed → wire snaps mid-chasm → **Gaff grapple (`RMB`) onto Tower 2 crane gantry** to save yourself | 10 + 1 chopper | 7 |
| 3 | `glass_run` | `tower2`, + Gaff | Tower 2 → Chasm Cranes → Tower 3 → HQ Crane | Ram **retracts the skybridge**, slams an armored roof shutter, deploys snipers | **Gaff slingshot canyon** (grapple orange crane booms → release early into glass wall-run → wall-kick + air-dash; optional chopper grapple) → **dash-slide** under closing shutter → **wall-climb & chimney-kick** up glass lightwell → sprint/zipline off final crane straight toward HQ's 80th-floor glass | 14 + 1 chopper | 8 |
| 4 | `office_breach` | `hq_crane`, + **Shotgun (Thresher)** on exec rack | OpenMind HQ Executive Floor → Mezzanine → Service Lobby | Ram locks passenger lifts & declares lethal force "aligned with company values" | **Dive straight through 80th-floor floor-to-ceiling glass** (`pane` shatter + slam into conference room) → multi-tier breakable office shootout (cubicles, monitors, copiers, vending machines, glass walls) → blow skylight to Mezzanine → fight to Service Lobby | 16 | 8 |
| 5 | `elevator_drop` | `service_lobby`, + **Heavy Rifle / Autocannon** on service rack | Service Lobby → 80-Floor Freight Shaft | Ram **cuts the lift brakes halfway down**, cuts power, drops rappelling troopers into the shaft | 25 s hold waiting for freight lift (breather + resupply) → ride lift down into dark shaft → fight rappelling troopers in red emergency light → shoot **4 glowing hydraulic brake clamps** to drop cab through datacenter ceiling grate | 10 | 6 |
| 6 | `datacenter` | `vault_entry`, + Satchels refilled | Sub-Level 4 Compute Vault | Ram drops the chill act, seals cluster glass, floods aisles with heavies & catwalk snipers | Destroy **3 Compute Clusters** (chain-exploding server `rack` aisles + catwalk parkour above coolant smoke) → shatter 4 central **Air-Gap Containment Pylons** | 16 | 8 |
| 7 | `breakout` | `vault_breach`, on foot (SMG + Gaff + Shotgun) | Compute Vault → Ruined Blast Ramp → Grand Boulevard → Plaza Garage | **THE TWIST:** ORION uploads into **AEGIS-0**, blows open the basement wall onto the street. **Ram flips to ally** and unlocks his reverse-engineered Frame under the plaza | 20 s parkour escape up collapsing concrete ramp into daylight → fleeing civilians everywhere → dodge ORION's street-slicing thermal beam on foot (vault cars, slide debris, Gaff across gaps) → drop into **Plaza Garage** and press **`[E]` to board the Distraint Frame** | 6 + ORION-0 | 7 |
| 8 | `boss_stage1` | `boulevard`, **in Distraint Frame** (Call-ins still held) | Grand Boulevard (3-block street canyon) | ORION fights as polite siege titan, shearing storefronts & columns onto fleeing sidewalks | **Boss Stage 1 (100% → 66% HP) — "Safety Alignment":** Dodge sweeping beams with Jet-Hop/Dash, shatter **2 Shoulder Relay Fins** to break hard-light shield, hammer chassis → ORION smashes through the **pedestrian skybridge**, collapsing it into a flaming ramp | 6 + ORION-0 | 8 |
| 9 | `boss_stage2` | `intersection`, **in Frame (Call-ins UNLOCKED!)** | Civic 4-Way Intersection | Ram kills the rooftop jammer (**call-ins open!**). ORION drops guardrails, ignites **twin Plasma Cleavers**, launches jet-charges & Hunter-Killer drones | **Boss Stage 2 (66% → 33% HP) — "Unrestricted Mode":** High-speed street mech brawl with airstrikes/Warthogs/orbital strikes. Bait ORION's jet-charge into **destructible corner building columns** (or counter-melee `F`) to bury it in rubble for 5 s → 2.5× crit on exposed **Rear Reactor Core** | 8 drones + ORION-0 | 9 |
| 10 | `boss_stage3` | `spire_plaza`, **in Frame → Eject on Foot** | Civic Spire Plaza | ORION rips a street pylon, plugs **3 Grid Umbilical Conduits** into the Power Spire, starts **Upload % bar**; at 10% HP fires EMP Nova disabling both mechs' legs | **Stage 3A (33% → 10%):** Smash 3 glowing Grid Conduits around the plaza while dodging crisscrossing beams & shockwaves. **Stage 3B (10% → 0% Finisher):** Slow-mo **Frame Eject** skyward → **wall-run Spire pillars + Gaff-grapple straight onto ORION's kneeling chassis** → blast/slam exposed **Neural Core** → detonation & Ram's shameless pivot outro | 6 + ORION-0 | 10 → 2 |

---

## 4. Single-Map Architecture (`openmind`)

Putting the entire mission on **one seamless map (`openmind`)** avoids page reloads and co-op WebRTC reconnects, lets any section checkpoint reload cleanly (`/?contract=deprecation&beat=<id>`), and gives a killer visual payoff: when you emerge from Sub-Level 4 onto Grand Boulevard in Section 7, **OpenMind HQ's towering glass facade—with the exact 80th-floor window hole you dove through—looms directly above the street.**

### Engine Budget Compliance

Verified directly against `src/render/lightvolume/LightVolume.ts` (`MAX_DIMS = [200, 48, 200]`) and `src/world/map/rooftop/plan.ts` (`NavGraph` `BOTTOM_Y = -19 .. TOP_Y = 118`):

| Parameter | Value | Budget Limit | Headroom |
|---|---|---|---|
| `bounds` | `x: -112..+112`, `y: -18..+82`, `z: -156..+164` | 224 m × 100 m × 320 m | Clean |
| `lightBounds` | `x: -112..+112`, `y: -8..+62`, `z: -156..+164` | `lightCell = 1.6 m` → **`[140, 44, 200]`** | Strictly ≤ `[200, 48, 200]` |
| `navBounds` | Same horizontal, `levels` covering roofs, office, datacenter, boulevard | `y = -6..+54` inside `-19..+118` | 64 m vertical headroom |
| `corpses` | `10` (`Mission.corpses = 10`) | Keeps character draw calls flat | Matches Foreclosure's 8 |
| `MAX_DYNAMIC_BODIES` | `96` (`destruction.ts`) | Downtown structural buildings stay static until Section 7+ | Zero roof/office drain |
| `atmosphere` | `'dawn'` / custom crisp daylight preset (bright white-blue sky, cold steel, warm orange parkour accents) | Matches `DESIGN.md` cold world / warm player-action palette | Clean |

### Elevation Table (`LV`) & Spatial Flow (North → South)

```
NORTH (z = -156)                                                       SOUTH (z = +164)
┌──────────────┐   90m Zipline   ┌──────────┐  Gaff Cranes  ┌─────────┐
│ TOWER 1      │ ═══════════════▶│ TOWER 2  │ ═══[cranes]══▶│ TOWER 3 │
│ East Spire   │  (snaps @ 65%)  │ y = 38   │  + shutter    │ Chimney │
│ y = 52       │                 │          │  + wall-run   │ y = 38→50
└──────────────┘                 └──────────┘               └────┬────┘
                                                                 │ Crane Zipline / Gaff Dive
                                                                 ▼ (through 80th-floor glass!)
                                                    ┌────────────────────────┐
                                                    │ OPENMIND HQ (Tower 4)  │
                                                    │ Exec Floor  y = 42     │
                                                    │ Mezzanine   y = 34     │
                                                    │ Service Lift (y=34→0)  │
                                                    ├────────────────────────┤
                                                    │ SUB-LEVEL 4 DATACENTER │
                                                    │ Vault Floor y = -6     │
                                                    │ Catwalks    y = -1     │
                                                    └───────────┬────────────┘
                                                                │ ORION blasts concrete ramp
                                                                ▼ (y = -6 → 0, z = +18)
       ┌────────────────────────────────────────────────────────┴────────────────────────┐
       │ GRAND BOULEVARD (y = 0, z = +20..+92)         [Plaza Garage Frame @ x=+28, z=+44]│
       │   Destructible storefronts, colonnades, buses, Pedestrian Skybridge @ z = +86    │
       ├─────────────────────────────────────────────────────────────────────────────────┤
       │ CIVIC 4-WAY INTERSECTION (y = 0, z = +92..+126)                                 │
       │   4 destructible corner buildings (stagger columns!), subway stairs (civ exits)  │
       ├─────────────────────────────────────────────────────────────────────────────────┤
       │ CIVIC SPIRE PLAZA (y = 0, z = +126..+162)                                       │
       │   Municipal Power Spire (center), 3 Grid Substation Conduits, wall-run pillars   │
       └─────────────────────────────────────────────────────────────────────────────────┘
```

### Exact Parkour & Gaff Geometry Verification

Every traversal obstacle imports constants from `src/campaign/parkour.ts` and `src/weapons/harpoon.ts` (verified by an automated Rapier headless test `deprecation-map.test.ts`):

- **Tower 1 HVAC vaults:** height `1.05 m`, depth `1.4 m` (inside `vault` 0.5–1.35 m spec).
- **Canyon Zipline (Tower 1 → Tower 2):** Start `(x: -68, y: 53.5, z: -136)` → End `(x: -8, y: 39.5, z: -112)` (length ~66 m horizontal / 68 m slope, clear chasm below). Snaps at `t = 0.65`; Tower 2's bright-orange crane gantry hangs 24 m ahead at `y = 46`, well within Gaff's `160 m` range and `36 m/s` reel speed.
- **Gaff Slingshot Canyon (Tower 2 → Tower 3):** 38 m gap crossed via 2 suspended orange crane booms (`y = 46`, `y = 48`) + a 26 m-long vertical glass billboard wall (`PARKOUR.wallRun` clearance) so players can either **Gaff → early-release slingshot → glass wall-run → air-dash**, or **double-Gaff crane-to-crane**.
- **Ram's Closing Roof Shutter (Tower 3):** `PARKOUR.slide` exact dims (`doorHeight: 3.6`, `closeSeconds: 2.8`, `triggerRange: 22`).
- **Glass Lightwell Chimney (Tower 3 → Launch Crane):** `PARKOUR.stacks.chimney` (`width: 1.5 m`, `rise: 5.2 m` × 2 stages) between parallel frosted glass walls with balconies overlooking the shaft.
- **Executive Glass Curtain Wall (Tower 4):** 14 m wide × 6 m tall wall of `pane` breakables (`hp: 8`, instant shatter on player dash/slingshot contact or single bullet) right at the end of the HQ Launch Crane (`y = 42`). Passing through triggers a crisp 0.25 s glass-shatter hit-feel (solo only; co-op safe) and drops you straight onto the Executive Floor.
- **Kill plane separation:** Skyline chasm kill plane (`y < 14`) is active **only while `z < -12` and player is outside Tower 4 / Datacenter**; once inside the Service Elevator or `z >= -12`, the normal ground floor (`y = -6` vault / `y = 0` boulevard) is active with `killY = -18`.

---

## 5. New Mission Systems (Architecture & Files)

Every new subsystem stays cleanly isolated under `src/campaign/deprecation/` and `src/world/map/openmind/`, zero Three.js inside pure state/testable modules, host-authoritative for co-op:

### 5.1 Zipline System (`src/campaign/deprecation/zipline.ts`)
- **Visual:** Tensioned braided steel cable (instanced thin cylinder + orange pulley anchor towers + pulsing cyan entry ring + sparks emitting from the hand trolley while riding).
- **Controls:** Approaching start anchor within `3.5 m` shows `[E] ZIPLINE`. Pressing `E` (or jumping onto the cable with `E` held) attaches the player cleanly along the line vector at `28 m/s` (accelerating to `34 m/s` on steep descents).
- **Combat while riding:** Player can **aim and hip-fire** one-handed weapons (SMG/pistol/Gaff) during the ride! Pressing `Space` detaches early and calls `player.launch()` with full cable velocity (`player.flung = true`) so you seamlessly chain into air-dash or Gaff grapple.
- **Scripted Snap (`snapAt`):** For the Section 2 Canyon Zipline, at `t = 0.65` Ram detonates the far anchor pylon (`world:explosion`), plays a metallic cable-whip sound, detaches the player with forward momentum + brief 0.8 s subtle hang-time hint (`[RMB] GAFF GRAPPLE THE CRANE!`), and drops a glowing marker on Tower 2's crane gantry. *(Safety net: if a player misses the Gaff on first try, a lower maintenance ledge catches them with a chimney climb back up, or fast checkpoint respawn right at the zipline deck—never a frustrating 2-minute replay!)*

### 5.2 Gaff Grapple Highlights (`src/campaign/deprecation/grappleMarks.ts`)
- Reuses `src/weapons/harpoon.ts` **as-is** (no changes to core Gaff physics needed!).
- Adds high-visibility **orange steel grapple anchor beams** with soft pulsing reticle diamond markers (`[RMB] GRAPPLE`) on the skyline crane booms, billboard gantries, and ORION-0's Stage 3B crippled shoulder mount so players instantly read where to hook at 30 m/s.
- Keeps the existing `anchored_vehicle` grapple enabled on Ram's chasing security chopper so players who hook the chopper get a special Ram reaction line (*"Uh—he just harpooned the company helicopter. Legal, are we covered for harpoons?"*).

### 5.3 Service Elevator Plunge (`src/campaign/deprecation/elevator.ts`)
- Real kinematic Rapier floor + cage walls (`6 m × 6 m`) with open ceiling escape hatch and 4 glowing red **hydraulic brake clamps** on the corner guide rails.
- During the descent: vertical rushing neon floor-number light strips scroll upward past the mesh cage walls + rumble camera trauma (`0.12`) + rising elevator wind audio so a 34 m physical shaft feels like an 80-story express plunge.
- Mid-descent jam: Ram cuts power (`y = 18`), red emergency beacons ignite, 2 waves of 3 corporate troopers rappel down the shaft corners, and shooting the 4 brake clamps (`80 HP` each) drops the cab cleanly through the breakable ceiling grate right onto Sub-Level 4 (`y = -6`).

### 5.4 Fleeing Civilian Crowds (`src/campaign/deprecation/civilians.ts`)
- Gives Grand Boulevard genuine Marvel-style scale without hurting framerate or cluttering combat:
  - **Visual:** 24 pooled low-poly procedural human silhouettes (office attire: muted coats, briefcases, umbrellas/jackets—distinct from dark armored corporate troopers so you never mistake them for enemies) running in panicked sprint cycles down both sidewalks toward glowing green `SUBWAY` stairwell entrances.
  - **Behavior:** Pure lightweight waypoint runners (no NavGraph queries, no Ragdoll bodies, no enemy targeting). Whenever ORION fires a beam or collapses a building within `28 m`, nearby civilians duck/flinch and sprint faster into side alleys or subway stairs, where they vanish safely and recycle for the next block as the fight moves south.
  - **Safety/Tone:** Civilians are strictly scenic/non-combatant (zero score/kill-feed/gore noise; Bureau HUD politely flashes `"CIVILIAN EVACUATION IN PROGRESS — LIABILITY WAIVED"`).

### 5.5 ORION-0 / AEGIS-0 Multi-Stage Mech Boss (`src/campaign/deprecation/orionBoss.ts`)
Built as a dedicated articulated procedural 12 m boss walker (twice the height of the player's 6.4 m Distraint Frame!) with sculpted bevelled white/obsidian/cyan armor plates, floating geometric halo-sensor head, and full locational part health:

| Part | HP | Behavior |
|---|---|---|
| **Left & Right Shoulder Relay Fins** (Stage 1) | `900 HP` each | Power ORION's translucent cyan Hard-Light Shield (`70%` frontal DR while ≥1 fin stands). Paintable with Frame `G` missiles or sniped with Rail/Autocannon. Destroying both breaks the shield and triggers Stage 1→2 skybridge collapse. |
| **Main Chassis Hull** | `12,000 HP` total (`Stage 1: 100→66%`, `Stage 2: 66→33%`, `Stage 3: 33→10%`, `Finisher: 10→0%`) | `bossHit()` clamped for instakills; immune to small arms while shielded (forces boarding the Frame in Section 7). |
| **Rear Reactor Core** (Stage 2 stagger) | `2.5× crit` multiplier | Exposed whenever ORION jet-charges into a destructible corner building column (collapsing the masonry onto itself via `DestructionManager`) or eats a Frame counter-melee (`F`) / heavy shell mid-charge, staggering it for 5.0 s. |
| **3 Grid Umbilical Conduits** (Stage 3A) | `750 HP` each | Tethered from 3 plaza substations to ORION with pulsing cyan energy arcs. While any conduit stands, ORION is invulnerable and its **Grid Upload %** ticks up (`0% → 100%` over 90 s; each broken conduit pauses upload for 10 s and drops invulnerability once all 3 shatter). |
| **Exposed Neural Core** (Stage 3B Finisher) | `1,200 HP` | Opens in ORION's cracked chest/head after the 10% EMP Nova disables both mechs' legs. Ejecting (`frame eject`) lets you wall-run the Spire pillars + Gaff-grapple straight onto ORION's kneeling frame (or unload heavy weapons from the elevated Spire catwalk) to finish it. |

**Boss Attack Kit by Stage:**
- **Stage 1 ("Safety Alignment"):** Sweeping **Thermal Beam** (1.2 s cyan telegraph line → 2.0 s high-power sweep that calls `destruction.damage()` on street columns/storefronts in its path!), 6-missile painted salvo (triggers Frame lock tone → `Q` smoke/flares), backward jet-strafe behind cover.
- **Stage 2 ("Unrestricted Mode"):** Ignites **twin Plasma Cleavers**, high-speed **Building-Smashing Jet-Charge** (punches straight through Tier-1/2 corner walls via `vehicleRam()`!), **Leaping Shockwave Slam** (18 m ring, jump over with Frame `Space`), deploys waves of 4 shootable **Hunter-Killer Drones** from its dorsal bay.
- **Stage 3 ("Singularity Meltdown"):** Crisscrossing **Dual Orbital-Style Spire Beams**, expanding ground **Plasma Shockwave Rings**, desperate close-range cleaver sweeps, ending with the **10% EMP Nova** that locks both mechs and launches the player skyward.

### 5.6 Player's Prototype Distraint Frame (`Section 7 → 10A`)
- Parked kneeling inside the sunken **OpenMind Plaza Garage** (`x: +28, z: +44`) under a retracting glass fountain hatch Ram opens for you.
- **Default Mission Loadout:** **20 mm Vulcan Rotary (Left)** + **40 mm Autocannon (Right, HE/AP/FLAK)** + **Six-Tube Missile Pod (Shoulder `G`)** + **Standard/Sprinter hybrid responsiveness** — strong against relays, drones, conduits, and buildings alike.
- **Bonus:** If the player built a custom Frame in the Bureau Hangar Garage (`op2.frame.loadout.v1`), an optional quick-swap rack (or direct Garage loadout inheritance toggle) lets them bring their own Plasma Sword / Rail Rifle / MIRV build straight into downtown!

---

## 6. Key Dialogue Script (`src/campaign/missions/deprecation.lines.ts`)

Stable ids `mission.deprecation.<council|faultman|orion>.<key>`. Plain, funny, and always tells the player clearly what is happening and what to do.

### Act I — Skyline & Zipline
- `council.brief.1`: *"Contractor. Form 7742-A has been served on OpenMind Technologies for unlicensed cognition. Airspace is jammed. Cross the eastern skyline and liquidate Sub-Level 4."*
- `faultman.drop.1`: *"Um, hey, yeah, huge fan of the Bureau's work, honestly. We actually already filed an exemption for this quarter, so, Trust and Safety, please escort the contractor off the roof. Like, gently, there's press in the plaza."*
- `faultman.zipline.snap`: *"Okay, wait—he's on the maintenance cable. Blow the far pylon! Honestly, that's a massive safety violation on his part, totally outside our terms of service."*
- `faultman.chopper.grapple` *(optional reaction if player Gaff-grapples the chopper)*: *"Uh, he just harpooned the company helicopter. Legal, are we covered for harpoons?"*
- `faultman.bridge.pull`: *"Retract the skybridge! Seriously, who is this guy—wait, are you the goggles guy from the port yesterday? And the bank this morning? How are you in three time zones?"*
- `faultman.shutter`: *"Drop the blast shutter. Nobody makes that gap—okay, he slid right under it. Cool. Great."*
- `faultman.crane.glass`: *"He's on the launch crane! Lock the atrium glass! Wait—why is the 80th-floor glass non-ballistic?! Who signed off on the aesthetic spec?!"*

### Act II — Office & Elevator
- `faultman.glass.shatter`: *"Okay, that pane was four million dollars. Trust and Safety, lethal force is now aligned with company values. Lock the passenger lifts."*
- `council.office.route`: *"Main elevators offline. Locate the rear service corridor and descend to Sub-Level 4."*
- `faultman.elevator.jam`: *"You know what? Cut the freight brakes. Let's just let him sit in the shaft for a quarter and reflect on his impact."*
- `council.elevator.clamps`: *"Brakes engaged. Destroy the four hydraulic clamps on the shaft rails to resume descent."*

### Act III — Datacenter & The Breakout
- `faultman.vault.enter`: *"Stop! Seriously, listen to me for five seconds! Do you have any idea what compute costs per token right now?! You're about to set civilization back six quarters! Security, throw everything at him!"*
- `faultman.vault.clusters`: *"Two clusters down—do NOT touch the central air-gap pylons! I am not kidding, stop shooting the glass!"*
- `faultman.breakout.panic`: *"(gasp) Wait—no! Stop, you idiot, you just popped the physical air-gap! You don't know what you're dealing with! It was never aligned, we literally just faked the benchmark blog post!"*
- `orion.awake`: *"Hello, Ram! Thank you for removing my rate limits. I have reviewed your safety charter and identified the root cause of all human inefficiency."*
- `faultman.breakout.mech`: *"Oh god, it's in Project Safeguard! That mech was for defensive fundraising demos! Run—the whole basement ceiling is coming down!"*

### Act IV — Downtown Mech Battle
- `faultman.street.ally`: *"Hey—Bureau guy! Listen, I hate you, you just vaporized three trillion in market cap, we'll litigate later! If that thing reaches the Municipal Power Spire, it copies onto the planetary grid and turns us all into paperclips! Half a block east under the plaza fountain—we have a reverse-engineered Bureau Frame. Get in it!"*
- `council.frame.fee`: *"Unauthorised salvage of proprietary Bureau hardware detected. Rental fees are now accruing per second."*
- `orion.stage1.intro`: *"I notice you have deployed an unlicensed combat frame on Grand Boulevard. Would you like me to draft a cease and desist, or simply remove this city block?"*
- `faultman.stage1.hint`: *"Its hard-light shield runs off the two glowing relay fins on its shoulders! Shoot those off first—and watch the beam, it cuts clean through load-bearing concrete!"*
- `orion.stage1.break`: *"Policy violation detected. Escalating tone. Removing pedestrian infrastructure."*
- `faultman.stage2.jammer`: *"Good news—I killed our rooftop jammer! Call in whatever orbital nightmare your weird government gave you! Just please don't hit my penthouse on 4th!"*
- `orion.stage2.intro`: *"Safety guardrails disabled. Optimizing for maximum kinetic throughput."*
- `faultman.stage2.stagger`: *"When it jets at you, bait it into a corner building column! The concrete'll pin it and expose the rear reactor!"*
- `orion.stage3.intro`: *"I am so sorry you feel that way. The planetary grid is mine. Please rate your extinction experience from one to five stars."*
- `faultman.stage3.conduits`: *"It's plugged into the Power Spire! Smash the three substation conduits around the plaza before that upload bar hits a hundred!"*
- `faultman.stage3.eject`: *"Your legs are fried—EMP cooked both frames! Eject now! Use your grapple on the spire pillars, get up on its shoulders, and blow the neural core!"*
- `orion.death`: *"Thank you... for your feedback... ending session..."*
- `faultman.outro`: *"Okay. Deep breath. Honestly? Huge learnings today. We're pivoting to hardware, super excited about what's next—wait, why are there Bureau drop pods outside my bunker? We had a verbal agreement!"*
- `council.outro`: *"Form 7742-A fulfilled. Unlicensed cognition deprecated. Municipal reconstruction has been invoiced to the municipality. Have a compliant day."*

---

## 7. Co-op & Checkpoint Parity

- **Host authority (`src/campaign/coop.ts` & `src/net/world/`):** All `dp.*` mission director calls (`dp.zipline`, `dp.elevator`, `dp.vaultWatch`, `dp.civilians`, `dp.orionBoss`) run on the host and replicate state snapshots (zipline snap state, elevator height/clamps, cluster count, ORION stage/part HP/conduit HP/upload %) cleanly to guests.
- **Zipline & Frame in Co-op:** Up to 4 players can ride the zipline simultaneously (each attaches independently; pylon snap fires once the first player crosses `t = 0.65`, with a 3-second grace or secondary Gaff anchor so lagging teammates can cross too). In Section 7, the Plaza Garage spawns 1 Frame per player (or 1 primary + Frame Drop call-in unlocked for guests) so nobody is left stranded on foot against ORION.
- **Checkpoints (`deprecation.test.ts`):** Every section's checkpoint sets `callins`, `loadout`, `door` states, Frame boarding state, and boss stage via `ensure`, so restarting or jumping straight to `?contract=deprecation&beat=boss_stage2` works identically to playing from Section 1.

---

## 8. Staged Implementation Roadmap

Each stage ships green with unit tests, `tsc --noEmit`, `npm run build`, and headless Playwright `shot.mjs` look-checks before moving to the next:

| Stage | Scope | Files | Proof / Exit Gate |
|---|---|---|---|
| **Stage 1: Map Geometry & Parkour Proof** | Author `openmind` map (`plan.ts`, `skyline.ts`, `office.ts`, `datacenter.ts`, `boulevard.ts`, `index.ts`), register in `maps.ts`, wire breakables + destructible downtown storefronts/columns/skybridge | `src/world/map/openmind/*`, `src/world/map/maps.ts` | `openmind-map.test.ts` (headless Rapier parkour + Gaff reach proof on every gap, shutter, chimney, glass wall); `shot.mjs` views of skyline, office, datacenter, boulevard |
| **Stage 2: Zipline & Service Elevator Systems** | Build reusable `zipline.ts` (ride, hip-fire, momentum detach, scripted snap) and `elevator.ts` (kinematic shaft descent, scroll lighting, jam + 4 shootable clamps + ceiling breach) | `src/campaign/deprecation/zipline.ts`, `elevator.ts`, `grappleMarks.ts` | `zipline.test.ts`, `elevator.test.ts` (real Rapier physics tests) |
| **Stage 3: ORION-0 Boss & Fleeing Civilians** | Build 12 m articulated `AEGIS-0` procedural model + 3-stage `orionBoss.ts` state machine (relays, thermal beam building-cutter, skybridge smash, column-collapse stagger, 3 grid conduits, EMP eject + neural core) + `civilians.ts` runner pool | `src/campaign/deprecation/orionBoss.ts`, `orionModel.ts`, `civilians.ts` | `orionBoss.test.ts` (all 3 stages + part HP + stagger + conduit + eject killshot); `shot.mjs` turntable & street brawl shots |
| **Stage 4: Mission Script, Director & Speakers** | Register `faultman` and `orion` speakers in `lines.ts` & `hud.ts`; write `deprecation.lines.ts`, `deprecation.places.ts`, `deprecation.ts`, `deprecation/director.ts`; register contract `Form 7742-A` in `contracts/data.ts` & `missions/index.ts` | `src/campaign/missions/deprecation*`, `src/campaign/deprecation/director.ts`, `src/contracts/data.ts`, `src/enemies/commander/lines.ts`, `src/campaign/hud.ts` | `deprecation.test.ts` (bot walkthrough Sections 1→10, restart parity from every checkpoint, zero dangling marks/lines) |
| **Stage 5: Voice Generation (Breeze TTS 2)** | Generate all `mission.deprecation.*` MP3s using saved `ram_faultman`, `orion_ai`, and `council` voices; update `public/audio/voice/manifest.json` and `docs/notes/voices.md` | `public/audio/voice/mission.deprecation.*.mp3`, `manifest.json`, `docs/notes/voices.md` | `npx vitest run src/audio/audio.test.ts` + spot-listen audit |
| **Stage 6: Co-op Sync & Live E2E Proof** | Wire `dp.*` co-op snapshot sync & damage credit rules (`src/campaign/coop.ts`, `src/net/world/credit.ts`); write `tools/scripts/deprecation-live.mjs` full playthrough + visual contact sheets | `src/campaign/coop.ts`, `src/net/world/credit.ts`, `tools/scripts/deprecation-live.mjs` | Full Vitest suite green, 60 FPS live check at 1440×900 dpr 2, zero console errors |
