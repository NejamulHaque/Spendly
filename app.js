// ============================================================
//  SPENDLY — app.js
//  Main application: Auth UI, Firestore data, all UI logic
// ============================================================

import { watchAuthState, signUpEmail, signInEmail, signInGoogle, logOut, resetPassword, friendlyError } from "./auth.js";
import { listenTransactions, addTransaction, updateTransaction, deleteTransaction,
         getBudgets, saveBudgets, getAllGoals, addGoal, updateGoal, deleteGoal,
         getAllRecurring, addRecurring, deleteRecurring, getPrefs, savePrefs, wipeAllUserData } from "./db.js";

'use strict';

// ── App State ────────────────────────────────────────────────
let currentUser    = null;
let unsubscribeTx  = null;   // Firestore real-time listener unsubscribe fn

let DB = {
  transactions: [],
  budgets:      {},
  goals:        [],
  recurring:    [],
  settings: { name:'', currency:'INR', monthlyIncome:0, budgetAlerts:true, compactView:false },
};

// ── Constants ────────────────────────────────────────────────
const CATS_EXPENSE = ['Food','Transportation','Housing','Utilities','Healthcare','Entertainment','Education','Shopping','Other'];
const CATS_INCOME  = ['Salary','Freelance','Business','Investment','Gift','Other'];
const CAT_COLORS   = { Food:'#ffd166',Transportation:'#a78bfa',Housing:'#00d4aa',Utilities:'#2dd4bf',Healthcare:'#f472b6',Entertainment:'#fb7185',Education:'#fb923c',Shopping:'#34d399',Other:'#94a3b8',Salary:'#00d4aa',Freelance:'#7c6aff',Business:'#38d9a9',Investment:'#ffd166',Gift:'#f472b6' };
const CAT_ICONS    = { Food:'fa-utensils',Transportation:'fa-car',Housing:'fa-house',Utilities:'fa-bolt',Healthcare:'fa-heart-pulse',Entertainment:'fa-clapperboard',Education:'fa-graduation-cap',Shopping:'fa-bag-shopping',Other:'fa-tag',Salary:'fa-briefcase',Freelance:'fa-laptop',Business:'fa-chart-pie',Investment:'fa-trending-up',Gift:'fa-gift' };
const CAT_BADGES   = { Food:'badge-food',Transportation:'badge-transport',Housing:'badge-housing',Utilities:'badge-utilities',Healthcare:'badge-health',Entertainment:'badge-entertainment',Education:'badge-education',Shopping:'badge-shopping',Other:'badge-other',Salary:'badge-salary',Freelance:'badge-freelance',Business:'badge-business',Investment:'badge-investment',Gift:'badge-gift' };
const CURRENCIES   = { INR:{sym:'₹',locale:'en-IN'},USD:{sym:'$',locale:'en-US'},EUR:{sym:'€',locale:'de-DE'},GBP:{sym:'£',locale:'en-GB'},JPY:{sym:'¥',locale:'ja-JP'},CAD:{sym:'CA$',locale:'en-CA'},AUD:{sym:'A$',locale:'en-AU'},SGD:{sym:'S$',locale:'en-SG'},BDT:{sym:'৳',locale:'en-BD'} };

let chartInstances   = {};
let currentModalType = 'expense';
let currentRecType   = 'expense';

// ════════════════════════════════════════════════════════════
//  AUTH UI
// ════════════════════════════════════════════════════════════

window.showTab = function(tab) {
  ['login','signup'].forEach(t => {
    document.getElementById('panel-' + t).classList.toggle('active', t === tab);
    document.getElementById('tab-'   + t).classList.toggle('active', t === tab);
  });
  clearAuthMessages();
};

window.handleEmailLogin = async function() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  setAuthLoading('btn-login', true);
  clearAuthMessages();
  try {
    await signInEmail(email, pw);
    // onAuthStateChanged fires → onLogin() handles the rest
  } catch (e) {
    showAuthError(e.code ? friendlyError(e.code) : e.message);
    setAuthLoading('btn-login', false);
  }
};

window.handleEmailSignup = async function() {
  const name    = document.getElementById('signup-name').value.trim();
  const email   = document.getElementById('signup-email').value.trim();
  const pw      = document.getElementById('signup-pw').value;
  const confirm = document.getElementById('signup-confirm').value;

  clearAuthMessages();
  if (pw !== confirm) { showAuthError("Passwords don't match."); return; }

  setAuthLoading('btn-signup', true);
  try {
    await signUpEmail(name, email, pw);
  } catch (e) {
    showAuthError(e.code ? friendlyError(e.code) : e.message);
    setAuthLoading('btn-signup', false);
  }
};

window.handleGoogle = async function() {
  clearAuthMessages();
  try {
    await signInGoogle();
  } catch (e) {
    showAuthError(e.code ? friendlyError(e.code) : e.message);
  }
};

window.handleForgotPw = async function() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { showAuthError('Enter your email above first.'); return; }
  try {
    await resetPassword(email);
    showAuthSuccess('Password reset email sent! Check your inbox.');
  } catch (e) {
    showAuthError(e.code ? friendlyError(e.code) : e.message);
  }
};

window.handleLogout = async function() {
  openConfirm('Sign Out', 'Are you sure you want to sign out?', async () => {
    if (unsubscribeTx) { unsubscribeTx(); unsubscribeTx = null; }
    await logOut();
  });
};

window.togglePw = function(id, btn) {
  const el = document.getElementById(id);
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  btn.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
};

window.checkPwStrength = function(pw) {
  const el    = document.getElementById('pw-strength');
  const fill  = document.getElementById('pw-fill');
  const label = document.getElementById('pw-label');
  if (!pw) { el.classList.remove('show'); return; }
  el.classList.add('show');
  let score = 0;
  if (pw.length >= 6)  score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw))   score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { w:'20%',  bg:'#ef4444', txt:'Very weak'  },
    { w:'40%',  bg:'#f97316', txt:'Weak'       },
    { w:'60%',  bg:'#eab308', txt:'Fair'       },
    { w:'80%',  bg:'#22c55e', txt:'Strong'     },
    { w:'100%', bg:'#00d4aa', txt:'Very strong'},
  ];
  const l = levels[Math.min(score, 4)];
  fill.style.width      = l.w;
  fill.style.background = l.bg;
  label.textContent     = l.txt;
  label.style.color     = l.bg;
};

function setAuthLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.toggle('loading', on);
}
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  document.getElementById('auth-error-text').textContent = msg;
  el.classList.add('show');
  document.getElementById('auth-success').classList.remove('show');
}
function showAuthSuccess(msg) {
  const el = document.getElementById('auth-success');
  document.getElementById('auth-success-text').textContent = msg;
  el.classList.add('show');
  document.getElementById('auth-error').classList.remove('show');
}
function clearAuthMessages() {
  document.getElementById('auth-error').classList.remove('show');
  document.getElementById('auth-success').classList.remove('show');
}

// ════════════════════════════════════════════════════════════
//  AUTH STATE HANDLER
// ════════════════════════════════════════════════════════════

watchAuthState(
  async user => {
    currentUser = user;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-shell').style.display   = '';
    setAuthLoading('btn-login', false);
    setAuthLoading('btn-signup', false);

    // Populate sidebar user info
    const name  = user.displayName || user.email.split('@')[0];
    const email = user.email;
    document.getElementById('sidebar-name').textContent  = name;
    document.getElementById('sidebar-email').textContent = email;
    document.getElementById('settings-email').textContent = email;

    // Avatar: photo URL (Google) or initials
    const av = document.getElementById('sidebar-avatar');
    if (user.photoURL) {
      av.innerHTML = `<img src="${user.photoURL}" alt="avatar">`;
    } else {
      av.textContent = name.charAt(0).toUpperCase();
    }

    setSyncStatus('syncing');

    // Load prefs + data from Firestore
    const prefs = await getPrefs(user.uid);
    DB.settings = { ...DB.settings, ...prefs, name };
    applySettings();
    updateGreeting();

    DB.budgets   = await getBudgets(user.uid);
    DB.goals     = await getAllGoals(user.uid);
    DB.recurring = await getAllRecurring(user.uid);

    // Real-time transaction listener
    if (unsubscribeTx) unsubscribeTx();
    unsubscribeTx = listenTransactions(user.uid, txs => {
      DB.transactions = txs;
      renderAll();
      setSyncStatus('synced');
    });

    renderBudgets();
    renderGoals();
    renderRecurring();
    setSyncStatus('synced');

    document.getElementById('m-date').value = todayStr();
    document.getElementById('r-date').value = todayStr();
    setType('expense');
  },
  () => {
    currentUser = null;
    if (unsubscribeTx) { unsubscribeTx(); unsubscribeTx = null; }
    document.getElementById('auth-screen').style.display = '';
    document.getElementById('app-shell').style.display   = 'none';
  }
);

function setSyncStatus(state) {
  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!dot) return;
  dot.className = 'sync-dot' + (state === 'syncing' ? ' syncing' : state === 'offline' ? ' offline' : '');
  label.textContent = state === 'syncing' ? 'Syncing…' : state === 'offline' ? 'Offline' : 'Synced';
}

// ════════════════════════════════════════════════════════════
//  CURRENCY
// ════════════════════════════════════════════════════════════
function sym(c) { return (CURRENCIES[c || DB.settings.currency] || CURRENCIES.INR).sym; }
function fmt(n, c) {
  const cur = c || DB.settings.currency;
  const info = CURRENCIES[cur] || CURRENCIES.INR;
  try { return new Intl.NumberFormat(info.locale, { style:'currency', currency:cur, minimumFractionDigits: cur==='JPY'?0:2, maximumFractionDigits: cur==='JPY'?0:2 }).format(n); }
  catch { return info.sym + Number(n).toFixed(2); }
}
window.setCurrency = function(val) {
  DB.settings.currency = val;
  saveSettings();
  ['global-currency','s-currency'].forEach(id => { const el=document.getElementById(id); if(el) el.value=val; });
  document.querySelectorAll('[id$="-sym"]').forEach(el => el.textContent = sym());
  renderAll();
};

// ════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════
const PAGE_TITLES = { dashboard:'Dashboard', transactions:'Transactions', budgets:'Budgets', goals:'Savings Goals', recurring:'Recurring', analytics:'Analytics', settings:'Settings' };

window.nav = function(el, pageId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + pageId).classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[pageId] || '';
  if (pageId === 'analytics') setTimeout(renderAnalytics, 80);
  if (pageId === 'dashboard')  renderDashboard();
  document.getElementById('sidebar').classList.remove('open');
};

window.toggleSidebar = function() { document.getElementById('sidebar').classList.toggle('open'); };

// ════════════════════════════════════════════════════════════
//  TRANSACTION MODAL
// ════════════════════════════════════════════════════════════
window.openModal = function(editId) {
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  if (editId) {
    const tx = DB.transactions.find(t => t.id === editId);
    if (!tx) return;
    document.getElementById('modal-title').textContent      = 'Edit Transaction';
    document.getElementById('modal-save-label').textContent = 'Update';
    document.getElementById('m-edit-id').value = editId;
    setType(tx.type);
    document.getElementById('m-date').value    = tx.date;
    document.getElementById('m-amount').value  = tx.amount;
    document.getElementById('m-desc').value    = tx.description || '';
    document.getElementById('m-tags').value    = (tx.tags || []).join(', ');
    document.getElementById('m-payment').value = tx.payment || '';
    document.getElementById('m-notes').value   = tx.notes || '';
    setTimeout(() => { document.getElementById('m-cat').value = tx.category; }, 50);
  } else {
    document.getElementById('modal-title').textContent      = 'Add Transaction';
    document.getElementById('modal-save-label').textContent = 'Save';
    document.getElementById('m-edit-id').value  = '';
    setType('expense');
    document.getElementById('m-date').value   = todayStr();
    document.getElementById('m-amount').value = '';
    document.getElementById('m-desc').value   = '';
    document.getElementById('m-tags').value   = '';
    document.getElementById('m-payment').value = '';
    document.getElementById('m-notes').value  = '';
  }
  setTimeout(() => document.getElementById('m-amount').focus(), 120);
};

window.closeModal = function() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
};

window.handleOverlayClick = function(e) { if (e.target === document.getElementById('modal-overlay')) closeModal(); };

// ════════════════════════════════════════════════════════════
//  CONFIRM DIALOG
// ════════════════════════════════════════════════════════════
window.openConfirm = function(title, msg, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;
  document.getElementById('confirm-btn').onclick = () => { onConfirm(); closeConfirm(); };
  document.getElementById('confirm-overlay').classList.add('open');
};
window.closeConfirm = function() { document.getElementById('confirm-overlay').classList.remove('open'); };

