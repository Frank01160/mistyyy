// ============================================
// BASHAAN POS - MAIN POS ENGINE (COMPLETE)
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
        this.currentReportPeriod = null;
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
        this.checkLowStock();
        BashanPOS.logAudit('POS_OPEN', 'POS page loaded');
        console.log('🔥 POS System Ready');
    }
    
    setupUI() {
        const bn = document.querySelector('.badge-name');
        const br = document.querySelector('.badge-role');
        if (bn) bn.textContent = this.user.name;
        if (br) br.textContent = this.user.role;
        if (this.user.role === 'seller') {
            const rb = document.getElementById('reportsBtn');
            if (rb) rb.style.display = 'none';
        }
        if (this.user.role === 'manager') {
            const fm = document.getElementById('floatingMenu');
            if (fm) fm.style.display = 'block';
            const fab = document.getElementById('fabMain');
            if (fab) fab.addEventListener('click', () => { fab.classList.toggle('active'); const fs = document.getElementById('fabSubmenu'); if (fs) fs.classList.toggle('open'); });
            document.addEventListener('click', (e) => { if (!e.target.closest('.floating-menu')) { const f1 = document.getElementById('fabMain'); const f2 = document.getElementById('fabSubmenu'); if (f1) f1.classList.remove('active'); if (f2) f2.classList.remove('open'); } });
            const fr = document.getElementById('fabReports');
            if (fr) fr.addEventListener('click', () => { const f1 = document.getElementById('fabMain'); const f2 = document.getElementById('fabSubmenu'); if (f1) f1.classList.remove('active'); if (f2) f2.classList.remove('open'); this.openReports(); });
            const fl = document.getElementById('fabLogout');
            if (fl) fl.addEventListener('click', () => BashanPOS.logout());
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
        if (rp) rp.addEventListener('change', (e) => { const cd = document.getElementById('customDates'); if (cd) cd.style.display = e.target.value === 'custom' ? 'flex' : 'none'; });
        document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); this.completeSale(); } if (e.key === 'Escape') this.clearCart(); });
        const ro = document.getElementById('reportsOverlay');
        if (ro) ro.addEventListener('click', (e) => { if (e.target === e.currentTarget) this.closeReports(); });
        const sm = document.getElementById('successModal');
        if (sm) sm.addEventListener('click', (e) => { if (e.target === e.currentTarget) this.newSale(); });
        window.addEventListener('beforeunload', () => this.saveCart());
    }
    
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
                tab.addEventListener('click', () => this.selectCategory(doc.id, tab));
                tc.appendChild(tab);
            });
            const at = tc.querySelector('[data-category="all"]');
            if (at) at.addEventListener('click', function() { document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active')); this.classList.add('active'); if (window.posSystem) window.posSystem.selectCategory('all'); });
        } catch (e) { console.error('Categories error:', e); }
    }
    
    selectCategory(catId, tabEl = null) {
        this.selectedCategory = catId;
        document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
        if (tabEl) tabEl.classList.add('active');
        else { const t = document.querySelector('[data-category="' + catId + '"]'); if (t) t.classList.add('active'); }
        this.renderProducts();
    }
    
    loadProductsRealtime() {
        this.productsUnsubscribe = BashanPOS.getProductsRealtime((products) => {
            this.products = products;
            this.renderProducts();
            this.checkLowStock();
        });
    }
    
    renderProducts(searchTerm = '') {
        const grid = document.getElementById('productsGrid');
        if (!grid) return;
        let filtered = [...this.products];
        if (this.selectedCategory !== 'all') filtered = filtered.filter(p => p.category === this.selectedCategory);
        if (searchTerm) { const t = searchTerm.toLowerCase(); filtered = filtered.filter(p => p.name && p.name.toLowerCase().includes(t)); }
        if (filtered.length === 0) { grid.innerHTML = '<div class="no-products"><p>No products found</p><span>Try different search or category</span></div>'; return; }
        grid.innerHTML = filtered.map(p => this.createProductCard(p)).join('');
        grid.querySelectorAll('.product-card:not(.sold-out)').forEach(card => {
            card.addEventListener('click', () => {
                const pid = card.dataset.productId;
                const prod = this.products.find(p => p.id === pid);
                if (prod) this.addToCart(prod);
            });
        });
    }
    
    createProductCard(product) {
        const uom = product.uom || 'kg';
        const ns = product.nguniaKg || this.settings?.nguniaDefault || 1000;
        const thr = product.lowStockThreshold || this.settings?.lowStockThreshold || 100;
        let stock = 0, sd = '', pd = '', maxStock = 100;
        switch(uom) {
            case 'kg': stock = product.currentStockKg || 0; maxStock = ns * 5; sd = BashanPOS.formatStock(stock, ns); pd = BashanPOS.formatCurrency(product.pricePerKg || 0) + '/kg'; break;
            case 'bags': stock = product.currentStockCount || 0; maxStock = 50; sd = stock + ' bags (' + (product.kgPerBag || 50) + 'kg each)'; pd = BashanPOS.formatCurrency(product.pricePerBag || 0) + '/bag'; break;
            case 'litres': stock = product.currentStockLitres || 0; maxStock = 100; sd = stock.toFixed(2) + ' L'; pd = BashanPOS.formatCurrency(product.pricePerLitre || 0) + '/L'; break;
            case 'ml': stock = product.currentStockMl || 0; maxStock = 5000; sd = stock.toFixed(0) + ' mL'; pd = BashanPOS.formatCurrency(product.pricePer100ml || 0) + '/100mL'; break;
            case 'pieces': stock = product.currentStockCount || 0; maxStock = 100; sd = stock + ' pcs'; pd = BashanPOS.formatCurrency(product.pricePerPiece || 0) + '/pc'; break;
            case 'grams': stock = product.currentStockGrams || 0; maxStock = 5000; sd = stock + 'g'; pd = BashanPOS.formatCurrency(product.pricePerGram || 0) + '/g'; break;
            case 'sachets': stock = product.currentStockCount || 0; maxStock = 100; sd = stock + ' sachets'; pd = BashanPOS.formatCurrency(product.pricePerSachet || 0) + '/sachet'; break;
            case 'cartons': stock = product.currentStockCount || 0; maxStock = 20; const ipc = product.itemsPerCarton || 12; sd = stock + ' cartons (' + (stock * ipc) + ' pcs)'; pd = BashanPOS.formatCurrency(product.pricePerCarton || 0) + '/carton'; break;
            case 'rolls': stock = product.currentStockCount || 0; maxStock = 30; sd = stock + ' rolls'; pd = BashanPOS.formatCurrency(product.pricePerRoll || 0) + '/roll'; break;
            case 'metres': stock = product.currentStockMetres || 0; maxStock = 200; sd = stock.toFixed(2) + ' m'; pd = BashanPOS.formatCurrency(product.pricePerMetre || 0) + '/m'; break;
            default: stock = product.currentStockKg || 0; maxStock = ns * 5; sd = BashanPOS.formatStock(stock, ns); pd = BashanPOS.formatCurrency(product.pricePerKg || 0) + '/kg';
        }
        const soldOut = stock <= 0;
        const lowStock = stock <= thr && stock > 0;
        const pct = Math.min(100, Math.max(0, (stock / maxStock) * 100));
        let sbc = 'good';
        if (pct < 20) sbc = 'low';
        else if (pct < 50) sbc = 'medium';
        const badge = uom !== 'kg' ? '<span class="uom-badge">' + uom + '</span>' : '';
        return '<div class="product-card ' + (soldOut ? 'sold-out' : '') + ' ' + (lowStock && !soldOut ? 'low-stock' : '') + '" data-product-id="' + product.id + '">' +
            (lowStock && !soldOut ? '<span class="low-stock-badge">Low</span>' : '') + badge +
            '<div class="product-name">' + (product.name || 'Unnamed') + '</div>' +
            '<div class="product-category">' + (product.category || 'Uncategorized') + '</div>' +
            '<div class="product-price">' + pd + '</div>' +
            '<div class="product-stock">' + sd + '</div>' +
            '<div class="stock-bar"><div class="stock-bar-fill ' + sbc + '" style="width:' + pct + '%"></div></div></div>';
    }
    
    // ============ HELPERS ============
    getProductStock(product) {
        switch(product.uom || 'kg') {
            case 'kg': return product.currentStockKg || 0;
            case 'bags': return product.currentStockCount || 0;
            case 'litres': return product.currentStockLitres || 0;
            case 'ml': return product.currentStockMl || 0;
            case 'pieces': return product.currentStockCount || 0;
            case 'grams': return product.currentStockGrams || 0;
            case 'sachets': return product.currentStockCount || 0;
            case 'cartons': return product.currentStockCount || 0;
            case 'rolls': return product.currentStockCount || 0;
            case 'metres': return product.currentStockMetres || 0;
            default: return product.currentStockKg || 0;
        }
    }
    
    convertToKg(product, qty) {
        const u = product.uom || 'kg';
        if (u === 'kg') return qty * (product.nguniaKg || 1000);
        if (u === 'bags') return qty * (product.kgPerBag || 50);
        return qty;
    }
    
    calcSubtotal(product, qty, mode) {
        const u = product.uom || 'kg';
        const m = mode || 'unit';
        if (m === 'kg') return qty * (product.pricePerKg || ((product.pricePerBag || 0) / (product.kgPerBag || 50)));
        if (m === 'unit' && u === 'bags') return qty * (product.pricePerBag || 0);
        switch(u) {
            case 'kg': return qty * (product.nguniaKg || 1000) * (product.pricePerKg || 0);
            case 'bags': return qty * (product.pricePerBag || 0);
            case 'litres': return qty * (product.pricePerLitre || 0);
            case 'ml': return qty * (product.pricePer100ml || 0);
            case 'pieces': return qty * (product.pricePerPiece || 0);
            case 'grams': return qty * (product.pricePerGram || 0);
            case 'sachets': return qty * (product.pricePerSachet || 0);
            case 'cartons': return qty * (product.pricePerCarton || 0);
            case 'rolls': return qty * (product.pricePerRoll || 0);
            case 'metres': return qty * (product.pricePerMetre || 0);
            default: return qty * (product.pricePerKg || 0);
        }
    }
    
    getPriceDisplay(item, mode) {
        const m = mode || item.sellMode || 'unit';
        const u = item.uom || 'kg';
        if (m === 'kg') return BashanPOS.formatCurrency(item.pricePerKg || 0) + '/kg';
        switch(u) {
            case 'kg': return BashanPOS.formatCurrency(item.pricePerKg || 0) + '/kg';
            case 'bags': return BashanPOS.formatCurrency(item.pricePerBag || 0) + '/bag';
            case 'litres': return BashanPOS.formatCurrency(item.pricePerLitre || 0) + '/L';
            case 'ml': return BashanPOS.formatCurrency(item.pricePer100ml || 0) + '/100mL';
            case 'pieces': return BashanPOS.formatCurrency(item.pricePerPiece || 0) + '/pc';
            case 'grams': return BashanPOS.formatCurrency(item.pricePerGram || 0) + '/g';
            case 'sachets': return BashanPOS.formatCurrency(item.pricePerSachet || 0) + '/sachet';
            case 'cartons': return BashanPOS.formatCurrency(item.pricePerCarton || 0) + '/carton';
            case 'rolls': return BashanPOS.formatCurrency(item.pricePerRoll || 0) + '/roll';
            case 'metres': return BashanPOS.formatCurrency(item.pricePerMetre || 0) + '/m';
            default: return '';
        }
    }
    
    // ============ CART ============
    addToCart(product) {
        const uom = product.uom || 'kg';
        const existingIdx = this.cart.findIndex(item => item.productId === product.id);
        
        if (existingIdx >= 0) {
            const item = this.cart[existingIdx];
            let newQty = item.qty + 1;
            let currentStock = this.getProductStock(product);
            if (item.sellMode === 'kg') currentStock = product.currentStockKg || 0;
            if (newQty > currentStock) { BashanPOS.showNotification('Not enough stock!', 'warning'); return; }
            item.qty = newQty;
            item.qtyKg = this.convertToKg(product, newQty);
            item.subtotal = this.calcSubtotal(product, newQty, item.sellMode);
        } else {
            let currentStock = this.getProductStock(product);
            if (currentStock <= 0) { BashanPOS.showNotification('Out of stock!', 'error'); return; }
            
            const cartItem = {
                productId: product.id, name: product.name, uom: uom, qty: 1, sellMode: 'unit',
                qtyKg: this.convertToKg(product, 1), subtotal: this.calcSubtotal(product, 1, 'unit'), maxStock: currentStock
            };
            
            switch(uom) {
                case 'kg': cartItem.nguniaSize = product.nguniaKg || this.settings?.nguniaDefault || 1000; cartItem.pricePerKg = product.pricePerKg || 0; break;
                case 'bags': cartItem.kgPerBag = product.kgPerBag || 50; cartItem.pricePerBag = product.pricePerBag || 0; cartItem.pricePerKg = (product.pricePerBag || 0) / (product.kgPerBag || 50); break;
                case 'litres': cartItem.pricePerLitre = product.pricePerLitre || 0; break;
                case 'ml': cartItem.pricePer100ml = product.pricePer100ml || 0; break;
                case 'pieces': cartItem.pricePerPiece = product.pricePerPiece || 0; break;
                case 'grams': cartItem.pricePerGram = product.pricePerGram || 0; break;
                case 'sachets': cartItem.pricePerSachet = product.pricePerSachet || 0; break;
                case 'cartons': cartItem.itemsPerCarton = product.itemsPerCarton || 12; cartItem.pricePerCarton = product.pricePerCarton || 0; break;
                case 'rolls': cartItem.pricePerRoll = product.pricePerRoll || 0; break;
                case 'metres': cartItem.pricePerMetre = product.pricePerMetre || 0; break;
            }
            
            this.cart.push(cartItem);
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
    
    toggleCartMode(index) {
        const item = this.cart[index];
        if (!item || (item.uom !== 'bags' && item.uom !== 'kg')) return;
        item.sellMode = item.sellMode === 'kg' ? 'unit' : 'kg';
        const product = this.products.find(p => p.id === item.productId);
        if (product) item.subtotal = this.calcSubtotal(product, item.qty, item.sellMode);
        this.renderCart();
        this.updateCartSummary();
        this.saveCart();
    }
    
    updateCartQuantity(index, value) {
        const item = this.cart[index];
        if (!item) return;
        const product = this.products.find(p => p.id === item.productId);
        if (!product) return;
        
        let newQty = parseFloat(value) || 0;
        let currentStock = this.getProductStock(product);
        if (item.sellMode === 'kg') currentStock = product.currentStockKg || 0;
        
        if (newQty < 0) { BashanPOS.showNotification('Cannot be negative', 'warning'); this.renderCart(); return; }
        if (newQty > currentStock) { BashanPOS.showNotification('Only ' + currentStock + ' available', 'warning'); newQty = currentStock; }
        if (newQty <= 0) { this.removeFromCart(index); return; }
        
        item.qty = newQty;
        item.qtyKg = this.convertToKg(product, newQty);
        item.subtotal = this.calcSubtotal(product, newQty, item.sellMode);
        this.renderCart();
        this.updateCartSummary();
        this.saveCart();
    }
    
    renderCart() {
        const cc = document.getElementById('cartItems');
        if (!cc) return;
        
        if (this.cart.length === 0) {
            cc.innerHTML = '<div class="cart-empty"><svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><p>No items in basket</p><span>Click products to add</span></div>';
            return;
        }
        
        cc.innerHTML = this.cart.map((item, index) => {
            const qty = item.qty || 0;
            const subtotal = item.subtotal || 0;
            const uom = item.uom || 'kg';
            const mode = item.sellMode || 'unit';
            
            let qtyDisplay = '', unitLabel = '', stepSize = 1, unitName = uom;
            let showToggle = (uom === 'bags' || uom === 'kg');
            let toggleLabel = mode === 'kg' ? '🔄 Switch to ' + (uom === 'bags' ? 'bags' : 'ngunias') : '🔄 Switch to kg';
            
            if (mode === 'kg') {
                qtyDisplay = qty.toFixed(1);
                unitLabel = 'kg';
                stepSize = 0.1;
                unitName = 'kg';
            } else {
                switch(uom) {
                    case 'kg': qtyDisplay = qty.toFixed(3); unitLabel = '1 ngunia = ' + (item.nguniaSize || 1000) + 'kg'; stepSize = 0.001; unitName = 'ngunias'; break;
                    case 'bags': qtyDisplay = Math.round(qty).toString(); unitLabel = (item.kgPerBag || 50) + 'kg per bag'; stepSize = 1; unitName = 'bags'; break;
                    case 'litres': qtyDisplay = qty.toFixed(2); unitLabel = 'per litre'; stepSize = 0.01; unitName = 'litres'; break;
                    case 'ml': qtyDisplay = Math.round(qty).toString(); unitLabel = 'per 100mL'; stepSize = 1; unitName = 'mL'; break;
                    case 'pieces': qtyDisplay = Math.round(qty).toString(); unitLabel = 'per piece'; stepSize = 1; unitName = 'pieces'; break;
                    case 'grams': qtyDisplay = Math.round(qty).toString(); unitLabel = 'per gram'; stepSize = 1; unitName = 'grams'; break;
                    case 'sachets': qtyDisplay = Math.round(qty).toString(); unitLabel = 'per sachet'; stepSize = 1; unitName = 'sachets'; break;
                    case 'cartons': qtyDisplay = Math.round(qty).toString(); unitLabel = (item.itemsPerCarton || 12) + ' items/carton'; stepSize = 1; unitName = 'cartons'; break;
                    case 'rolls': qtyDisplay = Math.round(qty).toString(); unitLabel = 'per roll'; stepSize = 1; unitName = 'rolls'; break;
                    case 'metres': qtyDisplay = qty.toFixed(2); unitLabel = 'per metre'; stepSize = 0.01; unitName = 'metres'; break;
                    default: qtyDisplay = qty.toString(); unitLabel = ''; unitName = 'units';
                }
            }
            
            return '<div class="cart-item">' +
                '<div class="cart-item-header"><span class="cart-item-name">' + item.name + '</span><span class="cart-item-uom">' + uom + (mode === 'kg' ? ' (kg)' : '') + '</span><button class="remove-item-btn" onclick="posSystem.removeFromCart(' + index + ')" title="Remove">×</button></div>' +
                '<div class="cart-item-details"><div class="qty-input-group"><div class="qty-label">Quantity (' + unitName + ')</div><input type="number" class="qty-input" value="' + qtyDisplay + '" step="' + stepSize + '" min="0" onchange="posSystem.updateCartQuantity(' + index + ', this.value)"><div class="qty-unit">' + unitLabel + '</div></div><div class="cart-item-price">' + this.getPriceDisplay(item, mode) + '</div></div>' +
                (showToggle ? '<div class="cart-item-toggle"><button class="toggle-mode-btn" onclick="posSystem.toggleCartMode(' + index + ')">' + toggleLabel + '</button></div>' : '') +
                '<div class="cart-item-subtotal">' + BashanPOS.formatCurrency(subtotal) + '</div></div>';
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
        if (cb) cb.disabled = this.cart.length === 0 || total <= 0;
    }
    
    clearCart() {
        if (this.cart.length === 0) return;
        BashanPOS.showConfirm('Clear all items from basket?').then(ok => {
            if (ok) { this.cart = []; this.renderCart(); this.updateCartSummary(); this.saveCart(); BashanPOS.showNotification('Basket cleared', 'info'); }
        });
    }
    
    saveCart() { sessionStorage.setItem('bashan_cart', JSON.stringify(this.cart)); }
    
    restoreCart() {
        const saved = sessionStorage.getItem('bashan_cart');
        if (saved) {
            try {
                this.cart = JSON.parse(saved);
                this.cart.forEach(item => {
                    const product = this.products.find(p => p.id === item.productId);
                    if (product) {
                        item.maxStock = this.getProductStock(product);
                        item.subtotal = this.calcSubtotal(product, item.qty || 1, item.sellMode);
                        item.qtyKg = this.convertToKg(product, item.qty || 1);
                        switch(item.uom) {
                            case 'kg': item.nguniaSize = product.nguniaKg || 1000; item.pricePerKg = product.pricePerKg || 0; break;
                            case 'bags': item.kgPerBag = product.kgPerBag || 50; item.pricePerBag = product.pricePerBag || 0; item.pricePerKg = (product.pricePerBag || 0) / (product.kgPerBag || 50); break;
                            case 'litres': item.pricePerLitre = product.pricePerLitre || 0; break;
                            case 'ml': item.pricePer100ml = product.pricePer100ml || 0; break;
                            case 'pieces': item.pricePerPiece = product.pricePerPiece || 0; break;
                            case 'grams': item.pricePerGram = product.pricePerGram || 0; break;
                            case 'sachets': item.pricePerSachet = product.pricePerSachet || 0; break;
                            case 'cartons': item.itemsPerCarton = product.itemsPerCarton || 12; item.pricePerCarton = product.pricePerCarton || 0; break;
                            case 'rolls': item.pricePerRoll = product.pricePerRoll || 0; break;
                            case 'metres': item.pricePerMetre = product.pricePerMetre || 0; break;
                        }
                    }
                });
                this.renderCart();
                this.updateCartSummary();
            } catch (e) { console.error('Restore cart error:', e); this.cart = []; }
        }
    }
    
    // ============ COMPLETE SALE ============
    async completeSale() {
        if (this.cart.length === 0) { BashanPOS.showNotification('Basket empty!', 'warning'); return; }
        const subtotal = this.cart.reduce((s, i) => s + (i.subtotal || 0), 0);
        const discount = parseFloat(document.getElementById('discountInput')?.value) || 0;
        const total = Math.max(0, subtotal - discount);
        if (total <= 0) { BashanPOS.showNotification('Total must be > 0', 'warning'); return; }
        if (this.settings?.maxDiscount && discount > this.settings.maxDiscount) { BashanPOS.showNotification('Max discount: ' + BashanPOS.formatCurrency(this.settings.maxDiscount), 'warning'); return; }
        
        for (const item of this.cart) {
            const product = this.products.find(p => p.id === item.productId);
            if (!product) { BashanPOS.showNotification('Product not found: ' + item.name, 'error'); return; }
            const stock = item.sellMode === 'kg' ? (product.currentStockKg || 0) : this.getProductStock(product);
            if (item.qty > stock) { BashanPOS.showNotification('Insufficient stock for ' + item.name, 'error'); return; }
        }
        
        const confirmed = await BashanPOS.showConfirm('Complete sale of ' + BashanPOS.formatCurrency(total) + '?\n\nItems: ' + this.cart.length + '\nDiscount: ' + BashanPOS.formatCurrency(discount));
        if (!confirmed) return;
        
        const paymentMethod = document.getElementById('paymentMethod')?.value || 'Cash';
        const customerName = document.getElementById('customerName')?.value?.trim() || '';
        
        const saleItems = this.cart.map(item => {
            const si = { productId: item.productId, name: item.name, uom: item.uom || 'kg', qty: item.qty, sellMode: item.sellMode || 'unit', price: item.subtotal / (item.qty || 1), subtotal: item.subtotal };
            switch(item.uom) {
                case 'kg': si.qtyNgunia = item.qty; si.qtyKg = item.qtyKg; si.pricePerKg = item.pricePerKg; si.nguniaSize = item.nguniaSize; break;
               case 'bags': 
    si.pricePerBag = item.pricePerBag; 
    si.kgPerBag = item.kgPerBag; 
    if (item.sellMode === 'kg') { 
        si.qtyKg = item.qty; 
        si.pricePerKg = item.pricePerKg; 
    } 
    break;  case 'litres': si.pricePerLitre = item.pricePerLitre; break;
                case 'ml': si.pricePer100ml = item.pricePer100ml; break;
                case 'pieces': si.pricePerPiece = item.pricePerPiece; break;
                case 'grams': si.pricePerGram = item.pricePerGram; break;
                case 'sachets': si.pricePerSachet = item.pricePerSachet; break;
                case 'cartons': si.pricePerCarton = item.pricePerCarton; si.itemsPerCarton = item.itemsPerCarton; break;
                case 'rolls': si.pricePerRoll = item.pricePerRoll; break;
                case 'metres': si.pricePerMetre = item.pricePerMetre; break;
            }
            return si;
        });
        
        const saleData = { items: saleItems, subtotal, discountKsh: discount, total, paymentMethod, customerName, sellerId: this.user.id, sellerName: this.user.name };
        
        const cb = document.getElementById('completeSaleBtn');
        if (cb) { cb.disabled = true; cb.innerHTML = '<div class="loading-spinner"></div>'; }
        
        const result = await BashanPOS.completeSale(saleData);
        
        if (result.success) {
            this.lastSale = { ...saleData, receiptNumber: result.receiptNumber, saleId: result.saleId, timestamp: new Date() };
            this.showSuccessModal();
            this.cart = [];
            this.renderCart();
            this.updateCartSummary();
            this.saveCart();
            const di = document.getElementById('discountInput'); if (di) di.value = '0';
            const cn = document.getElementById('customerName'); if (cn) cn.value = '';
            this.loadTodaySales();
            this.playSuccessSound();
            BashanPOS.showNotification('Sale complete! Receipt: ' + result.receiptNumber, 'success');
        } else {
            BashanPOS.showNotification('Sale failed: ' + result.message, 'error');
        }
        
        if (cb) { cb.disabled = false; cb.innerHTML = '<span>COMPLETE SALE</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'; }
    }
    
    showSuccessModal() {
        const sale = this.lastSale;
        if (!sale) return;
        const itemsList = sale.items.map(item => {
            let qd = '';
            switch(item.uom) {
                case 'kg': qd = (item.qtyKg || 0).toFixed(1) + 'kg'; break;
                case 'bags': qd = item.sellMode === 'kg' ? (item.qty || 0).toFixed(1) + 'kg' : item.qty + ' bags'; break;
                case 'litres': qd = item.qty.toFixed(2) + ' L'; break;
                case 'ml': qd = item.qty.toFixed(0) + ' mL'; break;
                case 'pieces': qd = item.qty + ' pcs'; break;
                case 'grams': qd = item.qty + 'g'; break;
                case 'sachets': qd = item.qty + ' sachets'; break;
                case 'cartons': qd = item.qty + ' cartons'; break;
                case 'rolls': qd = item.qty + ' rolls'; break;
                case 'metres': qd = item.qty.toFixed(2) + ' m'; break;
                default: qd = item.qty;
            }
            return item.name + ': ' + qd + ' - ' + BashanPOS.formatCurrency(item.subtotal);
        }).join('<br>');
        const sd = document.getElementById('saleDetails');
        if (sd) sd.innerHTML = '<p><strong>Receipt:</strong> ' + sale.receiptNumber + '</p><p><strong>Total:</strong> ' + BashanPOS.formatCurrency(sale.total) + '</p><p><strong>Items:</strong> ' + sale.items.length + '</p><p><strong>Payment:</strong> ' + sale.paymentMethod + '</p>' + (sale.customerName ? '<p><strong>Customer:</strong> ' + sale.customerName + '</p>' : '') + '<div style="margin-top:10px;font-size:12px;text-align:left;border-top:1px solid var(--card-border);padding-top:10px;">' + itemsList + '</div>';
        const modal = document.getElementById('successModal');
        if (modal) modal.classList.add('active');
    }
    
    newSale() { const m = document.getElementById('successModal'); if (m) m.classList.remove('active'); const s = document.getElementById('searchProducts'); if (s) s.focus(); }
    
   playSuccessSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.setValueAtTime(1000, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        // Audio not supported - that's okay
    }
}
    
    // ============ RECEIPT ============
    generateReceiptHTML(sale) {
        if (!sale) sale = this.lastSale;
        if (!sale) return '';
        const s = this.settings || {};
        const d = sale.timestamp ? new Date(sale.timestamp) : new Date();
        return '<div style="font-family:monospace;max-width:300px;padding:10px;font-size:12px;"><div style="text-align:center;margin-bottom:15px;"><h2 style="margin:0;font-size:16px;">' + (s.businessName || 'Bashan Livestock Feeds') + '</h2><p style="margin:5px 0;font-size:11px;">' + (s.businessAddress || '') + '</p><p style="margin:5px 0;font-size:11px;">Tel: ' + (s.businessPhone || '') + '</p><hr style="border:1px dashed #ccc;"></div><p><strong>Receipt:</strong> ' + sale.receiptNumber + '</p><p><strong>Date:</strong> ' + d.toLocaleString('en-KE') + '</p><p><strong>Seller:</strong> ' + sale.sellerName + '</p>' + (sale.customerName ? '<p><strong>Customer:</strong> ' + sale.customerName + '</p>' : '') + '<hr style="border:1px dashed #ccc;"><table style="width:100%;font-size:11px;"><thead><tr style="border-bottom:1px solid #ccc;"><th style="text-align:left;">Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead><tbody>' + sale.items.map(item => {
            let qd = '', pd = '';
            switch(item.uom) {
                case 'kg': qd = (item.qtyKg || 0).toFixed(1) + 'kg'; pd = item.pricePerKg || ''; break;
                case 'bags': qd = item.sellMode === 'kg' ? (item.qty || 0).toFixed(1) + 'kg' : item.qty + ' bags'; pd = item.sellMode === 'kg' ? (item.pricePerKg || '') : (item.pricePerBag || ''); break;
                case 'litres': qd = (item.qty || 0).toFixed(2) + ' L'; pd = item.pricePerLitre || ''; break;
                case 'ml': qd = (item.qty || 0).toFixed(0) + ' mL'; pd = item.pricePer100ml || ''; break;
                case 'pieces': qd = item.qty + ' pcs'; pd = item.pricePerPiece || ''; break;
                case 'grams': qd = item.qty + 'g'; pd = item.pricePerGram || ''; break;
                case 'sachets': qd = item.qty + ' sachets'; pd = item.pricePerSachet || ''; break;
                case 'cartons': qd = item.qty + ' cartons'; pd = item.pricePerCarton || ''; break;
                case 'rolls': qd = item.qty + ' rolls'; pd = item.pricePerRoll || ''; break;
                case 'metres': qd = (item.qty || 0).toFixed(2) + ' m'; pd = item.pricePerMetre || ''; break;
                default: qd = item.qty || ''; pd = '';
            }
            return '<tr><td>' + item.name + '</td><td style="text-align:right;">' + qd + '</td><td style="text-align:right;">' + pd + '</td><td style="text-align:right;">' + BashanPOS.formatCurrency(item.subtotal) + '</td></tr>';
        }).join('') + '</tbody></table><hr style="border:1px dashed #ccc;"><p style="text-align:right;"><strong>Subtotal:</strong> ' + BashanPOS.formatCurrency(sale.subtotal) + '</p>' + (sale.discountKsh > 0 ? '<p style="text-align:right;"><strong>Discount:</strong> -' + BashanPOS.formatCurrency(sale.discountKsh) + '</p>' : '') + '<p style="text-align:right;font-size:14px;"><strong>TOTAL:</strong> ' + BashanPOS.formatCurrency(sale.total) + '</p><p style="margin-top:10px;"><strong>Payment:</strong> ' + sale.paymentMethod + '</p><hr style="border:1px dashed #ccc;"><p style="text-align:center;font-size:10px;margin-top:15px;">Thank you for your business!<br>' + (s.receiptFooter || 'Quality Products') + '</p></div>';
    }
    
    printReceipt() { const h = this.generateReceiptHTML(); const w = window.open('', '_blank', 'width=400,height=600'); w.document.write(h); w.document.close(); w.focus(); setTimeout(() => w.print(), 500); }
    
    downloadReceiptPDF() {
        const sale = this.lastSale;
        if (!sale) return;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: [80, 200] });
        const s = this.settings || {};
        let y = 10;
        doc.setFontSize(12); doc.text(s.businessName || 'Bashan Livestock Feeds', 40, y, { align: 'center' }); y += 7;
        doc.setFontSize(8); doc.text('Receipt: ' + sale.receiptNumber, 5, y); y += 4;
        doc.text('Date: ' + new Date(sale.timestamp || Date.now()).toLocaleString('en-KE'), 5, y); y += 4;
        doc.text('Seller: ' + sale.sellerName, 5, y); y += 6;
        sale.items.forEach(item => {
            let qd = '';
            switch(item.uom) { case 'kg': qd = (item.qtyKg||0).toFixed(1)+'kg'; break; case 'bags': qd = item.sellMode==='kg' ? (item.qty||0).toFixed(1)+'kg' : item.qty+' bags'; break; case 'litres': qd = (item.qty||0).toFixed(2)+' L'; break; case 'ml': qd = (item.qty||0).toFixed(0)+' mL'; break; case 'pieces': qd = item.qty+' pcs'; break; case 'grams': qd = item.qty+'g'; break; case 'sachets': qd = item.qty+' sachets'; break; case 'cartons': qd = item.qty+' cartons'; break; case 'rolls': qd = item.qty+' rolls'; break; case 'metres': qd = (item.qty||0).toFixed(2)+' m'; break; default: qd = item.qty; }
            doc.text(item.name + ' (' + qd + ')', 5, y); doc.text(BashanPOS.formatCurrency(item.subtotal), 75, y, { align: 'right' }); y += 4;
        });
        y += 3; doc.line(5, y, 75, y); y += 5;
        doc.text('Subtotal:', 5, y); doc.text(BashanPOS.formatCurrency(sale.subtotal), 75, y, { align: 'right' }); y += 4;
        doc.text('Discount:', 5, y); doc.text('-' + BashanPOS.formatCurrency(sale.discountKsh), 75, y, { align: 'right' }); y += 4;
        doc.setFontSize(10); doc.text('TOTAL:', 5, y); doc.text(BashanPOS.formatCurrency(sale.total), 75, y, { align: 'right' }); y += 6;
        doc.setFontSize(8); doc.text('Payment: ' + sale.paymentMethod, 5, y); y += 8;
        doc.text('Thank you for your business!', 40, y, { align: 'center' });
        doc.save('Receipt_' + sale.receiptNumber + '.pdf');
    }
    
    // ============ REPORTS ============
    openReports() { const o = document.getElementById('reportsOverlay'); if (o) o.classList.add('active'); this.loadReport(); }
    closeReports() { const o = document.getElementById('reportsOverlay'); if (o) o.classList.remove('active'); }
    
    async loadReport() {
        const period = document.getElementById('reportPeriod')?.value || 'today';
        const payment = document.getElementById('reportPayment')?.value || 'all';
        let sd, ed;
        const now = new Date();
        switch (period) {
            case 'today': sd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0); ed = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0,0,0); break;
            case 'yesterday': sd = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1, 0,0,0); ed = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0); break;
            case 'week': const dow = now.getDay(); sd = new Date(now.getFullYear(), now.getMonth(), now.getDate()-dow, 0,0,0); ed = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0,0,0); break;
            case 'month': sd = new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0); ed = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0,0,0); break;
            case 'custom': const si = document.getElementById('startDate')?.value; const ei = document.getElementById('endDate')?.value; if (!si || !ei) { BashanPOS.showNotification('Select both dates', 'warning'); return; } sd = new Date(si + 'T00:00:00'); ed = new Date(ei + 'T23:59:59'); break;
            default: sd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0,0,0); ed = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0,0,0);
        }
        try {
            const st = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
            st('reportRevenue', 'Loading...'); st('reportDiscounts', '...'); st('reportCount', '...'); st('reportAvg', '...');
            const tb = document.getElementById('reportTableBody'); if (tb) tb.innerHTML = '<tr class="no-data"><td colspan="8">Loading...</td></tr>';
            let q = BashanPOS.salesRef.where('timestamp', '>=', sd).where('timestamp', '<', ed).orderBy('timestamp', 'desc');
            if (payment && payment !== 'all') q = q.where('paymentMethod', '==', payment);
            const snap = await q.get();
            const sales = []; snap.forEach(d => sales.push({ id: d.id, ...d.data() }));
            const tr = sales.reduce((s, x) => s + (x.total || 0), 0);
            const td = sales.reduce((s, x) => s + (x.discountKsh || 0), 0);
            const avg = sales.length > 0 ? tr / sales.length : 0;
            st('reportRevenue', BashanPOS.formatCurrency(tr));
            st('reportDiscounts', BashanPOS.formatCurrency(td));
            st('reportCount', sales.length);
            st('reportAvg', BashanPOS.formatCurrency(avg));
            if (tb) {
                if (sales.length === 0) tb.innerHTML = '<tr class="no-data"><td colspan="8"><div style="padding:30px;text-align:center;">📊 No sales found</div></td></tr>';
                else tb.innerHTML = sales.map(sale => {
                    let ds = 'N/A';
                    if (sale.timestamp) try { ds = (sale.timestamp.toDate ? sale.timestamp.toDate() : new Date(sale.timestamp)).toLocaleDateString('en-KE', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch(e) {}
                    return '<tr><td><strong>' + (sale.receiptNumber || 'N/A') + '</strong></td><td>' + ds + '</td><td>' + (sale.items?.length || 0) + ' items</td><td>' + BashanPOS.formatCurrency(sale.subtotal || 0) + '</td><td>' + BashanPOS.formatCurrency(sale.discountKsh || 0) + '</td><td><strong>' + BashanPOS.formatCurrency(sale.total || 0) + '</strong></td><td>' + (sale.paymentMethod || 'Cash') + '</td><td>' + (sale.sellerName || '') + '</td></tr>';
                }).join('');
            }
            this.currentReportData = sales;
        } catch (e) {
            console.error('Report error:', e);
            const tb = document.getElementById('reportTableBody');
            if (tb) tb.innerHTML = '<tr class="no-data"><td colspan="8"><div style="padding:30px;text-align:center;color:var(--danger);">❌ Failed<br>' + e.message + '</div></td></tr>';
        }
    }
    
    exportCSV() {
        if (!this.currentReportData?.length) { BashanPOS.showNotification('No data', 'warning'); return; }
        let csv = 'Receipt,Date,Items,Subtotal,Discount,Total,Payment,Seller\n';
        this.currentReportData.forEach(s => csv += '"' + s.receiptNumber + '","' + BashanPOS.formatDate(s.timestamp) + '",' + s.items.length + ',' + s.subtotal + ',' + (s.discountKsh || 0) + ',' + s.total + ',"' + s.paymentMethod + '","' + s.sellerName + '"\n');
        const b = new Blob([csv], { type: 'text/csv' });
        const u = URL.createObjectURL(b);
        const a = document.createElement('a'); a.href = u; a.download = 'sales_report_' + new Date().toISOString().split('T')[0] + '.csv'; a.click();
        URL.revokeObjectURL(u);
    }
    
    exportPDF() {
        if (!this.currentReportData?.length) { BashanPOS.showNotification('No data', 'warning'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(16); doc.text('Sales Report', 20, 20);
        doc.setFontSize(10); doc.text('Generated: ' + new Date().toLocaleString('en-KE'), 20, 30);
        doc.autoTable({ startY: 40, head: [['Receipt','Date','Items','Subtotal','Discount','Total','Payment']], body: this.currentReportData.map(s => [s.receiptNumber, BashanPOS.formatDate(s.timestamp), s.items.length + ' items', BashanPOS.formatCurrency(s.subtotal), BashanPOS.formatCurrency(s.discountKsh || 0), BashanPOS.formatCurrency(s.total), s.paymentMethod]), theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [26, 86, 50] } });
        doc.save('sales_report_' + new Date().toISOString().split('T')[0] + '.pdf');
    }
    
    printReport() { window.print(); }
    
    // ============ TODAY ============
    async loadTodaySales() {
        const n = new Date();
        const s = new Date(n.getFullYear(), n.getMonth(), n.getDate());
        const e = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
        try {
            const snap = await BashanPOS.salesRef.where('timestamp', '>=', s).where('timestamp', '<', e).get();
            let t = 0; snap.forEach(d => t += d.data().total || 0);
            this.todaySales = { total: t, count: snap.size };
            const tt = document.getElementById('todayTotal'); if (tt) tt.textContent = BashanPOS.formatCurrency(t);
            const tc = document.getElementById('todayCount'); if (tc) tc.textContent = snap.size;
        } catch (e) {}
    }
    
    // ============ LOW STOCK ============
    checkLowStock() {
        const thr = this.settings?.lowStockThreshold || 100;
        this.lowStockProducts = this.products.filter(p => {
            if (p.archived) return false;
            const pt = p.lowStockThreshold || thr;
            const s = this.getProductStock(p);
            return s <= pt && s > 0;
        });
        const ac = document.getElementById('alertCount'); if (ac) ac.textContent = this.lowStockProducts.length || '';
        const ab = document.getElementById('alertBell');
        if (ab) { if (this.lowStockProducts.length > 0) ab.classList.add('has-alerts'); else ab.classList.remove('has-alerts'); }
    }
    
    toggleStockAlerts() {
        const pop = document.getElementById('stockAlertPopup');
        if (!pop) return;
        if (pop.classList.contains('active')) { this.dismissStockAlerts(); return; }
        if (this.lowStockProducts.length === 0) { BashanPOS.showNotification('No alerts', 'info'); return; }
        const body = document.getElementById('alertBody');
        if (body) body.innerHTML = this.lowStockProducts.map(p => {
            let sd = ''; const u = p.uom || 'kg';
            switch(u) { case 'kg': sd = BashanPOS.formatStock(p.currentStockKg||0, p.nguniaKg||1000); break; case 'bags': sd = (p.currentStockCount||0)+' bags'; break; case 'litres': sd = (p.currentStockLitres||0).toFixed(2)+' L'; break; case 'pieces': sd = (p.currentStockCount||0)+' pcs'; break; case 'sachets': sd = (p.currentStockCount||0)+' sachets'; break; case 'cartons': sd = (p.currentStockCount||0)+' cartons'; break; default: sd = (p.currentStockKg||0)+' kg'; }
            return '<div class="alert-product"><span class="alert-product-name">' + p.name + '</span><span class="alert-product-stock">' + sd + '</span></div>';
        }).join('');
        pop.classList.add('active');
        setTimeout(() => this.dismissStockAlerts(), 10000);
    }
    
    dismissStockAlerts() { const p = document.getElementById('stockAlertPopup'); if (p) p.classList.remove('active'); }
    
    destroy() { if (this.productsUnsubscribe) this.productsUnsubscribe(); }
}

let posSystem;
document.addEventListener('DOMContentLoaded', () => { posSystem = new BashanPOSSystem(); window.posSystem = posSystem; });
window.addEventListener('beforeunload', () => { if (posSystem) posSystem.destroy(); });