// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCnPxhTtqx2rqJjNp3Uor_8DkTXXeq9r60",
  authDomain: "mistyyyy-756fc.firebaseapp.com",
  projectId: "mistyyyy-756fc",
  storageBucket: "mistyyyy-756fc.firebasestorage.app",
  messagingSenderId: "440947601221",
  appId: "1:440947601221:web:324823524d00a7adb3182c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Enable offline persistence
db.enablePersistence()
    .then(() => console.log('✅ Offline mode enabled'))
    .catch(err => console.log('⚠️ Persistence error:', err.code));

// ============================================
// COLLECTION REFERENCES
// ============================================
const productsRef = db.collection('products');
const categoriesRef = db.collection('categories');
const salesRef = db.collection('sales');
const stockLogRef = db.collection('stockLog');
const settingsRef = db.collection('settings');
const auditLogRef = db.collection('auditLog');
const sessionsRef = db.collection('sessions');

// ============================================
// CORE CONSTANTS
// ============================================
const APP_VERSION = '1.0.0';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;
const SESSION_TIMEOUT = 30 * 60 * 1000;
const DEFAULT_NGUNIA_KG = 1000;
const LOW_STOCK_THRESHOLD = 100;

// ============================================
// AUDIT LOGGING
// ============================================
function logAudit(action, details) {
    const user = JSON.parse(sessionStorage.getItem('bashan_user'));
    if (!user) return;
    
    auditLogRef.add({
        userId: user.id,
        userName: user.name,
        role: user.role,
        action: action,
        details: details,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        ipHash: getIPHash()
    }).catch(err => console.error('Audit log error:', err));
}

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

