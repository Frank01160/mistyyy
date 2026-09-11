// ============================================
// BASHAAN POS - SETTINGS ENGINE (REWRITTEN)
// ============================================

class SettingsSystem {
  constructor() {
    this.user = null;
    this.settings = null;
    this.categories = [];
    this.ready = false;
    this.waitForReady();
  }

  // ---------- BOOT ----------
  async waitForReady() {
    if (typeof window.BashanPOS === 'undefined') {
      return setTimeout(() => this.waitForReady(), 300);
    }

    this.user = BashanPOS.checkAuth();
    if (!this.user) {
      return setTimeout(() => this.waitForReady(), 300);
    }

    if (this.user.role !== 'manager') {
      alert('Only managers can access settings');
      window.location.href = 'pos.html';
      return;
    }

    console.log('✅ User authenticated:', this.user);

    this.settings = await BashanPOS.getSettings();
    console.log('✅ Settings loaded:', this.settings);

    this.setupUI();
    this.bindEvents();
    this.loadSettingsToForm();
    await this.loadCategories();

    this.ready = true;
    console.log('✅ Settings System Ready');
  }

  setupUI() {
    const userBadge = document.getElementById('userBadge');
    if (userBadge) userBadge.textContent = `${this.user.role}: ${this.user.name}`;
  }

