# Plan: the second campaign mission, Foreclosure

Status: a plan, nothing built. Written 2026-11-14 from the owner's words, `docs/campaign/MISSION.md`, the hive plan
(`docs/notes/hive-mission-plan.md`), the notes and proposals for this week's work, and the code at `b977170` with other agents' work in
the tree. Section 6 lists what was checked in the code and what each check changed. Nothing was run in a browser.

The owner asked for:

- a plan for the second campaign mission, with "a point where you climb into a mech suit and pilot a fucking mech";
- for the campaign, our side looking nothing like theirs. The shadowy, evil bureau's men should look the part: "a spec-ops ninja type:
  all black, with black, grey and red accents; that's our thing. The enemies are more ragtag and colourful."

## 1. Where it goes: before The Sump

**This is mission 2. The Sump moves to mission 3, unchanged except for the look of its Bailiffs.**

| Reason | Why it matters |
|---|---|
| It stands on this week's work | Allies, mounted guns, walls and gates and shacks, the AC-130 seat, enemy anti-air, vehicles with weak points, armour and helmets, stims, parkour: all of it was built for humans, and every one of them gets a job here. The Sump needs the far battle, `prey`, the dark and two new bosses, none of it built, and the owner put it on hold |
| Allies work against humans today | The Outpost's squads already pick allies as foes (`prefersAlly`). Swarm enemies ignore allies (`docs/notes/allies.md`, Rough), so friendlies in The Sump still need its stage 2 |
| The story runs straight through | Holdfast garrisoned the Outpost. You foreclose on it, and the Council ships its people to Tallow "for processing". The Sump opens with the product no longer inert. The Remainder is "what is left of everyone you were paid to remove": now that includes a town you met |
| It introduces the Bailiffs | The 14th Recoveries fight beside you here first, in their new look, against men. When they die one by one in The Sump, the player already knows them |
| Variety | Humans and a mech here, then the zombies. The Sump keeps its horror because this one is daylight and spectacle |

Nothing in the Sump plan has to change except its stage 2 "the look" item (bone-white and navy), which this plan replaces with the owner's
black, grey and red. Form numbers stay: the Outpost is 7742-C, this is 7742-F, The Sump is 7743-R.

## 2. The pitch

**Foreclosure.** Contract, mission and map id `foreclosure`. Form 7742-F, Notice of Foreclosure.

- **The place.** Holdfast, a squatters' free port in a dead shipyard on the salt flats of the planet Brine. Dyed sailcloth awnings,
  painted containers, gantry cranes, a dry dock, a harbour wall with a flak tower on it, and west of the town the salt pans, where the
  town's oldest machine still works.
- **Who they are.** The Holdfasters: dockers, salt-cutters and their families, armed with whatever the Outpost did not take. Ragtag and
  colourful (section 4). Their leader is **the Harbourmaster**, who speaks to the whole town, and to you, over the port's loudspeakers.
  Warm, funny, unbothered by forms. Where the Commander was smug, she is kind, and that is worse for the player.
- **Your side.** The Office of Societal Compliance's own armed collectors, the Bailiffs: a squad of six from **the 14th Recoveries**.
  No lines, as in The Sump. And the **Distraint Frame**, "available on request; fees apply".
- **The boss.** **Old Mother**, a salt-harvesting crawler 30 m long that the town has armed and painted, with the Harbourmaster on its
  bridge.
- **The beat in the thread.** The Outpost removed one man. This removes a town, and shows where the dead go.
- **Why this mission.** It is the one place in the campaign where the player is overwhelmed on foot for twelve minutes and then gets to
  walk back through the same streets six metres tall. The owner asked for the mech; the mission is built so the mech is the answer to
  everything the first half did to you.
- **How long.** About 29 minutes on a first play, about 22 for a strong player. The Outpost is 28, The Sump 30.

### The shape

Taken from you twice, then given back huge. Intensity out of 10. Coordinates in section 5 are a first layout that the map stage owns.

