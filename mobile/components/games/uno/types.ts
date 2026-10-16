export type UnoColor = 'rato' | 'nilo' | 'hariyo' | 'pahelo' | 'wild';

export type UnoCardType = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface UnoCard {
  id: string;
  color: UnoColor;
  type: UnoCardType;
  value?: number; // 0 - 9 for number cards
  nepaliDigit?: string;
  nepaliLabel: string;
  englishLabel: string;
  scoreValue: number;
}

export interface UnoPlayer {
  id: string;
  name: string;
  nepaliName: string;
  isBot: boolean;
  avatarIcon: string;
  cards: UnoCard[];
  hasCalledUno: boolean;
  unoCallWindowExpiresAt?: number;
  lastReaction?: string;
}

export type UnoGameMode = 'bots' | 'pass_and_play';

export type UnoDirection = 'clockwise' | 'counter_clockwise';

export interface UnoGameState {
  gameId: string;
  mode: UnoGameMode;
  players: UnoPlayer[];
  currentPlayerIndex: number;
  direction: UnoDirection;
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  activeColor: UnoColor;
  status: 'playing' | 'waiting_color_choice' | 'game_over';
  winner: UnoPlayer | null;
  pendingColorChoiceCard: UnoCard | null;
  lastActionMessage: string;
  lastActionNepaliMessage: string;
  consecutiveDrawCount: number;
  soundEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UnoColorMeta {
  color: UnoColor;
  nameEn: string;
  culturalTitle: string;
  nameNp: string;
  symbolNp: string;
  bgHex: string;
  borderHex: string;
  glowHex: string;
  textHex: string;
  meaningEn: string;
}

export const COLOR_METAS: Record<UnoColor, UnoColorMeta> = {
  rato: {
    color: 'rato',
    nameEn: 'Red',
    culturalTitle: 'Crimson Red',
    nameNp: 'रातो',
    symbolNp: 'लालीगुराँस',
    bgHex: '#EF4444',
    borderHex: '#B91C1C',
    glowHex: 'rgba(239, 68, 68, 0.45)',
    textHex: '#FFFFFF',
    meaningEn: 'Red Suit',
  },
  nilo: {
    color: 'nilo',
    nameEn: 'Blue',
    culturalTitle: 'Sky Blue',
    nameNp: 'नीलो',
    symbolNp: 'हिमाल',
    bgHex: '#2563EB',
    borderHex: '#1D4ED8',
    glowHex: 'rgba(37, 99, 235, 0.45)',
    textHex: '#FFFFFF',
    meaningEn: 'Blue Suit',
  },
  hariyo: {
    color: 'hariyo',
    nameEn: 'Green',
    culturalTitle: 'Emerald Green',
    nameNp: 'हरियो',
    symbolNp: 'तराई वन',
    bgHex: '#10B981',
    borderHex: '#047857',
    glowHex: 'rgba(16, 185, 129, 0.45)',
    textHex: '#FFFFFF',
    meaningEn: 'Green Suit',
  },
  pahelo: {
    color: 'pahelo',
    nameEn: 'Yellow',
    culturalTitle: 'Golden Yellow',
    nameNp: 'पहेँलो',
    symbolNp: 'सयपत्री',
    bgHex: '#F59E0B',
    borderHex: '#B45309',
    glowHex: 'rgba(245, 158, 11, 0.45)',
    textHex: '#FFFFFF',
    meaningEn: 'Yellow Suit',
  },
  wild: {
    color: 'wild',
    nameEn: 'Wild',
    culturalTitle: 'Multi-Color Wild',
    nameNp: 'इन्द्रेणी',
    symbolNp: 'ढाका टोपी',
    bgHex: '#7C3AED',
    borderHex: '#4C1D95',
    glowHex: 'rgba(124, 58, 237, 0.45)',
    textHex: '#FFFFFF',
    meaningEn: 'Wild Card',
  },
};

export const NEPALI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
export const NEPALI_DIGIT_NAMES = ['शून्य', 'एक', 'दुई', 'तीन', 'चार', 'पाँच', 'छ', 'सात', 'आठ', 'नौ'];
