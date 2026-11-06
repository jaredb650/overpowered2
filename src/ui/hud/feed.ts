/** Kill feed under the minimap, the style lane under the combo and the radio above the call-ins. All small capped pools, oldest out. */
import { COLLAPSE, div, span } from '../dom';

interface Line {
  el: HTMLElement;
  speaker: HTMLElement;
  text: HTMLElement;
  life: number;
  leaving: boolean;
}

const LEAVE = 0.11;

class Lane {
  readonly el: HTMLElement;
  private free: Line[] = [];
  private live: Line[] = [];

  constructor(cls: string, private readonly lineCls: string, private readonly cap: number, private readonly life: number) {
    this.el = div(cls);
    for (let i = 0; i < cap + 2; i++) {
      const speaker = span('ln-k');
      const text = span('ln-t');
      const el = div(lineCls, speaker, text);
      el.style.display = 'none';
      this.free.push({ el, speaker, text, life: 0, leaving: false });
    }
  }

  push(text: string, color: string | undefined, speaker = ''): void {
    if (this.live.length >= this.cap) this.drop(this.live.shift()!);
    const line = this.free.pop();
    if (!line) return;
    line.speaker.textContent = speaker;
    line.text.textContent = text;
    line.life = this.life;
    line.leaving = false;
    line.el.style.setProperty('--c', color ?? 'var(--ink)');
    line.el.style.display = '';
    this.el.append(line.el);
    this.live.push(line);
    line.el.animate(
      [{ transform: 'translateX(1.4rem) scale(1.12)', easing: 'cubic-bezier(.1,.9,.2,1)' }, { transform: 'none' }],
      150,
    );
  }

  private drop(line: Line): void {
    line.el.style.display = 'none';
    line.el.remove();
    this.free.push(line);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const line = this.live[i]!;
      line.life -= dt;
      if (!line.leaving && line.life <= LEAVE) {
        line.leaving = true;
        line.el.animate(COLLAPSE as unknown as Keyframe[], LEAVE * 1000);
      }
      if (line.life <= 0) {
        this.live.splice(i, 1);
        this.drop(line);
      }
    }
  }

  clear(): void {
    while (this.live.length) this.drop(this.live.pop()!);
  }
}

export class KillFeed extends Lane {
  constructor() {
    super('feed', 'feed-ln', 6, 4);
  }
}

export class StyleLane extends Lane {
  constructor() {
    super('style', 'style-ln', 5, 1.5);
  }
}

/** Enemy radio. Long enough to read in a fight, short enough that a quiet room goes quiet. */
export class CommsFeed extends Lane {
  constructor() {
    super('comms', 'comms-ln', 4, 6);
  }
}
