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
- Done: the dev panel (F1 or backquote) loads on every map and contract of the dev server, with every cheat off until you tick it; `?dev=0` turns it off there. The public site keeps `?dev=1`. Main menu, The Crucible's tab, **Crucible rules**: each type's first wave or off, Juggernaut and Titan cadence and count, start wave, wave size, escort, most alive, breaks, spawn speed, enemy health and damage. Any custom rule makes the run unranked; `?rules=0` plays the standard rules.

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

## Playtest round 4: Outpost mission, `softskins`

Owner, after taking the shotgun and first two grenades: shredded instantly by the wave, not enough cover to slide between, and "mortared" inside the houses. Asked whether there is an intended way out.

- The beat's job in MISSION.md is "a hard, fair, even fight". As played, it is not.
- Up to 13 men at once: the 4 from `lz.rim`, the 8 in `soft.first`, and the tower. MISSION.md counts 17 men in total and leaves out the rim.
- No armour on offer until `breather`.
- The "mortars" are probably frags. The planner answers a camper with a frag and a rush, at 62 damage over 6.5 m, so two kill from full health. Real mortars need a wave start to place a tube. Tank shells do 60 over 6 m if the owner had reached `heavy`.

Planned changes, after Assemble and the playtest finish so as not to collide with them:

1. `softskins`: done. Green troops, one truck at a time, one frag per squad, armour and health in the Guardhouse, more cover on the apron.
2. `heavy`: done. The wreck objective comes at 8 s, the sniper is gone, and green troops carry through `wreck` and `turn`.

## Parkour pass (2026-11-10)

Owner: "Add animations for wall jumps, mantles, vaults, all parkour moves for the player. I think we should do a complete parkour overhaul."

Shipped, and **not yet played by anyone**: it was built and checked by measurement, tests and frozen stills. Manual: docs/notes/player.md, "The body in first person" and "Vault".

- A first-person body layer for every move: the left hand plants on ledges, cover, walls and the floor, the weapon dips, cants and floats, the camera rolls (never pitches or yaws, so the crosshair stays on the shot), and legs show in a slide and a vault.
- A vault: jump while running at waist-high cover and the body goes over on one hand at the speed it arrived with.
- Quiet hand and boot sounds on each move.
- A jump pressed during a climb or a vault is now a jump off the top or the far side, with the double jump kept. Thin ledges can be grabbed.
- Try it: `/?map=range`, F1, MOVEMENT, "Parkour strip". Off-switches: `?moveanim=0`, `?movecam=0`, `?legs=0`, `?vault=0`, `?movefix=0`.

For the owner to decide by playing:

1. **Vault on a key, or automatic?** The brief said running at cover carries you over. It ships on a jump press, because cover is also something to stop behind and the movement rule is that nothing happens by accident. `?vault=auto` or the lab box is the no-key version.
2. **Should a jump at cover always be a vault?** Within 1.9 m of cover up to 2.6 m deep it is, so jumping onto a crate needs a start further back.
3. **How much camera motion.** Roll is capped at 4.6 degrees. `ANIM.camera` is the one number a settings entry would write; there is no entry in the menu yet.
4. **The legs.** Simple, good in a slide, and in a vault they cross the gun when looking down. Keep, improve or hide (`?legs=0`).

Open:

- The right hand never leaves the weapon: a mantle is one-handed and a wall on the right gets no trailing hand.
- Jump and sprint have no new animation. The rig's own jump kick and run pose are what they have.
- The mantle still ends beside the ledge with six ticks of air (`mantleCarry` is built and off). Turning it on needs the campaign's lesson tests to judge a crossing a moment later than the first standing frame.
- The campaign's cable gallery can be crossed without a wall run (46 of 238 jump-and-dash timings on its own test lane). Found here, not caused here: it needs a deeper drop under the far deck or a lip that cannot be climbed.
- The parkour strip is on the Test Range only. `/?sandbox=movement` has no viewmodel, so it shows the camera part alone.

## Weapon families and piercing rounds

