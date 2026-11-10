# OVERPOWERED 2: OVERDRIVE

Sequel and ground-up rewrite of OVERPOWERED, a browser FPS. This is the source of truth for what the game is.
`docs/original/*.md` is the exact spec of the first game: numbers, effect recipes, bugs. Read the file for your area.

## 1. Pillars

1. **Cold world, hot violence.** The first game looked punchy because unlit yellow, orange and red chips landed on a cool sky-blue scene (`docs/original/01-fx-particles.md`, section 3). The sequel keeps that contrast on purpose: the map is cold steel and blue-hour fog, and warm colour is reserved for what the player does. No orange or yellow set dressing competes with explosions. Lava is the one exception and it sits in one zone.
2. **Peak on frame one.** Effects have zero attack time. They hit at full size and full colour on the frame of the event, the same frame as the sound, then leave by shrinking. Lifetimes stack like an audio envelope: 0.1 s crack, 0.5 s body, 1 s chips, 1-2 s tail.
3. **Bodies are the toy.** Every limb can come off. Enemies keep fighting with what is left: no legs means crawling, no arms means biting, no head means a stagger and a fountain. Ragdolls are real rigid bodies. Blood stays on the floor.
4. **Momentum is the game.** The player is fast and gets faster. Bunny hopping, sliding, wall running and dashing chain into each other, and speed pays out in score.
5. **Become overpowered.** Streaks escalate from strong to ridiculous. The end of a good run should feel like cheating.

## 2. Non-negotiable carry-overs

Everything in the first game comes back, with bugs fixed and without its accidents being lost.

- **Weapons:** SMG (30 mag, 20 rps, pixel-accurate), shotgun, rocket launcher, 30mm autocannon with scope, sword with its three-swing chain, RMB area sweep and heavy finisher, walkie-talkie airstrike, A-10 Warthog strafe designator, akimbo SMG during Berserk.
- **Perks:** Blood Thirst, Hellfire, Berserk, Adrenaline, SLOWMO, Airstrike, Warthog, with original triggers and rough numbers.
- **Systems:** wave survival with score, kill feed, high score in localStorage, minimap, FPS and debug toggles, pickups, health regen, enemy pickup drops, menu, easy and hard soundtrack states, splash, menu, guide, pause and game over screens.
- **Feel:** triple-layered headshot sound, yellow headshot chips, tight blood jets at 5:1 speed-to-jitter, opaque faceted chips that shrink, wireframe shock sphere, dotted smoke trails, hard 50 ms snap shake, SLOWMO audio pitch drop, gravity about 2x real on debris.
- **Audio:** every sample in `public/audio/sfx`, plus the soundtrack in `public/audio/music` (`manifest.json`).

Things the first game wanted but never got working are in scope: real tracers, dismemberment that does not throw, targeting for strikes, hit-stop, hit markers, viewmodel bob and sway, working glow.

## 3. Art direction

- **Setting:** The Crucible, a vast derelict foundry-reactor complex at blue hour. Brutalist concrete, cold steel, wet floors, fog, huge scale. Cyan and white emissive strips for navigation. Warm light only near the lava zone and the reactor's failure states.
- **Palette:** world in desaturated blues and greys between 0.02 and 0.35 luminance. FX in pure saturated hues. Blood is saturated red and never brown.
- **Tone mapping:** Khronos PBR Neutral, or anything else that keeps saturated colour saturated. ACES is banned because it washes out reds and yellows.
- **FX language:** hard, faceted, opaque chips plus HDR glow. Bloom adds heat around them but the silhouette stays crisp. Soft sprites are allowed only for smoke and mist. Normal blending for chips; additive for flashes and energy.
- **Characters:** organic and detailed, baked offline from signed distance fields. Enemy factions read at a glance by silhouette and by one accent colour.
- **UI:** hard-edged, monospace-forward, angular. Inherits the first game's terminal bluntness without its green-on-red clash.

## 4. Technical architecture

TypeScript, Vite, three.js (WebGLRenderer, WebGL2), Rapier 3D (compat build). No other runtime dependencies without a strong reason. All geometry and textures are procedural (runtime, or baked by `tools/`). No third-party art.

### Layout and ownership

| Directory | Owns |
|---|---|
| `src/core/` | Contracts, clocks, events, composition root (`Game.ts`) |
| `src/render/` | Renderer, post stack, materials, procedural textures, sky, light volume, decals, dynamic lights |
| `src/physics/` | Rapier wrapper |
| `src/world/` | Map, collision, nav graph, world objects (jump pads, barrels, hazards) |
| `src/characters/` | Rig, baked model loading, skinned instances, procedural animation |
| `tools/bake/` | Offline model pipeline. Output goes to `public/assets/` |
| `src/gore/` | Ragdolls, severing, gibs, slicing, blood persistence |
| `src/fx/` | GPU particles and every effect recipe |
| `src/input/`, `src/player/` | Input, movement, camera rig |
| `src/weapons/` | Weapon data, firing, viewmodels, projectiles, melee, hit resolution |
| `src/enemies/` | Enemy data, AI, damage model, spawning, waves, bosses |
| `src/progression/` | Streaks, perks, call-ins, powerups, pickups, score |
| `src/audio/` | Audio engine, music |
| `src/ui/` | HUD and all menus (DOM + CSS) |
| `src/sandbox/` | One isolated test page per system, at `/?sandbox=<name>` |

