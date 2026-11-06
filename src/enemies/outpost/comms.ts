/**
 * Radio chatter as events. Section 19 ships recorded voices later, so a line is a kind plus text and nothing here plays
 * speech: the kind is what a voice bank will key on.
 *
 * The lines are written to be stacked: the same kind comes up many times in a run, so each stays short and plain.
 */
import * as THREE from 'three';
import type { AiWorld } from '../aiWorld';
import { say } from '../attacks';
import type { CommsKind, CommsLine } from './events';
import type { Soldier } from './soldier';

const LINES: Record<CommsKind, readonly string[]> = {
  contact: ['Contact!', 'Contact front!', 'Eyes on! Eyes on it!', 'Got it, moving in the open!', 'There! There!'],
  lost: ['Lost visual.', 'Where did it go?', 'I have nothing. Anyone?', 'It was right there.'],
  noise: ['You hear that?', 'Movement. Somewhere close.', 'Shots fired, close.', 'Stay sharp, something is moving.'],
  manDown: ['Man down!', 'He\'s down! He\'s down!', 'We lost one!', 'Oh God. He\'s gone.'],
  leaderDown: ['Sarge is down!', 'They got the sergeant!', 'We lost the lead!'],
  takingCommand: ['I have the squad! On me!', 'I\'m in command! Hold it together!', 'Form on me!'],
  medic: ['Medic!', 'I need a medic here!', 'Got wounded, need help!'],
  reloading: ['Reloading!', 'Changing mag!', 'I\'m dry!', 'Cover me, reloading!'],
  moving: ['Moving!', 'Bounding!', 'Team two, go!', 'Next cover, go go!'],
  covering: ['Covering!', 'Suppressing!', 'Keep its head down!', 'I\'ve got you, move!'],
  flanking: ['Flanking left!', 'Going wide!', 'Get round it!', 'Hit it from the side!'],
  frag: ['Frag out!', 'Grenade!', 'Throwing!'],
  flash: ['Flash out!', 'Banger going in!', 'Eyes!'],
  breach: ['Stack up!', 'On the door!', 'Breaching, breaching!', 'Go, go, go!'],
  fallback: ['Fall back!', 'Back, get back!', 'Pull out, by teams!', 'We can\'t hold this!'],
  regroup: ['Rally on me!', 'Regroup!', 'Form up!'],
  fear: ['What IS that thing?', 'It doesn\'t stop!', 'Bullets don\'t do anything!', 'That\'s not a man!', 'Did you see what it did to him?'],
  panic: ['I\'m not dying here!', 'Run! Just run!', 'Oh God, oh God, oh God!', 'Get away from me!'],
  surrender: ['Don\'t shoot!', 'I give up! I give up!', 'Please, please!', 'I have a family!', 'I\'m unarmed!'],
  fix: ['All units, Command has a fix. Sending it now.', 'Thermal has a rough position. Move.'],
  squadGone: ['We\'ve lost a whole squad!', 'They\'re all dead! All of them!', 'Nobody\'s left out there!'],
  hit: ['I\'m hit!', 'I\'m hit, I\'m hit!', 'Agh! My leg!', 'It got me!', 'Ah, Christ!'],
  dying: ['I can\'t feel my legs!', 'Don\'t leave me!', 'Tell them I tried.', 'Oh God, there\'s so much blood.', 'I don\'t want to die here.'],
  beg: ['Please. Please, no.', 'Don\'t. I\'m done, I\'m done.', 'I have kids!', 'Just leave me.'],
  scream: ['Help me! Somebody!', 'Medic! MEDIC!', 'Oh God, it hurts!', 'Don\'t leave me out here!', 'Get me out of here!'],
  rescue: ['I\'m going for him!', 'Cover me, I\'ll get him!', 'Hold on, I\'m coming!', 'We don\'t leave him!'],
  lastStand: ['Come on then!', 'You\'re coming with me!', 'Taking you with me!'],
  // The Commander's men speak from src/enemies/commander/lines.ts, through `relay`.
  order: [],
};

