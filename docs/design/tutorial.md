# Retraining: the tutorial

Status: built, 2026-11-17. This page describes what is in the game. The owner's direction: short, every mechanic once, one tight drill
each, chained, no repetition; the Council as narrator in her own box, subtitles only; the voluntary exit door; the Yard outdoors for
the skyhook; and a nuke on a town of begging prisoners to finish.

| Where | What |
|---|---|
| `src/campaign/missions/retraining.ts` | The mission: zones, marks, doors and the beats, as data |
| `src/campaign/missions/retraining.lines.ts` | Every word the Council says |
| `src/campaign/retraining.ts` | What no system did already: held subjects, drills with a retry, the shop outside a break, the exit door |
| `src/world/map/annex/` | The map, the Retraining Annex. `plan.ts` holds every number |
| `src/contracts/firstLaunch.ts` | "Has this browser ever played?", and the saves that answer it |
| `src/contracts/data.ts` | The `retraining` contract (`training: true`), on the `annex` map |
| `tools/scripts/retraining-run.mjs` | A browser run from the clone bay to the door, with a screenshot at every station |

## 1. Premise and tone

The contractor has been **selected for retraining**. A fresh one is issued from a clone pod in the Retraining Annex, a Bureau
training site, and walked north through every system the game has. The targets are **subjects**: captured men, held standing with
their hands up, begging through the garrison's own lines. The Council does not hear them. That is the joke and the horror both: the
Bureau does not hate these men; they are an item on a training budget.

**The Council** narrates, in the box the missions already use (the pyramid with the eye, `THE COUNCIL · Office of Societal
Compliance`). No new voice is recorded: every line shows as a subtitle for its reading time. Her lines never name a key; the hint
under them carries the player's own binding. Each station's first line cuts off whatever the last station was still saying, so she
is always talking about where the player is. The finale's lines are quietly ominous, not jokes.

## 2. How it is reached

| Way in | What happens |
|---|---|
| **First launch**, bare link | Play goes straight into Retraining instead of opening the Play menu (`mainmenu.ts`). It loads the `retraining` contract |
| **Invite link** (`?join=`) | Never. The invite flow is untouched, and the Play check refuses whenever `INVITE` is set |
| **Returning player** | Play opens the normal menu. **Play → Training** starts it |
| URL | `?contract=retraining`, and `&beat=<id>` to start at a station |

**First launch** means localStorage holds none of: `op2.retraining.v1`, `op2.played.v1`, any `op2_highscore*`,
`op2_campaign_beaten`, `op2_starter`, `op2.implants.worn`, `op2.crucible.rules.v1`, `op2_coop_match`,
`op2.settings.v1`, `op2.bindings.v1`/`v2`, `op2_adsZoom`. Keys written without playing (`op2_browser`, `op2_coop_name`, which is made up on load, the lab, cheats,
reports, the chunk-reload flag) do not count. Storage that throws reads as a returning player, so nobody is ever trapped.

- `op2.played.v1` is written the first time any run starts, in any mode.
- `op2.retraining.v1` is written as Retraining starts, and again on the way out with where the player left (`{ seen, finished, left }`).
  Either one means the next Play is the normal menu.

**The voluntary exit.** There is no skip button. Behind the spawn pod is a door under a sign, **EXIT · VOLUNTARY**, with white light
beyond it. The Council's opening tells the player they are free to leave through it at any time and are highly encouraged not to.
Walking through it at any point fades the picture, she says a parting line chosen by how far they got, the save is written, and the
game goes back to the menu (`quitToMenu`, no mission-complete screen).

| Left at | Line |
|---|---|
| The clone bay | "Contractor has declined retraining in under a minute. This has been noted as decisive. Have a productive day." |
| Mobility | "Retraining incomplete. Your file will say so, in a small font. Nobody reads the small font. I read the small font." |
| The Gallery to the Ring | "You were nearly useful. The remaining modules will be held for you. They do not expire. Neither do notes." |
| The Yard or the balcony | "You have left before the part with the explosion. This is unusual. It has been flagged as unusual." |
| After the nuke | "Retraining complete. You may now leave through the door you were always free to leave through." |

The door works from anywhere because it is a zone the run watches every frame; after the nuke the player is brought back to stand in
front of it. The pause menu's Quit to menu also still works.

## 3. The Annex

One route north, roofless behind tall walls, so the capture drone and every call-in have sky. Coordinates: x east, z south; the route
runs along -z.

