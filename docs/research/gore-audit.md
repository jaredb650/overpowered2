# Gore and ragdolls in OVERPOWERED 2: what exists today (audit)

> Kept from the gore and ragdoll research round. The proposals built from it, with each idea checked against the code, are in [docs/proposals/gore-ragdoll-proposals.md](../proposals/gore-ragdoll-proposals.md).

Read-only audit, 2026-11-18, of `dev` at `2eb1896`. Project root: `overpowered-2/`. Paths below are relative to it.

The main reference is `docs/notes/gore.md` (807 lines, 110 KB). It is very detailed and has measured numbers. This audit checks
it against the code, adds what it leaves out, and ranks the weak spots. Gore code is about 15,000 lines in `src/gore/` (plus
`src/enemies/damage.ts`, `src/enemies/blast.ts`, `src/characters/anatomy/`, `src/fx/`). There are 22 test files and a sandbox
(`/?sandbox=gore&scenario=...`).

**Owner's standing instruction (docs/NEXT.md:170):** "Do not change how ragdolls or gore behave until the owner asks." The
owner has now asked, but any proposal should still keep the shipped defaults unless the owner picks a change. Owner's earlier
playtest notes (docs/NEXT.md:5-29): likes the muscle ragdolls ("look really good") and the blood decals ("really awesome").
Wants GTA IV / Red Dead / Killing Floor weight. Listed: "hard transitions between animation and ragdoll are still visible",
"half ragdoll, half animated", and headshots dropping "like a sack of potatoes". Gore by weapon (the SMG wounding instead of
severing, head variants) and executions were put off (docs/NEXT.md:170).

---

## 1. Gore: the wound and hit model

### 1.1 Hit regions and limb pools
- **11 regions** (`GoreRegion`): head, chest, abdomen (the waist), armL/R (upper), forearmL/R, legL/R (thigh), shinL/R
  (`src/enemies/damage.ts:156-160` `REGION_BONE`). Co-op sends them as an **11-bit sever mask**.
- Each region except the head has a **limb pool** (`e.limbHp`). A hit wears it by
  `amount × severMult × SEVER_FACTOR[type] × rules.limbWear` (`damage.ts:552-557`). `SEVER_FACTOR` (`damage.ts:142`):
  bullet 1, pellet 1.2, explosive 0.7, melee 0.8, slash 2.4, fire/shock/true 0. When the pool hits 0 the limb comes off,
  dead or alive (`damage.ts:570` `sever`).
- `severMult` comes per weapon (`src/weapons/data.ts:82-84`, `canSever`). The **Always Sever** perk sets it to 1000
  (`Weapons.ts:1577`). A point-blank shotgun also multiplies it by `pointBlankSever` (`Weapons.ts:1634`).
- Corpses: limb health 60, waist 420 (`GoreTuning.corpseLimbHealth`, `corpseTrunkHealth`, `src/gore/index.ts:171-174`).
  A loose limb bursts into chunks after 90 (`limbBurstHealth`).
- `updateMaim` (`damage.ts:~588`) turns lost or broken limbs into AI state: legs 0 means crawl. A broken leg never counts as
  0 legs.
- Campaign/outpost soldiers also have **wound zones** (thigh, inner thigh, hand, arm, shoulder, lung, heart, gut, carotid,
  spine, pelvis, head) with bleeding, limping, paralysis and "mortal" (dies on his feet a few seconds later)
  (`src/enemies/wounds/rules.ts`, `zones.ts`, `injuries.ts`). In the Crucible only the limb pools apply.

### 1.2 Wounds drawn on the body (shader, not geometry)
- `WoundPlanner` in `src/gore/wounds.ts` decides each hit's mark. Per-weapon "bite" table `BITES` (`wounds.ts:42-58`):

| Round | Entry | Exit (trunk) | Exit (limb) | Depth | Breaks |
|---|---|---|---|---|---|
| SMALL (SMG, Rivet) | 1.25 cm | none, stays in the trunk | 1.8 cm | 5 cm | 0.35 |
| REVOLVER (Judge, Harrow) | 1.45 cm | 5.5 cm | 5 cm | 9 cm | 1.6 |
| STAKE | 2.2 cm | 4 cm | 4 cm | 10 cm | 1 |
| LANCE (Lance, Sabot) | 3 cm | 7 cm | 6 cm | 10 cm | 2 |
| CANNON (autocannon) | 4.5 cm | 11.5 cm | 9 cm | 13 cm | 3 |
| Trommel (`buzzsaw`) | 3 cm | 8.5 cm | 7 cm | 11 cm | 2 |
| Piledriver | 1.8 cm | 7.5 cm | 6.5 cm | 9 cm | 2.2 |
| Ultramag | 1.6 cm | 6.8 cm | 6 cm | 9 cm | 2 |

  A weapon id with no row bites like the SMG.
