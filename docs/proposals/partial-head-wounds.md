# Idea: partial head wounds instead of clean decapitation

Status: step 1 built on 2026-11-14 (the rules, the Fallout burst kit, pellet counting on the head, the helmet thrown
off). Step 2 built on 2026-11-14 for the Trooper the cheap way, then redone the same day as a **modeled, baked partial
head** after the owner found the crater too much like ordinary bullet damage (see Step 2b, below). The owner played it
("the exact feel I wanted"); **step 3 built on 2026-11-14**: the Gunner, Husk and Brute have their own baked partial heads
(see Step 3, at the end). `headOutcome` in `src/enemies/damage.ts` answers 'partial' for a severe headshot on the
Trooper, Gunner, Husk and Brute; `gore.headshot` builds it on the archetypes in `PARTIAL_HEADS` (`src/gore/index.ts`, all
four) and bursts it on the rest. Not done in step 1: the full Lance is not in the very damaging tier (nothing tells a full beam
from a ball in `DamageInfo` yet).

## The problem

A pistol or rifle round to the head can take the whole head off cleanly today, wherever the game decides a head kill
decapitates. A round does not do that; it reads as cartoonish. A clean separation belongs to the katana, which slices
all the way through a body and can take a head with it.

## The idea

- Bullets that would decapitate today leave a **partially destroyed head** instead: a head blown open, caved in or torn
  partly away, with the body still attached at the neck.
