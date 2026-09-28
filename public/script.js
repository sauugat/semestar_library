// ============================================================
// Semester Library — Minimalist Auth UI Script
// Handles Login, Password Toggles, Reset Modal, & Alert Banners
// ============================================================

// ─── Universal Alert Banner Helper ───
window.showAuthBanner = function (message, type = 'error', options = {}) {
  const banner = document.getElementById('authAlert');
  const bannerTitle = document.getElementById('authAlertTitle');
  const bannerMsg = document.getElementById('authAlertMsg');
  const bannerActions = document.getElementById('authAlertActions');
  const legacyErrorMsg = document.getElementById('errorMsg');

  // Maintain backward-compatibility for test suites
  if (legacyErrorMsg) {
    legacyErrorMsg.textContent = message;
    legacyErrorMsg.style.display = 'none';
  }

  if (!banner || !bannerMsg) return;

  banner.className = 'auth-banner ' + type;
  bannerMsg.textContent = message;

  if (bannerTitle) {
    bannerTitle.textContent = options.title || (type === 'error' ? 'Unable to sign in' : type === 'success' ? 'Success' : 'Notice');
    bannerTitle.style.display = options.title !== '' ? 'block' : 'none';
  }

  if (bannerActions) {
    if (options.actionsHtml) {
      bannerActions.innerHTML = options.actionsHtml;
      bannerActions.style.display = 'block';
    } else {
      bannerActions.innerHTML = '';
      bannerActions.style.display = 'none';
    }
  }

  banner.style.display = 'flex';
};

window.hideAuthAlert = function () {
  const banner = document.getElementById('authAlert');
  if (banner) banner.style.display = 'none';
  const legacyErrorMsg = document.getElementById('errorMsg');
  if (legacyErrorMsg) legacyErrorMsg.textContent = '';
};

// ─── Floating Toast Notification System ───
window.showAuthToast = function (message, type = 'info', duration = 3600) {
  let container = document.getElementById('authToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'authToastContainer';
    container.className = 'auth-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `auth-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-fadeout');
    setTimeout(() => toast.remove(), 260);
  }, duration);
};

// ─── Login Logic ───
window.doLogin = async function (e) {
  if (e) {
    e.preventDefault();
  }

  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const rememberCheckbox = document.getElementById('rememberMe');
  const consentCheckbox = document.getElementById('acceptTerms');

  if (!identifierInput || !passwordInput) return;

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;

  window.hideAuthAlert();

  if (!identifier || !password) {
    window.showAuthBanner('Please enter your username or email and password.', 'error', {
      title: 'Missing Credentials'
    });
    return;
  }

  if (consentCheckbox && !consentCheckbox.checked) {
    window.showAuthBanner('Please accept the Privacy Policy and Terms & Conditions before signing in.', 'warning', {
      title: 'Consent Required'
    });
    consentCheckbox.focus();
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

  // Show loading state
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span>Signing in…</span>';
  }

  try {
    if (typeof SemesterAuth === 'undefined' || typeof SemesterAuth.signIn !== 'function') {
      throw new Error('Authentication service is initializing. Please wait a moment.');
    }

    const { data, error } = await SemesterAuth.signIn(identifier, password);

    if (error) {
      let friendlyMsg = error.message || 'Invalid username/email or password.';
      const msg = (error.message || '').toLowerCase();

      if (error.code === 'EMAIL_NOT_CONFIRMED' || msg.includes('email not confirmed') || msg.includes('not confirmed')) {
        friendlyMsg = 'Your email address has not been verified yet. Please check your inbox or spam folder.';
        window.showAuthBanner(friendlyMsg, 'warning', {
          title: 'Email Verification Required',
          actionsHtml: `<button type="button" class="auth-banner-btn" onclick="handleResendVerification(event, '${identifier.replace(/'/g, "\\'")}')">Resend verification email</button>`
        });
      } else if (msg.includes('too many requests')) {
        friendlyMsg = 'Too many failed login attempts. Please wait a few moments before trying again.';
        window.showAuthBanner(friendlyMsg, 'error', { title: 'Account Temporarily Rate Limited' });
      } else {
        friendlyMsg = 'Invalid username/email or password.';
        window.showAuthBanner(friendlyMsg, 'error', { title: 'Incorrect Credentials' });
      }

      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span>Sign In</span>';
      }
      return;
    }

    if (data && data.session) {
      if (loginBtn) {
        loginBtn.innerHTML = '<span>Signing in…</span>';
      }
      window.showAuthToast('Signed in successfully! Redirecting…', 'success', 2000);

      const urlParams = new URLSearchParams(window.location.search);
      const redirectParam = urlParams.get('redirect');
      setTimeout(() => {
        window.location.href = redirectParam || '/dashboard.html';
      }, 350);
    }
  } catch (err) {
    window.showAuthBanner(err.message || 'Connection error. Please check your internet connection.', 'error', {
      title: 'Connection Error'
    });
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span>Sign In</span>';
    }
  }
};

// ─── In-App Forgot Password Modal Handlers ───
let lastFocusedTrigger = null;

