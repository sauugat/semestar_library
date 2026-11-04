import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderHandlers,
} from 'react-native';
import Reanimated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

let OptionalWebView: any = null;
try {
  // Dynamically require react-native-webview so unit tests and environments without native WebView never fail
  OptionalWebView = require('react-native-webview').WebView;
} catch {
  OptionalWebView = null;
}

/**
 * Shared gesture state coordinating Bubble-Only Swipe-to-Reply vs.
 * Outside-Bubble Swipe-to-Back across Group Chat, Personal DM, and Kyana AI.
 */
let activeBubbleTouchUntil = 0;
let isCurrentlyTouchingBubble = false;

export function markBubbleTouchStart(): void {
  isCurrentlyTouchingBubble = true;
  activeBubbleTouchUntil = Date.now() + 1200;
}

export function markBubbleTouchEnd(): void {
  isCurrentlyTouchingBubble = false;
  activeBubbleTouchUntil = Date.now() + 120;
}

export function isBubbleTouchActive(): boolean {
  return isCurrentlyTouchingBubble || Date.now() < activeBubbleTouchUntil;
}

/**
 * Hook that returns PanResponder handlers for navigating back to the inbox
 * when the user swipes right anywhere OUTSIDE of a message bubble.
 */
export function useChatBackSwipeResponder(
  onBack: () => void,
  enabled = true
): GestureResponderHandlers {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  const triggeredRef = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          if (!enabled || isBubbleTouchActive()) return false;
          return (
            gestureState.dx > 18 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.55 &&
            Math.abs(gestureState.dy) < 34
          );
        },
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (!enabled || isBubbleTouchActive()) return false;
          return (
            gestureState.dx > 18 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.55 &&
            Math.abs(gestureState.dy) < 34
          );
        },
        onPanResponderGrant: () => {
          triggeredRef.current = false;
        },
        onPanResponderMove: (_, gestureState) => {
          if (isBubbleTouchActive()) return;
          if (
            !triggeredRef.current &&
            gestureState.dx > 68 &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4
          ) {
            triggeredRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onBackRef.current();
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (isBubbleTouchActive() || triggeredRef.current) return;
          if (
            (gestureState.dx > 52 || (gestureState.dx > 32 && gestureState.vx > 0.45)) &&
            Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.35
          ) {
            triggeredRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onBackRef.current();
          }
        },
      }),
    [enabled]
  );

  return responder.panHandlers;
}

/**
 * Self-contained WebGL GLSL shader HTML that renders deep pitch-black 3D sculpted
 * obsidian silk ribbons with razor-thin liquid-silver specular rims matching IMG_6993.
 */
