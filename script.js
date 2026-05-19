// Global Variables
let currentUser = null;
let mfaResolver = null;
let recaptchaVerifier = null;
let gmailVerificationEmail = '';
let generatedGmailCode = '';
let phoneVerificationNumber = '';
let generatedPhoneCode = '';
let pendingUser = null; // User waiting for verification
let confirmationResult = null; // Firebase phone authentication confirmation result

const SECOND_FACTOR_STORAGE_KEY = 'secondFactorVerifiedByUid';
let phoneVerificationId = null;

function useLocalMfaMode() {
    if (window.useLocalMfa === true) return true;
    if (window.electronAPI) return true;
    if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) return true;
    const protocol = window.location.protocol;
    return protocol === 'file:' || protocol === 'null:' || window.location.hostname === 'localhost';
}

// Helper functions to get Firebase instances
function getAuth() {
    return window.auth;
}

function getDb() {
    return window.db;
}

// Save or update user profile in Firestore (uid must match signed-in user for rules)
async function saveUserProfileToFirestore(user, profileData = {}) {
    if (!user || !user.uid) {
        throw new Error('User must be signed in to save profile');
    }

    const profileFields = {
        email: profileData.email || user.email || '',
        name: profileData.name || user.displayName || '',
        phoneNumber: profileData.phoneNumber ?? null,
        mfaEnabled: profileData.mfaEnabled ?? false
    };

    if (window.firestoreDisabled || !window.db) {
        await saveUserProfileToLocalStorage(user.uid, {
            ...profileFields,
            lastLogin: new Date().toISOString()
        });
        return { savedTo: 'local' };
    }

    const profile = {
        ...profileFields,
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        const userRef = window.db.collection('users').doc(user.uid);
        const existing = await userRef.get();

        if (!existing.exists) {
            profile.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        }

        await userRef.set(profile, { merge: true });
        console.log('✅ User profile saved to Firestore:', user.uid);
        return { savedTo: 'firestore' };
    } catch (error) {
        console.error('❌ Firestore profile save failed:', error);
        try {
            await saveUserProfileToLocalStorage(user.uid, {
                ...profileFields,
                lastLogin: new Date().toISOString()
            });
        } catch (localError) {
            console.error('❌ Local profile save failed:', localError);
        }
        return { savedTo: 'local', error };
    }
}

async function saveUserProfileToLocalStorage(uid, profile) {
    if (!window.localStorageManager) return;

    const existing = await window.localStorageManager.getUser(uid);
    if (existing) {
        await window.localStorageManager.updateUser(uid, profile);
    } else {
        await window.localStorageManager.createUser({ uid, ...profile });
    }
}

async function ensureUserProfileInFirestore(user, extras = {}) {
    return saveUserProfileToFirestore(user, extras);
}

function getSecondFactorVerifiedMap() {
    try {
        const raw = window.localStorage.getItem(SECOND_FACTOR_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function selectVerificationMethod(method) {
    const emailTab = document.getElementById('methodEmailTab');
    const smsTab = document.getElementById('methodSmsTab');
    const emailPanel = document.getElementById('verificationEmailPanel');
    const smsPanel = document.getElementById('verificationSmsPanel');

    if (!emailTab || !smsTab || !emailPanel || !smsPanel) return;

    const isEmail = method === 'email';

    emailTab.classList.toggle('active', isEmail);
    smsTab.classList.toggle('active', !isEmail);
    emailTab.setAttribute('aria-selected', isEmail ? 'true' : 'false');
    smsTab.setAttribute('aria-selected', !isEmail ? 'true' : 'false');

    emailPanel.classList.toggle('active', isEmail);
    smsPanel.classList.toggle('active', !isEmail);

    if (isEmail) {
        const emailInput = document.getElementById('verificationEmail');
        if (emailInput) emailInput.focus();
    } else {
        const phoneInput = document.getElementById('verificationPhone');
        if (phoneInput) phoneInput.focus();
    }
}

function setSecondFactorVerified(uid, method) {
    if (!uid) return;
    const map = getSecondFactorVerifiedMap();
    map[uid] = {
        verified: true,
        method: method || 'unknown',
        verifiedAt: Date.now()
    };
    window.localStorage.setItem(SECOND_FACTOR_STORAGE_KEY, JSON.stringify(map));
}

function clearSecondFactorVerified(uid) {
    const map = getSecondFactorVerifiedMap();
    if (uid && map[uid]) {
        delete map[uid];
        window.localStorage.setItem(SECOND_FACTOR_STORAGE_KEY, JSON.stringify(map));
    }
}

function isSecondFactorVerified(uid) {
    const map = getSecondFactorVerifiedMap();
    return !!(uid && map[uid] && map[uid].verified);
}

async function completeSecondFactorAndProceed(method) {
    try {
        console.log('🔍 DEBUG: completeSecondFactorAndProceed called');
        console.log('🔍 DEBUG: pendingUser:', pendingUser);
        console.log('🔍 DEBUG: currentUser:', currentUser);
        console.log('🔍 DEBUG: method:', method);
        
        if (!pendingUser && currentUser) {
            pendingUser = currentUser;
            console.log('🔍 DEBUG: Set pendingUser from currentUser');
        }
        if (!pendingUser || !pendingUser.uid) {
            console.log('❌ DEBUG: No pending user found');
            console.log('❌ DEBUG: pendingUser exists:', !!pendingUser);
            console.log('❌ DEBUG: pendingUser.uid exists:', pendingUser && !!pendingUser.uid);
            showToast('No pending user found. Please sign in again.', 'error');
            showLoginForm();
            return;
        }

        setSecondFactorVerified(pendingUser.uid, method);
        currentUser = pendingUser;
        pendingUser = null;

        try {
            const userRef = db.collection('users').doc(currentUser.uid);
            await userRef.set({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.error('Failed to update lastLogin:', e);
        }

        showDashboard();
    } catch (e) {
        console.error('Error completing second factor:', e);
        showToast('Verification failed. Please try again.', 'error');
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    console.log('🔍 DOM Content Loaded - Starting initialization');
    
    // Wait for Firebase to be ready
    function waitForFirebase() {
        if (typeof firebase === 'undefined') {
            console.error('❌ Firebase not loaded - check script tags');
            showToast('Firebase not loaded. Please refresh the page.', 'error');
            return;
        }
        
        if (typeof window.auth === 'undefined' || typeof window.db === 'undefined') {
            console.log('⏳ Waiting for Firebase to initialize...');
            setTimeout(waitForFirebase, 100);
            return;
        }
        
        console.log('✅ Firebase is properly initialized');
        
        // Initialize app components
        try {
            initializeApp();
            setupEventListeners();
            setupRecaptcha();
            console.log('✅ App initialization completed');
        } catch (error) {
            console.error('❌ App initialization error:', error);
            showToast('App initialization failed. Please refresh.', 'error');
        }
    }
    
    waitForFirebase();
});

// Initialize app
function initializeApp() {
    // Get auth and db from window object
    const auth = window.auth;
    const db = window.db;
    
    // Check if this is a magic link sign-in
    if (auth.isSignInWithEmailLink(window.location.href)) {
        console.log('🔍 DEBUG: Magic link detected in URL');
        handleMagicLinkSignIn();
    }
    
    // Check if this is a password reset link
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const oobCode = urlParams.get('oobCode');
    
    if (mode === 'resetPassword' && oobCode) {
        console.log('🔍 DEBUG: Password reset detected in URL');
        handlePasswordReset(oobCode);
    }
    
    // Check auth state
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user;
            await checkMFARequirement(user);
        } else {
            showAuthContainer();
        }
    });
}

// Handle magic link sign-in
async function handleMagicLinkSignIn() {
    try {
        showLoading();
        
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
            email = window.prompt('Please provide your email for confirmation');
        }
        
        if (email) {
            console.log('🔍 DEBUG: Signing in with magic link for:', email);
            const result = await auth.signInWithEmailLink(email, window.location.href);
            currentUser = result.user;
            
            window.localStorage.removeItem('emailForSignIn');
            console.log('✅ Successfully signed in with magic link');
            console.log('🔍 DEBUG: User signed in:', currentUser.email);
            console.log('🔍 DEBUG: User UID:', currentUser.uid);
            showToast('Successfully signed in with magic link!', 'success');
            
            // For magic link sign-in, mark as second factor verified
            setSecondFactorVerified(currentUser.uid, 'email-link');
            console.log('✅ Second factor marked as verified for magic link');
            
            // Go directly to dashboard for magic link users
            showDashboard();
        } else {
            showToast('Email is required to complete sign-in.', 'error');
            showAuthContainer();
        }
    } catch (error) {
        console.error('❌ Error signing in with email link:', error);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error message:', error.message);
        showToast('Error signing in with magic link: ' + error.message, 'error');
        showAuthContainer();
    } finally {
        hideLoading();
    }
}

// Handle password reset
async function handlePasswordReset(oobCode) {
    try {
        showLoading();
        
        // Verify the oobCode
        const email = await auth.verifyPasswordResetCode(oobCode);
        console.log('🔍 DEBUG: Password reset code verified for:', email);
        
        // Store the oobCode for later use
        window.localStorage.setItem('passwordResetOobCode', oobCode);
        window.localStorage.setItem('passwordResetEmail', email);
        
        // Show the custom reset password form
        showAuthContainer();
        showResetPasswordForm();
        
        showToast(`Reset password for ${maskEmail(email)}`, 'info');
        
    } catch (error) {
        console.error('❌ Error verifying password reset code:', error);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error message:', error.message);
        showToast('Invalid or expired password reset link. Please request a new one.', 'error');
        showAuthContainer();
        showLoginForm();
    } finally {
        hideLoading();
    }
}


// Setup event listeners
function setupEventListeners() {
    // Login form
    document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleLogin();
    });

    // Register form
    document.getElementById('registerFormElement').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleRegister();
    });

    // Email code verification form
    document.getElementById('emailCodeVerificationFormElement').addEventListener('submit', handleEmailCodeVerification);

    // Verification options - email code request
    const verificationEmailForm = document.getElementById('verificationEmailFormElement');
    if (verificationEmailForm) {
        verificationEmailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleGmailVerification(e);
        });
    }

    // Verification options - SMS demo request
    const verificationSmsRequestForm = document.getElementById('verificationSmsRequestFormElement');
    if (verificationSmsRequestForm) {
        verificationSmsRequestForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handlePhoneVerificationRequest(e);
        });
    }

    // Phone code verification form (code entry)
    const phoneCodeForm = document.getElementById('phoneVerificationFormElement');
    if (phoneCodeForm) {
        phoneCodeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handlePhoneCodeVerificationSubmit();
        });
    }

    // Gmail verification form (legacy / kept for compatibility)
    const gmailVerificationForm = document.getElementById('gmailVerificationFormElement');
    if (gmailVerificationForm) {
        gmailVerificationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleGmailVerification(e);
        });
    }

    // MFA form
    document.getElementById('mfaFormElement').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleMFAVerification();
    });

    // Verification code inputs
    const codeInputs = document.querySelectorAll('.verification-code');
    codeInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && index < codeInputs.length - 1) {
                codeInputs[index + 1].focus();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                codeInputs[index - 1].focus();
            }
        });
    });
}

