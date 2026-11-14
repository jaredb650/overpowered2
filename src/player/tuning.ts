/**
 * Every movement and view number in one place, so a change can be asked for by name. Speeds are m/s, accelerations
 * m/s^2, times seconds, heights meters. The objects are mutable on purpose, so the sandbox and tests can tune live.
 *
 * Normal running is planted and speed is something the player earns (DESIGN section 13). The feel comes from four
 * numbers more than any others: `runSpeed`, `groundAccel`, `groundGrip` and `overspeedDecel`. See docs/notes/player.md.
 */
const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
const vaultFlag = query?.get('vault') ?? null;
/** `?movefix=0` takes the parkour pass's repairs to the old moves back out: the thin ledge, the wall-run seam, the jump off the top of a climb. */
const fixes = query?.get('movefix') !== '0';

export const MOVE = {
  // Fixed simulation
  hz: 120,

  // Body
  radius: 0.45,
  standHeight: 1.8,
  crouchHeight: 1.0,
  eyeStand: 1.62,
  eyeCrouch: 0.86,
  eyeSlide: 0.7,
  eyeRate: 16,

  // Collision
  skin: 0.01,
  maxSlopeDeg: 50,
  stepHeight: 0.45,
  /** A step-up always advances at least this far, so a hit at the very end of a tick cannot stall on a riser. */
  stepMinForward: 0.06,
  /** How far below the feet a grounded player is pulled back down. Covers stairs and ramp crests at speed. */
  snapDown: 0.5,
  /** A surface moving away from the player faster than this breaks the snap, so ramps launch. */
  snapMaxSeparation: 2.5,
  /** Eye smoothing after step-ups and snaps. */
  stepSmoothRate: 18,
  /** CG.World and CG.Barrier. */
  collisionMask: 1 | (1 << 8),
  /** Meters under the world's bounds at which a falling player is brought back to a spawn. */
  lostBelowWorld: 25,

  // Ground. Push-off is slower than grip: a heavy body takes a moment to get going but its feet do not slide.
  gravity: 32,
  /** Top speed on foot. The first game sprinted at 13.6. */
  runSpeed: 12.5,
  /** Building speed in the direction of the keys: 0 to run speed in 0.18 s. */
  groundAccel: 70,
  /** Killing speed in any other direction. This is what removes drift from a turn or a reversal. */
  groundGrip: 240,
  /** Stopping with no keys held: 0.125 s and 0.8 m from a run. */
  stopDecel: 100,
  /** Speed above run speed scrubs off this fast with a key held: 28 m/s back to a run in 0.2 s. */
  overspeedDecel: 75,
  crouchSpeed: 5.5,
  /** A fresh jump press this long after touchdown still keeps the landing speed. The other half of the hop window is `jumpBuffer`. */
  landGrace: 0.06,
  /** The stumble after a landing that was not a hop: run speed is cut by up to `landWeightSlow`, recovering over `landWeightTime`. */
  landWeightTime: 0.14,
  landWeightSlow: 0.3,
  /** Landing speed that earns the whole stumble. A plain jump lands at 9.5. */
  landWeightImpact: 16,

  // Jump
  /** Clears 1.41 m. Air time 0.59 s. */
  jumpSpeed: 9.5,
  /** A press this long before touchdown is held for the landing. */
  jumpBuffer: 0.1,
  coyote: 0.1,
  /** Holding Space hops on every landing, for players who ask for it. Default for Player.holdToHop. */
  holdToHop: false,
  doubleJumpSpeed: 9,
  /** Fraction of the angle to the input direction that a double jump turns the velocity through. */
  doubleJumpRedirect: 0.85,
  doubleJumpMinSpeed: 9,

  // Air. W+strafe is Quake's accelerate. Strafe alone is CPMA's: a tiny wish speed with huge acceleration turns
  // hard and gains less. W alone steers velocity at constant speed.
  airWishSpeed: 12.5,
  /** Strafe gain. Perfect gain is `airAccel * airWishSpeed^2 / speed` m/s per second. */
  airAccel: 0.6,
  /** Below wish speed, so a standing jump still goes somewhere. */
  airAccelSlow: 2,
  /** Braking with S in the air. */
  airStopAccel: 2,
  sideWishSpeed: 1.2,
  sideAccel: 40,
  /** How hard W alone pulls velocity toward the view. Low, so a jump is an arc the player committed to. */
  airControl: 60,
  /** Past this, drag starts. It sets where strafing tops out. Launches from pads and blasts ignore it until landing. */
  softCap: 24,
  softDrag: 1.2,

  // Dash
  dashCharges: 2,
  dashRecharge: 1.4,
  dashSpeed: 26,
  dashTime: 0.12,
  /** A dash is always this much faster than the speed it started from, so it stays a burst at high speed. */
  dashMinGain: 5,
  /** Speed a dash leaves behind. Near run speed, so the player is running again at once rather than skating. */
  dashExit: 13,
  /** Speed left behind when a jump or slide cuts the dash short, which is the dash-jump tech. */
  dashKeep: 18,
  dashBuffer: 0.08,

  // Slide
  slideEntrySpeed: 9,
  slideBoost: 1.25,
  /** The boost cannot lift speed past this, or chained slide-hops would outrun strafing. */
  slideBoostCap: 20,
  slideBoostCooldown: 1.25,
  /** Constant slowdown. This sets the slide's length from a run. */
  slideFriction: 7,
  /** Extra slowdown per m/s above run speed, so a slide from a fast landing also ends. */
  slideOverDrag: 0.6,
  slideBrake: 14,
  slideSteer: 1.6,
  /** Gravity along a slope. Above 1 on purpose: downhill must beat friction. */
  slideGravity: 1.6,
  /** The slide ends here. High enough to read as a clear stop rather than a slow fade. */
  slideEndSpeed: 6.5,

  // Ground slam
  slamSpeed: 34,
  slamGravityScale: 2.2,
  slamMaxSpeed: 70,
  /** Below this height a press queues a slide for the landing instead of slamming. */
  slamMinHeight: 1.2,
  slamBounceWindow: 0.14,
  /** Fraction of the fall's energy a bounce gives back. */
  slamBounceReturn: 0.6,
  slamBounceMin: 11,
  slamBounceMax: 20,
  /** Forward speed per meter fallen when a slam lands straight into a slide, while the slide boost is ready. */
  slamSlideGain: 0.5,
  slamSlideMaxGain: 6,
  slamRadiusMin: 4,
  slamRadiusMax: 12,
  /** Fall height that earns the biggest shockwave. */
  slamRadiusFall: 12,
  /**
   * A slam from at least this high is a big slam: both fists into the floor, a wider and harder hit, every bit of momentum
   * gone, and `bigSlamRecover` seconds on the floor with no moving and no shooting. No bounce and no slide come out of it.
   */
  bigSlamHeight: 6,
  bigSlamRecover: 0.5,
  /** Reach of a big slam against a small one's from the same height. Damage scales in `FEEDBACK.bigSlamDamage`. */
  bigSlamReach: 1.5,
  /** Eye above the feet while down on the fists. */
  bigSlamEye: 1.0,

  // Wall run. A wall run needs all of: airborne a moment, W held, moving along the wall, steering a little into it,
  // and a wall long enough to run on. A brush against a wall meets none of that.
  wallMaxNormalY: 0.26,
  wallRunMinSpeed: 8,
  wallRunEndSpeed: 5,
  wallRunSpeed: 15,
  wallRunAccel: 20,
  /** Gravity-free time. */
  wallRunHold: 0.9,
  wallRunMax: 1.8,
  wallRunFallScale: 0.25,
  wallRunMaxFall: 7,
  wallRunVyDamp: 9,
  wallRunEntryMaxVy: 4,
  wallRunEntryMinVy: -1.5,
  wallRunMinHeight: 0.8,
  /** Time off the ground before a wall can catch the player, so a jump beside a wall stays a jump. */
  wallRunMinAir: 0.12,
  /** Sine of the steepest approach of the body that still attaches. Steeper hits are head-on. */
  wallRunMaxInto: 0.6,
  /** Sine of how far the keys must steer into the wall, least and most: about 9 to 53 degrees. */
  wallRunWishMin: 0.15,
  wallRunWishMax: 0.8,
  /** Cosine of the widest angle between the keys and the body's direction: about 50 degrees. */
  wallRunWishAlong: 0.64,
  /** The wall must carry on this far ahead. Door jambs, pillars and crate ends are not walls. */
  wallRunAhead: 2.5,
  wallProbe: 0.42,
  /** Speed the player is drawn onto a wall that curves away. */
  wallPull: 9,
  /** A wall missing under the run for less than this is a seam, not the end of the wall. 0 ends the run on the first miss, as it used to. */
  wallRunGrace: fixes ? 0.05 : 0,

  // Wall kick
  /** Gap to the wall a press in the air can kick from. */
  wallKickReach: 0.4,
  /** Speed toward the wall a kick needs. Running parallel to a wall, a press is a double jump. */
  wallKickMinInto: 1.5,
  wallKickOut: 7,
  wallKickUp: 8.5,
  wallKickSpeedMult: 1.04,
  wallKickSpeedAdd: 1,
  wallKickSteer: 0.6,
  wallKickLock: 0.25,
  wallCoyote: 0.15,

  // Wall climb. A jump at a wall, looking straight at it with W held, goes up it hand over hand. Along the wall is still a
  // wall run. The gun is away for the climb.
  /** Cosine of the widest angle between the view and straight into the wall: about 30 degrees. */
  climbFacing: 0.866,
  climbSteps: 3,
  /** Height the steps add, on top of whatever the jump was still carrying, and the time they take. */
  climbHeight: 2.4,
  climbTime: 0.45,
  /** Time off the ground first, so a jump from against the wall leaves the floor before the hands take over. */
  climbMinAir: 0.1,
  /** Falling faster than this is a fall past a wall, not a jump at it. */
  climbMinVy: -6,
  /** Speed the body is held into the wall while on it, so contact is made every tick. */
  wallPress: 2,
  /** Still holding W at the top of the climb: the body sticks and slides down, this fast at first, building to the most. */
  clingSlideStart: 1.5,
  clingSlideMax: 4,
  /** Seconds from the first slide speed to the most. */
  clingSlideBuild: 1,
  /** While clinging the view can turn anywhere but into the wall: turning toward it slows from this angle off the wall's plane (radians). */
  clingViewEase: 0.35,
  /** Space while climbing or clinging: off the wall, out and up, and the view turned to face away from it. */
  wallJumpOut: 7.5,
  wallJumpUp: 9,
  /** Seconds of the view's turn, eased. Mouse motion adds on top of it. */
  wallJumpTurn: 0.22,

  // Mantle. Airborne only: on the ground the player must jump first, so nothing lifts them unasked.
  /** Highest ledge above the feet the hands can reach. */
  mantleReach: 2.2,
  mantleMinRise: 0.3,
  /** Cosine of the widest angle between the keys and the ledge: about 45 degrees. */
  mantleFacing: 0.7,
  mantleRiseSpeed: 7,
  /** Rise speed also follows horizontal speed, so a fast mantle is not a pause. */
  mantleRiseFromSpeed: 0.5,
  /** Forward speed guaranteed at the top, enough to clear the lip. */
  mantleExitSpeed: 6,
  /**
   * How far the climb carries the body in toward the ledge, and the share of the climb after which it starts. 0.57 ends it
   * standing on the ledge instead of beside it. It is 0, the old top-out, because the campaign's lesson tests judge a climb
   * and a crossing by where the body first stands, and any carry moves that: see docs/notes/player.md.
   */
  mantleCarry: 0,
  mantleCarryFrom: 0.65,
  /** A ledge this thin still gets a hand on it: a rail, or the top of a wall. 0 misses them, as it used to. */
  mantleThin: fixes ? 0.08 : 0,
  /**
   * Seconds after a climb in which a jump is a jump off the top. The climb ends with a few ticks of air before the feet are
   * on the ledge, and a press there, or one made during the climb, used to spend the double jump. 0 is that again.
   */
  mantleTopJump: fixes ? 0.1 : 0,

  // Vault. Waist-high cover with floor behind it, taken on one hand at the speed the player arrived with.
  /** Off with `?vault=0`: a jump at cover is a jump again. */
  vault: vaultFlag !== '0',
  /**
   * Vault with no key, from a run straight into the cover. Off by default, because cover is also something to stop
   * behind and nothing here happens by accident. `?vault=auto` or the lab panel turns it on.
   */
  vaultAuto: vaultFlag === 'auto',
  /** Speed toward the cover a press needs, and the speed the vault never drops below. */
  vaultMinSpeed: 7,
  /** Speed the no-key version needs: a run, not a walk up to the cover. */
  vaultAutoSpeed: 10.5,
  /** Body centre to the face of the cover at the press. */
  vaultReach: 1.9,
  /** Cosine of the widest angle between the run, the keys and the cover: about 40 degrees. */
  vaultFacing: 0.76,
  /** Lowest and highest top that counts as cover. Lower is a step, higher is a mantle. */
  vaultMinRise: 0.5,
  vaultMaxRise: 1.35,
  /** Deepest cover. Anything deeper is a platform, and a jump lands on it. */
  vaultMaxDepth: 2.6,
  /** The far side may be this much lower than the near side. */
  vaultMaxDrop: 1.5,
  /** Lower than this on the far side is a drop: the vault ends level, in the air past the cover, and the player falls the rest. */
  vaultStepDown: 0.15,
  /** Feet over the top by this much. */
  vaultClear: 0.06,
  /**
   * The shortest a vault lasts where the far side has room, so the hand has time to plant. The body never slows to fill
   * it: the path is made that much longer instead.
   */
  vaultMinTime: 0.2,
  /** Eye above the cover's top while crossing, and above the floor on arrival: the head stays low and lands in a crouch. */
  vaultEyeOver: 0.62,
  vaultEyeLand: 1.42,

  // Health
  maxHealth: 100,
  regenRate: 5,
  regenDelay: 3,
  armorAbsorb: 2 / 3,
  maxArmor: 200,
  overhealMax: 200,
  overhealDecay: 2,

  // Look
  sensitivity: 0.002,
  pitchLimit: 1.55,

  // Footsteps: stride length in meters grows with speed, so cadence rises with velocity but never buzzes.
  // A long stride is a slow, heavy cadence: 3.1 steps a second at run speed.
  strideBase: 2.4,
  strideFromSpeed: 0.13,
};

