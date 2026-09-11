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
   
