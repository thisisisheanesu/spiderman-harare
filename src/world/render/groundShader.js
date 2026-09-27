import { GLSL_HELPERS } from './facadeShader.js';

// GLSL for the city ground material (roads, pavements, kerbs, parks, verges, the Kopje).
// Ground layer codes (vertex facade byte 0, see groundTextures.js): 0..63 = index into the ground
// PBR set, 64.. = canvas layer 64 + i (rail ballast, Kopje rock, flower beds), PAINT = road paint
// over asphalt. Kinds: 0 surface, 1 base ground (urban mask: paved core / dry veld), 2 hillside
// (dry grass / rock by vertex alpha), 3 road paint.

const f = (x) => {
  const s = Number(x).toFixed(5);
  return s.includes('.') ? s : `${s}.0`;
};
const v3 = (a) => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;
const v4 = (a) => `vec4(${f(a[0])}, ${f(a[1])}, ${f(a[2])}, ${f(a[3])})`;

export const GROUND_CANVAS_BASE = 64;
export const GROUND_PAINT = 120;

export function groundFragmentDecl(set, G, { normals }) {
  const N = set.count;
  const info = [];
  const avg = [];
  for (let i = 0; i < N; i++) {
    info.push(v4(set.info.subarray(i * 4, i * 4 + 4)));
    avg.push(v3([Math.max(0.02, set.avg[i * 3]), Math.max(0.02, set.avg[i * 3 + 1]), Math.max(0.02, set.avg[i * 3 + 2])]));
  }
  const id = (n) => f(set.id(n));
  return /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray groundMap;
uniform sampler2DArray gPbrA;
${normals ? 'uniform sampler2DArray gPbrB;' : ''}
uniform sampler2D noiseMap;
uniform sampler2D urbanMap;
uniform vec4 urbanRect;
uniform float uNight;
varying vec4 vFac;
varying vec4 vPbr;
varying vec2 vFacUv;
varying vec3 vWPos;
varying vec3 vWNrm;
#define NG ${N}
#define G_ASPHALT ${id('asphalt_bleached')}
#define G_PATCH ${id('asphalt_patch')}
#define G_CRACK ${id('asphalt_cracked')}
#define G_SLABS ${id('pavement_slabs')}
#define G_DRY ${id('grass_dry')}
#define G_PATCHY ${id('grass_patchy')}
#define G_GREEN ${id('grass_green')}
#define G_SOIL ${id('soil_red')}
#define G_HERRING ${id('pavers_herringbone_red')}
#define G_ROCK ${f(G.rock)}
#define G_CANVAS ${f(GROUND_CANVAS_BASE)}
#define G_PAINT ${f(GROUND_PAINT)}
${normals ? '#define CITY_NORMALS' : ''}
${set.compressed ? '#define CITY_BC5' : ''}
const vec4 G_INFO[NG] = vec4[NG](${info.join(', ')});
const vec3 G_AVG[NG] = vec3[NG](${avg.join(', ')});
${GLSL_HELPERS}

struct GSample { vec4 a; vec4 b; };
GSample gSample(float layer, vec2 m, vec2 mdx, vec2 mdy) {
  vec2 s = G_INFO[int(layer + 0.5)].xy;
  GSample o;
  o.a = textureGrad(gPbrA, vec3(m * s, layer), mdx * s, mdy * s);
#ifdef CITY_NORMALS
  o.b = textureGrad(gPbrB, vec3(m * s, layer), mdx * s, mdy * s);
#else
  o.b = vec4(0.5, 0.5, 1.0, 0.0);
#endif
#ifdef CITY_BC5
  o.b.ba = vec2(1.0, 0.0);
#endif
  return o;
}
GSample gMix(GSample x, GSample y, float t) {
  GSample o;
  o.a = mix(x.a, y.a, t);
  o.b = mix(x.b, y.b, t);
  return o;
}
`;
}

export const GROUND_MAIN = /* glsl */ `
diffuseColor.a = 1.0;
vec3 gTint = vColor.rgb;
float gKind = floor(mod(vFac.z + 0.5, 8.0));
float gLayer = floor(vFac.x + 0.5);
float gFlags = floor(vPbr.w + 0.5);
float gUvMode = mod(gFlags, 4.0);
vec3 gN = normalize(vWNrm);
bool gHoriz = abs(gN.y) > 0.7;
vec2 gPlan = vec2(vWPos.x, -vWPos.z);
vec2 gM = (gHoriz && gUvMode < 0.5) ? gPlan : vFacUv;
vec2 gMdx = dFdx(gM);
vec2 gMdy = dFdy(gM);
vec2 gPdx = dFdx(gPlan);
vec2 gPdy = dFdy(gPlan);
mat3 gTBN = cityTBN(gN, vWPos, gM);
vec4 gNz = texture(noiseMap, vWPos.xz * 0.0059);
vec4 gNz2 = texture(noiseMap, vWPos.xz * 0.031 + 0.37);
vec4 gNz3 = texture(noiseMap, vWPos.xz * 0.17 + 0.71);
bool gPaint = gKind > 2.5 || abs(gLayer - G_PAINT) < 0.5;
float gPbrLayer = gLayer < G_CANVAS - 0.5 ? gLayer : (gPaint ? G_ASPHALT : G_DRY);
GSample gS = gSample(gPbrLayer, gM, gMdx, gMdy);
vec4 gC = textureGrad(groundMap, vec3(vFacUv, max(gLayer - G_CANVAS, 0.0)), dFdx(vFacUv), dFdy(vFacUv));

vec3 sAlb;
float sRough = 0.9;
float sMetal = 0.0;
float sAO = 1.0;
vec3 sNw = gN;
vec3 sEmit = vec3(0.0);
vec3 sF0 = vec3(0.04);
float sGlass = 0.0;
float sSun = 1.0;
float gNormalK = 1.0;

if (gPaint || abs(gPbrLayer - G_ASPHALT) < 0.5) {
  // Sun-bleached asphalt with dark repair patches and worn, cracked stretches.
  GSample a = gSample(G_ASPHALT, gPlan, gPdx, gPdy);
  float patchM = smoothstep(0.6, 0.64, gNz2.g * 0.8 + gNz3.r * 0.35);
  GSample pa = gSample(G_PATCH, gPlan, gPdx, gPdy);
  float crackM = smoothstep(0.5, 0.68, gNz.b + (gNz3.g - 0.5) * 0.3);
  GSample cr = gSample(G_CRACK, gPlan, gPdx, gPdy);
  a = gMix(a, cr, crackM * 0.85);
  a = gMix(a, pa, patchM);
  vec3 alb = a.a.rgb * (gPaint ? vec3(1.0) : gTint);
  // Oil and tyre grime in broad blotches; sun-bleached lighter areas.
  alb *= mix(0.84, 1.08, gNz.r) * mix(0.9, 1.04, gNz2.b);
  gS = a;
  sAlb = alb;
  if (gPaint) {
    // Road paint over the asphalt, worn through by traffic.
    float wear = smoothstep(0.3, 0.55, gNz3.b * 0.7 + gNz2.a * 0.5 + gS.a.r * 0.4);
    float cov = mix(0.35, 1.0, wear);
    vec3 paintCol = gTint * mix(0.78, 0.92, gNz3.a);
    sAlb = mix(alb, paintCol * mix(1.0, a.a.r / max(G_AVG[int(G_ASPHALT)].r, 0.05), 0.25), cov);
    gS.a.a = mix(gS.a.a, 0.55, cov);
    gNormalK = mix(1.0, 0.4, cov);
  }
} else if (gKind > 1.5 && gKind < 2.5) {
  // The Kopje: dry grass, red earth and granite outcrops.
  GSample dry = gSample(G_DRY, gPlan, gPdx, gPdy);
  GSample soil = gSample(G_SOIL, gPlan, gPdx, gPdy);
  float soilM = smoothstep(0.45, 0.7, gNz2.r + (gNz3.b - 0.5) * 0.4);
  vec4 rock = textureGrad(groundMap, vec3(vWPos.xz / 7.0, G_ROCK - G_CANVAS), dFdx(vWPos.xz / 7.0), dFdy(vWPos.xz / 7.0));
  float rockM = smoothstep(0.3, 0.7, vColor.a + (gNz2.r - 0.5) * 0.3);
  gS = gMix(dry, soil, soilM * 0.6);
  sAlb = mix(gS.a.rgb * mix(vec3(1.0), gTint, 0.5), rock.rgb * 1.05, rockM);
  gS.a.a = mix(gS.a.a, 0.75, rockM);
  gNormalK = 1.0 - rockM;
} else if (gKind > 0.5 && gKind < 1.5) {
  // Base ground under everything: paved in the city core, dry veld and red earth outside.
  vec2 uvU = (vWPos.xz - urbanRect.xy) / urbanRect.zw;
  float urban = texture(urbanMap, uvU).r;
  urban = smoothstep(0.2, 0.8, urban + (gNz2.r - 0.5) * 0.5);
  GSample pave = gSample(G_SLABS, gPlan, gPdx, gPdy);
  GSample dry = gSample(G_DRY, gPlan, gPdx, gPdy);
  GSample soil = gSample(G_SOIL, gPlan, gPdx, gPdy);
  GSample wild = gMix(dry, soil, smoothstep(0.42, 0.7, gNz.g + (gNz2.b - 0.5) * 0.45));
  gS = gMix(wild, pave, urban);
  sAlb = gS.a.rgb * mix(vec3(0.95, 0.93, 0.9), vec3(1.0), 1.0 - urban) * gTint;
  sAlb *= mix(0.86, 1.08, gNz.r);
} else if (gLayer > G_CANVAS - 0.5) {
  // Painted canvas layers (rail ballast with sleepers, flower beds, rock).
  sAlb = gC.rgb * gTint * mix(0.9, 1.06, gNz2.r);
  gS.a.a = 0.85;
  gNormalK = 0.0;
} else {
  vec3 alb = gS.a.rgb * gTint;
  if (abs(gLayer - G_GREEN) < 0.5 || abs(gLayer - G_DRY) < 0.5) {
    // Lawns go patchy and dry at the edges of the watering.
    GSample other = gSample(abs(gLayer - G_GREEN) < 0.5 ? G_PATCHY : G_SOIL, gM, gMdx, gMdy);
    float m = smoothstep(0.55, 0.75, gNz2.g + (gNz3.r - 0.5) * 0.35);
    gS = gMix(gS, other, m * 0.8);
    alb = gS.a.rgb * gTint;
  }
  if (abs(gLayer - G_HERRING) < 0.5 && gUvMode > 0.5) {
    // First Street Mall: grey concrete bands divide the terracotta pavers into ~6 m squares.
    vec2 cellM = abs(fract(vFacUv / 6.0 + 0.5) - 0.5) * 6.0;
    float band = max(cityBar(cellM.x, 0.22, length(gMdx) + length(gMdy)), cityBar(cellM.y, 0.22, length(gMdx) + length(gMdy)));
    GSample sl = gSample(G_SLABS, gM, gMdx, gMdy);
    gS = gMix(gS, sl, band);
    alb = mix(alb, sl.a.rgb * vec3(0.95, 0.93, 0.9), band);
  }
  sAlb = alb * mix(0.88, 1.07, gNz.r) * mix(0.94, 1.04, gNz2.g);
}
sRough = gS.a.a;
sAO = mix(1.0, gS.b.b, 0.8);
sNw = normalize(gTBN * cityUnpackNormal(gS.b.xy, gNormalK));
// Night: surfaces read a little darker and cooler under sodium-free LED streets.
diffuseColor.rgb = sAlb;
`;
