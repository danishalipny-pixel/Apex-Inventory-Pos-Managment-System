// Inventory Ledger & Valuation Controller
const inventoryManager = {
  movements: [],

  init() {
    this.bindEvents();
    this.loadMovements();
  },

  bindEvents() {
    const search = document.getElementById('movementSearchInput');
    if (search) {
      search.oninput = () => this.filterAndRenderMovements();
    }

    const typeFilter = document.getElementById('movementTypeFilter');
    if (typeFilter) {
      typeFilter.onchange = () => this.loadMovements();
    }
  },

  async loadMovements() {
    try {
      const type = document.getElementById('movementTypeFilter')?.value || 'All';
      let url = '/api/inventory/movements';
      if (type !== 'All') {
        url += `?type=${encodeURIComponent(type)}`;
      }

      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        this.movements = json.data;
        this.filterAndRenderMovements();
      }
    } catch (e) {
      console.error('Failed loading inventory movements:', e);
    }
  },

  filterAndRenderMovements() {
    const searchVal = (document.getElementById('movementSearchInput')?.value || '').toLowerCase().trim();
    const tbody = document.getElementById('movementsTableBody');
    if (!tbody) return;

    const filtered = this.movements.filter(m => {
      return !searchVal || 
        m.product_name.toLowerCase().includes(searchVal) ||
        m.sku.toLowerCase().includes(searchVal) ||
        (m.reference_id && m.reference_id.toLowerCase().includes(searchVal));
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">No movement records found</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(m => {
      const badgeClass = m.type === 'SALE' ? 'bg-danger-subtle text-danger' :
                         m.type === 'PURCHASE_RECEIVE' ? 'bg-success-subtle text-success' :
                         m.type === 'OPENING_STOCK' ? 'bg-primary-subtle text-primary' : 'bg-secondary-subtle text-secondary';
      const qtyClass = m.quantity > 0 ? 'text-success fw-bold' : 'text-danger fw-bold';
      const qtyDisplay = m.quantity > 0 ? `+${m.quantity}` : `${m.quantity}`;

      return `
        <tr>
          <td class="text-muted small">${m.created_at}</td>
          <td class="fw-semibold">${m.product_name}</td>
          <td><span class="badge bg-light text-dark border font-monospace">${m.sku}</span></td>
          <td><span class="badge ${badgeClass}">${m.type}</span></td>
          <td class="text-center font-monospace ${qtyClass}">${qtyDisplay}</td>
          <td class="text-center font-monospace text-muted">${m.stock_before}</td>
          <td class="text-center font-monospace fw-bold">${m.stock_after}</td>
          <td><span class="font-monospace small text-primary">${m.reference_id || '--'}</span></td>
          <td><small class="text-muted">${m.notes || '--'}</small></td>
        </tr>
      `;
    }).join('');
  },

  async loadValuationReport() {
    try {
      const res = await fetch('/api/inventory/valuation');
      const json = await res.json();
      if (json.success && json.data) {
        const { summary, by_category } = json.data;

        document.getElementById('valTotalCost').textContent = app.formatCurrency(summary.total_cost_valuation);
        document.getElementById('valTotalRetail').textContent = app.formatCurrency(summary.total_retail_valuation);
        document.getElementById('valPotentialProfit').textContent = app.formatCurrency(summary.potential_profit);

        const tbody = document.getElementById('valuationCategoryTableBody');
        if (tbody) {
          if (!by_category || by_category.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No valuation data available</td></tr>';
          } else {
            tbody.innerHTML = by_category.map(c => `
              <tr>
                <td class="fw-bold">${c.category}</td>
                <td class="text-center font-monospace">${c.sku_count}</td>
                <td class="text-center font-monospace">${c.stock_units}</td>
                <td class="text-end font-monospace fw-semibold text-primary">${app.formatCurrency(c.cost_valuation)}</td>
                <td class="text-end font-monospace fw-semibold text-success">${app.formatCurrency(c.retail_valuation)}</td>
              </tr>
            `).join('');
          }
        }
      }
    } catch (e) {
      console.error('Failed loading valuation report:', e);
    }
  }
};

window.addEventListener('DOMContentLoaded', () => inventoryManager.init());
