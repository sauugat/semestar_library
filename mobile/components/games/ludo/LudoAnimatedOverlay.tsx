import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import {
  type TokenTravelPlan,
  type CaptureReturnPlan,
  type CelebrationParticle,
  buildCelebrationParticles,
  LUDO_ANIMATION_CONSTANTS,
} from './ludo-animation';
import { Text } from '@/components/ui/Typography';
import type { PlayerColor } from '../../../../packages/ludo-engine/src/index.ts';

const TOKEN_COLOR_THEME: Record<
  PlayerColor,
  { fill: string; rim: string; innerBorder: string; shadow: string }
> = {
  red: {
    fill: '#E11D48',
    rim: '#881337',
    innerBorder: 'rgba(255, 255, 255, 0.45)',
    shadow: 'rgba(136, 19, 55, 0.40)',
  },
  green: {
    fill: '#10B981',
    rim: '#064E3B',
    innerBorder: 'rgba(255, 255, 255, 0.45)',
    shadow: 'rgba(6, 78, 59, 0.40)',
  },
  yellow: {
    fill: '#F59E0B',
    rim: '#78350F',
    innerBorder: 'rgba(255, 255, 255, 0.50)',
    shadow: 'rgba(120, 53, 15, 0.45)',
  },
  blue: {
    fill: '#3B82F6',
    rim: '#1E3A8A',
    innerBorder: 'rgba(255, 255, 255, 0.45)',
    shadow: 'rgba(30, 58, 138, 0.40)',
  },
};

export interface LudoAnimatedOverlayProps {
  boardSize: number;
  cellSize: number;
  travelPlan: TokenTravelPlan | null;
  capturePlans: CaptureReturnPlan[];
  celebrationRank: { color: PlayerColor; rank: number; displayName: string } | null;
  showWinnerCelebration?: boolean;
  winnerColor: PlayerColor | null;
  isReducedMotion?: boolean;
  onTravelComplete?: (outcome: 'completed' | 'cancelled') => void;
  onCaptureComplete?: (outcome: 'completed' | 'cancelled') => void;
  onCelebrationComplete?: (outcome: 'completed' | 'cancelled') => void;
  onWinnerCelebrationComplete?: (outcome: 'completed' | 'cancelled') => void;
}