export type MoveTuning = typeof MOVE;

/** Everything that shapes the view. Angles are degrees unless the name says radians. */
export const VIEW = {
  baseFov: 90,
  /** Extra FOV at `fovSpeedFull`. It opens only past `fovSpeedFrom`, so normal running never stretches the view. */
  fovSpeedAdd: 6,
  fovSpeedFrom: 13.5,
  fovSpeedFull: 30,
  fovRiseRate: 5,
  fovFallRate: 3,
  zoomRate: 22,
  /** FOV punches, degrees. Slam is the base plus the part scaled by how hard it hit. */
  dashPunch: 3,
  slidePunch: 2,
  slamPunch: -3,
  slamPunchHard: -3,

  /** Trauma drains at this rate per second. */
  traumaDecay: 2.4,
  /** The first game's hard snap: the offset jumps to a new random value every 50 ms instead of drifting. */
  shakeHold: 0.05,
  /** Radians at trauma 1. Trauma is squared, so 0.3 is a nudge and 1 is an explosion in the face. */
  shakePitch: 0.09,
  shakeRoll: 0.11,
  shakeYaw: 0.03,
  /** Fraction of the world shake applied to the viewmodel. Less than 1, so the gun jolts against the world. */
  shakeView: 0.45,
  shakeViewOffset: 0.012,

  kickOmega: 32,
  kickZeta: 0.62,
  /** Landing dip spring. Damped enough not to bounce: a heavy body sinks and comes back once. */
  dipOmega: 15,
  dipZeta: 0.8,
  /** Downward velocity added to the dip spring per m/s of landing impact. A plain jump dips about 6 cm. */
  dipPerImpact: 0.2,
  dipMaxImpact: 30,
  /** Radians of downward nod per m/s of landing impact, up to the max. */
  landNod: 0.0012,
  landNodMax: 0.03,
  /** Landing speed where the screen starts to shake. A 3 m drop is about 14. */
  landShakeFrom: 14,
  jumpLift: 0.35,

  bobHeight: 0.04,
  /** Small: side sway is what makes a view swim. */
  bobSide: 0.012,
  /** Bob fades in over this speed range. */
  bobInSpeed: 6,
  bobRate: 14,

  /** Slide lean at full sideways speed. There is no strafe lean: any roll on foot reads as a tilted crosshair. */
  slideRoll: 1.2,
  slideRollRef: 12,
  wallRoll: 8,
  rollRate: 11,
  wallRollRate: 9,
  deathRoll: 28,
};

