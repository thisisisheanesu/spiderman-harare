import { B, BONE_NAMES, LIMB, HIP_JOINT_Y } from './model.js';

// Procedural poses. A pose is a flat Float32Array: XYZ Euler angles for every bone, then the hips
// offset (x, y, z) from the bind position. Conventions (model faces -Z, +X = its right):
//   +x on a hanging limb swings it forward; +x on the spine/neck/head tilts it back (look up).
//   +z on a hanging limb swings it towards +X, so outward abduction is side * z (side: L = -1, R = +1).
//   +y turns left.
// Every pose function takes (out, c) where c holds the animation inputs (see Animator).

const N = BONE_NAMES.length;
export const POSE_SIZE = N * 3 + 3;
const HP = N * 3;

const SIDES = [-1, 1];
const bone = (base, s) => B[base + (s < 0 ? 'L' : 'R')];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function rot(p, b, x, y = 0, z = 0) {
  p[b * 3] = x;
  p[b * 3 + 1] = y;
  p[b * 3 + 2] = z;
}

function hips(p, x, y, z) {
  p[HP] = x;
  p[HP + 1] = y;
  p[HP + 2] = z;
}

// Plant a foot flat on the floor at forward offset footZ (model space, -Z = forward) by solving the
// two-bone leg in the sagittal plane. Accounts for the hips offset and the pelvis pitch.
function plantLeg(p, s, footZ, footLift = 0, footPitch = 0) {
  const th = bone('thigh', s);
  const sn = bone('shin', s);
  const ft = bone('foot', s);
  const A = LIMB.thigh;
  const C = LIMB.shin;
  const hy = HIP_JOINT_Y + p[HP + 1] - LIMB.ankle - footLift;
  const dz = footZ - p[HP + 2];
  const D = clamp(Math.hypot(hy, dz), 0.1, A + C - 1e-3);
  const knee = Math.PI - Math.acos(clamp((A * A + C * C - D * D) / (2 * A * C), -1, 1));
  const thigh = Math.atan2(-dz, hy) + Math.acos(clamp((A * A + D * D - C * C) / (2 * A * D), -1, 1));
  const pelvis = p[B.hips * 3];
  p[th * 3] = thigh - pelvis;
  p[sn * 3] = -knee;
  p[ft * 3] = -(thigh - knee) + footPitch;
}

function clear(p) {
  p.fill(0);
}

export function poseIdle(p, c) {
  const t = c.time;
  const br = Math.sin(t * 1.9);
  clear(p);
  hips(p, 0, -0.04 + 0.004 * br, 0.01);
  rot(p, B.spine, 0.05 + 0.012 * br);
  rot(p, B.chest, -0.03 + 0.02 * br);
  rot(p, B.neck, -0.03);
  rot(p, B.head, 0.02 + 0.03 * Math.sin(t * 0.5), 0.2 * Math.sin(t * 0.33));
  for (const s of SIDES) {
    rot(p, bone('upperArm', s), 0.12, -s * 0.1, s * (0.2 + 0.015 * br));
    rot(p, bone('forearm', s), 0.5);
    rot(p, bone('hand', s), 0.15, 0, s * 0.12);
    rot(p, bone('thigh', s), 0, s * 0.12, s * 0.07);
    plantLeg(p, s, s < 0 ? 0.03 : -0.06);
    p[bone('foot', s) * 3 + 2] = -s * 0.07;
  }
}

// Run cycle; c.runPhase advances with distance, c.run01 goes 0 (jog) → 1 (full parkour sprint).
export function poseRun(p, c) {
  const ph = c.runPhase;
  const k = c.run01;
  clear(p);
  const lean = 0.16 + 0.32 * k;
  hips(p, 0, -0.07 + 0.045 * Math.cos(2 * ph), -0.03 * k);
  rot(p, B.hips, 0, 0.16 * Math.sin(ph));
  rot(p, B.spine, -lean * 0.55, -0.12 * Math.sin(ph));
  rot(p, B.chest, -lean * 0.45, -0.16 * Math.sin(ph));
  rot(p, B.neck, lean * 0.45);
  rot(p, B.head, lean * 0.35);
  const A = 0.55 + 0.45 * k;
  for (const s of SIDES) {
    const leg = ph + (s < 0 ? 0 : Math.PI);
    const sw = Math.sin(leg);
    const fwd = Math.max(0, Math.cos(leg));
    const back = Math.max(0, -sw);
    rot(p, bone('thigh', s), 0.22 + A * sw + 0.25 * fwd * k, 0, s * 0.05);
    rot(p, bone('shin', s), -(0.3 + (1.15 + 0.8 * k) * fwd ** 0.8 + 0.35 * back));
    rot(p, bone('foot', s), -0.3 * back - 0.15 + 0.25 * Math.max(0, sw));
    rot(p, bone('upperArm', s), -(0.55 + 0.55 * k) * sw + 0.1, 0, s * (0.14 + 0.06 * k));
    rot(p, bone('forearm', s), 1.2 + 0.3 * Math.max(0, -sw) + 0.2 * k);
    rot(p, bone('hand', s), 0.25);
  }
}

