// ============================================
// BASHAAN POS - FIREBASE CONFIG (COMPAT SDK)
// ============================================

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCnPxhTtqx2rqJjNp3Uor_8DkTXXeq9r60",
  authDomain: "mistyyyy-756fc.firebaseapp.com",
  projectId: "mistyyyy-756fc",
  storageBucket: "mistyyyy-756fc.firebasestorage.app",
  messagingSenderId: "440947601221",
  appId: "1:440947601221:web:324823524d00a7adb3182c"
};

// Guard: make sure the compat SDK is loaded first
if (typeof firebase === 'undefined' || !firebase.initializeApp) {
  console.error('❌ Firebase compat SDK not loaded. Add these BEFORE this script:');
  console.error('   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>');
  console.error('   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>');
  throw new Error('Firebase compat SDK missing');
}

// Initialize
const app = firebase.initializeApp(firebaseConfig);
const db  = firebase.firestore();

// Enable offline persistence (non-blocking)
db.enablePersistence({ synchronizeTabs: true })
  .then(() => console.log('✅ Offline persistence enabled'))
  .catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('⚠️ Persistence: multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.warn('⚠️ Persistence not supported in this browser');
    } else {
      console.warn('⚠️ Persistence error:', err.code);
    }
  });

// ============================================
// COLLECTION REFERENCES
// ============================================
const productsRef   = db.collection('products');
const categoriesRef = db.collection('categories');
const salesRef      = db.collection('sales');
const stockLogRef   = db.collection('stockLog');
const settingsRef   = db.collection('settings');
const auditLogRef   = db.collection('auditLog');
const sessionsRef   = db.collection('sessions');

// ============================================
// CORE CONSTANTS
// ============================================
const APP_VERSION          = '1.0.0';
const MAX_LOGIN_ATTEMPTS   = 5;
const LOCKOUT_DURATION     = 15 * 60 * 1000;   // 15 min
const SESSION_TIMEOUT      = 30 * 60 * 1000;   // 30 min
const DEFAULT_NGUNIA_KG    = 1000;
const LOW_STOCK_THRESHOLD  = 100;

