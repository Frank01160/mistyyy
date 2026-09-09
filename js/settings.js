// ============================================
// BASHAAN POS - SETTINGS ENGINE (FIXED)
// ============================================

class SettingsSystem {
    constructor() {
        this.user = null;
        this.settings = null;
        this.categories = [];
        this.ready = false;
        
        // Wait for everything to be ready
        this.waitForReady();
    }
    
    async waitForReady() {
        // Wait for BashanPOS
        if (typeof window.BashanPOS === 'undefined') {
            console.log('⏳ Waiting for BashanPOS...');
            setTimeout(() => this.waitForReady(), 300);
            return;
        }
        
        // Check auth
        this.user = BashanPOS.checkAuth();
        if (!this.user) {
            console.log('⏳ Waiting for auth...');
            setTimeout(() => this.waitForReady(), 300);
            return;
        }
        
        // Only managers
        if (this.user.role !== 'manager') {
            alert('Only managers can access settings');
            window.location.href = 'pos.html';
            return;
        }
        
        console.log('✅ User authenticated:', this.user);
        
        // Load settings
        this.settings = await BashanPOS.getSettings();
        console.log('✅ Settings loaded:', this.settings);
        
        // Setup everything
        this.setupUI();
        this.bindEvents();
        this.loadSettingsToForm();
        await this.loadCategories();
        
        this.ready = true;
        console.log('✅ Settings System Ready');
    }
    
    setupUI() {
        const userBadge = document.getElementById('userBadge');
        if (userBadge) {
            userBadge.textContent = `${this.user.role}: ${this.user.name}`;
        }
    }
    
    // ============ BIND ALL EVENTS ============
    bindEvents() {
        console.log('🔗 Binding events...');
        
        // Navigation tabs
        document.querySelectorAll('.settings-nav-btn').forEach(btn => {
            btn.onclick = () => {
                console.log('📂 Tab clicked:', btn.dataset.tab);
                // Remove active from all
                document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
                // Activate clicked
                btn.classList.add('active');
                const panel = document.getElementById('panel-' + btn.dataset.tab);
                if (panel) panel.classList.add('active');
            };
        });
        
        // Business Info Save
        this.bindClick('saveBusinessBtn', () => this.saveBusinessInfo());
        
        // Categories
        this.bindClick('addCategoryBtn', () => this.addCategory());
        const catInput = document.getElementById('newCategoryName');
        if (catInput) {
            catInput.onkeypress = (e) => {
                if (e.key === 'Enter') this.addCategory();
            };
        }
        
        // Security
        this.bindClick('updateManagerPassBtn', () => this.updateManagerPassword());
        this.bindClick('updateSellerPassBtn', () => this.updateSellerPassword());
        this.bindClick('saveSessionBtn', () => this.saveSessionSettings());
        
        // Preferences
        this.bindClick('savePreferencesBtn', () => this.savePreferences());
        
        // Data
        this.bindClick('exportDataBtn', () => this.exportAllData());
        this.bindClick('importDataBtn', () => {
            const fileInput = document.getElementById('importFile');
            if (fileInput) fileInput.click();
        });
        const importFile = document.getElementById('importFile');
        if (importFile) {
            importFile.onchange = (e) => this.importData(e);
        }
        
        // Danger zone
        this.bindClick('clearSalesBtn', () => this.clearOldSales());
        this.bindClick('resetStockBtn', () => this.resetAllStock());
        this.bindClick('deleteAllBtn', () => this.deleteAllData());
        
        // Logout
        this.bindClick('logoutBtn', () => {
            console.log('🚪 Logout clicked');
            BashanPOS.logout();
        });
        
        console.log('✅ Events bound');
    }
    
    bindClick(id, handler) {
        const el = document.getElementById(id);
        if (el) {
            el.onclick = handler;
            console.log('  ✓ Bound:', id);
        } else {
            console.warn('  ⚠️ Element not found:', id);
        }
    }
    
    // ============ LOAD SETTINGS TO FORM ============
    loadSettingsToForm() {
        if (!this.settings) return;
        
        const fields = {
            'businessName': this.settings.businessName || '',
            'businessAddress': this.settings.businessAddress || '',
            'businessPhone': this.settings.businessPhone || '',
            'businessEmail': this.settings.businessEmail || '',
            'receiptFooter': this.settings.receiptFooter || '',
            'defaultNguniaSize': this.settings.nguniaDefault || 1000,
            'lowStockThreshold': this.settings.lowStockThreshold || 100,
            'maxDiscount': this.settings.maxDiscount || 5000,
            'sessionTimeout': this.settings.sessionTimeout || 30,
            'maxAttempts': this.settings.maxAttempts || 5
        };
        
        for (const [id, value] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el) el.value = value;
        }
        
