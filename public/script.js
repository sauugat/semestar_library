window.doLogin = async function (e) {
  if (e) {
    e.preventDefault();
  }

  const emailInput = document.getElementById('email') || document.getElementById('studentId');
  const passwordInput = document.getElementById('password');
  const errorMsg = document.getElementById('errorMsg');
  const loginBtn = document.getElementById('loginBtn');
  const rememberCheckbox = document.getElementById('rememberMe');

  if (!emailInput || !passwordInput) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (errorMsg) errorMsg.textContent = '';

  if (!email || !password) {
    if (errorMsg) errorMsg.textContent = 'Please enter your email and password.';
    return;
  }

  // Handle Remember Me (stores remembered email)
  try {
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem('rememberedEmail', email);
    } else {
      localStorage.removeItem('rememberedEmail');
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

    const { data, error } = await SemesterAuth.signIn(email, password);

    if (error) {
      let friendlyMsg = 'Invalid email or password.';
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
        friendlyMsg = 'Invalid email or password.';
      } else if (msg.includes('email not confirmed')) {
        friendlyMsg = 'Please verify your email address before signing in.';
      } else if (msg.includes('too many requests')) {
        friendlyMsg = 'Too many failed login attempts. Please wait a few moments.';
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

function initLoginHandlers() {
  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email') || document.getElementById('studentId');
  const rememberCheckbox = document.getElementById('rememberMe');

  try {
    const savedEmail = localStorage.getItem('rememberedEmail') || localStorage.getItem('rememberedStudentId');
    if (savedEmail && emailInput) {
      emailInput.value = savedEmail;
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
