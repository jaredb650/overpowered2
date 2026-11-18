# Gore and ragdolls: what to improve next (proposals)

2026-11-18, against `dev` at `2eb1896`. No game code was changed.

The owner asked: "Is there any way the gore system or ragdolls can be improved even more? Do as much research as you can and
come back with inspiration and proposals."

Sources, kept in the repo:
- [docs/research/gore-audit.md](../research/gore-audit.md): our code today, its numbers and its weak spots.
- [docs/research/gore-techniques.md](../research/gore-techniques.md): how other games do wounds, blood and gore.
- [docs/research/ragdoll-techniques.md](../research/ragdoll-techniques.md): how other games do ragdolls and hit reactions.
  Its author did not read our code, so this doc checks every idea in it against the code.
- The long reference is still [docs/notes/gore.md](../notes/gore.md).

Effort is in agent-days. Frame costs marked "est." are my estimates for the 8 GB M1. The others are measured numbers from
gore.md or the audit.

The owner's standing rule still applies: "Do not change how ragdolls or gore behave until the owner asks" (docs/NEXT.md). The
owner has now asked, but anything that changes a shipped default should land behind a URL switch so it can be compared, the
way `?stand=0` and `?strength=0` were.

---

## 1. Where we stand

What is already strong, and rare in any game:
- **Muscle-driven ragdolls.** Bodies die on their feet and fight to get up. They brace, guard their face, reach for a wound,
  give out when hurt, and roll when on fire (`src/gore/muscles.ts`, `reflex.ts`, `stand.ts`). The owner: "look really good".
- **No pop at death.** Bodies take the animation's speed when they die.
- **Wounds you can see into.** 32 wound slots per body, exit wounds sized per round, merged shotgun craters, bones that break,
  and a modelled interior (ribs, lungs, organs) behind every hole.
- **Explosions with a mixed outcome.** Each body gets its own result: gibbed, cut at the waist, missing limbs, burning,
  thrown or dazed (`src/enemies/blast.ts`).
- **Blood that stays.** Lit blood strands in the air; decals placed where each drop lands (`src/fx/stains.ts`); runs down
  walls; drying; growing pools; drag trails; spurting stumps; lens splatter. The owner called the decals "really awesome".
- **Stake pins.** A stake drags the struck bone to the wall and nails it there (`Gore.pin`, `src/gore/index.ts:1987`).

Where it is weak, from the audit, most visible first:

| # | Weak spot | What the player sees |
|---|---|---|
| W1 | Sword halves stand | A katana cut through the waist leaves the legs standing upright 2 s later (`tools/out/gore-audit/slice-3.png`). The halves are rigid hulls, not ragdolls, and the held gun disappears. |
| W2 | No physics flinch | A living enemy hit in the arm plays an animated spring flinch. Physics only takes over on a big stagger, a fall or a knockdown. |
| W3 | Joints only once | A limb that has been shot off cannot lose its forearm later. No hands, feet or jaw. |
| W4 | Walking through corpses | The player and enemies pass through bodies. You can't kick or shove a corpse. |
| W5 | First-use hitches | The first gib of a run takes 42 to 72 ms. The first Lance mass kill takes 67 ms. Each slice takes 4 to 5 ms. The ragdoll budget (14) runs over to 22 to 27 chains after big blasts, and that has never been timed on the 8 GB M1. |
| W6 | Repetitive poses, no piles | Dead bodies tend to end folded on their knees. Arms can rest inside the torso. Blasts scatter bodies, so they rarely pile up. |
| W7 | Co-op guest gore | The guest sees weaker gore: fixed wound size, no blast outcome, and limbs that drop with no force. |
| W8 | Corpses sink in view; decals never cleared | Past 40 corpses the oldest sinks into the floor even while you are looking at it. Blood and bullet holes share one 2048-decal ring, so each overwrites the other, and nothing is ever cleared. |

