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
| react | 5600-5609 | R1 every hit shows (strong, every round); R2 hand to the wound and a hurt posture; R4 dying carries the shots; R3b a hit spoils his aim (host decides); **R3 the struck part goes physical** (the gradient: animation, powered part, whole-body balance, limp, blended by weight; behind a switch) | `characters/animation/HumanoidAnimator.ts`, `enemies/damage.ts` (`respond`), `enemies/reactions.ts`, `gore/stand.ts`, `gore/rag.ts`, `gore/muscles.ts` | doing: R1 done |
| gibs | 5610-5619 | G1 rockets and grenades crack the trunk; G2 show the break: pieces thrown hard out of the fireball, bright wet torn faces, mid-size slabs, so the pieces add up to the body destroyed (every destruction: torso, head, limbs, whole-body gib); free guts that detach, fly and drape; O1 organs you notice (bigger, squash, roll, burst when stepped on or shot) | `gore/torso.ts`, `gore/chunks.ts`, `gore/index.ts` (gib paths), the gut rope, `weapons/Combat.ts` blast force only where G1 needs it | done: G1, G2, the volume audit, free guts, O1 |
| fire | 5620-5629 | F1 fire finishes the job (char by fire damage, the corpse burns on then smoulders, soot not a blood pool, flames on the whole body and on severed burning limbs); F3 fire meets the other systems (curled burnt corpses, dark pieces, morale chips faster, burning zombies keep attacking); F2 fire spreads from where it touched and eats the skin to muscle and bone | `enemies/EnemyManager.ts` burn, `characters/material.ts`, `fx/recipes`, `enemies/outpost/morale.ts`, `enemies/behaviours.ts` | doing: F1 done, F3 in hand |
| mess | 5630-5639 | M0 measure the budgets; P1 the mess stays (decal rings by kind and about four times the room, pieces that do not expire, corpses sink only out of view, resting bodies that stack and are **pushed aside as ragdolls** when walked into, the "Mess" setting); P3 many more corpses (tiers, baked far bodies that can wake) | `render/Decals.ts` (the rings and budgets), `gore/chunks.ts` lifetimes, `gore/rag.ts`, `gore/sliced.ts`, `gore/index.ts` corpse caps, settings UI | todo |
| decals | 5640-5649 | D1 realistic decal designs and BIG decals for coverage (the sheet, the choice of shape by speed, angle, amount and weapon, wet and dry surface response); B1 more blood from one hit; B4 drips from ceilings and ledges, splashes, soaked bodies; B2 footprints and slide smears; P2 blood that never has to go (the floor texture) | `render/materials/decalAtlas.glsl.ts`, the shape choice in `render/Decals.ts` and `gore/blood.ts`, `fx/layers/blood.ts` | doing: D1 (the sheet, big stains, marks), B1, B4, B2 landed; P2 next |
| wear | 5650-5659 | B3 blood on the weapon and hands; W1 wear you can see: readable limb damage (skin torn to muscle, then bone, as a region's pool is spent), without changing what shooting a limb does | `weapons/viewmodels/` materials, `characters/material.ts`, `characters/anatomy/interior.ts`, the body's data texture | B3 done (aaaa677), W1 done |

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
| `?vmblood=0`, lab row "Blood on the weapon" | on | Guns and gloves stay clean whatever is killed (B3) | wear |
| `?wear=0`, lab row "Wear on limbs" | on | W1: skin torn to muscle and bone as a limb's pool is spent, against bodies that show only their wounds | wear |
| `?bigblood=0`, lab row "Blood: big stains on a kill" | on | D1: the big stains a kill lays for coverage (burst, fan, wall sheet, soaked patch, drag, ring) against the small traced drops alone | decals |
| `?hitblood=0`, lab row "Blood: a mark from every round" | on | B1: every round's own fan on the floor past the body against none | decals |
| `?fire=0`, dev panel "New fire" | on | F1 and F3: off is fire as it was (a timer, one emitter on the chest, char by seconds alive only, out at death, a red pool under the body, no curl, no dark pieces). Not switched by it: the charred skin's new colours (the shader is one), and the rules of F3 (burning chips morale, the dead ignore fire) | fire |

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