export function poseJump(p, c) {
  clear(p);
  const up = clamp(c.vy / 12, 0, 1);
  hips(p, 0, 0, 0);
  rot(p, B.spine, -0.12);
  rot(p, B.chest, 0.08);
  rot(p, B.head, 0.12);
  rot(p, B.thighL, 1.35, 0, -0.1);
  rot(p, B.shinL, -1.9);
  rot(p, B.footL, -0.3);
  rot(p, B.thighR, 0.05 - 0.2 * up, 0, 0.08);
  rot(p, B.shinR, -0.55);
  rot(p, B.footR, -0.6);
  for (const s of SIDES) {
    rot(p, bone('upperArm', s), 0.5 + 1.2 * up * (s > 0 ? 1 : 0.4), 0, s * 0.45);
    rot(p, bone('forearm', s), 0.9);
    rot(p, bone('hand', s), 0.2);
  }
}

// Flailing fall at low speed.
export function poseFall(p, c) {
  const w = c.time * 6.5;
  clear(p);
  rot(p, B.spine, 0.12);
  rot(p, B.chest, 0.12);
  rot(p, B.head, -0.25);
  for (const s of SIDES) {
    const o = s * 1.3;
    rot(p, bone('upperArm', s), 0.35 + 0.35 * Math.sin(w + o), 0, s * (1.8 + 0.25 * Math.sin(w * 0.8 + o)));
    rot(p, bone('forearm', s), 0.55 + 0.3 * Math.sin(w * 1.1 + o));
    rot(p, bone('thigh', s), 0.45 + 0.4 * Math.sin(w * 0.9 + o), 0, s * 0.15);
    rot(p, bone('shin', s), -0.9 - 0.35 * Math.sin(w * 0.9 + o + 1));
    rot(p, bone('foot', s), -0.4);
  }
}

// Spread-eagle skydive (the body frame is horizontal, belly down).
export function poseSkydive(p, c) {
  const w = c.time * 3;
  clear(p);
  rot(p, B.spine, 0.18);
  rot(p, B.chest, 0.16);
  rot(p, B.neck, 0.45);
  rot(p, B.head, 0.55);
  for (const s of SIDES) {
    rot(p, bone('upperArm', s), 0.35 + 0.05 * Math.sin(w + s), 0, s * (1.25 + 0.06 * Math.sin(w * 1.3)));
    rot(p, bone('forearm', s), 0.75);
    rot(p, bone('hand', s), -0.2);
    rot(p, bone('thigh', s), -0.12, 0, s * 0.32);
    rot(p, bone('shin', s), -0.8 - 0.08 * Math.sin(w + s));
    rot(p, bone('foot', s), -0.6);
  }
}

// Head-first dive (the body frame's up follows the velocity): arms swept back, legs together.
export function poseDive(p, c) {
  const w = c.time * 14;
  const f = 0.03 * clamp(c.speed / 50, 0, 1);
  clear(p);
  rot(p, B.spine, 0.06);
  rot(p, B.chest, 0.05);
  rot(p, B.neck, 0.45);
  rot(p, B.head, 0.45);
  for (const s of SIDES) {
    rot(p, bone('upperArm', s), -0.35 + f * Math.sin(w + s), 0, s * 0.22);
    rot(p, bone('forearm', s), 0.12);
    rot(p, bone('hand', s), -0.1, 0, s * 0.2);
    rot(p, bone('thigh', s), -0.06 + (s < 0 ? 0.12 : 0), 0, s * 0.03);
    rot(p, bone('shin', s), s < 0 ? -0.45 : -0.15);
    rot(p, bone('foot', s), -0.95);
  }
}

