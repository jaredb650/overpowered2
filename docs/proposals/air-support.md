# Proposal: the air support update

Status: built. Part 1 2026-11-14 (sections 1, 2, 4 and 5; see "Aircraft: flown or sent in" and "The AC-130" in
`docs/notes/progression.md`). Part 2, section 3, 2026-11-14 (see "The enemy fights the aircraft" there). Written 2026-11-13 from the owner's notes after playtesting; the owner
answered the first round of questions the same day.

## The goal

Air support is the best feeling in the game: you are being overwhelmed, you call it in, and the fight changes. Today it
also makes you untouchable with no consequence. The update keeps the feeling and adds a consequence: the enemies fight
back against the aircraft, not just you, and you can lose one.

The picture to aim for: you stand on the ground with the AC-130, the attack chopper and the door gunner all up at
once, each raining fire in its own style, while rocket troops lock onto them, flares pop and missiles chase them down.

## 1. Every aircraft is both yours and an AI (built)

Applies to the door gunner, the attack chopper and the AC-130. Instant strikes (airstrike, Warthog, Orbital Lance,
Black Sun, nuke) stay as they are.

- **Tap** the call-in key: you take the seat and fly it. **Hold** the key: it goes in as an AI from the start and you
  stay on the ground.
- **E** leaves the seat. The aircraft does not go home: it stays and fights on its own until it is spent (see below).
- Once you leave, you cannot get back in.
- Call-ins only work from your own body on the ground. While you are in a seat you cannot call anything; leave first.
  So with three aircraft ready, you send in the ones you want as AIs first, and tap the one you want to fly last.
- The AC-130 never flies anywhere smart. It holds a fixed left-hand circle over the spot it was called to, like the real
  one (a "pylon turn"). The helicopters keep their current AI flying.
- Under AI control each aircraft uses the same weapons the player does, switching rounds visibly, so you can watch it
  work from the ground.
- **How long each lasts.** Helicopters run until their ammunition is gone. The AC-130 runs on its timer (2 minutes
  today) with unlimited ammunition; only magazines and reloads limit it.

Today: leaving the door gunner sends it home (`doorGunner.ts`), and the AC-130 is AI-only, a 2-minute siege that adds a
gun every half minute.

## 2. The AC-130 in your hands (built)

An attack chopper plus plus. Four weapons, one key each, with a round or fuze toggle on the two that have one.

| Key | Weapon | Modes | Role |
|---|---|---|---|
| 1 | **25 mm Gatling** | none | A beefed-up door gun. Fast fire for crowds in the open |
| 2 | **40 mm cannon** | **HE**: bursts on the first surface, so it clears rooftops. **AP**: goes through several roofs and walls, so it wallbangs. **Flak**: bursts a couple of metres short of the first enemy or surface and throws a cone of heavy pellets forward, a giant shotgun blast | The main tool. Picking the round is the skill: on top of a building, HE; under the roof, AP; behind low cover, flak |
| 3 | **105 mm howitzer** | **HE**: a huge blast. **White phosphorus**: a smaller blast that leaves a burning white cloud; enemies who walk through it catch fire | Slow reload |
| 4 | **Glide bomb** | none | One per sortie. See below |

- **Crew reloads.** Each gun has its own magazine and reloads on its own clock, including while you fire another gun. You
  juggle: drop a 105, switch to the Gatling while it reloads, empty that, switch to the 40 while both reload.
- **Flight time.** Every round takes time to fall from 185 m, so you lead moving targets and paint them.
- **Glide bomb.** Fire it at the spot under the crosshair. The bay takes a few seconds to open, there is a small
  *clink*, and you watch the bomb fall out. It homes on a laser that comes out of the centre of your screen, so you
  steer it all the way down like a wire-guided rocket, and can drag it onto a moving boss. The explosion is one of the
  biggest in the game: bigger than the airstrike's final bomb, a step down from the nuke, with a camera shake you feel on
  the ground.
- **Views.** Three, switched with one key: the current normal view with enemy boxes, white-hot thermal, and black-hot
  thermal. Every view shows every enemy; the views are about the look, not about hiding anything.