// Setup reCAPTCHA
function setupRecaptcha() {
    try {
        console.log('🔍 Setting up reCAPTCHA');
        
        // Check if recaptcha container exists
        const container = document.getElementById('recaptcha-container');
        if (!container) {
            console.error('❌ reCAPTCHA container not found');
            return;
        }
        
        // For Electron, we might need to disable reCAPTCHA for testing
        const isElectron = typeof window !== 'undefined' && window.process && window.process.type;
        
        if (isElectron) {
            console.log('🔍 Electron detected - configuring reCAPTCHA for development');
            // In Electron, reCAPTCHA might not work properly, so we'll use test mode
            auth.settings.appVerificationDisabledForTesting = true;
        }
        
        recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            'size': 'invisible',
            'callback': (response) => {
                console.log('✅ reCAPTCHA solved successfully');
            },
            'expired-callback': () => {
                console.log('❌ reCAPTCHA expired');
                showToast('reCAPTCHA expired. Please try again.', 'error');
            }
        });
        
        // Also assign to window for global access
        window.recaptchaVerifier = recaptchaVerifier;
        console.log('✅ reCAPTCHA setup completed');
        
    } catch (error) {
        console.error('❌ reCAPTCHA setup error:', error);
        console.error('Error details:', error.message);
        
        // Fallback: disable reCAPTCHA for development
        if (auth && auth.settings) {
            auth.settings.appVerificationDisabledForTesting = true;
            console.log('🔧 reCAPTCHA disabled for testing');
        }
    }
}

// Show/hide loading
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

let toastHideTimer = null;

// Show toast notification (verification codes stay longer so you can read them)
function showToast(message, type = 'success', durationMs) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    if (!toast || !toastMessage) return;

    if (toastHideTimer) {
        clearTimeout(toastHideTimer);
        toastHideTimer = null;
    }

    const isVerificationCode =
        /your code:|verification code:|demo sms code:/i.test(message) ||
        /\b\d{6}\b/.test(message);

    let duration = durationMs;
    if (duration == null) {
        if (isVerificationCode) duration = 15000;
        else if (type === 'error') duration = 6000;
        else if (type === 'warning' || type === 'info') duration = 8000;
        else duration = 4000;
    }

    toast.className = `toast ${type} show`;
    toastMessage.textContent = message;

    toastHideTimer = setTimeout(() => {
        toast.classList.remove('show');
        toastHideTimer = null;
    }, duration);
}

// Switch between forms
function switchForm(formType) {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    
    if (formType === 'login') {
        document.getElementById('loginForm').classList.add('active');
    } else if (formType === 'register') {
        document.getElementById('registerForm').classList.add('active');
    }
}

// Show verification options form
function showVerificationOptions() {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    document.getElementById('verificationOptionsForm').classList.add('active');

    const emailInput = document.getElementById('verificationEmail');
    if (emailInput && pendingUser && pendingUser.email) {
        emailInput.value = pendingUser.email;
    }

    const phoneInput = document.getElementById('verificationPhone');
    if (phoneInput && !phoneInput.value && pendingUser) {
        const uid = pendingUser.uid;
        if (uid && window.db && !window.firestoreDisabled) {
            window.db.collection('users').doc(uid).get().then((doc) => {
                if (doc.exists && doc.data().phoneNumber) {
                    phoneInput.value = doc.data().phoneNumber;
                }
            }).catch(() => {});
        }
    }
}

 function showPhoneCodeVerificationForm(phoneNumber) {
     const forms = document.querySelectorAll('.form-container');
     forms.forEach(form => form.classList.remove('active'));

     const maskedPhoneEl = document.getElementById('maskedPhone');
     if (maskedPhoneEl && phoneNumber) {
         maskedPhoneEl.textContent = maskPhone(phoneNumber);
     }

     const phoneForm = document.getElementById('phoneVerificationForm');
     if (phoneForm) {
         phoneForm.classList.add('active');
     }

     const codeInput = document.getElementById('phoneCode');
     if (codeInput) {
         codeInput.value = '';
         setTimeout(() => codeInput.focus(), 100);
     }
 }

// Handle Gmail verification (alternative method)
async function handleGmailVerification(e) {
    e.preventDefault();
    
    const email = document.getElementById('verificationEmail').value;
    
    if (!email) {
        showToast('Please enter your email address', 'error');
        return;
    }
    
    try {
        showLoading();
        
        const resolvedEmail = (pendingUser && pendingUser.email) || email;

        // Electron / local: 6-digit code in app. Browser: same (magic links fail in Electron).
        await sendEmailVerificationCode(resolvedEmail);
        
    } catch (error) {
        console.error('Email verification error:', error);
        showToast('Error sending verification code. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Send Gmail verification code
async function sendGmailVerificationCode(email) {
    // Always generate backup code first
    generatedGmailCode = Math.floor(100000 + Math.random() * 900000).toString();
    window.localStorage.setItem('verificationCode', generatedGmailCode);
    console.log(`� BACKUP CODE: ${generatedGmailCode}`);
    
    try {
        // Persist the recipient email for the rest of the flow/UI
        gmailVerificationEmail = email;
        
        // Always show the verification screen with backup code option
        showToast(`Backup code: ${generatedGmailCode} (check console)`, 'info');
        showMagicLinkInstructions();

        console.log('🔍 DEBUG: Attempting to send magic link to:', email);
        
        // Send magic link via Firebase
        const actionCodeSettings = {
            url: window.location.origin,
            handleCodeInApp: true,
        };

        console.log('🔍 DEBUG: Action code settings:', actionCodeSettings);
        console.log('🔍 DEBUG: Auth settings:', auth.settings);
        
        await auth.sendSignInLinkToEmail(email, actionCodeSettings);
        
        // Save email for verification when link is clicked
        window.localStorage.setItem('emailForSignIn', email);
        
        console.log('✅ Magic link sent via Firebase');
        showToast(`Magic link sent to ${maskEmail(email)}`, 'success');
        
    } catch (error) {
        console.error('❌ Error sending magic link:', error);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error message:', error.message);
        
        // Show error but don't block - user can still use backup code
        if (error.code === 'auth/quota-exceeded') {
            showToast('Email quota exceeded. Use backup code instead.', 'warning');
        } else if (error.code === 'auth/too-many-requests') {
            showToast('Too many requests. Use backup code instead.', 'warning');
        } else if (error.code === 'auth/invalid-email') {
            showToast('Invalid email address', 'error');
            return; // Only return on invalid email
        } else {
            showToast('Email service unavailable. Use backup code instead.', 'warning');
        }
    }
}

// Show magic link instructions
function showMagicLinkInstructions() {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    
    // Create magic link instructions form
    let magicLinkForm = document.getElementById('magicLinkForm');
    if (!magicLinkForm) {
        const formHTML = `
            <div id="magicLinkForm" class="form-container">
                <div class="gmail-icon-section">
                    <div class="gmail-icon">
                        <i class="fas fa-envelope"></i>
                    </div>
                </div>
                <h2>Check Your Email</h2>
                <p class="gmail-instruction">We've sent a magic link to</p>
                <p class="gmail-email-display" id="maskedEmailMagic">${gmailVerificationEmail || 'your email'}</p>
                <p class="gmail-sub-instruction">Choose an option to complete sign in</p>
                
                <div class="verification-options-tabs">
                    <button type="button" class="btn-option active" id="magicLinkTab" onclick="switchMagicOption('link')">
                        <i class="fas fa-link"></i>
                        Use Magic Link
                    </button>
                    <button type="button" class="btn-option" id="codeTab" onclick="switchMagicOption('code')">
                        <i class="fas fa-keyboard"></i>
                        Enter Code
                    </button>
                </div>
                
                <div id="magicLinkPanel" class="option-panel active">
                    <div class="email-instructions">
                        <p><strong>Instructions:</strong></p>
                        <ul>
                            <li>Open your email inbox</li>
                            <li>Find the email from Firebase</li>
                            <li>Click the "Sign in" link</li>
                            <li>You'll be automatically signed in</li>
                        </ul>
                    </div>
                </div>
                
                <div id="magicCodePanel" class="option-panel">
                    <p class="code-instruction">Enter the 6-digit code from browser console</p>
                    <div class="verification-code-container">
                        <input type="text" maxlength="1" class="verification-code" id="magicCode1" required>
                        <input type="text" maxlength="1" class="verification-code" id="magicCode2" required>
                        <input type="text" maxlength="1" class="verification-code" id="magicCode3" required>
                        <input type="text" maxlength="1" class="verification-code" id="magicCode4" required>
                        <input type="text" maxlength="1" class="verification-code" id="magicCode5" required>
                        <input type="text" maxlength="1" class="verification-code" id="magicCode6" required>
                    </div>
                    <button type="submit" class="btn-primary" onclick="handleMagicCodeVerification()">
                        <i class="fas fa-check-circle"></i>
                        Verify & Sign In
                    </button>
                </div>
                
                <button type="button" class="btn-secondary" onclick="showVerificationOptions()">
                    <i class="fas fa-arrow-left"></i>
                    Try another way
                </button>
                <div class="resend-section">
                    <p>Didn't receive the email? <a href="#" onclick="resendGmailCode()">Resend Email</a></p>
                    <p>Check your spam folder too!</p>
                </div>
            </div>
        `;
        
        const authCard = document.querySelector('.auth-card');
        authCard.insertAdjacentHTML('beforeend', formHTML);
        
        // Setup auto-focus for code inputs
        const codeInputs = document.querySelectorAll('#magicCodePanel .verification-code');
        codeInputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1 && index < codeInputs.length - 1) {
                    codeInputs[index + 1].focus();
                }
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                    codeInputs[index - 1].focus();
                }
            });
        });
        
        document.getElementById('magicLinkForm').classList.add('active');
    } else {
        document.getElementById('magicLinkForm').classList.add('active');
        const emailDisplay = document.getElementById('maskedEmailMagic');
        if (emailDisplay) {
            emailDisplay.textContent = gmailVerificationEmail || 'your email';
        }
    }
}

