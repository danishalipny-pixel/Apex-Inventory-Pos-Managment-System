// Customers and Suppliers Management Controller
const customersManager = {
  customers: [],

  init() {
    this.bindEvents();
    this.loadCustomers();
  },

  bindEvents() {
    const form = document.getElementById('customerForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await this.saveCustomer();
      };
    }
  },

  async loadCustomers() {
    try {
      const res = await fetch('/api/customers');
      const json = await res.json();
      if (json.success) {
        this.customers = json.data;
        this.renderTable();
      }
    } catch (e) {
      console.error('Failed loading customers:', e);
    }
  },

  renderTable() {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;

    if (this.customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No customers registered</td></tr>';
      return;
    }

    tbody.innerHTML = this.customers.map(c => `
      <tr>
        <td class="font-monospace text-muted">#${c.id}</td>
        <td class="fw-bold">${c.name}</td>
        <td>${c.phone || '<span class="text-muted">--</span>'}</td>
        <td>${c.email || '<span class="text-muted">--</span>'}</td>
        <td><small class="text-muted">${c.address || '--'}</small></td>
        <td class="text-end font-monospace fw-semibold text-success">${app.formatCurrency(c.total_spent)}</td>
        <td class="text-muted small">${c.created_at}</td>
      </tr>
    `).join('');
  },

  openAddCustomerModal() {
    const form = document.getElementById('customerForm');
    form.reset();
    const modal = new bootstrap.Modal(document.getElementById('customerModal'));
    modal.show();
  },

  async saveCustomer() {
    const form = document.getElementById('customerForm');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        app.showToast(result.message || 'Failed saving customer', 'danger');
        return;
      }

      const modalEl = document.getElementById('customerModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      app.showToast(`Customer "${data.name}" saved successfully`, 'success');
      await this.loadCustomers();
      if (typeof posManager !== 'undefined') {
        await posManager.loadCustomers();
        const select = document.getElementById('posCustomerSelect');
        if (select) select.value = result.data.id;
      }
    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  }
};

const suppliersManager = {
  suppliers: [],

  init() {
    this.bindEvents();
    this.loadSuppliers();
  },

  bindEvents() {
    const form = document.getElementById('supplierForm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await this.saveSupplier();
      };
    }
  },

  async loadSuppliers() {
    try {
      const res = await fetch('/api/suppliers');
      const json = await res.json();
      if (json.success) {
        this.suppliers = json.data;
        this.renderTable();
      }
    } catch (e) {
      console.error('Failed loading suppliers:', e);
    }
  },

  renderTable() {
    const tbody = document.getElementById('suppliersTableBody');
    if (!tbody) return;

    if (this.suppliers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No suppliers registered</td></tr>';
      return;
    }

    tbody.innerHTML = this.suppliers.map(s => `
      <tr>
        <td class="font-monospace text-muted">#${s.id}</td>
        <td class="fw-bold">${s.name}</td>
        <td>${s.contact_person || '<span class="text-muted">--</span>'}</td>
        <td>${s.phone || '<span class="text-muted">--</span>'}</td>
        <td>${s.email || '<span class="text-muted">--</span>'}</td>
        <td class="text-end font-monospace fw-bold ${s.balance > 0 ? 'text-danger' : 'text-success'}">
          ${app.formatCurrency(s.balance)}
        </td>
        <td class="text-muted small">${s.created_at}</td>
      </tr>
    `).join('');
  },

  openAddSupplierModal() {
    const form = document.getElementById('supplierForm');
    form.reset();
    const modal = new bootstrap.Modal(document.getElementById('supplierModal'));
    modal.show();
  },

  async saveSupplier() {
    const form = document.getElementById('supplierForm');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        app.showToast(result.message || 'Failed saving supplier', 'danger');
        return;
      }

      const modalEl = document.getElementById('supplierModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      app.showToast(`Supplier "${data.name}" added successfully`, 'success');
      await this.loadSuppliers();
      if (typeof purchasesManager !== 'undefined') purchasesManager.loadSuppliers();
    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  customersManager.init();
  suppliersManager.init();
});