## 3. The enemies fight the aircraft (built, part 2)

Built in `callins/antiAir.ts` and `crash.ts`. Flares are on the jump key (Space) in the chopper and gunship seats.

- Anything that fires explosives can turn on an aircraft: Rocketeers, the Juggernaut, other rocket bosses. The Commander
  already shoots call-ins down (`shootDown` in `callins/manager.ts`), which this builds on.
- It is never a flood. At most one or two enemies hunt aircraft at a time across the whole map, and a new one is picked
  only after a cooldown.
- A boss you are pounding from the air turns its missiles on the aircraft doing it.
- **The lock.** A lock-on tone beeps while an enemy locks on. A launch warning sounds when the missile is in the air.
  There is no on-screen marker; instead the missile itself is easy to see: a bright homing missile with a smoke trail
  that you can watch climb toward you and steer itself. That is when you fire flares, and you watch it chase the flares
  and burst in mid-air.
- **Getting shot down.** When an aircraft is shot down with you in it, you are thrown back into your body and it
  crashes.

| | Door gunner | Attack chopper | AC-130 |
|---|---|---|---|
| Missile hits to bring it down | 1 | 2 | 3 |
| Bullets | Hurt it (the helicopter, never you). Far shots travel slowly and rarely land; snipers and close gunmen can hit | Immune | Immune |
| Flares | The pilot fires them on his own. You have no say | 3, fired by you | 3, fired by you |
| Feel | Vulnerable on purpose: low, unarmoured, and whether you are shot down is out of your hands | Mostly safe if you listen for the lock tone | Hard to bring down; still listen for the tone |

- **Flares** have no recharge timer to plan around, because you cannot dodge in a seat. The only limit is a 3-second
  lockout after each pop, so a double press does not waste them.

## 4. Nothing the aircraft fire can hurt you (built)

Your body stays untouchable while you sit in a seat, as today. In survival mode a death resets everything, and you cannot
dodge while flying, so the aircraft is what is at risk, not you.

No aircraft's fire hurts you on the ground either: not the glide bomb, not the 105, not the white phosphorus cloud. You
can walk through a burning cloud. This is the rule today, and it stays.

## 5. What it looks like from the ground (built)

Each weapon has its own signature so you can read the AC-130 working without seeing it:
- the Gatling's stream;
- the 40 mm switching between surface bursts, AP tracers punching through roofs, and flak bursts in the air spraying
  pellets down;
- the 105's big blasts, and white phosphorus clouds with burning streamers;
- the glide bomb falling under its laser, then the whole-screen shake;
- flares popping, smoke trails of missiles chasing the aircraft, missiles bursting on flares, and wreckage when one
  comes down.

## 6. Left out

- A radar or x-ray pulse. Every view already shows every enemy; hiding them only to reveal them again would nerf the
  aircraft.
- Lock-on missiles for the player. They felt like a howitzer that aims itself; the steered glide bomb does the job better.
- Calling a second aircraft from inside a seat.
- Getting back into an aircraft you left.

## 7. Still open

- **Do the 3 flares refill during a sortie?** Default: no, 3 per sortie. Built that way.
- **The door gunner pilot's flares:** how many, and how reliable? Default: 2, and he is sometimes late. Built that way: late 30% of the
  time, and any crew is late as often.

## 8. Pieces, for costing later

Rough sizes only, not measured against the code.

| Piece | Size |
|---|---|
| Tap to fly, hold to send in as an AI; E hands over to the AI; no re-entry; no calling from a seat | Medium |
| AC-130 seat: four weapons, own reloads, flight time, views | Large |
| 40 mm HE / AP / flak rounds (AP may reuse `src/weapons/penetration.ts`) | Medium |
| 105 white phosphorus cloud that sets enemies on fire (may reuse the Burner's fire) | Medium |
| Glide bomb: bay, fall, steering by the screen-centre laser, the blast | Medium |
| Enemy anti-air: picking hunters, lock tone, visible homing missile, flares, hits and crashes | Large |
| Effects and sounds for all of the above | Medium |