Owner's words: "Need to add more weapons, or alternate modes. On top of the SMG there should be an assault rifle. If you press one again, it should scroll through sub genres of a certain weapon. An assault rifle, which causes more damage. There should be a pistol on top of the revolver. The alternate for the autocannon should be piercing rounds, so it can shoot through walls or through multiple enemies. So you can use your sonar to see enemies through walls and then shoot them through walls."

Done, and not yet played by anyone. Manual: `docs/notes/weapons.md`.

- Press the key of the weapon in hand to step to the next one on that key. Any other key draws what was last held there. Q and the wheel work as before; the wheel moves between keys.
- Key 1: SMG, then **Harrow**, a battle rifle. Key 4: Autocannon, then **Sabot**, the same cannon firing darts with no blast. Key 6: Judge, then **Rivet**, a pistol. Each has its own ammo and comes with the weapon it sits beside.
- Rounds go through walls and bodies on a budget. The Sabot goes through about 5 m of wall in all and everyone in line, plates and a Riot's shield included. The Harrow goes through one body or thin cover. A round leaves a pale crater where it comes out.
- Try it: `/?map=range`, F1, "Draw a weapon", then "Piercing gallery". T pings the sonar.
- Off-switches: `?families=0`, `?pierce=0`, `?reach=0`.

Waiting on the owner:

- **The SMG loses damage with range now**, from 35 m down to half at 80, so that the Harrow has a reach the SMG has not. Nobody asked for the SMG to change. `?reach=0` is the old SMG.
- **Names**: Harrow, Rivet, Sabot.
- **All the numbers.** Damage, rate, kick, magazine sizes, what each goes through. First guesses from the tables.
- **Hellfire Rounds on the Sabot** burst on every body the dart passes. That is a lot of blast from one trigger pull.

For the streams that come next (minigun, Lance, sword, the SMG):

- A second weapon on a key is one row in `WEAPONS` plus a viewmodel. `docs/notes/weapons.md`, "Adding a family member", has the whole list and what a row cannot yet say.
- The Lance was left as it was: two walls, each up to 1.6 m. It is one flag away from the metered budget (`penetrateWalls`).
- `canSever` is the field for "takes limbs". The SMG still has it on.

## Main menu background (built, owner asked for a helmet: done)

Owner: a background like the helicopter shot in Metal Gear Solid V's menu, the main character smoking a cigar, instead of a map preview.

