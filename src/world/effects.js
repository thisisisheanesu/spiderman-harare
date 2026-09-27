import * as THREE from 'three';

// Small animated set pieces, updated by City.update: the Eternal Flame on the Kopje and the Africa
// Unity Square fountain jets.

// Flickering flame (always lit).
export function createFlame(pos) {
  const geo = new THREE.ConeGeometry(0.5, 1.8, 7, 1, true);
  geo.translate(0, 0.9, 0);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.35), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  const inner = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.0, 1.0), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  inner.scale.set(0.5, 0.7, 0.5);
  mesh.add(inner);
  return {
    mesh,
    update(t) {
      const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 29 + 1) * 0.06;
      mesh.scale.set(1 + Math.sin(t * 7) * 0.05, f, 1 + Math.cos(t * 9) * 0.05);
      mesh.rotation.y = t * 0.7;
    },
  };
}

// Translucent water jets (geometry in world space around `origin`), pulsing gently.
export function createFountainJets(geometry, origin) {
  geometry.translate(-origin.x, 0, -origin.z);
  const mat = new THREE.MeshStandardMaterial({ color: '#eef8ff', roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(origin.x, 0, origin.z);
  mesh.renderOrder = 1;
  return {
    mesh,
    update(t) {
      mesh.scale.y = 1 + Math.sin(t * 1.7) * 0.05 + Math.sin(t * 4.3) * 0.02;
      mat.opacity = 0.5 + Math.sin(t * 3.1) * 0.06;
    },
  };
}
