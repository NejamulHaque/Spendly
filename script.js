/* ============================================================
   NESTFY — script.js  (Firebase Edition)
   Full app logic with real Firebase Auth + Firestore wired in.
   ============================================================ */

'use strict';

// ── Firebase Auth + DB imports ───────────────────────────────
import {
  watchAuthState, signUpEmail, signInEmail, signInGoogle,
  logOut, resetPassword, friendlyError,
} from "./auth.js";

import {
  listenTransactions, addTransaction, updateTransaction, deleteTransaction,
  getBudgets, saveBudgets,
  getAllGoals, addGoal, updateGoal, deleteGoal,
  getAllRecurring, addRecurring, deleteRecurring,
  getPrefs, savePrefs, wipeAllUserData,
} from "./db.js";

/* ── App State ─────────────────────────────────────────────── */
let _currentUser = null;
let _unsubscribeTx = null;   // Firestore real-time listener cleanup

let DB = {
  transactions: [],
  budgets: {},
  goals: [],
  recurring: [],
  settings: {
    name: '',
    currency: 'INR',
    monthlyIncome: 0,
    budgetAlerts: true,
    compactView: false,
  },
};

// ── Variables declared here to avoid "Cannot access before initialization" ──
let _viewMonth      = new Date().getMonth();
let _viewYear       = new Date().getFullYear();
let notifications   = [];
let onboardingStep  = 0;
let cmdSelectedIndex = -1;
let cmdItems        = [];
let _deletedTx      = null;
let _undoTimer      = null;
let _wallets        = [];   // populated after DEFAULT_WALLETS is defined
let _activeWallet   = null;

/* ── Constants ─────────────────────────────────────────────── */
const CATS_EXPENSE = ['Food', 'Transportation', 'Housing', 'Utilities', 'Healthcare', 'Entertainment', 'Education', 'Shopping', 'Other'];
const CATS_INCOME = ['Salary', 'Freelance', 'Business', 'Investment', 'Gift', 'Other'];

const CAT_COLORS = {
  Food: '#ffd166', Transportation: '#a78bfa', Housing: '#00d4aa',
  Utilities: '#2dd4bf', Healthcare: '#f472b6', Entertainment: '#fb7185',
  Education: '#fb923c', Shopping: '#34d399', Other: '#94a3b8',
  Salary: '#00d4aa', Freelance: '#7c6aff', Business: '#38d9a9',
  Investment: '#ffd166', Gift: '#f472b6',
};
const CAT_ICONS = {
  Food: 'fa-utensils', Transportation: 'fa-car', Housing: 'fa-house',
  Utilities: 'fa-bolt', Healthcare: 'fa-heart-pulse', Entertainment: 'fa-clapperboard',
  Education: 'fa-graduation-cap', Shopping: 'fa-bag-shopping', Other: 'fa-tag',
  Salary: 'fa-briefcase', Freelance: 'fa-laptop', Business: 'fa-chart-pie',
  Investment: 'fa-trending-up', Gift: 'fa-gift',
};
const CAT_BADGES = {
  Food: 'badge-food', Transportation: 'badge-transport', Housing: 'badge-housing',
  Utilities: 'badge-utilities', Healthcare: 'badge-health', Entertainment: 'badge-entertainment',
  Education: 'badge-education', Shopping: 'badge-shopping', Other: 'badge-other',
  Salary: 'badge-salary', Freelance: 'badge-freelance', Business: 'badge-business',
  Investment: 'badge-investment', Gift: 'badge-gift',
};
const CURRENCIES = {
  INR: { sym: '₹', locale: 'en-IN' }, USD: { sym: '$', locale: 'en-US' },
  EUR: { sym: '€', locale: 'de-DE' }, GBP: { sym: '£', locale: 'en-GB' },
  JPY: { sym: '¥', locale: 'ja-JP' }, CAD: { sym: 'CA$', locale: 'en-CA' },
  AUD: { sym: 'A$', locale: 'en-AU' }, SGD: { sym: 'S$', locale: 'en-SG' },
  BDT: { sym: '৳', locale: 'en-BD' },
};

let chartInstances = {};
let currentModalType = 'expense';
let currentRecType = 'expense';

/* ════════════════════════════════════════════════════════════
   FIREBASE AUTH STATE HANDLER
   ════════════════════════════════════════════════════════════ */
watchAuthState(
  // ── onLogin ──────────────────────────────────────────────
  async user => {
    _currentUser = user;
    hideAuthScreen();

    // Safe email — Google sign-in can return null email in some cases
    const name  = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
    const email = user.email || '';

    // Sidebar user info
    const wrap = document.getElementById('sidebar-user');
    if (wrap) wrap.style.display = 'block';
    document.getElementById('user-name').textContent  = name;
    document.getElementById('user-email').textContent = email || 'Google Account';
    const av = document.getElementById('user-avatar');
    if (av) {
      av.innerHTML = user.photoURL
        ? `<img src="${user.photoURL}" alt="avatar">`
        : (name[0] || '?').toUpperCase();
    }

    // Settings email — show safely
    const sEmailWrap = document.getElementById('settings-user-email');
    if (sEmailWrap) {
      sEmailWrap.innerHTML = `<i class="fas fa-envelope" style="color:var(--muted)"></i><span>${email || 'Google Account'}</span>`;
    }

    // Show skeletons while data loads
    showSkeletons();
    setSyncStatus('syncing');

    // ── Load ALL data in parallel ──────────────────────────
    const [prefs, budgets, goals, recurring] = await Promise.all([
      getPrefs(user.uid),
      getBudgets(user.uid),
      getAllGoals(user.uid),
      getAllRecurring(user.uid),
    ]);

    DB.settings  = { ...DB.settings, ...prefs, name };
    DB.budgets   = budgets;
    DB.goals     = goals;
    DB.recurring = recurring;

    applySettings();
    updateGreeting();
    renderBudgets();
    renderGoals();
    renderRecurring();
    renderWallets();       // show wallets immediately — don't wait for transactions
    unlockProtectedNav();

    // Re-apply email after prefs load — prefs may have stored a stale/null email
    const sEmailWrap2 = document.getElementById('settings-user-email');
    if (sEmailWrap2) {
      const displayEmail = email
        || user.providerData?.[0]?.email
        || 'Google Account';
      sEmailWrap2.innerHTML = `<i class="fas fa-envelope" style="color:var(--muted)"></i><span>${displayEmail}</span>`;
    }

    const mDate = document.getElementById('m-date'); if (mDate) mDate.value = todayStr();
    const rDate = document.getElementById('r-date'); if (rDate) rDate.value = todayStr();
    setType('expense');

    // ── Real-time transaction listener ─────────────────────
    if (_unsubscribeTx) _unsubscribeTx();
    let firstFire = true;
    _unsubscribeTx = listenTransactions(user.uid, txs => {
      DB.transactions = txs;
      renderAll();
      setSyncStatus('synced');

      if (firstFire) {
        firstFire = false;
        toast(`Welcome back, ${name}! 👋`, 'success');
        addNotification('login', `Welcome back, ${name}!`,
          `Signed in. ${txs.length} transaction${txs.length !== 1 ? 's' : ''} loaded.`,
          'fa-circle-check', '#00d4aa');

        if (txs.length > 0) localStorage.setItem('nestfy-onboarded', '1');
        if (txs.length === 0 && !localStorage.getItem('nestfy-onboarded')) {
          setTimeout(showOnboarding, 500);
        }

        checkShowOnboarding(user);
        renderBillReminders();
        renderHealthScore();
        setTimeout(() => autoGenerateDueRecurring(), 800);
      }
    });
  },

  // ── onLogout ─────────────────────────────────────────────
  () => {
    _currentUser = null;
    if (_unsubscribeTx) { _unsubscribeTx(); _unsubscribeTx = null; }

    // Reset local data
    DB.transactions = [];
    DB.budgets = {};
    DB.goals = [];
    DB.recurring = [];

    showAuthScreen();
    lockProtectedNav();

    const wrap = document.getElementById('sidebar-user');
    if (wrap) wrap.style.display = 'none';
  }
);

/* ════════════════════════════════════════════════════════════
   AUTH SCREEN HANDLERS
   (function names MUST match index.html onclick= attributes)
   ════════════════════════════════════════════════════════════ */

// ── Tab switching ─────────────────────────────────────────────
window.authTab = function (tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
  // Hide forgot panel, show tabs
  const fp = document.getElementById('forgot-panel');
  const tb = document.getElementById('auth-tab-bar');
  if (fp) fp.classList.remove('show');
  if (tb) tb.style.display = '';
  clearAuthMsg();
};

// ── Google sign-in ────────────────────────────────────────────
window.handleGoogleAuth = async function () {
  clearAuthMsg();
  try {
    const remember = document.getElementById('remember-me')?.checked !== false;
    const { setPersistence, browserLocalPersistence, browserSessionPersistence } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const { auth } = await import("./firebase-config.js");
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    await signInGoogle();
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showAuthMsg('error', e.code ? friendlyError(e.code) : e.message);
    }
  }
};

// ── Email login ───────────────────────────────────────────────
window.handleEmailLogin = async function () {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  clearAuthMsg();

  if (!email)    { showAuthMsg('error', 'Please enter your email.');    return; }
  if (!password) { showAuthMsg('error', 'Please enter your password.'); return; }

  setBtnLoading('btn-login', true);
  try {
    await signInEmail(email, password);
  } catch (e) {
    showAuthMsg('error', e.code ? friendlyError(e.code) : e.message);
    setBtnLoading('btn-login', false);
  }
};

// ── Email signup ──────────────────────────────────────────────
window.handleEmailSignup = async function () {
  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const confirm  = document.getElementById('signup-confirm')?.value ?? '';
  clearAuthMsg();

  if (!name)              { showAuthMsg('error', 'Please enter your full name.');             return; }
  if (!email)             { showAuthMsg('error', 'Please enter your email.');                 return; }
  if (password.length < 6){ showAuthMsg('error', 'Password must be at least 6 characters.'); return; }
  if (confirm && password !== confirm) { showAuthMsg('error', "Passwords don't match.");      return; }

  setBtnLoading('btn-signup', true);
  try {
    await signUpEmail(name, email, password);
  } catch (e) {
    showAuthMsg('error', e.code ? friendlyError(e.code) : e.message);
    setBtnLoading('btn-signup', false);
  }
};

// ── Forgot password ───────────────────────────────────────────
window.handleForgotPassword = async function () {
  // If forgot panel is visible, use reset-email field; otherwise show the panel
  const fp = document.getElementById('forgot-panel');
  const isShowing = fp && fp.classList.contains('show');

  if (!isShowing) {
    // Show forgot panel
    clearAuthMsg();
    document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
    const tb = document.getElementById('auth-tab-bar');
    if (tb) tb.style.display = 'none';
    if (fp) fp.classList.add('show');
    setTimeout(() => document.getElementById('reset-email')?.focus(), 80);
    return;
  }

  // Actually send reset email
  const email = document.getElementById('reset-email')?.value.trim()
             || document.getElementById('login-email')?.value.trim();
  if (!email) { showAuthMsg('error', 'Enter your email address first.'); return; }
  setBtnLoading('btn-reset', true);
  try {
    await resetPassword(email);
    showAuthMsg('success', 'Password reset email sent! Check your inbox.');
    const re = document.getElementById('reset-email'); if (re) re.value = '';
  } catch (e) {
    showAuthMsg('error', e.code ? friendlyError(e.code) : e.message);
  } finally {
    setBtnLoading('btn-reset', false);
  }
};

// ── Back from forgot panel ────────────────────────────────────
window.handleForgotBack = function () {
  clearAuthMsg();
  const fp = document.getElementById('forgot-panel');
  const tb = document.getElementById('auth-tab-bar');
  if (fp) fp.classList.remove('show');
  if (tb) tb.style.display = '';
  document.getElementById('panel-login')?.classList.add('active');
  document.getElementById('tab-login')?.classList.add('active');
};

