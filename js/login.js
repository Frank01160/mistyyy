// ============================================
// BASHAAN POS - LOGIN PAGE LOGIC (REWRITTEN)
// ============================================

document.addEventListener('DOMContentLoaded', () => {

  // ---------- DOM ----------
  const loginForm       = document.getElementById('loginForm');
  const passwordInput   = document.getElementById('passwordInput');
  const togglePasswordBtn = document.getElementById('togglePassword');
  const loginBtn        = document.getElementById('loginBtn');
  const loginLoading    = document.getElementById('loginLoading');
  const lockoutMessage  = document.getElementById('lockoutMessage');
  const lockoutTimer    = document.getElementById('lockoutTimer');
  const passwordError   = document.getElementById('passwordError');
  const attemptsLeft    = document.getElementById('attemptsLeft');
  const attemptsDots    = document.querySelectorAll('.attempt-dots .dot');
  const roleSeller      = document.getElementById('roleSeller');
  const roleManager     = document.getElementById('roleManager');
  const offlineWarning  = document.getElementById('offlineWarning');
  const appVersion      = document.getElementById('appVersion');

  // ---------- STATE ----------
  let selectedRole   = 'seller';
  let attempts       = parseInt(localStorage.getItem('bashan_login_attempts') || '0', 10);
  let lockoutUntil   = parseInt(localStorage.getItem('bashan_lockout_until') || '0', 10);
  let isLockedOut    = false;
  let isSubmitting   = false;
  let lockoutInterval = null;

  const MAX_ATTEMPTS = (window.BashanPOS && BashanPOS.MAX_LOGIN_ATTEMPTS) || 5;

  // ---------- BOOT ----------
  (function init() {
    if (appVersion && window.BashanPOS) {
      appVersion.textContent = BashanPOS.APP_VERSION;
    }

    // Already logged in?
    const raw = sessionStorage.getItem('bashan_user');
    if (raw) {
      try {
        const userData = JSON.parse(raw);
        if (userData.loginTime && Date.now() - userData.loginTime < 30 * 60 * 1000) {
          redirectToPOS();
          return;
        }
      } catch (e) { /* fall through */ }
    }

    checkLockout();
    updateAttemptsDisplay();
    checkOnlineStatus();
    bindEvents();
    setTimeout(() => passwordInput && passwordInput.focus(), 400);
  })();

  // ---------- EVENTS ----------
  function bindEvents() {
    roleSeller?.addEventListener('click', () => selectRole('seller'));
    roleManager?.addEventListener('click', () => selectRole('manager'));
    togglePasswordBtn?.addEventListener('click', togglePassword);
    loginForm?.addEventListener('submit', handleLogin);

    passwordInput?.addEventListener('input', () => {
      passwordError?.classList.remove('show');
      passwordInput.classList.remove('error');
    });

    window.addEventListener('online',  checkOnlineStatus);
    window.addEventListener('offline', checkOnlineStatus);

    // Enter key submits form (only when focus is inside the form)
    loginForm?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        loginForm.requestSubmit ? loginForm.requestSubmit() : loginForm.dispatchEvent(new Event('submit'));
      }
    });
  }

  function selectRole(role) {
    selectedRole = role;
    roleSeller?.classList.toggle('active', role === 'seller');
    roleManager?.classList.toggle('active', role === 'manager');
    if (passwordInput) {
      passwordInput.placeholder = `Enter ${role} password`;
      passwordInput.focus();
    }
  }

  function togglePassword() {
    if (!passwordInput) return;
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;

    const eyeIcon = togglePasswordBtn?.querySelector('.eye-icon');
    if (!eyeIcon) return;

    eyeIcon.innerHTML = type === 'text'
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }

  // ---------- LOGIN ----------
  async function handleLogin(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (isLockedOut) {
      showError('Account is temporarily locked. Please wait.');
      return;
    }

    if (!window.BashanPOS) {
      showError('System still loading. Please wait a moment and try again.');
      return;
    }

    const password = passwordInput?.value?.trim() || '';
    if (!password) {
      showError('Please enter your password');
      passwordInput?.classList.add('error');
      passwordInput?.focus();
      return;
    }

    isSubmitting = true;
    setLoading(true);

    try {
      const result = await BashanPOS.verifyPassword(password, selectedRole);

      if (result.success) {
        // Clear attempt counters
        localStorage.removeItem('bashan_login_attempts');
        localStorage.removeItem('bashan_lockout_until');

        const userData = {
          id:   selectedRole + '_' + Date.now(),
          name: selectedRole === 'manager' ? 'Manager' : 'Seller',
          role: selectedRole,
          loginTime: Date.now()
        };

        BashanPOS.saveSession(userData);
        BashanPOS.logAudit('LOGIN', `${selectedRole} logged in`);

        setTimeout(() => redirectToPOS(), 400);
      } else {
        handleFailedAttempt();
        showError(result.message || 'Incorrect password');
        passwordInput?.classList.add('error');
        if (passwordInput) passwordInput.value = '';
        passwordInput?.focus();
      }
    } catch (error) {
      console.error('Login error:', error);
      showError('Connection error. Please try again.');
    } finally {
      setLoading(false);
      isSubmitting = false;
    }
  }

  // ---------- ATTEMPTS & LOCKOUT ----------
  function handleFailedAttempt() {
    attempts++;
    localStorage.setItem('bashan_login_attempts', String(attempts));

    if (attempts >= MAX_ATTEMPTS) {
      const lockUntil = Date.now() + (BashanPOS.LOCKOUT_DURATION || 15 * 60 * 1000);
      localStorage.setItem('bashan_lockout_until', String(lockUntil));
      isLockedOut = true;
      showLockout(lockUntil);
    }

    updateAttemptsDisplay();
    BashanPOS.logAudit('LOGIN_FAILED', `Attempt ${attempts} for ${selectedRole}`);
  }

  function checkLockout() {
    if (lockoutUntil > Date.now()) {
      isLockedOut = true;
      showLockout(lockoutUntil);
    } else if (lockoutUntil > 0) {
      localStorage.removeItem('bashan_lockout_until');
      localStorage.removeItem('bashan_login_attempts');
      attempts = 0;
      isLockedOut = false;
    }
  }

  function showLockout(untilTime) {
    if (lockoutInterval) clearInterval(lockoutInterval);
    if (loginForm) loginForm.style.display = 'none';
    lockoutMessage?.classList.add('active');

    updateLockoutTimer(untilTime);
    lockoutInterval = setInterval(() => {
      if (Date.now() >= untilTime) {
        clearInterval(lockoutInterval);
        lockoutInterval = null;
        isLockedOut = false;
        localStorage.removeItem('bashan_lockout_until');
        localStorage.removeItem('bashan_login_attempts');
        attempts = 0;
        updateAttemptsDisplay();
        lockoutMessage?.classList.remove('active');
        if (loginForm) loginForm.style.display = 'block';
        passwordInput?.focus();
      } else {
        updateLockoutTimer(untilTime);
      }
    }, 1000);
  }

  function updateLockoutTimer(untilTime) {
    if (!lockoutTimer) return;
    const remaining = Math.max(0, untilTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    lockoutTimer.textContent = `Wait ${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function updateAttemptsDisplay() {
    const remaining = Math.max(0, MAX_ATTEMPTS - attempts);
    if (attemptsLeft) attemptsLeft.textContent = remaining;

    attemptsDots.forEach((dot, i) => dot.classList.toggle('used', i >= remaining));

    if (attemptsLeft) {
      attemptsLeft.style.color = remaining <= 2 ? '#ff5252'
                              : remaining <= 3 ? '#ffd740'
                              :                  '#66bb6a';
    }
  }

  // ---------- UI ----------
  function showError(message) {
    if (!passwordError) return;
    passwordError.textContent = message;
    passwordError.classList.add('show');
  }

  function setLoading(loading) {
    if (loading) {
      if (loginBtn) loginBtn.style.display = 'none';
      loginLoading?.classList.add('active');
      if (passwordInput) passwordInput.disabled = true;
    } else {
      if (loginBtn) loginBtn.style.display = 'flex';
      loginLoading?.classList.remove('active');
      if (passwordInput) passwordInput.disabled = false;
    }
  }

  function redirectToPOS() {
    window.location.href = 'pos.html';
  }

  function checkOnlineStatus() {
    offlineWarning?.classList.toggle('show', !navigator.onLine);
  }
});
