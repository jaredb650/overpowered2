# Damage response update ("the gore update"): rules and progress (started 2026-11-19)

The plan is `docs/proposals/damage-response-update.md` (the steps R1…, G1…, F1…, P1…, B1…, O1, W1, D1, M0, with `file:line`),
its research is `docs/research/damage-response-research.md`, and **the owner's answers in section 10a of the plan are
decisions**. Whoever resumes this work reads this file first, then the plan. Keep the status table and the log current.

## The owner's two goals, in his words

1. **Gibbing never feels like body parts disappear.** "The amount of gibs spawned by a destruction should more or less match
   in size the destroyed part, to make it truly feel like a body breaking apart, not being erased or deleted."
2. **Ragdolls feel like Red Dead:** "state of the art responsiveness gradient, no off switch feel." Every shot gets a reaction
   from the first round; animation, powered ragdoll and limp ragdoll blend by degree.

He is away and will not answer questions. **Nobody stops to ask.** Decide from his answers (plan section 10a), write the
decision in the log, and go on to the end. He judges by eye when he is back, so every lane leaves him things to look at.

## His decisions that override the plan's text (all in 10a; the short list)

- A **strong flinch on the struck limb for every round**, not only heavy guns. **A hit spoils an enemy's aim** (the host decides it in co-op).
- **Fireballs stay exactly as they are.** Gibs are **thrown with force out of the fireball**; that is how the player sees the
  break. **No floaty pieces**: normal weight, no reduced gravity.
- **Guts come free** on an obliteration or explosion: detached, thrown clear, **draped over the environment**. Today
  intestines are always attached to a bigger piece.
- **Organs burst when stepped on**, and bursting is how organs leave the world.
- **Fire eats skin down to muscle and bone.** Watching a man burn **chips morale faster**. **Zombies are not unnerved by fire
  and keep attacking** while burning.
- **Corpses:** walking through them **pushes them aside as ragdolls**; they never block or lift the player. Bodies and blood
  staying is a **setting** (all match / clear at wave break / less).
- **Limbs stay targetable exactly as now, to change what an enemy can do** (legs off: he crawls; an arm off: sidearm, flee or
  surrender). **Readable limb damage is wanted** (it should show a limb is about to break or come off) and must not change those rules.
- **More realistic decal designs**, and **BIG decals for coverage with the small ones as detail on top**.
- **Sound is not a focus**: the game has plenty of gore sounds. This update is about what is seen.
- Never touch: bullet spread rules, shotgun spread, the game facts in `CLAUDE.md`.

## Rules for every agent on this job

