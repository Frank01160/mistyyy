// ============================================
// BASHAAN POS - INVENTORY (v2)
// ============================================

class InventorySystem {
  constructor() {
    this.user = null;
    this.settings = null;
    this.products = [];
    this.categories = [];
    this.currentAdjustProduct = null;
    this.adjustmentType = 'add';
    this.historyData = [];
    this.init();
  }

  async init() {
    if (!window.BashanPOS) { setTimeout(() => this.init(), 500); return; }

    this.user = BashanPOS.checkAuth();
    if (!this.user) return;

    if (this.user.role !== 'manager') {
      BashanPOS.showNotification('Only managers can access inventory', 'warning');
      setTimeout(() => window.location.href = 'pos.html', 1500);
      return;
    }

    this.settings = await BashanPOS.getSettings();
    this.setupUI();
    this.setupEventListeners();
    await this.loadCategories();
    await this.loadProducts();
    BashanPOS.logAudit('INVENTORY_OPEN', 'Inventory page loaded');
    console.log('✅ Inventory Ready');
  }

  setupUI() {
    const un = document.getElementById('userName');
    const ur = document.getElementById('userRole');
    if (un) un.textContent = this.user.name;
    if (ur) ur.textContent = this.user.role;
  }

  setupEventListeners() {
    const b = (id, ev, fn) => { const e = document.getElementById(id); if (e) e.addEventListener(ev, fn); };
    b('searchInventory', 'input', () => this.renderTable());
    b('filterCategory', 'change', () => this.renderTable());
    b('filterStatus', 'change', () => this.renderTable());
    b('exportInventoryBtn', 'click', () => this.exportInventory());
    b('addProductBtn', 'click', () => this.openAddProduct());
    b('closeProductModal', 'click', () => this.closeModal('addProductModal'));
    b('cancelProductBtn', 'click', () => this.closeModal('addProductModal'));
    b('saveProductBtn', 'click', () => this.saveProduct());
    b('closeAdjustModal', 'click', () => this.closeModal('adjustStockModal'));
    b('cancelAdjustBtn', 'click', () => this.closeModal('adjustStockModal'));
    b('addTab', 'click', () => this.setAdjustmentType('add'));
    b('removeTab', 'click', () => this.setAdjustmentType('remove'));
    b('adjQty', 'input', () => this.updateAdjustPreview());
    b('confirmAdjustBtn', 'click', () => this.confirmAdjustment());
    b('historyBtn', 'click', () => this.openHistory());
    b('closeHistoryModal', 'click', () => this.closeModal('historyModal'));
    b('historyProduct', 'change', () => this.loadHistory());
    b('historyType', 'change', () => this.loadHistory());
    b('exportHistoryBtn', 'click', () => this.exportHistory());
    b('logoutBtn', 'click', () => BashanPOS.logout());

    // Product form: react to unit changes
    b('productBaseUnit', 'change', () => this.updateProductFormHints());
    b('productBulkUnit', 'change', () => this.updateProductFormHints());
    b('productBulkSize', 'input', () => this.updateProductFormHints());

    // Adjustment reason "other"
    b('adjReason', 'change', (e) => {
      const g = document.getElementById('otherReasonGroup');
      if (g) g.style.display = e.target.value === 'Other' ? 'block' : 'none';
    });

    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(o => {
      o.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) o.classList.remove('active');
      });
    });

    // Esc closes any open modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      }
    });
  }

  closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
  }

  // ---------- CATEGORIES ----------
  async loadCategories() {
    try {
      let snap = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
      if (snap.empty) {
        await this.createDefaultCategories();
        snap = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
      }
      this.categories = [];
      snap.forEach(d => this.categories.push({ id: d.id, ...d.data() }));
      this.populateCategoryDropdowns();
    } catch (e) {
      console.error('loadCategories:', e);
    }
  }

  async createDefaultCategories() {
    const defaults = [
      { name: 'Feeds', displayOrder: 0 },
      { name: 'Supplements', displayOrder: 1 },
      { name: 'Medicines', displayOrder: 2 },
      { name: 'Seeds', displayOrder: 3 },
      { name: 'Equipment', displayOrder: 4 },
      { name: 'Other', displayOrder: 5 }
    ];
    const batch = BashanPOS.db.batch();
    defaults.forEach(c => {
      const ref = BashanPOS.categoriesRef.doc();
      batch.set(ref, { name: c.name, displayOrder: c.displayOrder, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  }

  populateCategoryDropdowns() {
    const setOpts = (el, includeAll) => {
      if (!el) return;
      el.innerHTML = includeAll ? '<option value="all">All Categories</option>' : '<option value="">Select category...</option>';
      this.categories.forEach(c => {
        el.innerHTML += `<option value="${c.id}">${c.name}</option>`;
      });
    };
    setOpts(document.getElementById('filterCategory'), true);
    setOpts(document.getElementById('productCategory'), false);
  }

  categoryName(id) {
    return this.categories.find(c => c.id === id)?.name || 'Uncategorized';
  }

  // ---------- PRODUCTS ----------
  async loadProducts() {
    try {
      const snap = await BashanPOS.productsRef.where('archived', '==', false).get();
      this.products = [];
      snap.forEach(d => {
        const data = d.data();
        // Legacy migration: if old shape, convert to new
        if (data.stockBase === undefined) {
          const migrated = this.migrateLegacyProduct(data);
          if (migrated) {
            data.stockBase = migrated.stockBase;
            data.baseUnit = migrated.baseUnit;
            data.bulkUnit = migrated.bulkUnit || null;
            data.bulkSize = migrated.bulkSize || 1;
            data.priceBase = migrated.priceBase;
            data.priceBulk = migrated.priceBulk || null;
          }
        }
        this.products.push({ id: d.id, ...data });
      });
      this.renderTable();
      this.loadStats();
    } catch (e) {
      console.error('loadProducts:', e);
      BashanPOS.showNotification('Failed to load products', 'error');
    }
  }

  // Convert old UOM fields → new base/bulk shape
  migrateLegacyProduct(d) {
    const uom = d.uom || 'kg';
    const p = {};
    switch (uom) {
      case 'kg':
        p.baseUnit = 'kg';
        p.bulkUnit = 'ngunia';
        p.bulkSize = d.nguniaKg || 1000;
        p.stockBase = d.currentStockKg || 0;
        p.priceBase = d.pricePerKg || 0;
        p.priceBulk = null;
        break;
      case 'bags':
        p.baseUnit = 'kg';
        p.bulkUnit = 'ngunia';
        p.bulkSize = d.kgPerBag || 50;
        p.stockBase = (d.currentStockCount || 0) * (d.kgPerBag || 50);
        p.priceBase = (d.pricePerBag || 0) / (d.kgPerBag || 50);
        p.priceBulk = d.pricePerBag || null;
        break;
      case 'litres':
        p.baseUnit = 'litre'; p.bulkUnit = null; p.bulkSize = 1;
        p.stockBase = d.currentStockLitres || 0;
        p.priceBase = d.pricePerLitre || 0;
        break;
      case 'pieces':
        p.baseUnit = 'piece'; p.bulkUnit = null; p.bulkSize = 1;
        p.stockBase = d.currentStockCount || 0;
        p.priceBase = d.pricePerPiece || 0;
        break;
      case 'metres':
        p.baseUnit = 'metre'; p.bulkUnit = 'roll'; p.bulkSize = 100;
        p.stockBase = d.currentStockMetres || 0;
        p.priceBase = d.pricePerMetre || 0;
        break;
      default:
        p.baseUnit = 'kg'; p.bulkUnit = null; p.bulkSize = 1;
        p.stockBase = d.currentStockKg || 0;
        p.priceBase = d.pricePerKg || 0;
    }
    return p;
  }

  getStockBase(p) {
    return Number(p.stockBase) || 0;
  }

  getFilteredProducts() {
    const term = (document.getElementById('searchInventory')?.value || '').toLowerCase();
    const cat  = document.getElementById('filterCategory')?.value || 'all';
    const st   = document.getElementById('filterStatus')?.value || 'all';

    return this.products.filter(p => {
      const name = (p.name || '').toLowerCase();
      const matchesSearch = !term || name.includes(term);
      const matchesCat    = cat === 'all' || p.category === cat;

      const stock = this.getStockBase(p);
      const thr   = p.lowStockThreshold || this.settings?.lowStockThreshold || 10;

      let matchesStatus = true;
      if (st === 'in-stock')     matchesStatus = stock > thr;
      else if (st === 'low-stock')     matchesStatus = stock > 0 && stock <= thr;
      else if (st === 'out-of-stock')  matchesStatus = stock <= 0;

      return matchesSearch && matchesCat && matchesStatus;
    });
  }

  renderTable() {
    const filtered = this.getFilteredProducts();
    const tb = document.getElementById('inventoryTableBody');
    if (!tb) return;

    if (filtered.length === 0) {
      tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">📦 No products found</td></tr>';
      return;
    }

    tb.innerHTML = filtered.map(p => this.createTableRow(p)).join('');

    tb.querySelectorAll('.action-btn.adjust').forEach(btn => {
      btn.onclick = (e) => this.openAdjustModal(e.target.closest('tr').dataset.productId);
    });
    tb.querySelectorAll('.action-btn.edit').forEach(btn => {
      btn.onclick = (e) => this.openEditProduct(e.target.closest('tr').dataset.productId);
    });
    tb.querySelectorAll('.action-btn.archive').forEach(btn => {
      btn.onclick = (e) => this.archiveProduct(e.target.closest('tr').dataset.productId);
    });
  }

  createTableRow(p) {
    const stock = this.getStockBase(p);
    const thr   = p.lowStockThreshold || this.settings?.lowStockThreshold || 10;
    const baseUnit = p.baseUnit || 'kg';
    const bulkUnit = p.bulkUnit;
    const bulkSize = p.bulkSize || 1;

    // Stock display
    let stockDisplay;
    if (bulkUnit && bulkSize > 1) {
      stockDisplay = BashanPOS.formatProductStock(p);
    } else {
      stockDisplay = `${BashanPOS.formatNum(stock)} ${baseUnit}`;
    }

    // Prices
    const priceBaseDisplay = BashanPOS.formatCurrency(p.priceBase || 0) + '/' + baseUnit;
    let priceBulkDisplay = '—';
    if (bulkUnit) {
      const pb = p.priceBulk != null ? p.priceBulk : (p.priceBase || 0) * bulkSize;
      priceBulkDisplay = BashanPOS.formatCurrency(pb) + '/' + bulkUnit;
    }

    // Status
    let status, statusClass, rowClass;
    if (stock <= 0) { status = 'Out of Stock'; statusClass = 'out-of-stock'; rowClass = 'out-of-stock-row'; }
    else if (stock <= thr) { status = 'Low Stock'; statusClass = 'low-stock'; rowClass = 'low-stock-row'; }
    else { status = 'In Stock'; statusClass = 'in-stock'; rowClass = ''; }

    const maxForBar = Math.max(thr * 5, stock, 10);
    const pct = Math.min(100, Math.max(0, (stock / maxForBar) * 100));
    const barClass = stock <= 0 ? 'low' : (stock <= thr ? 'medium' : 'good');

    const bulkBadge = bulkUnit ? ` <span class="uom-badge-inline">${bulkSize} ${baseUnit}/${bulkUnit}</span>` : '';

    return `
      <tr class="${rowClass}" data-product-id="${p.id}">
        <td class="product-name-cell">${this.esc(p.name)}${bulkBadge}</td>
        <td>${this.esc(this.categoryName(p.category))}</td>
        <td>
          ${stockDisplay}
          <div class="stock-level-bar"><div class="stock-level-fill ${barClass}" style="width:${pct}%"></div></div>
        </td>
        <td>${priceBaseDisplay}</td>
        <td>${priceBulkDisplay}</td>
        <td><span class="status-badge ${statusClass}">${status}</span></td>
        <td>
          <div class="action-btns">
            <button class="action-btn adjust">📦 Adjust</button>
            <button class="action-btn edit">✏️ Edit</button>
            <button class="action-btn archive">🗑️ Archive</button>
          </div>
        </td>
      </tr>`;
  }

  esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  loadStats() {
    const thr = this.settings?.lowStockThreshold || 10;
    let low = 0, out = 0, value = 0;

    this.products.forEach(p => {
      const stock = this.getStockBase(p);
      const pt = p.lowStockThreshold || thr;
      if (stock <= 0) out++;
      else if (stock <= pt) low++;
      value += stock * (p.priceBase || 0);
    });

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('totalProducts', this.products.length);
    set('lowStockCount', low);
    set('outOfStockCount', out);
    set('totalValue', BashanPOS.formatCurrency(value));
  }

  // ---------- ADD/EDIT PRODUCT ----------
  openAddProduct() {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const txt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

    txt('productModalTitle', 'Add Product');
    set('editProductId', '');
    set('productName', '');
    set('productCategory', '');
    set('productBaseUnit', 'kg');
    set('productBulkUnit', '');
    set('productBulkSize', '50');
    set('productPriceBase', '');
    set('productPriceBulk', '');
    set('productStockBase', '0');
    set('productThreshold', this.settings?.lowStockThreshold || 10);

    this.updateProductFormHints();
    document.getElementById('addProductModal')?.classList.add('active');
  }

  openEditProduct(id) {
    const p = this.products.find(x => x.id === id);
    if (!p) return;

    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const txt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

    txt('productModalTitle', 'Edit Product');
    set('editProductId', p.id);
    set('productName', p.name || '');
    set('productCategory', p.category || '');
    set('productBaseUnit', p.baseUnit || 'kg');
    set('productBulkUnit', p.bulkUnit || '');
    set('productBulkSize', p.bulkSize || 50);
    set('productPriceBase', p.priceBase || '');
    set('productPriceBulk', p.priceBulk || '');
    set('productStockBase', this.getStockBase(p));
    set('productThreshold', p.lowStockThreshold || 10);

    this.updateProductFormHints();
    document.getElementById('addProductModal')?.classList.add('active');
  }

  updateProductFormHints() {
    const baseUnit = document.getElementById('productBaseUnit')?.value || 'kg';
    const bulkUnit = document.getElementById('productBulkUnit')?.value || '';
    const bulkSize = parseFloat(document.getElementById('productBulkSize')?.value) || 1;

    const baseLabelText = { kg: 'Kilogram', litre: 'Litre', piece: 'Piece', metre: 'Metre' }[baseUnit] || baseUnit;

    const txt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const show = (id, yes) => { const e = document.getElementById(id); if (e) e.style.display = yes ? 'block' : 'none'; };

    txt('priceBaseLabel', `Price per ${baseLabelText.toLowerCase()} (KSH) *`);
    txt('stockInputLabel', `Initial stock in ${baseUnit}s`);
    txt('thresholdLabel', `Low Stock Threshold (${baseUnit}s)`);

    if (bulkUnit) {
      show('bulkSizeGroup', true);
      show('priceBulkGroup', true);

      const bulkLabel = bulkUnit.charAt(0).toUpperCase() + bulkUnit.slice(1);
      txt('bulkSizeLabel', `Size of one ${bulkUnit} (in ${baseUnit}s) *`);
      txt('bulkSizeHint', `e.g. one ${bulkUnit} = ${bulkSize} ${baseUnit}${bulkSize !== 1 ? 's' : ''}`);
      txt('priceBulkLabel', `Price per ${bulkLabel} (KSH) — blank to auto-calc`);

      const stockHint = document.getElementById('stockInputHint');
      if (stockHint) {
        const autoBulkPrice = (parseFloat(document.getElementById('productPriceBase')?.value) || 0) * bulkSize;
        stockHint.textContent = `e.g. ${bulkSize} ${baseUnit}s = 1 ${bulkUnit}`;
      }
    } else {
      show('bulkSizeGroup', false);
      show('priceBulkGroup', false);
      const stockHint = document.getElementById('stockInputHint');
      if (stockHint) stockHint.textContent = '';
    }
  }

  async saveProduct() {
    const getV = (id) => document.getElementById(id)?.value || '';
    const getN = (id) => parseFloat(document.getElementById(id)?.value) || 0;

    const editId = getV('editProductId');
    const name = getV('productName').trim();
    const category = getV('productCategory');
    const baseUnit = getV('productBaseUnit');
    const bulkUnit = getV('productBulkUnit') || null;
    const bulkSize = bulkUnit ? getN('productBulkSize') : 1;
    const priceBase = getN('productPriceBase');
    let priceBulk = getN('productPriceBulk');
    const stockBase = getN('productStockBase');
    const threshold = getN('productThreshold');

    if (!name) { BashanPOS.showNotification('Product name is required', 'warning'); return; }
    if (priceBase <= 0) { BashanPOS.showNotification('Valid base price is required', 'warning'); return; }
    if (bulkUnit && bulkSize <= 0) { BashanPOS.showNotification('Bulk size must be > 0', 'warning'); return; }
    if (stockBase < 0) { BashanPOS.showNotification('Stock cannot be negative', 'warning'); return; }

    if (bulkUnit && !priceBulk) priceBulk = priceBase * bulkSize;

const data = {
  name: String(name),
  category: category || '',
  categoryName: this.categoryName(category),
  baseUnit: String(baseUnit),
  bulkUnit: bulkUnit || null,
  bulkSize: Number(bulkSize) || 1,
  priceBase: Number(priceBase) || 0,
  priceBulk: bulkUnit ? (Number(priceBulk) || 0) : null,
  stockBase: Number(stockBase) || 0,
  lowStockThreshold: Number(threshold) || 10,
  archived: false,
  updatedAt: firebase.firestore.FieldValue.serverTimestamp()
};

    try {
      if (editId) {
        await BashanPOS.productsRef.doc(editId).update(data);
        BashanPOS.showNotification('Product updated', 'success');
        BashanPOS.logAudit('PRODUCT_EDIT', `Edited: ${name}`);
      } else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await BashanPOS.productsRef.add(data);
        BashanPOS.showNotification('Product added', 'success');
        BashanPOS.logAudit('PRODUCT_ADD', `Added: ${name}`);
      }
      this.closeModal('addProductModal');
      await this.loadProducts();
    } catch (e) {
      console.error(e);
      BashanPOS.showNotification('Failed: ' + e.message, 'error');
    }
  }

  async archiveProduct(id) {
    const p = this.products.find(x => x.id === id);
    if (!p) return;
    if (!await BashanPOS.showConfirm(`Archive "${p.name}"?\n\nIt will be hidden from POS and inventory.`)) return;
    try {
      await BashanPOS.productsRef.doc(id).update({
        archived: true,
        archivedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      BashanPOS.showNotification('Product archived', 'success');
      BashanPOS.logAudit('PRODUCT_ARCHIVE', `Archived: ${p.name}`);
      await this.loadProducts();
    } catch (e) {
      BashanPOS.showNotification('Failed to archive', 'error');
    }
  }

  // ---------- ADJUST STOCK ----------
  openAdjustModal(id) {
    const p = this.products.find(x => x.id === id);
    if (!p) return;
    this.currentAdjustProduct = p;
    this.adjustmentType = 'add';

    const txt = (elId, v) => { const e = document.getElementById(elId); if (e) e.textContent = v; };
    const set = (elId, v) => { const e = document.getElementById(elId); if (e) e.value = v; };

    txt('adjustModalTitle', 'Adjust Stock');
    const info = document.getElementById('adjustProductInfo');
    if (info) {
      info.innerHTML = `
        <div class="product-name-lg">${this.esc(p.name)}</div>
        <div class="product-meta">
          <span>Current: ${BashanPOS.formatProductStock(p)}</span>
          <span>Price: ${BashanPOS.formatCurrency(p.priceBase || 0)}/${p.baseUnit}</span>
        </div>`;
    }

    txt('adjQtyLabel', `Quantity (${p.baseUnit}s)`);
    const hint = document.getElementById('adjQtyHint');
    if (hint) {
      if (p.bulkUnit && p.bulkSize > 1) {
        hint.textContent = `Enter in ${p.baseUnit}s. 1 ${p.bulkUnit} = ${p.bulkSize} ${p.baseUnit}s.`;
      } else hint.textContent = '';
    }

    set('adjQty', '0');
    set('adjReason', '');
    set('adjOtherReason', '');
    set('adjNotes', '');
    const og = document.getElementById('otherReasonGroup');
    if (og) og.style.display = 'none';

    this.setAdjustmentType('add');
    document.getElementById('adjustStockModal')?.classList.add('active');
  }

  setAdjustmentType(type) {
    this.adjustmentType = type;
    document.getElementById('addTab')?.classList.toggle('active', type === 'add');
    document.getElementById('removeTab')?.classList.toggle('active', type === 'remove');
    this.updateAdjustPreview();
  }

  updateAdjustPreview() {
    if (!this.currentAdjustProduct) return;
    const p = this.currentAdjustProduct;
    const qty = parseFloat(document.getElementById('adjQty')?.value) || 0;
    const current = this.getStockBase(p);
    const next = this.adjustmentType === 'add' ? current + qty : current - qty;
    const el = document.getElementById('newStockDisplay');
    if (!el) return;
    const display = BashanPOS.formatProductStock({ ...p, stockBase: Math.max(0, next) });
    el.textContent = display;
    el.style.color = next < 0 ? 'var(--danger)' : 'var(--green-pale)';
  }

  async confirmAdjustment() {
    if (!this.currentAdjustProduct) return;
    const p = this.currentAdjustProduct;
    const qty = parseFloat(document.getElementById('adjQty')?.value) || 0;
    const reason = document.getElementById('adjReason')?.value || '';
    const otherReason = document.getElementById('adjOtherReason')?.value?.trim() || '';
    const notes = document.getElementById('adjNotes')?.value?.trim() || '';

    if (qty <= 0) { BashanPOS.showNotification('Enter a quantity > 0', 'warning'); return; }
    if (!reason)  { BashanPOS.showNotification('Select a reason', 'warning'); return; }
    if (reason === 'Other' && !otherReason) { BashanPOS.showNotification('Specify the reason', 'warning'); return; }

    const current = this.getStockBase(p);
    if (this.adjustmentType === 'remove' && qty > current) {
      BashanPOS.showNotification(`Cannot remove more than current stock (${BashanPOS.formatProductStock(p)})`, 'error');
      return;
    }

    const next = this.adjustmentType === 'add' ? current + qty : current - qty;
    const finalReason = reason === 'Other' ? otherReason : reason;

    const ok = await BashanPOS.showConfirm(
      `${this.adjustmentType === 'add' ? 'Add' : 'Remove'} ${qty} ${p.baseUnit} ${this.adjustmentType === 'add' ? 'to' : 'from'} ${p.name}?\n\n` +
      `Current: ${current} ${p.baseUnit}\nNew: ${next} ${p.baseUnit}\nReason: ${finalReason}`
    );
    if (!ok) return;

    const result = await BashanPOS.updateStock(
      p.id, next, finalReason, notes, this.user.name, this.user.id
    );

    if (result.success) {
      BashanPOS.showNotification('Stock adjusted', 'success');
      this.closeModal('adjustStockModal');
      this.currentAdjustProduct = null;
      await this.loadProducts();
    } else {
      BashanPOS.showNotification('Failed: ' + result.message, 'error');
    }
  }

  // ---------- HISTORY ----------
  async openHistory() {
    // Populate product filter
    const sel = document.getElementById('historyProduct');
    if (sel) {
      sel.innerHTML = '<option value="all">All Products</option>';
      this.products.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${this.esc(p.name)}</option>`;
      });
    }
    document.getElementById('historyModal')?.classList.add('active');
    await this.loadHistory();
  }

  async loadHistory() {
    try {
      const productFilter = document.getElementById('historyProduct')?.value || 'all';
      const typeFilter    = document.getElementById('historyType')?.value || 'all';

      let query = BashanPOS.stockLogRef.orderBy('timestamp', 'desc').limit(200);
      if (productFilter !== 'all') query = query.where('productId', '==', productFilter);

      const snap = await query.get();
      this.historyData = [];
      snap.forEach(d => {
        const data = d.data();
        if (typeFilter === 'all' || data.type === typeFilter) {
          this.historyData.push({ id: d.id, ...data });
        }
      });
      this.renderHistory();
    } catch (e) {
      console.error('loadHistory:', e);
      const tb = document.getElementById('historyTableBody');
      if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;">Failed to load history</td></tr>';
    }
  }

  renderHistory() {
    const tb = document.getElementById('historyTableBody');
    if (!tb) return;

    if (this.historyData.length === 0) {
      tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted);">No stock movements found</td></tr>';
      return;
    }

    tb.innerHTML = this.historyData.map(log => {
      const unit = log.baseUnit || 'kg';
      const qty = BashanPOS.formatNum(log.quantityBase || 0) + ' ' + unit;
      return `
        <tr>
          <td>${BashanPOS.formatDate(log.timestamp)}</td>
          <td>${this.esc(log.productName)}</td>
          <td><span class="type-badge ${log.type}">${log.type === 'add' ? 'Added' : 'Removed'}</span></td>
          <td>${qty}</td>
          <td>${BashanPOS.formatNum(log.beforeStock || 0)}</td>
          <td>${BashanPOS.formatNum(log.afterStock || 0)}</td>
          <td>${this.esc(log.reason || '')}</td>
          <td>${this.esc(log.doneByName || '')}</td>
        </tr>`;
    }).join('');
  }

  exportHistory() {
    if (!this.historyData.length) { BashanPOS.showNotification('No history to export', 'warning'); return; }
    let csv = 'Date,Product,Type,Quantity,Before,After,Reason,Done By\n';
    this.historyData.forEach(l => {
      csv += `"${BashanPOS.formatDate(l.timestamp)}","${l.productName}","${l.type}",` +
             `${l.quantityBase || 0},${l.beforeStock || 0},${l.afterStock || 0},` +
             `"${l.reason || ''}","${l.doneByName || ''}"\n`;
    });
    this.downloadCSV(csv, `stock_history_${new Date().toISOString().split('T')[0]}.csv`);
  }

  exportInventory() {
    const filtered = this.getFilteredProducts();
    if (!filtered.length) { BashanPOS.showNotification('No data to export', 'warning'); return; }

    let csv = 'Product,Category,Base Unit,Stock (base),Bulk Unit,Bulk Size,Price/base,Price/bulk,Threshold\n';
    filtered.forEach(p => {
      csv += `"${p.name}","${this.categoryName(p.category)}","${p.baseUnit}",${this.getStockBase(p)},` +
             `"${p.bulkUnit || ''}",${p.bulkSize || 1},${p.priceBase || 0},${p.priceBulk || ''},${p.lowStockThreshold || 0}\n`;
    });
    this.downloadCSV(csv, `inventory_${new Date().toISOString().split('T')[0]}.csv`);
    BashanPOS.showNotification('Inventory exported', 'success');
  }

  downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}

let inventorySystem;
document.addEventListener('DOMContentLoaded', () => {
  inventorySystem = new InventorySystem();
  window.inventorySystem = inventorySystem;
});
