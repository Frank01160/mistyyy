// ============================================
// BASHAAN POS - LOGIN PAGE LOGIC
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginForm = document.getElementById('loginForm');
    const passwordInput = document.getElementById('passwordInput');
    const togglePasswordBtn = document.getElementById('togglePassword');
    const loginBtn = document.getElementById('loginBtn');
    const loginLoading = document.getElementById('loginLoading');
    const lockoutMessage = document.getElementById('lockoutMessage');
    const lockoutTimer = document.getElementById('lockoutTimer');
    const passwordError = document.getElementById('passwordError');
    const attemptsLeft = document.getElementById('attemptsLeft');
    const attemptsDots = document.querySelectorAll('.attempt-dots .dot');
    const roleSeller = document.getElementById('roleSeller');
    const roleManager = document.getElementById('roleManager');
    const offlineWarning = document.getElementById('offlineWarning');
    const appVersion = document.getElementById('appVersion');
    
    // State
    let selectedRole = 'seller';
    let attempts = parseInt(localStorage.getItem('bashan_login_attempts') || '0');
    let lockoutUntil = parseInt(localStorage.getItem('bashan_lockout_until') || '0');
    let isLockedOut = false;
    
    // Set version
    if (appVersion && window.BashanPOS) {
        appVersion.textContent = window.BashanPOS.APP_VERSION;
    }
    
    // Initialize
    init();
    
    function init() {
        // Check if already logged in
        const user = sessionStorage.getItem('bashan_user');
        if (user) {
            const userData = JSON.parse(user);
            if (Date.now() - userData.loginTime < 30 * 60 * 1000) {
                redirectToPOS(userData.role);
                return;
            }
        }
        
        // Check lockout
        checkLockout();
        
        // Update attempts display
        updateAttemptsDisplay();
        
        // Check offline status
        checkOnlineStatus();
        
        // Focus password input
        setTimeout(() => passwordInput.focus(), 500);
        
        // Event listeners
        setupEventListeners();
    }
    
    function setupEventListeners() {
        // Role selection
        roleSeller.addEventListener('click', () => selectRole('seller'));
        roleManager.addEventListener('click', () => selectRole('manager'));
        
        // Toggle password visibility
        togglePasswordBtn.addEventListener('click', togglePassword);
        
        // Form submission
        loginForm.addEventListener('submit', handleLogin);
        
        // Clear error on input
        passwordInput.addEventListener('input', () => {
            passwordError.classList.remove('show');
            passwordInput.classList.remove('error');
        });
        
        // Online/Offline detection
        window.addEventListener('online', checkOnlineStatus);
        window.addEventListener('offline', checkOnlineStatus);
    }
    
    function selectRole(role) {
        selectedRole = role;
        roleSeller.classList.toggle('active', role === 'seller');
        roleManager.classList.toggle('active', role === 'manager');
        passwordInput.focus();
        
        // Update placeholder
        passwordInput.placeholder = `Enter ${role} password`;
    }
    
    function togglePassword() {
        const type = passwordInput.type === 'password' ? 'text' : 'password';
        passwordInput.type = type;
        
        // Update eye icon
        const eyeIcon = togglePasswordBtn.querySelector('.eye-icon');
        if (type === 'text') {
            eyeIcon.innerHTML = `
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            `;
        } else {
            eyeIcon.innerHTML = `
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            `;
        }
    }
    
    async function handleLogin(e) {
        e.preventDefault();
        
        if (isLockedOut) {
            showError('Account is temporarily locked. Please wait.');
            return;
        }
        
        const password = passwordInput.value.trim();
        
        if (!password) {
            showError('Please enter your password');
            passwordInput.classList.add('error');
            passwordInput.focus();
            return;
        }
        
        // Show loading
        setLoading(true);
        
        try {
            const result = await BashanPOS.verifyPassword(password, selectedRole);
            
            if (result.success) {
                // Clear attempts
                localStorage.removeItem('bashan_login_attempts');
                localStorage.removeItem('bashan_lockout_until');
                
                // Save session
                const userData = {
                    id: selectedRole + '_' + Date.now(),
                    name: selectedRole === 'manager' ? 'Manager' : 'Seller',
                    role: selectedRole,
                    loginTime: Date.now()
                };
                
                BashanPOS.saveSession(userData);
                
                // Log audit
                BashanPOS.logAudit('LOGIN', `${selectedRole} logged in`);
                
                // Redirect
                setTimeout(() => {
                    redirectToPOS(selectedRole);
                }, 500);
                
            } else {
                handleFailedAttempt();
                showError(result.message || 'Incorrect password');
                passwordInput.classList.add('error');
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('Connection error. Please try again.');
        } finally {
            setLoading(false);
        }
    }
    
    function handleFailedAttempt() {
        attempts++;
        localStorage.setItem('bashan_login_attempts', attempts.toString());
        
        if (attempts >= 5) {
            // Lockout
            const lockoutTime = Date.now() + 15 * 60 * 1000;
            localStorage.setItem('bashan_lockout_until', lockoutTime.toString());
            isLockedOut = true;
            showLockout(lockoutTime);
        }
        
        updateAttemptsDisplay();
        BashanPOS.logAudit('LOGIN_FAILED', `Attempt ${attempts} for ${selectedRole}`);
    }
    
    function checkLockout() {
        if (lockoutUntil > Date.now()) {
            isLockedOut = true;
            showLockout(lockoutUntil);
        } else if (lockoutUntil > 0) {
            // Lockout expired
            localStorage.removeItem('bashan_lockout_until');
            localStorage.removeItem('bashan_login_attempts');
            attempts = 0;
            isLockedOut = false;
        }
    }
    
    function showLockout(untilTime) {
        loginForm.style.display = 'none';
        lockoutMessage.classList.add('active');
        
        updateLockoutTimer(untilTime);
        const timerInterval = setInterval(() => {
            if (Date.now() >= untilTime) {
                clearInterval(timerInterval);
                isLockedOut = false;
                localStorage.removeItem('bashan_lockout_until');
                localStorage.removeItem('bashan_login_attempts');
                attempts = 0;
                updateAttemptsDisplay();
                lockoutMessage.classList.remove('active');
                loginForm.style.display = 'block';
                passwordInput.focus();
            } else {
                updateLockoutTimer(untilTime);
            }
        }, 1000);
    }
    
    function updateLockoutTimer(untilTime) {
        const remaining = Math.max(0, untilTime - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        lockoutTimer.textContent = `Wait ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    function updateAttemptsDisplay() {
        const remaining = Math.max(0, 5 - attempts);
        attemptsLeft.textContent = remaining;
        
        attemptsDots.forEach((dot, index) => {
            if (index >= remaining) {
                dot.classList.add('used');
            } else {
                dot.classList.remove('used');
            }
        });
        
        // Color the remaining text
        if (remaining <= 2) {
            attemptsLeft.style.color = '#ff5252';
        } else if (remaining <= 3) {
            attemptsLeft.style.color = '#ffd740';
        } else {
            attemptsLeft.style.color = '#66bb6a';
        }
    }
    
    function showError(message) {
        passwordError.textContent = message;
        passwordError.classList.add('show');
    }
    
    function setLoading(loading) {
        if (loading) {
            loginBtn.style.display = 'none';
            loginLoading.classList.add('active');
            passwordInput.disabled = true;
        } else {
            loginBtn.style.display = 'flex';
            loginLoading.classList.remove('active');
            passwordInput.disabled = false;
        }
    }
    
    function redirectToPOS(role) {
    // Store the role so POS page knows who logged in
    window.location.href = 'pos.html';
}
    
    function checkOnlineStatus() {
        if (!navigator.onLine) {
            offlineWarning.classList.add('show');
        } else {
            offlineWarning.classList.remove('show');
        }
    }
    
    // Prevent multiple form submissions
    let isSubmitting = false;
    loginForm.addEventListener('submit', (e) => {
        if (isSubmitting) {
            e.preventDefault();
            return;
        }
        isSubmitting = true;
        setTimeout(() => { isSubmitting = false; }, 2000);
    });
    
    // Handle Enter key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement !== loginBtn) {
            e.preventDefault();
            loginForm.dispatchEvent(new Event('submit'));
        }
    });
});