| # | Beat | Starts | Runs | Place | What happens | Real hostiles at most | Int. |
|---|---|---|---|---|---|---|---|
| 1 | `briefing` | 0:00 | 1:00 | Film over Holdfast | The Council reads Form 7742-F. Holdfast garrisoned the Outpost, so its debts transfer. "Holdfast has filed an objection. Objections are not a recognised form." The Frame is mentioned once, with its fee | none | 2 |
| 2 | `overwatch` | 1:00 | 2:00 | The AC-130 seat over the Flats | You cover the 14th's landing from the gunship: green men below, colourful ones coming out of the shanties. The Harbourmaster's first broadcast. Two anti-air locks, flares, the lock tone learned here and heard again in the Frame. The lease runs out and you are on the ground | 18 | 7 |
| 3 | `landing` | 3:00 | 2:00 | The Flats and the outer shanties | On foot with six Bailiffs. Tap E, hold E, a stim to revive a man. Two technicals with roof guns. One rocket flattens a shack with a sniper in it | 12 | 6 |
| 4 | `wall` | 5:00 | 2:30 | Holdfast's wall | Two enemy-manned mounted guns on the wall. A Bailiff plants a breaching charge on a marked segment and you keep him alive for 10 s, or you blow the gate with five rockets. The launcher is on the 14th's breaching kit | 14 | 7 |
| 5 | `market` | 7:30 | 3:00 | The Market | Lanes 3 to 5 m wide between shacks and stalls. Riot shields in the lanes, riflemen on the roofs, a Warden. Surrenders, and prisoners you can take. One Bailiff dies | 16 | 7 |
| 6 | `courier` | 10:30 | 1:00 | The Square | A breath. A Bailiff's radio: E REQUEST FRAME, and the Council reads the fees. The courier crosses with the Frame slung under it. The flak tower on the harbour wall opens up; the courier burns and goes down into the dry dock 150 m north. A column of smoke is the goal for the next six minutes | 4, then a wave | 3 |
| 7 | `stacks` | 11:30 | 3:00 | The container yard | The hard stretch. The 12 m crane aisle is a killing ground owned by a tank on the quay (Grandad) and two snipers. Over the top is faster: wall climbs, clings, a chimney between stacks. The Bailiffs cannot parkour, so they take the long way round and lose a man. Grandad's roof hatch takes one rocket | 18 | 8 |
| 8 | `quay` | 14:30 | 0:30 | A crane cab over the quay | Breath. Health, armour, stims. The Thresher on a rack. The squad rejoins at four | 0 | 3 |
| 9 | `slip` | 15:00 | 2:30 | The Slip, the dry dock | The Frame lies half-buried under the courier. It needs 120 s to boot, and its boot bar is the Council's terms and conditions scrolling past. Hold the basin from three sides with the courier's torn-off door gun as a mounted gun, four Bailiffs and the Thresher: a truck, a technical, the town's one helicopter, and the militia's only heavy suit, a Juggernaut painted with flowers | 18 | 9 |
| 10 | `mount` | 17:30 | 0:45 | The Slip | It kneels and opens. Climb its shin (the wall climb), mantle onto its knee, drop into the seat. Dark, then the HUD boots line by line, a red slit lights across the glass, and it stands up | 0 | 3 |
| 11 | `foreclosure` | 18:15 | 3:00 | Back through the stacks and the market | The payoff. Down the crane aisle that nearly killed you. Through the shacks, not round them. Technicals crushed, a second tank, men breaking and throwing their hands up. Their answers: rockets, a top-attack missile with a lock tone (smoke on Q), sappers at your feet | 18 + 3 vehicles | 8 |
| 12 | `flak` | 21:15 | 1:45 | The harbour wall | The tower that shot down your courier. Its four guns are parts. Break them and the sky is yours again | 14 | 7 |
| 13 | `pans` | 23:00 | 0:30 | Out the west gate onto the salt | Breath. Flat white ground to the horizon, and something moving on it. The Harbourmaster: "Mother's been pulling salt out of this flat since before your Office had a name" | 0 | 3 |
| 14 | `mother` | 23:30 | 3:00 | The Pans, in the Frame | **The boss, phases 1 and 2.** Tracks, turrets, its own launcher, the cutter wheel, men on its decks. With both tracks gone it drags itself at you and the cutter wheel seizes the Frame. HULL BREACH. EJECT | 10 + the boss | 10 |
| 15 | `deck` | 26:30 | 1:45 | Old Mother's deck, on foot | Thrown 25 m up over the salt in slow motion, a big slam onto its deck. Fight its crew from post to post to the bridge and break the engine. The Harbourmaster kneels with her hands up. Your call | 8 | 9 |
| 16 | `ending` | 28:15 | 1:00 | Film | "Holdfast has been removed from the register." Deductions: one Distraint Frame, one courier, the Bailiffs you lost. "The residents are being shipped to Tallow for rendering. Tallow Rendering Works acknowledges receipt." | none | 1 |

The Outpost's rule holds: never two 8s without a breath. `mother` into `deck` is the one exception, as the Outpost's last climb is: the
ejection's 4 s of slow motion is the breath.

**Where the Frame sits, and why it is earned.** It is first seen at 10:30, falling out of the sky. Then six minutes of the hardest fighting
in the mission happen between you and it: the stacks, where you are small and the tank owns the open, and the hold, the peak of the
on-foot game. You get in at 17:30, 60% of the way through, and keep it for about 8 minutes, to 26:30. Its first job is to walk back
through the places that just hurt you. Its last is to be destroyed by the one thing on Brine bigger than it, so the mission ends with your
own feet on the boss.

**Finds.** Start: SMG, shotgun, sword, 2 grenades, 3 stims, call-ins as earned. The launcher at the wall. The Sabot in a crane cab only a
chimney climb reaches (optional). The Thresher at the quay. On the deck, the autocannon on the dead deck gunner. Every checkpoint promises
what the next fight needs, as `KIT` does on the Outpost.

**Voice.** Nothing is recorded. The Council's recorded `council.brief.line` ("Contractor. This is the Office of Societal Compliance. You
are on a recorded line.") opens the briefing by its id, as The Sump reuses takes (its fact 28). Everything else is text with stable ids,
`mission.foreclosure.<who>.<key>`. The Harbourmaster is text in the box with the port's PA tone under it, a synth recipe.

## 3. The Frame

### What it is

A **Distraint Frame**: the Office's own walker, issued to collect what will not come quietly. In law, distraint is seizing property to
pay a debt. On the HUD it is DISTRAINT 4; in the lines it is "the Frame".

- **Look.** 6.4 m tall on reverse-jointed legs, a hunched armoured torso with the cockpit pod set in its chest, a rotary cannon on the left
  arm, a 40 mm cannon on the right, a rocket pod on the right shoulder, and the reactor on its back behind slatted vents. Black, with grey
  plates and red running lights, and one red slit across the canopy: the Bureau's mark, the same slit the Bailiffs wear on their visors.
- **Why the Office has one and Holdfast does not.** It is the Bureau's answer to a town, and the enemy's look is junk and paint. The
  contrast is the owner's direction made big.
- **Not a captured enemy walker.** That would mean two walkers, or hijacking one mid-fight. Not a suit you wear either: the owner said
  "climb into", and a cockpit gives the view something to frame.

### Getting in