// ── Logout ────────────────────────────────────────────────────
window.handleLogout = async function () {
  // Show custom logout warning modal
  const existing = document.getElementById('logout-modal-overlay');
  if (existing) existing.remove();

  const txCount  = DB.transactions.length;
  const hasData  = txCount > 0;

  const overlay = document.createElement('div');
  overlay.id = 'logout-modal-overlay';
  overlay.className = 'overlay open';
  overlay.style.zIndex = '100005';
  overlay.innerHTML = `
    <div class="modal logout-modal" role="alertdialog" aria-modal="true" style="max-width:420px">
      <div class="logout-modal-header">
        <div class="logout-modal-icon">
          <i class="fas fa-right-from-bracket"></i>
        </div>
        <button class="modal-close" onclick="document.getElementById('logout-modal-overlay').remove();document.body.style.overflow='';document.body.classList.remove('modal-open')">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="logout-modal-body">
        <h3 class="logout-modal-title">Before you sign out</h3>
        <p class="logout-modal-sub">Make sure your data is safe — it lives in Firebase but downloading a backup is good practice.</p>

        ${hasData ? `
        <div class="logout-data-warning">
          <i class="fas fa-triangle-exclamation" style="color:var(--gold);font-size:1rem;flex-shrink:0;margin-top:2px"></i>
          <div>
            <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:3px">You have ${txCount} transaction${txCount !== 1 ? 's' : ''} on record</div>
            <div style="font-size:.75rem;color:var(--muted2)">Download a backup before leaving for peace of mind.</div>
          </div>
        </div>

        <div class="logout-download-row">
          <button class="btn btn-success btn-sm logout-download-btn" onclick="exportJSON();this.innerHTML='<i class=\\'fas fa-check\\'></i> Downloaded!'">
            <i class="fas fa-download"></i> Export Backup (JSON)
          </button>
          <button class="btn btn-ghost btn-sm logout-download-btn" onclick="exportCSV();this.innerHTML='<i class=\\'fas fa-check\\'></i> Downloaded!'">
            <i class="fas fa-file-csv"></i> Export CSV
          </button>
        </div>` : `
        <div class="logout-data-warning" style="border-color:rgba(0,212,170,.2);background:rgba(0,212,170,.04)">
          <i class="fas fa-circle-check" style="color:var(--accent);font-size:1rem;flex-shrink:0;margin-top:2px"></i>
          <div style="font-size:.82rem;color:var(--muted2)">No transaction data to back up. Your account is empty.</div>
        </div>`}

        <div class="logout-modal-footer">
          <button class="btn btn-ghost" onclick="document.getElementById('logout-modal-overlay').remove();document.body.style.overflow='';document.body.classList.remove('modal-open')">
            Cancel
          </button>
          <button class="btn btn-danger" id="confirm-logout-btn" onclick="performLogout()">
            <i class="fas fa-right-from-bracket"></i> Sign Out
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden'; document.body.classList.add('modal-open');

  // Close on backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      overlay.remove();
      document.body.style.overflow = ''; document.body.classList.remove('modal-open');
    }
  });
};

window.performLogout = async function () {
  const overlay = document.getElementById('logout-modal-overlay');
  const btn = document.getElementById('confirm-logout-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing out…'; }
  if (_unsubscribeTx) { _unsubscribeTx(); _unsubscribeTx = null; }
  await logOut();
  if (overlay) { overlay.remove(); }
  document.body.style.overflow = ''; document.body.classList.remove('modal-open');
  toast('Signed out successfully.', 'success');
};

// ── Password visibility toggle ────────────────────────────────
window.togglePw = function (inputId, btn) {
  const inp = document.getElementById(inputId);
  const icon = btn.querySelector('i');
  if (inp.type === 'password') {
    inp.type = 'text';
    if (icon) icon.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    inp.type = 'password';
    if (icon) icon.classList.replace('fa-eye-slash', 'fa-eye');
  }
};

// ── Password strength meter ───────────────────────────────────
window.checkStrength = function (val) {
  const wrap = document.getElementById('pw-strength');
  const fill = document.getElementById('pw-fill');
  const label = document.getElementById('pw-label');
  if (!val) { wrap.classList.remove('show'); return; }
  wrap.classList.add('show');
  let score = 0;
  if (val.length >= 6) score++;
  if (val.length >= 10) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  const levels = [
    { w: '20%', bg: '#ff6b6b', text: 'Too weak' },
    { w: '40%', bg: '#ff6b6b', text: 'Weak' },
    { w: '60%', bg: '#ffd166', text: 'Fair' },
    { w: '80%', bg: '#00d4aa', text: 'Strong' },
    { w: '100%', bg: '#00d4aa', text: 'Very strong' },
  ];
  const lv = levels[Math.min(Math.max(score - 1, 0), 4)];
  fill.style.width = lv.w;
  fill.style.background = lv.bg;
  label.textContent = lv.text;
};

/* ── Auth screen show/hide ────────────────────────────────────  */
function showAuthScreen() {
  const screen = document.getElementById('auth-screen');
  if (screen) screen.style.display = 'flex';
  // Reset forgot panel
  document.getElementById('forgot-panel')?.classList.remove('show');
  const tb = document.getElementById('auth-tab-bar');
  if (tb) tb.style.display = '';
  // Navigate away from protected pages on logout
  const activePage = document.querySelector('.page.active');
  if (activePage && (activePage.id === 'page-analytics' || activePage.id === 'page-settings')) {
    nav(document.querySelector('[data-page="dashboard"]'), 'dashboard');
  }
}

function hideAuthScreen() {
  const screen = document.getElementById('auth-screen');
  if (screen) screen.style.display = 'none';
}

/* ── Auth message helpers ─────────────────────────────────────  */
function showAuthMsg(type, text) {
  const err = document.getElementById('auth-error');
  const ok  = document.getElementById('auth-success');
  if (!err || !ok) return;
  err.classList.remove('show');
  ok.classList.remove('show');
  if (type === 'error') {
    document.getElementById('auth-error-text').textContent = text;
    err.classList.add('show');
  } else {
    document.getElementById('auth-success-text').textContent = text;
    ok.classList.add('show');
  }
}
function clearAuthMsg() {
  document.getElementById('auth-error')?.classList.remove('show');
  document.getElementById('auth-success')?.classList.remove('show');
}
function setBtnLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

/* ── Sync status indicator ─────────────────────────────────── */
function setSyncStatus(state) {
  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;
  dot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'offline' ? ' offline' : '');
  label.textContent = state === 'syncing' ? 'Syncing…' : state === 'offline' ? 'Offline' : 'Synced';
}

/* ── Protected nav ────────────────────────────────────────────  */
function unlockProtectedNav() {
  ['analytics', 'settings'].forEach(id => {
    const navItem = document.getElementById('nav-' + id);
    const lock = document.getElementById(id + '-lock');
    if (navItem) navItem.classList.remove('nav-locked');
    if (lock) lock.style.display = 'none';
    hideProtectedPage(id);
  });
}

function lockProtectedNav() {
  ['analytics', 'settings'].forEach(id => {
    const navItem = document.getElementById('nav-' + id);
    const lock = document.getElementById(id + '-lock');
    if (navItem) navItem.classList.add('nav-locked');
    if (lock) lock.style.display = 'inline-flex';
  });
}

function showProtectedPage(pageId) {
  const wall = document.getElementById(pageId + '-login-wall');
  const content = document.getElementById(pageId + '-content');
  if (wall) wall.style.display = 'flex';
  if (content) content.style.display = 'none';
}
function hideProtectedPage(pageId) {
  const wall = document.getElementById(pageId + '-login-wall');
  const content = document.getElementById(pageId + '-content');
  if (wall) wall.style.display = 'none';
  if (content) content.style.display = 'block';
}

window.navProtected = function (el, pageId) {
  if (!_currentUser) {
    showProtectedPage(pageId);
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageId).classList.add('active');
    document.getElementById('page-title').textContent = pageId.charAt(0).toUpperCase() + pageId.slice(1);
    closeSidebar();
  syncBottomNav(pageId);
    return;
  }
  hideProtectedPage(pageId);
  nav(el, pageId);
};

/* ════════════════════════════════════════════════════════════
   CURRENCY
   ════════════════════════════════════════════════════════════ */
function sym(c) {
  return (CURRENCIES[c || DB.settings.currency] || CURRENCIES.INR).sym;
}
function fmt(n, c) {
  const cur = c || DB.settings.currency;
  const info = CURRENCIES[cur] || CURRENCIES.INR;
  try {
    return new Intl.NumberFormat(info.locale, {
      style: 'currency', currency: cur,
      minimumFractionDigits: cur === 'JPY' ? 0 : 2,
      maximumFractionDigits: cur === 'JPY' ? 0 : 2,
    }).format(n);
  } catch { return info.sym + Number(n).toFixed(2); }
}
window.setCurrency = function (val) {
  DB.settings.currency = val;
  ['global-currency', 's-currency'].forEach(id => { const el = document.getElementById(id); if (el) el.value = val; });
  document.querySelectorAll('[id$="-sym"]').forEach(el => el.textContent = sym());
  saveSettings();
  renderAll();
};

/* ════════════════════════════════════════════════════════════
   NAVIGATION
   ════════════════════════════════════════════════════════════ */
const PAGE_TITLES = {
  dashboard: 'Dashboard', transactions: 'Transactions', budgets: 'Budgets',
  goals: 'Savings Goals', recurring: 'Recurring', analytics: 'Analytics', settings: 'Settings',
};

window.nav = function (el, pageId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const newPage = document.getElementById('page-' + pageId);
  if (newPage) {
    newPage.classList.add('active');
    // Page enter animation
    newPage.classList.remove('page-enter');
    void newPage.offsetWidth;
    newPage.classList.add('page-enter');
  }
  document.getElementById('page-title').textContent = PAGE_TITLES[pageId] || '';
  if (pageId === 'analytics') setTimeout(renderAnalytics, 80);
  if (pageId === 'dashboard') renderDashboard();
  if (pageId === 'settings')  renderAbout();
  closeSidebar();
  const content = document.querySelector('.content');
  if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
  // Sync bottom nav
  document.querySelectorAll('.bottom-nav-btn, .bottom-nav-item').forEach(b => {
    const bPage = b.dataset.page || b.id?.replace('bnav-', '');
    b.classList.toggle('active', bPage === pageId);
  });
};

window.toggleSidebar = function () {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const isOpen   = sidebar.classList.toggle('open');
  if (backdrop) backdrop.classList.toggle('show', isOpen);
};

function closeSidebar() {
  closeSidebar();
  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop) backdrop.classList.remove('show');
}

/* ════════════════════════════════════════════════════════════
   TRANSACTION MODAL
   ════════════════════════════════════════════════════════════ */
window.openModal = function (editId) {
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden'; document.body.classList.add('modal-open');

  if (editId) {
    const tx = DB.transactions.find(t => t.id === editId);
    if (!tx) return;
    document.getElementById('modal-title').textContent = 'Edit Transaction';
    document.getElementById('modal-save-label').textContent = 'Update';
    document.getElementById('m-edit-id').value = editId;
    setType(tx.type);
    document.getElementById('m-date').value    = tx.date;
    document.getElementById('m-amount').value  = tx.amount;
    document.getElementById('m-desc').value    = tx.description || '';
    document.getElementById('m-tags').value    = (tx.tags || []).join(', ');
    document.getElementById('m-payment').value = tx.payment || '';
    document.getElementById('m-notes').value   = tx.notes || '';
    setTimeout(() => {
      document.getElementById('m-cat').value    = tx.category;
      const mw = document.getElementById('m-wallet');
      if (mw) mw.value = tx.wallet || '';
    }, 50);
  } else {
    document.getElementById('modal-title').textContent = 'Add Transaction';
    document.getElementById('modal-save-label').textContent = 'Save';
    document.getElementById('m-edit-id').value  = '';
    setType('expense');
    document.getElementById('m-date').value    = todayStr();
    document.getElementById('m-amount').value  = '';
    document.getElementById('m-desc').value    = '';
    document.getElementById('m-tags').value    = '';
    document.getElementById('m-payment').value = '';
    document.getElementById('m-notes').value   = '';
    const mw = document.getElementById('m-wallet');
    if (mw) mw.value = '';
  }
  setTimeout(() => document.getElementById('m-amount').focus(), 120);
};

window.closeModal = function () {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = ''; document.body.classList.remove('modal-open');
};

window.handleOverlayClick = function (e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
};

/* ════════════════════════════════════════════════════════════
   CONFIRM DIALOG
   ════════════════════════════════════════════════════════════ */
window.openConfirm = function (title, msg, onConfirm, btnLabel = 'Confirm') {
  const btn = document.getElementById('confirm-btn');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  btn.textContent = btnLabel;
  // Clear any stale handler first, then set fresh one
  btn.replaceWith(btn.cloneNode(true)); // removes all event listeners
  const freshBtn = document.getElementById('confirm-btn');
  freshBtn.textContent = btnLabel;
  freshBtn.onclick = () => { onConfirm(); closeConfirm(); };
  document.getElementById('confirm-overlay').classList.add('open');
};
window.closeConfirm = function () {
  document.getElementById('confirm-overlay').classList.remove('open');
  // Clear handler so it can never fire stale callback
  const btn = document.getElementById('confirm-btn');
  if (btn) btn.onclick = null;
};

/* ════════════════════════════════════════════════════════════
   TYPE TOGGLE  (Expense / Income)
   ════════════════════════════════════════════════════════════ */
window.setType = function (type) {
  currentModalType = type;
  document.getElementById('tt-exp').classList.toggle('active', type === 'expense');
  document.getElementById('tt-inc').classList.toggle('active', type === 'income');
  const cats = type === 'expense' ? CATS_EXPENSE : CATS_INCOME;
  document.getElementById('m-cat').innerHTML = cats.map(c => `<option value="${c}">${catEmoji(c)} ${c}</option>`).join('');
};

window.setRecType = function (type) {
  currentRecType = type;
  document.getElementById('rt-exp').classList.toggle('active', type === 'expense');
  document.getElementById('rt-inc').classList.toggle('active', type === 'income');
};

function catEmoji(c) {
  return {
    Food: '🍽️', Transportation: '🚗', Housing: '🏠', Utilities: '⚡', Healthcare: '🏥',
    Entertainment: '🎬', Education: '📚', Shopping: '🛍️', Other: '📦',
    Salary: '💼', Freelance: '💻', Business: '📊', Investment: '📈', Gift: '🎁',
  }[c] || '•';
}

/* ════════════════════════════════════════════════════════════
   TRANSACTIONS — Firestore CRUD
   ════════════════════════════════════════════════════════════ */
window.saveTransaction = async function () {
  if (!_currentUser) { toast('Please sign in first', 'error'); return; }

  const date = document.getElementById('m-date').value;
  const cat = document.getElementById('m-cat').value;
  const amount = parseFloat(document.getElementById('m-amount').value);
  const desc = document.getElementById('m-desc').value.trim();
  const tags = document.getElementById('m-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const payment = document.getElementById('m-payment').value;
  const notes = document.getElementById('m-notes').value.trim();
  const editId = document.getElementById('m-edit-id').value;

  if (!date) { toast('Please select a date', 'error'); return; }
  if (!cat) { toast('Please select a category', 'error'); return; }
  if (!amount || amount <= 0) { toast('Please enter a valid amount', 'error'); return; }

  const walletEl = document.getElementById('m-wallet');
  const wallet = walletEl?.value || '';
  const record = { date, category: cat, amount, description: desc, tags, payment, notes, type: currentModalType, ...(wallet && { wallet }) };
  setSyncStatus('syncing');
  try {
    if (editId) {
      await updateTransaction(_currentUser.uid, editId, record);
      toast('Transaction updated ✓', 'success');
    } else {
      await addTransaction(_currentUser.uid, record);
      haptic('success');
      toast('Transaction saved ✓', 'success');
      // Check budget alerts after saving expense
      if (record.type === 'expense' && DB.budgets[record.category]) {
        const budget = DB.budgets[record.category];
        const now = new Date();
        const spent = DB.transactions
          .filter(t => t.type==='expense' && t.category===record.category && new Date(t.date).getMonth()===now.getMonth())
          .reduce((s,t) => s+t.amount, 0) + record.amount;
        const pct = Math.round(spent / budget.limit * 100);
        if (pct >= 100) {
          addNotification('budget', `Budget Exceeded!`,
            `You've gone over your ${record.category} budget by ${fmt(spent - budget.limit)}`, 'fa-wallet', '#ff6b6b');
        } else if (pct >= (budget.alertPct || 80)) {
          addNotification('budget', `Budget Alert`,
            `You've used ${pct}% of your ${record.category} budget (${fmt(spent)} of ${fmt(budget.limit)})`, 'fa-triangle-exclamation', '#ffd166');
        }
      }
    }
    closeModal();
    // listenTransactions fires automatically → renderAll()
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
    setSyncStatus('offline');
  }
};

window.deleteTransaction = function (id) {
  if (!_currentUser) return;
  const tx = DB.transactions.find(t => t.id === id);
  if (!tx) return;
  _deletedTx = { ...tx };
  if (_undoTimer) clearTimeout(_undoTimer);
  openConfirm('Delete Transaction', `Delete "${tx.description || tx.category}" (${fmt(tx.amount)})?`, async () => {
    setSyncStatus('syncing');
    try {
      await deleteTransaction(_currentUser.uid, id);
      showUndoToast(tx);
    } catch (e) { toast('Delete failed: ' + e.message, 'error'); setSyncStatus('offline'); }
  });
};

window.confirmClearAll = function () {
  openConfirm('Delete All Data', 'This permanently deletes ALL your data from Firebase. Cannot be undone!', async () => {
    setSyncStatus('syncing');
    try {
      await wipeAllUserData(_currentUser.uid);
      DB = { ...DB, transactions: [], budgets: {}, goals: [], recurring: [] };
      renderAll();
      toast('All data cleared', 'info');
    } catch (e) { toast('Error: ' + e.message, 'error'); setSyncStatus('offline'); }
  });
};