// ============================================
// HELPERS
// ============================================
function getIPHash() {
  const data = navigator.userAgent + Date.now();
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function hashPassword(password) {
  let hash = 0;
  const salt = "BASHAN_POS_SALT_2024";
  const combined = password + salt;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  for (let i = 0; i < 1000; i++) {
    hash = ((hash << 5) - hash) + hash % 256;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ============================================
// AUDIT LOGGING
// ============================================
function logAudit(action, details) {
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem('bashan_user')); } catch (e) {}

  auditLogRef.add({
    userId:   user?.id   || 'anonymous',
    userName: user?.name || 'Anonymous',
    role:     user?.role || 'unknown',
    action:   action,
    details:  details,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    ipHash:   getIPHash()
  }).catch(err => console.error('Audit log error:', err));
}

// ============================================
// AUTH FUNCTIONS
// ============================================
async function verifyPassword(inputPassword, role) {
  try {
    const doc = await settingsRef.doc('app').get();

    // First run: create default settings
    if (!doc.exists) {
      await settingsRef.doc('app').set({
        passwordManager: hashPassword('admin123'),
        passwordSeller:  hashPassword('seller123'),
        businessName:    'Bashan Livestock Feeds',
        businessAddress: '',
        businessPhone:   '',
        businessEmail:   '',
        receiptFooter:   'Thank you for your business!',
        nguniaDefault:   DEFAULT_NGUNIA_KG,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        maxDiscount:     5000,
        sessionTimeout:  30,
        maxAttempts:     MAX_LOGIN_ATTEMPTS,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('✅ Default settings created (manager: admin123 / seller: seller123)');
      return verifyPassword(inputPassword, role); // retry
    }

    const settings = doc.data();
    const storedHash = role === 'manager' ? settings.passwordManager : settings.passwordSeller;
    const inputHash  = hashPassword(inputPassword);

    if (inputHash === storedHash) {
      return { success: true, role };
    }
    return { success: false, message: 'Incorrect password' };

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
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// ============================================
// SESSION MANAGEMENT
// ============================================
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

let sessionCheckInterval = null;

function saveSession(userData) {
  const session = {
    ...userData,
    loginTime: Date.now(),
    token: generateToken()
  };
  sessionStorage.setItem('bashan_user', JSON.stringify(session));

  // Poll-based session expiry (works across tabs)
  if (sessionCheckInterval) clearInterval(sessionCheckInterval);
  sessionCheckInterval = setInterval(() => {
    const u = JSON.parse(sessionStorage.getItem('bashan_user') || 'null');
    if (!u) return;
    if (Date.now() - u.loginTime > SESSION_TIMEOUT) {
      logout('Session expired');
    }
  }, 30000);

  // Activity resets timer
  document.addEventListener('click', resetSessionTimer);
  document.addEventListener('keypress', resetSessionTimer);

  return session;
}

function resetSessionTimer() {
  const u = JSON.parse(sessionStorage.getItem('bashan_user') || 'null');
  if (u) {
    u.loginTime = Date.now();
    sessionStorage.setItem('bashan_user', JSON.stringify(u));
  }
}

function checkAuth() {
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem('bashan_user')); } catch (e) {}
  if (!user) return null;
  if (Date.now() - user.loginTime > SESSION_TIMEOUT) {
    logout('Session expired');
    return null;
  }
  return user;
}

function logout(reason) {
  const user = JSON.parse(sessionStorage.getItem('bashan_user') || 'null');
  if (user) logAudit('LOGOUT', reason || 'Manual logout');
  sessionStorage.removeItem('bashan_user');
  sessionStorage.removeItem('bashan_cart');
  window.location.href = 'index.html';
}

// ============================================
// PRODUCT FUNCTIONS
// ============================================
async function getProducts() {
  try {
    const snapshot = await productsRef.where('archived', '==', false).get();
    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
    return products;
  } catch (error) {
    console.error('Get products error:', error);
    return [];
  }
}

function getProductsRealtime(callback) {
  return productsRef.where('archived', '==', false)
    .onSnapshot(snapshot => {
      const products = [];
      snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
      callback(products);
    }, error => {
      
      console.error('Products realtime error:', error);
      callback([]);
    });
}

async function updateStock(productId, newStockValue, reason, notes, userName, userId, uom) {
  try {
    const productDoc = await productsRef.doc(productId).get();
    if (!productDoc.exists) return { success: false, message: 'Product not found' };

    const productData = productDoc.data();
    const productUom  = uom || productData.uom || 'kg';

    let oldStock = 0;
    const newStock = newStockValue;
    const updateData = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    let quantityChanged = 0;
    let quantityUnit = '';
    let logData = {};

    switch (productUom) {
      case 'kg':
        oldStock = productData.currentStockKg || 0;
        updateData.currentStockKg = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'kg';
        logData = {
          quantityKg: Math.abs(quantityChanged),
          quantityNgunia: Math.abs(quantityChanged) / (productData.nguniaKg || DEFAULT_NGUNIA_KG),
          beforeStock: oldStock, afterStock: newStock
        };
        break;

      case 'bags': {
        oldStock = productData.currentStockCount || 0;
        updateData.currentStockCount = newStock;
        const kgPerBag = productData.kgPerBag || 50;
        updateData.currentStockKg = newStock * kgPerBag;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'bags';
        logData = {
          quantityBags: Math.abs(quantityChanged),
          quantityKg: Math.abs(quantityChanged) * kgPerBag,
          beforeStock: oldStock, afterStock: newStock
        };
        break;
      }

      case 'litres':
        oldStock = productData.currentStockLitres || 0;
        updateData.currentStockLitres = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'litres';
        logData = { quantityLitres: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
        break;

      case 'ml':
        oldStock = productData.currentStockMl || 0;
        updateData.currentStockMl = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'mL';
        logData = { quantityMl: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
        break;

      case 'pieces':
        oldStock = productData.currentStockCount || 0;
        updateData.currentStockCount = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'pieces';
        logData = { quantityPieces: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
        break;

      case 'grams':
        oldStock = productData.currentStockGrams || 0;
        updateData.currentStockGrams = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'grams';
        logData = { quantityGrams: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
        break;

      case 'sachets':
        oldStock = productData.currentStockCount || 0;
        updateData.currentStockCount = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'sachets';
        logData = { quantitySachets: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
        break;

      case 'cartons': {
        oldStock = productData.currentStockCount || 0;
        updateData.currentStockCount = newStock;
        const itemsPerCarton = productData.itemsPerCarton || 12;
        updateData.currentStockPieces = newStock * itemsPerCarton;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'cartons';
        logData = {
          quantityCartons: Math.abs(quantityChanged),
          quantityPieces: Math.abs(quantityChanged) * itemsPerCarton,
          beforeStock: oldStock, afterStock: newStock
        };
        break;
      }

      case 'rolls':
        oldStock = productData.currentStockCount || 0;
        updateData.currentStockCount = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'rolls';
        logData = { quantityRolls: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
        break;

      case 'metres':
        oldStock = productData.currentStockMetres || 0;
        updateData.currentStockMetres = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'metres';
        logData = { quantityMetres: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
        break;

      default:
        oldStock = productData.currentStockKg || 0;
        updateData.currentStockKg = newStock;
        quantityChanged = newStock - oldStock;
        quantityUnit = 'kg';
        logData = { quantityKg: Math.abs(quantityChanged), beforeStock: oldStock, afterStock: newStock };
    }

    await productsRef.doc(productId).update(updateData);

    await stockLogRef.add({
      productId, productName: productData.name, uom: productUom,
      type: quantityChanged > 0 ? 'add' : 'remove',
      reason, notes: notes || '',
      doneBy: userId, doneByName: userName,
      ...logData,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    logAudit('STOCK_UPDATE',
      `${productData.name} (${productUom}): ${oldStock} → ${newStock} ${quantityUnit} (${reason})`);

    return { success: true };

  } catch (error) {
    console.error('Stock update error:', error);
    return { success: false, message: error.message };
  }
}

// ============================================
// SALE FUNCTIONS
// ============================================
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

    saleData.items.forEach(item => {
      const productRef = productsRef.doc(item.productId);
      const uom = item.uom || 'kg';
      const qty = item.qty || 0;
      const sellMode = item.sellMode || 'unit';

      switch (uom) {
        case 'kg':
          if (sellMode === 'kg') {
            batch.update(productRef, { currentStockKg: firebase.firestore.FieldValue.increment(-qty) });
          } else {
            batch.update(productRef, {
              currentStockKg: firebase.firestore.FieldValue.increment(
                -(item.qtyKg || qty * (item.nguniaSize || DEFAULT_NGUNIA_KG)))
            });
          }
          break;

        case 'bags': {
          const kgPerBag = item.kgPerBag || 50;
          if (sellMode === 'kg') {
            batch.update(productRef, {
              currentStockKg:    firebase.firestore.FieldValue.increment(-qty),
              currentStockCount: firebase.firestore.FieldValue.increment(-(qty / kgPerBag))
            });
          } else {
            batch.update(productRef, {
              currentStockCount: firebase.firestore.FieldValue.increment(-qty),
              currentStockKg:    firebase.firestore.FieldValue.increment(-(qty * kgPerBag))
            });
          }
          break;
        }

        case 'litres':
          batch.update(productRef, { currentStockLitres: firebase.firestore.FieldValue.increment(-qty) });
          break;
        case 'ml':
          batch.update(productRef, { currentStockMl: firebase.firestore.FieldValue.increment(-qty) });
          break;
        case 'pieces':
        case 'sachets':
        case 'rolls':
          batch.update(productRef, { currentStockCount: firebase.firestore.FieldValue.increment(-qty) });
          break;
        case 'grams':
          batch.update(productRef, { currentStockGrams: firebase.firestore.FieldValue.increment(-qty) });
          break;
        case 'cartons': {
          const itemsPerCarton = item.itemsPerCarton || 12;
          batch.update(productRef, {
            currentStockCount:  firebase.firestore.FieldValue.increment(-qty),
            currentStockPieces: firebase.firestore.FieldValue.increment(-(qty * itemsPerCarton))
          });
          break;
        }
        case 'metres':
          batch.update(productRef, { currentStockMetres: firebase.firestore.FieldValue.increment(-qty) });
          break;
        default:
          batch.update(productRef, {
            currentStockKg: firebase.firestore.FieldValue.increment(-(item.qtyKg || qty))
          });
      }
    });

    await batch.commit();
    logAudit('SALE_COMPLETE', `Sale ${receiptNumber}: KSH ${saleData.total} (${saleData.items.length} items)`);
    return { success: true, receiptNumber, saleId: saleRef.id };

  } catch (error) {
    console.error('Sale error:', error);
    return { success: false, message: error.message };
  }
}

// ============================================
// SETTINGS
// ============================================
async function getSettings() {
  try {
    const doc = await settingsRef.doc('app').get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error('Settings error:', error);
    return null;
  }
}

// ============================================
// UTILITIES
// ============================================
function formatCurrency(amount) {
  const num = Number(amount);
  if (isNaN(num)) return 'KSH 0.00';
  return 'KSH ' + num.toLocaleString('en-KE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function formatStock(kg, nguniaSize) {
  const size = nguniaSize || DEFAULT_NGUNIA_KG;
  const stockKg = Number(kg) || 0;
  if (stockKg <= 0) return '0 kg (Out of Stock)';
  const ngunias   = Math.floor(stockKg / size);
  const remainder = stockKg % size;
  if (ngunias === 0)      return `${remainder.toFixed(2)} kg`;
  if (remainder === 0)    return `${ngunias} ngunia${ngunias > 1 ? 's' : ''} (${stockKg} kg)`;
  return `${ngunias} ngunia${ngunias > 1 ? 's' : ''} + ${remainder.toFixed(2)} kg`;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-KE', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function showNotification(message, type) {
  const n = document.createElement('div');
  n.className = 'notification notification-' + (type || 'info');
  n.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()">×</button>`;
  document.body.appendChild(n);
  setTimeout(() => {
    n.classList.add('fade-out');
    setTimeout(() => n.remove(), 300);
  }, 4000);
}

function showConfirm(message) {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'confirm-modal';
    modal.innerHTML = `
      <div class="confirm-content">
        <p>${message}</p>
        <div class="confirm-buttons">
          <button class="btn-cancel" id="confirmCancel">Cancel</button>
          <button class="btn-confirm" id="confirmOk">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('confirmCancel').onclick = () => { modal.remove(); resolve(false); };
    document.getElementById('confirmOk').onclick     = () => { modal.remove(); resolve(true);  };
  });
}

// ============================================
// EXPORT TO WINDOW
// ============================================
window.BashanPOS = {
  db,
  productsRef, categoriesRef, salesRef, stockLogRef, settingsRef, auditLogRef, sessionsRef,
  verifyPassword, updatePassword, checkAuth, logout, saveSession,
  getProducts, getProductsRealtime, updateStock, completeSale,
  getSettings, logAudit,
  formatCurrency, formatStock, formatDate,
  showNotification, showConfirm,
  hashPassword,
  APP_VERSION, DEFAULT_NGUNIA_KG, MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION, SESSION_TIMEOUT
};

console.log('✅ Bashan POS Core Loaded - Version', APP_VERSION);
