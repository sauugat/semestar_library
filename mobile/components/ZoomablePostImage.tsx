import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

/** Owns two-finger gestures; leaves unzoomed horizontal swipes to the gallery. */
export function ZoomablePostImage({ uri, width, onZoomChange }: {
  uri: string; width: number; onZoomChange: (zoomed: boolean) => void;
}) {
  const [height, setHeight] = useState(1);
  const [scale] = useState(() => new Animated.Value(1));
  const [x] = useState(() => new Animated.Value(0));
  const [y] = useState(() => new Animated.Value(0));
  const state = useRef({ scale: 1, x: 0, y: 0, distance: 0, startScale: 1, startX: 0, startY: 0, anchorX: 0, anchorY: 0, lastTap: 0, multi: false, panDX: 0, panDY: 0 });
  const callback = useRef(onZoomChange);
  useEffect(() => { callback.current = onZoomChange; }, [onZoomChange]);
  const responder = useMemo(() => {
    const clamp = (v: number, size: number, zoom = state.current.scale) => Math.max(-size * (zoom - 1) / 2, Math.min(size * (zoom - 1) / 2, v));
    const paint = () => { const s = state.current; scale.setValue(s.scale); x.setValue(s.x); y.setValue(s.y); };
    const finish = () => {
      const s = state.current;
      s.distance = 0;
      s.x = clamp(s.x, width); s.y = clamp(s.y, height);
      callback.current(s.scale > 1.01);
      Animated.parallel([
        Animated.spring(x, { toValue: s.x, useNativeDriver: true, overshootClamping: true }),
        Animated.spring(y, { toValue: s.y, useNativeDriver: true, overshootClamping: true }),
      ]).start();
    };
    // PanResponder stores these callbacks; gesture refs are read only when events fire.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: () => state.current.scale > 1.01,
      onStartShouldSetPanResponderCapture: e => e.nativeEvent.touches.length > 1,
      onMoveShouldSetPanResponder: e => e.nativeEvent.touches.length > 1 || state.current.scale > 1.01,
      onMoveShouldSetPanResponderCapture: e => e.nativeEvent.touches.length > 1,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        const s = state.current;
        x.stopAnimation(); y.stopAnimation(); scale.stopAnimation();
        s.distance = 0; s.multi = e.nativeEvent.touches.length > 1;
        s.startX = s.x; s.startY = s.y; s.panDX = 0; s.panDY = 0;
        callback.current(true);
      },
      onPanResponderMove: (e, g) => {
        const s = state.current;
        const t = e.nativeEvent.touches;
        if (t.length > 1) {
          const distance = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
          const midX = (t[0].locationX + t[1].locationX) / 2 - width / 2;
          const midY = (t[0].locationY + t[1].locationY) / 2 - height / 2;
          s.multi = true;
          if (!s.distance) {
            s.distance = Math.max(1, distance); s.startScale = s.scale;
            s.startX = s.x; s.startY = s.y; s.anchorX = midX; s.anchorY = midY;
          }
          s.scale = Math.max(1, Math.min(4, s.startScale * distance / s.distance));
          const ratio = s.scale / s.startScale;
          s.x = clamp(midX - (s.anchorX - s.startX) * ratio, width);
          s.y = clamp(midY - (s.anchorY - s.startY) * ratio, height);
          s.panDX = g.dx; s.panDY = g.dy;
        } else {
          if (s.distance) { s.distance = 0; s.startX = s.x; s.startY = s.y; s.panDX = g.dx; s.panDY = g.dy; }
          s.x = clamp(s.startX + g.dx - s.panDX, width);
          s.y = clamp(s.startY + g.dy - s.panDY, height);
        }
        paint();
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, [height, width, scale, x, y]);

  const touchStart = useRef({ x: 0, y: 0, time: 0 });
  return <View style={{ width, flex: 1, overflow: 'hidden' }} onLayout={e => setHeight(e.nativeEvent.layout.height)}
    {...responder.panHandlers}
    onTouchStart={e => {
      const t = e.nativeEvent;
      if (t.touches.length === 1) {
        state.current.multi = false;
        touchStart.current = { x: t.pageX, y: t.pageY, time: Date.now() };
      } else state.current.multi = true;
    }}
    onTouchEnd={e => {
      const s = state.current, t = e.nativeEvent, start = touchStart.current;
      if (s.multi || t.touches.length || Math.hypot(t.pageX - start.x, t.pageY - start.y) > 10 || Date.now() - start.time > 250) return;
      const now = Date.now();
      if (now - s.lastTap < 300) {
        s.lastTap = 0; s.scale = s.scale > 1 ? 1 : 2.5; s.x = 0; s.y = 0;
        callback.current(s.scale > 1);
        Animated.parallel([
          Animated.spring(scale, { toValue: s.scale, useNativeDriver: true, overshootClamping: true }),
          Animated.spring(x, { toValue: 0, useNativeDriver: true }),
          Animated.spring(y, { toValue: 0, useNativeDriver: true }),
        ]).start();
      } else s.lastTap = now;
    }}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }, { translateY: y }, { scale }] }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
    </Animated.View>
  </View>;
}
