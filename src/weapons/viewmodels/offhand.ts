/**
 * The left hand's own life: frag grenades and call-in devices. It sits on top of whatever the main gun is doing, so
 * throwing a grenade mid-reload or from a two-handed hold just borrows the hand for a moment.
 */
import * as THREE from 'three';
import { clamp, damp } from '../../core/math';
import { TUNING } from '../data';
import { inOut, inQuad, outBack, outCubic, seg } from './curves';
import { HandCtl } from './def';
import type { Model } from './kit/model';
import type { OffhandSet } from './models';
import { HANDS } from './poses';

type State = 'none' | 'cook' | 'throw';
type Device = 'walkie' | 'designator';

const REST_LOW = new THREE.Vector3(-0.24, -0.5, -0.32);

export class Offhand {
  readonly root = new THREE.Group();
  readonly ctl = new HandCtl();
  readonly sockets: Record<string, THREE.Object3D> = {};
  /** 0..1 how much the left hand belongs to this system. */
  leftWeight = 0;
  /** The hand target. */
  hand: THREE.Object3D;
  private state: State = 'none';
  private t = 0;
  private device_: Device | null = null;
  private shownDevice: Device | null = null;
  private deviceW = 0;
  private press = 0;
  private lcdClock = 0;
  private readonly restOffset = new THREE.Vector3();

  constructor(private readonly set: OffhandSet) {
    for (const m of [set.grenade, set.walkie, set.designator]) {
      m.root.visible = false;
      this.root.add(m.root);
    }
    this.hand = set.grenade.sockets.hold!;
    this.ctl.base = 'offhand';
  }

  get cooking(): boolean {
    return this.state === 'cook';
  }

  reset(): void {
    this.state = 'none';
    this.t = 0;
    this.device_ = null;
    this.shownDevice = null;
    this.deviceW = 0;
    this.leftWeight = 0;
    this.press = 0;
    for (const m of [this.set.grenade, this.set.walkie, this.set.designator]) m.root.visible = false;
  }

  cook(): void {
    this.state = 'cook';
    this.t = 0;
  }

  release(): void {
    if (this.state !== 'cook') return;
    this.state = 'throw';
    this.t = 0;
  }

  device(d: Device | null): void {
    this.device_ = d;
  }

  /** Target confirmed: thumb on the talk key, or the laser burns. */
  confirm(): void {
    this.press = 1;
  }

  update(dt: number): void {
    this.t += dt;
    this.press = Math.max(0, this.press - dt * 1.6);
    // Held past the fuse it went off in the hand, and there is nothing left to throw.
    if (this.state === 'cook' && this.t > TUNING.grenade.fuse) this.state = 'none';
    if (this.state !== 'none') this.updateGrenade();
    else this.set.grenade.root.visible = false;
    this.updateDevice(dt);
    if (this.state === 'none' && this.deviceW < 0.002) this.leftWeight = 0;
    this.root.updateMatrixWorld(true);
  }

  private updateGrenade(): void {
    const g = this.set.grenade;
    const root = g.root;
    const t = this.t;
    this.hand = g.sockets.hold!;
    g.resetParts();
    this.ctl.begin(null);
    this.ctl.base = 'offhand';
    this.ctl.fingerRate = 34;
    this.ctl.pose.set(HANDS.ball);
    root.visible = true;
    const p = root.position;
    const r = root.rotation;
    if (this.state === 'cook') {
      const k = outBack(seg(t, 0, 0.2), 1.1);
      this.leftWeight = outCubic(seg(t, 0, 0.14));
      p.set(-0.2, -0.125, -0.36).lerp(REST_LOW, 1 - k);
      r.set(0.55, 0.3, 0.2);
      // Pin rips out on the way up, and a small tremble says the fuse is live.
      const pin = g.parts.pin!;
      const pull = seg(t, 0.1, 0.24);
      pin.position.x -= inQuad(pull) * 0.12;
      pin.position.y += inQuad(pull) * 0.08;
      pin.visible = pull < 1;
      if (t > 0.25) {
        const tr = Math.min(1, (t - 0.25) * 0.6) * 0.0016;
        p.x += Math.sin(t * 61) * tr;
        p.y += Math.sin(t * 47 + 1) * tr;
      }
      return;
    }
    g.parts.pin!.visible = false;
    // Wind back, whip through, follow through. The projectile leaves at 0.11 s, so the model must be gone by then.
    const back = inOut(seg(t, 0, 0.05));
    const whip = inQuad(seg(t, 0.05, 0.14));
    const low = outCubic(seg(t, 0.14, 0.4));
    p.set(-0.2, -0.125, -0.36);
    p.x += back * -0.05 + whip * 0.1;
    p.y += back * 0.1 - whip * 0.1 - low * 0.3;
    p.z += back * 0.08 - whip * 0.32 + low * 0.2;
    r.set(0.55 + back * 0.6 - whip * 1.2, 0.3, 0.2);
    if (t > 0.115) {
      this.ctl.pose.set(HANDS.open);
      for (const m of root.children) if ((m as THREE.Mesh).isMesh) m.visible = false;
      g.parts.pin!.visible = false;
      g.parts.spoon!.visible = false;
    }
    this.leftWeight = 1 - seg(t, 0.2, 0.4);
    if (t >= 0.4) {
      this.state = 'none';
      root.visible = false;
      for (const m of root.children) m.visible = true;
    }
  }

