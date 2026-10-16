// Sales Register Controller
const salesManager = {
  sales: [],

  init() {
    this.loadSales();
  },

  async loadSales() {
    try {
      const res = await fetch('/api/sales');
      const json = await res.json();
      if (json.success) {
        this.sales = json.data;
        this.renderTable();
      }
    } catch (e) {
      console.error('Failed loading sales register:', e);
    }
  },

  renderTable() {
    const tbody = document.getElementById('salesTableBody');
    if (!tbody) return;

    if (this.sales.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-muted">No sales recorded yet</td></tr>';
      return;
    }

    tbody.innerHTML = this.sales.map(s => {
      const payStatusBadge = s.payment_status === 'PAID' ? '<span class="badge bg-success">PAID</span>' :
                             s.payment_status === 'PARTIAL' ? '<span class="badge bg-warning text-dark">PARTIAL</span>' :
                             '<span class="badge bg-danger">UNPAID</span>';

      return `
        <tr>
          <td><span class="badge bg-light text-dark border font-monospace fw-bold">${s.invoice_number}</span></td>
          <td class="text-muted small">${s.created_at}</td>
          <td class="fw-semibold">${s.customer_name}</td>
          <td class="text-end font-monospace">${app.formatCurrency(s.subtotal)}</td>
          <td class="text-end font-monospace text-danger">-${app.formatCurrency(s.discount_amount)}</td>
          <td class="text-end font-monospace">${app.formatCurrency(s.tax_amount)}</td>
          <td class="text-end font-monospace fw-bold text-primary">${app.formatCurrency(s.total)}</td>
          <td class="text-center"><span class="badge bg-secondary-subtle text-secondary">${s.payment_method}</span></td>
          <td class="text-center">${payStatusBadge}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline-primary" onclick="salesManager.viewReceipt(${s.id})">
              <i class="fa-solid fa-receipt me-1"></i> Receipt
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async viewReceipt(saleId) {
    try {
      const res = await fetch(`/api/sales/${saleId}`);
      const json = await res.json();
      if (json.success && json.data) {
        if (typeof posManager !== 'undefined') {
          posManager.renderAndShowReceipt(json.data);
        }
      } else {
        app.showToast('Could not load receipt details', 'danger');
      }
    } catch (e) {
      app.showToast('Error: ' + e.message, 'danger');
    }
  }
};

window.addEventListener('DOMContentLoaded', () => salesManager.init());
