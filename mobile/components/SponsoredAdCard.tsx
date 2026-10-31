import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Caption } from '@/components/ui/Typography';
import { Avatar } from '@/components/ui/Avatar';
import {
  Advertisement,
  isSafeAdDestinationUrl,
  recordAdImpression,
  recordAdClick,
} from '@/services/advertisements';

export interface SponsoredAdCardProps {
  advertisement: Advertisement;
  getFullImageUrl: (url?: string | null) => string | null;
  sessionKey?: string;
}

function getHostnameLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

export function SponsoredAdCard({
  advertisement,
  getFullImageUrl,
  sessionKey,
}: SponsoredAdCardProps) {
  const { colors, spacing, radii } = useTheme();
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [expanded, setExpanded] = useState<boolean>(false);

  const advertiserName = advertisement.advertiser_name || advertisement.advertiserName || 'Sponsored Partner';
  const logoRaw = advertisement.advertiser_logo_url || advertisement.advertiserLogoUrl || null;
  const logoUrl = getFullImageUrl(logoRaw) || logoRaw;
  const mediaRaw = advertisement.media_url || advertisement.mediaUrl || '';
  const mediaUrl = getFullImageUrl(mediaRaw) || mediaRaw;
  const mediaType = advertisement.media_type || advertisement.mediaType || 'image';
  const primaryText = (advertisement.primary_text || advertisement.primaryText || '').trim();
  const headline = (advertisement.headline || '').trim();
  const description = (advertisement.description || '').trim();
  const ctaLabel = (advertisement.cta_label || advertisement.ctaLabel || 'Learn More').trim();
  const destinationUrl = (advertisement.destination_url || advertisement.destinationUrl || '').trim();
  const domainLabel = getHostnameLabel(destinationUrl);

  // Deduplicated impression recording when card is mounted in feed
  useEffect(() => {
    if (advertisement?.id) {
      void recordAdImpression(advertisement.id, sessionKey);
    }
  }, [advertisement?.id, sessionKey]);

  const handleOpenDestination = async () => {
    if (!isSafeAdDestinationUrl(destinationUrl)) {
      Alert.alert('Invalid Link', 'This advertisement does not have a valid destination link.');
      return;
    }
    void recordAdClick(advertisement.id, sessionKey);
    try {
      await Linking.openURL(destinationUrl);
    } catch {
      Alert.alert('Unable to Open Link', 'Could not open the destination URL.');
    }
  };

  const shouldTruncate = primaryText.length > 220 && !expanded;
  const displayPrimaryText = shouldTruncate ? `${primaryText.slice(0, 220).trim()}…` : primaryText;

  return (
    <View
      style={[
        styles.cardContainer,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
      testID={`sponsored-ad-card-${advertisement.id}`}
    >
      {/* Advertiser Identity Header */}
      <View style={styles.headerRow}>
        <View style={styles.advertiserIdentity}>
          <Avatar url={logoUrl} name={advertiserName} size="md" />
          <View style={{ flex: 1, marginLeft: spacing.compact }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text variant="sm" weight="700" numberOfLines={1} style={{ color: colors.text }}>
                {advertiserName}
              </Text>
            </View>
            <View style={styles.sponsoredMetaRow}>
              <View
                style={[
                  styles.sponsoredPill,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="globe-outline"
                  size={10}
                  color={colors.textSecondary}
                  style={{ marginRight: 3 }}
                />
                <Text
                  variant="xs"
                  weight="700"
                  style={{
                    color: colors.textSecondary,
                    fontSize: 10,
                    letterSpacing: 0.3,
                  }}
                >
                  Sponsored
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Primary Advertisement Copy */}
      {Boolean(primaryText) && (
        <View style={{ marginTop: spacing.sm }}>
          <Text
            variant="sm"
            style={{
              color: colors.text,
              lineHeight: 20,
              fontSize: 14,
            }}
          >
            {displayPrimaryText}
          </Text>
          {primaryText.length > 220 && (
            <TouchableOpacity
              onPress={() => setExpanded(!expanded)}
              activeOpacity={0.7}
              style={{ marginTop: 4 }}
            >
              <Caption weight="600" style={{ color: colors.textSecondary }}>
                {expanded ? 'Show less' : 'See more'}
              </Caption>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Creative Media + CTA Footer Strip */}
      <View
        style={[
          styles.creativeWrapper,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            marginTop: 10,
          },
        ]}
      >
        {Boolean(mediaUrl) && (
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={handleOpenDestination}
            accessibilityRole="link"
            accessibilityLabel={`Open sponsored link from ${advertiserName}`}
          >
            <View
              style={[
                styles.mediaFrame,
                {
                  aspectRatio,
                  backgroundColor: colors.surfaceRaised,
                },
              ]}
            >
              <Image
                source={{ uri: mediaUrl }}
                style={styles.mediaImage}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
                onLoad={(e) => {
                  const { width, height } = e.source;
                  if (width > 0 && height > 0) {
                    const ratio = width / height;
                    setAspectRatio(Math.min(Math.max(ratio, 0.8), 1.91));
                  }
                }}
              />
              {mediaType === 'video' && (
                <View style={styles.videoBadge}>
                  <Ionicons name="play-circle" size={18} color="#FFFFFF" />
                  <Text variant="xs" weight="700" style={{ color: '#FFFFFF', marginLeft: 4, fontSize: 10 }}>
                    VIDEO
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}

        {/* Bottom Call-To-Action Strip (Headline, Description, Domain & CTA Button) */}
        <View
          style={[
            styles.ctaFooterBar,
            {
              backgroundColor: colors.surfaceRaised,
              borderTopColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleOpenDestination}
            style={{ flex: 1, marginRight: 12 }}
          >
            {Boolean(domainLabel) && (
              <Caption
                style={{
                  color: colors.textMuted,
                  fontSize: 10.5,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  marginBottom: 2,
                }}
                numberOfLines={1}
              >
                {domainLabel}
              </Caption>
            )}
            <Text
              variant="sm"
              weight="700"
              numberOfLines={1}
              style={{ color: colors.text, fontSize: 14 }}
            >
              {headline || advertiserName}
            </Text>
            {Boolean(description) && (
              <Caption
                style={{ color: colors.textSecondary, marginTop: 2, fontSize: 12 }}
                numberOfLines={2}
              >
                {description}
              </Caption>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleOpenDestination}
            style={[
              styles.ctaButton,
              {
                backgroundColor: colors.text,
                borderRadius: radii.sm,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            testID={`sponsored-ad-cta-${advertisement.id}`}
          >
            <Text
              variant="xs"
              weight="700"
              style={{
                color: colors.background,
                fontSize: 12.5,
              }}
            >
              {ctaLabel}
            </Text>
            <Ionicons
              name="open-outline"
              size={13}
              color={colors.background}
              style={{ marginLeft: 5 }}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  advertiserIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sponsoredMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  sponsoredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  creativeWrapper: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  mediaFrame: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ctaFooterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
