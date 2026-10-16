// Point of Sale (POS) Controller
const posManager = {
  cart: [],
  discountRate: 0,
  activeCategory: 'All',
  productsList: [],
  customersList: [],

  async initPOS() {
    this.bindEvents();
    await this.loadCustomers();
    await this.loadCategories();
    await this.loadProducts();
    this.renderCart();
  },

  bindEvents() {
    // Search input handler
    const searchInput = document.getElementById('posSearchInput');
    if (searchInput) {
      searchInput.oninput = () => this.filterAndRenderGrid();
      // Handle barcode enter press
      searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleBarcodeScan(searchInput.value.trim());
        }
      };
    }

    const searchClear = document.getElementById('posSearchClear');
    if (searchClear) {
      searchClear.onclick = () => {
        searchInput.value = '';
        this.filterAndRenderGrid();
        searchInput.focus();
      };
    }

    // Clear cart button
    const clearBtn = document.getElementById('posClearCartBtn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        if (this.cart.length > 0 && confirm('Are you sure you want to clear the current cart?')) {
          this.cart = [];
          this.renderCart();
        }
      };
    }

    // Discount rate input
    const discountInput = document.getElementById('posDiscountRate');
    if (discountInput) {
      discountInput.oninput = () => {
        let val = parseFloat(discountInput.value) || 0;
        if (val < 0) val = 0;
        if (val > 100) val = 100;
        this.discountRate = val;
        this.renderCart();
      };
    }

    // Checkout button
    const checkoutBtn = document.getElementById('posCheckoutBtn');
    if (checkoutBtn) {
      checkoutBtn.onclick = () => this.openCheckoutModal();
    }

    // Quick Add Customer button
    const addCustQuickBtn = document.getElementById('posAddCustomerQuickBtn');
    if (addCustQuickBtn) {
      addCustQuickBtn.onclick = () => {
        const modal = new bootstrap.Modal(document.getElementById('customerModal'));
        modal.show();
      };
    }

    // Payment form submit
    const checkoutForm = document.getElementById('posCheckoutForm');
    if (checkoutForm) {
      checkoutForm.onsubmit = (e) => {
        e.preventDefault();
        this.completeSale();
      };
    }

    // Amount tendered live change calculation
    const tenderedInput = document.getElementById('checkoutAmountTendered');
    if (tenderedInput) {
      tenderedInput.oninput = () => this.updateCheckoutChange();
    }

    // Payment method radio change
    const payMethodRadios = document.querySelectorAll('input[name="checkoutPaymentMethod"]');
    payMethodRadios.forEach(radio => {
      radio.onchange = () => {
        const tenderedGroup = document.getElementById('cashTenderedGroup');
        if (radio.value === 'Cash') {
          tenderedGroup.classList.remove('d-none');
        } else {
          // If Card or Bank, amount tendered = total
          const totals = this.calculateTotals();
          tenderedInput.value = totals.total.toFixed(2);
          this.updateCheckoutChange();
        }
      };
    });
  },

  async loadCategories() {
    try {
      const res = await fetch('/api/categories');
      const json = await res.json();
      if (json.success) {
        const container = document.getElementById('posCategoryPills');
        if (container) {
          container.innerHTML = `
            <button class="btn btn-sm btn-primary active-cat" data-category="All" onclick="posManager.selectCategory('All', this)">All</button>
            ${json.data.map(c => `
              <button class="btn btn-sm btn-outline-secondary" data-category="${c.name}" onclick="posManager.selectCategory('${c.name}', this)">${c.name}</button>
            `).join('')}
          `;
        }
      }
    } catch (e) {
      console.error('Failed loading POS categories:', e);
    }
  },

  selectCategory(category, btn) {
    this.activeCategory = category;
    document.querySelectorAll('#posCategoryPills .btn').forEach(b => {
      b.className = 'btn btn-sm btn-outline-secondary';
    });
    btn.className = 'btn btn-sm btn-primary active-cat';
    this.filterAndRenderGrid();
  },

  async loadCustomers() {
    try {
      const res = await fetch('/api/customers');
      const json = await res.json();
      if (json.success) {
        this.customersList = json.data;
        const select = document.getElementById('posCustomerSelect');
        if (select) {
          const currentVal = select.value || '1';
          select.innerHTML = json.data.map(c => `
            <option value="${c.id}">${c.name} ${c.phone ? `(${c.phone})` : ''}</option>
          `).join('');
          select.value = currentVal;
        }
      }
    } catch (e) {
      console.error('Failed loading customers:', e);
    }
  },

  async loadProducts() {
    try {
      const res = await fetch('/api/products');
      const json = await res.json();
      if (json.success) {
        this.productsList = json.data;
        this.filterAndRenderGrid();
      }
    } catch (e) {
      console.error('Failed loading POS products:', e);
    }
  },

  handleBarcodeScan(code) {
    if (!code) return;
    const match = this.productsList.find(p => 
      (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) || 
      p.sku.toLowerCase() === code.toLowerCase()
    );
    if (match) {
      this.addToCart(match.id);
      document.getElementById('posSearchInput').value = '';
      this.filterAndRenderGrid();
    } else {
      app.showToast(`No product found with barcode or SKU: ${code}`, 'warning');
    }
  },

  filterAndRenderGrid() {
    const searchVal = (document.getElementById('posSearchInput')?.value || '').toLowerCase().trim();
    const grid = document.getElementById('posProductGrid');
    if (!grid) return;

    const filtered = this.productsList.filter(p => {
      const matchesCat = this.activeCategory === 'All' || p.category === this.activeCategory;
      const matchesSearch = !searchVal || 
        p.name.toLowerCase().includes(searchVal) || 
        p.sku.toLowerCase().includes(searchVal) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchVal));
      return matchesCat && matchesSearch;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-12 text-center py-5 text-muted">
          <i class="fa-solid fa-box-archive fa-3x mb-2 text-black-50"></i>
          <h6>No matching products</h6>
          <small>Try another keyword, scan barcode, or add new products.</small>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const isOutOfStock = p.stock_quantity <= 0;
      const isLowStock = p.stock_quantity > 0 && p.stock_quantity <= p.reorder_level;
      const badge = isOutOfStock ? '<span class="badge bg-danger product-badge">Out of Stock</span>' :
                    isLowStock ? `<span class="badge bg-warning text-dark product-badge">${p.stock_quantity} left (Low)</span>` :
                    `<span class="badge bg-success-subtle text-success product-badge">${p.stock_quantity} in stock</span>`;

      return `
        <div class="col-6 col-md-4 col-xl-3">
          <div class="card h-100 pos-product-card p-3 d-flex flex-column justify-content-between ${isOutOfStock ? 'out-of-stock' : ''}"
               onclick="posManager.addToCart(${p.id})">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <small class="text-muted font-monospace fs-xs">${p.sku}</small>
                ${badge}
              </div>
              <h6 class="fw-bold mb-1 text-truncate" title="${p.name}">${p.name}</h6>
              <small class="text-muted">${p.category}</small>
            </div>
            <div class="mt-3 d-flex justify-content-between align-items-center">
              <span class="h5 fw-bold text-primary mb-0">${app.formatCurrency(p.selling_price)}</span>
              <button class="btn btn-sm btn-outline-primary rounded-circle" style="width: 32px; height: 32px; padding: 0;">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  addToCart(productId) {
    const product = this.productsList.find(p => p.id === productId);
    if (!product) return;

    const allowNegative = app.settings.allow_negative_stock === 'true';
    const existingIndex = this.cart.findIndex(item => item.product_id === productId);

    if (existingIndex > -1) {
      const currentQty = this.cart[existingIndex].quantity;
      if (!allowNegative && (currentQty + 1) > product.stock_quantity) {
        app.showToast(`Cannot add more. Available stock for "${product.name}" is ${product.stock_quantity}.`, 'danger');
        return;
      }
      this.cart[existingIndex].quantity += 1;
    } else {
      if (!allowNegative && product.stock_quantity < 1) {
        app.showToast(`Product "${product.name}" is currently out of stock.`, 'danger');
        return;
      }
      this.cart.push({
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        unit_price: product.selling_price,
        unit_cost: product.cost_price,
        quantity: 1,
        available_stock: product.stock_quantity
      });
    }

    this.renderCart();
  },

  updateItemQuantity(productId, delta) {
    const index = this.cart.findIndex(item => item.product_id === productId);
    if (index === -1) return;

    const item = this.cart[index];
    const newQty = item.quantity + delta;
    const allowNegative = app.settings.allow_negative_stock === 'true';

    if (newQty <= 0) {
      this.cart.splice(index, 1);
    } else {
      if (delta > 0 && !allowNegative && newQty > item.available_stock) {
        app.showToast(`Cannot exceed available stock (${item.available_stock} units).`, 'warning');
        return;
      }
      item.quantity = newQty;
    }

    this.renderCart();
  },

  removeItem(productId) {
    this.cart = this.cart.filter(item => item.product_id !== productId);
    this.renderCart();
  },

  calculateTotals() {
    let subtotal = 0;
    for (const item of this.cart) {
      subtotal += item.quantity * item.unit_price;
    }
    subtotal = Math.round(subtotal * 100) / 100;

    const discountAmount = Math.round(subtotal * (this.discountRate / 100) * 100) / 100;
    const taxableAmount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

    const taxRate = parseFloat(app.settings.tax_rate) || 0.0;
    const taxAmount = Math.round(taxableAmount * (taxRate / 100) * 100) / 100;
    const total = Math.round((taxableAmount + taxAmount) * 100) / 100;

    return {
      subtotal,
      discountRate: this.discountRate,
      discountAmount,
      taxableAmount,
      taxRate,
      taxAmount,
      total
    };
  },

  renderCart() {
    const tbody = document.getElementById('posCartTableBody');
    const checkoutBtn = document.getElementById('posCheckoutBtn');
    if (!tbody) return;

    if (this.cart.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-5 text-muted">
            <i class="fa-solid fa-cart-arrow-down fa-2x mb-2 text-black-50"></i>
            <div>Cart is empty</div>
            <small class="text-muted">Click products on the left or scan barcode to add</small>
          </td>
        </tr>
      `;
      document.getElementById('posSubtotal').textContent = app.formatCurrency(0);
      document.getElementById('posDiscountAmount').textContent = `-${app.formatCurrency(0)}`;
      document.getElementById('posTaxAmount').textContent = app.formatCurrency(0);
      document.getElementById('posFinalTotal').textContent = app.formatCurrency(0);
      if (checkoutBtn) checkoutBtn.disabled = true;
      return;
    }

    const totals = this.calculateTotals();

    tbody.innerHTML = this.cart.map(item => {
      const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
      return `
        <tr>
          <td>
            <div class="fw-semibold text-truncate" style="max-width: 140px;">${item.name}</div>
            <small class="text-muted font-monospace">${item.sku}</small>
          </td>
          <td class="text-center">
            <div class="input-group input-group-sm justify-content-center" style="width: 85px; margin: 0 auto;">
              <button class="btn btn-outline-secondary px-1" type="button" onclick="posManager.updateItemQuantity(${item.product_id}, -1)">-</button>
              <input type="text" class="form-control text-center px-1 font-monospace" value="${item.quantity}" readonly>
              <button class="btn btn-outline-secondary px-1" type="button" onclick="posManager.updateItemQuantity(${item.product_id}, 1)">+</button>
            </div>
          </td>
          <td class="text-end font-monospace">${app.formatCurrency(item.unit_price)}</td>
          <td class="text-end font-monospace fw-bold">${app.formatCurrency(lineTotal)}</td>
          <td class="text-center">
            <button class="btn btn-link btn-sm text-danger p-0" onclick="posManager.removeItem(${item.product_id})">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    document.getElementById('posSubtotal').textContent = app.formatCurrency(totals.subtotal);
    document.getElementById('posDiscountAmount').textContent = `-${app.formatCurrency(totals.discountAmount)}`;
    document.getElementById('posTaxRateDisplay').textContent = totals.taxRate.toFixed(1);
    document.getElementById('posTaxAmount').textContent = app.formatCurrency(totals.taxAmount);
    document.getElementById('posFinalTotal').textContent = app.formatCurrency(totals.total);

    if (checkoutBtn) checkoutBtn.disabled = false;
  },

  openCheckoutModal() {
    if (this.cart.length === 0) return;

    const totals = this.calculateTotals();
    const modalEl = document.getElementById('posCheckoutModal');
    const modal = new bootstrap.Modal(modalEl);

    document.getElementById('checkoutModalTotal').textContent = app.formatCurrency(totals.total);
    document.getElementById('checkoutModalItemsCount').textContent = `${this.cart.reduce((s, i) => s + i.quantity, 0)} items in cart`;

    const tenderedInput = document.getElementById('checkoutAmountTendered');
    tenderedInput.value = totals.total.toFixed(2);
    this.updateCheckoutChange();

    // Render Quick Cash Buttons ($20, $50, $100, exact)
    const quickButtons = document.getElementById('quickCashButtons');
    const exact = totals.total;
    const next10 = Math.ceil(totals.total / 10) * 10;
    const next20 = Math.ceil(totals.total / 20) * 20;
    const next50 = Math.ceil(totals.total / 50) * 50;

    const amounts = Array.from(new Set([exact, next10, next20, next50].filter(a => a >= exact)));
    quickButtons.innerHTML = amounts.map(amt => `
      <button type="button" class="btn btn-sm btn-outline-primary" onclick="posManager.setAmountTendered(${amt})">
        ${app.formatCurrency(amt)}
      </button>
    `).join('');

    modal.show();
  },

  setAmountTendered(val) {
    const input = document.getElementById('checkoutAmountTendered');
    if (input) {
      input.value = parseFloat(val).toFixed(2);
      this.updateCheckoutChange();
    }
  },

  updateCheckoutChange() {
    const totals = this.calculateTotals();
    const tendered = parseFloat(document.getElementById('checkoutAmountTendered')?.value) || 0;
    const change = Math.max(0, Math.round((tendered - totals.total) * 100) / 100);
    const changeEl = document.getElementById('checkoutChangeDue');
    if (changeEl) {
      changeEl.textContent = app.formatCurrency(change);
    }
  },

  async completeSale() {
    const totals = this.calculateTotals();
    const customerId = document.getElementById('posCustomerSelect')?.value || 1;
    const paymentMethod = document.querySelector('input[name="checkoutPaymentMethod"]:checked')?.value || 'Cash';
    const amountTendered = parseFloat(document.getElementById('checkoutAmountTendered')?.value) || totals.total;
    const notes = document.getElementById('checkoutNotes')?.value || '';

    const payload = {
      customer_id: customerId,
      items: this.cart.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price
      })),
      discount_rate: totals.discountRate,
      discount_amount: totals.discountAmount,
      tax_rate: totals.taxRate,
      amount_paid: amountTendered,
      payment_method: paymentMethod,
      notes
    };

    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        // Handle failed sale (e.g. over-sell rejection)
        app.showToast(result.message || 'Sale transaction failed', 'danger');
        return;
      }

      // Close Checkout Modal
      const checkoutModalEl = document.getElementById('posCheckoutModal');
      const checkoutModal = bootstrap.Modal.getInstance(checkoutModalEl);
      if (checkoutModal) checkoutModal.hide();

      // Clear Cart
      this.cart = [];
      this.discountRate = 0;
      document.getElementById('posDiscountRate').value = '0';
      this.renderCart();

      // Show Receipt Modal
      this.renderAndShowReceipt(result.data);

      // Refresh Products & Dashboard
      await this.loadProducts();
      app.refreshDashboard();

      app.showToast(`Sale completed! Invoice #${result.data.invoice_number}`, 'success');

    } catch (err) {
      app.showToast('Network error processing sale: ' + err.message, 'danger');
    }
  },

  renderAndShowReceipt(saleData) {
    const container = document.getElementById('printableReceipt');
    if (!container) return;

    const b = saleData.business || app.settings;
    const sym = b.currency_symbol || '$';

    container.innerHTML = `
      <div class="receipt-header">
        <h4 class="text-uppercase">${b.name || 'Apex Retail Store'}</h4>
        <div>${b.address || ''}</div>
        <div>Tel: ${b.phone || ''} | Tax ID: ${b.tax_id || ''}</div>
      </div>

      <div class="receipt-meta d-flex justify-content-between">
        <div>
          <div><strong>INVOICE:</strong> ${saleData.invoice_number}</div>
          <div><strong>CUSTOMER:</strong> ${saleData.customer_name}</div>
        </div>
        <div class="text-end">
          <div><strong>DATE:</strong> ${saleData.created_at || new Date().toLocaleString()}</div>
          <div><strong>STATUS:</strong> <span class="badge bg-dark">${saleData.payment_status}</span></div>
        </div>
      </div>

      <table class="receipt-table">
        <thead>
          <tr>
            <th style="text-align: left;">ITEM</th>
            <th style="text-align: center;">QTY</th>
            <th style="text-align: right;">PRICE</th>
            <th style="text-align: right;">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${(saleData.items || []).map(item => `
            <tr>
              <td>${item.product_name}<br><small>${item.sku}</small></td>
              <td style="text-align: center;">${item.quantity}</td>
              <td style="text-align: right;">${sym}${item.unit_price.toFixed(2)}</td>
              <td style="text-align: right;">${sym}${item.line_total.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="receipt-summary">
        <div class="d-flex justify-content-between">
          <span>Subtotal:</span>
          <span>${sym}${saleData.subtotal.toFixed(2)}</span>
        </div>
        ${saleData.discount_amount > 0 ? `
          <div class="d-flex justify-content-between text-danger">
            <span>Discount (${saleData.discount_rate}%):</span>
            <span>-${sym}${saleData.discount_amount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div class="d-flex justify-content-between">
          <span>Tax (${saleData.tax_rate}%):</span>
          <span>${sym}${saleData.tax_amount.toFixed(2)}</span>
        </div>
        <div class="d-flex justify-content-between fw-bold fs-6 mt-1 pt-1 border-top border-dark">
          <span>TOTAL:</span>
          <span>${sym}${saleData.total.toFixed(2)}</span>
        </div>
        <div class="d-flex justify-content-between mt-2 pt-1 border-top border-secondary">
          <span>Payment Method:</span>
          <span>${saleData.payment_method}</span>
        </div>
        <div class="d-flex justify-content-between">
          <span>Amount Paid:</span>
          <span>${sym}${saleData.amount_paid.toFixed(2)}</span>
        </div>
        <div class="d-flex justify-content-between fw-bold">
          <span>Change Returned:</span>
          <span>${sym}${(saleData.change_amount || 0).toFixed(2)}</span>
        </div>
      </div>

      <div class="receipt-footer">
        <div class="barcode-strip mb-2">*${saleData.invoice_number}*</div>
        <div>${b.receipt_footer || 'Thank you for your business!'}</div>
      </div>
    `;

    const receiptModal = new bootstrap.Modal(document.getElementById('receiptModal'));
    receiptModal.show();
  }
};
