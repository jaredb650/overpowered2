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
const HOLDS: ReadonlySet<Step['do']> = new Set<Step['do']>(['wait', 'until', 'cutscene', 'ride']);

export function validateMission(m: Mission): string[] {
  const problems: string[] = [];
  const lineIds = new Set(m.lines.map(l => l.id));
  const beatIds = m.beats.map(b => b.id);
  const spawned = new Set<string>();

  if (lineIds.size !== m.lines.length) problems.push('two lines share an id');
  if (new Set(beatIds).size !== beatIds.length) problems.push('two beats share an id');
  for (const id of m.redeployLines) if (!lineIds.has(id)) problems.push(`redeploy line ${id} does not exist`);
  for (const [id, route] of Object.entries(m.routes)) for (const mark of route) if (!m.marks[mark]) problems.push(`route ${id} names no mark ${mark}`);

  const checkStep = (where: string, step: Step): void => {
    const need = (ok: unknown, what: string): void => {
      if (!ok) problems.push(`${where}: no ${what}`);
    };
    switch (step.do) {
      case 'say': need(lineIds.has(step.line), `line ${step.line}`); break;
      case 'objective': if (step.at) need(m.marks[step.at], `mark ${step.at}`); break;
      case 'door': need(m.doors[step.door], `door ${step.door}`); break;
      case 'squad':
      case 'boss':
      case 'rack':
      case 'drop':
        need(m.marks[step.at], `mark ${step.at}`);
        break;
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
  };

  const checkTrigger = (where: string, trigger: Trigger): void => {
    eachTrigger(trigger, t => {
      if ('zone' in t && !m.zones[t.zone]) problems.push(`${where}: no zone ${t.zone}`);
    });
  };

  const noteSpawns = (step: Step): void => {
    if (step.do === 'squad' || step.do === 'boss') spawned.add(step.tag);
    if (step.do === 'vehicle') {
      spawned.add(step.tag);
      if (step.crew?.length) spawned.add(step.crewTag ?? step.tag);
    }
  };

  // Every tag anywhere, so a cue may wait on a squad its own beat brings in later.
  for (const beat of m.beats) {
    eachStep(beat.start, noteSpawns);
    for (const cue of beat.cues ?? []) eachStep(cue.run, noteSpawns);
  }

  const checkTags = (where: string, trigger: Trigger): void => {
    eachTrigger(trigger, t => {
      const tags = 'cleared' in t ? (typeof t.cleared === 'string' ? [t.cleared] : t.cleared) : 'left' in t || 'below' in t ? [t.tag] : 'kills' in t && t.tag ? [t.tag] : [];
      for (const tag of tags) if (!spawned.has(tag)) problems.push(`${where}: nothing spawns under ${tag}`);
    });
  };

  const given = new Set(m.loadout.weapons);
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
        if ('when' in step) checkTags(where, step.when);
        if (step.do === 'give' || (step.do === 'rack' && !step.optional)) given.add(step.weapon);
      });
    }
    for (const cue of beat.cues ?? []) {
      checkTrigger(where, cue.when);
      checkTags(where, cue.when);
    }
    if (beat.until) {
      checkTrigger(where, beat.until);
      checkTags(where, beat.until);
    }
    if (!beat.until && !scripts.some(s => s?.some(step => step.do === 'goto' || step.do === 'finish'))) problems.push(`${where}: nothing ever ends it`);
    for (const step of beat.start ?? []) {
      if (HOLDS.has(step.do)) break;
      if (step.do === 'goto' && beatIds.indexOf(step.beat) <= index) problems.push(`${where}: goes back to ${step.beat} before anything holds it up`);
    }
  });
  return problems;
}
