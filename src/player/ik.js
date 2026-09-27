import * as THREE from 'three';

// Analytic two-bone IK (after Daniel Holden's formulation) on a three.js bone chain a -> b -> c
// (upper arm, forearm, hand). The elbow stays in the plane the animation put it in, so the clip's
// elbow direction survives; the hand keeps its local rotation. World matrices of the chain must be
// current; they are refreshed for the chain on return.

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ba = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _at = new THREE.Vector3();
const _acN = new THREE.Vector3();
const _axis0 = new THREE.Vector3();
const _axis1 = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _origA = new THREE.Quaternion();
const _origB = new THREE.Quaternion();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const acos = (x) => Math.acos(clamp(x, -1, 1));

// Rotate `bone` (whose world rotation is `gq`) by `angle` about world axis `axis`.
function rotateWorld(bone, gq, axis, angle) {
  _inv.copy(gq).invert();
  _axis1.copy(axis).applyQuaternion(_inv);
  _r.setFromAxisAngle(_axis1, angle);
  bone.quaternion.multiply(_r);
}

// Move the end of chain (a, b, c) to world point `target` with blend weight w (0..1). `stretch` < 1
// keeps the elbow a little bent when the target is out of reach.
export function solveTwoBone(a, b, c, target, w = 1, stretch = 0.995) {
  if (w <= 0) return;
  _origA.copy(a.quaternion);
  _origB.copy(b.quaternion);
  a.getWorldPosition(_a);
  b.getWorldPosition(_b);
  c.getWorldPosition(_c);
  _t.copy(target);
  const lab = _ab.subVectors(_b, _a).length();
  const lcb = _bc.subVectors(_c, _b).length();
  if (lab < 1e-4 || lcb < 1e-4) return;
  const lat = clamp(_at.subVectors(_t, _a).length(), 0.01, (lab + lcb) * stretch);
  _ac.subVectors(_c, _a);
  if (_ac.lengthSq() < 1e-8 || _at.lengthSq() < 1e-8) return;
  _ba.subVectors(_a, _b).normalize();
  _bc.normalize();
  const acN = _acN.copy(_ac).normalize();
  const abN = _ab.normalize();
  const atN = _at.normalize();
  const acAb0 = acos(acN.dot(abN));
  const baBc0 = acos(_ba.dot(_bc));
  const acAt0 = acos(acN.dot(atN));
  const acAb1 = acos((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat));
  const baBc1 = acos((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb));
  _axis0.crossVectors(acN, abN);
  if (_axis0.lengthSq() < 1e-8) {
    // Arm dead straight: bend about an axis across the arm (any), the elbow picks its side.
    _axis0.crossVectors(acN, Math.abs(acN.y) < 0.9 ? _b.set(0, 1, 0) : _b.set(1, 0, 0));
  }
  _axis0.normalize();
  a.getWorldQuaternion(_qa);
  b.getWorldQuaternion(_qb);
  rotateWorld(a, _qa, _axis0, acAb1 - acAb0);
  rotateWorld(b, _qb, _axis0, baBc1 - baBc0);
  // Swing the (re-bent) arm onto the target.
  a.updateMatrixWorld(true);
  c.getWorldPosition(_c);
  _ac.subVectors(_c, _a).normalize();
  _axis0.crossVectors(_ac, atN);
  const len = _axis0.length();
  if (len > 1e-6) {
    _axis0.divideScalar(len);
    a.getWorldQuaternion(_qa);
    rotateWorld(a, _qa, _axis0, acos(_ac.dot(atN)));
  }
  if (w < 1) {
    a.quaternion.slerpQuaternions(_origA, a.quaternion, w);
    b.quaternion.slerpQuaternions(_origB, b.quaternion, w);
  }
  a.updateMatrixWorld(true);
}
