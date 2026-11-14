# Plan: the parkour update

Status: plan, not scheduled. Written 2026-11-13 from the owner's notes after playing; the owner answered the first round
of questions the same day. Nothing here is built. Open details are marked **Q** with the default the build would use.
How movement works today is in `docs/notes/player.md`; every number lives in `src/player/tuning.ts`.

## The goal

The movement is already good. This adds four things: a slam with real weight, climbing up walls, a wall to cling to and
fight from, and a hand-off so a wall run on the right still shows the hand on the wall. The rule from today holds:
nothing happens by accident, every move needs a deliberate key and the right situation.

## 1. Two kinds of slam

**Today:** crouch in the air above 1.2 m slams down at 34 m/s. A jump within 0.14 s of landing bounces back up
(11 to 20 m/s, by fall height). A slam into a slide turns the fall into forward speed. The landing already damages enemies
around it: 4 to 12 m across and 30 to 140 damage, both by fall height (`slamEnemies` in `player/feedback.ts`).

**Small slam** (below the big slam's height): unchanged. The bounce and the slide tricks stay.

**Big slam** (from at least `bigSlamHeight` of fall):
- Both fists into the floor: a first-person animation of the hands punching down, the camera dropping with them.
- A ground impact, not an explosion: a ring of dust and debris rolling outward, a cracked-floor mark, a hard camera thump
  and a deep impact sound. No fire.
- It hits harder and wider than a small slam and throws enemies outward off their feet.
- It kills all momentum. The player is down for `bigSlamRecover` and stands up: no moving, no shooting, and fully
  vulnerable. That is the price of the hit.
- **Dash cancels it**: a dash during the stand-up spends a charge and leaves at once.
- No bounce and no slide out of a big slam.

- **Q1.** Height for a big slam. Default: 6 m of fall.
- **Q2.** Stand-up time. Default: 0.5 s.
- **Q3.** Big slam damage and reach. Default: 1.5 times the small slam's at the same height, and enemies within the
  inner half are knocked down.

## 2. Climbing up a wall

**Today:** wall runs go sideways only, and a mantle reaches 2.2 m.

- **Starting it.** Jump at a wall while facing it (within about 30 degrees) and holding W. Sideways along a wall is still
  a wall run; straight at it is now a climb.
- **The climb.** Two or three steps straight up, about 2 to 2.5 m. The gun is put away: both hands and both feet are on
  the wall.
- **A ledge at the top.** If a ledge comes within mantle reach during the climb, it goes straight into the mantle.
- **Clinging.** Still holding W at the end of the climb, the body sticks to the wall and slides down it, not slowly, not
  falling. The gun comes back out (section 3).
- **Letting go.** Releasing W drops off the wall.

- **Q4.** Steps and height. Default: 3 steps, 2.4 m, over about 0.45 s.
- **Q5.** Slide speed while clinging. Default: starts at 1.5 m/s and builds to 4 m/s, so a long cling is a controlled
  drop.

## 3. Fighting from a wall

While clinging and sliding down, the player twists away from the wall to shoot.

- The gun comes out in the right hand; the left hand stays on the wall.
- The view can turn up to 180 degrees either way from straight into the wall, so the player can shoot along the wall
  in either direction or straight out behind. Only looking into the wall itself is blocked.
- Full accuracy. No penalty.
- **Q6.** The view limit. Default: free everywhere except the half-space facing into the wall, eased at the edge so it
  never snaps.

## 4. Jumping off walls

- **The 180 wall jump.** Space while climbing or clinging kicks the body off the wall, and the camera turns 180 degrees for
  the player, so they come off facing out.
- **Chimneys.** Two walls close together can be climbed all the way up: climb, 180 jump, climb the other wall, and so on.
  There is no limit on how many.
- **Wall kick** (today's move, kept): a jump into a wall that is not a climb or a wall run bounces off it at an angle,
  with no turn of the camera.
- **Wall run to wall run.** Kicking off one wall run into another wall starts a new wall run, back and forth between two
  walls. Check first whether this already works; today's wall run rules are strict and the kick may break one of them.

**The double jump comes back only on the ground.** Touching a wall gives nothing back. Once the player leaves the ground,
they get one double jump until they are back in a normal walking and shooting state. Wall jumps and wall kicks are
separate from it: a double jump, then a wall jump, is fine.

- **Q7.** The camera turn on a 180 wall jump. Default: 0.22 s, eased, with mouse input added on top so the player is never
  locked out.

## 5. The gun in the left hand on a wall run on the right

**Today:** the right hand never leaves the gun, so a wall on the right gets no hand on it.

- At the start of a wall run with the wall on the right, a quick hand-off animation passes the gun to the left hand, and
  the right hand plants on the wall. At the end it passes back.
- The gun is **not mirrored**: it is the same model held in the left hand, so the camera sees its other side. On the
  autocannon, the belt of shells hanging off its left side is out of sight.
- Full accuracy from the left hand. No penalty.
- **Q8.** Hand-off time. Default: 0.15 s each way, firing allowed throughout (the shot comes from whichever hand holds
  the gun at that moment).

## 6. Left out

- A parkour roll on big landings (the owner dropped it).
- Ledge hanging and shimmying.
- Colliding with enemies, and vaulting off them.

## 7. Pieces, for costing later

Rough sizes only, not measured against the code.

| Piece | Size |
|---|---|
| Big slam: threshold, stand-up lock, dash cancel, stronger hit and knockdown | Small to medium |
| Big slam look: fists-down animation, dust and debris ring, floor mark, sound | Medium |
| Wall climb state, holstered gun, climb into mantle | Medium |
| Cling and slide down, gun out, view limited away from the wall | Medium |
| 180 wall jump with the camera turn; chimneys | Small to medium |
| Wall run to wall run (check first; may be a small rule change) | Small |
| Double jump only back on the ground (check today's rule) | Small |
| Left-hand hand-off: animation, left-hand grip per weapon, the right hand on the wall | Large (every gun needs a left-hand hold) |
| New sounds: big slam impact, climbing steps, wall slide scrape | Small; the owner sources them |