  private updateDevice(dt: number): void {
    // A confirmed call ends targeting on that frame. The thumb still has to be seen landing on the key.
    const want = this.device_ ?? (this.press > 0.75 ? this.shownDevice : null);
    if (want && this.shownDevice !== want && this.deviceW < 0.05) this.shownDevice = want;
    this.deviceW = damp(this.deviceW, want && want === this.shownDevice ? 1 : 0, want ? 11 : 15, dt);
    const dev = this.shownDevice;
    if (!dev) return;
    const m = dev === 'walkie' ? this.set.walkie : this.set.designator;
    const other = dev === 'walkie' ? this.set.designator : this.set.walkie;
    other.root.visible = false;
    m.root.visible = this.deviceW > 0.01;
    if (!m.root.visible) {
      if (!want) this.shownDevice = null;
      return;
    }
    if (this.state !== 'none') return;
    this.hand = m.sockets.hold!;
    m.resetParts();
    this.ctl.begin(null);
    this.ctl.base = 'offhand';
    this.ctl.fingerRate = 22;
    this.leftWeight = clamp(this.deviceW * 1.4);
    const k = 1 - this.deviceW;
    const r = m.root.rotation;
    const p = m.root.position;
    if (dev === 'walkie') {
      this.ctl.pose.set(HANDS.radio);
      p.set(-0.2, -0.155, -0.38);
      r.set(0.1, 0.42, -0.12);
      m.parts.ptt!.position.x += this.press > 0 ? 0.0016 : 0;
      this.ctl.pose[1] = this.ctl.pose[1]! + (this.press > 0 ? 0.3 : 0);
      const lamp = m.glows.lamp;
      if (lamp) lamp.color.copy(lamp.userData.base as THREE.Color).multiplyScalar(this.press > 0 ? 1.6 : 0.5 + 0.5 * Math.sin(this.t * 7));
      this.drawLcd(m, dt);
    } else {
      this.ctl.pose.set(HANDS.grip);
      p.set(-0.13, -0.1, -0.36);
      r.set(0.06, 0.2, 0);
      const laser = m.glows.laser;
      if (laser) laser.color.copy(laser.userData.base as THREE.Color).multiplyScalar(0.7 + this.press * 2 + 0.2 * Math.sin(this.t * 31));
      this.drawViewer(m, dt);
    }
    p.y -= k * 0.34;
    p.z += k * 0.08;
    r.x -= k * 0.9;
  }

  private drawLcd(m: Model, dt: number): void {
    this.lcdClock -= dt;
    if (this.lcdClock > 0) return;
    this.lcdClock = 0.25;
    const s = m.screens.lcd;
    if (!s) return;
    const { g, canvas, texture } = s;
    g.fillStyle = '#0f2a22';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#7dffc4';
    g.font = '700 22px "Courier New", monospace';
    g.textBaseline = 'top';
    g.fillText('CH 07 CRUCIBLE', 6, 6);
    g.font = '800 40px "Courier New", monospace';
    g.fillText(this.press > 0 ? 'TX >>>' : 'READY', 6, 38);
    const bars = 3 + Math.floor((this.t * 3) % 3);
    for (let i = 0; i < 6; i++) {
      g.globalAlpha = i < bars ? 1 : 0.2;
      g.fillRect(6 + i * 16, 96 - i * 2, 11, 6 + i * 2);
    }
    g.globalAlpha = 1;
    texture.needsUpdate = true;
  }

  private drawViewer(m: Model, dt: number): void {
    this.lcdClock -= dt;
    if (this.lcdClock > 0) return;
    this.lcdClock = 0.12;
    const s = m.screens.view;
    if (!s) return;
    const { g, canvas, texture } = s;
    const w = canvas.width;
    g.fillStyle = '#100506';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#ff5a3a';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w / 2, w / 2, 34 + Math.sin(this.t * 5) * 3, 0, Math.PI * 2);
    g.moveTo(w / 2 - 54, w / 2);
    g.lineTo(w / 2 - 16, w / 2);
    g.moveTo(w / 2 + 16, w / 2);
    g.lineTo(w / 2 + 54, w / 2);
    g.moveTo(w / 2, w / 2 - 54);
    g.lineTo(w / 2, w / 2 - 16);
    g.moveTo(w / 2, w / 2 + 16);
    g.lineTo(w / 2, w / 2 + 54);
    g.stroke();
    g.fillStyle = '#ff5a3a';
    g.font = '700 16px "Courier New", monospace';
    g.fillText(this.press > 0 ? 'LASE' : 'TGT', 6, 18);
    texture.needsUpdate = true;
  }
}
