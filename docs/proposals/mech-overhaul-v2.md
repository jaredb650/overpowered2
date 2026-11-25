# Distraint Frame Overhaul v2: Silhouette, Mobility & Arsenal Expansion

Status: **Proposal (pending owner review & picks).**
Grounded in the current Frame architecture (`src/frame/`, 37 existing parts) and inspired by *Armored Core VI: Fires of Rubicon* — translated into **100% original Bureau / contractor hardware** in OVERPOWERED 2's voice and procedural bevelled-metal art pipeline.

---

## 1. Why the Mech Looks the Same Today (Root Cause)

Right now, swapping parts barely changes the mech's silhouette because of four architectural limits in `src/frame/cockpit.ts` and `src/frame/models/shared.ts`:

1. **`hull()` is hardcoded and never swapped.** In `src/frame/cockpit.ts`, `hull()` always builds the exact same 2.95 m hunched obsidian torso, identical massive square shoulder pauldrons (`x = ±1.94`), and identical dorsal carapace. The three alternate cockpits (`cockpitTwin`, `cockpitOpen`, `cockpitSensor`) only bolt small brow plates, roll-bars, or optic trim *on top* of `this.hull` (`this.hull.add(built.exterior)`).
2. **Hardpoint anchors (`FRAME_PLACES`) are fixed.** Every mech puts arms at `[±1.75, 0.15, -1.15]` and shoulders at `[±1.55, 2.35, 0.2]`, so you never get narrow needle-nosed builds, towering wide-winged builds, or squat hulks.
3. **No Head / Sensor Crown slot.** A mech's "face" and silhouette crest carry huge visual identity; right now the visor slit is baked into the torso box.
4. **One locked paint palette.** Every model imports hardcoded `OBSIDIAN`, `GUNMETAL`, `PLATE`, `RED`, and `AMBER` constants from `src/frame/models/shared.ts`. Even Spider Legs and Treads wear the exact same dark slate paint and orange jets.

---

## 2. Armored Core 6 Deep Dive — What Actually Translates to OVERPOWERED 2

In AC6, a mech feels and looks completely different across builds because of **five interlocking layers**:

| AC6 Layer | What Makes It Great | How It Maps to the Distraint Frame |
|---|---|---|
| **Frame Silhouettes (Core + Head + Arms + Legs)** | Swapping a boxy industrial slab (*Basho / Wrecker*) for a razor-thin aero wedge (*Nachtreiher / Lammergeier*), an upright heroic frame (*Alba / HAL 826*), or an alien rounded carapace (*Ephemera*) transforms posture, proportions, and weapon mount width. | Upgrade `cockpit` into a **full Chassis/Core swap** (replaces torso, pauldrons, waist collar, posture, and `FRAME_PLACES`), add a **Head / Sensor Crown** slot, and add **3 new Leg architectures** (8 total). |
| **Paint & Generator Flame Color** | Custom armor paint + exhaust color (orange IC, cyan-blue Circulating-Current, crimson Coral) instantly makes every build feel personal. | Pass a `FramePalette` theme into `ModelBuilder` (still 2 merged draw calls via vertex colors!) with **10 preset liveries + custom primary/secondary/accent/glow colors** that also tint thruster plumes & optics. |
| **Distinct Mobility Styles (Legs + Boosters + Generators)** | Reverse-joint leaping, hovering tetrapods, drifting wheelchair/hover tanks, rapid directional Quick-Boost dodging, Coral redline surging, and Assault Boost + Boost Kick. | Keep all 5 current legs + 6 engines, and add **Hover-Skiff**, **Drift-Wheel Rig**, **Aero-Quad** legs + **Blink-Step**, **Redline Surge**, and **Assault-Ram** drives. |
| **Core Expansions** | High-impact active/passive overdrive abilities (Assault Armor blast, Pulse Armor shield, Pulse Protection dome, Terminal Armor last-stand). | Add a **Core Expansion** slot (`Q` key — default stays Standard Smoke & Flares; swap for Nova Blast, Aegis Shield, Bunker Dome, or Last-Stand Fuse). |
| **Asymmetric, Wild Weapons** | Napalm launchers, sweeping energy blades, charged wave slashes, pile bunkers, linear railguns, pulse shields, twin shoulder grenade cannons, floating laser orbits, stun needles, vertical plasma rain. | Add **7 Arm Weapons** (led by the **Dual-Mode HE/Napalm Grenade Launcher** and **Energy Sword**) and **5 Shoulder Weapons**. |