function clearFilters() {
  ['f-search', 'f-type', 'f-cat', 'f-from', 'f-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('f-sort').value = 'date-desc';
  renderTransactions();
}

/* ════════════════════════════════════════════════════════════
   BUDGETS — Firestore
   ════════════════════════════════════════════════════════════ */
window.saveBudget = async function () {
  if (!_currentUser) { toast('Please sign in first', 'error'); return; }
  const cat = document.getElementById('b-cat').value;
  const limit = parseFloat(document.getElementById('b-limit').value);
  const alertPct = parseInt(document.getElementById('b-alert-pct')?.value || 80);
  
  if (!cat) { toast('Select a category', 'error'); return; }
  if (isNaN(limit) || limit <= 0) { toast('Enter a valid budget limit', 'error'); return; }
  
  DB.budgets[cat] = { limit, alertPct };
  setSyncStatus('syncing');
  try {
    await saveBudgets(_currentUser.uid, DB.budgets);
    renderBudgets();
    document.getElementById('b-limit').value = '';
    toast(`Budget set for ${cat} ✓`, 'success');
    setSyncStatus('synced');
  } catch (e) { 
    toast('Save failed: ' + e.message, 'error'); 
    setSyncStatus('offline'); 
  }
};

window.deleteBudget = function (cat) {
  openConfirm('Remove Budget', `Remove the budget for "${cat}"?`, async () => {
    delete DB.budgets[cat];
    await saveBudgets(_currentUser.uid, DB.budgets);
    renderBudgets();
    toast(`Budget for ${cat} removed`, 'info');
  });
};

/* ════════════════════════════════════════════════════════════
   GOALS — Firestore
   ════════════════════════════════════════════════════════════ */
window.saveGoal = async function () {
  if (!_currentUser) { toast('Please sign in first', 'error'); return; }
  const name     = document.getElementById('g-name').value.trim();
  const target   = parseFloat(document.getElementById('g-target').value);
  const saved    = parseFloat(document.getElementById('g-saved').value) || 0;
  const date     = document.getElementById('g-date').value;
  const priority = document.getElementById('g-priority').value;
  const desc     = document.getElementById('g-desc').value.trim();

  if (!name)               { toast('Enter a goal name', 'error'); return; }
  if (!target || target <= 0) { toast('Enter a valid target amount', 'error'); return; }

  const btn = document.querySelector('[onclick="saveGoal()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

  setSyncStatus('syncing');
  try {
    const docId = await addGoal(_currentUser.uid, { name, target, saved, date, priority, desc });
    DB.goals.push({ id: docId, name, target, saved, date, priority, desc });
    renderGoals();
    // Clear form fields (use fieldId not id to avoid variable shadowing)
    ['g-name', 'g-target', 'g-saved', 'g-date', 'g-desc'].forEach(fieldId => {
      const el = document.getElementById(fieldId);
      if (el) el.value = '';
    });
    document.getElementById('g-priority').value = 'medium';
    toast(`Goal "${name}" added ✓`, 'success');
    setSyncStatus('synced');
  } catch (e) {
    console.error('saveGoal error:', e);
    toast(`Save failed: ${e.message || 'Check Firestore rules'}`, 'error');
    setSyncStatus('offline');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Add Goal'; }
  }
};

window.deleteGoal = function (id) {
  const g = DB.goals.find(g => g.id === id);
  openConfirm('Delete Goal', `Delete goal "${g?.name || 'this goal'}"?`, async () => {
    await deleteGoal(_currentUser.uid, id);
    DB.goals = DB.goals.filter(g => g.id !== id);
    renderGoals();
    toast('Goal deleted', 'info');
  });
};

window.updateGoalSaved = async function (id) {
  const g = DB.goals.find(g => g.id === id);
  if (!g) return;
  const val = parseFloat(prompt(`Update saved amount for "${g.name}" (current: ${fmt(g.saved)}):`));
  if (isNaN(val) || val < 0) return;
  await updateGoal(_currentUser.uid, id, { saved: val });
  const i = DB.goals.findIndex(g => g.id === id);
  if (i > -1) DB.goals[i].saved = val;
  renderGoals();
  toast('Goal updated ✓', 'success');
  // Fire confetti if goal is now complete
  const updated = DB.goals.find(g => g.id === id);
  if (updated && updated.saved >= updated.target) {
    launchConfetti();
    toast(`🎉 Goal "${updated.name}" completed! Amazing!`, 'success', 4000);
  }
};

/* ════════════════════════════════════════════════════════════
   RECURRING — Firestore
   ════════════════════════════════════════════════════════════ */
window.saveRecurring = async function () {
  if (!_currentUser) { toast('Please sign in first', 'error'); return; }
  const name   = document.getElementById('r-name').value.trim();
  const cat    = document.getElementById('r-cat').value;
  const freq   = document.getElementById('r-freq').value;
  const amount = parseFloat(document.getElementById('r-amount').value);
  const date   = document.getElementById('r-date').value;

  if (!name)              { toast('Enter a name', 'error'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }

  const btn = document.querySelector('[onclick="saveRecurring()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

  setSyncStatus('syncing');
  try {
    const docId = await addRecurring(_currentUser.uid, { name, category: cat, frequency: freq, amount, date, type: currentRecType });
    DB.recurring.push({ id: docId, name, category: cat, frequency: freq, amount, date, type: currentRecType });
    renderRecurring();
    ['r-name', 'r-amount', 'r-date'].forEach(fieldId => {
      const el = document.getElementById(fieldId);
      if (el) el.value = '';
    });
    toast(`"${name}" added ✓`, 'success');
    setSyncStatus('synced');
  } catch (e) {
    console.error('saveRecurring error:', e);
    toast(`Save failed: ${e.message || 'Check Firestore rules'}`, 'error');
    setSyncStatus('offline');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Add Recurring'; }
  }
};

window.deleteRecurring = function (id) {
  const r = DB.recurring.find(r => r.id === id);
  openConfirm('Delete Recurring', `Delete "${r?.name || 'this item'}"?`, async () => {
    await deleteRecurring(_currentUser.uid, id);
    DB.recurring = DB.recurring.filter(r => r.id !== id);
    renderRecurring();
    toast('Recurring removed', 'info');
  });
};

/* ── Auto-generate due recurring transactions ─────────────── */
async function autoGenerateDueRecurring() {
  if (!_currentUser || !DB.recurring.length) return;
  const today = todayStr();
  const lastRun = localStorage.getItem('nestfy-autorecur-' + _currentUser.uid);
  if (lastRun === today) return; // Already ran today

  let added = 0;
  for (const r of DB.recurring) {
    if (!r.date || !r.type || !r.amount) continue;
    const dueDate = r.date;
    if (dueDate > today) continue; // Not due yet

    // Check if already added for today
    const alreadyAdded = DB.transactions.some(
      t => t.description === r.name && t.date === today && t.amount === r.amount
    );
    if (alreadyAdded) continue;

    // Only auto-add if due TODAY (not overdue - user should handle those manually)
    if (dueDate === today) {
      try {
        await addTransaction(_currentUser.uid, {
          date: today,
          category: r.category,
          amount: r.amount,
          description: r.name + ' (auto)',
          type: r.type,
          payment: '',
          tags: ['recurring'],
          notes: 'Auto-generated from recurring',
        });
        added++;
      } catch(e) { /* silent */ }
    }
  }

  localStorage.setItem('nestfy-autorecur-' + _currentUser.uid, today);
  if (added > 0) {
    addNotification('recurring', 'Auto-generated', `${added} recurring transaction${added>1?'s':''} added for today`, 'fa-rotate', '#00d4aa');
    toast(`${added} recurring item${added>1?'s':''} auto-added ✓`, 'success', 3000);
  }
}

/* ════════════════════════════════════════════════════════════
   SETTINGS — Firestore
   ════════════════════════════════════════════════════════════ */
window.saveSettings = async function () {
  if (!_currentUser) return;
  DB.settings.name         = document.getElementById('s-name')?.value.trim() || '';
  DB.settings.monthlyIncome = parseFloat(document.getElementById('s-monthly-income')?.value) || 0;
  DB.settings.budgetAlerts  = document.getElementById('pref-alerts')?.checked !== false;
  DB.settings.compactView   = !!document.getElementById('pref-compact')?.checked;
  document.body.classList.toggle('compact-view', DB.settings.compactView);
  updateGreeting();
  try { await savePrefs(_currentUser.uid, DB.settings); toast('Settings saved ✓', 'success'); } catch (_) { /* silent */ }
};

function applySettings() {
  const { name, currency, monthlyIncome, budgetAlerts, compactView } = DB.settings;
  ['global-currency', 's-currency'].forEach(id => { const el = document.getElementById(id); if (el) el.value = currency || 'INR'; });
  const sName = document.getElementById('s-name'); if (sName) sName.value = name || '';
  const sInc  = document.getElementById('s-monthly-income'); if (sInc) sInc.value = monthlyIncome || '';
  const pAlert = document.getElementById('pref-alerts');  if (pAlert) pAlert.checked = budgetAlerts !== false;
  const pComp  = document.getElementById('pref-compact'); if (pComp)  pComp.checked  = !!compactView;
  // Apply compact view class to body
  document.body.classList.toggle('compact-view', !!compactView);
  document.querySelectorAll('[id$="-sym"]').forEach(el => el.textContent = sym());
}

/* ════════════════════════════════════════════════════════════
   EXPORT / IMPORT
   ════════════════════════════════════════════════════════════ */
window.exportCSV = function () {
  if (!DB.transactions.length) { toast('No transactions to export', 'error'); return; }
  const rows = [
    ['Date', 'Type', 'Category', 'Amount', 'Currency', 'Description', 'Tags', 'Payment', 'Notes'],
    ...DB.transactions.map(t => [
      t.date, t.type, t.category, t.amount, DB.settings.currency,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${(t.tags || []).join(';')}"`,
      t.payment || '',
      `"${(t.notes || '').replace(/"/g, '""')}"`,
    ])
  ];
  download(`nestfy_${todayStr()}.csv`, 'text/csv;charset=utf-8', rows.map(r => r.join(',')).join('\n'));
  toast('CSV exported ✓', 'success');
};

window.exportJSON = function () {
  download(`nestfy_backup_${todayStr()}.json`, 'application/json', JSON.stringify(DB, null, 2));
  toast('Backup exported ✓', 'success');
};

window.importJSON = function (input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.transactions) { toast('Invalid backup file', 'error'); return; }
      openConfirm('Import Backup', 'This will add imported transactions to your account. Continue?', async () => {
        if (!_currentUser) return;
        setSyncStatus('syncing');
        for (const tx of data.transactions) {
          const { id, createdAt, updatedAt, ...rest } = tx;
          await addTransaction(_currentUser.uid, rest);
        }
        toast('Data imported ✓', 'success');
      });
    } catch { toast('Could not read file', 'error'); }
  };
  reader.readAsText(file);
  input.value = '';
};

function download(name, type, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}

/* ════════════════════════════════════════════════════════════
   RENDER ALL
   ════════════════════════════════════════════════════════════ */
function renderAll() {
  renderDashboard();
  renderTransactions();
  renderBudgets();
  renderGoals();
  renderRecurring();
  updateBadge();
  renderAbout();
}

function updateBadge() {
  const el = document.getElementById('tx-count-badge');
  if (!el) return;
  const prev = parseInt(el.textContent) || 0;
  const next = DB.transactions.length;
  el.textContent = next;
  if (next !== prev) {
    el.style.transform = 'scale(1.4)';
    el.style.transition = 'transform .2s cubic-bezier(.34,1.56,.64,1)';
    setTimeout(() => { el.style.transform = 'scale(1)'; }, 200);
  }
}

/* ── Greeting ──────────────────────────────────────────────── */
function updateGreeting() {
  const h = new Date().getHours();
  const greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = DB.settings.name;
  const gEl = document.getElementById('greeting');
  const gSub = document.getElementById('greeting-sub');
  if (gEl) gEl.textContent = name ? `${greet}, ${name} 👋` : `${greet} 👋`;
  if (gSub) gSub.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD
   ════════════════════════════════════════════════════════════ */
function renderDashboard() {
  updateGreeting();
  const now = new Date(), curM = now.getMonth(), curY = now.getFullYear();
  const thisMonth = DB.transactions.filter(t => { const d = new Date(t.date); return d.getMonth() === curM && d.getFullYear() === curY; });
  const monthIncome = thisMonth.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthSpent = thisMonth.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const allIncome = DB.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const allSpent = DB.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = allIncome - allSpent;
  const effIncome = monthIncome || DB.settings.monthlyIncome;
  const savingsRate = effIncome > 0 ? Math.max(0, Math.round(((effIncome - monthSpent) / effIncome) * 100)) : 0;

  const set = animatedSet;

  set('s-income', fmt(monthIncome), 'var(--income)');
  set('s-income-sub', `${thisMonth.filter(t => t.type === 'income').length} transactions`);
  set('s-spent', fmt(monthSpent), 'var(--expense)');
  set('s-spent-sub', `${thisMonth.filter(t => t.type === 'expense').length} transactions`);
  set('s-balance', fmt(balance), balance >= 0 ? 'var(--income)' : 'var(--expense)');
  set('s-rate', savingsRate + '%');
  set('s-rate-sub', effIncome > 0 ? `${fmt(Math.max(0, effIncome - monthSpent))} saved` : 'Set income in Settings');

  renderInsights(thisMonth, monthSpent, effIncome);
  const piePeriod = document.getElementById('pie-period')?.value || 'month';
  renderPieChart(filterByPeriod(DB.transactions.filter(t => t.type === 'expense'), piePeriod));
  renderBarChart();
  renderRecent();
}

function filterByPeriod(arr, period) {
  const now = new Date(), m = now.getMonth(), y = now.getFullYear();
  if (period === 'month') return arr.filter(t => { const d = new Date(t.date); return d.getMonth() === m && d.getFullYear() === y; });
  if (period === '3month') { const cut = new Date(y, m - 2, 1); return arr.filter(t => new Date(t.date) >= cut); }
  if (period === 'year') return arr.filter(t => new Date(t.date).getFullYear() === y);
  return arr;
}

function renderInsights(thisMonth, spent, income) {
  const el = document.getElementById('insights-row'); if (!el) return;
  const catTotals = {};
  thisMonth.filter(t => t.type === 'expense').forEach(t => catTotals[t.category] = (catTotals[t.category] || 0) + t.amount);
  const top = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  const day = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const projected = day > 0 ? (spent / day) * daysInMonth : 0;
  el.innerHTML = `
    <div class="insight">
      <div class="insight-icon"><i class="fas fa-fire-flame-curved"></i></div>
      <div>
        <h4>Top Category: ${top ? top[0] : 'No expenses yet'}</h4>
        <p>${top ? `${fmt(top[1])} spent on ${top[0]} this month (${Math.round(top[1] / spent * 100) || 0}% of total)` : 'Add your expenses to see insights'}</p>
      </div>
    </div>
    <div class="insight" style="background:linear-gradient(135deg,rgba(124,106,255,.06),rgba(255,107,107,.04));border-color:rgba(124,106,255,.12)">
      <div class="insight-icon" style="background:rgba(124,106,255,.12);color:var(--accent2)"><i class="fas fa-chart-line"></i></div>
      <div>
        <h4>Projected Month: ${fmt(projected)}</h4>
        <p>Daily avg ${fmt(day > 0 ? spent / day : 0)} · ${daysInMonth - day} days left this month</p>
      </div>
    </div>`;
}

function renderRecent() {
  const el = document.getElementById('recent-list'); if (!el) return;
  const recent = [...DB.transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 7);
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state" style="padding:30px 0"><div class="empty-icon"><i class="fas fa-receipt"></i></div><h3>No transactions yet</h3><p>Add your first transaction to get started</p></div>`;
    return;
  }
  el.innerHTML = recent.map(t => `
    <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openModal('${t.id}')">
      <div style="width:34px;height:34px;border-radius:9px;background:${CAT_COLORS[t.category] || '#64748b'}18;display:flex;align-items:center;justify-content:center;color:${CAT_COLORS[t.category] || '#94a3b8'};font-size:.82rem;flex-shrink:0">
        <i class="fas ${CAT_ICONS[t.category] || 'fa-tag'}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(t.description || t.category)}</div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:1px">${fmtDate(t.date)} · ${t.category}</div>
      </div>
      <div style="font-family:var(--fm);font-size:.82rem;font-weight:700;color:${t.type === 'income' ? 'var(--income)' : 'var(--expense)'};flex-shrink:0">
        ${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}
      </div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   CHARTS
   ════════════════════════════════════════════════════════════ */
function renderPieChart(expenses) {
  const catTotals = {};
  expenses.forEach(t => catTotals[t.category] = (catTotals[t.category] || 0) + t.amount);
  const total = Object.values(catTotals).reduce((s, v) => s + v, 0);
  const labels = Object.keys(catTotals), data = Object.values(catTotals);
  const colors = labels.map(l => CAT_COLORS[l] || '#64748b');
  destroyChart('pie');
  const ctx = document.getElementById('chart-pie'); if (!ctx) return;
  chartInstances.pie = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors.map(c => c + 'bb'), borderColor: colors, borderWidth: 2, hoverOffset: 10 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: document.body.classList.contains('light') ? '#fff' : '#1a2035', titleColor: document.body.classList.contains('light') ? '#0f172a' : '#e2e8f0', bodyColor: document.body.classList.contains('light') ? '#475569' : '#94a3b8', borderColor: document.body.classList.contains('light') ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)', borderWidth: 1,
          callbacks: { label: c => `${c.label}: ${fmt(c.raw)} (${total ? Math.round(c.raw / total * 100) : 0}%)` }
        }
      }
    }
  });
  const leg = document.getElementById('pie-legend'); if (!leg) return;
  if (!labels.length) { leg.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:8px 0">No data for this period</div>'; return; }
  leg.innerHTML = labels.map((l, i) => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${colors[i]}"></div>
      <span style="flex:1">${l}</span>
      <div class="legend-bar-wrap"><div class="legend-bar"><div class="legend-fill" style="width:${total ? Math.round(data[i] / total * 100) : 0}%;background:${colors[i]}"></div></div></div>
      <span class="legend-pct">${total ? Math.round(data[i] / total * 100) : 0}%</span>
      <span class="legend-amt">${fmt(data[i])}</span>
    </div>`).join('');
}

function renderBarChart() {
  const months = getLast6Months();
  const incArr = months.map(m => getMonthTotal(m, 'income'));
  const expArr = months.map(m => getMonthTotal(m, 'expense'));
  destroyChart('bar');
  const ctx = document.getElementById('chart-bar'); if (!ctx) return;
  chartInstances.bar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label), datasets: [
        { label: 'Income', data: incArr, backgroundColor: 'rgba(0,212,170,.5)', borderColor: '#00d4aa', borderWidth: 2, borderRadius: 6, borderSkipped: false },
        { label: 'Expenses', data: expArr, backgroundColor: 'rgba(255,107,107,.5)', borderColor: '#ff6b6b', borderWidth: 2, borderRadius: 6, borderSkipped: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } } }, tooltip: { backgroundColor: document.body.classList.contains('light') ? '#fff' : '#1a2035', titleColor: document.body.classList.contains('light') ? '#0f172a' : '#e2e8f0', bodyColor: document.body.classList.contains('light') ? '#475569' : '#94a3b8', borderColor: document.body.classList.contains('light') ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)', borderWidth: 1, callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { x: { ticks: { color: document.body.classList.contains('light') ? '#94a3b8' : '#64748b', font: { family: 'Outfit' } }, grid: { color: document.body.classList.contains('light') ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)' } }, y: { ticks: { color: document.body.classList.contains('light') ? '#94a3b8' : '#64748b', font: { family: 'Outfit' }, callback: v => sym() + abbreviate(v) }, grid: { color: document.body.classList.contains('light') ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)' }, beginAtZero: true } }
    }
  });
}

/* ════════════════════════════════════════════════════════════
   TRANSACTIONS TABLE
   ════════════════════════════════════════════════════════════ */
function renderTransactions() {
  populateCatFilter();
  const search = (document.getElementById('f-search')?.value || '').toLowerCase().trim();
  const type = document.getElementById('f-type')?.value || '';
  const cat = document.getElementById('f-cat')?.value || '';
  const from = document.getElementById('f-from')?.value || '';
  const to = document.getElementById('f-to')?.value || '';
  const sort = document.getElementById('f-sort')?.value || 'date-desc';

  let list = [...DB.transactions];
  if (type) list = list.filter(t => t.type === type);
  if (cat) list = list.filter(t => t.category === cat);
  if (from) list = list.filter(t => t.date >= from);
  if (to) list = list.filter(t => t.date <= to);
  if (search) list = list.filter(t =>
    (t.description || '').toLowerCase().includes(search) ||
    (t.category || '').toLowerCase().includes(search) ||
    (t.notes || '').toLowerCase().includes(search) ||
    (t.tags || []).join(' ').toLowerCase().includes(search)
  );

  const [sk, sd] = sort.split('-');
  list.sort((a, b) => { const v = sk === 'date' ? new Date(a.date) - new Date(b.date) : a.amount - b.amount; return sd === 'desc' ? -v : v; });

  const tbody = document.getElementById('tx-body');
  const empty = document.getElementById('tx-empty');
  const footer = document.getElementById('tx-footer');
  if (!tbody) return;

  if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; footer.style.display = 'none'; return; }
  empty.style.display = 'none'; footer.style.display = 'flex';

  const totalFiltered = list.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
  const txCount = document.getElementById('tx-count-text');
  const txTotal = document.getElementById('tx-total-text');
  if (txCount) txCount.textContent = `${list.length} record${list.length !== 1 ? 's' : ''} shown`;
  if (txTotal) txTotal.textContent = `Net: ${totalFiltered >= 0 ? '+' : ''}${fmt(totalFiltered)}`;

  tbody.innerHTML = list.map(t => `
    <tr>
      <td style="white-space:nowrap;font-size:.78rem;color:var(--muted2)">${fmtDate(t.date)}</td>
      <td><span class="badge ${t.type === 'income' ? 'badge-income-type' : 'badge-expense-type'}">${t.type === 'income' ? '↓ Income' : '↑ Expense'}</span></td>
      <td><span class="badge ${CAT_BADGES[t.category] || 'badge-other'}"><i class="fas ${CAT_ICONS[t.category] || 'fa-tag'} fa-xs"></i> ${t.category}</span></td>
      <td style="max-width:220px">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">${escHtml(t.description || '—')}</div>
        ${t.notes ? `<div style="font-size:.65rem;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.notes)}</div>` : ''}
      </td>
      <td style="text-align:right" class="amount-col">
        <div class="transaction-amount ${t.type === 'income' ? 'col-income' : 'col-expense'}">
          ${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}
        </div>
      </td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-icon btn-sm" onclick="openModal('${t.id}')" title="Edit"><i class="fas fa-pencil"></i></button>
        <button class="btn btn-danger btn-icon btn-sm" onclick="deleteTransaction('${t.id}')" title="Delete"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('');
    
  renderCatPills();
}

function populateCatFilter() {
  const sel = document.getElementById('f-cat'); if (!sel) return;
  const cats = [...new Set(DB.transactions.map(t => t.category))].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.value = cur;
}

/* ════════════════════════════════════════════════════════════
   BUDGETS RENDER
   ════════════════════════════════════════════════════════════ */
function updateBudgetMonthLabel() {
  const el = document.getElementById('budget-month-label');
  if (el) {
    const d = new Date(_viewYear, _viewMonth);
    el.textContent = d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
  }
}

