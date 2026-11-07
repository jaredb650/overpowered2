# The Outpost: what a person has to judge

Bots have played this mission from the film to the end screen. A bot can say that a beat fires, a gate opens and a jump can be made. It cannot say that any of it is fun, fair or frightening, so this file is the list of what only you can answer. `docs/campaign/MISSION.md` is the plan.

## Getting anywhere

Campaign on the menu plays from the top. To go straight to one beat, add `&beat=<id>`, which gives you the kit and the doors that beat should have. A win reached that way does not unlock anything.

```
/?contract=campaign&autostart=1&beat=coolant
```

Beat ids, in order: `briefing` `insertion` `lockout` `softskins` `breather` `heavy` `wreck` `turn` `breach` `barracks` `coolant` `gallery` `mess` `armoury` `plates` `stack` `commander` `ending`

`?unlock=1` opens Endless Humans without a win. `/?contract=outpost&autostart=1` is Endless Humans straight away.

## Test these first

In this order, because the first ones are where a bad answer costs the most.

1. **`commander`. Is a man who stands still a last boss?** He no longer chases, because every way of moving he had took him out of his arena. A bot with perfect aim killed him in 16 s, so one hit now takes half as much of him as it did. The plan says 2:45. Say how long it took you and whether it felt like the peak of the mission.
2. **`mess`. Does the ambush scare you or just kill you?** Ten men, and a bot standing in the open took over 1,100 damage in half a minute. The floor now springs on "Now." and the sides 1.5 s later. If you die before you can read the room, it is too hard. If you never feel caught, it is too soft.
3. **`turn`. Can you find and kill everything?** Tanks and the chopper now carry a red marker. A tank takes 5 direct rockets on the hull, and the launcher holds 11. The rest is on the apron, as yellow squares on the minimap. Say whether the walk for rockets is a good beat or a chore, and whether the chopper can be hit by a person. A bot leading it hit twice in 12 s.
4. **`heavy` into `wreck`. Can you cross the apron?** About 70 m under two tanks, a tower gun and four men, then a double jump at the hull. This is the fight most likely to repeat your round 4 complaint.
5. **`softskins`, again.** It has been softened since your last go and no person has played it since.
6. **`coolant`. Is the gap fair?** One dash only crosses from the last metre of the lip. Both dashes cross from 4 m back, so the hint now says to press both. The hall is dark: say whether you can judge the jump.
7. **`breach`. The wreck and the door.** You climb over Bulwark's wreck, and the blast door starts to shut as you come down off it. A bot got under it first go. Say whether a person does, and whether you knew you had to climb.
8. **`barracks`. Is the dark frightening?** This is the mood turn, and a bot cannot be frightened.
9. **`plates`. Does the armour lesson land?** Try a rocket on the floor by the line, then one on a chest.
10. **`gallery`.** It swept well: about three in four of a wide spread of timings got across. Say whether the hint reads.

## Known rough edges

- **Mission progress is not saved.** Quitting or reloading starts again from the briefing, on a mission of 20 to 30 minutes. A Continue on the menu is the obvious next piece.
- **Suppression is heavy in the open.** Under fire on the apron most of the screen blurs and goes red. A bot stands still, which is the worst case, so judge it moving.
- **Lone men are marked through walls.** At three or fewer left, each gets a red marker. That is useful, but it also gives away the Coolant sniper, and for a moment the first men into the dark barracks.
- **Men left behind stay behind.** The sniper and any prisoner who re-arms past a gap remain on the map and on the count for the rest of the mission. They hold nothing up.
- **A wreck from a restart still has its turret.** After a death in `breach` the gate's wreck is whole, so it takes one more jump to cross than the one you blew up. It used to lie end on in the gate after a restart, so there was nothing to climb. It now lies across, as it died.
- **A stuck man would hold a beat.** `mess` and `plates` wait for everyone. No bot run stuck, but Restart from checkpoint on the pause menu is the only way out if one does.
- **The Commander's box still covers the lower middle of the screen** for up to 14 s in `breather` and `armoury`. It now waits for the radio and closes when the next fight opens.
- **Placeholders:** doors are hazard paint, racks are glowing bars, and the launcher on the deck is not the shape of a launcher. The pilot has no voice.

## Balance guesses

All of these are numbers nobody has felt.

| What | Now | Where | Why it might be wrong |
|---|---|---|---|
| Commander's largest hit | 2.5% of him | `STAGED_MAX_HIT`, `person.ts` | Set from a bot's time, not a person's |
| Ambush gap between floor and sides | 1.5 s | `mess` in `outpost.ts` | Long enough to move, perhaps not to react |
| Ambush wait after entering the kitchen | 5 s | `mess` in `outpost.ts` | A runner reaches them first, which breaks it at arm's length |
| Rockets, and rockets on the apron | 11, then 2 pickups of 5 every 20 s while under 3 | `weapons/data.ts`, `turn` in `outpost.ts` | Tanks and the chopper need about 17 direct hits |
| Tank | 1,000 health, 60 damage shell every 5.2 s | `vehicles/data.ts` | Two at once may be too much at conscript grade |
| Chopper | Presses 9 to 13 s, about 25 damage a second on a man standing still | `vehicles/data.ts` | Adds to everything else in `turn` |
| Wreck fire | 16 damage a second, 45 s on a tank | `wreck.ts` | Standing still by a truck wreck cost a bot 280 in the breather, so stopping where you fought can kill you in a breath |
| Threat levels | 1, 2, 4, 5, 6, 7, 8, 9 | `threat` steps in `outpost.ts` | Set by reading, not by playing |
| Replacement fee | 10% of the score | `REDEPLOY_FEE`, `host.ts` | Harmless if it stings, wrong if it stops people retrying |

## What the bots proved

`tools/scripts/mission-play.mjs` plays on the real keys at Retina size. It got out of the cut, up the hull, over the wreck, under the door, across the Coolant Hall and along the gallery on its own, with no help, and reached the end screen with no console errors. With `PLAY_DIE=1` it died in every beat from `lockout` on and each checkpoint gave back the right place, kit and doors. Frame rate held near 60 for the whole mission on the M1, with a headless browser at low priority.

Not yet run after the last changes: the retuned Commander fight to its end, the restart wreck climbed with a second jump, and a second playthrough past the armoury. The first two runs stopped on their time limit on a loaded machine, and the second playthrough's earlier stop was the bot's queue of skipped speeches, now hushed.

What it did not prove: it stands still to shoot and has perfect aim, so its times and damage are a measure of the fire in a beat and not of its difficulty. It usually needed a dev skip to finish the tanks, because it picks bad firing lines. Rockets themselves were measured apart from it.
