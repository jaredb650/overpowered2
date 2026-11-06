/**
 * Damped springs solved in closed form. An exact step gives identical motion at 30 and 240 fps and can never go
 * unstable at the stiffness recoil needs, which a per-frame Euler integrator cannot promise.
 */
export class Spring {
  x = 0;
  v = 0;

  constructor(public omega: number, public zeta: number) {}

  step(dt: number, target = 0): void {
    if (dt <= 0) return;
    const w = this.omega;
    const z = this.zeta;
    const y = this.x - target;
    if (z < 0.999) {
      const a = z * w;
      const wd = w * Math.sqrt(1 - z * z);
      const e = Math.exp(-a * dt);
      const c = Math.cos(wd * dt);
      const s = Math.sin(wd * dt);
      const b = (this.v + a * y) / wd;
      this.x = target + e * (y * c + b * s);
      this.v = e * (this.v * c - (a * b + wd * y) * s);
    } else {
      const e = Math.exp(-w * dt);
      const k = this.v + w * y;
      this.x = target + (y + k * dt) * e;
      this.v = (this.v - k * w * dt) * e;
    }
  }

  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}

export class Spring3 {
  readonly x: Spring;
  readonly y: Spring;
  readonly z: Spring;

  constructor(omega: number, zeta: number) {
    this.x = new Spring(omega, zeta);
    this.y = new Spring(omega, zeta);
    this.z = new Spring(omega, zeta);
  }

  tune(omega: number, zeta: number): void {
    this.x.omega = this.y.omega = this.z.omega = omega;
    this.x.zeta = this.y.zeta = this.z.zeta = zeta;
  }

  step(dt: number, tx = 0, ty = 0, tz = 0): void {
    this.x.step(dt, tx);
    this.y.step(dt, ty);
    this.z.step(dt, tz);
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}
