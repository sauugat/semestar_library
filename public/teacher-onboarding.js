(function() {
  'use strict';

  // Read onboarding token from query param or sessionStorage
  const urlParams = new URLSearchParams(window.location.search);
  let onboardingToken = urlParams.get('token') || sessionStorage.getItem('teacher_onboarding_token') || '';

  if (urlParams.get('token')) {
    sessionStorage.setItem('teacher_onboarding_token', urlParams.get('token'));
  }

  // State variables
  let allSubjects = [];
  let selectedSubjectIds = new Set();
  let step1Data = {
    name: '',
    username: '',
    email: '',
    password: ''
  };
  let targetEmail = '';
  let resendCooldownTimer = null;
  let resendCooldownSeconds = 0;

  // DOM elements
  const alertEl = document.getElementById('authAlert');
  const alertTitle = document.getElementById('authAlertTitle');
  const alertMsg = document.getElementById('authAlertMsg');

  function showAlert(message, type = 'error', title = '') {
    if (!alertEl) return;
    alertEl.className = 'auth-banner' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    alertTitle.textContent = title || (type === 'error' ? 'Validation Error' : 'Success');
    alertMsg.textContent = message;
    alertEl.style.display = 'block';
  }

  function hideAlert() {
    if (alertEl) alertEl.style.display = 'none';
  }

  // Initialize
  async function init() {
    if (!onboardingToken) {
      showAlert('No valid onboarding session found. Please log in with your temporary teacher credentials.', 'error', 'Session Missing');
      setTimeout(() => { window.location.href = '/login.html'; }, 2000);
      return;
    }

    setupPasswordToggle();
    setupSubjectSearch();
    setupOtpInputs();
    await checkInitialState();
  }

  async function checkInitialState() {
    try {
      const res = await fetch('/api/teacher/onboarding/state', {
        headers: { 'Authorization': `Bearer ${onboardingToken}` }
      });
      if (res.status === 401) {
        showAlert('Your onboarding session has expired. Please log in again.', 'error');
        sessionStorage.removeItem('teacher_onboarding_token');
        setTimeout(() => { window.location.href = '/login.html'; }, 1500);
        return;
      }
      const data = await res.json();
      if (data.status === 'completed' || data.completed) {
        sessionStorage.removeItem('teacher_onboarding_token');
        window.location.href = '/dashboard.html';
        return;
      }
      if (data.status === 'awaiting_email_verification') {
        targetEmail = data.email || data.state?.pending?.email || '';
        showAwaitingVerification(data.emailMasked);
      } else {
        await loadSubjects();
      }
    } catch (err) {
      console.warn('Could not check initial state:', err);
      await loadSubjects();
    }
  }

  function showCompletedState() {
    sessionStorage.removeItem('teacher_onboarding_token');
    document.getElementById('step1Section').style.display = 'none';
    document.getElementById('step2Section').style.display = 'none';
    const waitingScreen = document.getElementById('step3Section');
    waitingScreen.style.display = 'block';
    waitingScreen.innerHTML = `
      <div style="text-align: center; padding: 40px 16px;">
        <div style="font-size: 40px; margin-bottom: 16px;">✅</div>
        <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Teacher Account Ready</h2>
        <p style="font-size: 14px; color: var(--text-muted); margin-bottom: 24px; max-width: 380px; margin-left: auto; margin-right: auto; line-height: 1.5;">
          Your permanent faculty account has been activated! You can now sign in with your new username and password.
        </p>
        <a href="/login.html" class="btn btn-primary" style="display: inline-flex; text-decoration: none; padding: 10px 24px;">
          Sign In
        </a>
      </div>
    `;
  }

  async function loadSubjects() {
    try {
      const res = await fetch('/api/teacher/onboarding/subjects', {
        headers: { 'Authorization': `Bearer ${onboardingToken}` }
      });
      if (!res.ok) {
        throw new Error('Failed to load subjects');
      }
      const data = await res.json();
      allSubjects = data.subjects || [];
      renderSubjectsList();
    } catch (err) {
      const listCont = document.getElementById('subjectsListContainer');
      if (listCont) {
        listCont.innerHTML = `<div style="text-align: center; color: var(--danger-color, #ef4444); padding: 12px;">Could not load subjects. Please refresh the page.</div>`;
      }
    }
  }

  function setupPasswordToggle() {
    const toggleBtn = document.getElementById('togglePasswordBtn');
    const pwdInput = document.getElementById('newPassword');
    const eyeIcon = document.getElementById('pwdEyeIcon');
    if (toggleBtn && pwdInput) {
      toggleBtn.addEventListener('click', () => {
        const isText = pwdInput.type === 'text';
        pwdInput.type = isText ? 'password' : 'text';
        if (eyeIcon) eyeIcon.textContent = isText ? '👁' : '🙈';
      });
    }
  }

  // Step 1 Submission
  window.handleStep1Submit = function(e) {
    e.preventDefault();
    hideAlert();

    const name = document.getElementById('fullName').value.trim().replace(/\s+/g, ' ');
    const username = document.getElementById('username').value.trim().toLowerCase();
    const email = document.getElementById('recoveryEmail').value.trim().toLowerCase();
    const password = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!name || name.length < 2 || name.length > 100) {
      showAlert('Full Name must be between 2 and 100 characters.', 'error');
      return;
    }

    const usernameRegex = /^[a-zA-Z0-9._]{3,30}$/;
    if (!usernameRegex.test(username)) {
      showAlert('Username must be 3–30 characters and only contain letters, numbers, dot, or underscore.', 'error');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showAlert('Please enter a valid email address.', 'error');
      return;
    }

    if (password.length < 8) {
      showAlert('Password must be at least 8 characters long.', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showAlert('Passwords do not match.', 'error');
      return;
    }

    step1Data = { name, username, email, password };
    goToStep(2);
  };

  // Step Navigation
  window.goToStep = function(step) {
    hideAlert();
    document.getElementById('stepSection1').style.display = step === 1 ? 'block' : 'none';
    document.getElementById('stepSection2').style.display = step === 2 ? 'block' : 'none';
    document.getElementById('stepSection3').style.display = step === 3 ? 'block' : 'none';

    document.getElementById('stepNode1').className = 'step-node' + (step >= 1 ? ' active' : '');
    document.getElementById('stepNode2').className = 'step-node' + (step >= 2 ? ' active' : '');
    document.getElementById('stepNode3').className = 'step-node' + (step >= 3 ? ' active' : '');

    if (step === 2) {
      updateReviewSummary();
    }
  };

  // Setup Subject Search & Rendering
  function setupSubjectSearch() {
    const searchInput = document.getElementById('subjectSearch');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderSubjectsList(searchInput.value.trim().toLowerCase());
      });
    }
  }

  function renderSubjectsList(query = '') {
    const listCont = document.getElementById('subjectsListContainer');
    if (!listCont) return;

    let filtered = allSubjects;
    if (query) {
      filtered = allSubjects.filter(s =>
        (s.title && s.title.toLowerCase().includes(query)) ||
        (s.code && s.code.toLowerCase().includes(query))
      );
    }

    if (filtered.length === 0) {
      listCont.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No subjects match "${query}".</div>`;
      return;
    }

    // Group by semester
    const grouped = {};
    for (let sem = 1; sem <= 8; sem++) {
      grouped[sem] = [];
    }
    filtered.forEach(sub => {
      const s = sub.semester || 1;
      if (!grouped[s]) grouped[s] = [];
      grouped[s].push(sub);
    });

    let html = '';
    for (let sem = 1; sem <= 8; sem++) {
      const items = grouped[sem];
      if (!items || items.length === 0) continue;

      html += `<div class="semester-group-title">Semester ${sem}</div>`;
      items.forEach(sub => {
        const isChecked = selectedSubjectIds.has(sub.id);
        html += `
          <div class="subject-item-row" onclick="toggleSubjectSelection('${sub.id}')">
            <input type="checkbox" id="chk_${sub.id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleSubjectSelection('${sub.id}')">
            <label for="chk_${sub.id}" style="cursor: pointer; flex: 1;">
              <strong>${sub.code}</strong> — ${sub.title}
            </label>
          </div>
        `;
      });
    }

    listCont.innerHTML = html;
    renderChips();
  }

  window.toggleSubjectSelection = function(id) {
    if (selectedSubjectIds.has(id)) {
      selectedSubjectIds.delete(id);
    } else {
      selectedSubjectIds.add(id);
    }
    renderSubjectsList(document.getElementById('subjectSearch')?.value.trim().toLowerCase() || '');
    updateReviewSummary();
  };

  function renderChips() {
    const chipsCont = document.getElementById('selectedChips');
    const countText = document.getElementById('selectedCountText');
    if (!chipsCont || !countText) return;

    countText.textContent = `Selected (${selectedSubjectIds.size})`;
    if (selectedSubjectIds.size === 0) {
      chipsCont.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">No subjects selected yet.</span>';
      return;
    }

    let chipsHtml = '';
    selectedSubjectIds.forEach(id => {
      const sub = allSubjects.find(s => s.id === id);
      const title = sub ? sub.code : id;
      chipsHtml += `
        <span class="subject-chip">
          <span>${title}</span>
          <span class="subject-chip-remove" onclick="toggleSubjectSelection('${id}')" title="Remove">✕</span>
        </span>
      `;
    });
    chipsCont.innerHTML = chipsHtml;
  }

  function updateReviewSummary() {
    const revCard = document.getElementById('reviewSummary');
    if (!revCard) return;

    revCard.style.display = 'block';
    document.getElementById('revName').textContent = step1Data.name;
    document.getElementById('revUsername').textContent = step1Data.username;
    document.getElementById('revEmail').textContent = maskEmail(step1Data.email);
    document.getElementById('revSubjectCount').textContent = selectedSubjectIds.size;
  }

  function maskEmail(email) {
    if (!email) return '';
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const masked = name.length <= 2 ? name[0] + '***' : name[0] + '***' + name.slice(-1);
    return `${masked}@${parts[1]}`;
  }

  // Final Onboarding Submission
  window.submitOnboarding = async function() {
    hideAlert();
    if (selectedSubjectIds.size === 0) {
      showAlert('Please select at least one subject you teach.', 'error');
      return;
    }

    const submitBtn = document.getElementById('finalSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Submitting…</span>';

    try {
      const payload = {
        name: step1Data.name,
        username: step1Data.username,
        email: step1Data.email,
        password: step1Data.password,
        confirmPassword: step1Data.password,
        subjectIds: Array.from(selectedSubjectIds)
      };

      const res = await fetch('/api/teacher/onboarding/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${onboardingToken}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Onboarding submission failed.');
      }

      targetEmail = data.email || step1Data.email;
      showAwaitingVerification(data.emailMasked || maskEmail(step1Data.email));
    } catch (err) {
      showAlert(err.message || 'An error occurred during onboarding.', 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Complete Setup</span>';
    }
  };

  function showAwaitingVerification(maskedEmail) {
    goToStep(3);
    document.getElementById('waitingMaskedEmail').textContent = maskedEmail || 'your email';
    // Clear any previous OTP digits
    const inputs = document.querySelectorAll('.otp-digit-input');
    inputs.forEach(inp => { inp.value = ''; });
    if (inputs[0]) inputs[0].focus();
    startResendCooldown(60);
  }

  function setupOtpInputs() {
    const inputs = document.querySelectorAll('.otp-digit-input');
    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        const val = input.value.replace(/[^0-9]/g, '');
        if (!val) {
          input.value = '';
          return;
        }

        // Handle paste of full code
        if (val.length > 1) {
          const digits = val.slice(0, 6).split('');
          inputs.forEach((inp, i) => {
            inp.value = digits[i] || '';
          });
          const nextIdx = Math.min(digits.length, 5);
          inputs[nextIdx]?.focus();
          if (digits.length === 6) {
            handleVerifyOtp();
          }
          return;
        }

        // Single digit typed
        input.value = val[0];
        if (index < 5) {
          inputs[index + 1]?.focus();
        } else if (index === 5) {
          const allFilled = Array.from(inputs).every(inp => inp.value.length === 1);
          if (allFilled) handleVerifyOtp();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace') {
          if (!input.value && index > 0) {
            inputs[index - 1].value = '';
            inputs[index - 1].focus();
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          handleVerifyOtp();
        }
      });
    });
  }

  // OTP Verification Handler
  window.handleVerifyOtp = async function() {
    hideAlert();
    const inputs = document.querySelectorAll('.otp-digit-input');
    const digits = Array.from(inputs).map(inp => inp.value.trim()).join('');

    if (digits.length !== 6) {
      showAlert('Please enter the 6-digit verification code.', 'error', 'Incomplete Code');
      return;
    }

    const btn = document.getElementById('verifyOtpBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Verifying…</span>';
    }

    try {
      const supabase = await window.SemesterAuth.getSupabase();
      let verifyRes = await supabase.auth.verifyOtp({
        email: targetEmail,
        token: digits,
        type: 'email'
      });

      if (verifyRes.error && (verifyRes.error.message || '').toLowerCase().includes('type')) {
        verifyRes = await supabase.auth.verifyOtp({
          email: targetEmail,
          token: digits,
          type: 'signup'
        });
      }

      if (verifyRes.error || !verifyRes.data?.session?.access_token) {
        const errMsg = (verifyRes.error?.message || '').toLowerCase();
        if (errMsg.includes('expired') || verifyRes.error?.code === 'otp_expired') {
          showAlert('That code has expired. Request a new verification code.', 'error', 'Code Expired');
        } else {
          showAlert('That verification code is incorrect.', 'error', 'Incorrect Code');
        }
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>Verify & Continue</span>';
        }
        return;
      }

      const accessToken = verifyRes.data.session.access_token;

      // Call backend finalize
      const finRes = await fetch('/api/teacher/onboarding/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ token: accessToken })
      });

      const finData = await finRes.json().catch(() => ({}));
      if (!finRes.ok || !finData.success) {
        throw new Error(finData.message || 'Account activation failed.');
      }

      sessionStorage.removeItem('teacher_onboarding_token');

      showAlert('Account verified! Taking you to your dashboard…', 'success', 'Welcome');
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 500);
    } catch (err) {
      showAlert(err.message || 'Verification failed. Please try again.', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>Verify & Continue</span>';
      }
    }
  };

  // Resend Verification Email
  window.handleResendVerification = async function() {
    hideAlert();
    const btn = document.getElementById('resendBtn');
    if (resendCooldownSeconds > 0) return;

    btn.disabled = true;
    btn.innerHTML = '<span>Sending…</span>';

    try {
      const res = await fetch('/api/teacher/onboarding/resend-verification', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${onboardingToken}` }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Could not resend email.');
      }
      showAlert('Verification code sent! Please check your inbox.', 'success', 'Code Sent');
      startResendCooldown(60);
    } catch (err) {
      showAlert(err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<span>Resend Code</span>';
    }
  };

  function startResendCooldown(seconds) {
    resendCooldownSeconds = seconds;
    const btn = document.getElementById('resendBtn');
    if (!btn) return;

    clearInterval(resendCooldownTimer);
    btn.disabled = true;
    btn.innerHTML = `<span>Resend in ${resendCooldownSeconds}s</span>`;

    resendCooldownTimer = setInterval(() => {
      resendCooldownSeconds--;
      if (resendCooldownSeconds <= 0) {
        clearInterval(resendCooldownTimer);
        btn.disabled = false;
        btn.innerHTML = '<span>Resend Code</span>';
      } else {
        btn.innerHTML = `<span>Resend in ${resendCooldownSeconds}s</span>`;
      }
    }, 1000);
  }

  // Change Email Address
  window.toggleChangeEmailForm = function() {
    const wrap = document.getElementById('changeEmailFormWrap');
    if (wrap) {
      wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    }
  };

  window.handleSaveNewEmail = async function() {
    hideAlert();
    const newEmail = document.getElementById('newEmailInput').value.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      showAlert('Please enter a valid email address.', 'error');
      return;
    }

    const btn = document.getElementById('saveEmailBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const res = await fetch('/api/teacher/onboarding/change-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${onboardingToken}`
        },
        body: JSON.stringify({ email: newEmail })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Could not change email.');
      }
      targetEmail = cleanNewEmail;
      showAlert('Email updated and new verification code sent!', 'success', 'Email Updated');
      document.getElementById('waitingMaskedEmail').textContent = data.emailMasked || maskEmail(cleanNewEmail);
      const inputs = document.querySelectorAll('.otp-digit-input');
      inputs.forEach(inp => { inp.value = ''; });
      toggleChangeEmailForm();
      startResendCooldown(60);
    } catch (err) {
      showAlert(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save & Resend';
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
