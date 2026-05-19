// Local Storage Manager for user data when Firestore is unavailable
console.log('💾 Local Storage Manager loaded...');

class LocalStorageManager {
    constructor() {
        this.usersKey = 'mfa_users';
        this.verificationCodesKey = 'mfa_verification_codes';
    }

    // User management
    async createUser(userData) {
        try {
            const users = this.getUsers();
            const uid = userData.uid || this.generateUid();
            const newUser = {
                ...userData,
                uid,
                createdAt: userData.createdAt || new Date().toISOString(),
                lastLogin: userData.lastLogin || new Date().toISOString(),
                mfaEnabled: userData.mfaEnabled ?? false
            };
            
            users[uid] = newUser;
            localStorage.setItem(this.usersKey, JSON.stringify(users));
            
            console.log('✅ User created locally:', newUser.email);
            return newUser;
        } catch (error) {
            console.error('❌ Error creating user locally:', error);
            throw error;
        }
    }

    async getUser(uid) {
        try {
            const users = this.getUsers();
            return users[uid] || null;
        } catch (error) {
            console.error('❌ Error getting user locally:', error);
            return null;
        }
    }

    async getUserByEmail(email) {
        try {
            const users = this.getUsers();
            const user = Object.values(users).find(u => u.email === email);
            return user || null;
        } catch (error) {
            console.error('❌ Error getting user by email locally:', error);
            return null;
        }
    }

    async updateUser(uid, updates) {
        try {
            const users = this.getUsers();
            if (users[uid]) {
                users[uid] = { ...users[uid], ...updates };
                localStorage.setItem(this.usersKey, JSON.stringify(users));
                console.log('✅ User updated locally:', uid);
                return users[uid];
            }
            return null;
        } catch (error) {
            console.error('❌ Error updating user locally:', error);
            throw error;
        }
    }

    getUsers() {
        try {
            const usersData = localStorage.getItem(this.usersKey);
            return usersData ? JSON.parse(usersData) : {};
        } catch (error) {
            console.error('❌ Error getting users locally:', error);
            return {};
        }
    }

    // Verification codes management
    async storeVerificationCode(email, code, type = 'email') {
        try {
            const codes = this.getVerificationCodes();
            const codeData = {
                email: email,
                code: code,
                type: type,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
            };
            
            codes[code] = codeData;
            localStorage.setItem(this.verificationCodesKey, JSON.stringify(codes));
            
            console.log(`✅ Verification code stored locally for ${email}`);
            return codeData;
        } catch (error) {
            console.error('❌ Error storing verification code locally:', error);
            throw error;
        }
    }

    async verifyCode(email, code) {
        try {
            const codes = this.getVerificationCodes();
            const codeData = codes[code];
            
            if (!codeData) {
                console.log('❌ Code not found locally');
                return false;
            }
            
            if (codeData.email !== email) {
                console.log('❌ Email mismatch for verification code');
                return false;
            }
            
            const now = new Date();
            const expiresAt = new Date(codeData.expiresAt);
            
            if (now > expiresAt) {
                console.log('❌ Verification code expired');
                delete codes[code];
                localStorage.setItem(this.verificationCodesKey, JSON.stringify(codes));
                return false;
            }
            
            // Clean up used code
            delete codes[code];
            localStorage.setItem(this.verificationCodesKey, JSON.stringify(codes));
            
            console.log('✅ Verification code validated locally');
            return true;
        } catch (error) {
            console.error('❌ Error verifying code locally:', error);
            return false;
        }
    }

    getVerificationCodes() {
        try {
            const codesData = localStorage.getItem(this.verificationCodesKey);
            return codesData ? JSON.parse(codesData) : {};
        } catch (error) {
            console.error('❌ Error getting verification codes locally:', error);
            return {};
        }
    }

    // Utility functions
    generateUid() {
        return 'local_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    // Clean up expired codes
    cleanupExpiredCodes() {
        try {
            const codes = this.getVerificationCodes();
            const now = new Date();
            let cleaned = false;
            
            Object.keys(codes).forEach(code => {
                const expiresAt = new Date(codes[code].expiresAt);
                if (now > expiresAt) {
                    delete codes[code];
                    cleaned = true;
                }
            });
            
            if (cleaned) {
                localStorage.setItem(this.verificationCodesKey, JSON.stringify(codes));
                console.log('🧹 Cleaned up expired verification codes');
            }
        } catch (error) {
            console.error('❌ Error cleaning up expired codes:', error);
        }
    }
}

// Create global instance
window.localStorageManager = new LocalStorageManager();

// Clean up expired codes on load
window.localStorageManager.cleanupExpiredCodes();

// Make available globally
window.LocalStorageManager = LocalStorageManager;

console.log('✅ Local Storage Manager ready');