- Clean decapitation stays only for blades (the katana's full slice) and perhaps the heaviest rounds and blasts.
- Each enemy type needs its own **damaged-head variants**, the way limbs have stumps: a hollowed or cratered head with
  the inside showing, in that enemy's own helmet, mask or skin.

## Why it is a big job

- Stumps and caps today are baked per body (`tools/bake/caps.ts`, the character models in `public/assets/characters/`).
  Partial heads mean new baked geometry per archetype, likely two or three variants each (entry side, exit side, top).
- Gore's head kill (`gore.headshot`, `src/gore`) has to choose between a partial wound and a full burst by weapon and
  damage, and the helmets (now separate props, `docs/proposals/armour-and-headshots-plan.md` section 3) have to come off
  or crack with it.
- The sound side is covered: the owner dropped dedicated head-burst and decapitation sounds, since the headshot sounds
  already carry it.

## Questions for when it is planned

- Which weapons still burst a head fully (autocannon, Sabot, shotgun at point blank)?
- Does a partial head wound ever leave the man alive for a moment (dying, not dead)?
- How many variants per enemy are worth baking?

## Owner's direction, 2026-11-14, and what the code allows

**Tiers the owner asked for.** Very damaging fatal headshot: the head explodes. Severe: a partial head wound (part of
the head blown or caved away), replacing decapitation by bullets. Light: the normal hole. A whole head flying off only
from an explosion death (and the katana's slice, which already works through a slice plane). A dead body's damaged head
can still be shot off; a fatal headshot never takes it off whole.

**The burst the owner wants** (Fallout-style): the head comes apart in pieces that add up to a head: the cranium in
three curved pieces (bloodied bone outside, red inside), the jaw in two, the brain in two halves, two eyes, all scaled to
the character's head.

**Today** (`src/enemies/damage.ts` around the `headshot` branches, `gore.headshot` and `burstSkull` in `src/gore/index.ts`):
- Campaign soldiers keep their head on a light lethal headshot (under `HEAD_BURST_DAMAGE`, 40); 40 or more bursts it.
- Swarm enemies lose the whole head on a light lethal headshot (`gore.headshot` severs it whole); 40 or more bursts it.
  This is most of the "decapitation by bullets" the owner sees.
- A body lying down or rising loses the whole head.
- A blast with the `head` outcome goes through `gore.headshot`.
- The burst is 7 generic `skull` shards and 3 `brain` lumps of 3 to 5.5 cm (`chunks.ts`), not head-sized pieces.

**Feasibility.**
- Rules: small; a few branches in `damage.ts` and `gore.headshot`.
- Partial wound: the character shader already cuts real holes (craters, torn exits, `discard`) and shows an interior
  mesh through them (`makeInside`, `book.open`). A first version can be a very large crater on the head (8 to 12 cm)
  through the wound system, with no per-archetype baking. Check whether the baked interior covers the head; if not, a
  generic head-cavity insert scaled per head. Per-archetype hand-made variants only if this does not sell it.
- Burst kit: new chunk kinds with fixed geometry (cranium thirds, jaw halves, brain halves, eyes), built once and scaled
  by the head's radius; `ChunkField` already handles kinds, physics, splats and trails.
- A point-blank shotgun cannot burst a head today: each pellet is 20 damage. Count a blast's pellets on the head, as
  the armour rule does (`armourClass` volley), and treat four or more as one heavy hit.
- A helmet (now its own prop and plate) must come off with a partial wound or a burst.
- Machines (drones, skitters) are out of it.

**Open questions put to the owner.** Which weapons burst (suggested: autocannon, Sabot, point-blank shotgun, full Lance,
the Judge up close; everything else severe is a partial wound)? The Harrow: hole or partial? Does the katana keep its
clean decapitation?

## The plan: a proof of concept first (owner, 2026-11-14)

Build partial head wounds for the four most common enemies only, and judge them before spending more:

| Enemy | Archetype | Why |
|---|---|---|
| Trooper | `trooper` | The rifleman, everywhere |
| Gunner | `gunner` | The shotgunner |
| Husk | `husk` | The zombie |
| Brute | `brute` | The machine gunner |

Every other enemy keeps today's logic with one change: a bullet never pops its head off whole any more. Where today's
code would sever the head or burst it, it gets the new Fallout-style burst.

### The rules (all enemies)

| Headshot that kills | Result |
|---|---|
| Light (under 40) | The normal hole. Head stays on |
| Severe (40 or more) | The four POC enemies: a partial head wound. Everyone else: the Fallout burst |
| Very damaging: autocannon, Sabot, a point-blank shotgun blast (4 or more pellets in one head), full Lance, the Judge within 8 m | The Fallout burst, for everyone |
| An explosion death | The whole head can fly off, as it can today |
| The katana's slice | Unchanged: it can take a head cleanly |
| A dead body's damaged head, shot again | Can come off or burst |

Defaults taken for the open questions: the Harrow (50) is severe, so a partial wound; the katana keeps its clean cut.
Machines are out of it.

### Build order

1. **Rules, the Fallout burst kit, pellet counting on the head.** All enemies benefit. The burst kit: the cranium in
   three curved pieces, the jaw in two, the brain in two halves, two eyes, built once in code and scaled by each head's
   radius. The helmet comes off with any partial wound or burst.
2. **Partial wound, Trooper only.** Try the cheap way first: a very large crater on the head through the existing wound
   shader, with the interior showing (or a head-cavity insert if the baked interior does not reach the head). If that
   does not sell it, bake a partial head for the Trooper instead (its head cut away in the baker, like a stump cap).
   **Stop here for the owner to look at screenshots.**
3. **The other three** (Gunner, Husk, Brute), the same way as whichever approach won.

### Model and effort, for the best result per token

- **Wait for Euphoria stage 8 to finish.** It owns `src/gore/*` and `src/enemies/damage.ts`, which steps 1 and 2 edit.
- **Step 1: Opus 5.5, medium effort.** Well specified, mostly code in known places (`damage.ts` head branches,
  `gore.headshot`, `chunks.ts`), checked by tests and a few screenshots.
- **Step 2: Opus 5.5, high effort.** The visual judgment is the hard part, and screenshots are the expensive part, so
  one archetype only, with a cap of about six screenshot rounds before reporting back.
- **Step 3: Opus 5.5, medium effort.** Repeating a proven pattern three times.
- **Not Fable**, and **not a multi-agent workflow**: this is visual craft on one machine, not hard reasoning or wide
  fan-out, and parallel agents would fight over the same files and the one browser.
- One agent per step, run one after another, each starting from the last one's commit.

## Step 2: what was built first (2026-11-14), since replaced by step 2b

**The cheap way won**: no baking. A partial wound is one very big crater through the existing wound shader, and the
baked-at-load interior shows through it.

- `gore.headshot` with 'partial' on a Trooper calls `partialHead`: the helmet is already thrown (`damage.ts`
  `throwHelmet`, as for a burst), `WoundPlanner.headWound` cuts a ragged crater of 0.55 head radii (6 cm, so a hole
  about 12 cm across) and 16 cm deep, its line tipped 0.55 down into the head from over the crown and its middle raised
  0.3 head radii, so the round's side and the top of the head go together. Two small cranium shells, half a brain and two
  lumps of meat from step 1's kit are thrown back out of it, with blood. The body ragdolls limp, as a head kill does.
- The interior (`src/characters/anatomy/build.ts`) already had a skull; it gained a **brain** (an organ-coloured lumpy
  blob inside it). The interior shader opens the skull further for a crater this big (bone cut to 0.62 of the radius,
  from 0.3), so the layers read from outside in: torn hood, red meat, broken bone edge, brain.
- The skin shader (`src/characters/material.ts`) tears a crater over 3.5 cm radius out in a few lobes round its line
  (`op2Lobes`), so it is less of a round hole. Cannon and blast craters of that size get it too.
- Down, rising or dead, a 'partial' opens the head where it lies the same way.
- **Switch:** `?headpartial=0` bursts every 'partial' again, everywhere, the game included.
- **Sandbox:** `/?sandbox=gore&scenario=headpartial&arch=trooper`: one shot in the face, one in the side of the head.
  The sandbox has no player, so gore puts its bodies on the far level of detail, which draws no wounds: call
  `setLod(0)` on `__gore.stage.row` before drawing.

**Why not the baked head.** The crater sells "part of the head blown away" from the front, three-quarter and side, with
the head still on the neck, and it costs nothing per archetype. A baked partial head would mean new geometry per enemy
and per side, swapped in at the wound. Keep it in reserve if the owner finds the crater too round from the front.

**Rough.** Shot square in the face the opening still reads round from the front, as the Trooper's hood frames it. The
brain is a smooth pinkish lump with highlights, not folded. A body that lands face down hides the wound.

The owner's verdict on it: "It looks like our normal bullet hole damage system if I just shot someone a bunch. These
partial decap head wounds need to look special. The stumps need to be modeled." `WoundPlanner.headWound` is gone; the
lobed tears (`op2Lobes`) stay for big cannon and blast craters, and the interior's brain stays.

## Step 2b: the baked partial head (2026-11-14)

**Two variants, baked per archetype** from his own head, so where it is whole it is exactly him
(`tools/bake/parts/headWreck.ts`, registered as props by `partialHead` in `tools/bake/props.ts`):

- `trooperHeadPartialSide`: his left (+X) side sheared off on a slant that takes more of the crown than the jaw. A jagged
  bone rim proud of the flesh with splinters off it, the brain open, swollen over the break and spilling down the side,
  the eye hanging on its nerve against the cheek, the broken half of the jaw hanging with its teeth, the respirator's
  filter dangling on its hose, burned hood flaps folded down, tissue hanging off the rim.
- `trooperHeadPartialTop`: the crown and upper face gone from under the eyes in front to high on the back; jaw and
  snout left. Skull plates with the hood still on them standing open round the rim like petals, the brain folded and
  bulging in the bowl, scalp flaps peeled back over the sides, an eye hanging over the snout, blood in the lip of the bowl
  and run down the snout.
- Both: the cut face in layers by depth (burned hood, fat, meat, a bone band, dark wet inside), the hood scorched round
  the hole and blood run down from it in streaks, the brain's folds in the shape and its painted sulci.

**How it is made.** The whole Trooper is built as for his own bake, the edits on his head and neck that reach a box round
the head are kept, each clipped to it (`headOnly`), a jagged signed-distance cut (`torn`: a plane broken up by fbm and
ridged noise) takes the missing part with a layered flesh material on what it exposes, and the inside is put back as
edits with their own materials: a skull shell broken on its own jagged line a few millimetres proud, splinters, the skull
hollowed, the brain, blood, eye, jaw, flaps. The model moves to the head bone's origin, as the helmet does. 7000
triangles and a 1024 atlas each; about a minute and a half each at full quality (`nice npm run bake --
trooperHeadPartialSide trooperHeadPartialTop`), 17 s with `--draft`.

**At runtime.** `gore.init` loads both props through the library's `prop()`. On a partial wound `partialHead` picks the side
variant when the round runs within `PARTIAL_SIDE` (0.55) of the head's sideways axis, mirrored (scale X -1) when it came in
from his right, so the side facing the shooter is the one gone, and the top variant otherwise (face, back, above). It
mounts a clone on the head bone with `Character.standIn`, which collapses that bone's bind inverse for this body alone:
his head's skin and interior fold away, but the bone stays, so the stand-in follows the ragdoll, the head is still hit
on the corpse, and a later burst or shot-off takes it (a severed head carries a clone of it). The helmet is thrown by
`damage.ts` as in step 1; one with no plate to throw is hidden with the skin. Step 2's flying pieces and blood are kept.
On reset the shared inverses come back and the stand-in is dropped. `?headpartial=0` still bursts everything.

**Checked.** Sandbox `scenario=headpartial&arch=trooper` with `tools/scripts/headpartial-shots.mjs` (close-ups round both
heads, 10 and 18 m; `HP_CHECK=1` bursts the left head and shoots the right one off as a corpse, then resets: the
stand-ins hide with the head, the severed head carries one, reset drops it). Live on `/?map=range&contract=outpost`, a
severe round through the helmet mounts `trooperHeadPartialSide`. Screenshots in `tools/out/headpartial2/`,
`contact.png` first.

**Rough.** The stand-in has one level of detail. A body that lands face down still hides the wound. At 18 m it reads as
a red and pink broken head rather than in detail. The skull plates are small and read mostly from above. The neck's seam
under the stand-in is hidden by the hood but is not modeled.

**Step 3 this way** (Gunner, Husk, Brute): two bakes per enemy, `<arch>HeadPartialSide` and `<arch>HeadPartialTop`, each
`partialHead(<arch>, <builder>, sideBlown | topBlown)` plus an entry in `PARTIAL_HEADS`. The wreck code is shared, but its
measurements are the hooded Trooper's (`HOOD_C`, `SKULL_C` and the cut planes in head space), so each needs its own skull
and cut placed for its head: the Gunner's high collar, the Husk's bare face, the Brute's small head in a gorget and
visor. About a round or two of screenshots and three or four bakes per enemy.

## Step 3: the Gunner, Husk and Brute (2026-11-14)

Built the Trooper's way: two baked props each, `<arch>HeadPartialSide` and `<arch>HeadPartialTop`, with the same cut
planes, rim, splinters, folded brain, hanging eye and jaw, flaps and blood. `PARTIAL_HEADS` names all four.

**What was refitted.** The wreck's measurements moved out of constants into `fitFor(def)` in `headWreck.ts`: the outer
crown and lower face the cut face is layered against, the skull (the brain is sized from it), an optional outer shell, a
palette, and what hangs off the side variant. The Trooper's numbers are unchanged, so his props did not need a rebake.

- **Gunner**: the Trooper's hood without the respirator, so the same fit and no filter. His high collar is on the chest
  bone, so it stays on the body and hides the hanging jaw from the front; the bucket helm is thrown as a plate when he
  wears one, or hidden with the head by `standIn` when it is only the prop (checked live: the prop goes invisible).
- **Husk**: fitted to `humanHead` (gaunt), skull closer under thin skin. Undead palette: dried brown-red meat with grey
  and green mottling, yellowed bone, a grey brain with dark folds, thick dark red-brown blood, a dry crust round the hole
  in place of the burn, and flaps of his blotched grey skin. The eye hanging on its nerve glows his accent green, and a
  bar of his iron jaw cage hangs bent with the broken jaw.
- **Brute**: his hood at 0.92 inside a solid iron mask. The cut face shows a band of dark iron with a bright sheared edge
  outside the hood layers, and his flaps and skull plates are iron outside. His gorget is on the chest and stays; his head
  plate is thrown by `damage.ts` as before.

**Checked.** Sandbox `scenario=headpartial&arch=<gunner|husk|brute>` with `tools/scripts/headpartial-shots.mjs` (now waits
for that archetype's two props). Live on `/?map=range`, a severe (60) rifle round to the head of each mounts its stand-in
(Gunner and Brute from the front: the top; Husk from the side: the side). Screenshots in `tools/out/headpartial3/`,
`contact.png` first (each enemy: top variant front, three-quarter, side and 10 m, then the side variant the same).

**Rough.** As step 2b's. The Gunner's collar hides most of the hanging eye and jaw from the front. The Brute's torn iron
reads as a dark band more than as bent metal; his skull plates show their bone side from the front. The Husk's cage bar
is small at range.