- Shotgun pellets: 4.7 cm crater close in, down to 1.15 cm by 10 m. Within 11 cm of each other at point blank they merge into
  one crater (`wounds.ts:174-177`). The size is measured from **`ctx.player.eye`** (see co-op).
- Explosive: opens the trunk on the blast side, up to 18.5 cm across and 15 cm deep, burn ring, 3 to 9 shrapnel holes.
  Under 16% of health it only burns and peppers. Sword: a gash of 8.5 to 20 cm. Fire: burn patch. Melee: bruise.
  Machines: dents.
- **32 wound slots per body** (`src/characters/anatomy/wounds.ts:16` `MAX_WOUNDS`). The slots live in spare texels of the
  bone texture (37 bones + 32 wounds = 246 of 256 texels, `docs/notes/characters.md:165-167`). Wounds merge; the oldest
  makes room.
- **Interior anatomy** (`src/characters/anatomy/build.ts`, `interior.ts`): an inner flesh body, rib cage, spine, pelvis,
  skull, long bones, lungs, heart, liver, stomach, bowel. About 9k triangles per archetype, shared. It is drawn after the
  skin and shows only through a wound, so a bullet shows flesh and a cannon shows ribs and lungs.
- **Fractures** (`wounds.ts:242-246`): each limb hit adds `damage × breaks` to the joint's stress, and past `breakAt` (60 ×
  size²) the joint breaks. One Judge round breaks a forearm, three close pellets, about seven SMG rounds. Forearm/shin hits
  snap the elbow/knee the wrong way and a bone end pokes out of a hole. The ragdoll joint opens up (`RagTuning.brokenHinge`
  1.5, `brokenCone` π).
- **Gore setting** (`WoundTuning.level`, from `ui/settings.ts` `applyGore`): Low paints only, nothing opens or breaks. Full as
  tuned. Excessive: 25% wider and limbs go 1.5 times sooner.

### 1.3 Severity, and how a death is chosen
Severity for a wound is the share of max health the hit took (`damage.ts:456`; blasts with the `flesh` outcome send 1).
A corpse counts as 100 health.

The kill flow is one function, `EnemyDamage.kill` (`damage.ts:797`). In order:
1. Boss: its own death. Drone: crash.
2. `vaporize` (Lance beam/giant ball, energy blade without a plane): `gore.vaporize`.
3. Frozen (shatter), or blown up (tank, blast outcome `gib`, or a direct explosive hit with a bone): **gib**.
4. A slice plane (katana, energy blade): **slice**.
5. A club to the head: keeps the head, ragdoll.
6. Headshot by a round: `headOutcome` (`damage.ts:177`): under 40 damage a **hole**; 40+ a **partial head** on the Trooper,
   Gunner, Husk and Brute and a **burst** on the rest; autocannon, Sabot, Judge within 8 m, or 4 pellets of one blast on one
   head always **burst**. A bullet never takes a head off whole.
7. Else: big rounds (`BLOWOUT_ROUNDS` = Sabot, Awl, Ultramag, Piledriver) in the chest/belly, or a shotgun within 3 m, **blow
   out** the trunk's far side (`src/gore/torso.ts:22`, `:99`). A point-blank pellet kill in the trunk (force ≥ 100) **tears
   the waist** 35% of the time (`src/enemies/blast.ts:84-85`, `:166`). Then **collapse** (dies on its feet over 0.85 to 1.4 s,
   `damage.ts:107-110`) for bullets/fire/shock of force ≤ 30 on a body with both legs, standing, not airborne; otherwise a
   plain **ragdoll**.

### 1.4 Explosions (`src/enemies/blast.ts`)
Rings by share of radius (`BLAST.rings`, `blast.ts:70-73`): rocket fireball 0.25 and maim ring to 0.65; grenade 0.22/0.62;
Hellfire/shell 0.3/0.7; nuke 1/1. Inside the fireball and lethal: **gib**. In the maim ring, a weighted roll among
`waist, head, limbs (3), armLeg, arm, burn (5 s fire), flesh (opened trunk)`. In the outer ring: `limb, scorch, thrown,
dazed`. Each repeat of an outcome in one blast divides its weight by 2.6 (`repeat` 1.6), so a crowd gets a varied scene. A
blast may cut at most **12 limbs** (`BLAST.cuts`). This answers the owner's round-3 ask directly.

