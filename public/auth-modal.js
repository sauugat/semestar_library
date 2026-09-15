window.showAuthModal = function (requireAuth = false) {
  let existingModal = document.getElementById('globalAuthModal');
  if (existingModal) {
    existingModal.classList.add('open');
    const idInput = document.getElementById('modalStudentId');
    if (idInput) idInput.focus();
    return;
  }

  const modalHtml = `
    <div id="globalAuthModal" class="auth-modal-overlay" onclick="if(event.target===this) closeAuthModal();">
      <div class="apple-signin-card" style="position:relative;">
        ${requireAuth ? '' : `
        <button type="button" class="auth-modal-close-btn" onclick="closeAuthModal()" title="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        `}

        <div class="apple-emblem-halo">
          <div class="apple-emblem-ring"></div>
          <img src="631824E0-DFD0-462B-95E4-FEBD92499478-removebg-preview.png" alt="Semester Library" class="apple-emblem-img">
        </div>

        <h1 class="apple-signin-headline">Sign in with your Student ID</h1>
        <p class="apple-signin-subtext">Access your notices, exam routines, study notes, and syllabus materials.</p>

        <form id="modalLoginForm" class="apple-signin-form" onsubmit="event.preventDefault(); doModalLogin();">
          <div class="apple-input-group">
            <div class="apple-input-row">
              <label for="modalStudentId" class="apple-input-label">Student ID</label>
              <input type="text" id="modalStudentId" name="studentId" class="apple-text-field" placeholder="e.g. GU2026001" autocomplete="username" required>
            </div>
            <div class="apple-input-row">
              <label for="modalPassword" class="apple-input-label">Password</label>
              <input type="password" id="modalPassword" name="password" class="apple-text-field" placeholder="Enter your password" autocomplete="current-password" required>
            </div>
          </div>
          
          <div class="apple-signin-controls" style="margin-top:16px;">
            <label class="apple-remember-wrap" for="modalRememberMe">
              <input type="checkbox" id="modalRememberMe" class="apple-real-checkbox">
              <span class="apple-custom-check"></span>
              <span class="apple-remember-text">Remember Student ID</span>
            </label>
          </div>

          <button type="submit" class="apple-primary-btn" id="modalLoginBtn" onclick="doModalLogin(event)">
            <span>Sign In</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="apple-btn-arrow">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>

          <p id="modalErrorMsg" class="error-msg"></p>
        </form>

        <div class="apple-security-callout">
          <div class="security-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <p>Your Student ID and library session are encrypted and authenticated directly with Gandaki University.</p>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);

  // Restore remembered Student ID
  try {
    const savedId = localStorage.getItem('rememberedStudentId');
    if (savedId) {
      const idInput = document.getElementById('modalStudentId');
      const remCheck = document.getElementById('modalRememberMe');
      if (idInput) idInput.value = savedId;
      if (remCheck) remCheck.checked = true;
    }
  } catch (err) { }

  // Small delay to allow CSS transition to kick in
  setTimeout(() => {
    const modal = document.getElementById('globalAuthModal');
    if (modal) {
      modal.classList.add('open');
      const idInput = document.getElementById('modalStudentId');
      const passInput = document.getElementById('modalPassword');
      if (idInput && !idInput.value) idInput.focus();
      else if (passInput) passInput.focus();
    }
  }, 10);
};

window.closeAuthModal = function () {
  const modal = document.getElementById('globalAuthModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 400);
  }
};

window.doModalLogin = async function (e) {
  if (e) e.preventDefault();

  const idInput = document.getElementById('modalStudentId');
  const passInput = document.getElementById('modalPassword');
  const errorMsg = document.getElementById('modalErrorMsg');
  const loginBtn = document.getElementById('modalLoginBtn');
  const rememberCheckbox = document.getElementById('modalRememberMe');

  if (!idInput || !passInput) return;

  const studentId = idInput.value.trim();
  const password = passInput.value;

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
      setTimeout(() => {
        window.closeAuthModal();
        window.location.reload();
      }, 400);
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