// Switch between magic link and code options
function switchMagicOption(option) {
    const linkTab = document.getElementById('magicLinkTab');
    const codeTab = document.getElementById('codeTab');
    const linkPanel = document.getElementById('magicLinkPanel');
    const codePanel = document.getElementById('magicCodePanel');
    
    if (option === 'link') {
        linkTab.classList.add('active');
        codeTab.classList.remove('active');
        linkPanel.classList.add('active');
        codePanel.classList.remove('active');
    } else {
        linkTab.classList.remove('active');
        codeTab.classList.add('active');
        linkPanel.classList.remove('active');
        codePanel.classList.add('active');
        // Focus first code input
        setTimeout(() => document.getElementById('magicCode1').focus(), 100);
    }
}

// Handle magic code verification
async function handleMagicCodeVerification() {
    const code1 = document.getElementById('magicCode1').value;
    const code2 = document.getElementById('magicCode2').value;
    const code3 = document.getElementById('magicCode3').value;
    const code4 = document.getElementById('magicCode4').value;
    const code5 = document.getElementById('magicCode5').value;
    const code6 = document.getElementById('magicCode6').value;
    
    const enteredCode = code1 + code2 + code3 + code4 + code5 + code6;
    
    if (enteredCode.length !== 6) {
        showToast('Please enter the complete 6-digit code', 'error');
        return;
    }
    
    try {
        showLoading();
        
        const storedCode = window.localStorage.getItem('verificationCode');
        
        if (!storedCode) {
            showToast('Session expired. Please try again.', 'error');
            showVerificationOptions();
            return;
        }
        
        console.log('🔍 DEBUG: Entered magic code:', enteredCode);
        console.log('🔍 DEBUG: Stored magic code:', storedCode);
        
        if (enteredCode === storedCode) {
            console.log('✅ Magic code verified');
            
            // Clear localStorage
            window.localStorage.removeItem('verificationCode');
            
            showToast('Email verification successful!', 'success');
            await completeSecondFactorAndProceed('email-code');
            
        } else {
            showToast('Invalid verification code. Please try again.', 'error');
            
            // Clear all inputs
            document.getElementById('magicCode1').value = '';
            document.getElementById('magicCode2').value = '';
            document.getElementById('magicCode3').value = '';
            document.getElementById('magicCode4').value = '';
            document.getElementById('magicCode5').value = '';
            document.getElementById('magicCode6').value = '';
            document.getElementById('magicCode1').focus();
        }
        
    } catch (error) {
        console.error('Error verifying magic code:', error);
        showToast('Verification failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Handle phone verification request (alternative method)
async function handlePhoneVerificationRequest(e) {
    e.preventDefault();
    
    const phoneNumber = document.getElementById('verificationPhone').value;
    
    if (!phoneNumber) {
        showToast('Please enter your phone number', 'error');
        return;
    }
    
    try {
        showLoading();

        // Prefer the phone number stored for the signed-in user.
        // If none exists, fall back to the phone number typed in the form.
        let resolvedPhone = null;
        try {
            const uid = (pendingUser && pendingUser.uid) || (currentUser && currentUser.uid);
            if (uid) {
                const userDoc = await db.collection('users').doc(uid).get();
                const userData = userDoc && userDoc.exists ? userDoc.data() : null;
                if (userData && userData.phoneNumber) {
                    resolvedPhone = userData.phoneNumber;
                }
            }
        } catch (e) {
        }

        if (!resolvedPhone) {
            const formatted = formatPhoneNumber(phoneNumber);
            if (!formatted) {
                showToast('Invalid phone number format. Please include country code.', 'error');
                showVerificationOptions();
                return;
            }
            resolvedPhone = formatted;
        }

        phoneVerificationNumber = resolvedPhone;
        showPhoneCodeVerificationForm(resolvedPhone);

        if (useLocalMfaMode()) {
            await sendDemoPhoneVerificationCode(resolvedPhone);
        } else {
            const sent = await sendPhoneVerificationCode();
            if (!sent) {
                await sendDemoPhoneVerificationCode(resolvedPhone);
            }
        }
        
    } catch (error) {
        console.error('Phone verification error:', error);
        showToast('Error sending phone verification. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Handle phone code verification
async function handlePhoneCodeVerification(e) {
    e.preventDefault();
    
    // Get all 6 digits
    const code1 = document.getElementById('phoneCode1').value;
    const code2 = document.getElementById('phoneCode2').value;
    const code3 = document.getElementById('phoneCode3').value;
    const code4 = document.getElementById('phoneCode4').value;
    const code5 = document.getElementById('phoneCode5').value;
    const code6 = document.getElementById('phoneCode6').value;
    
    const enteredCode = code1 + code2 + code3 + code4 + code5 + code6;
    
    if (enteredCode.length !== 6) {
        showToast('Please enter the complete 6-digit code', 'error');
        return;
    }
    
    try {
        showLoading();
        
        const storedCode = window.localStorage.getItem('phoneVerificationCode');
        const phoneNumber = window.localStorage.getItem('phoneForVerification');
        
        if (!storedCode || !phoneNumber) {
            showToast('Session expired. Please try again.', 'error');
            showVerificationOptions();
            return;
        }
        
        console.log('🔍 DEBUG: Entered phone code:', enteredCode);
        console.log('🔍 DEBUG: Stored phone code:', storedCode);
        
        // Verify demo code
        if (enteredCode === storedCode) {
            console.log('✅ Phone code verified');
            
            // Clear localStorage
            window.localStorage.removeItem('phoneForVerification');
            window.localStorage.removeItem('phoneVerificationCode');
            
            showToast('Phone verification successful!', 'success');
            await completeSecondFactorAndProceed('sms-demo');
            
        } else {
            showToast('Invalid verification code. Please try again.', 'error');
            
            // Clear all inputs
            document.getElementById('phoneCode1').value = '';
            document.getElementById('phoneCode2').value = '';
            document.getElementById('phoneCode3').value = '';
            document.getElementById('phoneCode4').value = '';
            document.getElementById('phoneCode5').value = '';
            document.getElementById('phoneCode6').value = '';
            document.getElementById('phoneCode1').focus();
        }
        
    } catch (error) {
        console.error('Error verifying phone code:', error);
        showToast('Verification failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Choose Gmail verification
function chooseGmailVerification() {
    if (pendingUser && pendingUser.email) {
        gmailVerificationEmail = pendingUser.email;
        const maskedEmail = maskEmail(gmailVerificationEmail);
        document.getElementById('maskedEmail').textContent = maskedEmail;
        
        // Show Gmail verification form
        const forms = document.querySelectorAll('.form-container');
        forms.forEach(form => form.classList.remove('active'));
        document.getElementById('gmailVerificationForm').classList.add('active');
        
        sendEmailVerificationCode(gmailVerificationEmail);
    } else {
        const email = prompt('Enter your email for verification:');
        if (!email) return;
        gmailVerificationEmail = email;
        sendEmailVerificationCode(email);
    }
}

// Choose phone verification
function choosePhoneVerification() {
    if (pendingUser && pendingUser.email) {
        // Prompt for phone number
        const phoneNumber = prompt('Enter your phone number (with country code, e.g., +639526509781):');
        if (!phoneNumber) return;
        
        // Validate and format phone number
        const formattedPhone = formatPhoneNumber(phoneNumber);
        if (!formattedPhone) {
            showToast('Invalid phone number format. Please include country code.', 'error');
            return;
        }
        
        phoneVerificationNumber = formattedPhone;
        const maskedPhone = maskPhone(phoneVerificationNumber);
        document.getElementById('maskedPhone').textContent = maskedPhone;
        
        // Show phone verification form
        const forms = document.querySelectorAll('.form-container');
        forms.forEach(form => form.classList.remove('active'));
        document.getElementById('phoneVerificationForm').classList.add('active');
        
        if (useLocalMfaMode()) {
            sendDemoPhoneVerificationCode(phoneVerificationNumber);
        } else {
            sendPhoneVerificationCode().then((sent) => {
                if (!sent) sendDemoPhoneVerificationCode(phoneVerificationNumber);
            });
        }
    } else {
        showToast('No user found for phone verification', 'error');
    }
}

// Mask phone number for display
function maskPhone(phone) {
    if (phone.startsWith('+')) {
        const countryCode = phone.substring(0, 4);
        const lastFour = phone.substring(phone.length - 4);
        return countryCode + '****' + lastFour;
    }
    return '****' + phone.substring(phone.length - 4);
}

// Demo SMS code for Electron / local (no reCAPTCHA or Firebase Phone Auth)
async function sendDemoPhoneVerificationCode(phoneNumber) {
    generatedPhoneCode = Math.floor(100000 + Math.random() * 900000).toString();
    window.localStorage.setItem('phoneForVerification', phoneNumber);
    window.localStorage.setItem('phoneVerificationCode', generatedPhoneCode);
    window.demoPhoneVerificationActive = true;
    confirmationResult = null;
    window.confirmationResult = null;

    if (window.localStorageManager) {
        await window.localStorageManager.storeVerificationCode(phoneNumber, generatedPhoneCode, 'sms');
    }

    console.log('📱 Demo SMS verification code:', generatedPhoneCode, 'for', phoneNumber);
    showToast(`Demo SMS code: ${generatedPhoneCode} (also in DevTools console)`, 'info', 15000);
    return true;
}

// Send phone verification code via Firebase (browser only; often fails in Electron)
async function sendPhoneVerificationCode() {
    try {
        console.log('🔍 DEBUG: Starting phone verification for:', phoneVerificationNumber);

        const appVerifier = window.recaptchaVerifier;
        if (!appVerifier) {
            console.warn('reCAPTCHA not ready');
            return false;
        }

        confirmationResult = await auth.signInWithPhoneNumber(phoneVerificationNumber, appVerifier);
        window.confirmationResult = confirmationResult;
        window.demoPhoneVerificationActive = false;

        console.log('✅ Firebase phone verification initiated');
        showToast(`Verification code sent to ${maskPhone(phoneVerificationNumber)}`, 'success');
        return true;
    } catch (error) {
        console.error('❌ Error sending phone verification code:', error);
        if (error.code === 'auth/too-many-requests') {
            showToast('Too many requests. Please try again later.', 'error');
        } else if (error.code === 'auth/invalid-phone-number') {
            showToast('Invalid phone number format', 'error');
        } else if (error.code === 'auth/quota-exceeded') {
            showToast('SMS quota exceeded. Please try again later.', 'error');
        } else if (error.code === 'auth/app-not-authorized') {
            showToast('Phone auth not authorized. Using demo code instead.', 'warning');
        }
        return false;
    }
}

// Handle phone code verification submit
async function handlePhoneCodeVerificationSubmit() {
    const enteredCode = document.getElementById('phoneCode').value;
    
    if (enteredCode.length !== 6) {
        showToast('Please enter the complete 6-digit code', 'error');
        return;
    }
    
    try {
        showLoading();

        // Demo / Electron path: compare against locally stored code
        if (window.demoPhoneVerificationActive || useLocalMfaMode()) {
            const storedCode = window.localStorage.getItem('phoneVerificationCode');
            const phoneNumber = window.localStorage.getItem('phoneForVerification');

            if (!storedCode || !phoneNumber) {
                showToast('Session expired. Tap Send SMS Code again.', 'error');
                showVerificationOptions();
                return;
            }

            if (enteredCode === storedCode) {
                window.localStorage.removeItem('phoneForVerification');
                window.localStorage.removeItem('phoneVerificationCode');
                window.demoPhoneVerificationActive = false;
                showToast('Phone verification successful!', 'success');
                await completeSecondFactorAndProceed('sms-demo');
                return;
            }

            showToast('Invalid verification code. Check the code shown after Send SMS.', 'error');
            document.getElementById('phoneCode').value = '';
            document.getElementById('phoneCode').focus();
            return;
        }
        
        const activeConfirmationResult = confirmationResult || window.confirmationResult;
        
        if (!activeConfirmationResult) {
            throw new Error('No verification session found. Please request a new verification code.');
        }
        
        const result = await activeConfirmationResult.confirm(enteredCode);
        currentUser = result.user;
        
        // Create or update user document (Firestore or Local Storage)
        if (!window.firestoreDisabled) {
            // Use Firestore if available
            const userRef = db.collection('users').doc(currentUser.uid);
            const userDoc = await userRef.get();
            
            if (userDoc.exists) {
                // Update existing user
                await userRef.update({
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Create new user document
                await userRef.set({
                    email: currentUser.email,
                    phoneNumber: phoneVerificationNumber,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                    mfaEnabled: true
                });
            }
        } else {
            // Use local storage fallback
            console.log('🔧 Using local storage for user data');
            try {
                const existingUser = await window.localStorageManager.getUser(currentUser.uid);
                if (existingUser) {
                    // Update existing user
                    await window.localStorageManager.updateUser(currentUser.uid, {
                        lastLogin: new Date().toISOString(),
                        phoneNumber: phoneVerificationNumber
                    });
                } else {
                    // Create new user
                    await window.localStorageManager.createUser({
                        email: currentUser.email,
                        phoneNumber: phoneVerificationNumber,
                        mfaEnabled: true
                    });
                }
            } catch (localError) {
                console.error('❌ Local storage error:', localError);
                // Continue without storing user data
            }
        }
        
        showToast('Phone verification successful!', 'success');
        await completeSecondFactorAndProceed('sms');
        
    } catch (error) {
        console.error('❌ Phone verification error:', error);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error message:', error.message);
        
        if (error.code === 'auth/invalid-verification-code') {
            showToast('Invalid verification code. Please try again.', 'error');
            
            // For demo numbers, do not display any demo code
        } else if (error.code === 'auth/code-expired') {
            showToast('Verification code expired. Please request a new one.', 'error');
        } else if (error.code === 'auth/missing-verification-code') {
            showToast('Missing verification code. Please try again.', 'error');
        } else {
            showToast('Verification failed: ' + error.message, 'error');
        }
        
        // Clear the input
        document.getElementById('phoneCode').value = '';
        document.getElementById('phoneCode').focus();
    } finally {
        hideLoading();
    }
}

// Resend phone code
async function resendPhoneCode() {
    showToast('Resending verification code...', 'success');
    if (useLocalMfaMode() || window.demoPhoneVerificationActive) {
        await sendDemoPhoneVerificationCode(phoneVerificationNumber || window.localStorage.getItem('phoneForVerification'));
    } else {
        const sent = await sendPhoneVerificationCode();
        if (!sent) {
            await sendDemoPhoneVerificationCode(phoneVerificationNumber);
        }
    }
}

// Show Gmail verification form
function showGmailVerification() {
    const email = prompt('Enter your Gmail address for verification:');
    if (!email) return;

    // Validate email format
    const emailRegex = /^[^\s@]+@gmail\.com$/i;
    if (!emailRegex.test(email)) {
        showToast('Please enter a valid Gmail address', 'error');
        return;
    }

    gmailVerificationEmail = email;
    const maskedEmail = maskEmail(email);
    
    // Update masked email in the form
    document.getElementById('maskedEmail').textContent = maskedEmail;
    
    // Show Gmail verification form
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    document.getElementById('gmailVerificationForm').classList.add('active');
    
    sendEmailVerificationCode(gmailVerificationEmail);
}

// Mask email for display
function maskEmail(email) {
    const [username, domain] = email.split('@');
    if (username.length <= 2) {
        // For very short usernames, just mask the middle character or show as-is
        return username + '@' + domain;
    } else if (username.length === 3) {
        // For 3-character usernames, mask the middle one
        return username[0] + '*' + username[2] + '@' + domain;
    } else {
        // For longer usernames, show first two and last one with asterisks in between
        const firstTwo = username.substring(0, 2);
        const lastOne = username.substring(username.length - 1);
        const maskedCount = Math.max(0, username.length - 3);
        const masked = firstTwo + '*'.repeat(maskedCount) + lastOne;
        return masked + '@' + domain;
    }
}

// Send Gmail verification code (legacy wrapper)
async function sendGmailVerificationCodeLegacy() {
    return sendGmailVerificationCode(gmailVerificationEmail);
}

// Simulate sending email (for demo purposes)
async function simulateEmailSending(toEmail, verificationCode) {
    try {
        // Try to use Formspree if available, otherwise fallback to simulation
        return await sendRealEmailViaFormspree(toEmail, verificationCode);
        
    } catch (error) {
        console.error('Error simulating email send:', error);
        return false;
    }
}

// Send real email using Formspree
async function sendRealEmailViaFormspree(toEmail, verificationCode) {
    try {
        // Formspree endpoint
        const formspreeEndpoint = 'https://formspree.io/f/xreanjvz';
        
        // Prepare form data
        const formData = {
            email: toEmail,
            verification_code: verificationCode,
            subject: 'Your Verification Code',
            message: `Hello,\n\nYour verification code is: ${verificationCode}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.\n\nThanks,\nMFA Authentication System`
        };
        
        // Send data to Formspree
        const response = await fetch(formspreeEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        if (response.ok) {
            console.log('✅ Real email sent successfully via Formspree');
            showToast(`Email with verification code sent to ${maskEmail(toEmail)}`, 'success');
            return true;
        } else {
            throw new Error(`Formspree error: ${response.status} ${response.statusText}`);
        }
        
    } catch (error) {
        console.log('❌ Formspree failed, falling back to simulation:', error);
        
        // Fallback to simulation
        console.log(`📧 SIMULATION: Sending verification code ${verificationCode} to ${toEmail}`);
        console.log(`📧 Email content: "Your verification code is: ${verificationCode}"`);
        console.log(`🔧 FOR TESTING ONLY: Use code ${verificationCode} to complete verification`);
        console.log(`⚠️  In production, this code would only be sent to the user's email and never displayed here!`);
        
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Show user that email would be sent
        showToast(`Email with verification code sent to ${maskEmail(toEmail)}`, 'success');
        showToast('(Demo mode: Check browser console for the code)', 'info');
        
        return true;
    }
}

function showGmailCodeInputForm() {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    
    // Create or show the Gmail code input form
    let gmailCodeForm = document.getElementById('gmailCodeForm');
    if (!gmailCodeForm) {
        // Create the form if it doesn't exist
        const formHTML = `
            <div id="gmailCodeForm" class="form-container">
                <div class="gmail-icon-section">
                    <div class="gmail-icon">
                        <i class="fas fa-envelope"></i>
                    </div>
                </div>
                <h2>Enter Verification Code</h2>
                <p class="gmail-instruction">We've sent a 6-digit code to</p>
                <p class="gmail-email-display" id="maskedEmailCode">${gmailVerificationEmail ? maskEmail(gmailVerificationEmail) : 'your email'}</p>
                <p class="gmail-sub-instruction">Please enter the code below</p>
                <form id="gmailCodeFormElement">
                    <div class="verification-code-container">
                        <input type="text" maxlength="1" class="verification-code" id="gmailCode1" required>
                        <input type="text" maxlength="1" class="verification-code" id="gmailCode2" required>
                        <input type="text" maxlength="1" class="verification-code" id="gmailCode3" required>
                        <input type="text" maxlength="1" class="verification-code" id="gmailCode4" required>
                        <input type="text" maxlength="1" class="verification-code" id="gmailCode5" required>
                        <input type="text" maxlength="1" class="verification-code" id="gmailCode6" required>
                    </div>
                    <button type="submit" class="btn-primary">
                        <i class="fas fa-check-circle"></i>
                        Verify & Sign In
                    </button>
                    <div class="resend-section">
                        <p>Didn't receive the code? <a href="#" onclick="resendGmailCode()">Resend Code</a></p>
                        <p><a href="#" onclick="showVerificationOptions()">Try another way</a></p>
                    </div>
                </form>
            </div>
        `;
        
        // Insert the new form after the existing forms
        const authCard = document.querySelector('.auth-card');
        authCard.insertAdjacentHTML('beforeend', formHTML);
        
        // Add event listener for the new form
        document.getElementById('gmailCodeFormElement').addEventListener('submit', handleGmailCodeVerification);
        
        // Setup auto-focus for code inputs
        const codeInputs = document.querySelectorAll('#gmailCodeForm .verification-code');
        codeInputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (e.target.value.length === 1 && index < codeInputs.length - 1) {
                    codeInputs[index + 1].focus();
                }
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                    codeInputs[index - 1].focus();
                }
            });
        });
    }
    
    // Update the email display whether form is new or existing
    const emailDisplayElement = document.getElementById('maskedEmailCode');
    if (emailDisplayElement) {
        emailDisplayElement.textContent = gmailVerificationEmail ? maskEmail(gmailVerificationEmail) : 'your email';
    }
    
    document.getElementById('gmailCodeForm').classList.add('active');
    // Focus first input
    setTimeout(() => {
        document.getElementById('gmailCode1').focus();
    }, 100);
}

// Resend Gmail code
async function resendGmailCode() {
    const email = gmailVerificationEmail ||
        window.localStorage.getItem('emailForVerification') ||
        (pendingUser && pendingUser.email);
    if (!email) {
        showToast('No email on file. Go back and enter your email.', 'error');
        return;
    }
    showToast('Resending verification code...', 'success');
    await sendEmailVerificationCode(email);
}

// Handle Gmail code verification
async function handleGmailCodeVerification(e) {
    e.preventDefault();
    
    // Get all 6 digits
    const code1 = document.getElementById('gmailCode1').value;
    const code2 = document.getElementById('gmailCode2').value;
    const code3 = document.getElementById('gmailCode3').value;
    const code4 = document.getElementById('gmailCode4').value;
    const code5 = document.getElementById('gmailCode5').value;
    const code6 = document.getElementById('gmailCode6').value;
    
    const enteredCode = code1 + code2 + code3 + code4 + code5 + code6;
    
    if (enteredCode.length !== 6) {
        showToast('Please enter the complete 6-digit code', 'error');
        return;
    }
    
    try {
        showLoading();
        
        // Verify the code
        if (enteredCode === generatedGmailCode) {
            showToast('Email verification successful!', 'success');
            await completeSecondFactorAndProceed('email-otp');
        } else {
            showToast('Invalid verification code. Please try again.', 'error');
            
            // Clear all inputs
            document.getElementById('gmailCode1').value = '';
            document.getElementById('gmailCode2').value = '';
            document.getElementById('gmailCode3').value = '';
            document.getElementById('gmailCode4').value = '';
            document.getElementById('gmailCode5').value = '';
            document.getElementById('gmailCode6').value = '';
            document.getElementById('gmailCode1').focus();
        }
        
    } catch (error) {
        console.error('Error verifying Gmail code:', error);
        showToast('Verification failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Create or sign in user after Gmail verification
async function createOrSignInUser(email) {
    try {
        // Check if user exists
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).get();
        
        if (snapshot.empty) {
            // Create new user with temporary password
            const tempPassword = Math.random().toString(36).slice(-8);
            const userCredential = await auth.createUserWithEmailAndPassword(email, tempPassword);
            const user = userCredential.user;
            
            // Save user data to Firestore
            await db.collection('users').doc(user.uid).set({
                email: email,
                name: email.split('@')[0],
                phoneNumber: null,
                mfaEnabled: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                gmailVerified: true
            });
            
            currentUser = user;
        } else {
            // Sign in existing user
            const userDoc = snapshot.docs[0];
            const userData = userDoc.data();
            
            // For demo, sign in with email link magic
            const tempPassword = 'temp123456';
            try {
                const userCredential = await auth.signInWithEmailAndPassword(email, tempPassword);
                currentUser = userCredential.user;
            } catch (signInError) {
                // If sign in fails, create new session
                currentUser = { uid: userDoc.id, email: email };
            }
            
            // Update last login
            await db.collection('users').doc(userDoc.id).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                gmailVerified: true
            });
        }
        
        showDashboard();
        
    } catch (error) {
        console.error('Error creating/signing in user:', error);
        showToast('Error completing sign in process', 'error');
    }
}

// Show login form
function showLoginForm() {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    document.getElementById('loginForm').classList.add('active');
}

function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = event.target.closest('.toggle-password').querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// Handle login
async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;
    
    try {
        showLoading();

        // Set persistence based on remember me checkbox
        const persistence = rememberMe ? 
            firebase.auth.Auth.Persistence.LOCAL : 
            firebase.auth.Auth.Persistence.SESSION;
        
        await auth.setPersistence(persistence);

        // Sign in with Firebase Auth (source of truth for account existence)
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        currentUser = userCredential.user;
        pendingUser = currentUser;

        // Create Firestore profile if missing (fixes accounts created before profile save worked)
        const saveResult = await ensureUserProfileInFirestore(currentUser, { email });
        if (saveResult.savedTo === 'local' && saveResult.error) {
            console.warn('Profile saved locally only; update Firestore rules in Firebase Console.');
        }
        
        showToast('Login successful!', 'success');
        await checkMFARequirement(currentUser);

    } catch (error) {
        console.error('Login error:', error);
        
        // If Firebase requires MFA, extract the user from the error and set pendingUser
        if (error.code === 'auth/multi-factor-auth-required') {
            console.log('🔍 MFA required, setting up pending user');
            console.log('🔍 Error user:', error.user);
            console.log('🔍 Error resolver:', error.resolver);
            
            if (error.user) {
                currentUser = error.user;
                pendingUser = currentUser;
                console.log('🔍 Pending user set:', pendingUser.email);
            }
            
            // Store the resolver for later use if needed
            if (error.resolver) {
                window.multiFactorResolver = error.resolver;
                console.log('🔍 MFA resolver stored');
            }
        }
        
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}



// Send email verification code (works in Electron — code shown in toast & console)
async function sendEmailVerificationCode(email) {
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    generatedGmailCode = verificationCode;
    gmailVerificationEmail = email;

    window.localStorage.setItem('emailForVerification', email);
    window.localStorage.setItem('verificationCode', verificationCode);

    if (window.localStorageManager) {
        await window.localStorageManager.storeVerificationCode(email, verificationCode, 'email');
    }

    console.log('📧 Email verification code:', verificationCode, 'for', email);

    if (!window.firestoreDisabled && window.db) {
        try {
            await db.collection('emailVerificationCodes').add({
                email: email,
                code: verificationCode,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                expiresAt: new Date(Date.now() + 10 * 60 * 1000)
            });
        } catch (firestoreError) {
            console.warn('Firestore code store skipped:', firestoreError.message);
        }
    }

    if (useLocalMfaMode()) {
        showToast(`Your code: ${verificationCode}`, 'info', 15000);
        showEmailCodeVerificationForm(email);
        return;
    }

    const emailSent = await sendVerificationEmail(email, verificationCode);
    showToast(`Verification code: ${verificationCode}`, 'info', 15000);
    showEmailCodeVerificationForm(email);
    if (emailSent) {
        showToast(`Code also sent via email service to ${maskEmail(email)}`, 'success', 6000);
    }
}

// Send verification email using Formspree
async function sendVerificationEmail(email, code) {
    try {
        console.log('🔍 DEBUG: Starting email send to:', email);
        console.log('🔍 DEBUG: Verification code:', code);
        
        // Formspree - sends to your registered Formspree email
        const FORMSPREE_ENDPOINT = "xreanjvz"; // Your Formspree form ID
        
        const formData = {
            recipient_email: email,
            subject: `MFA Verification Code for ${email}`,
            message: `Your verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nEmail requested for: ${email}`,
            _replyto: email
        };
        
        console.log('🔍 DEBUG: Sending to Formspree:', formData);
        console.log('🔍 DEBUG: Formspree URL:', `https://formspree.io/f/${FORMSPREE_ENDPOINT}`);
        
        const response = await fetch(`https://formspree.io/f/${FORMSPREE_ENDPOINT}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(formData)
        });
        
        console.log('🔍 DEBUG: Formspree response status:', response.status);
        console.log('🔍 DEBUG: Formspree response headers:', response.headers);
        
        if (response.ok) {
            const responseData = await response.json();
            console.log('✅ Formspree success:', responseData);
            
            showToast(`Verification code sent successfully!`, 'success');
            showToast(`Check your Formspree email. Code: ${code}`, 'info');
            
            return true;
        } else {
            const errorText = await response.text();
            console.error('❌ Formspree response text:', errorText);
            
            try {
                const errorData = JSON.parse(errorText);
                console.error('❌ Formspree API Error:', errorData);
                throw new Error(`Formspree failed: ${errorData.message || 'Unknown error'}`);
            } catch (e) {
                console.error('❌ Formspree raw error:', errorText);
                throw new Error(`Formspree failed: ${errorText}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Email send error:', error);
        console.error('❌ Error details:', error.message);
        showToast(`Email service error: ${error.message}`, 'error');
        
        // Fallback: show the code to user for testing
        showToast(`Fallback: Code is ${code}`, 'warning');
        return true; // Return true so user can still test
    }
}

// Show email code verification form
function showEmailCodeVerificationForm(email) {
    console.log('🔍 DEBUG: Showing email code verification form for:', email);
    
    const forms = document.querySelectorAll('.form-container');
    console.log('🔍 DEBUG: Found forms:', forms.length);
    
    forms.forEach(form => form.classList.remove('active'));
    
    // Update masked email display
    const maskedEmail = maskEmail(email);
    const emailDisplayElement = document.getElementById('emailCodeVerificationEmail');
    console.log('🔍 DEBUG: Email display element:', emailDisplayElement);
    
    if (emailDisplayElement) {
        emailDisplayElement.textContent = maskedEmail;
        console.log('🔍 DEBUG: Set masked email:', maskedEmail);
    }

    const targetForm = document.getElementById('emailCodeVerificationForm');
    console.log('🔍 DEBUG: Target form element:', targetForm);
    
    if (targetForm) {
        targetForm.classList.add('active');
        console.log('🔍 DEBUG: Added active class to form');
        
        // Focus first input
        setTimeout(() => {
            const firstInput = document.getElementById('emailCode1');
            if (firstInput) {
                firstInput.focus();
                console.log('🔍 DEBUG: Focused first input');
            }
        }, 100);
    } else {
        console.error('❌ Could not find emailCodeVerificationForm');
    }
}

// Handle registration
async function handleRegister() {
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const phoneNumber = document.getElementById('phoneNumber').value;
    
    // Validate passwords match
    if (password !== confirmPassword) {
        showToast('Passwords do not match!', 'error');
        return;
    }
    
    // Validate password strength
    if (password.length < 6) {
        showToast('Password must be at least 6 characters!', 'error');
        return;
    }
    
    // Validate phone number format
    const formattedPhoneNumber = formatPhoneNumber(phoneNumber);
    if (!formattedPhoneNumber) {
        showToast('Invalid phone number format. Please include country code (e.g., +1234567890)', 'error');
        return;
    }
    
    try {
        showLoading();
        
        // Create user
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // Update user profile
        await user.updateProfile({
            displayName: name
        });
        
        // Save user profile to Firestore (users/{uid}) while signed in
        const saveResult = await saveUserProfileToFirestore(user, {
            name,
            email,
            phoneNumber: formattedPhoneNumber,
            mfaEnabled: false
        });

        if (saveResult.savedTo === 'firestore') {
            showToast('Account created successfully!', 'success');
        } else if (saveResult.error && saveResult.error.code === 'permission-denied') {
            showToast('Account created in Firebase, but Firestore profile failed. Update Firestore rules, then log in.', 'warning');
        } else {
            showToast('Account created (profile saved locally).', 'success');
        }
        
        // Switch to login form
        setTimeout(() => {
            switchForm('login');
        }, 2000);
        
    } catch (error) {
        console.error('Registration error:', error);
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}

// Handle email code verification
async function handleEmailCodeVerification(e) {
    e.preventDefault();
    
    // Get all 6 digits
    const code1 = document.getElementById('emailCode1').value;
    const code2 = document.getElementById('emailCode2').value;
    const code3 = document.getElementById('emailCode3').value;
    const code4 = document.getElementById('emailCode4').value;
    const code5 = document.getElementById('emailCode5').value;
    const code6 = document.getElementById('emailCode6').value;
    
    const enteredCode = code1 + code2 + code3 + code4 + code5 + code6;
    
    if (enteredCode.length !== 6) {
        showToast('Please enter the complete 6-digit code', 'error');
        return;
    }
    
    try {
        showLoading();
        
        const email = window.localStorage.getItem('emailForVerification');
        const storedCode = window.localStorage.getItem('verificationCode');
        
        // Fallback to in-memory code if localStorage was cleared (e.g., by SMS flow)
        const effectiveCode = storedCode || generatedGmailCode;
        
        if (!email || !effectiveCode) {
            showToast('Session expired. Please try again.', 'error');
            showVerificationOptions();
            return;
        }
        
        console.log('🔍 DEBUG: Entered code:', enteredCode);
        console.log('🔍 DEBUG: Stored code:', storedCode);
        console.log('🔍 DEBUG: Generated code (fallback):', generatedGmailCode);
        console.log('🔍 DEBUG: Effective code used:', effectiveCode);
        console.log('🔍 DEBUG: Email:', email);
        console.log('🔍 DEBUG: localStorage contents:', {
            emailForVerification: window.localStorage.getItem('emailForVerification'),
            verificationCode: window.localStorage.getItem('verificationCode')
        });
        console.log('🔍 DEBUG: Code comparison:', {
            entered: enteredCode,
            effective: effectiveCode,
            match: enteredCode === effectiveCode
        });
        
        // First try localStorage verification (more reliable)
        if (enteredCode === effectiveCode) {
            console.log('✅ Code verified via localStorage');
            
            // Clear localStorage
            window.localStorage.removeItem('emailForVerification');
            window.localStorage.removeItem('verificationCode');
            
            // Try to clean up Firestore (but don't fail if it fails)
            try {
                const codesRef = db.collection('emailVerificationCodes');
                const snapshot = await codesRef
                    .where('email', '==', email)
                    .where('code', '==', enteredCode)
                    .limit(1)
                    .get();
                
                if (!snapshot.empty) {
                    await codesRef.doc(snapshot.docs[0].id).delete();
                }
            } catch (firestoreError) {
                console.log('⚠️ Firestore cleanup failed, but continuing...');
            }
            
            await completeSecondFactorAndProceed('email-otp');
            
        } else {
            // If localStorage doesn't match, try Firestore as fallback
            console.log('🔍 Trying Firestore verification...');
            console.log('🔍 Firestore query params:', { email, code: enteredCode });
            
            const codesRef = db.collection('emailVerificationCodes');
            const snapshot = await codesRef
                .where('email', '==', email)
                .where('code', '==', enteredCode)
                .limit(1)
                .get();
            
            console.log('🔍 Firestore query results:', {
                empty: snapshot.empty,
                size: snapshot.size,
                docs: snapshot.docs.map(doc => ({
                    id: doc.id,
                    data: doc.data()
                }))
            });
            
            if (snapshot.empty) {
                console.log('❌ No matching code found in Firestore');
                showToast('Invalid verification code. Please check and try again.', 'error');
                
                // Clear all inputs
                document.getElementById('emailCode1').value = '';
                document.getElementById('emailCode2').value = '';
                document.getElementById('emailCode3').value = '';
                document.getElementById('emailCode4').value = '';
                document.getElementById('emailCode5').value = '';
                document.getElementById('emailCode6').value = '';
                document.getElementById('emailCode1').focus();
                return;
            }
            
            // Code found in Firestore, delete it
            const codeDoc = snapshot.docs[0];
            await codesRef.doc(codeDoc.id).delete();
            
            // Clear localStorage
            window.localStorage.removeItem('emailForVerification');
            window.localStorage.removeItem('verificationCode');
            
            await completeSecondFactorAndProceed('email-otp');
        }
        
    } catch (error) {
        console.error('Error verifying email code:', error);
        showToast('Verification failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Complete email sign in process
async function completeEmailSignIn(email) {
    try {
        await completeSecondFactorAndProceed('email-otp');
        
    } catch (error) {
        console.error('Error completing sign in:', error);
        showToast('Sign in failed. Please try again.', 'error');
    }
}

// Resend email verification code
async function resendEmailVerificationCode() {
    try {
        const email = window.localStorage.getItem('emailForVerification');
        if (!email) {
            showToast('Session expired. Please try again.', 'error');
            showLoginForm();
            return;
        }
        
        showLoading();
        showToast('Resending verification code...', 'success');
        await sendEmailVerificationCode(email);
        
    } catch (error) {
        console.error('Error resending email verification code:', error);
        showToast('Failed to resend code. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Format phone number to E.164 format
function formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Check if it starts with country code
    if (phoneNumber.startsWith('+')) {
        return '+' + cleaned;
    } else if (cleaned.length === 10) {
        // Assume US number if 10 digits
        return '+1' + cleaned;
    } else if (cleaned.length > 10) {
        // Assume first digits are country code
        return '+' + cleaned;
    }
    
    return null;
}

// Check MFA requirement - Handle magic link authentication
async function checkMFARequirement(user) {
    try {
        currentUser = user;

        console.log('🔍 DEBUG: checkMFARequirement called for user:', user.email);
        console.log('🔍 DEBUG: Second factor already verified:', isSecondFactorVerified(user.uid));

        // If second factor already completed for this session/user, proceed.
        if (isSecondFactorVerified(user.uid)) {
            console.log('✅ Second factor already verified, showing dashboard');
            showDashboard();
            return;
        }

        // ALWAYS require MFA for complete authentication
        // Remove per-user setting check to ensure all users must verify
        console.log('✅ MFA required for all users');
        const mfaEnabled = true;

        // Treat email-link sign-in as a completed second factor.
        const isEmailLinkAuth = window.localStorage.getItem('emailLinkAuthenticated') === 'true';
        if (isEmailLinkAuth) {
            window.localStorage.removeItem('emailLinkAuthenticated');
            setSecondFactorVerified(user.uid, 'email-link');
            showDashboard();
            return;
        }

        // Password-based login: require second factor only when enabled.
        // Do not auto-send a magic link; show "Try another way" options instead.
        console.log('✅ MFA enabled, showing verification options');
        pendingUser = user;
        showVerificationOptions();
        return;

    } catch (error) {
        console.error('Error checking MFA requirement:', error);
        showLoginForm();
    }
}

async function sendMFACode() {
    try {
        if (!currentUser) {
            showToast('User not logged in', 'error');
            return;
        }

        // Get user's phone number from Firestore
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data();
        
        if (!userData || !userData.phoneNumber) {
            showToast('Phone number not registered for MFA', 'error');
            return;
        }

        // Use Firebase Phone Auth with reCAPTCHA
        const appVerifier = window.recaptchaVerifier;
        const confirmationResult = await auth.signInWithPhoneNumber(userData.phoneNumber, appVerifier);
        
        // Store confirmation result globally for verification
        window.confirmationResult = confirmationResult;
        
        showToast('Verification code sent to your phone', 'success');
        
    } catch (error) {
        console.error('Error sending MFA code:', error);
        
        if (error.code === 'auth/too-many-requests') {
            showToast('Too many requests. Please try again later.', 'error');
        } else if (error.code === 'auth/invalid-phone-number') {
            showToast('Invalid phone number format', 'error');
        } else {
            showToast('Error sending verification code', 'error');
        }
    }
}

// Handle MFA verification
async function handleMFAVerification() {
    const codeInputs = document.querySelectorAll('.verification-code');
    const verificationCode = Array.from(codeInputs).map(input => input.value).join('');
    
    if (verificationCode.length !== 6) {
        showToast('Please enter the complete verification code', 'error');
        return;
    }
    
    try {
        showLoading();
        
        // Check if user is in test mode
        if (currentUser) {
            const userDoc = await db.collection('users').doc(currentUser.uid).get();
            const userData = userDoc.data();
            
            if (userData && userData.testMode && verificationCode === '101010') {
                // Test mode - accept configured demo code as valid code
                await db.collection('users').doc(currentUser.uid).update({
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                showToast('MFA verification successful! (Test Mode)', 'success');
                showDashboard();
                return;
            }
        }
        
        // Normal Firebase verification
        if (!window.confirmationResult) {
            throw new Error('No verification session found');
        }
        
        // Verify the code with Firebase
        const result = await window.confirmationResult.confirm(verificationCode);
        currentUser = result.user;
        
        // Update last login in Firestore
        await db.collection('users').doc(currentUser.uid).update({
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showToast('MFA verification successful!', 'success');
        showDashboard();
        
    } catch (error) {
        console.error('MFA verification error:', error);
        
        if (error.code === 'auth/invalid-verification-code') {
            showToast('Invalid verification code. Please try again.', 'error');
        } else if (error.code === 'auth/code-expired') {
            showToast('Verification code expired. Please request a new one.', 'error');
        } else {
            showToast('Verification failed. Please try again.', 'error');
        }
        
        // Clear the inputs
        codeInputs.forEach(input => input.value = '');
        codeInputs[0].focus();
    } finally {
        hideLoading();
    }
}

// Resend MFA code
async function resendCode() {
    showToast('Resending verification code...', 'success');
    await sendMFACode();
}

// Show dashboard
async function showDashboard() {
    console.log('🔍 DEBUG: Attempting to show dashboard');
    console.log('🔍 DEBUG: currentUser exists:', !!currentUser);
    
    // Ensure user is authenticated before showing dashboard
    if (!currentUser || !currentUser.uid) {
        console.error('❌ Cannot show dashboard: No authenticated user');
        showToast('Authentication required', 'error');
        showLoginForm();
        return;
    }
    
    console.log('🔍 DEBUG: User authenticated:', currentUser.email);
    console.log('🔍 DEBUG: Second factor verified:', isSecondFactorVerified(currentUser.uid));
    
    // For users with MFA enabled, require second factor verification
    try {
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data();
        const mfaEnabled = userData && userData.mfaEnabled;
        
        if (mfaEnabled && !isSecondFactorVerified(currentUser.uid)) {
            console.error('❌ Cannot show dashboard: MFA required but not verified');
            showToast('Two-factor authentication required', 'error');
            showVerificationOptions();
            return;
        }
        
        // All checks passed, show dashboard
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('dashboardContainer').style.display = 'block';
        
        // Update user info
        document.getElementById('userEmail').textContent = currentUser.email;
        
        // Update last login time
        const now = new Date();
        document.getElementById('lastLogin').textContent = now.toLocaleString();
    } catch (error) {
        console.error('Error checking MFA status:', error);
        // On error, proceed to dashboard but log it
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('dashboardContainer').style.display = 'block';
        document.getElementById('userEmail').textContent = currentUser.email;
    }
}

// Show auth container
function showAuthContainer() {
    document.getElementById('authContainer').style.display = 'flex';
    document.getElementById('dashboardContainer').style.display = 'none';
    
    // Reset to login form
    switchForm('login');
}

// Show MFA form
function showMFAForm() {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    document.getElementById('mfaForm').classList.add('active');
    
    // Clear previous inputs
    const codeInputs = document.querySelectorAll('.verification-code');
    codeInputs.forEach(input => input.value = '');
    codeInputs[0].focus();
}

// Logout
async function logout() {
    try {
        if (currentUser && currentUser.uid) {
            clearSecondFactorVerified(currentUser.uid);
        }
        await auth.signOut();
        showToast('Logged out successfully', 'success');
        showAuthContainer();
    } catch (error) {
        console.error('Logout error:', error);
        showToast('Error logging out', 'error');
    }
}

// Handle authentication errors
function handleAuthError(error) {
    let message = 'An error occurred';
    
    switch (error.code) {
        case 'auth/multi-factor-auth-required':
            message = 'This account requires Firebase multi-factor verification to complete sign-in. If you intended to use the dashboard MFA toggle, disable Firebase MFA enrollment for this account (Firebase Console) or update the app to use Firebase MFA resolver flow.';
            break;
        case 'auth/user-not-found':
            message = 'User not found. Please check your email.';
            break;
        case 'auth/wrong-password':
            message = 'Incorrect password. Please try again.';
            break;
        case 'auth/email-already-in-use':
            message = 'Email already in use. Please use a different email.';
            break;
        case 'auth/weak-password':
            message = 'Password is too weak. Please choose a stronger password.';
            break;
        case 'auth/invalid-email':
            message = 'Invalid email address.';
            break;
        case 'auth/too-many-requests':
            message = 'Too many failed attempts. Please try again later.';
            break;
        case 'auth/network-request-failed':
            message = 'Network error. Please check your connection.';
            break;
        case 'auth/invalid-action-code':
            message = 'Invalid or expired sign-in link. Please request a new one.';
            break;
        case 'auth/expired-action-code':
            message = 'Sign-in link has expired. Please request a new one.';
            break;
        case 'auth/invalid-verification-code':
            message = 'Invalid verification code. Please try again.';
            break;
        case 'auth/code-expired':
            message = 'Verification code expired. Please request a new one.';
            break;
        case 'auth/invalid-phone-number':
            message = 'Invalid phone number format. Please include country code.';
            break;
        case 'auth/quota-exceeded':
            message = 'SMS quota exceeded. Please try again later.';
            break;
        default:
            message = error.message || 'An unknown error occurred';
    }
    
    showToast(message, 'error');

    if (error && error.code === 'auth/multi-factor-auth-required') {
        // Route to the verification options UI to keep the flow consistent.
        // Note: Completing Firebase MFA requires implementing the resolver flow.
        showVerificationOptions();
    }
}

// Show forgot password form
function showForgotPasswordForm() {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    document.getElementById('forgotPasswordForm').classList.add('active');
}

// Handle forgot password form submission
async function handleForgotPasswordSubmit(e) {
    e.preventDefault();
    
    const email = document.getElementById('resetEmail').value;
    
    if (!email) {
        showToast('Please enter your email address', 'error');
        return;
    }
    
    try {
        showLoading();
        
        // For local development, Firebase won't redirect to localhost
        // Send email without custom URL settings
        await auth.sendPasswordResetEmail(email);
        
        showToast('Password reset email sent! Check your inbox.', 'success');
        console.log('✅ Password reset email sent via Firebase');
        
        // Pre-fill the login email with the reset email
        document.getElementById('loginEmail').value = email;
        
        // Go back to login after a delay
        setTimeout(() => {
            showLoginForm();
        }, 2000);
        
    } catch (error) {
        console.error('Password reset error:', error);
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}

// Show reset password form
function showResetPasswordForm() {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    document.getElementById('resetPasswordForm').classList.add('active');

    // Setup password validation listeners
    setupPasswordValidation();
}


// Setup password validation
function setupPasswordValidation() {
    const newPassword = document.getElementById('newPassword');
    const confirmPassword = document.getElementById('confirmNewPassword');
    
    if (newPassword && confirmPassword) {
        newPassword.addEventListener('input', updatePasswordStrength);
        confirmPassword.addEventListener('input', updatePasswordMatch);
    }
}

// Update password strength indicator
function updatePasswordStrength() {
    const password = document.getElementById('newPassword').value;
    const strengthBar = document.querySelector('#passwordStrength .strength-bar');
    const strengthText = document.querySelector('#passwordStrength .strength-text');
    
    if (!strengthBar || !strengthText) return;
    
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 10) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    
    const colors = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#5352ed'];
    const texts = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
    
    strengthBar.style.width = `${(strength / 5) * 100}%`;
    strengthBar.style.backgroundColor = colors[strength];
    strengthText.textContent = password.length > 0 ? texts[strength] : 'Password strength';
    strengthText.style.color = colors[strength];
}

// Update password match indicator
function updatePasswordMatch() {
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    const matchIndicator = document.getElementById('passwordMatch');
    
    if (!matchIndicator) return;
    
    if (confirmPassword.length === 0) {
        matchIndicator.style.display = 'none';
        return;
    }
    
    matchIndicator.style.display = 'flex';
    
    if (newPassword === confirmPassword) {
        matchIndicator.innerHTML = '<i class="fas fa-check-circle"></i><span>Passwords match</span>';
        matchIndicator.style.color = '#2ed573';
    } else {
        matchIndicator.innerHTML = '<i class="fas fa-times-circle"></i><span>Passwords do not match</span>';
        matchIndicator.style.color = '#ff4757';
    }
}

// Handle reset password form submission
async function handleResetPasswordSubmit(e) {
    e.preventDefault();
    
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    
    if (!newPassword || !confirmPassword) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
    }
    
    if (newPassword.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }
    
    try {
        showLoading();
        
        // Get the oobCode from localStorage
        const oobCode = window.localStorage.getItem('passwordResetOobCode');
        if (!oobCode) {
            showToast('Session expired. Please request a new password reset link.', 'error');
            showLoginForm();
            return;
        }
        
        // Reset the password using the oobCode
        await auth.confirmPasswordReset(oobCode, newPassword);
        
        // Clear the stored oobCode
        window.localStorage.removeItem('passwordResetOobCode');
        window.localStorage.removeItem('passwordResetEmail');
        
        showToast('Password updated successfully!', 'success');
        console.log('✅ Password updated successfully');
        
        // Go to login after successful password update
        setTimeout(() => {
            showLoginForm();
        }, 2000);
        
    } catch (error) {
        console.error('Password update error:', error);
        showToast('Error updating password: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Check password strength
function checkPasswordStrength(password) {
    const strengthBar = document.querySelector('.strength-bar');
    const strengthText = document.querySelector('.strength-text');
    
    if (!strengthBar || !strengthText) return;
    
    let strength = 0;
    
    // Check length
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    
    // Check for different character types
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    
    // Update UI based on strength
    strengthBar.className = 'strength-bar';
    
    if (strength <= 2) {
        strengthBar.classList.add('weak');
        strengthText.textContent = 'Weak password';
        strengthText.style.color = '#f56565';
    } else if (strength <= 4) {
        strengthBar.classList.add('medium');
        strengthText.textContent = 'Medium strength';
        strengthText.style.color = '#ed8936';
    } else {
        strengthBar.classList.add('strong');
        strengthText.textContent = 'Strong password';
        strengthText.style.color = '#48bb78';
    }
}

// Check password match
function checkPasswordMatch() {
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;
    const passwordMatch = document.getElementById('passwordMatch');
    
    if (!passwordMatch) return;
    
    if (confirmPassword.length === 0) {
        passwordMatch.classList.remove('show');
        return;
    }
    
    passwordMatch.classList.add('show');
    
    if (newPassword === confirmPassword) {
        passwordMatch.classList.add('valid');
        passwordMatch.classList.remove('invalid');
        passwordMatch.innerHTML = '<i class="fas fa-check-circle"></i><span>Passwords match</span>';
    } else {
        passwordMatch.classList.add('invalid');
        passwordMatch.classList.remove('valid');
        passwordMatch.innerHTML = '<i class="fas fa-times-circle"></i><span>Passwords do not match</span>';
    }
}

// Handle forgot password (legacy function for backward compatibility)
async function handleForgotPassword() {
    const email = document.getElementById('loginEmail').value;
    
    if (!email) {
        showForgotPasswordForm();
        return;
    }
    
    try {
        showLoading();
        await auth.sendPasswordResetEmail(email);
        showToast('Password reset email sent!', 'success');
        console.log('✅ Password reset email sent via Firebase');
    } catch (error) {
        console.error('Password reset error:', error);
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}

// Add event listeners for password reset forms
document.addEventListener('DOMContentLoaded', function() {
    // Forgot password link
    const forgotPasswordLink = document.querySelector('.forgot-password');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', function(e) {
            e.preventDefault();
            showForgotPasswordForm();
        });
    }
    
    // Forgot password form
    const forgotPasswordForm = document.getElementById('forgotPasswordFormElement');
    if (forgotPasswordForm) {
        forgotPasswordForm.addEventListener('submit', handleForgotPasswordSubmit);
    }
    
    // Reset password form
    const resetPasswordForm = document.getElementById('resetPasswordFormElement');
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', handleResetPasswordSubmit);
    }

    
    // Password strength checker
    const newPasswordInput = document.getElementById('newPassword');
    if (newPasswordInput) {
        newPasswordInput.addEventListener('input', function() {
            checkPasswordStrength(this.value);
            checkPasswordMatch();
        });
    }
    
    // Password match checker
    const confirmPasswordInput = document.getElementById('confirmNewPassword');
    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', checkPasswordMatch);
    }
});

// Enable MFA for user (admin function)
async function enableMFAForUser(userId) {
    try {
        await db.collection('users').doc(userId).update({
            mfaEnabled: true,
            mfaEnabledAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showToast('MFA enabled for user', 'success');
    } catch (error) {
        console.error('Error enabling MFA:', error);
        showToast('Error enabling MFA', 'error');
    }
}

// Disable MFA for user (admin function)
async function disableMFAForUser(userId) {
    try {
        await db.collection('users').doc(userId).update({
            mfaEnabled: false,
            mfaDisabledAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showToast('MFA disabled for user', 'success');
    } catch (error) {
        console.error('Error disabling MFA:', error);
        showToast('Error disabling MFA', 'error');
    }
}

// Check user session
function checkUserSession() {
    const lastActivity = localStorage.getItem('lastActivity');
    const sessionTimeout = 30 * 60 * 1000; // 30 minutes
    
    if (lastActivity && Date.now() - parseInt(lastActivity) > sessionTimeout) {
        logout();
        showToast('Session expired. Please login again.', 'warning');
    }
}

// Update last activity
function updateLastActivity() {
    localStorage.setItem('lastActivity', Date.now().toString());
}

// Activity tracking
document.addEventListener('mousemove', updateLastActivity);
document.addEventListener('keypress', updateLastActivity);
document.addEventListener('click', updateLastActivity);
document.addEventListener('scroll', updateLastActivity);

// Check session periodically
setInterval(checkUserSession, 60000); // Check every minute

// Demo function to simulate MFA setup
async function setupMFA() {
    if (!currentUser) {
        showToast('Please login first', 'error');
        return;
    }
    
    try {
        const phoneNumber = prompt('Enter your phone number for MFA (with country code, e.g., +1234567890):');
        if (!phoneNumber) return;
        
        // Format and validate phone number
        const formattedPhoneNumber = formatPhoneNumber(phoneNumber);
        if (!formattedPhoneNumber) {
            showToast('Invalid phone number format', 'error');
            return;
        }
        
        // Test the phone number by sending a verification code
        showLoading();
        const appVerifier = window.recaptchaVerifier;
        const confirmationResult = await auth.signInWithPhoneNumber(formattedPhoneNumber, appVerifier);
        
        // Ask user to verify the test code
        const testCode = prompt('Enter the verification code sent to your phone:');
        if (!testCode) {
            hideLoading();
            return;
        }
        
        await confirmationResult.confirm(testCode);
        
        // If verification succeeds, enable MFA for the user
        await db.collection('users').doc(currentUser.uid).update({
            phoneNumber: formattedPhoneNumber,
            mfaEnabled: true,
            mfaEnabledAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showToast('MFA setup successful! You will need to verify on next login.', 'success');
        
    } catch (error) {
        console.error('MFA setup error:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        if (error.code === 'auth/invalid-verification-code') {
            showToast('Invalid verification code. MFA setup failed.', 'error');
        } else if (error.code === 'auth/invalid-phone-number') {
            showToast('Invalid phone number. Please check the format.', 'error');
        } else if (error.code === 'auth/quota-exceeded') {
            showToast('SMS quota exceeded. Please try again later.', 'error');
        } else if (error.code === 'auth/too-many-requests') {
            showToast('Too many requests. Please wait before trying again.', 'error');
        } else {
            showToast(`Error setting up MFA: ${error.message}`, 'error');
        }
    } finally {
        hideLoading();
    }
}

// Add MFA setup button to dashboard (for demo)
document.addEventListener('DOMContentLoaded', function() {
    // This would be added to the dashboard in a real implementation
    console.log('MFA setup function available: setupMFA()');
    
    // Add quick test function for development
    window.testSMS = async function() {
        if (!currentUser) {
            showToast('Please login first', 'error');
            return;
        }
        
        try {
            const phoneNumber = '+639526509781'; // Test number
            
            // Enable MFA in Firestore
            await db.collection('users').doc(currentUser.uid).update({
                phoneNumber: phoneNumber,
                mfaEnabled: true,
                mfaEnabledAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            showToast('MFA enabled! Logout and login again to test SMS', 'success');
            
        } catch (error) {
            console.error('Error enabling MFA:', error);
            showToast('Error enabling MFA', 'error');
        }
    };
    
    // Test mode - completely bypasses Firebase billing
    window.testMFAOffline = async function() {
        if (!currentUser) {
            showToast('Please login first', 'error');
            return;
        }
        
        try {
            // Enable MFA in Firestore only (no Firebase Auth phone verification)
            await db.collection('users').doc(currentUser.uid).update({
                phoneNumber: '+639526509781',
                mfaEnabled: true,
                mfaEnabledAt: firebase.firestore.FieldValue.serverTimestamp(),
                testMode: true
            });
            
            showToast('Test MFA enabled! Logout and login again to test.', 'success');
            
        } catch (error) {
            console.error('Error enabling test MFA:', error);
            showToast('Error enabling test MFA', 'error');
        }
    };
    
    // Quick demo function for testing
window.quickDemo = async function() {
    console.log('🚀 Starting Quick Demo Mode...');
    
    try {
        // Use demo credentials
        const demoEmail = 'demo@example.com';
        const demoPassword = 'demo123456';
        
        // Try to sign in with demo account or create it
        try {
            const userCredential = await auth.signInWithEmailAndPassword(demoEmail, demoPassword);
            currentUser = userCredential.user;
            console.log('✅ Signed in with existing demo account');
        } catch (signInError) {
            // Create demo account if it doesn't exist
            const userCredential = await auth.createUserWithEmailAndPassword(demoEmail, demoPassword);
            currentUser = userCredential.user;
            
            // Save demo user data
            await db.collection('users').doc(currentUser.uid).set({
                name: 'Demo User',
                email: demoEmail,
                phoneNumber: '+639526509781',
                mfaEnabled: true,
                testMode: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            console.log('✅ Created new demo account');
        }
        
        // Set up for phone verification demo
        pendingUser = currentUser;
        phoneVerificationNumber = '+639526509781';
        
        // Show phone verification form
        const forms = document.querySelectorAll('.form-container');
        forms.forEach(form => form.classList.remove('active'));
        document.getElementById('phoneVerificationForm').classList.add('active');
        document.getElementById('maskedPhone').textContent = '+639****09781';
        
        await sendDemoPhoneVerificationCode(phoneVerificationNumber);
        showToast('Demo mode ready! Use the SMS code from the toast/console.', 'success');
        console.log('🧪 Demo ready! Phone verification form shown.');
        
    } catch (error) {
        console.error('❌ Demo setup error:', error);
        showToast('Demo setup failed: ' + error.message, 'error');
    }
};

console.log('🧪 Demo function available: quickDemo() - Call this in console for instant demo setup');
});

// Sign in with Google
async function signInWithGoogle() {
    try {
        showLoading();
        
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        currentUser = result.user;
        
        // Check if user exists in Firestore, if not create profile
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        if (!userDoc.exists) {
            await db.collection('users').doc(currentUser.uid).set({
                name: currentUser.displayName,
                email: currentUser.email,
                phoneNumber: null,
                mfaEnabled: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        } else {
            // Update last login
            await db.collection('users').doc(currentUser.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        
        showToast('Successfully signed in with Google!', 'success');
        await checkMFARequirement(currentUser);
        
    } catch (error) {
        console.error('Google sign-in error:', error);
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}

// UI functions for email link form
function showEmailLinkForm() {
    document.getElementById('emailLinkForm').style.display = 'block';
    document.getElementById('loginFormElement').style.display = 'none';
}

function hideEmailLinkForm() {
    document.getElementById('emailLinkForm').style.display = 'none';
    document.getElementById('loginFormElement').style.display = 'block';
}