### Rules

- Systems reach each other through `Ctx` (`src/core/contracts.ts`) and events. Never import another system's concrete class, except in `core/Game.ts` and sandboxes.
- **No allocation in hot paths.** Reuse scratch vectors. Pool anything spawned at runtime. Every pool has a hard cap with oldest-out eviction.
- **Clocks:** only `ctx.time`. Never `performance.now()`, `Date.now()` or `setTimeout` for gameplay. World things use `time.dt`, the player's own motion and weapons use `time.playerDt`, UI uses `time.realDt`. Everything is frame-rate independent: `damp()`, never `x *= 0.98`.
- **Budgets on an M1 at 1080p:** 60 fps in a heavy fight, under 500 draw calls, under 1.5M triangles, 12 ms CPU per frame, under 1 GB of memory, under 15 s to load.
- **Caps:** 48 live enemies, 14 simulated ragdolls, 40 corpses, 2048 decals, 30k particles.
- Coordinates: meters, Y up. Characters face +Z. The camera looks down -Z. See `src/characters/rig.ts`.

### Frame order

`input → player → weapons → enemies → projectiles → world → physics → gore → progression → camera → fx → audio → hud → render`

## 5. How to test

A dev server runs on `http://127.0.0.1:5173`. Start one with `npm run dev` if it is not up.

`node tools/shot.mjs --url "/?sandbox=<name>" --out tools/out/<name>.png --wait 4000` runs real headless Chrome on the real GPU, screenshots the page, and prints console errors and `window.__op2.stats()`. Read the PNG to check your work. **Always look at your output.** A clean typecheck says nothing about whether it looks right.

Screenshots and scripted input: see the header of `tools/shot.mjs`.

## 6. Movement

The first game was only fast in the air: 13.6 m/s sprinting on the ground, 45.6 m/s hopping, and that gap came from a drag accident. The sequel makes the ground fast and makes air speed a skill.

| Target | Value |
|---|---|
| Ground top speed | 17 m/s, reached in about 0.2 s. No sprint key: running is sprinting |
| Air | Quake-style accelerate. Strafe-jumping gains speed with no hard cap. Soft drag past 45 m/s |
| Bunny hop | No friction on a frame where jump is held or buffered. 120 ms jump buffer, 100 ms coyote time. Holding space auto-hops |
| Double jump | One extra jump in the air, redirects velocity toward input |
| Dash (Shift) | 2 charges, 1.4 s recharge each. 34 m/s burst for 0.14 s in the input direction, keeps momentum, cancels fall |
| Slide (Ctrl or C) | Keeps speed, 1.25x entry boost on a cooldown, low friction, faster downhill. Jumping out keeps all of it |
| Ground slam (Ctrl or C in air) | Hard drop, shockwave on landing that scales with fall height, bounce if jump is pressed on impact |
| Wall run | Any near-vertical wall at speed. No gravity for 1.2 s, then falls off slowly. Jump kicks off the wall with a speed boost. Camera rolls toward the wall |
| Wall kick | Jump near a wall while airborne, once per wall |
| Mantle | Auto-climb ledges up to 1.5 m above reach while moving forward. Keeps speed |
| Vault | Jump while running at waist-high cover with floor behind it: over on one hand, at the speed you arrived with. See docs/notes/player.md |
| Jump pads, launch ramps | Part of the map, tuned for chaining |
| Gravity | -28 |

Speed feedback: FOV rises with speed (+18 degrees at 45 m/s), wind audio, edge speed lines, weapon lag, footsteps in time with speed. Speed feeds Overdrive (section 9).

Feel requirements from the first game: 0.25 s or less to top speed, momentum persists when keys are released in the air, landing with a queued jump costs nothing.

Keys: WASD, Space jump, Shift dash, Ctrl/C slide and slam, R reload, Q last weapon, G grenade, E interact, F quick melee, 1-0 weapons, wheel cycles, X airstrike, Z Warthog, V/B/N higher call-ins, Esc pause, Tab stats, F3 fps, F4 debug.

## 7. Weapons

Original five are available from the start. Each new weapon arrives in a weapon cache: a drop pod that lands on the map every second wave, marked on the HUD, so the bigger map gets used. Ammo is per weapon type, with bigger reserves than the first game.

