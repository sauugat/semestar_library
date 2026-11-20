import AsyncStorage from '@react-native-async-storage/async-storage';
import { Monochrome } from '@/constants/theme';

export type DmThemeId =
  | 'default'
  | 'midnight-trails'
  | 'stormy-dusk'
  | 'neon-harbor'
  | 'cyber-sakura'
  | 'alpine-mist'
  | 'monochrome-peaks';

export interface DmChatTheme {
  id: DmThemeId;
  name: string;
  subtitle: string;
  previewColors: [string, string, string];
  backgroundImage: number | null;
  backgroundOverlay: string;
  selfBubbleBg: string;
  selfBubbleBorder: string;
  selfTextColor: string;
  selfMetaColor: string;
  peerBubbleBg: string;
  peerBubbleBorder: string;
  peerTextColor: string;
  peerMetaColor: string;
  sendButtonActiveBg: string;
  sendButtonActiveIcon: string;
}

const MIDNIGHT_TRAILS_BG = require('@/assets/images/chat-themes/midnight-trails.jpg');
const STORMY_DUSK_BG = require('@/assets/images/chat-themes/stormy-dusk.jpg');
const NEON_HARBOR_BG = require('@/assets/images/chat-themes/neon-harbor.jpg');
const CYBER_SAKURA_BG = require('@/assets/images/chat-themes/cyber-sakura.jpg');
const ALPINE_MIST_BG = require('@/assets/images/chat-themes/alpine-mist.jpg');
const MONOCHROME_PEAKS_BG = require('@/assets/images/chat-themes/monochrome-peaks.jpg');

export const DM_CHAT_THEMES: DmChatTheme[] = [
  {
    id: 'default',
    name: 'Default Dark',
    subtitle: 'Classic obsidian monochrome',
    previewColors: ['#0A0A0D', '#606064', '#18181B'],
    backgroundImage: null,
    backgroundOverlay: 'transparent',
    selfBubbleBg: '#606064',
    selfBubbleBorder: 'rgba(255, 255, 255, 0.10)',
    selfTextColor: Monochrome.outgoingText,
    selfMetaColor: Monochrome.outgoingMeta,
    peerBubbleBg: 'rgba(12, 12, 14, 0.94)',
    peerBubbleBorder: 'rgba(255, 255, 255, 0.08)',
    peerTextColor: Monochrome.incomingText,
    peerMetaColor: Monochrome.textTertiary,
    sendButtonActiveBg: '#FFFFFF',
    sendButtonActiveIcon: '#09090B',
  },
  {
    id: 'midnight-trails',
    name: 'Night Highway',
    subtitle: 'Crimson & charcoal over dusk trails',
    previewColors: ['#8C1628', '#2B2E35', '#C9A77C'],
    backgroundImage: MIDNIGHT_TRAILS_BG,
    backgroundOverlay: 'rgba(0, 0, 0, 0.20)',
    selfBubbleBg: '#8C1628',
    selfBubbleBorder: 'rgba(255, 195, 200, 0.18)',
    selfTextColor: '#FFFFFF',
    selfMetaColor: '#E3B6BC',
    peerBubbleBg: 'rgba(43, 46, 53, 0.94)',
    peerBubbleBorder: 'rgba(205, 173, 129, 0.62)',
    peerTextColor: '#F4F4F5',
    peerMetaColor: '#C8AD87',
    sendButtonActiveBg: '#9E1B30',
    sendButtonActiveIcon: '#FFFFFF',
  },
  {
    id: 'stormy-dusk',
    name: 'Stormy Dusk',
    subtitle: 'Crimson & steel slate over stormy lights',
    previewColors: ['#91192A', '#343A48', '#B0BACC'],
    backgroundImage: STORMY_DUSK_BG,
    backgroundOverlay: 'rgba(0, 0, 0, 0.22)',
    selfBubbleBg: '#91192A',
    selfBubbleBorder: 'rgba(255, 200, 206, 0.18)',
    selfTextColor: '#FFFFFF',
    selfMetaColor: '#E6B8BE',
    peerBubbleBg: 'rgba(52, 58, 72, 0.94)',
    peerBubbleBorder: 'rgba(176, 186, 204, 0.55)',
    peerTextColor: '#F4F4F5',
    peerMetaColor: '#B0B8C8',
    sendButtonActiveBg: '#9E1B30',
    sendButtonActiveIcon: '#FFFFFF',
  },
  {
    id: 'neon-harbor',
    name: 'Neon Harbor',
    subtitle: 'Crimson neon & deep teal reflections',
    previewColors: ['#B31D32', '#162226', '#3CD6A8'],
    backgroundImage: NEON_HARBOR_BG,
    backgroundOverlay: 'rgba(0, 0, 0, 0.28)',
    selfBubbleBg: '#B31D32',
    selfBubbleBorder: 'rgba(255, 130, 145, 0.28)',
    selfTextColor: '#FFFFFF',
    selfMetaColor: '#F5BCC4',
    peerBubbleBg: 'rgba(22, 34, 38, 0.94)',
    peerBubbleBorder: 'rgba(60, 214, 168, 0.52)',
    peerTextColor: '#F4F4F5',
    peerMetaColor: '#7EDAC0',
    sendButtonActiveBg: '#C42339',
    sendButtonActiveIcon: '#FFFFFF',
  },
  {
    id: 'cyber-sakura',
    name: 'Cyber Sakura',
    subtitle: 'Neon rose & midnight navy glow',
    previewColors: ['#A8245C', '#141822', '#5CB8F5'],
    backgroundImage: CYBER_SAKURA_BG,
    backgroundOverlay: 'rgba(0, 0, 0, 0.24)',
    selfBubbleBg: '#A8245C',
    selfBubbleBorder: 'rgba(244, 138, 184, 0.34)',
    selfTextColor: '#FFFFFF',
    selfMetaColor: '#F2B8D2',
    peerBubbleBg: 'rgba(20, 24, 34, 0.94)',
    peerBubbleBorder: 'rgba(92, 184, 245, 0.52)',
    peerTextColor: '#F4F4F5',
    peerMetaColor: '#98CCF2',
    sendButtonActiveBg: '#BA2A67',
    sendButtonActiveIcon: '#FFFFFF',
  },
  {
    id: 'alpine-mist',
    name: 'Alpine Mist',
    subtitle: 'Glacial pine-teal over snowy peaks',
    previewColors: ['#1F4B57', '#141D22', '#A2D0DA'],
    backgroundImage: ALPINE_MIST_BG,
    backgroundOverlay: 'rgba(0, 0, 0, 0.22)',
    selfBubbleBg: '#1F4B57',
    selfBubbleBorder: 'rgba(162, 208, 218, 0.32)',
    selfTextColor: '#FFFFFF',
    selfMetaColor: '#B5D7DF',
    peerBubbleBg: 'rgba(20, 29, 34, 0.94)',
    peerBubbleBorder: 'rgba(172, 192, 198, 0.45)',
    peerTextColor: '#F4F4F5',
    peerMetaColor: '#A8BFC6',
    sendButtonActiveBg: '#275E6D',
    sendButtonActiveIcon: '#FFFFFF',
  },
  {
    id: 'monochrome-peaks',
    name: 'Monochrome Peaks',
    subtitle: 'Graphite & silver over B&W ridge',
    previewColors: ['#2B2B2F', '#121214', '#DCDCE2'],
    backgroundImage: MONOCHROME_PEAKS_BG,
    backgroundOverlay: 'rgba(0, 0, 0, 0.34)',
    selfBubbleBg: '#34343A',
    selfBubbleBorder: 'rgba(255, 255, 255, 0.26)',
    selfTextColor: '#FFFFFF',
    selfMetaColor: '#D4D4D8',
    peerBubbleBg: 'rgba(18, 18, 20, 0.92)',
    peerBubbleBorder: 'rgba(220, 220, 226, 0.42)',
    peerTextColor: '#F4F4F5',
    peerMetaColor: '#B4B4BC',
    sendButtonActiveBg: '#FFFFFF',
    sendButtonActiveIcon: '#09090B',
  },
];

