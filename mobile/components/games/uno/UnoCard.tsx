import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text as RNText } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UnoCard as UnoCardType, COLOR_METAS } from './types';

interface UnoCardProps {
  card: UnoCardType;
  isFaceUp?: boolean;
  isPlayable?: boolean;
  onPress?: () => void;
  width?: number;
  height?: number;
  isSelected?: boolean;
}

const SUIT_MOTIF_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  rato: 'flower',
  nilo: 'snow',
  hariyo: 'leaf',
  pahelo: 'sunny',
  wild: 'sparkles',
};

export function UnoCard({
  card,
  isFaceUp = true,
  isPlayable = false,
  onPress,
  width = 68,
  height = 100,
  isSelected = false,
}: UnoCardProps) {
  const meta = COLOR_METAS[card.color] || COLOR_METAS.rato;
  const radius = Math.max(8, Math.round(width * 0.14));
  const showDetail = width >= 48;

  // ---------------------------------------------------------------------------
  // Brand-New Face-Down Card Back:
  // Traditional Newari Carved Rosewood, Ankhi Jhyal Lattice & Gilded Mandala
  // ---------------------------------------------------------------------------
  if (!isFaceUp) {
    return (
      <View
        style={[
          styles.cardBase,
          styles.carvedWoodCardBack,
          { width, height, borderRadius: radius },
          isSelected && styles.cardSelected,
        ]}
      >
        {/* Outer Carved Timber Bevel & Gilded Brass Inlay */}
        <View style={[styles.carvedInnerSanctum, { borderRadius: Math.max(5, radius - 3) }]}>
          {/* Top & Bottom Ankhi Jhyal Lattice Bars */}
          {showDetail && (
            <View style={styles.latticeRowTop}>
              <View style={styles.latticeDiamond} />
              <View style={styles.latticeDiamondGold} />
              <View style={styles.latticeDiamond} />
            </View>
          )}

          {/* 4 Carved Brass Corner Studs */}
          <View style={[styles.brassCornerStud, styles.studTL]} />
          <View style={[styles.brassCornerStud, styles.studTR]} />
          <View style={[styles.brassCornerStud, styles.studBL]} />
          <View style={[styles.brassCornerStud, styles.studBR]} />

          {/* Central 8-Pointed Ashtamangala Gilded Lotus Mandala */}
          <View
            style={[
              styles.mandalaMedallion,
              { width: width * 0.7, height: width * 0.7 },
            ]}
          >
            <View style={styles.mandalaSquareA} />
            <View style={styles.mandalaSquareB} />
            <View style={styles.mandalaInnerCircle}>
              <Ionicons name="flower" size={Math.round(width * 0.3)} color="#D4AF37" />
              <View style={styles.mandalaCoreDot} />
            </View>
          </View>

          {showDetail && (
            <View style={styles.unoGoldPlaque}>
              <RNText
                style={[
                  styles.unoGoldPlaqueText,
                  { fontSize: Math.max(7, Math.round(width * 0.12)) },
                ]}
              >
                UNO
              </RNText>
            </View>
          )}

          {showDetail && (
            <View style={styles.latticeRowBottom}>
              <View style={styles.latticeDiamond} />
              <View style={styles.latticeDiamondGold} />
              <View style={styles.latticeDiamond} />
            </View>
          )}
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Brand-New Face-Up Card:
  // Carved Gilded Arch Molding + Clean, High-Contrast English Typography
  // ---------------------------------------------------------------------------
  const isWild = card.color === 'wild';
  const cornerFontSize = Math.max(11, Math.round(width * 0.19));
  const centerFontSize = Math.max(22, Math.round(width * 0.44));
  const watermarkIcon = SUIT_MOTIF_ICON[card.color] || 'flower';

  return (
    <TouchableOpacity
      activeOpacity={isPlayable ? 0.8 : 1}
      disabled={!isPlayable && !onPress}
      onPress={onPress}
      style={[
        styles.cardBase,
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: isWild ? '#1E110B' : meta.bgHex,
          borderColor: isPlayable ? '#FDE047' : isWild ? '#D4AF37' : '#FEF3C7',
          borderWidth: isPlayable ? 3 : 2,
        },
        isPlayable && styles.cardPlayableHighlight,
        isSelected && styles.cardSelected,
      ]}
    >
      {/* Inner Carved Gold Arch Frame */}
      <View
        style={[
          styles.faceCarvedFrame,
          {
            borderRadius: Math.max(5, radius - 3),
            borderColor: isPlayable
              ? 'rgba(253, 224, 71, 0.8)'
              : 'rgba(254, 243, 199, 0.38)',
          },
        ]}
      >
        {showDetail && (
          <>
            <View style={styles.inlayDiamondTR} />
            <View style={styles.inlayDiamondBL} />
          </>
        )}

        {/* Top-Left Corner Index */}
        <View style={styles.cornerIndexTopLeft}>
          {renderCornerIndex(card, '#FFFFFF', cornerFontSize)}
        </View>

        {/* Center Sacred Mandala Oval */}
        <View
          style={[
            styles.centerMandalaOval,
            {
              width: width * 0.75,
              height: height * 0.62,
              borderColor: isWild ? '#D4AF37' : 'rgba(254, 243, 199, 0.92)',
              backgroundColor: isWild
                ? 'rgba(212, 175, 55, 0.14)'
                : 'rgba(20, 8, 4, 0.18)',
            },
          ]}
        >
          {/* Subtle Carved Suit Watermark */}
          <View style={styles.watermarkLayer} pointerEvents="none">
            <Ionicons
              name={watermarkIcon}
              size={Math.round(width * 0.44)}
              color="rgba(255, 255, 255, 0.13)"
            />
          </View>

          <View style={[styles.innerCarvedRing, isWild && styles.innerCarvedWildRing]}>
            {renderCenterContent(card, '#FFFFFF', centerFontSize, width)}
          </View>
        </View>

        {/* Bottom-Right Inverted Corner Index */}
        <View style={styles.cornerIndexBottomRight}>
          {renderCornerIndex(card, '#FFFFFF', cornerFontSize)}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Clean English Corner Indices
// ---------------------------------------------------------------------------
function renderCornerIndex(card: UnoCardType, textColor: string, fontSize: number) {
  if (card.type === 'number') {
    const hasUnderline = card.value === 6 || card.value === 9;
    return (
      <View style={styles.cornerNumCol}>
        <RNText
          style={{
            color: textColor,
            fontSize,
            fontWeight: '900',
            includeFontPadding: false,
            textAlign: 'center',
            textShadowColor: 'rgba(0, 0, 0, 0.5)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 2,
          }}
          numberOfLines={1}
        >
          {card.value}
        </RNText>
        {hasUnderline && <View style={[styles.digitUnderline, { backgroundColor: textColor }]} />}
      </View>
    );
  }

  if (card.type === 'skip') {
    return <Ionicons name="ban" size={fontSize} color={textColor} />;
  }

  if (card.type === 'reverse') {
    return <Ionicons name="sync" size={fontSize} color={textColor} />;
  }

  if (card.type === 'draw2') {
    return (
      <RNText style={[styles.cornerActionText, { color: textColor, fontSize: fontSize * 0.88 }]}>
        +2
      </RNText>
    );
  }

  if (card.type === 'wild') {
    return (
      <View style={styles.cornerWildRosette}>
        <View style={[styles.cornerMiniDot, { backgroundColor: '#EF4444' }]} />
        <View style={[styles.cornerMiniDot, { backgroundColor: '#2563EB' }]} />
        <View style={[styles.cornerMiniDot, { backgroundColor: '#10B981' }]} />
        <View style={[styles.cornerMiniDot, { backgroundColor: '#F59E0B' }]} />
      </View>
    );
  }

  if (card.type === 'wild4') {
    return (
      <RNText style={[styles.cornerActionText, { color: '#FDE047', fontSize: fontSize * 0.88 }]}>
        +4
      </RNText>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Clean English Center Content
// ---------------------------------------------------------------------------
function renderCenterContent(
  card: UnoCardType,
  textColor: string,
  fontSize: number,
  cardWidth: number
) {
  if (card.type === 'number') {
    const val = card.value ?? 0;
    const hasUnderline = val === 6 || val === 9;
    return (
      <View style={styles.centerNumberWrapper}>
        <RNText
          style={{
            color: textColor,
            fontSize,
            fontWeight: '900',
            includeFontPadding: false,
            textAlign: 'center',
            textAlignVertical: 'center',
            textShadowColor: 'rgba(0, 0, 0, 0.55)',
            textShadowOffset: { width: 0, height: 2 },
            textShadowRadius: 3,
          }}
          numberOfLines={1}
        >
          {val}
        </RNText>
        {hasUnderline && (
          <View style={[styles.centerUnderlineBar, { backgroundColor: textColor }]} />
        )}
      </View>
    );
  }

  if (card.type === 'skip') {
    const iconSize = Math.max(20, Math.round(cardWidth * 0.42));
    return (
      <View style={styles.centerActionBox}>
        <Ionicons name="ban" size={iconSize} color={textColor} />
      </View>
    );
  }

  if (card.type === 'reverse') {
    const iconSize = Math.max(20, Math.round(cardWidth * 0.42));
    return (
      <View style={styles.centerActionBox}>
        <Ionicons name="sync" size={iconSize} color={textColor} />
      </View>
    );
  }

  if (card.type === 'draw2') {
    return (
      <View style={styles.centerActionBox}>
        <RNText
          style={{
            color: textColor,
            fontSize: Math.max(18, Math.round(cardWidth * 0.38)),
            fontWeight: '900',
            includeFontPadding: false,
            textAlign: 'center',
            textShadowColor: 'rgba(0, 0, 0, 0.55)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 3,
          }}
        >
          +2
        </RNText>
      </View>
    );
  }

  if (card.type === 'wild') {
    const wheelSize = Math.max(24, Math.round(cardWidth * 0.46));
    return (
      <View
        style={[
          styles.wildQuadrantWheel,
          { width: wheelSize, height: wheelSize, borderRadius: wheelSize / 2 },
        ]}
      >
        <View style={styles.wildWheelRow}>
          <View style={[styles.wildSector, { backgroundColor: '#EF4444' }]} />
          <View style={[styles.wildSector, { backgroundColor: '#2563EB' }]} />
        </View>
        <View style={styles.wildWheelRow}>
          <View style={[styles.wildSector, { backgroundColor: '#10B981' }]} />
          <View style={[styles.wildSector, { backgroundColor: '#F59E0B' }]} />
        </View>
        <View style={styles.wildDhakaDiamond} />
        <View style={styles.wildCenterCore} />
      </View>
    );
  }

  if (card.type === 'wild4') {
    const wheelSize = Math.max(18, Math.round(cardWidth * 0.34));
    return (
      <View style={styles.centerActionBox}>
        <RNText
          style={{
            color: '#FDE047',
            fontSize: Math.max(16, Math.round(cardWidth * 0.33)),
            fontWeight: '900',
            includeFontPadding: false,
            textShadowColor: 'rgba(0, 0, 0, 0.7)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 3,
          }}
        >
          +4
        </RNText>
        <View
          style={[
            styles.wildQuadrantWheel,
            {
              width: wheelSize,
              height: wheelSize,
              borderRadius: wheelSize / 2,
              marginTop: 2,
            },
          ]}
        >
          <View style={styles.wildWheelRow}>
            <View style={[styles.wildSector, { backgroundColor: '#EF4444' }]} />
            <View style={[styles.wildSector, { backgroundColor: '#2563EB' }]} />
          </View>
          <View style={styles.wildWheelRow}>
            <View style={[styles.wildSector, { backgroundColor: '#10B981' }]} />
            <View style={[styles.wildSector, { backgroundColor: '#F59E0B' }]} />
          </View>
          <View style={styles.wildCenterCore} />
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  cardBase: {
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 6,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2.5,
  },
  cardPlayableHighlight: {
    borderColor: '#FDE047',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.95,
    shadowRadius: 12,
    elevation: 12,
    transform: [{ translateY: -9 }],
  },
  cardSelected: {
    borderColor: '#FFFFFF',
    borderWidth: 3,
    transform: [{ translateY: -12 }, { scale: 1.05 }],
  },
  carvedWoodCardBack: {
    backgroundColor: '#2B1308',
    borderColor: '#D4AF37',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carvedInnerSanctum: {
    width: '93%',
    height: '93%',
    borderWidth: 1.2,
    borderColor: '#B45309',
    backgroundColor: '#451A0A',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  latticeRowTop: {
    position: 'absolute',
    top: 4,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  latticeRowBottom: {
    position: 'absolute',
    bottom: 4,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  latticeDiamond: {
    width: 4,
    height: 4,
    backgroundColor: '#92400E',
    transform: [{ rotate: '45deg' }],
  },
  latticeDiamondGold: {
    width: 5,
    height: 5,
    backgroundColor: '#D4AF37',
    transform: [{ rotate: '45deg' }],
  },
  brassCornerStud: {
    position: 'absolute',
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    backgroundColor: '#D4AF37',
  },
  studTL: { top: 3, left: 3 },
  studTR: { top: 3, right: 3 },
  studBL: { bottom: 3, left: 3 },
  studBR: { bottom: 3, right: 3 },
  mandalaMedallion: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  mandalaSquareA: {
    position: 'absolute',
    width: '78%',
    height: '78%',
    borderWidth: 1.2,
    borderColor: '#D4AF37',
    backgroundColor: '#5B131A',
  },
  mandalaSquareB: {
    position: 'absolute',
    width: '78%',
    height: '78%',
    borderWidth: 1.2,
    borderColor: '#F59E0B',
    backgroundColor: '#6B141D',
    transform: [{ rotate: '45deg' }],
  },
  mandalaInnerCircle: {
    width: '68%',
    height: '68%',
    borderRadius: 999,
    backgroundColor: '#2B1308',
    borderWidth: 1.2,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mandalaCoreDot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FEF08A',
  },
  unoGoldPlaque: {
    position: 'absolute',
    bottom: 11,
    backgroundColor: '#2B1308',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  unoGoldPlaqueText: {
    color: '#FDE047',
    fontWeight: '900',
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
  faceCarvedFrame: {
    width: '94%',
    height: '94%',
    borderWidth: 1.2,
    justifyContent: 'space-between',
    padding: 3,
    position: 'relative',
  },
  inlayDiamondTR: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 5,
    height: 5,
    backgroundColor: 'rgba(254, 243, 199, 0.72)',
    transform: [{ rotate: '45deg' }],
  },
  inlayDiamondBL: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 5,
    height: 5,
    backgroundColor: 'rgba(254, 243, 199, 0.72)',
    transform: [{ rotate: '45deg' }],
  },
  cornerIndexTopLeft: {
    alignSelf: 'flex-start',
    minWidth: 14,
    minHeight: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  cornerIndexBottomRight: {
    alignSelf: 'flex-end',
    minWidth: 14,
    minHeight: 14,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '180deg' }],
    zIndex: 2,
  },
  cornerNumCol: {
    alignItems: 'center',
  },
  digitUnderline: {
    width: 8,
    height: 1.5,
    borderRadius: 1,
    marginTop: 0.5,
  },
  cornerActionText: {
    fontWeight: '900',
    includeFontPadding: false,
  },
  cornerWildRosette: {
    width: 11,
    height: 11,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,
  },
  cornerMiniDot: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
  },
  centerMandalaOval: {
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  watermarkLayer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerCarvedRing: {
    width: '88%',
    height: '88%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(254, 243, 199, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerCarvedWildRing: {
    borderColor: 'rgba(212, 175, 55, 0.85)',
  },
  centerNumberWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  centerUnderlineBar: {
    width: 14,
    height: 2,
    borderRadius: 1,
    marginTop: -1,
  },
  centerActionBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wildQuadrantWheel: {
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#FDE047',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wildWheelRow: {
    flexDirection: 'row',
    flex: 1,
    width: '100%',
  },
  wildSector: {
    flex: 1,
    height: '100%',
  },
  wildDhakaDiamond: {
    position: 'absolute',
    width: '56%',
    height: '56%',
    borderWidth: 1,
    borderColor: '#FDE047',
    transform: [{ rotate: '45deg' }],
  },
  wildCenterCore: {
    position: 'absolute',
    width: '30%',
    height: '30%',
    borderRadius: 999,
    backgroundColor: '#2B1308',
    borderWidth: 1,
    borderColor: '#FDE047',
  },
});