| Slot | Weapon | Role | Signature |
|---|---|---|---|
| 1 | **SMG** | Original. 25 dmg, 30 mag, 20 rps, zero spread | Becomes real akimbo in Berserk: both guns fire |
| 2 | **Shotgun** | Original. 6 pellets x 20, semi | Point-blank pellets sever limbs. Hellfire and Blood Thirst pellet counts carry over |
| 3 | **Rocket launcher** | Original. 100 dmg, radius 8, 40 m/s, mag 1. Rocket jumps are a real movement option, with low self-damage | Direct hits gib |
| 4 | **Autocannon** | Original. 30mm, 200 m/s, instakill blast radius 5, 5 mag, RMB scope | Ring trail, tracer cone |
| 5 | **Sword** | Original three-swing chain, RMB area sweep, heavy finisher | Real slice kills along the swing plane. Blocks bullets on RMB hold |
| 6 | **Judge** (revolver) | 6 shots, 120 dmg, slow | A headshot ricochets to the nearest enemy's head |
| 7 | **Lance** (railgun) | Charge and release | Pierces everything in line, severs what it touches, leaves a fading beam |
| 8 | **Buzzsaw** (minigun) | Spin-up, then 50 rps | Slows the player. Shreds limbs one by one |
| 9 | **Kiln** (flamethrower) | Short-range stream | Burning enemies panic, spread fire, char black |
| 0 | **Stakegun** | Rebar stakes | Pins enemies and severed limbs to walls. Ragdolls hang from the stake |

**Families.** A number key can hold more than one weapon. Pressing the key of the weapon in hand steps to the next on that key; any other key draws what was last held there. The second weapon comes with the first and has its own ammo.

| Slot | Beside | Weapon | Role |
|---|---|---|---|
| 1 | SMG | **Harrow** (battle rifle) | 50 dmg, 24 mag, 6.7 rps. Full damage at any range, where the SMG fades from 35 m to half at 80. Through one body or thin cover. Takes limbs |
| 4 | Autocannon | **Sabot** (the autocannon with darts) | 600 dmg, no blast, through armour, a Riot's shield, several walls and everyone in line. Ping the sonar, then shoot what it shows |
| 6 | Judge | **Rivet** (pistol) | 30 dmg, 15 mag, as fast as the trigger, drawn in 0.1 s. Triple headshots, weak at range |

**Penetration.** A round has a budget in meters of concrete, spent by the thickness of each wall it passes and by each body. It leaves a small dark hole going in and a wide pale crater coming out. The Lance keeps its own older rule: two walls, each up to 1.6 m. Numbers in `docs/notes/weapons.md`.

Off-switches: `?families=0` (one weapon a key), `?pierce=0` (no gun in the table goes through anything), `?reach=0` (no gun loses damage with range).

Grenades (G): 3 frags, restocked by ammo pickups. Cookable, bounce, and they can be shot out of the air to detonate.

Viewmodels are detailed, have bob, sway, inertia, recoil on a spring, reload animations and a draw animation. Weapon shake is short and hard as in the first game. Recoil is mostly visual, and guns stay accurate.

**Damage flow:** the shot resolves against bone capsules, region multipliers apply, damage goes to the enemy, limb damage accumulates per region, a limb comes off when its pool empties. Kills route through one `onEnemyKilled` path, unlike the seven copies in the first game.

## 8. Enemies

HP, speed and damage scale with wave, unlike the first game. Every humanoid uses the shared rig and can lose any limb.

| Id | Name | Role | Behaviour |
|---|---|---|---|
| husk | Husk | Melee swarm (type 0 in the first game) | Runs straight in, lunges, swarms. 50 HP |
| trooper | Trooper | Ranged | SMG or pistol, strafes, holds distance like the original: shoots inside 30, holds at 15, backs off under 13 |
| gunner | Gunner | Close ranged | Shotgun, pushes in |
| brute | Brute | Heavy (type 1) | Minigun, armour plates that can be shot off |
| stalker | Stalker | Elite (type 2) | Fast, dodges sideways when aimed at, twin blades |
| rocketeer | Rocketeer | Area denial | Rockets, keeps distance, backpack can be shot |
| sniper | Sniper | Long range | Visible laser, charges a heavy shot, relocates |
| riot | Riot | Frontal shield | Blocks from the front until flanked or until the shield arm is shot off |
| leaper | Leaper | Ambush | Clings to walls, pounces |
| bomber | Bomber | Suicide | Runs in with a fuel tank. Shoot the tank and it takes the pack with it |
| burner | Burner | Zone | Flamethrower, tank explodes |
| warden | Warden | Support | Shields and buffs nearby enemies. Priority target |
| skitter | Skitter | Machine swarm | Fast spider mine, non-humanoid |
| drone | Drone | Flyer | Hovering gun platform, falls and crashes when shot |
| juggernaut | Juggernaut | Mini-boss | Huge, charges, ground slam, armour stages |
| titan | Titan | Boss, every 10 waves | 7 m tall. Limbs are destructible phases: shoot off arms to remove attacks, legs to bring it to its knees |

**Maimed behaviour:** one leg lost: hop or drag. Both legs lost: crawl on arms, still dangerous. One arm lost: drops weapon if it was the gun arm, switches to melee or sidearm. Both arms lost: headbutt charge. Head lost: stumbles for a second, spraying, then falls.

