// Global Application State & Utilities
const app = {
  settings: {
    currency_symbol: '$',
    tax_rate: 10.0,
    allow_negative_stock: 'false'
  },
  currentSection: 'dashboard',

  async init() {
    this.bindEvents();
    this.startClock();
    await this.loadSettings();
    this.handleRouting();
    this.refreshDashboard();
  },

  bindEvents() {
    // Navigation link clicks
    document.querySelectorAll('[data-section]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.getAttribute('data-section');
        this.showSection(section);
      });
    });

    // Mobile sidebar toggle
    const toggleBtn = document.getElementById('sidebarToggle');
    const closeBtn = document.getElementById('sidebarToggleClose');
    const sidebar = document.getElementById('sidebar');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => sidebar.classList.toggle('show'));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => sidebar.classList.remove('show'));
    }

    // Quick POS Button in header
    const quickPos = document.getElementById('quickPOSBtn');
    if (quickPos) {
      quickPos.addEventListener('click', () => this.showSection('pos'));
    }

    // Settings Form Submission
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
      settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(settingsForm);
        const data = Object.fromEntries(formData.entries());
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          const result = await res.json();
          if (result.success) {
            this.settings = result.data;
            this.updateStockPolicyBadge();
            this.showToast('Business settings updated successfully', 'success');
          } else {
            this.showToast(result.message || 'Failed to update settings', 'danger');
          }
        } catch (err) {
          this.showToast('Error saving settings: ' + err.message, 'danger');
        }
      });
    }

    // Window popstate / hashchange
    window.addEventListener('hashchange', () => this.handleRouting());
  },

  handleRouting() {
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    this.showSection(hash);
  },

  showSection(sectionId) {
    this.currentSection = sectionId;

    // Hide all sections
    document.querySelectorAll('.app-section').forEach(sec => {
      sec.classList.add('d-none');
    });

    // Show target section
    const target = document.getElementById(`section-${sectionId}`);
    if (target) {
      target.classList.remove('d-none');
    }

    // Update active nav link
    document.querySelectorAll('#sidebar .nav-link').forEach(link => {
      if (link.getAttribute('data-section') === sectionId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Close mobile sidebar if open
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('show');

    // Section specific loaders
    if (sectionId === 'dashboard') this.refreshDashboard();
    if (sectionId === 'pos') posManager.initPOS();
    if (sectionId === 'products') productsManager.loadProducts();
    if (sectionId === 'purchases') purchasesManager.loadPurchases();
    if (sectionId === 'movements') inventoryManager.loadMovements();
    if (sectionId === 'sales-register') salesManager.loadSales();
    if (sectionId === 'customers') customersManager.loadCustomers();
    if (sectionId === 'suppliers') suppliersManager.loadSuppliers();
    if (sectionId === 'valuation') inventoryManager.loadValuationReport();
    if (sectionId === 'settings') this.populateSettingsForm();
  },

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        this.settings = json.data;
        this.updateStockPolicyBadge();
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  },

  updateStockPolicyBadge() {
    const badge = document.getElementById('stockPolicyBadge');
    if (badge) {
      if (this.settings.allow_negative_stock === 'true') {
        badge.className = 'badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1';
        badge.innerHTML = '<i class="fa-solid fa-triangle-exclamation me-1"></i> Negative Stock Allowed';
      } else {
        badge.className = 'badge bg-success-subtle text-success border border-success-subtle px-2 py-1';
        badge.innerHTML = '<i class="fa-solid fa-shield-halved me-1"></i> Negative Stock Rejected';
      }
    }
  },

  populateSettingsForm() {
    const form = document.getElementById('settingsForm');
    if (!form) return;
    for (const [key, val] of Object.entries(this.settings)) {
      const field = form.elements[key];
      if (field) field.value = val;
    }
  },

  formatCurrency(num) {
    const val = parseFloat(num) || 0.0;
    const symbol = this.settings.currency_symbol || '$';
    return `${symbol}${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  startClock() {
    const timeEl = document.getElementById('currentTime');
    const dateEl = document.getElementById('currentDate');
    const update = () => {
      const now = new Date();
      if (timeEl) timeEl.textContent = now.toLocaleTimeString();
      if (dateEl) dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    };
    update();
    setInterval(update, 1000);
  },

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toastId = 'toast-' + Date.now();
    const bgClass = type === 'success' ? 'bg-success text-white' :
                    type === 'danger' ? 'bg-danger text-white' :
                    type === 'warning' ? 'bg-warning text-dark' : 'bg-dark text-white';

    const toastHtml = `
      <div id="${toastId}" class="toast align-items-center ${bgClass} border-0 shadow" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body fw-medium">
            ${message}
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', toastHtml);
    const toastEl = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  },

  async refreshDashboard() {
    try {
      // 1. Fetch products stats & valuation
      const prodRes = await fetch('/api/products');
      const prodData = await prodRes.json();
      if (prodData.success) {
        document.getElementById('kpi-stock-valuation').textContent = this.formatCurrency(prodData.stats.total_stock_valuation);
        document.getElementById('kpi-total-products').textContent = prodData.stats.total_products;
        document.getElementById('kpi-total-stock-units').textContent = `${prodData.stats.total_units} units in warehouse`;
        document.getElementById('kpi-low-stock-count').textContent = prodData.stats.low_stock_count;
        document.getElementById('dashboardLowStockBadge').textContent = prodData.stats.low_stock_count;
      }

      // 2. Fetch sales stats
      const salesRes = await fetch('/api/sales');
      const salesData = await salesRes.json();
      if (salesData.success) {
        document.getElementById('kpi-total-revenue').textContent = this.formatCurrency(salesData.stats.total_revenue);
        document.getElementById('kpi-total-sales-count').textContent = `${salesData.stats.total_sales} recorded sales`;
      }

      // 3. Fetch recent movements
      const movRes = await fetch('/api/inventory/movements?limit=7');
      const movData = await movRes.json();
      const tbody = document.getElementById('dashboardMovementsTable');
      if (tbody) {
        if (!movData.data || movData.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No stock movements recorded yet</td></tr>';
        } else {
          tbody.innerHTML = movData.data.map(m => {
            const badgeClass = m.type === 'SALE' ? 'bg-danger-subtle text-danger' :
                               m.type === 'PURCHASE_RECEIVE' ? 'bg-success-subtle text-success' :
                               m.type === 'OPENING_STOCK' ? 'bg-primary-subtle text-primary' : 'bg-secondary-subtle text-secondary';
            const qtyClass = m.quantity > 0 ? 'text-success fw-bold' : 'text-danger fw-bold';
            const qtySign = m.quantity > 0 ? `+${m.quantity}` : `${m.quantity}`;
            return `
              <tr>
                <td class="text-muted small">${m.created_at}</td>
                <td class="fw-semibold">${m.product_name} <br><small class="text-muted font-monospace">${m.sku}</small></td>
                <td><span class="badge ${badgeClass}">${m.type}</span></td>
                <td class="${qtyClass}">${qtySign}</td>
                <td class="fw-medium">${m.stock_after}</td>
                <td><small class="text-muted font-monospace">${m.reference_id || '--'}</small></td>
              </tr>
            `;
          }).join('');
        }
      }

      // 4. Low stock watchlist
      const lowRes = await fetch('/api/inventory/low-stock');
      const lowData = await lowRes.json();
      const lowList = document.getElementById('dashboardLowStockList');
      if (lowList) {
        if (!lowData.data || lowData.data.length === 0) {
          lowList.innerHTML = '<li class="list-group-item text-center text-muted py-3">All inventory levels healthy!</li>';
        } else {
          lowList.innerHTML = lowData.data.slice(0, 5).map(item => `
            <li class="list-group-item d-flex justify-content-between align-items-center py-2">
              <div>
                <span class="fw-medium">${item.name}</span>
                <div class="text-muted fs-xs font-monospace">SKU: ${item.sku} | Reorder at ${item.reorder_level}</div>
              </div>
              <span class="badge ${item.stock_quantity <= 0 ? 'bg-danger' : 'bg-warning text-dark'} fw-bold">
                ${item.stock_quantity} left
              </span>
            </li>
          `).join('');
        }
      }

    } catch (e) {
      console.error('Failed refreshing dashboard:', e);
    }
  }
};

window.addEventListener('DOMContentLoaded', () => app.init());
