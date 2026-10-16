const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// Generate unique PO Number: PO-YYYYMMDD-XXXX
function generatePONumber(db) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PO-${dateStr}-`;

  const lastPO = db.prepare(`
    SELECT purchase_number FROM purchases 
    WHERE purchase_number LIKE ? 
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`);

  let nextSeq = 1;
  if (lastPO && lastPO.purchase_number) {
    const parts = lastPO.purchase_number.split('-');
    const currentSeq = parseInt(parts[2], 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

// GET all purchases
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { search, supplier_id, status } = req.query;

    let query = `
      SELECT p.*,
        (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) AS total_items,
        (SELECT SUM(ordered_quantity) FROM purchase_items WHERE purchase_id = p.id) AS total_ordered_qty,
        (SELECT SUM(received_quantity) FROM purchase_items WHERE purchase_id = p.id) AS total_received_qty
      FROM purchases p
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (p.purchase_number LIKE ? OR p.supplier_name LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    if (supplier_id) {
      query += ` AND p.supplier_id = ?`;
      params.push(supplier_id);
    }

    if (status && status !== 'All') {
      query += ` AND p.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY p.id DESC`;

    const purchases = db.prepare(query).all(...params);

    const stats = db.prepare(`
      SELECT 
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_purchase_amount,
        COALESCE(SUM(amount_paid), 0) AS total_amount_paid,
        COALESCE(SUM(CASE WHEN status = 'ORDERED' THEN 1 ELSE 0 END), 0) AS pending_receiving_count
      FROM purchases
    `).get() || { total_orders: 0, total_purchase_amount: 0, total_amount_paid: 0, pending_receiving_count: 0 };

    res.json({
      success: true,
      data: purchases,
      stats: {
        total_orders: Number(stats.total_orders),
        total_purchase_amount: Number(stats.total_purchase_amount),
        total_amount_paid: Number(stats.total_amount_paid),
        pending_receiving_count: Number(stats.pending_receiving_count)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single purchase by ID
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchase.id);
    const payments = db.prepare('SELECT * FROM supplier_payments WHERE purchase_id = ?').all(purchase.id);
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(purchase.supplier_id);

    res.json({
      success: true,
      data: {
        ...purchase,
        items,
        payments,
        supplier
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create purchase order (Draft / Ordered)
router.post('/', (req, res) => {
  const db = getDb();
  try {
    const { supplier_id, items, amount_paid, payment_method, notes } = req.body;

    if (!supplier_id) {
      return res.status(400).json({ success: false, message: 'Supplier is required' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Purchase items list cannot be empty' });
    }

    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: `Supplier ID ${supplier_id} not found` });
    }

    db.exec('BEGIN');

    let totalAmount = 0.0;
    const validatedItems = [];

    for (let i = 0; i < items.length; i++) {
      const itm = items[i];
      const prodId = parseInt(itm.product_id, 10);
      const qty = parseFloat(itm.quantity || itm.ordered_quantity);
      const cost = parseFloat(itm.cost_price || itm.unit_cost);

      if (!prodId || isNaN(qty) || qty <= 0) {
        db.exec('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Item #${i + 1} has invalid product or quantity must be greater than zero.`
        });
      }

      if (isNaN(cost) || cost < 0) {
        db.exec('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Item #${i + 1} must have a valid non-negative cost price.`
        });
      }

      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId);
      if (!product) {
        db.exec('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: `Product ID ${prodId} not found`
        });
      }

      const lineTotal = Math.round(qty * cost * 100) / 100;
      totalAmount += lineTotal;

      validatedItems.push({
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        ordered_quantity: qty,
        unit_cost: cost,
        line_total: lineTotal
      });
    }

    totalAmount = Math.round(totalAmount * 100) / 100;

    const paid = amount_paid !== undefined ? parseFloat(amount_paid) : 0.0;
    const unpaid = Math.max(0, Math.round((totalAmount - paid) * 100) / 100);

    let paymentStatus = 'UNPAID';
    if (paid >= totalAmount) {
      paymentStatus = 'PAID';
    } else if (paid > 0) {
      paymentStatus = 'PARTIAL';
    }

    const purchaseNumber = generatePONumber(db);

    // Insert purchase record (Status is ORDERED, NOT received yet)
    const pInsert = db.prepare(`
      INSERT INTO purchases (
        purchase_number, supplier_id, supplier_name, status,
        total_amount, amount_paid, payment_status, notes
      ) VALUES (?, ?, ?, 'ORDERED', ?, ?, ?, ?)
    `).run(
      purchaseNumber,
      supplier.id,
      supplier.name,
      totalAmount,
      paid,
      paymentStatus,
      notes || ''
    );

    const purchaseId = Number(pInsert.lastInsertRowid);

    // Insert purchase items
    for (const item of validatedItems) {
      db.prepare(`
        INSERT INTO purchase_items (
          purchase_id, product_id, product_name, sku,
          ordered_quantity, received_quantity, unit_cost, line_total
        ) VALUES (?, ?, ?, ?, ?, 0.0, ?, ?)
      `).run(
        purchaseId,
        item.product_id,
        item.product_name,
        item.sku,
        item.ordered_quantity,
        item.unit_cost,
        item.line_total
      );
    }

    // Update supplier balance (unpaid amount increases accounts payable)
    if (unpaid > 0) {
      db.prepare(`
        UPDATE suppliers 
        SET balance = ROUND(balance + ?, 2)
        WHERE id = ?
      `).run(unpaid, supplier.id);
    }

    // Record payment if any initial amount was paid
    if (paid > 0) {
      db.prepare(`
        INSERT INTO supplier_payments (
          supplier_id, purchase_id, amount, payment_method, notes
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        supplier.id,
        purchaseId,
        paid,
        payment_method || 'Bank Transfer',
        `Initial payment for ${purchaseNumber}`
      );
    }

    db.exec('COMMIT');

    const created = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
    const createdItems = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchaseId);

    res.status(201).json({
      success: true,
      message: 'Purchase order created successfully',
      data: {
        ...created,
        items: createdItems
      }
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST receive purchase & increase inventory stock
// Ensures receiving same quantity twice is prevented!
router.post('/:id/receive', (req, res) => {
  const db = getDb();
  try {
    const { id } = req.params;
    const { items: receivedItemOverrides } = req.body || {};

    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase record not found' });
    }

    // Duplicate Receiving Prevention Check
    if (purchase.status === 'RECEIVED') {
      return res.status(400).json({
        success: false,
        error_code: 'ALREADY_RECEIVED',
        message: `Purchase ${purchase.purchase_number} has already been received. Duplicate receiving is prevented.`
      });
    }

    if (purchase.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: `Purchase ${purchase.purchase_number} is cancelled and cannot be received.`
      });
    }

    const existingItems = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchase.id);
    if (existingItems.length === 0) {
      return res.status(400).json({ success: false, message: 'No items in this purchase order to receive' });
    }

    db.exec('BEGIN');

    const receivedResults = [];

    for (const item of existingItems) {
      let receivedQty = item.ordered_quantity;

      // Allow partial or specified received quantity overrides if provided
      if (receivedItemOverrides && Array.isArray(receivedItemOverrides)) {
        const override = receivedItemOverrides.find(o => 
          (o.item_id && o.item_id === item.id) || 
          (o.product_id && o.product_id === item.product_id)
        );
        if (override && override.received_quantity !== undefined) {
          receivedQty = parseFloat(override.received_quantity);
        }
      }

      if (isNaN(receivedQty) || receivedQty < 0) {
        db.exec('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Invalid received quantity (${receivedQty}) for product ${item.product_name}`
        });
      }

      // Update purchase_items table with received quantity
      db.prepare(`
        UPDATE purchase_items 
        SET received_quantity = ?
        WHERE id = ?
      `).run(receivedQty, item.id);

      // Only increase stock if received_quantity > 0
      if (receivedQty > 0) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        if (!product) {
          db.exec('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: `Product ID ${item.product_id} no longer exists.`
          });
        }

        const stockBefore = product.stock_quantity;
        const stockAfter = Math.round((stockBefore + receivedQty) * 1000) / 1000;

        // Increase stock by EXACTLY the quantity received
        db.prepare(`
          UPDATE products 
          SET stock_quantity = ?, cost_price = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(stockAfter, item.unit_cost, product.id);

        // Record inventory movement history for purchase receiving
        db.prepare(`
          INSERT INTO inventory_movements (
            product_id, product_name, sku, type, quantity,
            stock_before, stock_after, reference_type, reference_id,
            unit_cost, notes
          ) VALUES (?, ?, ?, 'PURCHASE_RECEIVE', ?, ?, ?, 'PURCHASE', ?, ?, ?)
        `).run(
          product.id,
          product.name,
          product.sku,
          receivedQty,
          stockBefore,
          stockAfter,
          purchase.purchase_number,
          item.unit_cost,
          `Received ${receivedQty} units against Purchase ${purchase.purchase_number}`
        );

        receivedResults.push({
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          ordered_quantity: item.ordered_quantity,
          received_quantity: receivedQty,
          stock_before: stockBefore,
          stock_after: stockAfter
        });
      }
    }

    // Mark purchase as RECEIVED
    db.prepare(`
      UPDATE purchases 
      SET status = 'RECEIVED', received_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(purchase.id);

    db.exec('COMMIT');

    const updatedPurchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchase.id);
    const updatedItems = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purchase.id);

    res.json({
      success: true,
      message: `Purchase ${purchase.purchase_number} received successfully. Stock updated.`,
      data: {
        ...updatedPurchase,
        items: updatedItems,
        received_summary: receivedResults
      }
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST record supplier payment for purchase
router.post('/:id/pay', (req, res) => {
  const db = getDb();
  try {
    const { id } = req.params;
    const { amount, payment_method, notes } = req.body;

    const payAmount = parseFloat(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
    }

    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
    if (!purchase) {
      return res.status(404).json({ success: false, message: 'Purchase not found' });
    }

    db.exec('BEGIN');

    const newAmountPaid = Math.round((purchase.amount_paid + payAmount) * 100) / 100;
    let paymentStatus = 'PARTIAL';
    if (newAmountPaid >= purchase.total_amount) {
      paymentStatus = 'PAID';
    }

    db.prepare(`
      UPDATE purchases 
      SET amount_paid = ?, payment_status = ?
      WHERE id = ?
    `).run(newAmountPaid, paymentStatus, purchase.id);

    // Decrease supplier balance (accounts payable)
    db.prepare(`
      UPDATE suppliers 
      SET balance = ROUND(balance - ?, 2)
      WHERE id = ?
    `).run(payAmount, purchase.supplier_id);

    // Record payment entry
    db.prepare(`
      INSERT INTO supplier_payments (
        supplier_id, purchase_id, amount, payment_method, notes
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      purchase.supplier_id,
      purchase.id,
      payAmount,
      payment_method || 'Bank Transfer',
      notes || `Payment for ${purchase.purchase_number}`
    );

    db.exec('COMMIT');

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        purchase_id: purchase.id,
        amount_paid: newAmountPaid,
        payment_status: paymentStatus
      }
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
