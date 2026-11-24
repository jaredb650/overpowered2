# Desert Raid — Real Vehicle Overhaul & Dune Escape Proposal

> **Status:** Planned (depends on `src/vehicles/drive/` PBR models, responsive engine audio, and multi-seat visible riders — all now landed on `dev`).

## 1. Goal

Upgrade the **Desert Raid** campaign mission from scripted "Lego brick" rail-mounted trucks to **real physics-driven `DriveableVehicle` technicals** (with articulated crew, textured PBR armor, suspension bounce, dust rooster tails, and recognizable horizon-range engine/turbine audio), culminating in a playable **high-speed dune-jumping escape finale** after the boss fight.

---

## 2. Core Pillars

1. **Replace Rail/Block Trucks with Real `DriveableVehicle` Chassis**
   - Swap the legacy scripted truck props for live `Jackal` (and optional `Bastion` / `Quad` escort) `DriveableVehicle` instances powered by `src/vehicles/drive/physics.ts`.
   - Visible operator models (`src/vehicles/drive/riders.ts`) fill Seat 0 (Driver) and Seat 1 (Roof Gunner) automatically — seamlessly supporting solo (AI driver/gunner) and 2–4 player co-op without separate rigging.
2. **AI-Driven Enemy Technicals & Horizon Audio Signatures**
   - Introduce a lightweight `VehicleAiDriver` controller that feeds `VehicleInput` (`throttle`, `steer`, `boost`, `handbrake`) into `stepVehiclePhysics` along dune/road waypoints + dynamic flanking offsets.
   - Because `VehicleAudioController` (`src/vehicles/drive/audio.ts`) already spatializes engines out to **210–390 m** with real-time Doppler shift and distinct tonal signatures (V8 truck bark + gear shifts, turbofan jet compressor whine + afterburner, twin-turbine chopper slap), players will **hear enemy technicals cresting the dunes and Harrier/Kestrel patrols sweeping in over the horizon** before seeing their dust plumes.
3. **Two-Act Structure: Gunner Approach → Boss Arena → Playable Escape Drive**
   - **Act 1 — Convoy Breach (Gunner Sequence):** Player rides in Seat 1 (Roof Hybrid .50-Cal HMG / 40mm AGL) while an AI squadmate (or co-op P2) drives Seat 0 at high speed across rolling dunes. Enemy technicals pull alongside, weave around wrecks, and launch RPGs/drones; shooting out their wheels/tires or hitting them with 40mm grenades sends them barrel-rolling through the sand.
   - **Act 2 — Compound Assault & Boss Fight:** Convoy breaches the fortified desert outpost; player dismounts for the on-foot / mech / vehicle combined-arms boss encounter (with parked Quads, Motos, and the squad Jackal still live in the arena!).
   - **Act 3 — High-Speed Dune-Jumping Escape Finale (Player Drives!):** After the boss falls and the compound begins collapsing / enemy air-armor reinforcements close in, the squad scrambles back into the **Jackal Technical** (and extra **Quad/Moto** outriders for 3–4p co-op):
     - **Solo:** Player takes **Seat 0 (Driver)** while the AI squadmate hops into **Seat 1 (Roof Gunner)** — visually standing in the truck bed rotating the gun, dynamically switching between `.50-Cal HMG` for infantry/buggies and `40mm AGL` for pursuing technicals/clusters!
     - **Co-op:** Any player can drive while a teammate mans the roof rotary gun (or rides two-up on a Nomad Quad / Razor Moto using hand weapons!).
     - **Set-piece Terrain Beats:** Collapsing radar tower, natural sand-dune jump ramps with airtime slow-mo/boost sparks, pursuing enemy technicals & a low-altitude Kestrel/Harrier strafing run to the extraction LZ.

---

## 3. Technical Building Blocks (Already Ready vs. Needed)

### Already Built (`src/vehicles/drive/`)
- **PBR Models & Visible Crew (`models.ts`, `textures.ts`, `riders.ts`):** All 10 driveable vehicles use cached procedural PBR armor/metal/tread/carbon/canopy maps and articulated `RiderRig` sockets (`setSeatOccupant(seatIndex, id, accentColor)`).
- **Responsive Horizon Audio (`audio.ts`, `recipes/vehicles.ts`):** Auto-retrying multi-layer engine loops with 5-speed transmission gear shifts, turbofan compressor whine, afterburner ignition, VTOL nozzle transitions, and 210–390 m Doppler horizon panning.
- **Smart Auto-Gunner Target Selection (`vehicle.ts`):** Jackal's roof turret already differentiates clusters/armored targets (40mm AGL) vs. lone infantry (.50-Cal HMG).
- **Ragdoll & Wreck Physics (`vehicle.ts`):** Kinematic Rapier bumper hull + pushable wrecks + forgiving player-favorable ramming.

### New Pieces Needed for Desert Raid Overhaul
1. **`src/vehicles/drive/aiDriver.ts` (~250 LOC):**
   - Path-following + pursuit + obstacle/wreck avoidance controller emitting `VehicleInput` for `DriveableVehicle`.
   - Supports two modes: `convoy_escort` (Act 1 friendly driver following dune spline with dramatic drifts/jumps) and `pursuit_raider` (enemy technicals pulling alongside, matching speed, breaking off when damaged).
   - Hooks into `DriveableVehicle.update(dt)` when Seat 0 is occupied by `'ai_friendly'` or `'ai_enemy'`, automatically running `VehicleAudioController` so distant AI vehicles roar and Doppler-shift across the desert!
2. **Enemy Faction Support on `DriveableVehicle`:**
   - Optional `team: 'player' | 'enemy'` flag so enemy technicals can be damaged, hijacked (grapple + `[E]` throws out enemy driver!), or blown up into burning physics wrecks.
3. **Desert Raid Mission Script Updates (`src/campaign/desertRaid.ts`):**
   - Replace rail-truck geometry with live `Jackal` spawn + `aiDriver` in Act 1.
   - Add Act 3 escape trigger after boss kill: objective beacon across the dune canyon (800–1200 m stretch with 3–4 jump crests, rock arches, pursuing raiders, and a Valkyrie/extraction pickup zone).
   - Ensure co-op seat assignment automatically places P1 in Driver and P2 in Roof Gunner (with P3/P4 spawning on escort Quads/Motos or Bastion seats).

---

## 4. Verification Checklist (When Implemented)
- [ ] Act 1 friendly Jackal drives smoothly over terrain with visible driver & roof gunner, no snagging or flip-locks.
- [ ] Approaching enemy technicals are clearly audible 150–200 m out with unmistakable V8 gear-shift & Doppler signatures.
- [ ] Act 3 escape sequence lets the player drive, hit dune jumps with Nitro boost, and watch their AI/co-op roof gunner visibly track and shred pursuers behind them.
- [ ] Solo and 2+ player co-op transitions work cleanly with zero orphaned seats or audio loops.