`mount`, 45 s. The boot ends, the Frame kneels (a pose on its animator), the hatch opens 3.6 m up and the prompt says E BOARD. The player
climbs its shin with the existing wall climb (2.4 m) into a mantle onto the knee, and walks into the hatch: a trigger, not a new move. Then
a camera tween of 0.8 s into the seat, the canopy shuts (dark), the HUD boots line by line ("By operating this Frame the contractor accepts
liability for its contents"), the slit lights red, and the camera rises 2 m as it stands with a hydraulic groan. That is the moment, so it
is short and nothing shoots at you during it.

A death in the Frame restarts the beat in a fresh one: "Replacement Frame issued. The fee has been deducted."

### The view and the HUD

- **First person from the cockpit,** eye at 5.2 m. The canopy's struts frame the edges of the screen. The two arm guns are world objects
  at the bottom corners, as the door gun is (`progression.md`: "Guns are world objects, not viewmodels"), so their barrels swing, spin
  and recoil in view, and a tracer leaves a real muzzle. The cockpit is a near-view model built like the Packmule's cabin.
- **The canopy cracks.** A sniper's round on the glass leaves a crack you look through. Three cracks lose a pane: wind noise and a hole
  in the view. A tension cue, not much damage.
- **The HUD** is the gunner's overlay (`GunnerHud`) in a new tone, `frame`:

| Element | Shows |
|---|---|
| Weapon rows | Rotary: heat bar, `OVERHEAT` in red. 40 mm: magazine, the round (HE, AP, FLAK), its reload. Pod: marks painted, its reload. As the AC-130's panel |
| The Frame | A small outline with each part's state: legs, pod, vents, glass. A part flashes when hit and greys when broken, like the Titan's limb pips |
| Jets | A fuel bar |
| Lock | `aa_lock` and `aa_launch` in the cockpit as in the seats; a SMOKE row with its count |
| Torso | A tick on the compass for where the legs point against where you look |

### Movement

The aim is never slowed. The weight lives in the feet: acceleration, the footfalls, the camera, and what a step does to the ground.

| Move | Key | Numbers (defaults, to be played) |
|---|---|---|
| Walk | WASD, relative to the view | 7 m/s ahead, 1.1 s to reach it, 0.6 s to stop. 4.5 m/s back, 5 m/s sideways. The player runs at 12.5, the Outpost's men at 2.5 to 4.5 |
| Look | Mouse | Full speed within 80 degrees of the legs. Past that the whole Frame turns at 140 degrees a second, so a 180 takes about 0.7 s once at the edge. `?frameturn=free` takes the limit off to compare (question 2) |
| Footfall | | One every 0.7 s at a walk: a small camera thump and dip, `land_hard` pitched low with a servo whine. Bodies within 1.4 m of a planted foot are crushed. A stall or shack under a foot goes |
| Steps | | Climbs 1.2 m: sandbags, jersey barriers, rubble. No crouch, slide, mantle or wall run |
| Jets | Space, hold to hover | Up 7 m in 0.8 s, hover up to 1.5 s, half control in the air. Fuel refills in 3 s on the ground. Over a 3 m wall, onto a quay, onto a container stack |
| Stomp | Crouch in the air | Down at 30 m/s. From 4 m or more: a ring of 14 m, 160 at the middle falling to 40, everyone within 10 m knocked down, the stall, shack or car under you crushed. 0.6 s to stand, cancelled by a charge. The big slam, twice the size |
| Charge | Shift, 2 charges, 4 s each | 0.7 s at 16 m/s, shoulder first. Bodies flung. A shack or a gate goes, a wall drops a stage. A soft-skin is wrecked and thrown. A tank stops you dead for 0.8 s. Pressed while turning, it re-plants the legs to the view at once |
| Backhand | F | A 120 degree arc, 4 m, 200 damage, bodies flung. Once a second |

### Weapons

The AC-130's three guns brought down to the ground, with the same idea the owner liked there: each has its own magazine and its own
reload clock, so you juggle them.

| Key | Weapon | Job | Taken from |
|---|---|---|---|
| LMB | **Rotary cannon**, left arm | Crowds, soft-skins, men on roofs. Unlimited, runs hot | The door gun's 20 mm round (60 a round, bursts where it lands, goes through 1.4 m of wall), at 20 a second. Heat from the mounted gun's `Heat`: about 7 s to `OVERHEAT`, 2.5 s to vent |
| RMB, R cycles the round | **40 mm cannon**, right arm | The thinking gun. HE for the sniper on a roof, AP for the men behind a wall, FLAK for a crowd at 20 m | The AC-130's 40 mm, its `Battery` and its three rounds as they are: HE 170 in 5 m, AP through 3 walls then 320, FLAK 14 pellets of 75. 8 a magazine, 4.5 s reload |
| G, hold to paint and let go | **Rocket pod**, shoulder | Armour, the anti-air teams, the boss's parts | The Quiver's `Painter` and missiles: up to 6 marks, a shaped charge on each. 10 s reload |
| Wheel | Zoom | x2 | The seat's `aimZooms: false` |
| Q | **Smoke and flares** | Breaks a lock | The seats' flares, 3 a beat, `FLARE_LOCKOUT` after each pop |

Against the mounted guns: the rotary is the level 3 mounted gun's job (a stream with heat) on legs. Against the seat: the Frame is a
gunner's seat whose mount walks, so the reticle, the arc, the HUD and every way out are the seat's.

### What it breaks

| Target | What happens | How |
|---|---|---|
| Stalls (new kind) | Walked through: the awning comes down as cloth | A new `stall` in `structures.ts`, 40 health, flattened by any contact or blast. The market's colour |
| Shacks | A footfall, a charge or a stomp flattens one | Existing shacks (120). The charge and stomp are blasts of a new kind, `crush`, with no fireball |
| Walls and gates | A charge drops a wall one stage and opens a gate. The 40 mm and the pod wear them as any blast does | `Combat.blast` already wears them (`docs/notes/world.md`). `crush` counts like a tank shell, 4 times |
| Soft-skins | Crushed under a stomp, wrecked and thrown 4 to 8 m by a charge, cut apart by the rotary | `vehicle.take` on the part. The throw is a canned arc for the wreck, because vehicles are kinematic on purpose |
| Tanks | The pod: three on the hull, one through the roof hatch. A charge does 300 and stops you | The existing tank, its parts and weak points |
| Men | Crushed, kicked, flung, burst. Their morale breaks: the Frame is a dread spike and a standing dread within 40 m, so men run and surrender in numbers | `gore` ragdoll impulses, `slamEnemies`, `Dread` and `DREAD_SPIKES` in `outpost/morale.ts` |
| Not broken | Containers, concrete, the tower's base, the dock | So the routes keep their shape |

### What hurts it

The Frame has 4000 health and parts, as a tank does. Hits reach it through `player.interceptor`: the body rides inside, every hit on the
player goes to the Frame instead, and `PlayerDamage.from` says which side and how high it came from. Rockets and shells that meet a part's
collider say which part.

| Source | Damage | Note |
|---|---|---|
| Small arms | 0 to the plates. Sparks and the armour marker, the sound the player made on the Outpost's tank | The man shooting you is what you hear, not what hurts |
| Sniper | A crack in the glass, 1% | Glint and laser first, as today |
| Rocket, direct | 260, 6.5% | Splash 40% of that |
| Top-attack missile | 480, 12% | The anti-air missile, climbing then diving. Lock tone 3.2 s. Smoke breaks it |
| Tank shell | 600, 15% | The laid-gun rhythm warns: traverse, laser, fire |
| Sapper charge | 600 on a leg | A man runs to a foot, plants a beeping charge, runs. Stomp within 3 m or backhand to clear it in 5 s |
| Old Mother | Section 5 | |

| Part | Pool | Broken |
|---|---|---|
| Leg, each | 900 | A limp: 55% speed, no jets, half a charge, until the next checkpoint |
| Rocket pod | 500 | No rockets |
| Rear vents | weak point | Everything from behind does 2.5 times. THROUGH THE VENTS, from the enemy's side |
| Glass | 3 cracks | A pane goes. Cosmetic |

About fifteen rockets from the front, or six from behind. Careless for a minute costs it; careful, it lasts the beat. No repairs inside a
beat: each checkpoint gives it back whole.

### How long you keep it, and how you leave

From 17:30 to 26:30, about 8 minutes of play in three beats and a breath. No way out by choice (`noWayOut`, as the scripted ride has).
Old Mother takes it: with both tracks broken it drags itself at you and the cutter wheel seizes the Frame. HULL BREACH, EJECT on the HUD;
Space ejects you, or it does after 3 s. `seat.leave`, then `player.launch` throws the body 25 m up and forward over the deck with a short
slow motion. The hint says crouch, and the big slam lands you on Old Mother's deck. The Frame folds in the wheel and burns.

### Why it is fun and not a slow tank

1. **The aim is the player's own.** Mouse speed is never capped inside the torso's arc. The weight is in the feet and the camera.
2. **Everything breaks,** and it breaks the places that hurt you. The crane aisle, the market lanes, the shacks you hid behind.
3. **It goes up.** Jets onto a container stack, a stomp into a crowd. The vertical game the player already loves, at six metres.
4. **Three clocks to juggle,** as in the AC-130 the owner liked: empty the rotary, drop two 40 mm, paint while both reload.
5. **The enemy changes.** Men who held lanes against you run and throw their hands up. The surrender system finally has a reason.
6. **Things that make you move.** A lock tone, a sapper at your foot, a tank's laser, a top-attack missile you can see climbing.
7. **It is short and it ends big.** Eight minutes, then it dies in the boss's arms and throws you onto it.

### What is reused and what is new

| Piece | Reused | New | Size |
|---|---|---|---|
| Seat, view, HUD frame | `GunnerSeat`, `SeatPlan` (arc, zoom, `noWayOut`), `camera.setSeat`, `GunnerHud` | A `frame` tone: parts outline, fuel, three rows | M |
| The body inside | `player.park` (exposed), `player.interceptor`, `PlayerDamage.from` | `player.carry(feet)`, which moves a parked body without clearing input and resetting the body layer as `park` does | S |
| Walking | Nothing walks freely today: vehicles follow routes on `Driver` | A walker controller: a Rapier shape cast of a capsule against the world, steps to 1.2 m, jets, stomp, charge, turn limit | L |
| Rotary | The door gun's round, `Heat` | The arm mount | S |
| 40 mm | The AC-130's `Battery` and rounds | Fired flat from a muzzle, so its arming is measured from there | S |
| Pod | The Quiver's `Painter`, `MissileTarget`, shaped charge | A six-tube mount | S |
| Stomp, backhand | `slamEnemies`, the big slam's ring and crack, gore impulses | Scale and an arc | S |
| Breaking things | `Combat.blast` on structures, `vehicle.take` | `crush` blast kind, `stall` kind, the wreck's throw | M |
| Being hurt | Vehicle parts and weak points as the model, `AntiAir`'s lock, missile and flares | The Frame as a ground `Aircraft`, the missile's dive, sappers | M |
| The model | The baker (SDF, `paintedMetal`, `rivets`, `panelLine`, `hazard`), `onRequest` loading, the skitter's procedural animator and `ik.ts` | A `walker` rig and `WalkerAnimator`: foot plants by IK, torso twist, arm aim and recoil, kneel, collapse | L |
| Cockpit | The Packmule cabin's way of building, `materials.nearby` | The cockpit, the canopy cracks | M |
| Getting in, getting out | Wall climb, mantle, `player.launch`, the big slam | A hatch trigger, a camera tween, the eject | S |

## 4. The look: the Bureau and the ragtag

### What the owner saw

Allies are the enemy's own bodies (`ctx.characters.spawn('trooper')` for a rifleman) with props added, and their bands are cyan
`0x39e0ff`. The Trooper's accent is cyan `0x26d9ff`. So a friendly rifleman is an enemy rifleman with the same colour lit on him. The
green crosshair tells them apart; the bodies do not.

### Our side: black, grey and red

- **The Bailiffs.** Two new baked bodies on the shared humanoid rig, not enemy bodies with props.
  - `bailiff`: slim and tall, matte black suit, charcoal soft armour cut close, a hood over a smooth black helmet with one red visor slit,
    grey webbing, a red stripe down the left arm. Rifleman, shotgunner, sniper, rocketeer and medic all wear it, with their gun fitted
    to the hand at run time, as `allies/props.ts` already fits the pack and the beacon.
  - `bailiffHeavy`: the same in heavy plate, broader, for the machine gunner and the riot shield.
  - The props change colour: the pack frame grey, the bands red, the beacon stays cold white (amber when down). The minimap keeps its
    ally colour (question 8).
- **The player.** The menu's `contractor` is re-baked in the same palette: black sleeve, grey plates, red slit and stripe instead of the
  grey-blue with an orange stripe. The first-person sleeve (`fabric` `0x3a4048` in `viewmodels/kit/finishes.ts`) goes to near-black, the
  bracer gets a red stripe, the wrist computer lights red. The HUD's hot orange stays (question 7).
- **Red against the crosshair.** The crosshair is red over hostiles. Red on our side is small, lit and on a black body: slits and stripes,
  never a coat. Green stays HUD only. **The crosshair never lies.**
- **The Frame** is the same palette at six metres.

### Their side: ragtag and colourful

The seven human types (`trooper`, `gunner`, `brute`, `rocketeer`, `sniper`, `riot`, `warden`) are re-baked as a militia: mismatched
fatigues in dyed colours, patterned scarves and sashes, hand-painted helmets, scavenged plate in odd colours, a different hat or wrap on
each type. Each keeps its silhouette and its accent as the colour of its paint, so the cast still reads by type at a glance.

| Type | Today's accent | Becomes |
|---|---|---|
| Trooper | Cyan | Turquoise paint, a patterned wrap. Moved off the allies' old cyan |
| Gunner | Amber | Unchanged |
| Brute | Red `0xff2a1a` | Off red, to a hot magenta, because red is ours |
| Sniper | Red-pink `0xff1060` | Off red, to violet |
| Rocketeer, Riot, Warden | Mint, blue, cream | Unchanged |

Helmets are props (`docs/notes/characters.md`), so they are re-painted with the bodies. The swarm creatures and the Juggernaut and
Titan are not touched.

### Is it a prerequisite?

- **The Bailiffs' bodies: yes,** for every beat with allies in it. Six friendlies in a firefight against men in the same body is the
  problem the owner named. Stage 1 lands before the first beats with allies are judged.
- **The ragtag re-bake: no.** The mission plays with today's enemy bodies. But Holdfast's whole identity is its colour, so stage 2 should
  land before the mission is called finished. It changes the human enemies everywhere by default, the Outpost and Endless Humans
  included (question 6).
- **The player's own look:** independent and small, in stage 1.

## 5. Enemies and set pieces

### Holdfast on paper

x east, z south, y up, north is -z. About 320 by 240 m: the town on the east half, the pans on the west. A first layout for the map stage.

| Place | Where (x, z) | What it is for |
|---|---|---|
| The Flats | z 80..115, LZ at (40, 95) | The landing, under the gunship. Salt crust, a few wrecks |
| Outer shanties | z 55..80 | Shacks scattered on the flats, two tracks for technicals |
| The Wall | z 50, x -10..150 | The fort's wall kit, 3 m. The main gate at (70, 50). Two gun pads behind it at (40, 46) and (100, 46). A marked segment at (55, 50) for the charge |
| The Market | z 10..50, x 10..130 | Shacks and stalls in lanes 3 to 5 m wide. The Square, 24 m across, at (70, 28) |
| The Stacks | z -40..10, x 0..110 | Containers 2 to 4 high. A 12 m crane aisle along x 55. Chimneys 1.2 to 1.6 m wide between stacks. A gantry crane at x 30. The quay road at x 110..125, where Grandad sits. The Sabot's crane cab at (30, 22 up, -20) |
| The Slip | centre (120, -70) | A dry dock 60 x 30, floor y -6, ramps on three sides. The courier's wreck and the Frame in it |
| The harbour wall | z -105, x -30..150 | The flak tower at (20, -105), 24 m, four guns on top |
| The west gate | (-10, -20) | Out of the town onto the pans |
| The Pans | x -160..-10 | Open salt, 150 m across, Old Mother's loop |

Mech-width is designed in: the crane aisle is 12 m, the market is shacks the Frame walks through, the route from the Slip to the west gate
never needs a gap under 6 m that does not break.

### Who you fight

The contract runs on the Outpost's rules (`ai: 'outpost'`, wounds, morale, surrender, prisoners), 18 real hostiles at most, as the
Outpost does.

| Beat | Men | Machines and set pieces |
|---|---|---|
| `overwatch` | 18 at most, all types but the Juggernaut, two rocketeers hunting the gunship | The gunship's ring over the LZ (the existing `ride` with `ac130`) |
| `landing` | Troopers, gunners, a sniper in a shack | Two technicals: the scout car, repainted |
| `wall` | Troopers, rocketeers, two men on the mounted guns | The breach: allies' `markBreach` for the charge, or the gate's 400 health |
| `market` | Riot shields in lanes, troopers on roofs, a Warden, a brute | Stalls, shacks. Prisoners |
| `courier` | One squad at the end | The courier on `flight.ts`, the flak tower firing (scripted), the crash |
| `stacks` | Two snipers on stacks, troopers, rocketeers | Grandad, the tank, roof hatch weak point |
| `slip` | Three waves, one per side | A troop truck, a technical, the enemy helicopter, the Juggernaut. The courier's door gun as a mounted gun, level 3 |
| `foreclosure` | Everyone, rocketeers locking on, sappers | Two technicals, a truck, a second tank, walls and shacks in the way |
| `flak` | Gunners and rocketeers on the wall | The tower: four guns as vehicle parts, 500 each, and its own launcher |
| `mother` | Ten deck crew on posts, pinned like roof gunners | Old Mother |
| `deck` | Eight on posts, the Harbourmaster | Old Mother's deck, stopped |

### Old Mother

A salt crawler 30 m long, 14 wide and 12 tall, painted with murals and hung with flags. A `Vehicle` like the tank: a kinematic chassis
on a route round the pans, a collider per part, parts and weak points from `data.ts`, the laid-gun rhythm.

| Part | Pool | Does | Broken |
|---|---|---|---|
| Track, port and starboard | 1500 each | Moves it at 4 m/s | One: it slews in circles. Both: it stops, and phase 2 starts |
| Turret, two | 700 each | The tank's laid gun: traverse, laser, a shell of 15% | Silent |
| Launcher | 500 | The top-attack missile at the Frame every 14 s | Silent |
| Cutter wheel | 2000 | A sweep along a marked lane 20 m long, 1.2 s of warning, 20%. In phase 2 it drags the crawler toward you and seizes the Frame | Cannot be broken in the Frame. It is what kills it |
| Deck crew | Men | Rifles and rockets from posts, pinned like roof gunners | Killed as men |
| Engine | 1200, weak point | Under plates until both tracks are gone | The end of `deck` |

- **Phase 1, the hunt** (about 1:45). It circles, you circle it. Tracks from the side, turrets with the pod, the launcher before it
  launches. Smoke when the tone starts.
- **Phase 2, the drag** (about 1:15). Both tracks gone, it heaves itself at you on the cutter wheel in lunges along a lane you can read.
  Each lunge you dodge buys a shot at the exposed engine plates. At 40% of its health, or after 75 s, it catches you: the eject.
- **Phase 3, the deck** (`deck`, about 1:45). Stopped, so its deck is a floor. Crew on posts, the autocannon on the first dead gunner,
  the engine in the stern, the bridge forward. When the engine goes the Harbourmaster comes out with her hands up, as a prisoner does.
  Spare her or not; the Council's last lines differ, and she goes to Tallow either way.

### The Harbourmaster's lines, as the tone of them

- On the gunship: "Good morning, Holdfast. The tax man has come in person. Wave."
- "To the gentleman in the sky: we read your notice. We used it to light the stove."
- When the courier burns: "That's a lot of iron to drop on a town that's behind on its rent."
- At the boot: "They've sent a suit of armour after a town of fishwives. Mother. Wake up."
- At the end: "Go on, then. Fill in your form."

### New enemy pieces

| Piece | What | Size |
|---|---|---|
| Men on mounted guns | An enemy soldier with a post at a gun calls `occupy`, `aimAt`, `trigger`, which the gun already offers to allies. Shoot him off it, take it | S |
| The flak tower | A static `Vehicle` with four gun parts and the scripted kill of the courier | S |
| Anti-air against a ground target | The Frame registers as an `Aircraft`; the missile climbs, then dives | S |
| Sappers | A run to a foot, a plant, a run away, a beeping charge. First to cut | M |
| Old Mother | Above | L |
| Stalls | A new structure kind | S |

## 6. Facts checked in the code, and what each changed

1. **The seat parks the body, and a mech has to carry it.** `GunnerSeat.board` calls `player.park(spot, exposed)` once. `park` teleports,
   clears input and resets the body layer. Enemies aim at `player.position` (The Sump's fact 15), so a body left where the Frame stood
   would draw every shot. Hence `player.carry(feet)`: the body rides in the torso every frame without the resets.
2. **Hits can be taken by something else.** `player.interceptor` is asked before every hit (`Player.takeDamage`), and its one user is the
   hostage shield in `outpost/prisoners.ts`. The Frame sets it on boarding and gives it back on leaving. `PlayerDamage` carries `from`
   and `type`, enough for front, back and legs.
3. **Nothing in the game walks freely except the player.** Vehicles are kinematic on routes (`Driver`), with no physics bodies on purpose.
   So the walker controller is new, and the largest single piece of the Frame.
4. **Vehicle parts are the model to copy.** `Vehicle` puts a moved static box per part, `take(amount, part, source, point)` and `weakAt`.
   The Frame's parts and Old Mother are built the same way.
5. **Structures already take blasts.** `Combat.blast` wears walls, gates and shacks, a tank shell counts 4 times, and the nav opens on a
   breach. So a charge and a stomp are blasts of a new `crush` kind with no fireball, and nothing in `structures.ts` changes but the
   `stall` kind.
6. **The baker has three rigs, each with its own procedural animator** (`HumanoidAnimator`, `SkitterAnimator`, `DroneAnimator`, and
   `ik.ts`). A walker is a fourth, marked `onRequest` as the contractor is, so only this mission and the range pay for it.
7. **The AC-130's 40 mm lives in `Battery`** with `armRange`, written for a 245 m fall. Fired flat from an arm, it arms from the muzzle.
   The rounds never harm the player through the `worldObject` flag, which the Frame keeps.
8. **The Quiver's mind is pure.** `Painter` in `weapons/swarm.ts` has no world, so the pod uses it as it is.
9. **Anti-air hunts `Aircraft`,** an interface of position, hits, flares, `huntable` and `down`. The missile leaves steeply up and turns at
   2.6 rad/s, which over a ground target is a top attack. The Frame implements the interface and maps a hit to damage, not a count.
10. **The mission can already put the player in the gunship.** The `ride` step takes a `CallInId`, and anything but the door gun with a
    route calls `boardCallIn`. So `overwatch` is a `ride` with `ac130`, after a `place` on the LZ.
11. **A mounted gun already takes an AI gunner** (`occupy`, `aimAt`, `trigger`, `vacate`), written for allies. Enemy gunners are a small
    job on that.
12. **Morale has a dread to spike.** `DREAD_SPIKES` in `outpost/morale.ts` lists call-ins by name. The Frame is one more row and a
    standing dread nearby.
13. **The player can be thrown.** `player.launch(velocity)` exists, and the big slam is in `player/feedback.ts`. The eject is these two.
14. **Allies stay off the jump links,** so they cannot follow the stacks' parkour route (`docs/notes/allies.md`). That is how the squad
    loses a man there, honestly, with no script.
15. **The light volume is at most 200 x 48 x 200 cells** (`LightVolume.ts`). A 320 m site gets 1.6 m cells. The pans need no detail; the
    market might show soft light. The map stage measures it.
16. **`campaign.provide` is `Object.assign`** (The Sump's fact 5, still true), so two systems cannot both provide `call`. The steps here
    are typed steps, not `call`, or they wait for The Sump's registry.

## 7. Rules for every stage

The Sump plan's section 3 holds, with these changes.

- One agent per stage, its own files, shared files edited by exact replacement, commits by path, never a push.
- Tests one file at a time. Browser only through `tools/shot.mjs` at `--dpr 2 --w 1440 --h 900`, one at a time on the 8 GB machine, so
  no more than three stages run at once.
- `outpost.test.ts`, `runner.test.ts`, `contracts.test.ts` and `crucible.test.ts` pass unchanged. The Outpost plays as it does, apart
  from its enemies' paint if stage 2 lands.
- Budget: 60 fps, under 450 draws, under 1.4M triangles. The Frame and Old Mother each under 30k triangles.
- No new voice, no service calls. New lines are rows with stable ids.
- Every stage ends with a URL the owner can play, and says what it could not verify. The owner judges by playing.

## 8. Build stages

| # | Stage | What the owner gets | Size | Depends on | Model, effort | Tokens |
|---|---|---|---|---|---|---|
| 1 | The Bureau's look | Bailiffs on their own two bodies in black, grey and red; the player's body and arms the same; an identification sheet | M | none | Opus, high | 0.4 to 0.7M |
| 2 | The ragtag militia | The seven human types re-baked in colour, no red on them, helmets repainted | M to L | none | Opus, high | 0.6 to 1.0M |
| 3 | **The Frame on the range** | Walk, look, jets, stomp, charge, backhand, three guns, the cockpit and HUD, on a stand-in body of boxes | L | none | Opus, xhigh | 1.2 to 1.8M |
| 4 | The Frame's body | The baked walker, its animator, kneel and stand, boarding, the collapse, the eject | L | 3's interface; can start beside it | Opus, high | 0.8 to 1.2M |
| 5 | What it breaks, what breaks it | `crush`, stalls, thrown wrecks, crushed men, parts and weak points, the top-attack lock and smoke, dread, sappers | M to L | 3 | Opus, high | 0.6 to 1.0M |
| 6 | The mission's plumbing | Sixteen empty beats that run, the contract row (locked), the dev panel's Mission section, steps for the Frame, the roster and holding call-ins | M | none | Opus, high | 0.4 to 0.6M |
| 7 | Holdfast | The map, its parkour lessons measured as `parkour.ts` does, mech widths proved | L | none | Opus, high | 1.0 to 1.5M |
| 8 | Old Mother | The boss, all three phases, on the range then the pans | L | 3, 5, 7 | Opus, xhigh | 1.0 to 1.5M |
| 9 | Beats 1 to 6 | Briefing to courier, with enemy gunners on the wall guns | M to L | 1, 6, 7 | Opus, high | 0.6 to 1.0M |
| 10 | Beats 7 to 10 | Stacks to mount: the hard stretch, the hold, getting in | M | 4, 9 | Opus, high | 0.5 to 0.8M |
| 11 | Beats 11 to 16, and the whole | Foreclosure to ending, the flak tower, the menu entry, `docs/campaign/FORECLOSURE.md`, the voice script, a pacing pass | L | 5, 8, 10; 2 before it is called done | Opus, high | 0.8 to 1.2M |

**In parallel.** First wave: 3, 6 and 7 (three at once, the machine's limit). As one finishes: 1 and 2, then 4 beside the end of 3.
Second wave: 5 and 9. Third: 8 and 10. Last: 11.

**Stage 3 first, and alone if the owner prefers.** It is the Frame as a toy on `/?map=range&frame=1`, about 1.2 to 1.8M tokens, and it
answers the only question that matters before anything else: is it fun to drive. The owner can play it and stop there, or carry on.

**Fable.** No stage needs it. If one did, it would be stage 3, because the feel is the whole mission, but the owner's hands are the judge
of feel, not the model. Opus at xhigh with a play loop is the default.

**Total:** about 8 to 12 million tokens. That is 3 to 6 times the air support update (2 to 2.5M) and 5 to 12 times the parkour update
(1 to 1.7M). The Frame alone (stages 3 to 5) is about 2.6 to 4M, close to the air support update again, and the rest is a mission the
size of the Outpost.

### Stage notes

- **1. The Bureau's look.** `tools/bake/archetypes/bailiffs.ts`, two rows in `archetypes.ts` with `onRequest`, `STYLES` lines.
  `allies/data.ts` maps types to the new bodies, `allies/props.ts` fits the gun per type and takes the new colours. The contractor
  re-baked, the sleeve finishes. Loaded by pages with allies (the fort, `&allies=`, this mission). Targets: each body under 2.5 MB; the
  sheet (a Bailiff beside each human enemy type at 10, 25 and 50 m) shows them apart by value at 25 m; Outpost Defense's garrison
  wears them. Try: `/?map=range&contract=outpost&allies=6&foes=5`.
- **2. The ragtag militia.** `archetypes/soldiers.ts` and the helmet props. Targets: the same sheet, every type still named right by eye
  from its silhouette and paint; the Outpost's `mission-live.mjs` steps unchanged. Try: the models sandbox, then `/?contract=campaign`.
- **3. The Frame on the range.** `src/frame/`: `controller.ts` (the walker), `seat.ts` (a `GunnerSeat` on a moving mount),
  `weapons.ts`, `hud` tone in `vehicles/hud.ts`, `cockpit.ts`. `player.carry`. Targets: 60 fps on the range with 18 enemies, no fall
  through any floor in 300 s of random driving, a jet onto a 2.6 m container 10 of 10, a stomp from 4 m knocks everyone in 10 m down,
  `?frameturn=free` works. Try: `/?map=range&frame=1`.
- **4. The Frame's body.** `tools/bake/archetypes/frame.ts`, a `walker` rig in `rig.ts`, `WalkerAnimator`. Targets: under 30k
  triangles and 3 MB, feet planted with no visible slide at 7 m/s, the kneel and the collapse, a sheet from outside at four angles.
- **5. What it breaks.** Touches `world/structures.ts` (stall), `weapons/Combat.ts` (`crush`), `enemies/vehicles/wreck.ts` (the throw),
  `progression/callins/antiAir.ts` (a ground target), `outpost/morale.ts` (one row). Targets: a charge breaches a wall in two, a stomp
  crushes a technical, a lock is broken by smoke 10 of 10, the Frame dies to 15 front rockets and 6 rear.
- **6. Plumbing.** `campaign/missions/foreclosure.ts`, `.lines.ts`, `.test.ts`, `types.ts` steps (`frame`, `roster`, `callins`), the lab
  panel's Mission section. Targets: no dangling names, startable from any beat, finishable after a death in each.
- **7. Holdfast.** `src/world/map/holdfast/`, as the Outpost's. Targets: the Sump's map targets scaled to the site; the stacks' parkour
  route crossed by bots and not crossable by walking; every Frame route clear at 3.6 m wide by a swept box.
- **8. Old Mother.** `src/enemies/vehicles/crawler.ts` and its rows. Targets: a bot in the Frame with the pod wins phases 1 and 2 in
  2:30 to 3:30; every attack warns for 1 s or more; the deck is a floor once stopped, with no fall-through in 100 slams.
- **9 to 11.** The beats, as the Outpost's were built: rows, places, lines, a bot that plays from any beat. 11 adds the menu tab (locked
  until the Outpost is beaten, open on the dev server), the ending, the doc and a test that the doc says what the game says.

## 9. Open questions for the owner

Each has the default the build would use, so nothing waits.

1. **Before The Sump?** Default: yes. This is mission 2, The Sump is mission 3, and its Bailiffs wear this mission's look.
2. **How the Frame turns.** Default: the view is free within 80 degrees of the legs, then the whole Frame turns at 140 degrees a second.
   `?frameturn=free` plays it with no limit, so you can feel both.
3. **Getting out at will?** Default: no. The boss takes it. The other answer is E to get out and no way back in, as the aircraft do.
4. **How much of the mission in the Frame?** Default: about 8 of 29 minutes, from 60% of the way in.
5. **Dying in the Frame.** Default: the Frame's death is yours, and the checkpoint gives a fresh one with a fee. The other answer is that
   it ejects you and the beat goes on harder, on foot.
6. **The ragtag look everywhere, or the campaign only?** Default: everywhere, one look per type. Campaign-only doubles the bodies and the
   memory on every page that loads them.
7. **The player's HUD orange.** Default: kept. Only the bodies change.
8. **Red on our side, red crosshair over theirs.** Default: our red is small lit slits and stripes on black, the enemy loses its reds,
   the crosshair keeps red for hostile and green for friendly, and the minimap keeps the ally colour it has.
9. **Opening in the AC-130 seat.** Default: yes, two minutes over the landing. The other answer is a dropship landing and straight to
   the ground.
10. **The Harbourmaster's end.** Default: she surrenders and it is your call, through the prisoner system. Either way she goes to Tallow.
11. **Call-ins from the cockpit.** Default: no, the seat rule holds. The flak tower holds the sky shut until `flak` anyway.
12. **Sappers.** Default: in, and the first thing cut if the stage runs long.
13. **The names.** Default: Foreclosure, Holdfast, Brine, the Holdfasters, the Harbourmaster, Old Mother, Grandad, the 14th Recoveries,
    the Distraint Frame. Each is one row to change.
14. **The Frame outside the mission.** Default: the range and the lab only. A call-in or an endless mode is its own job.

## 10. Left out on purpose

- **Enemy mechs, and a mech duel.** One walker is one controller, one rig and one bake. A second doubles the risk for a fight that the
  crawler gives better.
- **Getting out and back in.** One way in, one way out.
- **The Frame as a call-in, in Endless or in Outpost Defense.**
- **A physics mech.** It is kinematic, as the vehicles are, so it can never be shoved off the map. No ragdoll for it: it collapses.
- **Riding Old Mother while it moves.** Its deck is a floor only once it has stopped.
- **Picking up men or cars with the Frame's hands.**
- **Buildings that collapse.** Stalls, shacks, walls and gates break. Containers, concrete and the tower's base do not.
- **Allies with the Frame.** The 14th hold the Slip. Friendlies at its feet would be crushed, and they cannot keep up.
- **Any recording, any generated audio, any line for a Bailiff.**
- **Real friendly fire.**
- **Changes to the Outpost's script.** Only its enemies' paint, if question 6 stays at its default.
- **Saving mid-mission, new music, and anything multiplayer.**