/** What movement sounds and draws, other than camera motion. */
export const FEEDBACK = {
  footstepVolume: 1,
  /** Pitch at a walk, and how much a run adds. Low, so steps sound like a heavy body. */
  footstepPitch: 0.82,
  footstepPitchFromSpeed: 0.1,
  jumpVolume: 1,
  landVolume: 1,
  /** Hands and boots on a move: the plant on a ledge, the scuff at the top. Low, under the move's own sound. */
  bodyVolume: 0.8,
  /** Landing speed that plays at full volume. */
  landLoudAt: 20,
  /** Landings harder than this use the heavy thud. */
  hardLanding: 16,
  /** Landings harder than this kick up dust. */
  landDust: 10,
  /** Speed where the edge streaks start and where they max out. */
  speedLinesFrom: 16,
  speedLinesFull: 36,
  /** Meters of travel between dust puffs under a slide. */
  slideDustEvery: 1.6,
  /** Meters of travel between spark bursts on a wall run. */
  wallSparksEvery: 1.4,
  /** Slam damage at the centre, by fall height, falling to `slamEdge` of that at the rim. */
  slamDamageMin: 30,
  slamDamageMax: 140,
  slamEdge: 0.35,
  slamForce: 60,
  /** Fall height where a slam counts as full strength for damage, shake and sound. */
  slamFullAt: 12,
  /** Big slam damage against a small slam's from the same height. */
  bigSlamDamage: 1.5,
  /** Push, newton-seconds, on a body inside the inner half of a big slam: enough to take a man off his feet. */
  bigSlamKnock: 420,
};
