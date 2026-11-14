# Idea: partial head wounds instead of clean decapitation

Status: idea, pinned by the owner on 2026-11-14. Nothing here is built or costed.

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
