// ============================================
// BASHAAN POS - POINT OF SALE (v2)
// ============================================

class BashanPOSSystem {
  constructor() {
    this.user = null;
    this.settings = null;
    this.products = [];
    this.categories = [];
    this.cart = [];
    this.selectedCategory = 'all';
    this.lowStockProducts = [];
    this.todaySales = { total: 0, count: 0 };
    this.lastSale = null;
    this.productsUnsubscribe = null;
    this.currentReportData = null;
    this.init();
  }

  async init() {
    if (!window.BashanPOS) { setTimeout(() => this.init(), 500); return; }
    this.user = BashanPOS.checkAuth();
    if (!this.user) return;

    this.settings = await BashanPOS.getSettings();
    this.setupUI();
    this.setupClock();
    this.setupEventListeners();
    await this.loadCategories();
    this.loadProductsRealtime();
    this.loadTodaySales();
    this.restoreCart();
    BashanPOS.logAudit('POS_OPEN', 'POS loaded');
    console.log('🔥 POS Ready');
  }

  // ---------- UI ----------
  setupUI() {
    const bn = document.querySelector('.badge-name');
    const br = document.querySelector('.badge-role');
    if (bn) bn.textContent = this.user.name;
    if (br) br.textContent = this.user.role;

    if (this.user.role === 'seller') {
      const rb = document.getElementById('reportsBtn');
      if (rb) rb.style.display = 'none';
      const fm = document.getElementById('floatingMenu');
      if (fm) fm.style.display = 'none';
    }

    if (this.user.role === 'manager') {
      const fm = document.getElementById('floatingMenu');
      if (fm) fm.style.display = 'block';

      const fab = document.getElementById('fabMain');
      const fs  = document.getElementById('fabSubmenu');
      if (fab) fab.onclick = () => {
        fab.classList.toggle('active');
        fs?.classList.toggle('open');
      };
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.floating-menu')) {
          fab?.classList.remove('active');
          fs?.classList.remove('open');
        }
      });
      document.getElementById('fabReports')?.addEventListener('click', () => {
        fab?.classList.remove('active');
        fs?.classList.remove('open');
        this.openReports();
      });
      document.getElementById('fabLogout')?.addEventListener('click', () => BashanPOS.logout());
    }
  }

  setupClock() {
    const tick = () => {
      const n = new Date();
      const c = document.getElementById('liveClock');
      const d = document.getElementById('dateDisplay');
      if (c) c.textContent = n.toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true });
      if (d) d.textContent = n.toLocaleDateString('en-KE', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    };
    tick();
    setInterval(tick, 1000);
  }

  setupEventListeners() {
    const b = (id, ev, fn) => { const e = document.getElementById(id); if (e) e.addEventListener(ev, fn); };
    b('searchProducts', 'input', (e) => this.renderProducts(e.target.value));
    b('discountInput', 'input', () => this.updateCartSummary());
    b('completeSaleBtn', 'click', () => this.completeSale());
    b('clearCartBtn', 'click', () => this.clearCart());
    b('reportsBtn', 'click', () => this.openReports());
    b('closeReports', 'click', () => this.closeReports());
    b('loadReportBtn', 'click', () => this.loadReport());
    b('exportCSV', 'click', () => this.exportCSV());
    b('exportPDF', 'click', () => this.exportPDF());
    b('printReport', 'click', () => this.printReport());
    b('printReceiptBtn', 'click', () => this.printReceipt());
    b('downloadReceiptBtn', 'click', () => this.downloadReceiptPDF());
    b('newSaleBtn', 'click', () => this.newSale());
    b('logoutBtn', 'click', () => BashanPOS.logout('User logout'));
    b('alertBell', 'click', () => this.toggleStockAlerts());
    b('dismissAlert', 'click', () => this.dismissStockAlerts());

    const rp = document.getElementById('reportPeriod');
    if (rp) rp.addEventListener('change', (e) => {
      const cd = document.getElementById('customDates');
      if (cd) cd.style.display = e.target.value === 'custom' ? 'flex' : 'none';
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); this.completeSale(); }
      if (e.key === 'Escape') this.clearCart();
    });

    const ro = document.getElementById('reportsOverlay');
    if (ro) ro.addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeReports(); });
    const sm = document.getElementById('successModal');
    if (sm) sm.addEventListener('click', (e) => { if (e.target === e.currentTarget) this.newSale(); });
    window.addEventListener('beforeunload', () => this.saveCart());
  }

  // ---------- CATEGORIES ----------
  async loadCategories() {
    try {
      const snap = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
      this.categories = [];
      const tc = document.getElementById('categoryTabs');
      if (!tc) return;

      tc.innerHTML = '<button class="cat-tab active" data-category="all">All</button>';
      snap.forEach(doc => {
        const cat = { id: doc.id, ...doc.data() };
        this.categories.push(cat);
        const tab = document.createElement('button');
        tab.className = 'cat-tab';
        tab.dataset.category = doc.id;
        tab.textContent = cat.name;
        tab.onclick = () => this.selectCategory(doc.id, tab);
        tc.appendChild(tab);
      });
      const allTab = tc.querySelector('[data-category="all"]');
      if (allTab) allTab.onclick = () => this.selectCategory('all', allTab);
    } catch (e) { console.error('Categories:', e); }
  }

  selectCategory(id, tab) {
    this.selectedCategory = id;
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    tab?.classList.add('active');
    this.renderProducts();
  }

  loadProductsRealtime() {
    this.productsUnsubscribe = BashanPOS.getProductsRealtime((products) => {
      this.products = products;
      this.renderProducts();
      this.checkLowStock();
      this.refreshCartFromProducts();
    });
  }

  refreshCartFromProducts() {
    this.cart.forEach(item => {
      const p = this.products.find(x => x.id === item.productId);
      if (p) {
        item.maxBase = BashanPOS.getStockBase(p);
        item.subtotal = item.qty * item.price;
      }
    });
    this.renderCart();
    this.updateCartSummary();
  }

  // ---------- PRODUCTS ----------
  renderProducts(searchTerm = '') {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    let filtered = [...this.products];
    if (this.selectedCategory !== 'all') filtered = filtered.filter(p => p.category === this.selectedCategory);
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      filtered = filtered.filter(p => (p.name || '').toLowerCase().includes(t));
    }

    if (!filtered.length) {
      grid.innerHTML = '<div class="no-products"><p>No products found</p><span>Try another search or category</span></div>';
      return;
    }

    grid.innerHTML = filtered.map(p => this.createProductCard(p)).join('');
    grid.querySelectorAll('.product-card').forEach(card => {
      card.onclick = () => {
        const p = this.products.find(x => x.id === card.dataset.productId);
        if (p) this.addToCart(p);
      };
      // Right-click / long-press = add in base unit
      card.oncontextmenu = (e) => {
        e.preventDefault();
        const p = this.products.find(x => x.id === card.dataset.productId);
        if (p) this.addToCart(p, 'base');
      };
    });
  }

  createProductCard(product) {
    const stock = BashanPOS.getStockBase(product);
    const baseUnit = product.baseUnit || 'kg';
    const bulkUnit = product.bulkUnit;
    const bulkSize = product.bulkSize || 1;
    const threshold = product.lowStockThreshold || this.settings?.lowStockThreshold || 10;

    const soldOut = stock <= 0;
    const lowStock = stock > 0 && stock <= threshold;
    const maxForBar = Math.max(threshold * 5, stock, 10);
    const pct = Math.min(100, Math.max(0, (stock / maxForBar) * 100));

    let barClass = 'good';
    if (pct < 20) barClass = 'low';
    else if (pct < 50) barClass = 'medium';

    // Display price based on bulk availability
    let priceLine;
    if (bulkUnit) {
      const bulkPrice = product.priceBulk != null ? product.priceBulk : product.priceBase * bulkSize;
      priceLine = `${BashanPOS.formatCurrency(bulkPrice)}/${bulkUnit}`;
    } else {
      priceLine = `${BashanPOS.formatCurrency(product.priceBase || 0)}/${baseUnit}`;
    }

    const stockLine = BashanPOS.formatProductStock(product);
    const badge = bulkUnit ? `<span class="uom-badge">${bulkUnit}</span>` : '';

    return `
      <div class="product-card ${soldOut ? 'sold-out' : ''}" data-product-id="${product.id}">
        ${lowStock ? '<span class="low-stock-badge">Low</span>' : ''}
        ${badge}
        <div class="product-name">${this.esc(product.name) || 'Unnamed'}</div>
        <div class="product-category">${this.esc(product.categoryName) || 'Uncategorized'}</div>
        <div class="product-price">${priceLine}</div>
        <div class="product-stock">${stockLine}</div>
        <div class="stock-bar"><div class="stock-bar-fill ${barClass}" style="width:${pct}%"></div></div>
      </div>`;
  }

  esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- CART ----------
  // Default unit = 'bulk' if product has bulk unit, else 'base'
  addToCart(product, forcedUnit) {
    const stockBase = BashanPOS.getStockBase(product);
    if (stockBase <= 0) { BashanPOS.showNotification('Out of stock', 'error'); return; }

    const defaultUnit = forcedUnit || (product.bulkUnit ? 'bulk' : 'base');
    const baseUnit = product.baseUnit || 'kg';
    const bulkUnit = product.bulkUnit;
    const bulkSize = product.bulkSize || 1;

    const unit = (defaultUnit === 'bulk' && bulkUnit) ? 'bulk' : 'base';
    const unitPrice = unit === 'bulk'
      ? (product.priceBulk != null ? product.priceBulk : product.priceBase * bulkSize)
      : product.priceBase;
    const perBaseUnit = unit === 'bulk' ? bulkSize : 1;

    // Cart line key: productId + unit
    const key = product.id + ':' + unit;
    const existing = this.cart.find(i => i.key === key);

    if (existing) {
      const step = 1;
      const newQty = existing.qty + step;
      const baseNeeded = newQty * perBaseUnit;
      if (baseNeeded > stockBase) { BashanPOS.showNotification('Not enough stock', 'warning'); return; }
      existing.qty = newQty;
      existing.subtotal = newQty * unitPrice;
    } else {
      this.cart.push({
        key,
        productId: product.id,
        name: product.name,
        unit,                          // 'base' | 'bulk'
        unitLabel: unit === 'bulk' ? bulkUnit : baseUnit,
        qty: 1,
        price: unitPrice,
        perBaseUnit,
        subtotal: unitPrice,
        maxBase: stockBase
      });
    }

    this.renderCart();
    this.updateCartSummary();
    this.saveCart();
    if (navigator.vibrate) navigator.vibrate(20);
  }

  removeFromCart(index) {
    this.cart.splice(index, 1);
    this.renderCart();
    this.updateCartSummary();
    this.saveCart();
  }

  updateCartQuantity(index, value) {
    const item = this.cart[index];
    if (!item) return;

    let qty = parseFloat(value) || 0;
    if (qty < 0) { BashanPOS.showNotification('Cannot be negative', 'warning'); this.renderCart(); return; }

    const maxQty = Math.floor((item.maxBase || 0) / item.perBaseUnit);
    if (qty > maxQty) {
      BashanPOS.showNotification('Only ' + maxQty + ' available', 'warning');
      qty = maxQty;
    }
    if (qty <= 0) { this.removeFromCart(index); return; }

    item.qty = qty;
    item.subtotal = qty * item.price;
    this.renderCart();
    this.updateCartSummary();
    this.saveCart();
  }

  renderCart() {
    const cc = document.getElementById('cartItems');
    if (!cc) return;

    if (!this.cart.length) {
      cc.innerHTML = `<div class="cart-empty">
        <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        <p>No items in basket</p><span>Click products to add</span>
      </div>`;
      return;
    }

    cc.innerHTML = this.cart.map((item, i) => {
      const step = item.unit === 'bulk' ? 1 : (item.unitLabel === 'kg' || item.unitLabel === 'litre' || item.unitLabel === 'metre' ? 0.5 : 1);
      const qtyDisplay = item.qty % 1 === 0 ? item.qty : item.qty.toFixed(2);
      const baseQty = item.qty * item.perBaseUnit;

      return `
        <div class="cart-item">
          <div class="cart-item-header">
            <span class="cart-item-name">${this.esc(item.name)}</span>
            <span class="cart-item-uom">${item.unitLabel}</span>
            <button class="remove-item-btn" onclick="posSystem.removeFromCart(${i})">×</button>
          </div>
          <div class="cart-item-details">
            <div class="qty-input-group">
              <div class="qty-label">Quantity (${item.unitLabel})</div>
              <input type="number" class="qty-input" value="${qtyDisplay}" step="${step}" min="0"
                     onchange="posSystem.updateCartQuantity(${i}, this.value)">
              <div class="qty-unit">${BashanPOS.formatCurrency(item.price)} / ${item.unitLabel}</div>
            </div>
          </div>
          <div class="cart-item-subtotal">${BashanPOS.formatCurrency(item.subtotal)}</div>
        </div>`;
    }).join('');
  }

  updateCartSummary() {
    const subtotal = this.cart.reduce((s, i) => s + (i.subtotal || 0), 0);
    const discount = parseFloat(document.getElementById('discountInput')?.value) || 0;
    const total = Math.max(0, subtotal - discount);

    const se = document.getElementById('cartSubtotal');
    const te = document.getElementById('cartTotal');
    const cb = document.getElementById('completeSaleBtn');
    if (se) se.textContent = BashanPOS.formatCurrency(subtotal);
    if (te) te.textContent = BashanPOS.formatCurrency(total);
    if (cb) cb.disabled = !this.cart.length || total <= 0;
  }

  clearCart() {
    if (!this.cart.length) return;
    BashanPOS.showConfirm('Clear all items from basket?').then(ok => {
      if (ok) {
        this.cart = [];
        this.renderCart();
        this.updateCartSummary();
        this.saveCart();
        BashanPOS.showNotification('Basket cleared', 'info');
      }
    });
  }

  saveCart() { sessionStorage.setItem('bashan_cart', JSON.stringify(this.cart)); }

  restoreCart() {
    const saved = sessionStorage.getItem('bashan_cart');
    if (!saved) return;
    try {
      this.cart = JSON.parse(saved);
      this.refreshCartFromProducts();
    } catch { this.cart = []; }
  }

  // ---------- COMPLETE SALE ----------
  async completeSale() {
    if (!this.cart.length) { BashanPOS.showNotification('Basket empty', 'warning'); return; }

    const subtotal = this.cart.reduce((s, i) => s + (i.subtotal || 0), 0);
    const discount = parseFloat(document.getElementById('discountInput')?.value) || 0;
    const total = Math.max(0, subtotal - discount);

    if (total <= 0) { BashanPOS.showNotification('Total must be > 0', 'warning'); return; }
    if (this.settings?.maxDiscount && discount > this.settings.maxDiscount) {
      BashanPOS.showNotification('Max discount: ' + BashanPOS.formatCurrency(this.settings.maxDiscount), 'warning');
      return;
    }

    // Verify stock
    for (const item of this.cart) {
      const p = this.products.find(x => x.id === item.productId);
      if (!p) { BashanPOS.showNotification('Product not found: ' + item.name, 'error'); return; }
      const baseQty = item.qty * item.perBaseUnit;
      if (baseQty > BashanPOS.getStockBase(p)) {
        BashanPOS.showNotification('Insufficient stock for ' + item.name, 'error');
        return;
      }
    }

    const ok = await BashanPOS.showConfirm(
      `Complete sale of ${BashanPOS.formatCurrency(total)}?\n\n` +
      `Items: ${this.cart.length}\nDiscount: ${BashanPOS.formatCurrency(discount)}`
    );
    if (!ok) return;

    const paymentMethod = document.getElementById('paymentMethod')?.value || 'Cash';
    const customerName = document.getElementById('customerName')?.value?.trim() || '';

    const saleItems = this.cart.map(item => ({
      productId: item.productId,
      name: item.name,
      unit: item.unit,
      unitLabel: item.unitLabel,
      qty: item.qty,
      price: item.price,
      subtotal: item.subtotal
    }));

    const saleData = {
      items: saleItems,
      subtotal,
      discountKsh: discount,
      total,
      paymentMethod,
      customerName,
      sellerId: this.user.id,
      sellerName: this.user.name
    };

    const cb = document.getElementById('completeSaleBtn');
    if (cb) { cb.disabled = true; cb.innerHTML = '<div class="loading-spinner"></div>'; }

    const result = await BashanPOS.completeSale(saleData);

    if (result.success) {
      this.lastSale = {
        ...saleData,
        receiptNumber: result.receiptNumber,
        saleId: result.saleId,
        timestamp: new Date()
      };
      this.showSuccessModal();
      this.cart = [];
      this.renderCart();
      this.updateCartSummary();
      this.saveCart();
      const di = document.getElementById('discountInput'); if (di) di.value = '0';
      const cn = document.getElementById('customerName'); if (cn) cn.value = '';
      this.loadTodaySales();
      this.playSuccessSound();
      BashanPOS.showNotification('Sale complete! ' + result.receiptNumber, 'success');
    } else {
      BashanPOS.showNotification('Sale failed: ' + result.message, 'error');
    }

    if (cb) {
      cb.disabled = false;
      cb.innerHTML = '<span>COMPLETE SALE</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    }
  }

  showSuccessModal() {
    const sale = this.lastSale;
    if (!sale) return;
    const lines = sale.items.map(item =>
      `${this.esc(item.name)}: ${BashanPOS.formatNum(item.qty)} ${item.unitLabel} — ${BashanPOS.formatCurrency(item.subtotal)}`
    ).join('<br>');

    const sd = document.getElementById('saleDetails');
    if (sd) {
      sd.innerHTML = `
        <p><strong>Receipt:</strong> ${sale.receiptNumber}</p>
        <p><strong>Total:</strong> ${BashanPOS.formatCurrency(sale.total)}</p>
        <p><strong>Items:</strong> ${sale.items.length}</p>
        <p><strong>Payment:</strong> ${sale.paymentMethod}</p>
        ${sale.customerName ? `<p><strong>Customer:</strong> ${this.esc(sale.customerName)}</p>` : ''}
        <div style="margin-top:10px;font-size:12px;border-top:1px solid var(--card-border);padding-top:10px;">${lines}</div>`;
    }
    document.getElementById('successModal')?.classList.add('active');
  }

  newSale() {
    document.getElementById('successModal')?.classList.remove('active');
    document.getElementById('searchProducts')?.focus();
  }

  playSuccessSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }

  // ---------- RECEIPT ----------
  generateReceiptHTML(sale) {
    if (!sale) sale = this.lastSale;
    if (!sale) return '';
    const s = this.settings || {};
    const d = sale.timestamp ? new Date(sale.timestamp) : new Date();

    const itemRows = sale.items.map(item => {
      const qty = BashanPOS.formatNum(item.qty) + ' ' + item.unitLabel;
      return `<tr>
        <td>${this.esc(item.name)}</td>
        <td style="text-align:right">${qty}</td>
        <td style="text-align:right">${BashanPOS.formatCurrency(item.subtotal)}</td>
      </tr>`;
    }).join('');

    return `<div style="font-family:monospace;max-width:320px;padding:10px;font-size:12px;color:#000;background:#fff;">
      <div style="text-align:center;margin-bottom:15px;">
        <h2 style="margin:0;font-size:16px;">${s.businessName || 'Bashan Livestock Feeds'}</h2>
        <p style="margin:5px 0;font-size:11px;">${s.businessAddress || ''}</p>
        <p style="margin:5px 0;font-size:11px;">Tel: ${s.businessPhone || ''}</p>
        <hr style="border:1px dashed #ccc;">
      </div>
      <p><strong>Receipt:</strong> ${sale.receiptNumber}</p>
      <p><strong>Date:</strong> ${d.toLocaleString('en-KE')}</p>
      <p><strong>Seller:</strong> ${sale.sellerName}</p>
      ${sale.customerName ? `<p><strong>Customer:</strong> ${sale.customerName}</p>` : ''}
      <hr style="border:1px dashed #ccc;">
      <table style="width:100%;font-size:11px;">
        <thead>
          <tr style="border-bottom:1px solid #ccc;">
            <th style="text-align:left">Item</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <hr style="border:1px dashed #ccc;">
      <p style="text-align:right;"><strong>Subtotal:</strong> ${BashanPOS.formatCurrency(sale.subtotal)}</p>
      ${sale.discountKsh > 0 ? `<p style="text-align:right;"><strong>Discount:</strong> -${BashanPOS.formatCurrency(sale.discountKsh)}</p>` : ''}
      <p style="text-align:right;font-size:14px;"><strong>TOTAL:</strong> ${BashanPOS.formatCurrency(sale.total)}</p>
      <p><strong>Payment:</strong> ${sale.paymentMethod}</p>
      <hr style="border:1px dashed #ccc;">
      <p style="text-align:center;font-size:10px;margin-top:15px;">${s.receiptFooter || 'Thank you for your business!'}</p>
    </div>`;
  }

  printReceipt() {
    const html = this.generateReceiptHTML();
    const w = window.open('', '_blank', 'width=400,height=600');
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 500);
  }

  downloadReceiptPDF() {
    const sale = this.lastSale;
    if (!sale) return;
    if (!window.jspdf) { BashanPOS.showNotification('PDF library not loaded', 'error'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: [80, 200] });
    const s = this.settings || {};
    let y = 10;
    doc.setFontSize(12); doc.text(s.businessName || 'Bashan Feeds', 40, y, { align: 'center' }); y += 7;
    doc.setFontSize(8);
    doc.text('Receipt: ' + sale.receiptNumber, 5, y); y += 4;
    doc.text('Date: ' + new Date(sale.timestamp || Date.now()).toLocaleString('en-KE'), 5, y); y += 4;
    doc.text('Seller: ' + sale.sellerName, 5, y); y += 6;
    sale.items.forEach(item => {
      const line = `${item.name} (${BashanPOS.formatNum(item.qty)} ${item.unitLabel})`;
      doc.text(line, 5, y);
      doc.text(BashanPOS.formatCurrency(item.subtotal), 75, y, { align: 'right' });
      y += 4;
    });
    y += 3; doc.line(5, y, 75, y); y += 5;
    doc.text('Subtotal:', 5, y); doc.text(BashanPOS.formatCurrency(sale.subtotal), 75, y, { align: 'right' }); y += 4;
    doc.text('Discount:', 5, y); doc.text('-' + BashanPOS.formatCurrency(sale.discountKsh), 75, y, { align: 'right' }); y += 4;
    doc.setFontSize(10);
    doc.text('TOTAL:', 5, y); doc.text(BashanPOS.formatCurrency(sale.total), 75, y, { align: 'right' }); y += 6;
    doc.setFontSize(8);
    doc.text('Payment: ' + sale.paymentMethod, 5, y); y += 8;
    doc.text('Thank you!', 40, y, { align: 'center' });
    doc.save('Receipt_' + sale.receiptNumber + '.pdf');
  }

  // ---------- REPORTS ----------
  openReports() {
    document.getElementById('reportsOverlay')?.classList.add('active');
    this.loadReport();
  }
  closeReports() { document.getElementById('reportsOverlay')?.classList.remove('active'); }

  async loadReport() {
    const period = document.getElementById('reportPeriod')?.value || 'today';
    const payment = document.getElementById('reportPayment')?.value || 'all';
    let sd, ed;
    const now = new Date();

    switch (period) {
      case 'today': sd = new Date(now.getFullYear(), now.getMonth(), now.getDate()); ed = new Date(sd.getTime() + 86400000); break;
      case 'yesterday': sd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); ed = new Date(sd.getTime() + 86400000); break;
      case 'week': { const dow = now.getDay(); sd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow); ed = new Date(now.getTime() + 86400000); break; }
      case 'month': sd = new Date(now.getFullYear(), now.getMonth(), 1); ed = new Date(now.getTime() + 86400000); break;
      case 'custom': {
        const si = document.getElementById('startDate')?.value;
        const ei = document.getElementById('endDate')?.value;
        if (!si || !ei) { BashanPOS.showNotification('Select both dates', 'warning'); return; }
        sd = new Date(si + 'T00:00:00');
        ed = new Date(ei + 'T23:59:59');
        break;
      }
      default: sd = new Date(now.getFullYear(), now.getMonth(), now.getDate()); ed = new Date(sd.getTime() + 86400000);
    }

    try {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      set('reportRevenue', 'Loading...');
      const tb = document.getElementById('reportTableBody');
      if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;">Loading...</td></tr>';

      let q = BashanPOS.salesRef.where('timestamp', '>=', sd).where('timestamp', '<', ed);
      if (payment !== 'all') q = q.where('paymentMethod', '==', payment);

      const snap = await q.get();
      const sales = [];
      snap.forEach(d => sales.push({ id: d.id, ...d.data() }));
      sales.sort((a, b) => {
        const ta = a.timestamp?.toDate?.() || 0;
        const tb2 = b.timestamp?.toDate?.() || 0;
        return tb2 - ta;
      });

      const totalRev = sales.reduce((s, x) => s + (x.total || 0), 0);
      const totalDisc = sales.reduce((s, x) => s + (x.discountKsh || 0), 0);
      const avg = sales.length ? totalRev / sales.length : 0;

      set('reportRevenue', BashanPOS.formatCurrency(totalRev));
      set('reportDiscounts', BashanPOS.formatCurrency(totalDisc));
      set('reportCount', sales.length);
      set('reportAvg', BashanPOS.formatCurrency(avg));

      if (tb) {
        if (!sales.length) tb.innerHTML = '<tr class="no-data"><td colspan="8">No sales found</td></tr>';
        else tb.innerHTML = sales.map(sale => {
          let ds = '';
          try {
            const d = sale.timestamp?.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp);
            ds = d.toLocaleDateString('en-KE', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
          } catch { ds = 'N/A'; }
          return `<tr>
            <td><strong>${this.esc(sale.receiptNumber)}</strong></td>
            <td>${ds}</td>
            <td>${sale.items?.length || 0}</td>
            <td>${BashanPOS.formatCurrency(sale.subtotal || 0)}</td>
            <td>${BashanPOS.formatCurrency(sale.discountKsh || 0)}</td>
            <td><strong>${BashanPOS.formatCurrency(sale.total || 0)}</strong></td>
            <td>${sale.paymentMethod || 'Cash'}</td>
            <td>${this.esc(sale.sellerName)}</td>
          </tr>`;
        }).join('');
      }
      this.currentReportData = sales;
    } catch (e) {
      console.error(e);
      BashanPOS.showNotification('Report failed: ' + e.message, 'error');
    }
  }

  exportCSV() {
    if (!this.currentReportData?.length) { BashanPOS.showNotification('No data', 'warning'); return; }
    let csv = 'Receipt,Date,Items,Subtotal,Discount,Total,Payment,Seller\n';
    this.currentReportData.forEach(s => {
      csv += `"${s.receiptNumber}","${BashanPOS.formatDate(s.timestamp)}",${s.items.length},${s.subtotal},${s.discountKsh || 0},${s.total},"${s.paymentMethod}","${s.sellerName}"\n`;
    });
    const b = new Blob([csv], { type: 'text/csv' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = 'sales_' + new Date().toISOString().split('T')[0] + '.csv'; a.click();
    URL.revokeObjectURL(u);
  }

  exportPDF() {
    if (!this.currentReportData?.length) { BashanPOS.showNotification('No data', 'warning'); return; }
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16); doc.text('Sales Report', 20, 20);
    doc.setFontSize(10); doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 20, 30);
    doc.autoTable({
      startY: 40,
      head: [['Receipt','Date','Items','Subtotal','Discount','Total','Payment']],
      body: this.currentReportData.map(s => [
        s.receiptNumber,
        BashanPOS.formatDate(s.timestamp),
        s.items.length,
        BashanPOS.formatCurrency(s.subtotal),
        BashanPOS.formatCurrency(s.discountKsh || 0),
        BashanPOS.formatCurrency(s.total),
        s.paymentMethod
      ]),
      theme: 'grid',
      styles: { fontSize: 8 },
      headStyles: { fillColor: [26, 86, 50] }
    });
    doc.save('sales_' + new Date().toISOString().split('T')[0] + '.pdf');
  }

  printReport() { window.print(); }

  // ---------- TODAY ----------
  async loadTodaySales() {
    const n = new Date();
    const s = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    const e = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    try {
      const snap = await BashanPOS.salesRef.where('timestamp', '>=', s).where('timestamp', '<', e).get();
      let t = 0;
      snap.forEach(d => t += d.data().total || 0);
      this.todaySales = { total: t, count: snap.size };
      const tt = document.getElementById('todayTotal'); if (tt) tt.textContent = BashanPOS.formatCurrency(t);
      const tc = document.getElementById('todayCount'); if (tc) tc.textContent = snap.size;
    } catch (e) {}
  }

  // ---------- LOW STOCK ----------
  checkLowStock() {
    const thr = this.settings?.lowStockThreshold || 10;
    this.lowStockProducts = this.products.filter(p => {
      if (p.archived) return false;
      const pt = p.lowStockThreshold || thr;
      const s = BashanPOS.getStockBase(p);
      return s > 0 && s <= pt;
    });

    const ac = document.getElementById('alertCount');
    if (ac) ac.textContent = this.lowStockProducts.length || '';

    const ab = document.getElementById('alertBell');
    if (ab) ab.classList.toggle('has-alerts', this.lowStockProducts.length > 0);
  }

  toggleStockAlerts() {
    const pop = document.getElementById('stockAlertPopup');
    if (!pop) return;
    if (pop.classList.contains('active')) { this.dismissStockAlerts(); return; }
    if (!this.lowStockProducts.length) { BashanPOS.showNotification('No alerts', 'info'); return; }

    const body = document.getElementById('alertBody');
    if (body) {
      body.innerHTML = this.lowStockProducts.map(p =>
        `<div class="alert-product">
          <span class="alert-product-name">${this.esc(p.name)}</span>
          <span class="alert-product-stock">${BashanPOS.formatProductStock(p)}</span>
        </div>`
      ).join('');
    }
    pop.classList.add('active');
    setTimeout(() => this.dismissStockAlerts(), 10000);
  }

  dismissStockAlerts() {
    document.getElementById('stockAlertPopup')?.classList.remove('active');
  }
}

let posSystem;
document.addEventListener('DOMContentLoaded', () => {
  posSystem = new BashanPOSSystem();
  window.posSystem = posSystem;
});