## 9. Streaks, perks and call-ins

The ladder is the best system in the first game. Keep its thresholds, snowball structure, layered per-shot audio and live countdown labels. Extend it.

| Trigger | Reward |
|---|---|
| 4 kills in 5 s | **Blood Thirst** 10 s: 2x damage, bottomless mags, double pellets |
| Combo 8 | **Airstrike** (X): 15 rockets and finale |
| 10 kills in 10 s | **Hellfire** 5 s: explosive rounds, huge instakill rockets |
| Combo 12 | **Warthog** (Z): 50-shell strafe along a chosen line |
| Combo 15 | **Berserk** 10 s: 5x damage, 3x fire rate, unlimited ammo, invulnerable, 2x speed, akimbo. Does not reset the combo |
| Combo 20 | **Sentinels** 20 s: three orbiting gun drones |
| Combo 25 | **Orbital Lance** (V): steer a burning beam for 6 s |
| Combo 30 | **Chain Storm** 12 s: every kill arcs lightning |
| Combo 40 | **Black Sun** (B): singularity that drags enemies and corpses in, then implodes |
| Combo 50 | **Tactical Nuke** (N): whites out the map |
| 3 sword kills in 3 s | **Adrenaline**: speed, stacks to 3 |
| 3 headshots in 3 s | **SLOWMO** 5 s: world at 0.25x, player full speed |
| 3 limbs severed in 2 s | **Butcher** 8 s: every hit severs |
| 3 airborne kills in 4 s | **Skyfall** 8 s: unlimited air dashes, explosive slam |
| 3 kills from one explosion | **Chain Reaction** 6 s: enemies explode on death |
| 5 kills above 25 m/s | **Overdrive** 10 s: damage scales with speed. The title perk |

Combo rule: next kill within 5 s of the last. Wave breaks pause the combo timer, which fixes the first game's rule that wave breaks always killed it. Call-ins have real targeting: press to enter, fresh click to confirm, RMB to cancel, true blast radius shown.

## 10. Powerups and pickups

- **Drops** (30% per kill, as in the first game): health +25, ammo, armor +25.
- **Map items** with respawn timers: Mega Health (+100, overheal), Heavy Armor.
- **Timed capsules**, spawn on a schedule at pickup spots, marked on HUD, 15 s each: **Quad** (4x damage), **Haste** (1.5x speed and fire rate), **Vampire** (kills heal), **Ricochet** (bullets bounce), **Shock Rounds** (arc between enemies), **Ghost** (enemies lose you past 15 m), **Magnet** (pickups fly to you), **Regen** (fast health and ammo), **Frost Nova** (one use, freezes enemies, frozen bodies shatter), **Time Warp** (one use, 5 s slow-mo).
- **Weapon caches** as in section 7.

## 11. The map: The Crucible

About 320 m across, about 9x the first game's area, with real verticality. Built for 17-45 m/s movement: wide lanes, long walls for wall running, ramps for slides, jump pads between levels. Everything is a connected loop, so there are no dead ends.

| Zone | Character |
|---|---|
| **Crucible Core** (centre) | Sunken circular arena around a giant reactor column. Pads launch to upper rings |
| **Foundry** (north) | Enormous hall, crane rails, catwalks, the only lava, the only warm light |
| **Refinery** (east) | Tanks, pipe racks, towers, tight flanking routes, exploding barrels |
| **Scrapyard** (south) | Open, stacked containers, wrecks, ramps, long sightlines |
| **Transit** (west) | Train platform, tunnels, underpass loops |
| **Ring Road** | Elevated banked road around everything at about 14 m, the speed loop |

Hazards: lava, explosive barrels and tanks, crushers, electrified floors. Enemies die to them too.

## 12. Scoring

Base kill 100, 150, 200 by tier as in the first game, +50 headshot. New multiplier: combo tier x speed tier. Style bonuses for limb shots, airborne kills, slide kills, multi-kills, wall-run kills, point-blank, long shots, environmental kills. Wave clear bonus. Banner and stinger on every wave start and clear, which the first game lacked. Hard music from wave 10, as before.


## 13. Owner playtest changes (these override earlier sections)

The owner played the first build. Their verdict: new features are cool, the graphics are a big upgrade, the gore is good. Their complaints drive this section.

**Map.** The owner found The Crucible too big and labyrinthine for tight fights, with nooks to snag on and pits to fall into. **The Kill House** is a new, separate map. Section 15 decides which game runs where; neither map replaces the other.

- A roofless concrete shoot house in a walled yard, about 70 x 70 m. Close quarters: 10-30 m sightlines, rooms, corridors, doorways, simple loops.
- Roofless on purpose. Real kill houses have open tops with overhead catwalks, and call-ins and gunships need to reach the floor.
- Clean and readable: flat floors, plain walls, no pits, no death drops, no fiddly geometry to catch on. Corridors and doors wide enough for fast movement.
- One upper level at most: the overhead catwalk ring, reached by ramps or stairs.
- Enemies arrive through gates in the perimeter and reach the player quickly. Nobody should have to hunt for them.

