// Firebase Configuration - Replace with your own config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Enable multi-factor authentication
auth.tenantId = null; // Set your tenant ID if using multi-tenancy

// Configure auth settings
auth.settings = {
    appVerificationDisabledForTesting: false // Set to true only for testing
};

console.log('Firebase initialized successfully');
