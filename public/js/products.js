// Products & Stock Inventory Controller
const productsManager = {
  products: [],
  categories: [],

  init() {
    this.bindEvents();
    this.loadCategories();
    this.loadProducts();
  },

  bindEvents() {
    // Search input
    const search = document.getElementById('prodSearchInput');
    if (search) {
      search.oninput = () => this.filterAndRender();
    }

    // Category filter
    const catFilter = document.getElementById('prodCategoryFilter');
    if (catFilter) {
      catFilter.onchange = () => this.filterAndRender();
    }

    // Low stock toggle
    const lowStockToggle = document.getElementById('prodLowStockToggle');
    if (lowStockToggle) {
      lowStockToggle.onchange = () => this.filterAndRender();
    }

    // Add / Edit Product Form Submit
    const form = document.getElementById('productForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await this.saveProduct();
      };
    }

    // Adjust Stock Form Submit
    const adjustForm = document.getElementById('adjustStockForm');
    if (adjustForm) {
      adjustForm.onsubmit = async (e) => {
        e.preventDefault();
        await this.applyStockAdjustment();
      };
    }
  },

  async loadCategories() {
    try {
      const res = await fetch('/api/categories');
      const json = await res.json();
      if (json.success) {
        this.categories = json.data;
        const filterSelect = document.getElementById('prodCategoryFilter');
        const formSelect = document.getElementById('prodFormCategory');

        if (filterSelect) {
          const currentVal = filterSelect.value || 'All';
          filterSelect.innerHTML = '<option value="All">All Categories</option>' +
            json.data.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
          filterSelect.value = currentVal;
        }

        if (formSelect) {
          formSelect.innerHTML = json.data.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        }
      }
    } catch (e) {
      console.error('Failed loading categories:', e);
    }
  },

  async promptAddCategory() {
    const name = prompt('Enter new category name:');
    if (!name || !name.trim()) return;

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      const json = await res.json();
      if (json.success) {
        app.showToast(`Category "${name}" created`, 'success');
        await this.loadCategories();
        document.getElementById('prodFormCategory').value = name.trim();
      } else {
        app.showToast(json.message || 'Failed creating category', 'danger');
      }
    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  },

  async loadProducts() {
    try {
      const res = await fetch('/api/products');
      const json = await res.json();
      if (json.success) {
        this.products = json.data;

        // Update statistics cards
        document.getElementById('prodStatCount').textContent = json.stats.total_products;
        document.getElementById('prodStatUnits').textContent = json.stats.total_units;
        document.getElementById('prodStatValuation').textContent = app.formatCurrency(json.stats.total_stock_valuation);
        document.getElementById('prodStatLowCount').textContent = json.stats.low_stock_count;

        this.filterAndRender();
      }
    } catch (e) {
      console.error('Failed loading products:', e);
    }
  },

  filterAndRender() {
    const searchVal = (document.getElementById('prodSearchInput')?.value || '').toLowerCase().trim();
    const catVal = document.getElementById('prodCategoryFilter')?.value || 'All';
    const lowStockOnly = document.getElementById('prodLowStockToggle')?.checked || false;

    const filtered = this.products.filter(p => {
      const matchesSearch = !searchVal || 
        p.name.toLowerCase().includes(searchVal) ||
        p.sku.toLowerCase().includes(searchVal) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchVal));
      const matchesCat = catVal === 'All' || p.category === catVal;
      const matchesLowStock = !lowStockOnly || p.stock_quantity <= p.reorder_level;
      return matchesSearch && matchesCat && matchesLowStock;
    });

    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-muted">No products found matching filters</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(p => {
      const isOut = p.stock_quantity <= 0;
      const isLow = p.stock_quantity > 0 && p.stock_quantity <= p.reorder_level;
      const statusBadge = isOut ? '<span class="badge bg-danger">Out of Stock</span>' :
                          isLow ? '<span class="badge bg-warning text-dark">Low Stock</span>' :
                          '<span class="badge bg-success-subtle text-success">Healthy</span>';

      return `
        <tr>
          <td>
            <div class="fw-bold text-dark">${p.name}</div>
            <small class="text-muted">${p.description || ''}</small>
          </td>
          <td><span class="badge bg-light text-dark border font-monospace">${p.sku}</span></td>
          <td><span class="badge bg-secondary-subtle text-secondary">${p.category}</span></td>
          <td class="text-end font-monospace">${app.formatCurrency(p.cost_price)}</td>
          <td class="text-end font-monospace fw-semibold text-primary">${app.formatCurrency(p.selling_price)}</td>
          <td class="text-center font-monospace fw-bold ${isOut ? 'text-danger' : isLow ? 'text-warning' : 'text-dark'}">${p.stock_quantity} ${p.unit}</td>
          <td class="text-center text-muted font-monospace">${p.reorder_level}</td>
          <td class="text-end font-monospace fw-bold text-success">${app.formatCurrency(p.stock_valuation)}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center">
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary" title="Adjust Stock" onclick="productsManager.openAdjustStockModal(${p.id})">
                <i class="fa-solid fa-sliders"></i>
              </button>
              <button class="btn btn-outline-primary" title="Edit Product" onclick="productsManager.openEditProductModal(${p.id})">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn btn-outline-danger" title="Delete Product" onclick="productsManager.deleteProduct(${p.id})">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  openAddProductModal() {
    const form = document.getElementById('productForm');
    form.reset();
    document.getElementById('prodModalId').value = '';
    document.getElementById('productModalTitle').textContent = 'Add New Product';
    document.getElementById('openingStockGroup').classList.remove('d-none');
    document.getElementById('prodFormOpeningStock').value = '0';
    document.getElementById('prodFormReorderLevel').value = '5';
    document.getElementById('prodFormUnit').value = 'pcs';

    this.loadCategories();
    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    modal.show();
  },

  openEditProductModal(id) {
    const product = this.products.find(p => p.id === id);
    if (!product) return;

    document.getElementById('prodModalId').value = product.id;
    document.getElementById('productModalTitle').textContent = `Edit Product: ${product.name}`;
    document.getElementById('prodFormName').value = product.name;
    document.getElementById('prodFormSku').value = product.sku;
    document.getElementById('prodFormBarcode').value = product.barcode || '';
    document.getElementById('prodFormCategory').value = product.category;
    document.getElementById('prodFormCostPrice').value = product.cost_price;
    document.getElementById('prodFormSellingPrice').value = product.selling_price;
    document.getElementById('prodFormReorderLevel').value = product.reorder_level;
    document.getElementById('prodFormUnit').value = product.unit;
    document.getElementById('prodFormDesc').value = product.description || '';

    // Hide opening stock during edit (stock changes must use adjustment or purchase)
    document.getElementById('openingStockGroup').classList.add('d-none');

    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    modal.show();
  },

  async saveProduct() {
    const id = document.getElementById('prodModalId').value;
    const isEdit = Boolean(id);

    const payload = {
      name: document.getElementById('prodFormName').value,
      sku: document.getElementById('prodFormSku').value,
      barcode: document.getElementById('prodFormBarcode').value,
      category: document.getElementById('prodFormCategory').value,
      cost_price: parseFloat(document.getElementById('prodFormCostPrice').value),
      selling_price: parseFloat(document.getElementById('prodFormSellingPrice').value),
      reorder_level: parseFloat(document.getElementById('prodFormReorderLevel').value),
      unit: document.getElementById('prodFormUnit').value,
      description: document.getElementById('prodFormDesc').value
    };

    if (!isEdit) {
      payload.opening_stock = parseFloat(document.getElementById('prodFormOpeningStock').value) || 0;
    }

    try {
      const url = isEdit ? `/api/products/${id}` : '/api/products';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        app.showToast(result.message || 'Failed saving product', 'danger');
        return;
      }

      // Close modal
      const modalEl = document.getElementById('productModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      app.showToast(isEdit ? 'Product updated successfully' : 'Product created with opening stock', 'success');
      await this.loadProducts();
      app.refreshDashboard();

    } catch (e) {
      app.showToast('Network error: ' + e.message, 'danger');
    }
  },

  openAdjustStockModal(id) {
    const product = this.products.find(p => p.id === id);
    if (!product) return;

    document.getElementById('adjustProdId').value = product.id;
    document.getElementById('adjustProdName').textContent = product.name;
    document.getElementById('adjustProdSku').textContent = `SKU: ${product.sku}`;
    document.getElementById('adjustCurrentStock').textContent = `${product.stock_quantity} ${product.unit}`;
    document.getElementById('adjustQty').value = '';
    document.getElementById('adjustNotes').value = '';

    const modal = new bootstrap.Modal(document.getElementById('adjustStockModal'));
    modal.show();
  },

  async applyStockAdjustment() {
    const id = document.getElementById('adjustProdId').value;
    const qty = parseFloat(document.getElementById('adjustQty').value);
    const reason = document.getElementById('adjustReason').value;
    const notes = document.getElementById('adjustNotes').value;

    if (isNaN(qty) || qty === 0) {
      app.showToast('Please specify a non-zero adjustment quantity', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/products/${id}/adjust-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty, reason, notes })
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        app.showToast(result.message || 'Adjustment failed', 'danger');
        return;
      }

      const modalEl = document.getElementById('adjustStockModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      app.showToast(result.message, 'success');
      await this.loadProducts();
      app.refreshDashboard();

    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  },

  async deleteProduct(id) {
    const product = this.products.find(p => p.id === id);
    if (!product) return;

    if (!confirm(`Are you sure you want to delete "${product.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok || !result.success) {
        app.showToast(result.message || 'Cannot delete product', 'danger');
        return;
      }

      app.showToast('Product deleted successfully', 'success');
      await this.loadProducts();
      app.refreshDashboard();
    } catch (e) {
      app.showToast('Error deleting product: ' + e.message, 'danger');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => productsManager.init());
