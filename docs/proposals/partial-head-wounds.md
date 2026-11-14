# Idea: partial head wounds instead of clean decapitation

Status: step 1 built on 2026-11-14 (the rules, the Fallout burst kit, pellet counting on the head, the helmet thrown
off). The hook for step 2 is `headOutcome` in `src/enemies/damage.ts`, which already answers 'partial' for a severe
headshot on the Trooper, Gunner, Husk and Brute; `gore.headshot` bursts a 'partial' until step 2 builds it. Not done in
step 1: the full Lance is not in the very damaging tier (nothing tells a full beam from a ball in `DamageInfo` yet).

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