function renderBudgets() {
  updateBudgetMonthLabel();
  const el = document.getElementById('budget-list');
  if (!el) return;
  
  const entries = Object.entries(DB.budgets);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fas fa-wallet"></i></div><h3>No budgets set</h3><p>Use the form to set monthly limits</p></div>`;
    return;
  }
  
  const now = new Date(), cm = now.getMonth(), cy = now.getFullYear();
  const monthExp = {};
  DB.transactions.filter(t => {
    const d = new Date(t.date);
    return t.type === 'expense' && d.getMonth() === (_viewMonth ?? cm) && d.getFullYear() === (_viewYear ?? cy);
  }).forEach(t => { 
    monthExp[t.category] = (monthExp[t.category] || 0) + t.amount; 
  });

  el.innerHTML = entries.map(([cat, cfg]) => {
    const limit = typeof cfg === 'object' ? cfg.limit : cfg;
    const alertPct = typeof cfg === 'object' ? (cfg.alertPct || 80) : 80;
    const spent = monthExp[cat] || 0;
    const pct = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
    const over = spent > limit;
    const warn = pct >= alertPct && !over;
    const color = over ? 'var(--expense)' : warn ? 'var(--gold)' : 'var(--income)';
    
    // Ring chart logic
    const r = 21, circ = 2 * Math.PI * r;
    const dash = circ * (pct / 100), gap = circ - dash;

    return `
      <div class="budget-item">
        <div class="budget-ring-wrap">
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--card2)" stroke-width="5"/>
            <circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="5"
              stroke-dasharray="${dash} ${gap}" stroke-linecap="round"/>
          </svg>
          <div class="ring-text" style="color:${color}">${pct}%</div>
        </div>
        <div class="budget-info">
          <div class="budget-cat">
            <i class="fas ${CAT_ICONS[cat] || 'fa-tag'}" style="color:${CAT_COLORS[cat] || '#64748b'}"></i>
            ${cat}
            ${over ? '<span style="font-size:.62rem;color:var(--expense);font-weight:700">OVER</span>' :
              warn ? '<span style="font-size:.62rem;color:var(--gold);font-weight:700">NEAR LIMIT</span>' : ''}
          </div>
          <div class="budget-nums">${fmt(spent)} / ${fmt(limit)} · ${fmt(Math.max(0, limit - spent))} left</div>
          <div class="budget-bar-wrap"><div class="budget-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>
        <button class="budget-delete" onclick="deleteBudget('${cat}')" title="Remove budget"><i class="fas fa-times"></i></button>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   GOALS RENDER
   ════════════════════════════════════════════════════════════ */
function renderGoals() {
  const el = document.getElementById('goals-list'); if (!el) return;
  if (!DB.goals.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fas fa-bullseye"></i></div><h3>No savings goals</h3><p>Add your first goal using the form</p></div>`;
    return;
  }
  const priorityColor = { high: 'var(--expense)', medium: 'var(--gold)', low: 'var(--income)' };
  el.innerHTML = DB.goals.map(g => {
    const pct = Math.min(100, Math.round(g.saved / g.target * 100));
    const daysLeft = g.date ? Math.ceil((new Date(g.date) - new Date()) / 86400000) : null;
    const done = pct >= 100;
    return `
      <div class="goal-card">
        <div class="goal-head">
          <div>
            <div class="goal-name" style="${done ? 'color:var(--income)' : ''}">
              ${done ? '✅ ' : ''}${escHtml(g.name)}
              <span style="font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid;color:${priorityColor[g.priority]};border-color:${priorityColor[g.priority]}33;background:${priorityColor[g.priority]}11;margin-left:6px">${g.priority}</span>
            </div>
            <div class="goal-target">${g.desc ? escHtml(g.desc) : ''}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-icon btn-sm" onclick="updateGoalSaved('${g.id}')" title="Update saved"><i class="fas fa-plus"></i></button>
            <button class="btn btn-danger btn-icon btn-sm" onclick="deleteGoal('${g.id}')"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="progress" style="height:8px"><div class="progress-fill" style="width:${pct}%;background:${done ? 'var(--income)' : 'linear-gradient(90deg,var(--accent2),var(--accent))'}"></div></div>
        <div class="goal-pct-row" style="margin-top:6px">
          <span style="font-size:.72rem;font-weight:700;color:${done ? 'var(--income)' : 'var(--accent)'}">${pct}%</span>
          <span style="font-size:.72rem;color:var(--muted)">${fmt(g.saved)} / ${fmt(g.target)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:4px">
          <span>${fmt(Math.max(0, g.target - g.saved))} remaining</span>
          ${daysLeft !== null ? `<span>${daysLeft > 0 ? daysLeft + ' days left' : daysLeft === 0 ? 'Due today' : '<span style="color:var(--expense)">Overdue</span>'}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════
   RECURRING RENDER
   ════════════════════════════════════════════════════════════ */
function renderRecurring() {
  const el = document.getElementById('rec-list');
  const cnt = document.getElementById('rec-count');
  if (!el) return;
  const recInc = DB.recurring.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const recExp = DB.recurring.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const net = recInc - recExp;
  const sumEl = document.getElementById('rec-summary');
  if (sumEl) sumEl.innerHTML = `
    <div class="card-head"><div class="card-title-lg">Monthly Overview</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:4px">RECURRING IN</div><div style="font-family:var(--fm);font-weight:700;color:var(--income)">${fmt(recInc)}</div></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:4px">RECURRING OUT</div><div style="font-family:var(--fm);font-weight:700;color:var(--expense)">${fmt(recExp)}</div></div>
      <div><div style="font-size:.68rem;color:var(--muted);margin-bottom:4px">NET/MONTH</div><div style="font-family:var(--fm);font-weight:700;color:${net >= 0 ? 'var(--income)' : 'var(--expense)'}">${net >= 0 ? '+' : ''}${fmt(net)}</div></div>
    </div>`;
  if (!DB.recurring.length) {
    el.innerHTML = `<div class="empty-state" style="padding:36px 0"><div class="empty-icon"><i class="fas fa-rotate"></i></div><h3>No recurring items</h3><p>Add subscriptions, rent, or salary</p></div>`;
    if (cnt) cnt.textContent = ''; return;
  }
  if (cnt) cnt.textContent = `${DB.recurring.length} item${DB.recurring.length !== 1 ? 's' : ''}`;
  const freqLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
  el.innerHTML = DB.recurring.map(r => `
    <div class="rec-item">
      <div class="rec-icon" style="background:${r.type === 'income' ? 'rgba(0,212,170,.12)' : 'rgba(255,107,107,.12)'}">
        <i class="fas ${CAT_ICONS[r.category] || 'fa-rotate'}" style="color:${r.type === 'income' ? 'var(--income)' : 'var(--expense)'}"></i>
      </div>
      <div class="rec-info">
        <div class="rec-name">${escHtml(r.name)}<span class="freq-pill">${freqLabel[r.frequency] || r.frequency}</span></div>
        <div class="rec-detail">${r.category} · ${r.type}${r.date ? ` · Due ${fmtDate(r.date)}` : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="rec-amount ${r.type === 'income' ? 'col-income' : 'col-expense'}">${r.type === 'income' ? '+' : '-'}${fmt(r.amount)}</div>
        <button class="btn btn-danger btn-sm" style="margin-top:5px" onclick="deleteRecurring('${r.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   ANALYTICS
   ════════════════════════════════════════════════════════════ */
function renderAnalytics() {
  const months = getLast12Months();
  const incArr = months.map(m => getMonthTotal(m, 'income'));
  const expArr = months.map(m => getMonthTotal(m, 'expense'));
  destroyChart('line');
  const lctx = document.getElementById('chart-line');
  if (lctx) chartInstances.line = new Chart(lctx, {
    type: 'line',
    data: {
      labels: months.map(m => m.label), datasets: [
        { label: 'Income', data: incArr, borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,.08)', fill: true, tension: .4, pointBackgroundColor: '#00d4aa', pointRadius: 4, pointHoverRadius: 6 },
        { label: 'Expenses', data: expArr, borderColor: '#ff6b6b', backgroundColor: 'rgba(255,107,107,.08)', fill: true, tension: .4, pointBackgroundColor: '#ff6b6b', pointRadius: 4, pointHoverRadius: 6 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Outfit' } } }, tooltip: { backgroundColor: document.body.classList.contains('light') ? '#fff' : '#1a2035', titleColor: document.body.classList.contains('light') ? '#0f172a' : '#e2e8f0', bodyColor: document.body.classList.contains('light') ? '#475569' : '#94a3b8', borderColor: document.body.classList.contains('light') ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)', borderWidth: 1, callbacks: { label: c => `${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { x: { ticks: { color: document.body.classList.contains('light') ? '#94a3b8' : '#64748b', font: { family: 'Outfit' } }, grid: { color: document.body.classList.contains('light') ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)' } }, y: { ticks: { color: document.body.classList.contains('light') ? '#94a3b8' : '#64748b', font: { family: 'Outfit' }, callback: v => sym() + abbreviate(v) }, grid: { color: document.body.classList.contains('light') ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)' }, beginAtZero: true } }
    }
  });
  const catT = {};
  DB.transactions.filter(t => t.type === 'expense').forEach(t => catT[t.category] = (catT[t.category] || 0) + t.amount);
  const dLabels = Object.keys(catT), dData = Object.values(catT), dColors = dLabels.map(l => CAT_COLORS[l] || '#64748b');
  destroyChart('donut');
  const dctx = document.getElementById('chart-donut');
  if (dctx) chartInstances.donut = new Chart(dctx, { type: 'doughnut', data: { labels: dLabels, datasets: [{ data: dData, backgroundColor: dColors.map(c => c + 'bb'), borderColor: dColors, borderWidth: 2, hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } } }, tooltip: { backgroundColor: document.body.classList.contains('light') ? '#fff' : '#1a2035', titleColor: document.body.classList.contains('light') ? '#0f172a' : '#e2e8f0', bodyColor: document.body.classList.contains('light') ? '#475569' : '#94a3b8', borderColor: document.body.classList.contains('light') ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)', borderWidth: 1, callbacks: { label: c => `${c.label}: ${fmt(c.raw)}` } } } } });
  const daily = {}, cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 29);
  for (let d = new Date(cutoff); d <= new Date(); d.setDate(d.getDate() + 1)) daily[d.toISOString().slice(0, 10)] = 0;
  DB.transactions.filter(t => t.type === 'expense' && new Date(t.date) >= cutoff).forEach(t => { daily[t.date] = (daily[t.date] || 0) + t.amount; });
  const dKeys = Object.keys(daily).sort(), dVals = dKeys.map(k => daily[k]);
  destroyChart('daily');
  const dyctx = document.getElementById('chart-daily');
  if (dyctx) chartInstances.daily = new Chart(dyctx, { type: 'bar', data: { labels: dKeys.map((d, i) => { const dt = new Date(d + 'T00:00:00'); return dt.getDate() === 1 || i === 0 ? dt.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : String(dt.getDate()); }), datasets: [{ label: 'Spending', data: dVals, backgroundColor: dVals.map(v => v > 0 ? 'rgba(255,107,107,.6)' : 'rgba(100,116,139,.2)'), borderColor: dVals.map(v => v > 0 ? '#ff6b6b' : '#475569'), borderWidth: 1, borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: document.body.classList.contains('light') ? '#fff' : '#1a2035', titleColor: document.body.classList.contains('light') ? '#0f172a' : '#e2e8f0', bodyColor: document.body.classList.contains('light') ? '#475569' : '#94a3b8', borderColor: document.body.classList.contains('light') ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)', borderWidth: 1, callbacks: { label: c => `Spent: ${fmt(c.raw)}` } } }, scales: { x: { ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 }, maxTicksLimit: 15 }, grid: { display: false } }, y: { ticks: { color: document.body.classList.contains('light') ? '#94a3b8' : '#64748b', font: { family: 'Outfit' }, callback: v => sym() + abbreviate(v) }, grid: { color: document.body.classList.contains('light') ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)' }, beginAtZero: true } } } });
  const allInc = DB.transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const allExp = DB.transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const avg = DB.transactions.filter(t => t.type === 'expense').length ? allExp / DB.transactions.filter(t => t.type === 'expense').length : 0;
  const maxTx = DB.transactions.reduce((max, t) => t.amount > max.amount ? t : max, { amount: 0 });
  const metrics = document.getElementById('analytics-metrics');
  if (metrics) metrics.innerHTML = [['Total Income', fmt(allInc), 'var(--income)'], ['Total Expenses', fmt(allExp), 'var(--expense)'], ['Net Balance', fmt(allInc - allExp), allInc >= allExp ? 'var(--income)' : 'var(--expense)'], ['Avg Transaction', fmt(avg), 'var(--text)'], ['Total Records', DB.transactions.length, 'var(--text)'], ['Largest Expense', maxTx.amount ? fmt(maxTx.amount) : '—', 'var(--gold)']].map(([l, v, c]) => `<div class="analytics-stat"><span class="label">${l}</span><span class="value" style="color:${c}">${v}</span></div>`).join('');
  const topCats = document.getElementById('analytics-top-cats');
  const total2 = Object.values(catT).reduce((s, v) => s + v, 0);
  const sorted = Object.entries(catT).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (topCats) topCats.innerHTML = sorted.length ? sorted.map(([cat, amt]) => `<div class="legend-item"><div class="legend-dot" style="background:${CAT_COLORS[cat] || '#64748b'}"></div><span style="flex:1">${cat}</span><div class="legend-bar-wrap"><div class="legend-bar"><div class="legend-fill" style="width:${total2 ? Math.round(amt / total2 * 100) : 0}%;background:${CAT_COLORS[cat] || '#64748b'}"></div></div></div><span class="legend-pct">${total2 ? Math.round(amt / total2 * 100) : 0}%</span><span class="legend-amt">${fmt(amt)}</span></div>`).join('') : '<div style="color:var(--muted);font-size:.8rem">No expense data yet</div>';

  // Heatmap — always render at the end of analytics
  renderHeatmap();
}

/* heatmap called directly inside renderAnalytics below */
/* ════════════════════════════════════════════════════════════
   ABOUT
   ════════════════════════════════════════════════════════════ */
function renderAbout() {
  const el = document.getElementById('about-stats'); if (!el) return;
  const first = DB.transactions.length ? [...DB.transactions].sort((a, b) => a.date.localeCompare(b.date))[0].date : null;
  el.innerHTML = [
    ['Transactions', DB.transactions.length],
    ['Budgets set', Object.keys(DB.budgets).length],
    ['Savings goals', DB.goals.length],
    ['Recurring items', DB.recurring.length],
    ['Tracking since', first ? fmtDate(first) : '—'],
    ['Version', 'Nestfy v1.0'],
  ].map(([l, v]) => `<div class="analytics-stat"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('');
}

/* ════════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════════ */
function getLast6Months() {
  const now = new Date(), res = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); res.push({ label: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }), month: d.getMonth(), year: d.getFullYear() }); }
  return res;
}
function getLast12Months() {
  const now = new Date(), res = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); res.push({ label: d.toLocaleDateString('en', { month: 'short' }), month: d.getMonth(), year: d.getFullYear() }); }
  return res;
}
function getMonthTotal({ month, year }, type) {
  return DB.transactions.filter(t => { const d = new Date(t.date); return t.type === type && d.getMonth() === month && d.getFullYear() === year; }).reduce((s, t) => s + t.amount, 0);
}
function destroyChart(k) { if (chartInstances[k]) { chartInstances[k].destroy(); delete chartInstances[k]; } }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function abbreviate(v) { if (v >= 1e7) return (v / 1e7).toFixed(1) + 'Cr'; if (v >= 1e5) return (v / 1e5).toFixed(1) + 'L'; if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'; return v; }

/* ── Toast ─────────────────────────────────────────────────── */
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = 'all .3s'; setTimeout(() => el.remove(), 300); }, duration);
}

/* ── Keyboard shortcuts ────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  const typing = ['INPUT','TEXTAREA','SELECT'].includes(tag);

  if (e.key === 'Escape') {
    closeModal(); closeConfirm();
    if (document.getElementById('cmd-overlay')?.classList.contains('open')) closeCmd();
    if (document.getElementById('shortcuts-panel')?.style.display !== 'none') toggleShortcuts();
    // Close notif panel
    const np = document.getElementById('notif-panel');
    if (np?.classList.contains('open')) toggleNotifPanel();
    // Close logout modal if open
    const logoutOverlay = document.getElementById('logout-modal-overlay');
    if (logoutOverlay) { logoutOverlay.remove(); }
    // Safety net: always release scroll lock on Escape
    document.body.style.overflow = '';
    document.body.classList.remove('modal-open');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (document.getElementById('modal-overlay').classList.contains('open')) saveTransaction();
  }
  // Keyboard shortcuts only on desktop
  if (window.innerWidth > 768) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); openModal(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmd(); }
    if (e.key === '?' && !typing) { e.preventDefault(); toggleShortcuts(); }
  }

  // Enter key on auth panels
  const activePanel = document.querySelector('.auth-panel.active');
  if (e.key === 'Enter' && activePanel && !typing) {
    if (activePanel.id === 'panel-login') handleEmailLogin();
    if (activePanel.id === 'panel-signup') handleEmailSignup();
  }
});

/* ── Init ──────────────────────────────────────────────────── */
(function init() {
  const mDate = document.getElementById('m-date'); if (mDate) mDate.value = todayStr();
  const rDate = document.getElementById('r-date'); if (rDate) rDate.value = todayStr();
  setType('expense');
  initSwipeToDelete();
  initBottomNav();
  console.log('Nestfy v2.0 initialized ✓');
})();

/* ════════════════════════════════════════════════════════════
   DAY / NIGHT THEME TOGGLE
   ════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   THEME ENGINE — Day / Night Toggle
   ════════════════════════════════════════════════════════════ */

// Apply theme immediately on script load (before DOM) to avoid flash
(function () {
  const saved = localStorage.getItem('nestfy-theme') || 'dark';
  if (saved === 'light') document.documentElement.classList.add('light-init');
})();

function applyTheme(theme, save = true) {
  const isLight = theme === 'light';

  document.documentElement.classList.toggle('light-init', isLight);
  document.body.classList.toggle('light', isLight);

  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon)  icon.className    = isLight ? 'fas fa-sun' : 'fas fa-moon';
  if (label) label.textContent = isLight ? 'Light Mode' : 'Dark Mode';

  // Update Chart.js defaults
  if (window.Chart) {
    const C = {
      text:     isLight ? '#475569' : '#64748b',
      grid:     isLight ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.04)',
      ttBg:     isLight ? '#ffffff'  : '#1a2035',
      ttTitle:  isLight ? '#0f172a'  : '#e2e8f0',
      ttBody:   isLight ? '#475569'  : '#94a3b8',
      ttBorder: isLight ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)',
    };
    Chart.defaults.color = C.text;
    Chart.defaults.plugins.tooltip.backgroundColor = C.ttBg;
    Chart.defaults.plugins.tooltip.titleColor      = C.ttTitle;
    Chart.defaults.plugins.tooltip.bodyColor       = C.ttBody;
    Chart.defaults.plugins.tooltip.borderColor     = C.ttBorder;
    Chart.defaults.plugins.tooltip.borderWidth     = 1;
    // Chart.js v4 — set scale defaults via scales.x/y not Chart.defaults.scale
    if (Chart.defaults.scales) {
      ['x', 'y', 'r'].forEach(axis => {
        if (Chart.defaults.scales[axis]) {
          Chart.defaults.scales[axis].grid  = { color: C.grid };
          Chart.defaults.scales[axis].ticks = { color: C.text };
        }
      });
    }

    // Only re-render charts when logged in and data is loaded
    if (_currentUser && DB.transactions !== undefined) {
      Object.keys(chartInstances).forEach(k => {
        if (chartInstances[k]) { chartInstances[k].destroy(); delete chartInstances[k]; }
      });
      renderDashboard();
      const activePage = document.querySelector('.page.active');
      if (activePage?.id === 'page-analytics') setTimeout(renderAnalytics, 50);
    }
  }

  if (save) localStorage.setItem('nestfy-theme', theme);
}

window.toggleTheme = function () {
  applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
};

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('nestfy-theme') || 'dark', false);
});


/* ════════════════════════════════════════════════════════════
   FEATURE 1: ANIMATED NUMBER COUNTERS
   ════════════════════════════════════════════════════════════ */
function animateCounter(el, targetStr, duration = 800) {
  if (!el) return;
  // Extract numeric value and prefix/suffix
  const num = parseFloat(targetStr.replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) { el.textContent = targetStr; return; }
  
  const prefix = targetStr.match(/^[^0-9-]*/)?.[0] || '';
  const suffix = targetStr.match(/[^0-9.]+$/)?.[0] || '';
  const decimals = (targetStr.split('.')?.[1]?.replace(/[^0-9]/g,'') || '').length;
  
  const start = performance.now();
  const startVal = 0;
  
  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startVal + (num - startVal) * eased;
    el.textContent = prefix + current.toFixed(decimals) + suffix;
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = targetStr;
  }
  requestAnimationFrame(update);
}

// Override the set() function inside renderDashboard to animate
function animatedSet(id, val, color) {
  const el = document.getElementById(id);
  if (!el) return;
  if (color) el.style.color = color;
  // Only animate numeric stat values
  if (id.startsWith('s-') && (val.includes('₹') || val.includes('$') || val.includes('%'))) {
    animateCounter(el, val, 700);
  } else {
    el.textContent = val;
  }
}

/* ════════════════════════════════════════════════════════════
   FEATURE 2: SPENDING HEATMAP CALENDAR
   ════════════════════════════════════════════════════════════ */
function renderHeatmap() {
  const el = document.getElementById('heatmap-container');
  if (!el) return;

  const today = new Date();
  const weeks = 26;

  // Build daily spending map
  const spendMap = {};
  DB.transactions
    .filter(t => t.type === 'expense')
    .forEach(t => { spendMap[t.date] = (spendMap[t.date] || 0) + t.amount; });

  const maxSpend = Math.max(...Object.values(spendMap), 1);

  // Align start to Sunday, 26 weeks ago
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7));
  start.setDate(start.getDate() - start.getDay());

  // Month labels
  let monthsHtml = '';
  const monthsSeen = new Set();
  for (let w = 0; w < weeks; w++) {
    const d = new Date(start);
    d.setDate(d.getDate() + w * 7);
    const key = d.getMonth() + '-' + d.getFullYear();
    if (!monthsSeen.has(key)) {
      monthsSeen.add(key);
      monthsHtml += `<span>${d.toLocaleDateString('en', { month: 'short' })}</span>`;
    } else {
      monthsHtml += `<span></span>`;
    }
  }

  // Day labels (only Sun, Wed, Sat for cleanliness)
  const dayLabels = ['Sun','','','Wed','','','Sat'];
  const daysHtml = dayLabels.map(d => `<span>${d}</span>`).join('');

  // Week columns
  let cellsHtml = '';
  for (let w = 0; w < weeks; w++) {
    cellsHtml += '<div class="heatmap-week">';
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(date.getDate() + w * 7 + d);
      if (date > today) {
        cellsHtml += '<div class="heatmap-cell heatmap-future"></div>';
        continue;
      }
      const dateStr = date.toISOString().slice(0, 10);
      const spend = spendMap[dateStr] || 0;
      const intensity = spend > 0 ? Math.min(4, Math.ceil((spend / maxSpend) * 4)) : 0;
      const isToday = dateStr === todayStr();
      const title = spend > 0 ? `${fmtDate(dateStr)}: ${fmt(spend)}` : fmtDate(dateStr);
      cellsHtml += `<div class="heatmap-cell heatmap-${intensity}${isToday ? ' heatmap-today' : ''}" title="${title}" onclick="heatmapClick('${dateStr}','${spend}')"></div>`;
    }
    cellsHtml += '</div>';
  }

  // Legend
  const legendHtml = `
    <div class="heatmap-legend">
      <span style="color:var(--muted);font-size:.7rem">Less</span>
      <div class="heatmap-cell heatmap-0"></div>
      <div class="heatmap-cell heatmap-1"></div>
      <div class="heatmap-cell heatmap-2"></div>
      <div class="heatmap-cell heatmap-3"></div>
      <div class="heatmap-cell heatmap-4"></div>
      <span style="color:var(--muted);font-size:.7rem">More</span>
    </div>`;

  el.innerHTML = `
    <div class="heatmap-grid">
      <div class="heatmap-months">${monthsHtml}</div>
      <div class="heatmap-body">
        <div class="heatmap-days">${daysHtml}</div>
        <div class="heatmap-cells">${cellsHtml}</div>
      </div>
      ${legendHtml}
    </div>`;
}

window.heatmapClick = function(date, spend) {
  if (parseFloat(spend.replace(/[^0-9.]/g,'')) === 0) return;
  // Filter transactions page to that date
  nav(document.querySelector('[data-page="transactions"]'), 'transactions');
  const fFrom = document.getElementById('f-from');
  const fTo   = document.getElementById('f-to');
  if (fFrom) fFrom.value = date;
  if (fTo)   fTo.value   = date;
  renderTransactions();
  toast(`Showing transactions for ${date}`, 'info');
};

/* ════════════════════════════════════════════════════════════
   FEATURE 3: MULTIPLE WALLETS
   ════════════════════════════════════════════════════════════ */
const DEFAULT_WALLETS = [
  { id: 'cash',   name: 'Cash',       icon: 'fa-money-bills',    color: '#00d4aa' },
  { id: 'bank',   name: 'Bank',       icon: 'fa-building-columns',color: '#7c6aff' },
  { id: 'card',   name: 'Card',       icon: 'fa-credit-card',    color: '#ffd166' },
  { id: 'upi',    name: 'UPI',        icon: 'fa-mobile-screen',  color: '#f472b6' },
  { id: 'savings',name: 'Savings',    icon: 'fa-piggy-bank',     color: '#34d399' },
];
// Populate _wallets now that DEFAULT_WALLETS is defined
_wallets = [...DEFAULT_WALLETS];

function renderWallets() {
  const el = document.getElementById('wallet-bar');
  if (!el) return;
  
  const walletTotals = {};
  _wallets.forEach(w => {
    const inc = DB.transactions.filter(t => t.wallet === w.id && t.type === 'income').reduce((s,t) => s+t.amount, 0);
    const exp = DB.transactions.filter(t => t.wallet === w.id && t.type === 'expense').reduce((s,t) => s+t.amount, 0);
    walletTotals[w.id] = inc - exp;
  });
  
  const allBalance = DB.transactions.reduce((s,t) => s + (t.type==='income' ? t.amount : -t.amount), 0);
  
  el.innerHTML = `
    <div class="wallet-card ${_activeWallet === null ? 'active' : ''}" onclick="setActiveWallet(null)">
      <div class="wallet-icon" style="background:linear-gradient(135deg,var(--accent),var(--accent2))">
        <i class="fas fa-layer-group"></i>
      </div>
      <div class="wallet-info">
        <div class="wallet-name">All Wallets</div>
        <div class="wallet-bal" style="color:${allBalance>=0?'var(--income)':'var(--expense)'}">${allBalance>=0?'+':''}${fmt(allBalance)}</div>
      </div>
    </div>
    ${_wallets.map(w => `
    <div class="wallet-card ${_activeWallet===w.id?'active':''}" onclick="setActiveWallet('${w.id}')">
      <div class="wallet-icon" style="background:${w.color}22;color:${w.color}">
        <i class="fas ${w.icon}"></i>
      </div>
      <div class="wallet-info">
        <div class="wallet-name">${escHtml(w.name)}</div>
        <div class="wallet-bal" style="color:${walletTotals[w.id]>=0?'var(--income)':'var(--expense)'}">${walletTotals[w.id]>=0?'+':''}${fmt(walletTotals[w.id]||0)}</div>
      </div>
    </div>`).join('')}
    <div class="wallet-card wallet-add" onclick="addWalletPrompt()">
      <div class="wallet-icon" style="background:var(--card2);color:var(--muted)">
        <i class="fas fa-plus"></i>
      </div>
      <div class="wallet-info">
        <div class="wallet-name" style="color:var(--muted)">Add Wallet</div>
      </div>
    </div>`;
}

window.setActiveWallet = function(walletId) {
  _activeWallet = walletId;
  renderWallets();
  renderDashboard();
  renderTransactions();
  
  const label = walletId ? _wallets.find(w=>w.id===walletId)?.name : 'All Wallets';
  toast(`Viewing: ${label}`, 'info', 1500);
};

window.addWalletPrompt = function() {
  const name = prompt('Wallet name (e.g. "HDFC Bank", "Paytm"):');
  if (!name?.trim()) return;
  const id = name.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if (_wallets.find(w => w.id === id)) { toast('Wallet already exists', 'error'); return; }
  _wallets.push({ id, name: name.trim(), icon: 'fa-wallet', color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0') });
  renderWallets();
  toast(`"${name.trim()}" wallet added ✓`, 'success');
};

// Update modal to include wallet selector
function injectWalletSelect() {
  const paymentGroup = document.querySelector('#m-payment')?.closest('.form-group');
  if (!paymentGroup || document.getElementById('m-wallet')) return;
  
  const walletGroup = document.createElement('div');
  walletGroup.className = 'form-group';
  walletGroup.style.marginBottom = '0';
  walletGroup.innerHTML = `
    <div class="form-label">Wallet</div>
    <select class="form-control" id="m-wallet">
      <option value="">All / No wallet</option>
      ${_wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}
    </select>`;
  paymentGroup.parentNode.insertBefore(walletGroup, paymentGroup);
}

/* ════════════════════════════════════════════════════════════
   FEATURE 5: KEYBOARD SHORTCUTS PANEL
   ════════════════════════════════════════════════════════════ */
window.toggleShortcuts = function() {
  // Shortcuts are desktop-only — ignore on mobile
  if (window.innerWidth <= 768) return;
  const panel   = document.getElementById('shortcuts-panel');
  const overlay = document.getElementById('shortcuts-overlay');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  } else {
    panel.classList.add('open');
    if (overlay) overlay.classList.add('open');
  }
};

/* ════════════════════════════════════════════════════════════
   FEATURE 6: SWIPE TO DELETE (Mobile)
   ════════════════════════════════════════════════════════════ */
function initSwipeToDelete() {
  // Delegated touch handler on the transactions table
  const body = document.getElementById('tx-body');
  if (!body) return;
  
  let startX = 0, startY = 0, activeRow = null;
  
  body.addEventListener('touchstart', e => {
    const row = e.target.closest('tr');
    if (!row) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    activeRow = row;
  }, { passive: true });
  
  body.addEventListener('touchmove', e => {
    if (!activeRow) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx)) { activeRow = null; return; } // vertical scroll
    if (dx < -30) {
      activeRow.style.transform = `translateX(${Math.max(dx, -80)}px)`;
      activeRow.style.background = 'rgba(255,107,107,.1)';
    }
  }, { passive: true });
  
  body.addEventListener('touchend', e => {
    if (!activeRow) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (dx < -70) {
      // Trigger delete
      const deleteBtn = activeRow.querySelector('.btn-danger');
      activeRow.style.transition = 'transform .3s, opacity .3s';
      activeRow.style.transform = 'translateX(-100%)';
      activeRow.style.opacity = '0';
      setTimeout(() => deleteBtn?.click(), 300);
    } else {
      activeRow.style.transition = 'transform .3s, background .3s';
      activeRow.style.transform = '';
      activeRow.style.background = '';
      setTimeout(() => { if(activeRow) { activeRow.style.transition = ''; } }, 300);
    }
    activeRow = null;
  }, { passive: true });
}

/* ════════════════════════════════════════════════════════════
   FEATURE 7: BOTTOM NAV (Mobile)
   ════════════════════════════════════════════════════════════ */
function initBottomNav() {
  const nav2 = document.getElementById('bottom-nav');
  if (!nav2) return;
  // Sync bottom nav with sidebar nav
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function syncBottomNav(pageId) {
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageId);
  });
}

/* ════════════════════════════════════════════════════════════
   FEATURE 8: AI SPENDING INSIGHTS
   ════════════════════════════════════════════════════════════ */
function generateAIInsights() {
  const el = document.getElementById('ai-insights-list');
  if (!el || !DB.transactions.length) return;
  
  const now = new Date();
  const curM = now.getMonth(), curY = now.getFullYear();
  const prevM = curM === 0 ? 11 : curM - 1;
  const prevY = curM === 0 ? curY - 1 : curY;
  
  const thisMonth = DB.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === curM && d.getFullYear() === curY;
  });
  const lastMonth = DB.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === prevM && d.getFullYear() === prevY;
  });
  
  const thisExp  = thisMonth.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const lastExp  = lastMonth.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const thisInc  = thisMonth.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  
  const catTotals = {};
  thisMonth.filter(t=>t.type==='expense').forEach(t => catTotals[t.category] = (catTotals[t.category]||0)+t.amount);
  const topCat = Object.entries(catTotals).sort((a,b)=>b[1]-a[1])[0];
  
  const lastCatTotals = {};
  lastMonth.filter(t=>t.type==='expense').forEach(t => lastCatTotals[t.category] = (lastCatTotals[t.category]||0)+t.amount);
  
  const insights = [];
  
  // 1. Month over month spending change
  if (lastExp > 0) {
    const change = ((thisExp - lastExp) / lastExp * 100).toFixed(0);
    if (change > 10) {
      insights.push({ icon: '📈', color: 'var(--expense)', title: `Spending up ${change}% vs last month`, body: `You've spent ${fmt(thisExp - lastExp)} more than last month. Consider reviewing your ${topCat?.[0] || 'expenses'}.` });
    } else if (change < -10) {
      insights.push({ icon: '🎉', color: 'var(--income)', title: `Great! Spending down ${Math.abs(change)}%`, body: `You saved ${fmt(lastExp - thisExp)} compared to last month. Keep it up!` });
    }
  }
  
  // 2. Top category spike
  if (topCat && lastCatTotals[topCat[0]]) {
    const catChange = ((topCat[1] - lastCatTotals[topCat[0]]) / lastCatTotals[topCat[0]] * 100).toFixed(0);
    if (catChange > 20) {
      insights.push({ icon: '⚡', color: 'var(--gold)', title: `${topCat[0]} spending spiked ${catChange}%`, body: `${topCat[0]} is your top expense at ${fmt(topCat[1])} — ${catChange}% higher than last month.` });
    }
  }
  
  // 3. Savings rate insight
  if (thisInc > 0) {
    const rate = Math.round(((thisInc - thisExp) / thisInc) * 100);
    if (rate < 0) {
      insights.push({ icon: '🚨', color: 'var(--expense)', title: 'Spending exceeds income!', body: `You're spending ${fmt(thisExp - thisInc)} more than you earn this month. Review your expenses.` });
    } else if (rate > 30) {
      insights.push({ icon: '💪', color: 'var(--income)', title: `Excellent! ${rate}% savings rate`, body: `You're saving ${rate}% of your income. Consider investing the surplus!` });
    } else if (rate < 10) {
      insights.push({ icon: '💡', color: 'var(--gold)', title: `Low savings rate: ${rate}%`, body: `Aim for 20%+ savings. Try reducing ${topCat?.[0] || 'non-essential'} spending.` });
    }
  }
  
  // 4. Budget alerts
  const overBudget = Object.entries(DB.budgets).filter(([cat, {limit}]) => {
    const spent = thisMonth.filter(t=>t.type==='expense'&&t.category===cat).reduce((s,t)=>s+t.amount,0);
    return spent > limit;
  });
  if (overBudget.length) {
    insights.push({ icon: '🔴', color: 'var(--expense)', title: `${overBudget.length} budget${overBudget.length>1?'s':''} exceeded`, body: `Over budget in: ${overBudget.map(([c])=>c).join(', ')}. Adjust your spending or limits.` });
  }
  
  // 5. Positive: no expenses yet today
  const todayTxs = DB.transactions.filter(t => t.date === todayStr() && t.type === 'expense');
  if (!todayTxs.length && DB.transactions.length > 5) {
    insights.push({ icon: '✨', color: 'var(--accent)', title: 'No expenses logged today!', body: `Great start to the day. Stay mindful of your spending.` });
  }
  
  if (!insights.length) {
    insights.push({ icon: '📊', color: 'var(--accent)', title: 'Your finances look healthy!', body: `Keep tracking to get personalised insights. Add more transactions for deeper analysis.` });
  }
  
  el.innerHTML = insights.slice(0, 4).map(ins => `
    <div class="ai-insight-card">
      <div class="ai-insight-emoji">${ins.icon}</div>
      <div class="ai-insight-body">
        <div class="ai-insight-title" style="color:${ins.color}">${ins.title}</div>
        <div class="ai-insight-text">${ins.body}</div>
      </div>
    </div>`).join('');
}


/* ════════════════════════════════════════════════════════════
   FEATURE: CONFETTI ON GOAL COMPLETION
   ════════════════════════════════════════════════════════════ */
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.style.display = 'block';
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#00d4aa','#7c6aff','#ffd166','#ff6b6b','#34d399','#f472b6'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -20,
    r: Math.random() * 8 + 4,
    d: Math.random() * 80 + 20,
    color: colors[Math.floor(Math.random() * colors.length)],
    tilt: Math.random() * 10 - 5,
    tiltAngle: 0,
    tiltSpeed: Math.random() * 0.1 + 0.05,
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.tiltAngle += p.tiltSpeed;
      p.y += (Math.cos(frame / 20 + p.d) + 1 + p.r / 2) * 1.8;
      p.x += Math.sin(frame / 20);
      p.tilt = Math.sin(p.tiltAngle) * 12;
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
      ctx.stroke();
    });
    frame++;
    if (frame < 200) requestAnimationFrame(draw);
    else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }
  draw();
}

// Hook into updateGoalSaved to fire confetti on completion
// (merged directly — no re-wrapping needed)

/* ════════════════════════════════════════════════════════════
   FEATURE: UNDO AFTER DELETE
   showUndoToast and undoDelete support the deleteTransaction above
   ════════════════════════════════════════════════════════════ */

function showUndoToast(tx) {
  // Remove existing undo toast
  document.getElementById('undo-toast')?.remove();

  const el = document.createElement('div');
  el.id = 'undo-toast';
  el.className = 'undo-toast';
  el.innerHTML = `
    <span>Transaction deleted</span>
    <button onclick="undoDelete('${tx.id}')">UNDO</button>
  `;
  document.getElementById('toast-container').appendChild(el);

  _undoTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
    _deletedTx = null;
  }, 5000);
}

window.undoDelete = async function (id) {
  if (!_deletedTx || !_currentUser) return;
  clearTimeout(_undoTimer);
  document.getElementById('undo-toast')?.remove();
  try {
    const { id: txId, createdAt, updatedAt, ...rest } = _deletedTx;
    await addTransaction(_currentUser.uid, rest);
    toast('Transaction restored ✓', 'success');
    _deletedTx = null;
  } catch (e) {
    toast('Could not restore: ' + e.message, 'error');
  }
};

/* ════════════════════════════════════════════════════════════
   FEATURE: HAPTIC FEEDBACK (Mobile vibration)
   ════════════════════════════════════════════════════════════ */
function haptic(type = 'light') {
  if (!navigator.vibrate) return;
  const patterns = { light: 10, medium: 20, heavy: [30, 10, 30], success: [10, 10, 10] };
  navigator.vibrate(patterns[type] || 10);
}

// Add haptic to key actions — integrated into the undo-wrapped version above
// Note: haptic is called from within the undo-aware deleteTransaction confirm callback

/* ════════════════════════════════════════════════════════════
   FEATURE: PULL TO REFRESH (Mobile)
   ════════════════════════════════════════════════════════════ */
(function initPullToRefresh() {
  let startY = 0, pulling = false;
  const indicator = document.getElementById('pull-refresh-indicator');

  document.addEventListener('touchstart', e => {
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 60 && indicator) {
      indicator.classList.add('show');
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!pulling) return;
    pulling = false;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > 80) {
      haptic('medium');
      if (indicator) {
        indicator.classList.add('spinning');
        setTimeout(() => {
          indicator.classList.remove('show', 'spinning');
        }, 1000);
      }
      // Refresh current page data
      const activePage = document.querySelector('.page.active');
      if (activePage?.id === 'page-dashboard') renderDashboard();
      else if (activePage?.id === 'page-transactions') renderTransactions();
      else if (activePage?.id === 'page-analytics') renderAnalytics();
      toast('Refreshed ✓', 'success', 1200);
    } else {
      if (indicator) indicator.classList.remove('show', 'spinning');
    }
  }, { passive: true });
})();

