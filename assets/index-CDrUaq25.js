const ae=`#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`,Ct=`#version 300 es
in vec2 aPos;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uPad;
out vec2 vUV;
void main() {
  vec2 half2 = uHalf + uPad;
  vec2 px = uCenter + (aPos * 2.0 - 1.0) * half2;
  vUV = px / uRes;
  gl_Position = vec4(px / uRes * 2.0 - 1.0, 0.0, 1.0);
}`,Bt=`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             12.92 * c,
             lessThanEqual(c, vec3(0.0031308)));
}
void main() { outColor = vec4(linearToSrgb(texture(uTex, vUV).rgb), 1.0); }`,Dt=`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;   // texel size of the SOURCE level
out vec4 outColor;
void main() {
  vec2 t = uTexel;
  vec4 a = texture(uTex, vUV) * 0.125;
  vec4 b = (texture(uTex, vUV + vec2(-t.x, -t.y)) +
            texture(uTex, vUV + vec2( t.x, -t.y)) +
            texture(uTex, vUV + vec2(-t.x,  t.y)) +
            texture(uTex, vUV + vec2( t.x,  t.y))) * 0.125;
  vec4 c = (texture(uTex, vUV + vec2(-2.0 * t.x, 0.0)) +
            texture(uTex, vUV + vec2( 2.0 * t.x, 0.0)) +
            texture(uTex, vUV + vec2(0.0, -2.0 * t.y)) +
            texture(uTex, vUV + vec2(0.0,  2.0 * t.y))) * 0.0625;
  vec4 d = (texture(uTex, vUV + vec2(-2.0 * t.x, -2.0 * t.y)) +
            texture(uTex, vUV + vec2( 2.0 * t.x, -2.0 * t.y)) +
            texture(uTex, vUV + vec2(-2.0 * t.x,  2.0 * t.y)) +
            texture(uTex, vUV + vec2( 2.0 * t.x,  2.0 * t.y))) * 0.03125;
  // RGB stores radiance. Alpha stores normalized optical density, so the mip
  // chain can blur both representations with exactly the same footprint.
  outColor = a + b + c + d;
}`,Pt=`#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uLow;
uniform sampler2D uHigh;
uniform vec2 uLowTexel;
out vec4 outColor;
void main() {
  vec2 t = uLowTexel;
  vec4 low = texture(uLow, vUV) * 4.0;
  low += (texture(uLow, vUV + vec2( t.x, 0.0)) +
          texture(uLow, vUV + vec2(-t.x, 0.0)) +
          texture(uLow, vUV + vec2(0.0,  t.y)) +
          texture(uLow, vUV + vec2(0.0, -t.y))) * 2.0;
  low += texture(uLow, vUV + vec2( t.x,  t.y)) +
         texture(uLow, vUV + vec2(-t.x,  t.y)) +
         texture(uLow, vUV + vec2( t.x, -t.y)) +
         texture(uLow, vUV + vec2(-t.x, -t.y));
  low *= 1.0 / 16.0;
  vec4 high = texture(uHigh, vUV);
  outColor = mix(high, low, 0.65);
}`,_t=`#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
uniform int uScene;
uniform float uZoom;
uniform sampler2D uWallpaper;
uniform int uUseImage;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  vec3 low = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; }
  return s;
}
// distance to a quadratic bezier (iterative, good enough for a backdrop)
float sdBezier(vec2 p, vec2 a, vec2 b, vec2 c) {
  float best = 1e9;
  vec2 prev = a;
  for (int i = 1; i <= 40; i++) {
    float t = float(i) / 40.0;
    vec2 q = mix(mix(a, b, t), mix(b, c, t), t);
    vec2 pa = p - prev, ba = q - prev;
    float u = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
    best = min(best, length(pa - ba * u));
    prev = q;
  }
  return best;
}

vec3 sunsetBranches(vec2 uv) {
  // dusk gradient: cool grey-mauve at the top, warm amber near the horizon
  vec3 top = vec3(0.62, 0.55, 0.55);
  vec3 mid = vec3(0.85, 0.63, 0.53);
  vec3 low = vec3(0.94, 0.70, 0.52);
  vec3 col = mix(mid, top, smoothstep(0.45, 1.0, uv.y));
  col = mix(col, low, smoothstep(0.45, 0.0, uv.y));
  col += (fbm(uv * 3.0) - 0.5) * 0.05;

  vec2 p = uv * vec2(uRes.x / uRes.y, 1.0);
  float sc = uRes.x / uRes.y;
  vec3 bark = vec3(0.17, 0.10, 0.09);
  // main trunk + a few branches, thick and dark like the reference photo
  float d = sdBezier(p, vec2(0.42 * sc, -0.1), vec2(0.52 * sc, 0.45), vec2(0.36 * sc, 1.1));
  float m = smoothstep(0.060, 0.040, d);
  d = sdBezier(p, vec2(0.40 * sc, 0.30), vec2(0.62 * sc, 0.44), vec2(0.95 * sc, 0.26));
  m = max(m, smoothstep(0.034, 0.020, d));
  d = sdBezier(p, vec2(0.44 * sc, 0.62), vec2(0.25 * sc, 0.80), vec2(0.05 * sc, 0.72));
  m = max(m, smoothstep(0.022, 0.010, d));
  d = sdBezier(p, vec2(0.46 * sc, 0.80), vec2(0.72 * sc, 0.95), vec2(1.05 * sc, 0.78));
  m = max(m, smoothstep(0.016, 0.007, d));
  d = sdBezier(p, vec2(0.12 * sc, -0.05), vec2(0.18 * sc, 0.5), vec2(0.06 * sc, 1.05));
  m = max(m, smoothstep(0.038, 0.022, d));
  // seed pods
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2((0.14 + 0.02 * fi) * sc, 0.30 + 0.26 * fi);
    m = max(m, smoothstep(0.035, 0.022, length((p - c) * vec2(1.0, 0.8))));
  }
  return mix(col, bark, m * 0.94);
}

vec3 deepBlueCity(vec2 uv) {
  vec3 col = mix(vec3(0.06, 0.14, 0.55), vec3(0.02, 0.06, 0.34), smoothstep(0.0, 1.0, uv.y));
  col += (fbm(uv * vec2(90.0, 90.0)) - 0.5) * 0.05;   // fabric-like dither
  // bright vertical tower strip
  float x = abs(uv.x - 0.5);
  float tower = smoothstep(0.035, 0.012, x) * smoothstep(0.02, 0.25, uv.y);
  col = mix(col, vec3(0.72, 0.58, 0.52), tower * 0.85);
  float glow = smoothstep(0.16, 0.0, x) * smoothstep(0.0, 0.5, uv.y) * 0.18;
  col += vec3(0.5, 0.42, 0.36) * glow;
  col = mix(col, vec3(0.10, 0.14, 0.26), smoothstep(0.16, 0.02, uv.y));
  return col;
}

vec3 islandOcean(vec2 uv) {
  float ar = uRes.x / uRes.y;
  vec3 deep = vec3(0.03, 0.26, 0.52);
  vec3 shallow = vec3(0.20, 0.74, 0.82);
  float waves = fbm(vec2(uv.x * ar * 6.0, uv.y * 22.0) + 3.0);
  vec3 col = mix(deep, shallow, smoothstep(0.30, 0.78, waves * 0.7 + uv.y * 0.5));

  vec2 p = (uv - vec2(0.5, 0.40)) * vec2(ar, 1.0);
  float isl = (fbm(p * 2.2 + 11.0) - 0.5) * 0.34;
  float d = length(p * vec2(0.62, 1.25)) - (0.42 + isl);
  // shallow reef ring around the land
  col = mix(col, vec3(0.42, 0.86, 0.86), smoothstep(0.14, 0.03, d) * 0.75);
  col = mix(col, vec3(0.94, 0.90, 0.72), smoothstep(0.035, 0.0, d));        // beach
  vec3 jungle = mix(vec3(0.04, 0.26, 0.09), vec3(0.24, 0.55, 0.20),
                    fbm(p * 9.0 + 5.0));
  col = mix(col, jungle, smoothstep(0.005, -0.02, d));                      // jungle
  return col;
}

vec2 coverUV(vec2 uv) {
  vec2 imageSize = vec2(textureSize(uWallpaper, 0));
  float imageAspect = imageSize.x / max(imageSize.y, 1.0);
  float viewportAspect = uRes.x / max(uRes.y, 1.0);
  vec2 p = uv;
  if (imageAspect > viewportAspect) {
    float crop = (imageAspect / viewportAspect - 1.0) * 0.5;
    p.x = p.x * (1.0 - 2.0 * crop) + crop;
  } else {
    float crop = (viewportAspect / imageAspect - 1.0) * 0.5;
    p.y = p.y * (1.0 - 2.0 * crop) + crop;
  }
  return clamp(p, vec2(0.001), vec2(0.999));
}

void main() {
  vec2 uv = (vUV - 0.5) / max(uZoom, 0.01) + 0.5;
  vec3 col;
  if (uUseImage == 1) {
    // Wallpaper textures are plain RGBA8 holding display/sRGB values; decode
    // to linear radiance here. They are uploaded top row first (no
    // UNPACK_FLIP_Y_WEBGL), so the lookup flips instead.
    vec2 wallpaperUV = coverUV(uv);
    wallpaperUV.y = 1.0 - wallpaperUV.y;
    col = srgbToLinear(texture(uWallpaper, wallpaperUV).rgb);
  } else {
    // Procedural palette constants are authored as display/sRGB colours. The
    // SRGB render target expects linear shader output and encodes it on write.
    col = srgbToLinear(uScene == 0 ? sunsetBranches(uv)
                       : uScene == 1 ? deepBlueCity(uv)
                                     : islandOcean(uv));
  }
  // Beer-Lambert representation of backdrop darkness. A value of 4 optical
  // density units already corresponds to ~1.8% transmission, enough for the
  // near-black branches while retaining useful precision in RGBA8.
  float lum = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.018);
  float density = clamp(-log(lum) / 4.0, 0.0, 1.0);
  outColor = vec4(col, density);
}`,Ft=`#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uSrc;      // blurred mip chain of the backdrop
uniform sampler2D uBlurSrc;  // tent-upsampled reconstruction chain
uniform vec2  uRes;
uniform vec2  uCenter;       // draw-group bounds centre, px (vertex quad only)
uniform vec2  uHalf;         // element half size, px
const int MAX_SHAPES = 16;
uniform int   uShapeCount;
uniform vec2  uShapeCenters[MAX_SHAPES];
uniform vec2  uShapeHalves[MAX_SHAPES];
uniform int   uShapeTypes[MAX_SHAPES]; // 0 square/rect, 1 capsule, 2 circle
uniform float uShapeRadii[MAX_SHAPES];
uniform float uMergeRadius;  // smooth-union reach, px
uniform float uSquircle;     // superellipse exponent (2 = circular corners)
uniform float uBevel;        // max width of the refracting rim, px
uniform float uHeight;       // max glass height / optical thickness, px
uniform float uSizeAdaptation;// 0 = absolute material lengths, 1 = fit small UI
uniform float uIOR;
uniform float uDispersion;
uniform float uBlurPlateau;  // blur radius in the middle, px
uniform float uBlurRim;      // blur radius at the rim, px
uniform float uOpticalDensity;// dark-detail preservation; 0 = linear radiance
uniform float uMips;         // number of levels in the blurred chain
uniform float uSpecular;
uniform float uSpecPower;
uniform float uHighlightAdapt;
uniform float uHighlightWidth;
uniform float uHighlightSharpness;
uniform float uHighlightBase;
uniform float uFresnel;
uniform float uSat;
uniform float uBright;
uniform float uTintAmount;
uniform vec3  uTintColor;
uniform float uTintAdapt;    // content-aware light/dark material polarity
uniform float uShadow;
uniform float uShadowSize;
uniform float uShadowOffset;
uniform vec2  uLightDir;
uniform float uEdgeLine;
uniform float uEdgeWidth;
uniform float uEdgeDark;
uniform float uRefractScale;
uniform float uMeniscus;     // 1 = concave meniscus rim, 0 = convex lens rim
uniform int   uDebug;        // 0 final, 1 thickness, 2 normals, 3 displacement

float sdSquircle(vec2 p, vec2 b, float r, float n) {
  vec2 q = abs(p) - b + r;
  vec2 m = max(q, 0.0) + 1e-5;
  float e = pow(pow(m.x, n) + pow(m.y, n), 1.0 / n);
  return min(max(q.x, q.y), 0.0) + e - r;
}

float sdPrimitive(vec2 p, vec2 halfSize, int shapeType, float radius) {
  if (shapeType == 2) {
    // Circle is invariant: layout cannot turn it into an ellipse.
    return length(p) - min(halfSize.x, halfSize.y);
  }
  if (shapeType == 1) {
    // Apple's capsule rule: end-cap radius is exactly half the short side.
    return sdSquircle(p, halfSize, min(halfSize.x, halfSize.y), 2.0);
  }
  // Square and rectangular folders share the same fixed-radius corner model;
  // only their bounding boxes differ. The default exponent is 2 per reference.
  return sdSquircle(p, halfSize, radius, max(uSquircle, 2.0));
}

// One distance field represents the complete component group. Because the
// normal is derived from this same field below, the meniscus, refraction and
// highlight bend continuously through the bridge instead of exposing two
// composited glass layers.
float sdAppleShape(vec2 px) {
  float nearest = 1e8;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    nearest = min(nearest, next);
  }

  if (uMergeRadius < 0.01) return nearest;

  // Global exponential smooth-min is associative and C-infinity. Pairwise
  // polynomial unions are only C1 and become order-dependent with 3+ shapes;
  // their curvature boundaries show up as diagonal tears under sharp glass
  // highlights. 0.36 matches the polynomial union's depth at equal distances.
  float scale = max(uMergeRadius * 0.36, 0.01);
  float sum = 0.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    sum += exp(-(next - nearest) / scale);
  }
  return nearest - scale * log(max(sum, 1e-6));
}

// Quintic tangent transition. Besides value and slope, its second derivative
// matches at both ends: f(0/1)=0/1, f'(0/1)=0/1, f''(0/1)=0. This lets a
// circular corner leave a straight side with zero curvature instead of the
// rounded-box SDF's abrupt 0 -> 1/r curvature jump.
float tangentTransition(float u) {
  return u * u * u * (6.0 - 8.0 * u + 3.0 * u * u);
}

vec2 primitiveOpticalGradient(vec2 p, vec2 halfSize,
                              int shapeType, float radius) {
  if (shapeType == 2) return normalize(p + 1e-6);

  float exponent = shapeType == 1 ? 2.0 : max(uSquircle, 2.0);
  float resolvedRadius = shapeType == 1
                       ? min(halfSize.x, halfSize.y) : radius;
  vec2 q = abs(p) - halfSize + resolvedRadius;
  vec2 direction;

  if (q.x > 0.0 && q.y > 0.0) {
    // Analytic Lp-corner normal. Exponents above 2 already approach the side
    // with zero curvature; blend out the circular-corner correction by n=3.
    vec2 lp = normalize(pow(q, vec2(exponent - 1.0)) + 1e-6);
    const float HALF_PI = 1.57079632679;
    const float TRANSITION_ANGLE = 0.43633231299; // 25 degrees at each tangent
    float angle = atan(q.y, q.x);
    float easedAngle = angle;
    if (angle < TRANSITION_ANGLE) {
      easedAngle = TRANSITION_ANGLE *
                   tangentTransition(angle / TRANSITION_ANGLE);
    } else if (angle > HALF_PI - TRANSITION_ANGLE) {
      float fromTop = (HALF_PI - angle) / TRANSITION_ANGLE;
      easedAngle = HALF_PI - TRANSITION_ANGLE *
                   tangentTransition(fromTop);
    }
    vec2 continuousCorner = vec2(cos(easedAngle), sin(easedAngle));
    float circularCorner = 1.0 - smoothstep(2.0, 3.0, exponent);
    direction = normalize(mix(lp, continuousCorner, circularCorner));
  } else if (q.x > q.y) {
    direction = vec2(1.0, 0.0);
  } else {
    direction = vec2(0.0, 1.0);
  }

  return direction * sign(p);
}

vec2 opticalGradient(vec2 px) {
  float nearest = 1e8;
  int nearestIndex = 0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    if (next < nearest) {
      nearest = next;
      nearestIndex = i;
    }
  }

  if (uMergeRadius < 0.01 || uShapeCount == 1) {
    return primitiveOpticalGradient(
      px - uShapeCenters[nearestIndex], uShapeHalves[nearestIndex],
      uShapeTypes[nearestIndex], uShapeRadii[nearestIndex]
    );
  }

  // The derivative of exponential smooth-min is the same weighted average of
  // the primitive derivatives. Reusing those weights keeps fused normals C2
  // through both a primitive's tangent and the union bridge.
  float scale = max(uMergeRadius * 0.36, 0.01);
  vec2 gradientSum = vec2(0.0);
  float weightSum = 0.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    vec2 local = px - uShapeCenters[i];
    float next = sdPrimitive(local, uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    float weight = exp(-(next - nearest) / scale);
    gradientSum += primitiveOpticalGradient(
      local, uShapeHalves[i], uShapeTypes[i], uShapeRadii[i]
    ) * weight;
    weightSum += weight;
  }
  return gradientSum / max(weightSum, 1e-6);
}

// Shading adaptation belongs to the primitive under this fragment, not to the
// bounds of the whole draw group. The latter changes whenever any component in
// a connected fusion group moves, making every highlight pulse in sympathy.
//
// Around a genuine smooth-union bridge, use the same exponential influence as
// the distance field so the material centre crosses continuously from one
// primitive to the next. Contributions too weak to affect the visible bridge
// are smoothly discarded; a nearby-but-separate component then has exactly no
// influence on this component's highlight or light/dark tint.
void localComponentMetrics(vec2 px, out vec2 componentCenter,
                           out float componentShortSide) {
  float nearest = 1e8;
  vec2 nearestCenter = uShapeCenters[0];
  float nearestShortSide = 1.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    if (next < nearest) {
      nearest = next;
      nearestCenter = uShapeCenters[i];
      nearestShortSide = 2.0 * min(uShapeHalves[i].x, uShapeHalves[i].y);
    }
  }

  componentCenter = nearestCenter;
  componentShortSide = nearestShortSide;
  if (uMergeRadius < 0.01 || uShapeCount == 1) return;

  float scale = max(uMergeRadius * 0.36, 0.01);
  vec2 centreSum = vec2(0.0);
  float shortSideSum = 0.0;
  float weightSum = 0.0;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float next = sdPrimitive(px - uShapeCenters[i], uShapeHalves[i],
                             uShapeTypes[i], uShapeRadii[i]);
    float weight = exp(-(next - nearest) / scale);
    weight *= smoothstep(0.04, 0.20, weight);
    centreSum += uShapeCenters[i] * weight;
    shortSideSum += 2.0 * min(uShapeHalves[i].x, uShapeHalves[i].y) * weight;
    weightSum += weight;
  }
  if (weightSum > 0.0) {
    componentCenter = centreSum / weightSum;
    componentShortSide = shortSideSum / weightSum;
  }
}

vec4 sampleBg(vec2 px, float lod) {
  vec2 uv = clamp(px / uRes, vec2(0.001), vec2(0.999));
  return textureLod(uSrc, uv, lod);
}

vec4 sampleReconstructedBg(vec2 px, float lod) {
  vec2 uv = clamp(px / uRes, vec2(0.001), vec2(0.999));
  return textureLod(uBlurSrc, uv, lod);
}

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             12.92 * c,
             lessThanEqual(c, vec3(0.0031308)));
}

vec2 softLimitOffset(vec2 offset, float limit) {
  float magnitude = length(offset);
  if (magnitude < 1e-4) return offset;
  float limited = tanh(magnitude / max(limit, 1.0)) * limit;
  return offset * (limited / magnitude);
}

// Variable-radius blur, radius in device px.
//
// A single textureLod() tap on the mip chain is not enough. The chain only
// offers radii in powers of two, and on the top levels one texel is tens of
// pixels wide, so a lone bilinear tap (a) averages in a huge slab of the
// screen, which drags the colour toward the frame mean -> washed out, and
// (b) reconstructs as a handful of big diamonds -> the "too few samples" mush.
// Instead take the level whose own radius is about a third of what we want and
// spread TAPS samples over the remainder on a golden-angle spiral. Neighbouring
// taps then land roughly one texel apart at that level, which is exactly the
// spacing at which the level's own filtering makes the disc continuous, so the
// result is a real wide Gaussian that keeps its local colour.
const int TAPS = 12;
const float GOLDEN_ANGLE = 2.39996323;

vec3 blurBg(vec2 px, float radius) {
  if (radius < 1.0) return sampleBg(px, 0.0).rgb;
  float lod = clamp(log2(radius) - 1.585, 0.0, uMips - 1.0);   // 2^lod ~ r/3
  vec3 acc = vec3(0.0);
  float densityAcc = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float fi = float(i) + 0.5;
    float r  = sqrt(fi / float(TAPS));       // equal-area spacing over the disc
    float a  = fi * GOLDEN_ANGLE;
    float w  = exp(-1.8 * r * r);
    vec2 samplePx = px + vec2(cos(a), sin(a)) * r * radius;
    // Keep narrow blur faithful to the original downsample chain, then lean on
    // the reconstructed chain where coarse mip blocks and temporal breathing
    // become visible. Both samplers return linear radiance from sRGB textures.
    float reconstruction = 0.78 * smoothstep(10.0, 52.0, radius);
    vec4 s = mix(sampleBg(samplePx, lod),
                 sampleReconstructedBg(samplePx, lod), reconstruction);
    acc += s.rgb * w;
    densityAcc += s.a * w;
    wsum += w;
  }
  vec3 linearCol = acc / wsum;

  // A pure radiance average spreads a dark branch but also dilutes it toward
  // the pale sky. The density channel averages -log(luminance), equivalent to
  // geometrically averaging transmission. That preserves the visual weight of
  // dark occluders while keeping uniform light regions unchanged. We retain
  // the linear RGB hue and only restore the missing luminance contrast.
  float linearLum = max(dot(linearCol, vec3(0.2126, 0.7152, 0.0722)), 0.001);
  float densityLum = exp(-4.0 * densityAcc / wsum);
  float densityGap = max(linearLum - densityLum, 0.0);
  float radiusGate = smoothstep(1.0, 8.0, radius);
  float targetLum = max(linearLum * 0.22,
                        linearLum - densityGap * uOpticalDensity * radiusGate);
  return linearCol * (targetLum / linearLum);
}

void main() {
  vec2 px = vUV * uRes;

  float d = sdAppleShape(px);
  float aa = smoothstep(0.8, -0.8, d);
  vec2 adaptCenter;
  float localShortSide;
  localComponentMetrics(px, adaptCenter, localShortSide);
  // Material lengths are authored against the large demo components. Treat
  // them as maxima and fit the complete optical system to 30% of a smaller
  // primitive's short side. The shared metric call above also keeps this scale
  // continuous when differently sized primitives form one fused surface.
  float fittedScale = clamp(0.30 * localShortSide / max(uBevel, 1.0), 0.05, 1.0);
  float opticalScale = mix(1.0, fittedScale,
                           clamp(uSizeAdaptation, 0.0, 1.0));
  float bevel = max(uBevel * opticalScale, 1.0);
  float opticalHeight = uHeight * opticalScale;

  // ---- gradient of the SDF = outward direction of the surface -------------
  vec2 g = normalize(opticalGradient(px) + 1e-6);

  // ---- thickness field / bevel profile -----------------------------------
  float t  = clamp(-d / bevel, 0.0, 1.0);    // 0 at the edge, 1 on the plateau
  float ct = 1.0 - t;
  float h  = sqrt(max(1.0 - ct * ct, 0.0));  // convex (circular) bevel
  float dhdt = ct / max(h, 0.10);            // slope, clamped at the silhouette
  float slope = (opticalHeight / bevel) * dhdt;

  // 0 = convex lens, 1 = the default Apple-like concave rim. Values above 1
  // deliberately exaggerate the inward normal for exploratory tuning.
  float curveSign = 1.0 - 2.0 * uMeniscus;
  vec3 n = normalize(vec3(curveSign * g * slope, 1.0));
  vec3 I = vec3(0.0, 0.0, -1.0);

  // ---- refraction (Snell) + dispersion -----------------------------------
  float path = opticalHeight * mix(0.25, 1.0, h) * uRefractScale;
  vec2 dR, dG, dB;
  {
    float e = 1.0 / max(uIOR - uDispersion, 1.0);
    vec3 R = refract(I, n, e);
    dR = (R == vec3(0.0)) ? vec2(0.0) : R.xy / max(-R.z, 0.25) * path;
    e = 1.0 / max(uIOR, 1.0);
    R = refract(I, n, e);
    dG = (R == vec3(0.0)) ? vec2(0.0) : R.xy / max(-R.z, 0.25) * path;
    e = 1.0 / max(uIOR + uDispersion, 1.0);
    R = refract(I, n, e);
    dB = (R == vec3(0.0)) ? vec2(0.0) : R.xy / max(-R.z, 0.25) * path;
  }

  // Strong concave meniscus normals can make the screen-space mapping fold
  // over itself at multi-shape junctions. On hard-edged wallpapers that reads
  // as triangular tearing rather than refraction. Compress only the extreme
  // tail; ordinary offsets remain almost linear while caustic spikes stay
  // within a bevel-sized optical footprint.
  float maxDisplacement = max(1.15 * bevel, max(12.0 * opticalScale, 3.0));
  dR = softLimitOffset(dR, maxDisplacement);
  dG = softLimitOffset(dG, maxDisplacement);
  dB = softLimitOffset(dB, maxDisplacement);

  // ---- scattering: rim stays readable, plateau is frosted ----------------
  float radius = mix(uBlurRim, uBlurPlateau, smoothstep(0.0, 0.85, t))
               * opticalScale;

  vec3 col;
  col.r = blurBg(px + dR, radius).r;
  col.g = blurBg(px + dG, radius).g;
  col.b = blurBg(px + dB, radius).b;

  // Saturation is boosted on the TRANSMITTED backdrop only (this is what
  // UIVisualEffectView's saturationDeltaFactor does). Any wide blur averages
  // colours toward grey; without this the frosted panel reads pale even though
  // the wallpaper behind it is saturated. Doing it before the reflections keeps
  // the specular/Fresnel highlights neutral.
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSat);

  // ---- reflection: backdrop environment + narrow specular lobes -----------
  // Schlick: F0 for glass is ~4%, and the (1-cos)^5 falloff keeps the mirror
  // term confined to the steepest part of the bevel. A softer exponent smears
  // a grey wash across the whole rim and bleaches the refracted image there.
  float fres = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
  vec2 nn = normalize(n.xy + 1e-6);

  // Keep the reflected environment local to the fragment. Stabilise the lobe
  // controls around the owning primitive below so hard wallpaper edges do not
  // chop one rim into unrelated bright and dark pieces.
  float probeLod = clamp(3.5 + log2(max(opticalScale, 0.05)),
                         0.0, uMips - 1.0);
  float probeRadius = max(1.35 * bevel, max(18.0 * opticalScale, 3.0));
  vec3 envL = sampleBg(px + vec2(-probeRadius, 0.0), probeLod).rgb;
  vec3 envR = sampleBg(px + vec2( probeRadius, 0.0), probeLod).rgb;
  vec3 envB = sampleBg(px + vec2(0.0, -probeRadius), probeLod).rgb;
  vec3 envT = sampleBg(px + vec2(0.0,  probeRadius), probeLod).rgb;
  vec2 fallbackLight = normalize(uLightDir + vec2(1e-5));
  // Highlight adaptation must be stable across one component. Driving its
  // strength and colour from each fragment's probe makes a mountain ridge or
  // tree line cut the rim into bright and dark pieces. Probe around the local
  // component centre while retaining per-fragment environment reflection.
  vec3 adaptL = sampleBg(adaptCenter + vec2(-probeRadius, 0.0), probeLod).rgb;
  vec3 adaptR = sampleBg(adaptCenter + vec2( probeRadius, 0.0), probeLod).rgb;
  vec3 adaptB = sampleBg(adaptCenter + vec2(0.0, -probeRadius), probeLod).rgb;
  vec3 adaptT = sampleBg(adaptCenter + vec2(0.0,  probeRadius), probeLod).rgb;
  vec2 adaptGradient = vec2(luminance(adaptR) - luminance(adaptL),
                            luminance(adaptT) - luminance(adaptB));
  float stableContrast = length(adaptGradient);
  float lightAdapt = clamp(uHighlightAdapt, 0.0, 1.0) *
                     smoothstep(0.025, 0.22, stableContrast);
  // Keep the lobe direction material-local. Steering it with the wallpaper
  // gradient creates a rapidly rotating direction field around hard colour
  // edges, which appears as diagonal tears and lets unrelated components alter
  // each other's highlights. The environment still adapts strength and colour.
  vec2 lightDir = fallbackLight;

  // Reflect the colour seen in the surface-normal direction. A local sample
  // keeps small bright structures (tower lights, clouds, coastlines) attached
  // to the nearby rim instead of turning every frame into the same white ring.
  float wx = clamp(0.5 + 0.5 * nn.x, 0.0, 1.0);
  float wy = clamp(0.5 + 0.5 * nn.y, 0.0, 1.0);
  vec3 envX = mix(envL, envR, wx);
  vec3 envY = mix(envB, envT, wy);
  vec3 ringEnv = (envX * abs(nn.x) + envY * abs(nn.y)) /
                 max(abs(nn.x) + abs(nn.y), 1e-3);
  float localProbeLod = clamp(2.0 + log2(max(opticalScale, 0.05)),
                              0.0, uMips - 1.0);
  vec3 localEnv = sampleBg(px + g * max(0.55 * bevel,
                                        max(6.0 * opticalScale, 2.0)),
                           localProbeLod).rgb;
  vec3 env = mix(ringEnv, localEnv, 0.58);
  float envLum = luminance(env);
  env = mix(env, vec3(envLum), 0.10); // retain wallpaper hue, tame neon spikes
  float envStrength = mix(0.58, 1.0, smoothstep(0.08, 0.75, envLum));
  col = mix(col, env, clamp(fres * uFresnel * envStrength, 0.0, 0.82));

  vec3 L1 = normalize(vec3(lightDir, 0.58));
  vec3 L2 = normalize(vec3(-lightDir, 0.48));
  float sharpness = max(uHighlightSharpness, 0.1);
  float s1 = pow(max(dot(n, L1), 0.0),
                 max(uSpecPower * sharpness, 1.0));
  float s2 = pow(max(dot(n, L2), 0.0),
                 max(uSpecPower * sharpness * 0.78, 1.0)) * 0.18;
  float highlightWidth = clamp(uHighlightWidth, 0.16, 1.0);
  float riseEnd = min(0.10, 0.25 * highlightWidth);
  float specBand = smoothstep(0.015, riseEnd, t) *
                   (1.0 - smoothstep(0.61 * highlightWidth,
                                     highlightWidth, t));
  float baseHighlight = clamp(uHighlightBase, 0.0, 1.0);
  float sourceStrength = baseHighlight + (1.0 - baseHighlight) * lightAdapt;
  vec3 sourceEnv = mix(mix(adaptL, adaptR, 0.5 + 0.5 * lightDir.x),
                       mix(adaptB, adaptT, 0.5 + 0.5 * lightDir.y), 0.5);
  float sourceLum = max(luminance(sourceEnv), 0.08);
  vec3 specColor = clamp(mix(vec3(1.0), sourceEnv / sourceLum, 0.42),
                         vec3(0.45), vec3(2.2));
  col += uSpecular * (s1 + s2) * specBand * sourceStrength * specColor;

  // Dark contour right at the silhouette: at grazing angles the rim reflects
  // the surroundings instead of transmitting, so real glass edges read dark.
  float w = max(uEdgeWidth, 0.5);
  float contour = smoothstep(w, 0.0, abs(d + 0.55 * w));
  col *= 1.0 - uEdgeDark * contour;

  // Crisp inner highlight line; direction and colour follow the local probe.
  float line = smoothstep(1.35 * w, 0.0, abs(d + 2.2 * w));
  float lit = 0.26 + 0.74 * max(dot(g, lightDir), 0.0);
  vec3 stableEnv = (adaptL + adaptR + adaptB + adaptT) * 0.25;
  float stableEnvLum = max(luminance(stableEnv), 0.12);
  vec3 lineColor = mix(vec3(1.0), stableEnv / stableEnvLum, 0.28);
  col += uEdgeLine * line * lit * lineColor;

  // ---- tint --------------------------------------------------------------
  // Tint polarity adapts once per local component, not per draw group.
  // This captures the system-material light/dark switch without letting a hard
  // background edge split one surface into visibly different materials.
  float materialLum = luminance(sampleBg(adaptCenter, uMips - 1.0).rgb);
  float useDarkMaterial = smoothstep(0.38, 0.68, materialLum);
  vec3 automaticTint = mix(vec3(0.97, 0.985, 1.0),
                           vec3(0.035, 0.055, 0.080), useDarkMaterial);
  vec3 resolvedTint = mix(uTintColor, automaticTint, clamp(uTintAdapt, 0.0, 1.0));
  float adaptiveAmount = uTintAmount * mix(1.10, 0.92, useDarkMaterial);
  col = mix(col, resolvedTint, clamp(adaptiveAmount, 0.0, 1.0));
  col += uBright;

  // ---- soft contact shadow ----------------------------------------------
  float ds = sdAppleShape(px + vec2(0.0, uShadowOffset));
  float sh = exp(-max(ds, 0.0) / max(uShadowSize, 0.5)) * uShadow;

  if (uDebug == 1) col = vec3(h);
  if (uDebug == 2) col = vec3(0.5 + 0.5 * n.xy, n.z);
  if (uDebug == 3) col = vec3(length(dG) / max(opticalHeight, 1.0),
                              length(dR - dB) / max(opticalHeight, 1.0) * 6.0, 0.0);

  // The browser drawing buffer stores display/sRGB values, unlike the explicit
  // SRGB8_ALPHA8 offscreen attachments. Encode the final linear material here,
  // then add triangular-distribution noise smaller than one display-space LSB.
  if (uDebug == 0) {
    float n0 = hash12(gl_FragCoord.xy + vec2(17.0, 59.0));
    float n1 = hash12(gl_FragCoord.yx + vec2(83.0, 11.0));
    float noise = (n0 - n1) * (0.85 / 255.0);
    col = clamp(linearToSrgb(col) + noise, 0.0, 1.0);
  }

  float a = aa + sh * (1.0 - aa);
  outColor = vec4(col * aa, a);   // premultiplied; shadow contributes black
}`,bs=16;const Ut=Object.freeze({rect:0,folder:0,pill:1,circle:2});function It(s){return Ut[s]??0}function zt(s,e=0){const t=Math.min(s.w??s.width??0,s.h??s.height??0);return Math.min(s.radius??e,t*.235)}function _e(s,e,t,i,r,a){const n=Math.abs(s)-t+r,l=Math.abs(e)-i+r,o=Math.max(n,0)+1e-5,h=Math.max(l,0)+1e-5,c=(o**a+h**a)**(1/a);return Math.min(Math.max(n,l),0)+c-r}function be(s,e,t,i,r,a,n=2){return r===2?Math.hypot(s,e)-Math.min(t,i):r===1?_e(s,e,t,i,Math.min(t,i),2):_e(s,e,t,i,a,Math.max(n,2))}function ye(s,e){const t=s.w??s.width??s.size??0,i=s.h??s.height??s.size??t;return{cx:(s.x??0)+t/2,cy:(s.y??0)+i/2,halfX:t/2,halfY:i/2,type:It(s.shape),radius:zt({...s,w:t,h:i},e.radius??0)}}function Ze(s,e,t,i={},r=i.mergeRadius??0){if(!t.length)return 1/0;const a=t.map(u=>ye(u,i)),n=i.squircle??2;let l=1/0;const o=a.map(u=>{const m=be(s-u.cx,e-u.cy,u.halfX,u.halfY,u.type,u.radius,n);return m<l&&(l=m),m});if(!(r>=.01)||a.length===1)return l;const h=Math.max(r*.36,.01);let c=0;for(const u of o)c+=Math.exp(-(u-l)/h);return l-h*Math.log(Math.max(c,1e-6))}function Gt(s,e,t,i={},r={}){const a=r.fusion===!1?0:r.mergeRadius??i.mergeRadius??0,n=r.tolerance??0,l=i.squircle??2;if(r.fusion===!1){for(let h=t.length-1;h>=0;h--){const c=ye(t[h],i);if(be(s-c.cx,e-c.cy,c.halfX,c.halfY,c.type,c.radius,l)<=n)return t[h]}return null}const o=ke(t,a,16).groups;for(let h=o.length-1;h>=0;h--){const c=o[h];if(Ze(s,e,c,i,a)>n)continue;let u=null,m=1/0;for(let d=c.length-1;d>=0;d--){const f=ye(c[d],i),y=be(s-f.cx,e-f.cy,f.halfX,f.halfY,f.type,f.radius,l);y<m&&(m=y,u=c[d])}return u}return null}function Ht(s,e,t,i={},r=i.mergeRadius??0){const a=ke(t,r,16).groups;if(!a.length)return 1/0;let n=1/0;for(const l of a){const o=Ze(s,e,l,i,r);o<n&&(n=o)}return n}function Nt(s,e){const t=l=>{const o=Number(l.w??l.width??l.size??0),h=Number(l.h??l.height??l.size??o);return{x:Number(l.x??0),y:Number(l.y??0),w:o,h}},i=t(s),r=t(e),a=Math.max(0,Math.max(i.x-(r.x+r.w),r.x-(i.x+i.w))),n=Math.max(0,Math.max(i.y-(r.y+r.h),r.y-(i.y+i.h)));return Math.hypot(a,n)}function Ot(s,e=0){if(s.length<=1)return s.length?[s.slice()]:[];const t=Math.max(0,e)*.36*8,i=s.map((n,l)=>l),r=n=>{for(;i[n]!==n;)i[n]=i[i[n]],n=i[n];return n};for(let n=0;n<s.length;n++)for(let l=n+1;l<s.length;l++)Nt(s[n],s[l])<=t&&(i[r(n)]=r(l));const a=new Map;return s.forEach((n,l)=>{const o=r(l);a.has(o)||a.set(o,[]),a.get(o).push(n)}),[...a.values()]}function ke(s,e=0,t=16){const i=Ot(s,e),r=[];let a=!1;for(const n of i){n.length>t&&(a=!0);for(let l=0;l<n.length;l+=t)r.push(n.slice(l,l+t))}return{groups:r,truncated:a}}const Wt=`#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uDpr;
uniform float uMips;
uniform float uBackdropBlur;
const int MAX_SHAPES = 16;
uniform int uShapeCount;
uniform vec2 uShapeCenters[MAX_SHAPES];
uniform vec2 uShapeHalves[MAX_SHAPES];
uniform int uShapeTypes[MAX_SHAPES];
uniform float uShapeRadii[MAX_SHAPES];
uniform float uShapeTints[MAX_SHAPES];
uniform float uShapeTintLights[MAX_SHAPES];
uniform float uShapeFrosts[MAX_SHAPES];
uniform float uShapeOpacities[MAX_SHAPES];
uniform float uShapePressures[MAX_SHAPES];
uniform vec2 uShapePressAxes[MAX_SHAPES];
uniform vec2 uLightDirs[MAX_SHAPES];
uniform float uRefraction;
uniform float uEdgeReach;
uniform float uEdgeWidth;
uniform float uDispersion;
uniform float uBody;
uniform float uAbsorption;
uniform float uRim;
uniform float uReflection;
uniform float uHighlight;
uniform float uEcho;
uniform float uHairline;
uniform float uHairWidth;
// 1 while a layer is composited into the sRGB backdrop texture, which encodes
// on write; 0 for the display-referred drawing buffer.
uniform int uOutputLinear;

// Softness ratio -> pre-blur radius, as a fraction of the component short side.
const float FROST_PREBLUR_SCALE = 0.05;
// Strength of the pressed-in squash. The mapping slope at the contour is
// 1 - k, so k must stay below 1 to avoid folding the image.
const float PRESS_SQUASH = 0.85;

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             12.92 * c,
             lessThanEqual(c, vec3(0.0031308)));
}

vec3 srgbToLinear(vec3 c) {
  bvec3 cutoff = lessThanEqual(c, vec3(0.04045));
  vec3 low = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, cutoff);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

// Inside a rounded box the exact distance is max(q.x, q.y), and its gradient
// switches axis across the corner diagonal. Refraction reads that gradient as
// the surface normal, so the switch drew a 45-degree crease into every corner.
// A soft maximum rounds that ridge. It is used for the normal only: distance,
// masks, hairline and silhouette all keep the exact field.
// Unbiased: softMax(a, a, k) == a, so the interior term keeps its sign and
// the clamp below still recognises the inner rectangle.
float softMax(float a, float b, float k) {
  return 0.5 * (a + b + sqrt((a - b) * (a - b) + k * k)) - k * 0.5;
}

float sdRoundBoxSoft(vec2 p, vec2 b, float r, float k) {
  vec2 q = abs(p) - b + r;
  return min(softMax(q.x, q.y, k), 0.0) + length(max(q, 0.0)) - r;
}

float smoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

float shapeSdf(int index, vec2 point) {
  vec2 p = point - uShapeCenters[index];
  vec2 halfSize = uShapeHalves[index];
  int kind = uShapeTypes[index];
  float radius = min(uShapeRadii[index], min(halfSize.x, halfSize.y));
  if (kind == 0) return sdRoundBox(p, halfSize, radius);
  if (kind == 1) return sdRoundBox(p, halfSize, min(halfSize.x, halfSize.y));
  return length(p) - min(halfSize.x, halfSize.y);
}

/** The silhouette field with a rounded interior ridge, for normals. */
float shapeField(int index, vec2 point) {
  vec2 p = point - uShapeCenters[index];
  vec2 halfSize = uShapeHalves[index];
  int kind = uShapeTypes[index];
  float minHalf = min(halfSize.x, halfSize.y);
  float k = clamp(minHalf * 0.08, 1.5, 12.0);
  if (kind == 0) return sdRoundBoxSoft(p, halfSize, min(uShapeRadii[index], minHalf), k);
  if (kind == 1) return sdRoundBoxSoft(p, halfSize, minHalf, k);
  return length(p) - minHalf;
}

vec2 opticalNormal(int index, vec2 point, vec2 sdfNormal) {
  vec2 p = point - uShapeCenters[index];
  vec2 halfSize = max(uShapeHalves[index], vec2(1.0));
  int kind = uShapeTypes[index];

  if (kind == 0) {
    // The sixth-order superellipse is the optical field, while roundness only
    // controls the silhouette. This separation is part of the V2 model.
    vec2 q = p / halfSize;
    vec2 g = vec2(sign(q.x) * pow(abs(q.x), 5.0) / halfSize.x,
                  sign(q.y) * pow(abs(q.y), 5.0) / halfSize.y);
    return normalize(g + sdfNormal * 0.0001);
  }
  if (kind == 1) {
    vec2 closest;
    if (halfSize.x >= halfSize.y) {
      float segment = max(halfSize.x - halfSize.y, 0.0);
      closest = vec2(clamp(p.x, -segment, segment), 0.0);
    } else {
      float segment = max(halfSize.y - halfSize.x, 0.0);
      closest = vec2(0.0, clamp(p.y, -segment, segment));
    }
    return normalize(p - closest + sdfNormal * 0.0001);
  }
  return normalize(p + sdfNormal * 0.0001);
}

// The shared backdrop pipeline stores linear radiance in SRGB8_ALPHA8.
// V2's optical constants were authored in display space, so convert each
// sample back before applying the V2 equations.
vec3 backdropLod(vec2 uv, float lod) {
  return linearToSrgb(textureLod(uSrc, clamp(uv, vec2(0.001), vec2(0.999)),
                                 clamp(lod, 0.0, max(uMips - 1.0, 0.0))).rgb);
}

// The mip level an implicit texture() lookup selects for a refracted
// coordinate. Explicit sampling never drops below it, so compressed capture
// bands stay filtered exactly as before while pre-blur can raise the level.
float footprintLod(vec2 uv) {
  vec2 dx = dFdx(uv) * uRes;
  vec2 dy = dFdy(uv) * uRes;
  return 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
}

vec3 softBackdrop(vec2 uv, float radius) {
  float lod = log2(max(radius * 0.9, 1.0));
  vec2 r = vec2(max(radius * 0.42, 0.35)) / uRes;
  vec2 center = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 c = backdropLod(center, lod) * 0.44;
  c += backdropLod(center + vec2(r.x, 0.0), lod) * 0.14;
  c += backdropLod(center - vec2(r.x, 0.0), lod) * 0.14;
  c += backdropLod(center + vec2(0.0, r.y), lod) * 0.14;
  c += backdropLod(center - vec2(0.0, r.y), lod) * 0.14;
  return c;
}

// The backdrop blurred before refraction: a frosted layer that the liquid
// glass then bends. Radius is in device pixels; zero is the sharp backdrop.
vec3 preBlurredBackdrop(vec2 uv, float radius, float footprint) {
  if (radius <= 0.0) return backdropLod(uv, footprint);
  float lod = max(log2(max(radius * 0.9, 1e-3)), footprint);
  vec2 r = vec2(radius * 0.42) / uRes;
  vec2 center = clamp(uv, vec2(0.001), vec2(0.999));
  vec3 c = backdropLod(center, lod) * 0.44;
  c += backdropLod(center + vec2(r.x, 0.0), lod) * 0.14;
  c += backdropLod(center - vec2(r.x, 0.0), lod) * 0.14;
  c += backdropLod(center + vec2(0.0, r.y), lod) * 0.14;
  c += backdropLod(center - vec2(0.0, r.y), lod) * 0.14;
  return c;
}

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 interfaceColor(vec2 point, vec2 normal, float preBlur) {
  float radius = max(2.0, preBlur);
  vec3 outsideColor = softBackdrop((point + normal * 1.8) / uRes, radius);
  vec3 insideColor = softBackdrop((point - normal * 1.8) / uRes, radius);
  // Apple's outer interface is a neutral contrast line rather than a copy of
  // the wallpaper colour. Include display-space value as well as luminance so
  // saturated blue/purple fields select a dark line even though their formal
  // luminance is modest. The outside carries more weight because that is the
  // field the silhouette must remain legible against.
  float outsideValue = max(outsideColor.r, max(outsideColor.g, outsideColor.b));
  float insideValue = max(insideColor.r, max(insideColor.g, insideColor.b));
  float outsideLight = max(luminance(outsideColor), outsideValue * 0.72);
  float insideLight = max(luminance(insideColor), insideValue * 0.72);
  float interfaceLight = outsideLight * 0.68 + insideLight * 0.32;
  float darkLine = smoothstep(0.40, 0.61, interfaceLight);
  return mix(vec3(0.92, 0.93, 0.96), vec3(0.014, 0.013, 0.018), darkLine);
}

void main() {
  vec2 point = vUV * uRes;
  int chosen = -1;
  float chosenD = 1e6;
  int nearest = 0;
  float nearestD = 1e6;
  for (int i = 0; i < MAX_SHAPES; i++) {
    if (i >= uShapeCount) break;
    float d = shapeSdf(i, point);
    if (d < nearestD) { nearest = i; nearestD = d; }
    if (d <= 2.1) { chosen = i; chosenD = d; }
  }

  // Screen-space derivatives (fwidth, dFdx/dFdy and implicit texture LOD) are
  // only defined in uniform control flow. Fragments outside every surface
  // return early below; if that happened before the derivatives, a lane in
  // the 2x2 quad that exited with the 1e6 sentinel would make its neighbours'
  // hairline width and mip level garbage on some GPUs, sprinkling stray
  // pixels along the silhouette. So the geometric ALU runs for every lane,
  // evaluated on the nearest surface as a continuous extension for outside
  // fragments, and only the texture fetches are skipped after the return.
  bool covered = chosen >= 0;
  if (!covered) { chosen = nearest; chosenD = nearestD; }
  float edgeAA = max(fwidth(nearestD), 0.72);

  vec2 center = uShapeCenters[chosen];
  vec2 halfSize = uShapeHalves[chosen];
  float minHalf = min(halfSize.x, halfSize.y);
  float e = 1.35;
  float dx = shapeField(chosen, point + vec2(e, 0.0)) - shapeField(chosen, point - vec2(e, 0.0));
  float dy = shapeField(chosen, point + vec2(0.0, e)) - shapeField(chosen, point - vec2(0.0, e));
  vec2 normal = normalize(vec2(dx, dy) + vec2(0.0001));
  float depth = clamp(-chosenD / max(12.0, minHalf * 0.62), 0.0, 1.0);
  float refractionSupport = max(14.0, minHalf * 0.50);
  float edgeCurve = pow(1.0 - smoothstep(0.0, refractionSupport, -chosenD), 2.2);
  vec2 local = (point - center) / max(halfSize, vec2(1.0));

  float edgeDepth = max(-chosenD, 0.0);
  float causticSupport = max(8.0, minHalf * uEdgeWidth);
  float captureX = clamp(edgeDepth / causticSupport, 0.0, 1.0);
  float causticT = 1.0 - smoothstep(0.0, causticSupport, edgeDepth);
  float causticShade = causticT * causticT * (3.0 - 2.0 * causticT);
  // The old double-smoothstep displacement flattened at the visible contour.
  // Its source-coordinate derivative therefore changed sign twice, making a
  // captured line turn back just before it touched the edge. A one-sided exit
  // profile keeps a finite slope at the contour and relaxes to zero only on
  // the inner side of the capture band, leaving a single optical fold.
  float captureProfile = pow(1.0 - captureX, 1.64);
  float refractionX = clamp(edgeDepth / refractionSupport, 0.0, 1.0);
  float refractionProfile = pow(1.0 - refractionX, 2.2);
  // The silhouette and optical superellipse deliberately differ in V2, but
  // the visible contour must still exit along the silhouette normal. Blend to
  // the broader optical field only after leaving the outer edge pixels.
  float opticalNormalMix = smoothstep(0.12, 0.55, captureX);
  vec2 bendNormal = normalize(mix(normal, opticalNormal(chosen, point, normal), opticalNormalMix));
  vec2 inward = -bendNormal;
  // Edge pull used to multiply Capture reach as a second public control. Keep
  // its original default as an internal calibration so the default material
  // retains the same displacement with one unambiguous capture parameter.
  const float CAPTURE_REACH_SCALE = 1.24;
  float captureDistance = uEdgeReach * minHalf * 2.0 * CAPTURE_REACH_SCALE * captureProfile;
  float shallowRefraction = uRefraction * refractionProfile * 0.32;
  vec2 lensShift = inward * (shallowRefraction + captureDistance);
  lensShift += -local * (uRefraction * 0.035) * smoothstep(0.16, 0.92, depth);
  // A held lens is pressed in: a shallow diverging surface that squashes what
  // is seen through it. The outward displacement follows the contour normal,
  // vanishes on the centre line and at the silhouette, and softens the
  // ordinary edge fold instead of inflating the rim.
  float pressure = clamp(uShapePressures[chosen], 0.0, 1.0);
  float pressDepth = clamp(edgeDepth / max(minHalf, 1.0), 0.0, 1.0);
  lensShift *= 1.0 - pressure * 0.35;
  // Per-axis weights let a host shorten the squash along one direction, so a
  // wide capsule can keep its length while it flattens (or vice versa).
  vec2 pressAxes = clamp(uShapePressAxes[chosen], 0.0, 1.0);
  lensShift += normal * pressAxes * (PRESS_SQUASH * minHalf * pressure
                                     * pressDepth * (1.0 - pressDepth));
  vec2 chromaShift = bendNormal * uDispersion * (0.32 + edgeCurve * 0.95);
  vec2 uvR = (point + lensShift * (1.0 + uDispersion * 0.009) + chromaShift) / uRes;
  vec2 uvG = (point + lensShift) / uRes;
  vec2 uvB = (point + lensShift * (1.0 - uDispersion * 0.011) - chromaShift) / uRes;
  // Reach controls where the sample comes from, not how fat a captured line
  // becomes. Preserve the tuned reach=35 softness while preventing larger
  // reaches from silently doubling the blur radius.
  float causticBlur = min(0.7 + 1.13 * uDpr, 0.7 + captureDistance * 0.026);
  // Softness and background pre-blur are the same operation: the backdrop is
  // blurred before the lens bends it. Softness is a ratio of the component
  // short side, so a larger card is naturally more frosted at one setting;
  // pre-blur is an absolute radius. Successive blurs add in quadrature.
  float frostRadius = clamp(uShapeFrosts[chosen], 0.0, 1.0) * minHalf * 2.0 * FROST_PREBLUR_SCALE;
  float preBlur = sqrt(frostRadius * frostRadius + uBackdropBlur * uBackdropBlur);
  float lodR = footprintLod(uvR);
  float lodG = footprintLod(uvG);
  float lodB = footprintLod(uvB);
  vec2 echoUv = (point - normal * 11.0) / uRes;
  float echoLod = footprintLod(echoUv);

  if (!covered) {
    outColor = vec4(0.0);
    return;
  }

  vec3 sr = preBlurredBackdrop(uvR, preBlur, lodR);
  vec3 sg = preBlurredBackdrop(uvG, preBlur, lodG);
  vec3 sb = preBlurredBackdrop(uvB, preBlur, lodB);
  // Captured lines keep their slight softening inside the thin caustic band
  // unless the pre-blurred backdrop is already at least that soft.
  float causticMix = causticShade * 0.18;
  if (causticMix > 0.001 && causticBlur > preBlur) {
    sr = mix(sr, softBackdrop(uvR, causticBlur), causticMix);
    sg = mix(sg, softBackdrop(uvG, causticBlur), causticMix);
    sb = mix(sb, softBackdrop(uvB, causticBlur), causticMix);
  }
  vec3 transmitted = vec3(sr.r, sg.g, sb.b);

  float transmittedLum = luminance(transmitted);
  vec3 bodyTarget = mix(vec3(0.030, 0.031, 0.038), vec3(0.94, 0.95, 0.97),
                        smoothstep(0.58, 0.82, transmittedLum));
  transmitted = mix(transmitted, bodyTarget,
                    clamp(uBody * (0.034 + edgeCurve * 0.012), 0.0, 0.11));
  transmitted = mix(vec3(luminance(transmitted)), transmitted, 1.0 - uBody * 0.045);

  float opticalPath = 0.26 + sqrt(depth) * 0.74;
  transmitted *= exp(-vec3(0.018, 0.011, 0.004) * opticalPath * 2.4 * uAbsorption);
  // Tinted Liquid Glass chooses one light/dark material for the whole
  // component. Choosing per fragment lets high-contrast content punch a
  // checkerboard through the surface instead of producing the coherent milky
  // veil used by notifications and other legibility-first controls.
  vec3 tintTarget = mix(vec3(0.055, 0.057, 0.066), vec3(0.975, 0.970, 0.955),
                        clamp(uShapeTintLights[chosen], 0.0, 1.0));
  float tintOpacity = smoothstep(0.0, 1.5, uShapeTints[chosen]) * 0.78;
  transmitted = mix(transmitted, tintTarget, tintOpacity * (0.88 + depth * 0.12));

  float mask = 1.0 - smoothstep(0.0, 1.35, chosenD);
  float thinRim = exp(-pow((chosenD + 0.65) / 1.4, 2.0));
  float innerRim = exp(-pow((chosenD + 6.2) / 3.8, 2.0));
  float fresnel = pow(clamp(edgeCurve, 0.0, 1.0), 0.72);
  vec2 lightDir = normalize(uLightDirs[chosen] + vec2(0.0001));
  float key = pow(max(dot(normal, lightDir), 0.0), 7.0) * fresnel;
  float opposite = pow(max(dot(normal, -lightDir), 0.0), 5.0) * innerRim;
  vec3 color = transmitted;
  // The rim reflection, echo and interface line only exist in a band around
  // the contour. Their weights are resolved first so interior fragments skip
  // the extra backdrop probes; a skipped weight is below 1/2000.
  float rimMix = clamp((thinRim * 0.42 + innerRim * 0.18 + fresnel * 0.10)
                       * uRim * uReflection, 0.0, 0.72);
  if (rimMix > 0.0005) {
    // A softened environment probe keeps moving video/feed edges from turning
    // into one-frame white flashes while preserving the local colour response.
    vec3 reflected = softBackdrop((point + normal * (8.0 + uRefraction * 0.17)) / uRes,
                                  max(5.2, preBlur));
    vec3 adaptiveRim = reflected * 1.45 + vec3(0.06, 0.035, 0.08);
    adaptiveRim = mix(adaptiveRim, vec3(0.96, 0.97, 1.0), 0.24);
    adaptiveRim = mix(adaptiveRim, vec3(0.035, 0.025, 0.045),
                      smoothstep(0.78, 0.98, luminance(reflected)) * 0.48);
    color = mix(color, adaptiveRim, rimMix);
  }
  color += vec3(1.0, 0.82, 0.92) * key * 0.30 * uRim * uHighlight;
  color *= 1.0 - opposite * 0.12 * uRim;
  float echoMix = exp(-pow((chosenD + 11.0) / 5.5, 2.0)) * 0.075 * uRim * uEcho;
  if (echoMix > 0.0005) {
    vec3 echoColor = preBlurredBackdrop(echoUv, preBlur, echoLod);
    color = mix(color, echoColor * 1.12, echoMix);
  }

  float lineWidth = mix(0.34, 1.08, clamp(uHairWidth, 0.0, 1.0));
  float strokeDistance = abs(chosenD + 0.10) - lineWidth * 0.5;
  float hairline = 1.0 - smoothstep(-edgeAA * 0.72, edgeAA * 0.72, strokeDistance);
  // Premultiplied layer composition exactly reproduces the prototype's two
  // sequential mixes when drawn over the supplied backdrop, and also allows
  // the same shader to work in overlay mode over a DOM/canvas backdrop.
  float hairAlpha = clamp(hairline * uHairline * (0.22 + uRim * 0.20), 0.0, 1.0);
  vec3 hairColor = vec3(0.0);
  if (hairAlpha > 0.0) {
    hairColor = interfaceColor(point, normal, preBlur);
    // The contrast line is the default interface. On the light-facing arc the
    // specular key replaces it with the thin white highlight visible in the
    // native material instead of merely brightening the black line underneath.
    float hairHighlight = clamp(key * uHighlight * 2.5 * (0.65 + uRim * 0.60), 0.0, 0.96);
    hairColor = mix(hairColor, vec3(0.985, 0.99, 1.0), hairHighlight);
  }

  float alpha = hairAlpha + mask * (1.0 - hairAlpha);
  // The rim, key highlight and echo terms can push the body colour past 1.0.
  // Inside the surface the drawing buffer clamps that anyway, but on the
  // anti-aliased fringe a premultiplied rgb larger than alpha composites
  // brighter than either the glass or the backdrop, sprinkling over-bright
  // pixels along the outer edge. Saturate before premultiplying.
  color = clamp(color, 0.0, 1.0);
  if (uOutputLinear == 1) {
    color = srgbToLinear(color);
    hairColor = srgbToLinear(hairColor);
  }
  vec3 premultiplied = hairColor * hairAlpha + color * mask * (1.0 - hairAlpha);
  float surfaceOpacity = clamp(uShapeOpacities[chosen], 0.0, 1.0);
  outColor = vec4(premultiplied * surfaceOpacity, alpha * surfaceOpacity);
}`;function Fe(s,e,t){const i=s.createShader(e);if(s.shaderSource(i,t),s.compileShader(i),!s.getShaderParameter(i,s.COMPILE_STATUS)){const r=s.getShaderInfoLog(i);throw s.deleteShader(i),new Error(r+`
`+t)}return i}function Z(s,e,t){const i=s.createProgram(),r=Fe(s,s.VERTEX_SHADER,e);let a;try{a=Fe(s,s.FRAGMENT_SHADER,t)}catch(o){throw s.deleteShader(r),s.deleteProgram(i),o}if(s.attachShader(i,r),s.attachShader(i,a),s.linkProgram(i),s.detachShader(i,r),s.detachShader(i,a),s.deleteShader(r),s.deleteShader(a),!s.getProgramParameter(i,s.LINK_STATUS)){const o=s.getProgramInfoLog(i);throw s.deleteProgram(i),new Error(o)}const n={},l=s.getProgramParameter(i,s.ACTIVE_UNIFORMS);for(let o=0;o<l;o++){const h=s.getActiveUniform(i,o).name.replace("[0]","");n[h]=s.getUniformLocation(i,h)}return{p:i,loc:n}}const Xt=7;class Je{constructor(e,t={}){const i=e.getContext("webgl2",{alpha:!!t.alpha,antialias:!1,premultipliedAlpha:!0,preserveDrawingBuffer:!!t.preserveDrawingBuffer});if(!i)throw new Error("WebGL2 unavailable");this.gl=i,this.canvas=e,this.materialVersion=t.materialVersion===2?2:1,this.lost=!1,this.tex=null,this.blurTex=null,this.wallpapers=[],this.fbos=[],this.blurFbos=[],this.mipLevels=0,this.w=0,this.h=0,this.createResources()}createResources(){const e=this.gl;this.quad=e.createVertexArray(),e.bindVertexArray(this.quad),this.quadBuffer=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.quadBuffer),e.bufferData(e.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.bindVertexArray(null),this.progWall=Z(e,ae,_t),this.progDown=Z(e,ae,Dt),this.progUp=Z(e,ae,Pt),this.progBlit=Z(e,ae,Bt),this.progGlass=Z(e,Ct,this.materialVersion===2?Wt:Ft),this.fallbackTexture=e.createTexture(),e.bindTexture(e.TEXTURE_2D,this.fallbackTexture),e.texImage2D(e.TEXTURE_2D,0,e.SRGB8_ALPHA8,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.bindTexture(e.TEXTURE_2D,null)}releaseResources(){const e=this.gl;for(const t of[this.progWall,this.progDown,this.progUp,this.progBlit,this.progGlass])t&&e.deleteProgram(t.p);this.progWall=null,this.progDown=null,this.progUp=null,this.progBlit=null,this.progGlass=null,this.quad&&e.deleteVertexArray(this.quad),this.quadBuffer&&e.deleteBuffer(this.quadBuffer),this.fallbackTexture&&e.deleteTexture(this.fallbackTexture),this.quad=null,this.quadBuffer=null,this.fallbackTexture=null}releaseTargets(){const e=this.gl;this.tex&&e.deleteTexture(this.tex),this.blurTex&&e.deleteTexture(this.blurTex),this.fbos.forEach(t=>e.deleteFramebuffer(t)),this.blurFbos.forEach(t=>e.deleteFramebuffer(t)),this.tex=null,this.blurTex=null,this.fbos=[],this.blurFbos=[],this.mipLevels=0}handleContextLost(){this.lost=!0,this.progWall=null,this.progDown=null,this.progUp=null,this.progBlit=null,this.progGlass=null,this.quad=null,this.quadBuffer=null,this.fallbackTexture=null,this.tex=null,this.blurTex=null,this.fbos=[],this.blurFbos=[];for(const e of this.wallpapers)e.texture=null,e.ready=!1,e.width=0,e.height=0}restore(){if(!this.lost)return this;this.lost=!1,this.createResources();const{w:e,h:t}=this;return this.w=0,this.h=0,e>0&&t>0&&this.resize(e,t),this.createWallpaperTextures(),this}hasLiveBackdrop(){return this.wallpapers.some(e=>e.update==="live")}sourceSize(e){return[Number((e==null?void 0:e.videoWidth)||(e==null?void 0:e.naturalWidth)||(e==null?void 0:e.width)||0),Number((e==null?void 0:e.videoHeight)||(e==null?void 0:e.naturalHeight)||(e==null?void 0:e.height)||0)]}isPremultipliedSource(e){var i,r,a;const t=(i=e==null?void 0:e.tagName)==null?void 0:i.toUpperCase();return t==="CANVAS"||t==="VIDEO"||((r=e==null?void 0:e.constructor)==null?void 0:r.name)==="OffscreenCanvas"||((a=e==null?void 0:e.constructor)==null?void 0:a.name)==="VideoFrame"}uploadSource(e){const[t,i]=this.sourceSize(e.source),r=Math.min(1,Math.max(.1,Number(e.scale)||1));if(r>=1||!this.isPremultipliedSource(e.source))return[e.source,t,i];const a=Math.max(1,Math.round(t*r)),n=Math.max(1,Math.round(i*r));e.scaled||(e.scaled=typeof document<"u"?document.createElement("canvas"):new globalThis.OffscreenCanvas(a,n)),e.scaled.width!==a&&(e.scaled.width=a),e.scaled.height!==n&&(e.scaled.height=n);const l=e.scaled.getContext("2d");return l.clearRect(0,0,a,n),l.drawImage(e.source,0,0,a,n),[e.scaled,a,n]}probeSource(e){const t=this.wallpapers[e];if(!t)return null;const i=Math.min(1,Math.max(.1,Number(t.scale)||1));return t.scaled&&i<1?t.scaled:t.source}uploadWallpaper(e,t=!1){if(this.lost||!e.texture)return!1;const[i,r]=this.sourceSize(e.source);if(!(i>0)||!(r>0))return!1;const[a,n,l]=this.uploadSource(e),o=this.gl;o.bindTexture(o.TEXTURE_2D,e.texture);const h=this.isPremultipliedSource(a);return o.pixelStorei(o.UNPACK_PREMULTIPLY_ALPHA_WEBGL,h),!t&&e.ready&&e.width===n&&e.height===l?o.texSubImage2D(o.TEXTURE_2D,0,0,0,o.RGBA,o.UNSIGNED_BYTE,a):o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,o.RGBA,o.UNSIGNED_BYTE,a),o.pixelStorei(o.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.width=n,e.height=l,e.ready=!0,!0}setWallpaperScale(e){const t=Math.min(1,Math.max(.1,Number(e)||1));let i=!1;for(const r of this.wallpapers)(r.scale??1)!==t&&(i=!0),r.scale=t;return i}resize(e,t){if(e=Math.max(1,Math.round(e)),t=Math.max(1,Math.round(t)),this.lost){this.w=e,this.h=t;return}if(e===this.w&&t===this.h)return;const i=this.gl;this.w=e,this.h=t,this.canvas.width=e,this.canvas.height=t,this.releaseTargets(),this.mipLevels=Math.min(Xt,Math.floor(Math.log2(Math.max(e,t)))+1);const r=()=>{const a=i.createTexture();return i.bindTexture(i.TEXTURE_2D,a),i.texStorage2D(i.TEXTURE_2D,this.mipLevels,i.SRGB8_ALPHA8,e,t),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR_MIPMAP_LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),a};this.tex=r(),this.blurTex=r(),this.fbos=[],this.blurFbos=[];for(let a=0;a<this.mipLevels;a++){const n=i.createFramebuffer();i.bindFramebuffer(i.FRAMEBUFFER,n),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,this.tex,a),this.fbos.push(n);const l=i.createFramebuffer();i.bindFramebuffer(i.FRAMEBUFFER,l),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,this.blurTex,a),this.blurFbos.push(l)}i.bindFramebuffer(i.FRAMEBUFFER,null)}createWallpaperTextures(){if(this.lost)return;const e=this.gl;for(const t of this.wallpapers)t.texture&&e.deleteTexture(t.texture),t.texture=e.createTexture(),t.ready=!1,t.width=0,t.height=0,e.bindTexture(e.TEXTURE_2D,t.texture),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),this.uploadWallpaper(t,!0);e.bindTexture(e.TEXTURE_2D,null)}setWallpapers(e,t={}){const i=this.gl,r=t.update==="live"?"live":"static",a=Math.min(1,Math.max(.1,Number(t.scale)||1));this.lost||this.wallpapers.forEach(n=>i.deleteTexture(n.texture)),this.wallpapers=e.map(n=>({texture:null,source:n,update:r,scale:a,scaled:null,ready:!1,width:0,height:0})),this.createWallpaperTextures()}refreshWallpapers(e=!1){if(!this.lost){for(const t of this.wallpapers)(e||t.update==="live")&&this.uploadWallpaper(t);this.gl.bindTexture(this.gl.TEXTURE_2D,null)}}mipSize(e){return[Math.max(1,this.w>>e),Math.max(1,this.h>>e)]}buildBackdrop(e,t=1){if(this.lost||!this.fbos.length)return;const i=this.gl;this.refreshWallpapers(),i.bindVertexArray(this.quad),i.disable(i.BLEND),i.bindFramebuffer(i.FRAMEBUFFER,this.fbos[0]),i.viewport(0,0,this.w,this.h),i.useProgram(this.progWall.p),i.uniform2f(this.progWall.loc.uRes,this.w,this.h),i.uniform1i(this.progWall.loc.uScene,e),i.uniform1f(this.progWall.loc.uZoom,t);const r=this.wallpapers[e];if(i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,r!=null&&r.ready?r.texture:this.fallbackTexture),i.uniform1i(this.progWall.loc.uWallpaper,1),i.uniform1i(this.progWall.loc.uUseImage,r!=null&&r.ready?1:0),i.drawArrays(i.TRIANGLE_STRIP,0,4),this.downsampleBackdrop(),this.materialVersion===2)return;const a=this.mipLevels-1,[n,l]=this.mipSize(a);i.bindFramebuffer(i.READ_FRAMEBUFFER,this.fbos[a]),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,this.blurFbos[a]),i.blitFramebuffer(0,0,n,l,0,0,n,l,i.COLOR_BUFFER_BIT,i.NEAREST),i.bindVertexArray(this.quad),i.useProgram(this.progUp.p),i.uniform1i(this.progUp.loc.uLow,0),i.uniform1i(this.progUp.loc.uHigh,1);for(let o=a-1;o>=0;o--){const[h,c]=this.mipSize(o+1),[u,m]=this.mipSize(o);i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,this.blurTex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,o+1),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,o+1),i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,this.tex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,o),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,o),i.bindFramebuffer(i.FRAMEBUFFER,this.blurFbos[o]),i.viewport(0,0,u,m),i.uniform2f(this.progUp.loc.uLowTexel,1/h,1/c),i.drawArrays(i.TRIANGLE_STRIP,0,4)}i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,this.blurTex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,0),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,this.mipLevels-1),i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,this.tex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,0),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,this.mipLevels-1)}downsampleBackdrop(){if(this.lost||!this.fbos.length)return;const e=this.gl;e.bindVertexArray(this.quad),e.disable(e.BLEND),e.useProgram(this.progDown.p),e.uniform1i(this.progDown.loc.uTex,0),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.tex);for(let t=1;t<this.mipLevels;t++){const[i,r]=this.mipSize(t-1),[a,n]=this.mipSize(t);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_BASE_LEVEL,t-1),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAX_LEVEL,t-1),e.bindFramebuffer(e.FRAMEBUFFER,this.fbos[t]),e.viewport(0,0,a,n),e.uniform2f(this.progDown.loc.uTexel,1/i,1/r),e.drawArrays(e.TRIANGLE_STRIP,0,4)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_BASE_LEVEL,0),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAX_LEVEL,this.mipLevels-1)}beginBackdropLayer(){if(this.lost||!this.fbos.length||!this.blurFbos.length)return!1;const e=this.gl;return e.bindFramebuffer(e.READ_FRAMEBUFFER,this.fbos[0]),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,this.blurFbos[0]),e.blitFramebuffer(0,0,this.w,this.h,0,0,this.w,this.h,e.COLOR_BUFFER_BIT,e.NEAREST),!0}commitBackdropLayer(){this.lost||!this.fbos.length||!this.blurFbos.length||([this.tex,this.blurTex]=[this.blurTex,this.tex],[this.fbos,this.blurFbos]=[this.blurFbos,this.fbos],this.downsampleBackdrop())}drawBackdrop(){if(this.lost||!this.tex)return;const e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this.w,this.h),e.disable(e.BLEND),e.bindVertexArray(this.quad),e.useProgram(this.progBlit.p),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.tex),e.uniform1i(this.progBlit.loc.uTex,0),e.drawArrays(e.TRIANGLE_STRIP,0,4)}clearOutput(){if(this.lost)return;const e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this.w,this.h),e.disable(e.BLEND),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT)}drawGlassGroup(e,t,i,r=t.mergeRadius??0){if(!e.length||this.lost||!this.tex)return;const a=this.gl,{loc:n,p:l}=this.progGlass,o=e.slice(0,16),h=Math.min(...o.map(p=>p.x)),c=Math.min(...o.map(p=>p.y)),u=Math.max(...o.map(p=>p.x+p.w)),m=Math.max(...o.map(p=>p.y+p.h)),d=u-h,f=m-c;a.bindFramebuffer(a.FRAMEBUFFER,null),a.viewport(0,0,this.w,this.h),a.enable(a.BLEND),a.blendFunc(a.ONE,a.ONE_MINUS_SRC_ALPHA),a.bindVertexArray(this.quad),a.useProgram(l);const y=(h+d/2)*i,g=this.h-(c+f/2)*i,b=d/2*i,S=f/2*i,x=new Float32Array(16*2),R=new Float32Array(16*2),E=new Float32Array(16),v=new Int32Array(16);o.forEach((p,A)=>{const k=Math.min(p.w,p.h);x[A*2]=(p.x+p.w/2)*i,x[A*2+1]=this.h-(p.y+p.h/2)*i,R[A*2]=p.w/2*i,R[A*2+1]=p.h/2*i,E[A]=Math.min(p.radius??t.radius,k*.235)*i,v[A]=p.shape==="pill"?1:p.shape==="circle"?2:0}),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.tex),a.uniform1i(n.uSrc,0),a.activeTexture(a.TEXTURE2),a.bindTexture(a.TEXTURE_2D,this.blurTex),a.uniform1i(n.uBlurSrc,2),a.uniform2f(n.uRes,this.w,this.h),a.uniform2f(n.uCenter,y,g),a.uniform2f(n.uHalf,b,S),a.uniform1i(n.uShapeCount,o.length),a.uniform2fv(n.uShapeCenters,x),a.uniform2fv(n.uShapeHalves,R),a.uniform1iv(n.uShapeTypes,v),a.uniform1fv(n.uShapeRadii,E),a.uniform1f(n.uMergeRadius,Math.max(0,r)*i),a.uniform1f(n.uPad,(t.shadowSize*4+Math.max(r,0)*.3+8)*i),a.uniform1f(n.uSquircle,t.squircle),a.uniform1f(n.uBevel,t.bevel*i),a.uniform1f(n.uHeight,t.height*i),a.uniform1f(n.uSizeAdaptation,t.sizeAdaptation??1),a.uniform1f(n.uIOR,t.ior),a.uniform1f(n.uDispersion,t.dispersion),a.uniform1f(n.uBlurPlateau,t.blurPlateau*i),a.uniform1f(n.uBlurRim,t.blurRim*i),a.uniform1f(n.uOpticalDensity,t.opticalDensity),a.uniform1f(n.uMips,this.mipLevels),a.uniform1f(n.uSpecular,t.specular),a.uniform1f(n.uSpecPower,t.specPower),a.uniform1f(n.uHighlightAdapt,t.highlightAdapt),a.uniform1f(n.uHighlightWidth,t.highlightWidth),a.uniform1f(n.uHighlightSharpness,t.highlightSharpness),a.uniform1f(n.uHighlightBase,t.highlightBase),a.uniform1f(n.uFresnel,t.fresnel),a.uniform1f(n.uSat,t.saturation),a.uniform1f(n.uBright,t.brightness),a.uniform1f(n.uTintAmount,t.tintAmount),a.uniform3f(n.uTintColor,...t.tintColor),a.uniform1f(n.uTintAdapt,t.tintAdapt??0),a.uniform1f(n.uShadow,t.shadow),a.uniform1f(n.uShadowSize,t.shadowSize*i),a.uniform1f(n.uShadowOffset,t.shadowOffset*i),a.uniform2f(n.uLightDir,t.lightX,t.lightY),a.uniform1f(n.uEdgeLine,t.edgeLine),a.uniform1f(n.uEdgeWidth,t.edgeWidth*i),a.uniform1f(n.uEdgeDark,t.edgeDark),a.uniform1f(n.uRefractScale,t.refractScale),a.uniform1f(n.uMeniscus,t.meniscus),a.uniform1i(n.uDebug,t.debug|0),a.drawArrays(a.TRIANGLE_STRIP,0,4),a.disable(a.BLEND)}drawGlass(e,t,i){this.drawGlassGroup([e],t,i,0)}drawGlassV2Group(e,t,i,r=[],a=[],n={}){if(!e.length||this.lost||!this.tex)return;const l=!!n.intoBackdrop&&this.blurFbos.length>0,o=this.gl,{loc:h,p:c}=this.progGlass,u=e.slice(0,16),m=Math.min(...u.map(w=>w.x)),d=Math.min(...u.map(w=>w.y)),f=Math.max(...u.map(w=>w.x+w.w)),y=Math.max(...u.map(w=>w.y+w.h)),g=f-m,b=y-d,S=new Float32Array(16*2),x=new Float32Array(16*2),R=new Float32Array(16),E=new Int32Array(16),v=new Float32Array(16*2),p=new Float32Array(16),A=new Float32Array(16),k=new Float32Array(16),B=new Float32Array(16),L=new Float32Array(16),M=new Float32Array(16*2);u.forEach((w,T)=>{var De,Pe;const D=Math.min(w.w,w.h);S[T*2]=(w.x+w.w/2)*i,S[T*2+1]=this.h-(w.y+w.h/2)*i,x[T*2]=w.w/2*i,x[T*2+1]=w.h/2*i,R[T]=Math.min(w.radius??D*.5*t.roundness,D*.5)*i,E[T]=w.shape==="pill"?1:w.shape==="circle"?2:0;const z=r[T]??[Math.SQRT1_2,Math.SQRT1_2];v[T*2]=z[0],v[T*2+1]=z[1],p[T]=w.tint??t.tint,A[T]=a[T]??1,k[T]=w.frost??t.frost,B[T]=w.opacity??1,L[T]=w.pressure??0,M[T*2]=((De=w.pressureAxes)==null?void 0:De[0])??1,M[T*2+1]=((Pe=w.pressureAxes)==null?void 0:Pe[1])??1}),o.bindFramebuffer(o.FRAMEBUFFER,l?this.blurFbos[0]:null),o.viewport(0,0,this.w,this.h),o.enable(o.BLEND),o.blendFunc(o.ONE,o.ONE_MINUS_SRC_ALPHA),o.bindVertexArray(this.quad),o.useProgram(c),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.tex),o.uniform1i(h.uSrc,0),o.uniform1i(h.uOutputLinear,l?1:0),o.uniform2f(h.uRes,this.w,this.h),o.uniform1f(h.uDpr,i),o.uniform2f(h.uCenter,(m+g/2)*i,this.h-(d+b/2)*i),o.uniform2f(h.uHalf,g/2*i,b/2*i),o.uniform1f(h.uPad,4*i),o.uniform1f(h.uMips,this.mipLevels),o.uniform1i(h.uShapeCount,u.length),o.uniform2fv(h.uShapeCenters,S),o.uniform2fv(h.uShapeHalves,x),o.uniform1iv(h.uShapeTypes,E),o.uniform1fv(h.uShapeRadii,R),o.uniform1fv(h.uShapeTints,p),o.uniform1fv(h.uShapeTintLights,A),o.uniform1fv(h.uShapeFrosts,k),o.uniform1fv(h.uShapeOpacities,B),o.uniform1fv(h.uShapePressures,L),o.uniform2fv(h.uShapePressAxes,M),o.uniform2fv(h.uLightDirs,v),o.uniform1f(h.uRefraction,t.refraction*i),o.uniform1f(h.uEdgeReach,t.edgeReach),o.uniform1f(h.uBackdropBlur,(t.backdropBlur??0)*i),o.uniform1f(h.uEdgeWidth,t.edgeWidth),o.uniform1f(h.uDispersion,t.dispersion),o.uniform1f(h.uBody,t.body),o.uniform1f(h.uAbsorption,t.absorption),o.uniform1f(h.uRim,t.rim),o.uniform1f(h.uReflection,t.reflection),o.uniform1f(h.uHighlight,t.highlight),o.uniform1f(h.uEcho,t.echo),o.uniform1f(h.uHairline,t.hairline),o.uniform1f(h.uHairWidth,t.hairWidth),o.drawArrays(o.TRIANGLE_STRIP,0,4),o.disable(o.BLEND)}destroy(){if(this.lost){this.wallpapers=[];return}const e=this.gl;this.releaseTargets(),this.releaseResources(),this.wallpapers.forEach(t=>e.deleteTexture(t.texture)),this.wallpapers=[]}}const qt={radius:64,squircle:2,mergeRadius:52,bevel:34,height:21,sizeAdaptation:1,ior:2,dispersion:.06,refractScale:3,meniscus:1,blurPlateau:4.5,blurRim:11,opticalDensity:.4,specular:.89,specPower:29.5,fresnel:.65,saturation:1.35,brightness:0,tintAmount:.02,tintColor:[1,1,1],tintAdapt:.14,shadow:.09,shadowSize:4,shadowOffset:0,lightX:-.18,lightY:.08,highlightAdapt:.91,highlightWidth:.87,highlightSharpness:.55,highlightBase:.3,edgeLine:.3,edgeWidth:.5,edgeDark:.02,debug:0},Vt={regular:{},clear:{blurPlateau:3,blurRim:1,height:20,bevel:15,refractScale:1.5,specular:.36,fresnel:1,tintAmount:.02,brightness:.02,saturation:1.18},lens:{bevel:26,height:34,ior:1.62,dispersion:.09,refractScale:1.8,blurPlateau:2,blurRim:0,specular:.42,fresnel:1.2}},$t={tintAmount:.86,blurPlateau:0,blurRim:0,refractScale:0,dispersion:0,meniscus:0,specular:.12,fresnel:.15,saturation:1,highlightBase:.06,edgeLine:.22};function Yt(s){return{...s,tintColor:[...s.tintColor]}}function jt(){return Yt(qt)}function ue(s="regular"){return{...jt(),...Vt[s]||{}}}const et=Object.freeze({refraction:84,edgeReach:.14,edgeWidth:.21,dispersion:2,frost:0,backdropBlur:0,body:.72,absorption:.58,tint:0,rim:.24,reflection:.31,highlight:.34,lightAngle:136,echo:.28,hairline:.92,hairWidth:.52,roundness:.47}),Kt=Object.freeze({refraction:0,edgeReach:0,dispersion:0,frost:0,backdropBlur:0,body:1.5,tint:1.35,reflection:.18,highlight:.12,echo:0}),ys=Object.freeze([["refraction",0,110,1],["edgeReach",0,1.6,.01],["edgeWidth",0,.55,.01],["dispersion",0,7,.1],["frost",0,1,.01],["backdropBlur",0,64,1],["body",0,1.5,.01],["absorption",0,2,.01],["tint",0,1.5,.01],["rim",0,1,.01],["reflection",0,1.5,.01],["highlight",0,1.5,.01],["lightAngle",-180,180,1],["echo",0,1.5,.01],["hairline",0,1.5,.01],["hairWidth",0,1,.01],["roundness",.05,.6,.01]]);function Le(){return{...et}}function $(s={}){if(typeof s=="string")throw new TypeError("Liquid Glass V2 does not use V1 preset names.");const e=Object.keys(s||{}).filter(t=>!(t in et));if(e.length)throw new TypeError(`Unknown Liquid Glass V2 material parameter${e.length===1?"":"s"}: ${e.join(", ")}`);return{...Le(),...s||{}}}const Qt=Object.freeze({rect:0,folder:0,pill:1,circle:2});function Zt(s){return Qt[s]??0}function Ue(s,e,t,i,r){const a=Math.min(r,t,i),n=Math.abs(s)-t+a,l=Math.abs(e)-i+a;return Math.min(Math.max(n,l),0)+Math.hypot(Math.max(n,0),Math.max(l,0))-a}function Jt(s,e=.47){const t=Number(s.w??s.width??s.size??0),i=Number(s.h??s.height??s.size??t);return Number.isFinite(s.radius)?Math.max(0,Math.min(Number(s.radius),Math.min(t,i)*.5)):Math.min(t,i)*.5*e}function tt(s,e,t,i={}){const r=Number(t.w??t.width??t.size??0),a=Number(t.h??t.height??t.size??r),n=r/2,l=a/2,o=s-Number(t.x??0)-n,h=e-Number(t.y??0)-l,c=Zt(t.shape),u=Jt({...t,w:r,h:a},i.roundness??.47);return c===1?Ue(o,h,n,l,Math.min(n,l)):c===2?Math.hypot(o,h)-Math.min(n,l):Ue(o,h,n,l,u)}function ei(s,e,t,i={}){let r=1/0;for(const a of t)r=Math.min(r,tt(s,e,a,i));return r}function ti(s,e,t,i={},r={}){const a=r.tolerance??0;for(let n=t.length-1;n>=0;n--)if(tt(s,e,t[n],i)<=a)return t[n];return null}const ii=new Set(["folder","rect","pill","circle"]),si=new Set(["replace","overlay"]),ri=new Set(["auto","static","live"]),ai="(prefers-reduced-transparency: reduce)";function ni(s){if(!si.has(s))throw new TypeError(`Unknown liquid glass V2 composite mode: ${s}`);return s}function oi(s){const e=s==="folderRect"?"rect":s;if(!ii.has(e))throw new TypeError(`Unknown liquid glass V2 shape: ${s}`);return e}function de(s,e){const t=Number(s.w??s.width??s.size??0),i=Number(s.h??s.height??s.size??t);if(!Number.isFinite(t)||!Number.isFinite(i)||t<0||i<0)throw new TypeError("Liquid glass V2 elements need a finite, non-negative width and height.");const r=s.tint==null?void 0:Number(s.tint);if(r!==void 0&&!Number.isFinite(r))throw new TypeError("Liquid glass V2 element tint must be a finite number.");const a=s.frost==null?void 0:Number(s.frost);if(a!==void 0&&!Number.isFinite(a))throw new TypeError("Liquid glass V2 element frost must be a finite number.");const n=s.opacity==null?void 0:Number(s.opacity),l=Number(s.pressure??0);if(!Number.isFinite(l))throw new TypeError("Liquid glass V2 element pressure must be a finite number.");const o=s.pressureAxes==null?[1,1]:[Number(s.pressureAxes[0]??1),Number(s.pressureAxes[1]??1)];if(!o.every(Number.isFinite))throw new TypeError("Liquid glass V2 element pressureAxes must be two finite numbers.");if(n!==void 0&&!Number.isFinite(n))throw new TypeError("Liquid glass V2 element opacity must be a finite number.");const h=s.tintTone??"light";if(!["auto","light","dark"].includes(h))throw new TypeError(`Unknown liquid glass V2 tint tone: ${h}`);const c=Number(s.layer??0);if(!Number.isInteger(c)||c<0)throw new TypeError("Liquid glass V2 element layer must be a non-negative integer.");return{...s,id:s.id??`glass-v2-${e+1}`,shape:oi(s.shape??"rect"),x:Number(s.x??0),y:Number(s.y??0),w:t,h:i,...r===void 0?{}:{tint:r},...a===void 0?{}:{frost:a},...n===void 0?{}:{opacity:n},tintTone:h,layer:c,pressure:Math.max(0,Math.min(1,l)),pressureAxes:o.map(u=>Math.max(0,Math.min(1,u)))}}function li(s){const e=new Map;for(const t of s){const i=t.layer??0;e.has(i)||e.set(i,[]),e.get(i).push(t)}return[...e.keys()].sort((t,i)=>t-i).map(t=>e.get(t))}function Ie(s){const e=Number(s??1);if(!Number.isFinite(e)||e<=0||e>1)throw new TypeError("Liquid glass V2 backdrop scale must be a number in (0, 1].");return Math.max(.1,e)}function ze(s){return typeof s!="string"?Promise.resolve(s):new Promise((e,t)=>{const i=new Image;i.onload=()=>e(i),i.onerror=()=>t(new Error(`Unable to load liquid glass V2 wallpaper: ${s}`)),i.src=s})}function hi(s){var t,i,r;const e=(t=s==null?void 0:s.tagName)==null?void 0:t.toUpperCase();return e==="CANVAS"||e==="VIDEO"||((i=s==null?void 0:s.constructor)==null?void 0:i.name)==="OffscreenCanvas"||((r=s==null?void 0:s.constructor)==null?void 0:r.name)==="VideoFrame"}function ci(s,e="auto"){if(!ri.has(e))throw new TypeError(`Unknown liquid glass V2 backdrop update mode: ${e}`);return e==="auto"?hi(s)?"live":"static":e}function ui(s){return typeof globalThis.matchMedia=="function"?globalThis.matchMedia(s):null}function Ge(s){return[Number((s==null?void 0:s.videoWidth)||(s==null?void 0:s.naturalWidth)||(s==null?void 0:s.width)||0),Number((s==null?void 0:s.videoHeight)||(s==null?void 0:s.naturalHeight)||(s==null?void 0:s.height)||0)]}function He(s,e,t,i){const r=Math.max(t/s,t/e)*i,a=s*r,n=e*r;return{x:(t-a)/2,y:(t-n)/2,width:a,height:n}}const di=`
let canvas = null;
self.onmessage = ({ data }) => {
  const { id, bitmap, size, x, y, width, height } = data;
  let pixels = null;
  try {
    if (!canvas || canvas.width !== size) canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, size, size);
    context.drawImage(bitmap, x, y, width, height);
    pixels = context.getImageData(0, 0, size, size).data;
  } catch {}
  bitmap.close();
  self.postMessage({ id, pixels }, pixels ? [pixels.buffer] : []);
};`,Ne=84;class oe{static isSupported(){var e;if(typeof document>"u")return!1;try{const i=document.createElement("canvas").getContext("webgl2");return i?((e=i.getExtension("WEBGL_lose_context"))==null||e.loseContext(),!0):!1}catch{return!1}}constructor(e,t={}){var i,r;if(!e||typeof e.getContext!="function")throw new TypeError("LiquidGlassWebGLV2 needs an HTMLCanvasElement.");this.canvas=e,this.version="v2",this.compositeMode=ni(t.compositeMode??"replace"),this.renderer=new Je(e,{alpha:this.compositeMode==="overlay",preserveDrawingBuffer:!!t.preserveDrawingBuffer,materialVersion:2}),this.material=$(t.material),this.elements=[],this.backdrops=[],this.wallpaperIndex=0,this.wallpaperZoom=t.wallpaperZoom??1,this.running=!1,this.animationFrame=0,this.dirty=!0,this.backdropDirty=!0,this.pyramidStale=!1,this.backdropScale=1,this.lightFieldDirty=!0,this.lastFrame={width:0,height:0,dpr:0},this.warnedShapeLimit=!1,this.lightCanvas=null,this.lightPixels=null,this.lightSampleSize=64,this.smoothedLightDirections=new Map,this.lastLightFieldUpdate=0,this.lastLightBlendTime=0,this.lastManualBackdropUpdate=-1/0,this.lightFieldAsyncDirty=!1,this.lightWorker=null,this.lightWorkerUnavailable=!1,this.lightProbeId=0,this.lightProbePending=!1,this.lightProbeQueued=!1,this.settledRenderFrame=0,this.onContextLost=t.onContextLost??null,this.onContextRestored=t.onContextRestored??null,this.respectReducedTransparency=t.respectReducedTransparency??!0,this.reducedTransparencyQuery=this.respectReducedTransparency?ui(ai):null,this.handleReducedTransparencyChange=()=>{this.markDirty(),this.render()},(r=(i=this.reducedTransparencyQuery)==null?void 0:i.addEventListener)==null||r.call(i,"change",this.handleReducedTransparencyChange),this.handleContextLost=a=>{var n;a.preventDefault(),this.renderer.handleContextLost(),this.markBackdropDirty(),(n=this.onContextLost)==null||n.call(this,a)},this.handleContextRestored=a=>{var n;this.renderer.restore(),this.markBackdropDirty(),this.lastFrame={width:0,height:0,dpr:0},(n=this.onContextRestored)==null||n.call(this,a),this.render()},e.addEventListener("webglcontextlost",this.handleContextLost,!1),e.addEventListener("webglcontextrestored",this.handleContextRestored,!1),this.resizeObserver=null,(t.autoResize??!0)&&typeof globalThis.ResizeObserver=="function"&&(this.resizeObserver=new globalThis.ResizeObserver(()=>{this.lightFieldDirty=!0,this.markDirty(),this.render()}),this.resizeObserver.observe(e)),t.elements&&this.setElements(t.elements,!1),t.wallpapers&&this.setWallpapers(t.wallpapers,!1),t.backdrop&&this.setBackdrop(t.backdrop,{update:t.backdropUpdate,autoStart:t.autoStart,shouldRender:!1})}get contextLost(){return this.renderer.lost}get reducedTransparency(){var e;return!!((e=this.reducedTransparencyQuery)!=null&&e.matches)}get effectiveMaterial(){return this.reducedTransparency?{...this.material,...Kt}:this.material}markDirty(){return this.dirty=!0,this}markBackdropDirty(){return this.backdropDirty=!0,this.lightFieldDirty=!0,this.lastLightFieldUpdate=0,this.smoothedLightDirections.clear(),this.markDirty()}setElements(e,t=!0){return this.elements=e.map((i,r)=>de(i,r)),this.markDirty(),t&&this.render(),this}addElement(e,t=!0){const i=de(e,this.elements.length);return this.elements.push(i),this.markDirty(),t&&this.render(),i.id}updateElement(e,t,i=!0){const r=this.elements.findIndex(a=>a.id===e);return r===-1?this:(this.elements[r]=de({...this.elements[r],...t},r),this.markDirty(),i&&this.render(),this)}removeElement(e,t=!0){return this.elements=this.elements.filter(i=>i.id!==e),this.markDirty(),t&&this.render(),this}setMaterial(e,t=!0){if(typeof e=="string")throw new TypeError("Liquid Glass V2 does not convert V1 preset names. Pass a V2 material object.");return this.material=$({...this.material,...e||{}}),this.markDirty(),t&&this.render(),this}setWallpapers(e,t=!0){return this.backdrops=e.slice(),this.renderer.setWallpapers(e,{update:"static"}),this.markBackdropDirty(),t&&this.render(),this}async loadWallpapers(e,t=!0){const i=await Promise.all(e.map(ze));return this.setWallpapers(i,t)}async setWallpaper(e,t=!0){return this.loadWallpapers([e],t)}setBackdrop(e,t={}){if(!e||typeof e=="string")throw new TypeError("setBackdrop needs a CanvasImageSource. Use loadBackdrop for a URL.");const i=ci(e,t.update);return t.scale!==void 0&&(this.backdropScale=Ie(t.scale)),this.backdrops=[e],this.renderer.setWallpapers([e],{update:i,scale:this.backdropScale}),this.wallpaperIndex=0,this.markBackdropDirty(),(t.autoStart??i==="live")&&this.start(),(t.shouldRender??!0)&&this.render(),this}setBackdropScale(e,t=!0){const i=Ie(e);return i===this.backdropScale?this:(this.backdropScale=i,this.renderer.setWallpaperScale(i)&&!this.renderer.hasLiveBackdrop()&&this.renderer.refreshWallpapers(!0),this.markBackdropDirty(),t&&this.render(),this)}async loadBackdrop(e,t={}){const i=await ze(e);return this.setBackdrop(i,{...t,update:t.update??"static"})}updateBackdrop(e=!0){var r,a;this.renderer.refreshWallpapers(!0);const t=((a=(r=globalThis.performance)==null?void 0:r.now)==null?void 0:a.call(r))??Date.now(),i=t-this.lastManualBackdropUpdate<Ne;return this.lastManualBackdropUpdate=t,i&&this.lightProbeWorker()?(this.backdropDirty=!0,this.lightFieldAsyncDirty=!0,this.markDirty()):this.markBackdropDirty(),e&&this.render(),this}setWallpaperIndex(e,t=!0){return this.wallpaperIndex=Math.max(0,Math.floor(e)),this.markBackdropDirty(),t&&this.render(),this}distanceAt(e,t){return ei(e,t,this.elements,this.material)}hitTest(e,t,i={}){return ti(e,t,this.elements,this.material,i)}pointerPosition(e){var r,a;const t=this.canvas.getBoundingClientRect(),i=((r=e.touches)==null?void 0:r[0])??((a=e.changedTouches)==null?void 0:a[0])??e;return{x:i.clientX-t.left,y:i.clientY-t.top}}hitTestEvent(e,t={}){const{x:i,y:r}=this.pointerPosition(e),a=t.tolerance??(e.pointerType&&e.pointerType!=="mouse"?8:0);return this.hitTest(i,r,{...t,tolerance:a})}start(){if(this.running)return this;if(typeof globalThis.requestAnimationFrame!="function")throw new Error("LiquidGlassWebGLV2.start() requires requestAnimationFrame.");this.running=!0;const e=()=>{this.running&&(this.render(),this.animationFrame=globalThis.requestAnimationFrame(e))};return this.animationFrame=globalThis.requestAnimationFrame(e),this}stop(){return this.running=!1,this.animationFrame&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(this.animationFrame),this.animationFrame=0,this}resize(e=this.canvas.clientWidth||this.canvas.width||1,t=this.canvas.clientHeight||this.canvas.height||1,i=Math.min(globalThis.devicePixelRatio||1,2)){return this.renderer.resize(Math.round(e*i),Math.round(t*i)),{width:e,height:t,dpr:i}}probeSource(){return this.renderer.probeSource(this.wallpaperIndex)??this.backdrops[this.wallpaperIndex]}updateLightField(){this.lightFieldDirty=!1,this.lightProbeId+=1,this.lightProbeQueued=!1;const e=this.probeSource(),[t,i]=Ge(e);if(!(t>0)||!(i>0)||typeof document>"u"){this.lightPixels=null;return}this.lightCanvas||(this.lightCanvas=document.createElement("canvas"));const r=this.lightSampleSize;this.lightCanvas.width=r,this.lightCanvas.height=r;const a=this.lightCanvas.getContext("2d",{willReadFrequently:!0});if(!a){this.lightPixels=null;return}a.clearRect(0,0,r,r);const n=He(t,i,r,this.wallpaperZoom);try{a.drawImage(e,n.x,n.y,n.width,n.height),this.lightPixels=a.getImageData(0,0,r,r).data}catch{this.lightPixels=null}}lightProbeWorker(){var r;if(this.lightWorker||this.lightWorkerUnavailable)return this.lightWorker;if(typeof globalThis.Worker!="function"||typeof globalThis.OffscreenCanvas!="function"||typeof globalThis.createImageBitmap!="function"||typeof globalThis.Blob!="function"||typeof((r=globalThis.URL)==null?void 0:r.createObjectURL)!="function")return this.lightWorkerUnavailable=!0,null;let e="";const t=()=>{e&&globalThis.URL.revokeObjectURL(e),e=""};try{e=globalThis.URL.createObjectURL(new globalThis.Blob([di],{type:"text/javascript"})),this.lightWorker=new globalThis.Worker(e)}catch{return t(),this.lightWorkerUnavailable=!0,null}const i=()=>{var a;(a=this.lightWorker)==null||a.terminate(),this.lightWorker=null,this.lightWorkerUnavailable=!0,this.lightProbePending=!1,this.lightFieldDirty=!0,this.markDirty()};return this.lightWorker.onerror=()=>{t(),i()},this.lightWorker.onmessage=({data:a})=>{if(t(),this.lightProbePending=!1,!a.pixels){i();return}a.id===this.lightProbeId&&(this.lightPixels=a.pixels,this.markDirty(),this.lightProbeQueued&&(this.lightProbeQueued=!1,this.requestLightField({queue:!0})),this.renderer.hasLiveBackdrop()||this.scheduleSettledRender())},this.lightWorker}requestLightField({queue:e=!1}={}){if(this.lightProbePending)return e&&(this.lightProbeQueued=!0),!0;const t=this.probeSource(),[i,r]=Ge(t);if(!(i>0)||!(r>0)||!this.lightProbeWorker())return!1;const a=++this.lightProbeId,n=this.lightSampleSize,l=He(i,r,n,this.wallpaperZoom);return this.lightProbePending=!0,globalThis.createImageBitmap(t).then(o=>{if(a!==this.lightProbeId||!this.lightWorker){o.close(),a===this.lightProbeId&&(this.lightProbePending=!1);return}this.lightWorker.postMessage({id:a,bitmap:o,size:n,...l},[o])},()=>{a===this.lightProbeId&&(this.lightProbePending=!1)}),!0}scheduleSettledRender(){this.settledRenderFrame||typeof globalThis.requestAnimationFrame!="function"||(this.settledRenderFrame=globalThis.requestAnimationFrame(()=>{this.settledRenderFrame=0,this.dirty&&this.render({dpr:this.lastFrame.dpr||void 0})}))}sampleLuminance(e,t){if(!this.lightPixels)return .5;const i=this.lightSampleSize,r=Math.max(0,Math.min(i-1,Math.round(e*(i-1)))),n=(Math.max(0,Math.min(i-1,Math.round(t*(i-1))))*i+r)*4;return(this.lightPixels[n]*.2126+this.lightPixels[n+1]*.7152+this.lightPixels[n+2]*.0722)/255}lightDirection(e,t,i,r){const a=[-.34,0,.34];let n=0,l=0;for(const R of a)for(const E of a){const v=(e.x+e.w*(.5+E))/Math.max(t,1),p=(e.y+e.h*(.5+R))/Math.max(i,1),A=this.sampleLuminance(v,p);n+=E*A,l+=R*A}const o=r*Math.PI/180,h=Math.cos(o),c=Math.sin(o),u=Math.hypot(n,l)/a.length;if(u<.008)return[h,c];const m=Math.hypot(n,l)||1,d=-n/m,f=l/m,y=Math.max(0,Math.min(1,(u-.015)/.13)),g=y*y*(3-2*y)*.58,b=h*(1-g)+d*g,S=c*(1-g)+f*g,x=Math.hypot(b,S)||1;return[b/x,S/x]}tintLightForElement(e,t,i){if(e.tintTone==="light")return 1;if(e.tintTone==="dark")return 0;const r=[-24,0,24],a=e.x+e.w*.5,n=e.y+e.h*.5;let l=0;for(const c of r)for(const u of r){const m=(a+u)/Math.max(t,1),d=(n+c)/Math.max(i,1);l+=this.sampleLuminance(m,d)}const o=l/(r.length*r.length),h=Math.max(0,Math.min(1,(o-.22)/(.5-.22)));return h*h*(3-2*h)}render(e={}){var R,E;if(this.renderer.lost)return this;const t=this.canvas.clientWidth||this.canvas.width||1,i=this.canvas.clientHeight||this.canvas.height||1,r=Number(e.dpr??globalThis.devicePixelRatio??1),a=Math.max(.5,Math.min(Number.isFinite(r)?r:1,2)),n=t!==this.lastFrame.width||i!==this.lastFrame.height||a!==this.lastFrame.dpr,l=this.renderer.hasLiveBackdrop();if(!e.force&&!this.dirty&&!n&&!l)return this;this.resize(t,i,a);const o=li(this.elements.filter(v=>v.w>0&&v.h>0));if(this.compositeMode==="overlay"&&!o.length)return this.renderer.clearOutput(),n&&(this.pyramidStale=!0),this.dirty=!1,this.lastFrame={width:t,height:i,dpr:a},this;const h=((E=(R=globalThis.performance)==null?void 0:R.now)==null?void 0:E.call(R))??Date.now(),c=this.backdropDirty||n||l;if((c||this.pyramidStale)&&(this.renderer.buildBackdrop(this.wallpaperIndex,this.wallpaperZoom),this.pyramidStale=!1),c){const v=l&&h-this.lastLightFieldUpdate>=Ne;if(this.lightFieldDirty||n)this.updateLightField(),this.lastLightFieldUpdate=h;else if(v||this.lightFieldAsyncDirty){const p=this.lightFieldAsyncDirty;this.lightFieldAsyncDirty=!1,this.requestLightField({queue:p})||this.updateLightField(),this.lastLightFieldUpdate=h}this.backdropDirty=!1}this.compositeMode==="overlay"?this.renderer.clearOutput():this.renderer.drawBackdrop();const u=this.effectiveMaterial,m=o.flat(),d=this.lastLightBlendTime?Math.min(100,h-this.lastLightBlendTime):100,f=l?1-Math.exp(-d/280):1,y=new Set(m.map(v=>v.id));for(const v of this.smoothedLightDirections.keys())y.has(v)||this.smoothedLightDirections.delete(v);const g=m.map(v=>{const p=this.lightDirection(v,t,i,u.lightAngle),A=this.smoothedLightDirections.get(v.id);if(!A||f>=1)return this.smoothedLightDirections.set(v.id,p),p;const k=A[0]*(1-f)+p[0]*f,B=A[1]*(1-f)+p[1]*f,L=Math.hypot(k,B)||1,M=[k/L,B/L];return this.smoothedLightDirections.set(v.id,M),M}),b=m.map(v=>this.tintLightForElement(v,t,i));this.lastLightBlendTime=h,o.some(v=>v.length>16)&&!this.warnedShapeLimit&&(this.warnedShapeLimit=!0,console.warn("LiquidGlassWebGLV2: more than 16 shapes require multiple passes; overlapping shapes across a pass boundary may composite differently."));const S=(v,p,A)=>{for(let k=0;k<v.length;k+=16)this.renderer.drawGlassV2Group(v.slice(k,k+16),u,a,g.slice(p+k,p+k+16),b.slice(p+k,p+k+16),{intoBackdrop:A})};let x=0;return o.forEach((v,p)=>{S(v,x,!1),p<o.length-1&&this.renderer.beginBackdropLayer()&&(S(v,x,!0),this.renderer.commitBackdropLayer(),this.pyramidStale=!0),x+=v.length}),this.dirty=!1,this.lastFrame={width:t,height:i,dpr:a},this}destroy(){var e,t,i,r;this.stop(),this.lightProbeId+=1,this.settledRenderFrame&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(this.settledRenderFrame),this.settledRenderFrame=0,(e=this.lightWorker)==null||e.terminate(),this.lightWorker=null,this.lightProbePending=!1,this.canvas.removeEventListener("webglcontextlost",this.handleContextLost,!1),this.canvas.removeEventListener("webglcontextrestored",this.handleContextRestored,!1),(i=(t=this.reducedTransparencyQuery)==null?void 0:t.removeEventListener)==null||i.call(t,"change",this.handleReducedTransparencyChange),(r=this.resizeObserver)==null||r.disconnect(),this.resizeObserver=null,this.renderer.destroy(),this.elements=[],this.backdrops=[],this.lightPixels=null,this.lightCanvas=null,this.smoothedLightDirections.clear()}}const X=new Set,I=new Map;let K=0,xe=0,le=!1,F=null,Q=0;const he=()=>Q;function fi(){Q++,C(34)}const it=()=>{var s,e;return((e=(s=globalThis.performance)==null?void 0:s.now)==null?void 0:e.call(s))??Date.now()};function Me(){!K&&typeof globalThis.requestAnimationFrame=="function"&&(K=globalThis.requestAnimationFrame(mi))}function C(s=0){xe=Math.max(xe,it()+s),Me()}function pi(){for(const s of I.keys())s.isConnected||I.delete(s);return I.size>0}function mi(){K=0;const s=it();I.size&&Q++;const e=[];for(const i of X)i.visible&&e.push(i);for(const i of e)try{i.measure(s)}catch(r){console.error(r)}let t=!1;for(const i of e)try{i.draw(s)&&(t=!0)}catch(r){console.error(r)}(t||s<xe||pi())&&Me()}function gi(s){if(!s||typeof s.contains!="function")return!1;for(const e of X)for(const t of e.trackedElements())if(s===t||s.contains(t))return!0;return!1}const st=()=>{Q++,C(160)},rt=()=>{Q++,X.forEach(s=>{var e;return(e=s.onViewportResize)==null?void 0:e.call(s)}),C(320)},at=s=>{gi(s.target)&&(I.set(s.target,(I.get(s.target)??0)+1),Me())},nt=s=>{const e=I.get(s.target);e&&(e<=1?I.delete(s.target):I.set(s.target,e-1),C(34))},ot=()=>{Q++,C(200)};function vi(){var e,t;if(le||typeof globalThis.addEventListener!="function")return;le=!0;const s={capture:!0,passive:!0};globalThis.addEventListener("scroll",st,s),globalThis.addEventListener("resize",rt,{passive:!0});for(const i of["transitionrun","animationstart"])document.addEventListener(i,at,!0);for(const i of["transitionend","transitioncancel","animationend","animationcancel"])document.addEventListener(i,nt,!0);(t=(e=document.fonts)==null?void 0:e.addEventListener)==null||t.call(e,"loadingdone",ot),typeof globalThis.IntersectionObserver=="function"&&(F=new globalThis.IntersectionObserver(i=>{for(const r of i)for(const a of X)a.element===r.target&&(a.visible=r.isIntersecting);C(64)},{rootMargin:"256px"}))}function bi(){var s,e;if(le){le=!1,globalThis.removeEventListener("scroll",st,!0),globalThis.removeEventListener("resize",rt);for(const t of["transitionrun","animationstart"])document.removeEventListener(t,at,!0);for(const t of["transitionend","transitioncancel","animationend","animationcancel"])document.removeEventListener(t,nt,!0);(e=(s=document.fonts)==null?void 0:s.removeEventListener)==null||e.call(s,"loadingdone",ot),F==null||F.disconnect(),F=null,I.clear(),K&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(K),K=0}}function lt(s){X.add(s),s.visible=!0,vi(),F==null||F.observe(s.element),C(120)}function ht(s){X.delete(s)&&(F==null||F.unobserve(s.element),X.size||bi())}function yi(s){X.forEach(s)}const Ce="data-liquid-glass-layer",xi=/(^(data|blob|https?):)|\/|\.(avif|webp|png|apng|jpe?g|gif|svg|bmp|ico)([?#]|$)/i,ct=new Set(["IMG","VIDEO","CANVAS"]),U=s=>typeof Element<"u"&&s instanceof Element,Oe=new Map,ce=new Set;function ut(s){return ce.add(s),()=>ce.delete(s)}function dt(s){let e=Oe.get(s);if(e)return e;const t=new Image;return t.crossOrigin="anonymous",t.decoding="async",e={url:s,image:t,state:"loading"},e.promise=new Promise(i=>{t.onload=()=>{e.state="ready",i(e),ce.forEach(r=>r(e))},t.onerror=()=>{e.state="error",console.warn(`LiquidGlass: could not load backdrop image ${s} (a cross-origin image needs CORS headers).`),i(e),ce.forEach(r=>r(e))}}),t.src=s,Oe.set(s,e),e}function wi(s){var t;if(!s)return[0,0];const e=(t=s.tagName)==null?void 0:t.toUpperCase();return e==="IMG"?s.complete?[s.naturalWidth,s.naturalHeight]:[0,0]:e==="VIDEO"?s.readyState>=2?[s.videoWidth,s.videoHeight]:[0,0]:[Number(s.displayWidth??s.width??0),Number(s.displayHeight??s.height??0)]}function _(s,e){const t=[];let i=0,r=0;for(let a=0;a<s.length;a++){const n=s[a];n==="("?i++:n===")"?i--:i===0&&(e===" "?/\s/.test(n):n===e)&&(t.push(s.slice(r,a)),r=a+1)}return t.push(s.slice(r)),t.map(a=>a.trim()).filter(Boolean)}function q(s="0%"){if(s==="left"||s==="top")return{ratio:0,px:0};if(s==="center")return{ratio:.5,px:0};if(s==="right"||s==="bottom")return{ratio:1,px:0};const e={ratio:0,px:0},t=/([-+])?\s*(\d*\.?\d+(?:e[-+]?\d+)?)(%|px)?/gi;for(let i=t.exec(s);i;i=t.exec(s)){const r=Number(i[2])*(i[1]==="-"?-1:1);i[3]==="%"?e.ratio+=r/100:e.px+=r}return e}const P=({ratio:s,px:e},t)=>s*t+e;function N(s="50% 50%"){const e=_(s," ");return e.length===1&&e.push("50%"),[q(e[0]),q(e[1])]}function Si(s){return Array.isArray(s)?s.map(e=>typeof e=="number"?{ratio:e,px:0}:q(String(e))):N(s??"50% 50%")}function Ti(s,e,t,i="cover",r=N()){let a=t.width,n=t.height;if(i==="cover"||i==="contain"){const l=(i==="cover"?Math.max:Math.min)(t.width/s,t.height/e);a=s*l,n=e*l}else if(i==="none"||i==="scale-down"){const l=i==="none"?1:Math.min(1,t.width/s,t.height/e);a=s*l,n=e*l}return{x:t.x+P(r[0],t.width-a),y:t.y+P(r[1],t.height-n),width:a,height:n}}const Ei=new Set(["multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light","difference","exclusion","hue","saturation","color","luminosity"]);function ft(s,e){Ei.has(e.mixBlendMode)&&(s.globalCompositeOperation=e.mixBlendMode)}const O=s=>!s||s==="transparent"||/^rgba\([^)]*,\s*0(\.0*)?\s*\)$/.test(s)||/\/\s*0(\.0*)?%?\s*\)$/.test(s);function Ri(s,e){const t=(i,r)=>{const a=_(i||"0"," ")[0];return Math.max(0,P(q(a),r))};return[t(s.borderTopLeftRadius,e.width),t(s.borderTopRightRadius,e.width),t(s.borderBottomRightRadius,e.width),t(s.borderBottomLeftRadius,e.width)]}function Ai(s,e,t){s.beginPath(),t!=null&&t.some(i=>i>0)&&typeof s.roundRect=="function"?s.roundRect(e.x,e.y,e.width,e.height,t):s.rect(e.x,e.y,e.width,e.height),s.clip()}const ie=s=>{const e=s.getBoundingClientRect();return{x:e.left,y:e.top,width:e.width,height:e.height}},we=()=>({x:0,y:0,width:globalThis.innerWidth||document.documentElement.clientWidth,height:globalThis.innerHeight||document.documentElement.clientHeight});function ki(s,e){const t=ie(s),i=s.offsetWidth?t.width/s.offsetWidth:1,r=s.offsetHeight?t.height/s.offsetHeight:1,a=(parseFloat(e.borderLeftWidth)||0)+(parseFloat(e.paddingLeft)||0),n=(parseFloat(e.borderTopWidth)||0)+(parseFloat(e.paddingTop)||0),l=(parseFloat(e.borderRightWidth)||0)+(parseFloat(e.paddingRight)||0),o=(parseFloat(e.borderBottomWidth)||0)+(parseFloat(e.paddingBottom)||0);return{x:t.x+a*i,y:t.y+n*r,width:Math.max(0,t.width-(a+l)*i),height:Math.max(0,t.height-(n+o)*r)}}function pt(s,e){const t=[];for(const i of s){const r=_(i," "),a=[];for(;r.length>1&&/(%|px)$|^calc\(/.test(r[r.length-1]);)a.unshift(r.pop());const n=r.join(" ");a.length||t.push({color:n,offset:null});for(const l of a)t.push({color:n,offset:P(q(l),e)/Math.max(e,1e-6)})}if(!t.length)return t;t[0].offset===null&&(t[0].offset=0),t.at(-1).offset===null&&(t.at(-1).offset=1);for(let i=1;i<t.length;i++){if(t[i].offset!==null){t[i].offset=Math.max(t[i].offset,t[i-1].offset);continue}let r=i;for(;t[r].offset===null;)r++;const a=t[i-1].offset,n=Math.max(t[r].offset,a);for(let l=i;l<r;l++)t[l].offset=a+(n-a)*(l-i+1)/(r-i+1)}return t}function mt(s){if(s.length<2)return s;const e=s[0].offset,t=s.at(-1).offset-e;if(!(t>5e-4))return s;const i=[];for(let r=Math.floor(-e/t);r<=Math.ceil((1-e)/t);r++)for(const a of s){const n=a.offset+r*t;n<-t||n>1+t||i.push({color:a.color,offset:Math.min(1,Math.max(0,n))})}return i.length>=2?i:s}function gt(s,e){for(const t of e)try{s.addColorStop(Math.min(1,Math.max(0,t.offset)),t.color)}catch{}return s}function Li(s){const e=/^(-?\d*\.?\d+)(deg|turn|rad|grad)$/.exec(s);if(!e)return null;const t=Number(e[1]);return{deg:t,turn:t*360,rad:t*180/Math.PI,grad:t*.9}[e[2]]}function Mi(s,e,t,i=!1){const r=_(e,",");let a=180;const n=r[0]??"",l=Li(n);if(l!==null)a=l,r.shift();else if(/^to\s/.test(n)){const y=n.slice(3).trim().split(/\s+/),g=y.includes("right")?1:y.includes("left")?-1:0,b=y.includes("bottom")?1:y.includes("top")?-1:0,S=g&&b?g*t.height:g,x=g&&b?b*t.width:b;a=Math.atan2(S,-x)*180/Math.PI,r.shift()}else/^in\s/.test(n)&&r.shift();const o=a*Math.PI/180,h=Math.abs(t.width*Math.sin(o))+Math.abs(t.height*Math.cos(o)),c=t.x+t.width/2,u=t.y+t.height/2,m=Math.sin(o)*h/2,d=-Math.cos(o)*h/2,f=pt(r,h);s.fillStyle=gt(s.createLinearGradient(c-m,u-d,c+m,u+d),i?mt(f):f),s.fillRect(t.x,t.y,t.width,t.height)}function Ci(s,e,t,i=!1){const r=_(e,","),a=r[0]??"";let n=!1,l="farthest-corner",o=null,h=N("50% 50%");if(!(/^(rgb|hsl|hwb|lab|lch|oklab|oklch|color|#|transparent|currentcolor)/i.test(a)||!/(circle|ellipse|closest|farthest|at\s|\d(px|%))/.test(a))){r.shift();const[E,v]=a.split(/\s*\bat\b\s*/);v&&(h=N(v));for(const p of _(E??""," "))p==="circle"?n=!0:p==="ellipse"?n=!1:/^(closest|farthest)-(side|corner)$/.test(p)?l=p:/(px|%)$/.test(p)&&(o??(o=[])).push(q(p));(o==null?void 0:o.length)===1&&(n=!0)}const u=t.x+P(h[0],t.width),m=t.y+P(h[1],t.height),d=u-t.x,f=t.x+t.width-u,y=m-t.y,g=t.y+t.height-m;let b,S;if(o)b=P(o[0],t.width),S=o[1]?P(o[1],t.height):b;else{const E=l.startsWith("closest")?Math.min:Math.max,v=E(Math.abs(d),Math.abs(f)),p=E(Math.abs(y),Math.abs(g));if(n)b=l.endsWith("side")?E(v,p):Math.hypot(v,p),S=b;else{const A=l.endsWith("corner")?Math.SQRT2:1;b=v*A,S=p*A}}b=Math.max(b,.001),S=Math.max(S,.001),s.save(),s.beginPath(),s.rect(t.x,t.y,t.width,t.height),s.clip(),s.translate(u,m),s.scale(1,S/b);const x=pt(r,b);s.fillStyle=gt(s.createRadialGradient(0,0,0,0,0,b),i?mt(x):x);const R=Math.max(t.width,t.height)*2+Math.abs(u)+Math.abs(m);s.fillRect(-R,-R*b/S,R*2,R*2*b/S),s.restore()}function Bi(s,e,t){const[i,r]=t??[0,0],a=i>0&&r>0;if(s==="cover"||s==="contain"){if(!a)return[e.width,e.height];const c=(s==="cover"?Math.max:Math.min)(e.width/i,e.height/r);return[i*c,r*c]}const[n="auto",l="auto"]=_(s||"auto"," ");let o=n==="auto"?null:P(q(n),e.width),h=l==="auto"?null:P(q(l),e.height);return o===null&&h===null?a?[i,r]:[e.width,e.height]:(o===null&&(o=a?h*i/r:e.width),h===null&&(h=a?o*r/i:e.height),[o,h])}function Di(s,e,t,i,r){const a=/^url\((['"]?)(.*)\1\)$/.exec(e),n=/^(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(e);if(!a&&!n)return!0;let l=null;if(a&&(l=dt(a[2]),l.state!=="ready"))return l.state!=="loading";const o=l?[l.image.naturalWidth,l.image.naturalHeight]:null;if(l&&!(o[0]>0&&o[1]>0))return!0;const h=t.attachment==="fixed"?we():i,[c,u]=Bi(t.size,h,o);if(!(c>.5&&u>.5))return!0;const m=N(t.position),d=h.x+P(m[0],h.width-c),f=h.y+P(m[1],h.height-u),[y,g]=(()=>{const B=_(t.repeat||"repeat"," ");if(B[0]==="repeat-x")return[!0,!1];if(B[0]==="repeat-y")return[!1,!0];const L=B[0]!=="no-repeat",M=(B[1]??B[0])!=="no-repeat";return[L,M]})(),b=Math.max(i.x,r.x),S=Math.min(i.x+i.width,r.x+r.width),x=Math.max(i.y,r.y),R=Math.min(i.y+i.height,r.y+r.height);if(b>=S||x>=R)return!0;const E=y?d+Math.floor((b-d)/c)*c:d,v=g?f+Math.floor((x-f)/u)*u:f,p=y?S:d+1,A=g?R:f+1;let k=0;for(let B=v;B<A&&k<1024;B+=u)for(let L=E;L<p&&k<1024;L+=c){k++;const M={x:L,y:B,width:c,height:u};l?s.drawImage(l.image,L,B,c,u):n[2]==="linear"?Mi(s,n[3],M,!!n[1]):Ci(s,n[3],M,!!n[1])}return!0}function vt(s,e,t,{canvas:i=!1}={}){const r=getComputedStyle(e);if(r.display==="none")return!0;const a=ie(e),n=i?1:Number(r.opacity);if(!(n>.004))return!0;const l=r.backgroundImage&&r.backgroundImage!=="none"?_(r.backgroundImage,","):[],o=r.backgroundColor;if(!l.length&&O(o))return!0;s.save(),s.globalAlpha*=Number.isFinite(n)?n:1,i||ft(s,r),i?(s.beginPath(),s.rect(t.x,t.y,t.width,t.height),s.clip()):Ai(s,a,Ri(r,a)),O(o)||(s.fillStyle=o,s.fillRect(t.x,t.y,t.width,t.height));const h=g=>_(g||"",","),c=h(r.backgroundSize),u=h(r.backgroundPosition),m=h(r.backgroundRepeat),d=h(r.backgroundAttachment),f=(g,b,S)=>g.length?g[b%g.length]:S;let y=!0;for(let g=l.length-1;g>=0;g--)y=Di(s,l[g],{size:f(c,g,"auto"),position:f(u,g,"0% 0%"),repeat:f(m,g,"repeat"),attachment:f(d,g,"scroll")},i?ie(document.documentElement):a,t)&&y;return s.restore(),y}function bt(s,e,t,i,r,a){const[n,l]=wi(e);if(!(n>0&&l>0)||!(t.width>0&&t.height>0)||t.x>=a.x+a.width||t.x+t.width<=a.x||t.y>=a.y+a.height||t.y+t.height<=a.y)return;const o=Ti(n,l,t,i,r);s.save(),s.beginPath(),s.rect(t.x,t.y,t.width,t.height),s.clip();try{s.drawImage(e,o.x,o.y,o.width,o.height)}catch{}s.restore()}function yt(s,e,t){const{element:i}=e,r=getComputedStyle(i);if(r.display==="none"||r.visibility==="hidden")return;const a=Number(r.opacity);if(!(a>.004))return;s.save(),s.globalAlpha*=Number.isFinite(a)?a:1,ft(s,r);const n=e.anchor?xt(e.anchor):ki(i,r);bt(s,i,n,e.fit??r.objectFit??"fill",e.position??N(r.objectPosition),t),s.restore()}function xt(s){return s==="viewport"||s==null?we():s==="document"?ie(document.documentElement):U(s)?ie(s):we()}function wt(s,{allowUrl:e=!0}={}){let t=null;try{t=document.querySelector(s)}catch{t=null}return t||(e&&xi.test(s)?{url:s}:{missing:s})}function Pi(s,e={}){return ct.has(s.tagName.toUpperCase())?{kind:"media",element:s,...e}:{kind:"css",element:s}}function St(s){return s&&typeof s=="object"&&!U(s)&&("width"in s||"displayWidth"in s)&&!("source"in s)}function se(s){if(s==null||s==="auto")return[{kind:"auto"}];if(Array.isArray(s))return s.flatMap(e=>se(e));if(typeof s=="function")return[{kind:"paint",paint:s}];if(typeof s=="string")return[{kind:"ref",ref:s}];if(U(s))return[{kind:"ref",ref:s}];if(St(s))return[{kind:"source",source:s,fit:"cover",position:N(),anchor:"viewport"}];if(typeof s=="object"){if(s.color&&!s.source)return[{kind:"color",color:s.color}];if(s.source!=null)return[{kind:"ref",ref:s.source,fit:s.fit,position:s.position==null?void 0:Si(s.position),anchor:s.anchor,opacity:s.opacity}]}throw new TypeError("LiquidGlass: unsupported backdrop. Use an element, selector, image URL, canvas/video/image, painter function, or { source, fit, anchor }.")}function _i(s){const e=document.documentElement,t=getComputedStyle(e);return[{kind:"css",element:t.backgroundImage!=="none"||!O(t.backgroundColor)||!document.body?e:document.body,canvas:!0},{kind:"page",host:s}]}function Se(s,e){const t=[];for(const i of s){if(i.kind==="auto"){t.push(..._i(e));continue}if(i.kind!=="ref"){t.push(i);continue}let r=i.ref;if(typeof r=="string"){const n=wt(r);if(n.missing){t.push({kind:"missing",ref:r});continue}r=n}const a={...i.fit?{fit:i.fit}:{},...i.position?{position:i.position}:{},...i.anchor!=null?{anchor:Fi(i.anchor)}:{},...i.opacity!=null?{opacity:i.opacity}:{}};r!=null&&r.url?t.push({kind:"source",entry:dt(r.url),fit:"cover",position:N(),anchor:"viewport",...a}):U(r)&&r.isConnected?t.push(Pi(r,a)):(St(r)||U(r)&&ct.has(r.tagName.toUpperCase()))&&t.push({kind:"source",source:r,fit:"cover",position:N(),anchor:"viewport",...a})}return t}function Fi(s){if(typeof s!="string"||s==="viewport"||s==="document")return s;const e=wt(s,{allowUrl:!1});return U(e)?e:"viewport"}function Ui(){var t;const s=getComputedStyle(document.documentElement).colorScheme||"";return/dark/.test(s)&&!/light/.test(s)||/dark/.test(s)&&((t=globalThis.matchMedia)==null?void 0:t.call(globalThis,"(prefers-color-scheme: dark)").matches)?"#121212":"#ffffff"}function Ii(s,e,t){let i=!0;s.save(),s.fillStyle=Ui(),s.fillRect(t.x,t.y,t.width,t.height);for(const r of e){s.save();try{switch(r.opacity!=null&&(s.globalAlpha*=r.opacity),r.kind){case"css":i=vt(s,r.element,t,{canvas:r.canvas})&&i;break;case"media":yt(s,r,t);break;case"source":{const a=r.entry?r.entry.image:r.source;if(r.entry&&r.entry.state!=="ready"){i=i&&r.entry.state!=="loading";break}bt(s,a,xt(r.anchor),r.fit,r.position,t);break}case"color":s.fillStyle=r.color,s.fillRect(t.x,t.y,t.width,t.height);break;case"paint":r.paint(s,{...t});break;case"page":i=Ji(s,t,r.host)&&i;break;default:break}}finally{s.restore()}}return s.restore(),i}function Tt(s,e,t,i,r){const a=t.width>0?t.screenWidth/t.width:1,n=t.height>0?t.screenHeight/t.height:1;return s.setTransform(r/a,0,0,r/n,r*(i-t.x/a),r*(i-t.y/n)),Ii(s,e,{x:t.x-i*a,y:t.y-i*n,width:(t.width+i*2)*a,height:(t.height+i*2)*n})}function Et(s){return s.some(e=>{var a,n;if(e.kind==="page")return ts(e.host);const t=e.kind==="media"?e.element:e.kind==="source"?e.source:null;if(!t)return!1;const i=(a=t.tagName)==null?void 0:a.toUpperCase();if(i==="VIDEO")return!t.paused&&!t.ended;if(i==="CANVAS")return!0;const r=(n=t.constructor)==null?void 0:n.name;return r==="OffscreenCanvas"||r==="VideoFrame"})}function Te(s){return s.flatMap(e=>e.kind==="media"||e.kind==="css"&&!e.canvas?[e.element]:[])}function zi(s){return s.filter(e=>e.kind==="missing").map(e=>e.ref)}const Gi="[data-liquid-glass], [data-liquid-glass-control]",Hi=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","HEAD","META","LINK","TITLE","BR","WBR","IFRAME","OBJECT","EMBED","INPUT","TEXTAREA","SELECT","OPTION","BUTTON"]),Ni=new Set(["IMG","VIDEO","CANVAS"]),Oi="http://www.w3.org/1999/xhtml",Wi=-.6,We=-.4;let H=null,re=!0,Xe=!1,fe=null;const Ee=new Map;function Rt(s,e){const t=Math.min(s.length,e.length);for(let i=0;i<t;i++){if(s[i][0]!==e[i][0])return s[i][0]-e[i][0];if(s[i][1]!==e[i][1])return s[i][1]-e[i][1]}return s.length-e.length}const qe=s=>s.backgroundImage!=="none"||!O(s.backgroundColor),Xi=s=>["Top","Right","Bottom","Left"].some(e=>parseFloat(s[`border${e}Width`])>0&&s[`border${e}Style`]!=="none"&&!O(s[`border${e}Color`]));function qi(s,e){return e&&s.zIndex!=="auto"||s.position==="fixed"||s.position==="sticky"||Number(s.opacity)<1||s.transform!=="none"||s.filter!=="none"||s.isolation==="isolate"||s.mixBlendMode!=="normal"||s.backdropFilter&&s.backdropFilter!=="none"||/paint|strict|content/.test(s.contain||"")}function Vi(s){const e=s.fontStyle.startsWith("oblique")?"italic":s.fontStyle,t=s.fontVariantCaps==="small-caps"?"small-caps ":"";return`${e} ${t}${s.fontWeight} ${s.fontSize} ${s.fontFamily}`}function $i(s,e){let t=Ee.get(s);if(t)return t;fe??(fe=document.createElement("canvas").getContext("2d")),fe.font=s;const i=fe.measureText("Hg");return t={ascent:i.fontBoundingBoxAscent??e*.8,descent:i.fontBoundingBoxDescent??e*.2},Ee.set(s,t),t}function Yi(s){if(!s||s==="none")return null;const e=_(_(s,",")[0]," "),t=e.find(r=>!/^-?[\d.]+(px)?$/.test(r)),i=e.filter(r=>/^-?[\d.]+(px)?$/.test(r)).map(parseFloat);return!t||i.length<2?null:{color:t,x:i[0],y:i[1],blur:i[2]??0}}function ji(s,e){return e==="uppercase"?s.toUpperCase():e==="lowercase"?s.toLowerCase():e==="capitalize"?s.replace(new RegExp("^\\p{L}","u"),t=>t.toUpperCase()):s}const Be=(s,e)=>s.x<e.x+e.width&&s.x+s.width>e.x&&s.y<e.y+e.height&&s.y+s.height>e.y;function Ki(){const s=globalThis.scrollX||0,e=globalThis.scrollY||0,t=globalThis.innerWidth||document.documentElement.clientWidth,i=globalThis.innerHeight||document.documentElement.clientHeight,r={x:-t*.5,y:-i,width:t*2,height:i*3},a=[],n=new Map,l=document.createRange();let o=0;const h=getComputedStyle(document.documentElement),c=qe(h);function u(d,f,y,g,b){const S=d.data;if(!/\S/.test(S))return;const x=f.webkitTextFillColor||f.color,R=parseFloat(f.webkitTextStrokeWidth)||0;if(O(x)&&!(R>0))return;l.selectNodeContents(d);const E=l.getBoundingClientRect();if(!E.width||!Be({x:E.left,y:E.top,width:E.width,height:E.height},r))return;const v=b?0:s,p=b?0:e,A=[],k=(L,M)=>{M.width>0&&A.push({text:ji(L,f.textTransform),x:M.left+v,y:M.top+p,width:M.width,height:M.height})},B=/\S+/g;for(let L=B.exec(S);L;L=B.exec(S)){l.setStart(d,L.index),l.setEnd(d,L.index+L[0].length);const M=l.getClientRects();if(M.length<=1){M.length&&k(L[0],M[0]);continue}let w="",T=null;for(let D=0;D<L[0].length;D++){l.setStart(d,L.index+D),l.setEnd(d,L.index+D+1);const z=l.getBoundingClientRect();T&&Math.abs(z.top-T.top)>1&&(k(w,T),w="",T=null),w+=L[0][D],T=T?{left:T.left,top:T.top,width:z.right-T.left,height:T.height}:{left:z.left,top:z.top,width:z.width,height:z.height}}T&&k(w,T)}A.length&&a.push({type:"text",key:y,fixed:b,alpha:g,words:A,box:{x:E.left+v,y:E.top+p,width:E.width,height:E.height},font:Vi(f),size:parseFloat(f.fontSize)||16,fill:O(x)?null:x,stroke:R>0?{width:R,color:f.webkitTextStrokeColor}:null,letterSpacing:f.letterSpacing!=="normal"?f.letterSpacing:"",shadow:Yi(f.textShadow)})}function m(d,f,y,g,b=!0){if(d.namespaceURI!==Oi)return;const S=d.tagName.toUpperCase();if(Hi.has(S))return;const x=getComputedStyle(d);if(x.display==="none"||x.display==="contents"&&!d.childNodes.length)return;const R=x.position!=="static",E=qi(x,R),v=Number.parseInt(x.zIndex,10),p=R&&Number.isFinite(v)?v:R||E?0:x.display.startsWith("inline")?We:Wi,A=[...f,[p,o++]],k=g||x.position==="fixed";d.matches(Gi)&&(n.set(d,A),d.getAttribute("data-liquid-glass")!=="fallback"&&(b=!1));const B=Number(x.opacity),L=y*(Number.isFinite(B)?B:1),M=x.visibility==="visible"&&L>.004,w=Ni.has(S);if(b&&M&&(w||qe(x)||Xi(x))){const D=d.getBoundingClientRect();D.width&&D.height&&a.push({type:w?"media":"box",element:d,key:A,fixed:k,alpha:y,box:{x:D.left+(k?0:s),y:D.top+(k?0:e),width:D.width,height:D.height}})}if(w)return;const T=E||R?A:f;for(const D of d.childNodes)D.nodeType===1?m(D,T,L,k):D.nodeType===3&&M&&u(D,x,[...T,[We,o++]],L,k)}return document.body&&m(document.body,[],1,!1,c),a.sort((d,f)=>Rt(d.key,f.key)),{items:a,hosts:n,scrollX:s,scrollY:e,width:t,height:i}}function Ve(){const s=globalThis.innerWidth||0,e=globalThis.innerHeight||0,t=H&&(Math.abs((globalThis.scrollY||0)-H.scrollY)>e*.5||Math.abs((globalThis.scrollX||0)-H.scrollX)>s*.25||s!==H.width||e!==H.height);return(!H||re||t)&&(H=Ki(),re=!1),H}function j(){re||(re=!0,fi())}function Qi(){var e,t,i,r;if(Xe||typeof document>"u")return;Xe=!0,typeof MutationObserver=="function"&&new MutationObserver(a=>{for(const n of a){const l=n.target.nodeType===1?n.target:n.target.parentElement;if(!(!l||n.type==="attributes"&&l.closest(`[${Ce}]`))){j();return}}}).observe(document.documentElement,{subtree:!0,childList:!0,characterData:!0,attributes:!0,attributeFilter:["style","class","hidden","src","open"]}),globalThis.addEventListener("scroll",a=>{a.target!==document&&a.target!==document.documentElement&&j()},{capture:!0,passive:!0}),globalThis.addEventListener("resize",j,{passive:!0});for(const a of["transitionend","transitioncancel","animationend","load"])document.addEventListener(a,j,!0);const s=()=>{Ee.clear(),j()};(t=(e=document.fonts)==null?void 0:e.addEventListener)==null||t.call(e,"loadingdone",s),(r=(i=document.fonts)==null?void 0:i.ready)==null||r.then(s)}function Zi(s,e,t,i,r){const{ascent:a,descent:n}=$i(e.font,e.size);s.font=e.font,s.textBaseline="alphabetic",s.textAlign="left",e.letterSpacing&&"letterSpacing"in s&&(s.letterSpacing=e.letterSpacing),e.shadow&&(s.shadowColor=e.shadow.color,s.shadowOffsetX=e.shadow.x,s.shadowOffsetY=e.shadow.y,s.shadowBlur=e.shadow.blur),e.fill&&(s.fillStyle=e.fill),e.stroke&&(s.strokeStyle=e.stroke.color,s.lineWidth=e.stroke.width);const l=r.x+r.width,o=r.y+r.height;for(const h of e.words){const c=h.x+t,u=h.y+i;if(c>l||c+h.width<r.x||u>o||u+h.height<r.y)continue;const m=u+(h.height-(a+n))/2+a;e.fill&&s.fillText(h.text,c,m),e.stroke&&s.strokeText(h.text,c,m)}}function At(s){let e=Ve(),t=e.hosts.get(s);if(t||(re=!0,e=Ve(),t=e.hosts.get(s)),!t)return{state:e,end:0};let i=0,r=e.items.length;for(;i<r;){const a=i+r>>1;Rt(e.items[a].key,t)<0?i=a+1:r=a}return{state:e,end:i}}function Ji(s,e,t){Qi();const{state:i,end:r}=At(t),a=globalThis.scrollX||0,n=globalThis.scrollY||0;let l=!0;for(let o=0;o<r;o++){const h=i.items[o],c=h.fixed?0:-a,u=h.fixed?0:-n;if(Be({...h.box,x:h.box.x+c,y:h.box.y+u},e)){s.save(),s.globalAlpha*=h.alpha;try{h.type==="text"?Zi(s,h,c,u,e):h.type==="media"?yt(s,{element:h.element},e):(l=vt(s,h.element,e)&&l,es(s,h.element))}finally{s.restore()}}}return l}function es(s,e){const t=getComputedStyle(e),i=parseFloat(t.borderTopWidth)||0;if(!(i>0)||t.borderTopStyle==="none"||O(t.borderTopColor))return;const r=e.getBoundingClientRect(),a=Math.max(0,(parseFloat(t.borderTopLeftRadius)||0)-i/2);s.save(),s.globalAlpha*=Number(t.opacity)||1,s.strokeStyle=t.borderTopColor,s.lineWidth=i,s.beginPath();const n=r.left+i/2,l=r.top+i/2,o=Math.max(0,r.width-i),h=Math.max(0,r.height-i);a>0&&typeof s.roundRect=="function"?s.roundRect(n,l,o,h,Math.min(a,o/2,h/2)):s.rect(n,l,o,h),s.stroke(),s.restore()}function ts(s){if(!H)return!1;const{state:e,end:t}=At(s),i=s.getBoundingClientRect(),r={x:i.left-96,y:i.top-96,width:i.width+192,height:i.height+192},a=globalThis.scrollX||0,n=globalThis.scrollY||0;for(let l=0;l<t;l++){const{type:o,element:h,box:c,fixed:u}=e.items[l];if(o==="media"&&Be({...c,x:c.x-(u?0:a),y:c.y-(u?0:n)},r)&&(h.tagName==="CANVAS"||h.tagName==="VIDEO"&&!h.paused&&!h.ended))return!0}return!1}function is(){j()}const J=new WeakMap,ss=new Set(["IMG","INPUT","TEXTAREA","SELECT","VIDEO","CANVAS","IFRAME","BR","HR"]),pe=["load","loadeddata","play","playing","pause","seeked","resize"];let me=null;function Re(){return me===null&&(me=oe.isSupported()),me}function te(s){var t,i,r;if(!s)return;const e=(t=s.renderer)==null?void 0:t.gl;s.destroy(),(r=(i=e==null?void 0:e.getExtension)==null?void 0:i.call(e,"WEBGL_lose_context"))==null||r.loseContext()}function kt(s,e){if(typeof MutationObserver!="function")return null;const t=new MutationObserver(e),i=new Set;for(const r of s)for(let a=r;(a==null?void 0:a.nodeType)===1&&!i.has(a);a=a.parentElement)i.add(a),t.observe(a,{attributes:!0,attributeFilter:["style","class"]});return t}function Lt(s,e){const t=typeof s=="string"&&typeof document<"u"?document.querySelector(s):s;if(!U(t))throw new TypeError(`${e}: no element matches ${String(s)}.`);return t}function rs(s,e,t){const i=(s.borderTopLeftRadius||"0").split(/\s+/)[0],r=parseFloat(i)||0;return i.endsWith("%")?Math.min(e,t)*r/100:r}function $e(s,e,t,i){if(i.shape&&i.shape!=="auto")return{shape:i.shape,...Number.isFinite(i.radius)?{radius:i.radius}:{}};const r=Number.isFinite(i.radius)?i.radius:rs(s,e,t),a=Math.min(e,t);return r>=a/2-.5?{shape:Math.abs(e-t)<1?"circle":"pill"}:{shape:"rect",radius:Math.max(0,r)}}const as=["tint","tintTone","frost","opacity"];function Ye(...s){const e={};for(const t of s)for(const i of as)(t==null?void 0:t[i])!=null&&(e[i]=t[i]);return e}class xs{static isSupported(){return Re()}static from(e){const t=typeof e=="string"?document.querySelector(e):e;return(t&&J.get(t))??null}static refreshAll(){is(),yi(e=>{var t;return(t=e.refresh)==null?void 0:t.call(e)})}constructor(e,t={}){var r;const i=Lt(e,"LiquidGlass");if(ss.has(i.tagName.toUpperCase()))throw new TypeError(`LiquidGlass: <${i.tagName.toLowerCase()}> cannot hold the glass layer. Wrap it in an element and pass that.`);if($(t.material??{}),(r=J.get(i))==null||r.destroy(),J.set(i,this),this.element=i,this.options={...t},this.destroyed=!1,this.visible=!0,this.mode="pending",this.glass=null,this.canvas=null,this.targets=[],this.layers=[],this.mediaListeners=[],this.restore=[],this.frame=null,this.sizeKey="",this.positionKey="",this.geometryKey="",this.styleDirty=!0,this.backdropDirty=!0,this.elementsDirty=!0,this.warnedMissing="",this.ready=new Promise(a=>{this.resolveReady=a}),!Re()){this.enterFallback();return}this.buffer=document.createElement("canvas"),this.bufferContext=this.buffer.getContext("2d",{alpha:!1}),this.mountCanvas(),this.backdropSpec=se(t.backdrop),this.resolveTargets(),this.resolveBackdrop(),this.resizeObserver=typeof ResizeObserver=="function"?new ResizeObserver(()=>this.refresh({backdrop:!1})):null,this.observeSizes(),this.unsubscribeAssets=ut(()=>{this.backdropDirty=!0,C(34)}),this.watchStyles(),lt(this)}get supported(){return this.mode!=="fallback"}trackedElements(){return[this.element,...this.targets.map(e=>e.element)]}setStyle(e,t,i){this.restore.push([e,t,e.style[t]]),e.style[t]=i}mountCanvas(){const{element:e}=this,t=getComputedStyle(e),i=(a,n)=>this.setStyle(e,a,n);t.position==="static"&&i("position","relative"),t.isolation!=="isolate"&&i("isolation","isolate");const r=document.createElement("canvas");r.setAttribute(Ce,""),r.setAttribute("aria-hidden","true"),Object.assign(r.style,{position:"absolute",left:"0px",top:"0px",width:"0px",height:"0px",margin:"0",padding:"0",border:"0",maxWidth:"none",maxHeight:"none",display:"block",pointerEvents:"none",zIndex:String(this.options.zIndex??-1),visibility:"hidden"}),e.appendChild(r),this.canvas=r,e.setAttribute("data-liquid-glass","pending")}resolveTargets(){var i;const e=this.options.targets;let t=[];typeof e=="string"?t=[...this.element.querySelectorAll(e)].map(r=>({element:r})):e&&typeof e[Symbol.iterator]=="function"&&(t=[...e].map(r=>U(r)?{element:r}:r).filter(r=>U(r==null?void 0:r.element))),this.targets=t,(i=this.mutationObserver)==null||i.disconnect(),this.mutationObserver=null,typeof e=="string"&&typeof MutationObserver=="function"&&(this.mutationObserver=new MutationObserver(()=>{this.resolveTargets(),this.observeSizes(),this.refresh({backdrop:!1})}),this.mutationObserver.observe(this.element,{childList:!0,subtree:!0}))}observeSizes(){if(this.resizeObserver){this.resizeObserver.disconnect();for(const e of this.trackedElements())this.resizeObserver.observe(e)}}watchStyles(){var e;(e=this.styleObserver)==null||e.disconnect(),this.styleObserver=kt([...this.trackedElements(),...Te(this.layers)],()=>{this.styleDirty=!0,this.backdropDirty=!0,C(120)})}onViewportResize(){this.refresh()}resolveBackdrop(){for(const[i,r]of this.mediaListeners)pe.forEach(a=>i.removeEventListener(a,r));this.mediaListeners=[],this.layers=Se(this.backdropSpec,this.element);const e=zi(this.layers).join(", ");e&&e!==this.warnedMissing&&console.warn(`LiquidGlass: backdrop ${e} matched no element and is not an image URL. Call refresh() once it exists.`),this.warnedMissing=e;const t=()=>{this.backdropDirty=!0,C(34)};for(const i of Te(this.layers)){const r=i.tagName.toUpperCase();r!=="IMG"&&r!=="VIDEO"||(pe.forEach(a=>i.addEventListener(a,t)),this.mediaListeners.push([i,t]))}}measure(){if(this.destroyed||this.mode==="fallback")return;const{element:e}=this,t=e.getBoundingClientRect(),i={x:t.left,y:t.top,screenWidth:t.width,screenHeight:t.height,width:e.offsetWidth??t.width,height:e.offsetHeight??t.height,borderLeft:e.clientLeft,borderTop:e.clientTop,scrollLeft:e.scrollLeft,scrollTop:e.scrollTop,targets:this.targets.map(({element:r})=>{const a=r.getBoundingClientRect();return{x:a.left,y:a.top,width:r.offsetWidth??a.width,height:r.offsetHeight??a.height,screenWidth:a.width,screenHeight:a.height}})};this.styleDirty&&(this.styles=[e,...this.targets.map(r=>r.element)].map(r=>getComputedStyle(r)).map(r=>({borderTopLeftRadius:r.borderTopLeftRadius})),this.styleDirty=!1,this.elementsDirty=!0),this.frame=i}bleed(){var t;if(Number.isFinite(this.options.bleed))return Math.max(0,this.options.bleed);const e=((t=this.glass)==null?void 0:t.material)??$(this.options.material??{});return Math.ceil(Math.min(96,24+e.refraction*.17+e.backdropBlur*2))}createGlass(){try{this.glass=new oe(this.canvas,{compositeMode:"overlay",autoResize:!1,autoStart:!1,preserveDrawingBuffer:!0,material:this.options.material,respectReducedTransparency:this.options.respectReducedTransparency??!0,onContextLost:e=>{var t,i;return(i=(t=this.options).onContextLost)==null?void 0:i.call(t,e)},onContextRestored:e=>{var t,i;this.sizeKey="",this.backdropDirty=!0,this.elementsDirty=!0,C(64),(i=(t=this.options).onContextRestored)==null||i.call(t,e)}})}catch(e){return console.warn("LiquidGlass: WebGL2 surface could not be created; using the fallback.",e),this.enterFallback(),!1}return this.mode="webgl",this.element.setAttribute("data-liquid-glass","webgl"),!0}buildElements(e,t,i,r){const a=Ye(this.options);return this.targets.length?this.targets.slice(0,e.targets.length).map((n,l)=>{const o=e.targets[l],h=o.width||o.screenWidth/i,c=o.height||o.screenHeight/r;return{id:`target-${l}`,x:(o.x-e.x)/i+t,y:(o.y-e.y)/r+t,width:h,height:c,...$e(this.styles[l+1]??this.styles[0],h,c,{...this.options,...n}),...Ye(this.options,n)}}).filter(n=>n.width>0&&n.height>0):[{id:"surface",x:t,y:t,width:e.width,height:e.height,...$e(this.styles[0],e.width,e.height,this.options),...a}]}draw(){var f,y;const e=this.frame;if(!e||this.destroyed||this.mode==="fallback")return!1;if(!(e.width>0&&e.height>0&&e.screenWidth>0&&e.screenHeight>0))return this.canvas.style.visibility!=="hidden"&&(this.canvas.style.visibility="hidden"),!1;if(!this.glass&&!this.createGlass())return!1;const t=Math.max(.5,Math.min(globalThis.devicePixelRatio||1,this.options.maxDpr??2)),i=this.bleed(),r=e.width+i*2,a=e.height+i*2,n=`${r}x${a}@${t}`;n!==this.sizeKey&&(this.sizeKey=n,this.canvas.style.width=`${r}px`,this.canvas.style.height=`${a}px`,this.buffer.width=Math.max(1,Math.round(r*t)),this.buffer.height=Math.max(1,Math.round(a*t)),this.glass.setBackdrop(this.buffer,{update:"static",autoStart:!1,shouldRender:!1}),this.backdropDirty=!0,this.elementsDirty=!0);const l=`${-i-e.borderLeft+e.scrollLeft},${-i-e.borderTop+e.scrollTop}`;if(l!==this.positionKey){this.positionKey=l;const[g,b]=l.split(",");this.canvas.style.left=`${g}px`,this.canvas.style.top=`${b}px`}const o=e.screenWidth/e.width,h=e.screenHeight/e.height,c=[e.x,e.y,e.screenWidth,e.screenHeight,...e.targets.flatMap(g=>[g.x,g.y,g.screenWidth,g.screenHeight])].map(g=>Math.round(g*64)).join(",");c!==this.geometryKey&&(this.geometryKey=c,this.backdropDirty=!0,this.elementsDirty=!0),he()!==this.epoch&&(this.epoch=he(),this.backdropDirty=!0);const u=this.options.live===!0||this.options.live!==!1&&Et(this.layers);let m=!1,d=this.settled??!1;return(this.backdropDirty||u)&&(d=Tt(this.bufferContext,this.layers,e,i,t),this.settled=d,this.glass.updateBackdrop(!1),this.backdropDirty=!1,m=!0),this.elementsDirty&&(this.glass.setElements(this.buildElements(e,i,o,h),!1),this.elementsDirty=!1,m=!0),(m||this.glass.dirty)&&(this.glass.render({force:!0,dpr:t}),this.canvas.style.visibility&&(this.canvas.style.visibility=""),(y=(f=this.options).onRender)==null||y.call(f,this)),d&&this.resolveReady&&(this.resolveReady(this),this.resolveReady=null),u}enterFallback(){var i,r;this.mode="fallback",te(this.glass),this.glass=null,(i=this.canvas)==null||i.remove(),this.canvas=null;const{element:e}=this;e.setAttribute("data-liquid-glass","fallback");const t=this.options.fallback??"css";if(typeof t=="function")t(e);else if(t==="css"){const a=this.options.targets,n=typeof a=="string"?[...e.querySelectorAll(a)]:a?[...a].map(h=>U(h)?h:h==null?void 0:h.element).filter(U):[e],l=Math.round(14+(this.options.frost??0)*30),o=Math.min(1,this.options.tint??0);for(const h of n){const c=getComputedStyle(h);(!c.backdropFilter||c.backdropFilter==="none")&&(this.setStyle(h,"backdropFilter",`blur(${l}px) saturate(1.6)`),this.setStyle(h,"webkitBackdropFilter",`blur(${l}px) saturate(1.6)`)),O(c.backgroundColor)&&this.setStyle(h,"backgroundColor",this.options.tintTone==="dark"?`rgba(20,21,26,${(.28+o*.5).toFixed(3)})`:`rgba(255,255,255,${(.14+o*.5).toFixed(3)})`)}}(r=this.resolveReady)==null||r.call(this,this),this.resolveReady=null}refresh({backdrop:e=!0}={}){return this.destroyed||this.mode==="fallback"?this:(e&&(typeof this.options.targets=="string"&&this.resolveTargets(),this.resolveBackdrop(),this.observeSizes(),this.watchStyles()),this.styleDirty=!0,this.backdropDirty=!0,this.elementsDirty=!0,C(64),this)}update(e={}){var t;return this.destroyed?this:("material"in e&&$({...this.options.material??{},...e.material??{}}),this.options={...this.options,...e,..."material"in e?{material:{...this.options.material??{},...e.material??{}}}:{}},this.mode==="fallback"?this:("material"in e&&((t=this.glass)==null||t.setMaterial(e.material??{},!1)),"zIndex"in e&&this.canvas&&(this.canvas.style.zIndex=String(e.zIndex??-1)),"backdrop"in e&&(this.backdropSpec=se(e.backdrop)),"targets"in e&&this.resolveTargets(),this.sizeKey="",this.refresh()))}destroy(){var e,t,i,r,a,n;if(!this.destroyed){this.destroyed=!0,ht(this),(e=this.resizeObserver)==null||e.disconnect(),(t=this.mutationObserver)==null||t.disconnect(),(i=this.styleObserver)==null||i.disconnect(),(r=this.unsubscribeAssets)==null||r.call(this);for(const[l,o]of this.mediaListeners)pe.forEach(h=>l.removeEventListener(h,o));te(this.glass),this.glass=null,(a=this.canvas)==null||a.remove(),this.canvas=null;for(const[l,o,h]of this.restore.reverse())l.style[o]=h;this.element.removeAttribute("data-liquid-glass"),J.get(this.element)===this&&J.delete(this.element),(n=this.resolveReady)==null||n.call(this,this),this.resolveReady=null}}}const G=(s,e=0,t=1)=>Math.max(e,Math.min(t,s)),ee=new WeakMap,ns=Object.freeze({refraction:17,edgeReach:.14,edgeWidth:.22,dispersion:0,frost:0,backdropBlur:0,body:.72,absorption:.58,tint:0}),os=Object.freeze({outerWidth:.13,outerHeight:1.24,innerLength:0,innerHeight:.24});function je(s={}){return{...Le(),...s,...ns}}const ls={navbar:[312,72],switch:[84,28]},ge=3,hs=140,cs=Object.freeze({switch:{tint:1.5,frost:.24,tintTone:"light"},navbar:{tint:.34,frost:.32,tintTone:"dark"}});function V(s,e,t){const i=document.createElement(s);return i.setAttribute(Ce,""),i.setAttribute("aria-hidden","true"),Object.assign(i.style,{position:"absolute",left:"0px",top:"0px",margin:"0",padding:"0",border:"0",maxWidth:"none",maxHeight:"none",display:"block",pointerEvents:"none",zIndex:String(t)}),e==null||e.appendChild(i),i}function Y(s,e,t,i,r,a=r/2){s.beginPath(),s.roundRect(e,t,i,r,Math.max(0,Math.min(a,i/2,r/2)))}function Ke(s,e,t,i,r){s.velocity+=(e-s.value)*i*t,s.velocity*=Math.exp(-r*t),s.value+=s.velocity*t}function us(s){const e=s??[{value:"first",label:"First"},{value:"second",label:"Second"}];if(!Array.isArray(e)||e.length<2)throw new TypeError("LiquidGlassNavbar needs at least two items.");return e.map((t,i)=>typeof t=="string"?{value:t,label:t}:{value:t.value??String(i),label:t.label??String(t.value??i),icon:t.icon})}class Mt{constructor(e,t,i){var l,o;const r=i==="navbar"?"LiquidGlassNavbar":"LiquidGlassSwitch",a=Lt(e,r);$((t==null?void 0:t.material)??{}),(l=ee.get(a))==null||l.destroy(),ee.set(a,this),this.container=a,this.element=a,this.options={...t??{}},this.kind=i,this.destroyed=!1,this.visible=!0,this.items=i==="navbar"?us(this.options.items):null;const n=i==="switch"?this.options.checked?1:0:this.indexOf(this.options.value);if(this.position={value:n,velocity:0},this.positionTarget=n,this.amount={value:0,velocity:0},this.value=i==="switch"?!!n:this.items[n].value,this.material={...Le(),...this.options.material??{}},this.lens={...os,...this.options.lens??{}},this.dragging=!1,this.animating=!1,this.releasing=!1,this.releaseMix=1,this.releaseStartedAt=0,this.activePointerId=null,this.lastTime=0,this.frame=null,this.size=null,this.sizeKey="",this.geometryKey="",this.staticDirty=!0,this.dirty=!0,this.pressedShown=!1,this.settled=!1,this.settledWaiters=[],this.restore=[],this.ready=new Promise(h=>{this.settledWaiters.push(()=>h(this))}),this.setupContainer(),this.supported=Re(),this.backdropCanvas=V("canvas",null,0),this.compositeCanvas=V("canvas",null,0),this.baseCanvas=i==="navbar"?V("canvas",a,0):null,this.trackCanvas=V("canvas",a,1),this.pressCanvas=V("canvas",a,2),this.restCanvas=V("canvas",a,3),this.labelLayer=V("div",a,4),Object.assign(this.labelLayer.style,{inset:"0",width:"100%",height:"100%"}),this.labelLayer.removeAttribute("aria-hidden"),this.supported)try{this.baseGlass=this.baseCanvas?new oe(this.baseCanvas,{material:this.material,compositeMode:"overlay",autoResize:!1,preserveDrawingBuffer:!0}):null,this.pressGlass=new oe(this.pressCanvas,{material:je(this.material),compositeMode:"overlay",autoResize:!1,preserveDrawingBuffer:!0})}catch(h){console.warn(`${r}: WebGL2 unavailable, drawing the flat fallback.`,h),te(this.baseGlass),this.baseGlass=null,this.pressGlass=null,this.supported=!1}a.setAttribute("data-liquid-glass",this.supported?"webgl":"fallback"),this.onPointerDown=h=>this.pointerDown(h),this.onPointerMove=h=>this.pointerMove(h),this.onPointerEnd=h=>this.pointerEnd(h),this.onKeyDown=h=>this.keyDown(h),a.addEventListener("pointerdown",this.onPointerDown),a.addEventListener("pointermove",this.onPointerMove),a.addEventListener("pointerup",this.onPointerEnd),a.addEventListener("pointercancel",this.onPointerEnd),a.addEventListener("lostpointercapture",this.onPointerEnd),a.addEventListener("keydown",this.onKeyDown),this.onFocusChange=h=>{h.type==="blur"&&(this.pointerFocus=!1),this.dirty=!0,C(34)},a.addEventListener("focus",this.onFocusChange),a.addEventListener("blur",this.onFocusChange),this.layers=Se(se(this.options.backdrop),a),this.unsubscribeAssets=ut(()=>{this.staticDirty=!0,C(34)}),this.resizeObserver=typeof ResizeObserver=="function"?new ResizeObserver(()=>C(64)):null,(o=this.resizeObserver)==null||o.observe(a),this.watchStyles(),this.buildLabels(),this.updateAccessibility(),lt(this)}static from(e){const t=typeof e=="string"?document.querySelector(e):e;return(t&&ee.get(t))??null}setupContainer(){const{container:e,kind:t}=this,i=getComputedStyle(e),r=(o,h)=>{this.restore.push([o,e.style[o]]),e.style[o]=h};i.position==="static"&&r("position","relative"),i.isolation!=="isolate"&&r("isolation","isolate"),i.display==="inline"&&r("display","inline-block");const[a,n]=ls[t],l=e.clientHeight===0&&!e.style.height;(this.options.width!=null||l&&!e.style.width)&&r("width",`${this.options.width??a}px`),(this.options.height!=null||l)&&r("height",`${this.options.height??n}px`),r("touchAction","none"),r("userSelect","none"),r("webkitUserSelect","none"),r("cursor",this.options.disabled?"default":"pointer"),r("outline","none"),this.originalAttributes=["tabindex","role","aria-checked","aria-label","aria-disabled","data-liquid-glass"].map(o=>[o,e.getAttribute(o)]),e.tabIndex=this.options.disabled?-1:e.tabIndex>=0?e.tabIndex:0,e.dataset.liquidGlassControl=t}trackedElements(){return[this.container]}watchStyles(){var e;(e=this.styleObserver)==null||e.disconnect(),this.styleObserver=kt([this.container,...Te(this.layers)],()=>{this.staticDirty=!0,C(120)})}onViewportResize(){this.refresh()}count(){return this.kind==="navbar"?this.items.length:2}indexOf(e){const t=this.items.findIndex(i=>i.value===e);return t<0?0:t}measure(){const e=this.container.getBoundingClientRect();this.frame={x:e.left,y:e.top,screenWidth:e.width,screenHeight:e.height,width:this.container.offsetWidth,height:this.container.offsetHeight}}draw(e){const{frame:t}=this;if(!t||this.destroyed||!(t.width>0&&t.height>0))return!1;const i=Math.min(globalThis.devicePixelRatio||1,2),r=`${t.width}x${t.height}@${i}`;r!==this.sizeKey&&(this.sizeKey=r,this.layout(t.width,t.height,i));const a=[t.x,t.y,t.screenWidth,t.screenHeight].map(o=>Math.round(o*64)).join(",");(a!==this.geometryKey||he()!==this.epoch)&&(this.geometryKey=a,this.epoch=he(),this.staticDirty=!0);const n=this.options.live===!0||this.options.live!==!1&&this.supported&&Et(this.layers);n&&(this.staticDirty=!0);const l=this.animating&&this.step(e);return(this.staticDirty||this.dirty)&&this.render(),l||n}layout(e,t,i){var u,m;const r=Math.ceil(36+t*.5);this.size={width:e,height:t,dpr:i,bleed:r};const a=e+r*2,n=t+r*2,l=Math.max(1,Math.round(a*i)),o=Math.max(1,Math.round(n*i));for(const d of[this.baseCanvas,this.trackCanvas,this.pressCanvas,this.restCanvas])d&&Object.assign(d.style,{left:`${-r}px`,top:`${-r}px`,width:`${a}px`,height:`${n}px`});for(const d of[this.backdropCanvas,this.compositeCanvas,this.trackCanvas,this.restCanvas])d.width=l,d.height=o;let h=e,c=t;this.kind==="switch"&&(e/t<ge?c=e/ge:h=t*ge),this.track={x:r+(e-h)/2,y:r+(t-c)/2,w:h,h:c},(u=this.baseGlass)==null||u.setBackdrop(this.backdropCanvas,{update:"static",autoStart:!1,shouldRender:!1}),(m=this.pressGlass)==null||m.setBackdrop(this.compositeCanvas,{update:"static",autoStart:!1,shouldRender:!1}),this.staticDirty=!0,this.dirty=!0,this.buildLabels()}step(e){var l,o;const t=G((e-this.lastTime)/1e3,.001,.034);this.lastTime=e;const i=(o=(l=globalThis.matchMedia)==null?void 0:l.call(globalThis,"(prefers-reduced-motion: reduce)"))==null?void 0:o.matches,r=this.dragging?1:0,a=this.count()-1;i?(this.amount.value=r,this.amount.velocity=0,this.position.value=this.positionTarget,this.position.velocity=0):(Ke(this.amount,r,t,this.dragging?520:540,this.dragging?28:31),Ke(this.position,this.positionTarget,t,this.dragging?420:360,this.dragging?31:27)),this.amount.value=G(this.amount.value,0,1.12),this.position.value=G(this.position.value,0,a),this.releasing&&(this.releaseMix=i?1:G((e-this.releaseStartedAt)/hs));const n=Math.abs(this.amount.value-r)<.004&&Math.abs(this.amount.velocity)<.018&&Math.abs(this.position.value-this.positionTarget)<.003&&Math.abs(this.position.velocity)<.018&&(!this.releasing||this.releaseMix>=1);return n&&(this.amount.value=r,this.position.value=this.positionTarget,this.animating=this.dragging,this.dragging||(this.releasing=!1)),this.dirty=!0,!n||this.dragging}startAnimation(){var e,t;this.destroyed||(this.animating||(this.animating=!0,this.lastTime=((t=(e=globalThis.performance)==null?void 0:e.now)==null?void 0:t.call(e))??Date.now()),this.dirty=!0,C(34))}thumbGeometry(e=this.amount.value){const{track:t}=this,i=t.h*.08,r=this.count(),a=G(this.position.value/(r-1)),n=this.kind==="navbar"?(t.w-i*2)/r:t.w*.65,l=t.h*.84,o=Math.max(0,t.w-n-i*2),h=t.x+i+o*a,c=t.y+i;let u,m;this.kind==="navbar"?(u=1+e*this.lens.outerWidth,m=1+e*Math.max(0,t.h*this.lens.outerHeight/l-1)):(u=1+e*.33,m=1+e);const d=n*u,f=l*m,y=h-(d-n)/2,g=this.kind==="navbar"?Math.max(0,(f-t.h)/2):t.h*.42,b=t.x-g+(t.w+g*2-d)*a;return{x:y+(b-y)*G(e),y:c-(f-l)/2,w:d,h:f}}context(e){const t=e.getContext("2d");return t.setTransform(this.size.dpr,0,0,this.size.dpr,0,0),t}drawBackdrop(){const e=this.backdropCanvas.getContext("2d");return Tt(e,this.layers,this.frame,this.size.bleed,this.size.dpr)}drawTrack(){const e=this.context(this.trackCanvas);if(e.clearRect(0,0,this.trackCanvas.width,this.trackCanvas.height),this.kind==="navbar"&&this.baseGlass)return;const{x:t,y:i,w:r,h:a}=this.track;if(e.save(),Y(e,t,i,r,a),this.kind==="switch"){const n=e.createLinearGradient(t,i,t+r,i+a);n.addColorStop(0,"#c2c3c7"),n.addColorStop(1,"#a9abb0"),e.fillStyle=n,e.fill(),Y(e,t,i,r,a);const l=G(this.position.value);if(e.globalAlpha=l*l*(3-2*l),this.options.color)e.fillStyle=this.options.color;else{const o=e.createLinearGradient(t,i,t+r,i+a);o.addColorStop(0,"#34d86a"),o.addColorStop(1,"#25c653"),e.fillStyle=o}e.fill()}else{const n=this.darkTrack();e.fillStyle=n?"rgba(30,32,38,.72)":"rgba(225,230,238,.72)",e.fill(),e.strokeStyle=n?"rgba(255,255,255,.18)":"rgba(255,255,255,.5)",e.stroke()}e.restore()}renderBase(){this.baseGlass&&(this.baseGlass.updateBackdrop(!1),this.baseGlass.setElements([{id:"navbar-track",shape:"pill",...this.track,tint:this.options.tint??.86,tintTone:this.options.tintTone??"light"}],!1),this.baseGlass.render({force:!0,dpr:this.size.dpr}))}composePressedBackdrop(){const e=this.compositeCanvas.getContext("2d");e.setTransform(1,0,0,1,0,0),e.drawImage(this.backdropCanvas,0,0),this.baseCanvas&&e.drawImage(this.baseCanvas,0,0,this.compositeCanvas.width,this.compositeCanvas.height),e.drawImage(this.trackCanvas,0,0)}renderPressed(e){if(!this.pressGlass)return;if(!e){this.pressGlass.setElements([],!1),this.pressGlass.render({force:!0,dpr:this.size.dpr}),this.pressedShown=!1;return}const t=G(this.amount.value),i=this.releasing?1-this.releaseMix:t,r=cs[this.kind];this.pressGlass.updateBackdrop(!1),this.pressGlass.setElements([{id:`${this.kind}-pressed-thumb`,shape:"pill",...this.thumbGeometry(),tint:r.tint*(1-i),frost:r.frost*(1-i),opacity:this.releasing?1-this.releaseMix:1,pressure:this.kind==="navbar"?t:0,pressureAxes:this.kind==="navbar"?[1-this.lens.innerLength,1-this.lens.innerHeight]:[1,1],tintTone:r.tintTone}],!1),this.pressGlass.render({force:!0,dpr:this.size.dpr}),this.pressedShown=!0}drawRestingThumb(e){const t=this.context(this.restCanvas);t.clearRect(0,0,this.restCanvas.width,this.restCanvas.height);const i=this.dragging,r=this.supported&&(i||this.releasing),a=r?i?0:this.releaseMix:1;if(a<=.001)return;const n=this.thumbGeometry(r||!this.supported?this.amount.value:0),l=n.h/2;if(t.save(),t.globalAlpha=a,this.kind==="switch"){t.shadowColor="rgba(0,0,0,.18)",t.shadowBlur=n.h*.16,t.shadowOffsetY=n.h*.045,Y(t,n.x,n.y,n.w,n.h,l);const o=t.createLinearGradient(n.x,n.y,n.x,n.y+n.h);o.addColorStop(0,"rgba(255,255,255,.97)"),o.addColorStop(1,"rgba(238,239,242,.94)"),t.fillStyle=o,t.fill(),t.shadowColor="transparent",Y(t,n.x+.75,n.y+.75,n.w-1.5,n.h-1.5,l-.75),t.strokeStyle="rgba(83,85,91,.34)",t.lineWidth=1.5,t.stroke()}else{const o=this.darkTrack();if(t.shadowColor="rgba(0,0,0,.055)",t.shadowBlur=n.h*.09,t.shadowOffsetY=n.h*.045,Y(t,n.x,n.y,n.w,n.h,l),t.clip(),e&&"filter"in t){const{dpr:h}=this.size,c=Math.max(5,n.h*.105),u=c*2.5,m=Math.max(0,n.x-u),d=Math.max(0,n.y-u),f=n.w+u*2,y=n.h+u*2;t.filter=`blur(${c}px)`,t.drawImage(this.compositeCanvas,m*h,d*h,f*h,y*h,m,d,f,y),t.filter="none",t.globalCompositeOperation="color",t.fillStyle=o?"rgba(46,48,54,.72)":"rgba(148,150,155,.72)",t.fillRect(n.x,n.y,n.w,n.h),t.globalCompositeOperation="source-over",t.fillStyle=o?"rgba(12,13,17,.42)":"rgba(142,145,152,.24)"}else{const h=t.createLinearGradient(n.x,n.y,n.x,n.y+n.h);h.addColorStop(0,o?"rgba(62,64,72,.9)":"rgba(174,178,186,.88)"),h.addColorStop(1,o?"rgba(42,44,50,.86)":"rgba(145,149,158,.82)"),t.fillStyle=h}t.fillRect(n.x,n.y,n.w,n.h)}t.restore()}darkTrack(){var n;const e=this.options.tintTone??"light";if(e!=="auto")return e==="dark";const t=(n=this.baseGlass)==null?void 0:n.elements[0];if(!t||!this.size)return!1;const{width:i,height:r,bleed:a}=this.size;return this.baseGlass.tintLightForElement(t,i+a*2,r+a*2)<.5}labelColor(){return this.options.labelColor??(this.darkTrack()?"rgba(245,246,250,.95)":"rgba(22,25,31,.9)")}drawFocusRing(){let e;try{e=this.container.matches(":focus-visible")}catch{e=document.activeElement===this.container}if(!e||this.pointerFocus)return;const t=this.context(this.restCanvas),{x:i,y:r,w:a,h:n}=this.track;t.save(),Y(t,i-3,r-3,a+6,n+6),t.lineWidth=2,t.strokeStyle="rgba(10,132,255,.95)",t.stroke(),t.restore()}render(){if(this.destroyed||!this.size||!this.frame)return this;if(this.staticDirty){if(this.settled=this.supported?this.drawBackdrop():!0,this.renderBase(),this.kind==="navbar"&&this.options.tintTone==="auto"){const i=this.labelColor();if(i!==this.appliedLabelColor){this.appliedLabelColor=i;for(const r of this.labelLayer.children)r.style.color=i}}this.staticDirty=!1}this.drawTrack();const e=this.dragging||this.releasing&&this.releaseMix<1,t=this.supported&&(e||this.kind==="navbar");return t&&this.composePressedBackdrop(),(e||this.pressedShown)&&this.renderPressed(e),this.drawRestingThumb(t),this.drawFocusRing(),this.updateAccessibility(),this.dirty=!1,this.settled&&this.settledWaiters.length&&this.settledWaiters.splice(0).forEach(i=>i()),this}buildLabels(){var a,n;if(this.labelLayer.replaceChildren(),this.kind!=="navbar")return;const e=((a=this.size)==null?void 0:a.width)??this.container.offsetWidth,t=((n=this.size)==null?void 0:n.height)??this.container.offsetHeight,i=t*.08,r=(e-i*2)/this.items.length;this.items.forEach((l,o)=>{const h=document.createElement("span");h.dataset.index=String(o),h.setAttribute("role","tab"),h.textContent=`${l.icon?`${l.icon}  `:""}${l.label}`,Object.assign(h.style,{position:"absolute",left:`${i+r*o}px`,top:"0px",width:`${r}px`,height:`${t}px`,display:"grid",placeItems:"center",color:this.labelColor(),font:"inherit",fontSize:`${this.options.fontSize??Math.max(13,Math.min(17,t*.22))}px`,fontWeight:"600",lineHeight:"1",whiteSpace:"nowrap",pointerEvents:"none"}),this.labelLayer.appendChild(h)})}updateAccessibility(){const{container:e}=this;if(this.kind==="switch")e.setAttribute("role","switch"),e.setAttribute("aria-checked",String(!!this.value)),e.setAttribute("aria-label",this.options.ariaLabel??e.getAttribute("aria-label")??"Liquid glass switch");else{e.setAttribute("role","tablist"),e.setAttribute("aria-label",this.options.ariaLabel??e.getAttribute("aria-label")??"Liquid glass navigation");const t=Math.round(this.positionTarget);for(const i of this.labelLayer.children)i.setAttribute("aria-selected",String(Number(i.dataset.index)===t))}}localPoint(e){var a,n;const t=this.container.getBoundingClientRect(),i=((a=this.size)==null?void 0:a.width)||t.width||1,r=((n=this.size)==null?void 0:n.height)||t.height||1;return{x:(e.clientX-t.left)*i/(t.width||1),y:(e.clientY-t.top)*r/(t.height||1)}}progressForPointer(e){const{x:t}=this.localPoint(e),{track:i,size:r}=this,a=this.thumbGeometry(0),n=i.h*.08,l=Math.max(1,i.w-a.w-n*2);return G((t+r.bleed-i.x-n-a.w/2)/l)*(this.count()-1)}pointerDown(e){var r,a;if(this.options.disabled||e.button!==0||!this.size)return;e.preventDefault(),this.dragging=!0;const t=Math.round(this.positionTarget);this.press={x:e.clientX,y:e.clientY,moved:!1,start:t},this.activePointerId=e.pointerId,this.releasing=!1,this.releaseMix=0;const i=this.progressForPointer(e);this.positionTarget=this.kind==="switch"?Math.round(i):i;try{(a=(r=this.container).setPointerCapture)==null||a.call(r,e.pointerId)}catch{}this.pointerFocus=!0,this.container.focus({preventScroll:!0}),this.startAnimation()}pointerMove(e){if(!(!this.dragging||e.pointerId!==this.activePointerId)){if(e.preventDefault(),!this.press.moved){if(Math.hypot(e.clientX-this.press.x,e.clientY-this.press.y)<4)return;this.press.moved=!0}this.positionTarget=this.progressForPointer(e),this.startAnimation()}}pointerEnd(e){var i,r;if(!this.dragging||e.pointerId!==this.activePointerId)return;e.preventDefault(),this.dragging=!1;const{start:t}=this.press??{start:Math.round(this.positionTarget)};e.type==="pointercancel"?this.positionTarget=t:this.positionTarget=Math.round(this.positionTarget),this.activePointerId=null,this.press=null,this.releasing=!0,this.releaseMix=0,this.releaseStartedAt=((r=(i=globalThis.performance)==null?void 0:i.now)==null?void 0:r.call(i))??Date.now(),this.commitValue(this.positionTarget),this.startAnimation()}keyDown(e){if(this.pointerFocus&&(this.pointerFocus=!1,this.dirty=!0,C(34)),this.options.disabled)return;const t=this.count()-1,i=Math.round(this.positionTarget);let r=null;(e.key==="ArrowLeft"||e.key==="ArrowUp")&&(r=Math.max(0,i-1)),(e.key==="ArrowRight"||e.key==="ArrowDown")&&(r=Math.min(t,i+1)),e.key==="Home"&&(r=0),e.key==="End"&&(r=t),this.kind==="switch"&&(e.key===" "||e.key==="Enter")&&(r=i?0:1),r!==null&&(e.preventDefault(),this.positionTarget=r,this.commitValue(r),this.startAnimation())}commitValue(e,t=!0){var r,a;const i=this.value;if(this.value=this.kind==="switch"?!!e:this.items[e].value,t&&i!==this.value){const n=this.kind==="switch"?void 0:e;(a=(r=this.options).onChange)==null||a.call(r,this.value,n),this.container.dispatchEvent(new CustomEvent("change",{detail:{value:this.value,index:n},bubbles:!0}))}this.updateAccessibility()}jumpTo(e,t){return this.positionTarget=e,this.position.value=e,this.position.velocity=0,this.commitValue(e,t),this.dirty=!0,C(34),this}setBackdrop(e){return this.options.backdrop=e,this.refresh().nextSettled()}nextSettled(){return new Promise(e=>{this.settled=!1,this.settledWaiters.push(()=>e(this))})}setMaterial(e){var t,i;return $({...this.options.material??{},...e??{}}),this.material={...this.material,...e??{}},(t=this.baseGlass)==null||t.setMaterial(this.material,!1),(i=this.pressGlass)==null||i.setMaterial(je(this.material),!1),this.staticDirty=!0,C(34),this}setLens(e){return this.kind!=="navbar"?this:(this.lens={...this.lens,...e??{}},this.dirty=!0,C(34),this)}setTintTone(e){return this.kind!=="navbar"?this:(this.options.tintTone=e,this.appliedLabelColor=null,this.staticDirty=!0,this.dirty=!0,this.buildLabels(),C(34),this)}setDisabled(e){return this.options.disabled=!!e,this.container.tabIndex=e?-1:0,this.container.style.cursor=e?"default":"pointer",this.container.setAttribute("aria-disabled",String(!!e)),this}refresh(){return this.destroyed?this:(this.layers=Se(se(this.options.backdrop),this.container),this.watchStyles(),this.staticDirty=!0,this.dirty=!0,C(64),this)}updateBackdrop(){return this.refresh()}destroy(){var t,i,r;if(this.destroyed)return;this.destroyed=!0,ht(this),(t=this.resizeObserver)==null||t.disconnect(),(i=this.styleObserver)==null||i.disconnect(),(r=this.unsubscribeAssets)==null||r.call(this),te(this.baseGlass),te(this.pressGlass),this.baseGlass=null,this.pressGlass=null;const{container:e}=this;e.removeEventListener("pointerdown",this.onPointerDown),e.removeEventListener("pointermove",this.onPointerMove),e.removeEventListener("pointerup",this.onPointerEnd),e.removeEventListener("pointercancel",this.onPointerEnd),e.removeEventListener("lostpointercapture",this.onPointerEnd),e.removeEventListener("keydown",this.onKeyDown),e.removeEventListener("focus",this.onFocusChange),e.removeEventListener("blur",this.onFocusChange);for(const a of[this.baseCanvas,this.trackCanvas,this.pressCanvas,this.restCanvas,this.labelLayer])a==null||a.remove();delete e.dataset.liquidGlassControl;for(const[a,n]of this.restore.reverse())e.style[a]=n;for(const[a,n]of this.originalAttributes)n===null?e.removeAttribute(a):e.setAttribute(a,n);ee.get(e)===this&&ee.delete(e),this.settledWaiters.splice(0).forEach(a=>a())}}class ws extends Mt{constructor(e,t={}){super(e,t,"navbar")}setValue(e,{notify:t=!1}={}){return this.jumpTo(this.indexOf(e),t)}}class Ss extends Mt{constructor(e,t={}){super(e,t,"switch")}get checked(){return!!this.value}setChecked(e,{notify:t=!1}={}){return this.jumpTo(e?1:0,t)}}const Ae=Object.freeze({FOLDER:"folder",RECT:"rect",PILL:"pill",CIRCLE:"circle"}),ne=Object.freeze({REPLACE:"replace",OVERLAY:"overlay"}),W=Object.freeze({AUTO:"auto",STATIC:"static",LIVE:"live"}),ds="(prefers-reduced-transparency: reduce)";function fs(s){if(!Object.values(ne).includes(s))throw new TypeError(`Unknown liquid glass composite mode: ${s}`);return s}function ps(s){var t,i,r;const e=(t=s==null?void 0:s.tagName)==null?void 0:t.toUpperCase();return e==="CANVAS"||e==="VIDEO"||((i=s==null?void 0:s.constructor)==null?void 0:i.name)==="OffscreenCanvas"||((r=s==null?void 0:s.constructor)==null?void 0:r.name)==="VideoFrame"}function ms(s,e=W.AUTO){if(!Object.values(W).includes(e))throw new TypeError(`Unknown liquid glass backdrop update mode: ${e}`);return e===W.AUTO?ps(s)?W.LIVE:W.STATIC:e}function gs(s){const e=s==="folderRect"?Ae.RECT:s;if(!Object.values(Ae).includes(e))throw new TypeError(`Unknown liquid glass shape: ${s}`);return e}function Qe(s){return typeof s!="string"?Promise.resolve(s):new Promise((e,t)=>{const i=new Image;i.onload=()=>e(i),i.onerror=()=>t(new Error(`Unable to load liquid glass wallpaper: ${s}`)),i.src=s})}function ve(s,e){const t=Number(s.w??s.width??s.size??0),i=Number(s.h??s.height??s.size??t);if(!(t>0)||!(i>0))throw new TypeError("Liquid glass elements need a positive width and height.");return{...s,id:s.id??`glass-${e+1}`,shape:gs(s.shape??Ae.FOLDER),x:Number(s.x??0),y:Number(s.y??0),w:t,h:i}}function vs(s){return typeof globalThis.matchMedia=="function"?globalThis.matchMedia(s):null}class Ts{static isSupported(){var e;if(typeof document>"u")return!1;try{const i=document.createElement("canvas").getContext("webgl2");return i?((e=i.getExtension("WEBGL_lose_context"))==null||e.loseContext(),!0):!1}catch{return!1}}constructor(e,t={}){var i,r;if(!e||typeof e.getContext!="function")throw new TypeError("LiquidGlassWebGL needs an HTMLCanvasElement.");this.canvas=e,this.compositeMode=fs(t.compositeMode??ne.REPLACE),this.renderer=new Je(e,{alpha:this.compositeMode===ne.OVERLAY,preserveDrawingBuffer:!!t.preserveDrawingBuffer}),this.material=typeof t.material=="string"?ue(t.material):{...ue("regular"),...t.material||{}},this.elements=[],this.fusion=!!(t.fusion??!1),this.wallpaperIndex=0,this.wallpaperZoom=t.wallpaperZoom??1,this.running=!1,this.animationFrame=0,this.onContextLost=t.onContextLost??null,this.onContextRestored=t.onContextRestored??null,this.dirty=!0,this.backdropDirty=!0,this.lastFrame={width:0,height:0,dpr:0},this.warnedShapeLimit=!1,this.respectReducedTransparency=t.respectReducedTransparency??!0,this.reducedTransparencyQuery=this.respectReducedTransparency?vs(ds):null,this.handleReducedTransparencyChange=()=>{this.markDirty(),this.render()},(r=(i=this.reducedTransparencyQuery)==null?void 0:i.addEventListener)==null||r.call(i,"change",this.handleReducedTransparencyChange),this.handleContextLost=a=>{var n;a.preventDefault(),this.renderer.handleContextLost(),this.markBackdropDirty(),(n=this.onContextLost)==null||n.call(this,a)},this.handleContextRestored=a=>{var n;this.renderer.restore(),this.markBackdropDirty(),this.lastFrame={width:0,height:0,dpr:0},(n=this.onContextRestored)==null||n.call(this,a),this.render()},e.addEventListener("webglcontextlost",this.handleContextLost,!1),e.addEventListener("webglcontextrestored",this.handleContextRestored,!1),this.resizeObserver=null,(t.autoResize??!0)&&typeof globalThis.ResizeObserver=="function"&&(this.resizeObserver=new globalThis.ResizeObserver(()=>{this.markDirty(),this.render()}),this.resizeObserver.observe(e)),t.elements&&this.setElements(t.elements,!1),t.wallpapers&&this.setWallpapers(t.wallpapers,!1),t.backdrop&&this.setBackdrop(t.backdrop,{update:t.backdropUpdate,autoStart:t.autoStart,shouldRender:!1})}get contextLost(){return this.renderer.lost}get reducedTransparency(){var e;return!!((e=this.reducedTransparencyQuery)!=null&&e.matches)}get effectiveMaterial(){return this.reducedTransparency?{...this.material,...$t}:this.material}markDirty(){return this.dirty=!0,this}markBackdropDirty(){return this.backdropDirty=!0,this.markDirty()}setElements(e,t=!0){return this.elements=e.map((i,r)=>ve(i,r)),this.markDirty(),t&&this.render(),this}addElement(e,t=!0){const i=ve(e,this.elements.length);return this.elements.push(i),this.markDirty(),t&&this.render(),i.id}updateElement(e,t,i=!0){const r=this.elements.findIndex(a=>a.id===e);return r===-1?this:(this.elements[r]=ve({...this.elements[r],...t},r),this.markDirty(),i&&this.render(),this)}removeElement(e,t=!0){return this.elements=this.elements.filter(i=>i.id!==e),this.markDirty(),t&&this.render(),this}setMaterial(e,t=!0){return this.material=typeof e=="string"?ue(e):{...this.material,...e||{}},this.markDirty(),t&&this.render(),this}setFusion(e,t=this.material.mergeRadius,i=!0){return this.fusion=!!e,Number.isFinite(t)&&(this.material.mergeRadius=Math.max(0,t)),this.markDirty(),i&&this.render(),this}setWallpapers(e,t=!0){return this.renderer.setWallpapers(e,{update:W.STATIC}),this.markBackdropDirty(),t&&this.render(),this}setBackdrop(e,t={}){if(!e||typeof e=="string")throw new TypeError("setBackdrop needs a CanvasImageSource. Use loadBackdrop for a URL.");const i=ms(e,t.update);return this.renderer.setWallpapers([e],{update:i,scale:t.scale}),this.wallpaperIndex=0,this.markBackdropDirty(),(t.autoStart??i===W.LIVE)&&this.start(),(t.shouldRender??!0)&&this.render(),this}async loadBackdrop(e,t={}){const i=await Qe(e);return this.setBackdrop(i,{...t,update:t.update??W.STATIC})}updateBackdrop(e=!0){return this.renderer.refreshWallpapers(!0),this.markBackdropDirty(),e&&this.render(),this}async loadWallpapers(e,t=!0){const i=await Promise.all(e.map(Qe));return this.setWallpapers(i,t)}async setWallpaper(e,t=!0){return this.loadWallpapers([e],t)}setWallpaperIndex(e,t=!0){return this.wallpaperIndex=Math.max(0,Math.floor(e)),this.markBackdropDirty(),t&&this.render(),this}distanceAt(e,t,i={}){const r=i.fusion??this.fusion?i.mergeRadius??this.material.mergeRadius:0;return Ht(e,t,this.elements,this.material,r)}hitTest(e,t,i={}){return Gt(e,t,this.elements,this.material,{fusion:i.fusion??this.fusion,mergeRadius:i.mergeRadius,tolerance:i.tolerance??0})}pointerPosition(e){var r,a;const t=this.canvas.getBoundingClientRect(),i=((r=e.touches)==null?void 0:r[0])??((a=e.changedTouches)==null?void 0:a[0])??e;return{x:i.clientX-t.left,y:i.clientY-t.top}}hitTestEvent(e,t={}){const{x:i,y:r}=this.pointerPosition(e),a=t.tolerance??(e.pointerType&&e.pointerType!=="mouse"?8:0);return this.hitTest(i,r,{...t,tolerance:a})}start(){if(this.running)return this;if(typeof globalThis.requestAnimationFrame!="function")throw new Error("LiquidGlassWebGL.start() requires requestAnimationFrame.");this.running=!0;const e=()=>{this.running&&(this.render(),this.animationFrame=globalThis.requestAnimationFrame(e))};return this.animationFrame=globalThis.requestAnimationFrame(e),this}stop(){return this.running=!1,this.animationFrame&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(this.animationFrame),this.animationFrame=0,this}resize(e=this.canvas.clientWidth||this.canvas.width||1,t=this.canvas.clientHeight||this.canvas.height||1,i=Math.min(globalThis.devicePixelRatio||1,2)){return this.renderer.resize(Math.round(e*i),Math.round(t*i)),{width:e,height:t,dpr:i}}render(e={}){if(this.renderer.lost)return this;const t=this.canvas.clientWidth||this.canvas.width||1,i=this.canvas.clientHeight||this.canvas.height||1,r=Number(e.dpr??globalThis.devicePixelRatio??1),a=Math.max(.5,Math.min(Number.isFinite(r)?r:1,2)),n=t!==this.lastFrame.width||i!==this.lastFrame.height||a!==this.lastFrame.dpr;if(!e.force&&!this.dirty&&!n&&!this.renderer.hasLiveBackdrop())return this;const l=this.renderer.hasLiveBackdrop();this.resize(t,i,a),(this.backdropDirty||n||l)&&(this.renderer.buildBackdrop(this.wallpaperIndex,this.wallpaperZoom),this.backdropDirty=!1),this.compositeMode===ne.OVERLAY?this.renderer.clearOutput():this.renderer.drawBackdrop();const o=this.effectiveMaterial;if(this.fusion){const{groups:h,truncated:c}=ke(this.elements,o.mergeRadius,16);c&&!this.warnedShapeLimit&&(this.warnedShapeLimit=!0,console.warn("LiquidGlassWebGL: more than 16 fused shapes are within merging distance of each other. They are drawn in separate passes, so the silhouette will not bridge across every one of them."));for(const u of h)this.renderer.drawGlassGroup(u,o,a,o.mergeRadius)}else for(const h of this.elements)this.renderer.drawGlass(h,o,a);return this.dirty=!1,this.lastFrame={width:t,height:i,dpr:a},this}destroy(){var e,t,i;this.stop(),this.canvas.removeEventListener("webglcontextlost",this.handleContextLost,!1),this.canvas.removeEventListener("webglcontextrestored",this.handleContextRestored,!1),(t=(e=this.reducedTransparencyQuery)==null?void 0:e.removeEventListener)==null||t.call(e,"change",this.handleReducedTransparencyChange),(i=this.resizeObserver)==null||i.disconnect(),this.resizeObserver=null,this.renderer.destroy(),this.elements=[]}}export{W as BACKDROP_UPDATES,ne as COMPOSITE_MODES,et as DEFAULT_MATERIAL,qt as DEFAULT_MATERIAL_V1,et as DEFAULT_MATERIAL_V2,os as DEFAULT_NAVIGATION_LENS,xs as LiquidGlass,ws as LiquidGlassNavbar,Ss as LiquidGlassSwitch,oe as LiquidGlassWebGL,Ts as LiquidGlassWebGLV1,oe as LiquidGlassWebGLV2,bs as MAX_GLASS_SHAPES,Xt as MIPS,Vt as PRESETS_V1,ns as PRESSED_CONTROL_MATERIAL_V2,Kt as REDUCED_TRANSPARENCY_MATERIAL,$t as REDUCED_TRANSPARENCY_MATERIAL_V1,Kt as REDUCED_TRANSPARENCY_MATERIAL_V2,Ae as SHAPES,ys as SLIDERS,ys as SLIDERS_V2,Ot as connectedElementGroups,ei as distanceToElements,ei as distanceToElementsV2,Le as getDefaultMaterial,jt as getDefaultMaterialV1,Le as getDefaultMaterialV2,je as getPressedControlMaterialV2,ke as groupElements,ti as hitTestElements,Gt as hitTestElementsV1,ti as hitTestElementsV2,$ as makeMaterial,ue as makeMaterialV1,$ as makeMaterialV2,Ze as sdGroup};
