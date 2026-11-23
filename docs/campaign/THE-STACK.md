# THE STACK — mission sketch

Status: **sketch agreed with the owner, 2026-11-22. Nothing built yet.** Next step: a full plan like `DESERT-RAID.md`, then
the full script for the owner's OK before any building starts.

## The idea

A vertical slum of tower blocks welded into one solid mass: no daylight, wires everywhere, a fight on every floor. **Night,
rain, solo infiltration.** You go in alone to take down a brain chip dealer and leave with every piece of tech he has.

Inspired by the walled-city feel, but it's our own place, not a recreation of a real one.

## The place: the Stack

- Hundreds of illegal buildings grown into one block. Corridors a metre wide, stairs inside stairs, homes built on homes,
  dripping pipes, cable bundles as thick as an arm, flickering signs (no real brands), rain coming down through gaps.
- **Vertical:** start at street level and fight upward. The ground floor is wet, dark and crowded; the roof is a forest of
  aerials under an open night sky.
- **Thin walls:** plaster and sheet metal you can shoot through and kick down. It's the Desert Raid destruction kit
  indoors: you cut your own way between flats.

## The villain: Juno Rask, "the Wirer"

- Sells **black-market brain chips** out of a back-alley clinic and puts them into people himself. Half the Stack is
  chipped and owes him.
- **Wired into the whole building:** every light, lock, lift and camera is his. He watches through the cameras and talks
  over the speakers and through his enforcers' mouths.
- **His big move: he pushes updates to his men mid-fight.** "Pushing Thermal to floor nine." Suddenly those enemies see you
  through walls. Later Focus (faster) and Sonar (they know where you are). It's visible and audible: their eyes light up
  and a sound plays. It forces you to change how you fight.
- Arrogant, fast-talking, thinks he's an artist. Chipped to the eyeballs himself.
- **His own model.** A human-sized person, not a monster, with his own look: wired, scarred, lit up where his chips are.
- **A real boss fight:** hard to fight, a lot of health. He's fast and uses his own chips against you (Gun Kata style
  shooting, slow-mo bursts, maybe seeing you through walls). Note: in co-op any slow-mo has team rules (`docs/notes/coop.md`),
  but this mission is solo.

## The job

- Take Rask, and **steal all his tech**: three stashes of prototype brain chips hidden in the Stack, plus the one in his
  head.
- **The brain chips are rewards for finishing the mission**, not powers during it. Each one you take unlocks in
  Procurement when the mission is done.

### The reward brain chips

| Where | Brain chip | What it does |
|---|---|---|
| Rask's head | **Overclock** | Reloads and melee at double speed for a few seconds. |
| Stash 1 (the Corridors) | **Puppet** | Take over one enemy for a few seconds; he turns and fights for you, then drops. |
| Stash 2 (the Clinic) | **Ghost** | Enemies lose track of you for a few seconds; it ends the moment you fire. |
| Stash 3 (the Roofs) | **Static** | A short pulse that stuns everyone near you and kills nearby lights and turrets. |

- Overclock comes from Rask **however the fight ends**: removed alive (his head explodes), pulled from his body if he
  was killed in the fight, or taken out later if he was captured.
- A stash you miss can be picked up on a replay.
- Spare idea, unused: **Afterimage** (a dash leaves a decoy that draws fire for a moment).
- Every one needs the full brain chip checklist (shop row, cheat-panel row, test, viewmodel, co-op, notes), as in
  `CLAUDE.md`. In Endless Humans, shop items must unlock before round 10.

## The route

1. **The Way In.** Street level, rain, crowds. Force the gate, fight up the first stairwells. Rask, amused: "A tourist.
   Fantastic."
2. **The Corridors.** A tight maze of flats and tiny shops. Fights at point-blank range: shotgun and melee heaven,
   shooting through walls. **First stash (Puppet).** Rask cuts the lights and pushes Thermal to his men, so it's you in the dark
   against people who can see you.
3. **The Clinic.** His operating floor: chairs, jars, bodies with open skulls. Gross, gory and quiet, then his best
   chipped enforcers come in. **Second stash (Ghost).**
4. **The Shaft.** A big open lift shaft through the middle of the building. He drops the lift on you, and you climb by
   wall run and jumping walkway to walkway as walkways collapse. Enemies fire from every level around you.
5. **The Roofs.** Open air at last: aerials, washing lines, rooftop shacks, rain. Run and fight across them with big gaps
   between buildings; a low-flying cargo shuttle roars overhead. **Third stash (Static).**
6. **The Vault.** His penthouse server room, packed with racks and blinking lights. The boss fight. When he's beaten he
   drops to his knees, and the player gets two choices:
   - **Capture** (hold E): zip-tied, carried out.
   - **Remove brain chip:** the prompt doesn't say it will kill him. You pull it, **and his head explodes.** No warning.
   - If he dies in the fight instead, you can still **pull the brain chip from his body**.
7. **The Exit.** With him down, the Stack hunts you. Fight down to a rooftop pickup; a helicopter door gun cuts through the
   windows on the way out.

## Set pieces that force a way of playing

- Lights cut plus Thermal pushed to his men: you hunt in the dark.
- A floor goes on lockdown and every door seals: you cut your way through the walls.
- The lift drop: the Shaft becomes a pure parkour climb.
- Updates pushed to his men: the enemies keep changing under you.

## Decisions (owner, 2026-11-22)

- Rask's brain chip is **Overclock**.
- **The stash brain chips are rewards for finishing the mission**, not powers during it.
- **Night and rain.**
- **Solo infiltration**, no squad.
- Ending: **capture, or remove the brain chip**, which kills him (his head explodes) without telling the player first.
  If he dies in the fight, **the brain chip can still be pulled from his body**.
- Rask has **his own model**: human-sized, hard to fight, a lot of health.

## Open questions

1. Are Puppet, Ghost and Static the right three stash brain chips? (Proposed, not yet approved.)
2. Once unlocked, are the new brain chips in Procurement for every mode, or only some?

## What it will need (guesses, the code hasn't been checked yet)

1. A tall interior map: corridors, flats, the clinic, the lift shaft, roofs, the vault.
2. Indoor thin-wall destruction (shares the Desert Raid destruction kit).
3. Rain and night lighting; Rask controlling lights, doors and the lift.
4. Enemies that change mid-fight when Rask pushes an update (Thermal, Focus, Sonar), visible and audible.
5. Rask: his own model, boss health, his own brain chip moves.
6. The ending: capture, or remove brain chip with the head explosion.
7. Four new brain chips (Overclock, Puppet, Ghost, Static), unlocked in Procurement by finishing the mission, plus the
   three stash pickups in the level.
8. Exit with a helicopter door gun.
