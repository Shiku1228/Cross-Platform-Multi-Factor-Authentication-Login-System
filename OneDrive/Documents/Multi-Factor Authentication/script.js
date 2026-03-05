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
        if (!pendingUser && currentUser) {
            pendingUser = currentUser;
        }
        if (!pendingUser || !pendingUser.uid) {
            showToast('No pending user found. Please sign in again.', 'error');
            showLoginForm();
            return;
        }

        setSecondFactorVerified(pendingUser.uid, method);
        currentUser = pendingUser;
        pendingUser = null;

        try {
            await db.collection('users').doc(currentUser.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
        }

        showDashboard();
    } catch (e) {
        console.error('Error completing second factor:', e);
        showToast('Verification failed. Please try again.', 'error');
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    setupRecaptcha();
});

// Initialize app
function initializeApp() {
    // Check for email link sign-in on page load
    if (auth.isSignInWithEmailLink(window.location.href)) {
        handleEmailLinkSignIn();
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

// Handle email link sign-in
async function handleEmailLinkSignIn() {
    try {
        showLoading();
        
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
            // Get email from URL parameter if not in localStorage
            const urlParams = new URLSearchParams(window.location.search);
            email = urlParams.get('email');
        }
        
        if (!email) {
            showToast('Invalid sign-in link. Please request a new link.', 'error');
            showLoginForm();
            return;
        }
        
        // Sign in with email link
        const result = await auth.signInWithEmailLink(email, window.location.href);
        currentUser = result.user;
        
        // Clear localStorage
        window.localStorage.removeItem('emailForSignIn');
        
        // Mark as email link authenticated (treated as second factor)
        window.localStorage.setItem('emailLinkAuthenticated', 'true');
        if (currentUser && currentUser.uid) {
            setSecondFactorVerified(currentUser.uid, 'email-link');
        }
        
        showToast('Successfully signed in with magic link!', 'success');
        
        // Update URL to remove parameters
        window.history.replaceState({}, document.title, window.location.pathname);
        
    } catch (error) {
        console.error('Error signing in with email link:', error);
        showToast('Invalid or expired sign-in link. Please request a new link.', 'error');
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
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => {
            console.log('reCAPTCHA solved');
        }
    });
}