```
 z  +22  [ dark corridor, white light ]   <- EXIT · VOLUNTARY
    +14  ================ door =================
         INTAKE: clone pods, the player's pod in the middle
      0  ============= doorway north ===========
         MOBILITY HALL (16 m wide, 20 m walls)
     -6    duct: a wall with a 1.2 m slot under it          CROUCH
    -18    waist-high cover                                  vault
    -26    the slide slot, 1.15 m high, 8 m long             SLIDE
    -40    the mantle wall, 2.8 m: its top is the take-off
    -46    dash pit, 16 m (jump + double jump = 14 m)        DASH
    -62    landing
    -68    wall-run pit, 26 m, cyan stripes on both walls    WALL RUN
    -94    landing
   -100    the chimney: a 2.4 m shaft to 14.8 m              CHIMNEY
   -106    slam pit, a ring of five subjects                 SLAM
   -126    rocket ledge, 7 m, no-climb; on it the jet tower, 7 m more, no-climb   ROCKET JUMP, JUMP JET
   -133  ==== shutter (at 7 m) ====
         THE GALLERY: landing, stairs down, the lane, the supply pod's pad (east), a low wall and trench
   -200  ==== shutter ====
         THE CUTTING ROOM
   -226  ==== shutter ====
         THE QUIET ROOM: low rooms hiding three subjects (south), a painted ring (north)
   -270  ==== shutter ====
         THE YARD (outdoors, 60 m wide): sandbags, a roofless shed (east), floodlights, stairs up the balcony block
   -334  THE BALCONY, 6 m up, a glass parapet north, a back wall the blast throws you into
   -346  THE TOWN: eleven destructible shacks, twenty subjects, floodlit
   -404
```

## 4. The stations

Every station has a completion check (a zone, a game event, or a signal from `retraining.ts`) and a retry. A drill fails without
dying (a pit, a walk instead of a slide, a landing instead of a slam): the player is put back at its start with a hint. A death is the
campaign's own: back to the last checkpoint with its kit, and a "Replacement contractor issued" line.