**Movement.** It must feel weighty and controllable, not slippery. This replaces the targets in section 6 where they conflict. Speed comes from skill, and normal running is planted and precise. Speed stays a core pillar, but control comes first.

**Finding enemies.** When few enemies remain, they are revealed on the HUD and minimap, so a wave never stalls on a lost straggler.

**New call-ins**, added to the streak ladder in section 9:

- **AC-130**: a modelled gunship circles a designated area for 2 minutes while the player keeps fighting on the ground. Visible shells and tracers. Weapons: 25mm Gatling (a walking stream), 40mm Bofors (strings of exploding autocannon shells), 105mm howitzer (several slow, huge artillery shots with visible arcs), plus Hellfire missiles and flare drops. Never harms the player.
- **Attack Chopper**: the player takes the gunner seat, CoD-killstreak style. The helicopter flies itself to wherever enemies are. Chin cannon and rockets until munitions run out, then back to the ground. Enemies are highlighted on the helicopter HUD.
- **Door Gunner**: the same idea, from the side door of a utility helicopter on a circling orbit, with an M134 minigun.

## 14. The Outpost update (applies to the Outpost contract only; see section 15)

**The fantasy changes.** The first game's power fantasy was mowing down mindless drones. The sequel's is the Predator on a rampage through a human outpost. The player is an overwhelming, gadget-laden monster. The enemies are people: trained, coordinated, doing their best to stop you, and failing. They react to your power. They get scared. The owner's reference point is the Juggernaut fight: durable, but every bullet visibly damaged him, like he was made of flesh. Everyone should feel like that, at their own scale.

### 14.1 Wounds: the space between healthy and dead

Enemies pass through conditions. Gore needs time on screen to matter.

| Condition | What it is | Behaviour |
|---|---|---|
| **Healthy** | Unhurt | Full tactics |
| **Wounded** | Hurt, still effective | Limps, clutches the wound, worse aim, bleeds, seeks cover and a medic |
| **Mortal** | Fatally hurt but still standing | Keeps fighting for a few seconds while bleeding out, staggering, aim collapsing, then drops. Rapid further hits kill instantly |
| **Downed** | Incapacitated on the ground | Crawls away from the player toward cover or allies, bleeding out over 10-20 s. Can be dragged to safety or revived. May fire a sidearm or beg |
| **Dead** | Gone | Ragdoll, with twitching and agonal movement for a few seconds |

- **Instant death** comes from headshots, decapitation, several mortal hits in rapid succession, or overwhelming force. They drop dead and twitch.
- **Every hit reads.** Bullets flinch, stagger and slow. Arm hits can make them drop the gun. Leg hits drop them to a knee or a limp. Blood loss is a real clock.
- **Stop coming apart like clay.** Gibbing is rare and earned: a direct rocket or cannon hit, point-blank explosives, nukes. A nearby blast knocks people down, burns them, takes a limb or two, and leaves them alive and screaming. Limbs need sustained fire or heavy weapons to sever, so that it means something.
- **Bodies stay destructible.** Corpses keep taking damage: limbs come off, and sustained damage breaks them down in stages. Dead bodies are part of the toy.

### 14.2 Squads and intelligence

- Enemies fight in squads of 3-6 with a leader and a role mix. **Fewer, better enemies:** quality over swarm. About 8 on wave 1, and rarely over about 18 alive. Melee rushers are rare; husks are a late, rare exception and not the base unit.
- Human tactics on the Kill House: use cover, peek, suppress, flank, bound forward while others fire, throw grenades, reload behind cover, hold angles, fall back, regroup, call for help, react to noise and last known position rather than always knowing where the player is.
- They help each other: pull a downed ally to cover by dragging them, stim them back up, cover a teammate who is exposed, replace a dead leader.
- Enemies talk: voiced radio barks and an on-screen comms feed. Contact calls, man down, requests for medics, reloading, panic, and fear of what the player is.

### 14.3 Morale and fear

- Each enemy has morale. It falls when allies die nearby, on witnessing brutal kills, when the leader dies, when under fire, and when a squad is rapidly destroyed.
- **Dread** is a global measure of the player's rampage, driven by kill speed and brutality. Power-ups and perks spike it: Berserk and Hellfire make enemies run. High Dread means enemies break sooner and reinforcements hesitate.
- As morale falls: steady, then shaken (hugging cover, poor aim), then panicked (retreat, blind fire), then **broken**: they drop their weapon and either flee for an exit or surrender.
- A squad cut down fast leaves its one or two survivors broken.
- **Surrender:** hands up, kneeling, pleading. They stop being a threat and do not count toward clearing the wave.
- **Fleeing:** broken enemies run for exit gates. Reaching one removes them from the round. Rounds never stall on a hider.

