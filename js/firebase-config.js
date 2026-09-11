// ============================================
// BASHAAN POS - FIREBASE CORE
// ============================================

const firebaseConfig = {
  apiKey: "AIzaSyCnPxhTtqx2rqJjNp3Uor_8DkTXXeq9r60",
  authDomain: "mistyyyy-756fc.firebaseapp.com",
  projectId: "mistyyyy-756fc",
  storageBucket: "mistyyyy-756fc.firebasestorage.app",
  messagingSenderId: "440947601221",
  appId: "1:440947601221:web:324823524d00a7adb3182c"
};

if (typeof firebase === 'undefined' || !firebase.initializeApp) {
  console.error('❌ Firebase compat SDK missing. Load firebase-app-compat.js + firebase-firestore-compat.js BEFORE firebase-config.js');
  throw new Error('Firebase compat SDK missing');
}

const app = firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();

db.enablePersistence({ synchronizeTabs: true })
  .then(() => console.log('✅ Offline persistence enabled'))
  .catch(err => console.warn('⚠️ Persistence:', err.code));

const productsRef   = db.collection('products');
const categoriesRef = db.collection('categories');
const salesRef      = db.collection('sales');
const stockLogRef   = db.collection('stockLog');
const settingsRef   = db.collection('settings');
const auditLogRef   = db.collection('auditLog');

const APP_VERSION         = '2.0.0';
const MAX_LOGIN_ATTEMPTS  = 5;
const LOCKOUT_DURATION    = 15 * 60 * 1000;
const SESSION_TIMEOUT     = 30 * 60 * 1000;
const LOW_STOCK_THRESHOLD = 10;

function hashPassword(password) {
  let hash = 0;
  const salt = "BASHAN_POS_SALT_2024";
  const combined = password + salt;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash = hash & hash;
  }
  for (let i = 0; i < 1000; i++) { hash = ((hash << 5) - hash) + (hash % 256); hash = hash & hash; }
  return Math.abs(hash).toString(16);
}

function getIPHash() {
  const data = navigator.userAgent + Date.now();
  let hash = 0;
  for (let i = 0; i < data.length; i++) hash = ((hash << 5) - hash) + data.charCodeAt(i);
  return Math.abs(hash).toString(36);
}

function logAudit(action, details) {
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem('bashan_user')); } catch(e) {}
  auditLogRef.add({
    userId:   user?.id   || 'anonymous',
    userName: user?.name || 'Anonymous',
    role:     user?.role || 'unknown',
    action, details,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    ipHash: getIPHash()
  }).catch(err => console.error('Audit error:', err));
}

