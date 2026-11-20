import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Text } from '@/components/ui/Typography';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.6;

interface FullScreenImageViewerProps {
  visible: boolean;
  imageUri: string | null;
  imageTitle?: string;
  headers?: Record<string, string>;
  onClose: () => void;
}

export function FullScreenImageViewer({
  visible,
  imageUri,
  imageTitle,
  headers,
  onClose,
}: FullScreenImageViewerProps) {
  const insets = useSafeAreaInsets();
  const [savingImage, setSavingImage] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);
  const [loadingImage, setLoadingImage] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showHint, setShowHint] = useState(true);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isClosingRef = useRef(false);
  const lastImageUriRef = useRef<string | null>(imageUri);
  if (imageUri) {
    lastImageUriRef.current = imageUri;
  }

  // Reanimated shared values (native UI thread, 120fps)
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const dismissY = useSharedValue(0);
  const controlsOpacity = useSharedValue(1);

  const triggerClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    onCloseRef.current();
  }, []);

  const toggleControls = useCallback(() => {
    setControlsVisible((prev) => {
      const next = !prev;
      controlsOpacity.value = withTiming(next ? 1 : 0, { duration: 180 });
      return next;
    });
  }, [controlsOpacity]);

  const updateZoomFlag = useCallback((zoomed: boolean) => {
    setIsZoomed(zoomed);
  }, []);

  // Reset state whenever modal opens with a new image
  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      dismissY.value = 0;
      controlsOpacity.value = 1;
      setIsZoomed(false);
      setControlsVisible(true);
      setLoadingImage(true);
      setShowHint(true);
      const timer = setTimeout(() => setShowHint(false), 2600);
      return () => clearTimeout(timer);
    }
  }, [
    visible,
    imageUri,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    dismissY,
    controlsOpacity,
  ]);

  const clampTranslate = (val: number, maxBound: number) => {
    'worklet';
    return Math.max(-maxBound, Math.min(maxBound, val));
  };

  // Native pinch-to-zoom (works even when fingers land one after another)
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      const nextScale = Math.max(0.85, Math.min(savedScale.value * e.scale, MAX_SCALE + 0.5));
      scale.value = nextScale;
      if (nextScale > 1.02) {
        const maxX = (SCREEN_WIDTH * (nextScale - 1)) / 2;
        const maxY = (SCREEN_HEIGHT * 0.82 * (nextScale - 1)) / 2;
        translateX.value = clampTranslate(savedTranslateX.value, maxX);
        translateY.value = clampTranslate(savedTranslateY.value, maxY);
      }
    })
    .onEnd(() => {
      if (scale.value < 1.05) {
        scale.value = withSpring(MIN_SCALE, { damping: 20, stiffness: 240 });
        translateX.value = withSpring(0, { damping: 20, stiffness: 240 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 240 });
        savedScale.value = MIN_SCALE;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(updateZoomFlag)(false);
      } else {
        const finalScale = Math.min(scale.value, MAX_SCALE);
        scale.value = withSpring(finalScale, { damping: 20, stiffness: 240 });
        const maxX = (SCREEN_WIDTH * (finalScale - 1)) / 2;
        const maxY = (SCREEN_HEIGHT * 0.82 * (finalScale - 1)) / 2;
        const clampedX = clampTranslate(translateX.value, maxX);
        const clampedY = clampTranslate(translateY.value, maxY);
        translateX.value = withSpring(clampedX, { damping: 20, stiffness: 240 });
        translateY.value = withSpring(clampedY, { damping: 20, stiffness: 240 });
        savedScale.value = finalScale;
        savedTranslateX.value = clampedX;
        savedTranslateY.value = clampedY;
        runOnJS(updateZoomFlag)(true);
      }
    });

  // 1-finger pan when zoomed, or vertical swipe-to-dismiss when at 1x
  const panGesture = Gesture.Pan()
    .maxPointers(2)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      if (scale.value > 1.05) {
        const maxX = (SCREEN_WIDTH * (scale.value - 1)) / 2 + 40;
        const maxY = (SCREEN_HEIGHT * 0.82 * (scale.value - 1)) / 2 + 40;
        translateX.value = clampTranslate(savedTranslateX.value + e.translationX, maxX);
        translateY.value = clampTranslate(savedTranslateY.value + e.translationY, maxY);
      } else if (e.numberOfPointers === 1) {
        dismissY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value > 1.05) {
        const maxX = (SCREEN_WIDTH * (scale.value - 1)) / 2;
        const maxY = (SCREEN_HEIGHT * 0.82 * (scale.value - 1)) / 2;
        const clampedX = clampTranslate(translateX.value, maxX);
        const clampedY = clampTranslate(translateY.value, maxY);
        translateX.value = withSpring(clampedX, { damping: 20, stiffness: 240 });
        translateY.value = withSpring(clampedY, { damping: 20, stiffness: 240 });
        savedTranslateX.value = clampedX;
        savedTranslateY.value = clampedY;
      } else {
        const shouldDismiss = Math.abs(e.translationY) > 100 || Math.abs(e.velocityY) > 800;
        if (shouldDismiss) {
          const targetY = e.translationY < 0 ? -SCREEN_HEIGHT : SCREEN_HEIGHT;
          dismissY.value = withTiming(targetY, { duration: 180 }, (finished) => {
            if (finished) {
              runOnJS(triggerClose)();
            }
          });
        } else {
          dismissY.value = withSpring(0, { damping: 20, stiffness: 240 });
        }
      }
    });

  // Double-tap to zoom in around the tapped spot, or reset to 1x
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((e) => {
      if (scale.value > 1.1) {
        scale.value = withSpring(MIN_SCALE, { damping: 20, stiffness: 240 });
        translateX.value = withSpring(0, { damping: 20, stiffness: 240 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 240 });
        savedScale.value = MIN_SCALE;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(updateZoomFlag)(false);
      } else {
        const target = DOUBLE_TAP_SCALE;
        const maxX = (SCREEN_WIDTH * (target - 1)) / 2;
        const maxY = (SCREEN_HEIGHT * 0.82 * (target - 1)) / 2;
        const tapOffsetX = (SCREEN_WIDTH / 2 - e.x) * (target - 1);
        const tapOffsetY = (SCREEN_HEIGHT * 0.41 - e.y) * (target - 1);
        const clampedX = clampTranslate(tapOffsetX, maxX);
        const clampedY = clampTranslate(tapOffsetY, maxY);
        scale.value = withSpring(target, { damping: 20, stiffness: 240 });
        translateX.value = withSpring(clampedX, { damping: 20, stiffness: 240 });
        translateY.value = withSpring(clampedY, { damping: 20, stiffness: 240 });
        savedScale.value = target;
        savedTranslateX.value = clampedX;
        savedTranslateY.value = clampedY;
        runOnJS(updateZoomFlag)(true);
      }
    });

  // Single tap toggles header controls
  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .requireExternalGestureToFail(doubleTapGesture)
    .onEnd(() => {
      runOnJS(toggleControls)();
    });

  const composedGesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    Gesture.Exclusive(doubleTapGesture, singleTapGesture)
  );

  const backdropBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dismissY.value,
      [-SCREEN_HEIGHT * 0.45, 0, SCREEN_HEIGHT * 0.45],
      [0.15, 1, 0.15],
      Extrapolation.CLAMP
    ),
  }));

  const dismissContainerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dismissY.value },
      {
        scale: interpolate(
          dismissY.value,
          [-SCREEN_HEIGHT * 0.45, 0, SCREEN_HEIGHT * 0.45],
          [0.88, 1, 0.88],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const headerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const getLocalImageUri = async (): Promise<string> => {
    if (!imageUri) throw new Error('No image URL');
    if (!imageUri.startsWith('http://') && !imageUri.startsWith('https://')) {
      return imageUri;
    }
    const cleanName = (imageUri.split('/').pop() || 'photo.jpg').split('?')[0];
    const targetPath = `${FileSystem.cacheDirectory}viewer_${Date.now()}_${cleanName}`;
    const res = await FileSystem.downloadAsync(imageUri, targetPath, {
      headers: headers || undefined,
    });
    return res.uri;
  };

  const handleSave = async () => {
    if (!imageUri || savingImage) return;
    setSavingImage(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is needed to save images to your device.');
        return;
      }
      const local = await getLocalImageUri();
      await MediaLibrary.saveToLibraryAsync(local);
      Alert.alert('Saved to Photos', 'Image saved successfully to your photo library.');
    } catch (err: any) {
      const msg = err?.message || '';
      if (
        msg.includes('ExpoMediaLibraryNext') ||
        msg.includes('native module') ||
        msg.includes('Cannot find native module') ||
        msg.includes('UnavailabilityError')
      ) {
        Alert.alert('Save to Photos Unavailable', 'Saving to Photos is unavailable in Expo Go; you can use Share instead.');
      } else {
        Alert.alert('Save Failed', err.message || 'Could not save the image.');
      }
    } finally {
      setSavingImage(false);
    }
  };

  const handleShare = async () => {
    if (!imageUri || sharingImage) return;
    setSharingImage(true);
    try {
      const local = await getLocalImageUri();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(local, {
          mimeType: 'image/jpeg',
          dialogTitle: imageTitle || 'Share Photo',
        });
      } else {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
      }
    } catch (err: any) {
      Alert.alert('Share Failed', err.message || 'Could not share image.');
    } finally {
      setSharingImage(false);
    }
  };

  const activeUri = imageUri || lastImageUriRef.current;
  if (!visible || !activeUri) return null;

  const isRemote = activeUri.startsWith('http://') || activeUri.startsWith('https://');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={triggerClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" />
      <GestureHandlerRootView style={styles.modalShell}>
        <Animated.View style={[styles.backdropBg, backdropBgStyle]} />
        <Animated.View style={[styles.backdrop, dismissContainerStyle]}>
          <SafeAreaView style={styles.safeArea} edges={['bottom']}>
            {/* Header Action Bar */}
            <Animated.View
              style={[
                styles.header,
                { paddingTop: insets.top + 12 },
                headerAnimatedStyle,
              ]}
              pointerEvents={controlsVisible ? 'auto' : 'none'}
            >
              <View style={styles.actionGroup}>
                <TouchableOpacity
                  onPress={handleShare}
                  disabled={sharingImage}
                  style={styles.actionBtn}
                  accessibilityLabel="Share image"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {sharingImage ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="share-outline" size={18} color="#FFFFFF" />
                      <Text variant="xs" weight="600" style={styles.btnLabel}>
                        Share
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSave}
                  disabled={savingImage}
                  style={styles.actionBtn}
                  accessibilityLabel="Save image to photos"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {savingImage ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                      <Text variant="xs" weight="600" style={styles.btnLabel}>
                        Save
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={triggerClose}
                style={styles.closeBtn}
                accessibilityLabel="Close image viewer"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>

            {/* Native UI-Thread Pinch, Double-Tap Zoom, Pan & Swipe-to-Dismiss */}
            <GestureDetector gesture={composedGesture}>
              <View style={styles.zoomContainer}>
                {loadingImage && (
                  <View style={styles.loadingOverlay} pointerEvents="none">
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  </View>
                )}
                <Animated.View style={[styles.imageWrapper, imageAnimatedStyle]}>
                  <Image
                    source={{
                      uri: activeUri,
                      headers: isRemote ? headers : undefined,
                      cacheKey: activeUri,
                    }}
                    style={styles.fullImage}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    transition={120}
                    onLoadEnd={() => setLoadingImage(false)}
                    onError={() => setLoadingImage(false)}
                  />
                </Animated.View>
              </View>
            </GestureDetector>

            {/* Auto-dismissing Footer Hint */}
            {showHint && (
              <Animated.View
                style={[styles.footer, headerAnimatedStyle]}
                pointerEvents="none"
              >
                <Text variant="xs" style={styles.footerText}>
                  {isZoomed
                    ? 'Double-tap to reset • Drag to pan • Pinch to zoom'
                    : 'Pinch or double-tap to zoom • Swipe up or down to close'}
                </Text>
              </Animated.View>
            )}
          </SafeAreaView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalShell: {
    flex: 1,
  },
  backdropBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  backdrop: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 10,
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
  },
  btnLabel: {
    color: '#FFFFFF',
    marginLeft: 5,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  imageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.82,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 10,
    zIndex: 10,
  },
  footerText: {
    color: '#8E8E93',
    fontSize: 12,
  },
});