Gib (`gore.gib`, `src/gore/index.ts:1437`): limbs launch at `force / 30` m/s, clamped 6 to 15 (`index.ts:164-166`). The trunk
uses a **pre-cut kit** (`torso.ts`, `Gore.warm` at load, `index.ts:1529`, about 157 ms for 13 archetypes): over 420 force
a **crack** into 3 or 5 pieces (6 over 1500), a 6-piece ribcage, 4 organs, gut strands; at or under 420 a **waist tear**.
Trunk pieces fly at most 7 m/s (`pieceSpeed`). Past 3 gibs in one frame (`fullPerFrame`) a gib is the small version.

### 1.5 Per weapon (what actually differs)

| Weapon | Wound | Death it can give | Notes |
|---|---|---|---|
| SMG / Rivet | small hole, no trunk exit | collapse; severs by wear (severMult 1.4 on some rows) | owner put off "SMG wounds instead of severing" |
| Shotgun, Thresher, Deuce | merged crater per shell | blow-out ≤ 3 m, waist tear 35% at point blank, gut loop ≤ 4.5 m | one spray and one drip per shell (pellets within 50 ms merge) |
| Flechette (shotgun ammo) | 3.5× pellets at 0.25 dmg each | as above | each dart its own small drip (`src/gore/blood.ts:290-291`); `impactScale` 0.4 |
| Judge / Harrow | torn exit 5.5 cm | burst head ≤ 8 m (Judge) | breaks a forearm in one round |
| API (Harrow, Flail) | AP round | sets the man alight a share of the time (`AMMO.api`) | burn is the whole-body char shader + chest emitter |
| Raufoss (Sabot mod, Piledriver alt) | stops on first hit, bursts (r 1.3 m, 22 dmg), cone of pellets out the back | blow-out (Sabot) | behind a plate it bursts inside the man |
| Sabot, Awl, Ultramag, Piledriver | big exits | blow-out in trunk; head burst (Sabot) | |
| Autocannon | 4.5 cm crater / 11.5 cm exit | head burst | **Flak mod**: proximity air burst, cone of `pellet` shrapnel with severMult 3 (`src/weapons/flak.ts:85-88`) |
| Trommel (20 mm) | 3 cm crater, breaks a joint in one round | | burst fragments leave no mark |
| Lance | bigger hole | **vaporize**: body sags, glows, burns away in 1.1 to 1.4 s | cleave 3 kills a frame; worst frame 40 ms warm, 67 ms first (`docs/NEXT.md:233`) |
| Katana / energy blade | gash | **slice** along the blade plane (`cutMesh`, 2.9 ms + `bakePose` 1.3-2 ms) | energy blade halves burn away (`src/gore/sear.ts`) |
| Club (key 5) | bruise | ragdoll with head kept | |
| Rocket, grenade, barrel, shell | trunk opening | blast rings above | |

### 1.6 Dismemberment: how a severed part is built (`gore.sever`, `src/gore/index.ts:1043-1107`)
- No mesh cut. The body hides the limb (`Character.hideLimb`: bind inverse collapsed to `COLLAPSED`, a pre-modelled cap shown
  on the parent), and the limb is a **second pooled skinned instance** showing only that subtree (`spawnSevered`). Wounds and
  burn are copied over.
- The limb gets its own Rapier chain (`addLimb`) seeded with the body's velocity, then 45% of the hit's force
  (`limbForceShare`) at the struck point plus a spin (`kick`, floor 0.3).
- A stump starts beating (`beatPeriod` 0.62 s, 4.5 s) with a **spurt**: a glossy blood rope (`SpurtField`, 34 globs/s, max
  8 at once, 20 rays a frame staining what it hits, `src/gore/spurt.ts:14-36`).
- Waist cut on a living humanoid: the top half becomes a **Crawler** that drags itself at the player for about 7 s
  (`crawlSeconds`, `src/gore/crawl.ts`), with gut strands from both halves.
- Living bodies short of legs switch the animator to `hop`, `crawl` or `writhe` (`HumanoidAnimator.ts:134`, `:656`) and the
  outpost AI drags itself to cover at 1.15 m/s (0.6 one arm, 0.25 no arms) (`src/enemies/wounds/crawl.ts`).
- Sever reaction: `limb_sever` sound and a scream (`damage.ts:575-576`), a body jolt (`limbLossShock` 0.35).

