# 🌿 Bashan Livestock Feeds POS System

A complete Point of Sale system for livestock feed businesses. Built with vanilla HTML/CSS/JS and Firebase Firestore.

## 🚀 Quick Start

### 1. Firebase Setup
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable **Firestore Database** (in test mode for development)
4. Copy your Firebase config from Project Settings

### 2. Configure the App
Edit `js/firebase-config.js` and replace the config object:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};