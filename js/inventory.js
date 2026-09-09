// ============================================
// BASHAAN POS - INVENTORY MANAGEMENT ENGINE
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
        if (!window.BashanPOS) {
            console.error('❌ BashanPOS not loaded. Retrying...');
            setTimeout(() => this.init(), 500);
            return;
        }
        
        this.user = BashanPOS.checkAuth();
        if (!this.user) return;
        
        if (this.user.role !== 'manager') {
            BashanPOS.showNotification('Only managers can access inventory management', 'warning');
            setTimeout(() => window.location.href = 'pos.html', 2000);
            return;
        }
        
        this.settings = await BashanPOS.getSettings();
        
        this.setupUI();
        this.setupEventListeners();
        await this.initializeCategories();
        await this.loadProducts();
        this.loadStats();
        
        BashanPOS.logAudit('INVENTORY_OPEN', 'Inventory page loaded');
        console.log('✅ Inventory System Ready');
    }
    
    setupUI() {
        const userName = document.getElementById('userName');
        const userRole = document.getElementById('userRole');
        if (userName) userName.textContent = this.user.name;
        if (userRole) userRole.textContent = this.user.role;
    }
    
    setupEventListeners() {
        const bind = (id, event, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(event, handler);
        };
        
        bind('searchInventory', 'input', () => this.renderTable());
        bind('filterCategory', 'change', () => this.renderTable());
        bind('filterStatus', 'change', () => this.renderTable());
        bind('exportInventoryBtn', 'click', () => this.exportInventory());
        bind('closeAdjustModal', 'click', () => this.closeAdjustModal());
        bind('cancelAdjustBtn', 'click', () => this.closeAdjustModal());
        bind('addTab', 'click', () => this.setAdjustmentType('add'));
        bind('removeTab', 'click', () => this.setAdjustmentType('remove'));
        bind('adjNgunias', 'input', () => this.calculateAdjustment());
        bind('adjKg', 'input', () => this.calculateAdjustment());
        bind('confirmAdjustBtn', 'click', () => this.confirmAdjustment());
        bind('confirmRemoveBtn', 'click', () => this.confirmAdjustment());
        bind('historyBtn', 'click', () => this.openHistory());
        bind('closeHistoryModal', 'click', () => this.closeHistory());
        bind('historyProduct', 'change', () => this.loadHistory());
        bind('historyType', 'change', () => this.loadHistory());
        bind('exportHistoryBtn', 'click', () => this.exportHistory());
        bind('addProductBtn', 'click', () => this.openAddProduct());
        bind('closeProductModal', 'click', () => this.closeProductModal());
        bind('cancelProductBtn', 'click', () => this.closeProductModal());
        bind('saveProductBtn', 'click', () => this.saveProduct());
        bind('logoutBtn', 'click', () => BashanPOS.logout());
        
        const adjReason = document.getElementById('adjReason');
        if (adjReason) {
            adjReason.addEventListener('change', (e) => {
                const otherGroup = document.getElementById('otherReasonGroup');
                if (otherGroup) otherGroup.style.display = e.target.value === 'Other' ? 'block' : 'none';
            });
        }
        
        this.setupStockInputListeners();
        this.setupCategoryDropdown();
        
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) {
                    overlay.classList.remove('active');
                }
            });
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
            }
        });
    }
    
    // ============ CATEGORIES ============
    async initializeCategories() {
        try {
            const snapshot = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
            
            if (snapshot.empty) {
                console.log('📝 Creating default categories...');
                await this.createDefaultCategories();
                const newSnapshot = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
                this.processCategories(newSnapshot);
            } else {
                this.processCategories(snapshot);
            }
            
            this.populateCategoryDropdowns();
            console.log('✅ Categories loaded:', this.categories.length);
        } catch (error) {
            console.error('❌ Load categories error:', error);
            await this.createDefaultCategories();
            const snapshot = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
            this.processCategories(snapshot);
            this.populateCategoryDropdowns();
        }
    }
    
    processCategories(snapshot) {
        this.categories = [];
        snapshot.forEach(doc => {
            this.categories.push({ id: doc.id, ...doc.data() });
        });
    }
    
    async createDefaultCategories() {
        const defaults = [
            { name: 'Feeds', displayOrder: 0 },
            { name: 'Insecticides', displayOrder: 1 },
            { name: 'Supplements', displayOrder: 2 },
            { name: 'Seeds', displayOrder: 3 },
            { name: 'Equipment', displayOrder: 4 },
            { name: 'Medicines', displayOrder: 5 },
            { name: 'Other', displayOrder: 6 }
        ];
        
        const batch = BashanPOS.db.batch();
        defaults.forEach(cat => {
            const ref = BashanPOS.categoriesRef.doc();
            batch.set(ref, {
                name: cat.name,
                displayOrder: cat.displayOrder,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        
        await batch.commit();
        console.log('✅ Default categories created');
    }
    
    setupCategoryDropdown() {
        const productCategory = document.getElementById('productCategory');
        if (!productCategory) return;
        
        productCategory.addEventListener('change', (e) => {
            const value = e.target.value;
            
            if (value === '__add_new__') {
                const newCat = prompt('Enter new category name:');
                if (newCat && newCat.trim()) {
                    this.addCustomCategory(newCat.trim());
                } else {
                    productCategory.value = '';
                }
            }
        });
    }
    
    async addCustomCategory(categoryName) {
        try {
            const exists = this.categories.find(c => 
                c.name.toLowerCase() === categoryName.toLowerCase()
            );
            
            if (exists) {
                const productCategory = document.getElementById('productCategory');
                if (productCategory) productCategory.value = exists.id;
                return;
            }
            
            const docRef = await BashanPOS.categoriesRef.add({
                name: categoryName,
                displayOrder: this.categories.length,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            const snapshot = await BashanPOS.categoriesRef.orderBy('displayOrder').get();
            this.processCategories(snapshot);
            this.populateCategoryDropdowns();
            
            const productCategory = document.getElementById('productCategory');
            if (productCategory) productCategory.value = docRef.id;
            
            BashanPOS.showNotification('Category "' + categoryName + '" added!', 'success');
            BashanPOS.logAudit('CATEGORY_ADD', 'Added category: ' + categoryName);
        } catch (error) {
            console.error('Add category error:', error);
            BashanPOS.showNotification('Failed to add category', 'error');
        }
    }
    
    populateCategoryDropdowns() {
        const filterSelect = document.getElementById('filterCategory');
        const productSelect = document.getElementById('productCategory');
        const historySelect = document.getElementById('historyProduct');
        
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="all">All Categories</option>';
            this.categories.forEach(cat => {
                filterSelect.innerHTML += '<option value="' + cat.id + '">' + cat.name + '</option>';
            });
        }
        
        if (productSelect) {
            productSelect.innerHTML = '<option value="">Select or type category...</option>';
            this.categories.forEach(cat => {
                productSelect.innerHTML += '<option value="' + cat.id + '">' + cat.name + '</option>';
            });
            productSelect.innerHTML += '<option value="__add_new__" style="color: #4caf50; font-style: italic;">+ Add New Category...</option>';
        }
        
        if (historySelect) {
            historySelect.innerHTML = '<option value="all">All Products</option>';
            this.products.forEach(p => {
                historySelect.innerHTML += '<option value="' + p.id + '">' + p.name + '</option>';
            });
        }
    }
    
    // ============ PRODUCTS ============
    async loadProducts() {
        try {
            const snapshot = await BashanPOS.productsRef.where('archived', '==', false).get();
            this.products = [];
            snapshot.forEach(doc => {
                this.products.push({ id: doc.id, ...doc.data() });
            });
            
            console.log('✅ Products loaded:', this.products.length);
            this.renderTable();
            this.loadStats();
            this.populateCategoryDropdowns();
        } catch (error) {
            console.error('❌ Load products error:', error);
            BashanPOS.showNotification('Failed to load products', 'error');
            
            const tbody = document.getElementById('inventoryTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);"><p>⚠️ Failed to load products</p><p style="font-size:12px;color:var(--danger);">' + error.message + '</p><button onclick="location.reload()" class="outline-btn" style="margin-top:10px;">🔄 Retry</button></td></tr>';
            }
        }
    }
    
    getStockValue(product) {
        const uom = product.uom || 'kg';
        switch(uom) {
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
    
    getFilteredProducts() {
        const searchTerm = (document.getElementById('searchInventory')?.value || '').toLowerCase();
        const categoryFilter = document.getElementById('filterCategory')?.value || 'all';
        const statusFilter = document.getElementById('filterStatus')?.value || 'all';
        
        return this.products.filter(product => {
            const matchesSearch = !searchTerm || 
                (product.name && product.name.toLowerCase().includes(searchTerm));
            const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter;
            
            const stock = this.getStockValue(product);
            const threshold = product.lowStockThreshold || 100;
            
            let matchesStatus = true;
            if (statusFilter === 'in-stock') {
                matchesStatus = stock > threshold;
            } else if (statusFilter === 'low-stock') {
                matchesStatus = stock <= threshold && stock > 0;
            } else if (statusFilter === 'out-of-stock') {
                matchesStatus = stock <= 0;
            }
            
            return matchesSearch && matchesCategory && matchesStatus;
        });
    }
    
    renderTable() {
        const filtered = this.getFilteredProducts();
        const tbody = document.getElementById('inventoryTableBody');
        if (!tbody) return;
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);"><p>📦 No products found</p><p style="font-size:12px;">Try adjusting your filters or add a new product</p></td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(product => this.createTableRow(product)).join('');
        
        tbody.querySelectorAll('.action-btn.adjust').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const productId = e.target.closest('tr').dataset.productId;
                this.openAdjustModal(productId);
            });
        });
        
        tbody.querySelectorAll('.action-btn.edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const productId = e.target.closest('tr').dataset.productId;
                this.openEditProduct(productId);
            });
        });
        
        tbody.querySelectorAll('.action-btn.archive').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const productId = e.target.closest('tr').dataset.productId;
                await this.archiveProduct(productId);
            });
        });
    }
    
    createTableRow(product) {
        const uom = product.uom || 'kg';
        const nguniaSize = product.nguniaKg || this.settings?.nguniaDefault || 1000;
        const threshold = product.lowStockThreshold || this.settings?.lowStockThreshold || 100;
        
        let stock = 0;
        let stockDisplay = '';
        let priceDisplay = '';
        let maxForBar = 100;
        
        switch(uom) {
            case 'kg':
                stock = product.currentStockKg || 0;
                maxForBar = nguniaSize * 10;
                stockDisplay = BashanPOS.formatStock(stock, nguniaSize);
                priceDisplay = BashanPOS.formatCurrency(product.pricePerKg || 0) + '/kg';
                break;
            case 'bags':
                stock = product.currentStockCount || 0;
                maxForBar = 50;
                stockDisplay = stock + ' bags (' + (product.kgPerBag || 50) + 'kg each)';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerBag || 0) + '/bag';
                break;
            case 'litres':
                stock = product.currentStockLitres || 0;
                maxForBar = 100;
                stockDisplay = stock.toFixed(2) + ' litres';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerLitre || 0) + '/L';
                break;
            case 'ml':
                stock = product.currentStockMl || 0;
                maxForBar = 5000;
                stockDisplay = stock.toFixed(0) + ' mL';
                priceDisplay = BashanPOS.formatCurrency(product.pricePer100ml || 0) + '/100mL';
                break;
            case 'pieces':
                stock = product.currentStockCount || 0;
                maxForBar = 100;
                stockDisplay = stock + ' pieces';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerPiece || 0) + '/pc';
                break;
            case 'grams':
                stock = product.currentStockGrams || 0;
                maxForBar = 5000;
                stockDisplay = stock + 'g';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerGram || 0) + '/g';
                break;
            case 'sachets':
                stock = product.currentStockCount || 0;
                maxForBar = 100;
                stockDisplay = stock + ' sachets';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerSachet || 0) + '/sachet';
                break;
            case 'cartons':
                stock = product.currentStockCount || 0;
                maxForBar = 20;
                const ipc = product.itemsPerCarton || 12;
                stockDisplay = stock + ' cartons (' + (stock * ipc) + ' pcs)';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerCarton || 0) + '/carton';
                break;
            case 'rolls':
                stock = product.currentStockCount || 0;
                maxForBar = 30;
                stockDisplay = stock + ' rolls';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerRoll || 0) + '/roll';
                break;
            case 'metres':
                stock = product.currentStockMetres || 0;
                maxForBar = 200;
                stockDisplay = stock.toFixed(2) + ' metres';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerMetre || 0) + '/m';
                break;
            default:
                stock = product.currentStockKg || 0;
                maxForBar = nguniaSize * 10;
                stockDisplay = BashanPOS.formatStock(stock, nguniaSize);
                priceDisplay = BashanPOS.formatCurrency(product.pricePerKg || 0) + '/kg';
        }
        
        let status, statusClass, rowClass, stockBarClass;
        if (stock <= 0) {
            status = 'Out of Stock';
            statusClass = 'out-of-stock';
            rowClass = 'out-of-stock-row';
            stockBarClass = 'low';
        } else if (stock <= threshold) {
            status = 'Low Stock';
            statusClass = 'low-stock';
            rowClass = 'low-stock-row';
            stockBarClass = 'medium';
        } else {
            status = 'In Stock';
            statusClass = 'in-stock';
            rowClass = '';
            stockBarClass = 'good';
        }
        
        const stockPercentage = Math.min(100, Math.max(0, (stock / maxForBar) * 100));
        const categoryName = this.categories.find(c => c.id === product.category)?.name || product.category || 'Uncategorized';
        const uomBadge = '<span class="uom-badge-inline">' + uom + '</span>';
        
        return '<tr class="' + rowClass + '" data-product-id="' + product.id + '">' +
            '<td class="product-name-cell">' + (product.name || 'Unnamed') + ' ' + uomBadge + '</td>' +
            '<td>' + categoryName + '</td>' +
            '<td>' + (uom !== 'kg' ? '-' : (nguniaSize + ' kg')) + '</td>' +
            '<td class="stock-display">' + stockDisplay +
                '<div class="stock-level-bar"><div class="stock-level-fill ' + stockBarClass + '" style="width:' + stockPercentage + '%"></div></div>' +
            '</td>' +
            '<td>' + priceDisplay + '</td>' +
            '<td><span class="status-badge ' + statusClass + '">' + status + '</span></td>' +
            '<td><div class="action-btns">' +
                '<button class="action-btn adjust">📦 Adjust</button>' +
                '<button class="action-btn edit">✏️ Edit</button>' +
                '<button class="action-btn archive">🗑️ Archive</button>' +
            '</div></td>' +
        '</tr>';
    }
    
    loadStats() {
        const threshold = this.settings?.lowStockThreshold || 100;
        const totalProducts = this.products.length;
        
        let lowStock = 0;
        let outOfStock = 0;
        let totalValue = 0;
        
        this.products.forEach(p => {
            const uom = p.uom || 'kg';
            let stock = 0;
            let value = 0;
            const productThreshold = p.lowStockThreshold || threshold;
            
            switch(uom) {
                case 'kg':
                    stock = p.currentStockKg || 0;
                    value = stock * (p.pricePerKg || 0);
                    break;
                case 'bags':
                    stock = p.currentStockCount || 0;
                    value = stock * (p.pricePerBag || 0);
                    break;
                case 'litres':
                    stock = p.currentStockLitres || 0;
                    value = stock * (p.pricePerLitre || 0);
                    break;
                case 'ml':
                    stock = p.currentStockMl || 0;
                    value = stock * (p.pricePer100ml || 0);
                    break;
                case 'pieces':
                    stock = p.currentStockCount || 0;
                    value = stock * (p.pricePerPiece || 0);
                    break;
                case 'grams':
                    stock = p.currentStockGrams || 0;
                    value = stock * (p.pricePerGram || 0);
                    break;
                case 'sachets':
                    stock = p.currentStockCount || 0;
                    value = stock * (p.pricePerSachet || 0);
                    break;
                case 'cartons':
                    stock = p.currentStockCount || 0;
                    value = stock * (p.pricePerCarton || 0);
                    break;
                case 'rolls':
                    stock = p.currentStockCount || 0;
                    value = stock * (p.pricePerRoll || 0);
                    break;
                case 'metres':
                    stock = p.currentStockMetres || 0;
                    value = stock * (p.pricePerMetre || 0);
                    break;
                default:
                    stock = p.currentStockKg || 0;
                    value = stock * (p.pricePerKg || 0);
            }
            
            if (stock <= 0) outOfStock++;
            else if (stock <= productThreshold) lowStock++;
            
            totalValue += value;
        });
        
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setText('totalProducts', totalProducts);
        setText('lowStockCount', lowStock);
        setText('outOfStockCount', outOfStock);
        setText('totalValue', BashanPOS.formatCurrency(totalValue));
    }
    
    // ============ STOCK ADJUSTMENT ============
    openAdjustModal(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;
        
        this.currentAdjustProduct = product;
        this.adjustmentType = 'add';
        
        const uom = product.uom || 'kg';
        let stockDisplay = '';
        let priceDisplay = '';
        
        switch(uom) {
            case 'kg':
                stockDisplay = BashanPOS.formatStock(product.currentStockKg || 0, product.nguniaKg || 1000);
                priceDisplay = BashanPOS.formatCurrency(product.pricePerKg || 0) + '/kg';
                break;
            case 'bags':
                stockDisplay = (product.currentStockCount || 0) + ' bags';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerBag || 0) + '/bag';
                break;
            case 'litres':
                stockDisplay = (product.currentStockLitres || 0).toFixed(2) + ' L';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerLitre || 0) + '/L';
                break;
            case 'ml':
                stockDisplay = (product.currentStockMl || 0).toFixed(0) + ' mL';
                priceDisplay = BashanPOS.formatCurrency(product.pricePer100ml || 0) + '/100mL';
                break;
            case 'pieces':
                stockDisplay = (product.currentStockCount || 0) + ' pieces';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerPiece || 0) + '/pc';
                break;
            case 'grams':
                stockDisplay = (product.currentStockGrams || 0) + 'g';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerGram || 0) + '/g';
                break;
            case 'sachets':
                stockDisplay = (product.currentStockCount || 0) + ' sachets';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerSachet || 0) + '/sachet';
                break;
            case 'cartons':
                stockDisplay = (product.currentStockCount || 0) + ' cartons';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerCarton || 0) + '/carton';
                break;
            case 'rolls':
                stockDisplay = (product.currentStockCount || 0) + ' rolls';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerRoll || 0) + '/roll';
                break;
            case 'metres':
                stockDisplay = (product.currentStockMetres || 0).toFixed(2) + ' m';
                priceDisplay = BashanPOS.formatCurrency(product.pricePerMetre || 0) + '/m';
                break;
            default:
                stockDisplay = BashanPOS.formatStock(product.currentStockKg || 0, 1000);
                priceDisplay = BashanPOS.formatCurrency(product.pricePerKg || 0) + '/kg';
        }
        
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        setText('adjustModalTitle', 'Adjust Stock - ' + product.name);
        
        const infoEl = document.getElementById('adjustProductInfo');
        if (infoEl) {
            infoEl.innerHTML = '<div class="product-name-lg">' + product.name + ' <span class="uom-badge-inline">' + uom + '</span></div>' +
                '<div class="product-meta"><span>Current: ' + stockDisplay + '</span><span>Price: ' + priceDisplay + '</span></div>';
        }
        
        setText('currentStockDisplay', stockDisplay);
        
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        setVal('adjNgunias', '0');
        setVal('adjKg', '0');
        setVal('adjReason', '');
        setVal('adjOtherReason', '');
        setVal('adjNotes', '');
        setText('adjTotalDisplay', '0');
        setText('newStockDisplay', stockDisplay);
        
        const otherGroup = document.getElementById('otherReasonGroup');
        if (otherGroup) otherGroup.style.display = 'none';
        
        this.setAdjustmentType('add');
        
        const modal = document.getElementById('adjustStockModal');
        if (modal) modal.classList.add('active');
    }
    
    setAdjustmentType(type) {
        this.adjustmentType = type;
        
        const addTab = document.getElementById('addTab');
        const removeTab = document.getElementById('removeTab');
        const confirmAdd = document.getElementById('confirmAdjustBtn');
        const confirmRemove = document.getElementById('confirmRemoveBtn');
        const typeText = document.getElementById('adjTypeText');
        
        if (addTab) addTab.classList.toggle('active', type === 'add');
        if (removeTab) removeTab.classList.toggle('active', type === 'remove');
        if (confirmAdd) confirmAdd.style.display = type === 'add' ? 'inline-flex' : 'none';
        if (confirmRemove) confirmRemove.style.display = type === 'remove' ? 'inline-flex' : 'none';
        if (typeText) typeText.textContent = type === 'add' ? 'add' : 'remove';
        
        this.calculateAdjustment();
    }
    
    calculateAdjustment() {
        if (!this.currentAdjustProduct) return;
        
        const nguniaSize = this.currentAdjustProduct.nguniaKg || this.settings?.nguniaDefault || 1000;
        const ngunias = parseFloat(document.getElementById('adjNgunias')?.value) || 0;
        const kg = parseFloat(document.getElementById('adjKg')?.value) || 0;
        const totalKg = (ngunias * nguniaSize) + kg;
        
        const totalDisplay = document.getElementById('adjTotalDisplay');
        if (totalDisplay) {
            totalDisplay.textContent = totalKg.toFixed(2) + ' kg (' + (totalKg / nguniaSize).toFixed(3) + ' ngunias)';
        }
        
        const currentStock = this.currentAdjustProduct.currentStockKg || 0;
        const newStock = this.adjustmentType === 'add' ? currentStock + totalKg : currentStock - totalKg;
        
        const newStockDisplay = document.getElementById('newStockDisplay');
        if (newStockDisplay) {
            newStockDisplay.textContent = BashanPOS.formatStock(Math.max(0, newStock), nguniaSize);
        }
    }
    
    async confirmAdjustment() {
        if (!this.currentAdjustProduct) return;
        
        const product = this.currentAdjustProduct;
        const uom = product.uom || 'kg';
        const nguniaSize = product.nguniaKg || this.settings?.nguniaDefault || 1000;
        const ngunias = parseFloat(document.getElementById('adjNgunias')?.value) || 0;
        const kg = parseFloat(document.getElementById('adjKg')?.value) || 0;
        
        let totalChange = 0;
        let currentStock = 0;
        let unitLabel = '';
        
        switch(uom) {
            case 'kg':
                totalChange = (ngunias * nguniaSize) + kg;
                currentStock = product.currentStockKg || 0;
                unitLabel = 'kg';
                break;
            case 'bags':
                totalChange = ngunias + kg;
                currentStock = product.currentStockCount || 0;
                unitLabel = 'bags';
                break;
            default:
                totalChange = ngunias + kg;
                currentStock = this.getStockValue(product);
                unitLabel = uom;
        }
        
        if (totalChange <= 0) {
            BashanPOS.showNotification('Please enter a quantity', 'warning');
            return;
        }
        
        if (this.adjustmentType === 'remove' && totalChange > currentStock) {
            BashanPOS.showNotification('Cannot remove more than current stock (' + currentStock + ' ' + unitLabel + ')', 'error');
            return;
        }
        
        const reason = document.getElementById('adjReason')?.value || '';
        const otherReason = document.getElementById('adjOtherReason')?.value || '';
        
        if (!reason) {
            BashanPOS.showNotification('Please select a reason', 'warning');
            return;
        }
        
        const finalReason = reason === 'Other' ? otherReason : reason;
        if (reason === 'Other' && !otherReason) {
            BashanPOS.showNotification('Please specify the reason', 'warning');
            return;
        }
        
        const notes = document.getElementById('adjNotes')?.value || '';
        const newStock = this.adjustmentType === 'add' ? currentStock + totalChange : currentStock - totalChange;
        
        const confirmed = await BashanPOS.showConfirm(
            (this.adjustmentType === 'add' ? 'Add' : 'Remove') + ' ' + totalChange + ' ' + unitLabel + ' ' +
            (this.adjustmentType === 'add' ? 'to' : 'from') + ' ' + product.name + '?\n\n' +
            'Current: ' + currentStock + ' ' + unitLabel + '\n' +
            'New: ' + newStock + ' ' + unitLabel + '\n\n' +
            'Reason: ' + finalReason
        );
        
        if (!confirmed) return;
        
        const result = await BashanPOS.updateStock(
            product.id, newStock, finalReason, notes,
            this.user.name, this.user.id, uom
        );
        
        if (result.success) {
            BashanPOS.showNotification('Stock adjusted successfully!', 'success');
            this.closeAdjustModal();
            await this.loadProducts();
        } else {
            BashanPOS.showNotification('Failed to adjust stock: ' + result.message, 'error');
        }
    }
    
    closeAdjustModal() {
        const modal = document.getElementById('adjustStockModal');
        if (modal) modal.classList.remove('active');
        this.currentAdjustProduct = null;
    }
    
    // ============ ADD/EDIT PRODUCT ============
    openAddProduct() {
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        
        setText('productModalTitle', 'Add New Product');
        setVal('editProductId', '');
        setVal('productName', '');
        setVal('productCategory', '');
        setVal('productUOM', 'kg');
        setVal('productUOMHidden', 'kg');
        setVal('productPrice', '');
        setVal('productNguniaSize', this.settings?.nguniaDefault || 1000);
        setVal('productInitNgunias', '0');
        setVal('productInitKg', '0');
        setVal('productInitBags', '0');
        setVal('productInitVolume', '0');
        setVal('productInitCount', '0');
        setVal('productInitCartons', '0');
        setVal('productInitLength', '0');
        setVal('kgPerBag', '50');
        setVal('itemsPerCarton', '12');
        setVal('productThreshold', this.settings?.lowStockThreshold || 100);
        
        this.handleUOMChange();
        
        const modal = document.getElementById('addProductModal');
        if (modal) modal.classList.add('active');
    }
    
    openEditProduct(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;
        
        const uom = product.uom || 'kg';
        const nguniaSize = product.nguniaKg || this.settings?.nguniaDefault || 1000;
        
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        
        setText('productModalTitle', 'Edit Product');
        setVal('editProductId', product.id);
        setVal('productName', product.name || '');
        setVal('productCategory', product.category || '');
        setVal('productUOM', uom);
        setVal('productUOMHidden', uom);
        setVal('productNguniaSize', nguniaSize);
        setVal('productThreshold', product.lowStockThreshold || 100);
        
        // Set price and stock based on UOM
        switch(uom) {
            case 'kg':
                setVal('productPrice', product.pricePerKg || '');
                setVal('productInitNgunias', Math.floor((product.currentStockKg || 0) / nguniaSize));
                setVal('productInitKg', ((product.currentStockKg || 0) % nguniaSize).toFixed(2));
                break;
            case 'bags':
                setVal('productPrice', product.pricePerBag || '');
                setVal('productInitBags', product.currentStockCount || 0);
                setVal('kgPerBag', product.kgPerBag || 50);
                break;
            case 'litres':
                setVal('productPrice', product.pricePerLitre || '');
                setVal('productInitVolume', product.currentStockLitres || 0);
                break;
            case 'ml':
                setVal('productPrice', product.pricePer100ml || '');
                setVal('productInitVolume', product.currentStockMl || 0);
                break;
            case 'pieces':
                setVal('productPrice', product.pricePerPiece || '');
                setVal('productInitCount', product.currentStockCount || 0);
                break;
            case 'grams':
                setVal('productPrice', product.pricePerGram || '');
                setVal('productInitCount', product.currentStockGrams || 0);
                break;
            case 'sachets':
                setVal('productPrice', product.pricePerSachet || '');
                setVal('productInitCount', product.currentStockCount || 0);
                break;
            case 'cartons':
                setVal('productPrice', product.pricePerCarton || '');
                setVal('productInitCartons', product.currentStockCount || 0);
                setVal('itemsPerCarton', product.itemsPerCarton || 12);
                break;
            case 'rolls':
                setVal('productPrice', product.pricePerRoll || '');
                setVal('productInitLength', product.currentStockCount || 0);
                break;
            case 'metres':
                setVal('productPrice', product.pricePerMetre || '');
                setVal('productInitLength', product.currentStockMetres || 0);
                break;
            default:
                setVal('productPrice', product.pricePerKg || '');
        }
        
        this.handleUOMChange();
        
        const modal = document.getElementById('addProductModal');
        if (modal) modal.classList.add('active');
    }
    
    async saveProduct() {
        const getVal = (id) => document.getElementById(id)?.value || '';
        const getNum = (id) => parseFloat(document.getElementById(id)?.value) || 0;
        const getInt = (id) => parseInt(document.getElementById(id)?.value) || 0;
        
        const editId = getVal('editProductId');
        const name = getVal('productName').trim();
        const category = getVal('productCategory');
        const uom = getVal('productUOM');
        const price = getNum('productPrice');
        const threshold = getInt('productThreshold');
        
        if (!name) { BashanPOS.showNotification('Product name is required', 'warning'); return; }
        if (isNaN(price) || price <= 0) { BashanPOS.showNotification('Valid price is required', 'warning'); return; }
        
        let stockQuantity = 0;
        let productData = {
            name: name,
            category: category || '',
            uom: uom,
            lowStockThreshold: threshold,
            archived: false,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        switch(uom) {
            case 'kg':
                const ngunias = getNum('productInitNgunias');
                const extraKg = getNum('productInitKg');
                const nguniaSize = getInt('productNguniaSize');
                if (isNaN(nguniaSize) || nguniaSize <= 0) { BashanPOS.showNotification('Valid ngunia size is required', 'warning'); return; }
                stockQuantity = (ngunias * nguniaSize) + extraKg;
                productData.nguniaKg = nguniaSize;
                productData.pricePerKg = price;
                productData.currentStockKg = stockQuantity;
                break;
            case 'bags':
                const bags = getInt('productInitBags');
                const kgPerBag = getNum('kgPerBag');
                if (isNaN(kgPerBag) || kgPerBag <= 0) { BashanPOS.showNotification('Valid weight per bag is required', 'warning'); return; }
                stockQuantity = bags;
                productData.kgPerBag = kgPerBag;
                productData.pricePerBag = price;
                productData.currentStockCount = bags;
                productData.currentStockKg = bags * kgPerBag;
                break;
            case 'litres':
                stockQuantity = getNum('productInitVolume');
                productData.pricePerLitre = price;
                productData.currentStockLitres = stockQuantity;
                break;
            case 'ml':
                stockQuantity = getNum('productInitVolume');
                productData.pricePer100ml = price;
                productData.currentStockMl = stockQuantity;
                break;
            case 'pieces':
                stockQuantity = getInt('productInitCount');
                productData.pricePerPiece = price;
                productData.currentStockCount = stockQuantity;
                break;
            case 'grams':
                stockQuantity = getInt('productInitCount');
                productData.pricePerGram = price;
                productData.currentStockGrams = stockQuantity;
                break;
            case 'sachets':
                stockQuantity = getInt('productInitCount');
                productData.pricePerSachet = price;
                productData.currentStockCount = stockQuantity;
                break;
            case 'cartons':
                const cartons = getInt('productInitCartons');
                const itemsPerCarton = getInt('itemsPerCarton');
                if (isNaN(itemsPerCarton) || itemsPerCarton < 1) { BashanPOS.showNotification('Valid items per carton is required', 'warning'); return; }
                stockQuantity = cartons;
                productData.itemsPerCarton = itemsPerCarton;
                productData.pricePerCarton = price;
                productData.currentStockCount = cartons;
                productData.currentStockPieces = cartons * itemsPerCarton;
                break;
            case 'rolls':
                stockQuantity = getNum('productInitLength');
                productData.pricePerRoll = price;
                productData.currentStockCount = stockQuantity;
                break;
            case 'metres':
                stockQuantity = getNum('productInitLength');
                productData.pricePerMetre = price;
                productData.currentStockMetres = stockQuantity;
                break;
        }
        
        if (isNaN(stockQuantity) || stockQuantity < 0) {
            BashanPOS.showNotification('Invalid stock calculation', 'error');
            return;
        }
        
        console.log('💾 Saving product:', productData);
        
        try {
            if (editId) {
                await BashanPOS.productsRef.doc(editId).update(productData);
                BashanPOS.showNotification('Product updated successfully!', 'success');
                BashanPOS.logAudit('PRODUCT_EDIT', 'Edited product: ' + name + ' (' + uom + ')');
            } else {
                productData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                await BashanPOS.productsRef.add(productData);
                BashanPOS.showNotification('Product added successfully!', 'success');
                BashanPOS.logAudit('PRODUCT_ADD', 'Added product: ' + name + ' (' + uom + ')');
            }
            
            this.closeProductModal();
            await this.loadProducts();
        } catch (error) {
            console.error('❌ Save product error:', error);
            BashanPOS.showNotification('Failed to save product: ' + error.message, 'error');
        }
    }
    
    handleUOMChange() {
        const uomEl = document.getElementById('productUOM');
        const uomHidden = document.getElementById('productUOMHidden');
        if (!uomEl) return;
        
        const uom = uomEl.value;
        if (uomHidden) uomHidden.value = uom;
        
        const groups = [
            'stockKgInputs', 'stockBagsInputs', 'stockVolumeInputs',
            'stockCountInputs', 'stockCartonInputs', 'stockLengthInputs',
            'nguniaSizeGroup', 'kgPerBagGroup'
        ];
        groups.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        
        const setLabel = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'flex'; };
        const showBlock = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };
        
        switch(uom) {
            case 'kg':
                show('stockKgInputs');
                showBlock('nguniaSizeGroup');
                setLabel('priceLabel', 'Price per Kilogram (KSH) *');
                setLabel('priceHint', 'Enter the price per kg');
                setLabel('mainUnitLabel1', 'Ngunias/Bags');
                setLabel('thresholdLabel', 'Low Stock Threshold (kg)');
                setLabel('thresholdHint', 'Alert when stock falls below this amount in kg');
                setVal('productThreshold', this.settings?.lowStockThreshold || 100);
                break;
            case 'bags':
                show('stockBagsInputs');
                showBlock('kgPerBagGroup');
                setLabel('priceLabel', 'Price per Bag (KSH) *');
                setLabel('priceHint', 'Enter the price per bag');
                setLabel('thresholdLabel', 'Low Stock Threshold (bags)');
                setLabel('thresholdHint', 'Alert when stock falls below this many bags');
                setVal('productThreshold', 5);
                break;
            case 'litres':
                show('stockVolumeInputs');
                setLabel('volumeLabel', 'Quantity (Litres)');
                setLabel('priceLabel', 'Price per Litre (KSH) *');
                setLabel('priceHint', 'Enter the price per litre');
                setLabel('thresholdLabel', 'Low Stock Threshold (litres)');
                setLabel('thresholdHint', 'Alert when stock falls below this amount in litres');
                setVal('productThreshold', 10);
                break;
            case 'ml':
                show('stockVolumeInputs');
                setLabel('volumeLabel', 'Quantity (Millilitres)');
                setLabel('priceLabel', 'Price per 100mL (KSH) *');
                setLabel('priceHint', 'Enter the price per 100mL');
                setLabel('thresholdLabel', 'Low Stock Threshold (mL)');
                setLabel('thresholdHint', 'Alert when stock falls below this amount in mL');
                setVal('productThreshold', 500);
                break;
            case 'pieces':
                show('stockCountInputs');
                setLabel('countLabel', 'Quantity (Pieces)');
                setLabel('priceLabel', 'Price per Piece (KSH) *');
                setLabel('priceHint', 'Enter the price per piece');
                setLabel('thresholdLabel', 'Low Stock Threshold (pieces)');
                setLabel('thresholdHint', 'Alert when stock falls below this many pieces');
                setVal('productThreshold', 10);
                break;
            case 'grams':
                show('stockCountInputs');
                setLabel('countLabel', 'Quantity (Grams)');
                setLabel('priceLabel', 'Price per Gram (KSH) *');
                setLabel('priceHint', 'Enter the price per gram');
                setLabel('thresholdLabel', 'Low Stock Threshold (grams)');
                setLabel('thresholdHint', 'Alert when stock falls below this amount in grams');
                setVal('productThreshold', 500);
                break;
            case 'sachets':
                show('stockCountInputs');
                setLabel('countLabel', 'Quantity (Sachets/Packets)');
                setLabel('priceLabel', 'Price per Sachet (KSH) *');
                setLabel('priceHint', 'Enter the price per sachet/packet');
                setLabel('thresholdLabel', 'Low Stock Threshold (sachets)');
                setLabel('thresholdHint', 'Alert when stock falls below this many sachets');
                setVal('productThreshold', 20);
                break;
            case 'cartons':
                show('stockCartonInputs');
                setLabel('priceLabel', 'Price per Carton (KSH) *');
                setLabel('priceHint', 'Enter the price per carton');
                setLabel('thresholdLabel', 'Low Stock Threshold (cartons)');
                setLabel('thresholdHint', 'Alert when stock falls below this many cartons');
                setVal('productThreshold', 2);
                break;
            case 'rolls':
                show('stockLengthInputs');
                setLabel('priceLabel', 'Price per Roll (KSH) *');
                setLabel('priceHint', 'Enter the price per roll');
                setLabel('thresholdLabel', 'Low Stock Threshold (rolls)');
                setLabel('thresholdHint', 'Alert when stock falls below this many rolls');
                setVal('productThreshold', 3);
                break;
            case 'metres':
                show('stockLengthInputs');
                setLabel('priceLabel', 'Price per Metre (KSH) *');
                setLabel('priceHint', 'Enter the price per metre');
                setLabel('thresholdLabel', 'Low Stock Threshold (metres)');
                setLabel('thresholdHint', 'Alert when stock falls below this many metres');
                setVal('productThreshold', 20);
                break;
        }
        
        this.updateStockTotalDisplay();
    }
    
    setupStockInputListeners() {
        const stockInputs = [
            'productInitNgunias', 'productInitKg', 'productInitBags',
            'productInitVolume', 'productInitCount', 'productInitCartons',
            'itemsPerCarton', 'productInitLength', 'productNguniaSize', 'kgPerBag'
        ];
        
        stockInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => this.updateStockTotalDisplay());
            }
        });
    }
    
    updateStockTotalDisplay() {
        const uom = document.getElementById('productUOM')?.value || 'kg';
        const totalDisplay = document.getElementById('totalStockDisplay');
        if (!totalDisplay) return;
        
        let displayText = '';
        
        switch(uom) {
            case 'kg':
                const ngunias = parseFloat(document.getElementById('productInitNgunias')?.value) || 0;
                const extraKg = parseFloat(document.getElementById('productInitKg')?.value) || 0;
                const nguniaSize = parseInt(document.getElementById('productNguniaSize')?.value) || 1000;
                const totalKg = (ngunias * nguniaSize) + extraKg;
                displayText = totalKg.toFixed(2) + ' kg (' + (totalKg / nguniaSize).toFixed(3) + ' ngunias)';
                break;
            case 'bags':
                const bags = parseInt(document.getElementById('productInitBags')?.value) || 0;
                const kgPerBag = parseFloat(document.getElementById('kgPerBag')?.value) || 50;
                const bagsTotalKg = bags * kgPerBag;
                const bagsTotalEl = document.getElementById('productBagsTotalKg');
                if (bagsTotalEl) bagsTotalEl.value = bagsTotalKg.toFixed(2);
                displayText = bags + ' bags (' + bagsTotalKg.toFixed(2) + ' kg total)';
                break;
            case 'litres':
                displayText = (parseFloat(document.getElementById('productInitVolume')?.value) || 0).toFixed(2) + ' litres';
                break;
            case 'ml':
                displayText = (parseFloat(document.getElementById('productInitVolume')?.value) || 0).toFixed(0) + ' mL';
                break;
            case 'pieces':
            case 'grams':
                displayText = (parseInt(document.getElementById('productInitCount')?.value) || 0) + ' ' + uom;
                break;
            case 'sachets':
                displayText = (parseInt(document.getElementById('productInitCount')?.value) || 0) + ' sachets';
                break;
            case 'cartons':
                const cartons = parseInt(document.getElementById('productInitCartons')?.value) || 0;
                const ipc = parseInt(document.getElementById('itemsPerCarton')?.value) || 12;
                displayText = cartons + ' cartons (' + (cartons * ipc) + ' total items)';
                break;
            case 'rolls':
                displayText = (parseFloat(document.getElementById('productInitLength')?.value) || 0) + ' rolls';
                break;
            case 'metres':
                displayText = (parseFloat(document.getElementById('productInitLength')?.value) || 0).toFixed(2) + ' metres';
                break;
        }
        
        totalDisplay.textContent = displayText;
    }
    
    closeProductModal() {
        const modal = document.getElementById('addProductModal');
        if (modal) modal.classList.remove('active');
    }
    
    async archiveProduct(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;
        
        const confirmed = await BashanPOS.showConfirm('Archive "' + product.name + '"?\n\nThis product will be hidden but not deleted.');
        if (!confirmed) return;
        
        try {
            await BashanPOS.productsRef.doc(productId).update({
                archived: true,
                archivedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            BashanPOS.showNotification('Product archived', 'success');
            BashanPOS.logAudit('PRODUCT_ARCHIVE', 'Archived product: ' + product.name);
            await this.loadProducts();
        } catch (error) {
            BashanPOS.showNotification('Failed to archive product', 'error');
        }
    }
    
    // ============ STOCK HISTORY ============
    async openHistory() {
        const modal = document.getElementById('historyModal');
        if (modal) modal.classList.add('active');
        await this.loadHistory();
    }
    
    async loadHistory() {
        try {
            const productFilter = document.getElementById('historyProduct')?.value || 'all';
            const typeFilter = document.getElementById('historyType')?.value || 'all';
            
            let query = BashanPOS.stockLogRef.orderBy('timestamp', 'desc').limit(200);
            if (productFilter !== 'all') {
                query = query.where('productId', '==', productFilter);
            }
            
            const snapshot = await query.get();
            this.historyData = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (typeFilter === 'all' || data.type === typeFilter) {
                    this.historyData.push({ id: doc.id, ...data });
                }
            });
            
            this.renderHistory();
        } catch (error) {
            console.error('Load history error:', error);
            const tbody = document.getElementById('historyTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;">Failed to load history</td></tr>';
        }
    }
    
    renderHistory() {
        const tbody = document.getElementById('historyTableBody');
        if (!tbody) return;
        
        if (this.historyData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;">No stock movements found</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.historyData.map(log => {
            const uom = log.uom || 'kg';
            let qtyDisplay = '';
            
            switch(uom) {
                case 'kg': qtyDisplay = (log.quantityKg || 0).toFixed(2) + ' kg'; break;
                case 'bags': qtyDisplay = (log.quantityBags || 0) + ' bags'; break;
                case 'litres': qtyDisplay = (log.quantityLitres || 0).toFixed(2) + ' L'; break;
                case 'ml': qtyDisplay = (log.quantityMl || 0).toFixed(0) + ' mL'; break;
                case 'pieces': qtyDisplay = (log.quantityPieces || 0) + ' pcs'; break;
                case 'grams': qtyDisplay = (log.quantityGrams || 0) + 'g'; break;
                case 'sachets': qtyDisplay = (log.quantitySachets || 0) + ' sachets'; break;
                case 'cartons': qtyDisplay = (log.quantityCartons || 0) + ' cartons'; break;
                case 'rolls': qtyDisplay = (log.quantityRolls || 0) + ' rolls'; break;
                case 'metres': qtyDisplay = (log.quantityMetres || 0).toFixed(2) + ' m'; break;
                default: qtyDisplay = (log.quantityKg || 0).toFixed(2) + ' kg';
            }
            
            const before = log.beforeStock || 0;
            const after = log.afterStock || 0;
            
            return '<tr>' +
                '<td>' + BashanPOS.formatDate(log.timestamp) + '</td>' +
                '<td>' + log.productName + '</td>' +
                '<td><span class="type-badge ' + log.type + '">' + (log.type === 'add' ? 'Added' : 'Removed') + '</span></td>' +
                '<td>' + qtyDisplay + '</td>' +
                '<td>' + before + '</td>' +
                '<td>' + after + '</td>' +
                '<td>' + log.reason + '</td>' +
                '<td>' + log.doneByName + '</td>' +
            '</tr>';
        }).join('');
    }
    
    closeHistory() {
        const modal = document.getElementById('historyModal');
        if (modal) modal.classList.remove('active');
    }
    
    // ============ EXPORT ============
    exportInventory() {
        const filtered = this.getFilteredProducts();
        if (filtered.length === 0) {
            BashanPOS.showNotification('No data to export', 'warning');
            return;
        }
        
        let csv = 'Product,Category,UOM,Current Stock,Price,Stock Value,Status\n';
        
        filtered.forEach(p => {
            const uom = p.uom || 'kg';
            let stock = 0, price = 0, value = 0, stockDisplay = '';
            const threshold = p.lowStockThreshold || 100;
            const categoryName = this.categories.find(c => c.id === p.category)?.name || 'N/A';
            
            switch(uom) {
                case 'kg': stock = p.currentStockKg || 0; price = p.pricePerKg || 0; stockDisplay = stock + ' kg'; break;
                case 'bags': stock = p.currentStockCount || 0; price = p.pricePerBag || 0; stockDisplay = stock + ' bags'; break;
                case 'litres': stock = p.currentStockLitres || 0; price = p.pricePerLitre || 0; stockDisplay = stock + ' L'; break;
                case 'ml': stock = p.currentStockMl || 0; price = p.pricePer100ml || 0; stockDisplay = stock + ' mL'; break;
                case 'pieces': stock = p.currentStockCount || 0; price = p.pricePerPiece || 0; stockDisplay = stock + ' pcs'; break;
                case 'grams': stock = p.currentStockGrams || 0; price = p.pricePerGram || 0; stockDisplay = stock + 'g'; break;
                case 'sachets': stock = p.currentStockCount || 0; price = p.pricePerSachet || 0; stockDisplay = stock + ' sachets'; break;
                case 'cartons': stock = p.currentStockCount || 0; price = p.pricePerCarton || 0; stockDisplay = stock + ' cartons'; break;
                case 'rolls': stock = p.currentStockCount || 0; price = p.pricePerRoll || 0; stockDisplay = stock + ' rolls'; break;
                case 'metres': stock = p.currentStockMetres || 0; price = p.pricePerMetre || 0; stockDisplay = stock + ' m'; break;
                default: stock = p.currentStockKg || 0; price = p.pricePerKg || 0; stockDisplay = stock + ' kg';
            }
            
            value = stock * price;
            const status = stock <= 0 ? 'Out of Stock' : (stock <= threshold ? 'Low Stock' : 'In Stock');
            
            csv += '"' + p.name + '","' + categoryName + '","' + uom + '",' + stock + ',' + price + ',' + value + ',"' + status + '"\n';
        });
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inventory_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        
        BashanPOS.showNotification('Inventory exported!', 'success');
    }
    
    exportHistory() {
        if (this.historyData.length === 0) {
            BashanPOS.showNotification('No history to export', 'warning');
            return;
        }
        
        let csv = 'Date,Product,Type,Quantity,Before,After,Reason,Done By\n';
        
        this.historyData.forEach(log => {
            const uom = log.uom || 'kg';
            let qty = '';
            switch(uom) {
                case 'kg': qty = (log.quantityKg || 0).toFixed(2) + ' kg'; break;
                case 'bags': qty = (log.quantityBags || 0) + ' bags'; break;
                case 'litres': qty = (log.quantityLitres || 0).toFixed(2) + ' L'; break;
                default: qty = (log.quantityKg || 0) + ' ' + uom;
            }
            
            csv += '"' + BashanPOS.formatDate(log.timestamp) + '","' + log.productName + '","' + log.type + '",' +
                   '"' + qty + '",' + (log.beforeStock || 0) + ',' + (log.afterStock || 0) + ',' +
                   '"' + log.reason + '","' + log.doneByName + '"\n';
        });
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'stock_history_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Initialize
let inventorySystem;
document.addEventListener('DOMContentLoaded', () => {
    inventorySystem = new InventorySystem();
    window.inventorySystem = inventorySystem;
});