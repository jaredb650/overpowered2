# Proposal: the air support update

Status: idea, not scheduled. Written 2026-11-13 from the owner's notes after playtesting. Nothing here is built.
Open questions are marked **Q** with the default the build would use.

## The goal

Air support is the best feeling in the game: you are being overwhelmed, you call it in, and the fight changes. Today it
also makes you untouchable with no consequence. The update keeps the feeling and adds the consequence: the enemies fight
back against the aircraft, not just you, and you can lose an aircraft.

The picture to aim for: you stand on the ground with the AC-130, the attack chopper and the door gunner all up at
once, each raining fire in its own style, while rocket troops lock onto them, flares pop and missiles chase them down.

## 1. Every aircraft is both yours and an AI

Applies to the door gunner, the attack chopper and the AC-130. Instant strikes (airstrike, Warthog, Orbital Lance,
Black Sun, nuke) stay as they are.

- When you call it in, you are in the seat and in control.
- **E** leaves the seat. The aircraft does not go home: it stays and fights on its own until its ammunition (helicopters)
  or its time (AC-130) runs out.
- Once you leave, you cannot get back in.
- The AC-130 never flies anywhere smart. It holds a fixed left-hand circle over the spot it was called to, like the real
  one (a "pylon turn"). The helicopters keep their current AI flying.
- Under AI control the aircraft uses the same weapons the player does, switching rounds visibly, so you can watch it work
  from the ground.
- **Q1.** Several at once: you can only sit in one seat. If you call a second aircraft while seated, default: you move to
  the new seat and the old one carries on as an AI.
- **Q2.** Can you call one straight into AI mode without taking the seat (for the "orchestra" picture)? Default: tap
  the key to take the seat, hold it to send it in as an AI.

Today: leaving the door gunner sends it home (`doorGunner.ts`), and the AC-130 is AI-only, a 2-minute siege that adds a
gun every half minute.

## 2. The AC-130 in your hands

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
- **Glide bomb.** Click the spot. The bay takes a few seconds to open, there is a small *clink*, and you watch the bomb
  fall out and guide itself onto the spot. The explosion is one of the biggest in the game: bigger than the airstrike's
  final bomb, a step down from the nuke, with a camera shake you feel on the ground.
- **Views.** Three, switched with one key: the current normal view with enemy boxes, white-hot thermal, and black-hot
  thermal. Every view shows every enemy; the views are about the look, not about hiding anything.
- **Q3.** Which gun is the second one in real life? The current AC-130J carries a 30 mm gun; the older AC-130U carried a 40 mm.
  Default: 40 mm, because it is slower and heavier and the game already has a 40 mm round.
- **Q4.** Glide bomb guidance: fixed at release, or does it follow your mark while it falls, so you can drag it onto a
  moving target? Default: it follows the mark, like a laser-guided bomb.
- **Q5.** Does the AC-130 still run on a timer (2 minutes today) with ammunition only limited by reloads, while the
  helicopters run until their ammunition is gone? Default: yes.

## 3. The enemies fight the aircraft

- Anything that fires explosives can turn on an aircraft: Rocketeers, the Juggernaut, other rocket bosses. The Commander
  already shoots call-ins down (`shootDown` in `callins/manager.ts`), which this builds on.
- It is never a flood. At most one or two enemies hunt aircraft at a time across the whole map, and a new one is picked
  only after a cooldown.
- A boss you are pounding from the air turns its missiles on the aircraft doing it.
- **The lock.** A lock-on tone beeps while an enemy locks on; a launch warning sounds when the missile is in the air; the
  missile takes a few seconds to arrive.
- **Flares.** In the attack chopper and the AC-130, you fire flares yourself. In the door gunner, the pilot fires them on
  his own and you have no say: that is the reason to pick the other two.
- **Armour.**
  - Door gunner: unarmoured. Bullets from far away travel slowly and rarely hit, but snipers and close gunmen can hit it.
  - Attack chopper and AC-130: immune to bullets, only missiles hurt them.
- When an aircraft is shot down with you in it, you are thrown back into your body and it crashes.
- Your body stays untouchable while you sit in a seat, as today. In survival mode a death resets everything, and you
  cannot dodge while flying, so the aircraft is what is at risk, not you.
- **Q6.** How many missile hits does each take? Default: door gunner 1, attack chopper 2, AC-130 3.
- **Q7.** Flares: a few charges that refill slowly, or a cooldown? Default: 3 charges, one back every 15 s.
- **Q8.** When the door gunner is hit by bullets, what loses health: the helicopter or you? Default: the helicopter.

## 4. What it looks like from the ground

Each weapon has its own signature so you can read the AC-130 working without seeing it:
- the Gatling's stream;
- the 40 mm switching between surface bursts, AP tracers punching through roofs, and flak bursts in the air spraying
  pellets down;
- the 105's big blasts, and white phosphorus clouds with burning streamers;
- the glide bomb's whole-screen shake;
- flares popping, smoke trails of missiles chasing the aircraft, and wreckage when one comes down.

## 5. Left out

- A radar or x-ray pulse. Every view already shows every enemy; hiding them only to reveal them again would nerf the
  aircraft.
- Lock-on missiles for the player. They felt like a howitzer that aims itself; the glide bomb does the job better.

## 6. Pieces, for costing later

Rough sizes only, not measured against the code.

| Piece | Size |
|---|---|
| Seat then AI handover for all three aircraft, no re-entry | Medium |
| AC-130 seat: four weapons, own reloads, flight time, views | Large |
| 40 mm HE / AP / flak rounds (AP may reuse `src/weapons/penetration.ts`) | Medium |
| 105 white phosphorus cloud that sets enemies on fire (may reuse the Burner's fire) | Medium |
| Glide bomb: bay, fall, guidance, the blast | Medium |
| Enemy anti-air: picking hunters, lock, missile, flares, hits and crashes | Large |
| Effects and sounds for all of the above | Medium |
