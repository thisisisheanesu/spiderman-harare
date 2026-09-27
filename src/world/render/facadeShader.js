import * as THREE from 'three';
import { STYLES, STYLE_IDS, VIRTUAL, GLASS_PRESETS, FRAME_COLORS } from '../facades.js';

// GLSL for the city facade material (see materials.js). Tables that never change after loading
// (PBR tile sizes / mean colours, facade styles, virtual layers, glass presets) are compiled in as
// constant arrays, so the material keeps few uniforms (phones have ~224 fragment vectors).

const f = (x) => {
  const s = Number(x).toFixed(5);
  return s.includes('.') ? s : `${s}.0`;
};
const v2 = (a) => `vec2(${f(a[0])}, ${f(a[1])})`;
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;
const v4 = (a) => `vec4(${f(a[0])}, ${f(a[1])}, ${f(a[2])}, ${f(a[3])})`;
const arr = (type, n, items) => `${type}[${n}](${items.join(', ')})`;
const lin = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// Shared GLSL helpers (also used by the ground material).
export const GLSL_HELPERS = /* glsl */ `
float cityHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Box-filtered coverage of x >= e for a pixel footprint w (anti-aliased step).
float cityStep(float e, float x, float w) {
  return clamp((x - e) / max(w, 1e-5) + 0.5, 0.0, 1.0);
}
float cityBox(float a, float b, float x, float w) {
  return clamp(cityStep(a, x, w) - cityStep(b, x, w), 0.0, 1.0);
}
float cityRect(vec4 r, vec2 p, vec2 w) {
  return cityBox(r.x, r.z, p.x, w.x) * cityBox(r.y, r.w, p.y, w.y);
}
// Coverage of a bar of half width hw centred at distance d.
float cityBar(float d, float hw, float w) {
  return 1.0 - cityStep(hw, d, w);
}
// Cotangent frame from screen derivatives (normal mapping without tangents).
mat3 cityTBN(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * s, B * s, N);
}
vec3 cityUnpackNormal(vec2 xy, float strength) {
  vec2 n = (xy * 2.0 - 1.0) * strength;
  return vec3(n, sqrt(max(0.0, 1.0 - dot(n, n))));
}
`;

// Fragment declarations for the facade material. `pbr` = the facade PbrSet.
// Albedo contrast per material (1 = as scanned): the peeling plaster scan reads as camouflage on a
// 20 m wall at full strength.
const CONTRAST = { plaster_peeling: 0.45, concrete_weathered: 0.75, plaster_textured: 0.8, roof_gravel: 0.85 };