*(Note: we intentionally skip AC6's weight/EN-load lockout spreadsheet so players stay free to build crazy fun combos, using clear stat trade-offs like hull HP, speed, and shoulder count instead.)*

---

## 3. Visual Overhaul: Making Every Mech Look Dramatically Different

### 3.1 Full Chassis / Core Replacements (`cockpit` slot → **Chassis / Core**)

Instead of layering tiny trims onto one `hull()`, `StandIn` (`src/frame/cockpit.ts`) delegates the **entire exterior torso, shoulder pauldrons, waist collar, cockpit canopy, first-person interior, and `FRAME_PLACES` hardpoint offsets** to a `ChassisVisual` builder.

| Id | Name | Silhouette & Look | Gameplay Trade-Offs | How It's Modelled |
|---|---|---|---|---|
| `cockpitStandard` | **Distraint Mk.IV** *(existing)* | Classic hunched Bureau heavy walker with wide sloped pauldrons and overhanging brow. | `1.0×` hull, 1 shoulder (`G`). Unchanged default. | Existing `hull()` + `cockpit()`, parameterized with `FramePalette`. |
| `cockpitTwin` | **Twin-Mount Mk.IV** *(upgraded)* | Redesigned into a broader, heavier **gunship twin-shoulder yoke** torso with canted dual ammo hoppers and a sleek twin-mullion fighter canopy. | `1.0×` hull, `0.7×` canopy, 2 shoulders (`G`, `V`). | Full torso replacement with recessed cheek air-intakes and wide reinforced dorsal shoulder cradles. |
| `cockpitOpen` | **Gantry Open-Cage** *(rebuilt)* | **Strips the torso shell completely away.** Exposed tubular steel spaceframe, visible pulsing reactor drum, hydraulic torso struts, open pilot harness seat, and a towering 3-pylon weapons bridge. | `0.9×` hull, exposed pilot seat, 3 shoulders (`G`, `V`, `B`). | Zero solid carapace — built from bevelled truss rails (`prism`), cylindrical roll-cage tubes, visible central reactor cylinder with glowing slats, and elevated triple gantry. |
| `chassisKestrel` | **Kestrel Aero-Core** | Razor-narrow, **forward-leaning predatory wedge** (*Nachtreiher / Lammergeier* feel). Pinched wasp waist, swept forward intakes, tiny blade-like collarbone winglets instead of bulky pauldrons, arms pulled tighter (`x = ±1.42`). | `0.78×` hull, **Walk ×1.12, Dash ×1.15**, 2 shoulders (`G`, `V`). | Long, slim faceted triangular `prism()` fuselage tilted forward `12°`, sharp dorsal spine fin, swept canard cheek plates, narrow jet-fighter wraparound first-person canopy. |
| `chassisBastion` | **Bastion Siege-Core** | Towering, **brutalist squared-off bunker** (*Basho / Wrecker* feel). Flat sloped reactive-armor glacis chest, massive slab shoulder blast-shields (`x = ±2.18`), bolted steel tow shackles, heavy cage bumper, tiny recessed tank-slit viewport. | **`1.45×` hull**, **`1.5×` canopy**, **−40% view recoil**, Walk `×0.90`, 2 shoulders (`G`, `V`). | Thick chamfered hexagonal/trapezoidal armor slabs, spaced ERA brick tiles (`prism`), oversized vertical shield pauldrons, armored slit-visor first-person cockpit with heavy riveted pillars. |
| `chassisValkyrie` | **Valkyrie Wing-Core** | Upright, athletic **V-taper prototype chassis** (*HAL 826 / Alba* feel). Crisp layered chest plates, upright heroic posture, and a **sweeping rear wing-rack** that pushes shoulder hardpoints wide & outward (`x = ±2.15, y = 2.55`) into an unmistakable winged silhouette. | `1.0×` hull, **+20% energy charge & cooling speed**, 2 shoulders (`G`, `V`). | Sculpted multi-layer tapered chest `prism()` plates, angled collar vents, twin sweeping aft thruster wing-pylons carrying the shoulder mounts, crisp holographic bezel interior. |
| `chassisChitin` | **Chitin Bio-Core** | Uncanny **smooth rounded carapace** (*Ephemera* feel). Bulbous layered dome torso with curved segmented rib plates, teardrop shoulder shells, and glowing recessed spine veins — completely distinct from angular industrial metal. | `0.90×` hull, **+35% jet/drive fuel regen**, 2 shoulders (`G`, `V`). | Stacked, smoothly tapering 12-sided `ngon()` / multi-vertex curved `prism()` shells (`curveSegments: 8`) overlapping like armored beetle plates, smooth organic ribs, curved panoramic visor interior. |

*(Note: `cockpitSensor`'s 70 m wall-seeing optics move cleanly to the **Cyclops Recon Head** below, while keeping `cockpitSensor` as a valid backward-compatible wire alias that mounts the standard chassis + Cyclops optics so saved loadouts never break!)*

---

### 3.2 New Slot: Head / Sensor Crown (`head`)

Mounted at each chassis's `places.head` socket (rotates subtly with aim yaw/pitch!). Purely sculpted external silhouette + light tactical trait:

| Id | Name | Look & Modelling | Trait |
|---|---|---|---|
| `headStandard` | **Flush Visor** | Standard Distraint integrated brow (zero extra protrusion; default unchanged). | Baseline (`×1.0`). |
| `headDuelist` | **V-Crest Helmet** | Sharp angular armored mecha head with swept **twin V-fin crest antennas**, high cheek guards, and narrow glowing twin-slit optics (`prism` faceted crown + thin tapered blade fins). | **+15% arm gun turn tracking speed** (`Gun.follow`). |
| `headCyclops` | **Cyclops Recon Dome** | Cylindrical armored turret head with a **large recessed glowing mono-eye lens**, brass focus ring, side FLIR pods, and tall twin whip antennas (`ngon(12)` dome + recessed lens barrel). | **70 m Thermal wall-seeing enemy outlines** (shared in co-op; replaces old `cockpitSensor` lock-in so you can pair thermal vision with *any* chassis!). |
| `headStealth` | **Flat Arrowhead Hood** | Ultra-low razor-flat diamond sensor hood tucked almost flush between the shoulders with a thin horizontal slit glow (`prism` sharp delta plate). | **+25% shoulder missile/paint lock range & speed**. |
| `headBunker` | **Demolition Cage** | Squat bolted steel head block wrapped in cylindrical roll-bars with **four bright amber floodlight lenses** across the brow. | **+35% canopy/head armor** + brighter forward headlamp cone. |
| `headHalo` | **Seraph Crown** | Swept-back curved shell with a tall **vertical glowing optic seam** down the face and twin backward-sweeping curved horn fins. | **−20% status/stun & canopy crack build-up**. |

---

### 3.3 New Cosmetic Layer: Paint Liveries & Thruster Flame Color (`paint`)

Zero balance stats, 100% visual transformation — works on **every** chassis, head, leg, engine, arm, and shoulder!

- **How it works technically (zero extra draw calls):** Replace hardcoded hex constants (`OBSIDIAN`, `GUNMETAL`, `PLATE`, `STEEL`, `BRASS`, `RED`, `AMBER`) in model builders with a `FramePalette` object (`primary`, `secondary`, `trim`, `frame`, `accent`, `glow`, `thruster`). Because `ModelBuilder` bakes colors into vertex attributes on build/swap, a full custom-painted mech still renders in **2 draw calls** (`solid` + `glow`).
- **10 Instant Preset Liveries:**
  1. **Bureau Standard** — Obsidian / Gunmetal / Slate / Crimson optics / Amber jets *(default)*
  2. **Arctic Prototype** — Matte Chalk White / Cool Grey / Titanium / Ice-Cyan optics & **Blue-Cyan jets**
  3. **Hazard Demolition** — Industrial Safety Yellow / Charcoal / Worn Steel / Amber optics & jets
  4. **Crimson Ace** — Deep Blood Red / Matte Black / Gold-Brass trim / Red-Orange optics & **Crimson jets**
  5. **Desert Enforcement** — Matte Sand Tan / Olive Drab / Dark Iron / Amber optics
  6. **Stealth Night-Ops** — Carbon Black / Dark Graphite / Matte Iron / Electric Cyan inset lines & **Blue jets**
  7. **Scrapyard Rust** — Oxidized Terracotta / Raw Iron / Welded Brass / Orange flames
  8. **Cobalt Security** — Navy Blue / Brushed Silver / Charcoal / White-Blue optics & **Cyan jets**
  9. **Forest Heavy** — Military Olive / Dark Moss / Gunmetal / Amber optics
  10. **Chrome Experimental** — Bright Brushed Steel / Obsidian joints / Gold accents / Magenta-Red **Redline jets**
- **Custom Swatches:** Optional 4-color picker (Primary Armor, Secondary Plate, Trim/Hydraulics, Glow/Thruster Flame) right on the Loadout screen with live 3D turntable update.

---

## 4. Expanded Arm Weapons (`leftArm` / `rightArm` — LMB / RMB, tap `1` / `2` to switch mode)

All 7 existing arm weapons stay intact. Here are **7 new AC6-inspired arm weapons**, starting with the two requested directly:

### 4.1 Dual-Mode Grenade Launcher (`grenadeL/R`) — **Owner Request**
- **Role:** Heavy drum-fed 60 mm multi-purpose grenade launcher that toggles seamlessly between blast clearing and area-denial fire.
- **Fire Modes (tap `1` left / `2` right):**
  - **HE (High Explosive):** 6-round revolving drum, `0.55 s` cadence, `3.2 s` reload (`R` reloads early). Fires heavy arcing 60 mm grenades (`62 m/s`, lobbed over low cover) that detonate on impact or proximity with a **7.5 m blast radius, 290 damage**, heavy ragdoll launch, and breakable-cover shattering.
  - **NAPALM (Incendiary):** Shares the 6-round drum; grenades shatter on impact into a **10 m splashing carpet of sticky burning napalm pools** (reusing `Combat.napalmBurst` + `Flames.ts`) that burn for **12 seconds**, igniting anything that walks through, charring skin, and rapidly breaking human soldier morale. Visual tracer shifts from bright amber-white (HE) to dripping orange-red incendiary globs (Napalm), and the launcher's indicator rail glows orange vs. fiery crimson!
- **Look & 3D Modelling (`src/frame/models/grenade.ts`):**
  - **Fixed (`build`):** Heavy bevelled industrial receiver housing (`prism`), ribbed top heat-shroud with open cooling slots, angled side ammo status bar (glows amber for HE / hot orange-red for Napalm), underslung hydraulic recoil buffer.
  - **Moving (`moving`):** Oversized **6-chamber fluted revolving cylinder drum** built from 6 chamber tubes arranged around a brass central ratchet axle (rotates `60°` per shot via `arm.turn()`!), paired with a stubby fat **60 mm wide-bore fluted barrel** with a ventilated conical blast-cup muzzle brake and a bold side sight frame. Reads unmistakably as a massive mech-scale MGL-32 / AC6 *Gou-Chen* hybrid.

### 4.2 Plasma Energy Sword (`swordL/R`) — **Friend's Request**
- **Role:** Dedicated mech-scale melee arm! Works on either arm (dual-wield energy swords = blender build!).
- **Controls & Combat Feel:**
  - **Tap LMB / RMB — 3-Hit Sweeping Combo:** Fast horizontal cleave → reverse diagonal back-slash → heavy overhead/cross-cut (`0.38 s` / `0.40 s` / `0.55 s` cadence). Each swing triggers a **short forward melee-booster lunge (5–7 m)** toward the aimed target (classic AC6 melee thrust!) and carves a **9.5 m wide, 160° arc** dealing `420 / 480 / 680` damage.
  - **Real Gore Slicing:** Hooks directly into `Gore` / `Melee.ts`'s `slicePlaneNormal` pipeline (capped at `MAX_SLICES_PER_FRAME` so chopping through 15 zombies never drops frames!) + energy-blade vaporization/cauterized glowing cut edges on armored enemies and vehicles.
  - **Hold LMB / RMB (0.85 s charge) — Two Switchable Stances (tap `1` / `2`):**
    1. **WAVE CLEAVE** *(Moonlight-inspired)*: Releases a blazing **10 m-wide crescent energy wave** flying `55 m/s` out to `65 m`, slicing everything in its path clean in half (`waveCut` plane slice) and punching through crowd formations (`3.5 s` heat cooldown).
    2. **IMPALE LUNGE** *(Laser Lance-inspired)*: Rockets the entire mech **18 m forward at 38 m/s** with the sword leveled ahead like a jousting lance, skewering and blasting every enemy/vehicle in a 3.5 m corridor and ending in a concussive plasma burst (`4.5 s` heat cooldown).
- **Look & 3D Modelling (`src/frame/models/sword.ts`):**
  - **Gauntlet Emitter (`build`):** Heavy armored forearm buckler shroud (`prism` swept gauntlet) with twin brass power-capacitor drums, vented side heat-sinks, and an articulated **split twin-prong plasma emitter fork** jutting 1.4 m past the wrist.
  - **Igniting Energy Blade (`moving` + custom blade mesh):** When idle, a compact glowing pilot-arc crackles between the emitter forks. On swing or charge, a massive **5.2 m long, beveled broadsword plasma blade** snaps to full length — constructed from a sharp white-hot faceted inner core (`prism` taper) wrapped in a wider translucent additive outer plasma sheath + swept ribbon trail shader during swings! Color follows your Paint/Glow palette (default searing crimson-orange or icy plasma cyan).
  - **Animation Hook:** Extends `Gun` with an optional `MeleeArmPose` (`swingYaw`, `swingPitch`, `swingRoll`, `bladeExtend`) so you see the giant blade sweep dramatically across the bottom of the screen in 1P AND carve a blazing arc in 3P / co-op!

### 4.3 Hydraulic Pile Bunker (`bunkerL/R`)
- **Inspiration:** AC6's legendary `PB-033M ASHMEAD`.
- **Role:** Extreme close-range single-target executioner & boss-breaker.
- **Behavior:** Tap fires a snappy `4.5 m` punch (`320 dmg`, huge knockback, `0.65 s` cd). **Hold 0.9 s to cock the explosive charge**, then release to fire the steel stake out `6.5 m` at supersonic speed: **900 damage** (full `bossHit` cap!), launches vehicles/tanks like toys, shatters heavy armor, and erupts a directional cone of sparks + deafening pneumatic cannon crack (`4.0 s` reload).
- **Look & 3D Modelling (`src/frame/models/bunker.ts`):** Massive brutalist forearm ram housing with twin exposed brass gas-cylinders, heavy slatted recoil cage, visible breech piston drum, and a thick tapered hexagonal **2.4 m tungsten spike** that visibly slams forward `1.8 m` on fire and hydraulically retracts with a vent puff.

### 4.4 Heavy Incinerator / Flamethrower (`flamerL/R`)
- **Inspiration:** AC6's `WB-0000 BAD COOK` + OVERPOWERED 2's Kiln.
- **Role:** Continuous close-mid corridor melter (`26 m` reach).
- **Behavior:** Hold to pour a thick, roaring cone of pressurized napalm flame (reusing `Flames.ts` streaming globs + pools) that coats floors, ignores small cover, and panics human squads (`Heat` gauge: ~7 s sustained burn, `2.8 s` vent).
- **Look & 3D Modelling (`src/frame/models/flamer.ts`):** Twin side-by-side perforated cylindrical flame nozzles with glowing pilot igniter rings, a massive underslung pressurized fuel tank strapped with brass retaining bands, and braided hose conduits feeding the breech.

### 4.5 Plasma Scatter Rifle (`plasmaL/R`)
- **Inspiration:** AC6's `Vvc-760PR` & `Nebula`.
- **Role:** Explosive energy rifle that leaves lingering plasma domes.
- **Behavior:** Tap fires fast `85 m/s` plasma orbs (`0.65 s` cadence, Heat-based) that burst on impact into a **4.5 m crackling energy sphere** lasting `1.8 s` (dealing rapid damage to everything inside). Hold `0.8 s` to charge a **3-orb horizontal fan volley** that blankets a street.
- **Look & 3D Modelling (`src/frame/models/plasma.ts`):** Sleek split-fork rail emitter with three stacked glowing octagonal containment coils visible inside an open ribcage shroud and a bulbous rear magnetic bottle capacitor.

### 4.6 Linear Rail Rifle (`railL/R`)
- **Inspiration:** AC6's `Harris` / `Curtis` linear rifles.
- **Role:** Precision mech sniper / anti-armor railgun (zero spread!).
- **Behavior:** Tap fires snappy `0.35 s` hypersonic kinetic slugs (`190 dmg`, penetrates 2 bodies). Hold `1.1 s` to charge an over-amped **rail shot** (`650 dmg`, punches through 2 walls & unlimited bodies, leaves a hanging supersonic vapor-ring trail, heavy heat spike).
- **Look & 3D Modelling (`src/frame/models/rail.ts`):** Extra-long (`4.1 m`) twin parallel magnetic rail blades separated by an open glowing copper/cyan accelerator gap, boxy rear autoloader breech, and fold-out muzzle stabilizer fins that flare open while charging.

### 4.7 Armored Energy Shield (`shieldL/R`)
- **Inspiration:** AC6's Pulse Shields & Bucklers — usable on *either* arm so you can run Shield + Energy Sword (mech knight!) or Shield + 105 mm Howitzer!
- **Role:** Active directional defense.
- **Behavior:** Hold LMB/RMB to angle the arm across the front and project a **4.5 m × 3.5 m faceted translucent energy barrier** that blocks **80% of frontal damage** and stops rockets/snipers (drains Heat while blocking; overheats if shattered). **Perfect Guard (first 0.5 s after raising):** blocks **95% damage** and reflects enemy rockets right back! Tap `F` while holding shield for a **Shield Bash** shockwave.
- **Look & 3D Modelling (`src/frame/models/shield.ts`):** Heavy angular kite-shaped armored tower plate mounted along the forearm with 4 fold-out brass projector emitter wings; holding deploys a crisp faceted hexagonal energy wall with glowing rim seams (semi-transparent so your center crosshair stays 100% readable!).

---

## 5. Expanded Shoulder Weapons (`shoulder` — G / V / B, tap `3` / `4` / `5` to cycle)

All 8 existing shoulders stay intact. Adding **5 AC6-inspired shoulder systems**:

| Id | Name | AC6 Inspiration | What It Does | Look & 3D Modelling |
|---|---|---|---|---|
| `twinGrenade` | **Twin Grenade Cannon** | *SONGBIRDS* | High-velocity direct-fire double cannon: fires **two 80 mm explosive shells `0.14 s` apart** (`120 m/s`, `6 m` blast, `260 dmg` each, huge stagger/knockdown). `6.5 s` reload. | Squat twin side-by-side heavy breech barrels on an articulated recoil sled with thick perforated muzzle brakes and dual brass-capped rear breach blocks. |
| `laserOrbit` | **Autonomous Laser Orbits** | *45-091 ORBT* / Drones | Press shoulder key to release **2 hovering armored gun-drones** that float beside your shoulders for `14 s` (or until heat fills), automatically zapping enemies within `45 m` with crisp laser bolts while both arms stay free! `10 s` cooldown. | Sleek vertical wing-pod holster on the shoulder; when deployed, 2 physical faceted diamond drone meshes detach and bob in formation around the torso (`StandIn` animated group) firing tracers! |
| `arcNeedle` | **Arc Rail Needle** | *VE-60SNA Stun Needle* | Fires a blistering-fast harpoon rail spike (`240 m/s`, `380 dmg`) that **sticks into the target/wall, crackles for `0.45 s`, then detonates in a `9 m` lightning arc** chaining to up to 5 nearby enemies (`220 dmg` + brief shock stun). `7.0 s` reload. | Tall folding dual-prong rail launcher that snaps forward horizontally when firing, with glowing copper coil rings and a visibly loaded long steel harpoon dart. |
| `plasmaMissiles` | **Vertical Plasma Rain** | *Vvc-70VPM* | Hold to paint up to 6 targets (or tap for blind salvo); launches **6 missiles straight vertically** that arc over skyscrapers/walls and dive straight down, bursting into **5 m lingering plasma domes** (`160 dmg` + `1.5 s` DoT). `9.0 s` reload. | Angled vertical-launch honeycombed hexagonal 6-cell cassette box with hinged flip-open blast doors and glowing energy-charge indicator vents. |
| `shoulderGatling` | **Shoulder Rotary Pod** | *DF-GA-09 Shao-Wei* | Hold `G`/`V`/`B` to spin up a **compact 4-barrel shoulder minigun** (`22 rds/s`, `48 dmg`, `4.5 s` heat, `2.4 s` vent) simultaneously while firing *both* arm weapons for absurd three-gun firepower. | Compact pintle-mounted 4-barrel gatling cluster with a side curved ammo drum and slotted cooling shroud that visibly spins when firing. |

---

## 6. New Movement & Mech Styles (Legs, Engines & Core Expansions)

### 6.1 Three New Leg Architectures (`legs` slot — 8 total!)

| Id | Name | AC6 Inspiration | Movement & Style | Look & 3D Modelling |
|---|---|---|---|---|
| `legsHover` | **Mag-Skiff Hover Hull** | *VE-42B* Hover Tank | Floats **`0.65 m` off the ground** on repulsor cushions! Smooth `×1.30` speed in **all directions including full-speed strafing & backpedaling**, glides effortlessly over rubble/stairs with zero bob or aim sway, drifts smoothly through turns, zero view recoil. No stomp — crouch triggers a **downward repulsor crush pulse** (`10 m`, `180 dmg`, flings enemies). Hull `×1.25`. | Wide, sleek **boat-like armored hover-skirt chassis** (`prism` flared pentagonal hull) with 4 angled dark repulsor intake fans, glowing underside thruster rings, and subtle continuous hover bob + tilt into movement direction! |
| `legsWheels` | **Drift-Wheel Rig** | *EL-TL-11 FORTALEZA* ("Wheelchair") | Ultra-fast **`×1.60` ground speed** on armored motorized wheels! Turning while moving kicks out into a **controlled high-speed powerslide drift** (letting you circle-strafe bosses at 12+ m/s while firing heavy guns with zero stance penalty!), launches off ramps, crushes infantry on impact (`240 dmg`). Lower hull (`×0.85`), weak hop (`×0.4`). | Low-slung aggressive **tri-wheel / quad-hub armored battle sled** with oversized treaded chevron wheels that spin & steer live, twin slanted rear booster skates spitting sparks on drift, and low armored fender skirts. |
| `legsAeroQuad` | **Aero-Quad Legs** | *LAMMERGEIER/42F* Light Tetrapod | Skeletal lightweight 4-leg frame! Walk `×1.15`, strafe `×1.35`. Pressing Space mid-air engages **Flat Hover-Glide**: legs splay horizontally into a wide X-wing airframe, letting you **glide sideways at `14 m/s` at locked altitude** with half normal fuel drain and zero recoil kick! Leg armor `×0.75`. | Ultra-thin, razor-sharp **insectoid carbon-steel spider limbs** with glowing vertical wing-blades along each femur; in mid-air hover, all 4 legs animate smoothly outward to horizontal (`±45° / ±135°`) with ventral hover-jet plumes under each knee! |

### 6.2 Three New Engines / Thruster Drives (`engine` slot — 9 total!)

| Id | Name | AC6 Inspiration | Movement & Style | Look & 3D Modelling |
|---|---|---|---|---|
| `engineBlink` | **Blink-Step Booster** | High-QB Boosters (*Alula / Gills*) | Turns `Shift` into a **rapid omnidirectional Quick-Boost snap-dash** (`30 m/s` burst over `0.26 s`, works in **any WASD direction** on ground OR mid-air, **4 charges** refilling every `1.3 s`!). Normal jump-jets (`×0.9` fuel), Walk `×1.15`. Plays like a hyper-agile AC duelist. | Compact **6-nozzle directional thruster crown** arrayed radially across the back and hips — individual vernier nozzles visibly flare opposite your dash direction with crisp shock rings! |
| `engineRedline` | **Redline Surge Reactor** | *Coral Generators* (*Aorta / NGI 000*) | Massive **`×1.8` fuel tank** and **crimson/custom surge flames**. Partial fuel regens slowly (`×0.5` rate) — **BUT draining fuel completely to `0%` triggers a Redline Surge**: after a `1.4 s` capacitor whine, fuel snaps instantly back to **`75%`** + emits a glowing exhaust shock + grants **`+25%` energy weapon charge/cooling for 4 s**! Rewards fearless continuous flight & boosting. | Exposed **twin skeletal containment cages** cradling pulsing vertical core rods on the back with glowing manifold tubes that shift intensity as fuel nears redline, venting a dramatic ring burst on recovery. |
| `engineAssault` | **Assault-Ram Drive** | *Assault Boost + Boost Kick* | Hold `Shift` to ignite a relentless **forward Assault Boost rush (`28 m/s`)** with a glowing frontal prow deflection barrier (**30% reduced frontal damage** while rushing, lateral WASD weave allowed). Tap `F` (or slam directly into a target) during the rush for a devastating **Boost Kick / Hydraulic Ram** (`550 dmg`, `1600` knockback, staggers heavy tanks & sends squads bowling across the map!). | Giant **twin foldable ram-jet turbine pods** mounted on articulated back booms that swing wide and lock forward during Assault Boost, projecting a fierce forward shock-cone around the chest. |

### 6.3 New Slot: Core Expansion (`expansion` — `Q` key)

Every Frame already has `Q` bound to Smoke & Flares. Turning `Q` into a swappable **Core Expansion** slot keeps the default Frame 100% unchanged while adding huge tactical variety:

| Id | Name | AC6 Inspiration | What It Does | Visual Effect |
|---|---|---|---|---|
| `expSmoke` | **Smoke & Flares** *(default)* | Baseline | Unchanged existing `Q` (3 charges, smoke wall, flares, 6.5 m push; upgraded by Countermeasure Rack). | Existing smoke wall & flare salvo. |
| `expNova` | **Breacher Nova** | *Assault Armor* | `0.35 s` gathering charge, then detonates a **violent 18 m omnidirectional energy shockwave** centered on the mech: **deletes all incoming enemy rockets/grenades**, deals `480` damage & massive ragdoll fling, strips leg sappers. 2 charges, `22 s` refill. | Crisp expanding glowing spherical shell (tinted to your glow color) + distortion ring + radial spark burst. |
| `expAegis` | **Aegis Barrier** | *Pulse Armor* | Wraps the mech in a **mobile 1,500 HP faceted energy shield** for `8 s` (absorbs all damage until broken, immediately clears leg sappers and resets incoming stagger). 2 charges, `24 s` refill. | Low-poly geodesic translucent glowing hex-dome tightly orbiting the mech's torso, flickering brighter on bullet impacts and shattering into shards when broken. |
| `expDome` | **Bunker Dome** | *Pulse Protection* | Drops a **stationary 10 m-wide armored energy dome** at your feet for `12 s`. Blocks 100% of outside enemy fire (up to `3,000 HP`) while you and co-op teammates can shoot *out* freely from inside! 1 charge, `28 s` refill. | Drops a glowing brass-and-steel projector beacon disc on the floor that projects an arched translucent hexagonal bunker dome. |
| `expTerminal` | **Last-Stand Fuse** | *Terminal Armor* | **Passive automatic safety net** (no `Q` press needed): when hull damage would destroy the mech (`0 HP`), it clamps hull at **`1 HP`**, blasts nearby enemies back (`10 m`), and wraps the Frame in an **invulnerable `4.5 s` emergency shield** so you can finish the wave or safely eject (`E`). Triggers once every `90 s`. | Dramatic slow-pulse crimson/amber overdrive shell + cockpit warning flash (`TERMINAL FUSE ACTIVE — 4.5s`). |

---

## 7. How We Will Model Everything (Technical Art & Code Plan)

To hit the repo's **Model Quality Bar** (`CLAUDE.md`: *real form, never boxes; bevelled 2D `prism()` profiles, chamfers, cut-outs, 2–3 contrasting materials, glow only as thin inset lines*) **without hurting frame rate**:

1. **Unified `FramePalette` System (`src/frame/models/palette.ts`):**
   - Replace static color imports in `src/frame/models/*.ts` with a `FramePalette` parameter (`{ primary, secondary, trim, frame, dark, accent, glow, thruster }`) defaulting to `BUREAU_PALETTE` (exact current colors).
   - `ModelBuilder` already merges every part into **at most 2 meshes (`solid` + `glow`)** using vertex colors. Swapping paint rebuilds only the cached `StandIn` / `ArmRack` groups (takes < 3 ms) and costs **zero extra draw calls** at runtime!
2. **Modular `ChassisVisual` + Dynamic `FRAME_PLACES` (`src/frame/models/chassis/`):**
   - Each chassis exports:
     ```ts
     export interface ChassisPlaces {
       eye: readonly [number, number, number];
       head: readonly [number, number, number];
       leftArm: readonly [number, number, number];
       rightArm: readonly [number, number, number];
       shoulders: readonly (readonly [number, number, number])[];
       jets: readonly [number, number, number];
     }
     ```
   - `StandIn` replaces `this.hull` entirely with the active chassis mesh instead of bolting trim onto the standard hull. `Frame` and `FramePreview` query `body.places` for arm pivots, shoulder mounts, and head socket so a narrow **Kestrel** actually pulls its arms inward and a **Valkyrie** mounts its shoulders wide on its rear wings!
3. **Articulated Weapon & Blade Support (`src/vehicles/guns.ts` + `src/frame/arms/`):**
   - Extend `Gun` with an optional animated attachment/pose hook (`setPoseOffset(yaw, pitch, roll, zSlide)` + optional dynamic child mesh like the **Energy Sword's** extending blade & **Armored Shield's** translucent hex energy wall).
   - First-person readability: Energy Sword rests low and angled along the outer edge when idle; Energy Shield deploys with translucent edges + clean open sight window near center crosshair so aiming stays crystal clear.
4. **Co-op Wire Compatibility (`src/frame/loadout.ts`):**
   - Strictly **append** all new part IDs to `FRAME_PART_ORDER` (never reorder existing indices `0..36`).
   - Extend `kitIds` cleanly with optional trailing slots (`head`, `expansion`, `paint` index) while keeping legacy 7-number and 8-number wire packets decoding to default `headStandard` / `expSmoke` / `paintBureau`.
   - Add `MechKind` wire notes for new FX (`grenade`, `sword`, `bunker`, `flamer`, `plasma`, `rail`, `shield`, `twinGrenade`, `orbit`, `arcNeedle`, `plasmaMissiles`, `shoulderGatling`, `expansion`) so co-op teammates see every sword slash, napalm pool, floating orbit drone, and Aegis dome!
5. **Loadout Screen & Garage Upgrade (`src/ui/screens/frameLoadout.ts` & `framePreview.ts`):**
   - Add tabs/groups for **Chassis (Core)**, **Head**, **Legs**, **Engine**, **Expansion (Q)**, **Arms (L/R)**, **Shoulders (1–3)**, and **Paint & Glow**.
   - Add a **"Test Action"** preview button or subtle idle animation on the 3D turntable (e.g., sword blade ignites on hover, hover-skiff gently floats, Valkyrie wings & laser orbits softly animate) + **4 Quick-Build Presets** ("Cyber Samurai", "Napalm Siege Tank", "Aero Hover-Sniper", "Redline Striker") so players can immediately see how radically different four builds look!

---

## 8. Suggested Phased Build Plan

Because this is a massive expansion (**~40+ new parts & visual systems**), splitting it into **4 clean, shippable milestones** keeps quality sky-high and lets you playtest each wave as it lands:

| Milestone | Scope | What You Get to Playtest Immediately |
|---|---|---|
| **Milestone 1: Silhouette & Garage Overhaul** | `FramePalette` + 10 liveries/custom paint, `ChassisVisual` refactor + 5 dramatic full-torso chassis (Kestrel, Bastion, Valkyrie, Chitin, rebuilt Open-Cage), 6 Head crowns, upgraded 3D Garage preview. | Instantly transforms how every mech looks — zero more "same boxy torso"! |
| **Milestone 2: Headline Weapons (Grenade Launcher & Melee)** | **Dual-Mode HE/Napalm Grenade Launcher**, **Energy Sword** (combo slices + Wave Cleave / Impale Lunge), **Hydraulic Pile Bunker**, **Armored Energy Shield** + `Gun` melee/shield animation hooks. | Your two top requests + full mech-knight / CQC brawling! |
| **Milestone 3: AC6 Mobility & Core Expansions** | **Hover-Skiff**, **Drift-Wheel Rig**, **Aero-Quad** legs; **Blink-Step**, **Redline Surge**, **Assault-Ram** drives; **Core Expansions** (`Q` Nova / Aegis / Bunker Dome / Last-Stand Fuse). | Completely new ways to move, drift, dodge, kick, and survive. |
| **Milestone 4: Heavy Arsenal & Autonomous Shoulders** | **Heavy Flamethrower**, **Plasma Scatter Rifle**, **Linear Rail Rifle**; **Twin Grenade Cannon**, **Autonomous Laser Orbits**, **Arc Rail Needle**, **Vertical Plasma Rain**, **Shoulder Rotary Pod**. | Full AC6-scale weapon sandbox with crazy build synergies + full co-op parity & verification. |

---

## 9. Signature Builds Enabled by This Update

- **The Cyber Samurai:** *Kestrel Aero-Core* + *V-Crest Helmet* + *Sprinter Legs* + *Blink-Step Booster* + *Breacher Nova* + **Energy Sword (L)** + **Armored Energy Shield (R)** + *Autonomous Laser Orbits* + Arctic White/Cyan paint.
- **The Napalm Juggernaut:** *Bastion Siege-Core* + *Demolition Cage* + *Treads* + *Long-Haul Engine* + *Aegis Barrier* + **Dual-Mode Grenade Launcher (L)** + **Heavy Flamethrower (R)** + *Twin Grenade Cannon* + *Mortar Rack* + Hazard Yellow paint.
- **The Hover Gunship:** *Valkyrie Wing-Core* + *Flat Stealth Hood* + *Aero-Quad Legs* + *Redline Surge Reactor* + *Bunker Dome* + **Plasma Scatter Rifle (L)** + **Linear Rail Rifle (R)** + *Vertical Plasma Rain* + *Arc Rail Needle* + Crimson Ace paint.
- **The Drift Wrecker:** *Gantry Open-Cage* + *Cyclops Recon Dome* + *Drift-Wheel Rig* + *Assault-Ram Drive* + *Last-Stand Fuse* + **Hydraulic Pile Bunker (L)** + **Mech Shotgun (R)** + *Shoulder Rotary Pod* + *Twin Grenade Cannon* + *Point Defence* + Scrapyard Rust paint.
