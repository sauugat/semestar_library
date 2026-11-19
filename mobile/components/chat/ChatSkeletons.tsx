import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

function ShimmerBar({
  width,
  height,
  borderRadius = 8,
  pulse,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  pulse: SharedValue<number>;
  style?: ViewStyle;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  return (
    <Reanimated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: '#222226',
        },
        style,
        animatedStyle,
      ]}
    />
  );
}

/**
 * Pure UI-thread Reanimated v4 shimmer pulse (zero JS-thread frame work during transitions).
 */
function useSkeletonPulse() {
  const pulse = useSharedValue(0.38);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.76, { duration: 680, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.36, { duration: 680, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  return pulse;
}

/**
 * Professional monochrome skeleton loader for the Chats Inbox screen
 * (Active Now row + Pinned section + Messages list).
 */
export function ChatInboxSkeleton() {
  const pulse = useSkeletonPulse();

  return (
    <Reanimated.View
      entering={FadeIn.duration(140)}
      style={styles.inboxWrap}
      accessibilityLabel="Loading conversations"
    >
      {/* Active Now Header + Avatars */}
      <View style={styles.activeNowBlock}>
        <View style={styles.activeNowHeaderRow}>
          <ShimmerBar width={88} height={13} borderRadius={6} pulse={pulse} />
          <ShimmerBar width={54} height={12} borderRadius={6} pulse={pulse} />
        </View>
        <View style={styles.activeNowAvatarsRow}>
          {[0, 1, 2, 3, 4].map((idx) => (
            <View key={idx} style={styles.activeNowAvatarItem}>
              <ShimmerBar width={58} height={58} borderRadius={29} pulse={pulse} />
              <ShimmerBar
                width={42}
                height={10}
                borderRadius={5}
                pulse={pulse}
                style={{ marginTop: 8 }}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Pinned Section */}
      <View style={styles.sectionHeader}>
        <ShimmerBar width={54} height={10} borderRadius={5} pulse={pulse} />
      </View>
      {[0, 1].map((idx) => (
        <View key={`pinned-${idx}`} style={styles.convRow}>
          <ShimmerBar width={54} height={54} borderRadius={27} pulse={pulse} />
          <View style={styles.convBody}>
            <View style={styles.convTopLine}>
              <ShimmerBar width={idx === 0 ? '42%' : '54%'} height={15} borderRadius={7} pulse={pulse} />
              <ShimmerBar width={34} height={11} borderRadius={5} pulse={pulse} />
            </View>
            <ShimmerBar
              width={idx === 0 ? '68%' : '56%'}
              height={12}
              borderRadius={6}
              pulse={pulse}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      ))}

      {/* Messages Section */}
      <View style={[styles.sectionHeader, { marginTop: 8 }]}>
        <ShimmerBar width={72} height={10} borderRadius={5} pulse={pulse} />
      </View>
      {[0, 1, 2, 3, 4].map((idx) => (
        <View key={`dm-${idx}`} style={styles.convRow}>
          <ShimmerBar width={54} height={54} borderRadius={27} pulse={pulse} />
          <View style={styles.convBody}>
            <View style={styles.convTopLine}>
              <ShimmerBar
                width={idx % 2 === 0 ? '48%' : '38%'}
                height={15}
                borderRadius={7}
                pulse={pulse}
              />
              <ShimmerBar width={30} height={11} borderRadius={5} pulse={pulse} />
            </View>
            <ShimmerBar
              width={idx % 3 === 0 ? '74%' : idx % 3 === 1 ? '58%' : '64%'}
              height={12}
              borderRadius={6}
              pulse={pulse}
              style={{ marginTop: 8 }}
            />
          </View>
        </View>
      ))}
    </Reanimated.View>
  );
}

/**
 * Professional monochrome skeleton loader for DM, Group, and Kyana chat timelines.
 */
export function ChatConversationSkeleton({ showAvatars = true }: { showAvatars?: boolean }) {
  const pulse = useSkeletonPulse();

  const rows: Array<{ side: 'left' | 'right'; width: number | `${number}%`; height: number; showAvatar?: boolean }> = [
    { side: 'left', width: '64%', height: 46, showAvatar: true },
    { side: 'right', width: '56%', height: 42 },
    { side: 'right', width: '36%', height: 38 },
    { side: 'left', width: '72%', height: 58, showAvatar: true },
    { side: 'left', width: '48%', height: 40, showAvatar: false },
    { side: 'right', width: '62%', height: 44 },
  ];

  return (
    <Reanimated.View
      entering={FadeIn.duration(140)}
      style={styles.chatWrap}
      accessibilityLabel="Loading messages"
    >
      {/* Date Pill Skeleton */}
      <View style={styles.datePillWrap}>
        <ShimmerBar width={74} height={22} borderRadius={11} pulse={pulse} />
      </View>

      <View style={styles.bubblesList}>
        {rows.map((row, idx) => {
          const isRight = row.side === 'right';
          return (
            <View
              key={idx}
              style={[
                styles.bubbleRow,
                isRight ? styles.bubbleRowRight : styles.bubbleRowLeft,
              ]}
            >
              {!isRight && showAvatars && (
                <View style={styles.avatarSlot}>
                  {row.showAvatar ? (
                    <ShimmerBar width={28} height={28} borderRadius={14} pulse={pulse} />
                  ) : null}
                </View>
              )}
              <ShimmerBar
                width={row.width}
                height={row.height}
                borderRadius={18}
                pulse={pulse}
                style={isRight ? styles.bubbleRightTint : styles.bubbleLeftTint}
              />
            </View>
          );
        })}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  inboxWrap: {
    flex: 1,
    paddingTop: 6,
  },
  activeNowBlock: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  activeNowHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  activeNowAvatarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  activeNowAvatarItem: {
    alignItems: 'center',
    width: 60,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#18181B',
  },
  convBody: {
    flex: 1,
    marginLeft: 14,
  },
  convTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    paddingBottom: 18,
  },
  datePillWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  bubblesList: {
    gap: 10,
  },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bubbleRowLeft: {
    justifyContent: 'flex-start',
  },
  bubbleRowRight: {
    justifyContent: 'flex-end',
  },
  avatarSlot: {
    width: 28,
    marginRight: 8,
    alignItems: 'center',
  },
  bubbleLeftTint: {
    backgroundColor: '#1C1C20',
    borderBottomLeftRadius: 5,
  },
  bubbleRightTint: {
    backgroundColor: '#2A2A30',
    borderBottomRightRadius: 5,
  },
});