export function facadeFragmentDecl(pbr, { normals, interiors }) {
  const N = pbr.count;
  const info = [];
  const avg = [];
  const metal = Array.from(pbr.metal || new Float32Array(N), (m) => f(m));
  for (let i = 0; i < N; i++) {
    const c = CONTRAST[pbr.names[i]] ?? 1;
    info.push(v4([pbr.info[i * 4], pbr.info[i * 4 + 1], pbr.info[i * 4 + 2], c]));
    avg.push(v3([Math.max(0.02, pbr.avg[i * 3]), Math.max(0.02, pbr.avg[i * 3 + 1]), Math.max(0.02, pbr.avg[i * 3 + 2])]));
  }
  const names = Object.keys(STYLES);
  const win = [];
  const sa = [];
  const sb = [];
  const sc = [];
  const sm = [];
  for (const n of names) {
    const s = STYLES[n];
    win.push(v4(s.win));
    sa.push(v4([s.reveal, s.frame, s.mull, s.transom]));
    sb.push(v4([s.sill, s.pair ? 1 : 0, s.room, s.depth]));
    sc.push(v4([s.ribbon ? 1 : 0, s.spandrel ? 1 : 0, s.surround || 0, s.tileW]));
    sm.push(v2([pbr.id(s.wall), pbr.id(s.accent)]));
  }
  const vl = [];
  const vc = [];
  for (const v of Object.values(VIRTUAL)) {
    const id = pbr.id(v.mat);
    vl.push(v4([id, v.uvScale, v.metal, 0]));
    if (v.color) {
      const c = lin(v.color);
      vc.push(v3([c[0] / Math.max(0.02, pbr.avg[id * 3]), c[1] / Math.max(0.02, pbr.avg[id * 3 + 1]), c[2] / Math.max(0.02, pbr.avg[id * 3 + 2])]));
    } else {
      vc.push(v3([1, 1, 1]));
    }
  }
  const glass = GLASS_PRESETS.map(([t, f0]) => v4([...t, f0]));
  const frames = FRAME_COLORS.map((h) => v3(lin(h)));
  const defs = Object.entries(STYLE_IDS).map(([k, i]) => `#define ST_${k.toUpperCase()} ${i}`).join('\n');
  return /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray facadeMap;
uniform sampler2DArray pbrA;
${normals ? 'uniform sampler2DArray pbrB;' : ''}
uniform sampler2D interiorMap;
uniform sampler2D noiseMap;
uniform float uNight;
uniform float uShutterFrac;
uniform vec3 uInterior;
uniform vec3 uSunDir;
uniform vec3 uBounce;
uniform vec3 uCanyonLit;
uniform vec3 uCanyonShade;
uniform sampler2D urbanMap;
uniform vec4 urbanRect;
uniform vec3 uSkyHorizon;
varying vec4 vFac;
varying vec4 vPbr;
varying vec2 vFacUv;
varying vec3 vWPos;
varying vec3 vWNrm;
#define NPBR ${N}
#define NST ${names.length}
#define NVL ${vl.length}
#define M_ALU ${f(pbr.id('window_frame_aluminium'))}
#define M_GLASS ${f(pbr.id('window_glass'))}
#define M_SHUTTER ${f(pbr.id('shutter_rolldown'))}
#define M_METAL ${f(pbr.id('metal_panel'))}
#define M_PLASTER ${f(pbr.id('plaster_smooth'))}
#define M_GRANITE_DARK ${f(pbr.id('granite_dark_tiles'))}
#define PAINT 0.84
${defs}
${interiors ? '#define CITY_INTERIORS' : ''}
${normals ? '#define CITY_NORMALS' : ''}
${pbr.compressed ? '#define CITY_BC5' : ''}
const float PBR_METAL[NPBR] = float[NPBR](${metal.join(', ')});
const vec4 PBR_INFO[NPBR] = ${arr('vec4', N, info)};
const vec3 PBR_AVG[NPBR] = ${arr('vec3', N, avg)};
const vec4 ST_WIN[NST] = ${arr('vec4', names.length, win)};
const vec4 ST_A[NST] = ${arr('vec4', names.length, sa)};
const vec4 ST_B[NST] = ${arr('vec4', names.length, sb)};
const vec4 ST_C[NST] = ${arr('vec4', names.length, sc)};
const vec2 ST_MAT[NST] = ${arr('vec2', names.length, sm)};
const vec4 VL_A[NVL] = ${arr('vec4', vl.length, vl)};
const vec3 VL_C[NVL] = ${arr('vec3', vc.length, vc)};
const vec4 GLASS[8] = ${arr('vec4', 8, glass)};
const vec3 FRAMES[4] = ${arr('vec3', 4, frames)};
${GLSL_HELPERS}

vec3 cityAlbedo(vec4 a, float mat, vec3 tint) {
  int m = int(mat + 0.5);
  vec3 c = mix(PBR_AVG[m], a.rgb, PBR_INFO[m].w);
  return PBR_INFO[m].z > 0.5 ? c * tint * (PAINT / PBR_AVG[m]) : c * tint;
}

// Interior mapping (public/textures/README.md, "Projection"): ray-box hit in room space, then the
// bake projection into the atlas cell. gx / gy: smooth room-uv gradients for textureGrad.
vec3 cityInterior(vec2 wuv, vec3 d, float cell, float mirror, vec2 gx, vec2 gy) {
  if (mirror > 0.5) { wuv.x = 1.0 - wuv.x; d.x = -d.x; gx.x = -gx.x; gy.x = -gy.x; }
  wuv = clamp(wuv, vec2(0.001), vec2(0.999));
  d.z = max(d.z, 1e-3);
  vec3 p0 = vec3(wuv, 0.0);
  vec3 tA = (vec3(0.0) - p0) / d;
  vec3 tB = (vec3(1.0) - p0) / d;
  vec3 tM = max(tA, tB);
  float t = min(min(tM.x, tM.y), tM.z);
  vec3 p = p0 + d * t;
  vec2 cuv = clamp(0.5 + (p.xy - 0.5) / (1.0 + p.z), vec2(0.004), vec2(0.996));
  float row = floor((cell + 0.5) / 4.0);
  float col = cell - row * 4.0;
  vec2 auv = (vec2(col, 1.0 - row) + cuv) / vec2(4.0, 2.0);
  return textureGrad(interiorMap, auv, gx / vec2(4.0, 2.0), gy / vec2(4.0, 2.0)).rgb;
}
`;
}

// Main surface evaluation, injected at <color_fragment>. Produces the s* variables consumed by the
// later injection points (roughness, metalness, normal, emissive, specular colour, direct-light
// occlusion inside window recesses, ambient occlusion).
export const FACADE_MAIN = /* glsl */ `
diffuseColor.a = 1.0;
vec3 cTint = diffuseColor.rgb;
float cKind = floor(mod(vFac.z + 0.5, 8.0));
float cCls = floor((vFac.z + 0.5) / 8.0);
float cLayer = floor(vFac.x + 0.5);
float cSeed = floor(vFac.y + 0.5);
float cGp = floor(mod(vFac.w + 0.5, 8.0));
float cMatX = floor(vPbr.x + 0.5);
float cAccX = floor(vPbr.y + 0.5);
float cExtra = floor(vPbr.z + 0.5);
float cFlags = floor(vPbr.w + 0.5);
float cUvMode = mod(cFlags, 4.0);
int cFrameIdx = int(mod(floor(cFlags / 4.0), 4.0));
float cWeather = mod(floor(cFlags / 16.0), 4.0) / 3.0;

vec3 cN = normalize(vWNrm);
float cVert = 1.0 - step(0.7, abs(cN.y));
vec3 cT = cVert > 0.5 ? normalize(vec3(cN.z, 0.0, -cN.x)) : vec3(1.0, 0.0, 0.0);
vec2 cPlan = cVert > 0.5 ? vec2(dot(vWPos, cT), vWPos.y) : vec2(vWPos.x, -vWPos.z);

bool cIsStyle = cLayer > 127.5 && cLayer < 191.5;
bool cIsVirtual = cLayer > 191.5;
int cSt = int(clamp(cLayer - 128.0, 0.0, float(NST - 1)));
int cVl = int(clamp(cLayer - 192.0, 0.0, float(NVL - 1)));

// Which PBR material, and its uv in metres.
float cMat = 0.0;
vec2 cMet = cPlan;
float cMetalOv = -1.0;
vec3 cColScale = vec3(1.0);
bool cHasPbr = cIsStyle || cIsVirtual || cMatX < 254.5;
if (cIsVirtual) {
  bool expl = cMatX < 254.5;
  cMat = expl ? cMatX : VL_A[cVl].x;
  cMet = expl ? (cUvMode < 0.5 ? cPlan : vFacUv) : vFacUv * VL_A[cVl].y;
  cMetalOv = VL_A[cVl].z;
  cColScale = expl ? vec3(1.0) : VL_C[cVl];
} else if (cIsStyle) {
  cMat = cMatX < 254.5 ? cMatX : ST_MAT[cSt].x;
} else if (cMatX < 254.5) {
  cMat = cMatX;
  cMet = cUvMode > 0.5 ? vFacUv : cPlan;
}
int cMi = int(cMat + 0.5);
vec2 cUv = cMet * PBR_INFO[cMi].xy;
vec2 cUvDx = dFdx(cUv);
vec2 cUvDy = dFdy(cUv);
vec4 cA = textureGrad(pbrA, vec3(cUv, cMat), cUvDx, cUvDy);
#ifdef CITY_NORMALS
vec4 cB = textureGrad(pbrB, vec3(cUv, cMat), cUvDx, cUvDy);
#else
vec4 cB = vec4(0.5, 0.5, 1.0, 0.0);
#endif
#ifdef CITY_BC5
cB.b = 1.0;
cB.a = PBR_METAL[cMi];
#endif
mat3 cTBN = cityTBN(cN, vWPos, cUv);
// Derivatives for the analytic layouts (taken here, in uniform control flow).
vec2 fdU = vec2(dFdx(vFacUv.x), dFdy(vFacUv.x));
vec2 fdV = vec2(dFdx(vFacUv.y), dFdy(vFacUv.y));
vec2 fdS = vec2(dFdx(cPlan.x), dFdy(cPlan.x));
vec2 fdY = vec2(dFdx(cPlan.y), dFdy(cPlan.y));
vec2 cFw = vec2(length(fdU), length(fdV)) + 1e-6;
float cBayW = length(fdS) / cFw.x;
float cFloorH = length(fdY) / cFw.y;
float cUSign = dot(fdS, fdU) < 0.0 ? -1.0 : 1.0;
vec2 cPlanDx = vec2(fdS.x, fdY.x);
vec2 cPlanDy = vec2(fdS.y, fdY.y);

// Low-frequency variation so tiles never visibly repeat, plus grime.
vec4 cNz = texture(noiseMap, cPlan * 0.011 + vec2(cSeed * 0.137, cSeed * 0.071));
vec4 cNz2 = texture(noiseMap, vec2(cPlan.x * 0.23, cPlan.y * 0.021) + cSeed * 0.031);
float cMacro = mix(0.86, 1.1, cNz.r) * mix(0.94, 1.04, cNz.g);

// Street canyon: how tall the buildings around are (urban mask) and how high up this point is.
float cUrban = texture(urbanMap, (vWPos.xz - urbanRect.xy) / urbanRect.zw).r;
float cCanyonH = mix(5.0, 26.0, smoothstep(0.15, 0.7, cUrban));
float cYRel = max(vWPos.y, 0.0);

// Surface outputs.
vec3 sAlb = vec3(0.6);
float sRough = cA.a;
float sMetal = cMetalOv >= 0.0 ? cMetalOv : cB.a;
float sAO = mix(1.0, cB.b, 0.85);
vec3 sNw = normalize(cTBN * cityUnpackNormal(cB.xy, 1.0));
float sGlass = 0.0;
vec3 sF0 = vec3(0.04);
vec3 sEmit = vec3(0.0);
float sSun = 1.0;

if (cIsVirtual) {
  sAlb = cIsVirtual && cMatX > 254.5 ? cA.rgb * cTint * cColScale : cityAlbedo(cA, cMat, cTint);
  sAlb *= cMacro;
} else if (cIsStyle) {
  // ---------------------------------------------------------------- analytic facade
  vec4 W = ST_WIN[cSt];
  vec4 SA = ST_A[cSt];
  vec4 SB = ST_B[cSt];
  vec4 SC = ST_C[cSt];
  float tileW = SC.w;
  float bayW = clamp(cBayW, tileW * 0.4, tileW * 2.5);
  float fh = clamp(cFloorH, 2.2, 7.0);
  if (cVert < 0.5) { bayW = tileW; fh = 3.3; }
  vec2 cell = floor(vFacUv);
  vec2 fr = vFacUv - cell;
  vec2 p = fr * vec2(bayW, fh);
  vec2 pw = cFw * vec2(bayW, fh);
  float lod = smoothstep(0.3, 0.75, max(cFw.x, cFw.y));
  vec3 V = normalize(vWPos - cameraPosition);
  vec3 Tu = cT * cUSign;
  vec3 vts = vec3(dot(V, Tu), V.y, -dot(V, cN));
  vts.z = max(vts.z, 0.03);
  vec3 lts = vec3(dot(uSunDir, Tu), uSunDir.y, dot(uSunDir, cN));

  bool pair = SB.y > 0.5;
  float halfW = pair ? bayW * 0.5 : bayW;
  vec2 pl = vec2(pair ? mod(p.x, halfW) : p.x, p.y);
  float pairOff = p.x - pl.x;
  vec4 R = W * vec4(halfW, fh, halfW, fh);
  // Street-level shopfronts are laid out in metres.
  bool shop = cSt == ST_SHOP || cSt == ST_LOBBY || cSt == ST_COLSHOP;
  float bayHash = cityHash(vec2(cell.x * 1.618 + cSeed * 0.37, cell.y * 3.1 + cSeed));
  float door = 0.0;
  if (cSt == ST_SHOP) {
    R = vec4(0.28, 0.5, bayW - 0.28, fh - 0.78);
    door = step(bayHash, 0.4);
  } else if (cSt == ST_LOBBY) {
    R = vec4(0.35, 0.1, bayW - 0.35, fh - 0.45);
  } else if (cSt == ST_COLSHOP) {
    R = vec4(0.3, 0.55, bayW - 0.3, fh - 0.55);
    door = 1.0;
  }
  float hasWin = step(0.001, W.z - W.x);

  // Wall / accent / trim albedo.
  vec3 wallAlb = cityAlbedo(cA, cMat, cTint) * cMacro;
  float accMat = cAccX < 254.5 ? cAccX : ST_MAT[cSt].y;
  vec2 accS = PBR_INFO[int(accMat + 0.5)].xy;
  vec4 accA = textureGrad(pbrA, vec3(cPlan * accS, accMat), cPlanDx * accS, cPlanDy * accS);
  vec3 trimAlb = cityAlbedo(accA, accMat, mix(cTint, vec3(0.9, 0.89, 0.86), 0.55)) * mix(0.95, 1.03, cNz.g);
  vec3 frameCol = FRAMES[cFrameIdx];
  if (cSt == ST_COLSHOP) frameCol = vec3(0.045, 0.1, 0.06);

  // Wall plane: opening, sill, surround, style extras.
  float open0 = hasWin * cityRect(R, pl, pw);
  float revD = SA.x;
  vec2 q = pl + vts.xy * (revD / vts.z);
  float inGl = cityRect(R, q, pw);
  float reveal = open0 * (1.0 - inGl);
  float trim = 0.0;
  float bevel = 0.0;     // +1 = facet tilted up (sill tops), -1 = down (soffits)
  float aoK = 1.0;
  float accentK = 0.0;   // accent material (stall risers, fins, spandrels)
  // Sill under the opening.
  if (SB.x > 0.0) {
    float sillH = SB.x;
    vec4 Rs = vec4(R.x - 0.06, R.y - sillH, R.z + 0.06, R.y);
    float sk = cityRect(Rs, pl, pw) * (1.0 - open0);
    trim = max(trim, sk);
    bevel += sk * (smoothstep(R.y - sillH * 0.6, R.y, pl.y) * 2.0 - 0.6);
    // Shadow line and drip stains under the sill.
    float under = cityRect(vec4(Rs.x, Rs.y - 0.05, Rs.z, Rs.y), pl, pw);
    aoK *= 1.0 - 0.45 * under * (1.0 - open0);
    float drip = cityBox(Rs.x, Rs.z, pl.x, pw.x) * smoothstep(Rs.y - 1.4, Rs.y, pl.y) * step(pl.y, Rs.y);
    wallAlb *= 1.0 - 0.28 * drip * smoothstep(0.45, 0.75, cNz2.b) * (0.5 + cWeather);
  }
  if (SC.z > 0.0) {
    float s = SC.z;
    float sk = cityRect(R + vec4(-s, -s, s, s), pl, pw) * (1.0 - open0);
    trim = max(trim, sk);
  }
  vec3 extraAlb = vec3(0.0);
  float extraK = 0.0;
  vec3 extraN = vec3(0.0, 0.0, 1.0);
  if (cSt == ST_PAIR) {
    // Lighter pier between the two windows.
    float pk = cityBox(bayW * 0.46, bayW * 0.54, p.x, pw.x);
    trim = max(trim, pk * 0.8);
  } else if (cSt == ST_FINS) {
    float fk = cityBox(0.0, bayW * 0.24, p.x, pw.x);
    accentK = max(accentK, fk);
    aoK *= 1.0 - 0.25 * cityBox(bayW * 0.24, bayW * 0.3, p.x, pw.x);
  } else if (cSt == ST_BANDS) {
    // Dark spandrel line under each ribbon.
    accentK = max(accentK, cityBox(R.y - SB.x - 0.14, R.y - SB.x, pl.y, pw.y));
  } else if (cSt == ST_COLONIAL) {
    // Painted louvred shutters either side of the window.
    float sw = (R.z - R.x) * 0.3;
    float shL = cityRect(vec4(R.x - sw - 0.1, R.y, R.x - 0.1, R.w), pl, pw);
    float shR = cityRect(vec4(R.z + 0.1, R.y, R.z + 0.1 + sw, R.w), pl, pw);
    float sh = max(shL, shR);
    float slat = 0.5 + 0.5 * sin(pl.y * 90.0);
    extraAlb = mix(vec3(0.05, 0.12, 0.07), vec3(0.08, 0.16, 0.1), slat) * (0.8 + 0.4 * cityHash(vec2(cSeed, 5.0)));
    extraK = sh;
    extraN = normalize(vec3(0.0, (slat - 0.5) * 0.6, 1.0));
    // Cornice line near the top of each storey.
    float cor = cityBox(fh - 0.28, fh - 0.12, pl.y, pw.y);
    trim = max(trim, cor);
    bevel += cor * 0.8;
  } else if (cSt == ST_BALCONY) {
    // Slab edge at floor level, shadowed recess behind the railing, railing bars.
    float slab = cityBox(0.0, 0.22, pl.y, pw.y);
    trim = max(trim, slab);
    bevel -= slab * 0.4;
    aoK *= mix(1.0, 0.62, smoothstep(fh - 0.1, fh - 0.9, pl.y) * (1.0 - slab)) ;
    aoK *= 1.0 - 0.35 * cityBox(fh - 0.25, fh, pl.y, pw.y);
    float railH = cityBox(0.22, 1.15, pl.y, pw.y);
    float bars = cityBar(abs(fract(p.x / 0.13) - 0.5) * 0.13, 0.012, pw.x) * railH;
    float rail = cityBox(1.08, 1.15, pl.y, pw.y) + cityBox(0.22, 0.27, pl.y, pw.y);
    extraK = clamp(max(bars, rail), 0.0, 1.0);
    extraAlb = vec3(0.05, 0.055, 0.06) * (0.8 + 0.5 * cityHash(vec2(cSeed, 9.0)));
    extraN = vec3(0.0, 0.0, 1.0);
  } else if (cSt == ST_INDUSTRIAL) {
    wallAlb *= 0.92 + 0.08 * cityBar(abs(fract(p.x / 0.2) - 0.5) * 0.2, 0.05, pw.x);
  } else if (cSt == ST_SHOP) {
    // Stall riser (tiles) under the display window, fascia band above.
    float riser = cityBox(0.0, R.y, pl.y, pw.y) * cityBox(R.x, R.z, pl.x, pw.x) * (1.0 - door * cityBox(bayW * 0.56, bayW * 0.9, pl.x, pw.x));
    accentK = max(accentK, riser);
    aoK *= 1.0 - 0.3 * cityBox(fh - 0.85, fh - 0.78, pl.y, pw.y);
  } else if (cSt == ST_COLSHOP) {
    float riser = cityBox(0.0, R.y, pl.y, pw.y) * cityBox(R.x, R.z, pl.x, pw.x) * (1.0 - cityBox(bayW * 0.4, bayW * 0.6, pl.x, pw.x));
    extraK = max(extraK, riser);
    extraAlb = vec3(0.05, 0.11, 0.065);
    float pil = 1.0 - cityBox(0.12, bayW - 0.12, pl.x, pw.x);
    trim = max(trim, pil);
  }
  // Doors: the opening runs down to the pavement.
  if (door > 0.5) {
    vec4 Rd = cSt == ST_COLSHOP ? vec4(bayW * 0.4, 0.02, bayW * 0.6, R.w) : vec4(bayW * 0.56, 0.02, bayW * 0.9, R.w);
    float dk = cityRect(Rd, pl, pw);
    open0 = max(open0, dk);
    vec2 qd = pl + vts.xy * (revD / vts.z);
    inGl = max(inGl, cityRect(Rd, qd, pw) * dk);
    reveal = open0 * (1.0 - inGl);
  }

  // Glass plane: frames, mullions, transoms.
  float fw = SA.y;
  vec4 Ri = R + vec4(fw, fw, -fw, -fw);
  float frameK = 1.0 - cityRect(Ri, q, pw);
  float nm = SA.z;
  if (SC.x > 0.5) {
    float sp = bayW / max(nm, 1.0);
    float xm = (q.x + pairOff) / sp;
    frameK = max(frameK, cityBar(abs(xm - floor(xm + 0.5)) * sp, fw * 0.5, pw.x));
  } else if (nm > 0.5) {
    float sp = (R.z - R.x) / (nm + 1.0);
    float xm = (q.x - R.x) / sp;
    frameK = max(frameK, cityBar(abs(xm - floor(xm + 0.5)) * sp, fw * 0.5, pw.x));
  }
  if (SA.w > 0.0) {
    float ty = R.w - (R.w - R.y) * SA.w;
    frameK = max(frameK, cityBar(abs(q.y - ty), fw * 0.5, pw.y));
  }
  if (cSt == ST_SHOP) frameK = max(frameK, cityBar(abs(q.y - 2.35), fw * 0.5, pw.y));
  if (cSt == ST_CURTAIN) frameK = max(frameK, cityBar(abs(q.y - fh * 0.02), fw * 0.5, pw.y));
  frameK = clamp(frameK, 0.0, 1.0);
  float glassK = open0 * inGl * (1.0 - frameK);
  float frameVis = open0 * inGl * frameK;

  // Per-room choices.
  float roomBays = SB.z;
  float roomIdx = floor(cell.x / roomBays);
  float rh = cityHash(vec2(roomIdx * 1.37 + cSeed * 0.311, cell.y * 2.113 + cSeed * 0.07));
  float rh2 = cityHash(vec2(rh * 91.7 + cell.y, roomIdx + 7.0));
  float rh3 = cityHash(vec2(rh2 * 53.1, cSeed + roomIdx * 0.5));
  float cellId;
  if (cCls > 1.5 && cCls < 2.5) {
    cellId = cExtra > 0.5 ? cExtra - 1.0 : (rh < 0.12 ? 7.0 : 4.0 + floor(rh3 * 2.999));
  } else if (cCls > 0.5 && cCls < 1.5) {
    cellId = rh < 0.5 ? 2.0 : 3.0;
  } else {
    cellId = rh < 0.45 ? 0.0 : (rh < 0.88 ? 1.0 : 7.0);
  }
  if (cSt == ST_LOBBY) cellId = 0.0;
  // Night lighting (some buildings busy, most offices dark, homes and hotels lit).
  float isRes = step(0.5, cCls) * (1.0 - step(1.5, cCls));
  float isShopC = step(1.5, cCls) * (1.0 - step(2.5, cCls));
  float bldBusy = cityHash(vec2(cSeed, 1.7));
  float litFrac = mix(mix(0.16, 0.45, isRes), 0.62, isShopC) * (1.0 - step(3.5, cCls)) * smoothstep(0.1, 0.55, bldBusy) * 1.4;
  float lit = step(rh2, litFrac) * step(0.02, rh);
  // Shop shutters (more at night; never on the door bay of an open shop).
  float shut = (cSt == ST_SHOP) ? step(bayHash * 0.9 + rh3 * 0.1, uShutterFrac) : 0.0;
  if (shut > 0.5) lit = 0.0;

  // Glass: grime layer, tint, reflectance, a slight per-pane tilt so reflections break up.
  vec4 gA = textureGrad(pbrA, vec3(cPlan / 3.0, M_GLASS), cPlanDx / 3.0, cPlanDy / 3.0);
#ifdef CITY_NORMALS
  vec4 gB = textureGrad(pbrB, vec3(cPlan / 3.0, M_GLASS), cPlanDx / 3.0, cPlanDy / 3.0);
#else
  vec4 gB = vec4(0.5, 0.5, 1.0, 0.0);
#endif
  float grime = clamp((gA.a - 0.04) / 0.36, 0.0, 1.0);
  vec4 GL = GLASS[int(cGp + 0.5)];
  float paneId = cell.x * 3.7 + cell.y * 17.1 + floor((q.x + pairOff) / max(bayW / 2.0, 0.5));
  vec2 tilt = (vec2(cityHash(vec2(paneId, cSeed)), cityHash(vec2(cSeed, paneId))) - 0.5) * 0.035;
  vec3 gN = normalize(vec3(tilt + (gB.xy * 2.0 - 1.0) * 0.12, 1.0));
  float cosT = clamp(vts.z, 0.0, 1.0);
  float Fr = GL.w + (1.0 - GL.w) * pow(1.0 - cosT, 5.0);

  // Room behind the glass.
  vec3 roomCol = vec3(0.0);
#ifdef CITY_INTERIORS
  if (glassK > 0.001 && lod < 0.999 && cVert > 0.5) {
    float roomW = roomBays * bayW;
    vec2 ruv = vec2((mod(cell.x, roomBays) * bayW + q.x + pairOff) / roomW, q.y / fh);
    float depthM = SB.w * roomW * (shop ? 1.0 : (0.8 + 0.5 * rh3));
    vec3 rd = vec3(vts.x / roomW, vts.y / fh, vts.z / depthM);
    vec2 gx = vec2(fdU.x / roomBays, fdV.x);
    vec2 gy = vec2(fdU.y / roomBays, fdV.y);
    roomCol = cityInterior(ruv, rd, cellId, step(0.5, rh2), gx, gy);
  }
#else
  roomCol = vec3(0.18, 0.16, 0.14);
#endif
  float dayVar = mix(0.35, 1.1, rh3) * (shop ? 0.85 : 1.0);
  float roomLight = mix(dayVar, mix(uInterior.y, 1.0 + (shop ? 0.6 : 0.0), lit), uNight);
  // Blinds and curtains (not in shops).
  float blind = 0.0;
  vec3 blindCol = vec3(0.0);
  if (!shop) {
    float amt = rh3 < 0.35 ? (0.25 + 0.7 * fract(rh3 * 7.3)) : 0.0;
    float by = R.w - (R.w - R.y) * amt;
    blind = step(by, q.y) * step(0.001, amt);
    float slat = 0.8 + 0.2 * step(0.5, fract(q.y * 18.0));
    blindCol = (isRes > 0.5 ? vec3(0.62, 0.45, 0.32) : vec3(0.72, 0.7, 0.64)) * slat;
    if (isRes > 0.5) {
      float cw = (R.z - R.x) * 0.22;
      float curt = max(cityBox(R.x, R.x + cw, q.x, pw.x), cityBox(R.z - cw, R.z, q.x, pw.x)) * step(0.4, rh2);
      blind = max(blind, curt);
      blindCol = mix(blindCol, vec3(0.5 + 0.4 * rh, 0.35 + 0.3 * rh2, 0.28 + 0.3 * rh3) * 0.7, curt);
    }
  }
  vec3 warm = vec3(1.0, 0.64, 0.33);
  vec3 cool = vec3(0.92, 0.9, 0.8);
  vec3 winCol = mix(cool, warm, clamp(isRes + isShopC * 0.6 + step(0.7, rh3) * 0.6, 0.0, 1.0));
  vec3 inside = mix(roomCol, blindCol * (0.35 + 0.4 * uInterior.z), blind);
  vec3 glassEmit = inside * GL.rgb * (1.0 - Fr) * (1.0 - 0.5 * grime) * uInterior.x * roomLight;
  glassEmit += winCol * lit * uNight * 0.12 * (1.0 - Fr);

  // Roll-down shutter over the shop window.
  vec3 shutAlb = vec3(0.0);
  float shutK = 0.0;
  if (shut > 0.5) {
    vec2 shS = PBR_INFO[int(M_SHUTTER)].xy;
    vec4 sA = textureGrad(pbrA, vec3(p * shS, M_SHUTTER), cPlanDx * shS, cPlanDy * shS);
    shutAlb = cityAlbedo(sA, M_SHUTTER, mix(vec3(0.55, 0.57, 0.58), cTint * 0.8, 0.3));
    shutK = open0;
    glassK *= 1.0 - shutK;
    frameVis *= 1.0 - shutK;
    reveal *= 1.0 - shutK;
  }

  // Reveal (jamb) surfaces: which side the view ray hit.
  vec2 over = vec2(max(R.x - q.x, q.x - R.z), max(R.y - q.y, q.y - R.w));
  vec3 jambN;
  if (over.x > over.y) jambN = q.x < R.x ? Tu : -Tu;
  else jambN = q.y < R.y ? vec3(0.0, 1.0, 0.0) : vec3(0.0, -1.0, 0.0);
  // Sun into the recess: trace from the glass plane back out towards the light.
  float sunIn = 1.0;
  if (lts.z > 0.02) {
    vec2 qs = q + lts.xy * (revD / lts.z);
    sunIn = cityRect(R, qs, pw * 2.0 + 0.02);
  } else {
    sunIn = 0.0;
  }
  float edgeAO = smoothstep(0.0, 0.35, min(min(q.x - R.x, R.z - q.x), min(q.y - R.y, R.w - q.y)) + 0.03);

  // Compose (detail).
  vec3 alb = wallAlb;
  float rough = cA.a;
  float metal = 0.0;
  vec3 nW = sNw;
  alb = mix(alb, cityAlbedo(accA, accMat, cTint * 0.9), accentK);
  alb = mix(alb, trimAlb, trim);
  nW = normalize(nW + cN * 0.0 + vec3(0.0, 1.0, 0.0) * bevel * 0.8);
  alb = mix(alb, extraAlb, extraK);
  nW = normalize(mix(nW, cTBN * extraN, extraK));
  rough = mix(rough, 0.55, extraK);
  // Curtain-wall spandrels are opaque glass, not wall.
  float spandrel = SC.y * (1.0 - open0);
  // Reveal.
  alb = mix(alb, wallAlb * 0.9, reveal);
  nW = normalize(mix(nW, jambN, reveal));
  float aoRev = mix(1.0, 0.72, reveal);
  // Frames.
  alb = mix(alb, frameCol, frameVis);
  rough = mix(rough, 0.45, frameVis);
  metal = mix(metal, 0.5, frameVis);
  // Shutter.
  alb = mix(alb, shutAlb, shutK);
  // Glass.
  float gk = clamp(glassK + spandrel, 0.0, 1.0);
  vec3 glassAlb = mix(vec3(0.02, 0.022, 0.024), gA.rgb * 0.45, grime);
  alb = mix(alb, glassAlb, gk);
  rough = mix(rough, mix(0.04, 0.3, grime), gk);
  metal = mix(metal, 0.0, gk);
  nW = normalize(mix(nW, cN * gN.z + Tu * gN.x + vec3(0.0, 1.0, 0.0) * gN.y, gk));
  vec3 f0 = mix(vec3(0.04), GL.w * mix(vec3(1.0), GL.rgb * 1.3, 0.6), gk);
  sEmit = glassEmit * glassK;
  sEmit += vec3(0.02, 0.022, 0.025) * spandrel * uInterior.x * (1.0 - uNight);
  float inRecess = clamp(glassK + frameVis + reveal + shutK * 0.0, 0.0, 1.0);
  sSun = mix(1.0, sunIn, inRecess * (1.0 - shutK));
  float ao = aoK * aoRev * mix(1.0, mix(0.7, 1.0, edgeAO), clamp(glassK + frameVis, 0.0, 1.0));

  // Far away: the average of the bay, keeping each window's lit state (city lights from afar).
  float winFrac = hasWin * clamp((min(R.z, halfW) - max(R.x, 0.0)) * (min(R.w, fh) - max(R.y, 0.0)) / (halfW * fh), 0.0, 1.0);
  if (cSt == ST_CURTAIN) winFrac = 0.85;
  vec3 farAlb = mix(mix(wallAlb, trimAlb, 0.12), vec3(0.03), winFrac * 0.85);
  sAlb = mix(alb, farAlb, lod);
  sRough = mix(rough, mix(cA.a, 0.12, winFrac), lod);
  sMetal = mix(metal, 0.0, lod);
  sF0 = mix(f0, mix(vec3(0.04), GL.w * mix(vec3(1.0), GL.rgb * 1.3, 0.6), winFrac), lod);
  sGlass = mix(gk, winFrac, lod);
  vec3 farEmit = (vec3(0.16, 0.15, 0.13) * GL.rgb * dayVar * uInterior.x * (1.0 - uNight) + winCol * lit * uNight * 0.55 * uInterior.x) * winFrac * (1.0 - shut);
  sEmit = mix(sEmit, farEmit, lod);
  sNw = normalize(mix(nW, cN, lod));
  sSun = mix(sSun, 1.0, lod);
  sAO *= mix(ao, 1.0, lod);
  // Street dust and splash at the foot of walls.
  sAlb *= mix(0.78, 1.0, smoothstep(0.0, 1.6 + cNz2.r, vWPos.y - 0.0 * cNz.b)) ;
} else {
  // ---------------------------------------------------------------- canvas layer
  vec4 fTex = textureGrad(facadeMap, vec3(vFacUv, cLayer), vec2(fdU.x, fdV.x), vec2(fdU.y, fdV.y));
  float isFacade = 1.0 - step(0.5, cKind);
  float fGlass = isFacade * smoothstep(0.44, 0.6, fTex.a);
  vec3 base = fTex.rgb * cTint;
  if (cHasPbr) {
    // Painted artwork with the detail (normal, roughness, texture) of a real material.
    float l = dot(cA.rgb / PBR_AVG[cMi], vec3(0.33));
    base *= mix(1.0, l, 0.6);
  } else {
    sNw = cN;
    sRough = 0.8;
    sMetal = 0.0;
    sAO = 1.0;
  }
  vec4 GL = GLASS[int(cGp + 0.5)];
  vec3 V = normalize(vWPos - cameraPosition);
  float cosT = clamp(-dot(V, cN), 0.0, 1.0);
  float Fr = GL.w + (1.0 - GL.w) * pow(1.0 - cosT, 5.0);
  float r1 = cityHash(floor(vFacUv + 1e-3) * vec2(1.0, 1.73) + cSeed * 0.137);
  float r2 = cityHash(floor(vFacUv + 1e-3).yx * 1.31 + cSeed * 0.43 + 11.0);
  sAlb = mix(base * mix(0.9, 1.05, cNz.r), fTex.rgb * GL.rgb * 0.12, fGlass);
  sRough = mix(sRough, 0.06, fGlass);
  sF0 = mix(vec3(0.04), vec3(max(GL.w, 0.08)), fGlass);
  sGlass = fGlass;
  sNw = normalize(mix(sNw, cN, fGlass));
  // Windows light up at night (as the analytic facades do).
  float isRes = step(0.5, cCls) * (1.0 - step(1.5, cCls));
  float isShopC = step(1.5, cCls) * (1.0 - step(2.5, cCls));
  float bldBusy = cityHash(vec2(cSeed, 1.7));
  float litFrac = mix(mix(0.16, 0.45, isRes), 0.6, isShopC) * (1.0 - step(3.5, cCls)) * smoothstep(0.1, 0.55, bldBusy) * 1.4;
  float lit = step(r2, litFrac) * step(0.02, r1);
  vec3 winCol = mix(vec3(0.9, 0.88, 0.78), vec3(1.0, 0.62, 0.3), clamp(isRes + isShopC * 0.7, 0.0, 1.0));
  sEmit += fGlass * (fTex.rgb * GL.rgb * 0.25 * uInterior.x * (1.0 - uNight) + winCol * lit * uNight * (0.45 + 0.75 * r1) * 0.9) * (1.0 - Fr);
  float isSign = step(0.5, cKind) * (1.0 - step(1.5, cKind));
  float signLit = step(0.25, cityHash(vec2(cSeed, 3.0)));
  sEmit += fTex.rgb * isSign * signLit * uNight * 0.9;
  float isLamp = step(2.5, cKind) * (1.0 - step(3.5, cKind));
  sEmit += vec3(1.0, 0.7, 0.38) * isLamp * uNight * 5.0;
  float isPanel = step(3.5, cKind) * (1.0 - step(4.5, cKind));
  sEmit += fTex.rgb * cTint * isPanel * uNight * 1.4;
  sAlb *= mix(0.8, 1.0, smoothstep(0.0, 1.8, vWPos.y));
}
if (cIsVirtual) {
  sAlb *= mix(0.84, 1.0, smoothstep(0.0, 1.2, vWPos.y));
}
// Sunlight bounced off the pavement lights canopy soffits and eaves from below.
sEmit += sAlb * uBounce * smoothstep(0.2, 1.0, -cN.y) * sAO;
diffuseColor.rgb = sAlb;
`;

// Injected after <lights_fragment_maps>: in the city's street canyons, low reflections see the
// buildings across the street (a lit or shaded facade with rows of windows), not open sky, and
// street-level walls see less of the sky.
export const FACADE_CANYON = /* glsl */ `
#if defined( USE_ENVMAP )
{
  vec3 Vw = normalize(vWPos - cameraPosition);
  vec3 Rw = reflect(Vw, sNw);
  float rh = length(Rw.xz);
  float street = 22.0;
  float hitY = cYRel + street * Rw.y / max(rh, 1e-3);
  float inCanyon = smoothstep(-0.5, 0.5, hitY) * (1.0 - smoothstep(cCanyonH - 3.0, cCanyonH + 3.0, hitY)) * smoothstep(0.15, 0.35, rh) * cVert;
  if (inCanyon > 0.001) {
    vec2 hitXZ = vWPos.xz + Rw.xz / max(rh, 1e-3) * street;
    vec4 nz = texture(noiseMap, hitXZ * 0.021);
    vec3 nOpp = vec3(-Rw.x, 0.0, -Rw.z) / max(rh, 1e-3);
    float litK = max(0.0, dot(nOpp, uSunDir));
    vec3 wallC = mix(vec3(0.34, 0.31, 0.27), vec3(0.45, 0.43, 0.4), nz.r) * (uCanyonShade + uCanyonLit * litK);
    float fl = fract(hitY / 3.4);
    float win = smoothstep(0.28, 0.34, fl) * (1.0 - smoothstep(0.78, 0.84, fl)) * step(0.3, nz.g);
    float litWin = step(0.72, fract(sin(dot(floor(vec2(hitXZ.x + hitXZ.y, hitY / 3.4)), vec2(12.9898, 78.233))) * 43758.5453));
    vec3 winC = mix(wallC * 0.25 + uCanyonShade * 0.15, vec3(1.0, 0.7, 0.4) * 0.35 * litWin, uNight);
    vec3 canyon = mix(wallC, winC, win);
    // Street level across the road: shaded shopfronts under their canopies, lit displays at night.
    float bay = fract((hitXZ.x - hitXZ.y) * 0.21);
    vec3 shopC = uCanyonShade * mix(0.35, 0.8, step(0.55, bay) * nz.b) + vec3(1.0, 0.8, 0.55) * 0.3 * uNight * step(0.4, nz.g);
    float fascia = smoothstep(3.0, 3.1, hitY) * (1.0 - smoothstep(3.5, 3.6, hitY));
    canyon = mix(canyon, shopC, 1.0 - smoothstep(3.0, 3.1, hitY));
    canyon = mix(canyon, wallC * 1.1, fascia);
    radiance = mix(radiance, canyon, inCanyon * 0.9);
  }
  iblIrradiance *= mix(0.72, 1.0, smoothstep(0.0, cCanyonH, cYRel)) * mix(1.0, 0.85, cVert * (1.0 - smoothstep(0.0, cCanyonH, cYRel)));
}
#endif
`;