const FLUID_RIBBON_SHADER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #000000; }
  canvas { width: 100%; height: 100%; display: block; background: #000000; }
</style>
</head>
<body>
<canvas id="gl"></canvas>
<script>
(function(){
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener('resize', resize);

  const vsSource = \`
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  \`;

  const fsSource = \`
    precision highp float;
    varying vec2 v_uv;
    uniform float u_time;
    uniform vec2 u_res;

    // Smooth periodic wave helper for sculpted 3D black-silk ribbons
    float ribbonRidge(float dist, float width, float sharpness) {
      float norm = abs(dist) / width;
      return exp(-pow(norm, sharpness));
    }

    void main() {
      vec2 uv = v_uv;
      float aspect = u_res.x / max(u_res.y, 1.0);
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

      // Periodic phase so loop is 100% seamless
      float t = u_time;
      float s1 = sin(t);
      float c1 = cos(t);
      float s2 = sin(t * 2.0 + 0.8);
      float c2 = cos(t * 2.0 + 0.4);

      // Domain warp for organic liquid-silk folding
      vec2 warp = vec2(
        0.045 * sin(p.y * 5.2 + t) + 0.02 * cos(p.x * 4.0 - t),
        0.055 * cos(p.x * 4.5 + t * 1.0) + 0.025 * sin(p.y * 6.0 - t)
      );
      vec2 q = p + warp;

      // 1. Upper-Right Sweeping S-Fold Ribbon (matches upper curve in IMG_6993)
      float upperCurve = (q.y - 0.14) - 0.24 * sin(q.x * 3.6 - 0.45 + 0.22 * s1) - 0.18 * q.x;
      float upperSpec = ribbonRidge(upperCurve, 0.028, 2.2) * smoothstep(-0.35, 0.25, q.x);
      float upperBody = ribbonRidge(upperCurve + 0.035, 0.095, 1.6) * smoothstep(-0.42, 0.22, q.x);

      // 2. Hero Center Horizontal Undulating Silk Wave (bright silver crest + dark pleats below)
      float centerWave = (q.y - 0.03) + 0.085 * sin(q.x * 4.2 - 0.6 + 0.35 * c1) - 0.04 * cos(q.x * 7.0 + s1);
      float centerCrest = ribbonRidge(centerWave, 0.022, 2.4);
      float centerSheen = ribbonRidge(centerWave - 0.018, 0.068, 1.7);
      float centerShadow = ribbonRidge(centerWave + 0.042, 0.055, 2.0);

      // Parallel dark satin pleats beneath the hero wave
      float pleat1 = ribbonRidge(centerWave + 0.095 + 0.012 * s2, 0.024, 2.1);
      float pleat2 = ribbonRidge(centerWave + 0.165 - 0.014 * c1, 0.030, 1.9);

      // 3. Lower-Left Sculptural C-Curve Vortex Ribbon (matches bottom C-loop in IMG_6993)
      vec2 loopCenter = vec2(-0.08 + 0.03 * s1, -0.26 + 0.025 * c1);
      vec2 lp = q - loopCenter;
      float angle = atan(lp.y, lp.x);
      float radius = length(lp);
      float targetRadius = 0.22 + 0.045 * sin(angle * 2.0 + 0.7 + 0.3 * c1) + 0.02 * cos(angle * 3.0 - s1);
      float cLoopMask = smoothstep(-0.4, 0.85, -cos(angle - 0.55));
      float lowerLoopCrest = ribbonRidge(radius - targetRadius, 0.024, 2.3) * cLoopMask;
      float lowerLoopBody = ribbonRidge(radius - targetRadius - 0.025, 0.075, 1.6) * cLoopMask;

      // Secondary inner twist inside the lower C-loop
      float innerLoop = ribbonRidge(radius - (targetRadius * 0.66), 0.018, 2.2) * (1.0 - cLoopMask * 0.5);

      // Combine lighting with deep obsidian dominance (>85% pure black/near-black)
      float bodyShade =
        upperBody * 0.20 +
        centerSheen * 0.26 +
        pleat1 * 0.16 +
        pleat2 * 0.14 +
        lowerLoopBody * 0.22 +
        innerLoop * 0.15;

      // Traveling subtle metallic sheen modulation
      float flowLight = 0.78 + 0.22 * sin(q.x * 5.0 - q.y * 3.0 + t);

      float specular =
        (upperSpec * 0.62 +
         centerCrest * 0.78 +
         pleat1 * 0.22 +
         pleat2 * 0.16 +
         lowerLoopCrest * 0.68 +
         innerLoop * 0.28) * flowLight;

      // Carve deep obsidian troughs between folds
      float shadowCut = clamp(centerShadow * 0.85, 0.0, 0.75);
      float lum = max(0.0, (bodyShade + specular) * (1.0 - shadowCut * 0.55));

      // Non-linear tone curve so darks stay pitch black and only the thin ribbon crests gleam silver
      lum = pow(clamp(lum, 0.0, 1.0), 1.38) * 0.78;

      // Subtle cool metallic silver-platinum tint in highlights, pure #000000 in shadows
      vec3 col = vec3(lum * 0.97, lum * 0.98, lum * 1.02);

      // Top and bottom soft edge vignette
      float vigY = smoothstep(0.0, 0.14, uv.y) * smoothstep(1.0, 0.84, uv.y);
      col *= (0.35 + 0.65 * vigY);

      gl_FragColor = vec4(col, 1.0);
    }
  \`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uRes = gl.getUniformLocation(prog, 'u_res');

  const start = performance.now();
  const PERIOD_MS = 14000;
  function frame(now) {
    const elapsed = (now - start) % PERIOD_MS;
    const phase = (elapsed / PERIOD_MS) * Math.PI * 2.0;
    gl.uniform1f(uTime, phase);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;

export interface FluidChatBackgroundProps {
  /**
   * Optional dimmer opacity (0..1) layered over the animated ribbons
   * to guarantee high-contrast text bubble readability.
   * Defaults to 0.14.
   */
  veilOpacity?: number;
}

/**
 * Performant, seamlessly looping 3D dark-obsidian & metallic-silver fluid ribbon background
 * for all chat screens (DM, Cohort Group Chat, and Kyana AI).
 *
 * Combines:
 * 1. An instant 0ms Reanimated UI-thread sculptural dark-silk ribbon system (deep #000000
 *    canvas with razor-thin silver specular rims and concave shadow cutouts), and
 * 2. A GPU-accelerated WebGL GLSL domain-warped 3D black-silk ribbon shader when available.
 */
export const FluidChatBackground = React.memo(function FluidChatBackground({
  veilOpacity = 0.14,
}: FluidChatBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);

  // Master continuous phase [0, 2π] for seamless periodic harmonics on native UI thread
  const phase = useSharedValue(0);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        setReduceMotion(Boolean(enabled));
      }
    );

    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(phase);
      phase.value = 0.85;
      return;
    }

    phase.value = 0;
    phase.value = withRepeat(
      withTiming(Math.PI * 2, {
        duration: 14000,
        easing: Easing.linear,
      }),
      -1,
      false
    );

    return () => {
      cancelAnimation(phase);
    };
  }, [reduceMotion, phase]);

  // 1. Upper-right sweeping S-curve dark satin fold with thin silver rim
  const upperRibbonStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const tx = Math.sin(p) * 30 + Math.cos(p * 2) * 10;
    const ty = Math.cos(p) * 22 + Math.sin(p * 2) * 8;
    const rot = -24 + Math.sin(p + 0.4) * 8;
    const sx = 1.06 + Math.cos(p) * 0.07;
    const sy = 0.96 + Math.sin(p + 1.1) * 0.08;

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotateZ: `${rot}deg` },
        { scaleX: sx },
        { scaleY: sy },
      ],
    };
  });

  // Deep obsidian concave cutout carving the upper S-curve
  const upperCutoutStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const tx = Math.cos(p + 0.5) * 24;
    const ty = Math.sin(p + 0.5) * 18;
    const rot = -19 + Math.cos(p) * 6.5;

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotateZ: `${rot}deg` },
      ],
    };
  });

  // 2. Central hero horizontal undulating black-silk & chrome-rim wave
  const centerRibbonStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const tx = Math.cos(p) * 36 - Math.sin(p * 2) * 12;
    const ty = Math.sin(p) * 24 + Math.cos(p * 2) * 9;
    const rot = -7 + Math.sin(p + 1.4) * 6.5;
    const sy = 0.94 + Math.cos(p + 0.8) * 0.09;

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotateZ: `${rot}deg` },
        { scaleX: 1.12 },
        { scaleY: sy },
      ],
    };
  });

  // Secondary parallel dark satin pleat ridge beneath the hero ribbon
  const midPleatStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const tx = -Math.sin(p + 0.9) * 32;
    const ty = Math.cos(p + 0.5) * 18;
    const rot = -4 + Math.cos(p + 1.2) * 5.5;
    const sy = 0.95 + Math.sin(p * 2) * 0.06;

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotateZ: `${rot}deg` },
        { scaleY: sy },
      ],
    };
  });

  // 3. Lower-left sculptural C-curve vortex loop (predominantly black with sharp silver rim)
  const lowerLoopStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const tx = Math.sin(p + 2.1) * 26 + Math.cos(p * 2) * 9;
    const ty = -Math.cos(p + 1.7) * 22;
    const rot = 26 + Math.sin(p + 0.3) * 9.5;
    const sx = 1.04 + Math.sin(p) * 0.07;
    const sy = 1.02 + Math.cos(p) * 0.07;

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotateZ: `${rot}deg` },
        { scaleX: sx },
        { scaleY: sy },
      ],
    };
  });

  // Lower-right counter-flowing dark obsidian fold
  const lowerRightWaveStyle = useAnimatedStyle(() => {
    const p = phase.value;
    const tx = -Math.cos(p + 1.1) * 28;
    const ty = Math.sin(p + 2.4) * 20;
    const rot = -30 + Math.cos(p + 0.7) * 8;

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { rotateZ: `${rot}deg` },
      ],
    };
  });

  const ribbonWidth = Math.max(width * 1.7, 660);
  const loopSize = Math.max(width * 1.15, 430);

  return (
    <View
      pointerEvents="none"
      style={styles.container}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* 1. Pure Pitch-Black Base Canvas (#000000) */}
      <View style={styles.baseCanvas} />

      {/* 2. Native Reanimated Sculpted Black-Silk & Razor-Silver Ribbons (Instant 0ms Render) */}
      <Reanimated.View
        style={[
          styles.upperRibbonWrap,
          {
            width: ribbonWidth,
            height: height * 0.38,
            top: -height * 0.04,
            right: -width * 0.36,
          },
          upperRibbonStyle,
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0)',
            'rgba(0, 0, 0, 0.96)',
            'rgba(18, 19, 23, 0.88)',
            'rgba(82, 86, 96, 0.42)',
            'rgba(212, 218, 228, 0.62)',
            'rgba(72, 76, 86, 0.38)',
            'rgba(6, 6, 8, 0.96)',
            'rgba(0, 0, 0, 0.99)',
            'rgba(0, 0, 0, 0)',
          ]}
          locations={[0, 0.24, 0.41, 0.47, 0.5, 0.53, 0.64, 0.82, 1]}
          start={{ x: 0.18, y: 0 }}
          end={{ x: 0.82, y: 1 }}
          style={styles.fullCurvedRibbon}
        />
      </Reanimated.View>

      {/* Deep Pitch-Black Concave Cutout to Carve the S-Curve */}
      <Reanimated.View
        style={[
          styles.upperCutout,
          {
            width: width * 1.2,
            height: height * 0.3,
            top: height * 0.02,
            left: -width * 0.26,
          },
          upperCutoutStyle,
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0.99)',
            'rgba(0, 0, 0, 0.97)',
            'rgba(32, 34, 40, 0.18)',
            'rgba(0, 0, 0, 0)',
          ]}
          locations={[0, 0.68, 0.88, 1]}
          start={{ x: 0.2, y: 0.1 }}
          end={{ x: 0.9, y: 0.95 }}
          style={styles.fullCurvedRibbon}
        />
      </Reanimated.View>

      {/* 3. Center Hero Horizontal Black-Satin Wave with Sharp Silver Specular Crest */}
      <Reanimated.View
        style={[
          styles.centerRibbonWrap,
          {
            width: ribbonWidth,
            height: height * 0.26,
            top: height * 0.27,
            left: -width * 0.34,
          },
          centerRibbonStyle,
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0)',
            'rgba(0, 0, 0, 0.98)',
            'rgba(14, 15, 18, 0.92)',
            'rgba(95, 100, 112, 0.48)',
            'rgba(232, 236, 245, 0.72)',
            'rgba(105, 110, 122, 0.42)',
            'rgba(8, 9, 12, 0.96)',
            'rgba(0, 0, 0, 0.99)',
            'rgba(0, 0, 0, 0)',
          ]}
          locations={[0, 0.22, 0.39, 0.465, 0.5, 0.535, 0.65, 0.84, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.fullCurvedRibbon}
        />
      </Reanimated.View>

      {/* 4. Secondary Parallel Dark-Obsidian Satin Pleat Ridge */}
      <Reanimated.View
        style={[
          styles.midPleatWrap,
          {
            width: ribbonWidth,
            height: height * 0.2,
            top: height * 0.45,
            left: -width * 0.3,
          },
          midPleatStyle,
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0)',
            'rgba(0, 0, 0, 0.98)',
            'rgba(22, 24, 28, 0.85)',
            'rgba(118, 124, 136, 0.34)',
            'rgba(36, 38, 44, 0.65)',
            'rgba(0, 0, 0, 0.98)',
            'rgba(0, 0, 0, 0)',
          ]}
          locations={[0, 0.25, 0.44, 0.5, 0.57, 0.8, 1]}
          start={{ x: 0.48, y: 0 }}
          end={{ x: 0.52, y: 1 }}
          style={styles.fullCurvedRibbon}
        />
      </Reanimated.View>

      {/* 5. Lower-Left Sculptural C-Curve Vortex Ribbon (Deep Black Core + Thin Silver Rim) */}
      <Reanimated.View
        style={[
          styles.lowerLoopWrap,
          {
            width: loopSize,
            height: loopSize * 0.9,
            bottom: -height * 0.05,
            left: -width * 0.28,
            borderRadius: loopSize * 0.46,
          },
          lowerLoopStyle,
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(220, 225, 236, 0.64)',
            'rgba(110, 115, 126, 0.38)',
            'rgba(24, 26, 32, 0.82)',
            'rgba(4, 4, 6, 0.98)',
            'rgba(0, 0, 0, 1)',
          ]}
          locations={[0, 0.09, 0.24, 0.52, 1]}
          start={{ x: 0.06, y: 0.14 }}
          end={{ x: 0.78, y: 0.82 }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: loopSize * 0.46 },
          ]}
        />
        {/* Large Pitch-Black Hollow Core so C-Ribbon is Sleek & Predominantly Black */}
        <View
          style={[
            styles.lowerLoopCore,
            {
              width: loopSize * 0.72,
              height: loopSize * 0.66,
              borderRadius: loopSize * 0.36,
              top: loopSize * 0.12,
              left: loopSize * 0.15,
            },
          ]}
        />
      </Reanimated.View>

      {/* 6. Lower-Right Counter-Flowing Obsidian Fold */}
      <Reanimated.View
        style={[
          styles.lowerRightWrap,
          {
            width: width * 1.3,
            height: height * 0.28,
            bottom: height * 0.03,
            right: -width * 0.35,
          },
          lowerRightWaveStyle,
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0)',
            'rgba(0, 0, 0, 0.98)',
            'rgba(44, 47, 54, 0.38)',
            'rgba(155, 160, 172, 0.36)',
            'rgba(32, 34, 40, 0.52)',
            'rgba(0, 0, 0, 0.98)',
            'rgba(0, 0, 0, 0)',
          ]}
          locations={[0, 0.24, 0.45, 0.5, 0.56, 0.82, 1]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.fullCurvedRibbon}
        />
      </Reanimated.View>

      {/* 7. GPU WebGL Domain-Warped 3D Black-Silk Shader Layer (when WebView is available & motion enabled) */}
      {OptionalWebView && !reduceMotion && Platform.OS !== 'web' && (
        <View style={styles.shaderLayer} pointerEvents="none">
          <OptionalWebView
            originWhitelist={['*']}
            source={{ html: FLUID_RIBBON_SHADER_HTML }}
            style={styles.webview}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            javaScriptEnabled={true}
            domStorageEnabled={false}
            androidLayerType="hardware"
             opaque={false}
            backgroundColor="transparent"
          />
        </View>
      )}

      {/* 8. Readability Contrast Veil + Top & Bottom Obsidian Vignettes */}
      {veilOpacity > 0 && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `rgba(0, 0, 0, ${veilOpacity})` },
          ]}
        />
      )}

      <LinearGradient
        colors={[
          'rgba(0, 0, 0, 0.88)',
          'rgba(0, 0, 0, 0.38)',
          'rgba(0, 0, 0, 0)',
        ]}
        locations={[0, 0.55, 1]}
        style={styles.topVignette}
      />

      <LinearGradient
        colors={[
          'rgba(0, 0, 0, 0)',
          'rgba(0, 0, 0, 0.48)',
          'rgba(0, 0, 0, 0.92)',
        ]}
        locations={[0, 0.45, 1]}
        style={styles.bottomVignette}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: '#000000',
    zIndex: 0,
  },
  baseCanvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
  shaderLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.88,
    backgroundColor: 'transparent',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  upperRibbonWrap: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  upperCutout: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  centerRibbonWrap: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  midPleatWrap: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  lowerLoopWrap: {
    position: 'absolute',
    overflow: 'hidden',
  },
  lowerLoopCore: {
    position: 'absolute',
    backgroundColor: '#000000',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.98,
    shadowRadius: 28,
  },
  lowerRightWrap: {
    position: 'absolute',
    borderRadius: 999,
    overflow: 'hidden',
  },
  fullCurvedRibbon: {
    flex: 1,
    borderRadius: 999,
  },
  topVignette: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 145,
  },
  bottomVignette: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 155,
  },
});