Built: the contractor (the player's own body, new: `contractor` in `docs/notes/characters.md`) sits in the Packmule's open door at dusk, back
against the forward post, right boot out over the sill, cigar in his left hand on his knee. A drag every 10 to 15 s with the tip flaring, an exhale
the slipstream pulls out of the door, looks out of the door, weight shifts, a drifting handheld camera, swinging grab straps, rotor flicker on
the sun, dim instruments, a sea of cloud with peaks through it sliding past, scraps of cloud going by close. Quiet cabin loop under the music.
Manual: `docs/notes/ui.md`, "Main menu background".

After the owner's first look ("give him a helmet or mask or something"): he now wears a high-cut helmet in the suit's grey-blue with an
orange stripe, a cold status light and a smoked visor down over his eyes; the jaw and mouth stay bare for the cigar, and a half mask hangs
on his chest strap. The cigar is held up its length and sits in the corner of his mouth on a drag, so the hand no longer covers the mouth.
The cabin was made to read as an aircraft: cloud heads instead of a flat deck that looked like sea, hazard stripes on the sill, a grab
handle on the door post, the gun on a pedestal, the red work light up so the troop seats show. On the splash he is framed above the title,
and the view tilts down to the menu's framing on the click.

- Off-switch: `?menubg=map` (the old flythrough). `?menubg=still` is the still frame that reduced motion gets. Graphics quality Low no longer freezes it.
- About a third of the old background's cost: 2.4 ms a frame with the GPU's work against 7.5, 27 draws against 110 to 190.

For the owner to judge by looking: the helmet and visor, the pose, how dark it is, the cigar's read at menu size, and the door gun, which is
parked swung forward and is mostly behind the Play list at 16:10. The main rotor is never in frame from the cabin floor.

## Future job: the hive mission (planned, on hold)

The second campaign mission, against the zombies on the planet Tallow, is planned and not built. The owner said on 2026-11-10 to hold it: plan it, keep it for a later job, build nothing now.

- The plan is `docs/notes/hive-mission-plan.md`: thirteen stages in build order, from friendly soldiers and the air wing to the two new bosses (the Commander, Reissued, and the Remainder).
- Boss order the owner set: an ordinary Juggernaut, then the Commander back as a new boss that is neither a Juggernaut nor a Titan, then the Titan as a mini boss, then the hive mind that talks to the player all mission.
- No voice lines are to be generated for it yet.
- Start it only on the owner's word. Before building, re-check the plan's facts against the code: weapons, the door gun, executions and the ragdoll stages all changed after it was written.

## Owner decisions, 2026-11-10

Settled by the owner after playing; do not list these as open again.

- **SMG and Harrow:** keep every SMG change, the range falloff included. "The SMG and the assault rifle both feel really good."
- **Parkour:** it "feels really good right now". Vault stays on a jump press. Keep the legs. Camera roll stays at the shipped amount. Whatever else is open on parkour can stay open.
- **Ragdoll stages 1 to 5:** keep every shipped default (rest pose, fall speed 1, knockdown width, push-up help, SMG headshots floor the body).
- **Slot 4:** the Sabot is the first gun on the key and the explosive autocannon is the upgrade behind it.
- **Music:** pinned. The two menu tracks and the playlist plumbing are in; the early-wave and late-wave tracks and the MP3 PLAYER screen wait for a later job. The public site ships with no music at all (the Pages build empties both manifests and drops the track files), and there is no MP3 PLAYER or upload feature to build for now.
- **Hive mission:** planned, on hold (see the section above).
- **Ragdolls and gore, put off to a later job:** the owner said the fighting "feels really, really good" as it is, so ragdoll stages 7 and 8 (`docs/notes/euphoria-plan.md`), gore by weapon (the SMG wounding instead of severing, the head variants) and executions with prisoner questioning are not built. Do not change how ragdolls or gore behave until the owner asks. Stage 6 (losing balance on muscles) and stage 7 (catching balance: a hard stagger goes onto the body's muscles on its feet, and it catches itself or goes over) were then asked for and are built, both behind `?stand=0` for comparison; see their as-built notes in the plan. The owner said yes to an enemy spending up to 2.5 s on physics, unable to attack, in a stagger it might recover from. Stage 8 (wounds set strength) is next and not built. Not played by the owner yet, each against `?stand=0` on `/?map=range`: shotgun a running Trooper's leg, shotgun a standing Trooper in the chest twice, burst the SMG into a Husk until it falls (stage 6); the shotgun to a Trooper's and a Brute's chest at 8 to 10 m, a shot to the thigh while it patrols, and the SMG held on a Brute, with AI off and then on (stage 7). Known: melee gives a body on its muscles on its feet a downed body's low hit volume (`Melee.ts:610`).
- **Built in this update, all committed:** the rest of the weapons (Sabot first on key 4, the Quiver, the Thresher, the Trommel with the Piledriver and the door gun, the Lance, the melee weapons and the katana's reach) and the helicopter scene behind the main menu. The menu scene is on the public site; the Lance, key 5, key 8 and the final check's fixes are local until the owner asks for a push.

## Final check, 2026-11-10 (stopped before its report)

The check ran for 90 minutes and was cut off when the session restarted, so it left no report. This is what its log and saved results (`tools/out/xcheck`, scratch) show.

- **Tests:** all 55 test files ran one at a time. One failed, `src/audio/music.test.ts`, because it still expected the soundtrack on the public site; fixed in `9689fde`. 1055 tests passed. Type check clean.
- **A flaky test, older than this update:** `src/gore/muscles.test.ts`, 'never leaves a stale speed on a sleeping body', fails about 1 run in 24 today ("expected 362 to be less than 360") and failed 4 in 24 at stage 5 (`34c686b`). The file is unchanged since stage 5. Not fixed, because ragdoll code is not to be touched.
- **Ragdolls and gore since stage 5:** the only changes under `src/gore` and the enemy reaction files are 9 lines in `src/gore/wounds.ts` (wound-size rows for the new rounds) and 9 lines in `src/enemies/damage.ts` (a club kill leaves the head on). The gore, reaction, contact and wound test files each passed 6 runs of 6, apart from the flaky test above.
- **Fixed:** a gun that runs dry now hands over to the other gun on its own key first (`84e9714`); the guide, the Commander's lines and the design's key table were brought up to date (`0348c45`); a stale path in the notes (`66c6321`).
- **Load time, production build, on a loaded machine:** 15 to 16 s to the splash for both builds it compared, with one 24 s run; the "Waking the army" step at 97% took 1 to 2 s. The 70 s wait once seen on the live site did not show up locally.
- **Not done:** a two-wave Crucible run on the production build (the menu and the weapon cycle did run on it). Do it as part of the check before the next push.

## Weapons update: key 4 reordered, the Quiver and the Thresher (committed, not played)

What the owner gets:

- **Key 4:** the Sabot is the gun the key gives from the start. The explosive autocannon is its upgrade: the second weapon cache (after wave 4) brings it, and pressing 4 again reaches it. Missions that hand out the autocannon (the Outpost's armoury rack and its later checkpoints) still give the autocannon, and their key 4 draws it.
- **Key 3, the Quiver:** a four-tube box launcher beside the rocket. Hold the trigger near enemies to paint up to four marks, one every 0.2 s, each with a bracket on the HUD and a rising tick; with fewer than four in view the spares stack, on a boss or a vehicle first. Let go and four missiles leave a tube apart, fan out, weave a little and home on their marks; one whose target dies takes the nearest enemy, vehicle or aircraft ahead, or flies on. A tap fires all four straight. Right click drops the marks and keeps the missiles. Bosses, vehicles and the chopper can be painted. One salvo killed a tank and took a fifth off a Juggernaut on the range, twice what four rockets did.
- **Key 2, the Thresher:** a full-auto drum shotgun beside the pump. 20 shells, 5 a second, 4 pellets a shell to the pump's 6, a climb to hold down, a long drum reload.
- Try it: F1, "Quiver: draw it, five targets ahead to paint", hold the trigger on them. Pick Juggernaut first for the stacking.
- Off-switches: `?slot4=old` (key 4 as before: autocannon first and from the start, no autocannon in a cache), `?climb=0` (no Thresher climb), `?families=0` (no second guns at all, and key 4 the autocannon from the start, as before families).

Waiting on the owner:

- **Where the autocannon is earned:** second cache, after wave 4. It pushes the Lance, Buzzsaw, Kiln and Stakegun one pod later each.
- **Names:** Quiver and Thresher.
- **All the numbers**, nobody has played them: the Quiver's paint cone (9 degrees either side of the crosshair), mark rate, turn rate, weave and blast; the Thresher's climb and its damage against the pump's.
- The Quiver and the Thresher also come with the rocket and the shotgun in the Outpost's loadouts, as the Harrow does with the SMG.
- **The Outpost's Sabot:** the armoury rack and the full loadout give the autocannon alone now. Before, the Sabot came with it. Adding `sabot` to the rack and the `full` kit would put it back.

Still open:

- **The first salvo on a page can hitch** (46 to 131 ms measured, once 600 ms, on a loaded machine). A rocket's first blast on a page does the same, so it looks like the shared first-explosion cost, not the Quiver's; there is no warm-up for it yet.
- The Quiver's reload and both guns' draw and fire poses were only checked as stills. Four overlapping blasts show square smoke sprites against the range sky (fx's smoke column, as a rocket's do faintly).
- No voice lines for the new guns.

## The Lance, rebuilt (committed, not played)

Owner's words: "The rail gun currently really sucks. Just make it more fun. The rail gun should have you charge it up, it should be super powerful. And weak shots should have their own utility, like little plasma balls. You charge it up, maybe it shoots through enemies, but then each enemy it pierces through has a little plasma explosion. So you can shoot a beam through a crowd, and if you hit multiple guys it causes a line of explosions."

What was wrong with it: a tap did nothing but fizzle, a press during the wait after a shot was thrown away, a full charge was 420 damage beside a Sabot that does 600 on a click, and the charge was a bar and a hum. Manual: `docs/notes/weapons.md`, "The Lance".

What the owner gets, on key 7 as before:

- **Tap:** a plasma ball, 80 m/s, four a second. 60 on what it hits and a 2.2 m splash, and it puts things on the floor: a Trooper it does not kill goes down with a limb off, and two of them floor a Brute through its plates.
- **Hold:** the charge climbs through three stages, each with a tick that is higher than the last, a notch on the bar under the crosshair, a capacitor lighting on the gun and the view drawing in. Let go at the first for a weak beam through one body, at the second for one through four, at full (1.1 s) for the real thing.
- **The full beam:** 1000 damage through everyone in line, two walls and armour, with a thunderclap, a hard kick, the view thrown wide from the charge's narrowed one, and a freeze on what it struck. Then a plasma burst goes off at every body it passed, one after another down the line, a few hundredths of a second apart: 2.8 m each, and it tears up whoever stood beside the line. Eight in a column with three beside them: all eleven dead in one run.
- **The cell** holds 12: a ball takes 1, a beam 2, a full beam 3. Right click lets a charge go and costs nothing.
- Try it: F1, "Lance: draw it, a column of 8 to shoot through", aim level down the column, hold to full, let go. "Column of 20" is the long line. `/?sandbox=fx&effect=plasmaBurst` is one burst on its own.
- Off-switch: `?lance=old`, the gun as it was.

Waiting on the owner:

- **All the numbers.** How long a tap may be (0.4 s), the stages, 1000 damage, the cost in cells, how big and how fast the bursts are, the kick and the freeze.
- **The ball does not always kill a Trooper in one.** It leaves it on the floor with a limb off about half the time. Say if a tap should simply kill.
- **Bosses.** A single hit can take 5% of a boss at most, the game's own rule, so a full beam is 130 on a Juggernaut. The balls are the better use of a cell on it. Say if the Lance should be the exception.
- **Bursts never gib.** They tear limbs, burn and throw, by the blast table. A gib at every body of a long line would be the heaviest thing a frame could be asked for.

Still open:

- From the gun, a beam down a straight line shows its bursts one behind another. The line of explosions reads best when the beam crosses a crowd at an angle, or from the side.
- Twenty deaths in one shot still cost a worst frame of 40 ms on a warm page and 67 ms on the first shot of a page (load average 8), against 192 ms for the old gun, because the beam kills three bodies a frame instead of all at once. The bursts themselves are 4 ms at worst. The slow frame is a body cut in two plus a head kill: gore's cost. Fewer cut bodies per beam (`cleave` in `TUNING.lance.stages`, now 3) would take it down; say if that is worth it.
- Only the beam's first frame strikes corpses already lying in the line, so a corpse beyond the first three bodies is passed over. The later frames used to strike the beam's own fresh kills a second time at 1000 damage.
- The full beam's view punch is a zoom wider than the view, so for 0.2 s after the shot the look is up to 13% faster.
- The new sounds (`lance_plasma`, `lance_stage`, `lance_thunder`, `plasma_burst`) have been measured, not heard.

## Key 5: a katana that only cuts what it reaches, and four more to swing (committed, not played)

Owner's words: "Add more melee weapons, like maybe a crowbar, knife, shovel, baton. Melee weapons that are fun in their own respect. The katana feels a little bit overpowered because I feel like it can slice people from like a mile away."

Why it cut from a mile away: every swing pulled the player toward anyone within 10 m, standing still or not, and then cut anything in a 120 degree cone out to 5 m from the eye, and anything within 1.7 m, behind included. The charged sweep reached 8 m.

What the owner gets:

- **The katana** cuts what its blade sweeps through: each swing is a slab along the crosshair, 2.0 to 2.2 m out, with a 0.8 m step for a body just past that, so 2.8 to 3 m to the front of a body at most. Nothing behind cover, nothing behind the player. Same damage, timing and slices up close. **Its dash** is now its own move: swing while running at someone within 7 m and it carries you there at 30 m/s with a punch of the view. Standing still there is no pull. The charged sweep reaches 3.2 m. The guard and the finisher are as they were.
- **Press 5 again** for the four beside it, all owned from the start: **Shiv** (knife), **Prybar** (crowbar), **Spade** (shovel), **Cosh** (baton). Each has its own model, swings, right click and sounds.
  - Shiv: two quick cuts, out in 0.08 s, short. Three times the damage on a back turned or anyone reeling, falling or down. Right click thrusts.
  - Prybar: slow, a blow that breaks the arm or leg it lands on and puts people on their heels or the floor. Through armour plate for half again. Takes no limbs off. Right click is an overhead that winds up.
  - Spade: slow and wide. The face is a heavy blow that throws what it kills nearly 3 m. Right click swings the edge: a cut that takes a head off at the neck.
  - Cosh: quick and light. It knocks people down rather than killing them: a Trooper went down on the first blow and took six to die.
- A club's flat swing lands on the arm on the side it comes from, so at an ordinary look the Prybar and the Spade's face break an arm instead of landing on the neck and killing. Aimed at the head they still kill, and a club kill leaves the head on: only the Spade's edge takes heads.
- Every swing of the five reaches down for something low at your feet (a Skitter, a man on the floor), without reaching further.
- Butcher makes the blades sever everything; the clubs still take nothing off.
- The melee key swings whichever of the five is on key 5.
- Try it: F1, draw any of them, then "Melee reach: five at 1.5 to 8 m" (or "Backs turned" for the Shiv).
- Off-switches: `?blade=old` puts the katana's old reach and lunge back. `?melee=old` takes the four new weapons off key 5, leaving the katana alone.

Waiting on the owner:

- **Every number.** The katana's reach and step, when the dash fires and how far, and each new weapon's speed, damage and push.
- **Held, the katana steps on every swing**, so holding the button through a line walks you forward about 0.8 m a swing (1.9 m in a held second). Say if a held chain should stand still.
- **A club kill leaves the head on** (one small hook in `src/enemies/damage.ts`, reached only by key 5's blows). Say if a Prybar to the head should burst it after all.
- **Butcher and the clubs.** Butcher says every hit severs; the clubs are kept out of it, so a Prybar never takes a limb. Say if Butcher should win.
- **The Cosh throws a floored man about 3.7 m**, so the Shiv's bonus on him needs a walk up first.

Still open:

- The four models were judged as stills, not in motion. The Spade's beheading is confirmed by the game's kill event, not yet by a clear still.
- Touched outside the weapon system, all small: `src/enemies/damage.ts` (a club's head kill keeps the head), `src/weapons/families.ts` (`?melee=old`), `src/enemies/commander/tracker.ts` and `index.ts`, `src/enemies/outpost/index.ts` (the new weapons count as melee and make blade noise), `src/enemies/commander/lines.ts` (words for them), `src/progression/index.ts` (Adrenaline counts every melee kill, not only the sword's).

## Key 8: the Trommel, the Piledriver and the door gun (built and committed, not played, not heard)

Owner's words: "The minigun, I don't like that it has a buzzsaw thing. I think the barrels should be thicker. It shouldn't just feel like a super fast assault rifle. It should feel like it's shooting bigger bullets, higher caliber. Not a super big explosion, but it should feel like a 20 millimeter Gatling gun. Very small explosions, grapefruit sized. It should shake the screen a lot and feel more violent. It should slow you down while you're shooting it too." And beside it a heavy machine gun, slower, far more damage and gibbing a round, the one that goes through walls; and the door gunner's gun with both.

Manual: `docs/notes/weapons.md`, "Key 8", "Bursts", "The door gun", "Heavy guns slow the player".

What the owner gets:

- **The BUZZSAW is the TROMMEL**, a 20 mm rotary cannon. The saw was its name, its sound and its look, and all three went: a new name, a low drive and 25 heavy rounds a second where there was a sawtooth whine and 50 light ones, six barrels 3 cm thick in a plain muzzle ring where there were thin ones behind a red toothed disc, and a reticle that no longer spins. 32 damage a round for 13. Every round goes off where it lands in a flash, a crack and a puff the size of a grapefruit. Big brass, a thick tracer on every round, a big orange flash, a lot of shake, and the gun hammers in the hands. By the tables it takes an arm off a Trooper in the swarm with one round, and it knocks down what it kills. It goes through nothing.
- **It slows you**: to 0.8 of a run while the barrels turn (right click still spins it early) and to half while it fires. In the air too, over about a tenth of a second. A dash, a slide, a wall run, a climb, a vault, a slam and anything a pad or a blast threw you at are left alone, and what a dash leaves behind bleeds off over a quarter of a second (a dash-jump's over about a third) rather than stopping you dead where it ends.
- **Press 8 again: the PILEDRIVER**, a heavy machine gun, in the same weapon cache as the Trommel. 90 damage at 8 a second, 50 on the belt, a slow 3 s reload. It goes through an inner wall and everyone behind it (one round killed a file of three Troopers), takes off any limb it touches, bursts three kills in ten, and cuts a dead body in two with one round. It kicks, climbs a little for you to hold down, and slows you to 0.72 of a run while it fires.
- **The door gun** is a 20 mm rotary cannon now: 30 rounds a second of 60 for 60 of 22, and the only gun that does both, bursting where it lands and going on through 1.4 m of roof or wall. Over the Kill House with the sight held on men behind cover, 67 of 73 hits landed on bodies it could not see.
- Try it: F1, "TROMMEL: draw it, nine in three ranks ahead", "PILEDRIVER: the same", "Door gun: board it now". On the Test Range, "Piercing gallery" for the Piledriver.
- **The Commander calls it the Trommel.** His recorded takes say "Buzzsaw", so his lines about it are shown and not spoken.
- Off-switches: `?slot8=old` (the BUZZSAW by name, numbers and model, no Piledriver, the Commander's old takes), `?burst=0` (no round bursts), `?slow=0` (no gun slows you), `?doorgun=old` (the M134).

Waiting on the owner:

- **The names**: Trommel (a rotary drum, and the German for drum, as in drumfire) and Piledriver. Each is one string in its row of `WEAPONS`.
- **How much shake.** It is set high on purpose: about a degree of pitch and roll, re-rolled twenty times a second, for as long as the trigger is held. `shake` in the Trommel's row.
- **The slowdown holding in the air.** The old gun only dragged there, which measured as nothing: a hop with the trigger held kept full speed. Say if a jump should be free again.
- **The door gun's rate was halved** to make each round three times as big. Say if it should keep its sixty a second.
- **Every number**: both guns' damage, rate, belts, kick and climb, the burst's size and its fragments (0.45 m, 10 damage, which seldom reach anyone), how often the Piledriver bursts a body.

Still open:

- **Nothing has been heard.** The sounds were rebuilt once after the first version measured as a rumble too low for small speakers; whether they are deep and violent is for ears.
- **The Commander's Trommel lines are silent.** Eight takes say "Buzzsaw" and voice cannot be made here; new takes saying "Trommel" would bring his voice back.
- **Frame cost**, measured last at a load average of about 6 on `react-chaos.mjs`'s crowd (24 bodies, AI on, a rocket every 0.45 s): p95 19.2 ms alone, 19.3 with the Trommel held into it (23 bursts a second), 18.5 with 60 door-gun bursts a second; the physics step's p95 1.9, 2.0 and 2.7 ms. No console errors.
- Touched outside the weapon system, all small: two rows in `src/gore/wounds.ts` (the wound a 20 mm round and a heavy machine gun round leave; `?slot8=old` keeps the old one), `fx.burst` and two muzzle flashes in `src/fx`, three sandbox checks in `src/sandbox/range.ts`, the body-hit expectations in `src/audio/audio.test.ts`, three lab buttons, and the door gun's barrels in `src/vehicles/guns.ts`, which the menu's helicopter shares.