Read `CLAUDE.md` first. The working rules of the co-op job apply (they are in `docs/notes/coop-overhaul.md`, "Rules for every
agent on this job"), with these differences:

- **Branch:** the shared branch is **`gore-update`** (cut from the finished co-op work). Your own branch is `gore/<your-name>`
  in your worktree; land with `git rebase gore-update`, `npx tsc --noEmit`, the whole suite, then
  `git push . HEAD:refs/heads/gore-update` (fast-forward only; rebase and retry if a peer landed first). Never push to
  `origin`, never touch `dev` or `coop-overhaul`.
- **Node:** every shell needs `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null`; `npm ci` once in a new worktree.
- **The machine is shared with another person and it is daytime.** One browser run of yours at a time (`tools/shot.mjs`
  queues on machine-wide slots: never bypass it), stop your Vite when you are not using it (and restart it before a proof: a
  long-lived Vite here serves stale files), tests already run at low priority. Kill what you started when done.
- **Cheap, repeatable look-checks** (read `docs/notes/devtools.md`): `tools/sheet.mjs` lays a clip's frames on one contact
  sheet (use it for every motion you change: this is how you see a flinch, a gib or a burn frame by frame);
  `tools/diff.mjs` compares two pictures; `tools/scripts/lib/steady.mjs` freezes the clock and seeds the dice so before and
  after are the same shot; `tools/scripts/perf-trace.mjs` and `soak-memory.mjs` for cost. The gore sandbox (`/?sandbox=gore`)
  and the Test Range (`/?map=range&dev=1`) are the stages. Work from a seeded, frozen scene; judge at dpr 2, 1440x900.
- **For the owner, in `tools/out/gore-update/<your-name>/` in the MAIN checkout**
  (`/home/jared/jared/overpowered2/tools/out/gore-update/<your-name>/`): for each step, a **before** and an **after**
  contact sheet of the same seeded scene, full-size stills of the best frames, and a short `LOOK.md` listing what to look at
  and any URL switch to compare old and new in the running game. LOOK at your own sheets before you call a step done; if it
  does not read at a glance from the player's eye at fighting distance, it is not done.
- **Switches:** anything risky to the feel (the plan marks them) goes behind a URL parameter and a dev-panel row, **on by
  default** unless your own look-check says it is not ready, so the owner can compare when he is back. List every switch in
  the table below.
- **Model quality bar** (`CLAUDE.md`): any new geometry has real form, torn edges, 2 to 3 materials, never boxes. Art
  direction: saturated red blood on a cold world; peak on frame one. **Visual work is done by this model only.**
- **Cost:** pools with hard caps, no allocation in hot paths, 60 fps on a laptop with up to 48 enemies. Measure what you add
  (the plan's M0 list) and write the numbers down. A quality setting may scale counts; the default must hold frame rate.
- **Co-op must keep working.** Each screen computes its own cosmetics from the events already sent (read "Gore on each screen"
  in `docs/notes/coop.md`): do not put cosmetics on the wire; a rule that changes how an enemy FIGHTS (a hit spoiling aim, fire
  and morale) is the host's and reaches guests as the facts already do. Guests run the damage model with facts off: your
  change must run there too. Before landing run `tools/scripts/coop-gore-shots.mjs` (two or three pages) and the unit suite;
  the whole co-op sweep is `node tools/scripts/coop-all.mjs` and is run by the lead at the end.
- **Tests:** unit tests beside the code for every rule; the six gore tests whose bounds are tighter than the game's real
  spread (`docs/notes/devtools.md` has the table) are yours to widen or meet when you change what they measure.
- **Docs:** `docs/notes/gore.md`, `wounds.md`, `fx.md`, `enemies.md`, `characters.md` say what was built, with numbers.
- **Commit trailer:** `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- **Report** (final message): commits, what the player now sees for each step, measured cost, tests and proofs, the switches,
  where the owner's pictures are, what is not done, decisions you made. Plain words.

## Lanes

Each lane owns a vertical through the plan's batches and goes on to its next step without waiting. Status: `todo`, `doing`, `done` (commit).

| Lane | Ports | Steps, in order | Mainly in | Status |
|---|---|---|---|---|
| react | 5600-5609 | R1 every hit shows (strong, every round); R2 hand to the wound and a hurt posture; R4 dying carries the shots; R3b a hit spoils his aim (host decides); **R3 the struck part goes physical** (the gradient: animation, powered part, whole-body balance, limp, blended by weight; behind a switch) | `characters/animation/HumanoidAnimator.ts`, `enemies/damage.ts` (`respond`), `enemies/reactions.ts`, `gore/stand.ts`, `gore/rag.ts`, `gore/muscles.ts` | done: R1, R2, R4, R3b, R3 (all landed) |
| gibs | 5610-5619 | G1 rockets and grenades crack the trunk; G2 show the break: pieces thrown hard out of the fireball, bright wet torn faces, mid-size slabs, so the pieces add up to the body destroyed (every destruction: torso, head, limbs, whole-body gib); free guts that detach, fly and drape; O1 organs you notice (bigger, squash, roll, burst when stepped on or shot) | `gore/torso.ts`, `gore/chunks.ts`, `gore/index.ts` (gib paths), the gut rope, `weapons/Combat.ts` blast force only where G1 needs it | done: G1, G2, the volume audit, free guts, O1 |
| fire | 5620-5629 | F1 fire finishes the job (char by fire damage, the corpse burns on then smoulders, soot not a blood pool, flames on the whole body and on severed burning limbs); F3 fire meets the other systems (curled burnt corpses, dark pieces, morale chips faster, burning zombies keep attacking); F2 fire spreads from where it touched and eats the skin to muscle and bone | `enemies/EnemyManager.ts` burn, `characters/material.ts`, `fx/recipes`, `enemies/outpost/morale.ts`, `enemies/behaviours.ts` | done: F1 `c27c432`, F3 `70003f3`, F2 `be9ff70` |
| mess | 5630-5639 | M0 measure the budgets; P1 the mess stays (decal rings by kind and about four times the room, pieces that do not expire, corpses sink only out of view, resting bodies that stack and are **pushed aside as ragdolls** when walked into, the "Mess" setting); P3 many more corpses (tiers, baked far bodies that can wake) | `render/Decals.ts` (the rings and budgets), `gore/chunks.ts` lifetimes, `gore/rag.ts`, `gore/sliced.ts`, `gore/index.ts` corpse caps, settings UI | done: M0, P1, the push rule, the "Mess" setting, P3 (the far batch). Limbs were baked by "fit". Not done: the laptop has not been measured (lane "verify") |
| decals | 5640-5649 | D1 realistic decal designs and BIG decals for coverage (the sheet, the choice of shape by speed, angle, amount and weapon, wet and dry surface response); B1 more blood from one hit; B4 drips from ceilings and ledges, splashes, soaked bodies; B2 footprints and slide smears; P2 blood that never has to go (the floor texture) | `render/materials/decalAtlas.glsl.ts`, the shape choice in `render/Decals.ts` and `gore/blood.ts`, `fx/layers/blood.ts` | done: D1 (the sheet, big stains, marks), B1, B4, B2, P2 |
| wear | 5650-5659 | B3 blood on the weapon and hands; W1 wear you can see: readable limb damage (skin torn to muscle, then bone, as a region's pool is spent), without changing what shooting a limb does | `weapons/viewmodels/` materials, `characters/material.ts`, `characters/anatomy/interior.ts`, the body's data texture | done: B3 (aaaa677), W1 |
| fit | 5660-5669 | The seams between the six: fire and the others, gibs and the others, mess and the others (limbs baked, the long fight's cost), react and the others, the co-op "limb" case, one look, the notes | everything above, at the joins | done: steps 1 to 4 (`bd37370`, `9e228fa`, `50a0bdb`, `dfbdce9`; pictures and `LOOK.md` in `tools/out/gore-update/fit/`). Not done: listed in its last log entry |
| verify | (its own) | The whole update's cost on a laptop, the quality settings, the whole co-op sweep, single player, the owner's pictures | measurements and settings | (its own log) |

Shared files and contracts:
- `render/Decals.ts`: **mess** owns the rings, counts, ageing and budgets and lands the split into rings FIRST (within its first
  hour); **decals** owns the sheet (`decalAtlas.glsl.ts`), the cells table and which shape is chosen, and adds the "big" ring
  through mess's structure. `gore/blood.ts`: **decals** owns it.
- `characters/material.ts` (the skin shader): **fire** (char, burn-away) and **wear** (region wear) both edit it. Fire lands
  F1 first; wear starts with B3 (viewmodels, no overlap) and builds W1 on fire's shader, sharing one "skin gone, interior
  shows" path with F2 rather than two.
- `gore/chunks.ts`: **gibs** owns pieces' shapes, launch and organs; **mess** owns lifetimes, caps and what rests.
- `gore/rag.ts`, `gore/stand.ts`, `gore/muscles.ts`: **react** owns the living body's physics; **mess** owns the resting corpse
  (colliders, waking, pushing aside). `enemies/damage.ts`: **react** owns `respond` and reactions; others touch only their own calls.
- `gore/index.ts` and `enemies/EnemyManager.ts` are shared: small, local edits, rebase often.

## Switches (keep current)

| Switch | Default | What it compares | Lane |
|---|---|---|---|
| `?gibthrow=0`, dev panel "Gibs thrown out of the blast" | on | G2: a burst body's pieces thrown up and out of the fireball (7 to 10 m/s up, all round) against the old launch (3 to 7 m/s, down inside the fireball by 0.5 s). The ribbons, the slabs and the crack itself stay either way | gibs |
| `?flinch=0`, dev panel "Hits: every hit shows" | on | R1: the hit flinch's new shape and size (twist, dropped shoulder, struck arm 20 to 40 degrees, knee dip, a floor by weapon) against the 3 to 10 degree nod from before | react |
| `?clutch=0`, dev panel "Hits: hand to the wound" | on | R2: a hand to the wound (or arms up) on a plain flinch, and the hurt posture and limp, against none of it short of a stagger | react |
| `?carry=0`, dev panel "Hits: dying carries shots" | on | R4: eight bodies may die on their feet at once and a kill on a body already on its muscles dies on its feet from where it was, against four and a drop | react |
| `?aimspoil=0`, dev panel "Hits: spoil his aim" | on | R3b: an enemy hit in the gun arm or rocked hard fires up to 3 times as wide and up to 0.2 s late for a third of a second (the host decides), against hits that never touch an attack short of a stagger | react |
| `?sway=0`, dev panel "Hits: struck part physical" | on | R3: the struck arm, head or upper body on physics for 0.3 to 0.8 s (looser with each hit, driven back to the animation), against the flinch on its springs alone | react |
| `?vmblood=0`, lab row "Blood on the weapon" | on | Guns and gloves stay clean whatever is killed (B3) | wear |
| `?wear=0`, lab row "Wear on limbs" | on | W1: skin torn to muscle and bone as a limb's pool is spent, against bodies that show only their wounds | wear |
| `?bigblood=0`, lab row "Blood: big stains on a kill" | on | D1: the big stains a kill lays for coverage (burst, fan, wall sheet, soaked patch, drag, ring) against the small traced drops alone | decals |
| `?hitblood=0`, lab row "Blood: a mark from every round" | on | B1: every round's own fan on the floor past the body against none | decals |
| `?fire=0`, dev panel "New fire" | on | F1 and F3: off is fire as it was (a timer, one emitter on the chest, char by seconds alive only, out at death, a red pool under the body, no curl, no dark pieces). Not switched by it: the charred skin's new colours (the shader is one), and the rules of F3 (burning chips morale, the dead ignore fire) | fire |
| `?messrest=0` (dev panel: "Corpses heap") | on | Off: a body at rest keeps no capsules, so the next one falls through it and bodies lie one deep, as before | mess |
| `?messpush=0` (dev panel: "Corpses are pushed aside") | on | Off: nothing at rest is woken by the player or an enemy walking into it, or by a body landing on it: corpses are walked through untouched, as before | mess |
| `?messfar=0` (dev panel: "Far corpses baked") | on | Off: no body is baked into the far batch, and every body kept stays a character, as in P1 | mess |
| Settings, Video, "Mess" | Standard | Low / Clear at wave break / Standard / Everything: how many bodies, limbs, pieces and how much blood stay (`MESS` in `src/gore/mess.ts`) | mess |
| `?bloodmap=0`, lab row "Blood: old stains kept on floors" | on | P2: dried floor stains kept in floor tiles after their decals are overwritten, against stains that go when the ring comes round | decals |
| `?dryflesh=0`, dev panel "Flesh dries" | on | Torn faces, loose meat, and the blood and bared flesh on the dead dull over a minute and a half as the blood on the floor does, against flesh that stays as wet and bright as when it was made | fit |
| `?onestep=1`, dev panel "Physics: one step a 60 Hz frame" | **off** (the lead's call: it changes the whole game's physics stepping, and the owner said the physics as it is "seems fundamental to the current feel") | A frame up to 6% over 1/60 s is one physics step. Off: every frame a hair over 1/60 s is cut in two steps, as it always was (1.57 world steps a frame at 60 Hz, each the cost of one). **Not gore's alone: it is the whole game's physics step** | fit |

Not switches of their own, by design: loose limbs baked into their own batch go with `?messfar=0`; pieces and guts lying
on the dead go with `?messrest=0`; a burnt body's dry, charred pieces, burning halves and soot go with `?fire=0`; the
limp that starts with the look goes with `?wear=0`; the struck part's wall stop and host-eye rule go with `?sway=0`.
The shader fixes of "one look" (bared flesh lit by the light on it, burnt things dark under a hard light, floor blood
red under the weapon light) have no switch: each replaces a fault, and the before pictures are in `fit/pictures/`.

## Log

- 2026-11-19: file written; branch `gore-update` cut from the finished co-op work.
- 2026-11-19, mess, step 1: **the decal buffer is split into rings by kind** (`src/render/Decals.ts`; `docs/notes/render.md`,
  "Rings"). Four rings in one instanced mesh and one draw: `scorch` 256, `big` 256, `blood` 8,192, `mark` 1,536, drawn in that
  order. Decided: scorches got their own ring under everything (the brief had them with the holes), so the blood of a man a
  rocket killed lands on the burn, not under it; holes, cracks and cuts are on top. **For agent "decals":** add your kinds to
  `DecalKind`, `CELLS` and `RING_OF` (big stains go in ring `big`, which nothing uses yet); `decals.onRetire` is the call when
  a decal is about to be overwritten (P2's hook); `mesh.count` is no longer the number of decals (`decals.total`,
  `live(ring)`). The counts are the plan's until M0 has measured overdraw.
- 2026-11-19, react: **R1 landed.** Every hit shows from the first round (`docs/notes/enemies.md`, "How a hit shows"). Decisions: the strong end on every round as the owner answered (an SMG round turns a Trooper's chest 30 degrees and a struck arm 36); the wobble is kept out by the spring's shape (`HitSpring`: overdamped on the way back), not by keeping it small; fire and shock keep their old size (thirty bites a second); a hard trunk hit on a standing body takes one catch step. Look: `tools/out/gore-update/react/r1/` and its `LOOK.md`. The probe is `tools/scripts/hit-seq.mjs` (`docs/notes/devtools.md`).
- 2026-11-19, gibs: **G1 and G2 landed** (`docs/notes/gore.md`, "What breaks a trunk" and the four paragraphs after it).
  A rocket, grenade, barrel or shell kill now cracks the trunk: 5 or 6 pieces from the big blasts, 3 from the small ones and
  from a round that obliterates, the whole ribcage, 4 organs, 5 slabs. Decisions: the break is chosen by the damage's type and
  force alone, because those cross the wire with the kill and `blastKind` does not; one burst in five still tears at the
  waist. **G2 by the owner's rules:** nothing in `fx/recipes/explosions.ts` is touched, no piece has reduced gravity; pieces
  go up at 7 to 10 m/s and out all round, so they are over the fireball's top as it goes and in the air to about a second.
  Decided: all round and not only away from the blast (`along` 0.3), because the player fires the rocket and everything
  thrown straight away from him shrinks to a dot behind the smoke; a **ribbon of blood** behind every big piece through the
  spurts' own layer, since at 6 m a trunk piece is 30 pixels and dark and the ribbon is what the eye follows; **slabs** cut
  from each archetype's own trunk skin. **For "mess":** `ChunkTuning.capacity` is now typed without the slab kinds; a slab's
  count is `SlabTuning.perShape` (6 a shape an archetype) in `slabs.ts`, and yours to raise with the rest. Trunk pieces still
  count as halves. **For "decals":** `fx.gibTrail` (a strand) books one stain in three through `core.stains`, and a ribbon
  leaves none of its own. **For "fire":** slabs are `ChunkField` instances drawn with the archetype's skin material; tint
  them where you tint the trunk's pieces. Probes: `tools/scripts/gib-seq.mjs` (every destruction, frame by frame, with
  counts), `gib-pieces.mjs` (close-ups of the models), `gib-cost.mjs`. Look: `tools/out/gore-update/gibs/` and its `LOOK.md`.
- 2026-11-19, wear, **B3 landed** (blood on the weapon and hands; `docs/notes/viewmodels.md`, "Blood on the weapon and the
  hands"). Decisions: each gun keeps its own blood while put away and each glove has its own, so hands stay bloody across a
  weapon change; blood dries on the floor stains' curve (4 to 55 s) and wears off after 150 s more over 120 s, so a long
  match does not end with every gun permanently coated; nothing lands within 2.8 cm of a sight point; a bullet kill at 3 m
  leaves a few drops and a gib at arm's length a lot (amounts in the note). Pictures: `tools/out/gore-update/wear/b3/`.
  Not done: drips off the gun, a clean magazine on reload, a friend's kill spattering a co-op guest.
- 2026-11-19: the finished co-op (`d2e2f8a`) is on `dev` and the public site, after agent final-check's CLEAN TO MERGE. Seen twice and not run down: the end board shows guests' ping near 1 s in proofs (4 ms mid-match); probably the test pages in the background, for the owner to watch in a real game.
- 2026-11-19, wear, **W1 landed** (wear you can see; `docs/notes/characters.md`, "Wear you can see"). Each region's pool is
  written to the skin (three texels after the wounds: 249 of 256 used, 7 free before fire's two) and the skin is torn to
  muscle, then bone, as it is spent; at the joint the last of the pool takes it all the way round. Decisions: it is
  **painted on the skin, not cut out of it** (no extra draw at any level of detail, reads at 20 m, works on severed limbs
  and far bodies; the modelled interior stays for wounds); rounds tear in patches, a blade opens long cuts, a blast strips
  and scorches, fire draws nothing of its own; one hit shows at most half a pool; the trunk, which has no pool, wears by
  the health a hit on it took and stops at 0.7; a co-op guest wears its own copy from its own counts, nothing sent; the
  rules are untouched (a test runs the same rounds with it on and off).
  **For "fire" (the shared path):** the look of skin gone is `SKIN_GONE` in `characters/material.ts`, driven by two numbers,
  `sThrough` (how deep: 0 a raw edge, 0.24 muscle, 0.5 bone) and `sChar` (0 raw, 1 burnt black). For F2's burn-through,
  work your depth out from the burn and its origin and write `sThrough = max(sThrough, yours)` and `sChar` next to
  `WEAR_DRIVER`; the block is under `OP2_WEARS` (the wounded skin, and any skinned body far off). I did not touch your burn
  code; my texels are appended after the wounds as your comment asks, so `EXTRA_FIRE = 2` slots in ahead of them.
  **For "react":** a limb that looks nearly gone and how it moves use the same pools (`poolStrength` weakens a limb from
  `POOL_WEAK_FROM` of its pool; the skin starts tearing from the first round), so the look leads the limp: at 30% spent a
  leg is visibly torn and still at full strength. Not a fault, but if the limp should start with the look, lower
  `POOL_WEAK_FROM`; I did not edit your files.
  Pictures: `tools/out/gore-update/wear/w1/`. Not done: real holes onto the interior, wear from a corpse's own limb health,
  machines.
- 2026-11-19, decals: **D1 landed: the decal sheet redrawn, big stains, a mark from every round (B1), marks by surface.**
  What is built and its numbers: `docs/notes/render.md`, "The decal sheet"; `docs/notes/gore.md`, "Big stains". Decisions:
  - **Blood cells are fields, not pictures** (outline as distance to the edge, thickness, haze), and the decal shader draws
    the liquid: this is what makes a 512 px burst hold a sharp edge at 3 m, lets a pool spread from its middle, dries thin
    blood before thick, and gives the wet lip. The old sheet could not be kept beside it, so **there is no switch back to
    the old shapes**; the before pictures are from a second worktree at `66a33f1`.
  - **The sheet is 2048 x 4096 (89 MB with mipmaps, 44 before).** I did not pack two stains into one texel's channels to
    stay at 44: possible, but it would have made every cell harder to draw and check. If memory matters on a small GPU,
    that is the lever (or `sizeScale`).
  - **The sheet is baked by five shaders in the background** (one shader with everything compiled in 2.7 s and held the
    page; now 1.2 s cold off the main thread, 60 to 77 ms of drawing).
  - **A stain of 0.34 m and up is a splash** and gets a whole composition, so the big marks on a wall are bursts and fans
    with fingers, not round blobs.
  - **Big stains replace rays, not add to them:** a gib's 18 rays are 10, a blow-out's 12 are 7, a head burst's 9 are 5.
    A kill's big stains go in ring `big`; a single round's fan goes with the small stains (`minor`), or one magazine
    would empty that ring.
  - **Saturated red over physically pale:** blood's brightness levels off under a hard light (it went pink in the
    flashlight) and it keeps 40% of the sky's mirror sheen (a wet floor at a low angle went pale).
  - **A bug of the old sheet is gone with it:** stripes through the first cell of each row (the first blot, the first
    pool, the first cut): the research's "stripes where pools stack".
  - **For agent "fire":** `decals.add('soot', point, normal, size, rotation)` is the soot shape (two cells: a blotch, and
    one drawn out along +X), in ring `scorch`, under the blood. Scorches now have three variants (plain, a burnt-out pale
    middle, thrown one way) with soot streaks. **For anyone laying bullet holes:** `bulletMetal` and `bulletGlass` are new
    kinds; `fx.impact` already picks by surface.
  - **For agent "mess":** `onRetire`'s `data` layout changed (cell + how full, time, kind + mirror bits + seed, lip
    width: the top of `render/decalShader.glsl.ts`). `decals.big(..., minor)` chooses the ring.
  - Co-op: `coop-gore-shots.mjs` ran, 3 pages: six cases passed, `limb` failed once on the watcher's count of legs left
    and passed when run alone (it counts wounds, puffs and sprays, none of which this changes): nothing to update in its
    expectations. Tests: `decalSheet.test.ts`, `blood.test.ts` "big stains"; the whole suite passes.
  - Pictures: `tools/out/gore-update/decals/` and its `LOOK.md` (the sheet cell by cell, seven seeded scenes before and
    after). Weakest shape: the drags. Not done yet: B4, B2, P2.
- 2026-11-19, gibs: **the volume audit, free guts and O1 landed** (`docs/notes/gore.md`: the audit's table, "Limb parts",
  "Free guts", "Organs you notice"). What the audit found beyond the trunk: a third of a gibbed body's limbs were thrown as
  the forearm or shin alone and the upper arm or thigh deleted (41 to 71 of a Trooper's 83 litres of limb survived a gib;
  now 71 every time); a loose leg destroyed left 4.5 of 14 litres, a top half 5 of 45 (now the limb's own four pieces, cut
  from each archetype at load: a hand with its wrist, a boot with a shin in it); a pair of legs burst lost its pelvis.
  Decisions: limbs split in two only while the live-limb budget has room, else whole; limb parts cost 270 ms of load, taken
  rather than a hitch in play; a strand snags on any edge 0.3 m over the floor beside it, two points a strand; an organ
  bursts under the local player's feet only (each screen its own, as all of gore); stepping needs the feet within 20 cm,
  and walking near kicks it instead, since the owner asked for both. **Not done:** a thrown organ still shows inside the
  opened chest (needs a bit in the body's data texture; fire and wear are in that file now); machines' bodies still go as
  12 scraps; guts do not rest on corpses until resting bodies have colliders (mess); the audit's litres are the Trooper's
  only. **For "mess":** organs now burst when their slot is reclaimed (`ChunkField.spawn`), so raising the organ slots
  only delays that; limb parts are 4 a shape (`PARTS_PER_SHAPE` in `gore/index.ts`).
- 2026-11-19, decals: **B1's trail, B4 and B2 landed** (`docs/notes/gore.md`, "Blood that reacts"): a wounded man who walks
  leaves a line of drops a stride; blood on a ceiling and a pool at a ledge drip; what lands in a pool splashes; a body at
  rest in another's blood is soaked; the player and enemies leave a dozen fading boot prints after stepping in a pool, and
  a slide leaves smears. Decisions: "a pool" for all of these is any big wet stain on a floor (pool, burst, soak, ring, a
  kill's fan) for 75 s, not the pool decal alone, so a fresh massacre is wet wherever it looks wet; enemy prints are for
  booted humanoids only and rationed (14 a second, within 30 m); the player's steps are read from his stride (no new
  event); the hook for enemies is one line in `CharacterLibrary.wireGround` and an optional `GoreSystem.footfall`. No new
  switch: the trail goes with `?hitblood=0`, and prints need blood on the floor. Pictures: `after/scenes/new-prints-*`,
  `new-walk-*`.
- 2026-11-19, fire, F1: **fire that finishes the job** (`src/gore/fire.ts`, `docs/notes/gore.md` "Fire on bodies",
  `enemies.md` "Burning", `characters.md` "Burnt skin"). One list in gore of everything alight or smouldering (the living,
  corpses, limbs); flames off the whole body by its hit capsules; char by fire damage as well as time, at least 0.85 on a
  death by fire; the corpse burns 5 to 8 s more, then smoulders 30 s; soot and a scorch for the blood pool; the kit on a
  burnt body burns black with it. Decisions: the smoulder's glow is strongest in its first 8 s and gone by 30 (a corpse that
  glowed evenly for half a minute read as still alight); a living man whose fire goes out smokes for 3 s; `?fire=0` gives
  the old behaviour but draws char with the new shader (one shader, not two). Cost: no difference that survives this shared
  machine's run-to-run noise (numbers in `gore.md`). **For agent "wear":** the bone texture now has two fire texels
  (`EXTRA_FIRE`, before the wounds) and 8 texels free after the wounds; the shared "skin gone, the interior shows" path
  lands with F2 and will be announced here. **For agent "decals":** a burnt body needs a **soot shape**: a soft-edged,
  streaky black-brown stain about 1.2 to 1.6 m across with a darker burnt middle and soot thrown out one side, plus a small
  one (0.4 to 0.7 m) for a limb; until it exists `FireField.scorch` lays one `scorch` and two small ones (`src/gore/fire.ts`,
  one place to change). Pictures: `tools/out/gore-update/fire/`.
- 2026-11-19, fire, F3: **fire meets the other systems.** Burning corpses draw their arms and legs up (the nearest 4, through
  the joint muscles, then freeze in the pose); the pieces of a burnt body are dark (`chunks.char`, an instance colour);
  watching a comrade burn costs a squad 9 morale a second a man, the fastest steady loss, and his burning body 4 a second
  for 6 s more (`docs/notes/outpost.md`, "Fire"); the dead (Husk, Stalker, Leaper, Bomber, Juggernaut: `EnemyDef.mindless`)
  keep coming and keep attacking while they burn. Decisions: "zombie" is decided by type, not by mode, so a Trooper in The
  Crucible still panics ("burning men still panic"); a man's own fire does not chip his own morale (he is already past it);
  no more than two burning men and two burning bodies count at once. **For agent "gibs":** `ChunkField.char` (set by
  `Gore.gib` round its spawns) tints pieces by instance colour; the slabs' skin side and the trunk's big pieces are not
  tinted because they draw with the body's skin material (`charredVariant(material)` in `characters/material.ts` gives a
  burnt twin of any character material if you want it there), and a burnt body's gib still throws red blood and ribbons.
- 2026-11-19, mess, M0 and P1 landed (`docs/notes/gore.md`, "The mess that stays" and "The mess: measured budgets").
  **Measured:** a corpse costs the frame 0.030 ms of script and 36,600 triangles on the development machine, a third of it
  a skeleton worked out again every frame for a body that lies still; decals cost by layers stacked on screen (0.006 ms a
  full-screen layer), not by count; 2,250 fixed capsules cost the physics step nothing. **Built:** a body at rest keeps a
  fixed capsule where each of its own lay, so bodies heap (chokepoint, 80 kills: hips up to 0.88 m, was 0.14); it wakes as
  a ragdoll when the player or an enemy walks into it, a body lands on it, or what it lay on goes; its skeleton is still
  and all but the newest 8 cast no shadow; the oldest out of sight go first; pieces lie until their slot is needed; a
  soaked spot stops spending decals; the "Mess" setting. **Decided:** default Standard (120 bodies kept, 3.5 ms on the
  laptop by the estimate with every body in view, against 7.2 ms for the 40 it drew before; **the laptop figures are an
  estimate scaled from `docs/notes/render.md`, there is no laptop here**). Enemies push at 0.4 of the player's strength
  and wake one body every 0.6 s between them: at full strength a horde ploughed every heap flat. The old "Gore" setting no
  longer sets how many bodies, limbs and pieces stay. The stripes where pools overlap were agent "decals"'s find (a cell
  number interpolated across a quad), fixed in D1. **For "fire":** a body that must stay a character (it is burning) calls
  `gore.hold(char, seconds)` once P3 lands; `Decals.fadeOut` and `Gore.sweep()` clear the floor at a wave break.
  **For "gibs":** your `ChunkField.kick` is reused for the player kicking meat, bone and ribs (`shove`); the common kinds'
  rooms are doubled and `ChunkTuning.share` (0.5 at Standard) says how much is in use, the cut kinds keep all of theirs.
  **Not done yet:** P3. **Co-op:** `coop-gore-shots.mjs` failed one case twice ("limb", the watcher's screen) with the first
  build, where a body's still skeleton had to be undone on every path that gives an instance back; it is now one that ends
  by itself the moment a bone moves, and the proof has passed three full runs since.
- 2026-11-19, react: **R2 landed.** A plain flinch sends a hand to the wound 0.2 s later, with a 1.1 s gap; a body under half its health bends over and goes back to its wound; a weakened leg limps (`docs/notes/enemies.md`). Decisions: zombies get no hand and no hurt posture (they feel nothing) but do limp, since a ruined leg is mechanical; men with anatomy keep their own wound postures, so only the flinch's hand is new for them; the hurt posture is refreshed on a hit (health only changes then), not every frame. Co-op: `coop-gore-shots.mjs` passes; its `limb` case fails about one full run in seven on the watcher's count of legs **on the build before this lane too** (seven runs of the untouched branch, one failure, the same message): the watcher's copy drops the limb through the fallback in `net/world/replicas.ts` (no `sever` event within 0.8 s), which calls `gore.sever` and never `updateMaim`, so its `maim` stays whole. Not this lane's; for the lead's sweep.
- 2026-11-19, decals: **P2 landed: blood that never has to go** (`docs/notes/render.md`, "the floor tiles";
  `src/render/BloodMap.ts`). Decisions, where the plan left room:
  - **The floor's own shader is not touched.** The plan had the floor material read a blood texture. Instead the texture is
    shown by sixteen quads in the decal draw: the same lit shader as every stain (so old blood keeps its red under cyan
    light and does not jump when it changes hands), no recompile of the world's materials, no cost at all until the
    first stain is baked, and one switch turns it off.
  - **The rule for upper floors, stairs and ramps:** a tile is one floor height and passes the decals' depth test, so
    floors over each other never share blood; only flat stains are baked; ramps, stairs and walls keep decals.
  - **Baked when dry (100 s), not when overwritten:** the decal and the tile then show the same stain for a while, so
    nothing blinks when the decal goes. A stain overwritten earlier is baked on its way out.
  - **Fixed memory: sixteen tiles of 15.9 m (6 MB).** Past that the least lately used tile is wiped and moved. If a
    map's fights spread wider than about 65 m by 65 m, raise `MapTuning.side`.
  - **For agent "mess":** ring `floor` (16 slots, first in the draw) is the map's; `decals.clear()` empties the tiles, so
    "clear at wave break" clears old blood too; `setLimit('blood', n)` works as before and what it pushes out is baked.
    `decals.total` counts the tiles in use.
  - Not measured: the tiles' cost on a laptop GPU (each is one big quad through the decal shader; it discards where
    there is no blood). Not done: walls and slopes, and a setting for the tiles' resolution.
  - Pictures: `tools/out/gore-update/decals/after/kept/` (ten kills with the blood ring cut to 120 decals, tiles on and off).
- 2026-11-19, react: **R4 landed** (`docs/notes/gore.md`, "Collapse and twitching"). `maxCollapses` 4 to 8, and a kill on a body gore has on its feet becomes a death on its feet on the same ragdoll. Found on the way: before this an SMG kill on a Trooper never died on its feet at all, because the second round had put it on its muscles and the rule refused a body that counted as down (0 of 8 in a row; now 8 of 8). Decisions: 8 and not more, from the measured step (median 0.9 ms against 0.7 with eight dying at once); the carried death starts early in a death's clock with its hold capped at what its balance had left, since mapping the clock to the hold put it on the floor in 0.35 s, which is the drop this step removes. `ragdoll.test.ts` 'a blast at the cap' stood its bodies 12 m apart for four collapses, which put three of eight off its floor: they are now spread over the same width.
- 2026-11-19, fire, F2: **fire starts where it touched and burns the skin through to muscle and bone.** Built on wear's
  `SKIN_GONE` as its second driver (`FIRE_DRIVER` in `characters/material.ts`), not a second look: the burn has an origin
  (`setBurnOrigin`, from the flame's hit or a random point on the body), the char walks out from it, and `setBurnThrough`
  bares cooked muscle and sooty bone, most where the fire caught (`docs/notes/characters.md`, "Burnt skin"; `gore.md`,
  "Fire on bodies"). Decisions: painted on the skin like wear, so no interior draw, no extra draw calls and it works at
  every level of detail (the plan's "interior shows through" would have cost two draws a burnt body and stopped at full
  detail); a living man shows it only after some seconds alight and only to 0.4; plate never burns through. `?fire=0` does
  not switch F2's look on a body already burnt, only who drives it (nothing does with it off).
- 2026-11-19, react: **R3b landed** (`docs/notes/enemies.md`, "A hit spoils his aim"). The numbers, kept modest: shaken for 0.35 s at most; fully by a round in the gun arm, about 0.6 by an SMG round in a Trooper's chest, 0.14 on a plated Brute; up to 3 times the miss radius plus 0.05 rad; a wind-up put back 0.2 s at most, once an attack. Decisions: zombies, bosses and machines are not affected (the first feel nothing, the others answer hits by `poise` and their fights were tuned on it); only the deciding machine sets it and nothing is added to the wire. In the game a Trooper's burst at 12 m goes from 0.18 m off a standing player to 0.71 m while his gun arm is being hit: that is the balance change the owner said yes to, and `SPOIL.wide` is the one number to turn it down.
- 2026-11-19, mess, P3 landed (`docs/notes/gore.md`, "Many more corpses: the far batch"). Past 32 bodies drawn as
  characters (Standard), the oldest settled bodies are baked into one shared mesh, one draw for all of them, and their
  characters go back to the library; a baked body keeps its fixed capsules, so it is still part of its heap, and is stood
  up again exactly as it lay (pose, cuts, wounds, wear, burns, kit) when a round or a blast reaches it, someone walks into
  it, or what it lay on goes. **Measured:** bake 0.2 to 0.3 ms, stand-up 0.1 ms; sixty bodies 395 draws and 1.60 M
  triangles as characters, 140 and 0.64 M baked; a body stood up again differs from the picture before it was baked in
  0.002 to 0.15% of pixels; baking changes 0.15% at 18 m, 2.5% at 11 m, 5.7% at 6 m. **Decided:** changes are made out of
  sight or past 11 m; in plain sight only when the characters are 4 past their cap (at 12, a 150-kill fight on one spot
  ended with 77 characters and more triangles than the game before); loose limbs at rest lose their shadows past the
  newest 8; a loose piece's draw runs only as far as the slots used. **Found and fixed on the way:** a burnt body's kit
  keeps its unburnt material in `userData` (`charKit`), and three's `clone()` turns `userData` into JSON, so a baked burnt
  Gunner's minigun was later given a plain object for a material and the frame could not be drawn: the copies a baked body
  carries are made with `cloneKit`. **For "fire":** `SeveredPart.pose` still clones kit the plain way; a baked body is
  never one with flames on it (`fire.flaming`), and `gore.hold(char, seconds)` keeps any body a character. **Not done:**
  limbs and pieces are now the larger share of the floor's cost (limbs 153 draws, pieces 1.03 M triangles at Standard
  after 150 kills) and are not baked; nothing was measured on a laptop.
- 2026-11-19, react: **R3 landed, on by default** (`docs/notes/enemies.md`, "The struck part goes physical"). The lane's steps are all done. Decisions: (1) **the part is simulated inside the animator, not as Rapier bodies.** A chain of point masses at the joints with fixed bone lengths, springs to the animation and a snap along the shot gives the hang, the lag and the whip the plan asked of a "powered ragdoll hung on the animated spine", and it removes the two things the plan called risky: there is no hand-over (gore reads the pose and speed off the bones as for any animation) and no physics cost (0.043 ms a frame for eight upper bodies; the step is unchanged). What it does not do: collide. A swinging arm passes through a wall or the body's own trunk for the third of a second it is loose, as the animated arm does. (2) **On by default**, because the sheets and the numbers show no pop: in, no sharper than the flinch's own kick; out, 0.0055 m a frame at most; onto its muscles 0.041 m; into death 0.007 m; a crowd of 24 under fire with eight parts live shows nothing wrong. (3) A loose part starts with 0.3 of the flinch's throw, not all of it: with all of it a struck hand travelled 0.82 m. (4) Eight at once within 25 m, in view; the animated flinch (R1) is what every other body gets. For whoever plays it: `SwayTuning` in `sway.ts` is every number (how loose, how long, how hard the snap).
- 2026-11-19, fit, step 1: **fire meets the others, a thrown organ leaves its chest, the dead hold things up, a torn leg
  limps, and the co-op "limb" flake.** (For "gore-verify": what changes cost or co-op is marked.)
  - **A burnt body is dry and its pieces are burnt** (`docs/notes/gore.md`, "Fire on bodies"). Soot is the decal lane's
    `soot` shape now (one along the body, a small burnt middle, one off to a side). Past char 0.5 nothing red comes out
    of a body: its gib throws charred trunk pieces, cooked cut faces, dark slabs, parts and meat, no ribbons, stains,
    jets or guts, ash and soot instead; a round knocks ash out of it; a limb off it does not spray. A trunk piece or a
    blade's half of a body with char or flames on it is an instanced mesh of one whose colour is its char, and
    **burns on** when its body was burning (`FireField.pieceOf`). Decided: dry by char alone, alive or dead (a man at
    char 0.5 has seconds left), and the energy blade's cut is left as it is.
  - **Baked burnt bodies** keep their char (walking out from where it caught), their burn-through and their limbs' wear,
    painted into the vertices as the shader's far level draws them, and a smouldering one smokes on while baked and has
    its fire back when stood up (`park`, `resume`). **Cost:** a parked fire is one of fire's 40 entries; the bake's inner
    loop does a little more a vertex (not measured apart; a bake was 0.2 to 0.3 ms).
  - **The clone hazard is fixed at the root:** a burnt twin knows the material it was made from (`unburntVariant`), so
    nothing is kept in `userData` and any copy of burnt kit is safe; `cloneKit` is gone.
  - **A thrown organ is gone from the chest** (`Character.takeOrgan`): a bit an organ in a spare channel of fire's second
    texel. No texel spent; five are still free.
  - **Pieces and guts lie on the dead** (`docs/notes/gore.md`, "What lies on the dead"): loose pieces meet resting
    bodies' capsules, strands' floor rays do, and all of it falls when the body under it goes. **Cost/co-op:** up to 72
    moving pieces now also meet the fixed capsules (M0 measured those as nearly free to 2,250); nothing on the wire.
  - **The limp starts with the look** (`legLooks`): from a tenth of a leg's pool spent, where wear shows, not from 0.45.
    The rules of a weak leg are untouched (`hurt.test.ts`). Decided on the movement side: wear's proportional tear is
    what the owner asked to read, so the walk was brought to it and not the tear held back.
  - **The co-op "limb" case:** ten full runs of the tip, three pages: nine clean (267 checks), one failed, and not on
    legs: a watching screen counted two blood puffs too many. Cause: a round into the dead is each screen's own, the
    earlier cases' corpses lie round the same spot on every screen in a different place, and the "limb" case aims low;
    one screen's copy of the pellets met an old corpse. That is the game working as written and the proof miscounting:
    the proof now tags blood knocked out of a corpse with that corpse. The leg count itself: mess's guard covers both
    causes named (the stale snapshot, and react's fallback, which runs only on a copy that is up and is followed by the
    guard in the same frame). One real hole next to it is closed: a limb dropped by the fallback never recounted the
    copy's arms (`updateMaim` is called now; `replicas.test.ts`). **Co-op:** that one line is the only change to it.

- 2026-11-19, verify, first numbers, **for "gore-fit" now** (the whole table comes later): **in a heavy fight the update's
  cost on this machine is the physics step, and it is bodies falling into a heap of resting capsules.** The scene is
  `tools/scripts/gore-cost.mjs` (its header says what it plays): real time, every frame drawn at 1440x900 dpr 2, default
  quality, Mess at Standard, up to 48 alive in the Crucible topped up at five a second and fought from one spot (bullets,
  then rockets and grenades, then the Kiln, then bullets), about 420 kills in 90 s, the same on each build. One run each
  on `e801633` (i9-13900K, RTX 4090, load 2 to 5), ms a frame:

  | Build | Script, mean (95th) | Physics step, mean (95th) | `render()` | `gore.update` | GPU | Draws | Triangles | Frames over 16.9 ms, of 5,100 |
  |---|---|---|---|---|---|---|---|---|
  | before the update (`d2e2f8a`) | 9.8 (12.0) | 1.55 (2.6) | 6.3 | 0.35 | 5.0 | 691 | 3.5 M | 25 |
  | tip, every switch off | 11.7 (15.4) | 1.62 (2.6) | 8.1 | 0.40 | 5.1 | 861 | 4.9 M | 136 |
  | tip | **14.5 (19.4)** | **4.99 (7.7)** | 7.1 | 0.82 | 5.1 | 775 | 4.3 M | **821** |
  | tip, `?messrest=0` | 12.8 | 2.36 (4.0) | 7.9 | 0.71 | | | | 320 |
  | tip, `MessTuning.maxShapes` 600 | 14.1 | 4.13 (6.1) | | | | | | 628 |
  | tip, `MessTuning.maxShapes` 1,300 | 14.3 | 4.52 (7.7) | | | | | | 924 |

  - The world has 1,990 colliders before the first kill (the Crucible's own), 4,190 once the heap has grown, 2,040 with
    `?messrest=0`. The step is already 4.4 ms ten seconds in, with 750 capsules down, and capping the capsules at 600
    barely helps: **it is not how many there are, it is about twenty live ragdolls a frame landing in and lying on a
    heap, each of their parts against every capsule under it** (a resting body leaves about 18). M0's "2,250 capsules
    cost nothing" dropped fourteen ragdolls once on capsules spread out; a fight keeps dropping them on the same spot.
    In Endless Humans, where men die spread over the floor, the same capsules cost 0.9 ms, not 3.4.
  - **So "loose pieces meet resting bodies' capsules" (fit, step 1) is on the costly side of this**: up to 72 more
    moving things against the heap. Not measured yet on `bd37370`; I will.
  - What would bring it down, in your files: a resting body keeping three to five big shapes (trunk, hips, thighs)
    where it keeps every bone's now; or only the top layer of a heap keeping shapes; or fewer bodies allowed to be live
    ragdolls on a heap at once. On this machine the tip misses 60 in this scene one frame in six where the game before
    it missed one in two hundred; a laptop's processor is slower.
  - **The switches-off build is not the old game:** with `?messfar=0` Standard keeps 120 bodies as characters (4.9 M
    triangles, 861 draws against 691): heavier to draw than either the old game or the update.
  - The GPU's own time is the same on all three (5.0 to 5.1 ms on the RTX 4090 at 1440x900); `render()` on the tip is
    0.8 ms over the old game (84 more draws, 0.8 M more triangles).
  - What I am doing with it: Mess at Low will not leave capsules, and the automatic step-down (dynamic resolution's)
    will stop leaving them when frames are missed and resolution is not the cause.
- 2026-11-19, fit, step 2: **limbs are baked, the long fight costs less than the old game, machines break into their
  hulls, and two fixes to the struck part.** (For "verify": every line here changes cost or co-op.)
  - **Loose limbs at rest are baked** into a batch of their own (`docs/notes/gore.md`, "Loose limbs are baked too, and
    what a crowded heap costs"), pieces and trunk halves at rest cast no shadow, and a crowded heap is baked sooner and
    drawn coarser past 4 m. **Measured, the same seeded fights (`mess-fight.mjs`), Standard:** 150 kills on one spot
    813 draws / 4.41 M triangles / 5.55 ms a frame drawn before, **467 / 2.71 M / 2.87 ms** after (the game before the
    update: 640 / 3.45 M / 5.08 ms). A chokepoint at 80 kills 583 / 2.98 M before, 415 / 2.16 M after, with the heap as
    high (hips to 0.65 m, 13 bodies over 35 cm, against 0.68 m and 9). Decided: the piece is kept and only taken out
    of the scene while it is baked, so there is nothing to restore and a round finds it as before; trunk halves are
    not baked (0.05 M triangles between them: not worth a third batch); no new switch (`?messfar=0` covers it).
  - **A machine bursts into its own hull** (`buildWreck`): the drone, the skitter and the Titan were their limbs and a
    dozen scraps, with the body itself nowhere. Four pieces that fit together, the hull's volume within 15%.
  - **The struck part goes by the host's own eye** (`EnemyManager.localView`): a co-op host's AI figures are from the
    player an enemy is after, and one beside the host that hunted a far guest got the animated flinch alone. **A loose
    arm stays in front of a wall** (one ray an arm a frame, a push out at 3.5 m/s at most). Decided against a stop for
    its own trunk: measured, the loose arm comes no nearer the trunk than the animated flinch takes it (within 2 mm,
    three archetypes, both arms, seven directions), so there was nothing for it to do; and the loose arm ends at most
    9 cm further out than the flinch throws it, so most of an arm seen in a wall is the flinch's own pose, which has
    never collided with anything. That is R1's shape, and not changed here.
  - **Not done: the settle of a body that dies on its feet.** Four of six SMG collapses and six of six plain drops end
    with both knees folded right up; the two knobs there are (topple speed, the weak leg's lead) leave it at four of
    six. It needs a real change judged by eye (a leg that slides out), which was not cheap.
- 2026-11-19, fit, step 3: **one look, and the audit for every archetype** (`docs/notes/gore.md`, "One look" and "The
  audit, every archetype"; night stills from `tools/scripts/fit-look.mjs`).
  - **Limb wear did glow, and it was the effect, not a lamp**: a fixed warm fill on bared flesh made a torn limb the
    brightest thing in a dark corner at 20 m. It is lit by the light that reaches it now. Still reads at 20 m.
  - **The burnt-through body did read raw under a light**: under the weapon light at two metres even char turned tan,
    with the cooked muscle a wet red. Burnt pixels now level off: black char, dark brown-red cooked muscle (matt), sooty
    bone, under any light.
  - **Blood on the floor washed out under the weapon light** (the "pale rims", and more: a dried stain nearly
    vanished): a stain's opacity now rises with the light on it and the lip's glint levels off.
  - **Flesh dries** with the floor's blood: pieces and cut faces by the time they were made, the dead where they lie
    in six steps. New switch `?dryflesh=0`. Decided: tacky, not matt, and a round into a dried corpse wets it again.
    **Cost:** six texture uploads a body over a minute and a half; one uniform a frame.
  - **The audit:** every flesh archetype adds up (trunk pieces equal each kit, every limb thrown). Found: the
    machines' hulls deleted (fixed in step 2), a skitter losing two of six legs two bursts in three (fixed: a machine's
    limbs are thrown by bone), the Sniper's slabs are scraps (not fixed: a slab is one island of trunk skin and its
    trunk is many small ones).
  - **A bug of step 1, found in the night stills and fixed:** a gut strand could be caught in mid-air on a trunk piece
    flying over it (its floor rays met anything of the ragdolls' group) and hang there from nothing. Strands lie only
    on what is at rest.
  - **Left as they are:** the inside of a wound's hole keeps its old fixed light; a baked burnt body can go pale under
    the weapon light (it has no rule for char); the colours themselves, which already agreed.
- 2026-11-19, fit, step 4, **an answer to "verify" on the physics step: it was being taken 1.57 times a frame, and the
  three things you suggested do nothing.** (`docs/notes/gore.md`, "What a heap costs the physics step"; the runs are
  your own scene for 45 s with Rapier's profiler on, `fit/cost/`.)
  - Tried and **measured as nothing, so not kept**: a resting body keeping only its big shapes (a quarter of them:
    3.4 ms against 3.4 to 3.5); a landing that wakes nothing (3.4); loose pieces falling through the dead as before my
    step 1 (3.2 to 3.3, inside the spread between runs of one build, which is 3.1 to 3.5). **So "pieces meet resting
    capsules" is not on the costly side**, and capping or thinning capsules will not help at Standard.
  - The number of chains simulated is the ragdoll budget's, heaps or none (14.8 a frame against 13.6). What a heap adds
    is contacts: one world step 1.59 ms against 1.17.
  - **The find: `Physics.step` ran two steps on every frame a hair over 1/60 s**, which on a 60 Hz screen is more than
    half of them (16.6 to 16.8 ms). 1.57 world steps a frame, in the old game as well. **Fixed** (a frame up to 6% over
    is one step): the same fight goes from 3.6 ms (3.1 to 4.4, five runs) to **2.1 and 2.5**, which is what no heap at
    all cost at two steps. **Cost and feel, for you to re-measure:** it is the whole game's physics, single player and
    co-op host alike; every test and frozen picture already took one step, and so does a 120 Hz screen, so nothing
    seeded can show a difference. Switch `?onestep=0` (dev panel, "Physics: one step a 60 Hz frame").
    Decided: it lives in `src/physics/Physics.ts`, which is no lane's file, because that is where the fault was.
  - Still true: a heap's step is about a third dearer than a flat floor's, and the old game gains from the same fix.
    Your step-down for Low and for missed frames is still worth having.
- 2026-11-19, fit, **last entry: what was proven on the final build, what is not done, and what was decided.**
  - **Proofs on `dfbdce9`:** whole suite green (3,079 tests); the co-op gore proof (`coop-gore-shots.mjs`, three
    pages) twelve runs in a row, 267 checks each, none failed (`fit/coop-limb/final-gate`, `final`). The same proof on
    the tip the lanes left (`e801633`) failed one run in ten on the "limb" case, and that failure was the proof's own
    (step 1). The same seeded long fight on the final build, Standard: **150 kills on one spot 463 draw calls, 2.59 M
    triangles, 2.81 ms a frame drawn** (the game before the update 640 / 3.45 M / 5.08 ms; the update before this pass
    813 / 4.41 M / 5.55 ms), highest hips 0.72 m and 6 bodies over 35 cm (0.80 m and 7 before the pass); the
    chokepoint at 80 kills 419 / 2.09 M, highest hips 0.83 m.
  - **Not done:**
    1. The settle of a body that dies on its feet (knees folded right up, most times): needs a change judged by eye.
    2. Trunk pieces and halves are not baked into a batch (0.05 M triangles between them); they only lost their shadows.
    3. A baked burnt body can go pale under the weapon light: the far batch has no rule for char under a hard light.
    4. The inside of a wound's hole keeps its old fixed light.
    5. The Sniper's trunk breaks into scraps (0.05 to 1.0 L), because its trunk skin is many small islands.
    6. Pieces thrown by a burst on a heap mostly fly clear of it; what does come down on the dead stays there (tests),
       but a still picture shows little of it.
    7. A heap's physics step is still about a third dearer than a flat floor's. Nothing here was measured on a
       laptop: that is "verify".
    8. The struck arm can still be seen in a wall when the animated flinch itself puts it there (R1's pose, which has
       never collided with anything).
  - **Decided, without asking:** burnt past half char means no red at all (pieces, faces, stains, ribbons), by the
    owner's "burnt things look burnt"; flesh dries tacky, not matt, on the floor blood's clock, with a switch; limbs
    are baked by keeping the piece and hiding it, so nothing has to be restored; the limp follows the look and the
    rules of what a round does to a limb are untouched; no stop for the struck arm against its own trunk (measured:
    nothing for it to do); the physics step fix went into `src/physics/Physics.ts` with a switch, because that is
    where the fault was, though it is the whole game's; three ways of thinning the heap for the step were measured
    as nothing and thrown away rather than left as dead knobs.
  - **Pictures and what to look at:** `tools/out/gore-update/fit/LOOK.md` and `fit/pictures/`.
- 2026-11-19, lead: agent gore-fit found that on a 60 Hz screen more than half of all frames ran two physics steps and made every such frame one step (about a third less physics time in a heavy fight). That changes how the WHOLE game's physics is stepped for a 60 Hz player (the owner's Mac), and on 2026-11-18 he pinned a change to the physics build with the words "the current physics build works well and seems fundamental to the current feel". So the switch is **off by default** (`?onestep=1` or the dev panel row turns it on); the cost tables in `docs/notes/gore.md` that quote the one-step figure are with it ON. For the owner to compare by playing.