async function verifyPassword(inputPassword, role) {
  try {
    const doc = await settingsRef.doc('app').get();
    if (!doc.exists) {
      await settingsRef.doc('app').set({
        passwordManager: hashPassword('admin123'),
        passwordSeller:  hashPassword('seller123'),
        businessName:    'Bashan Livestock Feeds',
        businessAddress: '',
        businessPhone:   '',
        businessEmail:   '',
        receiptFooter:   'Thank you for your business!',
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        maxDiscount:     5000,
        sessionTimeout:  30,
        maxAttempts:     MAX_LOGIN_ATTEMPTS,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return verifyPassword(inputPassword, role);
    }
    const settings = doc.data();
    const stored = role === 'manager' ? settings.passwordManager : settings.passwordSeller;
    return hashPassword(inputPassword) === stored
      ? { success: true, role }
      : { success: false, message: 'Incorrect password' };
  } catch (error) {
    console.error('Auth error:', error);
    return { success: false, message: 'Authentication failed. Check connection.' };
  }
}

async function updatePassword(newPassword, role) {
  const field = role === 'manager' ? 'passwordManager' : 'passwordSeller';
  try {
    await settingsRef.doc('app').update({ [field]: hashPassword(newPassword) });
    logAudit('PASSWORD_CHANGE', `Password changed for ${role}`);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
}

function generateToken() { return Math.random().toString(36).substring(2) + Date.now().toString(36); }
let sessionCheckInterval = null;

function saveSession(userData) {
  const session = { ...userData, loginTime: Date.now(), token: generateToken() };
  sessionStorage.setItem('bashan_user', JSON.stringify(session));
  if (sessionCheckInterval) clearInterval(sessionCheckInterval);
  sessionCheckInterval = setInterval(() => {
    const u = JSON.parse(sessionStorage.getItem('bashan_user') || 'null');
    if (u && Date.now() - u.loginTime > SESSION_TIMEOUT) logout('Session expired');
  }, 30000);
  document.addEventListener('click', resetSessionTimer);
  document.addEventListener('keypress', resetSessionTimer);
  return session;
}

function resetSessionTimer() {
  const u = JSON.parse(sessionStorage.getItem('bashan_user') || 'null');
  if (u) { u.loginTime = Date.now(); sessionStorage.setItem('bashan_user', JSON.stringify(u)); }
}

function checkAuth() {
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem('bashan_user')); } catch(e) {}
  if (!user) return null;
  if (Date.now() - user.loginTime > SESSION_TIMEOUT) { logout('Session expired'); return null; }
  return user;
}

function logout(reason) {
  const user = JSON.parse(sessionStorage.getItem('bashan_user') || 'null');
  if (user) logAudit('LOGOUT', reason || 'Manual logout');
  sessionStorage.removeItem('bashan_user');
  sessionStorage.removeItem('bashan_cart');
  window.location.href = 'index.html';
}

async function getProducts() {
  try {
    const snap = await productsRef.where('archived', '==', false).get();
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out;
  } catch (e) { console.error(e); return []; }
}

function getProductsRealtime(callback) {
  return productsRef.where('archived', '==', false).onSnapshot(snap => {
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    callback(out);
  }, err => { console.error(err); callback([]); });
}

function getStockBase(p) { return Number(p.stockBase) || 0; }
function baseUnitsPer(p) { return p.bulkSize || 1; }

async function updateStock(productId, newStockBase, reason, notes, userName, userId) {
  try {
    const doc = await productsRef.doc(productId).get();
    if (!doc.exists) return { success: false, message: 'Product not found' };
    const p = doc.data();
    const oldStock = Number(p.stockBase) || 0;
    const delta = newStockBase - oldStock;

    await productsRef.doc(productId).update({
      stockBase: newStockBase,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await stockLogRef.add({
      productId, productName: p.name, baseUnit: p.baseUnit,
      type: delta > 0 ? 'add' : 'remove',
      quantityBase: Math.abs(delta),
      beforeStock: oldStock, afterStock: newStockBase,
      reason, notes: notes || '',
      doneBy: userId, doneByName: userName,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    logAudit('STOCK_UPDATE', `${p.name}: ${oldStock} → ${newStockBase} ${p.baseUnit} (${reason})`);
    return { success: true };
  } catch (e) {
    console.error(e);
    return { success: false, message: e.message };
  }
}

async function completeSale(saleData) {
  try {
    const batch = db.batch();
    const saleRef = salesRef.doc();
    const date = new Date();
    const receiptNumber = 'BSH-' +
      date.getFullYear() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0') + '-' +
      String(Math.floor(Math.random() * 9999)).padStart(4, '0');

    batch.set(saleRef, {
      receiptNumber,
      items: saleData.items,
      subtotal: saleData.subtotal,
      discountKsh: saleData.discountKsh || 0,
      total: saleData.total,
      paymentMethod: saleData.paymentMethod || 'Cash',
      customerName: saleData.customerName || '',
      sellerId: saleData.sellerId,
      sellerName: saleData.sellerName,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    for (const item of saleData.items) {
      const productRef = productsRef.doc(item.productId);
      const pDoc = await productRef.get();
      if (!pDoc.exists) continue;
      const p = pDoc.data();
      const per = (item.unit === 'bulk') ? (p.bulkSize || 1) : 1;
      batch.update(productRef, {
        stockBase: firebase.firestore.FieldValue.increment(-(Number(item.qty) * per))
      });
    }

    await batch.commit();
    logAudit('SALE_COMPLETE', `Sale ${receiptNumber}: KSH ${saleData.total} (${saleData.items.length} items)`);
    return { success: true, receiptNumber, saleId: saleRef.id };
  } catch (e) {
    console.error(e);
    return { success: false, message: e.message };
  }
}

async function getSettings() {
  try {
    const d = await settingsRef.doc('app').get();
    return d.exists ? d.data() : null;
  } catch (e) { console.error(e); return null; }
}

function formatCurrency(amount) {
  const n = Number(amount);
  if (isNaN(n)) return 'KSH 0.00';
  return 'KSH ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNum(n) {
  if (n === Math.floor(n)) return n.toString();
  return Number(n).toFixed(2).replace(/\.?0+$/, '');
}

function formatProductStock(p) {
  const base = Number(p.stockBase) || 0;
  const bu = p.bulkUnit, bs = p.bulkSize || 1, baseUnit = p.baseUnit || 'kg';
  if (!bu || bs <= 1) return `${formatNum(base)} ${baseUnit}`;
  const bulk = Math.floor(base / bs);
  const rem  = base % bs;
  if (bulk === 0) return `${formatNum(rem)} ${baseUnit}`;
  if (rem === 0) return `${bulk} ${bu}${bulk > 1 ? 's' : ''} (${formatNum(base)} ${baseUnit})`;
  return `${bulk} ${bu}${bulk > 1 ? 's' : ''} + ${formatNum(rem)} ${baseUnit}`;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-KE', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function showNotification(msg, type) {
  const n = document.createElement('div');
  n.className = 'notification notification-' + (type || 'info');
  n.innerHTML = `<span>${msg}</span><button onclick="this.parentElement.remove()">×</button>`;
  document.body.appendChild(n);
  setTimeout(() => {
    n.classList.add('fade-out');
    setTimeout(() => n.remove(), 300);
  }, 4000);
}

function showConfirm(msg) {
  return new Promise(resolve => {
    const m = document.createElement('div');
    m.className = 'confirm-modal';
    m.innerHTML = `
      <div class="confirm-content">
        <p>${msg.replace(/\n/g, '<br>')}</p>
        <div class="confirm-buttons">
          <button class="btn-cancel" id="cc">Cancel</button>
          <button class="btn-confirm" id="co">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    document.getElementById('cc').onclick = () => { m.remove(); resolve(false); };
    document.getElementById('co').onclick = () => { m.remove(); resolve(true);  };
  });
}

window.BashanPOS = {
  db,
  productsRef, categoriesRef, salesRef, stockLogRef, settingsRef, auditLogRef,
  verifyPassword, updatePassword, checkAuth, logout, saveSession,
  getProducts, getProductsRealtime, updateStock, completeSale,
  getSettings, logAudit,
  formatCurrency, formatProductStock, formatNum, formatDate,
  showNotification, showConfirm,
  hashPassword, getStockBase, baseUnitsPer,
  APP_VERSION, LOW_STOCK_THRESHOLD, MAX_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION, SESSION_TIMEOUT
};

console.log('✅ Bashan POS Core Loaded — v', APP_VERSION);