### 1.7 Blood (`src/gore/blood.ts`, `src/fx/`)
- **In the air:** `BloodLayer` (`src/fx/layers/blood.ts`), ring of **1200 strands**, each one instance drawn as a curved
  arc that beads and tapers, **lit** (patched `MeshStandardMaterial`), so it goes dark in shadow. Landing time is computed
  at emission; the `StainQueue` (`src/fx/stains.ts`, 192 slots) puts the decal down the frame the drop arrives.
- Within 3 m of the camera a burst hits the **lens** (`src/fx/recipes/blood.ts:11-16`).
- **On surfaces:** one shared decal ring of **2048** (`src/render/Decals.ts:6`, one `InstancedMesh`) for bullet holes,
  scorches, blood, pools, smears, slashes and cracks. Wall stains of 0.16 m or more grow a **run** down the wall. Blood
  **dries** over 5 to 70 s (`Decals.ts:141`). Pools grow in 3 stacked decals per corpse.
- `BloodField` budgets (`blood.ts:14-37`): 24 rays/frame, 160 droplets, 96 queued, 24 pools, 32 bleeders, 6 sprays and 6
  drips a frame. Each hit wets the body (+0.1 and 1.1 × share), and the skin shader runs blood down from wounds.
- Flying meat drips 3 times a second for 2.5 s. Gut strands (`src/gore/rope.ts`, max 14, verlet 11 points) drag blood.

### 1.8 Reactions while alive
- **Flinch:** spring-driven in the animator (`HumanoidAnimator.flinch`, `FlinchSprings` `HumanoidAnimator.ts:46`), size
  `0.2 + 2.2 × share`, max 1.4 (`damage.ts:128`). Pure animation, no physics.
- **Shock** adds up per enemy and fades in about a second (`src/enemies/reactions.ts`): stagger, fall, thrown.
- **Physical stagger** (`standFrom`, `damage.ts:1092`): a stagger of strength ≥ 0.35 within 20 m and in view goes onto the
  muscles on its feet; it catches its balance or goes over (max 6 at once). **Physical fall** (`fallFrom`, `:1105`, max 4).
- **Knockdown and get-up** (max 12 bodies): a real ragdoll that fights its way up on its muscles, can give out when hurt,
  knocked cold by head hits, rolls when on fire.
- Hurt limbs lose strength (stage 8): a weak leg buckles, both hands go to a gut wound.
- Wound/gore audio: wound tiers, screams, death lines, limb rip, gib rain, splats, ragdoll knocks (`d56acf5`).

### 1.9 What persists, and the caps

| Thing | Cap | Lifetime | Where |
|---|---|---|---|
| Corpses (frozen + simulated) | 40 | until the cap; then the oldest **sinks** 1.2 m over 2.2 s, in view or not | `index.ts:107`, `:904-912`, `:998` |
| Simulated ragdoll chains | 14 (soft; runs over) | sim stops at 7 s (14 if pinned), freezes after 0.45 s still | `index.ts:73-84`, `:118-124` |
| Collapses / knockdowns / stumbles / standing | 4 / 12 / 4 / 6 | | `index.ts:86-102` |
| Loose limbs / simulating limbs / per archetype | 48 / 22 / 22 | | `index.ts:109-115` |
| Stumps | 32 | 4.5 s of beat | `index.ts:116`, `:130` |
| Character instances | 96 per archetype, limbs 24 per archetype | oldest taken back | `src/characters/CharacterLibrary.ts:29-30` |
| Chunks (meat, bone, organs, ribs) | 72 bodies; per kind meat 96, viscera 40, bone 48, ... | linger 14 s (organs/ribs 28 s) | `src/gore/chunks.ts:18-36` |
| Sliced halves / trunk pieces | 28 (`maxHalves`), sink only after 8 s in sight, hard cap 44 | sim 7 s | `src/gore/sliced.ts:17-44` (gore.md says 20; code says 28) |
| Gut strands | 14 | loose 30 s, hanging until the body goes | `rope.ts:14-37` |
| Spurts | 8 | | `spurt.ts:15` |
| Decals (all kinds) | 2048 ring | until overwritten; no clear on wave | `Decals.ts:6` |
| Blood strands in the air | 1200 ring | | `fx/layers/blood.ts:238` |

Corpses are never cleared on a wave; `gore.clear()` is only called from the lab and the arena sandbox. A Crucible run keeps
40 bodies and 2048 decals.

## 2. Ragdolls