// Swinging: the frame's up runs along the web. c.webSide picks the arm on the web; c.rising (-1..1)
// drives the legs: extended on the way down, tucked through the bottom, kicking forward on the rise.
export function poseSwing(p, c) {
  const s = c.webSide || 1;
  const r = clamp(c.rising, -1, 1);
  const down = smooth(-0.15, -0.7, r);
  const up = smooth(0.1, 0.65, r);
  const mid = 1 - down - up;
  clear(p);
  hips(p, 0, 0, 0);
  rot(p, B.spine, 0.14 * down - 0.3 * mid - 0.22 * up, s * 0.08);
  rot(p, B.chest, 0.1 * down - 0.2 * mid - 0.1 * up, s * 0.1);
  rot(p, B.neck, -0.05);
  rot(p, B.head, 0.1 + 0.15 * down, -s * 0.15);
  rot(p, bone('shoulder', s), 0, 0, s * 0.12);
  rot(p, bone('upperArm', s), 2.95, 0, -s * 0.12);
  rot(p, bone('forearm', s), 0.18);
  rot(p, bone('hand', s), 0.35);
  const o = -s;
  rot(p, bone('upperArm', o), -0.25 + 0.6 * up, 0, o * (1.15 - 0.3 * mid));
  rot(p, bone('forearm', o), 0.45 + 0.5 * mid);
  rot(p, bone('hand', o), 0.1);
  for (const side of SIDES) {
    const lead = side === s ? 1 : 0;
    rot(p, bone('thigh', side), -0.2 * down + (1.25 + 0.3 * lead) * mid + (0.65 + 0.3 * lead) * up, 0, side * (0.06 + 0.1 * mid));
    rot(p, bone('shin', side), -0.25 * down - (1.8 + 0.3 * lead) * mid - (0.3 + 0.7 * (1 - lead)) * up);
    rot(p, bone('foot', side), -0.6 * down - 0.3);
  }
}

// Tucked ball for flips and rolls.
export function poseTuck(p) {
  clear(p);
  rot(p, B.spine, -0.55);
  rot(p, B.chest, -0.45);
  rot(p, B.neck, -0.3);
  rot(p, B.head, -0.25);
  for (const s of SIDES) {
    rot(p, bone('upperArm', s), 1.0, 0, s * 0.3);
    rot(p, bone('forearm', s), 1.9);
    rot(p, bone('thigh', s), 2.15, 0, s * 0.18);
    rot(p, bone('shin', s), -2.35);
    rot(p, bone('foot', s), 0.2);
  }
}

// Arms-out spread for twirls and corkscrews.
export function poseSpread(p, c) {
  clear(p);
  rot(p, B.spine, 0.1);
  rot(p, B.chest, 0.12);
  rot(p, B.head, 0.1);
  for (const s of SIDES) {
    rot(p, bone('upperArm', s), 0.2, 0, s * 1.45);
    rot(p, bone('forearm', s), 0.25);
    rot(p, bone('hand', s), 0, 0, s * 0.3);
    rot(p, bone('thigh', s), s < 0 ? 0.9 : -0.1, 0, s * 0.12);
    rot(p, bone('shin', s), s < 0 ? -1.6 : -0.3);
    rot(p, bone('foot', s), -0.6);
  }
  rot(p, B.hips, 0, 0.2 * Math.sin(c.time * 3));
}

// Web-zip: pulled head first with both hands on the lines, legs trailing.
export function poseZip(p, c) {
  const pull = clamp(c.zipT, 0, 1);
  clear(p);
  rot(p, B.spine, 0.06);
  rot(p, B.chest, 0.04);
  rot(p, B.neck, 0.2);
  rot(p, B.head, 0.3);
  for (const s of SIDES) {
    rot(p, bone('shoulder', s), 0, 0, s * 0.1);
    rot(p, bone('upperArm', s), 2.85 - 0.5 * pull, 0, -s * 0.18);
    rot(p, bone('forearm', s), 0.2 + 0.9 * pull);
    rot(p, bone('hand', s), 0.3);
    rot(p, bone('thigh', s), s < 0 ? 0.45 : -0.08, 0, s * 0.05);
    rot(p, bone('shin', s), s < 0 ? -1.2 : -0.3);
    rot(p, bone('foot', s), -0.8);
  }
}

