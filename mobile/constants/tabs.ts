export interface TabConfig {
  name: string;
  label: string;
  iconOutline: string;
  iconFilled: string;
}

// Strictly five tabs in ordered sequence with Chat in center (index 2)
export const STUDENT_TAB_CONFIGS: TabConfig[] = [
  {
    name: 'index',
    label: 'Home',
    iconOutline: 'home-outline',
    iconFilled: 'home',
  },
  {
    name: 'library',
    label: 'Library',
    iconOutline: 'book-outline',
    iconFilled: 'book',
  },
  {
    name: 'chat',
    label: 'Chat',
    iconOutline: 'chatbubble-outline',
    iconFilled: 'chatbubble',
  },
  {
    name: 'games',
    label: 'Games',
    iconOutline: 'game-controller-outline',
    iconFilled: 'game-controller',
  },
  {
    name: 'profile',
    label: 'Profile',
    iconOutline: 'person-outline',
    iconFilled: 'person',
  },
];

export const TEACHER_TAB_CONFIGS: TabConfig[] = [
  {
    name: 'index',
    label: 'Dashboard',
    iconOutline: 'grid-outline',
    iconFilled: 'grid',
  },
  {
    name: 'library',
    label: 'My Materials',
    iconOutline: 'folder-outline',
    iconFilled: 'folder',
  },
  {
    name: 'chat',
    label: 'Chat',
    iconOutline: 'chatbubble-outline',
    iconFilled: 'chatbubble',
  },
  {
    name: 'games',
    label: 'Notices',
    iconOutline: 'megaphone-outline',
    iconFilled: 'megaphone',
  },
  {
    name: 'profile',
    label: 'Profile',
    iconOutline: 'person-outline',
    iconFilled: 'person',
  },
];

export const ADMIN_TAB_CONFIGS: TabConfig[] = [
  {
    name: 'index',
    label: 'Dashboard',
    iconOutline: 'grid-outline',
    iconFilled: 'grid',
  },
  {
    name: 'library',
    label: 'Users',
    iconOutline: 'people-outline',
    iconFilled: 'people',
  },
  {
    name: 'chat',
    label: 'Academics',
    iconOutline: 'school-outline',
    iconFilled: 'school',
  },
  {
    name: 'games',
    label: 'Content',
    iconOutline: 'shield-checkmark-outline',
    iconFilled: 'shield-checkmark',
  },
  {
    name: 'profile',
    label: 'Profile',
    iconOutline: 'person-outline',
    iconFilled: 'person',
  },
];

// Preserved for backwards compatibility with tests and layout math
export const TAB_CONFIGS: TabConfig[] = STUDENT_TAB_CONFIGS;