### 2.1 Construction (`src/gore/rag.ts`, 982 lines)
- `Rag` is any bone chain as **Rapier rigid bodies with joints**: whole body, a severed limb, a top half. Each body's frame is
  its bone's world frame. Bones are written **rotation-only** down from the chain root, so solver stretch never reaches the
  mesh.
- **Joint limits** are cone and twist limits applied as **velocity corrections in `preStep`** (they only remove closing
  speed, so they cannot explode), fading in over 0.25 s because a running stride starts past them. Hinges (knee, elbow) keep
  Rapier's stop behind the soft limit. Asymmetric hip/shoulder reach (`swingShape()`).
- Feet rest on a **ball under the ankle** (`RagTuning.heelFeet`), so dead shins tip.
- **No self-collision within a body** (solver groups). Bodies collide with each other and with gibs/limbs
  (`BodyFilter`, `rag.ts:975-982`). They do **not** collide with the player or living enemies (`CG.Player`, `CG.Enemy`
  absent): the player and enemies walk through corpses.
- Gravity is 19 m/s², twice real. A tempo dial (`?raggrav=`, `RagTuning.gravityScale`, default 1) is built and measured
  but off.

### 2.2 Hand-off from animation
- **Velocity seeding**: the animation is stepped 1/90 s ahead and differenced (`measureAnimVelocity`), with LOD catch-up.
  Pose jump at death: 0. Nothing a hit does to the animation may land in one frame, or it reads as speed.
- **Collapse** (dying on its feet): the animator keeps running against a ghost root and joints track it on muscles while
  support fades over 0.85 to 1.4 s. That is the blend between animation and physics.
- Headshot kills go limp the same frame (`goLimp`), no twitch (`headshotTwitch` 0). The owner asked for that.

