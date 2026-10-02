import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Dimensions,
  Platform,
  BackHandler,
  StatusBar,
  Share,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Typography';
import { useTheme } from '@/constants/useTheme';
import { PostMediaItem } from '@/services/posts';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PostMediaGalleryProps {
  media?: (PostMediaItem | { url: string })[] | null;
  imageUrl?: string | null;
  getFullUrl?: (path: string | null) => string | null;
  onDoubleTap?: () => void;
}

export function PostMediaGallery({
  media,
  imageUrl,
  getFullUrl,
  onDoubleTap,
}: PostMediaGalleryProps) {
  const { colors, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const resolveUrl = useCallback(
    (path?: string | null): string | null => {
      if (!path) return null;
      if (getFullUrl) {
        const resolved = getFullUrl(path);
        if (resolved) return resolved;
      }
      return path;
    },
    [getFullUrl]
  );

  const urls = useMemo<string[]>(() => {
    if (Array.isArray(media) && media.length > 0) {
      return media
        .map((m) => resolveUrl(m.url))
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
    }
    if (imageUrl) {
      const u = resolveUrl(imageUrl);
      return u ? [u] : [];
    }
    return [];
  }, [media, imageUrl, resolveUrl]);

  const [modalVisible, setModalVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<string>>(null);
  const lastTapRef = useRef<number>(0);

  // Android Back Handler for Fullscreen Modal
  useEffect(() => {
    if (!modalVisible || Platform.OS !== 'android') return;
    const onBackPress = () => {
      setModalVisible(false);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [modalVisible]);

  const openFullscreen = (index: number) => {
    setActiveIndex(index);
    setModalVisible(true);
  };

  const closeFullscreen = () => {
    setModalVisible(false);
  };

  const handleShareImage = async () => {
    const currentUrl = urls[activeIndex];
    if (!currentUrl) return;
    try {
      await Share.share({
        url: currentUrl,
        message: currentUrl,
      });
    } catch {
      // Ignored
    }
  };

  const handleViewerTouchEnd = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      lastTapRef.current = 0;
      onDoubleTap?.();
    } else {
      lastTapRef.current = now;
    }
  };

  if (urls.length === 0) return null;

  // Single Image Layout (Natural / Capped 16:10 aspect ratio)
  if (urls.length === 1) {
    return (
      <View style={styles.container}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => openFullscreen(0)}
          style={[
            styles.singleImageContainer,
            {
              borderRadius: radii.md,
              borderColor: colors.border,
              backgroundColor: colors.surfaceRaised,
            },
          ]}
        >
          <Image
            source={{ uri: urls[0] }}
            style={styles.singleImage}
            contentFit="cover"
            transition={150}
          />
        </TouchableOpacity>
        {renderFullscreenModal()}
      </View>
    );
  }

  // 2 Images Layout (Side-by-side equal columns)
  if (urls.length === 2) {
    return (
      <View style={styles.container}>
        <View style={styles.twoImageLayout}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openFullscreen(0)}
            style={[
              styles.twoImageCol,
              {
                borderRadius: radii.md,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              },
            ]}
          >
            <Image
              source={{ uri: urls[0] }}
              style={styles.fullFill}
              contentFit="cover"
              transition={150}
            />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openFullscreen(1)}
            style={[
              styles.twoImageCol,
              {
                borderRadius: radii.md,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              },
            ]}
          >
            <Image
              source={{ uri: urls[1] }}
              style={styles.fullFill}
              contentFit="cover"
              transition={150}
            />
          </TouchableOpacity>
        </View>
        {renderFullscreenModal()}
      </View>
    );
  }

  // 3 Images Layout (1 large on left, 2 stacked on right)
  if (urls.length === 3) {
    return (
      <View style={styles.container}>
        <View style={styles.threeImageLayout}>
          {/* Main Left Image */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openFullscreen(0)}
            style={[
              styles.threeImageMain,
              {
                borderRadius: radii.md,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              },
            ]}
          >
            <Image
              source={{ uri: urls[0] }}
              style={styles.fullFill}
              contentFit="cover"
              transition={150}
            />
          </TouchableOpacity>

          {/* Right Stack (2 images) */}
          <View style={styles.threeImageStack}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => openFullscreen(1)}
              style={[
                styles.threeImageStackedItem,
                {
                  borderRadius: radii.md,
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceRaised,
                },
              ]}
            >
              <Image
                source={{ uri: urls[1] }}
                style={styles.fullFill}
                contentFit="cover"
                transition={150}
              />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => openFullscreen(2)}
              style={[
                styles.threeImageStackedItem,
                {
                  borderRadius: radii.md,
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceRaised,
                },
              ]}
            >
              <Image
                source={{ uri: urls[2] }}
                style={styles.fullFill}
                contentFit="cover"
                transition={150}
              />
            </TouchableOpacity>
          </View>
        </View>
        {renderFullscreenModal()}
      </View>
    );
  }

  // 4+ Images Layout (2x2 Grid with +N overlay on the 4th item if > 4)
  const remainingCount = urls.length - 4;
  return (
    <View style={styles.container}>
      <View style={styles.fourGridContainer}>
        {/* Row 1: Images 0 & 1 */}
        <View style={styles.gridRow}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openFullscreen(0)}
            style={[
              styles.gridItem,
              {
                borderRadius: radii.md,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              },
            ]}
          >
            <Image
              source={{ uri: urls[0] }}
              style={styles.fullFill}
              contentFit="cover"
              transition={150}
            />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openFullscreen(1)}
            style={[
              styles.gridItem,
              {
                borderRadius: radii.md,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              },
            ]}
          >
            <Image
              source={{ uri: urls[1] }}
              style={styles.fullFill}
              contentFit="cover"
              transition={150}
            />
          </TouchableOpacity>
        </View>

        {/* Row 2: Images 2 & 3 (Image 3 has +N badge if > 4) */}
        <View style={styles.gridRow}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openFullscreen(2)}
            style={[
              styles.gridItem,
              {
                borderRadius: radii.md,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              },
            ]}
          >
            <Image
              source={{ uri: urls[2] }}
              style={styles.fullFill}
              contentFit="cover"
              transition={150}
            />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openFullscreen(3)}
            style={[
              styles.gridItem,
              {
                borderRadius: radii.md,
                borderColor: colors.border,
                backgroundColor: colors.surfaceRaised,
              },
            ]}
          >
            <Image
              source={{ uri: urls[3] }}
              style={styles.fullFill}
              contentFit="cover"
              transition={150}
            />
            {remainingCount > 0 && (
              <View style={styles.moreOverlay}>
                <Text style={styles.moreOverlayText}>+{remainingCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
      {renderFullscreenModal()}
    </View>
  );

  function renderFullscreenModal() {
    return (
      <Modal
        visible={modalVisible}
        transparent={false}
        animationType="fade"
        onRequestClose={closeFullscreen}
      >
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <View style={[styles.modalRoot, { backgroundColor: '#000000' }]}>
          {/* Top Bar with Close, Counter, and Share */}
          <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 16) }]}>
            <TouchableOpacity
              onPress={closeFullscreen}
              style={styles.headerBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Close gallery"
            >
              <Ionicons name="close" size={26} color="#ffffff" />
            </TouchableOpacity>

            <View style={styles.counterBox}>
              <Text style={styles.counterText}>
                {activeIndex + 1} / {urls.length}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleShareImage}
              style={styles.headerBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Share image"
            >
              <Ionicons name="share-outline" size={22} color="#ffffff" />
            </TouchableOpacity>
          </View>

          {/* Swipeable Horizontal Image Viewer */}
          <FlatList
            ref={flatListRef}
            data={urls}
            keyExtractor={(_, idx) => `gallery-item-${idx}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={activeIndex}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const newIdx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              if (newIdx >= 0 && newIdx < urls.length) {
                setActiveIndex(newIdx);
              }
            }}
            renderItem={({ item }) => (
              <View
                style={styles.slideContainer}
                onTouchEnd={handleViewerTouchEnd}
              >
                <Image
                  source={{ uri: item }}
                  style={styles.slideImage}
                  contentFit="contain"
                  priority="high"
                />
              </View>
            )}
            style={{ flex: 1 }}
          />
        </View>
      </Modal>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 10,
    marginBottom: 4,
  },
  fullFill: {
    width: '100%',
    height: '100%',
  },
  singleImageContainer: {
    width: '100%',
    aspectRatio: 16 / 10,
    overflow: 'hidden',
    borderWidth: 1,
  },
  singleImage: {
    width: '100%',
    height: '100%',
  },
  twoImageLayout: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  twoImageCol: {
    flex: 1,
    aspectRatio: 1,
    overflow: 'hidden',
    borderWidth: 1,
  },
  threeImageLayout: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
    height: 240,
  },
  threeImageMain: {
    flex: 1.2,
    height: '100%',
    overflow: 'hidden',
    borderWidth: 1,
  },
  threeImageStack: {
    flex: 1,
    height: '100%',
    gap: 6,
  },
  threeImageStackedItem: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 1,
  },
  fourGridContainer: {
    width: '100%',
    gap: 6,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 6,
    width: '100%',
  },
  gridItem: {
    flex: 1,
    aspectRatio: 1,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  moreOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreOverlayText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modalRoot: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    zIndex: 10,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterBox: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  counterText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  slideContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT - 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideImage: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
});
