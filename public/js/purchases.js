// Purchases & Stock Receiving Controller
const purchasesManager = {
  purchases: [],
  suppliers: [],
  products: [],

  init() {
    this.bindEvents();
    this.loadSuppliers();
    this.loadPurchases();
  },

  bindEvents() {
    // Create Purchase Form Submit
    const form = document.getElementById('createPurchaseForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await this.submitPurchaseOrder();
      };
    }

    // Receive Purchase Form Submit
    const receiveForm = document.getElementById('receivePurchaseForm');
    if (receiveForm) {
      receiveForm.onsubmit = async (e) => {
        e.preventDefault();
        await this.submitReceiveShipment();
      };
    }
  },

  async loadSuppliers() {
    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      if (json.success) {
        this.suppliers = json.data;
        const select = document.getElementById('purchaseSupplierSelect');
        if (select) {
          select.innerHTML = '<option value="">-- Choose Supplier --</option>' +
            json.data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
      }
    } catch (e) {
      console.error('Failed loading suppliers:', e);
    }
  },

  async loadPurchases() {
    try {
      const res = await fetch('/api/purchases');
      const json = await res.json();
      if (json.success) {
        this.purchases = json.data;
        this.renderTable();
      }
    } catch (e) {
      console.error('Failed loading purchases:', e);
    }
  },

  renderTable() {
    const tbody = document.getElementById('purchasesTableBody');
    if (!tbody) return;

    if (this.purchases.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No purchase orders created yet</td></tr>';
      return;
    }

    tbody.innerHTML = this.purchases.map(p => {
      const isReceived = p.status === 'RECEIVED';
      const statusBadge = isReceived 
        ? '<span class="badge bg-success"><i class="fa-solid fa-check-double me-1"></i>RECEIVED</span>' 
        : '<span class="badge bg-warning text-dark"><i class="fa-solid fa-clock me-1"></i>ORDERED</span>';
      
      const payBadge = p.payment_status === 'PAID' ? '<span class="badge bg-success-subtle text-success">PAID</span>' :
                       p.payment_status === 'PARTIAL' ? '<span class="badge bg-warning-subtle text-warning">PARTIAL</span>' :
                       '<span class="badge bg-danger-subtle text-danger">UNPAID</span>';

      return `
        <tr>
          <td><span class="badge bg-light text-dark border font-monospace fw-bold">${p.purchase_number}</span></td>
          <td class="text-muted small">${p.created_at}</td>
          <td class="fw-semibold">${p.supplier_name}</td>
          <td class="text-center font-monospace">${p.total_items} items (${p.total_ordered_qty} units)</td>
          <td class="text-end font-monospace fw-bold">${app.formatCurrency(p.total_amount)}</td>
          <td class="text-end font-monospace">${app.formatCurrency(p.amount_paid)}</td>
          <td class="text-center">${payBadge}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center">
            ${isReceived ? `
              <button class="btn btn-sm btn-outline-secondary disabled" title="Already Received">
                <i class="fa-solid fa-lock me-1"></i> Received
              </button>
            ` : `
              <button class="btn btn-sm btn-success fw-semibold" onclick="purchasesManager.openReceiveModal(${p.id})">
                <i class="fa-solid fa-boxes-packing me-1"></i> Receive Stock
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');
  },

  async openCreatePurchaseModal() {
    await this.loadSuppliers();

    // Fetch latest products
    const prodRes = await fetch('/api/products');
    const prodJson = await prodRes.json();
    this.products = prodJson.success ? prodJson.data : [];

    const form = document.getElementById('createPurchaseForm');
    form.reset();

    const tbody = document.getElementById('purchaseItemsTableBody');
    tbody.innerHTML = '';
    this.addPurchaseItemRow();

    const modal = new bootstrap.Modal(document.getElementById('createPurchaseModal'));
    modal.show();
  },

  addPurchaseItemRow() {
    const tbody = document.getElementById('purchaseItemsTableBody');
    const rowId = 'row-' + Date.now() + '-' + Math.floor(Math.random() * 100);

    const productOptions = this.products.map(p => 
      `<option value="${p.id}" data-cost="${p.cost_price}">${p.name} (${p.sku})</option>`
    ).join('');

    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.innerHTML = `
      <td>
        <select class="form-select form-select-sm po-product-select" required onchange="purchasesManager.onProductSelectChanged('${rowId}')">
          <option value="">-- Select Product --</option>
          ${productOptions}
        </select>
      </td>
      <td>
        <input type="number" step="0.01" min="0" class="form-control form-control-sm po-unit-cost" required value="0.00" oninput="purchasesManager.calculateRowTotal('${rowId}')">
      </td>
      <td>
        <input type="number" step="1" min="1" class="form-control form-control-sm po-quantity" required value="1" oninput="purchasesManager.calculateRowTotal('${rowId}')">
      </td>
      <td class="text-end font-monospace fw-bold po-line-total">$0.00</td>
      <td class="text-center">
        <button type="button" class="btn btn-link btn-sm text-danger p-0" onclick="purchasesManager.removePurchaseItemRow('${rowId}')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
    this.calculateGrandTotal();
  },

  onProductSelectChanged(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const select = row.querySelector('.po-product-select');
    const selectedOption = select.options[select.selectedIndex];
    const defaultCost = selectedOption.getAttribute('data-cost') || '0.00';

    row.querySelector('.po-unit-cost').value = parseFloat(defaultCost).toFixed(2);
    this.calculateRowTotal(rowId);
  },

  calculateRowTotal(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const cost = parseFloat(row.querySelector('.po-unit-cost').value) || 0;
    const qty = parseFloat(row.querySelector('.po-quantity').value) || 0;
    const lineTotal = Math.round(cost * qty * 100) / 100;

    row.querySelector('.po-line-total').textContent = app.formatCurrency(lineTotal);
    this.calculateGrandTotal();
  },

  removePurchaseItemRow(rowId) {
    const tbody = document.getElementById('purchaseItemsTableBody');
    if (tbody.children.length <= 1) {
      app.showToast('Purchase order must contain at least one item', 'warning');
      return;
    }
    const row = document.getElementById(rowId);
    if (row) row.remove();
    this.calculateGrandTotal();
  },

  calculateGrandTotal() {
    let grand = 0;
    document.querySelectorAll('#purchaseItemsTableBody tr').forEach(row => {
      const cost = parseFloat(row.querySelector('.po-unit-cost')?.value) || 0;
      const qty = parseFloat(row.querySelector('.po-quantity')?.value) || 0;
      grand += cost * qty;
    });
    grand = Math.round(grand * 100) / 100;
    document.getElementById('purchaseTotalCalculated').textContent = app.formatCurrency(grand);
  },

  async submitPurchaseOrder() {
    const supplierId = document.getElementById('purchaseSupplierSelect').value;
    const initialPaid = parseFloat(document.getElementById('purchaseInitialPaid').value) || 0.0;
    const notes = document.getElementById('purchaseNotes').value;

    const items = [];
    document.querySelectorAll('#purchaseItemsTableBody tr').forEach(row => {
      const prodId = row.querySelector('.po-product-select').value;
      const cost = parseFloat(row.querySelector('.po-unit-cost').value);
      const qty = parseFloat(row.querySelector('.po-quantity').value);
      if (prodId && qty > 0) {
        items.push({
          product_id: parseInt(prodId, 10),
          quantity: qty,
          cost_price: cost
        });
      }
    });

    if (items.length === 0) {
      app.showToast('Please select at least one valid product and quantity', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: parseInt(supplierId, 10),
          items,
          amount_paid: initialPaid,
          notes
        })
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        app.showToast(result.message || 'Failed creating purchase order', 'danger');
        return;
      }

      const modalEl = document.getElementById('createPurchaseModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      app.showToast(`Purchase Order #${result.data.purchase_number} created (Pending Receipt)`, 'success');
      await this.loadPurchases();
      app.refreshDashboard();

    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  },

  async openReceiveModal(purchaseId) {
    try {
      const res = await fetch(`/api/purchases/${purchaseId}`);
      const json = await res.json();
      if (!json.success || !json.data) {
        app.showToast('Could not load purchase details', 'danger');
        return;
      }

      const purchase = json.data;

      // Duplicate receiving guard
      if (purchase.status === 'RECEIVED') {
        app.showToast(`Purchase ${purchase.purchase_number} is already received. Duplicate receiving is prevented.`, 'warning');
        return;
      }

      document.getElementById('receivePurchaseId').value = purchase.id;
      document.getElementById('receivePONumber').textContent = purchase.purchase_number;
      document.getElementById('receiveSupplierName').textContent = purchase.supplier_name;

      const tbody = document.getElementById('receiveItemsTableBody');
      tbody.innerHTML = purchase.items.map(item => `
        <tr data-item-id="${item.id}" data-product-id="${item.product_id}">
          <td class="fw-semibold">${item.product_name}</td>
          <td><span class="badge bg-light text-dark font-monospace">${item.sku}</span></td>
          <td class="text-center font-monospace">${item.ordered_quantity}</td>
          <td>
            <input type="number" step="1" min="0" max="${item.ordered_quantity}" 
                   class="form-control form-control-sm text-center font-monospace receive-qty-input"
                   value="${item.ordered_quantity}" required>
          </td>
        </tr>
      `).join('');

      const modal = new bootstrap.Modal(document.getElementById('receivePurchaseModal'));
      modal.show();
    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  },

  async submitReceiveShipment() {
    const purchaseId = document.getElementById('receivePurchaseId').value;
    const items = [];

    document.querySelectorAll('#receiveItemsTableBody tr').forEach(row => {
      const itemId = row.getAttribute('data-item-id');
      const prodId = row.getAttribute('data-product-id');
      const qty = parseFloat(row.querySelector('.receive-qty-input').value);
      items.push({
        item_id: parseInt(itemId, 10),
        product_id: parseInt(prodId, 10),
        received_quantity: qty
      });
    });

    try {
      const res = await fetch(`/api/purchases/${purchaseId}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        app.showToast(result.message || 'Receiving shipment failed', 'danger');
        return;
      }

      const modalEl = document.getElementById('receivePurchaseModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      app.showToast(result.message, 'success');
      await this.loadPurchases();
      if (typeof productsManager !== 'undefined') productsManager.loadProducts();
      app.refreshDashboard();

    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => purchasesManager.init());
