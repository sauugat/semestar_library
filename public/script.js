// ============================================================
// Semester Library — Login UI Script
// ============================================================

window.doLogin = async function (e) {
  if (e) {
    e.preventDefault();
  }

  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const passwordInput = document.getElementById('password');
  const errorMsg = document.getElementById('errorMsg');
  const loginBtn = document.getElementById('loginBtn');
  const rememberCheckbox = document.getElementById('rememberMe');
  const resendContainer = document.getElementById('resendContainer');

  if (!identifierInput || !passwordInput) return;

  const identifier = identifierInput.value.trim();
  const password = passwordInput.value;

  if (errorMsg) errorMsg.textContent = '';
  if (resendContainer) resendContainer.style.display = 'none';

  if (!identifier || !password) {
    if (errorMsg) errorMsg.textContent = 'Please enter your username/email and password.';
    return;
  }

  // Handle Remember Me (stores remembered identifier)
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
    loginBtn.innerHTML = '<span class="app-spinner spinner-sm spinner-light" style="margin-right:8px; display:inline-block; vertical-align:middle;"></span><span>Signing in…</span>';
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
        if (resendContainer) resendContainer.style.display = 'block';
      } else if (msg.includes('too many requests')) {
        friendlyMsg = 'Too many failed login attempts. Please wait a few moments.';
      } else {
        friendlyMsg = 'Invalid username/email or password.';
      }

      if (errorMsg) errorMsg.textContent = friendlyMsg;
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      }
      return;
    }

    if (data && data.session) {
      if (loginBtn) {
        loginBtn.innerHTML = '<span>Success!</span>';
        loginBtn.style.background = '#22c55e';
      }

      const urlParams = new URLSearchParams(window.location.search);
      const redirectParam = urlParams.get('redirect');
      setTimeout(() => {
        window.location.href = redirectParam || '/dashboard.html';
      }, 300);
    }
  } catch (err) {
    if (errorMsg) errorMsg.textContent = err.message || 'Connection error. Please check your internet and try again.';
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
  }
};

window.handleForgotPassword = async function (e) {
  if (e) e.preventDefault();
  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const currentVal = identifierInput ? identifierInput.value.trim() : '';

  const inputVal = prompt('Enter your registered email address or username to receive a password reset link:', currentVal);
  if (!inputVal || !inputVal.trim()) return;

  const errorMsg = document.getElementById('errorMsg');
  if (errorMsg) {
    errorMsg.style.color = '#0071e3';
    errorMsg.textContent = 'Sending password reset link...';
  }

  try {
    const { data } = await SemesterAuth.forgotPassword(inputVal.trim());
    if (errorMsg) {
      errorMsg.style.color = '#22c55e';
      errorMsg.textContent = (data && data.message) || 'If an account exists, a password reset link has been sent.';
    }
  } catch (err) {
    if (errorMsg) {
      errorMsg.style.color = '#ff3b30';
      errorMsg.textContent = 'Failed to submit password reset request. Please try again.';
    }
  }
};

window.handleResendVerification = async function (e) {
  if (e) e.preventDefault();
  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const identifier = identifierInput ? identifierInput.value.trim() : '';

  if (!identifier) {
    alert('Please enter your username or email in the login box first.');
    return;
  }

  const resendBtn = document.getElementById('resendBtn');
  if (resendBtn) resendBtn.textContent = 'Sending verification link...';

  try {
    const { data } = await SemesterAuth.resendVerification(identifier);
    alert((data && data.message) || 'If an unverified account exists, a new verification link has been sent to your email.');
  } catch {
    alert('Failed to send verification link. Please try again.');
  } finally {
    if (resendBtn) resendBtn.textContent = 'Resend email verification link';
  }
};

function initLoginHandlers() {
  const form = document.getElementById('loginForm');
  const identifierInput = document.getElementById('identifier') || document.getElementById('email') || document.getElementById('studentId');
  const rememberCheckbox = document.getElementById('rememberMe');
  const errorMsg = document.getElementById('errorMsg');

  // Check if redirected after confirming email (?verified=true)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('verified') === 'true' && errorMsg) {
    errorMsg.style.color = '#22c55e';
    errorMsg.textContent = '✔ Email verified successfully! You can now sign in.';
  }

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
