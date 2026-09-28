// ============================================================
// Semester Library — Global In-App Authentication Modal
// Provides unified authentication popup across all web pages
// ============================================================

window.showAuthModal = function (requireAuth = false) {
  let existingModal = document.getElementById('globalAuthModal');
  if (existingModal) {
    existingModal.classList.add('open');
    const idInput = document.getElementById('modalIdentifier') || document.getElementById('modalEmail');
    if (idInput) idInput.focus();
    return;
  }

  const modalHtml = `
    <div id="globalAuthModal" class="auth-modal-overlay" onclick="if(event.target===this) closeAuthModal();">
      <div class="apple-signin-card" style="position:relative;">
        ${requireAuth ? '' : `
        <button type="button" class="auth-modal-close-btn" onclick="closeAuthModal()" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        `}

        <div class="apple-emblem-halo">
          <div class="apple-emblem-ring"></div>
          <img src="631824E0-DFD0-462B-95E4-FEBD92499478-removebg-preview.png" alt="Semester Library" class="apple-emblem-img">
        </div>

        <h1 class="apple-signin-headline">Sign In to Continue</h1>
        <p class="apple-signin-subtext">Access study notes, exam routines, syllabus materials, and discussions.</p>

        <!-- Rich Alert Banner inside modal -->
        <div id="modalAuthAlert" class="auth-banner" style="display: none; margin-bottom: 12px;" role="alert">
          <div class="auth-banner-icon" id="modalAuthAlertIcon"></div>
          <div class="auth-banner-content">
            <div class="auth-banner-title" id="modalAuthAlertTitle"></div>
            <div class="auth-banner-msg" id="modalAuthAlertMsg"></div>
            <div class="auth-banner-actions" id="modalAuthAlertActions" style="display: none;"></div>
          </div>
        </div>

        <form id="modalLoginForm" class="apple-signin-form" onsubmit="event.preventDefault(); doModalLogin();">
          <div class="apple-input-group">
            <div class="apple-input-row">
              <label for="modalIdentifier" class="apple-input-label">Username or Email</label>
              <input type="text" id="modalIdentifier" name="identifier" class="apple-text-field" placeholder="Username or email address" autocomplete="username" required>
            </div>
            <div class="apple-input-row">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <label for="modalPassword" class="apple-input-label" style="margin-bottom: 0;">Password</label>
                <a href="/login.html" class="apple-text-link" style="font-size: 11px;">Forgot password?</a>
              </div>
              <div class="apple-password-field-wrap">
                <input type="password" id="modalPassword" name="password" class="apple-text-field" placeholder="Enter your password" autocomplete="current-password" required>
                <button type="button" class="apple-password-toggle" id="modalPasswordToggle" aria-label="Toggle password visibility">
                  <svg class="eye-open-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <svg class="eye-closed-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="display:none;">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                </button>
              </div>
            </div>
          </div>
          
          <div class="apple-signin-controls" style="margin: 12px 2px 14px;">
            <label class="apple-remember-wrap" for="modalRememberMe">
              <input type="checkbox" id="modalRememberMe" class="apple-real-checkbox">
              <span class="apple-custom-check"></span>
              <span class="apple-remember-text" style="font-size: 13px;">Remember username</span>
            </label>
          </div>

          <button type="submit" class="apple-primary-btn" id="modalLoginBtn">
            <span>Sign In</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>

          <p id="modalErrorMsg" class="error-msg" style="display: none;"></p>

          <div style="text-align: center; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border-color, rgba(255,255,255,0.08));">
            <span style="font-size: 13px; color: var(--text-secondary, #86868b);">Don't have an account? </span>
            <a href="/register.html" class="apple-text-link" style="font-size: 13px; font-weight: 600;">Create Account</a>
          </div>
        </form>

        <div class="apple-security-callout" style="margin-top: 20px;">
          <div class="security-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <p>Protected with industry-standard cryptographic sessions &amp; Supabase Auth.</p>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Restore remembered Username or Email
  try {
    const saved = localStorage.getItem('rememberedIdentifier') || localStorage.getItem('rememberedEmail') || localStorage.getItem('rememberedStudentId');
    if (saved) {
      const input = document.getElementById('modalIdentifier');
      const remCheck = document.getElementById('modalRememberMe');
      if (input) input.value = saved;
      if (remCheck) remCheck.checked = true;
    }
  } catch (err) { }

  // Wire password toggle
  const toggleBtn = document.getElementById('modalPasswordToggle');
  if (toggleBtn) {
    toggleBtn.onclick = function (e) {
      e.preventDefault();
      const input = document.getElementById('modalPassword');
      if (!input) return;
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      const openIcon = toggleBtn.querySelector('.eye-open-icon');
      const closedIcon = toggleBtn.querySelector('.eye-closed-icon');
      if (openIcon && closedIcon) {
        openIcon.style.display = isPass ? 'none' : 'block';
        closedIcon.style.display = isPass ? 'block' : 'none';
      }
    };
  }

  // Focus
  setTimeout(() => {
    const modal = document.getElementById('globalAuthModal');
    if (modal) {
      modal.classList.add('open');
      const input = document.getElementById('modalIdentifier');
      const passInput = document.getElementById('modalPassword');
      if (input && !input.value) input.focus();
      else if (passInput) passInput.focus();
    }
  }, 10);
};

window.closeAuthModal = function () {
  const modal = document.getElementById('globalAuthModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 350);
  }
};

window.doModalLogin = async function (e) {
  if (e) e.preventDefault();

  const idInput = document.getElementById('modalIdentifier');
  const passInput = document.getElementById('modalPassword');
  const loginBtn = document.getElementById('modalLoginBtn');
  const rememberCheckbox = document.getElementById('modalRememberMe');
  const banner = document.getElementById('modalAuthAlert');
  const bannerTitle = document.getElementById('modalAuthAlertTitle');
  const bannerMsg = document.getElementById('modalAuthAlertMsg');
  const bannerIcon = document.getElementById('modalAuthAlertIcon');
  const bannerActions = document.getElementById('modalAuthAlertActions');
  const legacyErrorMsg = document.getElementById('modalErrorMsg');

  function showModalAlert(message, type = 'error', title = null, actionsHtml = null) {
    if (legacyErrorMsg) legacyErrorMsg.textContent = message;
    if (!banner) return;
    banner.className = 'auth-banner ' + type;
    if (bannerTitle) {
      bannerTitle.textContent = title || (type === 'error' ? 'Sign In Error' : 'Notice');
      bannerTitle.style.display = 'block';
    }
    if (bannerMsg) bannerMsg.textContent = message;
    if (bannerIcon) {
      if (type === 'error') {
        bannerIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      } else {
        bannerIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l2.5 2.5L16 9"/></svg>`;
      }
    }
    if (bannerActions) {
      if (actionsHtml) {
        bannerActions.innerHTML = actionsHtml;
        bannerActions.style.display = 'block';
      } else {
        bannerActions.innerHTML = '';
        bannerActions.style.display = 'none';
      }
    }
    banner.style.display = 'flex';
  }

  function hideModalAlert() {
    if (banner) banner.style.display = 'none';
    if (legacyErrorMsg) legacyErrorMsg.textContent = '';
  }

  if (!idInput || !passInput) return;

  const identifier = idInput.value.trim();
  const password = passInput.value;

  hideModalAlert();

  if (!identifier || !password) {
    showModalAlert('Please enter your username/email and password.', 'error');
    return;
  }

  // Handle Remember Me
  try {
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem('rememberedIdentifier', identifier);
    } else {
      localStorage.removeItem('rememberedIdentifier');
    }
  } catch (err) { }

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="app-spinner spinner-sm spinner-light" style="margin-right:8px; display:inline-block; vertical-align:middle;"></span><span>Signing in…</span>';
  }

  try {
    if (typeof SemesterAuth === 'undefined' || typeof SemesterAuth.signIn !== 'function') {
      throw new Error('Authentication service is initializing. Please retry in a moment.');
    }

    const { data, error } = await SemesterAuth.signIn(identifier, password);

    if (error) {
      let friendlyMsg = error.message || 'Invalid username/email or password.';
      const msg = (error.message || '').toLowerCase();

      if (error.code === 'EMAIL_NOT_CONFIRMED' || msg.includes('email not confirmed')) {
        friendlyMsg = 'Your email address has not been verified yet. Please check your inbox.';
        showModalAlert(friendlyMsg, 'warning', 'Email Verification Required', `
          <button type="button" class="auth-banner-btn" onclick="SemesterAuth.resendVerification('${identifier.replace(/'/g, "\\'")}').then(() => alert('Verification email resent! Check your inbox.'));">
            Resend email verification
          </button>
        `);
      } else if (msg.includes('too many requests')) {
        showModalAlert('Too many failed login attempts. Please wait a few moments.', 'error', 'Rate Limited');
      } else {
        showModalAlert('Invalid username/email or password.', 'error');
      }

      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      }
      return;
    }

    if (data && data.session) {
      if (loginBtn) {
        loginBtn.innerHTML = '<span>Signing in…</span>';
      }
      setTimeout(() => {
        window.closeAuthModal();
        window.location.reload();
      }, 350);
    }
  } catch (err) {
    showModalAlert(err.message || 'Connection error. Please try again.', 'error');
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
  }
};

// Automatically sync profile chip across all pages
function syncHeaderProfile() {
  const profileChip = document.querySelector('.dash-profile-chip');
  if (!profileChip) return;
  const fetchFn = typeof window.authFetch === 'function' ? window.authFetch : fetch;
  fetchFn('/api/profile')
    .then(res => res.ok ? res.json() : null)
    .then(p => {
      if (p) {
        const headerAvatar = document.getElementById('headerAvatar');
        const headerName = document.getElementById('headerProfileName');
        if (headerName) headerName.textContent = p.name ? p.name.split(' ')[0] : 'Profile';
        if (headerAvatar) {
          if (p.avatarUrl) {
            headerAvatar.innerHTML = `<img src="${p.avatarUrl}" alt="${p.name}">`;
          } else {
            headerAvatar.textContent = p.name ? p.name.charAt(0).toUpperCase() : 'S';
          }
        }
      } else {
        profileChip.outerHTML = `<a href="/login.html" class="nav-cta-btn apple-nav-btn">Sign In</a>`;
      }
    })
    .catch(() => {
      profileChip.outerHTML = `<a href="/login.html" class="nav-cta-btn apple-nav-btn">Sign In</a>`;
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncHeaderProfile);
} else {
  syncHeaderProfile();
}
