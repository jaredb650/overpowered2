import * as THREE from 'three';

/**
 * A neon strip far away is thinner than a pixel, so without MSAA it misses pixel centres along its length and
 * breaks into dashes. GL lines rasterise as one unbroken pixel-wide run however thin the shape, so each emissive mesh
 * gets its own edges drawn over it in its own colour. Up close the lines sit on a surface of the same colour and
 * vanish, and at range they are the strip.
 */
export class EmissiveLines {
  private readonly lines: THREE.Mesh[] = [];
  private readonly materials = new Map<THREE.Material, THREE.MeshBasicMaterial>();

  private materialFor(source: THREE.MeshStandardMaterial): THREE.MeshBasicMaterial {
    let m = this.materials.get(source);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ wireframe: true, toneMapped: false });
      m.color.copy(source.emissive).multiplyScalar(source.emissiveIntensity);
      this.materials.set(source, m);
    }
    return m;
  }

  /** Call once the map is built. Lines are children, so anything that moves takes them along. */
  attach(scene: THREE.Scene, visible: boolean): void {
    const found: THREE.Mesh[] = [];
    scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).name?.startsWith('world:emissive')) found.push(mesh);
    });
    for (const mesh of found) {
      const line = new THREE.Mesh(mesh.geometry, this.materialFor(mesh.material as THREE.MeshStandardMaterial));
      line.visible = visible;
      mesh.add(line);
      this.lines.push(line);
    }
  }

  setVisible(visible: boolean): void {
    for (const line of this.lines) line.visible = visible;
  }
}
