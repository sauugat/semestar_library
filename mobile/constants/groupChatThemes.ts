export type GroupCodeKey = 'MERCURY' | 'VENUS' | 'EARTH' | 'MARS';

export interface GroupChatTheme {
  groupCode: GroupCodeKey | 'DEFAULT';
  name: string;
  subtitle: string;
  backgroundImage: number | null;
  backgroundOverlay: string;
  selfBubbleBg: string;
  selfTextColor: string;
  selfMetaColor: string;
  peerBubbleBg: string;
  peerTextColor: string;
  peerMetaColor: string;
  senderNameColor: string;
  sendButtonActiveBg: string;
  sendButtonActiveIcon: string;
  accentColor: string;
}

export const DEFAULT_GROUP_CHAT_THEME: GroupChatTheme = {
  groupCode: 'DEFAULT',
  name: 'Default',
  subtitle: 'Clean dark monochrome',
  backgroundImage: null,
  backgroundOverlay: 'transparent',
  selfBubbleBg: '#606064',
  selfTextColor: '#FFFFFF',
  selfMetaColor: 'rgba(255, 255, 255, 0.72)',
  peerBubbleBg: 'rgba(20, 20, 24, 0.90)',
  peerTextColor: '#FFFFFF',
  peerMetaColor: 'rgba(228, 228, 231, 0.62)',
  senderNameColor: '#A1A1AA',
  sendButtonActiveBg: '#F5F5F5',
  sendButtonActiveIcon: '#111111',
  accentColor: '#E4E4E7',
};

export const GROUP_CHAT_THEMES: Record<GroupCodeKey, GroupChatTheme> = {
  MERCURY: {
    groupCode: 'MERCURY',
    name: 'Mercury',
    subtitle: 'Bronze crater crescent & cyan mineral glow',
    backgroundImage: require('@/assets/images/chat-themes/mercury.jpg'),
    backgroundOverlay: 'rgba(4, 4, 6, 0.16)',
    selfBubbleBg: '#9E683B',
    selfTextColor: '#FFFFFF',
    selfMetaColor: 'rgba(255, 255, 255, 0.74)',
    peerBubbleBg: 'rgba(20, 22, 26, 0.88)',
    peerTextColor: '#F4F4F5',
    peerMetaColor: 'rgba(228, 228, 231, 0.62)',
    senderNameColor: '#7DD3D8',
    sendButtonActiveBg: '#C98E5B',
    sendButtonActiveIcon: '#120B05',
    accentColor: '#7DD3D8',
  },
  VENUS: {
    groupCode: 'VENUS',
    name: 'Venus',
    subtitle: 'Glowing terracotta horizon & warm umber space',
    backgroundImage: require('@/assets/images/chat-themes/venus.jpg'),
    backgroundOverlay: 'rgba(10, 5, 3, 0.18)',
    selfBubbleBg: '#A84D24',
    selfTextColor: '#FFFFFF',
    selfMetaColor: 'rgba(255, 255, 255, 0.75)',
    peerBubbleBg: 'rgba(26, 17, 13, 0.88)',
    peerTextColor: '#FAF5F0',
    peerMetaColor: 'rgba(250, 245, 240, 0.62)',
    senderNameColor: '#F4A97A',
    sendButtonActiveBg: '#E07A48',
    sendButtonActiveIcon: '#1A0A04',
    accentColor: '#F4A97A',
  },
  EARTH: {
    groupCode: 'EARTH',
    name: 'Earth',
    subtitle: 'Orbital sapphire ocean & golden sunflare',
    backgroundImage: require('@/assets/images/chat-themes/earth.jpg'),
    backgroundOverlay: 'rgba(4, 10, 18, 0.28)',
    selfBubbleBg: '#176496',
    selfTextColor: '#FFFFFF',
    selfMetaColor: 'rgba(255, 255, 255, 0.76)',
    peerBubbleBg: 'rgba(13, 22, 30, 0.90)',
    peerTextColor: '#F0F9FF',
    peerMetaColor: 'rgba(224, 242, 254, 0.65)',
    senderNameColor: '#FACC6B',
    sendButtonActiveBg: '#38BDF8',
    sendButtonActiveIcon: '#061826',
    accentColor: '#38BDF8',
  },
  MARS: {
    groupCode: 'MARS',
    name: 'Mars',
    subtitle: 'Crimson iron-oxide dunes & starry night sky',
    backgroundImage: require('@/assets/images/chat-themes/mars.jpg'),
    backgroundOverlay: 'rgba(12, 6, 4, 0.24)',
    selfBubbleBg: '#B53F20',
    selfTextColor: '#FFFFFF',
    selfMetaColor: 'rgba(255, 255, 255, 0.75)',
    peerBubbleBg: 'rgba(24, 15, 13, 0.90)',
    peerTextColor: '#FFF7F5',
    peerMetaColor: 'rgba(255, 247, 245, 0.64)',
    senderNameColor: '#F8A57B',
    sendButtonActiveBg: '#E86A42',
    sendButtonActiveIcon: '#1A0804',
    accentColor: '#F8A57B',
  },
};

export function getGroupChatTheme(groupCodeOrTitle?: string | null): GroupChatTheme {
  if (!groupCodeOrTitle) return DEFAULT_GROUP_CHAT_THEME;
  const normalized = String(groupCodeOrTitle).trim().toUpperCase();
  if (normalized in GROUP_CHAT_THEMES) {
    return GROUP_CHAT_THEMES[normalized as GroupCodeKey];
  }
  if (normalized.includes('MERCURY')) return GROUP_CHAT_THEMES.MERCURY;
  if (normalized.includes('VENUS')) return GROUP_CHAT_THEMES.VENUS;
  if (normalized.includes('EARTH')) return GROUP_CHAT_THEMES.EARTH;
  if (normalized.includes('MARS')) return GROUP_CHAT_THEMES.MARS;
  return DEFAULT_GROUP_CHAT_THEME;
}
