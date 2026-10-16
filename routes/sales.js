const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// Helper to get business settings
function getBusinessSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// Generate unique invoice number: INV-YYYYMMDD-XXXX
function generateInvoiceNumber(db) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INV-${dateStr}-`;

  const lastSale = db.prepare(`
    SELECT invoice_number FROM sales 
    WHERE invoice_number LIKE ? 
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`);

  let nextSeq = 1;
  if (lastSale && lastSale.invoice_number) {
    const parts = lastSale.invoice_number.split('-');
    const currentSeq = parseInt(parts[2], 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

// GET all sales / sales register
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { search, customer_id, payment_status, payment_method, limit } = req.query;

    let query = `
      SELECT s.*, 
        (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS total_items,
        (SELECT SUM(quantity) FROM sale_items WHERE sale_id = s.id) AS total_units_sold
      FROM sales s
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (s.invoice_number LIKE ? OR s.customer_name LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    if (customer_id) {
      query += ` AND s.customer_id = ?`;
      params.push(customer_id);
    }

    if (payment_status && payment_status !== 'All') {
      query += ` AND s.payment_status = ?`;
      params.push(payment_status);
    }

    if (payment_method && payment_method !== 'All') {
      query += ` AND s.payment_method = ?`;
      params.push(payment_method);
    }

    query += ` ORDER BY s.id DESC`;

    if (limit) {
      query += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
    }

    const sales = db.prepare(query).all(...params);

    const stats = db.prepare(`
      SELECT 
        COUNT(*) AS total_sales,
        COALESCE(SUM(total), 0) AS total_revenue,
        COALESCE(SUM(tax_amount), 0) AS total_tax,
        COALESCE(SUM(discount_amount), 0) AS total_discounts
      FROM sales
    `).get() || { total_sales: 0, total_revenue: 0, total_tax: 0, total_discounts: 0 };

    res.json({
      success: true,
      data: sales,
      stats: {
        total_sales: Number(stats.total_sales),
        total_revenue: Number(stats.total_revenue),
        total_tax: Number(stats.total_tax),
        total_discounts: Number(stats.total_discounts)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single sale by ID or Invoice Number
router.get('/:identifier', (req, res) => {
  try {
    const db = getDb();
    const { identifier } = req.params;

    let sale = null;
    if (/^\d+$/.test(identifier)) {
      sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(identifier);
    }
    if (!sale) {
      sale = db.prepare('SELECT * FROM sales WHERE invoice_number = ?').get(identifier);
    }

    if (!sale) {
      return res.status(404).json({ success: false, message: 'Sale not found' });
    }

    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    const settings = getBusinessSettings(db);

    res.json({
      success: true,
      data: {
        ...sale,
        items,
        business: {
          name: settings.business_name,
          address: settings.business_address,
          phone: settings.business_phone,
          email: settings.business_email,
          tax_id: settings.business_tax_id,
          currency: settings.currency,
          currency_symbol: settings.currency_symbol || '$',
          receipt_footer: settings.receipt_footer
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST complete a POS sale (atomic transaction with stock deduction & over-sell validation)
router.post('/', (req, res) => {
  const db = getDb();
  try {
    const {
      customer_id,
      items,
      discount_rate,
      discount_amount,
      tax_rate,
      amount_paid,
      payment_method,
      notes
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Sale cart cannot be empty' });
    }

    const settings = getBusinessSettings(db);
    const allowNegativeStock = settings.allow_negative_stock === 'true';

    // Verify Customer
    const custId = customer_id ? parseInt(customer_id, 10) : 1;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId);
    if (!customer) {
      return res.status(400).json({ success: false, message: `Customer ID ${custId} not found` });
    }

    // Begin atomic transaction
    db.exec('BEGIN');

    // 1. Validate all items & stock availability BEFORE applying changes
    const validatedItems = [];
    let subtotal = 0.0;

    for (let i = 0; i < items.length; i++) {
      const itm = items[i];
      const prodId = parseInt(itm.product_id, 10);
      const qty = parseFloat(itm.quantity);

      if (!prodId || isNaN(qty) || qty <= 0) {
        db.exec('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Item #${i + 1} has invalid product ID or quantity must be greater than zero.`
        });
      }

      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId);
      if (!product) {
        db.exec('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: `Product ID ${prodId} was not found in inventory.`
        });
      }

      // Check stock availability
      if (!allowNegativeStock && product.stock_quantity < qty) {
        db.exec('ROLLBACK');
        return res.status(400).json({
          success: false,
          error_code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for "${product.name}" (SKU: ${product.sku}). Available stock: ${product.stock_quantity}, requested quantity: ${qty}. Sale rejected.`
        });
      }

      const unitPrice = itm.unit_price !== undefined ? parseFloat(itm.unit_price) : product.selling_price;
      const lineTotal = Math.round(qty * unitPrice * 100) / 100;
      subtotal += lineTotal;

      validatedItems.push({
        product,
        quantity: qty,
        unit_price: unitPrice,
        unit_cost: product.cost_price,
        line_total: lineTotal
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;

    // 2. Calculate discounts
    let calculatedDiscount = 0.0;
    const discRate = parseFloat(discount_rate) || 0.0;
    if (discRate > 0) {
      calculatedDiscount = Math.round(subtotal * (discRate / 100) * 100) / 100;
    } else if (discount_amount !== undefined) {
      calculatedDiscount = Math.round(parseFloat(discount_amount) * 100) / 100;
    }
    calculatedDiscount = Math.min(subtotal, Math.max(0, calculatedDiscount));

    const taxableAmount = Math.round((subtotal - calculatedDiscount) * 100) / 100;

    // 3. Calculate Taxes
    const effectiveTaxRate = tax_rate !== undefined ? parseFloat(tax_rate) : (parseFloat(settings.tax_rate) || 0.0);
    const calculatedTax = Math.round(taxableAmount * (effectiveTaxRate / 100) * 100) / 100;

    // 4. Calculate Final Total
    const finalTotal = Math.round((taxableAmount + calculatedTax) * 100) / 100;

    // 5. Payment calculations
    const payMethod = payment_method || 'Cash';
    const tendered = amount_paid !== undefined ? parseFloat(amount_paid) : finalTotal;
    const changeAmount = payMethod === 'Cash' ? Math.max(0, Math.round((tendered - finalTotal) * 100) / 100) : 0.0;
    
    let paymentStatus = 'PAID';
    if (tendered < finalTotal) {
      paymentStatus = tendered > 0 ? 'PARTIAL' : 'UNPAID';
    }

    // 6. Generate Invoice Number
    const invoiceNumber = generateInvoiceNumber(db);

    // 7. Insert Sale record
    const saleInsert = db.prepare(`
      INSERT INTO sales (
        invoice_number, customer_id, customer_name, subtotal,
        discount_rate, discount_amount, tax_rate, tax_amount,
        total, amount_paid, change_amount, payment_method,
        payment_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoiceNumber,
      customer.id,
      customer.name,
      subtotal,
      discRate,
      calculatedDiscount,
      effectiveTaxRate,
      calculatedTax,
      finalTotal,
      tendered,
      changeAmount,
      payMethod,
      paymentStatus,
      notes || ''
    );

    const saleId = Number(saleInsert.lastInsertRowid);

    // 8. Process items: insert sale_items, deduct stock, and record inventory_movements
    const saleItemsRecords = [];

    for (const item of validatedItems) {
      // Insert sale item
      db.prepare(`
        INSERT INTO sale_items (
          sale_id, product_id, product_name, sku,
          unit_cost, unit_price, quantity, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        saleId,
        item.product.id,
        item.product.name,
        item.product.sku,
        item.unit_cost,
        item.unit_price,
        item.quantity,
        item.line_total
      );

      // Deduct stock exactly by quantity sold
      const stockBefore = item.product.stock_quantity;
      const stockAfter = Math.round((stockBefore - item.quantity) * 1000) / 1000;

      db.prepare(`
        UPDATE products 
        SET stock_quantity = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(stockAfter, item.product.id);

      // Record inventory movement history
      db.prepare(`
        INSERT INTO inventory_movements (
          product_id, product_name, sku, type, quantity,
          stock_before, stock_after, reference_type, reference_id,
          unit_cost, notes
        ) VALUES (?, ?, ?, 'SALE', ?, ?, ?, 'SALE', ?, ?, ?)
      `).run(
        item.product.id,
        item.product.name,
        item.product.sku,
        -item.quantity,
        stockBefore,
        stockAfter,
        invoiceNumber,
        item.unit_cost,
        `POS Sale Invoice #${invoiceNumber}`
      );

      saleItemsRecords.push({
        product_id: item.product.id,
        product_name: item.product.name,
        sku: item.product.sku,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        stock_before: stockBefore,
        stock_after: stockAfter
      });
    }

    // 9. Update Customer spend total
    db.prepare(`
      UPDATE customers 
      SET total_spent = ROUND(total_spent + ?, 2)
      WHERE id = ?
    `).run(finalTotal, customer.id);

    // Commit Transaction
    db.exec('COMMIT');

    // Fetch complete created sale
    const savedSale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    const savedItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);

    res.status(201).json({
      success: true,
      message: 'Sale completed successfully',
      data: {
        ...savedSale,
        items: savedItems,
        business: {
          name: settings.business_name,
          address: settings.business_address,
          phone: settings.business_phone,
          email: settings.business_email,
          tax_id: settings.business_tax_id,
          currency: settings.currency,
          currency_symbol: settings.currency_symbol || '$',
          receipt_footer: settings.receipt_footer
        }
      }
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