export function LudoAnimatedOverlay({
  boardSize,
  cellSize,
  travelPlan,
  capturePlans,
  celebrationRank,
  showWinnerCelebration = false,
  winnerColor,
  isReducedMotion = false,
  onTravelComplete,
  onCaptureComplete,
  onCelebrationComplete,
  onWinnerCelebrationComplete,
}: LudoAnimatedOverlayProps) {
  const tokenDiameter = Math.max(13, Math.round(cellSize * 0.74));
  const halfToken = tokenDiameter / 2;

  // 1. Traveling Token Animation State
  const travelPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const travelHop = useRef(new Animated.Value(0)).current;
  const travelScale = useRef(new Animated.Value(1)).current;
  const [activeTravel, setActiveTravel] = useState<TokenTravelPlan | null>(null);
  const activeTravelAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!travelPlan) {
      if (activeTravelAnimRef.current) {
        activeTravelAnimRef.current.stop();
        activeTravelAnimRef.current = null;
      }
      setActiveTravel(null);
      return;
    }

    setActiveTravel(travelPlan);
    const { pixelSteps, stepDurationMs, reachedFinish } = travelPlan;

    if (pixelSteps.length === 0) {
      onTravelComplete?.('completed');
      return;
    }

    if (isReducedMotion) {
      const finalStep = pixelSteps[pixelSteps.length - 1];
      travelPos.setValue({
        x: finalStep.x - halfToken,
        y: finalStep.y - halfToken,
      });
      travelHop.setValue(0);
      travelScale.setValue(1);
      onTravelComplete?.('completed');
      return;
    }

    // Initial position
    const startX = (travelPlan.fromCoord.x + 0.5) * cellSize - halfToken;
    const startY = (travelPlan.fromCoord.y + 0.5) * cellSize - halfToken;
    travelPos.setValue({ x: startX, y: startY });
    travelHop.setValue(0);
    travelScale.setValue(1);

    // Build chained animations for each step
    const stepAnimations: Animated.CompositeAnimation[] = [];

    for (let i = 0; i < pixelSteps.length; i++) {
      const step = pixelSteps[i];
      const targetX = step.x - halfToken;
      const targetY = step.y - halfToken;

      const moveStep = Animated.timing(travelPos, {
        toValue: { x: targetX, y: targetY },
        duration: stepDurationMs,
        useNativeDriver: true,
      });

      const hopStep = Animated.sequence([
        Animated.timing(travelHop, {
          toValue: -LUDO_ANIMATION_CONSTANTS.TOKEN_HOP_HEIGHT_PX,
          duration: Math.round(stepDurationMs * 0.45),
          useNativeDriver: true,
        }),
        Animated.timing(travelHop, {
          toValue: 0,
          duration: Math.round(stepDurationMs * 0.55),
          useNativeDriver: true,
        }),
      ]);

      stepAnimations.push(Animated.parallel([moveStep, hopStep]));
    }

    // Finish flourish if reached finish
    if (reachedFinish) {
      stepAnimations.push(
        Animated.sequence([
          Animated.timing(travelScale, {
            toValue: 1.20,
            duration: 110,
            useNativeDriver: true,
          }),
          Animated.timing(travelScale, {
            toValue: 1.0,
            duration: 110,
            useNativeDriver: true,
          }),
        ])
      );
    }

    const sequence = Animated.sequence(stepAnimations);
    activeTravelAnimRef.current = sequence;

    sequence.start(({ finished }) => {
      activeTravelAnimRef.current = null;
      if (finished) {
        onTravelComplete?.('completed');
      } else {
        onTravelComplete?.('cancelled');
      }
    });

    return () => {
      if (activeTravelAnimRef.current) {
        activeTravelAnimRef.current.stop();
        activeTravelAnimRef.current = null;
      }
    };
  }, [travelPlan, isReducedMotion, cellSize, halfToken, onTravelComplete, travelPos, travelHop, travelScale]);

  // 2. Captured Return Animation State
  const [activeCaptures, setActiveCaptures] = useState<CaptureReturnPlan[]>([]);
  const captureProgressAnim = useRef(new Animated.Value(0)).current;
  const activeCaptureAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!capturePlans || capturePlans.length === 0) {
      if (activeCaptureAnimRef.current) {
        activeCaptureAnimRef.current.stop();
        activeCaptureAnimRef.current = null;
      }
      setActiveCaptures([]);
      return;
    }

    setActiveCaptures(capturePlans);
    captureProgressAnim.setValue(0);

    if (isReducedMotion) {
      captureProgressAnim.setValue(1);
      onCaptureComplete?.('completed');
      return;
    }

    const anim = Animated.timing(captureProgressAnim, {
      toValue: 1,
      duration: LUDO_ANIMATION_CONSTANTS.CAPTURE_RETURN_DURATION_MS,
      useNativeDriver: true,
    });
    activeCaptureAnimRef.current = anim;

    anim.start(({ finished }) => {
      activeCaptureAnimRef.current = null;
      if (finished) {
        onCaptureComplete?.('completed');
      } else {
        onCaptureComplete?.('cancelled');
      }
    });

    return () => {
      if (activeCaptureAnimRef.current) {
        activeCaptureAnimRef.current.stop();
        activeCaptureAnimRef.current = null;
      }
    };
  }, [capturePlans, isReducedMotion, captureProgressAnim, onCaptureComplete]);

  // 3. Rank Celebration State
  const rankScale = useRef(new Animated.Value(0)).current;
  const rankOpacity = useRef(new Animated.Value(0)).current;
  const activeRankAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!celebrationRank) {
      if (activeRankAnimRef.current) {
        activeRankAnimRef.current.stop();
        activeRankAnimRef.current = null;
      }
      return;
    }

    if (isReducedMotion) {
      onCelebrationComplete?.('completed');
      return;
    }

    rankScale.setValue(0.7);
    rankOpacity.setValue(0);

    const anim = Animated.sequence([
      Animated.parallel([
        Animated.spring(rankScale, {
          toValue: 1,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.timing(rankOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(950),
      Animated.timing(rankOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]);
    activeRankAnimRef.current = anim;

    anim.start(({ finished }) => {
      activeRankAnimRef.current = null;
      if (finished) {
        onCelebrationComplete?.('completed');
      } else {
        onCelebrationComplete?.('cancelled');
      }
    });

    return () => {
      if (activeRankAnimRef.current) {
        activeRankAnimRef.current.stop();
        activeRankAnimRef.current = null;
      }
    };
  }, [celebrationRank, isReducedMotion, onCelebrationComplete, rankScale, rankOpacity]);

  // 4. Confetti Particles State (Event-driven only for fresh game completion)
  const particlesProgress = useRef(new Animated.Value(0)).current;
  const [particles, setParticles] = useState<CelebrationParticle[]>([]);
  const activeWinnerAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!showWinnerCelebration || !winnerColor) {
      if (activeWinnerAnimRef.current) {
        activeWinnerAnimRef.current.stop();
        activeWinnerAnimRef.current = null;
      }
      setParticles([]);
      return;
    }

    if (isReducedMotion) {
      onWinnerCelebrationComplete?.('completed');
      return;
    }

    const parts = buildCelebrationParticles(18, boardSize);
    setParticles(parts);
    particlesProgress.setValue(0);

    const anim = Animated.timing(particlesProgress, {
      toValue: 1,
      duration: 1300,
      useNativeDriver: true,
    });
    activeWinnerAnimRef.current = anim;

    anim.start(({ finished }) => {
      activeWinnerAnimRef.current = null;
      setParticles([]);
      if (finished) {
        onWinnerCelebrationComplete?.('completed');
      } else {
        onWinnerCelebrationComplete?.('cancelled');
      }
    });

    return () => {
      if (activeWinnerAnimRef.current) {
        activeWinnerAnimRef.current.stop();
        activeWinnerAnimRef.current = null;
      }
      setParticles([]);
    };
  }, [showWinnerCelebration, winnerColor, boardSize, isReducedMotion, particlesProgress, onWinnerCelebrationComplete]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* 1. Active Traveling Token */}
      {activeTravel && (
        <Animated.View
          style={[
            styles.animatedTokenOverlay,
            {
              width: tokenDiameter,
              height: tokenDiameter,
              transform: [
                { translateX: travelPos.x },
                { translateY: travelPos.y },
                { translateY: travelHop },
                { scale: travelScale },
              ],
            },
          ]}
        >
          <RenderTokenDisc color={activeTravel.color} diameter={tokenDiameter} isElevated />
        </Animated.View>
      )}

      {/* 2. Returning Captured Tokens */}
      {activeCaptures.map((cap) => {
        const startX = cap.startPixel.x - halfToken;
        const startY = cap.startPixel.y - halfToken;
        const endX = cap.targetYardPixel.x - halfToken;
        const endY = cap.targetYardPixel.y - halfToken;

        const posX = captureProgressAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [startX, endX],
        });
        const posY = captureProgressAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [startY, endY],
        });
        const capScale = captureProgressAnim.interpolate({
          inputRange: [0, 0.7, 1],
          outputRange: [1, 0.85, 0.75],
        });

        return (
          <Animated.View
            key={`cap-${cap.color}-${cap.tokenIndex}`}
            style={[
              styles.animatedTokenOverlay,
              {
                width: tokenDiameter,
                height: tokenDiameter,
                transform: [
                  { translateX: posX },
                  { translateY: posY },
                  { scale: capScale },
                ],
              },
            ]}
          >
            <RenderTokenDisc color={cap.color} diameter={tokenDiameter} />
          </Animated.View>
        );
      })}

      {/* 3. Confetti Particles */}
      {particles.map((p) => {
        const partX = particlesProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [p.startX - p.size / 2, p.targetX - p.size / 2],
        });
        const partY = particlesProgress.interpolate({
          inputRange: [0, 0.7, 1],
          outputRange: [p.startY - p.size / 2, p.targetY - p.size / 2 - 12, p.targetY + 20],
        });
        const partOpacity = particlesProgress.interpolate({
          inputRange: [0, 0.7, 1],
          outputRange: [1, 0.9, 0],
        });
        const partRotate = particlesProgress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${p.rotationDeg}deg`],
        });

        return (
          <Animated.View
            key={p.id}
            style={[
              styles.particle,
              {
                width: p.size,
                height: p.size,
                borderRadius: p.size > 8 ? 2 : p.size / 2,
                backgroundColor: p.colorHex,
                transform: [
                  { translateX: partX },
                  { translateY: partY },
                  { rotate: partRotate },
                ],
                opacity: partOpacity,
              },
            ]}
          />
        );
      })}

      {/* 4. Player Rank Toast Pill */}
      {celebrationRank && (
        <View style={styles.centerToastContainer}>
          <Animated.View
            style={[
              styles.rankPill,
              {
                backgroundColor: TOKEN_COLOR_THEME[celebrationRank.color].rim,
                borderColor: TOKEN_COLOR_THEME[celebrationRank.color].fill,
                transform: [{ scale: rankScale }],
                opacity: rankOpacity,
              },
            ]}
          >
            <Text variant="sm" weight="800" style={{ color: '#FFFFFF', letterSpacing: 0.5 }}>
              {`${celebrationRank.displayName.toUpperCase()} FINISHED #${celebrationRank.rank}!`}
            </Text>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

function RenderTokenDisc({
  color,
  diameter,
  isElevated = false,
}: {
  color: PlayerColor;
  diameter: number;
  isElevated?: boolean;
}) {
  const theme = TOKEN_COLOR_THEME[color];
  const innerDiscSize = Math.max(6, Math.round(diameter * 0.54));

  return (
    <View
      style={[
        styles.tokenDisc,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: theme.rim,
          shadowColor: theme.shadow,
          borderWidth: isElevated ? 2 : 0,
          borderColor: '#FFFFFF',
          elevation: isElevated ? 7 : 4,
        },
      ]}
    >
      <View
        style={[
          styles.mainBodyDisc,
          {
            width: diameter - Math.max(2, Math.round(diameter * 0.15)),
            height: diameter - Math.max(2, Math.round(diameter * 0.15)),
            borderRadius: diameter / 2,
            backgroundColor: theme.fill,
          },
        ]}
      >
        <View
          style={[
            styles.innerBevelPlate,
            {
              width: innerDiscSize,
              height: innerDiscSize,
              borderRadius: innerDiscSize / 2,
              borderColor: theme.innerBorder,
              backgroundColor: 'rgba(255, 255, 255, 0.16)',
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  animatedTokenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 50,
  },
  tokenDisc: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 4,
  },
  mainBodyDisc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerBevelPlate: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  particle: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 60,
  },
  centerToastContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 70,
  },
  rankPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