        console.log('✅ Form populated');
    }
    
    // ============ NOTIFICATION HELPER ============
    notify(msg, type = 'info') {
        console.log(`🔔 [${type}] ${msg}`);
        
        // Try BashanPOS notification first
        if (window.BashanPOS && typeof BashanPOS.showNotification === 'function') {
            BashanPOS.showNotification(msg, type);
        } else {
            // Fallback alert
            alert(msg);
        }
    }
    
    async confirm(msg) {
        if (window.BashanPOS && typeof BashanPOS.showConfirm === 'function') {
            return await BashanPOS.showConfirm(msg);
        } else {
            return confirm(msg);
        }
    }
    
    // ============ SAVE FUNCTIONS ============
    async saveBusinessInfo() {
        console.log('💾 Saving business info...');
        
        const data = {
            businessName: document.getElementById('businessName')?.value?.trim() || '',
            businessAddress: document.getElementById('businessAddress')?.value?.trim() || '',
            businessPhone: document.getElementById('businessPhone')?.value?.trim() || '',
            businessEmail: document.getElementById('businessEmail')?.value?.trim() || '',
            receiptFooter: document.getElementById('receiptFooter')?.value?.trim() || ''
        };
        
        try {
            await BashanPOS.settingsRef.doc('app').update(data);
            this.settings = { ...this.settings, ...data };
            this.notify('Business info saved!', 'success');
        } catch (error) {
            console.error('Save error:', error);
            this.notify('Failed to save: ' + error.message, 'error');
        }
    }
    
    // ============ CATEGORIES ============
    async loadCategories() {
        try {
            const snapshot = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
            this.categories = [];
            snapshot.forEach(doc => {
                this.categories.push({ id: doc.id, ...doc.data() });
            });
            this.renderCategories();
            console.log('✅ Categories:', this.categories.length);
        } catch (error) {
            console.error('Categories error:', error);
            const list = document.getElementById('categoriesList');
            if (list) list.innerHTML = '<p style="color:red;">Failed to load categories</p>';
        }
    }
    
    renderCategories() {
        const list = document.getElementById('categoriesList');
        if (!list) return;
        
        if (this.categories.length === 0) {
            list.innerHTML = '<p class="empty-message">No categories yet. Add one above.</p>';
            return;
        }
        
        list.innerHTML = this.categories.map((cat, i) => `
            <div class="category-item" data-id="${cat.id}">
                <span class="category-name">${i + 1}. ${cat.name}</span>
                <div class="category-actions">
                    <button class="edit-cat-btn" data-id="${cat.id}">✏️ Edit</button>
                    <button class="delete-cat-btn" data-id="${cat.id}">🗑️</button>
                </div>
            </div>
        `).join('');
        
        // Bind category action buttons
        list.querySelectorAll('.edit-cat-btn').forEach(btn => {
            btn.onclick = () => this.editCategory(btn.dataset.id);
        });
        list.querySelectorAll('.delete-cat-btn').forEach(btn => {
            btn.onclick = () => this.deleteCategory(btn.dataset.id);
        });
    }
    
    async addCategory() {
        const input = document.getElementById('newCategoryName');
        if (!input) return;
        
        const name = input.value.trim();
        if (!name) {
            this.notify('Enter a category name', 'warning');
            input.focus();
            return;
        }
        
        if (this.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
            this.notify('Category already exists!', 'warning');
            return;
        }
        
        try {
            await BashanPOS.categoriesRef.add({
                name: name,
                displayOrder: this.categories.length,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            input.value = '';
            this.notify(`"${name}" added!`, 'success');
            await this.loadCategories();
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
    
    async editCategory(id) {
        const cat = this.categories.find(c => c.id === id);
        if (!cat) return;
        
        const newName = prompt('Edit category name:', cat.name);
        if (!newName || newName.trim() === '' || newName.trim() === cat.name) return;
        
        try {
            await BashanPOS.categoriesRef.doc(id).update({ name: newName.trim() });
            this.notify('Category updated!', 'success');
            await this.loadCategories();
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
    
    async deleteCategory(id) {
        const cat = this.categories.find(c => c.id === id);
        if (!cat) return;
        
        const confirmed = await this.confirm(`Delete "${cat.name}"?`);
        if (!confirmed) return;
        
        try {
            await BashanPOS.categoriesRef.doc(id).delete();
            this.notify('Category deleted!', 'success');
            await this.loadCategories();
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
    
    // ============ SECURITY ============
    async updateManagerPassword() {
        const current = document.getElementById('managerCurrentPass')?.value || '';
        const newPass = document.getElementById('managerNewPass')?.value || '';
        const confirm = document.getElementById('managerConfirmPass')?.value || '';
        
        if (!current || !newPass || !confirm) {
            this.notify('All fields required', 'warning');
            return;
        }
        if (newPass !== confirm) {
            this.notify('Passwords do not match', 'warning');
            return;
        }
        if (newPass.length < 4) {
            this.notify('Min 4 characters', 'warning');
            return;
        }
        
        const verify = await BashanPOS.verifyPassword(current, 'manager');
        if (!verify.success) {
            this.notify('Wrong current password', 'error');
            return;
        }
        
        const result = await BashanPOS.updatePassword(newPass, 'manager');
        if (result.success) {
            this.notify('Password updated!', 'success');
            ['managerCurrentPass', 'managerNewPass', 'managerConfirmPass'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        } else {
            this.notify('Failed: ' + result.message, 'error');
        }
    }
    
    async updateSellerPassword() {
        const authPass = document.getElementById('sellerAuthPass')?.value || '';
        const newPass = document.getElementById('sellerNewPass')?.value || '';
        
        if (!authPass || !newPass) {
            this.notify('All fields required', 'warning');
            return;
        }
        if (newPass.length < 4) {
            this.notify('Min 4 characters', 'warning');
            return;
        }
        
        const verify = await BashanPOS.verifyPassword(authPass, 'manager');
        if (!verify.success) {
            this.notify('Wrong manager password', 'error');
            return;
        }
        
        const result = await BashanPOS.updatePassword(newPass, 'seller');
        if (result.success) {
            this.notify('Seller password updated!', 'success');
            ['sellerAuthPass', 'sellerNewPass'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        } else {
            this.notify('Failed: ' + result.message, 'error');
        }
    }
    
    async saveSessionSettings() {
        const timeout = parseInt(document.getElementById('sessionTimeout')?.value) || 30;
        const maxAttempts = parseInt(document.getElementById('maxAttempts')?.value) || 5;
        
        try {
            await BashanPOS.settingsRef.doc('app').update({ sessionTimeout: timeout, maxAttempts });
            this.notify('Session settings saved!', 'success');
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
    
    // ============ PREFERENCES ============
    async savePreferences() {
        const nguniaDefault = parseInt(document.getElementById('defaultNguniaSize')?.value) || 1000;
        const lowStockThreshold = parseInt(document.getElementById('lowStockThreshold')?.value) || 100;
        const maxDiscount = parseInt(document.getElementById('maxDiscount')?.value) || 5000;
        
        try {
            await BashanPOS.settingsRef.doc('app').update({ nguniaDefault, lowStockThreshold, maxDiscount });
            this.notify('Preferences saved!', 'success');
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
    
    // ============ DATA MANAGEMENT ============
    async exportAllData() {
        this.notify('Exporting...', 'info');
        
        try {
            const data = { exportDate: new Date().toISOString(), version: BashanPOS.APP_VERSION };
            
            const [products, categories, sales, stockLog] = await Promise.all([
                BashanPOS.productsRef.get(),
                BashanPOS.categoriesRef.get(),
                BashanPOS.salesRef.orderBy('timestamp', 'desc').limit(1000).get(),
                BashanPOS.stockLogRef.orderBy('timestamp', 'desc').limit(500).get()
            ]);
            
            data.products = []; products.forEach(d => data.products.push({ id: d.id, ...d.data() }));
            data.categories = []; categories.forEach(d => data.categories.push({ id: d.id, ...d.data() }));
            data.sales = []; sales.forEach(d => { const s = d.data(); s.timestamp = s.timestamp?.toDate?.()?.toISOString() || null; data.sales.push({ id: d.id, ...s }); });
            data.stockLog = []; stockLog.forEach(d => { const l = d.data(); l.timestamp = l.timestamp?.toDate?.()?.toISOString() || null; data.stockLog.push({ id: d.id, ...l }); });
            
            // Remove passwords from settings
            const safeSettings = { ...this.settings };
            delete safeSettings.passwordManager;
            delete safeSettings.passwordSeller;
            data.settings = safeSettings;
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bashan_backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            this.notify('Export complete!', 'success');
        } catch (error) {
            this.notify('Export failed: ' + error.message, 'error');
        }
    }
    
    async importData(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const confirmed = await this.confirm('Import data? This will merge with existing data.');
        if (!confirmed) { event.target.value = ''; return; }
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const batch = BashanPOS.db.batch();
            let count = 0;
            
            if (data.products) {
                data.products.forEach(p => {
                    const { id, createdAt, updatedAt, ...rest } = p;
                    if (id) { batch.set(BashanPOS.productsRef.doc(id), rest, { merge: true }); count++; }
                });
            }
            if (data.categories) {
                data.categories.forEach(c => {
                    const { id, ...rest } = c;
                    if (id) { batch.set(BashanPOS.categoriesRef.doc(id), rest, { merge: true }); count++; }
                });
            }
            
            await batch.commit();
            this.notify(`Imported ${count} records!`, 'success');
            await this.loadCategories();
        } catch (error) {
            this.notify('Import failed: Invalid file', 'error');
        }
        event.target.value = '';
    }
    
    async clearOldSales() {
        const months = parseInt(document.getElementById('clearSalesPeriod')?.value) || 3;
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);
        
        const confirmed = await this.confirm(`Delete sales older than ${months} months? This cannot be undone!`);
        if (!confirmed) return;
        
        try {
            const snapshot = await BashanPOS.salesRef.where('timestamp', '<', cutoff).get();
            if (snapshot.empty) { this.notify('No old sales to clear', 'info'); return; }
            
            const batch = BashanPOS.db.batch();
            snapshot.forEach(d => batch.delete(d.ref));
            await batch.commit();
            this.notify(`Deleted ${snapshot.size} old sales`, 'success');
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
    
    async resetAllStock() {
        const confirmed = await this.confirm('RESET ALL STOCK TO ZERO?\n\nThis cannot be undone!');
        if (!confirmed) return;
        
        try {
            const snapshot = await BashanPOS.productsRef.get();
            if (snapshot.empty) { this.notify('No products to reset', 'info'); return; }
            
            const batch = BashanPOS.db.batch();
            snapshot.forEach(d => batch.update(d.ref, { currentStockKg: 0, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
            await batch.commit();
            this.notify(`Reset ${snapshot.size} products to zero`, 'warning');
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
    
    async deleteAllData() {
        const confirmed = await this.confirm('⚠️ DELETE ALL DATA?\n\nThis will permanently delete ALL products, sales, categories, and logs.');
        if (!confirmed) return;
        
        const doubleCheck = await this.confirm('⚠️ FINAL WARNING: This is IRREVERSIBLE!');
        if (!doubleCheck) return;
        
        try {
            const collections = ['products', 'categories', 'sales', 'stockLog', 'auditLog'];
            let total = 0;
            
            for (const col of collections) {
                const snapshot = await BashanPOS.db.collection(col).get();
                if (!snapshot.empty) {
                    const batch = BashanPOS.db.batch();
                    snapshot.forEach(d => batch.delete(d.ref));
                    await batch.commit();
                    total += snapshot.size;
                }
            }
            
            // Reset settings
            await BashanPOS.settingsRef.doc('app').set({
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
                passwordManager: '76a3e7c8',
                passwordSeller: '5d2f1a9b',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            this.notify(`Deleted ${total} records. System reset.`, 'warning');
            
            setTimeout(() => BashanPOS.logout('System reset'), 2000);
        } catch (error) {
            this.notify('Failed: ' + error.message, 'error');
        }
    }
}

// ============ INITIALIZATION ============
let settingsSystem;

// Use a simple polling approach to wait for BashanPOS
function initWhenReady() {
    if (typeof window.BashanPOS !== 'undefined') {
        console.log('🚀 BashanPOS found, starting settings...');
        settingsSystem = new SettingsSystem();
        window.settingsSystem = settingsSystem;
    } else {
        console.log('⏳ Waiting for BashanPOS...');
        setTimeout(initWhenReady, 200);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 Settings page DOM ready');
    initWhenReady();
});