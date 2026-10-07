import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  BackHandler,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import {
  getLudoInvitation,
  acceptLudoInvitation,
  declineLudoInvitation,
  LudoInvitationError,
  type LudoInvitationDetail,
} from '@/services/ludo-invitations';

type ScreenState =
  | 'loading'
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'room_started'
  | 'room_full'
  | 'room_unavailable'
  | 'wrong_account'
  | 'error';

export default function LudoInvitationScreen() {
  const router = useRouter();
  const { invitationId } = useLocalSearchParams<{ invitationId: string }>();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const [invitation, setInvitation] = useState<LudoInvitationDetail | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isAccepting, setIsAccepting] = useState<boolean>(false);
  const [isDeclining, setIsDeclining] = useState<boolean>(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);

  const fetchInvitation = useCallback(async () => {
    if (!invitationId) {
      setScreenState('error');
      setErrorMessage('Invalid invitation link.');
      return;
    }

    setScreenState('loading');
    try {
      const data = await getLudoInvitation(invitationId);
      setInvitation(data);

      if (data.status === 'accepted') {
        setScreenState('accepted');
      } else if (data.status === 'declined') {
        setScreenState('declined');
      } else if (data.status === 'expired') {
        setScreenState('expired');
      } else {
        const remaining = Math.max(
          0,
          Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000)
        );
        if (remaining <= 0) {
          setScreenState('expired');
        } else {
          setSecondsRemaining(remaining);
          setScreenState('pending');
        }
      }
    } catch (err: any) {
      if (err instanceof LudoInvitationError) {
        if (err.status === 403 || err.code === 'FORBIDDEN') {
          setScreenState('wrong_account');
        } else if (err.code === 'EXPIRED') {
          setScreenState('expired');
        } else if (err.code === 'ROOM_STARTED') {
          setScreenState('room_started');
        } else if (err.code === 'ROOM_FULL') {
          setScreenState('room_full');
        } else {
          setScreenState('error');
          setErrorMessage(err.message || 'Failed to load invitation.');
        }
      } else {
        setScreenState('error');
        setErrorMessage('Failed to load invitation. Please check your connection.');
      }
    }
  }, [invitationId]);

  useEffect(() => {
    void fetchInvitation();
  }, [fetchInvitation]);

  // Countdown timer for pending invitations
  useEffect(() => {
    if (screenState !== 'pending' || secondsRemaining <= 0) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          setScreenState('expired');
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [screenState, secondsRemaining]);

  const handleAccept = async () => {
    if (!invitationId || isAccepting || isDeclining) return;
    setIsAccepting(true);

    try {
      const res = await acceptLudoInvitation(invitationId);
      setScreenState('accepted');
      // Navigate to online Ludo room with JOIN intent
      router.replace({
        pathname: '/games/ludo/online/[roomId]',
        params: { roomId: res.roomId, intent: 'join' },
      });
    } catch (err: any) {
      setIsAccepting(false);
      if (err instanceof LudoInvitationError) {
        if (err.code === 'ROOM_STARTED') {
          setScreenState('room_started');
        } else if (err.code === 'ROOM_FULL') {
          setScreenState('room_full');
        } else if (err.code === 'ROOM_UNAVAILABLE') {
          setScreenState('room_unavailable');
        } else if (err.code === 'EXPIRED') {
          setScreenState('expired');
        } else if (err.status === 403) {
          setScreenState('wrong_account');
        } else {
          setScreenState('error');
          setErrorMessage(err.message || 'Failed to join match.');
        }
      } else {
        setScreenState('error');
        setErrorMessage('Failed to join match. Please check your connection.');
      }
    }
  };

  const handleDecline = async () => {
    if (!invitationId || isAccepting || isDeclining) return;
    setIsDeclining(true);

    try {
      await declineLudoInvitation(invitationId);
      setScreenState('declined');
    } catch (err: any) {
      setIsDeclining(false);
      if (err instanceof LudoInvitationError && err.status === 403) {
        setScreenState('wrong_account');
      } else {
        setScreenState('declined');
      }
    }
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${secs}s`;
  };

  const handleGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/games');
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.md,
          paddingHorizontal: spacing.lg,
        },
      ]}
    >
      {/* Header bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={handleGoBack}
          style={[styles.backButton, { backgroundColor: colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Subheading style={styles.topBarTitle}>Ludo Match</Subheading>
        <View style={styles.backButtonPlaceholder} />
      </View>

      <View style={styles.contentContainer}>
        {screenState === 'loading' && (
          <Card style={styles.card}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
              Loading invitation...
            </Text>
          </Card>
        )}

        {screenState === 'pending' && invitation && (
          <Card style={styles.card}>
            {/* Header Badge */}
            <Badge variant="neutral" label="INVITATION" style={styles.badge} />

            {/* Inviter Avatar / Info */}
            <View style={styles.avatarContainer}>
              {invitation.inviter.avatarUrl ? (
                <Image
                  source={{ uri: invitation.inviter.avatarUrl }}
                  style={[styles.avatar, { borderColor: colors.primary }]}
                />
              ) : (
                <View
                  style={[
                    styles.avatarFallback,
                    { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                  ]}
                >
                  <Ionicons name="person" size={40} color={colors.primary} />
                </View>
              )}
            </View>

            <Heading style={styles.inviterName}>{invitation.inviter.displayName}</Heading>
            <Text style={[styles.inviteMessage, { color: colors.textSecondary }]}>
              invited you to a private Ludo match.
            </Text>

            {/* Countdown / Expiration */}
            <View
              style={[
                styles.timerBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Ionicons name="time-outline" size={16} color={colors.warning} />
              <Caption style={[styles.timerText, { color: colors.textSecondary }]}>
                Expires in:{' '}
                <Text style={{ color: colors.warning, fontWeight: '700' }}>
                  {formatCountdown(secondsRemaining)}
                </Text>
              </Caption>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <PrimaryButton
                title={isAccepting ? 'Joining...' : 'Join Match'}
                onPress={handleAccept}
                disabled={isAccepting || isDeclining}
                loading={isAccepting}
                style={styles.actionBtn}
                accessibilityLabel="Join Match"
              />
              <SecondaryButton
                title={isDeclining ? 'Declining...' : 'Decline'}
                onPress={handleDecline}
                disabled={isAccepting || isDeclining}
                style={styles.actionBtn}
                accessibilityLabel="Decline Invitation"
              />
            </View>
          </Card>
        )}

        {screenState === 'expired' && (
          <Card style={styles.card}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.surface, borderColor: colors.warning },
              ]}
            >
              <Ionicons name="time-outline" size={44} color={colors.warning} />
            </View>
            <Heading style={styles.stateTitle}>Invitation Expired</Heading>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              This invitation has expired. Ask the host to send a new invite if the room is still open.
            </Text>
            <SecondaryButton
              title="Back to Games"
              onPress={handleGoBack}
              style={styles.stateBtn}
              accessibilityLabel="Back to Games"
            />
          </Card>
        )}

        {screenState === 'room_started' && (
          <Card style={styles.card}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.surface, borderColor: colors.error },
              ]}
            >
              <Ionicons name="game-controller-outline" size={44} color={colors.error} />
            </View>
            <Heading style={styles.stateTitle}>Match Already Started</Heading>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              This match has already started and cannot accept new players.
            </Text>
            <SecondaryButton
              title="Back to Games"
              onPress={handleGoBack}
              style={styles.stateBtn}
              accessibilityLabel="Back to Games"
            />
          </Card>
        )}

        {screenState === 'room_full' && (
          <Card style={styles.card}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.surface, borderColor: colors.warning },
              ]}
            >
              <Ionicons name="people-outline" size={44} color={colors.warning} />
            </View>
            <Heading style={styles.stateTitle}>Room is Full</Heading>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              All seats in this match have been taken by other players.
            </Text>
            <SecondaryButton
              title="Back to Games"
              onPress={handleGoBack}
              style={styles.stateBtn}
              accessibilityLabel="Back to Games"
            />
          </Card>
        )}

        {screenState === 'room_unavailable' && (
          <Card style={styles.card}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.surface, borderColor: colors.error },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={44} color={colors.error} />
            </View>
            <Heading style={styles.stateTitle}>Room Unavailable</Heading>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              This room is no longer active or could not be found.
            </Text>
            <SecondaryButton
              title="Back to Games"
              onPress={handleGoBack}
              style={styles.stateBtn}
              accessibilityLabel="Back to Games"
            />
          </Card>
        )}

        {screenState === 'wrong_account' && (
          <Card style={styles.card}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.surface, borderColor: colors.error },
              ]}
            >
              <Ionicons name="lock-closed-outline" size={44} color={colors.error} />
            </View>
            <Heading style={styles.stateTitle}>Unavailable</Heading>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              This invitation isn't available for this account.
            </Text>
            <SecondaryButton
              title="Back to Games"
              onPress={handleGoBack}
              style={styles.stateBtn}
              accessibilityLabel="Back to Games"
            />
          </Card>
        )}

        {screenState === 'declined' && (
          <Card style={styles.card}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.surface, borderColor: colors.textSecondary },
              ]}
            >
              <Ionicons name="close-circle-outline" size={44} color={colors.textSecondary} />
            </View>
            <Heading style={styles.stateTitle}>Invitation Declined</Heading>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              You declined this invitation to join the Ludo match.
            </Text>
            <SecondaryButton
              title="Back to Games"
              onPress={handleGoBack}
              style={styles.stateBtn}
              accessibilityLabel="Back to Games"
            />
          </Card>
        )}

        {screenState === 'accepted' && (
          <Card style={styles.card}>
            {isAccepting ? (
              <>
                <ActivityIndicator size="large" color={colors.success || '#10B981'} />
                <Heading style={[styles.stateTitle, { marginTop: 16 }]}>Joining Match...</Heading>
                <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
                  Entering Ludo room.
                </Text>
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.iconCircle,
                    { backgroundColor: colors.surface, borderColor: colors.success || '#10B981' },
                  ]}
                >
                  <Ionicons name="checkmark-circle-outline" size={44} color={colors.success || '#10B981'} />
                </View>
                <Heading style={styles.stateTitle}>Invitation Accepted</Heading>
                <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
                  You have already accepted this invitation.
                </Text>
                {invitation?.roomId ? (
                  <PrimaryButton
                    title="Open Match"
                    onPress={() => {
                      router.replace({
                        pathname: '/games/ludo/online/[roomId]',
                        params: { roomId: invitation.roomId, intent: 'join' },
                      });
                    }}
                    style={styles.stateBtn}
                    accessibilityLabel="Open Match"
                  />
                ) : null}
                <SecondaryButton
                  title="Back to Games"
                  onPress={handleGoBack}
                  style={[styles.stateBtn, { marginTop: 10 }]}
                  accessibilityLabel="Back to Games"
                />
              </>
            )}
          </Card>
        )}

        {screenState === 'error' && (
          <Card style={styles.card}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.surface, borderColor: colors.error },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={44} color={colors.error} />
            </View>
            <Heading style={styles.stateTitle}>Invitation Error</Heading>
            <Text style={[styles.stateDesc, { color: colors.textSecondary }]}>
              {errorMessage || 'Unable to open invitation.'}
            </Text>
            <SecondaryButton
              title="Back to Games"
              onPress={handleGoBack}
              style={styles.stateBtn}
              accessibilityLabel="Back to Games"
            />
          </Card>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonPlaceholder: {
    width: 40,
  },
  topBarTitle: {
    fontWeight: '700',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    padding: 24,
    alignItems: 'center',
  },
  badge: {
    marginBottom: 16,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
  },
  avatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviterName: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  inviteMessage: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  timerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 24,
  },
  timerText: {
    marginLeft: 6,
    fontSize: 13,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  actionBtn: {
    width: '100%',
  },
  loadingText: {
    marginTop: 14,
    fontSize: 14,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  stateDesc: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  stateBtn: {
    width: '100%',
  },
});