export const DM_CHAT_THEME_MAP: Record<DmThemeId, DmChatTheme> = DM_CHAT_THEMES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<DmThemeId, DmChatTheme>
);

const dmThemeMemoryCache = new Map<string, DmThemeId>();

function getThemeStorageKey(userId: string, conversationId: string): string {
  return `dm_chat_theme_v1:${userId || 'anon'}:${conversationId}`;
}

export function getDmThemeById(themeId?: string | null): DmChatTheme {
  if (themeId && themeId in DM_CHAT_THEME_MAP) {
    return DM_CHAT_THEME_MAP[themeId as DmThemeId];
  }
  return DM_CHAT_THEME_MAP.default;
}

export function getDmThemeSync(userId: string, conversationId: string): DmThemeId {
  const key = getThemeStorageKey(userId, conversationId);
  return dmThemeMemoryCache.get(key) || 'default';
}

export async function loadDmTheme(userId: string, conversationId: string): Promise<DmThemeId> {
  const key = getThemeStorageKey(userId, conversationId);
  const mem = dmThemeMemoryCache.get(key);
  if (mem) return mem;
  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored && stored in DM_CHAT_THEME_MAP) {
      const resolved = stored as DmThemeId;
      dmThemeMemoryCache.set(key, resolved);
      return resolved;
    }
  } catch {}
  return 'default';
}

export async function saveDmTheme(
  userId: string,
  conversationId: string,
  themeId: DmThemeId
): Promise<void> {
  const key = getThemeStorageKey(userId, conversationId);
  dmThemeMemoryCache.set(key, themeId);
  try {
    await AsyncStorage.setItem(key, themeId);
  } catch {}
}