// Show/hide loading
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// Show toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toast.className = `toast ${type} show`;
    toastMessage.textContent = message;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
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
        
        // Check if email is registered
        const userQuery = await db.collection('users').where('email', '==', email).limit(1).get();
        if (userQuery.empty) {
            showToast('No account found with that email.', 'error');
            hideLoading();
            return;
        }
        
        // Send Gmail verification code
        await sendGmailVerificationCode(email);
        
    } catch (error) {
        console.error('Gmail verification error:', error);
        showToast('Error sending Gmail verification. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Send Gmail verification code
async function sendGmailVerificationCode(email) {
    try {
        // Persist the recipient email for the rest of the flow/UI
        gmailVerificationEmail = email;

        // Generate a 6-digit code
        generatedGmailCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Store in localStorage so verification works after refresh
        window.localStorage.setItem('emailForVerification', email);
        window.localStorage.setItem('verificationCode', generatedGmailCode);

        // Send the code to the *recipient email* via EmailJS (or simulation if EmailJS not available)
        const emailSent = await simulateEmailSending(email, generatedGmailCode);

        if (!emailSent) {
            showToast('Failed to send verification email. Please try another method.', 'error');
            showVerificationOptions();
            return;
        }

        showToast(`Verification code sent to ${maskEmail(email)}`, 'success');
        showGmailCodeInputForm();
    } catch (error) {
        console.error('Error sending Gmail verification code:', error);
        showToast('Email service unavailable. Please try another method.', 'error');
        showVerificationOptions();
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
        
        // Use demo number and code
        const demoPhoneNumber = "+639526509781";
        const demoCode = "101010";

        phoneVerificationNumber = demoPhoneNumber;
        
        // Store demo data
        window.localStorage.setItem('phoneForVerification', demoPhoneNumber);
        window.localStorage.setItem('phoneVerificationCode', demoCode);
        
        showToast(`Demo: Verification code sent to ${maskPhone(demoPhoneNumber)}`, 'success');
        showPhoneCodeVerificationForm(demoPhoneNumber);
        
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
        
        // Send verification code using Firebase
        sendGmailVerificationCode();
    } else {
        // Prompt for email if no pending user
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
        document.getElementById('maskedEmail').textContent = maskedEmail;
        
        // Show Gmail verification form
        const forms = document.querySelectorAll('.form-container');
        forms.forEach(form => form.classList.remove('active'));
        document.getElementById('gmailVerificationForm').classList.add('active');
        
        // Send verification code
        sendGmailVerificationCode();
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
        
        // Send verification code using Firebase
        sendPhoneVerificationCode();
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

// Send phone verification code
async function sendPhoneVerificationCode() {
    try {
        showLoading();
        
        console.log('🔍 DEBUG: Starting phone verification for:', phoneVerificationNumber);
        console.log('🔍 DEBUG: Firebase auth settings:', auth.settings);
        
        // Use Firebase Phone Auth with reCAPTCHA
        const appVerifier = window.recaptchaVerifier;
        console.log('🔍 DEBUG: App verifier created:', appVerifier);
        
        // Check if this is a demo number
        const isDemoNumber = phoneVerificationNumber === '+639526509781' || 
                            phoneVerificationNumber === '+15555215554' ||
                            phoneVerificationNumber.includes('555');
        
        if (isDemoNumber) {
            console.log('🧪 DEMO MODE: Detected demo number, verification should work without SMS');
            showToast('Demo number detected - check console for verification code', 'info');
        }
        
        confirmationResult = await auth.signInWithPhoneNumber(phoneVerificationNumber, appVerifier);
        
        console.log('✅ Firebase phone verification initiated successfully');
        console.log('📱 Phone number:', phoneVerificationNumber);
        console.log('🔧 Or check Firebase console for the actual verification code');
        
        showToast(`Verification code sent to ${maskPhone(phoneVerificationNumber)}`, 'success');
        
    } catch (error) {
        console.error('❌ Error sending phone verification code:', error);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error message:', error.message);
        
        if (error.code === 'auth/too-many-requests') {
            showToast('Too many requests. Please try again later.', 'error');
        } else if (error.code === 'auth/invalid-phone-number') {
            showToast('Invalid phone number format', 'error');
        } else if (error.code === 'auth/quota-exceeded') {
            showToast('SMS quota exceeded. Please try again later.', 'error');
        } else if (error.code === 'auth/app-not-authorized') {
            showToast('Firebase app not authorized for phone auth. Check configuration.', 'error');
        } else {
            showToast('Error sending verification code: ' + error.message, 'error');
        }
    } finally {
        hideLoading();
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
        
        console.log('🔍 DEBUG: Verifying code:', enteredCode);
        console.log('🔍 DEBUG: Phone number:', phoneVerificationNumber);
        console.log('🔍 DEBUG: Confirmation result exists:', !!confirmationResult);
        
        // Check for demo number and demo code
        const isDemoNumber = phoneVerificationNumber === '+639526509781' || 
                            phoneVerificationNumber === '+15555215554' ||
                            phoneVerificationNumber.includes('555');
        
        if (isDemoNumber && enteredCode === '101010') {
            console.log('🧪 DEMO MODE: Using demo code for demo number');
            
            showToast('Demo verification successful!', 'success');
            await completeSecondFactorAndProceed('sms-demo');
            return;
        }

        if (!isDemoNumber) {
            showToast('SMS is in demo mode only. Please use the email link or email code option.', 'error');
            return;
        }

        showToast('Invalid verification code. Please try again.', 'error');
        
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
    await sendPhoneVerificationCode();
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
    
    // Send verification code
    sendGmailVerificationCode(gmailVerificationEmail);
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
    showToast('Resending verification code...', 'success');
    await sendGmailVerificationCode();
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

        // Check if the email is registered
        const userQuery = await db.collection('users').where('email', '==', email).limit(1).get();

        if (userQuery.empty) {
            showToast('No account found with that email. Please register or use a registered email.', 'error');
            hideLoading();
            return;
        }

        // Set persistence based on remember me checkbox
        const persistence = rememberMe ? 
            firebase.auth.Auth.Persistence.LOCAL : 
            firebase.auth.Auth.Persistence.SESSION;
        
        await auth.setPersistence(persistence);

        // Sign in user with email and password
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        currentUser = userCredential.user;
        
        showToast('Login successful!', 'success');
        await checkMFARequirement(currentUser);

    } catch (error) {
        console.error('Login error:', error);
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}

// Send magic link from login form
async function sendMagicLinkFromForm() {
    const email = document.getElementById('loginEmail').value;
    
    if (!email) {
        showToast('Please enter your email address first', 'error');
        return;
    }
    
    try {
        showLoading();

        // Check if the email is registered
        const userQuery = await db.collection('users').where('email', '==', email).limit(1).get();

        if (userQuery.empty) {
            showToast('No account found with that email. Please register or use a registered email.', 'error');
            hideLoading();
            return;
        }

        // Send magic link
        await sendMagicLink(email);

    } catch (error) {
        console.error('Error sending magic link:', error);
        showToast('Failed to send magic link. Please try another method.', 'error');
    } finally {
        hideLoading();
    }
}

// Send magic link for primary authentication
async function sendMagicLink(email) {
    try {
        showLoading();
        
        // Send sign-in link to email
        const actionCodeSettings = {
            url: window.location.origin + '/?email=' + email,
            handleCodeInApp: true,
        };
        await auth.sendSignInLinkToEmail(email, actionCodeSettings);
        window.localStorage.setItem('emailForSignIn', email);

        showToast('Magic link sent to your email! Please check your inbox to sign in.', 'success');
        showInfoContainer('magicLinkSent');

    } catch (error) {
        console.error('Error sending magic link:', error);
        showToast('Failed to send magic link. Please try another method.', 'error');
    } finally {
        hideLoading();
    }
}

// Send email verification code
async function sendEmailVerificationCode(email) {
    try {
        // Generate a 6-digit code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store the code and timestamp in Firestore for verification
        await db.collection('emailVerificationCodes').add({
            email: email,
            code: verificationCode,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes expiry
        });

        // Send email using EmailJS or Firebase Cloud Functions
        const emailSent = await sendVerificationEmail(email, verificationCode);
        
        if (emailSent) {
            // Store email for verification
            window.localStorage.setItem('emailForVerification', email);
            window.localStorage.setItem('verificationCode', verificationCode);
            
            showToast(`Verification code sent to ${maskEmail(email)}`, 'success');
            showEmailCodeVerificationForm(email);
        } else {
            showToast('Failed to send verification email. Please try another method.', 'error');
            showVerificationOptions();
        }
        
    } catch (error) {
        console.error('Error sending email verification code:', error);
        showToast('Error sending verification code. Please try again.', 'error');
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
        
        // Save user data to Firestore with formatted phone number
        await db.collection('users').doc(user.uid).set({
            name: name,
            email: email,
            phoneNumber: formattedPhoneNumber,
            mfaEnabled: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showToast('Account created successfully!', 'success');
        
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
        
        if (!email || !storedCode) {
            showToast('Session expired. Please try again.', 'error');
            showLoginForm();
            return;
        }
        
        console.log('🔍 DEBUG: Entered code:', enteredCode);
        console.log('🔍 DEBUG: Stored code:', storedCode);
        console.log('🔍 DEBUG: Email:', email);
        
        // First try localStorage verification (more reliable)
        if (enteredCode === storedCode) {
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
            
            const codesRef = db.collection('emailVerificationCodes');
            const snapshot = await codesRef
                .where('email', '==', email)
                .where('code', '==', enteredCode)
                .limit(1)
                .get();
            
            if (snapshot.empty) {
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

        // If second factor already completed for this session/user, proceed.
        if (isSecondFactorVerified(user.uid)) {
            showDashboard();
            return;
        }

        // Treat email-link sign-in as a completed second factor.
        const isEmailLinkAuth = window.localStorage.getItem('emailLinkAuthenticated') === 'true';
        if (isEmailLinkAuth) {
            window.localStorage.removeItem('emailLinkAuthenticated');
            setSecondFactorVerified(user.uid, 'email-link');
            showDashboard();
            return;
        }

        // Password-based login: ALWAYS require second factor (email link first).
        pendingUser = user;
        await sendDefaultEmailLink();
        return;

    } catch (error) {
        console.error('Error checking MFA requirement:', error);
        if (user && user.email) {
            showEmailLinkSentForm(user.email);
        } else {
            showLoginForm();
        }
    }
}

// Resend magic link
async function resendMagicLink() {
    try {
        const email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
            showToast('No email found. Please try again.', 'error');
            showLoginForm();
            return;
        }
        
        showLoading();
        showToast('Resending magic link...', 'success');
        
        // Resend sign-in link to email
        const actionCodeSettings = {
            url: window.location.origin + '/?email=' + email,
            handleCodeInApp: true,
        };
        await auth.sendSignInLinkToEmail(email, actionCodeSettings);
        
        showToast('Magic link resent! Please check your email.', 'success');
        
    } catch (error) {
        console.error('Error resending magic link:', error);
        showToast('Failed to resend magic link. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Show info container for magic link sent
function showInfoContainer(type) {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    
    if (type === 'magicLinkSent') {
        // Update the checkGmailForm with current email
        const emailForSignIn = window.localStorage.getItem('emailForSignIn');
        if (emailForSignIn) {
            const maskedEmail = maskEmail(emailForSignIn);
            const emailDisplay = document.getElementById('checkGmailEmail');
            if (emailDisplay) {
                emailDisplay.textContent = maskedEmail;
            }
        }
        document.getElementById('checkGmailForm').classList.add('active');
    }
}

// Send default email sign-in link
async function sendDefaultEmailLink() {
    try {
        if (!currentUser || !currentUser.email) {
            showToast('User email not found. Please try another method.', 'error');
            showLoginForm();
            return;
        }

        // Email link auth requires a valid http(s) origin. If you open index.html via file://,
        // window.location.origin can be "null", which will break continue URLs.
        if (!window.location.origin || window.location.origin === 'null') {
            showToast('Email link requires running the app on http://localhost (not file://). Please start a local server (e.g. Live Server) and try again.', 'error');
            showEmailLinkSentForm(currentUser.email);
            return;
        }
        
        showLoading();
        
        // Use Firebase Email Link Authentication
        const continueUrl = window.location.origin + window.location.pathname;
        const actionCodeSettings = {
            url: continueUrl,
            handleCodeInApp: true,
            iOS: {
                bundleId: 'com.example.ios'
            },
            android: {
                packageName: 'com.example.android',
                installApp: true,
                minimumVersion: '12'
            }
        };
        
        // Send sign-in link to email
        await auth.sendSignInLinkToEmail(currentUser.email, actionCodeSettings);
        
        // Save email for verification when link is clicked
        window.localStorage.setItem('emailForSignIn', currentUser.email);
        
        console.log('Firebase email verification sent to:', currentUser.email);
        
        // Show email link sent form
        showEmailLinkSentForm(currentUser.email);
        
    } catch (error) {
        console.error('Error sending default email link:', error);
        console.error('Error code:', error && error.code);
        console.error('Error message:', error && error.message);
        
        if (error.code === 'auth/too-many-requests') {
            showToast('Too many email requests. Please try another method.', 'error');
        } else if (error.code === 'auth/invalid-email') {
            showToast('Invalid email address. Please try another method.', 'error');
        } else if (error.code === 'auth/unauthorized-continue-uri') {
            showToast('Email link blocked by Firebase: add this domain to Firebase Auth > Settings > Authorized domains (e.g. localhost/127.0.0.1), then try again.', 'error');
        } else if (error.code === 'auth/invalid-continue-uri') {
            showToast('Invalid email link URL. Make sure you are running on http://localhost and that the domain is authorized in Firebase Auth settings.', 'error');
        } else if (error.code === 'auth/missing-continue-uri') {
            showToast('Email link misconfigured: missing continue URL. Please refresh and try again on http://localhost.', 'error');
        } else if (error.code === 'auth/operation-not-allowed') {
            showToast('Email link is disabled in Firebase. Enable Email link (passwordless sign-in) in Firebase Auth > Sign-in method.', 'error');
        } else {
            const raw = (() => {
                if (!error) return '';
                if (typeof error === 'string') return error;
                if (error.code) return error.code;
                if (error.message) return error.message;
                try { return JSON.stringify(error); } catch (_) { return String(error); }
            })();
            const details = raw ? ` (${raw})` : '';
            showToast(`Email service unavailable. Please try another method.${details} Check DevTools Console for the full error.`, 'error');
        }

        // Still keep the flow: email link is the primary step, fallback is only via the button.
        if (currentUser && currentUser.email) {
            showEmailLinkSentForm(currentUser.email);
        } else {
            showLoginForm();
        }
    } finally {
        hideLoading();
    }
}

// Show email link sent form with "Try another way" option
function showEmailLinkSentForm(email) {
    const forms = document.querySelectorAll('.form-container');
    forms.forEach(form => form.classList.remove('active'));
    
    // Update the existing checkGmailForm or create it
    let emailLinkForm = document.getElementById('checkGmailForm');
    if (emailLinkForm) {
        // Update existing form
        document.getElementById('checkGmailEmail').textContent = maskEmail(email);
        
        // Update the back button to show verification options
        const backButton = emailLinkForm.querySelector('.btn-secondary');
        if (backButton) {
            backButton.setAttribute('onclick', 'showVerificationOptions()');
            backButton.innerHTML = '<i class="fas fa-arrow-left"></i> Try another way';
        }
        
        emailLinkForm.classList.add('active');
    } else {
        // Create a simple email sent form
        const formHTML = `
            <div id="emailLinkSentForm" class="form-container">
                <div class="gmail-icon-section">
                    <div class="gmail-icon">
                        <i class="fas fa-envelope"></i>
                    </div>
                </div>
                <h2>Check Your Email</h2>
                <p class="gmail-instruction">We've sent a sign-in link to</p>
                <p class="gmail-email-display">${maskEmail(email)}</p>
                <p class="gmail-sub-instruction">Click the link in the email to sign in</p>
                <div class="email-instructions">
                    <p><strong>Instructions:</strong></p>
                    <ul>
                        <li>Check your email inbox</li>
                        <li>Look for an email with your sign-in link</li>
                        <li>Click the link to complete sign in</li>
                        <li>You'll be automatically signed in</li>
                    </ul>
                </div>
                <button type="button" class="btn-secondary" onclick="showVerificationOptions()">
                    <i class="fas fa-arrow-left"></i> Try another way
                </button>
                <div class="resend-section">
                    <p>Didn't receive the email? <a href="#" onclick="resendDefaultEmailLink()">Resend Email</a></p>
                    <p>Check your spam folder too!</p>
                </div>
            </div>
        `;
        
        const authCard = document.querySelector('.auth-card');
        authCard.insertAdjacentHTML('beforeend', formHTML);
        document.getElementById('emailLinkSentForm').classList.add('active');
    }
}

// Resend default email link
async function resendDefaultEmailLink() {
    showToast('Resending sign-in link...', 'success');
    await sendDefaultEmailLink();
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
function showDashboard() {
    document.getElementById('authContainer').style.display = 'none';
    document.getElementById('dashboardContainer').style.display = 'block';
    
    // Update user info
    if (currentUser) {
        document.getElementById('userEmail').textContent = currentUser.email;
        
        // Update last login time
        const now = new Date();
        document.getElementById('lastLogin').textContent = now.toLocaleString();
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
}

// Forgot password
async function handleForgotPassword() {
    const email = document.getElementById('loginEmail').value;
    
    if (!email) {
        showToast('Please enter your email address first', 'error');
        return;
    }
    
    try {
        showLoading();
        await auth.sendPasswordResetEmail(email);
        showToast('Password reset email sent!', 'success');
    } catch (error) {
        console.error('Password reset error:', error);
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}

// Add forgot password functionality
document.addEventListener('DOMContentLoaded', function() {
    const forgotPasswordLink = document.querySelector('.forgot-password');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', function(e) {
            e.preventDefault();
            handleForgotPassword();
        });
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
        
        showToast('Demo mode ready!', 'success');
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

// Handle email link sign-in
async function handleEmailLinkSignIn() {
    if (auth.isSignInWithEmailLink(window.location.href)) {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
            email = prompt('Please provide your email for confirmation');
        }
        if (!email) {
            showToast('Email is required for sign-in.', 'error');
            return;
        }

        showLoading();
        try {
            const result = await auth.signInWithEmailLink(email, window.location.href);
            window.localStorage.removeItem('emailForSignIn');
            currentUser = result.user;
            
            // Update last login in Firestore
            await db.collection('users').doc(currentUser.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            showToast('Successfully signed in with email link!', 'success');
            // Mark as email link authenticated to skip MFA
            window.localStorage.setItem('emailLinkAuthenticated', 'true');
            await checkMFARequirement(currentUser);
        } catch (error) {
            console.error('Error signing in with email link:', error);
            handleAuthError(error);
        } finally {
            hideLoading();
        }
    }
}

// Send email link for passwordless sign-in
async function sendEmailLink() {
    const email = document.getElementById('emailLinkEmail')?.value || 
                 prompt('Enter your email address for passwordless sign-in:');
    
    if (!email) {
        showToast('Email address is required', 'error');
        return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    console.log('🔍 DEBUG: Attempting to send email link to:', email);
    console.log('🔍 DEBUG: Current URL:', window.location.href);

    try {
        showLoading();
        
        const actionCodeSettings = {
            url: window.location.origin + window.location.pathname,
            handleCodeInApp: true,
            iOS: {
                bundleId: 'com.example.ios'
            },
            android: {
                packageName: 'com.example.android',
                installApp: true,
                minimumVersion: '12'
            }
        };

        console.log('🔍 DEBUG: Action code settings:', actionCodeSettings);
        console.log('🔍 DEBUG: Sending email link...');

        await auth.sendSignInLinkToEmail(email, actionCodeSettings);
        
        console.log('✅ DEBUG: Email link sent successfully!');
        window.localStorage.setItem('emailForSignIn', email);
        
        showToast('Passwordless sign-in link sent to your email!', 'success');
        
        // Hide email link form if it exists
        const emailLinkForm = document.getElementById('emailLinkForm');
        if (emailLinkForm) {
            emailLinkForm.style.display = 'none';
        }
        
        // Show additional help
        setTimeout(() => {
            showToast('Check your Spam/Promotions folders if not found in Primary', 'info');
        }, 2000);
        
    } catch (error) {
        console.error('❌ DEBUG: Error sending email link:', error);
        console.error('❌ DEBUG: Error code:', error.code);
        console.error('❌ DEBUG: Error message:', error.message);
        
        handleAuthError(error);
    } finally {
        hideLoading();
    }
}

// Check for email link sign-in on page load
document.addEventListener('DOMContentLoaded', () => {
    if (auth.isSignInWithEmailLink(window.location.href)) {
        handleEmailLinkSignIn();
    }
});

// UI functions for email link form
function showEmailLinkForm() {
    document.getElementById('emailLinkForm').style.display = 'block';
    document.getElementById('loginFormElement').style.display = 'none';
    document.querySelector('.passwordless-section').style.display = 'none';
}

function hideEmailLinkForm() {
    document.getElementById('emailLinkForm').style.display = 'none';
    document.getElementById('loginFormElement').style.display = 'block';
    document.querySelector('.passwordless-section').style.display = 'block';
}
