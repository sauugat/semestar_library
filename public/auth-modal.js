function showAuthModal(requireAuth = false) {
  if (document.getElementById('globalAuthModal')) {
    document.getElementById('globalAuthModal').classList.add('open');
    return;
  }

  const modalHtml = `
    <div id="globalAuthModal" class="auth-modal-overlay">
      <div class="apple-signin-card" style="position:relative;">
        ${requireAuth ? '' : `
        <button class="auth-modal-close-btn" onclick="closeAuthModal()">
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

          <button type="submit" class="apple-primary-btn" id="modalLoginBtn">
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

  // Small delay to allow CSS transition to kick in
  setTimeout(() => {
    document.getElementById('globalAuthModal').classList.add('open');
    document.getElementById('modalStudentId').focus();
  }, 10);
}

function closeAuthModal() {
  const modal = document.getElementById('globalAuthModal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 400); // Wait for transition
  }
}

async function doModalLogin() {
  const studentId = document.getElementById('modalStudentId').value.trim();
  const password = document.getElementById('modalPassword').value;
  const errorMsg = document.getElementById('modalErrorMsg');
  const loginBtn = document.getElementById('modalLoginBtn');

  errorMsg.textContent = '';

  if (!studentId || !password) {
    errorMsg.textContent = 'Please enter your Student ID and password.';
    return;
  }

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
      loginBtn.innerHTML = '<span>Success!</span>';
      loginBtn.style.background = '#22c55e'; // Green success color
      
      // Close modal and reload page to apply authenticated state
      setTimeout(() => {
        closeAuthModal();
        window.location.reload();
      }, 500);
      
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
