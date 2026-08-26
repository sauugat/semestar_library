async function doLogin() {
  const studentId = document.getElementById('studentId').value.trim();
  const password = document.getElementById('password').value;
  const errorMsg = document.getElementById('errorMsg');
  const loginBtn = document.getElementById('loginBtn');

  errorMsg.textContent = '';

  if (!studentId || !password) {
    errorMsg.textContent = 'Please enter your Student ID and password.';
    return;
  }

  // Show loading state
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<span>Signing in…</span>';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ studentId, password })
    });

    const data = await res.json();

    if (res.ok) {
      const urlParams = new URLSearchParams(window.location.search);
      const redirectParam = urlParams.get('redirect');
      window.location.href = redirectParam || data.redirect || '/dashboard.html';
    } else {
      errorMsg.textContent = data.message || 'Invalid Student ID or Password';
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
    }
  } catch (err) {
    errorMsg.textContent = 'Connection error. Please check your internet and try again.';
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<span>Sign In</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      doLogin();
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener('click', (e) => {
      // Prevent double-fire if button is inside form
      if (loginBtn.type === 'submit') return;
      e.preventDefault();
      doLogin();
    });
  }
});