// ============================================
// AUTH FUNCTIONS
// ============================================
function verifyPassword(inputPassword, role) {
    return settingsRef.doc('app').get().then(doc => {
        if (!doc.exists) {
            return settingsRef.doc('app').set({
                passwordManager: hashPassword('admin123'),
                passwordSeller: hashPassword('seller123'),
                businessName: 'Bashan Livestock Feeds',
                businessAddress: '',
                businessPhone: '',
                businessEmail: '',
                receiptFooter: 'Thank you for your business!',
                nguniaDefault: 1000,
                lowStockThreshold: 100,
                maxDiscount: 5000,
                sessionTimeout: 30,
                maxAttempts: 5,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
                logAudit('SYSTEM_INIT', 'Default settings created');
                return verifyPassword(inputPassword, role);
            });
        }
        
        const settings = doc.data();
        const storedHash = role === 'manager' ? settings.passwordManager : settings.passwordSeller;
        const inputHash = hashPassword(inputPassword);
        
        if (inputHash === storedHash) {
            return { success: true, role: role };
        }
        return { success: false, message: 'Incorrect password' };
    }).catch(error => {
        console.error('Auth error:', error);
        return { success: false, message: 'Authentication failed. Check connection.' };
    });
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

function updatePassword(newPassword, role) {
    const field = role === 'manager' ? 'passwordManager' : 'passwordSeller';
    return settingsRef.doc('app').update({
        [field]: hashPassword(newPassword)
    }).then(() => {
        logAudit('PASSWORD_CHANGE', `Password changed for ${role}`);
        return { success: true };
    }).catch(error => {
        return { success: false, message: error.message };
    });
}

// ============================================
// SESSION MANAGEMENT
// ============================================
function saveSession(userData) {
    const session = {
        ...userData,
        loginTime: Date.now(),
        token: generateToken()
    };
    sessionStorage.setItem('bashan_user', JSON.stringify(session));
    
    setTimeout(checkSession, SESSION_TIMEOUT);
    document.addEventListener('click', resetSessionTimer);
    document.addEventListener('keypress', resetSessionTimer);
    
    return session;
}

function generateToken() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function checkSession() {
    const user = JSON.parse(sessionStorage.getItem('bashan_user'));
    if (!user) return;
    
    if (Date.now() - user.loginTime > SESSION_TIMEOUT) {
        logout('Session expired');
    }
}

function resetSessionTimer() {
    const user = JSON.parse(sessionStorage.getItem('bashan_user'));
    if (user) {
        user.loginTime = Date.now();
        sessionStorage.setItem('bashan_user', JSON.stringify(user));
    }
}

function logout(reason) {
    const user = JSON.parse(sessionStorage.getItem('bashan_user'));
    if (user) {
        logAudit('LOGOUT', reason || 'Manual logout');
    }
    sessionStorage.removeItem('bashan_user');
    sessionStorage.removeItem('bashan_cart');
    window.location.href = 'index.html';
}

function checkAuth() {
    const user = JSON.parse(sessionStorage.getItem('bashan_user'));
    if (!user) {
        window.location.href = 'index.html';
        return null;
    }
    if (Date.now() - user.loginTime > SESSION_TIMEOUT) {
        logout('Session expired');
        return null;
    }
    return user;
}

// ============================================
// PRODUCT FUNCTIONS
// ============================================
function getProducts() {
    return productsRef.where('archived', '==', false).get()
        .then(snapshot => {
            const products = [];
            snapshot.forEach(doc => {
                products.push({ id: doc.id, ...doc.data() });
            });
            return products;
        })
        .catch(error => {
            console.error('Get products error:', error);
            return [];
        });
}

function getProductsRealtime(callback) {
    return productsRef.where('archived', '==', false)
        .onSnapshot(snapshot => {
            const products = [];
            snapshot.forEach(doc => {
                products.push({ id: doc.id, ...doc.data() });
            });
            callback(products);
        }, error => {
            console.error('Products realtime error:', error);
            callback([]);
        });
}

function updateStock(productId, newStockValue, reason, notes, userName, userId, uom) {
    return productsRef.doc(productId).get()
        .then(productDoc => {
            if (!productDoc.exists) {
                return { success: false, message: 'Product not found' };
            }
            
            const productData = productDoc.data();
            const productUom = uom || productData.uom || 'kg';
            let oldStock = 0;
            let newStock = newStockValue;
            let updateData = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            let quantityChanged = 0;
            let quantityUnit = '';
            let logData = {};
            
            switch(productUom) {
                case 'kg':
                    oldStock = productData.currentStockKg || 0;
                    updateData.currentStockKg = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'kg';
                    logData = {
                        quantityKg: Math.abs(quantityChanged),
                        quantityNgunia: Math.abs(quantityChanged) / (productData.nguniaKg || DEFAULT_NGUNIA_KG),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'bags':
                    oldStock = productData.currentStockCount || 0;
                    updateData.currentStockCount = newStock;
                    const kgPerBag = productData.kgPerBag || 50;
                    updateData.currentStockKg = newStock * kgPerBag;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'bags';
                    logData = {
                        quantityBags: Math.abs(quantityChanged),
                        quantityKg: Math.abs(quantityChanged) * kgPerBag,
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'litres':
                    oldStock = productData.currentStockLitres || 0;
                    updateData.currentStockLitres = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'litres';
                    logData = {
                        quantityLitres: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'ml':
                    oldStock = productData.currentStockMl || 0;
                    updateData.currentStockMl = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'mL';
                    logData = {
                        quantityMl: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'pieces':
                    oldStock = productData.currentStockCount || 0;
                    updateData.currentStockCount = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'pieces';
                    logData = {
                        quantityPieces: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'grams':
                    oldStock = productData.currentStockGrams || 0;
                    updateData.currentStockGrams = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'grams';
                    logData = {
                        quantityGrams: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'sachets':
                    oldStock = productData.currentStockCount || 0;
                    updateData.currentStockCount = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'sachets';
                    logData = {
                        quantitySachets: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'cartons':
                    oldStock = productData.currentStockCount || 0;
                    updateData.currentStockCount = newStock;
                    const itemsPerCarton = productData.itemsPerCarton || 12;
                    updateData.currentStockPieces = newStock * itemsPerCarton;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'cartons';
                    logData = {
                        quantityCartons: Math.abs(quantityChanged),
                        quantityPieces: Math.abs(quantityChanged) * itemsPerCarton,
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'rolls':
                    oldStock = productData.currentStockCount || 0;
                    updateData.currentStockCount = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'rolls';
                    logData = {
                        quantityRolls: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                case 'metres':
                    oldStock = productData.currentStockMetres || 0;
                    updateData.currentStockMetres = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'metres';
                    logData = {
                        quantityMetres: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
                    break;
                    
                default:
                    oldStock = productData.currentStockKg || 0;
                    updateData.currentStockKg = newStock;
                    quantityChanged = newStock - oldStock;
                    quantityUnit = 'kg';
                    logData = {
                        quantityKg: Math.abs(quantityChanged),
                        beforeStock: oldStock,
                        afterStock: newStock
                    };
            }
            
            return productsRef.doc(productId).update(updateData).then(() => {
                return stockLogRef.add({
                    productId: productId,
                    productName: productData.name,
                    uom: productUom,
                    type: quantityChanged > 0 ? 'add' : 'remove',
                    reason: reason,
                    notes: notes || '',
                    doneBy: userId,
                    doneByName: userName,
                    ...logData,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                }).then(() => {
                    logAudit('STOCK_UPDATE', 
                        `${productData.name} (${productUom}): ${oldStock} → ${newStock} ${quantityUnit} (${reason})`
                    );
                    return { success: true };
                });
            });
        })
        .catch(error => {
            console.error('Stock update error:', error);
            return { success: false, message: error.message };
        });
}

// ============================================
// SALE FUNCTIONS
// ============================================
function completeSale(saleData) {
    const batch = db.batch();
    const saleRef = salesRef.doc();
    
    // Generate receipt number
    const date = new Date();
    const receiptNumber = 'BSH-' + date.getFullYear() + 
                          String(date.getMonth() + 1).padStart(2, '0') +
                          String(date.getDate()).padStart(2, '0') + '-' +
                          String(Math.floor(Math.random() * 9999)).padStart(4, '0');
    
    const sale = {
        receiptNumber: receiptNumber,
        items: saleData.items,
        subtotal: saleData.subtotal,
        discountKsh: saleData.discountKsh || 0,
        total: saleData.total,
        paymentMethod: saleData.paymentMethod || 'Cash',
        customerName: saleData.customerName || '',
        sellerId: saleData.sellerId,
        sellerName: saleData.sellerName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    batch.set(saleRef, sale);
    
    // Deduct stock for each item based on UOM and sellMode
    saleData.items.forEach(item => {
        const productRef = productsRef.doc(item.productId);
        const uom = item.uom || 'kg';
        const qty = item.qty || 0;
        const sellMode = item.sellMode || 'unit';
        
        console.log('🔻 Deducting stock:', item.name, 'UOM:', uom, 'Mode:', sellMode, 'Qty:', qty);
        
        switch(uom) {
            case 'kg':
                // For kg products: qty is in ngunias, qtyKg is actual kg
                if (sellMode === 'kg') {
                    // Selling directly by kg
                    batch.update(productRef, {
                        currentStockKg: firebase.firestore.FieldValue.increment(-qty)
                    });
                } else {
                    // Selling by ngunias - deduct kg equivalent
                    batch.update(productRef, {
                        currentStockKg: firebase.firestore.FieldValue.increment(-(item.qtyKg || qty * (item.nguniaSize || 1000)))
                    });
                }
                break;
                
            case 'bags':
                if (sellMode === 'kg') {
                    // Selling bags by kg - deduct from currentStockKg AND recalculate bag count
                    const kgPerBag = item.kgPerBag || 50;
                    const kgToDeduct = qty;
                    const bagsToDeduct = kgToDeduct / kgPerBag;
                    
                    batch.update(productRef, {
                        currentStockKg: firebase.firestore.FieldValue.increment(-kgToDeduct),
                        currentStockCount: firebase.firestore.FieldValue.increment(-bagsToDeduct)
                    });
                    console.log('🔻 Bags kg mode: deducting', kgToDeduct, 'kg and', bagsToDeduct, 'bags');
                } else {
                    // Selling by bags - deduct bag count and kg equivalent
                    const kgPerBag = item.kgPerBag || 50;
                    batch.update(productRef, {
                        currentStockCount: firebase.firestore.FieldValue.increment(-qty),
                        currentStockKg: firebase.firestore.FieldValue.increment(-(qty * kgPerBag))
                    });
                    console.log('🔻 Bags unit mode: deducting', qty, 'bags and', qty * kgPerBag, 'kg');
                }
                break;
                
            case 'litres':
                batch.update(productRef, {
                    currentStockLitres: firebase.firestore.FieldValue.increment(-qty)
                });
                break;
                
            case 'ml':
                batch.update(productRef, {
                    currentStockMl: firebase.firestore.FieldValue.increment(-qty)
                });
                break;
                
            case 'pieces':
                batch.update(productRef, {
                    currentStockCount: firebase.firestore.FieldValue.increment(-qty)
                });
                break;
                
            case 'grams':
                batch.update(productRef, {
                    currentStockGrams: firebase.firestore.FieldValue.increment(-qty)
                });
                break;
                
            case 'sachets':
                batch.update(productRef, {
                    currentStockCount: firebase.firestore.FieldValue.increment(-qty)
                });
                break;
                
            case 'cartons':
                const itemsPerCarton = item.itemsPerCarton || 12;
                batch.update(productRef, {
                    currentStockCount: firebase.firestore.FieldValue.increment(-qty),
                    currentStockPieces: firebase.firestore.FieldValue.increment(-(qty * itemsPerCarton))
                });
                break;
                
            case 'rolls':
                batch.update(productRef, {
                    currentStockCount: firebase.firestore.FieldValue.increment(-qty)
                });
                break;
                
            case 'metres':
                batch.update(productRef, {
                    currentStockMetres: firebase.firestore.FieldValue.increment(-qty)
                });
                break;
                
            default:
                // Fallback to kg
                batch.update(productRef, {
                    currentStockKg: firebase.firestore.FieldValue.increment(-(item.qtyKg || qty))
                });
        }
    });
    
    return batch.commit()
        .then(() => {
            logAudit('SALE_COMPLETE', 'Sale ' + receiptNumber + ': KSH ' + saleData.total + ' (' + saleData.items.length + ' items)');
            return { success: true, receiptNumber, saleId: saleRef.id };
        })
        .catch(error => {
            console.error('Sale error:', error);
            return { success: false, message: error.message };
        });
}
// ============================================
// SETTINGS FUNCTIONS
// ============================================
function getSettings() {
    return settingsRef.doc('app').get()
        .then(doc => {
            if (doc.exists) {
                return doc.data();
            }
            return null;
        })
        .catch(error => {
            console.error('Settings error:', error);
            return null;
        });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function formatCurrency(amount) {
    const num = Number(amount);
    if (isNaN(num)) return 'KSH 0.00';
    return 'KSH ' + num.toLocaleString('en-KE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatStock(kg, nguniaSize) {
    const size = nguniaSize || DEFAULT_NGUNIA_KG;
    const stockKg = Number(kg) || 0;
    
    if (stockKg <= 0) return '0 kg (Out of Stock)';
    
    const ngunias = Math.floor(stockKg / size);
    const remainder = stockKg % size;
    
    if (ngunias === 0) {
        return `${remainder.toFixed(2)} kg`;
    } else if (remainder === 0) {
        return `${ngunias} ngunia${ngunias > 1 ? 's' : ''} (${stockKg} kg)`;
    } else {
        return `${ngunias} ngunia${ngunias > 1 ? 's' : ''} + ${remainder.toFixed(2)} kg`;
    }
}

function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = 'notification notification-' + (type || 'info');
    notification.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()">×</button>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'confirm-modal';
        modal.innerHTML = `
            <div class="confirm-content">
                <p>${message}</p>
                <div class="confirm-buttons">
                    <button class="btn-cancel" id="confirmCancel">Cancel</button>
                    <button class="btn-confirm" id="confirmOk">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        document.getElementById('confirmCancel').onclick = () => {
            modal.remove();
            resolve(false);
        };
        document.getElementById('confirmOk').onclick = () => {
            modal.remove();
            resolve(true);
        };
    });
}

// ============================================
// EXPORT FOR OTHER SCRIPTS
// ============================================
window.BashanPOS = {
    db,
    productsRef, categoriesRef, salesRef, stockLogRef, settingsRef, auditLogRef,
    verifyPassword, updatePassword, checkAuth, logout, saveSession,
    getProducts, getProductsRealtime, updateStock, completeSale,
    getSettings, logAudit,
    formatCurrency, formatStock, formatDate,
    showNotification, showConfirm,
    APP_VERSION, DEFAULT_NGUNIA_KG
};

console.log('✅ Bashan POS Core Loaded - Version', APP_VERSION);
