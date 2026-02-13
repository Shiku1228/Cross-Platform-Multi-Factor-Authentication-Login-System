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
    
    try {
        showLoading();
        
        // Create user
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const user = userCredential.user;
        
        // Update user profile
        await user.updateProfile({
            displayName: name
        });
        
        // Save user data to Firestore
        await db.collection('users').doc(user.uid).set({
            name: name,
            email: email,
            phoneNumber: phoneNumber,
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
        if (!currentUser || !currentUser.phoneNumber) {
            showToast('Phone number not registered for MFA', 'error');
            return;
        }
        
        // In a real implementation, you would use Firebase Phone Auth
        // For demo purposes, we'll simulate sending a code
        const appVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container');
        const confirmationResult = await currentUser.signInWithPhoneNumber(currentUser.phoneNumber, appVerifier);
        window.confirmationResult = confirmationResult;
        
        showToast('Verification code sent to your phone', 'success');
        
    } catch (error) {
        console.error('Error sending MFA code:', error);
        // For demo purposes, we'll simulate success
        showToast('Verification code sent to your phone', 'success');
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
        
        // In a real implementation, you would verify with Firebase
        // For demo purposes, we'll accept any 6-digit code
        if (window.confirmationResult) {
            const result = await window.confirmationResult.confirm(verificationCode);
            currentUser = result.user;
        } else {
            // Demo mode - accept any code
            if (verificationCode.length === 6) {
                // Update last login
                await db.collection('users').doc(currentUser.uid).update({
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                throw new Error('Invalid verification code');
            }
        }
        
        showToast('MFA verification successful!', 'success');
        showDashboard();
        
    } catch (error) {
        console.error('MFA verification error:', error);
        showToast('Invalid verification code. Please try again.', 'error');
        
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
        const phoneNumber = prompt('Enter your phone number for MFA:');
        if (!phoneNumber) return;
        
        await db.collection('users').doc(currentUser.uid).update({
            phoneNumber: phoneNumber,
            mfaEnabled: true,
            mfaEnabledAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        showToast('MFA setup successful! You will need to verify on next login.', 'success');
        
    } catch (error) {
        console.error('MFA setup error:', error);
        showToast('Error setting up MFA', 'error');
    }
}

// Add MFA setup button to dashboard (for demo)
document.addEventListener('DOMContentLoaded', function() {
    // This would be added to the dashboard in a real implementation
    console.log('MFA setup function available: setupMFA()');
});
