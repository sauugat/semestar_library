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
        window.location.href = '/teacher-dashboard.html';
        return;
      }
      if (data.status === 'awaiting_email_verification') {
        const pending = data.state?.pending || {};
        targetEmail = data.email || pending.email || '';
        if (pending.name || pending.username || pending.email) {
          step1Data = {
            name: pending.name || '',
            username: pending.username || '',
            email: pending.email || targetEmail,
            password: ''
          };
          const fullNameEl = document.getElementById('fullName');
          const usernameEl = document.getElementById('username');
          const emailEl = document.getElementById('recoveryEmail');
          if (fullNameEl && step1Data.name) fullNameEl.value = step1Data.name;
          if (usernameEl && step1Data.username) usernameEl.value = step1Data.username;
          if (emailEl && step1Data.email) emailEl.value = step1Data.email;
        }
        if (Array.isArray(pending.subjectIds)) {
          selectedSubjectIds = new Set(pending.subjectIds);
        }
        loadSubjects();
        showAwaitingVerification(data.emailMasked, false);
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
    const s1 = document.getElementById('stepSection1');
    const s2 = document.getElementById('stepSection2');
    const waitingScreen = document.getElementById('stepSection3');
    if (s1) s1.style.display = 'none';
    if (s2) s2.style.display = 'none';
    if (!waitingScreen) return;
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
  window.handleStep1Submit = async function(e) {
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

    const nextBtn = document.getElementById('step1NextBtn');
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<span>Checking…</span>';
    }

    try {
      const res = await fetch('/api/teacher/onboarding/check-username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${onboardingToken}`
        },
        body: JSON.stringify({ username })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.available === false) {
        showAlert(data.reason || 'That username is already taken. Please choose another.', 'error');
        return;
      }
    } catch (err) {
      console.warn('Username availability check failed:', err);
    } finally {
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = '<span>Continue to Subjects →</span>';
      }
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
  const CANONICAL_SUBJECT_NAMES = {
    "ELX111": "Basic Electronics",
    "BSM111": "Mathematics I",
    "CIT111": "Computer Programming,I (C)",
    "CIT112": "Basics of IT",
    "CIT113": "Workshop: Problem Solving and Logic",
    "BCT111": "Business Communication Technique",
    "CIT121": "Discrete Mathematics",
    "CIT122": "Computer Programming II (Java)",
    "BSM121": "Mathematics II",
    "ELX121": "Digital Logic",
    "CIT123": "Web Technology I",
    "CIT124": "Project I",
    "CIT214": "Data Structure and Algorithms",
    "CIT213": "Database Management System",
    "ELX211": "Microprocessor and Computer Architecture",
    "BCT211": "Principles of Organization and Management",
    "CIT212": "Software Engineering",
    "CIT211": "Web Technology II",
    "CIT224": "Computer Graphics Technology",
    "CIT223": "Data Communication and Computer Networks",
    "CIT222": "Management Information System",
    "CIT221": "Operating Systems",
    "BSM221": "Fundamentals of Probability and Statistics",
    "CIT225": "Project II",
    "BCT311": "Economics",
    "CIT311": "Mobile Application Development",
    "BSM311": "Numerical Methods",
    "CIT312": "Object Oriented Analysis and Design using UML",
    "BCT312": "Research Methodology",
    "BCT313": "Technical Proposal Writing",
    "CIT323": "Artificial Intelligence",
    "CIT322": "Digital Forensic Security Technologies",
    "BCT322": "Financial Accounting",
    "CIT321": "Human Computer Interface and UI Design",
    "BCT321": "IT Project Management",
    "CIT324": "Project III",
    "CIT413": "Cloud Computing",
    "CIT411": "Data Mining and Warehousing",
    "CIT412": "Software Development and Operations (DevOps)",
    "BCT411": "Technology Entrepreneurship",
    "CIT414": "Wireless Communication Systems",
    "CIT421": "Big Data Technologies",
    "BCT421": "Society, IT and Law",
    "CIT422": "Internship",
    "CIT423": "Project IV"
  };

  function getSubjectDisplayName(sub) {
    if (!sub) return '';
    const codeKey = String(sub.code || sub.id || '').trim().toUpperCase();
    return sub.name || sub.title || CANONICAL_SUBJECT_NAMES[codeKey] || '';
  }

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
      filtered = allSubjects.filter(s => {
        const subjectName = getSubjectDisplayName(s);
        return (
          (subjectName && subjectName.toLowerCase().includes(query)) ||
          (s.code && s.code.toLowerCase().includes(query))
        );
      });
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
        const subjectName = getSubjectDisplayName(sub);
        html += `
          <div class="subject-item-row" onclick="toggleSubjectSelection('${sub.id}')">
            <input type="checkbox" id="chk_${sub.id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleSubjectSelection('${sub.id}')">
            <label for="chk_${sub.id}" style="cursor: pointer; flex: 1;">
              <strong>${sub.code}</strong>${subjectName ? ` — ${subjectName}` : ''}
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
      const subjectName = sub ? getSubjectDisplayName(sub) : (CANONICAL_SUBJECT_NAMES[String(id).toUpperCase()] || '');
      const code = sub ? sub.code : id;
      const title = subjectName ? `${code} — ${subjectName}` : code;
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
        const step1ErrorCodes = new Set([
          'INVALID_NAME',
          'INVALID_USERNAME',
          'INVALID_EMAIL',
          'EMAIL_ALREADY_EXISTS',
          'EMAIL_COLLISION',
          'INVALID_PASSWORD',
          'PASSWORD_MISMATCH'
        ]);
        if (data.code && step1ErrorCodes.has(data.code)) {
          goToStep(1);
        }
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

  function showAwaitingVerification(maskedEmail, applyCooldown = true) {
    goToStep(3);
    document.getElementById('waitingMaskedEmail').textContent = maskedEmail || 'your email';
    // Clear any previous OTP digits
    const inputs = document.querySelectorAll('.otp-digit-input');
    inputs.forEach(inp => { inp.value = ''; });
    if (inputs[0]) inputs[0].focus();
    if (applyCooldown) {
      startResendCooldown(60);
    } else {
      const btn = document.getElementById('resendBtn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>Resend Code</span>';
      }
    }
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
      const emailToVerify = (targetEmail || step1Data.email || '').trim().toLowerCase();
      if (!emailToVerify) {
        showAlert('Missing email address for verification. Please refresh or update your email.', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>Verify & Continue</span>';
        }
        return;
      }

      const supabase = await window.SemesterAuth.getSupabase();
      const otpTypes = ['signup', 'email', 'magiclink', 'email_change'];
      let verifyRes = null;

      for (const otpType of otpTypes) {
        const attempt = await supabase.auth.verifyOtp({
          email: emailToVerify,
          token: digits,
          type: otpType
        });
        if (!attempt.error && attempt.data?.session?.access_token) {
          verifyRes = attempt;
          break;
        }
        if (!verifyRes) {
          verifyRes = attempt;
        }
      }

      if (!verifyRes || verifyRes.error || !verifyRes.data?.session?.access_token) {
        const errMsg = (verifyRes?.error?.message || '').toLowerCase();
        if (errMsg.includes('expired') || verifyRes?.error?.code === 'otp_expired') {
          showAlert('That code has expired or does not match. Please check the code or click Resend Code.', 'error', 'Verification Failed');
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
      try {
        if (finData.user) {
          sessionStorage.setItem('sl_user_cache', JSON.stringify(finData.user));
        }
        if (window.SemesterAuth && typeof window.SemesterAuth.syncSession === 'function') {
          await Promise.race([
            window.SemesterAuth.syncSession().catch(() => null),
            new Promise(r => setTimeout(r, 1200))
          ]);
        }
      } catch (_) {}

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
      targetEmail = newEmail;
      showAlert('Email updated and new verification code sent!', 'success', 'Email Updated');
      document.getElementById('waitingMaskedEmail').textContent = data.emailMasked || maskEmail(newEmail);
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
