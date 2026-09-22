/**
 * Semester Library — Universal Dark/Light Theme Controller
 *
 * Features:
 * - Persistent theme preference saved in localStorage ('theme' -> 'light' | 'dark')
 * - System preference fallback (prefers-color-scheme: dark) on first visit
 * - Dual attribute/class application:
 *     document.documentElement.setAttribute('data-theme', theme)
 *     document.documentElement.classList.toggle('dark', isDark)
 *     document.body.classList.toggle('dark-mode', isDark)
 * - Dynamic <meta name="theme-color"> updates for mobile browser chrome
 * - Animated Sun/Moon toggle button automatically injected or wired to existing markup
 * - Cross-tab synchronization via storage event
 * - System preference change listener
 */

(function () {
  'use strict';

  const THEME_KEY = 'theme';

  function getSystemPreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function getStoredTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (e) {}
    return null;
  }

  function resolveTheme() {
    return getStoredTheme() || 'dark';
  }

  function updateThemeColorMeta(isDark) {
    const color = isDark ? '#0d1117' : '#fafafc';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', color);
  }

  function updateToggleButtons(isDark) {
    const buttons = document.querySelectorAll('.theme-toggle-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('is-dark', isDark);
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('title', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
      btn.setAttribute('aria-label', isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    });
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    const root = document.documentElement;

    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', isDark);

    if (document.body) {
      document.body.classList.toggle('dark-mode', isDark);
      document.body.classList.toggle('theme-dark', isDark);
    }

    updateThemeColorMeta(isDark);
    updateToggleButtons(isDark);

    // Dispatch a custom event so other components (e.g., charts, editors) can respond
    try {
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme, isDark } }));
    } catch (e) {}
  }

  function setTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
    applyTheme(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || resolveTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }

  function createToggleMarkup() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle-btn';
    btn.id = 'themeToggleBtn';
    btn.setAttribute('aria-label', 'Toggle theme');
    btn.setAttribute('title', 'Toggle theme');
    btn.innerHTML = `
      <span class="theme-toggle-track">
        <svg class="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
        <svg class="theme-icon-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </span>
    `;
    btn.addEventListener('click', toggleTheme);
    return btn;
  }

  function mountToggleButtons() {
    // 1. Bind any buttons statically placed in the HTML
    const existing = document.querySelectorAll('.theme-toggle-btn');
    existing.forEach((b) => {
      if (!b._themeBound) {
        b.addEventListener('click', toggleTheme);
        b._themeBound = true;
      }
    });

    // 2. If no toggle button exists yet, dynamically insert near "Sign In" or profile chip
    if (existing.length === 0) {
      // In Apple navbar (index.html, login.html, etc.)
      const navRight = document.querySelector('.apple-nav .nav-right, .lib-nav .nav-right');
      if (navRight && !navRight.querySelector('.theme-toggle-btn')) {
        const signInBtn = navRight.querySelector('a[href*="login"], .nav-cta-btn, .apple-nav-btn');
        const btn = createToggleMarkup();
        if (signInBtn) {
          navRight.insertBefore(btn, signInBtn);
        } else {
          navRight.appendChild(btn);
        }
      }

      // In Dashboard / Assignment header actions (dash-header-actions)
      const dashActions = document.querySelector('.dash-header-actions');
      if (dashActions && !dashActions.querySelector('.theme-toggle-btn')) {
        const profileChip = dashActions.querySelector('.dash-profile-chip, a[href*="profile"], #headerProfileName');
        const btn = createToggleMarkup();
        btn.classList.add('dash-theme-btn');
        if (profileChip) {
          dashActions.insertBefore(btn, profileChip);
        } else {
          dashActions.appendChild(btn);
        }
      }
    }

    const isDark = (document.documentElement.getAttribute('data-theme') || resolveTheme()) === 'dark';
    updateToggleButtons(isDark);
  }

  // Initial immediate application
  const activeTheme = resolveTheme();
  applyTheme(activeTheme);

  // When DOM is ready, apply to body and mount buttons
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyTheme(resolveTheme());
      mountToggleButtons();
    });
  } else {
    applyTheme(resolveTheme());
    mountToggleButtons();
  }

  // Listen to OS system preference changes (only if user hasn't explicitly set localStorage)
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (e) => {
      if (!getStoredTheme()) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleSystemChange);
    }
  }

  // Multi-tab synchronization
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY && (e.newValue === 'dark' || e.newValue === 'light')) {
      applyTheme(e.newValue);
    }
  });

  // Global public API
  window.SemesterTheme = {
    get: () => document.documentElement.getAttribute('data-theme') || resolveTheme(),
    isDark: () => (document.documentElement.getAttribute('data-theme') || resolveTheme()) === 'dark',
    set: setTheme,
    toggle: toggleTheme
  };
})();