/* ════════════════════════════════════════════════════════════
   FEATURE: MONTH NAVIGATOR on Dashboard
   ════════════════════════════════════════════════════════════ */
/* ── Month navigator state is declared at top of file ── */

window.navMonth = function (dir) {
  _viewMonth += dir;
  if (_viewMonth > 11) { _viewMonth = 0;  _viewYear++; }
  if (_viewMonth < 0)  { _viewMonth = 11; _viewYear--; }
  updateMonthNav();
  renderDashboardForMonth();
};

window.resetMonthNav = function () {
  _viewMonth = new Date().getMonth();
  _viewYear  = new Date().getFullYear();
  updateMonthNav();
  renderDashboardForMonth();
};

function updateMonthNav() {
  const label = document.getElementById('month-nav-label');
  const resetBtn = document.getElementById('month-nav-reset');
  if (!label) return;
  const now = new Date();
  const isCurrentMonth = _viewMonth === now.getMonth() && _viewYear === now.getFullYear();
  label.textContent = new Date(_viewYear, _viewMonth, 1)
    .toLocaleDateString('en', { month: 'long', year: 'numeric' });
  if (resetBtn) resetBtn.style.display = isCurrentMonth ? 'none' : 'inline-flex';
}

function renderDashboardForMonth() {
  // Filter transactions to selected month
  const monthTxs = DB.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === _viewMonth && d.getFullYear() === _viewYear;
  });

  const income  = monthTxs.filter(t => t.type === 'income').reduce((s,t)=>s+t.amount, 0);
  const expense = monthTxs.filter(t => t.type === 'expense').reduce((s,t)=>s+t.amount, 0);
  const balance = income - expense;
  const effIncome = income || DB.settings.monthlyIncome;
  const savingsRate = effIncome > 0 ? Math.max(0, Math.round(((effIncome - expense) / effIncome) * 100)) : 0;

  const set = (id, val, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (color) el.style.color = color;
  };

  set('s-income',  fmt(income),  'var(--income)');
  set('s-income-sub', `${monthTxs.filter(t=>t.type==='income').length} transactions`);
  set('s-spent',   fmt(expense), 'var(--expense)');
  set('s-spent-sub', `${monthTxs.filter(t=>t.type==='expense').length} transactions`);
  set('s-balance', fmt(balance), balance >= 0 ? 'var(--income)' : 'var(--expense)');
  set('s-rate',    savingsRate + '%');

  // Re-render pie chart for selected month
  renderPieChart(monthTxs.filter(t => t.type === 'expense'));
}