// ════════════════════════════════════════════════════════════
//  TYPE TOGGLE
// ════════════════════════════════════════════════════════════
window.setType = function(type) {
  currentModalType = type;
  document.getElementById('tt-exp').classList.toggle('active', type === 'expense');
  document.getElementById('tt-inc').classList.toggle('active', type === 'income');
  const cats = type === 'expense' ? CATS_EXPENSE : CATS_INCOME;
  document.getElementById('m-cat').innerHTML = cats.map(c => `<option value="${c}">${catEmoji(c)} ${c}</option>`).join('');
};

window.setRecType = function(type) {
  currentRecType = type;
  document.getElementById('rt-exp').classList.toggle('active', type === 'expense');
  document.getElementById('rt-inc').classList.toggle('active', type === 'income');
};

function catEmoji(c) {
  return {Food:'🍽️',Transportation:'🚗',Housing:'🏠',Utilities:'⚡',Healthcare:'🏥',Entertainment:'🎬',Education:'📚',Shopping:'🛍️',Other:'📦',Salary:'💼',Freelance:'💻',Business:'📊',Investment:'📈',Gift:'🎁'}[c] || '•';
}

// ════════════════════════════════════════════════════════════
//  SAVE TRANSACTION (Firestore)
// ════════════════════════════════════════════════════════════
window.saveTransaction = async function() {
  if (!currentUser) return;
  const date    = document.getElementById('m-date').value;
  const cat     = document.getElementById('m-cat').value;
  const amount  = parseFloat(document.getElementById('m-amount').value);
  const desc    = document.getElementById('m-desc').value.trim();
  const tags    = document.getElementById('m-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const payment = document.getElementById('m-payment').value;
  const notes   = document.getElementById('m-notes').value.trim();
  const editId  = document.getElementById('m-edit-id').value;

  if (!date)            { toast('Please select a date', 'error'); return; }
  if (!cat)             { toast('Please select a category', 'error'); return; }
  if (!amount || amount <= 0) { toast('Please enter a valid amount', 'error'); return; }

  const record = { date, category:cat, amount, description:desc, tags, payment, notes, type:currentModalType };
  setSyncStatus('syncing');
  try {
    if (editId) {
      await updateTransaction(currentUser.uid, editId, record);
      toast('Transaction updated ✓', 'success');
    } else {
      await addTransaction(currentUser.uid, record);
      toast('Transaction saved ✓', 'success');
    }
    closeModal();
    // listenTransactions fires automatically → renderAll()
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
    setSyncStatus('offline');
  }
};

window.deleteTransaction = function(id) {
  if (!currentUser) return;
  const tx = DB.transactions.find(t => t.id === id);
  openConfirm('Delete Transaction', `Delete "${tx?.description || tx?.category}" (${fmt(tx?.amount || 0)})?`, async () => {
    setSyncStatus('syncing');
    try {
      await deleteTransaction(currentUser.uid, id);
      toast('Transaction deleted', 'info');
    } catch (e) { toast('Delete failed: ' + e.message, 'error'); setSyncStatus('offline'); }
  });
};

window.confirmClearAll = function() {
  openConfirm('Delete All Data', 'This permanently deletes ALL your data from Firebase. Cannot be undone!', async () => {
    setSyncStatus('syncing');
    try {
      await wipeAllUserData(currentUser.uid);
      DB = { ...DB, transactions:[], budgets:{}, goals:[], recurring:[] };
      renderAll();
      toast('All data cleared', 'info');
    } catch (e) { toast('Error: ' + e.message, 'error'); setSyncStatus('offline'); }
  });
};

// ════════════════════════════════════════════════════════════
//  BUDGETS
// ════════════════════════════════════════════════════════════
window.saveBudget = async function() {
  if (!currentUser) return;
  const cat      = document.getElementById('b-cat').value;
  const limit    = parseFloat(document.getElementById('b-limit').value);
  const alertPct = parseInt(document.getElementById('b-alert-pct').value);
  if (!cat || isNaN(limit) || limit <= 0) { toast('Enter a valid budget limit', 'error'); return; }
  DB.budgets[cat] = { limit, alertPct };
  setSyncStatus('syncing');
  try {
    await saveBudgets(currentUser.uid, DB.budgets);
    renderBudgets();
    document.getElementById('b-limit').value = '';
    toast(`Budget set for ${cat} ✓`, 'success');
    setSyncStatus('synced');
  } catch (e) { toast('Save failed', 'error'); setSyncStatus('offline'); }
};

window.deleteBudget = function(cat) {
  openConfirm('Remove Budget', `Remove the budget for "${cat}"?`, async () => {
    delete DB.budgets[cat];
    await saveBudgets(currentUser.uid, DB.budgets);
    renderBudgets();
    toast(`Budget for ${cat} removed`, 'info');
  });
};

// ════════════════════════════════════════════════════════════
//  GOALS
// ════════════════════════════════════════════════════════════
window.saveGoal = async function() {
  if (!currentUser) return;
  const name     = document.getElementById('g-name').value.trim();
  const target   = parseFloat(document.getElementById('g-target').value);
  const saved    = parseFloat(document.getElementById('g-saved').value) || 0;
  const date     = document.getElementById('g-date').value;
  const priority = document.getElementById('g-priority').value;
  const desc     = document.getElementById('g-desc').value.trim();
  if (!name)            { toast('Enter a goal name', 'error'); return; }
  if (!target || target <= 0) { toast('Enter a valid target', 'error'); return; }
  setSyncStatus('syncing');
  try {
    const id = await addGoal(currentUser.uid, { name, target, saved, date, priority, desc });
    DB.goals.push({ id, name, target, saved, date, priority, desc });
    renderGoals();
    ['g-name','g-target','g-saved','g-date','g-desc'].forEach(id => document.getElementById(id).value = '');
    toast(`Goal "${name}" added ✓`, 'success');
    setSyncStatus('synced');
  } catch (e) { toast('Save failed', 'error'); setSyncStatus('offline'); }
};

window.deleteGoal = function(id) {
  const g = DB.goals.find(g => g.id === id);
  openConfirm('Delete Goal', `Delete goal "${g?.name}"?`, async () => {
    await deleteGoal(currentUser.uid, id);
    DB.goals = DB.goals.filter(g => g.id !== id);
    renderGoals();
    toast('Goal deleted', 'info');
  });
};

window.updateGoalSaved = async function(id) {
  const g   = DB.goals.find(g => g.id === id);
  if (!g) return;
  const val = parseFloat(prompt(`Update saved amount for "${g.name}" (current: ${fmt(g.saved)}):`));
  if (isNaN(val) || val < 0) return;
  await updateGoal(currentUser.uid, id, { saved: val });
  const i = DB.goals.findIndex(g => g.id === id);
  if (i > -1) DB.goals[i].saved = val;
  renderGoals();
  toast('Goal updated ✓', 'success');
};

// ════════════════════════════════════════════════════════════
//  RECURRING
// ════════════════════════════════════════════════════════════
window.saveRecurring = async function() {
  if (!currentUser) return;
  const name   = document.getElementById('r-name').value.trim();
  const cat    = document.getElementById('r-cat').value;
  const freq   = document.getElementById('r-freq').value;
  const amount = parseFloat(document.getElementById('r-amount').value);
  const date   = document.getElementById('r-date').value;
  if (!name)            { toast('Enter a name', 'error'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
  setSyncStatus('syncing');
  try {
    const id = await addRecurring(currentUser.uid, { name, category:cat, frequency:freq, amount, date, type:currentRecType });
    DB.recurring.push({ id, name, category:cat, frequency:freq, amount, date, type:currentRecType });
    renderRecurring();
    ['r-name','r-amount','r-date'].forEach(id => document.getElementById(id).value = '');
    toast(`"${name}" added ✓`, 'success');
    setSyncStatus('synced');
  } catch (e) { toast('Save failed', 'error'); setSyncStatus('offline'); }
};

window.deleteRecurring = function(id) {
  const r = DB.recurring.find(r => r.id === id);
  openConfirm('Delete Recurring', `Delete "${r?.name}"?`, async () => {
    await deleteRecurring(currentUser.uid, id);
    DB.recurring = DB.recurring.filter(r => r.id !== id);
    renderRecurring();
    toast('Recurring removed', 'info');
  });
};

// ════════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════════
window.saveSettings = async function() {
  if (!currentUser) return;
  DB.settings.name          = document.getElementById('s-name').value.trim();
  DB.settings.monthlyIncome = parseFloat(document.getElementById('s-income').value) || 0;
  DB.settings.budgetAlerts  = document.getElementById('pref-alerts').checked;
  DB.settings.compactView   = document.getElementById('pref-compact').checked;
  updateGreeting();
  try { await savePrefs(currentUser.uid, DB.settings); } catch (e) { /* silent */ }
};

function applySettings() {
  const { name, currency, monthlyIncome, budgetAlerts, compactView } = DB.settings;
  ['global-currency','s-currency'].forEach(id => { const el=document.getElementById(id); if(el) el.value=currency; });
  const sn = document.getElementById('s-name');    if(sn) sn.value = name || '';
  const si = document.getElementById('s-income');  if(si) si.value = monthlyIncome || '';
  const pa = document.getElementById('pref-alerts'); if(pa) pa.checked = budgetAlerts !== false;
  const pc = document.getElementById('pref-compact'); if(pc) pc.checked = !!compactView;
  document.querySelectorAll('[id$="-sym"]').forEach(el => el.textContent = sym());
}

// ════════════════════════════════════════════════════════════
//  EXPORT / IMPORT
// ════════════════════════════════════════════════════════════
window.exportCSV = function() {
  if (!DB.transactions.length) { toast('No transactions to export', 'error'); return; }
  const rows = [
    ['Date','Type','Category','Amount','Currency','Description','Tags','Payment','Notes'],
    ...DB.transactions.map(t => [t.date,t.type,t.category,t.amount,DB.settings.currency,`"${(t.description||'').replace(/"/g,'""')}"`,`"${(t.tags||[]).join(';')}"`,t.payment||'',`"${(t.notes||'').replace(/"/g,'""')}"`])
  ];
  download(`spendly_${todayStr()}.csv`, 'text/csv', rows.map(r=>r.join(',')).join('\n'));
  toast('CSV exported ✓', 'success');
};

window.exportJSON = function() {
  download(`spendly_backup_${todayStr()}.json`, 'application/json', JSON.stringify(DB, null, 2));
  toast('Backup exported ✓', 'success');
};

window.importJSON = function(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.transactions) { toast('Invalid backup file', 'error'); return; }
      openConfirm('Import Backup', 'This will add imported data to your account. Continue?', async () => {
        setSyncStatus('syncing');
        for (const tx of data.transactions) {
          const { id, createdAt, updatedAt, ...rest } = tx;
          await addTransaction(currentUser.uid, rest);
        }
        toast(`Imported ${data.transactions.length} transactions ✓`, 'success');
        setSyncStatus('synced');
      });
    } catch { toast('Could not read file', 'error'); }
  };
  reader.readAsText(file);
  input.value = '';
};

