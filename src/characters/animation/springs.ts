/** Damped 3-vector springs. Flinches, recoil and landings all ride on these. */
export class Spring3 {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  constructor(readonly stiffness: number, readonly damping: number) {}

  kick(x: number, y: number, z: number): void {
    this.vx += x; this.vy += y; this.vz += z;
  }

  step(dt: number): void {
    // Semi-implicit Euler at a fixed ceiling step stays stable for any frame time.
    let left = dt;
    const k = this.stiffness, c = this.damping;
    while (left > 1e-5) {
      const h = left > 1 / 90 ? 1 / 90 : left;
      this.vx += (-k * this.x - c * this.vx) * h;
      this.vy += (-k * this.y - c * this.vy) * h;
      this.vz += (-k * this.z - c * this.vz) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.z += this.vz * h;
      left -= h;
    }
  }

  get active(): boolean {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(this.vz) > 1e-3;
  }

  clear(): void {
    this.x = this.y = this.z = this.vx = this.vy = this.vz = 0;
  }
}