// month nav update is handled in renderDashboard override above

/* ════════════════════════════════════════════════════════════
   FEATURE: SKELETON LOADING SCREENS
   ════════════════════════════════════════════════════════════ */
function showSkeletons() {
  ['s-income','s-spent','s-balance','s-rate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = '<div class="skeleton skeleton-text"></div>'; el.style.color = ''; }
  });
  const recentList = document.getElementById('recent-list');
  if (recentList) {
    recentList.innerHTML = Array(5).fill(`
      <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div class="skeleton" style="width:34px;height:34px;border-radius:9px;flex-shrink:0"></div>
        <div style="flex:1">
          <div class="skeleton skeleton-text" style="width:60%;margin-bottom:6px"></div>
          <div class="skeleton skeleton-text" style="width:35%"></div>
        </div>
        <div class="skeleton skeleton-text" style="width:60px"></div>
      </div>`).join('');
  }
}

// Show skeletons while Firebase loads — called from onLogin before data arrives

/* ════════════════════════════════════════════════════════════
   FEATURE: ONBOARDING FOR NEW USERS
   ════════════════════════════════════════════════════════════ */
function checkShowOnboarding(user) {
  // Show onboarding if user has 0 transactions
  if (DB.transactions.length > 0) return;
  const onboarded = localStorage.getItem('nestfy-onboarded-' + user.uid);
  if (onboarded) return;

  // Show a welcome card on dashboard
  const wrap = document.getElementById('streak-banner-wrap');
  if (!wrap) return;

  wrap.innerHTML = `
    <div class="onboarding-banner">
      <div class="onboarding-emoji">👋</div>
      <div class="onboarding-body">
        <h4>Welcome to Nestfy!</h4>
        <p>Add your first transaction to get started tracking your finances.</p>
        <div class="onboarding-banner-steps">
          <div class="onboarding-step">
            <span class="step-num">1</span>
            <span>Tap <strong>Add</strong> to log a transaction</span>
          </div>
          <div class="onboarding-step">
            <span class="step-num">2</span>
            <span>Set up <strong>Budgets</strong> for categories</span>
          </div>
          <div class="onboarding-step">
            <span class="step-num">3</span>
            <span>Create <strong>Savings Goals</strong></span>
          </div>
        </div>
      </div>
      <button class="onboarding-close" onclick="dismissOnboarding('${user.uid}')">
        <i class="fas fa-times"></i>
      </button>
    </div>`;
}

window.dismissOnboarding = function (uid) {
  localStorage.setItem('nestfy-onboarded-' + uid, '1');
  const wrap = document.getElementById('streak-banner-wrap');
  if (wrap) wrap.innerHTML = '';
};

// Hook into onLogin to show onboarding
const __hookOnboarding = true; // marker so we don't double-hook

/* ── Missing window exports (called from HTML onchange/onclick) ── */
window.renderDashboard    = renderDashboard;
window.renderTransactions = renderTransactions;
window.clearFilters       = clearFilters;



/* ============================================================
   NESTFY ADVANCED FEATURES
   ============================================================ */

/* ════════════════════════════════════════════════════════════
   1. COMMAND PALETTE (Ctrl+K)
   ════════════════════════════════════════════════════════════ */
// cmdSelectedIndex and cmdItems declared at top of file

const CMD_PAGES = [
  { icon: 'fa-home',       color: '#00d4aa', title: 'Dashboard',        sub: 'Overview & charts',        action: () => nav(document.querySelector('[data-page="dashboard"]'),     'dashboard') },
  { icon: 'fa-list-ul',    color: '#7c6aff', title: 'Transactions',      sub: 'All income & expenses',    action: () => nav(document.querySelector('[data-page="transactions"]'), 'transactions') },
  { icon: 'fa-wallet',     color: '#ffd166', title: 'Budgets',           sub: 'Monthly spending limits',  action: () => nav(document.querySelector('[data-page="budgets"]'),      'budgets') },
  { icon: 'fa-bullseye',   color: '#f472b6', title: 'Savings Goals',     sub: 'Financial targets',        action: () => nav(document.querySelector('[data-page="goals"]'),        'goals') },
  { icon: 'fa-rotate',     color: '#34d399', title: 'Recurring',         sub: 'Subscriptions & salary',   action: () => nav(document.querySelector('[data-page="recurring"]'),    'recurring') },
  { icon: 'fa-chart-line', color: '#a78bfa', title: 'Analytics',         sub: '12-month trends & stats',  action: () => navProtected(document.querySelector('[data-page="analytics"]'),  'analytics') },
  { icon: 'fa-gear',       color: '#94a3b8', title: 'Settings',          sub: 'Preferences & data',       action: () => navProtected(document.querySelector('[data-page="settings"]'),   'settings') },
];

const CMD_ACTIONS = [
  { icon: 'fa-plus',         color: '#00d4aa', title: 'Add Transaction',   sub: 'Log income or expense',     action: () => openModal() },
  { icon: 'fa-moon',         color: '#7c6aff', title: 'Toggle Theme',      sub: 'Switch dark/light mode',    action: () => toggleTheme() },
  { icon: 'fa-download',     color: '#ffd166', title: 'Export CSV',        sub: 'Download transactions',     action: () => exportCSV() },
  { icon: 'fa-file-export',  color: '#34d399', title: 'Export Backup',     sub: 'Download JSON backup',      action: () => exportJSON() },
  { icon: 'fa-right-from-bracket', color: '#ff6b6b', title: 'Sign Out',   sub: 'Log out of Nestfy',         action: () => handleLogout() },
];

window.openCmd = function () {
  const overlay = document.getElementById('cmd-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden'; document.body.classList.add('modal-open');
  setTimeout(() => {
    const inp = document.getElementById('cmd-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }, 50);
  cmdSearch('');
};

window.closeCmd = function () {
  const overlay = document.getElementById('cmd-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = ''; document.body.classList.remove('modal-open');
  cmdSelectedIndex = -1;
};

window.cmdSearch = function (query) {
  const q = query.toLowerCase().trim();
  const results = document.getElementById('cmd-results');
  if (!results) return;

  // Highlight matching text
  function hl(text, query) {
    if (!query || !text) return escHtml(text || '');
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escHtml(text);
    return escHtml(text.slice(0, idx)) +
      '<mark style="background:rgba(0,212,170,.25);color:var(--accent);border-radius:3px;padding:0 2px">' +
      escHtml(text.slice(idx, idx + query.length)) + '</mark>' +
      escHtml(text.slice(idx + query.length));
  }

  // Filter pages and actions
  const pages   = CMD_PAGES.filter(p => !q || p.title.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q));
  const actions = CMD_ACTIONS.filter(a => !q || a.title.toLowerCase().includes(q) || a.sub.toLowerCase().includes(q));

  // Filter transactions
  const txs = q.length > 1
    ? DB.transactions
        .filter(t => (t.description || '').toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q))
        .slice(0, 4)
    : [];

  cmdItems = [];
  let html = '';

  if (pages.length) {
    html += `<div class="cmd-section-label">Pages</div>`;
    pages.forEach(p => {
      const idx = cmdItems.length;
      cmdItems.push(p);
      html += `<div class="cmd-item" data-idx="${idx}" onclick="cmdSelect(${idx})">
        <div class="cmd-item-icon" style="background:${p.color}18;color:${p.color}"><i class="fas ${p.icon}"></i></div>
        <div class="cmd-item-text"><div class="cmd-item-title">${p.title}</div><div class="cmd-item-sub">${p.sub}</div></div>
        <span class="cmd-item-badge">Page</span>
      </div>`;
    });
  }

  if (actions.length) {
    html += `<div class="cmd-section-label">Actions</div>`;
    actions.forEach(a => {
      const idx = cmdItems.length;
      cmdItems.push(a);
      html += `<div class="cmd-item" data-idx="${idx}" onclick="cmdSelect(${idx})">
        <div class="cmd-item-icon" style="background:${a.color}18;color:${a.color}"><i class="fas ${a.icon}"></i></div>
        <div class="cmd-item-text"><div class="cmd-item-title">${a.title}</div><div class="cmd-item-sub">${a.sub}</div></div>
        <span class="cmd-item-badge">Action</span>
      </div>`;
    });
  }

  if (txs.length) {
    html += `<div class="cmd-section-label">Transactions</div>`;
    txs.forEach(t => {
      const idx = cmdItems.length;
      cmdItems.push({ action: () => { openModal(t.id); closeCmd(); } });
      html += `<div class="cmd-item" data-idx="${idx}" onclick="cmdSelect(${idx})">
        <div class="cmd-item-icon" style="background:${CAT_COLORS[t.category] || '#64748b'}18;color:${CAT_COLORS[t.category] || '#94a3b8'}"><i class="fas ${CAT_ICONS[t.category] || 'fa-tag'}"></i></div>
        <div class="cmd-item-text"><div class="cmd-item-title">${hl(t.description || t.category, q)}</div><div class="cmd-item-sub">${fmtDate(t.date)} · ${fmt(t.amount)}</div></div>
        <span class="cmd-item-badge" style="color:${t.type==='income'?'var(--income)':'var(--expense)'}">${t.type}</span>
      </div>`;
    });
  }

  if (!html) {
    html = `<div class="cmd-empty"><i class="fas fa-search" style="font-size:1.5rem;margin-bottom:8px;display:block;color:var(--muted)"></i>No results for "${escHtml(query)}"</div>`;
  }

  results.innerHTML = html;
  cmdSelectedIndex = -1;
};

window.cmdSelect = function (idx) {
  const item = cmdItems[idx];
  if (!item) return;
  closeCmd();
  setTimeout(() => item.action(), 50);
};

window.cmdKeydown = function (e) {
  const items = document.querySelectorAll('.cmd-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdSelectedIndex = Math.min(cmdSelectedIndex + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdSelectedIndex = Math.max(cmdSelectedIndex - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (cmdSelectedIndex >= 0) cmdSelect(cmdSelectedIndex);
    else if (cmdItems.length > 0) cmdSelect(0);
    return;
  } else if (e.key === 'Escape') {
    closeCmd(); return;
  } else return;

  items.forEach((el, i) => el.classList.toggle('selected', i === cmdSelectedIndex));
  items[cmdSelectedIndex]?.scrollIntoView({ block: 'nearest' });
};

// Global keyboard shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const overlay = document.getElementById('cmd-overlay');
    overlay?.classList.contains('open') ? closeCmd() : openCmd();
  }
});

/* ════════════════════════════════════════════════════════════
   2. ONBOARDING FLOW
   ════════════════════════════════════════════════════════════ */
const ONBOARDING_STEPS = [
  {
    icon: '👋',
    title: 'Welcome to Nestfy!',
    desc: 'Your smart personal finance tracker. Let\'s take a quick tour to help you get started in under 2 minutes.',
  },
  {
    icon: '💸',
    title: 'Track Every Transaction',
    desc: 'Log your income and expenses with categories, tags, and payment methods. Click "Add Transaction" or press Ctrl+N anytime.',
  },
  {
    icon: '🎯',
    title: 'Set Budgets & Goals',
    desc: 'Create monthly spending budgets per category and set savings goals. Nestfy alerts you when you\'re approaching your limits.',
  },
  {
    icon: '📊',
    title: 'Powerful Analytics',
    desc: 'Get deep insights with 12-month trends, daily spending charts, and AI-powered spending analysis tailored to your habits.',
  },
  {
    icon: '⌨️',
    title: 'Pro Tips',
    desc: 'Press Ctrl+K to open the command palette, Ctrl+N to add a transaction, and use the theme toggle in the sidebar for dark/light mode.',
  },
];