window.clearFilters = function() {
  ['f-search','f-type','f-cat','f-from','f-to'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('f-sort').value = 'date-desc';
  renderTransactions();
};

function download(name, type, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
}

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════
function renderAll() { renderDashboard(); renderTransactions(); renderBudgets(); renderGoals(); renderRecurring(); updateBadge(); renderAbout(); }

function updateBadge() { const el=document.getElementById('tx-count-badge'); if(el) el.textContent=DB.transactions.length; }

function updateGreeting() {
  const h = new Date().getHours();
  const greet = h<5?'Good night':h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const name  = DB.settings.name || (currentUser?.displayName) || '';
  const gEl   = document.getElementById('greeting');
  const gSub  = document.getElementById('greeting-sub');
  if (gEl)  gEl.textContent  = name ? `${greet}, ${name} 👋` : `${greet} 👋`;
  if (gSub) gSub.textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}

function renderDashboard() {
  updateGreeting();
  const now = new Date(), m = now.getMonth(), y = now.getFullYear();
  const thisMonth  = DB.transactions.filter(t => { const d=new Date(t.date); return d.getMonth()===m && d.getFullYear()===y; });
  const monthInc   = thisMonth.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const monthSpent = thisMonth.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const allInc     = DB.transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const allSpent   = DB.transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const balance    = allInc - allSpent;
  const effInc     = monthInc || DB.settings.monthlyIncome;
  const savingsRate = effInc > 0 ? Math.max(0, Math.round(((effInc - monthSpent) / effInc) * 100)) : 0;

  const set = (id,val,color) => { const el=document.getElementById(id); if(!el)return; el.textContent=val; if(color) el.style.color=color; };
  set('s-income',  fmt(monthInc),  'var(--income)');
  set('s-income-sub', `${thisMonth.filter(t=>t.type==='income').length} transactions`);
  set('s-spent',   fmt(monthSpent),'var(--expense)');
  set('s-spent-sub',  `${thisMonth.filter(t=>t.type==='expense').length} transactions`);
  set('s-balance', fmt(balance),   balance>=0?'var(--income)':'var(--expense)');
  set('s-rate',    savingsRate+'%');
  set('s-rate-sub', effInc>0 ? `${fmt(Math.max(0,effInc-monthSpent))} saved` : 'Set income in Settings');

  renderInsights(thisMonth, monthSpent, effInc);
  renderPieChart(filterByPeriod(DB.transactions.filter(t=>t.type==='expense'), document.getElementById('pie-period')?.value||'month'));
  renderBarChart();
  renderRecent();
}

function filterByPeriod(arr, period) {
  const now=new Date(), m=now.getMonth(), y=now.getFullYear();
  if (period==='month')  return arr.filter(t=>{const d=new Date(t.date);return d.getMonth()===m&&d.getFullYear()===y;});
  if (period==='3month') { const cut=new Date(y,m-2,1); return arr.filter(t=>new Date(t.date)>=cut); }
  if (period==='year')   return arr.filter(t=>new Date(t.date).getFullYear()===y);
  return arr;
}

function renderInsights(thisMonth, spent, income) {
  const el = document.getElementById('insights-row'); if (!el) return;
  const catT = {};
  thisMonth.filter(t=>t.type==='expense').forEach(t=>catT[t.category]=(catT[t.category]||0)+t.amount);
  const top = Object.entries(catT).sort((a,b)=>b[1]-a[1])[0];
  const day = new Date().getDate();
  const dIM = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  const proj = day > 0 ? (spent/day)*dIM : 0;
  el.innerHTML = `
    <div class="insight"><div class="insight-icon"><i class="fas fa-fire-flame-curved"></i></div><div><h4>Top Category: ${top?top[0]:'No expenses yet'}</h4><p>${top?`${fmt(top[1])} spent this month (${Math.round(top[1]/spent*100)||0}% of total)`:'Add expenses to see insights'}</p></div></div>
    <div class="insight" style="background:linear-gradient(135deg,rgba(124,106,255,.06),rgba(255,107,107,.04));border-color:rgba(124,106,255,.12)"><div class="insight-icon" style="background:rgba(124,106,255,.12);color:var(--accent2)"><i class="fas fa-chart-line"></i></div><div><h4>Projected Month: ${fmt(proj)}</h4><p>Daily avg ${fmt(day>0?spent/day:0)} · ${dIM-day} days left</p></div></div>
  `;
}

function renderRecent() {
  const el = document.getElementById('recent-list'); if (!el) return;
  const recent = [...DB.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,7);
  if (!recent.length) { el.innerHTML=`<div class="empty-state" style="padding:30px 0"><div class="empty-icon"><i class="fas fa-receipt"></i></div><h3>No transactions yet</h3><p>Add your first transaction</p></div>`; return; }
  el.innerHTML = recent.map(t=>`
    <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openModal('${t.id}')">
      <div style="width:34px;height:34px;border-radius:9px;background:${CAT_COLORS[t.category]||'#64748b'}18;display:flex;align-items:center;justify-content:center;color:${CAT_COLORS[t.category]||'#94a3b8'};font-size:.82rem;flex-shrink:0"><i class="fas ${CAT_ICONS[t.category]||'fa-tag'}"></i></div>
      <div style="flex:1;min-width:0"><div style="font-size:.83rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(t.description||t.category)}</div><div style="font-size:.68rem;color:var(--muted);margin-top:1px">${fmtDate(t.date)} · ${t.category}</div></div>
      <div style="font-family:var(--fm);font-size:.82rem;font-weight:700;color:${t.type==='income'?'var(--income)':'var(--expense)'};flex-shrink:0">${t.type==='income'?'+':'-'}${fmt(t.amount)}</div>
    </div>
  `).join('');
}

function renderPieChart(expenses) {
  const catT={};expenses.forEach(t=>catT[t.category]=(catT[t.category]||0)+t.amount);
  const total=Object.values(catT).reduce((s,v)=>s+v,0);
  const labels=Object.keys(catT), data=Object.values(catT), colors=labels.map(l=>CAT_COLORS[l]||'#64748b');
  destroyChart('pie');
  const ctx=document.getElementById('chart-pie'); if(!ctx) return;
  chartInstances.pie=new Chart(ctx,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors.map(c=>c+'bb'),borderColor:colors,borderWidth:2,hoverOffset:10}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a2035',titleColor:'#e2e8f0',bodyColor:'#94a3b8',borderColor:'rgba(255,255,255,.1)',borderWidth:1,callbacks:{label:c=>`${c.label}: ${fmt(c.raw)} (${total?Math.round(c.raw/total*100):0}%)`}}}}});
  const leg=document.getElementById('pie-legend'); if(!leg) return;
  if(!labels.length){leg.innerHTML='<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:8px 0">No data for this period</div>';return;}
  leg.innerHTML=labels.map((l,i)=>`<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div><span style="flex:1">${l}</span><div class="legend-bar-wrap"><div class="legend-bar"><div class="legend-fill" style="width:${total?Math.round(data[i]/total*100):0}%;background:${colors[i]}"></div></div></div><span class="legend-pct">${total?Math.round(data[i]/total*100):0}%</span><span class="legend-amt">${fmt(data[i])}</span></div>`).join('');
}

function renderBarChart() {
  const months=getLast6Months();
  const incArr=months.map(m=>getMonthTotal(m,'income'));
  const expArr=months.map(m=>getMonthTotal(m,'expense'));
  destroyChart('bar');
  const ctx=document.getElementById('chart-bar'); if(!ctx) return;
  chartInstances.bar=new Chart(ctx,{type:'bar',data:{labels:months.map(m=>m.label),datasets:[{label:'Income',data:incArr,backgroundColor:'rgba(0,212,170,.5)',borderColor:'#00d4aa',borderWidth:2,borderRadius:6,borderSkipped:false},{label:'Expenses',data:expArr,backgroundColor:'rgba(255,107,107,.5)',borderColor:'#ff6b6b',borderWidth:2,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8',font:{family:'Outfit',size:11}}},tooltip:{backgroundColor:'#1a2035',titleColor:'#e2e8f0',bodyColor:'#94a3b8',borderColor:'rgba(255,255,255,.1)',borderWidth:1,callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.raw)}`}}},scales:{x:{ticks:{color:'#64748b',font:{family:'Outfit'}},grid:{color:'rgba(255,255,255,.04)'}},y:{ticks:{color:'#64748b',font:{family:'Outfit'},callback:v=>sym()+abbreviate(v)},grid:{color:'rgba(255,255,255,.04)'},beginAtZero:true}}}});
}

function renderTransactions() {
  populateCatFilter();
  const search=(document.getElementById('f-search')?.value||'').toLowerCase().trim();
  const type=document.getElementById('f-type')?.value||'';
  const cat=document.getElementById('f-cat')?.value||'';
  const from=document.getElementById('f-from')?.value||'';
  const to=document.getElementById('f-to')?.value||'';
  const sort=document.getElementById('f-sort')?.value||'date-desc';
  let list=[...DB.transactions];
  if(type) list=list.filter(t=>t.type===type);
  if(cat)  list=list.filter(t=>t.category===cat);
  if(from) list=list.filter(t=>t.date>=from);
  if(to)   list=list.filter(t=>t.date<=to);
  if(search) list=list.filter(t=>(t.description||'').toLowerCase().includes(search)||(t.category||'').toLowerCase().includes(search)||(t.tags||[]).join(' ').toLowerCase().includes(search));
  const [sk,sd]=sort.split('-');
  list.sort((a,b)=>{const v=sk==='date'?new Date(a.date)-new Date(b.date):a.amount-b.amount;return sd==='desc'?-v:v;});
  const tbody=document.getElementById('tx-body');
  const empty=document.getElementById('tx-empty');
  const footer=document.getElementById('tx-footer');
  if(!tbody) return;
  if(!list.length){tbody.innerHTML='';empty.style.display='block';footer.style.display='none';return;}
  empty.style.display='none';footer.style.display='flex';
  const totalFiltered=list.reduce((s,t)=>s+t.amount*(t.type==='income'?1:-1),0);
  const txCount=document.getElementById('tx-count-text');
  const txTotal=document.getElementById('tx-total-text');
  if(txCount) txCount.textContent=`${list.length} record${list.length!==1?'s':''} shown`;
  if(txTotal) txTotal.textContent=`Net: ${totalFiltered>=0?'+':''}${fmt(totalFiltered)}`;
  tbody.innerHTML=list.map(t=>`<tr><td style="white-space:nowrap;font-size:.78rem;color:var(--muted2)">${fmtDate(t.date)}</td><td><span class="badge ${t.type==='income'?'badge-income-type':'badge-expense-type'}">${t.type==='income'?'↓ Income':'↑ Expense'}</span></td><td><span class="badge ${CAT_BADGES[t.category]||'badge-other'}"><i class="fas ${CAT_ICONS[t.category]||'fa-tag'} fa-xs"></i> ${t.category}</span></td><td style="max-width:200px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">${escHtml(t.description||'—')}</div></td><td>${(t.tags||[]).map(g=>`<span class="tag">${escHtml(g)}</span>`).join(' ')}</td><td style="font-size:.72rem;color:var(--muted)">${escHtml(t.payment||'—')}</td><td style="text-align:right" class="amount-col ${t.type==='income'?'col-income':'col-expense'}">${t.type==='income'?'+':'-'}${fmt(t.amount)}</td><td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-icon btn-sm" onclick="openModal('${t.id}')" title="Edit"><i class="fas fa-pencil"></i></button><button class="btn btn-danger btn-icon btn-sm" onclick="deleteTransaction('${t.id}')" title="Delete"><i class="fas fa-trash"></i></button></td></tr>`).join('');
}

function populateCatFilter() {
  const sel=document.getElementById('f-cat'); if(!sel) return;
  const cats=[...new Set(DB.transactions.map(t=>t.category))].sort();
  const cur=sel.value;
  sel.innerHTML='<option value="">All Categories</option>'+cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  sel.value=cur;
}

function renderBudgets() {
  const el=document.getElementById('budget-list');
  const lbl=document.getElementById('budget-month-label');
  if(!el) return;
  if(lbl) lbl.textContent=new Date().toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const entries=Object.entries(DB.budgets);
  if(!entries.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon"><i class="fas fa-wallet"></i></div><h3>No budgets set</h3><p>Create your first budget</p></div>`;return;}
  const now=new Date(),m=now.getMonth(),y=now.getFullYear();
  const monthExp=DB.transactions.filter(t=>{const d=new Date(t.date);return t.type==='expense'&&d.getMonth()===m&&d.getFullYear()===y;});
  el.innerHTML=entries.map(([cat,{limit,alertPct}])=>{
    const spent=monthExp.filter(t=>t.category===cat).reduce((s,t)=>s+t.amount,0);
    const pct=Math.round(spent/limit*100);
    const over=pct>=100;
    const warn=!over&&pct>=(alertPct||80)&&DB.settings.budgetAlerts;
    const color=over?'var(--expense)':pct>=(alertPct||80)?'var(--gold)':'var(--income)';
    return `<div class="budget-row"><div class="budget-meta"><div class="budget-name"><div class="legend-dot" style="background:${CAT_COLORS[cat]||'#64748b'}"></div>${cat}</div><span class="budget-pct" style="color:${color}">${pct}%</span></div><div class="progress"><div class="progress-fill" style="width:${Math.min(100,pct)}%;background:${color}"></div></div><div class="budget-sub"><span>${fmt(spent)} spent</span><span>${over?`<span style="color:var(--expense)">Over by ${fmt(spent-limit)}</span>`:`${fmt(limit-spent)} remaining`}</span></div>${over?`<div class="budget-alert budget-over"><i class="fas fa-circle-exclamation"></i> Over budget by ${fmt(spent-limit)}</div>`:''}${warn?`<div class="budget-alert"><i class="fas fa-triangle-exclamation"></i> ${pct}% used — approaching limit</div>`:''}<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><span style="font-size:.72rem;color:var(--muted)">Limit: ${fmt(limit)}</span><button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="deleteBudget('${cat}')"><i class="fas fa-trash"></i></button></div></div>`;
  }).join('');
}

function renderGoals() {
  const el=document.getElementById('goals-list'); if(!el) return;
  if(!DB.goals.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon"><i class="fas fa-bullseye"></i></div><h3>No savings goals</h3><p>Add your first goal</p></div>`;return;}
  const pc={high:'var(--expense)',medium:'var(--gold)',low:'var(--income)'};
  el.innerHTML=DB.goals.map(g=>{
    const pct=Math.min(100,Math.round(g.saved/g.target*100));
    const dl=g.date?Math.ceil((new Date(g.date)-new Date())/86400000):null;
    const done=pct>=100;
    return `<div class="goal-card"><div class="goal-head"><div><div class="goal-name" style="${done?'color:var(--income)':''}">${done?'✅ ':''}${escHtml(g.name)}<span style="font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid;color:${pc[g.priority]};border-color:${pc[g.priority]}33;background:${pc[g.priority]}11;margin-left:6px">${g.priority}</span></div><div class="goal-target">${g.desc?escHtml(g.desc):''}</div></div><div style="display:flex;gap:6px"><button class="btn btn-ghost btn-icon btn-sm" onclick="updateGoalSaved('${g.id}')" title="Update saved"><i class="fas fa-plus"></i></button><button class="btn btn-danger btn-icon btn-sm" onclick="deleteGoal('${g.id}')"><i class="fas fa-trash"></i></button></div></div><div class="progress" style="height:8px"><div class="progress-fill" style="width:${pct}%;background:${done?'var(--income)':'linear-gradient(90deg,var(--accent2),var(--accent))'}"></div></div><div class="goal-pct-row" style="margin-top:6px"><span style="font-size:.72rem;font-weight:700;color:${done?'var(--income)':'var(--accent)'}">${pct}%</span><span style="font-size:.72rem;color:var(--muted)">${fmt(g.saved)} / ${fmt(g.target)}</span></div><div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:4px"><span>${fmt(Math.max(0,g.target-g.saved))} remaining</span>${dl!==null?`<span>${dl>0?dl+' days left':dl===0?'Due today':'<span style="color:var(--expense)">Overdue</span>'}</span>`:''}</div></div>`;
  }).join('');
}

function renderRecurring() {
  const el=document.getElementById('rec-list');
  const cnt=document.getElementById('rec-count');
  if(!el) return;
  const recInc=DB.recurring.filter(r=>r.type==='income').reduce((s,r)=>s+r.amount,0);
  const recExp=DB.recurring.filter(r=>r.type==='expense').reduce((s,r)=>s+r.amount,0);
  const net=recInc-recExp;
  const sumEl=document.getElementById('rec-summary');
  if(sumEl) sumEl.innerHTML=`<div class="card-head"><div class="card-title-lg">Monthly Overview</div></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center"><div><div style="font-size:.68rem;color:var(--muted);margin-bottom:4px">RECURRING IN</div><div style="font-family:var(--fm);font-weight:700;color:var(--income)">${fmt(recInc)}</div></div><div><div style="font-size:.68rem;color:var(--muted);margin-bottom:4px">RECURRING OUT</div><div style="font-family:var(--fm);font-weight:700;color:var(--expense)">${fmt(recExp)}</div></div><div><div style="font-size:.68rem;color:var(--muted);margin-bottom:4px">NET/MONTH</div><div style="font-family:var(--fm);font-weight:700;color:${net>=0?'var(--income)':'var(--expense)'}">${net>=0?'+':''}${fmt(net)}</div></div></div>`;
  if(!DB.recurring.length){el.innerHTML=`<div class="empty-state" style="padding:36px 0"><div class="empty-icon"><i class="fas fa-rotate"></i></div><h3>No recurring items</h3><p>Add subscriptions, rent, or salary</p></div>`;if(cnt)cnt.textContent='';return;}
  if(cnt) cnt.textContent=`${DB.recurring.length} item${DB.recurring.length!==1?'s':''}`;
  const fl={daily:'Daily',weekly:'Weekly',monthly:'Monthly',quarterly:'Quarterly',yearly:'Yearly'};
  el.innerHTML=DB.recurring.map(r=>`<div class="rec-item"><div class="rec-icon" style="background:${r.type==='income'?'rgba(0,212,170,.12)':'rgba(255,107,107,.12)'}"><i class="fas ${CAT_ICONS[r.category]||'fa-rotate'}" style="color:${r.type==='income'?'var(--income)':'var(--expense)'}"></i></div><div class="rec-info"><div class="rec-name">${escHtml(r.name)}<span class="freq-pill">${fl[r.frequency]||r.frequency}</span></div><div class="rec-detail">${r.category} · ${r.type}${r.date?` · Due ${fmtDate(r.date)}`:''}</div></div><div style="text-align:right"><div class="rec-amount ${r.type==='income'?'col-income':'col-expense'}">${r.type==='income'?'+':'-'}${fmt(r.amount)}</div><button class="btn btn-danger btn-sm" style="margin-top:5px" onclick="deleteRecurring('${r.id}')"><i class="fas fa-trash"></i></button></div></div>`).join('');
}

function renderAnalytics() {
  const months=getLast12Months();
  const incArr=months.map(m=>getMonthTotal(m,'income'));
  const expArr=months.map(m=>getMonthTotal(m,'expense'));
  destroyChart('line');
  const lctx=document.getElementById('chart-line');
  if(lctx) chartInstances.line=new Chart(lctx,{type:'line',data:{labels:months.map(m=>m.label),datasets:[{label:'Income',data:incArr,borderColor:'#00d4aa',backgroundColor:'rgba(0,212,170,.08)',fill:true,tension:.4,pointBackgroundColor:'#00d4aa',pointRadius:4},{label:'Expenses',data:expArr,borderColor:'#ff6b6b',backgroundColor:'rgba(255,107,107,.08)',fill:true,tension:.4,pointBackgroundColor:'#ff6b6b',pointRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8',font:{family:'Outfit'}}},tooltip:{backgroundColor:'#1a2035',titleColor:'#e2e8f0',bodyColor:'#94a3b8',borderColor:'rgba(255,255,255,.1)',borderWidth:1,callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.raw)}`}}},scales:{x:{ticks:{color:'#64748b',font:{family:'Outfit'}},grid:{color:'rgba(255,255,255,.04)'}},y:{ticks:{color:'#64748b',font:{family:'Outfit'},callback:v=>sym()+abbreviate(v)},grid:{color:'rgba(255,255,255,.04)'},beginAtZero:true}}}});
  const catT={};
  DB.transactions.filter(t=>t.type==='expense').forEach(t=>catT[t.category]=(catT[t.category]||0)+t.amount);
  const dLabels=Object.keys(catT),dData=Object.values(catT),dColors=dLabels.map(l=>CAT_COLORS[l]||'#64748b');
  destroyChart('donut');
  const dctx=document.getElementById('chart-donut');
  if(dctx) chartInstances.donut=new Chart(dctx,{type:'doughnut',data:{labels:dLabels,datasets:[{data:dData,backgroundColor:dColors.map(c=>c+'bb'),borderColor:dColors,borderWidth:2,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{labels:{color:'#94a3b8',font:{family:'Outfit',size:11}}},tooltip:{backgroundColor:'#1a2035',titleColor:'#e2e8f0',bodyColor:'#94a3b8',borderColor:'rgba(255,255,255,.1)',borderWidth:1,callbacks:{label:c=>`${c.label}: ${fmt(c.raw)}`}}}}});
  const daily={},cutoff=new Date();cutoff.setDate(cutoff.getDate()-29);
  for(let d=new Date(cutoff);d<=new Date();d.setDate(d.getDate()+1)) daily[d.toISOString().slice(0,10)]=0;
  DB.transactions.filter(t=>t.type==='expense'&&new Date(t.date)>=cutoff).forEach(t=>{daily[t.date]=(daily[t.date]||0)+t.amount;});
  const dKeys=Object.keys(daily).sort(),dVals=dKeys.map(k=>daily[k]);
  destroyChart('daily');
  const dyctx=document.getElementById('chart-daily');
  if(dyctx) chartInstances.daily=new Chart(dyctx,{type:'bar',data:{labels:dKeys.map((d,i)=>{const dt=new Date(d+'T00:00:00');return dt.getDate()===1||i===0?dt.toLocaleDateString('en',{month:'short',day:'numeric'}):String(dt.getDate());}),datasets:[{label:'Spending',data:dVals,backgroundColor:dVals.map(v=>v>0?'rgba(255,107,107,.6)':'rgba(100,116,139,.2)'),borderColor:dVals.map(v=>v>0?'#ff6b6b':'#475569'),borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a2035',titleColor:'#e2e8f0',bodyColor:'#94a3b8',borderColor:'rgba(255,255,255,.1)',borderWidth:1,callbacks:{label:c=>`Spent: ${fmt(c.raw)}`}}},scales:{x:{ticks:{color:'#64748b',font:{family:'Outfit',size:10},maxTicksLimit:15},grid:{display:false}},y:{ticks:{color:'#64748b',font:{family:'Outfit'},callback:v=>sym()+abbreviate(v)},grid:{color:'rgba(255,255,255,.04)'},beginAtZero:true}}}});
  const allInc=DB.transactions.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0);
  const allExp=DB.transactions.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const avg=DB.transactions.filter(t=>t.type==='expense').length?allExp/DB.transactions.filter(t=>t.type==='expense').length:0;
  const maxTx=DB.transactions.reduce((max,t)=>t.amount>max.amount?t:max,{amount:0});
  const metrics=document.getElementById('analytics-metrics');
  if(metrics) metrics.innerHTML=[['Total Income',fmt(allInc),'var(--income)'],['Total Expenses',fmt(allExp),'var(--expense)'],['Net Balance',fmt(allInc-allExp),allInc>=allExp?'var(--income)':'var(--expense)'],['Avg Transaction',fmt(avg),'var(--text)'],['Total Records',DB.transactions.length,'var(--text)'],['Largest Expense',maxTx.amount?fmt(maxTx.amount):'—','var(--gold)']].map(([l,v,c])=>`<div class="analytics-stat"><span class="label">${l}</span><span class="value" style="color:${c}">${v}</span></div>`).join('');
  const topCats=document.getElementById('analytics-top-cats');
  const total2=Object.values(catT).reduce((s,v)=>s+v,0);
  const sorted=Object.entries(catT).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(topCats) topCats.innerHTML=sorted.length?sorted.map(([cat,amt])=>`<div class="legend-item"><div class="legend-dot" style="background:${CAT_COLORS[cat]||'#64748b'}"></div><span style="flex:1">${cat}</span><div class="legend-bar-wrap"><div class="legend-bar"><div class="legend-fill" style="width:${total2?Math.round(amt/total2*100):0}%;background:${CAT_COLORS[cat]||'#64748b'}"></div></div></div><span class="legend-pct">${total2?Math.round(amt/total2*100):0}%</span><span class="legend-amt">${fmt(amt)}</span></div>`).join(''):'<div style="color:var(--muted);font-size:.8rem">No expense data</div>';
}

function renderAbout() {
  const el=document.getElementById('about-stats'); if(!el) return;
  const first=DB.transactions.length?[...DB.transactions].sort((a,b)=>a.date.localeCompare(b.date))[0].date:null;
  el.innerHTML=[['Transactions',DB.transactions.length],['Budgets set',Object.keys(DB.budgets).length],['Savings goals',DB.goals.length],['Recurring items',DB.recurring.length],['Tracking since',first?fmtDate(first):'—'],['Version','Spendly v3.1 (Firebase)']].map(([l,v])=>`<div class="analytics-stat"><span class="label">${l}</span><span class="value">${v}</span></div>`).join('');
}

// ── Utility ──────────────────────────────────────────────────
function getLast6Months()  { const now=new Date(),res=[];for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);res.push({label:d.toLocaleDateString('en',{month:'short',year:'2-digit'}),month:d.getMonth(),year:d.getFullYear()});}return res; }
function getLast12Months() { const now=new Date(),res=[];for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);res.push({label:d.toLocaleDateString('en',{month:'short'}),month:d.getMonth(),year:d.getFullYear()});}return res; }
function getMonthTotal({month,year},type) { return DB.transactions.filter(t=>{const d=new Date(t.date);return t.type===type&&d.getMonth()===month&&d.getFullYear()===year;}).reduce((s,t)=>s+t.amount,0); }
function destroyChart(k)  { if(chartInstances[k]){chartInstances[k].destroy();delete chartInstances[k];} }
function todayStr()       { return new Date().toISOString().slice(0,10); }
function fmtDate(d)       { return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}); }
function escHtml(s)       { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function abbreviate(v)    { if(v>=1e7)return(v/1e7).toFixed(1)+'Cr';if(v>=1e5)return(v/1e5).toFixed(1)+'L';if(v>=1e3)return(v/1e3).toFixed(0)+'K';return v; }

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type='info', duration=3000) {
  const icons={success:'fa-circle-check',error:'fa-circle-xmark',info:'fa-circle-info'};
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<i class="fas ${icons[type]||icons.info}"></i><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(30px)';el.style.transition='all .3s';setTimeout(()=>el.remove(),300);},duration);
}

// ── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key==='Escape') { closeModal(); closeConfirm(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='Enter') {
    if (document.getElementById('modal-overlay').classList.contains('open')) saveTransaction();
  }
  if ((e.ctrlKey||e.metaKey) && e.key==='n') { e.preventDefault(); openModal(); }
});