  // ---------- EVENTS ----------
  bindEvents() {
    console.log('🔗 Binding events...');

    document.querySelectorAll('.settings-nav-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-' + btn.dataset.tab)?.classList.add('active');
      };
    });

    this.bindClick('saveBusinessBtn',        () => this.saveBusinessInfo());
    this.bindClick('addCategoryBtn',         () => this.addCategory());
    this.bindClick('updateManagerPassBtn',   () => this.updateManagerPassword());
    this.bindClick('updateSellerPassBtn',    () => this.updateSellerPassword());
    this.bindClick('saveSessionBtn',         () => this.saveSessionSettings());
    this.bindClick('savePreferencesBtn',     () => this.savePreferences());
    this.bindClick('exportDataBtn',          () => this.exportAllData());
    this.bindClick('importDataBtn',          () => document.getElementById('importFile')?.click());
    this.bindClick('clearSalesBtn',          () => this.clearOldSales());
    this.bindClick('resetStockBtn',          () => this.resetAllStock());
    this.bindClick('deleteAllBtn',           () => this.deleteAllData());
    this.bindClick('logoutBtn',              () => BashanPOS.logout('Manager logout'));

    const catInput = document.getElementById('newCategoryName');
    if (catInput) catInput.onkeypress = (e) => { if (e.key === 'Enter') this.addCategory(); };

    const importFile = document.getElementById('importFile');
    if (importFile) importFile.onchange = (e) => this.importData(e);

    console.log('✅ Events bound');
  }

  bindClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.onclick = handler;
    else    console.warn('⚠️ Element not found:', id);
  }

  // ---------- FORM ----------
  loadSettingsToForm() {
    if (!this.settings) return;
    const fields = {
      businessName:        this.settings.businessName        || '',
      businessAddress:     this.settings.businessAddress     || '',
      businessPhone:       this.settings.businessPhone       || '',
      businessEmail:       this.settings.businessEmail       || '',
      receiptFooter:       this.settings.receiptFooter       || '',
      defaultNguniaSize:   this.settings.nguniaDefault       || 1000,
      lowStockThreshold:   this.settings.lowStockThreshold   || 100,
      maxDiscount:         this.settings.maxDiscount         || 5000,
      sessionTimeout:      this.settings.sessionTimeout      || 30,
      maxAttempts:         this.settings.maxAttempts         || 5
    };
    for (const [id, value] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }
    console.log('✅ Form populated');
  }

  // ---------- NOTIFY ----------
  notify(msg, type = 'info') {
    console.log(`🔔 [${type}] ${msg}`);
    if (window.BashanPOS?.showNotification) BashanPOS.showNotification(msg, type);
    else alert(msg);
  }

  async confirm(msg) {
    if (window.BashanPOS?.showConfirm) return await BashanPOS.showConfirm(msg);
    return window.confirm(msg);
  }

  // ---------- BUSINESS INFO ----------
  async saveBusinessInfo() {
    const data = {
      businessName:    document.getElementById('businessName')?.value?.trim()    || '',
      businessAddress: document.getElementById('businessAddress')?.value?.trim() || '',
      businessPhone:   document.getElementById('businessPhone')?.value?.trim()   || '',
      businessEmail:   document.getElementById('businessEmail')?.value?.trim()   || '',
      receiptFooter:   document.getElementById('receiptFooter')?.value?.trim()   || ''
    };
    try {
      await BashanPOS.settingsRef.doc('app').update(data);
      this.settings = { ...this.settings, ...data };
      this.notify('Business info saved!', 'success');
    } catch (error) {
      console.error(error);
      this.notify('Failed to save: ' + error.message, 'error');
    }
  }

  // ---------- CATEGORIES ----------
  async loadCategories() {
    try {
      let snapshot;
      try {
        snapshot = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
      } catch {
        // Fallback if displayOrder field missing on some docs
        snapshot = await BashanPOS.categoriesRef.get();
      }
      this.categories = [];
      snapshot.forEach(doc => this.categories.push({ id: doc.id, ...doc.data() }));
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
        <span class="category-name">${i + 1}. ${this.escapeHtml(cat.name)}</span>
        <div class="category-actions">
          <button class="edit-cat-btn" data-id="${cat.id}">✏️ Edit</button>
          <button class="delete-cat-btn" data-id="${cat.id}">🗑️</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.edit-cat-btn').forEach(b => b.onclick = () => this.editCategory(b.dataset.id));
    list.querySelectorAll('.delete-cat-btn').forEach(b => b.onclick = () => this.deleteCategory(b.dataset.id));
  }

  escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  async addCategory() {
    const input = document.getElementById('newCategoryName');
    if (!input) return;

    const name = input.value.trim();
    if (!name) { this.notify('Enter a category name', 'warning'); input.focus(); return; }
    if (this.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      this.notify('Category already exists!', 'warning');
      return;
    }

    try {
      await BashanPOS.categoriesRef.add({
        name,
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
    if (!newName || !newName.trim() || newName.trim() === cat.name) return;
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
    if (!await this.confirm(`Delete "${cat.name}"?`)) return;
    try {
      await BashanPOS.categoriesRef.doc(id).delete();
      this.notify('Category deleted!', 'success');
      await this.loadCategories();
    } catch (error) {
      this.notify('Failed: ' + error.message, 'error');
    }
  }

  // ---------- SECURITY ----------
  async updateManagerPassword() {
    const current = document.getElementById('managerCurrentPass')?.value || '';
    const newPass = document.getElementById('managerNewPass')?.value    || '';
    const confirm = document.getElementById('managerConfirmPass')?.value || '';

    if (!current || !newPass || !confirm) return this.notify('All fields required', 'warning');
    if (newPass !== confirm)               return this.notify('Passwords do not match', 'warning');
    if (newPass.length < 4)                return this.notify('Min 4 characters', 'warning');

    const verify = await BashanPOS.verifyPassword(current, 'manager');
    if (!verify.success) return this.notify('Wrong current password', 'error');

    const result = await BashanPOS.updatePassword(newPass, 'manager');
    if (result.success) {
      this.notify('Password updated!', 'success');
      ['managerCurrentPass','managerNewPass','managerConfirmPass']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    } else {
      this.notify('Failed: ' + result.message, 'error');
    }
  }

  async updateSellerPassword() {
    const authPass = document.getElementById('sellerAuthPass')?.value || '';
    const newPass  = document.getElementById('sellerNewPass')?.value  || '';

    if (!authPass || !newPass) return this.notify('All fields required', 'warning');
    if (newPass.length < 4)    return this.notify('Min 4 characters', 'warning');

    const verify = await BashanPOS.verifyPassword(authPass, 'manager');
    if (!verify.success) return this.notify('Wrong manager password', 'error');

    const result = await BashanPOS.updatePassword(newPass, 'seller');
    if (result.success) {
      this.notify('Seller password updated!', 'success');
      ['sellerAuthPass','sellerNewPass']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    } else {
      this.notify('Failed: ' + result.message, 'error');
    }
  }

  async saveSessionSettings() {
    const sessionTimeout = parseInt(document.getElementById('sessionTimeout')?.value, 10) || 30;
    const maxAttempts    = parseInt(document.getElementById('maxAttempts')?.value, 10)    || 5;
    try {
      await BashanPOS.settingsRef.doc('app').update({ sessionTimeout, maxAttempts });
      this.notify('Session settings saved!', 'success');
    } catch (error) {
      this.notify('Failed: ' + error.message, 'error');
    }
  }

  // ---------- PREFERENCES ----------
  async savePreferences() {
    const nguniaDefault     = parseInt(document.getElementById('defaultNguniaSize')?.value, 10) || 1000;
    const lowStockThreshold = parseInt(document.getElementById('lowStockThreshold')?.value, 10) || 100;
    const maxDiscount       = parseInt(document.getElementById('maxDiscount')?.value, 10)       || 5000;
    try {
      await BashanPOS.settingsRef.doc('app').update({ nguniaDefault, lowStockThreshold, maxDiscount });
      this.notify('Preferences saved!', 'success');
    } catch (error) {
      this.notify('Failed: ' + error.message, 'error');
    }
  }

  // ---------- DATA ----------
  async exportAllData() {
    this.notify('Exporting...', 'info');
    try {
      const data = { exportDate: new Date().toISOString(), version: BashanPOS.APP_VERSION };

      const [products, categories, sales, stockLog] = await Promise.all([
        BashanPOS.productsRef.get(),
        BashanPOS.categoriesRef.get(),
        BashanPOS.salesRef.orderBy('timestamp','desc').limit(1000).get(),
        BashanPOS.stockLogRef.orderBy('timestamp','desc').limit(500).get()
      ]);

      data.products   = products.docs.map(d => ({ id: d.id, ...d.data() }));
      data.categories = categories.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sales      = sales.docs.map(d => {
        const s = d.data();
        s.timestamp = s.timestamp?.toDate?.()?.toISOString() || null;
        return { id: d.id, ...s };
      });
      data.stockLog   = stockLog.docs.map(d => {
        const l = d.data();
        l.timestamp = l.timestamp?.toDate?.()?.toISOString() || null;
        return { id: d.id, ...l };
      });

      const safeSettings = { ...this.settings };
      delete safeSettings.passwordManager;
      delete safeSettings.passwordSeller;
      data.settings = safeSettings;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
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
    if (!await this.confirm('Import data? This will merge with existing data.')) {
      event.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const batch = BashanPOS.db.batch();
      let count = 0;

      (data.products || []).forEach(p => {
        const { id, createdAt, updatedAt, ...rest } = p;
        if (id) { batch.set(BashanPOS.productsRef.doc(id), rest, { merge: true }); count++; }
      });
      (data.categories || []).forEach(c => {
        const { id, ...rest } = c;
        if (id) { batch.set(BashanPOS.categoriesRef.doc(id), rest, { merge: true }); count++; }
      });

      await batch.commit();
      this.notify(`Imported ${count} records!`, 'success');
      await this.loadCategories();
    } catch (error) {
      this.notify('Import failed: Invalid file', 'error');
    }
    event.target.value = '';
  }

  async clearOldSales() {
    const months = parseInt(document.getElementById('clearSalesPeriod')?.value, 10) || 3;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    if (!await this.confirm(`Delete sales older than ${months} months? This cannot be undone!`)) return;

    try {
      const snapshot = await BashanPOS.salesRef.where('timestamp','<',cutoff).get();
      if (snapshot.empty) return this.notify('No old sales to clear', 'info');

      const batch = BashanPOS.db.batch();
      snapshot.forEach(d => batch.delete(d.ref));
      await batch.commit();
      this.notify(`Deleted ${snapshot.size} old sales`, 'success');
    } catch (error) {
      this.notify('Failed: ' + error.message, 'error');
    }
  }

  async resetAllStock() {
    if (!await this.confirm('RESET ALL STOCK TO ZERO?\n\nThis cannot be undone!')) return;
    try {
      const snapshot = await BashanPOS.productsRef.get();
      if (snapshot.empty) return this.notify('No products to reset', 'info');

      const batch = BashanPOS.db.batch();
      snapshot.forEach(d => batch.update(d.ref, {
        currentStockKg: 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }));
      await batch.commit();
      this.notify(`Reset ${snapshot.size} products to zero`, 'warning');
    } catch (error) {
      this.notify('Failed: ' + error.message, 'error');
    }
  }

  async deleteAllData() {
    if (!await this.confirm('⚠️ DELETE ALL DATA?\n\nThis will permanently delete ALL products, sales, categories, and logs.')) return;
    if (!await this.confirm('⚠️ FINAL WARNING: This is IRREVERSIBLE!')) return;

    try {
      const collections = ['products', 'categories', 'sales', 'stockLog', 'auditLog'];
      let total = 0;

      for (const col of collections) {
        const snapshot = await BashanPOS.db.collection(col).get();
        if (snapshot.empty) continue;

        // Firestore batch limit is 500 — chunk it
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += 500) {
          const batch = BashanPOS.db.batch();
          docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
        total += docs.length;
      }

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
        passwordManager: BashanPOS.hashPassword('admin123'),
        passwordSeller:  BashanPOS.hashPassword('seller123'),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      this.notify(`Deleted ${total} records. System reset.`, 'warning');
      setTimeout(() => BashanPOS.logout('System reset'), 2000);
    } catch (error) {
      this.notify('Failed: ' + error.message, 'error');
    }
  }
}

// ============================================
// INIT
// ============================================
function initWhenReady() {
  if (typeof window.BashanPOS !== 'undefined') {
    console.log('🚀 BashanPOS found, starting settings...');
    window.settingsSystem = new SettingsSystem();
  } else {
    setTimeout(initWhenReady, 200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('📄 Settings page DOM ready');
  initWhenReady();
});
