# Owner brain dump, playtest round 3

Owner's decision: **Euphoria is dropped for now.** One small batch runs first: headshot fix, spawn menu, blast rings and armour. All the human work then ships together as the campaign mission in docs/DESIGN.md section 22.

Things they like: muscle-driven ragdolls ("look really good"), blood decals ("really awesome"), the core system.

The feeling to chase: "it could be, there's something missing... not as good as it feels." GTA IV, Red Dead and Killing Floor feel weighty. That is the bar.

## Ragdolls and bodies

- Hard transitions between animation and ragdoll are still visible.
- Wants real Euphoria-style behaviour, interwoven with the wound system: half ragdoll, half animated.
- Running into enemies only staggers them. Should be able to truly knock them over, then watch them fight to get back up.
- **Headshots feel worse.** The head pops, then a stagger animation plays. A well-placed headshot should drop them like a sack of potatoes, with no unnecessary animation to sell it.
- Non-fatal headshots, especially shotguns, must always knock them over.

## Explosions

- Only enemies inside the fireball should gib.
- Around it, a mix: on fire, loses an arm, or an arm and a leg, head bursts, multiple limb damage, ripped in half at the waist. Not their whole torso exploding every time.
- A grenade into a crowd should leave a varied scene: some gibbed, some partly blown apart, some burning.
- Explosions should throw ragdolls forcefully, including survivors, who then have to get up.
- Shotguns can tear bodies in half at the waist.
- Armour and shaped charges: rockets and the autocannon do more direct-hit damage to armoured opponents and ignore armour on a direct hit, but less splash damage to them. Unarmoured opponents get ripped apart as normal.

## Humans

- Do not feel smart. Not tricky. Not intimidating on their own; only dangerous mixed in with zombies. The owner got further against humans than zombies. Humans should feel like the elevated, sophisticated opponent, even when they get scared.
- The Kill House does not suit them: lots of cover, hard for them to shoot the player, cannot set up ambushes.
- Reference: F.E.A.R.'s AI.
- More human bosses. Tanks and choppers are planned but not built.

## Surrender

- Too easy and forced. They take one shot and throw their hands up mid-firefight, when the advantage has not even shifted.
- More common in low-level soldiers. Elite and specialist soldiers rarely do it.
- Needs interactivity. Today you can only kill them, and that can be underwhelming because they tank a shotgun shell, stay kneeling and wait, even with an arm blown off.
- Shot and survived while surrendered: they run, because the surrender was clearly refused.
- Leaving surrender: if allies arrive and start shooting, they rejoin the fight, or use the distraction to flee for the exit.
- Out of sight and feeling safe: chance to pick up a weapon and fight again.

## Testing

- Dev panel: grant yourself kill combos, perks, streaks and summons, or add them to the inventory.

## Lead's proposals (owner has not approved these)

- Powered ragdoll, balance controller and behaviours as three layers. Real human motion from a licensed mocap library.
- Headshot fix is small and could ship first.
- A real Outpost map built for human tactics, rather than the Kill House.
- F.E.A.R. lessons: squad planner, narrating barks, loops and flanks in the level, aggressive pushing.
- Reduce "speed is armour" for humans, so that moving fast does not make them harmless.
- Surrender rank, conditions and a state machine; prisoners as interactive: grab as a shield, interrogate, or let go.
- Blast rings: fireball, maim, knockdown, with a random outcome roll per body.

## Open questions

- "the zombies should be the scary guys": read as a slip for "the humans". Confirm.
- Earlier the owner said forces looked ridiculous; now wants forceful explosions. Plan: bullets stay modest, blasts get stronger.
