# MFA Auth Desktop (Electron)

## Purpose
Cross-platform desktop client for the unified MFA authentication system. Wraps the existing Firebase web UI in an Electron window with a local server to ensure reCAPTCHA and Firebase Phone Auth work correctly.

## How to run

### Prerequisites
- Node.js installed
- This repo cloned locally

### Install dependencies
```bash
cd desktop
npm install
```

### Run in development
```bash
npm run dev
```
- Opens the app with DevTools

### Run normally
```bash
npm start
```

## Build for distribution
```bash
# Build for current platform
npm run build

# Build for Windows
npm run build-win

# Build for macOS
npm run build-mac

# Build for Linux
npm run build-linux
```

Outputs will be in `dist/`.

## Security notes
- `contextIsolation: true`
- `nodeIntegration: false`
- Serves local web UI via `http://127.0.0.1:3456` to avoid reCAPTCHA issues
- No sensitive data is exposed to Node

## Testing & screenshots
- Take screenshots of:
  - Login screen
  - OTP/MFA prompt
  - Dashboard after success
  - Auto logout after 15 minutes inactivity

## Firebase Console setup
In your Firebase project:
- Authentication > Settings > Authorized domains
- Add `localhost` and `127.0.0.1`