// onboardingStep declared at top of file

function showOnboarding() {
  if (localStorage.getItem('nestfy-onboarded')) return;
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  onboardingStep = 0;

  // Rebuild the card HTML fresh every time so content is guaranteed
  overlay.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-steps" id="onboarding-dots"></div>
      <div class="onboarding-icon"  id="onboarding-icon"></div>
      <div class="onboarding-title" id="onboarding-title"></div>
      <div class="onboarding-desc"  id="onboarding-desc"></div>
      <div class="onboarding-nav">
        <button class="btn-onboard-skip" onclick="skipOnboarding()">Skip</button>
        <button class="btn-onboard-next" id="onboarding-next-btn" onclick="nextOnboarding()">
          Next <i class="fas fa-arrow-right"></i>
        </button>
      </div>
    </div>`;

  overlay.classList.add('open');
  renderOnboardingStep();
}

function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboardingStep];
  if (!step) return;

  const icon  = document.getElementById('onboarding-icon');
  const title = document.getElementById('onboarding-title');
  const desc  = document.getElementById('onboarding-desc');
  const dots  = document.getElementById('onboarding-dots');
  const btn   = document.getElementById('onboarding-next-btn');

  if (icon)  icon.textContent  = step.icon;
  if (title) title.textContent = step.title;
  if (desc)  desc.textContent  = step.desc;

  if (dots) {
    dots.innerHTML = ONBOARDING_STEPS.map((_, i) => `<div class="onboarding-step-dot ${
      i < onboardingStep ? 'done' : i === onboardingStep ? 'active' : ''
    }"></div>`).join('');
  }

  const isLast = onboardingStep === ONBOARDING_STEPS.length - 1;
  if (btn) btn.innerHTML = isLast
    ? 'Start Tracking <i class="fas fa-check"></i>'
    : 'Next <i class="fas fa-arrow-right"></i>';
}

window.nextOnboarding = function () {
  if (onboardingStep < ONBOARDING_STEPS.length - 1) {
    onboardingStep++;
    renderOnboardingStep();
  } else {
    skipOnboarding();
  }
};

window.skipOnboarding = function () {
  localStorage.setItem('nestfy-onboarded', '1');
  const ov = document.getElementById('onboarding-overlay');
  if (ov) { ov.classList.remove('open'); }
};

/* ════════════════════════════════════════════════════════════
   3. NOTIFICATION CENTER
   ════════════════════════════════════════════════════════════ */
// notifications array declared at top of file

function addNotification(type, title, msg, icon, color) {
  const n = {
    id: Date.now() + Math.random(),
    type, title, msg, icon, color,
    time: new Date(),
    read: false,
  };
  notifications.unshift(n);
  if (notifications.length > 20) notifications.pop();
  renderNotifications();
  updateNotifDot();
}

function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `<div class="notif-empty"><i class="fas fa-bell-slash" style="font-size:1.5rem;margin-bottom:8px;display:block"></i>No notifications yet</div>`;
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead('${n.id}')">
      <div class="notif-icon" style="background:${n.color}18;color:${n.color}">
        <i class="fas ${n.icon}"></i>
      </div>
      <div class="notif-content">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-msg">${escHtml(n.msg)}</div>
        <div class="notif-time">${timeAgo(n.time)}</div>
      </div>
    </div>
  `).join('');
}

function updateNotifDot() {
  const dot = document.getElementById('notif-dot');
  const unread = notifications.filter(n => !n.read).length;
  if (dot) dot.classList.toggle('show', unread > 0);
}

window.toggleNotifPanel = function () {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
    // Never lock scroll for notification panel — it's a floating panel
    return;
  }
  panel.classList.add('open');
  renderNotifications();

  // Single auto-close listener — removed after first outside click
  function closeNotifPanel(e) {
    const notifBtn = document.getElementById('notif-btn');
    if (!panel.contains(e.target) && e.target !== notifBtn && !notifBtn?.contains(e.target)) {
      panel.classList.remove('open');
      document.removeEventListener('click', closeNotifPanel, true);
    }
  }
  // Use capture phase so it fires before any child handlers
  // Small delay to prevent immediate closure from the same click that opened it
  setTimeout(() => {
    document.addEventListener('click', closeNotifPanel, true);
  }, 150);
};

window.markNotifRead = function (id) {
  const n = notifications.find(n => String(n.id) === String(id));
  if (n) { n.read = true; renderNotifications(); updateNotifDot(); }
};

window.clearNotifications = function () {
  notifications = [];
  renderNotifications();
  updateNotifDot();
  const panel = document.getElementById('notif-panel');
  if (panel) { panel.classList.remove('open'); }
  // Never set overflow:hidden for notif panel
  document.getElementById('notif-panel')?.classList.remove('open');
};

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60)   return 'Just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400)return `${Math.floor(s/3600)}h ago`;
  return fmtDate(new Date(date).toISOString().slice(0,10));
}

/* ════════════════════════════════════════════════════════════
   4. FINANCIAL HEALTH SCORE
   ════════════════════════════════════════════════════════════ */
function renderHealthScore() {
  const wrap = document.getElementById('health-score-wrap');
  if (!wrap || !DB.transactions.length) { if (wrap) wrap.innerHTML = ''; return; }

  const now = new Date(), m = now.getMonth(), y = now.getFullYear();
  const thisMonth = DB.transactions.filter(t => {
    const d = new Date(t.date); return d.getMonth() === m && d.getFullYear() === y;
  });
  const monthIncome  = thisMonth.filter(t => t.type === 'income').reduce((s,t) => s+t.amount, 0);
  const monthExpense = thisMonth.filter(t => t.type === 'expense').reduce((s,t) => s+t.amount, 0);
  const allIncome    = DB.transactions.filter(t => t.type==='income').reduce((s,t)=>s+t.amount,0);
  const allExpense   = DB.transactions.filter(t => t.type==='expense').reduce((s,t)=>s+t.amount,0);

  // Score calculation (0-100)
  let score = 50;
  const savingsRate = monthIncome > 0 ? (monthIncome - monthExpense) / monthIncome : 0;
  const budgetCount = Object.keys(DB.budgets).length;
  const goalCount   = DB.goals.length;
  const netPositive = allIncome > allExpense;

  if (savingsRate >= 0.2)  score += 20;
  else if (savingsRate >= 0) score += 10;
  else score -= 15;

  if (budgetCount >= 3)  score += 10;
  else if (budgetCount > 0) score += 5;

  if (goalCount >= 1) score += 10;
  if (netPositive)    score += 10;
  if (DB.transactions.length >= 10) score += 5;

  score = Math.max(10, Math.min(100, Math.round(score)));

  const levels = [
    { min:80, label:'Excellent 🌟', color:'#00d4aa', desc: 'Your finances are in great shape! Keep up the savings habit.' },
    { min:60, label:'Good 👍',       color:'#7c6aff', desc: 'Solid financial health. Consider setting more savings goals.' },
    { min:40, label:'Fair ⚠️',       color:'#ffd166', desc: 'Some areas need attention. Review your budgets and spending.' },
    { min:0,  label:'Needs Work 🔧', color:'#ff6b6b', desc: 'Focus on reducing expenses and building an emergency fund.' },
  ];
  const level = levels.find(l => score >= l.min) || levels[levels.length-1];

  const circumference = 2 * Math.PI * 34; // r=34
  const offset = circumference - (score / 100) * circumference;

  wrap.innerHTML = `
    <div class="health-score-card">
      <div class="health-score-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle class="track" cx="40" cy="40" r="34" stroke-dasharray="${circumference}"/>
          <circle class="fill"  cx="40" cy="40" r="34"
            stroke="${level.color}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"/>
        </svg>
        <div class="health-score-num" style="color:${level.color}">${score}</div>
      </div>
      <div class="health-score-info">
        <span class="health-score-label" style="background:${level.color}18;color:${level.color}">${level.label}</span>
        <div class="health-score-title">Financial Health Score</div>
        <div class="health-score-desc">${level.desc}</div>
      </div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   5. AI SPENDING INSIGHTS (uses Claude API)
   ════════════════════════════════════════════════════════════ */
window.loadAIInsights = async function () {
  const card = document.getElementById('ai-insights-card');
  const list = document.getElementById('ai-insights-list');
  if (!card || !list) return;

  card.style.display = 'block';
  list.innerHTML = `<div class="ai-loading"><div class="ai-dots"><span></span><span></span><span></span></div>Analyzing your finances...</div>`;

  // Build data summary
  const now = new Date(), m = now.getMonth(), y = now.getFullYear();
  const thisMonth    = DB.transactions.filter(t => {
    const d = new Date(t.date); return d.getMonth() === m && d.getFullYear() === y;
  });
  const monthIncome  = thisMonth.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount, 0);
  const monthExpense = thisMonth.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount, 0);
  const catTotals    = {};
  thisMonth.filter(t=>t.type==='expense').forEach(t => catTotals[t.category] = (catTotals[t.category]||0) + t.amount);
  const topCats      = Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const currency     = DB.settings.currency || 'INR';
  const budgetCount  = Object.keys(DB.budgets).length;
  const goalCount    = DB.goals.length;
  const savingsRate  = monthIncome > 0 ? Math.round(((monthIncome-monthExpense)/monthIncome)*100) : 0;

  // Short delay for UX feel
  await new Promise(r => setTimeout(r, 600));

  const insights = generateRuleBasedInsights(monthIncome, monthExpense, savingsRate, topCats, budgetCount, goalCount, currency);
  list.innerHTML = insights.map(i => `
    <div class="ai-insight-item">
      <i class="fas ${i.icon}"></i>
      <span>${escHtml(i.text)}</span>
    </div>
  `).join('');

  addNotification('ai', 'Insights Updated', 'Your financial analysis is ready', 'fa-sparkles', '#7c6aff');
};

