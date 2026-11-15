# Proposal: squad chatter

Status: proposal, 2026-11-15. Written from the owner's notes, after research (section 2) and a read of the code as it is (section 3).
Nothing is built. Open details are marked **Q** with the default I would pick; the ones only the owner can settle are in section 12.

## 1. The goal

Human enemies should feel like people having a very bad day. They see you, tell each other, make a plan and say it out loud, then
carry it out. They notice how you fight ("it's fast, I've lost it"), get cocky when they hurt you, swear when you hurt them, and
shout their friend's name when you kill him. They remember you: break contact, come back, and someone yells "it's back". The one
carrying the radio ties his squad to the rest, and if you kill him that squad goes deaf. A man bleeding on the floor begs when you
point a gun at him, or swears at you, or pulls a pin and tells you so. Funny on top, bleak underneath, like the rest of the game.

Phase 1 is text: a small bubble over the speaker's head and the same line in the comms feed. Phase 2, later and only when the owner
says so, voices every line with a TTS model.

## 2. What the good games do (research)

Architecture and mechanics only. Every line in this doc is ours.

| Game | How it works | What we take |
|---|---|---|
| **F.E.A.R.** (Jeff Orkin, "Three States and a Plan", GDC 2006) | A planner per soldier and a squad layer that runs one squad behaviour at a time. Flanking was not built: it falls out of soldiers routing to the only cover left. **Barks are picked after the decision**: the squad layer looks at what was chosen and finds a matching exchange between two men ("flank him" / "moving"). The last man alive asks for reinforcements that do not exist, and players read the next enemies they meet as the reinforcements. Its lesson from the postmortem: dialogue hand-wired outside the planner asked a dismembered man for his status | Our squads already work this way (`planner.ts`). Add the two-man exchange, and let lines check the speaker's state so we never make that mistake |
| **Left 4 Dead** (Elan Ruskin, "AI-driven Dynamic Dialog through Fuzzy Pattern Matching", GDC 2012) | One query of flat facts (concept, who, his state, his memory, the world's). A rule is a list of criteria that must all pass; **the rule with the most criteria wins**, ties at random. A rule can write facts back ("said this") with expiry times, which are the cooldowns. A follow-up is broadcast and the best match nearby answers. A reply is looked up when it is due, so a conversation ends itself if things changed | The whole of section 5 |
| **The Last of Us Part II** (Naughty Dog, interviews) | Every human enemy has a name; friends cry it out when he dies. A "vague awareness" state between unaware and combat ("came from over there"), and searchers never fully relax. Dogs track by scent, each with a handler. The Seraphites whistle to each other | Names (4.7). Vague awareness we already have as heard-not-seen. No dogs; the radio is our whistle |
| **The Last of Us** (Travis McIntosh, via AI and Games) | A combat coordinator hands out capped roles: one investigator, flankers, approachers, opportunistic shooters. The player's last known position and its time are shared with nearby men | Our teams and drills already do this |
| **Halo** (Butcher and Griesemer, "The Illusion of Intelligence", GDC 2002; Damian Isla, GDC 2005) | Dialogue is driven by decisions and stimuli, filtered by priority, context, uniqueness and relevance, and nearby men can reply. Halo 1 shipped 5,147 lines over 12 voices. Each AI has a breaking point. Grunts flee when their Elite dies, and **it had to be exaggerated** (screams, a line saying so) because half of testers missed it. In playtests the same AI was called "very intelligent" by 52% when it was weak and by 92% when it was tough | Make the fear loud. Lines are what make the brain visible |
| **Splinter Cell Blacklist** (Martin Walsh, GDC) | Barks are tiered from generic to specific ("saw something" up to naming exactly what). Guards answer or wave each other off, and notice when one of them is missing | Generic rows always exist and specific rows win (5.1) |
| **Killzone** (Guerrilla, GDC Europe 2005) | Positions scored by weighted sums; routes cost more under fire; suppression aimed where a hidden player could be | We have this in `cover.ts`, `routes.ts` |
| **Arma** (Bohemia wiki, `allowFleeing`) | Morale belongs to the group: it flees when losses pass strength times the leader's courage | Squad nerve (4.4) beside our per-man morale |

What these share, and what this proposal is built on:

1. **Decide first, then say it.** The line comes from the decision, never the other way round.
2. **Say it as two men.** A call and an answer reads as men who understand each other, and it costs one more line.
3. **One rule table for all speech**: facts in, the most specific rule out, memory written back.
4. **Exaggerate.** A subtle reaction is a reaction nobody sees.
5. **Make losses personal.** A name and a grief line per man.

Sources:

- Orkin, "Three States and a Plan" (paper): https://pages.cs.wisc.edu/~dyer/cs540/handouts/gdc2006_orkin_jeff_fear.pdf. Talk: https://gdcvault.com/play/1013394/Three-States-and-a-Plan
- Orkin, "Combat Dialogue in FEAR: The Illusion of Communication" (Game AI Pro, preview): https://www.oreilly.com/library/view/game-ai-pro/9781482254792/K23980_C002.xhtml
- Ruskin, slides with notes: https://cdn.fastly.steamstatic.com/apps/valve/2012/GDC2012_Ruskin_Elan_DynamicDialog.pdf. Vault: https://gdcvault.com/play/1015528/AI-driven-Dynamic-Dialog-through. Summary: https://emshort.blog/2012/03/16/gdc-2012-talk-on-dynamic-dialogue/
- The Last of Us Part II: https://gamingbolt.com/the-last-of-us-part-2-every-enemy-you-kill-will-have-a-name, https://ungeek.ph/2020/06/how-naughty-dog-made-enemies-smarter-in-the-last-of-us-2, https://www.psu.com/news/the-last-of-us-part-2-dev-reveals-how-it-improved-enemy-ai-for-the-sequel/ (dogs and whistles rest on press reports only)
- The Last of Us: https://www.gamedeveloper.com/design/endure-and-survive-the-ai-of-the-last-of-us
- Halo: https://www.jmeiners.com/shamans/papers/ai/the_illusion_of_intelligence.pdf, https://www.halo.bungie.org/misc/gdc.2002.haloai/talk.html?page=19, https://gamedeveloper.com/programming/gdc-2005-proceeding-handling-complexity-in-the-i-halo-2-i-ai
- Splinter Cell Blacklist: https://gdcvault.com/play/1020195/Modeling-AI-Perception-and-Awareness, https://gamedeveloper.com/design/bringing-balance-to-stealth-ai-in-splinter-cell-blacklist
- Killzone: https://www.guerrilla-games.com/media/News/Files/gdce05_killzone_ai.pdf
- Arma: https://community.bistudio.com/wiki/allowFleeing

Not found in primary sources: Metal Gear Solid V's radio checks and command post, Shadow of Mordor's nemesis memory, Crysis, Hitman, Days Gone, Ghost Recon. They are left out rather than guessed at.

## 3. What we have today

More than the ask assumes. The Outpost's squads already narrate their drills, and the wounds update gave the hurt men their voices.

| Piece | Where | What it does today |
|---|---|---|
| Squad brain | `src/enemies/outpost/squad.ts`, `planner.ts` | F.E.A.R.-style: facts as bits, four goals, a cheapest-chain search over 12 drills (search, base of fire, flank, cut-off, frag, flash, breach, rush, ambush, retreat, regroup). Thinks twice a second |
| Narration | `squad.ts`, `comms.ts` | Every drill announces itself as it starts ("It's running! Cut it off!"). The Commander's orders are only spoken if the drill is really in the plan (`squad.obey`) |
| The mouth | `src/enemies/outpost/comms.ts` | 43 kinds of line, 3 to 5 texts each. Per-kind gap (`KIND_GAP`), 1.3 s between any two lines side-wide (`LINE_GAP`), `URGENT` kinds cut in, never the same text twice running. A lung or throat wound mutes a man; an ambush silences him; the Commander's radio silence takes the disciplined kinds off the air |
| Lines on screen | `ui/Hud.ts`, `ui/hud/feed.ts` | `comms:line` goes to `CommsFeed` (4 lines, 6 s). Fear kinds show amber, allies `--friend` green, the rest `--cold`. Speaker is `Cpl Alpha-2` |
| Lines in the air | `comms.ts` | A synth grunt from the body (`vox_scream` or the archetype's attack voice). No words |
| Sight and hearing | `outpost/perception.ts` | A man needs a clear line, the right facing and time (`notice`). Gunfire carries 42 m with 18% error. Footfalls and landings are heard (`listenToFeet`) |
| Shared knowledge | `perception.ts` `Intel`, `squad.report/adopt`, `index.ts` `radio` | A sighting goes round the squad at once and to every other squad 1.2 s later (`RADIO_DELAY`), one report in flight. After 6 s of nobody knowing, Command's thermal "fix" hands everyone a position within 5 m |
| What the men read of the player | `index.ts` `track`, `stillFor`; `squad.trail` | Lagged velocity (the eye), seconds standing still, reload, blinded, under 40% health. These set facts (RUNNING, CAMPING, OPENING) the planner uses |
| Morale | `outpost/morale.ts`, `index.ts` `tickMorale` | Per man 100 to 0: steady, shaken (60), panicked (35), broken (12). Global Dread 0 to 100 lifts the bars. Losses come from friends dying near (worse if gory), the leader dying, executions, wounds, near misses, screams, running dry, the player close, perk spikes. A squad that loses 60% inside 7 s breaks |
| Near misses | `EnemyManager.ts` `NEAR_MISS_RADIUS` 2.2 m | Raises `e.pressure`, which costs morale, makes men hug cover and peek less (`behaviours.ts`). No visible flinch of its own |
| Surrender, flight | `outpost/prisoners.ts` | Five signs weighed against rank. Broken men run or give up; a shot prisoner refuses for good; prisoners rearm, are questioned once (E: true or a lie), freed or cuffed for the drone |
| The wounded | `src/enemies/wounds/` | Mortal and downed men crawl to cover, scream to bring help, `dying`, `beg` (on the floor, in sight, within range), `scream`, `rescue`. 45% get a last stand: a sidearm, or a grenade dropped with "You're coming with me!" said as it drops |
| Aim read | `EnemyManager.ts` `e.aimedAt` | Seconds the player's crosshair has been on him with a line. Used today for nothing chatty |
| The Commander | `src/enemies/commander/lines.ts`, `orders.ts`, `tracker.ts` | Every line keyed, with a `Speaker` and an `Emotion`, exported to `docs/voice/` by `tools/scripts/voice-script.ts`. His notebook counts the player's habits per wave and per run. His `radio` unit (a man who delays call-ins until he dies) is the one precedent for "kill him to cut the line" |
| Foreclosure's war | `src/campaign/war.ts`, `missions/foreclosure.lines.ts` | Both sides' call-outs as keyed text rows (`CALLS`): Bailiffs in green under their unit ("Rifleman, 9th Recoveries"), Holdfast in cyan. Within `EARSHOT` (140 m) only, 2.6 s apart. Never spoken |
| Allies | `src/allies/`, `contracts/defense/radio.ts` | Bailiff soldiers fight beside you. They have no lines of their own; the fort's garrison radio calls their man down and dead |
| Voice playback | `src/ui/commander/voice.ts`, `public/audio/voice/` | 999 recorded clips (102 MB, ElevenLabs), listed in `manifest.json`, played 2D through an `<audio>` element. An unlisted line stays text |

**What is missing**

- **Who says what is hard-wired.** A call site picks a kind and the line is random from its pool. Nothing looks at who is talking
  (rank, role, faction, how scared he is), who just died, or what the player is doing. A veteran and a conscript say the same thing.
- **Nobody has a name.** `Alpha-2` cannot be shouted when he dies.
- **One radio for the whole side, and it never breaks.** Every sighting reaches every squad. There is no radioman to kill.
- **The player is read for tactics, never for talk.** Fast, still, on a kill streak, hurting them: none of it is said, except "it's
  hurt" under 40% health. Nobody gets cocky. There is no state above steady.
- **No memory of the player.** Losing contact and finding it again is just another "Contact!".
- **Lines are not spatial.** Everything is the feed. You cannot see who spoke, and a shout 80 m away reads the same as one at 5 m.
- **Lines have no stable ids.** `comms.ts` rows are array positions, so phase 2 has nothing to name files by.
- **Begging ignores the gun.** It fires on range and line of sight, not on being aimed at.
- **The last-stand grenade is announced as it drops**, which is too late to be a warning.

## 4. The shape of it

Five parts, all in `src/enemies/outpost/` beside the code they read, and no three.js in the rule matcher so it can be tested like
`planner.ts` and `morale.ts`.

| Part | New file | Job |
|---|---|---|
| The read | `read.ts` | What the side knows about the player as numbers: the blackboard |
| The radio | `radio.ts` (the existing `index.ts` radio moves here) | Radiomen, which squads are linked, what travels and how late |
| Nerve | `morale.ts` (extended) | A confident state, squad nerve, and what each state unlocks |
| The rules | `chatter/rules.ts`, `chatter/lines.ts` | Criteria-matched lines, memory, cooldowns, who may speak |
| The bubbles | `src/ui/hud/bubbles.ts` | Phase 1 on screen |

`comms.ts` stays the one mouth: every call site keeps calling `say(kind, s)`, and `say` asks the rules instead of a random pool.
The kinds become the rules' concepts, so nothing that calls it today changes.

### 4.1 The read (the blackboard)

One per side, on `Outpost`, updated on the 0.25 s morale tick from what the code already measures. Squads keep their own copy of
the position (`threat`, `knownAt`, `seenAt`, as now); the read is about how the player fights.

| Fact | From | Feeds |
|---|---|---|
| `speed` (eye-lagged, 3 s mean) | `track.speed` | "fast" lines, lost-contact lines, cut-offs |
| `still` seconds | `stillFor` | "pinned" lines, frag and flash (as now) |
| `killsRecent` (last 10 s) and `streak` | `enemy:killed` by the player | fear lines, "what are you" |
| `hurtRecent` (damage dealt to the player, last 8 s) and `healthShare` | `player:damaged`, `player.health` | confident lines, taunts |
| `contacts`, `lostAt`, `lostFor` | squads' `seenAt` going stale | "you again", search lines |
| `heading` (8-point compass, north is -z) | `track.velocity` at the moment of loss | "heading south" on the radio |
| `weapon` class, `height`, `inside` | the player, the map | flavour ("it's on the roof", "shotgun, keep back") |
| `deathsSeen` | the player's death with soldiers alive in sight | "didn't we kill you?" after a redeploy |
| `prisonersHeld`, `executions` | prisoner events | "it shoots prisoners" |

The Commander's `tracker.ts` already counts habits per wave and per run. The read is the fast, seconds-long version of it; the two
stay separate because the Commander's books are about waves.

### 4.2 The radio network

**One radioman per squad.** At spawn, the squad's first rifleman who is not the leader carries the radio (`Soldier.radio`). A squad
of one rifleman gives it to the leader. He wears a whip antenna on his back (a prop on the existing back socket; **Q**: art, default a
thin black rod and a box, baked like the helmets) and his feed lines carry a small radio mark.

**What travels over it**, each a typed message on a side-wide queue, delivered `RADIO_DELAY` (1.2 s, as now) later to every squad that
still has a radio:

| Message | Sent when | What the other squads do |
|---|---|---|
| `sighting` (position, seen or heard) | as `squad.report` today | `adopt`, as today |
| `heading` (direction, speed) | a squad loses a fast player (`speed` over 6 m/s) | Nearest linked squad with no contact gets RUNNING and the trail, so its planner picks `cutOff` for the exit ahead. "Bravo, it's heading south, cut it off at the gate" / "Bravo copies" |
| `casualty` (name, squad) | a man dies | Small morale hit on linked squads (half `FEAR.allyDown`), and a chance of "Charlie lost Novak" |
| `support` | a squad's nerve goes to shaken or it has lost half its men | Nearest linked idle squad gets goal `destroy` at that spot: reinforcements, announced both ends |
| `gone` | a squad breaks or dies | `squadGone`, Dread, as now; listeners' morale takes a hit |
| `fix` | Command's thermal pass | As today, but only linked squads get it |

**Kill the radioman** and the squad is cut off:

- `report` still goes round the squad at once (they shout), but not to anyone else, and nothing reaches it: no fixes, no headings,
  no support. It falls back on its own eyes and the `search` drill, which is exactly what happens when a player hides from it.
- A cut-off squad that comes within 30 m of a linked one can be heard: it hands over and takes what the other knows (shouting, no
  delay beyond a second). So the cut is real but not permanent, and a careful player keeps squads apart.
- The leader may send a man to the body for the set ("Get his radio!"): once per squad, only if the body is within 15 m and not in the
  player's view fan (`Intel.exposed`), the same reach-and-crouch the medics use (`assignAid`). The player can wait on the body.
  **Q**: default yes.
- The feed shows it: a cut-off squad's lines stop coming over the radio, and the death line says what was lost ("Radio's gone!").

The Commander's radio silence doctrine keeps working: data still travels, lines do not.

**Q**: should the player always hear the enemy radio? Default: yes, as the feed works now. Radio traffic is heard map-wide and marked as
radio. Shouts are heard only within earshot (40 m; `war.ts` uses 140 m for a battlefield). So killing a radioman takes his squad off your radio, which is the
feedback that it worked.

### 4.3 Perception events that feed it

Nothing new to sense. Chatter listens to moments the code already has, and a few are made explicit:

| Moment | Where it is today | Line it can drive |
|---|---|---|
| First sighting, re-sighting after `CALLOUT_GAP` | `squad.report` | contact; "again" when `lostFor` is long (4.6) |
| Lost contact | squad `inContact` going false | lost; "too fast" when `speed` was high |
| Heard, not seen | `hear` | noise |
| Near miss | `e.pressure` jumping by 0.3 in 0.5 s | flinch line and a short duck (see 4.5) |
| Friend down, ugly or not | `onKilled`, `FEAR.brutal` | the name (4.7) |
| Being aimed at | `e.aimedAt` | pleading, defiance, panic (4.8) |
| Player hurt, reloading, blinded | `seizeOpening` | opening, taunts |
| Player dies, redeploys | campaign `redeploy` | "didn't we kill you?" |

### 4.4 Nerve: morale per man and per squad

Keep `morale.ts` as it is and add one state on top, and a squad number.

| State | Bar (before Dread lifts it) | What it unlocks |
|---|---|---|
| **confident** (new) | morale over 85 and the squad winning: `hurtRecent` 25 or more, or the player under half health, or 2 to 1 in men in the fight | Taunts, mocking, bolder plans (`rush` priced 20% lower), longer peeks |
| steady | over 60 | Professional chatter, drills as now |
| shaken | 35 to 60 | Swearing, "where is it", hugging cover (as now), asking for support on the radio |
| panicked | 12 to 35 | Screams, "what are you", blind fire (as now) |
| broken | under 12 | Flee or surrender (as now), begging |

What raises it, new: dealing damage to the player (+6 per 20 damage, to the man who hit and his squad), the player going down to a
third of health (+10 side-wide), a reinforcement arriving (+8 to the helped squad), the leader near (as now), being two to one.
What lowers it is the existing `FEAR` table, plus a `casualty` over the radio at half weight.

**Squad nerve** is the mean of its fighters' morale, minus 15 with no leader and 10 with no radio. It picks who speaks for the squad
and how ("We can take it" or "We need to pull back"), and a squad at shaken asks for support. It does not replace the planner's goals:
`survive` already wins when a squad is hurt.

Confidence never reaches past Dread: a confident man's ceiling still falls as Dread climbs (`moraleCeiling`), so a rampage ends the
taunting by itself, and the switch from smug to scared is the payoff.

### 4.5 Announced tactics, carried out

The rule that already holds stays the rule: **a tactic is only said by the drill that is starting it**, so nothing is ever announced
that is not happening. What changes is the shape of the announcement: a call and an answer, spoken by the two men doing it.

| Drill | Call (who) | Answer (who) | Already executed by |
|---|---|---|---|
| `baseOfFire` + `flank` | Gunner, often the Brute: "I'll keep it busy. Go round" | Team 1's lead: "Going left" | `squad.ts`, team 0 holds the guns |
| `baseOfFire` on a still player | "It's pinned. Keep it there" | "Frag's coming" if the planner chose frag next | the CAMPING fact |
| `frag`, `flash` | the thrower: "Frag out!" | anyone: "Get down!" for a friend in range | `weapons.ts` |
| `cutOff` from a radio `heading` | radioman of the calling squad: "Heading south, Bravo" | Bravo's radioman: "Bravo copies, moving" | the RUNNING fact, set by radio |
| `retreat` | leader: "Fall back, by teams" | "Moving!" | `FALLBACK_*` |
| `regroup` | leader: "On me" | | as now |
| `search` | leader: "Spread out. Dennis, left side" (a name) | "Left side" | both teams, a beat apart |
| `rush` on an opening | anyone who saw it: "It's reloading! Go!" | | `seizeOpening` |
| support | shaken squad: "Charlie needs help at the yard" | helper: "On our way" | new, 4.2 |

The answer is a second concept sent 0.4 to 0.8 s after the call and looked up when it is due (Ruskin's trick), by a different man,
only if he is alive, not mute and not panicked. If the moment has passed, nobody answers, and no interrupt system is needed.

**Near-miss flinch.** A pressure spike while exposed plays a 0.4 s duck (the existing `cower` posture, then back) and can say "Close!",
"Shit!". It costs nothing in the brain: the man already peeks less under pressure.

### 4.6 Memory of the player

Per squad: `metAt`, `contacts` (how many times it has gained the player after losing him for over 12 s), and the names of its dead.
Per side: `deathsSeen`.

- Second contact: "It's back", "There it is again".
- Third and later, or with dead squadmates: "That's the one that got Marsh", "Not this time".
- After the player dies and is redeployed, men alive who saw it: "We killed you. We watched you die", "There's another one". This is the
  story's clone, said by the enemy, and it costs one fact.

### 4.7 Names

Every man gets a first or last name from his faction's pool when he enlists, never two alike alive at once. His friends shout it when
he dies ("Marsh! Marsh is down!"), when he is hit, when they send him somewhere ("Novak, left side"), and the radio reports it. The
leader's death names him too ("They got the sergeant", "Reyes is dead, I have the squad").

| Faction | Pool | Feed |
|---|---|---|
| The garrison (Outpost) | Short soldier surnames: Marsh, Novak, Okafor, Pike, Brandt, Sully, Hale... (16) | `Cpl Marsh · Alpha` |
| Holdfast militia | Dockside first names and nicknames: Big Teo, Ma Corran, Wick, Anya, Fitch... (16) | `Wick · Holdfast` |
| Bailiffs (allies) | Surname and a staff number: Grell 4471... (12) | `Grell, 9th Recoveries` |

**Q**: names or callsigns on the feed? Default: name, rank, squad, as above. The Commander's eight `NAMES` stay his.

### 4.8 The wounded

Most of this exists. What changes:

- **Begging reads the gun.** A downed or kneeling man whose `aimedAt` passes 0.5 s says something, and what depends on him:
  pleading (conscripts, the panicked), defiance (veterans, elites, the confident), cursing (anyone shaken). Once per man per aim, the
  pool spent before it repeats. **Q**: whether sparing a begging man should ever mean anything. Default: no new mechanic; the existing
  surrender, questioning and execution rules carry it.
- **The last-stand grenade warns.** Today the line goes out as the grenade drops. Instead: the line and the pin sound (`grenade_pin`)
  1 s before the drop, with his hand at his chest. A shot in that second stops it (he dies holding it, and it drops where he lies, as
  now). The warning is the point: the player reads it and acts.
- **The crawl talks.** A crawling man under his `screams` clock says one of "oh god" lines instead of only screaming, and a friend
  near shouts his name and "hold on" (the existing `rescue`).

## 5. The dialogue system

### 5.1 The rule table

Valve's design (section 2), cut to what we need. A line is a row:

```ts
interface ChatterRule {
  id: string;            // stable: 'ch.garrison.lost.fast.2'. The file name in phase 2
  concept: CommsKind;    // what is happening: 'lost', 'manDown', 'taunt'...
  faction: 'garrison' | 'holdfast' | 'bureau';
  text: string;          // slots: {name} {dead} {squad} {dir} {place}
  emotion: ChatterEmotion;
  channel: 'shout' | 'radio' | 'scream';
  when?: Criteria;       // plain predicates over the facts, below
  who?: { roles?: Role[]; ranks?: Rank[]; states?: MoraleState[]; leader?: boolean; radio?: boolean };
  weight?: number;       // more criteria already win; this breaks ties
  gap?: number;          // seconds before this row again. Default 40
  once?: boolean;        // once a run
  reply?: { concept: CommsKind; after: number };
}
```

**Matching.** `say(concept, s)` builds one facts object (the speaker, his squad, the read, the moment: `dead` and `deadBrutal` for a
casualty), gathers the rows for that concept and faction whose `who` and `when` pass and whose gaps have run, and takes the one with
the most criteria, breaking ties by weight and then at random. Generic rows have no criteria, so there is always something, and a
specific row ("lost", player fast, speaker shaken) beats it when it applies. Rows are plain data and the matcher has no three.js, so a
test can feed facts and read the line.

**Memory.** A chosen row writes back: its own `lastAt`, the concept's `lastAt` (the existing `KIND_GAP`), the speaker's `lastAt`
(a man does not talk twice in 4 s) and any fact it sets (`said.again = 2`). A run's memory is wiped by `reset`.

**Who speaks.**

- One speaker at a time **per squad**: a squad is busy for the line's airtime (0.9 s plus 0.06 s a character, the radio's own rule).
- At most two lines in the air at once across the side, and `LINE_GAP` drops from 1.3 s to 0.6 s, so two squads can talk over each
  other a little, which reads as a fight.
- `URGENT` concepts (frag, man down, last stand, spring...) interrupt: they cut the squad's current line and take the slot.
- Priority when two want the same slot: urgent, then tactic calls, then reactions, then flavour.
- Muted, silent, cuffed and dead men never speak, as now.

### 5.2 Not repeating

- A row has its own gap (default 40 s) on top of the concept's. A pool of five lines with a 40 s row gap and an 8 s concept gap cannot
  repeat inside 40 s.
- Rows with `once` (the best jokes, "you again" at four contacts) are said once a run.
- The matcher prefers rows not yet said this run, then the oldest.
- Each concept gets a "nothing" weight: some moments are better left silent (a third "contact" in 20 s). Silence counts as a line for
  the gaps.
- A test runs a 10 minute bot fight (`outpost-sim.ts`) and fails if any row repeats inside its gap, or any line is said more than 4
  times, or a concept fires over twice a minute on average.

### 5.3 Line categories and examples

Written for this game: the garrison calls the player "it" (as built), Holdfast knows it is a man in goggles from the news, and the
Bailiffs are deadpan clerks with rifles. Swearing is written as it would be said. Every line here is new.

**Contact, and contact again**

| Faction | Lines |
|---|---|
| Garrison | "Contact, it's in the stores!" · "Eyes on. Big, moving, armed." · "It's back. Same one." · "There it is again. Nobody lose it this time." · "Third time. I'm not letting it walk off again." |
| Holdfast | "It's the goggles! From the news!" · "Over there, the tax man!" · "Him again. He doesn't learn." |

**Lost contact**

- "Lost it. It's too bloody fast."
- "Where'd it go? It was right there!"
- "Nothing. It just went."
- "Heading south, I think. Anyone?" (radio)
- "Stop looking at me, I don't know where it is."

**The player sits still**

- "It's pinned. Keep it there."
- "It's not moving. Why isn't it moving?"
- "Hold that corner. It's going nowhere."
- "It's dug in behind the crates. Somebody frag it."

**The player is fast**

- "It's going round us!"
- "I can't track it, it's too fast!"
- "Shoot where it's going, not where it is!"
- "How is it moving like that?"

**Confident: they are hurting the player**

- "It's bleeding! Told you it bleeds!"
- "Not so tough now, are we?"
- "Keep it up, it's slowing down!"
- "Put it down and we're home for dinner."
- "That's for Marsh!" (after a squadmate died)

**The player is winning: fear**

- "What the hell is that?"
- "That was four men! In two seconds!"
- "Oh f... it's coming this way."
- "That's not a contractor, that's a weather event."
- "I signed up for gate duty."

**Man down, with a name**

- "Marsh! No, no, Marsh!"
- "Novak's down! Novak's down!"
- "It got Pike. It just... it got Pike."
- "Okafor? Okafor, talk to me!"
- "They got the sergeant! Who's got the squad?"

**Radio**

- "Alpha to all: it's heading south, past the motor pool." (`heading`)
- "Bravo copies. Moving to cut it off."
- "Charlie needs support at the yard. Anyone."
- "Delta's not answering. Delta, come in."
- "Radio's gone! Hale had the radio!"

**Announced tactics** (call and answer, 4.5)

- Brute: "I'll keep it busy. Go round!" / "Going left!"
- "Frag out!" / "Get down!"
- "Flash out! Eyes!"
- "Fall back to the trucks, by teams!" / "Moving!"
- "Spread out. Sully, left side." / "Left side."

**Near miss**

- "Close! Close!"
- "That went through my hat."
- "Shit! It's got my position!"
- "I'm fine. I'm fine. I'm moving."

**Wounded and crawling**

- "Oh god. Oh god, that's my leg."
- "Somebody. Anybody."
- "I can't feel... it's cold. Why's it cold?"
- "Don't leave me out here with it!"

**Aimed at, on the floor** (4.8)

| Kind | Lines |
|---|---|
| Pleading | "No. No, please." · "I've got a pension coming." · "I won't tell anyone. Who would I tell?" · "Please, I'm done, I'm done." |
| Defiant | "Go on, then." · "Do it. I'm not asking." · "You'll run out of us before we run out of you." |
| Cursing | "F... you. F... you!" · "You'll get yours." · "Look at me while you do it." |

**Last stand** (said 1 s before the drop)

- "You're coming with me!"
- "Pin's out! Pin's out, you bastard!"
- "Present for you!"
- "Hold this."

**Prisoners and executions**

- "It shot him on his knees!"
- "It doesn't take prisoners. Nobody gives up!"
- "It let Brandt go. It just let him go."

**Bailiffs (allies), deadpan**

- "Subject resisting. Noted."
- "Grell is down. His paperwork will be completed posthumously."
- "Contractor, you are in my line of fire. This has been logged."
- "Hostiles at the quay. Proceeding to enforce."
- "Area compliant."

### 5.4 Emotions, for phase 2

Every row carries an emotion, so the TTS can be steered per line, the same way `Line.emotion` steers the Commander's takes today.

| Emotion | Used for | Voice direction |
|---|---|---|
| `calm` | orders, radio, Bailiffs | Level, clipped |
| `urgent` | contact, frag out, tactic calls | Loud, fast |
| `cocky` | confident, taunts | Grin in the voice |
| `afraid` | shaken, lost contact | Breathy, higher |
| `panic` | panicked, "what are you" | Shouting, cracking |
| `pain` | hit, crawling | Through teeth |
| `pleading` | begging | Small, wet |
| `defiant` | defiance, last stand | Low, hard |
| `hushed` | ambush, searching close | Whisper |
| `grief` | a name after a death | Breaking |

## 6. Phase 1 on screen

### 6.1 The bubble

| | Rule |
|---|---|
| Who gets one | Only a speaker in view: on screen, within 35 m, and `e.hasLos` (already worked out for every enemy every frame, so no new rays) |
| Where | Over his head bone plus 0.35 m, projected each frame, transform only, like `hud/locks.ts` |
| How many | 3 at most. A fourth replaces the oldest non-urgent one |
| How long | The line's airtime, the same number the squad uses to stay busy |
| Look | Small dark box, 13 px text, 24 characters wide, 2 lines at most, a short tail down to the head. A 3 px edge in the faction colour (garrison `--cold`, Holdfast cyan, Bailiffs `--friend` green). Screams in caps, amber like the feed's fear lines. A radio line has a small radio mark |
| Distance | Full size to 10 m, down to 75% at 35 m. Never smaller |
| Overlap | Bubbles that would overlap stack upward by 1.1 box heights |
| Behind cover | A man behind a wall has no bubble; his line is feed only. If he is half visible, the bubble still shows, since `hasLos` is to his chest |

### 6.2 The feed

Every line the player can hear goes to `CommsFeed`, as now, with the name instead of the callsign. Shouts within earshot; radio from
any squad with a radio. Bubble and feed show the same text, so a player reading the corner never misses a bubble.

### 6.3 The setting

**Enemy chatter**: Bubbles and feed (default) / Feed only / Off. Off stops the text only; the men still fight the same, because no
tactic depends on a line being shown. Phase 2 adds a **Voices** slider beside it.

## 7. Phase 2: voices (later, only when the owner says)

The owner's standing rule holds: no ElevenLabs credits and no generated voices until he says. This is the plan for when he does.

### 7.1 The model

**ZONOS3-Mini is real**, and new: Zyphra released it on 2026-11-09, six days before this doc.

| | What I could verify |
|---|---|
| What | A text-to-speech model, a sparse mixture of experts, about 100M active of 800 to 886M parameters |
| Licence | Weights Apache 2.0, code MIT; its optional espeak-ng part is GPL-3.0 (a tool we would run offline, not ship) |
| Where it runs | Zyphra's API, or locally: WebGPU in a browser, an MLX server on Apple Silicon, ggml with Metal, Ollama, llama.cpp |
| Price on the API | $10 per million UTF-8 bytes of text. All of section 7.3 is about 60 KB of text, so **under a dollar a full pass**, and a few dollars with retakes |
| Voices | 27 built in, voice design (age, gender, accent, texture), and cloning from a 5 to 10 s sample |
| Delivery | Pace, emotion (happy, angry, scared), projection, liveliness, whisper, which covers our table in 5.4 |
| Languages | 43 |

Not verified: whether it runs on the owner's 8 GB M1 (Zyphra quotes an M3; the CUDA weights are about 9 GB; quantized sizes were not
shown), any free tier or rate limits, and quality, which so far is only Zyphra's own benchmarks. Sources:
https://www.zyphra.com/our-work/zonos3-mini, https://huggingface.co/Zyphra/ZONOS3-Mini, https://github.com/Zyphra/ZONOS3-Mini,
https://www.zyphra.com/inference.

Alternatives, also open: Chatterbox by Resemble AI (MIT, one emotion "exaggeration" control, clones from 5 to 20 s, watermarks every
output, https://www.resemble.ai/learn/models/chatterbox), Kokoro-82M (Apache 2.0, small and fast, no emotion control,
https://huggingface.co/hexgrad/Kokoro-82M) and Dia-1.6B by Nari Labs (Apache 2.0, https://huggingface.co/nari-labs/Dia-1.6B).
ElevenLabs is what the Commander was recorded with, and is out until the owner says.

**Generated offline, never in the game.** Whatever the model, lines are batch-made into files on a machine, listened to, and shipped as
MP3s. Running TTS live in the browser on an 8 GB laptop mid-fight is unproven and would cost frame time for no gain, since every line is
written in advance.

### 7.2 The pipeline

The Commander's, again:

1. `tools/scripts/chatter-script.ts` writes `docs/voice/chatter-script.csv` from the rules: id, voice, emotion, text. Slots: a row with
   `{name}` becomes one take per name in its faction's pool, so names multiply only the few rows that use them (man down, send, radio).
2. A generator, `tools/scripts/chatter-generate.mjs`, reads the CSV and writes `public/audio/chatter/<voice>/<id>.mp3`. Takes that
   exist are skipped, so a run resumes. The model is whichever the owner picks (section 12, question 11).
3. A manifest beside the files lists what exists. A row with no take stays text, as the Commander's do.

**Voices.** Six to start, chosen once and kept: garrison A and B, the Brute (low, slow), Holdfast A (male) and B (female), and one
Bailiff. A man's voice is picked by archetype and seat, so a squad of four has at least two. Clips are recorded dry.

**The radio filter.** Radio-channel lines go through a band-pass (300 Hz to 3.2 kHz), a little compression and soft clipping, as
`vox_dying_human` was cut and as `radioize` does in the synth. One shared filter chain on a 2D radio bus at run time, so one dry take
serves both a shout and a radio call. Shouts play 3D from the body with the usual distance filter.

### 7.3 The budget for the web build

| | Count |
|---|---|
| Concepts | about 45 |
| Rows per concept per faction | 4 to 6 |
| Factions with voices | 3 |
| Takes (rows by voices that say them) | about 1,400 |
| Name takes | 16 names, 3 rows, 2 voices, 2 factions: about 200 |
| Mean clip | 1.4 s, mono, 48 kbps MP3: about 8 KB |
| Total | about 13 MB on disk, loaded per mission by the factions it uses |

The Commander's 999 clips are 102 MB at 128 kbps; barks do not need that rate.

**Memory is the real limit, not disk.** A decoded clip is about 270 KB (48 kHz float), so 1,400 decoded would be 380 MB on an 8 GB
laptop. Barks are not decoded into the sfx bank. They play through a pool of three `<audio>` elements wired into Web Audio
(`MediaElementAudioSourceNode` into a panner, or into the radio bus), as `voice.ts` plays the Commander, so only the file being heard
is decoded. A take that is late to start is dropped, not queued.

**The catalogue rule.** `docs/notes/audio.md` must list every catalogue id, and `audio.test.ts` fails if it falls behind. Barks stay out
of the sfx catalogue, as the Commander's voice does, with their own manifest and their own test (every manifest entry is a rule id, every
voiced rule id is in the manifest or marked text-only). `audio.md` gets one section saying where chatter lives and which three ids it
uses (the radio bus, the pin sound, the duck), not 1,400 rows.

## 8. Build order

Each stage is playable on its own and ends with a URL. One agent per stage, commits by path, never a push. Tokens are rough.

| # | Stage | What the owner gets | Size | Model, effort | Tokens |
|---|---|---|---|---|---|
| 1 | **The rule table** | `comms.ts` asks rules instead of pools; every existing line ported with an id, faction and emotion; names on every man and on the feed; row gaps and the repeat test | M | Opus, medium | 0.3 to 0.5M |
| 2 | **Bubbles** | Lines over heads, the three-bubble cap, the setting | S to M | Opus, medium | 0.2 to 0.4M |
| 3 | **The read and the reactions** | Fast, still, streaks, hurting the player, "you again", the redeploy line, the near-miss flinch | M | Opus, high | 0.4 to 0.6M |
| 4 | **Radiomen** | One per squad with the antenna, linked squads only, heading reports driving another squad's cut-off, support calls, "get his radio" | M to L | Opus, high | 0.6 to 0.9M |
| 5 | **Nerve and call and answer** | The confident state, squad nerve, taunts, two-man tactic calls | M | Opus, high | 0.4 to 0.6M |
| 6 | **The wounded** | Begging at gunpoint, the warned last-stand grenade, the crawl talking | S | Opus, medium | 0.2 to 0.3M |
| 7 | **Holdfast and the Bailiffs** | Their rule sets; `war.ts` `CALLS` moved into rows; allies get lines | M | Opus, medium | 0.3 to 0.5M |
| 8 | **Voices** (when the owner says) | Script, generator, six voices, radio bus, the `<audio>` pool, a 20-line test first | M, plus the owner's listening | Opus, medium | 0.3 to 0.5M, plus the model's cost |

Stages 1 and 2 first and alone: they are the whole phase 1 look with today's behaviour, and the owner can judge whether bubbles help
before anything else moves. 3 and 6 can run beside each other after 1. 4 and 5 touch `squad.ts` and `index.ts` and should not run at the
same time. **Total for phase 1:** about 2.4 to 3.8M tokens, a little more than the air support update.

## 9. Cost

The budget is the 8 GB M1 at 60 fps, and Foreclosure's 450 draws, which the gunship already pushes past.

| Piece | Cost |
|---|---|
| Rule matching | Only when something is said, a few times a second at most. A concept has 5 to 30 rows, each a handful of comparisons: well under 0.05 ms a call |
| The read | Numbers on the existing 0.25 s tick. No rays |
| The radio | A queue of a few messages. No rays. `Intel.exposed` for the radio grab is a lookup |
| Bubbles | DOM, so **no draw calls**. Three pooled elements moved by `transform`, three projections a frame. `hasLos` is already computed |
| Feed | As now |
| Voices (phase 2) | At most two bark voices and one radio voice at once, in the existing 40-voice budget. Three `<audio>` elements. No decoded bank, so memory stays flat |

Nothing here adds geometry except the radioman's antenna, a few dozen triangles merged into his body like the helmets.

## 10. Rules for every stage

- `outpost.test.ts`, `planner.test.ts`, `capture.test.ts`, `commander.test.ts` and `war.test.ts` pass unchanged. The men fight as they
  do: only stages 4 and 5 change behaviour, and each says what it changed with a bench run (`human-bench.ts`, `outpost-sim.ts`).
- No line is said by a drill that is not starting. A test checks every tactic concept is only fired from its drill's start.
- All lines are ours. No line copied from another game.
- No voice, no service calls before stage 8.

## 11. Left out

- **Lines generated at run time** by a language model. Every line is written, keyed and reviewable, so it can be voiced and tested.
- **Hearing the player's own noise in lines** ("I heard boots"). The noise kind covers it.
- **Dogs and whistles.** The Last of Us uses both; we have no dogs, and the radio is our version of the whistle.
- **The swarm.** Husks do not talk.

## 12. Questions for the owner

1. **What do they call you?** Default: the garrison keeps "it" (as built: they think you are a monster), Holdfast says "him" and "the
   goggles" (they have seen the news), the Bailiffs say "the contractor".
2. **Is the radioman marked?** Default: yes, a whip antenna on his back you can pick out at 30 m, and a radio mark on his lines. Hidden
   makes killing him luck, not a choice.
3. **Can a man pick the radio back up?** Default: yes, once per squad, announced ("Get his radio!"), and only if the body is out of
   your view. It turns the body into bait.
4. **Do you hear their radio across the map?** Default: yes, radio traffic in the feed map-wide, marked as radio; shouts only within
   40 m. Killing a radioman takes his squad off your feed, which is how you know it worked.
5. **How much swearing?** Default: real swearing, written and later spoken in full, a few lines per concept, mostly when shaken or
   worse. The examples here spell it as "f..." only because it is a doc.
6. **Names or callsigns on the feed?** Default: `Cpl Marsh · Alpha`. The callsign alone is easier to read in a big fight; the name is
   what makes "Marsh is down" land.
7. **How mean, how often, when they are winning?** Default: taunts only with you under half health or after 25 damage in 8 s, at most
   one every 12 s side-wide, and they stop the moment Dread climbs.
8. **Do they remember the clone?** Default: yes. Men who saw you die say so after the redeploy ("We watched you die"). It is the story's
   hint, said by the enemy.
9. **Does sparing a begging man mean anything?** Default: no new rule. Begging is a reaction; the existing surrender, questioning and
   execution rules stay the only mechanics.
10. **Bubbles: on, and how many?** Default: on, three at most, only for men you can see within 35 m, with a setting for feed only or
    off. If they clutter the fight, feed only becomes the default.
11. **Phase 2 voice model.** Default: when you say go, a 20-line test (the same lines, three voices) on ZONOS3-Mini's API (cents)
    and Chatterbox run locally, you pick by ear, then the full batch. Nothing generated before you say so.
12. **Where first?** Default: wherever the Outpost brain runs (the Outpost mission, `?contract=outpost`, Outpost Defense's
    attackers), then Holdfast and the Bailiffs in Foreclosure as stage 7.
