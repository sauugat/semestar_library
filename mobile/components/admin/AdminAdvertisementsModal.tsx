import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import {
  Advertisement,
  getManagedAdvertisements,
  createAdvertisement,
  updateAdvertisement,
  setAdvertisementStatus,
  deleteAdvertisement,
} from '@/services/advertisements';
import { getAutoDetectedServerUrl, DEFAULT_SERVER_URL } from '@/services/api';

interface AdminAdvertisementsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AdminAdvertisementsModal({ visible, onClose }: AdminAdvertisementsModalProps) {
  const { colors, radii, spacing } = useTheme();
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    totalImpressions: 0,
    totalClicks: 0,
    overallCtr: 0,
  });
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<Advertisement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [advertiserName, setAdvertiserName] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Learn More');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [adStatus, setAdStatus] = useState<'active' | 'inactive' | 'paused'>('active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creativeAsset, setCreativeAsset] = useState<any | null>(null);
  const [logoAsset, setLogoAsset] = useState<any | null>(null);

  const resolveMediaUrl = (rawUrl?: string | null) => {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('file://')) {
      return rawUrl;
    }
    const host = (getAutoDetectedServerUrl() || DEFAULT_SERVER_URL).replace(/\/+$/, '');
    return `${host}/${rawUrl.replace(/^\/+/, '')}`;
  };

  const loadAds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getManagedAdvertisements({
        status: statusFilter !== 'all' ? statusFilter : undefined,
      });
      setAds(res.advertisements || []);
      if (res.summary) setSummary(res.summary);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not load advertisements.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (visible) {
      void loadAds();
    }
  }, [visible, loadAds]);

  const openCreateForm = () => {
    setEditingAd(null);
    setAdvertiserName('');
    setPrimaryText('');
    setHeadline('');
    setDescription('');
    setCtaLabel('Learn More');
    setDestinationUrl('');
    setAdStatus('active');
    setStartDate('');
    setEndDate('');
    setCreativeAsset(null);
    setLogoAsset(null);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEditForm = (ad: Advertisement) => {
    setEditingAd(ad);
    setAdvertiserName(ad.advertiser_name || '');
    setPrimaryText(ad.primary_text || '');
    setHeadline(ad.headline || '');
    setDescription(ad.description || '');
    setCtaLabel(ad.cta_label || 'Learn More');
    setDestinationUrl(ad.destination_url || '');
    setAdStatus((ad.status as any) || (ad.is_active ? 'active' : 'inactive'));
    setStartDate(ad.start_date ? String(ad.start_date).slice(0, 10) : '');
    setEndDate(ad.end_date ? String(ad.end_date).slice(0, 10) : '');
    setCreativeAsset(null);
    setLogoAsset(null);
    setFormError(null);
    setEditorOpen(true);
  };

  const handlePickCreative = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      setCreativeAsset({
        uri: a.uri,
        name: a.fileName || `creative_${Date.now()}.${a.type === 'video' ? 'mp4' : 'jpg'}`,
        type: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      });
    }
  };

  const handlePickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      setLogoAsset({
        uri: a.uri,
        name: a.fileName || `logo_${Date.now()}.jpg`,
        type: a.mimeType || 'image/jpeg',
      });
    }
  };

  const handleSaveAd = async () => {
    if (!advertiserName.trim()) {
      setFormError('Advertiser / brand name is required.');
      return;
    }
    if (!primaryText.trim()) {
      setFormError('Primary advertisement text is required.');
      return;
    }
    if (!editingAd && !creativeAsset) {
      setFormError('Please select an image or video creative.');
      return;
    }
    if (!destinationUrl.trim()) {
      setFormError('Destination URL is required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      if (editingAd) {
        await updateAdvertisement(editingAd.id, {
          advertiser_name: advertiserName.trim(),
          primary_text: primaryText.trim(),
          headline: headline.trim() || null,
          description: description.trim() || null,
          cta_label: ctaLabel.trim() || 'Learn More',
          destination_url: destinationUrl.trim(),
          status: adStatus,
          is_active: adStatus === 'active',
          start_date: startDate.trim() || null,
          end_date: endDate.trim() || null,
          creativeFile: creativeAsset,
          logoFile: logoAsset,
        });
      } else {
        await createAdvertisement({
          advertiser_name: advertiserName.trim(),
          primary_text: primaryText.trim(),
          headline: headline.trim() || null,
          description: description.trim() || null,
          cta_label: ctaLabel.trim() || 'Learn More',
          destination_url: destinationUrl.trim(),
          status: adStatus,
          is_active: adStatus === 'active',
          start_date: startDate.trim() || null,
          end_date: endDate.trim() || null,
          creativeFile: creativeAsset,
          logoFile: logoAsset,
        });
      }
      setEditorOpen(false);
      await loadAds();
    } catch (err: any) {
      setFormError(err.message || 'Could not save advertisement.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (ad: Advertisement) => {
    const nextStatus = ad.is_active === 1 && ad.status === 'active' ? 'paused' : 'active';
    try {
      await setAdvertisementStatus(ad.id, nextStatus);
      await loadAds();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update status.');
    }
  };

  const handleDelete = (ad: Advertisement) => {
    Alert.alert(
      'Delete Advertisement',
      `Delete sponsored campaign for "${ad.advertiser_name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAdvertisement(ad.id);
              await loadAds();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not delete advertisement.');
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Heading level={3} style={{ color: colors.text }}>
              {editorOpen ? (editingAd ? 'Edit Advertisement' : 'New Advertisement') : 'Advertisements'}
            </Heading>
            <Caption style={{ color: colors.textSecondary }}>
              In-Feed Sponsored Campaigns & Analytics
            </Caption>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {!editorOpen && (
              <TouchableOpacity
                onPress={openCreateForm}
                style={[styles.primaryBtn, { backgroundColor: colors.text, borderRadius: radii.sm }]}
              >
                <Ionicons name="add" size={16} color={colors.background} />
                <Text variant="xs" weight="700" style={{ color: colors.background, marginLeft: 4 }}>
                  New Ad
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => (editorOpen ? setEditorOpen(false) : onClose())}
              style={[styles.closeBtn, { borderColor: colors.border, borderRadius: radii.sm }]}
            >
              <Text variant="xs" weight="600" style={{ color: colors.text }}>
                {editorOpen ? 'Back' : 'Close'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {editorOpen ? (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}>
            {formError && (
              <View style={[styles.errorBox, { borderColor: '#EF4444', borderRadius: radii.sm }]}>
                <Text variant="xs" style={{ color: '#EF4444' }}>{formError}</Text>
              </View>
            )}

            <Caption style={styles.label}>ADVERTISER / BRAND NAME *</Caption>
            <TextInput
              value={advertiserName}
              onChangeText={setAdvertiserName}
              placeholder="e.g. GitHub Education"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            />

            <Caption style={styles.label}>PRIMARY ADVERTISEMENT TEXT *</Caption>
            <TextInput
              value={primaryText}
              onChangeText={setPrimaryText}
              placeholder="Write the main sponsored message..."
              placeholderTextColor={colors.textMuted}
              multiline
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, minHeight: 90, textAlignVertical: 'top' }]}
            />

            <Caption style={styles.label}>HEADLINE (OPTIONAL)</Caption>
            <TextInput
              value={headline}
              onChangeText={setHeadline}
              placeholder="Short bold callout headline"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            />

            <Caption style={styles.label}>DESCRIPTION (OPTIONAL)</Caption>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Supporting subtitle below headline"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Caption style={styles.label}>CTA BUTTON LABEL *</Caption>
                <TextInput
                  value={ctaLabel}
                  onChangeText={setCtaLabel}
                  placeholder="Learn More"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Caption style={styles.label}>STATUS</Caption>
                <TouchableOpacity
                  onPress={() => setAdStatus(adStatus === 'active' ? 'paused' : 'active')}
                  style={[styles.input, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, justifyContent: 'center' }]}
                >
                  <Text variant="xs" weight="700" style={{ color: colors.text }}>
                    {adStatus === 'active' ? 'ACTIVE (PUBLISHED)' : 'PAUSED / INACTIVE'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <Caption style={styles.label}>DESTINATION URL (HTTPS://) *</Caption>
            <TextInput
              value={destinationUrl}
              onChangeText={setDestinationUrl}
              placeholder="https://example.com"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="url"
              style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Caption style={styles.label}>START DATE (YYYY-MM-DD)</Caption>
                <TextInput
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="Optional"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Caption style={styles.label}>END DATE (YYYY-MM-DD)</Caption>
                <TextInput
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="Optional"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                onPress={handlePickCreative}
                style={[styles.mediaBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, flex: 1 }]}
              >
                <Ionicons name="image-outline" size={18} color={colors.text} />
                <Text variant="xs" weight="600" style={{ color: colors.text, marginLeft: 6 }}>
                  {creativeAsset ? 'Change Creative' : (editingAd ? 'Replace Creative' : 'Select Creative *')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handlePickLogo}
                style={[styles.mediaBtn, { borderColor: colors.border, backgroundColor: colors.surfaceRaised, flex: 1 }]}
              >
                <Ionicons name="person-circle-outline" size={18} color={colors.text} />
                <Text variant="xs" weight="600" style={{ color: colors.text, marginLeft: 6 }}>
                  {logoAsset ? 'Logo Selected' : 'Brand Logo'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleSaveAd}
              disabled={submitting}
              style={[
                styles.saveBtn,
                { backgroundColor: colors.text, borderRadius: radii.md, opacity: submitting ? 0.6 : 1 },
              ]}
            >
              <Text variant="sm" weight="700" style={{ color: colors.background }}>
                {submitting ? 'Saving…' : editingAd ? 'Update Advertisement' : 'Publish Advertisement'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}>
            {/* Summary Metrics */}
            <View style={styles.metricsRow}>
              <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Caption color="muted">Active Ads</Caption>
                <Text weight="800" style={{ fontSize: 18, color: colors.text }}>{summary.active} / {summary.total}</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Caption color="muted">Impressions</Caption>
                <Text weight="800" style={{ fontSize: 18, color: colors.text }}>{summary.totalImpressions}</Text>
              </View>
              <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Caption color="muted">CTA Clicks</Caption>
                <Text weight="800" style={{ fontSize: 18, color: colors.text }}>{summary.totalClicks}</Text>
              </View>
            </View>

            {/* Filter Pills */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {(['all', 'active', 'inactive'] as const).map((st) => (
                <TouchableOpacity
                  key={st}
                  onPress={() => setStatusFilter(st)}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: statusFilter === st ? colors.text : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{ color: statusFilter === st ? colors.background : colors.textSecondary, textTransform: 'capitalize' }}
                  >
                    {st}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {loading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator color={colors.text} />
              </View>
            ) : ads.length === 0 ? (
              <View style={[styles.emptyCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text variant="sm" weight="600" style={{ color: colors.text }}>No advertisements found</Text>
                <Caption color="muted" style={{ marginTop: 4 }}>
                  Create your first sponsored post to appear in student and website feeds.
                </Caption>
              </View>
            ) : (
              ads.map((ad) => {
                const isActive = ad.is_active === 1 && ad.status === 'active';
                const previewUri = resolveMediaUrl(ad.media_url);
                return (
                  <View
                    key={ad.id}
                    style={[styles.adRowCard, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text variant="sm" weight="700" style={{ color: colors.text }}>{ad.advertiser_name}</Text>
                        <Caption color="muted">
                          Created {ad.created_at ? new Date(ad.created_at).toLocaleDateString() : 'recently'}
                        </Caption>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor: isActive ? colors.surfaceRaised : colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text variant="xs" weight="700" style={{ color: isActive ? colors.text : colors.textMuted, fontSize: 10 }}>
                          {isActive ? 'ACTIVE' : String(ad.status || 'PAUSED').toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <Text variant="xs" color="secondary" numberOfLines={2} style={{ marginTop: 6 }}>
                      {ad.primary_text}
                    </Text>

                    {Boolean(previewUri) && (
                      <Image
                        source={{ uri: previewUri! }}
                        style={{ width: '100%', height: 110, borderRadius: 6, marginTop: 8, backgroundColor: colors.surfaceRaised }}
                        contentFit="cover"
                      />
                    )}

                    <View style={styles.statsStrip}>
                      <Caption color="secondary">Impressions: {ad.impression_count ?? 0}</Caption>
                      <Caption color="secondary">CTA Clicks: {ad.click_count ?? 0}</Caption>
                      <Caption color="secondary">CTA: {ad.cta_label}</Caption>
                    </View>

                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        onPress={() => openEditForm(ad)}
                        style={[styles.actionBtn, { borderColor: colors.border }]}
                      >
                        <Text variant="xs" weight="600" style={{ color: colors.text }}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleToggleStatus(ad)}
                        style={[styles.actionBtn, { borderColor: colors.border }]}
                      >
                        <Text variant="xs" weight="600" style={{ color: colors.text }}>
                          {isActive ? 'Pause' : 'Activate'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(ad)}
                        style={[styles.actionBtn, { borderColor: colors.border }]}
                      >
                        <Text variant="xs" weight="600" style={{ color: '#EF4444' }}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  mediaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 8,
  },
  saveBtn: {
    marginTop: 22,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  metricCard: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  emptyCard: {
    padding: 24,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  adRowCard: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  statsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
  },
});
