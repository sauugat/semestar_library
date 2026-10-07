import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  PanResponder,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Text } from '@/components/ui/Typography';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const [isZoomed, setIsZoomed] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animated values for zoom, pan, and swipe-down dismissal
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const dismissY = useRef(new Animated.Value(0)).current;

  // Track synchronous values for gesture logic
  const currentScale = useRef(1);
  const currentTranslateX = useRef(0);
  const currentTranslateY = useRef(0);

  // Gesture tracking refs
  const initialPinchDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const startPanX = useRef(0);
  const startPanY = useRef(0);
  const isPinching = useRef(false);
  const isPanning = useRef(false);
  const isSwipingDismiss = useRef(false);
  const lastTapRef = useRef(0);

  // Listen to animated scale to update synchronous refs
  useEffect(() => {
    const scaleSub = scale.addListener(({ value }) => {
      currentScale.current = value;
      setIsZoomed(value > 1.05);
    });
    const txSub = translateX.addListener(({ value }) => {
      currentTranslateX.current = value;
    });
    const tySub = translateY.addListener(({ value }) => {
      currentTranslateY.current = value;
    });
    return () => {
      scale.removeListener(scaleSub);
      translateX.removeListener(txSub);
      translateY.removeListener(tySub);
    };
  }, [scale, translateX, translateY]);

  // Reset transforms whenever modal opens with a new image
  useEffect(() => {
    if (visible) {
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
      dismissY.setValue(0);
      currentScale.current = 1;
      currentTranslateX.current = 0;
      currentTranslateY.current = 0;
      setIsZoomed(false);
      lastTapRef.current = 0;
    }
  }, [visible, imageUri]);

  const [showHint, setShowHint] = useState(true);

  const toggleControls = () => {
    setControlsVisible((prev) => {
      const next = !prev;
      Animated.timing(controlsOpacity, {
        toValue: next ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return next;
    });
  };

  // Auto-hide hint after 2.5 seconds
  useEffect(() => {
    if (visible) {
      setShowHint(true);
      setControlsVisible(true);
      controlsOpacity.setValue(1);
      const timer = setTimeout(() => {
        setShowHint(false);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // Clean up single tap timer on unmount
  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
    };
  }, []);

  const resetZoom = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, friction: 7, tension: 90, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 7, tension: 90, useNativeDriver: true }),
    ]).start();
  };

  const zoomTo = (targetScale: number) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: targetScale, friction: 7, tension: 90, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, friction: 7, tension: 90, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, friction: 7, tension: 90, useNativeDriver: true }),
    ]).start();
  };

  const handleDoubleTap = () => {
    if (currentScale.current > 1.1) {
      resetZoom();
    } else {
      zoomTo(2.5);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            gestureState.numberActiveTouches >= 2 ||
            currentScale.current > 1.05 ||
            (gestureState.dy > 8 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.2)
          );
        },
        onPanResponderGrant: (evt) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            isPinching.current = true;
            isPanning.current = false;
            isSwipingDismiss.current = false;
            const dx = touches[0].pageX - touches[1].pageX;
            const dy = touches[0].pageY - touches[1].pageY;
            initialPinchDistance.current = Math.sqrt(dx * dx + dy * dy);
            pinchStartScale.current = currentScale.current;
          } else {
            isPinching.current = false;
            if (currentScale.current > 1.05) {
              isPanning.current = true;
              isSwipingDismiss.current = false;
              startPanX.current = currentTranslateX.current;
              startPanY.current = currentTranslateY.current;
            } else {
              isPanning.current = false;
              isSwipingDismiss.current = true;
            }
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2 && initialPinchDistance.current > 0) {
            const dx = touches[0].pageX - touches[1].pageX;
            const dy = touches[0].pageY - touches[1].pageY;
            const currentDist = Math.sqrt(dx * dx + dy * dy);
            const newScale = Math.max(
              0.8,
              Math.min(pinchStartScale.current * (currentDist / initialPinchDistance.current), 4.5)
            );
            scale.setValue(newScale);
          } else if (isPanning.current && currentScale.current > 1.05) {
            const maxDragX = (SCREEN_WIDTH * (currentScale.current - 1)) / 2 + 60;
            const maxDragY = (SCREEN_HEIGHT * (currentScale.current - 1)) / 2 + 60;
            const nextX = Math.max(-maxDragX, Math.min(startPanX.current + gestureState.dx, maxDragX));
            const nextY = Math.max(-maxDragY, Math.min(startPanY.current + gestureState.dy, maxDragY));
            translateX.setValue(nextX);
            translateY.setValue(nextY);
          } else if (isSwipingDismiss.current && currentScale.current <= 1.05) {
            if (gestureState.dy > 0) {
              dismissY.setValue(gestureState.dy);
            }
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (isPinching.current) {
            isPinching.current = false;
            initialPinchDistance.current = 0;
            if (currentScale.current < 1.05) {
              resetZoom();
            } else if (currentScale.current > 4) {
              zoomTo(4);
            }
            return;
          }

          if (isPanning.current) {
            isPanning.current = false;
            const maxDragX = (SCREEN_WIDTH * (currentScale.current - 1)) / 2;
            const maxDragY = (SCREEN_HEIGHT * (currentScale.current - 1)) / 2;
            const clampedX = Math.max(-maxDragX, Math.min(currentTranslateX.current, maxDragX));
            const clampedY = Math.max(-maxDragY, Math.min(currentTranslateY.current, maxDragY));
            Animated.parallel([
              Animated.spring(translateX, {
                toValue: clampedX,
                friction: 7,
                tension: 90,
                useNativeDriver: true,
              }),
              Animated.spring(translateY, {
                toValue: clampedY,
                friction: 7,
                tension: 90,
                useNativeDriver: true,
              }),
            ]).start();
            return;
          }

          if (isSwipingDismiss.current) {
            isSwipingDismiss.current = false;
            if (gestureState.dy > 80 || gestureState.vy > 0.8) {
              Animated.timing(dismissY, {
                toValue: SCREEN_HEIGHT,
                duration: 180,
                useNativeDriver: true,
              }).start(() => {
                dismissY.setValue(0);
                onClose();
              });
            } else {
              Animated.spring(dismissY, {
                toValue: 0,
                friction: 7,
                tension: 90,
                useNativeDriver: true,
              }).start();
            }
          }

          // Double tap vs single tap detection
          if (Math.abs(gestureState.dx) < 8 && Math.abs(gestureState.dy) < 8) {
            const now = Date.now();
            if (now - lastTapRef.current < 280) {
              if (singleTapTimerRef.current) {
                clearTimeout(singleTapTimerRef.current);
                singleTapTimerRef.current = null;
              }
              lastTapRef.current = 0;
              handleDoubleTap();
            } else {
              lastTapRef.current = now;
              if (singleTapTimerRef.current) {
                clearTimeout(singleTapTimerRef.current);
              }
              singleTapTimerRef.current = setTimeout(() => {
                singleTapTimerRef.current = null;
                toggleControls();
              }, 280);
            }
          }
        },
        onPanResponderTerminate: () => {
          isPinching.current = false;
          isPanning.current = false;
          isSwipingDismiss.current = false;
          Animated.spring(dismissY, { toValue: 0, friction: 7, tension: 90, useNativeDriver: true }).start();
          if (currentScale.current < 1.05) {
            resetZoom();
          }
        },
      }),
    [onClose]
  );

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

  if (!visible || !imageUri) return null;

  const backdropOpacity = dismissY.interpolate({
    inputRange: [0, SCREEN_HEIGHT / 2],
    outputRange: [1, 0.4],
    extrapolate: 'clamp',
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <Animated.View
        style={[
          styles.backdrop,
          {
            opacity: backdropOpacity,
            transform: [{ translateY: dismissY }],
          },
        ]}
      >
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          {/* Header Action Bar respecting safe-area top inset */}
          <Animated.View
            style={[
              styles.header,
              {
                paddingTop: insets.top + 12,
                opacity: controlsOpacity,
              },
            ]}
            pointerEvents={controlsVisible ? 'auto' : 'none'}
          >
            <View style={styles.actionGroup}>
              {/* Share */}
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

              {/* Save */}
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

            {/* Close */}
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel="Close image viewer"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>

          {/* Interactive Zoom & Pan Area with PanResponder */}
          <View style={styles.zoomContainer} {...panResponder.panHandlers}>
            <Animated.View
              style={[
                styles.imageWrapper,
                {
                  transform: [
                    { translateX },
                    { translateY },
                    { scale },
                  ],
                },
              ]}
            >
              <Image
                source={{
                  uri: imageUri,
                  headers: headers || undefined,
                }}
                style={styles.fullImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                transition={120}
              />
            </Animated.View>
          </View>

          {/* Auto-dismissing Footer Hint */}
          {showHint && (
            <Animated.View
              style={[styles.footer, { opacity: controlsOpacity }]}
              pointerEvents="none"
            >
              <Text variant="xs" style={styles.footerText}>
                {isZoomed
                  ? 'Double-tap to reset • Pan with 1 finger • Pinch to adjust'
                  : 'Double-tap or pinch to zoom • Swipe down or tap ✕ to close'}
              </Text>
            </Animated.View>
          )}
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#000000',
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
  imageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.78,
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
