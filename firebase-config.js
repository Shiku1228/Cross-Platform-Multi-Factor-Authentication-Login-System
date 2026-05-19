const firebaseConfig = {
  apiKey: "AIzaSyD22Z3gjm44LzfWk_MapeIaU9JSw7BNZwk",
  authDomain: "multi-factor-authenticat-8e8bc.firebaseapp.com",
  projectId: "multi-factor-authenticat-8e8bc",
  messagingSenderId: "295561901319",
  appId: "1:295561901319:web:edd60ac5598f2d6d0601a2",
  measurementId: "G-HS7YDP3WBM"
};

try {
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();

  auth.tenantId = null;

  const isElectronOrLocal =
    (typeof window !== 'undefined' && !!window.electronAPI) ||
    (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) ||
    (typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.location.hostname === 'localhost'));

  window.useLocalMfa = isElectronOrLocal;

  auth.settings = {
    appVerificationDisabledForTesting: isElectronOrLocal
  };

  if (isElectronOrLocal) {
    console.log('Local MFA mode enabled (Electron / local dev) — email & SMS use demo codes');
  }

  auth.onAuthStateChanged((user) => {
    console.log('Firebase auth state changed:', user ? user.email : 'No user');
  });

  window.auth = auth;
  window.firebase = firebase;

  let db = null;
  try {
    db = firebase.firestore();

    db.settings({
      timestampsInSnapshots: true,
      ignoreUndefinedProperties: true
    });

    window.db = db;

    setTimeout(async () => {
      try {
        await db.collection('test').limit(1).get();
      } catch (firestoreError) {
        console.log('Firestore unavailable; using local storage for user data');
        window.firestoreDisabled = true;
      }
    }, 2000);

  } catch (firestoreInitError) {
    console.log('Firestore initialization failed:', firestoreInitError.message);
    window.firestoreDisabled = true;
  }

} catch (error) {
  console.error('Firebase initialization error:', error);

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const errorDiv = document.createElement('div');
      errorDiv.innerHTML = `
        <div style="position: fixed; top: 20px; right: 20px; background: #f44336; color: white; padding: 15px; border-radius: 5px; z-index: 9999;">
          <strong>Firebase Error:</strong> ${error.message}<br>
          Please check your internet connection and try again.
        </div>
      `;
      document.body.appendChild(errorDiv);

      setTimeout(() => {
        if (errorDiv.parentNode) {
          errorDiv.parentNode.removeChild(errorDiv);
        }
      }, 10000);
    });
  }
}
