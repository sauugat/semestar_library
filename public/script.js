window.doLogin = async function (e) {
  if (e) {
    e.preventDefault();
  }

  const studentIdInput = document.getElementById('studentId');
  const passwordInput = document.getElementById('password');
  const errorMsg = document.getElementById('errorMsg');
  const loginBtn = document.getElementById('loginBtn');
  const rememberCheckbox = document.getElementById('rememberMe');

  if (!studentIdInput || !passwordInput) return;

  const studentId = studentIdInput.value.trim();
  const password = passwordInput.value;

  if (errorMsg) errorMsg.textContent = '';

  if (!studentId || !password) {
    if (errorMsg) errorMsg.textContent = 'Please enter your Student ID and password.';
    return;
  }

  // Handle Remember Me
  try {
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem('rememberedStudentId', studentId);
    } else {
      localStorage.removeItem('rememberedStudentId');
    }
  } catch (err) { }

  // Show loading state
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span>Signing in…</span>';
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ studentId, password })
    });

    const data = await res.json();

    if (res.ok) {
      if (loginBtn) {
        loginBtn.innerHTML = '<span>Success!</span>';
        loginBtn.style.background = '#22c55e';
      }
      const urlParams = new URLSearchParams(window.location.search);
      const redirectParam = urlParams.get('redirect');
      setTimeout(() => {
        window.location.href = redirectParam || data.redirect || '/dashboard.html';
      }, 300);
    } else {
      if (errorMsg) errorMsg.textContent = data.message || 'Invalid Student ID or Password';
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      }
    }
  } catch (err) {
    if (errorMsg) errorMsg.textContent = 'Connection error. Please check your internet and try again.';
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
  }
};

function initLoginHandlers() {
  const form = document.getElementById('loginForm');
  const studentIdInput = document.getElementById('studentId');
  const rememberCheckbox = document.getElementById('rememberMe');

  try {
    const savedId = localStorage.getItem('rememberedStudentId');
    if (savedId && studentIdInput) {
      studentIdInput.value = savedId;
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
