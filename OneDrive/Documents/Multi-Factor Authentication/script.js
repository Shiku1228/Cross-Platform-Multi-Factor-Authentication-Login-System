// Global Variables
let currentUser = null;
let mfaResolver = null;
let recaptchaVerifier = null;

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    setupRecaptcha();
});

// Initialize app
function initializeApp() {
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

// Toggle password visibility
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
        
        // Sign in user
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        
        showToast('Login successful!', 'success');
        
    } catch (error) {
        console.error('Login error:', error);
        handleAuthError(error);
    } finally {
        hideLoading();
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
        
        // Send email verification
        await user.sendEmailVerification();
        
        showToast('Account created! Please check your email for verification.', 'success');
        
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

// Check MFA requirement
async function checkMFARequirement(user) {
    try {
        const userDoc = await db.collection('users').doc(user.uid).get();
        const userData = userDoc.data();
        
        if (userData && userData.mfaEnabled) {
            // User has MFA enabled, show MFA verification
            showMFAForm();
            await sendMFACode();
        } else {
            // No MFA required, show dashboard
            showDashboard();
        }
    } catch (error) {
        console.error('Error checking MFA requirement:', error);
        showDashboard();
    }
}

// Send MFA code
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
        
        if (error.code === 'auth/invalid-verification-code') {
            showToast('Invalid verification code. MFA setup failed.', 'error');
        } else if (error.code === 'auth/invalid-phone-number') {
            showToast('Invalid phone number. Please check the format.', 'error');
        } else {
            showToast('Error setting up MFA. Please try again.', 'error');
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
    
    console.log('🧪 Test function available: testSMS() - Run in console to enable MFA');
});

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
            url: window.location.href,
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
document.addEventListener('DOMContentLoaded', handleEmailLinkSignIn);

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