// Crouched perch on a ledge: knees wide, one forearm on a knee, the other hand on the ledge.
export function posePerch(p, c) {
  const br = Math.sin(c.time * 1.6);
  clear(p);
  hips(p, 0, -0.57 + 0.006 * br, 0.1);
  rot(p, B.hips, -0.35);
  rot(p, B.spine, -0.38 + 0.015 * br);
  rot(p, B.chest, -0.28 + 0.02 * br);
  rot(p, B.neck, 0.4);
  rot(p, B.head, 0.42 + 0.04 * Math.sin(c.time * 0.4), 0.25 * Math.sin(c.time * 0.23));
  for (const s of SIDES) {
    rot(p, bone('thigh', s), 0, s * 0.2, s * 0.3);
    plantLeg(p, s, s < 0 ? -0.06 : 0.0, 0, 0);
    p[bone('foot', s) * 3 + 1] = -s * 0.2;
    p[bone('foot', s) * 3 + 2] = -s * 0.28;
  }
  rot(p, B.upperArmR, 0.45, 0, 0.3);
  rot(p, B.forearmR, 1.35);
  rot(p, B.handR, 0.3, 0, 0.2);
  rot(p, B.upperArmL, 0.3, 0.1, -0.05);
  rot(p, B.forearmL, 0.2);
  rot(p, B.handL, -0.8);
}

// Superhero landing: one knee down, fist on the ground, other arm flung back; c.actionT (0..1)
// raises the head at the end.
export function poseLandHard(p, c) {
  const k = smooth(0.35, 0.9, c.actionT);
  clear(p);
  hips(p, 0, -0.5 + 0.12 * k, 0.06);
  rot(p, B.hips, -0.2);
  rot(p, B.spine, -0.45 + 0.2 * k);
  rot(p, B.chest, -0.3 + 0.1 * k);
  rot(p, B.neck, -0.15 + 0.35 * k);
  rot(p, B.head, -0.25 + 0.55 * k);
  rot(p, B.thighL, 0, 0, -0.18);
  plantLeg(p, -1, 0.38, 0, -0.9);
  rot(p, B.thighR, 0, 0, 0.12);
  plantLeg(p, 1, -0.32);
  rot(p, B.upperArmR, 0.3, 0, 0.12);
  rot(p, B.forearmR, 0.15);
  rot(p, B.handR, -0.5);
  rot(p, B.upperArmL, -0.55, 0, -1.15);
  rot(p, B.forearmL, 0.35);
  rot(p, B.handL, 0, 0, -0.4);
}

// Vault / mantle: hands down on the ledge, knees tucked to the side.
export function poseVault(p) {
  clear(p);
  hips(p, 0, -0.15, 0);
  rot(p, B.spine, -0.4);
  rot(p, B.chest, -0.25);
  rot(p, B.head, 0.35);
  for (const s of SIDES) {
    rot(p, bone('upperArm', s), 0.95, 0, s * 0.25);
    rot(p, bone('forearm', s), 0.25);
    rot(p, bone('hand', s), -0.9);
    rot(p, bone('thigh', s), 1.55, 0, 0.35);
    rot(p, bone('shin', s), -2.0);
    rot(p, bone('foot', s), 0.2);
  }
}

// Clinging to / climbing a wall (upright frame facing the wall, which is ~0.45 m ahead of the pivot).
// c.wallPhase advances with movement; c.wallMove (0..1) blends from clinging to scrambling.
export function poseWall(p, c) {
  const ph = c.wallPhase;
  const m = c.wallMove;
  const br = Math.sin(c.time * 2);
  clear(p);
  hips(p, 0, -0.08, -0.05);
  rot(p, B.spine, -0.18 + 0.01 * br, 0.1 * m * Math.sin(ph));
  rot(p, B.chest, -0.12);
  rot(p, B.neck, 0.35);
  rot(p, B.head, 0.3, c.wallLook * 0.5);
  for (const s of SIDES) {
    const cyc = Math.sin(ph + (s < 0 ? 0 : Math.PI)) * m;
    rot(p, bone('upperArm', s), 1.95 + 0.55 * cyc, 0, s * (0.55 - 0.15 * cyc));
    rot(p, bone('forearm', s), 0.55 - 0.25 * cyc);
    rot(p, bone('hand', s), -1.0);
    const lcyc = -cyc;
    rot(p, bone('thigh', s), 1.05 + 0.4 * lcyc, 0, s * (0.6 + 0.1 * lcyc));
    rot(p, bone('shin', s), -0.75 - 0.6 * Math.max(0, lcyc));
    rot(p, bone('foot', s), 1.1);
  }
}

// Running straight up a wall: a sprint with the feet striking the wall ahead.
export function poseWallRun(p, c) {
  poseRun(p, { runPhase: c.wallPhase, run01: 1 });
  rot(p, B.spine, 0.12);
  rot(p, B.chest, 0.05);
  rot(p, B.neck, 0.2);
  rot(p, B.head, 0.35);
  hips(p, 0, -0.1, 0.05);
}
