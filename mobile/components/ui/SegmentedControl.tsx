import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { useTheme } from '@/constants/useTheme';
import { MotionDuration } from '@/constants/motion';

export interface SegmentItem {
  key: string;
  label: string;
  count?: number;
}

export interface SegmentedControlProps {
  items: SegmentItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  style?: ViewStyle;
}

export function SegmentedControl({
  items,
  selectedKey,
  onSelect,
  style,
}: SegmentedControlProps) {
  const { colors, radii, typography, touchTarget } = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.key === selectedKey)
  );

  const animatedIndex = useRef(new Animated.Value(selectedIndex)).current;

  useEffect(() => {
    Animated.timing(animatedIndex, {
      toValue: selectedIndex,
      duration: MotionDuration.smallTransition,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [selectedIndex, animatedIndex]);

  const padding = 3;
  const availableWidth = Math.max(0, containerWidth - padding * 2);
  const segmentWidth = items.length > 0 ? availableWidth / items.length : 0;

  const translateX = animatedIndex.interpolate({
    inputRange: items.map((_, i) => i),
    outputRange: items.map((_, i) => i * segmentWidth),
  });

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSubtle,
          borderRadius: radii.button + 2,
          padding,
          minHeight: Math.max(touchTarget.comfortable, 44),
        },
        style,
      ]}
    >
      {/* Animated Sliding Indicator Pill */}
      {containerWidth > 0 && segmentWidth > 0 && (
        <Animated.View
          style={[
            styles.animatedIndicator,
            {
              width: segmentWidth,
              borderRadius: radii.button,
              backgroundColor: colors.surfaceRaised,
              transform: [{ translateX }],
            },
          ]}
        />
      )}

      {items.map((item, index) => {
        const isSelected = item.key === selectedKey;
        const countText = typeof item.count === 'number' && item.count > 0 ? (item.count > 99 ? '99+' : String(item.count)) : null;

        return (
          <TouchableOpacity
            key={item.key}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={countText ? `${item.label}, ${countText} unread` : item.label}
            onPress={() => onSelect(item.key)}
            style={styles.segment}
          >
            <Text
              style={[
                styles.label,
                typography.sm,
                {
                  color: isSelected ? colors.text : colors.textMuted,
                  fontWeight: isSelected ? '700' : '600',
                  letterSpacing: 0.4,
                },
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>

            {countText && (
              <View
                style={[
                  styles.countBadge,
                  {
                    backgroundColor: isSelected ? colors.text : colors.surface,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.countText,
                    {
                      color: isSelected ? colors.background : colors.textSecondary,
                    },
                  ]}
                >
                  {countText}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  animatedIndicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    zIndex: 1,
  },
  label: {
    textAlign: 'center',
  },
  countBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