### 14.4 Rewards for being the monster

- **Geneva Suggestion:** killing a surrendering enemy gives a bonus and a short stacking damage and fire-rate boost.
- **Back shots:** bonus damage on enemies facing away, which rewards running down the fleeing.
- Style scoring gains: mortal-wound finishes, limb shots, breaking a squad.

### 14.5 Sonar ping

Key T: the player taps their helmet (viewmodel animation) and a ping sweeps out, highlighting all enemies through walls for about 4 s, with a cooldown of about 8 s, dropping to about 3 s when 3 or fewer remain. It costs nothing and helps little in a big fight, but no round is ever artificially extended by a straggler.

### 14.6 Dynamic wounding: where you hit them decides what happens

Wounds are anatomical. A hit resolves to a bone capsule, and its position inside that capsule, in bone space, picks a zone, so organs and arteries need no new geometry. Each zone gives a distinct behaviour, a bleed rate and a style label. Wounds stack, and they are visible on the body.

| Zone | Effect | Label |
|---|---|---|
| Thigh, knee, shin | Limp, then falls. Destroyed or severed leg means crawling | KNEECAPPED |
| Inner thigh (femoral artery) | Heavy bleed, grabs the leg, down in about 8 s | FEMORAL |
| Hand | Drops the weapon at once, then scrambles for it or draws a sidearm | DISARMED |
| Arm or shoulder | Arm hangs useless. Cannot hold a two-handed weapon: fights one-handed with a sidearm at poor accuracy, or flees. Both arms gone: flee or surrender | ARM SHOT |
| Chest (lung) | Goes down, coughs blood, breathless, cannot sprint or shout | LUNG SHOT |
| Chest (heart) | Instant death | HEART SHOT |
| Abdomen | Doubles over, slow, long painful bleed, loud screaming | GUT SHOT |
| Neck (carotid) | Clutches throat, arterial spray through the fingers, on the ground, gone in about 3 s, cannot speak | CAROTID |
| Spine, from behind | Legs fail instantly. Drags with arms only | SPINED |
| Pelvis | Legs fail, drags | PELVIS |
| Head | Instant death. A glancing hit is a stun and stagger; a helmet can be shot off first | HEADSHOT, RINGING |

**System rules:**

- **Wound hold:** hands go to the worst wound by IK, pressure slows the bleed, and that hand is no longer fighting.
- **Weapon character:** small arms make small channels, shotguns tear tissue, cannons remove parts, swords cut clean, and fire cauterises, stopping bleeding but setting panic.
- **Armour:** plates stop small arms with a blunt stagger, crack and then fail, exposing the zones behind them.
- **Blast concussion:** dazed, deaf and stumbling, firing wild, ignoring orders.
- **Fire:** running panic, rolling on the floor.
- **Self-aid and buddy aid:** tourniquets, chest seals, stims. Interrupting it is a chance to finish them.
- **Last stand:** some mortally wounded enemies draw a sidearm, and some pull the pin on a grenade as they die, which then rolls free as a live threat.
- **Screams spread fear:** a screaming wounded enemy lowers nearby morale.
- **Bait:** a downed, screaming enemy draws allies in to rescue them, so the player can leave one alive on purpose to lure a squad.
- **Blood trails:** wounded enemies leave a drip trail on the floor that the player can track. It suits the Predator fantasy and helps find stragglers.


## 15. Contracts: the game is two games (the latest word, overrides everything above)

**Lore.** The player is an intergalactic, superpowered extermination contractor: a hitman commanded by a galactic Council to wipe out entire societies. Each society is a contract, with its own world, enemies and rules of engagement. Tone: dry and bureaucratic. A Council briefing announces genocide in the language of a parking notice. This is why the game can hold mindless hordes and terrified soldiers at once.

**Nothing is replaced.** The owner has grown to like the swarm game, so it stays exactly as it plays now. The tactical game is added beside it.

| Contract | Map | Enemies | Rules |
|---|---|---|---|
| **The Crucible** | The Crucible | Current roster: zombie-like husks, machines, mixed mobs | The swarm game as it stands: sections 8, 9 and 12. Mad dash, herd them, blow them up. No morale, no fear |
| **The Outpost** | The Kill House (for now) | Humans, in squads, fewer and smarter | Everything in section 14: wounds, tactics, morale, surrender |

**Build it as data.** A contract is a definition: map, faction, wave or squad composition, AI rule set, wound rules, Council briefing text, score and high-score table. Adding a new society later must be a new entry, not new plumbing. Examples for later: a machines-only world, a zombie-only world.

**Swarm pacing (owner playtest).** Slow melee enemies are the base of the swarm, around 3.5-4.5 m/s. The threat is numbers, not speed. Twitchy, fast, dodging movement belongs to one rare type: the stalker, played as a ninja. Waves get harder through numbers and mix, not speed.

**Faction rules.** Wounds, morale and gib thresholds are per faction.

