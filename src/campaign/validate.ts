/**
 * Catches a mission that cannot be played, before anyone plays it: a name that points at nothing, a tag nobody spawns, a checkpoint
 * that promises less than the player has been handed by then. Returns what is wrong, as sentences. Empty is good.
 */
import { MAX_HOSTILE } from '../enemies/outpost/doctrine';
import type { Mission, Script, Step, Trigger } from './types';

function eachStep(script: Script | undefined, fn: (step: Step) => void): void {
  for (const step of script ?? []) fn(step);
}

function eachTrigger(trigger: Trigger, fn: (t: Trigger) => void): void {
  fn(trigger);
  if ('all' in trigger) for (const t of trigger.all) eachTrigger(t, fn);
  if ('any' in trigger) for (const t of trigger.any) eachTrigger(t, fn);
}

/** A beat that leaves for itself or somewhere earlier before anything can stop it would spin the runner for ever. */
const HOLDS: ReadonlySet<Step['do']> = new Set<Step['do']>(['wait', 'until', 'cutscene', 'ride', 'sortie', 'frame']);

export function validateMission(m: Mission): string[] {
  const problems: string[] = [];
  const lineIds = new Set(m.lines.map(l => l.id));
  const beatIds = m.beats.map(b => b.id);
  /** Tag to the beats that spawn it. */
  const spawned = new Map<string, number[]>();
  const battles = new Set<string>();

  if (lineIds.size !== m.lines.length) problems.push('two lines share an id');
  if (new Set(beatIds).size !== beatIds.length) problems.push('two beats share an id');
  for (const id of m.redeployLines) if (!lineIds.has(id)) problems.push(`redeploy line ${id} does not exist`);
  for (const beat of m.beats) for (const id of beat.redeployLines ?? []) if (!lineIds.has(id)) problems.push(`beat ${beat.id}: redeploy line ${id} does not exist`);
  for (const [id, route] of Object.entries(m.routes)) for (const mark of route) if (!m.marks[mark]) problems.push(`route ${id} names no mark ${mark}`);

  const checkStep = (where: string, step: Step): void => {
    const need = (ok: unknown, what: string): void => {
      if (!ok) problems.push(`${where}: no ${what}`);
    };
    switch (step.do) {
      case 'say': need(lineIds.has(step.line), `line ${step.line}`); break;
      case 'drill': if (step.line) need(lineIds.has(step.line), `line ${step.line}`); break;
      case 'objective': if (step.at) need(m.marks[step.at], `mark ${step.at}`); break;
      case 'door': need(m.doors[step.door], `door ${step.door}`); break;
      case 'squad':
      case 'boss':
      case 'rack':
      case 'drop':
      case 'place':
      case 'frame':
        need(m.marks[step.at], `mark ${step.at}`);
        break;
      case 'roster': if (step.at) need(m.marks[step.at], `mark ${step.at}`); break;
      case 'sortie': need(m.marks[step.over], `mark ${step.over}`); break;
      case 'battle':
        need(m.marks[step.at], `mark ${step.at}`);
        need(m.marks[step.from], `mark ${step.from}`);
        break;
      case 'stop': need(battles.has(step.battle), `battle ${step.battle}`); break;
      case 'vehicle':
        need(m.marks[step.at], `mark ${step.at}`);
        if (step.route) need(m.routes[step.route], `route ${step.route}`);
        break;
      case 'cutscene': need(m.cutscenes[step.id], `cutscene ${step.id}`); break;
      case 'ride': if (step.route) need(m.routes[step.route], `route ${step.route}`); break;
      case 'goto': need(beatIds.includes(step.beat), `beat ${step.beat}`); break;
      case 'until': checkTrigger(where, step.when); break;
      default: break;
    }
    if (step.do === 'squad' && step.men.length > MAX_HOSTILE) problems.push(`${where}: squad ${step.tag} is over the cap on its own`);
    if (step.do === 'battle' && step.militia.length > MAX_HOSTILE) problems.push(`${where}: battle ${step.id} is over the cap on its own`);
  };

  const checkTrigger = (where: string, trigger: Trigger): void => {
    eachTrigger(trigger, t => {
      if ('zone' in t && !m.zones[t.zone]) problems.push(`${where}: no zone ${t.zone}`);
    });
  };

  const noteSpawns = (index: number) => (step: Step): void => {
    const note = (tag: string): void => {
      const beats = spawned.get(tag);
      if (beats) beats.push(index);
      else spawned.set(tag, [index]);
    };
    if (step.do === 'squad' || step.do === 'boss') note(step.tag);
    if (step.do === 'battle') {
      note(step.id);
      battles.add(step.id);
    }
    if (step.do === 'vehicle') {
      note(step.tag);
      if (step.crew?.length) note(step.crewTag ?? step.tag);
    }
  };

  // Every tag anywhere, so a cue may wait on a squad its own beat brings in later.
  m.beats.forEach((beat, index) => {
    eachStep(beat.start, noteSpawns(index));
    for (const cue of beat.cues ?? []) eachStep(cue.run, noteSpawns(index));
  });

  /** The beat a death here goes back to. */
  const savedAt = (index: number): number => {
    for (let i = index; i > 0; i--) if (m.beats[i]!.checkpoint) return i;
    return 0;
  };

  const checkTags = (where: string, index: number, trigger: Trigger): void => {
    eachTrigger(trigger, t => {
      const tags = 'cleared' in t ? (typeof t.cleared === 'string' ? [t.cleared] : t.cleared) : 'left' in t || 'below' in t ? [t.tag] : 'kills' in t && t.tag ? [t.tag] : [];
      for (const tag of tags) {
        const beats = spawned.get(tag);
        if (!beats) problems.push(`${where}: nothing spawns under ${tag}`);
        else if (!beats.some(b => b >= savedAt(index) && b <= index)) problems.push(`${where}: a restart here never brings back ${tag}`);
      }
    });
  };

  const given = new Set(m.loadout.weapons);
  const named = { zones: new Set<string>(), marks: new Set<string>(), doors: new Set<string>() };
  for (const route of Object.values(m.routes)) for (const mark of route) named.marks.add(mark);
  const noteName = (step: Step): void => {
    if ('at' in step && step.at) named.marks.add(step.at);
    if (step.do === 'door') named.doors.add(step.door);
    if (step.do === 'call' && step.arg) named.marks.add(step.arg);
    if (step.do === 'sortie') named.marks.add(step.over);
    if (step.do === 'battle') named.marks.add(step.from);
    if (step.do === 'vehicle' && step.holds) {
      named.marks.add(step.holds);
      if (!m.marks[step.holds]) problems.push(`vehicle ${step.tag}: no mark ${step.holds}`);
    }
    if (step.do === 'until') eachTrigger(step.when, t => noteZone(t));
  };
  const noteZone = (t: Trigger): void => {
    if ('zone' in t) named.zones.add(t.zone);
  };
  for (const beat of m.beats) {
    if (beat.checkpoint) named.marks.add(beat.checkpoint.at);
    eachStep(beat.start, noteName);
    for (const cue of beat.cues ?? []) {
      eachTrigger(cue.when, noteZone);
      eachStep(cue.run, noteName);
    }
    if (beat.until) eachTrigger(beat.until, noteZone);
  }
  for (const [kind, table] of [['zone', m.zones], ['mark', m.marks], ['door', m.doors]] as const) {
    const used = kind === 'zone' ? named.zones : kind === 'mark' ? named.marks : named.doors;
    for (const id of Object.keys(table)) if (!used.has(id)) problems.push(`${kind} ${id} is never used`);
  }

  m.beats.forEach((beat, index) => {
    const where = `beat ${beat.id}`;
    if (beat.checkpoint) {
      if (!m.marks[beat.checkpoint.at]) problems.push(`${where}: no mark ${beat.checkpoint.at}`);
      for (const w of given) if (!beat.checkpoint.loadout.weapons.includes(w)) problems.push(`${where}: its checkpoint takes away the ${w}`);
    }
    const scripts = [beat.start, ...(beat.cues ?? []).map(c => c.run)];
    for (const script of scripts) {
      eachStep(script, step => {
        checkStep(where, step);
        if ('when' in step) checkTags(where, index, step.when);
        if (step.do === 'give' || (step.do === 'rack' && !step.optional)) given.add(step.weapon);
      });
    }
    for (const cue of beat.cues ?? []) {
      checkTrigger(where, cue.when);
      checkTags(where, index, cue.when);
      // A repeating cue is armed afresh each time, so a signal it waits on has to go up again, or it fires once and never comes back.
      if (cue.repeat) eachTrigger(cue.when, t => {
        if ('signal' in t && !cue.run.some(step => step.do === 'signal' && step.name === t.signal)) problems.push(`${where}: a repeating cue waits on ${t.signal} and never raises it again`);
      });
    }
    if (beat.until) {
      checkTrigger(where, beat.until);
      checkTags(where, index, beat.until);
    }
    if (!beat.until && !scripts.some(s => s?.some(step => step.do === 'goto' || step.do === 'finish'))) problems.push(`${where}: nothing ever ends it`);
    for (const step of beat.start ?? []) {
      if (HOLDS.has(step.do)) break;
      if (step.do === 'goto' && beatIds.indexOf(step.beat) <= index) problems.push(`${where}: goes back to ${step.beat} before anything holds it up`);
    }
  });
  return problems;
}