/** Seconds before the same kind of line can come again. */
const KIND_GAP: Partial<Record<CommsKind, number>> = {
  contact: 4, lost: 8, noise: 10, moving: 5, covering: 6, reloading: 4, flanking: 8, fear: 7, panic: 5, surrender: 6, regroup: 6, fallback: 6,
  hit: 3, dying: 6, beg: 5, scream: 4, rescue: 6, lastStand: 5,
};
const DEFAULT_KIND_GAP = 2.5;
/** Spacing between any two lines, so the feed stays readable. A casualty cuts in regardless. */
const LINE_GAP = 1.3;
const URGENT: ReadonlySet<CommsKind> = new Set<CommsKind>(['manDown', 'leaderDown', 'takingCommand', 'squadGone', 'frag', 'flash', 'surrender', 'lastStand']);
/** Lines that come out as a scream, not a voice on the radio. */
const SCREAMED: ReadonlySet<CommsKind> = new Set<CommsKind>(['panic', 'surrender', 'scream', 'dying', 'beg', 'lastStand']);
/** What radio silence takes off the air. A man on fire does not keep radio discipline. */
const DISCIPLINED: ReadonlySet<CommsKind> = new Set<CommsKind>([
  'contact', 'lost', 'noise', 'moving', 'covering', 'flanking', 'breach', 'fallback', 'regroup', 'fix', 'reloading', 'takingCommand', 'frag', 'flash',
]);

export class Comms {
  private nextLineAt = 0;
  private readonly kindAt = new Map<CommsKind, number>();
  private readonly lastLine = new Map<CommsKind, number>();
  private readonly line: CommsLine = { kind: 'contact', text: '', squad: '', speaker: null, enemy: null, position: new THREE.Vector3() };

  constructor(private readonly w: AiWorld) {}

  reset(): void {
    this.nextLineAt = 0;
    this.kindAt.clear();
    this.lastLine.clear();
  }

  /** Never the same line twice running: a man repeating himself reads as a bug, not as panic. */
  private next(kind: CommsKind): string {
    const lines = LINES[kind];
    const last = this.lastLine.get(kind) ?? -1;
    const i = (last + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length;
    this.lastLine.set(kind, i);
    return lines[i]!;
  }

  /** `s` is who says it. Null is Command on the radio, heard everywhere. */
  say(kind: CommsKind, s: Soldier | null): void {
    const { w, line } = this;
    const now = w.now;
    // A hole in the lung or the throat takes the voice with it.
    if (s?.injuries.mute) return;
    if (DISCIPLINED.has(kind) && w.enemies.outpost!.doctrine.radioSilence) return;
    if (now < (this.kindAt.get(kind) ?? 0)) return;
    if (now < this.nextLineAt && !URGENT.has(kind)) return;
    this.kindAt.set(kind, now + (KIND_GAP[kind] ?? DEFAULT_KIND_GAP));
    this.nextLineAt = now + LINE_GAP;
    line.kind = kind;
    line.text = this.next(kind);
    line.squad = s ? s.squad.name : 'Command';
    line.speaker = s ? s.callsign : null;
    line.enemy = s ? s.e : null;
    if (s) line.position.copy(s.e.center);
    else line.position.copy(w.player.position);
    w.ctx.events.emit('comms:line', line);
    if (s) say(s.e, w, SCREAMED.has(kind) ? 'vox_scream' : s.e.def.voice.attack, 0.45);
  }

  /** Words the caller chose, on the same feed. `who` names a voice that belongs to nobody on the map. */
  relay(text: string, s: Soldier | null, who: string | null): void {
    const { w, line } = this;
    if (s?.injuries.mute) return;
    this.nextLineAt = w.now + LINE_GAP;
    line.kind = 'order';
    line.text = text;
    line.squad = s ? s.squad.name : 'Command';
    line.speaker = who ?? (s ? s.callsign : null);
    line.enemy = s ? s.e : null;
    if (s) line.position.copy(s.e.center);
    else line.position.copy(w.player.position);
    w.ctx.events.emit('comms:line', line);
  }
}
