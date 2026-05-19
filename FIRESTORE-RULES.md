# Firestore Security Rules Setup

## Issue: "Missing or insufficient permissions"

This error occurs when your Firestore database security rules don't allow access to the collections your app is trying to read/write.

## Quick Fix (Development)

Go to your Firebase Console:
1. Open [Firebase Console](https://console.firebase.google.com)
2. Select your project: `multi-factor-authenticat-8e8bc`
3. Go to **Firestore Database** → **Rules** tab
4. Replace the existing rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read/write access to all documents for development
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2027, 1, 1);
    }
  }
}
```

5. Click **Publish**

## Production-Ready Rules

For production, use more secure rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own documents
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Email verification codes - anyone can create, but only authenticated users can read
    match /emailVerificationCodes/{codeId} {
      allow create: if true;
      allow read, write: if request.auth != null;
    }
    
    // Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Collections Used by This App

The app uses these Firestore collections:

1. **`users`** - User profile data
2. **`emailVerificationCodes`** - Temporary verification codes

## Testing the Fix

After updating the rules:

1. Refresh your Electron app
2. Open browser console
3. Run `quickTest()` to verify Firestore connectivity
4. Try registering a new account

## Common Issues

- **Rules not updating**: Wait a few minutes for rules to propagate
- **Still getting permission errors**: Double-check rule syntax and click Publish
- **Auth errors**: Make sure Authentication is enabled in Firebase Console

## Security Note

The development rules above allow unrestricted access until January 1, 2027.
Remember to update to production rules before deploying your app.

**Important:** The app saves new users to `users/{uid}` only **after** Firebase Auth creates the account (user is signed in). Use the production rules above so each user can read/write their own document by UID.
