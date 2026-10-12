const Z=`#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`,tt=`#version 300 es
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
}`,it=`#version 300 es
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
void main() { outColor = vec4(linearToSrgb(texture(uTex, vUV).rgb), 1.0); }`,rt=`#version 300 es
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
}`,at=`#version 300 es
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
}`,st=`#version 300 es
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
}`,ot=`#version 300 es
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
}`;const nt=`#version 300 es
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
}`;function fe(r,e,t){const i=r.createShader(e);if(r.shaderSource(i,t),r.compileShader(i),!r.getShaderParameter(i,r.COMPILE_STATUS)){const a=r.getShaderInfoLog(i);throw r.deleteShader(i),new Error(a+`
`+t)}return i}function Y(r,e,t){const i=r.createProgram(),a=fe(r,r.VERTEX_SHADER,e);let s;try{s=fe(r,r.FRAGMENT_SHADER,t)}catch(n){throw r.deleteShader(a),r.deleteProgram(i),n}if(r.attachShader(i,a),r.attachShader(i,s),r.linkProgram(i),r.detachShader(i,a),r.detachShader(i,s),r.deleteShader(a),r.deleteShader(s),!r.getProgramParameter(i,r.LINK_STATUS)){const n=r.getProgramInfoLog(i);throw r.deleteProgram(i),new Error(n)}const o={},h=r.getProgramParameter(i,r.ACTIVE_UNIFORMS);for(let n=0;n<h;n++){const l=r.getActiveUniform(i,n).name.replace("[0]","");o[l]=r.getUniformLocation(i,l)}return{p:i,loc:o}}const lt=7;class ht{constructor(e,t={}){const i=e.getContext("webgl2",{alpha:!!t.alpha,antialias:!1,premultipliedAlpha:!0,preserveDrawingBuffer:!!t.preserveDrawingBuffer});if(!i)throw new Error("WebGL2 unavailable");this.gl=i,this.canvas=e,this.materialVersion=t.materialVersion===2?2:1,this.lost=!1,this.tex=null,this.blurTex=null,this.wallpapers=[],this.fbos=[],this.blurFbos=[],this.mipLevels=0,this.w=0,this.h=0,this.createResources()}createResources(){const e=this.gl;this.quad=e.createVertexArray(),e.bindVertexArray(this.quad),this.quadBuffer=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,this.quadBuffer),e.bufferData(e.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.bindVertexArray(null),this.progWall=Y(e,Z,st),this.progDown=Y(e,Z,rt),this.progUp=Y(e,Z,at),this.progBlit=Y(e,Z,it),this.progGlass=Y(e,tt,this.materialVersion===2?nt:ot),this.fallbackTexture=e.createTexture(),e.bindTexture(e.TEXTURE_2D,this.fallbackTexture),e.texImage2D(e.TEXTURE_2D,0,e.SRGB8_ALPHA8,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.bindTexture(e.TEXTURE_2D,null)}releaseResources(){const e=this.gl;for(const t of[this.progWall,this.progDown,this.progUp,this.progBlit,this.progGlass])t&&e.deleteProgram(t.p);this.progWall=null,this.progDown=null,this.progUp=null,this.progBlit=null,this.progGlass=null,this.quad&&e.deleteVertexArray(this.quad),this.quadBuffer&&e.deleteBuffer(this.quadBuffer),this.fallbackTexture&&e.deleteTexture(this.fallbackTexture),this.quad=null,this.quadBuffer=null,this.fallbackTexture=null}releaseTargets(){const e=this.gl;this.tex&&e.deleteTexture(this.tex),this.blurTex&&e.deleteTexture(this.blurTex),this.fbos.forEach(t=>e.deleteFramebuffer(t)),this.blurFbos.forEach(t=>e.deleteFramebuffer(t)),this.tex=null,this.blurTex=null,this.fbos=[],this.blurFbos=[],this.mipLevels=0}handleContextLost(){this.lost=!0,this.progWall=null,this.progDown=null,this.progUp=null,this.progBlit=null,this.progGlass=null,this.quad=null,this.quadBuffer=null,this.fallbackTexture=null,this.tex=null,this.blurTex=null,this.fbos=[],this.blurFbos=[];for(const e of this.wallpapers)e.texture=null,e.ready=!1,e.width=0,e.height=0}restore(){if(!this.lost)return this;this.lost=!1,this.createResources();const{w:e,h:t}=this;return this.w=0,this.h=0,e>0&&t>0&&this.resize(e,t),this.createWallpaperTextures(),this}hasLiveBackdrop(){return this.wallpapers.some(e=>e.update==="live")}sourceSize(e){return[Number((e==null?void 0:e.videoWidth)||(e==null?void 0:e.naturalWidth)||(e==null?void 0:e.width)||0),Number((e==null?void 0:e.videoHeight)||(e==null?void 0:e.naturalHeight)||(e==null?void 0:e.height)||0)]}isPremultipliedSource(e){var i,a,s;const t=(i=e==null?void 0:e.tagName)==null?void 0:i.toUpperCase();return t==="CANVAS"||t==="VIDEO"||((a=e==null?void 0:e.constructor)==null?void 0:a.name)==="OffscreenCanvas"||((s=e==null?void 0:e.constructor)==null?void 0:s.name)==="VideoFrame"}uploadSource(e){const[t,i]=this.sourceSize(e.source),a=Math.min(1,Math.max(.1,Number(e.scale)||1));if(a>=1||!this.isPremultipliedSource(e.source))return[e.source,t,i];const s=Math.max(1,Math.round(t*a)),o=Math.max(1,Math.round(i*a));e.scaled||(e.scaled=typeof document<"u"?document.createElement("canvas"):new globalThis.OffscreenCanvas(s,o)),e.scaled.width!==s&&(e.scaled.width=s),e.scaled.height!==o&&(e.scaled.height=o);const h=e.scaled.getContext("2d");return h.clearRect(0,0,s,o),h.drawImage(e.source,0,0,s,o),[e.scaled,s,o]}probeSource(e){const t=this.wallpapers[e];if(!t)return null;const i=Math.min(1,Math.max(.1,Number(t.scale)||1));return t.scaled&&i<1?t.scaled:t.source}uploadWallpaper(e,t=!1){if(this.lost||!e.texture)return!1;const[i,a]=this.sourceSize(e.source);if(!(i>0)||!(a>0))return!1;const[s,o,h]=this.uploadSource(e),n=this.gl;n.bindTexture(n.TEXTURE_2D,e.texture);const l=this.isPremultipliedSource(s);return n.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,l),!t&&e.ready&&e.width===o&&e.height===h?n.texSubImage2D(n.TEXTURE_2D,0,0,0,n.RGBA,n.UNSIGNED_BYTE,s):n.texImage2D(n.TEXTURE_2D,0,n.RGBA8,n.RGBA,n.UNSIGNED_BYTE,s),n.pixelStorei(n.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.width=o,e.height=h,e.ready=!0,!0}setWallpaperScale(e){const t=Math.min(1,Math.max(.1,Number(e)||1));let i=!1;for(const a of this.wallpapers)(a.scale??1)!==t&&(i=!0),a.scale=t;return i}resize(e,t){if(e=Math.max(1,Math.round(e)),t=Math.max(1,Math.round(t)),this.lost){this.w=e,this.h=t;return}if(e===this.w&&t===this.h)return;const i=this.gl;this.w=e,this.h=t,this.canvas.width=e,this.canvas.height=t,this.releaseTargets(),this.mipLevels=Math.min(lt,Math.floor(Math.log2(Math.max(e,t)))+1);const a=()=>{const s=i.createTexture();return i.bindTexture(i.TEXTURE_2D,s),i.texStorage2D(i.TEXTURE_2D,this.mipLevels,i.SRGB8_ALPHA8,e,t),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR_MIPMAP_LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),s};this.tex=a(),this.blurTex=a(),this.fbos=[],this.blurFbos=[];for(let s=0;s<this.mipLevels;s++){const o=i.createFramebuffer();i.bindFramebuffer(i.FRAMEBUFFER,o),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,this.tex,s),this.fbos.push(o);const h=i.createFramebuffer();i.bindFramebuffer(i.FRAMEBUFFER,h),i.framebufferTexture2D(i.FRAMEBUFFER,i.COLOR_ATTACHMENT0,i.TEXTURE_2D,this.blurTex,s),this.blurFbos.push(h)}i.bindFramebuffer(i.FRAMEBUFFER,null)}createWallpaperTextures(){if(this.lost)return;const e=this.gl;for(const t of this.wallpapers)t.texture&&e.deleteTexture(t.texture),t.texture=e.createTexture(),t.ready=!1,t.width=0,t.height=0,e.bindTexture(e.TEXTURE_2D,t.texture),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),this.uploadWallpaper(t,!0);e.bindTexture(e.TEXTURE_2D,null)}setWallpapers(e,t={}){const i=this.gl,a=t.update==="live"?"live":"static",s=Math.min(1,Math.max(.1,Number(t.scale)||1));this.lost||this.wallpapers.forEach(o=>i.deleteTexture(o.texture)),this.wallpapers=e.map(o=>({texture:null,source:o,update:a,scale:s,scaled:null,ready:!1,width:0,height:0})),this.createWallpaperTextures()}refreshWallpapers(e=!1){if(!this.lost){for(const t of this.wallpapers)(e||t.update==="live")&&this.uploadWallpaper(t);this.gl.bindTexture(this.gl.TEXTURE_2D,null)}}mipSize(e){return[Math.max(1,this.w>>e),Math.max(1,this.h>>e)]}buildBackdrop(e,t=1){if(this.lost||!this.fbos.length)return;const i=this.gl;this.refreshWallpapers(),i.bindVertexArray(this.quad),i.disable(i.BLEND),i.bindFramebuffer(i.FRAMEBUFFER,this.fbos[0]),i.viewport(0,0,this.w,this.h),i.useProgram(this.progWall.p),i.uniform2f(this.progWall.loc.uRes,this.w,this.h),i.uniform1i(this.progWall.loc.uScene,e),i.uniform1f(this.progWall.loc.uZoom,t);const a=this.wallpapers[e];if(i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,a!=null&&a.ready?a.texture:this.fallbackTexture),i.uniform1i(this.progWall.loc.uWallpaper,1),i.uniform1i(this.progWall.loc.uUseImage,a!=null&&a.ready?1:0),i.drawArrays(i.TRIANGLE_STRIP,0,4),this.downsampleBackdrop(),this.materialVersion===2)return;const s=this.mipLevels-1,[o,h]=this.mipSize(s);i.bindFramebuffer(i.READ_FRAMEBUFFER,this.fbos[s]),i.bindFramebuffer(i.DRAW_FRAMEBUFFER,this.blurFbos[s]),i.blitFramebuffer(0,0,o,h,0,0,o,h,i.COLOR_BUFFER_BIT,i.NEAREST),i.bindVertexArray(this.quad),i.useProgram(this.progUp.p),i.uniform1i(this.progUp.loc.uLow,0),i.uniform1i(this.progUp.loc.uHigh,1);for(let n=s-1;n>=0;n--){const[l,c]=this.mipSize(n+1),[d,x]=this.mipSize(n);i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,this.blurTex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,n+1),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,n+1),i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,this.tex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,n),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,n),i.bindFramebuffer(i.FRAMEBUFFER,this.blurFbos[n]),i.viewport(0,0,d,x),i.uniform2f(this.progUp.loc.uLowTexel,1/l,1/c),i.drawArrays(i.TRIANGLE_STRIP,0,4)}i.activeTexture(i.TEXTURE0),i.bindTexture(i.TEXTURE_2D,this.blurTex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,0),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,this.mipLevels-1),i.activeTexture(i.TEXTURE1),i.bindTexture(i.TEXTURE_2D,this.tex),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_BASE_LEVEL,0),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAX_LEVEL,this.mipLevels-1)}downsampleBackdrop(){if(this.lost||!this.fbos.length)return;const e=this.gl;e.bindVertexArray(this.quad),e.disable(e.BLEND),e.useProgram(this.progDown.p),e.uniform1i(this.progDown.loc.uTex,0),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.tex);for(let t=1;t<this.mipLevels;t++){const[i,a]=this.mipSize(t-1),[s,o]=this.mipSize(t);e.texParameteri(e.TEXTURE_2D,e.TEXTURE_BASE_LEVEL,t-1),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAX_LEVEL,t-1),e.bindFramebuffer(e.FRAMEBUFFER,this.fbos[t]),e.viewport(0,0,s,o),e.uniform2f(this.progDown.loc.uTexel,1/i,1/a),e.drawArrays(e.TRIANGLE_STRIP,0,4)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_BASE_LEVEL,0),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAX_LEVEL,this.mipLevels-1)}beginBackdropLayer(){if(this.lost||!this.fbos.length||!this.blurFbos.length)return!1;const e=this.gl;return e.bindFramebuffer(e.READ_FRAMEBUFFER,this.fbos[0]),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,this.blurFbos[0]),e.blitFramebuffer(0,0,this.w,this.h,0,0,this.w,this.h,e.COLOR_BUFFER_BIT,e.NEAREST),!0}commitBackdropLayer(){this.lost||!this.fbos.length||!this.blurFbos.length||([this.tex,this.blurTex]=[this.blurTex,this.tex],[this.fbos,this.blurFbos]=[this.blurFbos,this.fbos],this.downsampleBackdrop())}drawBackdrop(){if(this.lost||!this.tex)return;const e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this.w,this.h),e.disable(e.BLEND),e.bindVertexArray(this.quad),e.useProgram(this.progBlit.p),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.tex),e.uniform1i(this.progBlit.loc.uTex,0),e.drawArrays(e.TRIANGLE_STRIP,0,4)}clearOutput(){if(this.lost)return;const e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this.w,this.h),e.disable(e.BLEND),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT)}drawGlassGroup(e,t,i,a=t.mergeRadius??0){if(!e.length||this.lost||!this.tex)return;const s=this.gl,{loc:o,p:h}=this.progGlass,n=e.slice(0,16),l=Math.min(...n.map(u=>u.x)),c=Math.min(...n.map(u=>u.y)),d=Math.max(...n.map(u=>u.x+u.w)),x=Math.max(...n.map(u=>u.y+u.h)),m=d-l,g=x-c;s.bindFramebuffer(s.FRAMEBUFFER,null),s.viewport(0,0,this.w,this.h),s.enable(s.BLEND),s.blendFunc(s.ONE,s.ONE_MINUS_SRC_ALPHA),s.bindVertexArray(this.quad),s.useProgram(h);const E=(l+m/2)*i,p=this.h-(c+g/2)*i,v=m/2*i,S=g/2*i,b=new Float32Array(16*2),R=new Float32Array(16*2),T=new Float32Array(16),f=new Int32Array(16);n.forEach((u,A)=>{const k=Math.min(u.w,u.h);b[A*2]=(u.x+u.w/2)*i,b[A*2+1]=this.h-(u.y+u.h/2)*i,R[A*2]=u.w/2*i,R[A*2+1]=u.h/2*i,T[A]=Math.min(u.radius??t.radius,k*.235)*i,f[A]=u.shape==="pill"?1:u.shape==="circle"?2:0}),s.activeTexture(s.TEXTURE0),s.bindTexture(s.TEXTURE_2D,this.tex),s.uniform1i(o.uSrc,0),s.activeTexture(s.TEXTURE2),s.bindTexture(s.TEXTURE_2D,this.blurTex),s.uniform1i(o.uBlurSrc,2),s.uniform2f(o.uRes,this.w,this.h),s.uniform2f(o.uCenter,E,p),s.uniform2f(o.uHalf,v,S),s.uniform1i(o.uShapeCount,n.length),s.uniform2fv(o.uShapeCenters,b),s.uniform2fv(o.uShapeHalves,R),s.uniform1iv(o.uShapeTypes,f),s.uniform1fv(o.uShapeRadii,T),s.uniform1f(o.uMergeRadius,Math.max(0,a)*i),s.uniform1f(o.uPad,(t.shadowSize*4+Math.max(a,0)*.3+8)*i),s.uniform1f(o.uSquircle,t.squircle),s.uniform1f(o.uBevel,t.bevel*i),s.uniform1f(o.uHeight,t.height*i),s.uniform1f(o.uSizeAdaptation,t.sizeAdaptation??1),s.uniform1f(o.uIOR,t.ior),s.uniform1f(o.uDispersion,t.dispersion),s.uniform1f(o.uBlurPlateau,t.blurPlateau*i),s.uniform1f(o.uBlurRim,t.blurRim*i),s.uniform1f(o.uOpticalDensity,t.opticalDensity),s.uniform1f(o.uMips,this.mipLevels),s.uniform1f(o.uSpecular,t.specular),s.uniform1f(o.uSpecPower,t.specPower),s.uniform1f(o.uHighlightAdapt,t.highlightAdapt),s.uniform1f(o.uHighlightWidth,t.highlightWidth),s.uniform1f(o.uHighlightSharpness,t.highlightSharpness),s.uniform1f(o.uHighlightBase,t.highlightBase),s.uniform1f(o.uFresnel,t.fresnel),s.uniform1f(o.uSat,t.saturation),s.uniform1f(o.uBright,t.brightness),s.uniform1f(o.uTintAmount,t.tintAmount),s.uniform3f(o.uTintColor,...t.tintColor),s.uniform1f(o.uTintAdapt,t.tintAdapt??0),s.uniform1f(o.uShadow,t.shadow),s.uniform1f(o.uShadowSize,t.shadowSize*i),s.uniform1f(o.uShadowOffset,t.shadowOffset*i),s.uniform2f(o.uLightDir,t.lightX,t.lightY),s.uniform1f(o.uEdgeLine,t.edgeLine),s.uniform1f(o.uEdgeWidth,t.edgeWidth*i),s.uniform1f(o.uEdgeDark,t.edgeDark),s.uniform1f(o.uRefractScale,t.refractScale),s.uniform1f(o.uMeniscus,t.meniscus),s.uniform1i(o.uDebug,t.debug|0),s.drawArrays(s.TRIANGLE_STRIP,0,4),s.disable(s.BLEND)}drawGlass(e,t,i){this.drawGlassGroup([e],t,i,0)}drawGlassV2Group(e,t,i,a=[],s=[],o={}){if(!e.length||this.lost||!this.tex)return;const h=!!o.intoBackdrop&&this.blurFbos.length>0,n=this.gl,{loc:l,p:c}=this.progGlass,d=e.slice(0,16),x=Math.min(...d.map(y=>y.x)),m=Math.min(...d.map(y=>y.y)),g=Math.max(...d.map(y=>y.x+y.w)),E=Math.max(...d.map(y=>y.y+y.h)),p=g-x,v=E-m,S=new Float32Array(16*2),b=new Float32Array(16*2),R=new Float32Array(16),T=new Int32Array(16),f=new Float32Array(16*2),u=new Float32Array(16),A=new Float32Array(16),k=new Float32Array(16),B=new Float32Array(16),L=new Float32Array(16),M=new Float32Array(16*2);d.forEach((y,w)=>{var ue,de;const C=Math.min(y.w,y.h);S[w*2]=(y.x+y.w/2)*i,S[w*2+1]=this.h-(y.y+y.h/2)*i,b[w*2]=y.w/2*i,b[w*2+1]=y.h/2*i,R[w]=Math.min(y.radius??C*.5*t.roundness,C*.5)*i,T[w]=y.shape==="pill"?1:y.shape==="circle"?2:0;const H=a[w]??[Math.SQRT1_2,Math.SQRT1_2];f[w*2]=H[0],f[w*2+1]=H[1],u[w]=y.tint??t.tint,A[w]=s[w]??1,k[w]=y.frost??t.frost,B[w]=y.opacity??1,L[w]=y.pressure??0,M[w*2]=((ue=y.pressureAxes)==null?void 0:ue[0])??1,M[w*2+1]=((de=y.pressureAxes)==null?void 0:de[1])??1}),n.bindFramebuffer(n.FRAMEBUFFER,h?this.blurFbos[0]:null),n.viewport(0,0,this.w,this.h),n.enable(n.BLEND),n.blendFunc(n.ONE,n.ONE_MINUS_SRC_ALPHA),n.bindVertexArray(this.quad),n.useProgram(c),n.activeTexture(n.TEXTURE0),n.bindTexture(n.TEXTURE_2D,this.tex),n.uniform1i(l.uSrc,0),n.uniform1i(l.uOutputLinear,h?1:0),n.uniform2f(l.uRes,this.w,this.h),n.uniform1f(l.uDpr,i),n.uniform2f(l.uCenter,(x+p/2)*i,this.h-(m+v/2)*i),n.uniform2f(l.uHalf,p/2*i,v/2*i),n.uniform1f(l.uPad,4*i),n.uniform1f(l.uMips,this.mipLevels),n.uniform1i(l.uShapeCount,d.length),n.uniform2fv(l.uShapeCenters,S),n.uniform2fv(l.uShapeHalves,b),n.uniform1iv(l.uShapeTypes,T),n.uniform1fv(l.uShapeRadii,R),n.uniform1fv(l.uShapeTints,u),n.uniform1fv(l.uShapeTintLights,A),n.uniform1fv(l.uShapeFrosts,k),n.uniform1fv(l.uShapeOpacities,B),n.uniform1fv(l.uShapePressures,L),n.uniform2fv(l.uShapePressAxes,M),n.uniform2fv(l.uLightDirs,f),n.uniform1f(l.uRefraction,t.refraction*i),n.uniform1f(l.uEdgeReach,t.edgeReach),n.uniform1f(l.uBackdropBlur,(t.backdropBlur??0)*i),n.uniform1f(l.uEdgeWidth,t.edgeWidth),n.uniform1f(l.uDispersion,t.dispersion),n.uniform1f(l.uBody,t.body),n.uniform1f(l.uAbsorption,t.absorption),n.uniform1f(l.uRim,t.rim),n.uniform1f(l.uReflection,t.reflection),n.uniform1f(l.uHighlight,t.highlight),n.uniform1f(l.uEcho,t.echo),n.uniform1f(l.uHairline,t.hairline),n.uniform1f(l.uHairWidth,t.hairWidth),n.drawArrays(n.TRIANGLE_STRIP,0,4),n.disable(n.BLEND)}destroy(){if(this.lost){this.wallpapers=[];return}const e=this.gl;this.releaseTargets(),this.releaseResources(),this.wallpapers.forEach(t=>e.deleteTexture(t.texture)),this.wallpapers=[]}}const Ce=Object.freeze({refraction:84,edgeReach:.14,edgeWidth:.21,dispersion:2,frost:0,backdropBlur:0,body:.72,absorption:.58,tint:0,rim:.24,reflection:.31,highlight:.34,lightAngle:136,echo:.28,hairline:.92,hairWidth:.52,roundness:.47}),ct=Object.freeze({refraction:0,edgeReach:0,dispersion:0,frost:0,backdropBlur:0,body:1.5,tint:1.35,reflection:.18,highlight:.12,echo:0});function ut(){return{...Ce}}function K(r={}){if(typeof r=="string")throw new TypeError("Liquid Glass V2 does not use V1 preset names.");const e=Object.keys(r||{}).filter(t=>!(t in Ce));if(e.length)throw new TypeError(`Unknown Liquid Glass V2 material parameter${e.length===1?"":"s"}: ${e.join(", ")}`);return{...ut(),...r||{}}}const dt=Object.freeze({rect:0,folder:0,pill:1,circle:2});function ft(r){return dt[r]??0}function pe(r,e,t,i,a){const s=Math.min(a,t,i),o=Math.abs(r)-t+s,h=Math.abs(e)-i+s;return Math.min(Math.max(o,h),0)+Math.hypot(Math.max(o,0),Math.max(h,0))-s}function pt(r,e=.47){const t=Number(r.w??r.width??r.size??0),i=Number(r.h??r.height??r.size??t);return Number.isFinite(r.radius)?Math.max(0,Math.min(Number(r.radius),Math.min(t,i)*.5)):Math.min(t,i)*.5*e}function De(r,e,t,i={}){const a=Number(t.w??t.width??t.size??0),s=Number(t.h??t.height??t.size??a),o=a/2,h=s/2,n=r-Number(t.x??0)-o,l=e-Number(t.y??0)-h,c=ft(t.shape),d=pt({...t,w:a,h:s},i.roundness??.47);return c===1?pe(n,l,o,h,Math.min(o,h)):c===2?Math.hypot(n,l)-Math.min(o,h):pe(n,l,o,h,d)}function mt(r,e,t,i={}){let a=1/0;for(const s of t)a=Math.min(a,De(r,e,s,i));return a}function gt(r,e,t,i={},a={}){const s=a.tolerance??0;for(let o=t.length-1;o>=0;o--)if(De(r,e,t[o],i)<=s)return t[o];return null}const vt=new Set(["folder","rect","pill","circle"]),bt=new Set(["replace","overlay"]),xt=new Set(["auto","static","live"]),yt="(prefers-reduced-transparency: reduce)";function St(r){if(!bt.has(r))throw new TypeError(`Unknown liquid glass V2 composite mode: ${r}`);return r}function wt(r){const e=r==="folderRect"?"rect":r;if(!vt.has(e))throw new TypeError(`Unknown liquid glass V2 shape: ${r}`);return e}function te(r,e){const t=Number(r.w??r.width??r.size??0),i=Number(r.h??r.height??r.size??t);if(!Number.isFinite(t)||!Number.isFinite(i)||t<0||i<0)throw new TypeError("Liquid glass V2 elements need a finite, non-negative width and height.");const a=r.tint==null?void 0:Number(r.tint);if(a!==void 0&&!Number.isFinite(a))throw new TypeError("Liquid glass V2 element tint must be a finite number.");const s=r.frost==null?void 0:Number(r.frost);if(s!==void 0&&!Number.isFinite(s))throw new TypeError("Liquid glass V2 element frost must be a finite number.");const o=r.opacity==null?void 0:Number(r.opacity),h=Number(r.pressure??0);if(!Number.isFinite(h))throw new TypeError("Liquid glass V2 element pressure must be a finite number.");const n=r.pressureAxes==null?[1,1]:[Number(r.pressureAxes[0]??1),Number(r.pressureAxes[1]??1)];if(!n.every(Number.isFinite))throw new TypeError("Liquid glass V2 element pressureAxes must be two finite numbers.");if(o!==void 0&&!Number.isFinite(o))throw new TypeError("Liquid glass V2 element opacity must be a finite number.");const l=r.tintTone??"light";if(!["auto","light","dark"].includes(l))throw new TypeError(`Unknown liquid glass V2 tint tone: ${l}`);const c=Number(r.layer??0);if(!Number.isInteger(c)||c<0)throw new TypeError("Liquid glass V2 element layer must be a non-negative integer.");return{...r,id:r.id??`glass-v2-${e+1}`,shape:wt(r.shape??"rect"),x:Number(r.x??0),y:Number(r.y??0),w:t,h:i,...a===void 0?{}:{tint:a},...s===void 0?{}:{frost:s},...o===void 0?{}:{opacity:o},tintTone:l,layer:c,pressure:Math.max(0,Math.min(1,h)),pressureAxes:n.map(d=>Math.max(0,Math.min(1,d)))}}function Tt(r){const e=new Map;for(const t of r){const i=t.layer??0;e.has(i)||e.set(i,[]),e.get(i).push(t)}return[...e.keys()].sort((t,i)=>t-i).map(t=>e.get(t))}function me(r){const e=Number(r??1);if(!Number.isFinite(e)||e<=0||e>1)throw new TypeError("Liquid glass V2 backdrop scale must be a number in (0, 1].");return Math.max(.1,e)}function ge(r){return typeof r!="string"?Promise.resolve(r):new Promise((e,t)=>{const i=new Image;i.onload=()=>e(i),i.onerror=()=>t(new Error(`Unable to load liquid glass V2 wallpaper: ${r}`)),i.src=r})}function Et(r){var t,i,a;const e=(t=r==null?void 0:r.tagName)==null?void 0:t.toUpperCase();return e==="CANVAS"||e==="VIDEO"||((i=r==null?void 0:r.constructor)==null?void 0:i.name)==="OffscreenCanvas"||((a=r==null?void 0:r.constructor)==null?void 0:a.name)==="VideoFrame"}function Rt(r,e="auto"){if(!xt.has(e))throw new TypeError(`Unknown liquid glass V2 backdrop update mode: ${e}`);return e==="auto"?Et(r)?"live":"static":e}function At(r){return typeof globalThis.matchMedia=="function"?globalThis.matchMedia(r):null}function ve(r){return[Number((r==null?void 0:r.videoWidth)||(r==null?void 0:r.naturalWidth)||(r==null?void 0:r.width)||0),Number((r==null?void 0:r.videoHeight)||(r==null?void 0:r.naturalHeight)||(r==null?void 0:r.height)||0)]}function be(r,e,t,i){const a=Math.max(t/r,t/e)*i,s=r*a,o=e*a;return{x:(t-s)/2,y:(t-o)/2,width:s,height:o}}const kt=`
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
};`,xe=84;class Pe{static isSupported(){var e;if(typeof document>"u")return!1;try{const i=document.createElement("canvas").getContext("webgl2");return i?((e=i.getExtension("WEBGL_lose_context"))==null||e.loseContext(),!0):!1}catch{return!1}}constructor(e,t={}){var i,a;if(!e||typeof e.getContext!="function")throw new TypeError("LiquidGlassWebGLV2 needs an HTMLCanvasElement.");this.canvas=e,this.version="v2",this.compositeMode=St(t.compositeMode??"replace"),this.renderer=new ht(e,{alpha:this.compositeMode==="overlay",preserveDrawingBuffer:!!t.preserveDrawingBuffer,materialVersion:2}),this.material=K(t.material),this.elements=[],this.backdrops=[],this.wallpaperIndex=0,this.wallpaperZoom=t.wallpaperZoom??1,this.running=!1,this.animationFrame=0,this.dirty=!0,this.backdropDirty=!0,this.pyramidStale=!1,this.backdropScale=1,this.lightFieldDirty=!0,this.lastFrame={width:0,height:0,dpr:0},this.warnedShapeLimit=!1,this.lightCanvas=null,this.lightPixels=null,this.lightSampleSize=64,this.smoothedLightDirections=new Map,this.lastLightFieldUpdate=0,this.lastLightBlendTime=0,this.lastManualBackdropUpdate=-1/0,this.lightFieldAsyncDirty=!1,this.lightWorker=null,this.lightWorkerUnavailable=!1,this.lightProbeId=0,this.lightProbePending=!1,this.lightProbeQueued=!1,this.settledRenderFrame=0,this.onContextLost=t.onContextLost??null,this.onContextRestored=t.onContextRestored??null,this.respectReducedTransparency=t.respectReducedTransparency??!0,this.reducedTransparencyQuery=this.respectReducedTransparency?At(yt):null,this.handleReducedTransparencyChange=()=>{this.markDirty(),this.render()},(a=(i=this.reducedTransparencyQuery)==null?void 0:i.addEventListener)==null||a.call(i,"change",this.handleReducedTransparencyChange),this.handleContextLost=s=>{var o;s.preventDefault(),this.renderer.handleContextLost(),this.markBackdropDirty(),(o=this.onContextLost)==null||o.call(this,s)},this.handleContextRestored=s=>{var o;this.renderer.restore(),this.markBackdropDirty(),this.lastFrame={width:0,height:0,dpr:0},(o=this.onContextRestored)==null||o.call(this,s),this.render()},e.addEventListener("webglcontextlost",this.handleContextLost,!1),e.addEventListener("webglcontextrestored",this.handleContextRestored,!1),this.resizeObserver=null,(t.autoResize??!0)&&typeof globalThis.ResizeObserver=="function"&&(this.resizeObserver=new globalThis.ResizeObserver(()=>{this.lightFieldDirty=!0,this.markDirty(),this.render()}),this.resizeObserver.observe(e)),t.elements&&this.setElements(t.elements,!1),t.wallpapers&&this.setWallpapers(t.wallpapers,!1),t.backdrop&&this.setBackdrop(t.backdrop,{update:t.backdropUpdate,autoStart:t.autoStart,shouldRender:!1})}get contextLost(){return this.renderer.lost}get reducedTransparency(){var e;return!!((e=this.reducedTransparencyQuery)!=null&&e.matches)}get effectiveMaterial(){return this.reducedTransparency?{...this.material,...ct}:this.material}markDirty(){return this.dirty=!0,this}markBackdropDirty(){return this.backdropDirty=!0,this.lightFieldDirty=!0,this.lastLightFieldUpdate=0,this.smoothedLightDirections.clear(),this.markDirty()}setElements(e,t=!0){return this.elements=e.map((i,a)=>te(i,a)),this.markDirty(),t&&this.render(),this}addElement(e,t=!0){const i=te(e,this.elements.length);return this.elements.push(i),this.markDirty(),t&&this.render(),i.id}updateElement(e,t,i=!0){const a=this.elements.findIndex(s=>s.id===e);return a===-1?this:(this.elements[a]=te({...this.elements[a],...t},a),this.markDirty(),i&&this.render(),this)}removeElement(e,t=!0){return this.elements=this.elements.filter(i=>i.id!==e),this.markDirty(),t&&this.render(),this}setMaterial(e,t=!0){if(typeof e=="string")throw new TypeError("Liquid Glass V2 does not convert V1 preset names. Pass a V2 material object.");return this.material=K({...this.material,...e||{}}),this.markDirty(),t&&this.render(),this}setWallpapers(e,t=!0){return this.backdrops=e.slice(),this.renderer.setWallpapers(e,{update:"static"}),this.markBackdropDirty(),t&&this.render(),this}async loadWallpapers(e,t=!0){const i=await Promise.all(e.map(ge));return this.setWallpapers(i,t)}async setWallpaper(e,t=!0){return this.loadWallpapers([e],t)}setBackdrop(e,t={}){if(!e||typeof e=="string")throw new TypeError("setBackdrop needs a CanvasImageSource. Use loadBackdrop for a URL.");const i=Rt(e,t.update);return t.scale!==void 0&&(this.backdropScale=me(t.scale)),this.backdrops=[e],this.renderer.setWallpapers([e],{update:i,scale:this.backdropScale}),this.wallpaperIndex=0,this.markBackdropDirty(),(t.autoStart??i==="live")&&this.start(),(t.shouldRender??!0)&&this.render(),this}setBackdropScale(e,t=!0){const i=me(e);return i===this.backdropScale?this:(this.backdropScale=i,this.renderer.setWallpaperScale(i)&&!this.renderer.hasLiveBackdrop()&&this.renderer.refreshWallpapers(!0),this.markBackdropDirty(),t&&this.render(),this)}async loadBackdrop(e,t={}){const i=await ge(e);return this.setBackdrop(i,{...t,update:t.update??"static"})}updateBackdrop(e=!0){var a,s;this.renderer.refreshWallpapers(!0);const t=((s=(a=globalThis.performance)==null?void 0:a.now)==null?void 0:s.call(a))??Date.now(),i=t-this.lastManualBackdropUpdate<xe;return this.lastManualBackdropUpdate=t,i&&this.lightProbeWorker()?(this.backdropDirty=!0,this.lightFieldAsyncDirty=!0,this.markDirty()):this.markBackdropDirty(),e&&this.render(),this}setWallpaperIndex(e,t=!0){return this.wallpaperIndex=Math.max(0,Math.floor(e)),this.markBackdropDirty(),t&&this.render(),this}distanceAt(e,t){return mt(e,t,this.elements,this.material)}hitTest(e,t,i={}){return gt(e,t,this.elements,this.material,i)}pointerPosition(e){var a,s;const t=this.canvas.getBoundingClientRect(),i=((a=e.touches)==null?void 0:a[0])??((s=e.changedTouches)==null?void 0:s[0])??e;return{x:i.clientX-t.left,y:i.clientY-t.top}}hitTestEvent(e,t={}){const{x:i,y:a}=this.pointerPosition(e),s=t.tolerance??(e.pointerType&&e.pointerType!=="mouse"?8:0);return this.hitTest(i,a,{...t,tolerance:s})}start(){if(this.running)return this;if(typeof globalThis.requestAnimationFrame!="function")throw new Error("LiquidGlassWebGLV2.start() requires requestAnimationFrame.");this.running=!0;const e=()=>{this.running&&(this.render(),this.animationFrame=globalThis.requestAnimationFrame(e))};return this.animationFrame=globalThis.requestAnimationFrame(e),this}stop(){return this.running=!1,this.animationFrame&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(this.animationFrame),this.animationFrame=0,this}resize(e=this.canvas.clientWidth||this.canvas.width||1,t=this.canvas.clientHeight||this.canvas.height||1,i=Math.min(globalThis.devicePixelRatio||1,2)){return this.renderer.resize(Math.round(e*i),Math.round(t*i)),{width:e,height:t,dpr:i}}probeSource(){return this.renderer.probeSource(this.wallpaperIndex)??this.backdrops[this.wallpaperIndex]}updateLightField(){this.lightFieldDirty=!1,this.lightProbeId+=1,this.lightProbeQueued=!1;const e=this.probeSource(),[t,i]=ve(e);if(!(t>0)||!(i>0)||typeof document>"u"){this.lightPixels=null;return}this.lightCanvas||(this.lightCanvas=document.createElement("canvas"));const a=this.lightSampleSize;this.lightCanvas.width=a,this.lightCanvas.height=a;const s=this.lightCanvas.getContext("2d",{willReadFrequently:!0});if(!s){this.lightPixels=null;return}s.clearRect(0,0,a,a);const o=be(t,i,a,this.wallpaperZoom);try{s.drawImage(e,o.x,o.y,o.width,o.height),this.lightPixels=s.getImageData(0,0,a,a).data}catch{this.lightPixels=null}}lightProbeWorker(){var a;if(this.lightWorker||this.lightWorkerUnavailable)return this.lightWorker;if(typeof globalThis.Worker!="function"||typeof globalThis.OffscreenCanvas!="function"||typeof globalThis.createImageBitmap!="function"||typeof globalThis.Blob!="function"||typeof((a=globalThis.URL)==null?void 0:a.createObjectURL)!="function")return this.lightWorkerUnavailable=!0,null;let e="";const t=()=>{e&&globalThis.URL.revokeObjectURL(e),e=""};try{e=globalThis.URL.createObjectURL(new globalThis.Blob([kt],{type:"text/javascript"})),this.lightWorker=new globalThis.Worker(e)}catch{return t(),this.lightWorkerUnavailable=!0,null}const i=()=>{var s;(s=this.lightWorker)==null||s.terminate(),this.lightWorker=null,this.lightWorkerUnavailable=!0,this.lightProbePending=!1,this.lightFieldDirty=!0,this.markDirty()};return this.lightWorker.onerror=()=>{t(),i()},this.lightWorker.onmessage=({data:s})=>{if(t(),this.lightProbePending=!1,!s.pixels){i();return}s.id===this.lightProbeId&&(this.lightPixels=s.pixels,this.markDirty(),this.lightProbeQueued&&(this.lightProbeQueued=!1,this.requestLightField({queue:!0})),this.renderer.hasLiveBackdrop()||this.scheduleSettledRender())},this.lightWorker}requestLightField({queue:e=!1}={}){if(this.lightProbePending)return e&&(this.lightProbeQueued=!0),!0;const t=this.probeSource(),[i,a]=ve(t);if(!(i>0)||!(a>0)||!this.lightProbeWorker())return!1;const s=++this.lightProbeId,o=this.lightSampleSize,h=be(i,a,o,this.wallpaperZoom);return this.lightProbePending=!0,globalThis.createImageBitmap(t).then(n=>{if(s!==this.lightProbeId||!this.lightWorker){n.close(),s===this.lightProbeId&&(this.lightProbePending=!1);return}this.lightWorker.postMessage({id:s,bitmap:n,size:o,...h},[n])},()=>{s===this.lightProbeId&&(this.lightProbePending=!1)}),!0}scheduleSettledRender(){this.settledRenderFrame||typeof globalThis.requestAnimationFrame!="function"||(this.settledRenderFrame=globalThis.requestAnimationFrame(()=>{this.settledRenderFrame=0,this.dirty&&this.render({dpr:this.lastFrame.dpr||void 0})}))}sampleLuminance(e,t){if(!this.lightPixels)return .5;const i=this.lightSampleSize,a=Math.max(0,Math.min(i-1,Math.round(e*(i-1)))),o=(Math.max(0,Math.min(i-1,Math.round(t*(i-1))))*i+a)*4;return(this.lightPixels[o]*.2126+this.lightPixels[o+1]*.7152+this.lightPixels[o+2]*.0722)/255}lightDirection(e,t,i,a){const s=[-.34,0,.34];let o=0,h=0;for(const R of s)for(const T of s){const f=(e.x+e.w*(.5+T))/Math.max(t,1),u=(e.y+e.h*(.5+R))/Math.max(i,1),A=this.sampleLuminance(f,u);o+=T*A,h+=R*A}const n=a*Math.PI/180,l=Math.cos(n),c=Math.sin(n),d=Math.hypot(o,h)/s.length;if(d<.008)return[l,c];const x=Math.hypot(o,h)||1,m=-o/x,g=h/x,E=Math.max(0,Math.min(1,(d-.015)/.13)),p=E*E*(3-2*E)*.58,v=l*(1-p)+m*p,S=c*(1-p)+g*p,b=Math.hypot(v,S)||1;return[v/b,S/b]}tintLightForElement(e,t,i){if(e.tintTone==="light")return 1;if(e.tintTone==="dark")return 0;const a=[-24,0,24],s=e.x+e.w*.5,o=e.y+e.h*.5;let h=0;for(const c of a)for(const d of a){const x=(s+d)/Math.max(t,1),m=(o+c)/Math.max(i,1);h+=this.sampleLuminance(x,m)}const n=h/(a.length*a.length),l=Math.max(0,Math.min(1,(n-.22)/(.5-.22)));return l*l*(3-2*l)}render(e={}){var R,T;if(this.renderer.lost)return this;const t=this.canvas.clientWidth||this.canvas.width||1,i=this.canvas.clientHeight||this.canvas.height||1,a=Number(e.dpr??globalThis.devicePixelRatio??1),s=Math.max(.5,Math.min(Number.isFinite(a)?a:1,2)),o=t!==this.lastFrame.width||i!==this.lastFrame.height||s!==this.lastFrame.dpr,h=this.renderer.hasLiveBackdrop();if(!e.force&&!this.dirty&&!o&&!h)return this;this.resize(t,i,s);const n=Tt(this.elements.filter(f=>f.w>0&&f.h>0));if(this.compositeMode==="overlay"&&!n.length)return this.renderer.clearOutput(),o&&(this.pyramidStale=!0),this.dirty=!1,this.lastFrame={width:t,height:i,dpr:s},this;const l=((T=(R=globalThis.performance)==null?void 0:R.now)==null?void 0:T.call(R))??Date.now(),c=this.backdropDirty||o||h;if((c||this.pyramidStale)&&(this.renderer.buildBackdrop(this.wallpaperIndex,this.wallpaperZoom),this.pyramidStale=!1),c){const f=h&&l-this.lastLightFieldUpdate>=xe;if(this.lightFieldDirty||o)this.updateLightField(),this.lastLightFieldUpdate=l;else if(f||this.lightFieldAsyncDirty){const u=this.lightFieldAsyncDirty;this.lightFieldAsyncDirty=!1,this.requestLightField({queue:u})||this.updateLightField(),this.lastLightFieldUpdate=l}this.backdropDirty=!1}this.compositeMode==="overlay"?this.renderer.clearOutput():this.renderer.drawBackdrop();const d=this.effectiveMaterial,x=n.flat(),m=this.lastLightBlendTime?Math.min(100,l-this.lastLightBlendTime):100,g=h?1-Math.exp(-m/280):1,E=new Set(x.map(f=>f.id));for(const f of this.smoothedLightDirections.keys())E.has(f)||this.smoothedLightDirections.delete(f);const p=x.map(f=>{const u=this.lightDirection(f,t,i,d.lightAngle),A=this.smoothedLightDirections.get(f.id);if(!A||g>=1)return this.smoothedLightDirections.set(f.id,u),u;const k=A[0]*(1-g)+u[0]*g,B=A[1]*(1-g)+u[1]*g,L=Math.hypot(k,B)||1,M=[k/L,B/L];return this.smoothedLightDirections.set(f.id,M),M}),v=x.map(f=>this.tintLightForElement(f,t,i));this.lastLightBlendTime=l,n.some(f=>f.length>16)&&!this.warnedShapeLimit&&(this.warnedShapeLimit=!0,console.warn("LiquidGlassWebGLV2: more than 16 shapes require multiple passes; overlapping shapes across a pass boundary may composite differently."));const S=(f,u,A)=>{for(let k=0;k<f.length;k+=16)this.renderer.drawGlassV2Group(f.slice(k,k+16),d,s,p.slice(u+k,u+k+16),v.slice(u+k,u+k+16),{intoBackdrop:A})};let b=0;return n.forEach((f,u)=>{S(f,b,!1),u<n.length-1&&this.renderer.beginBackdropLayer()&&(S(f,b,!0),this.renderer.commitBackdropLayer(),this.pyramidStale=!0),b+=f.length}),this.dirty=!1,this.lastFrame={width:t,height:i,dpr:s},this}destroy(){var e,t,i,a;this.stop(),this.lightProbeId+=1,this.settledRenderFrame&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(this.settledRenderFrame),this.settledRenderFrame=0,(e=this.lightWorker)==null||e.terminate(),this.lightWorker=null,this.lightProbePending=!1,this.canvas.removeEventListener("webglcontextlost",this.handleContextLost,!1),this.canvas.removeEventListener("webglcontextrestored",this.handleContextRestored,!1),(i=(t=this.reducedTransparencyQuery)==null?void 0:t.removeEventListener)==null||i.call(t,"change",this.handleReducedTransparencyChange),(a=this.resizeObserver)==null||a.disconnect(),this.resizeObserver=null,this.renderer.destroy(),this.elements=[],this.backdrops=[],this.lightPixels=null,this.lightCanvas=null,this.smoothedLightDirections.clear()}}const W=new Set,I=new Map;let V=0,se=0,J=!1,F=null,q=0;const ye=()=>q;function Lt(){q++,D(34)}const _e=()=>{var r,e;return((e=(r=globalThis.performance)==null?void 0:r.now)==null?void 0:e.call(r))??Date.now()};function he(){!V&&typeof globalThis.requestAnimationFrame=="function"&&(V=globalThis.requestAnimationFrame(Bt))}function D(r=0){se=Math.max(se,_e()+r),he()}function Mt(){for(const r of I.keys())r.isConnected||I.delete(r);return I.size>0}function Bt(){V=0;const r=_e();I.size&&q++;const e=[];for(const i of W)i.visible&&e.push(i);for(const i of e)try{i.measure(r)}catch(a){console.error(a)}let t=!1;for(const i of e)try{i.draw(r)&&(t=!0)}catch(a){console.error(a)}(t||r<se||Mt())&&he()}function Ct(r){if(!r||typeof r.contains!="function")return!1;for(const e of W)for(const t of e.trackedElements())if(r===t||r.contains(t))return!0;return!1}const Fe=()=>{q++,D(160)},Ue=()=>{q++,W.forEach(r=>{var e;return(e=r.onViewportResize)==null?void 0:e.call(r)}),D(320)},Ie=r=>{Ct(r.target)&&(I.set(r.target,(I.get(r.target)??0)+1),he())},He=r=>{const e=I.get(r.target);e&&(e<=1?I.delete(r.target):I.set(r.target,e-1),D(34))},ze=()=>{q++,D(200)};function Dt(){var e,t;if(J||typeof globalThis.addEventListener!="function")return;J=!0;const r={capture:!0,passive:!0};globalThis.addEventListener("scroll",Fe,r),globalThis.addEventListener("resize",Ue,{passive:!0});for(const i of["transitionrun","animationstart"])document.addEventListener(i,Ie,!0);for(const i of["transitionend","transitioncancel","animationend","animationcancel"])document.addEventListener(i,He,!0);(t=(e=document.fonts)==null?void 0:e.addEventListener)==null||t.call(e,"loadingdone",ze),typeof globalThis.IntersectionObserver=="function"&&(F=new globalThis.IntersectionObserver(i=>{for(const a of i)for(const s of W)s.element===a.target&&(s.visible=a.isIntersecting);D(64)},{rootMargin:"256px"}))}function Pt(){var r,e;if(J){J=!1,globalThis.removeEventListener("scroll",Fe,!0),globalThis.removeEventListener("resize",Ue);for(const t of["transitionrun","animationstart"])document.removeEventListener(t,Ie,!0);for(const t of["transitionend","transitioncancel","animationend","animationcancel"])document.removeEventListener(t,He,!0);(e=(r=document.fonts)==null?void 0:r.removeEventListener)==null||e.call(r,"loadingdone",ze),F==null||F.disconnect(),F=null,I.clear(),V&&typeof globalThis.cancelAnimationFrame=="function"&&globalThis.cancelAnimationFrame(V),V=0}}function _t(r){W.add(r),r.visible=!0,Dt(),F==null||F.observe(r.element),D(120)}function Ft(r){W.delete(r)&&(F==null||F.unobserve(r.element),W.size||Pt())}function Ut(r){W.forEach(r)}const Ne="data-liquid-glass-layer",It=/(^(data|blob|https?):)|\/|\.(avif|webp|png|apng|jpe?g|gif|svg|bmp|ico)([?#]|$)/i,Xe=new Set(["IMG","VIDEO","CANVAS"]),U=r=>typeof Element<"u"&&r instanceof Element,Se=new Map,ee=new Set;function Ht(r){return ee.add(r),()=>ee.delete(r)}function We(r){let e=Se.get(r);if(e)return e;const t=new Image;return t.crossOrigin="anonymous",t.decoding="async",e={url:r,image:t,state:"loading"},e.promise=new Promise(i=>{t.onload=()=>{e.state="ready",i(e),ee.forEach(a=>a(e))},t.onerror=()=>{e.state="error",console.warn(`LiquidGlass: could not load backdrop image ${r} (a cross-origin image needs CORS headers).`),i(e),ee.forEach(a=>a(e))}}),t.src=r,Se.set(r,e),e}function zt(r){var t;if(!r)return[0,0];const e=(t=r.tagName)==null?void 0:t.toUpperCase();return e==="IMG"?r.complete?[r.naturalWidth,r.naturalHeight]:[0,0]:e==="VIDEO"?r.readyState>=2?[r.videoWidth,r.videoHeight]:[0,0]:[Number(r.displayWidth??r.width??0),Number(r.displayHeight??r.height??0)]}function _(r,e){const t=[];let i=0,a=0;for(let s=0;s<r.length;s++){const o=r[s];o==="("?i++:o===")"?i--:i===0&&(e===" "?/\s/.test(o):o===e)&&(t.push(r.slice(a,s)),a=s+1)}return t.push(r.slice(a)),t.map(s=>s.trim()).filter(Boolean)}function G(r="0%"){if(r==="left"||r==="top")return{ratio:0,px:0};if(r==="center")return{ratio:.5,px:0};if(r==="right"||r==="bottom")return{ratio:1,px:0};const e={ratio:0,px:0},t=/([-+])?\s*(\d*\.?\d+(?:e[-+]?\d+)?)(%|px)?/gi;for(let i=t.exec(r);i;i=t.exec(r)){const a=Number(i[2])*(i[1]==="-"?-1:1);i[3]==="%"?e.ratio+=a/100:e.px+=a}return e}const P=({ratio:r,px:e},t)=>r*t+e;function N(r="50% 50%"){const e=_(r," ");return e.length===1&&e.push("50%"),[G(e[0]),G(e[1])]}function Nt(r){return Array.isArray(r)?r.map(e=>typeof e=="number"?{ratio:e,px:0}:G(String(e))):N(r??"50% 50%")}function Xt(r,e,t,i="cover",a=N()){let s=t.width,o=t.height;if(i==="cover"||i==="contain"){const h=(i==="cover"?Math.max:Math.min)(t.width/r,t.height/e);s=r*h,o=e*h}else if(i==="none"||i==="scale-down"){const h=i==="none"?1:Math.min(1,t.width/r,t.height/e);s=r*h,o=e*h}return{x:t.x+P(a[0],t.width-s),y:t.y+P(a[1],t.height-o),width:s,height:o}}const Wt=new Set(["multiply","screen","overlay","darken","lighten","color-dodge","color-burn","hard-light","soft-light","difference","exclusion","hue","saturation","color","luminosity"]);function Ge(r,e){Wt.has(e.mixBlendMode)&&(r.globalCompositeOperation=e.mixBlendMode)}const X=r=>!r||r==="transparent"||/^rgba\([^)]*,\s*0(\.0*)?\s*\)$/.test(r)||/\/\s*0(\.0*)?%?\s*\)$/.test(r);function Gt(r,e){const t=(i,a)=>{const s=_(i||"0"," ")[0];return Math.max(0,P(G(s),a))};return[t(r.borderTopLeftRadius,e.width),t(r.borderTopRightRadius,e.width),t(r.borderBottomRightRadius,e.width),t(r.borderBottomLeftRadius,e.width)]}function Ot(r,e,t){r.beginPath(),t!=null&&t.some(i=>i>0)&&typeof r.roundRect=="function"?r.roundRect(e.x,e.y,e.width,e.height,t):r.rect(e.x,e.y,e.width,e.height),r.clip()}const j=r=>{const e=r.getBoundingClientRect();return{x:e.left,y:e.top,width:e.width,height:e.height}},oe=()=>({x:0,y:0,width:globalThis.innerWidth||document.documentElement.clientWidth,height:globalThis.innerHeight||document.documentElement.clientHeight});function Vt(r,e){const t=j(r),i=r.offsetWidth?t.width/r.offsetWidth:1,a=r.offsetHeight?t.height/r.offsetHeight:1,s=(parseFloat(e.borderLeftWidth)||0)+(parseFloat(e.paddingLeft)||0),o=(parseFloat(e.borderTopWidth)||0)+(parseFloat(e.paddingTop)||0),h=(parseFloat(e.borderRightWidth)||0)+(parseFloat(e.paddingRight)||0),n=(parseFloat(e.borderBottomWidth)||0)+(parseFloat(e.paddingBottom)||0);return{x:t.x+s*i,y:t.y+o*a,width:Math.max(0,t.width-(s+h)*i),height:Math.max(0,t.height-(o+n)*a)}}function Oe(r,e){const t=[];for(const i of r){const a=_(i," "),s=[];for(;a.length>1&&/(%|px)$|^calc\(/.test(a[a.length-1]);)s.unshift(a.pop());const o=a.join(" ");s.length||t.push({color:o,offset:null});for(const h of s)t.push({color:o,offset:P(G(h),e)/Math.max(e,1e-6)})}if(!t.length)return t;t[0].offset===null&&(t[0].offset=0),t.at(-1).offset===null&&(t.at(-1).offset=1);for(let i=1;i<t.length;i++){if(t[i].offset!==null){t[i].offset=Math.max(t[i].offset,t[i-1].offset);continue}let a=i;for(;t[a].offset===null;)a++;const s=t[i-1].offset,o=Math.max(t[a].offset,s);for(let h=i;h<a;h++)t[h].offset=s+(o-s)*(h-i+1)/(a-i+1)}return t}function Ve(r){if(r.length<2)return r;const e=r[0].offset,t=r.at(-1).offset-e;if(!(t>5e-4))return r;const i=[];for(let a=Math.floor(-e/t);a<=Math.ceil((1-e)/t);a++)for(const s of r){const o=s.offset+a*t;o<-t||o>1+t||i.push({color:s.color,offset:Math.min(1,Math.max(0,o))})}return i.length>=2?i:r}function qe(r,e){for(const t of e)try{r.addColorStop(Math.min(1,Math.max(0,t.offset)),t.color)}catch{}return r}function qt(r){const e=/^(-?\d*\.?\d+)(deg|turn|rad|grad)$/.exec(r);if(!e)return null;const t=Number(e[1]);return{deg:t,turn:t*360,rad:t*180/Math.PI,grad:t*.9}[e[2]]}function Yt(r,e,t,i=!1){const a=_(e,",");let s=180;const o=a[0]??"",h=qt(o);if(h!==null)s=h,a.shift();else if(/^to\s/.test(o)){const E=o.slice(3).trim().split(/\s+/),p=E.includes("right")?1:E.includes("left")?-1:0,v=E.includes("bottom")?1:E.includes("top")?-1:0,S=p&&v?p*t.height:p,b=p&&v?v*t.width:v;s=Math.atan2(S,-b)*180/Math.PI,a.shift()}else/^in\s/.test(o)&&a.shift();const n=s*Math.PI/180,l=Math.abs(t.width*Math.sin(n))+Math.abs(t.height*Math.cos(n)),c=t.x+t.width/2,d=t.y+t.height/2,x=Math.sin(n)*l/2,m=-Math.cos(n)*l/2,g=Oe(a,l);r.fillStyle=qe(r.createLinearGradient(c-x,d-m,c+x,d+m),i?Ve(g):g),r.fillRect(t.x,t.y,t.width,t.height)}function $t(r,e,t,i=!1){const a=_(e,","),s=a[0]??"";let o=!1,h="farthest-corner",n=null,l=N("50% 50%");if(!(/^(rgb|hsl|hwb|lab|lch|oklab|oklch|color|#|transparent|currentcolor)/i.test(s)||!/(circle|ellipse|closest|farthest|at\s|\d(px|%))/.test(s))){a.shift();const[T,f]=s.split(/\s*\bat\b\s*/);f&&(l=N(f));for(const u of _(T??""," "))u==="circle"?o=!0:u==="ellipse"?o=!1:/^(closest|farthest)-(side|corner)$/.test(u)?h=u:/(px|%)$/.test(u)&&(n??(n=[])).push(G(u));(n==null?void 0:n.length)===1&&(o=!0)}const d=t.x+P(l[0],t.width),x=t.y+P(l[1],t.height),m=d-t.x,g=t.x+t.width-d,E=x-t.y,p=t.y+t.height-x;let v,S;if(n)v=P(n[0],t.width),S=n[1]?P(n[1],t.height):v;else{const T=h.startsWith("closest")?Math.min:Math.max,f=T(Math.abs(m),Math.abs(g)),u=T(Math.abs(E),Math.abs(p));if(o)v=h.endsWith("side")?T(f,u):Math.hypot(f,u),S=v;else{const A=h.endsWith("corner")?Math.SQRT2:1;v=f*A,S=u*A}}v=Math.max(v,.001),S=Math.max(S,.001),r.save(),r.beginPath(),r.rect(t.x,t.y,t.width,t.height),r.clip(),r.translate(d,x),r.scale(1,S/v);const b=Oe(a,v);r.fillStyle=qe(r.createRadialGradient(0,0,0,0,0,v),i?Ve(b):b);const R=Math.max(t.width,t.height)*2+Math.abs(d)+Math.abs(x);r.fillRect(-R,-R*v/S,R*2,R*2*v/S),r.restore()}function Kt(r,e,t){const[i,a]=t??[0,0],s=i>0&&a>0;if(r==="cover"||r==="contain"){if(!s)return[e.width,e.height];const c=(r==="cover"?Math.max:Math.min)(e.width/i,e.height/a);return[i*c,a*c]}const[o="auto",h="auto"]=_(r||"auto"," ");let n=o==="auto"?null:P(G(o),e.width),l=h==="auto"?null:P(G(h),e.height);return n===null&&l===null?s?[i,a]:[e.width,e.height]:(n===null&&(n=s?l*i/a:e.width),l===null&&(l=s?n*a/i:e.height),[n,l])}function jt(r,e,t,i,a){const s=/^url\((['"]?)(.*)\1\)$/.exec(e),o=/^(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(e);if(!s&&!o)return!0;let h=null;if(s&&(h=We(s[2]),h.state!=="ready"))return h.state!=="loading";const n=h?[h.image.naturalWidth,h.image.naturalHeight]:null;if(h&&!(n[0]>0&&n[1]>0))return!0;const l=t.attachment==="fixed"?oe():i,[c,d]=Kt(t.size,l,n);if(!(c>.5&&d>.5))return!0;const x=N(t.position),m=l.x+P(x[0],l.width-c),g=l.y+P(x[1],l.height-d),[E,p]=(()=>{const B=_(t.repeat||"repeat"," ");if(B[0]==="repeat-x")return[!0,!1];if(B[0]==="repeat-y")return[!1,!0];const L=B[0]!=="no-repeat",M=(B[1]??B[0])!=="no-repeat";return[L,M]})(),v=Math.max(i.x,a.x),S=Math.min(i.x+i.width,a.x+a.width),b=Math.max(i.y,a.y),R=Math.min(i.y+i.height,a.y+a.height);if(v>=S||b>=R)return!0;const T=E?m+Math.floor((v-m)/c)*c:m,f=p?g+Math.floor((b-g)/d)*d:g,u=E?S:m+1,A=p?R:g+1;let k=0;for(let B=f;B<A&&k<1024;B+=d)for(let L=T;L<u&&k<1024;L+=c){k++;const M={x:L,y:B,width:c,height:d};h?r.drawImage(h.image,L,B,c,d):o[2]==="linear"?Yt(r,o[3],M,!!o[1]):$t(r,o[3],M,!!o[1])}return!0}function Ye(r,e,t,{canvas:i=!1}={}){const a=getComputedStyle(e);if(a.display==="none")return!0;const s=j(e),o=i?1:Number(a.opacity);if(!(o>.004))return!0;const h=a.backgroundImage&&a.backgroundImage!=="none"?_(a.backgroundImage,","):[],n=a.backgroundColor;if(!h.length&&X(n))return!0;r.save(),r.globalAlpha*=Number.isFinite(o)?o:1,i||Ge(r,a),i?(r.beginPath(),r.rect(t.x,t.y,t.width,t.height),r.clip()):Ot(r,s,Gt(a,s)),X(n)||(r.fillStyle=n,r.fillRect(t.x,t.y,t.width,t.height));const l=p=>_(p||"",","),c=l(a.backgroundSize),d=l(a.backgroundPosition),x=l(a.backgroundRepeat),m=l(a.backgroundAttachment),g=(p,v,S)=>p.length?p[v%p.length]:S;let E=!0;for(let p=h.length-1;p>=0;p--)E=jt(r,h[p],{size:g(c,p,"auto"),position:g(d,p,"0% 0%"),repeat:g(x,p,"repeat"),attachment:g(m,p,"scroll")},i?j(document.documentElement):s,t)&&E;return r.restore(),E}function $e(r,e,t,i,a,s){const[o,h]=zt(e);if(!(o>0&&h>0)||!(t.width>0&&t.height>0)||t.x>=s.x+s.width||t.x+t.width<=s.x||t.y>=s.y+s.height||t.y+t.height<=s.y)return;const n=Xt(o,h,t,i,a);r.save(),r.beginPath(),r.rect(t.x,t.y,t.width,t.height),r.clip();try{r.drawImage(e,n.x,n.y,n.width,n.height)}catch{}r.restore()}function Ke(r,e,t){const{element:i}=e,a=getComputedStyle(i);if(a.display==="none"||a.visibility==="hidden")return;const s=Number(a.opacity);if(!(s>.004))return;r.save(),r.globalAlpha*=Number.isFinite(s)?s:1,Ge(r,a);const o=e.anchor?je(e.anchor):Vt(i,a);$e(r,i,o,e.fit??a.objectFit??"fill",e.position??N(a.objectPosition),t),r.restore()}function je(r){return r==="viewport"||r==null?oe():r==="document"?j(document.documentElement):U(r)?j(r):oe()}function Qe(r,{allowUrl:e=!0}={}){let t=null;try{t=document.querySelector(r)}catch{t=null}return t||(e&&It.test(r)?{url:r}:{missing:r})}function Qt(r,e={}){return Xe.has(r.tagName.toUpperCase())?{kind:"media",element:r,...e}:{kind:"css",element:r}}function Ze(r){return r&&typeof r=="object"&&!U(r)&&("width"in r||"displayWidth"in r)&&!("source"in r)}function ne(r){if(r==null||r==="auto")return[{kind:"auto"}];if(Array.isArray(r))return r.flatMap(e=>ne(e));if(typeof r=="function")return[{kind:"paint",paint:r}];if(typeof r=="string")return[{kind:"ref",ref:r}];if(U(r))return[{kind:"ref",ref:r}];if(Ze(r))return[{kind:"source",source:r,fit:"cover",position:N(),anchor:"viewport"}];if(typeof r=="object"){if(r.color&&!r.source)return[{kind:"color",color:r.color}];if(r.source!=null)return[{kind:"ref",ref:r.source,fit:r.fit,position:r.position==null?void 0:Nt(r.position),anchor:r.anchor,opacity:r.opacity}]}throw new TypeError("LiquidGlass: unsupported backdrop. Use an element, selector, image URL, canvas/video/image, painter function, or { source, fit, anchor }.")}function Zt(r){const e=document.documentElement,t=getComputedStyle(e);return[{kind:"css",element:t.backgroundImage!=="none"||!X(t.backgroundColor)||!document.body?e:document.body,canvas:!0},{kind:"page",host:r}]}function Jt(r,e){const t=[];for(const i of r){if(i.kind==="auto"){t.push(...Zt(e));continue}if(i.kind!=="ref"){t.push(i);continue}let a=i.ref;if(typeof a=="string"){const o=Qe(a);if(o.missing){t.push({kind:"missing",ref:a});continue}a=o}const s={...i.fit?{fit:i.fit}:{},...i.position?{position:i.position}:{},...i.anchor!=null?{anchor:ei(i.anchor)}:{},...i.opacity!=null?{opacity:i.opacity}:{}};a!=null&&a.url?t.push({kind:"source",entry:We(a.url),fit:"cover",position:N(),anchor:"viewport",...s}):U(a)&&a.isConnected?t.push(Qt(a,s)):(Ze(a)||U(a)&&Xe.has(a.tagName.toUpperCase()))&&t.push({kind:"source",source:a,fit:"cover",position:N(),anchor:"viewport",...s})}return t}function ei(r){if(typeof r!="string"||r==="viewport"||r==="document")return r;const e=Qe(r,{allowUrl:!1});return U(e)?e:"viewport"}function ti(){var t;const r=getComputedStyle(document.documentElement).colorScheme||"";return/dark/.test(r)&&!/light/.test(r)||/dark/.test(r)&&((t=globalThis.matchMedia)==null?void 0:t.call(globalThis,"(prefers-color-scheme: dark)").matches)?"#121212":"#ffffff"}function ii(r,e,t){let i=!0;r.save(),r.fillStyle=ti(),r.fillRect(t.x,t.y,t.width,t.height);for(const a of e){r.save();try{switch(a.opacity!=null&&(r.globalAlpha*=a.opacity),a.kind){case"css":i=Ye(r,a.element,t,{canvas:a.canvas})&&i;break;case"media":Ke(r,a,t);break;case"source":{const s=a.entry?a.entry.image:a.source;if(a.entry&&a.entry.state!=="ready"){i=i&&a.entry.state!=="loading";break}$e(r,s,je(a.anchor),a.fit,a.position,t);break}case"color":r.fillStyle=a.color,r.fillRect(t.x,t.y,t.width,t.height);break;case"paint":a.paint(r,{...t});break;case"page":i=yi(r,t,a.host)&&i;break;default:break}}finally{r.restore()}}return r.restore(),i}function ri(r,e,t,i,a){const s=t.width>0?t.screenWidth/t.width:1,o=t.height>0?t.screenHeight/t.height:1;return r.setTransform(a/s,0,0,a/o,a*(i-t.x/s),a*(i-t.y/o)),ii(r,e,{x:t.x-i*s,y:t.y-i*o,width:(t.width+i*2)*s,height:(t.height+i*2)*o})}function ai(r){return r.some(e=>{var s,o;if(e.kind==="page")return wi(e.host);const t=e.kind==="media"?e.element:e.kind==="source"?e.source:null;if(!t)return!1;const i=(s=t.tagName)==null?void 0:s.toUpperCase();if(i==="VIDEO")return!t.paused&&!t.ended;if(i==="CANVAS")return!0;const a=(o=t.constructor)==null?void 0:o.name;return a==="OffscreenCanvas"||a==="VideoFrame"})}function we(r){return r.flatMap(e=>e.kind==="media"||e.kind==="css"&&!e.canvas?[e.element]:[])}function si(r){return r.filter(e=>e.kind==="missing").map(e=>e.ref)}const oi="[data-liquid-glass], [data-liquid-glass-control]",ni=new Set(["SCRIPT","STYLE","NOSCRIPT","TEMPLATE","HEAD","META","LINK","TITLE","BR","WBR","IFRAME","OBJECT","EMBED","INPUT","TEXTAREA","SELECT","OPTION","BUTTON"]),li=new Set(["IMG","VIDEO","CANVAS"]),hi="http://www.w3.org/1999/xhtml",ci=-.6,Te=-.4;let z=null,Q=!0,Ee=!1,ie=null;const le=new Map;function Je(r,e){const t=Math.min(r.length,e.length);for(let i=0;i<t;i++){if(r[i][0]!==e[i][0])return r[i][0]-e[i][0];if(r[i][1]!==e[i][1])return r[i][1]-e[i][1]}return r.length-e.length}const Re=r=>r.backgroundImage!=="none"||!X(r.backgroundColor),ui=r=>["Top","Right","Bottom","Left"].some(e=>parseFloat(r[`border${e}Width`])>0&&r[`border${e}Style`]!=="none"&&!X(r[`border${e}Color`]));function di(r,e){return e&&r.zIndex!=="auto"||r.position==="fixed"||r.position==="sticky"||Number(r.opacity)<1||r.transform!=="none"||r.filter!=="none"||r.isolation==="isolate"||r.mixBlendMode!=="normal"||r.backdropFilter&&r.backdropFilter!=="none"||/paint|strict|content/.test(r.contain||"")}function fi(r){const e=r.fontStyle.startsWith("oblique")?"italic":r.fontStyle,t=r.fontVariantCaps==="small-caps"?"small-caps ":"";return`${e} ${t}${r.fontWeight} ${r.fontSize} ${r.fontFamily}`}function pi(r,e){let t=le.get(r);if(t)return t;ie??(ie=document.createElement("canvas").getContext("2d")),ie.font=r;const i=ie.measureText("Hg");return t={ascent:i.fontBoundingBoxAscent??e*.8,descent:i.fontBoundingBoxDescent??e*.2},le.set(r,t),t}function mi(r){if(!r||r==="none")return null;const e=_(_(r,",")[0]," "),t=e.find(a=>!/^-?[\d.]+(px)?$/.test(a)),i=e.filter(a=>/^-?[\d.]+(px)?$/.test(a)).map(parseFloat);return!t||i.length<2?null:{color:t,x:i[0],y:i[1],blur:i[2]??0}}function gi(r,e){return e==="uppercase"?r.toUpperCase():e==="lowercase"?r.toLowerCase():e==="capitalize"?r.replace(new RegExp("^\\p{L}","u"),t=>t.toUpperCase()):r}const ce=(r,e)=>r.x<e.x+e.width&&r.x+r.width>e.x&&r.y<e.y+e.height&&r.y+r.height>e.y;function vi(){const r=globalThis.scrollX||0,e=globalThis.scrollY||0,t=globalThis.innerWidth||document.documentElement.clientWidth,i=globalThis.innerHeight||document.documentElement.clientHeight,a={x:-t*.5,y:-i,width:t*2,height:i*3},s=[],o=new Map,h=document.createRange();let n=0;const l=getComputedStyle(document.documentElement),c=Re(l);function d(m,g,E,p,v){const S=m.data;if(!/\S/.test(S))return;const b=g.webkitTextFillColor||g.color,R=parseFloat(g.webkitTextStrokeWidth)||0;if(X(b)&&!(R>0))return;h.selectNodeContents(m);const T=h.getBoundingClientRect();if(!T.width||!ce({x:T.left,y:T.top,width:T.width,height:T.height},a))return;const f=v?0:r,u=v?0:e,A=[],k=(L,M)=>{M.width>0&&A.push({text:gi(L,g.textTransform),x:M.left+f,y:M.top+u,width:M.width,height:M.height})},B=/\S+/g;for(let L=B.exec(S);L;L=B.exec(S)){h.setStart(m,L.index),h.setEnd(m,L.index+L[0].length);const M=h.getClientRects();if(M.length<=1){M.length&&k(L[0],M[0]);continue}let y="",w=null;for(let C=0;C<L[0].length;C++){h.setStart(m,L.index+C),h.setEnd(m,L.index+C+1);const H=h.getBoundingClientRect();w&&Math.abs(H.top-w.top)>1&&(k(y,w),y="",w=null),y+=L[0][C],w=w?{left:w.left,top:w.top,width:H.right-w.left,height:w.height}:{left:H.left,top:H.top,width:H.width,height:H.height}}w&&k(y,w)}A.length&&s.push({type:"text",key:E,fixed:v,alpha:p,words:A,box:{x:T.left+f,y:T.top+u,width:T.width,height:T.height},font:fi(g),size:parseFloat(g.fontSize)||16,fill:X(b)?null:b,stroke:R>0?{width:R,color:g.webkitTextStrokeColor}:null,letterSpacing:g.letterSpacing!=="normal"?g.letterSpacing:"",shadow:mi(g.textShadow)})}function x(m,g,E,p,v=!0){if(m.namespaceURI!==hi)return;const S=m.tagName.toUpperCase();if(ni.has(S))return;const b=getComputedStyle(m);if(b.display==="none"||b.display==="contents"&&!m.childNodes.length)return;const R=b.position!=="static",T=di(b,R),f=Number.parseInt(b.zIndex,10),u=R&&Number.isFinite(f)?f:R||T?0:b.display.startsWith("inline")?Te:ci,A=[...g,[u,n++]],k=p||b.position==="fixed";m.matches(oi)&&(o.set(m,A),m.getAttribute("data-liquid-glass")!=="fallback"&&(v=!1));const B=Number(b.opacity),L=E*(Number.isFinite(B)?B:1),M=b.visibility==="visible"&&L>.004,y=li.has(S);if(v&&M&&(y||Re(b)||ui(b))){const C=m.getBoundingClientRect();C.width&&C.height&&s.push({type:y?"media":"box",element:m,key:A,fixed:k,alpha:E,box:{x:C.left+(k?0:r),y:C.top+(k?0:e),width:C.width,height:C.height}})}if(y)return;const w=T||R?A:g;for(const C of m.childNodes)C.nodeType===1?x(C,w,L,k):C.nodeType===3&&M&&d(C,b,[...w,[Te,n++]],L,k)}return document.body&&x(document.body,[],1,!1,c),s.sort((m,g)=>Je(m.key,g.key)),{items:s,hosts:o,scrollX:r,scrollY:e,width:t,height:i}}function Ae(){const r=globalThis.innerWidth||0,e=globalThis.innerHeight||0,t=z&&(Math.abs((globalThis.scrollY||0)-z.scrollY)>e*.5||Math.abs((globalThis.scrollX||0)-z.scrollX)>r*.25||r!==z.width||e!==z.height);return(!z||Q||t)&&(z=vi(),Q=!1),z}function O(){Q||(Q=!0,Lt())}function bi(){var e,t,i,a;if(Ee||typeof document>"u")return;Ee=!0,typeof MutationObserver=="function"&&new MutationObserver(s=>{for(const o of s){const h=o.target.nodeType===1?o.target:o.target.parentElement;if(!(!h||o.type==="attributes"&&h.closest(`[${Ne}]`))){O();return}}}).observe(document.documentElement,{subtree:!0,childList:!0,characterData:!0,attributes:!0,attributeFilter:["style","class","hidden","src","open"]}),globalThis.addEventListener("scroll",s=>{s.target!==document&&s.target!==document.documentElement&&O()},{capture:!0,passive:!0}),globalThis.addEventListener("resize",O,{passive:!0});for(const s of["transitionend","transitioncancel","animationend","load"])document.addEventListener(s,O,!0);const r=()=>{le.clear(),O()};(t=(e=document.fonts)==null?void 0:e.addEventListener)==null||t.call(e,"loadingdone",r),(a=(i=document.fonts)==null?void 0:i.ready)==null||a.then(r)}function xi(r,e,t,i,a){const{ascent:s,descent:o}=pi(e.font,e.size);r.font=e.font,r.textBaseline="alphabetic",r.textAlign="left",e.letterSpacing&&"letterSpacing"in r&&(r.letterSpacing=e.letterSpacing),e.shadow&&(r.shadowColor=e.shadow.color,r.shadowOffsetX=e.shadow.x,r.shadowOffsetY=e.shadow.y,r.shadowBlur=e.shadow.blur),e.fill&&(r.fillStyle=e.fill),e.stroke&&(r.strokeStyle=e.stroke.color,r.lineWidth=e.stroke.width);const h=a.x+a.width,n=a.y+a.height;for(const l of e.words){const c=l.x+t,d=l.y+i;if(c>h||c+l.width<a.x||d>n||d+l.height<a.y)continue;const x=d+(l.height-(s+o))/2+s;e.fill&&r.fillText(l.text,c,x),e.stroke&&r.strokeText(l.text,c,x)}}function et(r){let e=Ae(),t=e.hosts.get(r);if(t||(Q=!0,e=Ae(),t=e.hosts.get(r)),!t)return{state:e,end:0};let i=0,a=e.items.length;for(;i<a;){const s=i+a>>1;Je(e.items[s].key,t)<0?i=s+1:a=s}return{state:e,end:i}}function yi(r,e,t){bi();const{state:i,end:a}=et(t),s=globalThis.scrollX||0,o=globalThis.scrollY||0;let h=!0;for(let n=0;n<a;n++){const l=i.items[n],c=l.fixed?0:-s,d=l.fixed?0:-o;if(ce({...l.box,x:l.box.x+c,y:l.box.y+d},e)){r.save(),r.globalAlpha*=l.alpha;try{l.type==="text"?xi(r,l,c,d,e):l.type==="media"?Ke(r,{element:l.element},e):(h=Ye(r,l.element,e)&&h,Si(r,l.element))}finally{r.restore()}}}return h}function Si(r,e){const t=getComputedStyle(e),i=parseFloat(t.borderTopWidth)||0;if(!(i>0)||t.borderTopStyle==="none"||X(t.borderTopColor))return;const a=e.getBoundingClientRect(),s=Math.max(0,(parseFloat(t.borderTopLeftRadius)||0)-i/2);r.save(),r.globalAlpha*=Number(t.opacity)||1,r.strokeStyle=t.borderTopColor,r.lineWidth=i,r.beginPath();const o=a.left+i/2,h=a.top+i/2,n=Math.max(0,a.width-i),l=Math.max(0,a.height-i);s>0&&typeof r.roundRect=="function"?r.roundRect(o,h,n,l,Math.min(s,n/2,l/2)):r.rect(o,h,n,l),r.stroke(),r.restore()}function wi(r){if(!z)return!1;const{state:e,end:t}=et(r),i=r.getBoundingClientRect(),a={x:i.left-96,y:i.top-96,width:i.width+192,height:i.height+192},s=globalThis.scrollX||0,o=globalThis.scrollY||0;for(let h=0;h<t;h++){const{type:n,element:l,box:c,fixed:d}=e.items[h];if(n==="media"&&ce({...c,x:c.x-(d?0:s),y:c.y-(d?0:o)},a)&&(l.tagName==="CANVAS"||l.tagName==="VIDEO"&&!l.paused&&!l.ended))return!0}return!1}function Ti(){O()}const $=new WeakMap,Ei=new Set(["IMG","INPUT","TEXTAREA","SELECT","VIDEO","CANVAS","IFRAME","BR","HR"]),re=["load","loadeddata","play","playing","pause","seeked","resize"];let ae=null;function ke(){return ae===null&&(ae=Pe.isSupported()),ae}function Le(r){var t,i,a;if(!r)return;const e=(t=r.renderer)==null?void 0:t.gl;r.destroy(),(a=(i=e==null?void 0:e.getExtension)==null?void 0:i.call(e,"WEBGL_lose_context"))==null||a.loseContext()}function Ri(r,e){if(typeof MutationObserver!="function")return null;const t=new MutationObserver(e),i=new Set;for(const a of r)for(let s=a;(s==null?void 0:s.nodeType)===1&&!i.has(s);s=s.parentElement)i.add(s),t.observe(s,{attributes:!0,attributeFilter:["style","class"]});return t}function Ai(r,e){const t=typeof r=="string"&&typeof document<"u"?document.querySelector(r):r;if(!U(t))throw new TypeError(`${e}: no element matches ${String(r)}.`);return t}function ki(r,e,t){const i=(r.borderTopLeftRadius||"0").split(/\s+/)[0],a=parseFloat(i)||0;return i.endsWith("%")?Math.min(e,t)*a/100:a}function Me(r,e,t,i){if(i.shape&&i.shape!=="auto")return{shape:i.shape,...Number.isFinite(i.radius)?{radius:i.radius}:{}};const a=Number.isFinite(i.radius)?i.radius:ki(r,e,t),s=Math.min(e,t);return a>=s/2-.5?{shape:Math.abs(e-t)<1?"circle":"pill"}:{shape:"rect",radius:Math.max(0,a)}}const Li=["tint","tintTone","frost","opacity"];function Be(...r){const e={};for(const t of r)for(const i of Li)(t==null?void 0:t[i])!=null&&(e[i]=t[i]);return e}class Mi{static isSupported(){return ke()}static from(e){const t=typeof e=="string"?document.querySelector(e):e;return(t&&$.get(t))??null}static refreshAll(){Ti(),Ut(e=>{var t;return(t=e.refresh)==null?void 0:t.call(e)})}constructor(e,t={}){var a;const i=Ai(e,"LiquidGlass");if(Ei.has(i.tagName.toUpperCase()))throw new TypeError(`LiquidGlass: <${i.tagName.toLowerCase()}> cannot hold the glass layer. Wrap it in an element and pass that.`);if(K(t.material??{}),(a=$.get(i))==null||a.destroy(),$.set(i,this),this.element=i,this.options={...t},this.destroyed=!1,this.visible=!0,this.mode="pending",this.glass=null,this.canvas=null,this.targets=[],this.layers=[],this.mediaListeners=[],this.restore=[],this.frame=null,this.sizeKey="",this.positionKey="",this.geometryKey="",this.styleDirty=!0,this.backdropDirty=!0,this.elementsDirty=!0,this.warnedMissing="",this.ready=new Promise(s=>{this.resolveReady=s}),!ke()){this.enterFallback();return}this.buffer=document.createElement("canvas"),this.bufferContext=this.buffer.getContext("2d",{alpha:!1}),this.mountCanvas(),this.backdropSpec=ne(t.backdrop),this.resolveTargets(),this.resolveBackdrop(),this.resizeObserver=typeof ResizeObserver=="function"?new ResizeObserver(()=>this.refresh({backdrop:!1})):null,this.observeSizes(),this.unsubscribeAssets=Ht(()=>{this.backdropDirty=!0,D(34)}),this.watchStyles(),_t(this)}get supported(){return this.mode!=="fallback"}trackedElements(){return[this.element,...this.targets.map(e=>e.element)]}setStyle(e,t,i){this.restore.push([e,t,e.style[t]]),e.style[t]=i}mountCanvas(){const{element:e}=this,t=getComputedStyle(e),i=(s,o)=>this.setStyle(e,s,o);t.position==="static"&&i("position","relative"),t.isolation!=="isolate"&&i("isolation","isolate");const a=document.createElement("canvas");a.setAttribute(Ne,""),a.setAttribute("aria-hidden","true"),Object.assign(a.style,{position:"absolute",left:"0px",top:"0px",width:"0px",height:"0px",margin:"0",padding:"0",border:"0",maxWidth:"none",maxHeight:"none",display:"block",pointerEvents:"none",zIndex:String(this.options.zIndex??-1),visibility:"hidden"}),e.appendChild(a),this.canvas=a,e.setAttribute("data-liquid-glass","pending")}resolveTargets(){var i;const e=this.options.targets;let t=[];typeof e=="string"?t=[...this.element.querySelectorAll(e)].map(a=>({element:a})):e&&typeof e[Symbol.iterator]=="function"&&(t=[...e].map(a=>U(a)?{element:a}:a).filter(a=>U(a==null?void 0:a.element))),this.targets=t,(i=this.mutationObserver)==null||i.disconnect(),this.mutationObserver=null,typeof e=="string"&&typeof MutationObserver=="function"&&(this.mutationObserver=new MutationObserver(()=>{this.resolveTargets(),this.observeSizes(),this.refresh({backdrop:!1})}),this.mutationObserver.observe(this.element,{childList:!0,subtree:!0}))}observeSizes(){if(this.resizeObserver){this.resizeObserver.disconnect();for(const e of this.trackedElements())this.resizeObserver.observe(e)}}watchStyles(){var e;(e=this.styleObserver)==null||e.disconnect(),this.styleObserver=Ri([...this.trackedElements(),...we(this.layers)],()=>{this.styleDirty=!0,this.backdropDirty=!0,D(120)})}onViewportResize(){this.refresh()}resolveBackdrop(){for(const[i,a]of this.mediaListeners)re.forEach(s=>i.removeEventListener(s,a));this.mediaListeners=[],this.layers=Jt(this.backdropSpec,this.element);const e=si(this.layers).join(", ");e&&e!==this.warnedMissing&&console.warn(`LiquidGlass: backdrop ${e} matched no element and is not an image URL. Call refresh() once it exists.`),this.warnedMissing=e;const t=()=>{this.backdropDirty=!0,D(34)};for(const i of we(this.layers)){const a=i.tagName.toUpperCase();a!=="IMG"&&a!=="VIDEO"||(re.forEach(s=>i.addEventListener(s,t)),this.mediaListeners.push([i,t]))}}measure(){if(this.destroyed||this.mode==="fallback")return;const{element:e}=this,t=e.getBoundingClientRect(),i={x:t.left,y:t.top,screenWidth:t.width,screenHeight:t.height,width:e.offsetWidth??t.width,height:e.offsetHeight??t.height,borderLeft:e.clientLeft,borderTop:e.clientTop,scrollLeft:e.scrollLeft,scrollTop:e.scrollTop,targets:this.targets.map(({element:a})=>{const s=a.getBoundingClientRect();return{x:s.left,y:s.top,width:a.offsetWidth??s.width,height:a.offsetHeight??s.height,screenWidth:s.width,screenHeight:s.height}})};this.styleDirty&&(this.styles=[e,...this.targets.map(a=>a.element)].map(a=>getComputedStyle(a)).map(a=>({borderTopLeftRadius:a.borderTopLeftRadius})),this.styleDirty=!1,this.elementsDirty=!0),this.frame=i}bleed(){var t;if(Number.isFinite(this.options.bleed))return Math.max(0,this.options.bleed);const e=((t=this.glass)==null?void 0:t.material)??K(this.options.material??{});return Math.ceil(Math.min(96,24+e.refraction*.17+e.backdropBlur*2))}createGlass(){try{this.glass=new Pe(this.canvas,{compositeMode:"overlay",autoResize:!1,autoStart:!1,preserveDrawingBuffer:!0,material:this.options.material,respectReducedTransparency:this.options.respectReducedTransparency??!0,onContextLost:e=>{var t,i;return(i=(t=this.options).onContextLost)==null?void 0:i.call(t,e)},onContextRestored:e=>{var t,i;this.sizeKey="",this.backdropDirty=!0,this.elementsDirty=!0,D(64),(i=(t=this.options).onContextRestored)==null||i.call(t,e)}})}catch(e){return console.warn("LiquidGlass: WebGL2 surface could not be created; using the fallback.",e),this.enterFallback(),!1}return this.mode="webgl",this.element.setAttribute("data-liquid-glass","webgl"),!0}buildElements(e,t,i,a){const s=Be(this.options);return this.targets.length?this.targets.slice(0,e.targets.length).map((o,h)=>{const n=e.targets[h],l=n.width||n.screenWidth/i,c=n.height||n.screenHeight/a;return{id:`target-${h}`,x:(n.x-e.x)/i+t,y:(n.y-e.y)/a+t,width:l,height:c,...Me(this.styles[h+1]??this.styles[0],l,c,{...this.options,...o}),...Be(this.options,o)}}).filter(o=>o.width>0&&o.height>0):[{id:"surface",x:t,y:t,width:e.width,height:e.height,...Me(this.styles[0],e.width,e.height,this.options),...s}]}draw(){var g,E;const e=this.frame;if(!e||this.destroyed||this.mode==="fallback")return!1;if(!(e.width>0&&e.height>0&&e.screenWidth>0&&e.screenHeight>0))return this.canvas.style.visibility!=="hidden"&&(this.canvas.style.visibility="hidden"),!1;if(!this.glass&&!this.createGlass())return!1;const t=Math.max(.5,Math.min(globalThis.devicePixelRatio||1,this.options.maxDpr??2)),i=this.bleed(),a=e.width+i*2,s=e.height+i*2,o=`${a}x${s}@${t}`;o!==this.sizeKey&&(this.sizeKey=o,this.canvas.style.width=`${a}px`,this.canvas.style.height=`${s}px`,this.buffer.width=Math.max(1,Math.round(a*t)),this.buffer.height=Math.max(1,Math.round(s*t)),this.glass.setBackdrop(this.buffer,{update:"static",autoStart:!1,shouldRender:!1}),this.backdropDirty=!0,this.elementsDirty=!0);const h=`${-i-e.borderLeft+e.scrollLeft},${-i-e.borderTop+e.scrollTop}`;if(h!==this.positionKey){this.positionKey=h;const[p,v]=h.split(",");this.canvas.style.left=`${p}px`,this.canvas.style.top=`${v}px`}const n=e.screenWidth/e.width,l=e.screenHeight/e.height,c=[e.x,e.y,e.screenWidth,e.screenHeight,...e.targets.flatMap(p=>[p.x,p.y,p.screenWidth,p.screenHeight])].map(p=>Math.round(p*64)).join(",");c!==this.geometryKey&&(this.geometryKey=c,this.backdropDirty=!0,this.elementsDirty=!0),ye()!==this.epoch&&(this.epoch=ye(),this.backdropDirty=!0);const d=this.options.live===!0||this.options.live!==!1&&ai(this.layers);let x=!1,m=this.settled??!1;return(this.backdropDirty||d)&&(m=ri(this.bufferContext,this.layers,e,i,t),this.settled=m,this.glass.updateBackdrop(!1),this.backdropDirty=!1,x=!0),this.elementsDirty&&(this.glass.setElements(this.buildElements(e,i,n,l),!1),this.elementsDirty=!1,x=!0),(x||this.glass.dirty)&&(this.glass.render({force:!0,dpr:t}),this.canvas.style.visibility&&(this.canvas.style.visibility=""),(E=(g=this.options).onRender)==null||E.call(g,this)),m&&this.resolveReady&&(this.resolveReady(this),this.resolveReady=null),d}enterFallback(){var i,a;this.mode="fallback",Le(this.glass),this.glass=null,(i=this.canvas)==null||i.remove(),this.canvas=null;const{element:e}=this;e.setAttribute("data-liquid-glass","fallback");const t=this.options.fallback??"css";if(typeof t=="function")t(e);else if(t==="css"){const s=this.options.targets,o=typeof s=="string"?[...e.querySelectorAll(s)]:s?[...s].map(l=>U(l)?l:l==null?void 0:l.element).filter(U):[e],h=Math.round(14+(this.options.frost??0)*30),n=Math.min(1,this.options.tint??0);for(const l of o){const c=getComputedStyle(l);(!c.backdropFilter||c.backdropFilter==="none")&&(this.setStyle(l,"backdropFilter",`blur(${h}px) saturate(1.6)`),this.setStyle(l,"webkitBackdropFilter",`blur(${h}px) saturate(1.6)`)),X(c.backgroundColor)&&this.setStyle(l,"backgroundColor",this.options.tintTone==="dark"?`rgba(20,21,26,${(.28+n*.5).toFixed(3)})`:`rgba(255,255,255,${(.14+n*.5).toFixed(3)})`)}}(a=this.resolveReady)==null||a.call(this,this),this.resolveReady=null}refresh({backdrop:e=!0}={}){return this.destroyed||this.mode==="fallback"?this:(e&&(typeof this.options.targets=="string"&&this.resolveTargets(),this.resolveBackdrop(),this.observeSizes(),this.watchStyles()),this.styleDirty=!0,this.backdropDirty=!0,this.elementsDirty=!0,D(64),this)}update(e={}){var t;return this.destroyed?this:("material"in e&&K({...this.options.material??{},...e.material??{}}),this.options={...this.options,...e,..."material"in e?{material:{...this.options.material??{},...e.material??{}}}:{}},this.mode==="fallback"?this:("material"in e&&((t=this.glass)==null||t.setMaterial(e.material??{},!1)),"zIndex"in e&&this.canvas&&(this.canvas.style.zIndex=String(e.zIndex??-1)),"backdrop"in e&&(this.backdropSpec=ne(e.backdrop)),"targets"in e&&this.resolveTargets(),this.sizeKey="",this.refresh()))}destroy(){var e,t,i,a,s,o;if(!this.destroyed){this.destroyed=!0,Ft(this),(e=this.resizeObserver)==null||e.disconnect(),(t=this.mutationObserver)==null||t.disconnect(),(i=this.styleObserver)==null||i.disconnect(),(a=this.unsubscribeAssets)==null||a.call(this);for(const[h,n]of this.mediaListeners)re.forEach(l=>h.removeEventListener(l,n));Le(this.glass),this.glass=null,(s=this.canvas)==null||s.remove(),this.canvas=null;for(const[h,n,l]of this.restore.reverse())h.style[n]=l;this.element.removeAttribute("data-liquid-glass"),$.get(this.element)===this&&$.delete(this.element),(o=this.resolveReady)==null||o.call(this,this),this.resolveReady=null}}}export{Mi as L};