window.openForgotPasswordModal = function (e) {
  if (e) {
    e.preventDefault();
    lastFocusedTrigger = e.currentTarget || document.getElementById('forgotPasswordLink');
  }
  const modal = document.getElementById('forgotPasswordModal');
  if (!modal) return;

  // Move modal to body to prevent any ancestor clipping/transform bugs
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const fpInput = document.getElementById('fpIdentifier');
  const alertBox = document.getElementById('fpAlert');
  if (alertBox) alertBox.style.display = 'none';

  if (fpInput && identifierInput && identifierInput.value.trim()) {
    fpInput.value = identifierInput.value.trim();
  }

  modal.classList.add('open');
  if (fpInput) setTimeout(() => fpInput.focus(), 60);
};

window.closeForgotPasswordModal = function () {
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) modal.classList.remove('open');
  if (lastFocusedTrigger && typeof lastFocusedTrigger.focus === 'function') {
    try { lastFocusedTrigger.focus(); } catch (_) {}
  }
};

window.submitForgotPassword = async function (e) {
  if (e) e.preventDefault();
  const input = document.getElementById('fpIdentifier');
  const submitBtn = document.getElementById('fpSubmitBtn');
  const alertBox = document.getElementById('fpAlert');
  if (!input) return;

  const value = input.value.trim();
  if (!value) {
    if (alertBox) {
      alertBox.className = 'auth-banner error';
      alertBox.innerHTML = '<div class="auth-banner-msg">Please enter your username or email address.</div>';
      alertBox.style.display = 'flex';
    }
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Sending…</span>';
  }

  try {
    const { data } = await SemesterAuth.forgotPassword(value);
    if (alertBox) {
      alertBox.className = 'auth-banner success';
      alertBox.innerHTML = `<div class="auth-banner-msg">${(data && data.message) || 'If an account exists, a password reset link has been dispatched.'}</div>`;
      alertBox.style.display = 'flex';
    }
    window.showAuthToast('Password recovery email dispatched.', 'success');
    setTimeout(() => {
      window.closeForgotPasswordModal();
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Send Reset Link</span>';
      }
    }, 2200);
  } catch (err) {
    if (alertBox) {
      alertBox.className = 'auth-banner error';
      alertBox.innerHTML = '<div class="auth-banner-msg">Failed to request password reset. Please try again.</div>';
      alertBox.style.display = 'flex';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Send Reset Link</span>';
    }
  }
};

// ─── Resend Verification Action ───
window.handleResendVerification = async function (e, targetIdentifier = null) {
  if (e) e.preventDefault();
  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const identifier = targetIdentifier || (identifierInput ? identifierInput.value.trim() : '');

  if (!identifier) {
    window.showAuthBanner('Please enter your username or email in the input box first.', 'warning', {
      title: 'Email or Username Required'
    });
    if (identifierInput) identifierInput.focus();
    return;
  }

  const resendBtn = document.getElementById('resendBtn');
  if (resendBtn) {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending link…';
  }

  try {
    const { data } = await SemesterAuth.resendVerification(identifier);
    const msg = (data && data.message) || 'If an unverified account exists, a new verification link has been sent to your email.';
    window.showAuthToast(msg, 'success', 4000);
    window.showAuthBanner(msg, 'success', {
      title: 'Verification Link Dispatched'
    });
  } catch {
    window.showAuthToast('Failed to send verification link. Please check your connection.', 'error');
  } finally {
    if (resendBtn) {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend email verification link';
    }
  }
};

// ─── Initialize Password Toggles ───
function initPasswordToggles() {
  document.querySelectorAll('.password-toggle, .apple-password-toggle').forEach(btn => {
    btn.onclick = function (e) {
      e.preventDefault();
      const wrap = btn.closest('.field-password-wrap, .apple-password-field-wrap');
      if (!wrap) return;
      const input = wrap.querySelector('input');
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      const openIcon = btn.querySelector('.eye-open-icon');
      const closedIcon = btn.querySelector('.eye-closed-icon');
      if (openIcon && closedIcon) {
        openIcon.style.display = isPassword ? 'none' : 'block';
        closedIcon.style.display = isPassword ? 'block' : 'none';
      }
    };
  });
}

// ─── Initialize Page Handlers ───
function initLoginHandlers() {
  const form = document.getElementById('loginForm');
  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const rememberCheckbox = document.getElementById('rememberMe');
  const fpModal = document.getElementById('forgotPasswordModal');

  // Ensure modal is direct child of body immediately on load
  if (fpModal && fpModal.parentElement !== document.body) {
    document.body.appendChild(fpModal);
  }

  // Click outside modal-box to close
  if (fpModal) {
    fpModal.addEventListener('click', (e) => {
      if (e.target === fpModal) {
        window.closeForgotPasswordModal();
      }
    });
  }

  initPasswordToggles();

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.closeForgotPasswordModal();
    }
  });

  // Check if redirected after confirming email (?verified=true)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('verified') === 'true') {
    window.showAuthBanner('Email verified successfully! You can now sign in to your Semester Library account.', 'success', {
      title: 'Email Verified'
    });
  }

  // Restore remembered username/email
  try {
    const saved = localStorage.getItem('rememberedIdentifier') || localStorage.getItem('rememberedEmail') || localStorage.getItem('rememberedStudentId');
    if (saved && identifierInput) {
      identifierInput.value = saved;
      if (rememberCheckbox) rememberCheckbox.checked = true;
    }
  } catch (err) { }

  if (form) {
    form.onsubmit = function (e) {
      e.preventDefault();
      window.doLogin(e);
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLoginHandlers);
} else {
  initLoginHandlers();
}
