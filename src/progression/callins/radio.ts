/**
 * Aircrew chatter on the HUD. Plays recorded aircrew radio clips through the comms voice system when available,
 * falling back cleanly to the HUD feed and `vox_radio` burst when clips are absent (e.g. headless tests).
 *
 * Lines queue, because a burst of events must read as a crew talking and not as a log. The queue is short on purpose:
 * a line that waits too long is about something that has already happened.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import { VOICE_INDEX, relayClip } from '../../enemies/outpost/chatter/voices';

const LINE_GAP = 1.5;
const MAX_WAITING = 3;

/** Exact call-in aircrew lines mapped to their generated Breeze TTS 2 clip keys (under `public/audio/chatter/`). */
export const CALLIN_CLIPS: Readonly<Record<string, string>> = {
  // Spectre AC-130
  'COPY YOUR MARK. INBOUND. WE HAVE THE GUNS.': 'callin.ac130.inbound_ai',
  'INBOUND. FIRE CONTROL IS YOURS.': 'callin.ac130.inbound_player',
  'HIT AGAIN. WE CANNOT TAKE ANOTHER.': 'callin.ac130.hit_critical',
  'WE ARE HIT. NUMBER TWO ENGINE IS OUT.': 'callin.ac130.hit_engine',
  'MAYDAY. MAYDAY. SPECTRE IS GOING DOWN.': 'callin.ac130.mayday',
  'BOMB AWAY. STEER IT IN.': 'callin.ac130.bomb_steer',
  'COPY. WE HAVE THE GUNS.': 'callin.ac130.take_guns',
  'ON STATION. GUNS HOT.': 'callin.ac130.on_station',
  'WINCHESTER. RETURNING TO BASE.': 'callin.ac130.winchester',
  'GOOD EFFECT ON TARGET.': 'callin.ac130.good_effect',
  'SPLASH ONE. GOOD HIT.': 'callin.ac130.splash_one',
  'SIXTY SECONDS ON STATION.': 'callin.ac130.sec60',
  'THIRTY SECONDS. BINGO FUEL.': 'callin.ac130.sec30',
  'TEN SECONDS. LAST ROUNDS.': 'callin.ac130.sec10',
  'NO MOVERS IN THE BOX. RAKING IT.': 'callin.ac130.raking',
  'WILLIE PETE, SHOT.': 'callin.ac130.wp_shot',
  'SHOT, OVER.': 'callin.ac130.shot_over',
  'SPLASH.': 'callin.ac130.splash',
  'BOMB AWAY. LASER ON.': 'callin.ac130.bomb_laser',
  // Gunner Strike chopper
  'INBOUND. WE HAVE THE GUN.': 'callin.gunner.inbound',
  'WE ARE HIT. STILL FLYING.': 'callin.gunner.hit_flying',
  'TAKING ROUNDS. TAKING ROUNDS.': 'callin.gunner.taking_rounds',
  'FLARES. FLARES.': 'callin.gunner.flares',
  'MAYDAY. MAYDAY. WE ARE GOING DOWN.': 'callin.gunner.mayday',
  'GUNS FREE. YOUR TRIGGER.': 'callin.gunner.guns_free',
  'TEN SECONDS. BINGO FUEL.': 'callin.gunner.sec10',
  'WINCHESTER. NOTHING LEFT.': 'callin.gunner.winchester',
  'COPY. WE HAVE THE GUN.': 'callin.gunner.take_gun',
  'BINGO FUEL. RETURNING TO BASE.': 'callin.gunner.bingo_rtb',
  'TAKING FIRE. KILL THAT GUNSHIP.': 'callin.gunner.kill_gunship',
  'GOOD HITS. KEEP IT ON THEM.': 'callin.gunner.good_hits',
};

const _pos = new THREE.Vector3();

export class Radio {
  private readonly waiting: string[] = [];
  private gap = 0;
  private readonly voice: number;

  constructor(private readonly ctx: Ctx, private readonly callsign: string, private readonly color: string) {
    // Spectre AC-130 uses pilot_serious_atc (.patc); Gunner Strike chopper uses pilot_gunship_cowboy (.pcow).
    this.voice = callsign.toUpperCase().includes('SPECTRE') ? VOICE_INDEX.patc : VOICE_INDEX.pcow;
  }

  say(line: string): void {
    if (this.waiting.length >= MAX_WAITING) this.waiting.shift();
    this.waiting.push(line);
  }

  update(dt: number): void {
    this.gap -= dt;
    if (this.gap > 0 || this.waiting.length === 0) return;
    this.gap = LINE_GAP;
    const text = this.waiting.shift()!;
    const { audio, hud, events, player } = this.ctx;
    const clipKey = CALLIN_CLIPS[text] ?? null;
    if (clipKey && relayClip(clipKey, this.voice)) {
      _pos.copy(player.position);
      events.emit('comms:line', {
        kind: 'ally',
        ally: true,
        text,
        squad: this.callsign,
        speaker: this.callsign,
        enemy: null,
        position: _pos,
        row: -1,
        voice: this.voice,
        clip: clipKey,
        radio: true,
      });
      return;
    }
    hud.feed(`${this.callsign}: ${text}`, this.color);
    audio.play('vox_radio', { volume: 0.55, unaffectedByTime: true });
  }
}
