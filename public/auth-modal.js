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

        <h1 class="apple-signin-headline">Sign in with your Email</h1>
        <p class="apple-signin-subtext">Access your notices, exam routines, study notes, and syllabus materials.</p>

        <form id="modalLoginForm" class="apple-signin-form" onsubmit="event.preventDefault(); doModalLogin();">
          <div class="apple-input-group">
            <div class="apple-input-row">
              <label for="modalEmail" class="apple-input-label">Email Address</label>
              <input type="email" id="modalEmail" name="email" class="apple-text-field" placeholder="student@example.com" autocomplete="email" required>
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
              <span class="apple-remember-text">Remember Email</span>
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

  // Restore remembered Email
  try {
    const savedEmail = localStorage.getItem('rememberedEmail') || localStorage.getItem('rememberedStudentId');
    if (savedEmail) {
      const emailInput = document.getElementById('modalEmail') || document.getElementById('modalStudentId');
      const remCheck = document.getElementById('modalRememberMe');
      if (emailInput) emailInput.value = savedEmail;
      if (remCheck) remCheck.checked = true;
    }
  } catch (err) { }

  // Small delay to allow CSS transition to kick in
  setTimeout(() => {
    const modal = document.getElementById('globalAuthModal');
    if (modal) {
      modal.classList.add('open');
      const emailInput = document.getElementById('modalEmail') || document.getElementById('modalStudentId');
      const passInput = document.getElementById('modalPassword');
      if (emailInput && !emailInput.value) emailInput.focus();
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

  const emailInput = document.getElementById('modalEmail') || document.getElementById('modalStudentId');
  const passInput = document.getElementById('modalPassword');
  const errorMsg = document.getElementById('modalErrorMsg');
  const loginBtn = document.getElementById('modalLoginBtn');
  const rememberCheckbox = document.getElementById('modalRememberMe');

  if (!emailInput || !passInput) return;

  const email = emailInput.value.trim();
  const password = passInput.value;

  if (errorMsg) errorMsg.textContent = '';

  if (!email || !password) {
    if (errorMsg) errorMsg.textContent = 'Please enter your email and password.';
    return;
  }

  // Handle Remember Me
  try {
    if (rememberCheckbox && rememberCheckbox.checked) {
      localStorage.setItem('rememberedEmail', email);
    } else {
      localStorage.removeItem('rememberedEmail');
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

    const { data, error } = await SemesterAuth.signIn(email, password);

    if (error) {
      let friendlyMsg = 'Invalid email or password.';
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
        friendlyMsg = 'Invalid email or password.';
      } else if (msg.includes('email not confirmed')) {
        friendlyMsg = 'Please verify your email address.';
      } else if (msg.includes('too many requests')) {
        friendlyMsg = 'Too many failed login attempts. Please wait.';
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
      setTimeout(() => {
        window.closeAuthModal();
        window.location.reload();
      }, 400);
    }
  } catch (err) {
    if (errorMsg) errorMsg.textContent = err.message || 'Connection error. Please try again.';
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