| Beat | Teaches | Done when | Retry |
|---|---|---|---|
| `intake` | Moving; the voluntary exit; the premise | Walks into the hall | (The door ends the run) |
| `crouch` | Crouch (`slide` held); vaulting the cover after it | Out of the duct | It is a wall with a slot: only a crouch fits |
| `slide` | Slide: press and hold at full speed; slide-jump in the hint | A slide seen inside the slot, then out of it | Walked through: back to the start of the run-up |
| `dash` | Mantle the wall; jump, double jump, dash across | On the landing | The pit puts the player back on the take-off |
| `wallrun` | Wall run along either wall, kick off | On the far landing | As the dash |
| `chimney` | Wall climb, the 180 jump off a wall, chimney up a 2.4 m shaft | At the top | (Falling only costs the climb) |
| `slam` | Ground slam; the big slam from 6 m+ knocks men down | A big slam (`player:slam`, `big`) | A landing or a small slam: back on top |
| `rocket` | Rocket jump (the launcher is issued here) | On the ledge | Try again |
| `jet` | Jump Jet: it replaces the double jump, jump again or hold to burn, the tank | On the tower | Try again. The implant is fitted for this beat and taken off after |
| `lane` | Firing (no spread on bullets), aiming, the focus zoom (hold dash while aimed), reloading. The SMG has HP fitted | The subject is dead | (He is held: he waits) |
| `armour` | HP on a plated man: the rounds stop on the plate | Three rounds stopped by his plate | Keep shooting. He is made sturdy, so HP wounds never kill him |
| `shop` | The supply pod lands on its pad. E opens Procurement: buy and fit SMG AP rounds. 1,000 scrip is given | `smgAp` fitted | The pod stays all run |
| `ap` | AP through the plate; the Council lists +P, flechettes, API, Raufoss and flak, all sold at the pod | He is dead | — |
| `grenade` | Cook and throw: three subjects in the trench | All three dead | Two grenades; any way that kills them counts |
| `stim` | The corrective floor drops health to 35; use a stim | `stim:inject` | — |
| `blade` | Every magazine is emptied. "Contractor, when you run out of ammunition, here is your standard issue blade." Quick melee on F from any gun, 5 draws it, the chain, the stab, the guard, the dash-slash | Three subjects dead | — |
| `energy` | The energy blade, fitted: faster, a longer lunge, through plate | The plated subject is dead | — |
| `sonar` | Lights out. Sonar on T shows every living body through walls: hidden men, running men | A ping, and the three hidden subjects dead | — |
| `kata` | Akimbo (the Rivet's second pistol, fitted), the Gun Kata brain chip: hold T to charge. Thermal and Focus named in the hint | `chip:kata` | Charge again |
| `surrender` | Live conscripts. Break the squad, leave the last man, stop shooting: he kneels | `enemy:surrendered` | If he will not, he kneels after 4 s as the last of his squad standing (`tut.yield`). If the player kills everyone, two more come |
| `question` | Tap E to question. Every squad still fighting is marked through walls for 9 s: here, the ambush in the shed | `prisoner:questioned` | — |
| `release` | Tap E again to let him go; released men raise the next man's odds | He is released | — |
| `capture` | Fight the shed. Hold E on a kneeling man: cuffed, the drone's skyhook lifts him away, the bounty is paid | `prisoner:secured` | As `surrender` |
| `balcony` | The town fills with twenty subjects among the shacks, begging. The balcony is 6 m up behind a glass parapet, so all of it is in view | On the balcony | — |
| `nuke` | The Council hands over the Tactical Nuke: N to aim, click to confirm | `callin:used`, `nuke` | — |
| `after` | The blast; the shacks go with the front; her closing lines; the player is brought back to the exit door | Walking out (the door) | — |

The finale's lines:

> Contractor. The Council's capabilities are beyond your imagination. You are not expected to imagine them. Only to know that they exist.
>
> High-performing contractors are given access to the most powerful weaponry in the known universe. You have been given access. Call it in.
>
> What you are about to witness is a fraction of what the Council is capable of. A small fraction.
>
> The Council can deliver this anywhere in the universe. On command. Any planet. Any town. Any address.
>
> Retraining complete. Your conduct has been noted. Please remember what you saw. The Council will.
>
> The exit is the door you were shown when you arrived. It is still unlocked. It is now recommended.

## 5. Held subjects

A held subject (`tut.held` in `retraining.ts`) is a garrison trooper with no behaviours and no attacks, posed `handsUp`, turned to
face the player, never in the prisoner loop (no E prompt, no kneeling, so none of the kneeling x5 damage and plate skip), and made a
holdout so his nerve never breaks. Armour is kept or stripped per lesson. Every few seconds one within earshot begs through the
garrison chatter (`beg`, `surrender`, `panic`), with its recorded voices. Each station sweeps the last station's survivors off the map
before it fills its own.

## 6. The tutorial's calls

The mission is data; what it needs beyond the runner's steps is a `tut.*` call, handled by `retraining.ts`.

| Call | Does |
|---|---|
| `tut.begin` | Writes `op2.retraining.v1` |
| `tut.held` `group:light\|plated:marks` | Held subjects on those marks; `clear:<group>` is signalled when all are dead |
| `tut.town` `marks` | The town's subjects |
| `tut.sweep` | Takes every held subject off the map |
| `tut.drill` `slide\|slam` | Watches a drill and puts the player back with a hint when it is done wrong |
| `tut.sturdy` / `tut.mortal` `group` | A deep health pool, then the real one back |
| `tut.fit` / `tut.unfit` `mod` | Grants and fits a mod, or takes it off |
| `tut.credits` `n` | Scrip into the shop's purse |
| `tut.pod` `mark` | A supply pod onto that mark (it stays: `SHOP_ANYTIME`) |
| `tut.drain` / `tut.refill` | Every magazine and reserve emptied, or filled |
| `tut.hurt` `n` | Health down to n (the corrective floor) |
| `tut.callin` `id` | Hands over a call-in |
| `tut.jumpjet` `on\|off` | Fits the Jump Jet for its tower (opening an implant slot), and takes it off |
| `tut.await` `fitted:<mod>\|released\|clear:<group>` | Signals that name once it is true, however long it takes |
| `tut.yield` `tag\|off` | The last man of that tag still up, fighting or running, kneels after 4 s |
| `tut.home` | Fades and brings the player back to the exit door |

Shared files touched, a line or two each: the shop is on for the `training` contract and open outside a break with every row released
(`SHOP_ANYTIME`, `contracts/shop`), its pod is not retired outside a break (`pods.ts`), the campaign builds `Retraining` for this
mission and routes `tut.*` calls to it (`campaign/index.ts`), the validator counts a call's comma-separated arguments as used names,
the map table and the sign atlas have the Annex's entries, and the menu has Play → Training and the first-launch check.

## 7. Mechanics shown only in words

Kept short on purpose, these are named in a hint or a line rather than drilled: the double jump on its own (it is inside the dash),
wall kicks on their own (inside the wall run), the cling, ADS hold vs toggle, weapon families and dropping a gun (U), shotgun spread,
wound zones (their labels show on every kill), +P, flechettes, API, Raufoss and flak (sold at the pod and named by the Council),
Thermal and Focus, the combo moves and parry beyond the hint, fleeing and cornered men, the fake surrender, streak perks, every call-in
but the nuke, the Distraint Frame, the Flail, and co-op revive.

## 8. Testing

- `src/campaign/missions/retraining.test.ts`: the mission validates clean, every line it says exists, a bot plays every beat in order
  to the door from the top and from five stations, and the first-launch rules.
- `tools/scripts/retraining-run.mjs` plays it in a real browser with the player's keys wherever a bot can, lists every place it had
  to teleport or kill under `cheats`, and screenshots every station and the nuke.