- Zombie-likes feel no pain or fear. Limb loss changes how they move, and they keep coming.
- Machines do not bleed. Damage disables parts and throws sparks.
- Humans use the whole of section 14.

**Shared by every contract:** movement, weapons, streaks, call-ins, ragdoll muscles, the sonar ping, gore.

**UI.** The main menu gains a contract select with a Council briefing for each. High scores are per contract.

## 16. The humans: a cunning, adapting enemy (Outpost contract)

Humans cannot be literally anything, the way aliens can. They are limited, so they must be interesting through cunning. The feel: an increasingly desperate human army fighting an existential threat, and learning from every man it loses.

### 16.1 Movement and teamwork

Humans are not superhuman. They walk, jog and rarely sprint: about 2.5-4.5 m/s, with short sprints near 6. Methodical, deliberate, working as a group.

Doctrine: **base of fire and manoeuvre.** A machine gunner pins the player or draws fire while riflemen bound around the flank. Crossfires, overwatch on doors, stacking and breaching with flashbangs, smoke to cross open ground, fighting withdrawals by bounds.

### 16.2 The Commander

An unseen enemy commander watches how the player plays and answers it. It is a rule-based director, not machine learning, but it must feel like being learned. It tracks the player's habits across the whole run: stillness, weapon use, routes, range, sonar use, pickups, call-ins, what they do to prisoners.

| If the player... | The humans answer with |
|---|---|
| Stays still or camps | **Mortar teams and snipers** from unseen angles, forcing a hunt. Mortars need a spotter, and killing the spotter stops them |
| Leans on the sonar | **Jammers** that scramble it, **decoy beacons** that show ghost blips, and men who hide still and wait in ambush |
| Repeats a route | **Mines and tripwires** on the corridors and doors they use most |
| Depends on pickups | **Booby-trapped pickups**, or a pickup left in the open as bait with guns on it |
| Uses explosives | Spread formations, no bunching |
| Rushes with melee | Shotgun pairs and flamers, claymores, men backing away and refusing to close |
| Relies on speed | Pre-aimed crossfire lanes at known exits, cable snares across corridors |
| Fights from the catwalks | Smoke and flanks from below, sniper counter-fire |
| Spams call-ins | Men shelter under cover, **MANPADS teams**, and a radio jammer that delays call-ins until its operator dies |
| Lands headshots | Heavier helmets and ballistic visors on later squads |
| Executes prisoners | **Nobody surrenders any more**, and **false surrenders** appear: hands up with a grenade |
| Baits with the wounded | **Rigged casualties:** a screaming man wired with explosives |
| Listens to radio chatter | **Radio silence**, and false chatter that lures the player to the wrong room |

### 16.3 Their own tricks

- **Sacrificial squads** bait the player into the open, then mortars land on the spot.
- **Playing dead:** a body that shoots the player in the back as they pass. Sonar shows it alive.
- **Danger close:** when the player is among them, they call fire on their own position.
- **Dead man's switch:** dying men with a detonator in hand.
- **Booby-trapped corpses** and rooms rigged to blow once the player is inside.
- **Barricades** and sealed doors to change the map under the player's feet.

### 16.4 Escalation

A run has an arc. **Contact:** professional and confident. **Adaptation:** they start answering the player. **Desperation:** sacrificial squads, danger-close fire, scorched earth. **Last Stand:** everything left, and the Commander in person.

### 16.5 It must read as cunning, never as cheating

- **Telegraph everything.** Every counter has a tell and a counterplay: a spotter to kill, a visible antenna on a jammer, a mine's blink or click, smoke before a mortar strike.
- **Show the learning.** Between waves the player reads **Intercepted Transmissions**: the Commander's orders, spelling out what they noticed and how they will respond. This is how a rule-based system feels alive.
- **One new adaptation at a time**, and they stay for the rest of the run.

## 17. Human vehicles (Outpost contract, later waves)

As the humans get desperate they bring out what they have: **ATVs, drones, tanks and attack choppers**, introduced gradually in later waves. They are escalation, not regular enemies.

- **Armoured:** bullets do nothing. Only explosives and shells damage vehicles: rockets, autocannon, grenades, call-in ordnance.
- **Locational damage:** tail, rotor and cockpit on a chopper; tracks, turret and engine on a tank. Each changes how it behaves: a shot tail rotor sends a chopper spinning, tracks stop a tank. **A perfectly placed autocannon round into the cockpit does massive damage.** Precision is rewarded with a spectacular kill.
- **Enemy chopper:** at most one alive at a time, not counting the player's own.
- **Air-to-air:** if the player calls in their Attack Chopper or Door Gunner while an enemy chopper is up, the two fight. The player's pilot prioritises the enemy chopper.
- Crews are people: they can bail out, burn, and be shot. A wreck stays as cover and a hazard.
- Vehicles need the Kill House's open sky and yard, or a larger Outpost map, for tanks. Check the fit before building.

## 18. The Commander talks back (Outpost contract)