**W7 is already planned** as co-op batch 1, fix E3 in [docs/notes/coop-audit.md](../notes/coop-audit.md) ("client-side gore
on guests"). It is not repeated here. Everything below runs locally on each machine, so it works in co-op as soon as E3 lands.

**Slow-mo is still parked per the owner.** Nothing below needs it.

---

## 2. Inspiration: the best things other games do

| Game | What it does | Source |
|---|---|---|
| Left 4 Dead 2 | Cuts wound holes into the body in the shader and fills them with shared wound meshes: 15 vertex and 7 pixel instructions. Shadows must get the same cut. We already do this class of wound. | [Vlachos, GDC 2010](https://cdn.fastly.steamstatic.com/apps/valve/2010/gdc2010_vlachos_l4d2wounds.pdf) |
| Killing Floor 2 | Blood stays on the map all match. Corpses can be shot apart further ("Zed juggling"). Zed Time drains every colour except red. | [GamesBeat](https://gamesbeat.com/developers-killing-floor-2-will-have-the-most-dynamic-video-game-gore-system-in-history-will-hit-early-access-with-gallery/) |
| Dead Island 2 (FLESH) | Damage goes through skin, fat, muscle and bone. Cuts are always complete, and bones are pre-split pieces. Bone snaps were recorded with frozen celery. | [Kotaku AMA](https://kotaku.com/ama-reddit-dead-island-2-weapons-flesh-system-ps5-xbox-1850415887), [Cultured Vultures](https://culturedvultures.com/dambuster-studios-talk-dead-island-2-interview/) |
| Metal Gear Rising | Spreads the cutting work over the frames of the swing, so the hit frame never pays for it all. The cut face is chosen by body region and cut angle. | [PlatinumGames blog](https://platinumgames.com/official-blog/article/4732) |
| Diablo 3 | Mass and joint rules that stop floppy ragdolls; gibbing by turning off chosen joints; partial ragdolls on fast movers; corpse dragging by "partial teleport". | [Catto, GDC 2012](https://box2d.org/files/ErinCatto_Ragdolls_GDC2012.pdf) |
| GTA IV/V, RDR2 (Euphoria) | Each bullet makes the body go loose, then stiffness ramps back over about 0.4 s. A hand reaches for the wound after 0.2 s. The stagger loses 30% stability per step until the body falls. | [GTA V NaturalMotion API docs](https://nitanmarcel.github.io/shvdn-docs.github.io/class_g_t_a_1_1_natural_motion_1_1_shot_helper.html) |
| Unreal (hit reactions) | The hit limb alone goes physical: its blend weight goes up quickly and then back down. This is the classic partial-ragdoll flinch. | [Epic docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/physics-driven-animation-in-unreal-engine) |
| Jedi: Fallen Order | A dying body follows its death clip on a hip constraint. If the hip can't reach its target (it hit a wall), it drops to a free ragdoll, so bodies slump against walls instead of clipping through them. | [Game Developer write-up](https://gamedeveloper.com/programming/leveraging-physical-animation-to-sell-force-powers-in-i-jedi-fallen-order-i-) |
| The Last of Us Part II | "Weapon feel is almost entirely hit reactions." A leg shot gives an instant stun, which sets up a follow-up shot. The thigh is split into two hit zones to favour the player. | [Mattson, GDC 2024 notes](https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/Mattson_Derek_ASecondShot_Notes.pdf) |
| Shadow Warrior (2013) | Wound decals on enemies that move with the mesh. On dismemberment they split the existing decals instead of rebuilding them, after rebuilding gave 50 jobs and a blink for 5 kills at once. | [ZTG 2014 slides](https://www.slideshare.net/slideshow/the-technology-behind-shadow-warrior-ztg-2014/40789491) |

---

## 3. What the web research suggested that we already have

Checked in the code, not taken from the docs.

| Web idea | Already have | The gap, if any |
|---|---|---|
| Red-only "Zed Time" grade (gore #1) | The colour-grade pass already has `isolate` and `keepHue`, and the Berserk perk drains everything but red (`src/render/post/grades.ts`). | Only perks use it. A short pulse on a big kill moment would be new (Q5, a taste call). |
| Hit-stop (gore #2) | `Time.hitStop` (`src/core/time.ts:36`). Gore uses it for headshots only (25 ms at 3% speed, `src/gore/index.ts:1311`). Melee swings have their own hit and kill stops (`src/weapons/data.ts:951`). | It is not used on severs, sword cuts or gibs (Q4, a taste call). |
| Layered gore audio (gore #2) | Wound tiers, screams, limb rips, gib rain, splats, ragdoll knocks (`d56acf5`, [docs/proposals/gore-sounds.md](gore-sounds.md)). | None worth a proposal. |
| Exit wounds and wall spray behind (gore #3) | Exit sizes per round (`BITES`, `src/gore/wounds.ts:42`), and a cone of rays onto the wall behind a kill (`src/gore/blood.ts:190`). | None. |
| Bind-pose wound masks, skinned splat decals (gore #4, #9) | 32 wound slots per body in the bone texture, merged, shaped, drying, drawn in the skin shader (`src/characters/anatomy/wounds.ts`). | None. Ours does more than either recipe. |
| L4D2 holes and wound inserts (gore #8) | The interior anatomy (ribs, spine, organs) shows through every wound, and big rounds blow out the far side (`src/characters/anatomy/`, `src/gore/torso.ts`). | None. |
| Weapon gore table (gore #5) | `BITES`, `SEVER_FACTOR`, per-weapon `severMult`, `headOutcome`, `BLOWOUT_ROUNDS`. | The owner put off "gore by weapon" (the SMG wounding instead of severing, head variants). |
| Growing pools and crawl trails (gore #6) | Pools grow in 3 stacked decals per corpse. Wounded men leave drips, pools and drag smears (`src/enemies/wounds/trail.ts`). A shot corpse smears. | None. |
| Burn and char (gore #7) | A whole-body char shader, the Lance vaporize, and the energy blade's burning halves (`src/gore/sear.ts`). | A burning corpse does not char further or smoke afterwards (M8). |
| Armour shatter (gore #10) | `PlateDebris` (`src/enemies/armor.ts:180`). Helmets break off in pieces. | None. |
| Katana caps (gore #11) | `cut.ts` closes every cut with a skin rim, muscle, and a bone disc wherever a bone crosses. The cut follows the blade's plane. | The work all lands on the kill frame (M7), and the halves are rigid (W1). |
| `DECAL_GLSL` and a stain queue (gore doc's guess) | Both exist. `DECAL_GLSL` (`src/render/materials/decalAtlas.glsl.ts`) is the generated 4×4 decal atlas: blood with a real meniscus, holes and scorches. It is **not** a clustered decal list; decals are one `InstancedMesh` ring of 2048 (`src/render/Decals.ts`). `StainQueue` (`src/fx/stains.ts`, 192 slots) puts a stain down on the frame its drop lands. | Decal priority and clearing (Q3). |
| Arterial spray (gore extra) | Stumps beat on a heartbeat and spurt a glossy rope that stains what it hits (`src/gore/spurt.ts`). | None. |
| Shaped hit impulses (ragdoll #1) | A hit up to 20 N·s stays on the bone; from 20 to 90 N·s up to 85% moves the whole body, with lift. Each impulse is capped at 6 m/s per body. A shove stops adding speed past 5 m/s, so six pellets don't add up to a rocket (`src/gore/rag.ts:118`, `:122`). | The 0.1 s spread and the pelvis counter-impulse are not worth it (see Skip). |
| Anti-spaghetti setup (ragdoll #2) | Knees and elbows are one-sided Rapier hinges. Shoulders, hips and neck get soft cone and twist limits with asymmetric reach (`swingShape`, `rag.ts:140`). The feet rest on a heel ball. Mass is shared by volume. | Arms can still sink into their own torso (Q6). |
| Momentum-correct handoff (ragdoll #3) | `measureAnimVelocity`; the pose jump at death is 0. | None. |
| Wall pinning (ragdoll #5) | The stake gun: drag the bone to the anchor, then a spherical joint to the world. It survives a freeze, and sliced halves can be pinned too. | Only the stake does it (M6, a taste call). |
| Spring flinch and stumble steps (ragdoll #6, #9) | `FlinchSprings` on spine, chest, head, pelvis and both arms; `REEL` quick steps; a buckling knee (`HumanoidAnimator.ts:46`). Hard staggers go onto the muscles (stage 7). | The struck limb doesn't move physically (W2: M4, B1). |
| "Dying, not limp" (ragdoll #7) | A collapse runs the animation against a ghost root on muscles while support fades over 0.85 to 1.4 s, then the body keeps about 3 s of tone. | Every body settles toward the same rest pose (W6: M5). |
| Settle, freeze, budgets (ragdoll #8) | Freeze after 0.45 s calm, a 7 s hard stop, a budget of 14 chains, collision groups, LOD at 26 and 60 m. | The budget runs over after big blasts, and that has never been timed on the M1 (Q7). |
| Knockdown and get-up (ragdoll #11) | Up to 12 bodies, on muscles, fighting their way up. | None. |
| Body-slam sounds (ragdoll extra) | Ragdoll knock sounds, and `landThud`. | None. |

---

## 4. Proposals

### Quick wins (a day or less each)

| ID | What the player sees | How, in our code | Effort | Frame cost (8 GB M1) | Risk | Fixes |
|---|---|---|---|---|---|---|
| **Q1** | No stall on the first grenade or Lance volley of a run. | First, time a cold page to find what the 42 to 72 ms actually is (shader compile, buffer upload or allocation). Then extend `Gore.warm` (`src/gore/index.ts:1529`, called from `Game.ts:96`) to play one full gib out of sight, the way `SliceField.warm` already does for slices (`sliced.ts:291`): chunks, organs, ribs, gut rope, spurt and the burn copies. | 0.5–1 | 0 in play. Load gets about 50 to 100 ms longer (est.). | Low. If the cost turns out to be allocation rather than compiling, warming helps less, which is why it is timed first. | W5 |
| **Q2** | Corpses never sink while you are looking at them. | Use the rule the halves already have (`SliceTuning.minShown`, `hardCap`): sink the oldest body that is off screen or far away, and fall back to the oldest overall only past a hard cap (say 56). `enforceBudget` / `sinkBody`, `src/gore/index.ts:904`. | 0.5 | About 0 for the check. Up to 16 more frozen skinned bodies drawn at the cap: about +16 draws (est.). | Low. | W8 |
| **Q3** | Fresh bullet holes stop vanishing under blood (and the reverse). | Split the 2048 ring in `src/render/Decals.ts` into two oldest-out rings (for example 1280 blood and pools, 768 holes, scorches and cracks) inside the same `InstancedMesh`. Optional, a taste call: fade old blood at a wave break. | 0.5 | 0 (same mesh, same draw). | Low. | W8 |
| **Q4** | Severs, sword cuts and gibs land with a tiny freeze, like headshots do now. | Call `time.hitStop` from `sever`, `slice` and `gib`: sever about 30 ms, bisect about 50 ms, a blast with 3 or more gibs about 40 ms. Never on plain body shots, and never stacked (`Time.hitStop` already takes the max). | 0.5 | 0 | Taste: too much reads as stutter in a fast FPS. Hit-stop is local time, so in co-op it must stay on the shooter's machine. | Feel ("weight") |
| **Q5** | A katana bisect or a big multi-gib blast drains the screen to red for about 0.4 s. | Ease the existing grade's `isolate` toward the Berserk red for a short pulse, only when no perk grade is up (`src/render/post/grades.ts` and whatever sets the grade). | 0.5 | 0 (the grade pass already runs). | Taste. It must not fight the Berserk and Blood Thirst grades. | Feel |
| **Q6** | Dead arms stop sinking into their own chest. | Let forearms and hands collide with the chest and pelvis of the same body only (one solver-group bit). Everything else stays non-colliding (`rag.ts`, solver groups and `BodyFilter`). gore.md says this was "left off for budget, not tried". | 0.5–1 | About 4 more contact pairs per awake body: under 0.1 ms with 14 awake (est.). | Medium. Overlapping capsules at the shoulder can jitter (Catto's warning). Ship it behind a switch, and test it against `weight.test.ts`. | W6 |
| **Q7** | Nothing, if it goes well: a measured budget instead of a guess. | Time the grenade into 30 Troopers and a Crucible-sized wave on the owner's 8 GB M1 (one browser at a time), reading Rapier's timing getters. Then A/B the SIMD build of Rapier (`@dimforge/rapier3d-simd-compat`, same API) against `rapier3d-compat` 0.21. | 1 | Might save physics time; unknown until measured. | The package swap touches all physics, so it only ships if the numbers say so. Needs WASM SIMD (current Chrome; Safari 16.4+). | W5 |

### Medium (one to three days each)

| ID | What the player sees | How, in our code | Effort | Frame cost | Risk | Fixes |
|---|---|---|---|---|---|---|
| **M1** | A sword cut near a joint (waist, neck, shoulder, hip) drops two limp bodies: the legs fold, the top half crawls if it was alive, and the gun stays in its hand. | When the slice plane passes close to a joint, send the kill through the existing sever path (hide the limb, a pooled skinned instance, its own ragdoll chain, the crawler for a living waist cut) instead of `cutMesh` and rigid hulls. Cuts away from a joint keep today's cut. `src/enemies/damage.ts` (kill step 4), `src/gore/index.ts` `slice`/`sever`, `src/gore/sliced.ts`. | 2 | Cheaper than today on those kills: no `cutMesh` (2.9 ms) and no `bakePose` (1.3–2 ms). Adds one chain (8 µs a sub-step). | Taste: the wound becomes the pre-modelled cap at the joint instead of a face at the blade's exact angle. | W1, W5 |
| **M2** | A shot-off arm can lose its forearm; a crawling top half can lose its arms. | Give loose limbs and top halves their own `spawnSevered`, using the same pooled-instance trick as the body (gore.md: "`SeveredLimb` has no `spawnSevered`"). `src/gore/index.ts` (`LooseLimb`, `sever`), `src/characters/Character.ts`. | 1.5–2 | One more pooled instance and 1 to 2 bodies per split, inside `maxLimbs` 48. | Low to medium. It must stay under `maxLimbsPerArchetype` (22) or the library takes back a limb we are still driving. | W3 |
| **M3** | Walk into a corpse and it shifts and rolls under your feet. A running enemy kicks a body aside. | Each frame, test the player's foot capsule against the ragdoll collision group. Wake the body it touches and push it with a capped speed, one way only, so a corpse never blocks or pushes the player. Do the same for the nearest 8 living enemies. Add a new nudge step in `src/gore/index.ts`, hooked from player movement in `src/player/`. | 1.5 | About 0.02 ms per mover per frame for the query (est.). Woken bodies count against the 14-chain budget. | Medium. A body that is woken and frozen over and over can leave a pool each time (gore.md had this bug with corpse shots), so reuse the `freshAt`/`pooled` handling. Local only in co-op, which is fine. | W4 |
| **M4** | Shoot an enemy's arm or head and that limb swings for real, then the animation takes it back. | For the nearest 4 to 6 enemies, put the struck arm or the neck and head on muscles for about 0.4 s, rooted on the animated shoulder or chest (kinematic), then ease back to the animation. `stand.ts` already holds a living body on muscles, so this is a smaller version of it. `src/gore/stand.ts`, `muscles.ts`, `rag.ts` (a chain from one bone), `src/enemies/damage.ts` (`react`), `HumanoidAnimator.ts`. | 3 | 3 to 4 bodies × 6 enemies at worst: about 0.3 to 0.6 ms of muscles and Rapier (est.). | Medium. The blend in and out must be eased, or it becomes the "hard transition" the owner already notices. Behind a switch. | W2 |
| **M5** | Bodies come to rest in different ways: curled round a gut wound, sprawled on the back after a chest hit, on their side after a leg hit. | During the death tone, drive the body weakly toward one of about 6 rest poses chosen by the wound, then fade over 1 to 2 s. The muscles already pull toward a rest pose (`neutralCap`); this gives it more than one target. `src/gore/muscles.ts`, `reflex.ts`. | 2–3 | About 0. The muscles already run during the tone. | High. Earlier tries at the knee fold failed (gore.md, "A dead body ends folded on its knees"), and the rest-pose pull is a shipped default the owner kept. Behind a switch for an A/B. | W6 |
| **M6** | A Sabot, Piledriver or Lance kill near a wall carries the body back and pins it there. | On a qualifying kill, cast one ray along the shot for 2.5 m; if it hits a wall, call the existing `Gore.pin`. In the hitscan kill path in `src/weapons/` and `src/gore/index.ts`. | 1 | One ray and one joint per pin. | Taste: it takes some of the stake gun's identity. | Weapon variety |
| **M7** | No hitch on a sword kill or a Lance volley. | Spread the slice over two frames: bake the pose on the kill frame and cut on the next. The halves already hang together for 0.14 s (`holdSeconds`), so the delay can't be seen. `src/gore/sliced.ts`, `index.ts` `slice`. | 1.5 | Turns a 4 to 5 ms spike into two frames of about 2.5 ms. | Low. Less needed if M1 lands, since joint cuts stop cutting. | W5 |
| **M8** | A man who burned to death keeps charring and smokes for a while after the fire is out. | While a corpse burns, raise its char amount over time, then emit smoke puffs for a few seconds after. Uses the char shader that exists. `src/gore/`, the char uniform in `src/characters/`. | 1–1.5 | A few puffs per body (pooled). | Low. | Burning (smaller) |
| **M9** | The katana blade and gloves get bloody after kills, drip, and dry. | A wet mask uniform on the viewmodel's blade and hand materials, raised by sword kills, fading with the same drying curve as decals. | 1.5–2 | One uniform. | Medium: the viewmodel close-up quality bar. Taste. | Feel |
| **M10** | Pick up a severed head or arm and throw it. It knocks a man back, splats, and makes a comic noise. | Loose limbs are already ragdoll chains, so this needs a use-key pickup, a hand pose and a throw. `src/gore/index.ts` (`LooseLimb`), `src/player/`, viewmodel. | 2–3 | About 0. | Taste (tone). Hand grips on the viewmodel. | Satire |

### Big bets (several days each)

| ID | What the player sees | How, in our code | Effort | Frame cost | Risk | Fixes |
|---|---|---|---|---|---|---|
| **B1** | Every hit on a nearby enemy is physical: it goes loose, staggers, catches itself or falls. This is the full "half ragdoll, half animated". | Extend M4 to the whole body with Euphoria-style looseness: stiffness drops to about 10% on a hit and ramps back over about 0.4 s. Build on `stand.ts`/`reflex.ts`, distance-gated to the nearest 6 to 8. | 5–8 | About 1 to 2 ms with 8 bodies on full muscles (est.). | High. This is the Euphoria step the owner dropped in round 3 and then partly asked back for (stages 6–8). Needs an A/B switch and the owner's playtest. | W2 |
| **B2** | Any sword cut, at any angle, leaves two limp halves that can be cut again. | Keep skin weights through the cut (`cut.ts:246` drops `skinIndex`/`skinWeight` today). Then each half can be a skinned mesh driven by the bones on its side, with its own ragdoll chain. | 5–7 | The same cut cost as today, plus the chains. | High. It is the hardest mesh work in the system. | W1, W3 |
| **B3** | Hands, feet and jaws come off, and limbs break above or below the joint, not only at it. | New cut points need caps per archetype (content work for 13 archetypes), new regions, and a wider sever mask (the 11-bit mask in co-op). | 6–10 | Small. | High (content and netcode). | W3 |
| **B4** | Corpses stay much longer: 100 or more on the floor instead of 40. | Once a body freezes, bake it into a cheap static mesh (`bakePose`, 1.3–2 ms, one body every few frames) and stop skinning it. Swap it back to a live ragdoll when it is shot or pushed. | 4–6 | Saves skinning on every frozen body. Memory on 8 GB has to be checked. | Medium. The swap back must not pop. | W8, W6 |
| **B5** | A rare X-ray moment: on a big-round kill at range, the skin fades away to show the bone and organs the round went through. | The interior anatomy already exists. Stage a camera and a skin fade, and use Sniper Elite-style scoring so it stays rare and skippable. Without slow-mo it would be a short picture-in-picture or a freeze-frame. | 4–6 | Only during the moment. | Taste. A fast FPS can't stop often; in co-op it is local only. | Spectacle |

**Piles (part of W6).** Bodies already collide with each other. They rarely pile up because blasts throw them apart, and the
throw is measured and the owner likes it. Q6, M3 and M5 help bodies lie on each other more naturally. Forcing piles is not
worth it.

---

## 5. Recommended first batch

Five items, about 6 to 7 agent-days. None needs a taste call first, and none changes a shipped default except behind a switch.

| # | Item | Effort | Frame cost on the M1 | Why first |
|---|---|---|---|---|
| 1 | **Q1** Time and warm the first gib | 0.5–1 | 0 in play; 50 to 100 ms more load (est.) | The worst frame in the system. |
| 2 | **Q7** Time the ragdoll budget on the M1, and A/B the SIMD Rapier | 1 | Might save time; unknown | Tells us how much room M3 and M4 have. |
| 3 | **M1** Joint-near sword cuts become ragdolls | 2 | Saves about 4 to 5 ms per such kill | The most visible weak spot (W1). |
| 4 | **Q2** Corpses sink only out of view | 0.5 | About 0 | Cheap, and removes an obvious tell (W8). |
| 5 | **M2** Loose limbs split again | 1.5–2 | Small, inside the existing caps | More gore from the system we have (W3). |

Next in line, after the owner's taste answers: Q4 (hit-stop) and Q5 (red drain), which are tiny once decided; then M3
(push corpses) and M4 (physical flinch).

---

## 6. Skip, and why

| Idea | Why skip |
|---|---|
| Real fluid blood (KF2 FleX) | No WebGL path; it needed a GTX 980 on PC. |
| Per-enemy render-target wound painting | 1.6 to 4.5 ms spikes (Looman). Our wound slots already do this with no render targets. |
| Ghoul2 splat decals, L4D2 shader holes, bind-pose masks | Already covered by the wound slots and the interior anatomy (section 3). |
| Baked map-wide floor paint | Needs unique UVs on every surface. The decal ring already gives persistence. |
| Switching to Jolt | Means replacing the whole physics layer. Our muscle layer already does what Jolt's ragdoll API offers. |
| Rapier raw per-axis spherical limits and motors | Our limits are velocity corrections in `preStep` that can't explode, plus muscles. Swapping them is risk with nothing to see. |
| Spreading the impulse over 0.1 s, and the pelvis counter-impulse | We already split bone and whole-body share by force and cap speed. A counter-impulse would undo the tuned carry-back (`bodyShare`) that stages 1 to 5 settled. |
| Blast impulse at each collider's closest point | The throw is tuned and measured (a rocket at 2 m throws a body 5.7 m), and the owner likes the explosions. Spin already comes from the mass-scaled limb spin. |
| Mass-ratio clamping and inertia boosts (Jolt, Havok) | No instability has been seen; `maxImpulseSpeed` keeps small parts on. Revisit only if a bug shows. |
| Verlet stick ragdolls for far corpses | Frozen bodies already cost no physics. |
| Machine-learning balance (Wobbledoll, DReCon, ARC Raiders) | Wrong cost class for a browser game. |
| Blood near you heals (ULTRAKILL) | A brain chip design question, not gore. Take it to progression if wanted. |
| Leg-shot stun as a new gameplay state (TLOU2) | Leg hits already reel, buckle and limp, and campaign soldiers have wound zones. A new stun would change combat balance, not gore. |

---

## 7. Questions for the owner

Taste calls first:
1. **More or less gore?** Should "Full" move toward today's "Excessive" (25% wider wounds, limbs come off 1.5 times sooner)?
2. **Zed Time colour drain (Q5)?** A 0.4 s red drain on a sword bisect or a multi-gib blast: yes or no, and on which kills?
3. **Hit-stop feel (Q4)?** Today only headshots freeze (25 ms). Add a tiny freeze on severs, sword cuts and gibs? About 30 to
   50 ms, or none?
4. **How long corpses stay?** Today 40, then the oldest sinks even in view. Keep 40 but sink only out of view (Q2)? Aim for
   100+ (B4)? Should anything (bodies, blood) be cleared at a wave break, or stay all run like Killing Floor 2?
5. **Executions?** Still put off?
6. **X-ray cam (B5)?** Wanted at all? Slow-mo is still parked, so it would be a freeze-frame or an inset.

Then:
7. **Sword cuts (M1):** limp halves with the cap at the joint, or the exact blade angle with rigid halves (today)?
8. **Wall pins (M6):** keep pinning the stake's alone, or let the heaviest rounds pin too?
9. **Throwable heads and limbs (M10):** right for the game's humour?
10. **Physical flinch (M4, then B1):** is "half ragdoll, half animated" wanted now, behind a switch for comparison?
11. **Death poses (M5):** may a switch try changing the rest pose that every body settles into (a default you kept)?

---

## 8. What was not checked

- No timings were taken for this doc. The measured numbers come from gore.md and the audit (a shared, loaded machine). The
  "est." numbers are guesses.
- I did not play the game or watch motion. The judgement on what looks weak comes from the audit's stills, which live in
  `tools/out/gore-audit/` (git-ignored, so on the audit machine only).
- I did not read `muscles.ts`, `reflex.ts` or `cut.ts` line by line; I checked tuning tables, entry points and the parts each
  proposal touches.
- `@dimforge/rapier3d-simd-compat` 0.21.0 is on npm (checked), but I did not install it or check that its API matches.
- Co-op claims come from docs/notes/coop-audit.md, not from a run.