### 2.3 Muscles (`src/gore/muscles.ts`, 2051 lines; `reflex.ts`, 1059; `stand.ts`)
A powered-ragdoll layer in `preStep`: soft limits (damping leads stiffness), a microgravity rest pose (capped at 0.3 of the
limb's weight), rotational impact (`kick`), collapse tracking, twitching, tone for about 3 s after death. `Reflex` does a
living body's fall: brace with the arms, guard the face, curl, reach for the wound, fight up. `Stand` catches balance with
ankle and chest pins. About **8 µs of CPU per body per sub-step**.

### 2.4 Shot impulse
- `force` is N·s. Up to 20 N·s it stays on the struck bone; from 20 to 90 N·s up to 85% moves the whole body via `Rag.shove`
  with 0.6 of it as lift (`index.ts:150-157`). One impulse may change one body's speed by at most 6 m/s
  (`maxImpulseSpeed`). Jolts are torque across joints, sized by joint inertia, scaled by mass (`(85/mass)^0.75`), 12 pulses
  at once.
- Living → death keeps up to 0.6 m/s of stagger (`DEATH_CARRY`, `damage.ts:139`).

### 2.5 Explosions throwing bodies
`Physics.radialImpulse` → `Gore.blast` (`index.ts:2066`) wakes and throws corpses in range, including ones killed this
frame. Muscle chains are thrown along one line shared by mass, plus a limb spin scaled by mass. Measured: a rocket at 2 m
throws a corpse 5.7 m at 9.4 m/s peak; point-blank shotgun 1.8 m; nuke 5.5 m (gore.md:611). Survivors get knocked down and
get up. Call-ins (nuke front, Black Sun) push bodies directly and ignore the tempo dial.

### 2.6 Settle, sleep, lifetime
Calm under 0.35 m/s and 1.1 rad/s for 0.45 s → freeze (and the body gets its blood pool then, `index.ts:991-994`). Hard stop
at 7 s. The ragdoll **budget** (14) freezes the oldest body at rest (≥ 0.6 s dead, < 1 m/s). It never freezes a body in the
air, so a big burst runs over: 22 chains for 1.6 s in the test, 26-27 for 1.7 s on a grenade into 30 in Chrome.

### 2.7 Vehicles: `Flung`
`src/enemies/vehicles/wreck.ts:29` `Flung` is **not** a body. It is a thrown wreck part (turret, tail) moved by hand-written
gravity and spin, which gets a collider once it lands and stays as cover. Vehicle crews and riders do not go through it.

## 3. Co-op (from docs/notes/coop-audit.md A2 and docs/research/coop-netcode.md)
- **Local on each machine:** ragdolls, corpses, gibs, slices, vaporize, head bursts, blood pools and decals. Each runs its
  own `Gore` from the `kill` event (the KF2 / Source model, which is right).
- **Synced:** `hitfx` (hit events), `sever` events, `kill` with its damage, the 11-bit sever mask in the snapshot,
  `damage.torso`/`damage.spill` choices so the guest throws the same trunk pieces (`planGib` seeded from point and source).
- **Weak on the guest:** wounds replay at a fixed severity of 0.6 (`net/world.ts:317-324`); a `sever` event skips the scream,
  sound and `updateMaim`, so a legless replica does not crawl; if the snapshot beats the event the limb is cut with a dummy
  hit (1 damage, straight up) and just drops; the blast-ring outcome is dropped on the guest; living knockdowns, wounds,
  fractures, blood level and crawl state are not synced; pellet wound size and gut spill use the **guest's own** eye
  position. The guest's own hits draw no blood for a round trip. Fix plan is coop-audit E3.

## 4. Performance

Target: 8 GB M1 in the browser. Numbers below are from gore.md (shared, loaded M1, so upper bounds) unless marked.

| Cost | Number | Source |
|---|---|---|
| Physics step, 14 ragdolls + 22 limbs | median 1.5 ms, p90 1.8, max 5.1 | gore.md:586 |
| Physics step peak, `react-chaos` (24 bodies, blast every 0.45 s) | 7 to 15 ms peaks | gore.md:597-631 |
| Grenade into 30 Troopers | 26-27 chains for 1.7 s; physics + gore 5.3-5.9 ms p99 | gore.md:686-691 |
| Muscle step | 8 µs / body / sub-step | gore.md:588 |
| **Gib call** | p50 7 to 10 ms; **first gib of a run 42 to 72 ms** | gore.md:324-328 |
| `Gore.warm` (cut torso kits) | about 157 ms at load | gore.md:275 |
| **Slice** (`cutMesh` + `bakePose`) | 2.9 ms + 1.3-2 ms per body | gore.md:594-595 |
| **Lance beam** killing 20 | worst frame 40 ms warm, 67 ms first | docs/NEXT.md:233 |
| Draw calls added by gibs | +45 to +75 at peak | gore.md:328 |
| Wounded body at LOD 0 | wound material (loops 32 wounds per pixel), plus interior and backing draws, one each | characters.md:198-202 |
| My capture at the end of a grenade + pile run | 213 draw calls, 809k triangles (headless, low priority, not a benchmark) | this audit |

Things that look expensive:
1. **First gib hitch, 42 to 72 ms.** Programs or kit pieces still warming on first use. A grenade into a crowd early in a run
   is the worst case. `SliceField.warm` draws one piece; a gib's other materials (organs, ribs, rope) may not be warmed.
2. **The soft ragdoll budget.** 14 is not a ceiling; 22 to 27 chains run after big bursts. Never measured on the 8 GB M1 in a
   Crucible-sized wave (gore.md:691 says so).
3. **Slices and the Lance** are CPU mesh work on the frame of the kill. `BLAST.cuts` (12) comment says "3 to 5 ms of mesh
   cutting each", but sever does not cut meshes (it uses pooled instances), so that comment looks stale.
4. **Lit blood strands** (1200 cap, `MeshStandardMaterial`) and the wounded skin shader's 32-wound loop are fragment cost
   that scales with screen coverage at dpr 2.
5. 40 corpses × their skinned meshes (frozen, but still skinned and drawn) plus 48 limbs. Corpses switch LOD at 26 m and
   60 m (`index.ts:168-169`, `:2212`); LOD 2 draws no wounds.

## 5. What is already good (keep it)
- **The muscle layer.** Soft limits, rest pose, tone that fades, twitching, a body that fights its way up and gives out when
  hurt, braced falls, face guards, knock-outs that snap the neck. This is real Euphoria-style work and it is measured and
  tested against real Rapier (5 test files).
- **Zero pop at death** (velocity seeding, collapse on a ghost root, eased stumbles). Most browser games pop.
- **Wounds you can see into.** Slot-shaped holes with a modelled interior (ribs, lungs, organs), exit wounds sized per round,
  merged shotgun craters, fractures with bone ends. Few games of any size do this.
- **Blast rings with a repeat penalty.** A grenade into a crowd gives a mix of gibs, waist cuts, lost limbs, burning,
  thrown and dazed. That is what the owner asked for.
- **Torso kit.** Pre-cut trunks, ribcage, organs, guts that hang and drag, arterial spurts that stain walls, partial heads
  baked from each archetype's own head.
- **Blood that stays.** Lit strands, decals placed where the drop actually lands, wall runs, drying, pools, wet bodies,
  lens splatter. The owner called the decals "really awesome".
- **Budgets everywhere**, oldest-out rings, nothing allocates per frame, deterministic sandbox and contact sheets.
- **Co-op shape is right** (local gore from a hit record); it just needs the guest to use it fully.

## 6. Weakest points, ranked

Ranked by how much they would show to a player, then by how cheap they are to fix.

1. **A cut body does not stay a body.** Sliced halves (katana, energy blade) and trunk pieces are **rigid convex hulls**
   (`src/gore/sliced.ts`), not ragdolls. In my capture a Trooper cut at the waist left **its legs standing upright 2 s
   later** (`tools/out/gore-audit/slice-3.png`). Halves take hits on a bounding box, cannot be cut again, and drop the held
   gun (`bakePose` is body only; gore.md:713-715). A waist cut on a corpse gives an inert top half; only a living cut crawls.
   Top gore games (MGR, DI2, Dead Space) keep cut parts limp.
2. **The living react on springs, not physics.** A standing enemy hit in the arm or shoulder gets an animated flinch
   (`HumanoidAnimator.flinch`); the struck limb does not swing physically. Physics only arrives with a stagger of strength
   ≥ 0.35, a fall or a knockdown, in view within 20 m, capped at 6/4/12 bodies. This is the owner's own "half ragdoll, half
   animated" ask, and the bridge from Euphoria-style deaths to Euphoria-style hits is not built. Small arms on a big enemy look
   the same as a light jolt.
3. **Dismemberment is joint-only and one level deep.** 11 regions, cut at the joints. No hands, feet, jaw, or mid-bone cuts
   from bullets; a severed limb cannot lose its forearm later (`SeveredLimb` has no `spawnSevered`); loose limbs burst into
   generic chunks after 90 damage. Soldier of Fortune 2 had 26 zones; Dead Island 2's FLESH strips muscle to bone
   progressively. Our wounds stop at holes and craters; there is no limb that gets shredded to bone and then breaks off at the
   shredded point.
4. **Corpses and the player do not touch.** Ragdolls and limbs collide only with the world and each other (`rag.ts:975-982`).
   The player and enemies walk through bodies; you cannot kick, shove or step on a corpse; knocked-down living bodies are
   walked through too (gore.md:728). In KF2, F.E.A.R. and Ready or Not, bodies react to being walked into, and that sells
   weight in the corridor fights the owner cares about.
5. **First-gib and first-slice hitches.** 42 to 72 ms on the first gib of a run, 67 ms for the first Lance mass kill, 4 to
   5 ms per slice. The 8 GB M1 never saw a Crucible-sized wave with the soft budget running over (22 to 27 chains). This is
   the main thing that could cost frames on the target.
6. **Bodies end in a few stock poses.** Dead bodies end folded on their knees (head to foot 0.75 m on a Trooper); Brutes
   freeze with knees up; arms can rest inside the torso (no self-collision); toes dip into the floor face down (the foot's
   collider is a ball under the ankle) (gore.md:639-648, 709, 800). Over a long Crucible run with 40 corpses, the knee-fold
   repeats. Blasts also scatter bodies radially, so a "pile" rarely forms (my `pile-1.png`: eight bodies spread several metres
   apart).
7. **Co-op guests see a weaker version.** Fixed 0.6 severity, no blast-ring outcome, limbs that drop with no force when the
   snapshot wins, no crawl on legless replicas, no living knockdowns (coop-audit A2, E3). A friend on the link gets less gore
   than the host.
8. **Corpse turnover is crude.** 40 bodies, then the oldest sinks 1.2 m into the floor over 2.2 s whether it is in view or
   not (`index.ts:904-912`, `:998`). Halves already wait until they have been seen for 8 s (`minShown`); bodies do not.
   Decals are one 2048 ring shared with bullet holes, never cleared between waves, so in a long run blood overwrites bullet
   holes and vice versa with no priority.

Smaller ones:
- **Bullets never take a head off.** Partial heads exist for only 4 archetypes (Trooper, Gunner, Husk, Brute); the rest
  burst. A burst head is pieces of a sphere kit (`chunks.ts`), the same on every archetype bar scale.
- **Burning** is one char amount on the skin shader plus a chest emitter and a roll on the floor. No progressive char of a
  burning corpse, no flesh melt, no smoke from a burnt body after the fire (only the Lance vaporizes).
- **Gore by weapon** is mostly wound size. The SMG still severs by wear; the owner put off "the SMG wounding instead of
  severing". No weapon-specific death poses or deaths (e.g. a shotgun lifting a body, a sniper round spinning it).
- **No finishers or executions** (put off, docs/NEXT.md:170).
- **Get-ups and collapses assume flat ground.** On stairs a collapse hovers until support fades (gore.md:725, 790).
- **Throws from call-ins ignore the tempo dial** and hard-limit bodies (`muscles=0`) use the old blast formula.
- **The death stumble can lurch a whole body 0.3 to 0.6 m** in the first 0.2 s, about one collapse in nine (gore.md:681).
- **Blood colour reads bright and uniform** on the cool-lit floors in my captures (saturated red splats on blue-grey
  concrete, e.g. `grenade-4.png`). Drying exists (5 to 70 s), so this is mostly the first minute. By eye only.
- **gore.md is out of date in one place:** it says `SliceTuning.maxHalves` is 20; the code says 28 (`sliced.ts:22`).
- A known flaky test: `src/gore/muscles.test.ts` 'never leaves a stale speed on a sleeping body' fails about 1 run in 24
  (docs/NEXT.md:178).

## 7. Gaps against the reference games (short)

| Game | What it does that we lack |
|---|---|
| Soldier of Fortune 2 (GHOUL 2) | 26 zones incl. hands, feet, jaw, groin; per-zone death animations; layered skin textures that reveal more per hit |
| Dead Island 2 (FLESH) | Progressive tissue layers (skin, fat, muscle, bone) per limb, degloving, melting from acid/fire, limbs breaking at the shredded point |
| RE4 remake | Per-region hit stagger animations blended with physics, limbs blown off at the shredded joint, leg hits drop to a kneel you can follow up (melee prompt) |
| Killing Floor 2 (M.E.A.T.) | 19 to 22 dismemberment points per zed, persistent blood all match, corpses that can be shot apart further for a few seconds, per-client body caps (8/12/15) |
| Sniper Elite | X-ray kill cam of organs and bones (we already model the interior, so a kill-cam is cheap to stage) |
| Ready or Not | Bodies that stay all mission, physical hit reactions while alive, wounds that persist on the body, bodies that block doors and get stepped over |
| Euphoria games (GTA IV, RDR) | Physics hit reactions on the living (stagger, grab the wound, stumble into cover, fall over railings), and bodies that react to being bumped |

## 8. Screenshots (this audit)

Captured in the real game (`/?autostart=1`, core_floor view, fixed 1/60 clock), my own dev server on port 5193 with
`OP2_NO_HMR=1`, Playwright chromium via `tools/shot.mjs`, dpr 2 at 1440x900. The server was stopped afterwards. The capture script lived in a scratch folder and was not kept
(it used gore-b.mjs's harness; damage is fed through `ctx.enemies.applyDamage` and `ctx.combat.explode`, not the player's gun).

Folder: `tools/out/gore-audit/` (git-ignored, so the images are on the audit machine only)
- `shotgun-1/2/3.png`: nine pellets (20 dmg, 30 N·s) into a Trooper from about 2.4 m, at 0.1, 0.4, 1.5 s. Thrown back about
  4 m; framed too wide to judge the wound.
- `limbs-1/2.png`: a Husk losing the left arm and right leg to heavy rounds, then killed. Spurts and wall spray visible.
- `grenade-1..4.png`: a grenade into six (four Husks, two Troopers) at 0.08, 0.33, 1.0, 3.0 s. Mixed outcome: one body
  thrown at the camera, a loose limb, chunks, heavy floor blood.
- `slice-1/2/3.png`: katana plane through a Trooper's waist at 0.13, 0.67, 2.0 s. **The legs stay standing** (weak spot 1).
- `pile-1.png`: eight bodies, a rocket, then the survivors shot. They scatter rather than pile.
- `last.png`: shot.mjs's own final frame.

## 9. What I did not check
- I did not play it with a mouse or watch motion. Every visual judgement is from stills.
- No timings on the 8 GB M1 under a real Crucible wave. Performance numbers are from gore.md and NEXT.md (shared, loaded
  machine).
- I did not read `muscles.ts`, `reflex.ts`, `stand.ts`, `chunks.ts`, `torso.ts` or `cut.ts` line by line; I relied on their
  headers, tuning tables and gore.md.
- I did not verify the co-op claims in the running game; they come from coop-audit.md (written today).
- I did not capture a headshot (hole, partial, burst), a blow-out, the Lance, flak, Raufoss, burning, or a crawler.
- The shotgun capture framing was too wide to judge the shotgun's wound or blow-out.
