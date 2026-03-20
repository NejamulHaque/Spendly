# 💰 Nestfy — Smart Finance Tracker

<div align="center">

![nestly Banner](https://img.shields.io/badge/Nestfy-Smart%20Finance%20Tracker-00d4aa?style=for-the-badge&logo=firebase&logoColor=white)

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Firebase-orange?style=for-the-badge&logo=firebase)](https://expence-tracker-3e97b.web.app)
[![PWA](https://img.shields.io/badge/PWA-Installable-blue?style=for-the-badge&logo=googlechrome&logoColor=white)](https://expence-tracker-3e97b.web.app)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Firebase](https://img.shields.io/badge/Firebase-10.12.2-yellow?style=for-the-badge&logo=firebase)](https://firebase.google.com)

**A beautiful, full-featured personal finance tracker built with vanilla JavaScript and Firebase.**

[🌐 Live App](https://expence-tracker-3e97b.web.app) · [🐛 Report Bug](https://github.com/NejamulHaque/nestfy/issues) · [✨ Request Feature](https://github.com/NejamulHaque/nestfy/issues)

</div>

---

## 📸 Screenshots

| Dashboard | Transactions | Analytics |
|-----------|-------------|-----------|
| ![Dashboard](Dashboard.jpg?text=Dashboard) | ![Transactions](Transactions.jpg?text=Transactions) | ![Analytics](Analytics.jpg?text=Analytics) |

---

## ✨ Features

### 💳 Transaction Tracking
- Log income and expenses with categories, tags, payment methods and notes
- Search, filter and sort full transaction history
- Edit or delete any transaction
- Export to CSV

### 📊 Smart Dashboard
- Monthly income, expenses, net balance and savings rate
- Top spending category insights
- Projected month-end spending
- Recent transactions list

### 🎯 Savings Goals
- Create financial goals with target amounts and dates
- Track progress with visual progress bars
- Set priority levels (High / Medium / Low)

### 💼 Monthly Budgets
- Set spending limits per category
- Smart alerts when approaching limits
- Visual budget status with progress bars

### 🔄 Recurring Transactions
- Track subscriptions, rent, salary and more
- Monthly overview of recurring income vs expenses
- Multiple frequency options (daily, weekly, monthly, quarterly, yearly)

### 📈 Analytics
- 12-month income vs expense trend
- All-time spending breakdown (donut chart)
- Daily spending bar chart (last 30 days)
- Key financial metrics

### ☁️ Cloud Sync
- Real-time sync across all devices via Firebase Firestore
- Sign in with Google or Email/Password
- Data persists securely in the cloud

### 📱 PWA — Installable App
- Install on Android, iPhone, Windows, Mac
- Works offline with service worker caching
- Fullscreen native app experience
- Home screen icon and splash screen

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Vanilla JavaScript (ES Modules)** | App logic — no framework |
| **Firebase Auth 10.12.2** | Google & Email/Password sign-in |
| **Cloud Firestore 10.12.2** | Real-time database |
| **Firebase Hosting** | Deployment & CDN |
| **Chart.js 4.4.0** | Dashboard & analytics charts |
| **Service Worker** | Offline support & PWA |
| **CSS Variables** | Dark theme design system |
| **Web App Manifest** | PWA installability |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Firebase account (free Spark plan works)
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/nestfy.git
cd spendly
```

### 2. Set Up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable **Authentication** → Sign-in method → Enable **Email/Password** and **Google**
4. Create a **Firestore Database** (start in test mode)
5. Go to Project Settings → Your apps → Add web app
6. Copy your config

### 3. Configure Firebase

Open `firebase-config.js` and replace with your config:

```js
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
```

### 4. Generate App Icons

```bash
npm install sharp
node generate-icons.js
```

### 5. Run Locally

```bash
npx serve .
```

Open [http://localhost:3000](http://localhost:3000)

### 6. Deploy to Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

---

## 📁 Project Structure

```
spendly/
├── index.html              # Main app shell + auth screen
├── script.js               # Full app logic (1250 lines)
├── auth.js                 # Firebase Auth — sign in/up/out
├── db.js                   # Firestore database layer
├── firebase-config.js      # Firebase initialization + exports
├── style.css               # App styles + dark theme
├── auth.css                # Auth screen styles
├── legal.html              # Terms of Service + Privacy Policy
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (offline support)
├── firebase.json           # Firebase Hosting config
├── generate-icons.js       # Icon generator script
└── icons/                  # PWA icons (all sizes)
    ├── icon-72.png
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-144.png
    ├── icon-152.png
    ├── icon-192.png
    ├── icon-384.png
    └── icon-512.png
```

---

## 🔐 Firestore Security Rules

Once you're ready for production, replace the default test rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

---

## 📱 Install as App

### Android
1. Open Chrome → go to the live URL
2. Tap **"Add to Home Screen"** banner
3. Tap **Install**

### iPhone
1. Open **Safari** → go to the live URL
2. Tap **Share** → **"Add to Home Screen"**
3. Tap **Add**

### Desktop (Windows / Mac)
1. Open Chrome or Edge → go to the live URL
2. Click the **install icon** in the address bar
3. Click **Install**

---

## 🗺️ Roadmap

- [ ] Bill reminders & push notifications
- [ ] Dark / Light mode toggle
- [ ] Multiple accounts / wallets
- [ ] Shared expenses (split bills)
- [ ] Bank statement import (CSV/PDF)
- [ ] AI spending insights
- [ ] Widget for Android home screen
- [ ] Play Store & Amazon Appstore release

---

## 🤝 Contributing

Contributions are welcome! Here's how:

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/AmazingFeature`
3. Commit your changes: `git commit -m 'Add AmazingFeature'`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## 👨‍💻 Author

**Nejamul Haque**

[![GitHub](https://img.shields.io/badge/GitHub-NejamulHaque-black?style=flat-square&logo=github)](https://github.com/NejamulHaque)
[![Email](https://img.shields.io/badge/Email-nejamulhaqueruhaan86%40gmail.com-red?style=flat-square&logo=gmail)](mailto:nejamulhaqueruhaan86@gmail.com)

---

## 🙏 Acknowledgements

- [Firebase](https://firebase.google.com) — Auth & Database
- [Chart.js](https://www.chartjs.org) — Beautiful charts
- [Font Awesome](https://fontawesome.com) — Icons
- [Google Fonts](https://fonts.google.com) — Outfit & JetBrains Mono

---

<div align="center">

**⭐ Star this repo if you found it useful!**

Made with ❤️ by Nejamul Haque

</div>