Between rounds, a dialogue box opens with the Commander's portrait and they talk trash to the player directly. This merges with Intercepted Transmissions (section 16.5): same moment, same character. Short, skippable, never blocks play for long.

- **Reactive, not canned.** Lines draw on the player's real stats from that round: favourite weapon, headshots, limbs severed, prisoners executed, time spent standing still, deaths of named soldiers, damage taken. It should feel like being watched.
- **The tone has an arc** that follows section 16.4: smug and professional at Contact, irritated at Adaptation, rattled and bargaining at Desperation, and cracked at the Last Stand.
- **The Council replies** now and then with a dry, bureaucratic note, in the style of a parking notice. The Commander shouting and the Council being unbothered is the joke.
- Lines also announce the adaptation for the next round, so the banter carries useful information.
- If the player gets hit by something the Commander set up, the next box gloats about it.

## 19. Voices

Spoken lines are generated offline with the owner's ElevenLabs account and shipped as audio files. Nothing calls ElevenLabs at runtime.

- **The Council:** the owner's "shodan" ElevenLabs voice.
- **The Commander:** the owner's "the void" voice. Every line carries the `[EVIL]` emotion tag, plus whatever emotion fits the line, e.g. `[EVIL][rattled]`. The emotion follows the arc in section 18: smug, irritated, rattled, cracked.
- Lines are written with variables for stats, so reactive lines need a small set of recorded variants rather than arbitrary text. Anything too dynamic to record stays as text in the dialogue box.

## 20. Owner playtest round 2: bodies

The owner says ragdolls now feel much better, and wants to see them. Decisions made:

- **Big enemies are solid.** The player cannot walk through them.
- **No Titan kneel.** The Titan dragging itself along the floor feels right.
- **Forces are too strong.** Ragdolls are thrown ridiculously hard. Bodies must feel heavy.

**Test Range.** A sandbox map to spawn enemies with no AI and try every weapon on them, plus dev toggles to turn off gibbing, explosive deaths, combos and perks. Gore cannot be judged when everything explodes.

**Active ragdoll (GTA and Red Dead style).** Ragdoll without dying. Enemies stumble, catch their balance, get knocked down and get back up. Under sustained fire a body keeps reacting to every further bullet. It should feel cinematic.

**Visible damage short of losing a limb, in varying degrees.**
- Bullets take chunks out of bodies.
- A shotgun or blast can open a rib cage without gibbing.
- Arms and legs can snap and stay hyperextended.


## 21. Current build notes

- **Streak triggers changed from section 9 after tuning:** Butcher is 5 different bodies in 4 s, direct hits only. Skyfall is 4 kills in 6 s. Chain Reaction is 4 kills from one blast. Overdrive needs speed above 18 m/s. Style perks are limited to one per 20 s.
- **Ladder additions still to place:** AC-130, Door Gunner and Attack Chopper slot into the combo ladder between Warthog (12) and Black Sun (40). Pick thresholds so each feels earned.


## 22. Campaign: The Outpost mission (overrides section 15 for the Outpost)

The Outpost stops being an endless contract and becomes a **fixed, start-to-end campaign mission** that also teaches the game. All human work ships as part of it: smarter AI, surrender, bosses, vehicles, a new map.

**Structure.**
1. **Council briefing:** a short opening cutscene. The Council gives the order, dry and bureaucratic.
2. **Insertion:** you fly in on the helicopter as door gunner, mowing down the defenders.
3. **Locked out:** you land and get locked outside the outpost. They call in reinforcements.
4. **Reinforcements:** soft-skin vehicles (Humvees and similar) bring men in.
5. **Heavy assault:** those plus tanks and choppers. You find an explosive weapon, and that is how you kill them.
6. **The raid:** inside the outpost: close corridors, full of soldiers, some parkour.
7. **The Commander:** kill him. Mission complete.

**It teaches as it plays.** Each stage introduces mechanics through the level itself: parkour needed to cross a gap that cannot be crossed otherwise, explosives against armour, the rest of the movement set. No separate tutorial.

**Unlocks.** The first time, the Outpost map is campaign only, fixed start to end, with no endless. Beating it unlocks **Endless humans on the Kill House**.

**Endless humans.** The Commander is always there, even though he dies in the campaign: he directs the soldiers, the player hears him, and they obey. That is what makes human survival unique.

**Human AI requirements from playtest.** Scarier on their own, smarter, trickier. See docs/NEXT.md: F.E.A.R. lessons, surrender by rank and circumstance, prisoners who run, rejoin or re-arm, more human bosses. The new map is built for them: watchtowers, machine-gun lanes, ambush rooms, loops for flanking.

**Owner decisions for the campaign:**
- About 20-30 minutes long.
- The player starts with few weapons and finds the rest. Finding the explosive weapon must matter.
- The opening cutscene is in-engine, with camera moves and the Council's voice.
- The Crucible stays available from the start as the swarm game.
- Humans are the scary enemies. They must be frightening on their own, more than the swarm.
