// Firebase Configuration - Replace with your own config
const firebaseConfig = {
  apiKey: "AIzaSyD22Z3gjm44LzfWk_MapeIaU9JSw7BNZwk",
  authDomain: "multi-factor-authenticat-8e8bc.firebaseapp.com",
  projectId: "multi-factor-authenticat-8e8bc",
  storageBucket: "multi-factor-authenticat-8e8bc.firebasestorage.app",
  messagingSenderId: "295561901319",
  appId: "1:295561901319:web:edd60ac5598f2d6d0601a2",
  measurementId: "G-HS7YDP3WBM"
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
