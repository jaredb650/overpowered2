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
| react | 5600-5609 | R1 every hit shows (strong, every round); R2 hand to the wound and a hurt posture; R4 dying carries the shots; R3b a hit spoils his aim (host decides); **R3 the struck part goes physical** (the gradient: animation, powered part, whole-body balance, limp, blended by weight; behind a switch) | `characters/animation/HumanoidAnimator.ts`, `enemies/damage.ts` (`respond`), `enemies/reactions.ts`, `gore/stand.ts`, `gore/rag.ts`, `gore/muscles.ts` | todo |
| gibs | 5610-5619 | G1 rockets and grenades crack the trunk; G2 show the break: pieces thrown hard out of the fireball, bright wet torn faces, mid-size slabs, so the pieces add up to the body destroyed (every destruction: torso, head, limbs, whole-body gib); free guts that detach, fly and drape; O1 organs you notice (bigger, squash, roll, burst when stepped on or shot) | `gore/torso.ts`, `gore/chunks.ts`, `gore/index.ts` (gib paths), the gut rope, `weapons/Combat.ts` blast force only where G1 needs it | todo |
| fire | 5620-5629 | F1 fire finishes the job (char by fire damage, the corpse burns on then smoulders, soot not a blood pool, flames on the whole body and on severed burning limbs); F3 fire meets the other systems (curled burnt corpses, dark pieces, morale chips faster, burning zombies keep attacking); F2 fire spreads from where it touched and eats the skin to muscle and bone | `enemies/EnemyManager.ts` burn, `characters/material.ts`, `fx/recipes`, `enemies/outpost/morale.ts`, `enemies/behaviours.ts` | todo |
| mess | 5630-5639 | M0 measure the budgets; P1 the mess stays (decal rings by kind and about four times the room, pieces that do not expire, corpses sink only out of view, resting bodies that stack and are **pushed aside as ragdolls** when walked into, the "Mess" setting); P3 many more corpses (tiers, baked far bodies that can wake) | `render/Decals.ts` (the rings and budgets), `gore/chunks.ts` lifetimes, `gore/rag.ts`, `gore/sliced.ts`, `gore/index.ts` corpse caps, settings UI | todo |
| decals | 5640-5649 | D1 realistic decal designs and BIG decals for coverage (the sheet, the choice of shape by speed, angle, amount and weapon, wet and dry surface response); B1 more blood from one hit; B4 drips from ceilings and ledges, splashes, soaked bodies; B2 footprints and slide smears; P2 blood that never has to go (the floor texture) | `render/materials/decalAtlas.glsl.ts`, the shape choice in `render/Decals.ts` and `gore/blood.ts`, `fx/layers/blood.ts` | todo |
| wear | 5650-5659 | B3 blood on the weapon and hands; W1 wear you can see: readable limb damage (skin torn to muscle, then bone, as a region's pool is spent), without changing what shooting a limb does | `weapons/viewmodels/` materials, `characters/material.ts`, `characters/anatomy/interior.ts`, the body's data texture | todo |

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

## Log

- 2026-11-19: file written; branch `gore-update` cut from the finished co-op work.
- 2026-11-19, mess, step 1: **the decal buffer is split into rings by kind** (`src/render/Decals.ts`; `docs/notes/render.md`,
  "Rings"). Four rings in one instanced mesh and one draw: `scorch` 256, `big` 256, `blood` 8,192, `mark` 1,536, drawn in that
  order. Decided: scorches got their own ring under everything (the brief had them with the holes), so the blood of a man a
  rocket killed lands on the burn, not under it; holes, cracks and cuts are on top. **For agent "decals":** add your kinds to
  `DecalKind`, `CELLS` and `RING_OF` (big stains go in ring `big`, which nothing uses yet); `decals.onRetire` is the call when
  a decal is about to be overwritten (P2's hook); `mesh.count` is no longer the number of decals (`decals.total`,
  `live(ring)`). The counts are the plan's until M0 has measured overdraw.
