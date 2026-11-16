# Soldier Bark & Squad Comms System — Design Notes
Nov 15, 2026 · @jared (the owner's own design doc, pasted verbatim into chat 2026-11-16; tables were flattened by the paste, rows are "col | col | col")

## Goal and design principles
The soldiers already flank, suppress, drag wounded and adapt, but the player rarely notices because nothing announces it. This system makes that hidden intelligence audible and readable. They should feel alive: aware of you, reacting to you, remembering you, and scared or angry like people.
Inspiration (the feeling, not systems to copy): F.E.A.R., where enemies announce a tactic and you watch it happen, and The Last of Us Part II, where enemies call each other by name, grieve, and remember who you killed. Aim for a mix of both.
North star: "If the AI didn't say it, it didn't happen" (Jeff Orkin, F.E.A.R.). Every important tactic, ability or state change gets a callout the player can hear or read.
Principles:
- Say it, then do it. Announce the tactic, then perform it within a second or two, so the player connects line and action (F.E.A.R. style).
- Lines are information, not flavor. Each callout tells the player something useful: where a grenade is coming from, that the warden is reviving, that a squad is flanking left.
- Emotion changes the words, not just the volume. Morale and context pick vocabulary, swearing, confidence and pacing.
- They are people with names. Names, callsigns and relationships make kills land and enable revenge lines (Last of Us Part II style).
- Memory. They remember what you did this match and react to it.
- Interruptible. Speech is physical: a headshot cuts a line mid-word, a dismemberment turns a callout into a scream.
- NPCs hear each other. A spoken line is also a game event other NPCs react to (take cover on "frag out", push on "he's blind").
- No mindless fight-to-the-death by default. Fighting to the death is a deliberate, announced choice.
- Readability in chaos. Critical warnings (grenades, flashbangs, suicide grenades, revives) get priority over chatter and an on-screen cue where needed.

## Audio highlights every system
The game already has deep systems (active ragdolls, gore, internal hitboxes, armor, wound states). In the chaos, players miss them visually. Audio makes them register, even subconsciously. Rule: every hidden system gets a sound, and the big ones get a voice line too.
What already proves this works: the armor sound pass. Before, shooting armored enemies felt unsatisfying (a blue hit marker, no sound). Now armor has distinct sounds, and armored enemies became fun to fight:
Armor event | Sound | Possible enemy line
- Hit fully absorbed | Light ricochet ping | "Ha, plates held!" (confident)
- Plate destroyed | Crunch/crack | "My plate's gone!" "Armor's cracked!"
- Shot through (e.g. sniper's mini sabot/AP round, through walls) | Penetration sound | "It went right through!" "He's got AP, armor's useless!"
Same logic for wounds (internal hitboxes like aorta, arteries, pelvis bleed zones):
Wound event | Sound | Possible enemy line
- Arterial / bleeding wound | Blood spray | "I'm bleeding out!" "It hit an artery!"
- Gut / critical wound | Wet impact, gasp | "Oh god, oh god…"
- Fatal | Distinct fatal-hit sound + line cut-off | none, the cut-off is the cue
Layering: the impact sound confirms what your bullet did; the enemy's voice confirms how it changed them (scared, retreating, calling for help); squadmates' lines confirm how the squad adapts.

## Core architecture
Technical suggestion: a rule-based line picker (Valve). Game events become "concepts", each query carries a bag of facts about the world, and the line with the most specific matching rule wins. Writers add lines as data without touching code.
Pipeline
1. Event fires (concept): e.g. ALLY_KILLED, THROW_FRAG, PLAYER_FLANKED_US, LOST_CONTACT, REACQUIRED, REVIVE_START.
2. Build the query (facts): speaker unit type, personality, morale tier, health, squad size left, squad role alive (MG, radio op), victim name, victim relationship, killer = player, how they died (headshot, explosion, dismember), player direction relative to speaker (clock + cardinal), player state (stunned, reloading, wounded, fleeing), player memory facts (squads wiped, kills this match, favorite tactic), time since last line, is radio channel.
3. Match rules: each rule = concept + criteria + line group. Most criteria required; optional ones add score. Highest score wins, so a specific line ("That's for Mike!") beats a generic one ("Take this!") when the facts allow.
4. Pick speaker: best-suited squad member (closest witness, the victim's buddy, the squad leader, the radio op for radio lines). Avoid the same guy talking back to back.
5. Priority and interrupts: critical (grenade warnings, suicide grenade, flash out, revive) > tactical (flank, suppress, contact) > emotional > idle. Higher priority can cut lower. Death or a big hit cuts the speaker instantly.
6. Play: text bubble (prototype) or voice line + optional HUD cue.
7. Broadcast as an event: the spoken line becomes a fact other NPCs (and the radio net) can respond to.
Anti-spam rules
- Per-concept cooldowns, per-speaker cooldowns, per-squad "talk budget".
- Never repeat the same exact line within N minutes; track recently used lines.
- Response chains: rules can trigger follow-up concepts ("Frag out!" → nearby ally: "Moving!").
- Critical warnings ignore the budget.

## Soldier identity
Every soldier gets a name at spawn, and squads get callsigns, so lines can reference real people ("Mike's hit!", "That's for Charlie squad!").
- Names: pick from a name pool per faction at spawn (assign at birth). Only some soldiers are "known" by name to teammates to keep it believable; the squad leader and buddies use names most.
- Buddy pairs: randomly pair soldiers inside a squad. A buddy's death hits harder (bigger morale drop, revenge lines, more likely to drag them).
- Squad callsigns: NATO alphabet (Alpha, Bravo, Charlie, Delta, Echo, Foxtrot, Golf...). Radio uses them: "Bravo, this is Charlie."
- Roles in a squad: riflemen, radio operator, machine gunner (brute) or another specialist. The MG is the tactical anchor; losing him drops morale.
- Player names: high/medium morale: "subject", "tango", "target", "hostile". Low morale: "that thing", "it", "that piece of shit", "the freak". Desperate: no name at all, just "him" and swearing.
Names that fit a space setting — everyday names like "Mike" break the vibe (examples in this doc are placeholders). Options to mix:
- Designations (robot/space soldiers): "K-17", "Seven", "Unit Nine", "Dex-4". "We lost Seven!" still hits like a name.
- Short hard surnames: Voss, Kade, Rook, Tash, Orin, Hale, Dace, Sable, Vance, Juno.
- Nicknames tied to personality: the brute is "Brick", the medic-type "Patch", the rocketeer "Spark", the rookie "Kid".
- Two registers (best of both): formal designation on the radio, nickname between buddies. Radio: "KR-7 is down." Buddy: "Patch! No!"
- Per faction: the human SWAT-style faction can use more grounded surnames; the space faction uses designations and nicknames.
Tips: keep names 1–2 syllables so they read in chaos and generate cleanly in TTS. Pre-generate each name inside its lines ("That's for Rook!") instead of splicing a name clip into a sentence.

## Voice and personality per unit
Unit | Voice direction | Personality
- Rifleman A | Mid, clipped | By-the-book professional
- Rifleman B | Younger, higher | Nervous rookie, breaks first
- Rifleman C | Gravelly, older | Cocky veteran, trash talk
- Shotgunner (x3 archetypes) | Loud, aggressive | Brawler; wants to close the gap, taunts up close
- Brute (armored MG) | Deep, aggro | Heavy, intimidating, loves suppressing
- Sniper | Whispery, calm | Mysterious, patient, few words
- Rocketeer | Precise, technical | Fussy specialist/engineer: "Watch the back blast", "Dropping ordnance"
- Warden | Odd, sing-song or calm | Funky healer/wizard; always announces shields and revives
- Radio operator | Clear, radio-filtered on net | Calm relay voice; panics if squad collapses
Voice generation note: ZONOS3-Mini voice design (age, accent, raspy/deep/soft) per archetype; several voice variants per personality so squads don't sound cloned.

## Morale and emotion
Morale tiers → speech
Tier | How they talk | Example lines
- High (true confidence) | Professional, short, procedural, little swearing, taunting when winning | "Contact front." "Stitch him up." "Target's hit, keep pressure."
- Medium | Still procedural, more urgent, some swearing | "He's fast, watch your sector!" "Get that gun back up!"
- Low (scared) | Swearing, broken sentences, calls player "it/that thing" | "What the fuck is that thing?" "I'm not dying here!"
- Broken | Fleeing, pleading, surrender | "I'm out, I'm out!" "Don't shoot!"
False vs true confidence: a soldier can talk big while morale is dropping ("Is that all you got?") with a shaky delivery, then crack. Track a separate "bravado" value or flag so tough talk can be fake.
Morale modifiers
- Down: buddy killed (big), MG/brute killed (big), squad leader or radio op killed, squad wiped nearby ("Delta's gone!"), player flanked them unseen, gore witnessed, being suppressed.
- Up: player wounded or stunned, warden revive/shield, reinforcements arrive, MG back online, player retreating.
Low-morale outcomes
- Flee: announce it ("Fall back!", "Fuck this, I'm out!"). Last man in squad very likely to flee.
- Surrender: hands up, pleading lines.
- Last stand (rare, announced): small chance instead of fleeing. Must say it first: "I'm not going down without a fight." "Come on then!" Then no retreat, no surrender. Never default behavior.
- Fake surrender + grenade (rare): surrenders, then shouts a defiant line before pulling the pin so the explosion is never random: "Fuck you!", "Surprise, motherfucker!", "See you in hell!". Visible pin-pull animation and a short HUD/audio cue.
- Revenge mode: after losing a buddy or squad, chance of going aggressive with named revenge lines.

## Damage and death reactions
- Instant kill (headshot, decap): cut the current line immediately, mid-word. No death line, or at most a short choked sound.
- Non-instant lethal: grunt, groan, gurgle; no full sentence.
- Limb shot off: scream, then "My arm!" / "I'm hit!" / "Fuck, my leg!" Line set keyed to the limb.
- Wounded, crawling: periodic pain lines, calls for buddy by name ("Danny, help me!"), calls for medic/warden.
- Bleeding out: fading, quieter lines; final words optional.
- Witness lines: nearby allies react based on relationship and morale: "Mike's down!", "Man down!", "Oh god, Jake!" (buddy), "We're taking casualties!" (squad leader).
Wound states → lines
State | What they do | Lines
- Disabled | Down, can't fight, may crawl | "I can't move!" "Somebody get me out of here!"
- Critically wounded | Crawling, needs help soon | "Help me, I'm hit bad!" Buddy's name, calls for the warden
- Mortally wounded | Dying no matter what | Fading lines, last words, prayers or curses
- Arm shot off | Scream, then shock | "My arm! Where's my arm?!"
- Bleeding out | Getting weaker over time | "I'm bleeding out!" then quieter, slower lines
- Pistol last stand | Pulls a sidearm from the ground | "You're coming with me!" "Not like this!" before the first shot
Drag, heal, revive loop (planned)
1. Ally wounded → buddy or nearest rifleman: "I got you, Mike!" / "Cover me, I'm grabbing him!"
2. Squad provides cover fire: "Covering!"
3. Drag to safety (target only allies, not enemies).
4. Stim/heal: "Hold still." "You're good, get back in it."
5. Healed soldier rejoins: "I'm up!" "Let's get this fucker."
6. If the medic is killed mid-drag, both get reaction lines and morale hits.

## Squad callouts
Tactics (say it, then do it)
- Suppress: "Suppressing fire!" "Keep his head down!" (MG/brute)
- Flank: "Flanking left!" "I'm going around!"
- Bound/move: "Moving!" "Set!" "Covering!" (fire and maneuver)
- Push: "Push him!" "Close in!" (shotgunners)
- Hold: "Hold position!" "Stay in cover!" (when MG is down or morale low)
- Reload: "Reloading!" / "Changing mags!" (teammate: "Covering!")
Grenades and flashbangs
- Frag: "Frag out!" / "Grenade!" Allies near the landing spot hear it and move away.
- Flashbang: "Flash out!" / "Bang out!" Plus an on-screen indicator for the incoming flash so the player can react.
- Player stunned: "He's blind, push!" "He's dazed, move move!" → squad pushes.
- Player throws a grenade: "Grenade! Move!" and they scatter.
Player position (clock and cardinal)
- Relative to the speaker: "Dead ahead, 12 o'clock!" "On our six!" "Right flank, 3 o'clock!"
- Cardinal on the radio net: "Heading north!" "He's south of the warehouse!"
- Height: "He's above us, on the roof!" "Low, under the walkway!"
- Surprise from behind: "Oh fuck, he's on our six!" "Behind us!"
- Charging: "He's coming right at us!" Running away: "He's running!" "He's breaking contact!"
Player status
- Player hit: "Tagged him!" "He's hit, stitch him up!" "Keep pressure!"
- Player healing or hiding: "He's hurt, he's hiding!" "Don't let him heal!"
- Player very fast/parkour: "He's too fast!" "Watch the rooftops!"
- Player using one tactic a lot: comment on it (see Memory).

## Radio and multi-squad coordination
Each squad's radio operator is its link to the other squads. Radio lines get a radio filter and squelch click.
Radio line types
- Contact report: callsign + distance + direction + description. "Bravo, Charlie. Contact, one hostile, 50 meters south of the tower, moving fast."
- Movement updates: "He's breaking contact, heading northbound." "Lost visual." "Last seen by the river."
- Re-acquire: "Eyes on! There he is!"
- Acknowledgements: "Copy." "Roger." "Wilco, moving." "Negative, we're pinned."
- Requests: "Need support at the bridge!" "Requesting a warden!" "Send the brute!"
- Status: "Charlie's taking casualties." "Delta is down to two."
Radio op killed mid-sentence
1. Line cuts with a squelch/static burst.
2. After a short delay, another squad: "Charlie, say again?" → "Charlie, radio check, over." → "Charlie, how copy?"
3. No answer → "We lost Charlie." / "Charlie's not answering, I think they're gone." Morale hit for listeners.
4. Optional: a surviving Charlie rifleman grabs the radio: "This is Charlie, Kowalski's dead, we need help!"
Squad wiped
- Nearby squads: "Golf is down!" "Delta's been wiped!" "We've got casualties!"
- Feeds memory and revenge lines ("This is for Delta!").
Coordinated plays (chosen by a squad-level planner, announced on the net)
Play | Radio call | What happens
- Hammer and anvil | "Bravo, push him toward us, we're set at the courtyard." | One squad holds a kill zone (anvil), another drives the player into it (hammer).
- Blocking / cut-off | "Echo, cut him off at the north exit." | A squad blocks the escape route the player is heading for.
- Pincer | "Charlie left, Delta right, on my mark." | Two squads close from both sides.
- Fix and flank | "We'll pin him, you go around." | One squad suppresses, the other flanks.
- Collapse on last known position | "All units, last seen at the depot, converge." | Search behavior after lost contact.
- Fall back and regroup | "Charlie's falling back to you!" | A broken squad merges with another.

## Memory and revenge
A per-match "player memory" blackboard shared by all squads (spread realistically via radio, so a squad only knows what was reported).
What to remember:
- Names of fallen soldiers and wiped squads ("That's for Devin!", "This is for Charlie squad!")
- Player's habits: headshots, flanking from behind, rooftop parkour, explosives, melee, running away to heal
- Times the player broke contact and came back
- Who has fought the player before and survived
Line examples:
- Re-engage after breaking contact: "There he is!" "You again." "Not getting away this time."
- Habit callouts: "He likes the high ground, watch the roofs!" "He keeps coming from behind, watch our six!"
- Revenge on a throw: "That's for Mike!" "Take this, you fucking bitch!" "Come get some!"
- Survivor of an earlier fight: "I've seen what this thing does, stay sharp."
Adapt, then explain: if the AI adapts to player habits (MGSV style), have them say it: "He's going for heads, keep your visors down!"
Legal note: keep this per-match and squad-level. Shadow of Mordor's Nemesis system is patented by Warner Bros until August 2036 (hierarchy of procedurally generated NPCs promoted/demoted who remember past encounters). Avoid a persistent rank/promotion hierarchy of named nemeses. Not legal advice.

## Unit types
Unit | Behavior | Signature lines
- Rifleman | Most dynamic. Uses cover and bounding fire. Moves while the MG pins you; hunkers down and shoots if the MG is idle or dead. | "Moving!" "Set!" "Covering!" "Flanking left!"
- Shotgunner (default human enemy) | Closes distance, pushes, ambushes corners. | "Get in close!" "Push him!" "Got you now!"
- Brute (armored MG) | Hangs back, pins you down, anchors squad tactics. Death = big morale hit. | "Suppressing!" "Eat it!" "Keep your head down, little man!"
- Sniper | Long range, few words, whispery. Announce laser/glint so deaths aren't random. | "I have him." "Sending." "Relocating."
- Rocketeer | Specialist/engineer. Announces every shot so the player can dodge. | "Back blast clear!" "Dropping ordnance!" "Rocket out!"
- Warden | Healer/wizard. Shields allies, revives the dead. Must announce everything so the player knows why enemies came back. | "Shield up!" "Rise, brother!" "Not yet, Kowalski, not yet."
- Radio operator | Relays contact reports, calls other squads, requests support. | "All units, contact south!" "Copy, moving."
Warden feedback: revive line + visible VFX on the revived body + optional HUD ping ("Warden reviving"), so killing the warden first becomes a learned priority.
Riot shield unit — the shield is mobile cover for everyone near it, not just its own squad.
1. Shield calls it: "Shield up, get behind me!" "Stack on me!"
2. Nearby infantry form up behind the shield instead of rushing ahead of it. Riflemen fire past the edges.
3. Shield advances toward the player: "Pushing!" "Keep moving!"
4. Shotgunners ride behind the shield. At close range they break out and blast: "Now!" "Break!"
5. If the player flanks the shield wall: "He's going around the shield!" and the shield turns.
6. If the shield goes down: "Shield's down, scatter!" Followers lose cover and morale dips.
7. Optional: the shield covers a buddy-drag ("I've got you covered, drag him!").
Todo: list remaining enemy types and give each a callout set.

## NPCs reacting to each other
Every spoken line is also a world event with a position, radius and listeners. NPCs who "hear" it update their behavior and can answer.
Line heard | Listener reaction
- "Frag out!" / "Grenade!" | Move away from the landing spot, never run onto it.
- "Flash out!" | Allies look away / take cover; ready to push.
- "He's blind!" | Squad pushes the stunned player.
- "Reloading!" | Buddy covers: "Covering!"
- "Suppressing!" | Riflemen start bounding / flanking.
- "Gun's down!" (MG dead) | Riflemen hold and hunker; morale drops.
- "Man down!" | Buddy or medic goes for the drag.
- "Shield up!" (warden) | Allies step into the shield, push harder.
- "Rocket out!" | Allies clear the back blast.
- "I'm not going down without a fight!" | Squadmates may rally or call him crazy.
- Radio contact report | Other squads choose a play (see radio section) and reply.
Also let NPCs answer each other conversationally: "Where is he?" → "Second floor, left window!"

## Cross-squad emergent tactics
Squads spawn with a designed loadout, but tactics should not stop at squad borders. Any units near each other that can see each other combine what they have.
How it works
- Local awareness: each unit keeps a list of allies within a radius and line of sight, with their role and what they're doing.
- Offers: units advertise what they provide. A shield offers cover, a suppressing MG offers "player pinned", a warden offers healing, a rocketeer offers "breach cover".
- Claims: nearby units claim offers that fit their role and the situation, regardless of squad. One unit leads each joint tactic, with a timeout.
- Announce on claim: the claim fires a spoken line (proximity, not radio).
Combos to support
Units nearby (any squad) | Emergent tactic | Lines
- Shield + riflemen/shotgunners | Shield push; others stack behind; shotgunners break out up close | "Get behind me!" → "Moving with you!"
- MG suppressing + riflemen | Riflemen flank instead of charging in | "He's pinned, go around!" "Flanking while he's down!"
- Warden + wounded ally | Drag the wounded toward the warden | "Get him to the warden!"
- Rocketeer + player in hard cover | Rocket the cover, others wait, then push | "Rocket, hit that cover!" → "Back blast clear!" → "Push!"
- Sniper with eyes on + others lost contact | Sniper spots for everyone | "He's behind the crates, left side."
- Shotgunners + player stunned | Rush | "He's blind, get in there!"
- Two broken squads | Merge into one | "You're with us now!"
The goal: designers set the rules, and combinations nobody scripted show up on their own, and the player hears them happen.

## Build plan
1. Design the system first: concepts (events), facts, rules, priorities, interrupts, listener reactions, radio net.
2. Write all line groups as data (JSON/CSV): id, concept, criteria, unit, personality, morale_tier, text, priority, cooldown, radio(bool), interruptible(bool).
3. Prototype with text bubbles over heads (and a radio subtitle feed for net traffic). Show cut-offs as truncated text with a dash ("Bravo, he's head—").
4. Debug overlay: show which rule fired and why (facts + score). Essential for tuning.
5. Playtest for readability: can the player tell what each squad is doing without the overlay?
6. Generate voices with ZONOS3-Mini: voice design per archetype, emotion/whisper steering per morale tier, several takes per line. Batch from the same CSV.
7. Audio rules: radio filter for net lines, cut-off support (stop playback instantly on death), mix priority so warnings cut through explosions.
8. HUD cues for critical events: incoming flashbang, suicide grenade, warden revive.

## Games to study
- F.E.A.R. — squad dialogue that announces tactics; GOAP planner. Barks multiply perceived intelligence.
- Left 4 Dead / Valve — rule-based dynamic dialogue (concepts + criteria + fuzzy match); AI Director pacing.
- The Last of Us Part II — every human enemy named; names in coordination and grief; "searching" state between aware and unaware.
- Metal Gear Solid V — enemies adapt to your habits and talk on radio; adapt + announce.
- Halo — Grunts panic and flee when their Elite leader dies (kill the anchor, the squad breaks).
- Shadow of Mordor — revenge inspiration for per-match memory only; mechanic patented until 2036.
- Dwarf Fortress / RimWorld — many simple systems interacting; storyteller director.
- S.T.A.L.K.E.R. (A-Life) — radio chatter about off-screen events.
- Alien: Isolation — director AI guiding a hunter toward the player.
- Arma / Ready or Not / SWAT 4 — radio procedure; CQB, surrender and fake-surrender.

## Real-world radio and tactics reference (keep shorter than real life)
- Call format: "[Receiver], this is [Sender], [message], over." In-game: "Bravo, Charlie, ..."
- Contact report: distance, direction, description. "Contact! 50 meters, south, one hostile, moving fast!"
- Direction: clock for own squad; cardinal or landmarks on the net.
- SALUTE for longer radio-op reports, sparingly.
- Radio check when a squad goes silent: "Charlie, radio check, over." "How copy?"
Prowords: Roger (received), Wilco (will comply; not with roger), Copy/Good copy, Say again, Oscar Mike (on the move), Set (in position), Moving/Covering (bounding), Contact, Break contact, Lost visual/last known, Frag out/Bang out, Man down/Casualty, Tango/Hostile, Stitch him up (walk a burst up the target).
Squad tactics: fire and maneuver / bounding overwatch; fix and flank; hammer and anvil; blocking / cut-off; L-shaped ambush; cordon and search; stacking and clearing rooms (CQB: "Clear!", "Room clear!").

## Open questions and future ideas
- [ ] Which other enemy types exist, and what are their callout sets?
- [ ] How many squads are on a map at once, and how many radio lines can play before it gets noisy?
- [ ] Should the player hear radio traffic only near a radio op, or everywhere as subtitles?
- [ ] Exact chance values for last stand, fake surrender and revenge mode.
- [ ] Does adaptation to player tactics change gear (MGSV style) or only behavior?
- [ ] Stealth mode: unaware → suspicious → searching → combat ladder with lines ("Did you hear that?", "Probably nothing", "Check the east side", "Found a body!").
- [ ] Keep the current setup: the player always hears enemy comms (chat box now, voices later). No radio pickup mechanic.
- [ ] Enemies taunting through the radio when the player wipes many squads.
- [ ] Debriefing / kill feed with names to make named kills stick.

## Sources
Jeff Orkin, Combat Dialogue in FEAR (Game AI Pro); Elan Ruskin, AI-driven Dynamic Dialog, GDC 2012; Valve Developer Wiki: Response System; GameSpot: Last of Us Part II enemies have names; Metal Gear Wiki: Revenge System; TechRadar: Nemesis patent until 2036; Basic Infantry Communication; Arma 3 radio discipline guide.
