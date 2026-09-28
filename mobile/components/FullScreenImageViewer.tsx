import React, { useState, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  PanResponder,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Text, Caption } from '@/components/ui/Typography';

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
  const [savingImage, setSavingImage] = useState(false);
  const [sharingImage, setSharingImage] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const lastTapRef = useRef<number>(0);

  // Swipe-down to dismiss animation
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Only trigger swipe-down if not zoomed and dragging downward
          return !isZoomed && gestureState.dy > 12 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5;
        },
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            translateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 80 || gestureState.vy > 0.8) {
            Animated.timing(translateY, {
              toValue: SCREEN_HEIGHT,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              translateY.setValue(0);
              onClose();
            });
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              friction: 7,
              tension: 90,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            friction: 7,
            useNativeDriver: true,
          }).start();
        },
      }),
    [isZoomed, onClose, translateY]
  );

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap detected
      if (isZoomed) {
        scrollViewRef.current?.scrollResponderZoomTo({ x: 0, y: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, animated: true });
        setIsZoomed(false);
      } else {
        scrollViewRef.current?.scrollResponderZoomTo({ x: SCREEN_WIDTH / 4, y: SCREEN_HEIGHT / 4, width: SCREEN_WIDTH / 2, height: SCREEN_HEIGHT / 2, animated: true });
        setIsZoomed(true);
      }
    } else {
      // Single tap -> close
      setTimeout(() => {
        if (Date.now() - lastTapRef.current >= 300) {
          onClose();
        }
      }, 310);
    }
    lastTapRef.current = now;
  };

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View
        style={[
          styles.backdrop,
          {
            transform: [{ translateY }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          {/* Header Action Bar */}
          <View style={styles.header}>
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
          </View>

          {/* Zoomable Image ScrollView */}
          <ScrollView
            ref={scrollViewRef}
            style={{ flex: 1 }}
            contentContainerStyle={styles.zoomContainer}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
            onScroll={(e) => {
              const zoom = (e.nativeEvent as any).zoomScale || 1;
              setIsZoomed(zoom > 1.05);
            }}
            scrollEventThrottle={32}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleDoubleTap}
              style={styles.imageWrapper}
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
            </TouchableOpacity>
          </ScrollView>

          {/* Footer Hint */}
          <View style={styles.footer}>
            <Caption style={styles.footerText}>
              Pinch or double-tap to zoom • Swipe down or tap to close
            </Caption>
          </View>
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