function generateRuleBasedInsights(income, expense, savingsRate, topCats, budgets, goals, currency) {
  const insights = [];

  // 1. Savings rate insight
  if (savingsRate < 0) {
    insights.push({ icon: 'fa-triangle-exclamation', text: `You're spending ${fmt(expense - income, currency)} more than you earn this month. Cut your top expense category first.` });
  } else if (savingsRate < 10) {
    insights.push({ icon: 'fa-piggy-bank', text: `Savings rate is only ${savingsRate}%. Try the 50/30/20 rule — 50% needs, 30% wants, 20% savings.` });
  } else if (savingsRate < 20) {
    insights.push({ icon: 'fa-piggy-bank', text: `You're saving ${savingsRate}% of income. Aim for 20%+ — you're ${20 - savingsRate}% away from the recommended target.` });
  } else {
    insights.push({ icon: 'fa-star', text: `Excellent! You're saving ${savingsRate}% of your income — well above the recommended 20%. Keep it up!` });
  }

  // 2. Top category insight
  if (topCats.length > 0) {
    const [topCat, topAmt] = topCats[0];
    const pct = income > 0 ? Math.round(topAmt / income * 100) : 0;
    if (pct > 40) {
      insights.push({ icon: 'fa-fire', text: `${topCat} is consuming ${pct}% of your income (${fmt(topAmt, currency)}). This is high — consider setting a strict budget here.` });
    } else {
      insights.push({ icon: 'fa-chart-pie', text: `Your biggest spend is ${topCat} at ${fmt(topAmt, currency)} (${pct}% of income). ${budgets === 0 ? 'Set a budget to keep it in check.' : 'Compare it against your budget limit.'}` });
    }
  } else if (income > 0) {
    insights.push({ icon: 'fa-chart-pie', text: `You have income recorded but no expenses yet this month. Start logging your spending to see a full breakdown.` });
  }

  // 3. Budget insight
  const overBudget = Object.entries(DB.budgets).filter(([cat, cfg]) => {
    const limit = typeof cfg === 'object' ? cfg.limit : cfg;
    const spent = DB.transactions
      .filter(t => t.type === 'expense' && t.category === cat &&
        new Date(t.date).getMonth() === new Date().getMonth() &&
        new Date(t.date).getFullYear() === new Date().getFullYear())
      .reduce((s, t) => s + t.amount, 0);
    return spent > limit;
  });

  if (overBudget.length > 0) {
    insights.push({ icon: 'fa-wallet', text: `You've exceeded your budget in ${overBudget.length} categor${overBudget.length > 1 ? 'ies' : 'y'}: ${overBudget.map(([c]) => c).join(', ')}. Review and adjust.` });
  } else if (budgets === 0) {
    insights.push({ icon: 'fa-wallet', text: `No budgets set yet. Create category budgets to automatically track when you're overspending.` });
  } else {
    insights.push({ icon: 'fa-circle-check', text: `You're within all ${budgets} of your budget limits this month. Great financial discipline!` });
  }

  // 4. Goals / recurring insight
  const upcomingBills = DB.recurring.filter(r => {
    if (!r.date) return false;
    const due = new Date(r.date + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((due - today) / 86400000);
    return diff >= 0 && diff <= 7;
  });

  if (upcomingBills.length > 0) {
    const total = upcomingBills.reduce((s, r) => s + r.amount, 0);
    insights.push({ icon: 'fa-calendar-check', text: `${upcomingBills.length} recurring payment${upcomingBills.length > 1 ? 's' : ''} due in the next 7 days totalling ${fmt(total, currency)}. Make sure you have funds ready.` });
  } else if (goals === 0) {
    insights.push({ icon: 'fa-bullseye', text: `No savings goals set. Create a goal — even a small emergency fund of 3 months' expenses provides financial security.` });
  } else {
    const nearGoal = DB.goals.find(g => g.target > 0 && g.saved / g.target >= 0.8 && g.saved < g.target);
    if (nearGoal) {
      const remaining = nearGoal.target - nearGoal.saved;
      insights.push({ icon: 'fa-trophy', text: `You're 80%+ done with "${nearGoal.name}"! Just ${fmt(remaining, currency)} left to reach your goal. Push through!` });
    } else {
      insights.push({ icon: 'fa-bullseye', text: `You have ${goals} savings goal${goals > 1 ? 's' : ''} active. Keep adding to them — small consistent contributions beat large occasional ones.` });
    }
  }

  return insights;
}

/* ════════════════════════════════════════════════════════════
   6. BILL REMINDERS (from Recurring)
   ════════════════════════════════════════════════════════════ */
function renderBillReminders() {
  const wrap = document.getElementById('bill-reminders-wrap');
  if (!wrap) return;

  const today = new Date();
  const upcoming = DB.recurring
    .filter(r => r.date && r.type === 'expense')
    .map(r => {
      const due = new Date(r.date + 'T00:00:00');
      const daysLeft = Math.ceil((due - today) / 86400000);
      return { ...r, daysLeft, due };
    })
    .filter(r => r.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (!upcoming.length) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = `
    <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px">
      <i class="fas fa-bell" style="color:var(--gold);margin-right:6px"></i>
      Upcoming Bills (${upcoming.length})
    </div>
    ${upcoming.map(r => {
      const overdue = r.daysLeft < 0;
      const dueLabel = r.daysLeft === 0 ? 'Due today!' : overdue ? `${Math.abs(r.daysLeft)} days overdue` : `Due in ${r.daysLeft} day${r.daysLeft !== 1 ? 's' : ''}`;
      return `
        <div class="bill-reminder-card ${overdue ? 'overdue' : ''}" onclick="nav(document.querySelector('[data-page=recurring]'),'recurring')">
          <div class="bill-icon ${overdue ? 'overdue' : ''}">
            <i class="fas ${CAT_ICONS[r.category] || 'fa-rotate'}"></i>
          </div>
          <div class="bill-info">
            <div class="bill-name">${escHtml(r.name)}</div>
            <div class="bill-detail">${r.category} · ${dueLabel}</div>
          </div>
          <div class="bill-amount ${overdue ? 'overdue' : ''}">${fmt(r.amount)}</div>
        </div>`;
    }).join('')}`;

  // Add notifications for overdue bills
  upcoming.filter(r => r.daysLeft <= 1).forEach(r => {
    const msg = r.daysLeft < 0
      ? `${r.name} was due ${Math.abs(r.daysLeft)} days ago!`
      : r.daysLeft === 0
        ? `${r.name} is due today (${fmt(r.amount)})`
        : `${r.name} is due tomorrow (${fmt(r.amount)})`;
    addNotification('bill', 'Bill Reminder', msg, 'fa-bell', r.daysLeft < 0 ? '#ff6b6b' : '#ffd166');
  });
}

/* ════════════════════════════════════════════════════════════
   7. MOBILE BOTTOM NAVIGATION
   ════════════════════════════════════════════════════════════ */
window.navMobile = function (btn, pageId) {
  // Update bottom nav active state
  document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Navigate
  nav(document.querySelector(`[data-page="${pageId}"]`), pageId);
};

/* ════════════════════════════════════════════════════════════
   8. PAGE TRANSITION ANIMATIONS — merged into window.nav above
   ════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   9. STAT CARD TRENDS (vs last month)
   ════════════════════════════════════════════════════════════ */
function renderStatTrends() {
  const now = new Date();
  const thisM = now.getMonth(), thisY = now.getFullYear();
  const lastM = thisM === 0 ? 11 : thisM - 1;
  const lastY = thisM === 0 ? thisY - 1 : thisY;

  const getTotal = (month, year, type) =>
    DB.transactions
      .filter(t => { const d=new Date(t.date); return d.getMonth()===month && d.getFullYear()===year && t.type===type; })
      .reduce((s,t) => s+t.amount, 0);

  const thisIncome  = getTotal(thisM, thisY, 'income');
  const lastIncome  = getTotal(lastM, lastY, 'income');
  const thisExpense = getTotal(thisM, thisY, 'expense');
  const lastExpense = getTotal(lastM, lastY, 'expense');

  const addTrend = (cardId, current, previous, reverseGood = false) => {
    const card = document.querySelector(`.${cardId}`) || document.getElementById(cardId);
    const sub  = card?.querySelector('.stat-sub');
    if (!sub || !previous) return;

    const pct   = Math.round(((current - previous) / previous) * 100);
    const isUp  = pct > 0;
    const isGood = reverseGood ? !isUp : isUp;

    const trendEl = card?.querySelector('.stat-trend');
    if (trendEl) trendEl.remove();

    const div = document.createElement('div');
    div.className = `stat-trend ${isGood ? 'up' : pct < 0 ? 'down' : 'flat'}`;
    div.innerHTML = `<i class="fas fa-arrow-${isUp ? 'up' : pct < 0 ? 'down' : 'right'}-long"></i> ${Math.abs(pct)}% vs last month`;
    sub.after(div);
  };

  addTrend('sc-green', thisIncome,  lastIncome,  false);
  addTrend('sc-red',   thisExpense, lastExpense, true);
}

/* ════════════════════════════════════════════════════════════
   WIRE EVERYTHING INTO renderDashboard & renderAll
   ════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════
   TRACKING STREAK — Days in a row with at least one transaction
   ════════════════════════════════════════════════════════════ */
function renderStreak() {
  const wrap = document.getElementById('streak-banner-wrap');
  if (!wrap || !DB.transactions.length) { if (wrap) wrap.innerHTML = ''; return; }

  // Build set of days with transactions
  const txDays = new Set(DB.transactions.map(t => t.date));
  
  // Count streak from today backwards
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const dateStr = d.toISOString().slice(0, 10);
    if (txDays.has(dateStr)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else if (i === 0) {
      // No transaction today yet — check yesterday to keep streak alive
      d.setDate(d.getDate() - 1);
      const yesterday = d.toISOString().slice(0, 10);
      if (txDays.has(yesterday)) {
        streak++;
        d.setDate(d.getDate() - 1);
        continue;
      }
      break;
    } else {
      break;
    }
  }

  if (streak < 2) { wrap.innerHTML = ''; return; }

  const msg = streak >= 30 ? `🏆 ${streak} day streak — incredible!`
            : streak >= 14 ? `🔥 ${streak} day streak — on fire!`
            : streak >= 7  ? `⚡ ${streak} day streak — great habit!`
            : `🌱 ${streak} day streak — keep it up!`;

  const sub = streak >= 7 ? "You've been tracking every day this week!" : "Tracking daily builds better money habits.";

  wrap.innerHTML = `
    <div class="streak-banner">
      <div class="streak-fire">${streak >= 7 ? '🔥' : '🌱'}</div>
      <div class="streak-info">
        <h4>${msg}</h4>
        <p>${sub}</p>
      </div>
      <div class="streak-count">${streak}d</div>
    </div>`;
}

/* ════════════════════════════════════════════════════════════
   QUICK STATS — Average daily spend, largest expense, etc.
   ════════════════════════════════════════════════════════════ */
function renderQuickStats() {
  const wrap = document.getElementById('quick-stats-wrap');
  if (!wrap || !DB.transactions.length) { if (wrap) wrap.innerHTML = ''; return; }

  const expenses = DB.transactions.filter(t => t.type === 'expense');
  if (!expenses.length) { wrap.innerHTML = ''; return; }

  // Avg daily spend (last 30 days)
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const recent = expenses.filter(t => new Date(t.date) >= thirtyAgo);
  const avgDaily = recent.length ? recent.reduce((s,t) => s+t.amount, 0) / 30 : 0;
  
  // Largest single expense
  const maxTx = expenses.reduce((max, t) => t.amount > max.amount ? t : max, expenses[0]);
  
  // Most used category
  const catCount = {};
  expenses.forEach(t => catCount[t.category] = (catCount[t.category] || 0) + 1);
  const topCat = Object.entries(catCount).sort((a,b) => b[1]-a[1])[0]?.[0] || '—';

  wrap.innerHTML = `
    <div class="quick-stats" style="margin-bottom:20px">
      <div class="quick-stat">
        <div class="quick-stat-val" style="color:var(--expense)">${fmt(avgDaily)}</div>
        <div class="quick-stat-label">Avg / Day (30d)</div>
      </div>
      <div class="quick-stat">
        <div class="quick-stat-val" style="color:var(--gold)">${fmt(maxTx.amount)}</div>
        <div class="quick-stat-label">Largest Expense</div>
      </div>
      <div class="quick-stat">
        <div class="quick-stat-val" style="color:var(--accent);font-size:.9rem">${topCat}</div>
        <div class="quick-stat-label">Top Category</div>
      </div>
    </div>`;
}

// renderDashboard extended — calls the base and adds advanced panels
const _baseDashboard = renderDashboard;
window.renderDashboard = renderDashboard = function () {
  _baseDashboard();
  renderHealthScore();
  renderBillReminders();
  renderStatTrends();
  renderStreak();
  renderQuickStats();
  renderWallets();
  generateAIInsights();
  updateMonthNav();
  if (_currentUser && DB.transactions.length >= 3) {
    const card = document.getElementById('ai-insights-card');
    if (card) card.style.display = 'block';
    loadAIInsights();
  }
};


/* ════════════════════════════════════════════════════════════
   INIT — wire onboarding, notifications on first login
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Theme is applied early — nothing extra needed here
});

// All functions are already on window via window.X = function() assignments above.
// The proxy stubs in index.html (loaded before this module) prevent ReferenceErrors
// on fast clicks. No re-export needed.

/* ════════════════════════════════════════════════════════════
   PROFESSIONAL UPGRADE v2.0 — New Features
   ════════════════════════════════════════════════════════════ */

/* ── openModalIncome — pre-set type to income ──────────────── */
window.openModalIncome = function () {
  openModal();
  setTimeout(() => setType('income'), 60);
};

/* ── Category Quick-Filter Pills ───────────────────────────── */
function renderCatPills() {
  const wrap = document.getElementById('cat-pills');
  if (!wrap) return;
  // Count per category
  const counts = {};
  DB.transactions.forEach(t => { counts[t.category] = (counts[t.category] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 8);
  wrap.innerHTML = [['All', DB.transactions.length], ...sorted].map(([cat, cnt]) => {
    const isAll = cat === 'All';
    const active = isAll
      ? !document.getElementById('f-cat')?.value
      : document.getElementById('f-cat')?.value === cat;
    return `<button class="cat-pill ${active ? 'active' : ''}" onclick="filterByCat('${cat}')">
      ${!isAll ? `<i class="fas ${CAT_ICONS[cat] || 'fa-tag'}" style="color:${CAT_COLORS[cat] || '#64748b'}"></i>` : ''}
      ${cat}
      <span class="cat-pill-count">${cnt}</span>
    </button>`;
  }).join('');
}

window.filterByCat = function(cat) {
  const el = document.getElementById('f-cat');
  if (el) el.value = cat === 'All' ? '' : cat;
  renderTransactions();
  renderCatPills();
};

/* ── Analytics Stats Inner (separate from metrics) ─────────── */
function renderAnalyticsStatsInner() {
  const el = document.getElementById('analytics-stats-inner');
  if (!el) return;
  const allInc = DB.transactions.filter(t => t.type==='income').reduce((s,t)=>s+t.amount,0);
  const allExp = DB.transactions.filter(t => t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const avgExp = DB.transactions.filter(t=>t.type==='expense').length
    ? allExp / DB.transactions.filter(t=>t.type==='expense').length : 0;
  const maxTx = DB.transactions.reduce((m,t)=>t.amount>m.amount?t:m,{amount:0});
  el.innerHTML = [
    ['Total Income',    fmt(allInc),              'var(--income)'],
    ['Total Expenses',  fmt(allExp),              'var(--expense)'],
    ['Net Balance',     fmt(allInc-allExp),        allInc>=allExp?'var(--income)':'var(--expense)'],
    ['Avg Transaction', fmt(avgExp),               'var(--text)'],
    ['Total Records',   DB.transactions.length,    'var(--accent2)'],
    ['Largest Expense', maxTx.amount?fmt(maxTx.amount):'—','var(--gold)'],
  ].map(([l,v,c])=>`<div class="analytics-stat">
    <span class="label">${l}</span>
    <span class="value" style="color:${c}">${v}</span>
  </div>`).join('');
}



/* ── Smart category suggestion from description ─────────────── */
(function initSmartCat(){
  const desc = document.getElementById('m-desc');
  if (!desc) return;
  const map = {
    swiggy:'Food',zomato:'Food',mcdonalds:'Food',uber:'Transportation',ola:'Transportation',
    petrol:'Transportation',fuel:'Transportation',rent:'Housing',electricity:'Utilities',
    netflix:'Entertainment',spotify:'Entertainment',amazon:'Shopping',flipkart:'Shopping',
    hospital:'Healthcare',medicine:'Healthcare',school:'Education',college:'Education',
    salary:'Salary',freelance:'Freelance',gym:'Healthcare',pharmacy:'Healthcare'
  };
  desc.addEventListener('input', function(){
    const val = this.value.toLowerCase();
    for(const [kw,cat] of Object.entries(map)){
      if(val.includes(kw)){
        const sel = document.getElementById('m-cat');
        if(sel && sel.value !== cat){
          sel.value=cat;
          const hint = document.getElementById('cat-suggest-hint');
          if(hint){ hint.textContent=`Suggested: ${cat}`; hint.style.display='block'; }
        }
        break;
      }
    }
  });
})();

/* ════════════════════════════════════════════════════════════
   DEVELOPER / ABOUT MODAL
   ════════════════════════════════════════════════════════════ */

window.openDevModal = function () {
  const overlay = document.getElementById('dev-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden'; document.body.classList.add('modal-open');

  // Populate live stats
  const txEl    = document.getElementById('dev-stat-tx');
  const goalEl  = document.getElementById('dev-stat-goals');
  const daysEl  = document.getElementById('dev-stat-days');

  if (txEl)   txEl.textContent   = DB.transactions.length || '0';
  if (goalEl) goalEl.textContent = DB.goals.length || '0';

  if (daysEl) {
    if (DB.transactions.length) {
      const first = new Date(Math.min(...DB.transactions.map(t => new Date(t.date))));
      const days  = Math.max(1, Math.round((new Date() - first) / 86400000));
      daysEl.textContent = days;
    } else {
      daysEl.textContent = '—';
    }
  }

  // Close sidebar on mobile after opening modal
  closeSidebar();
};

window.closeDevModal = function () {
  const overlay = document.getElementById('dev-modal-overlay');
  if (overlay) { overlay.classList.remove('open'); }
  document.body.style.overflow = ''; document.body.classList.remove('modal-open');
};

window.openContribute = function (type) {
  const overlay = document.getElementById('contribute-overlay');
  const title   = document.getElementById('contribute-title');
  const body    = document.getElementById('contribute-body');
  if (!overlay || !body) return;

  const configs = {
    buymecoffee: {
      title: '🛍️ Support on Gumroad',
      html: `
        <div class="contribute-option">
          <div class="contribute-option-icon" style="background:rgba(255,144,79,.12)">🛍️</div>
          <div class="contribute-option-info">
            <div class="contribute-option-title">Gumroad — Support Nestfy</div>
            <div class="contribute-option-val">nejamulhaque.gumroad.com/coffee</div>
          </div>
          <button class="contribute-copy-btn" onclick="openLink('https://nejamulhaque.gumroad.com/coffee')">Open</button>
        </div>
        <p style="font-size:.78rem;color:var(--muted);text-align:center;margin-top:10px;line-height:1.6">Your support keeps Nestfy free for everyone. Thank you! 🙏</p>`,
    },
    upi: {
      title: '📱 UPI Payment',
      html: `
        <div class="contribute-option">
          <div class="contribute-option-icon" style="background:rgba(124,106,255,.12)"><i class="fas fa-mobile-screen-button" style="color:var(--accent2);font-size:1.2rem"></i></div>
          <div class="contribute-option-info">
            <div class="contribute-option-title">UPI / GPay / PhonePe</div>
            <div class="contribute-option-val" id="upi-id-text" style="font-family:var(--fm);font-size:.8rem">nejamulhaque@freecharge</div>
          </div>
          <button class="contribute-copy-btn" onclick="copyUPI()"><i class="fas fa-copy" style="margin-right:4px"></i>Copy</button>
        </div>
        <div style="text-align:center;padding:16px 0 8px">
          <div style="font-size:.72rem;color:var(--muted);margin-bottom:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Scan to Pay</div>
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=upi://pay?pa=nejamulhaque@freecharge&pn=Nejamul%20Haque%20Murli&cu=INR&bgcolor=111620&color=00d4aa&qzone=2" alt="UPI QR Code" style="border-radius:12px;width:150px;height:150px;border:2px solid var(--border2)" onerror="this.parentElement.innerHTML='<div style=\'color:var(--muted);font-size:.78rem;padding:12px\'>QR unavailable — copy UPI ID above</div>'">
          <div style="margin-top:10px;font-size:.72rem;color:var(--muted)">Works with GPay, PhonePe, Paytm &amp; all UPI apps</div>
        </div>`,
    },
    github: {
      title: '⭐ Star on GitHub',
      html: `
        <div class="contribute-option">
          <div class="contribute-option-icon" style="background:rgba(255,255,255,.05)"><i class="fab fa-github" style="color:var(--text);font-size:1.4rem"></i></div>
          <div class="contribute-option-info">
            <div class="contribute-option-title">Nestfy on GitHub</div>
            <div class="contribute-option-val">github.com/NejamulHaque/nestfy</div>
          </div>
          <button class="contribute-copy-btn" onclick="openLink('https://github.com/NejamulHaque')">Open</button>
        </div>
        <div style="background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-top:10px">
          <div style="font-size:.78rem;font-weight:700;margin-bottom:8px">Ways to contribute</div>
          <div style="font-size:.75rem;color:var(--muted2);display:flex;flex-direction:column;gap:7px;line-height:1.5">
            <div><i class="fas fa-star" style="color:var(--gold);margin-right:7px;width:14px"></i>Star the repo to help others discover it</div>
            <div><i class="fas fa-bug" style="color:var(--expense);margin-right:7px;width:14px"></i>Report bugs via GitHub Issues</div>
            <div><i class="fas fa-code-pull-request" style="color:var(--accent);margin-right:7px;width:14px"></i>Submit PRs for new features or fixes</div>
            <div><i class="fas fa-share-nodes" style="color:var(--accent2);margin-right:7px;width:14px"></i>Share Nestfy with friends and family</div>
          </div>
        </div>`,
    },
    feedback: {
      title: '💡 Send Feedback',
      html: `
        <div style="margin-bottom:12px">
          <div class="form-label">What's on your mind?</div>
          <textarea class="form-control" id="feedback-text" placeholder="Bug report, feature request, general feedback..." style="resize:vertical;min-height:90px"></textarea>
        </div>
        <div style="margin-bottom:12px">
          <div class="form-label">Type</div>
          <select class="form-control" id="feedback-type">
            <option>🐛 Bug Report</option>
            <option>💡 Feature Request</option>
            <option>🌟 Compliment</option>
            <option>🤔 Question</option>
            <option>💬 Other</option>
          </select>
        </div>
        <button class="btn btn-primary" style="width:100%" onclick="submitFeedback()"><i class="fas fa-paper-plane"></i> Send Feedback</button>`,
    },
  };

  const cfg = configs[type];
  if (!cfg) return;
  if (title) title.textContent = cfg.title;
  body.innerHTML = cfg.html;
  overlay.classList.add('open');
};

window.closeContribute = function () {
  const overlay = document.getElementById('contribute-overlay');
  if (overlay) overlay.classList.remove('open');
};

window.copyUPI = function () {
  const upiId = document.getElementById('upi-id-text')?.textContent || 'nejamulhaque@freecharge';
  navigator.clipboard?.writeText(upiId)
    .then(() => toast('UPI ID copied! ✓', 'success'))
    .catch(() => {
      // Fallback
      const el = document.createElement('textarea');
      el.value = upiId;
      document.body.appendChild(el);
      el.select(); document.execCommand('copy');
      document.body.removeChild(el);
      toast('UPI ID copied! ✓', 'success');
    });
};

window.openLink = function (url) {
  window.open(url, '_blank', 'noopener,noreferrer');
};

window.submitFeedback = function () {
  const text = document.getElementById('feedback-text')?.value.trim();
  const type = document.getElementById('feedback-type')?.value || '';
  if (!text) { toast('Please enter your feedback', 'error'); return; }
  // Build mailto link
  const subject = encodeURIComponent('Nestfy Feedback: ' + type);
  const body    = encodeURIComponent(text + '\n\n---\nNestfy v2.0 | ' + new Date().toLocaleString());
  window.open(`mailto:nejamulhaque.05@gmail.com?subject=${subject}&body=${body}`, '_blank');
  toast('Opening mail app... ✓', 'success');
  closeContribute();
};

// Also add 'openDevModal' to proxy stubs in case of fast click
window.openDevModal = window.openDevModal || function(){};
window.closeDevModal = window.closeDevModal || function(){};
window.openContribute = window.openContribute || function(){};
window.closeContribute = window.closeContribute || function(){};

/* ════════════════════════════════════════════════════════════
   PWA INSTALL HELPER
   ════════════════════════════════════════════════════════════ */
window.triggerInstall = async function () {
  // deferredPrompt is set by beforeinstallprompt in index.html
  const dp = window._deferredInstallPrompt;
  if (dp) {
    dp.prompt();
    const { outcome } = await dp.userChoice;
    if (outcome === 'accepted') toast('Nestfy installed! 🎉', 'success');
    window._deferredInstallPrompt = null;
    const row = document.getElementById('install-app-row');
    if (row) row.style.display = 'none';
  } else {
    // Manual instructions fallback
    toast('Tap your browser menu → "Add to Home Screen"', 'info', 4000);
  }
};