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
