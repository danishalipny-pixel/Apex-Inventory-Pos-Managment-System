const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET all products with valuation and summary stats
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { search, category, low_stock } = req.query;

    let query = `
      SELECT id, name, sku, barcode, category, cost_price, selling_price,
             stock_quantity, reorder_level, unit, description, created_at, updated_at,
             ROUND(stock_quantity * cost_price, 2) AS stock_valuation
      FROM products
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (category && category !== 'All') {
      query += ` AND category = ?`;
      params.push(category);
    }

    if (low_stock === 'true') {
      query += ` AND stock_quantity <= reorder_level`;
    }

    query += ` ORDER BY id DESC`;

    const products = db.prepare(query).all(...params);

    // Calculate aggregated statistics
    const statsQuery = `
      SELECT 
        COUNT(*) AS total_products,
        COALESCE(SUM(stock_quantity), 0) AS total_units,
        COALESCE(ROUND(SUM(stock_quantity * cost_price), 2), 0.0) AS total_stock_valuation,
        COALESCE(SUM(CASE WHEN stock_quantity <= reorder_level THEN 1 ELSE 0 END), 0) AS low_stock_count
      FROM products
    `;
    const stats = db.prepare(statsQuery).get() || {
      total_products: 0,
      total_units: 0,
      total_stock_valuation: 0,
      low_stock_count: 0
    };

    res.json({
      success: true,
      data: products,
      stats: {
        total_products: Number(stats.total_products),
        total_units: Number(stats.total_units),
        total_stock_valuation: Number(stats.total_stock_valuation),
        low_stock_count: Number(stats.low_stock_count)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET product by ID
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const product = db.prepare(`
      SELECT id, name, sku, barcode, category, cost_price, selling_price,
             stock_quantity, reorder_level, unit, description, created_at, updated_at,
             ROUND(stock_quantity * cost_price, 2) AS stock_valuation
      FROM products
      WHERE id = ?
    `).get(req.params.id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create product with opening stock
router.post('/', (req, res) => {
  const db = getDb();
  try {
    const {
      name,
      sku,
      barcode,
      category,
      cost_price,
      selling_price,
      reorder_level,
      opening_stock,
      unit,
      description
    } = req.body;

    // Field Validations
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Product name is required' });
    }
    if (!sku || !sku.trim()) {
      return res.status(400).json({ success: false, message: 'SKU is required' });
    }
    if (!category || !category.trim()) {
      return res.status(400).json({ success: false, message: 'Category is required' });
    }

    const costPriceNum = parseFloat(cost_price) || 0.0;
    const sellingPriceNum = parseFloat(selling_price) || 0.0;
    const reorderLevelNum = parseFloat(reorder_level) || 0.0;
    const openingStockNum = parseFloat(opening_stock) || 0.0;

    if (costPriceNum < 0 || sellingPriceNum < 0) {
      return res.status(400).json({ success: false, message: 'Prices cannot be negative' });
    }
    if (openingStockNum < 0) {
      return res.status(400).json({ success: false, message: 'Opening stock cannot be negative' });
    }

    // Check SKU duplicate
    const cleanSku = sku.trim();
    const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(cleanSku);
    if (existing) {
      return res.status(400).json({ success: false, message: `Product with SKU "${cleanSku}" already exists` });
    }

    // Atomic transaction for Product + Opening Stock movement
    db.exec('BEGIN');

    const insertStmt = db.prepare(`
      INSERT INTO products (
        name, sku, barcode, category, cost_price, selling_price,
        stock_quantity, reorder_level, unit, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      name.trim(),
      cleanSku,
      barcode ? barcode.trim() : cleanSku,
      category.trim(),
      costPriceNum,
      sellingPriceNum,
      openingStockNum,
      reorderLevelNum,
      unit ? unit.trim() : 'pcs',
      description ? description.trim() : ''
    );

    const productId = Number(result.lastInsertRowid);

    // Record Opening Stock movement if stock > 0
    if (openingStockNum > 0) {
      db.prepare(`
        INSERT INTO inventory_movements (
          product_id, product_name, sku, type, quantity,
          stock_before, stock_after, reference_type, reference_id,
          unit_cost, notes
        ) VALUES (?, ?, ?, 'OPENING_STOCK', ?, 0, ?, 'PRODUCT_CREATE', ?, ?, ?)
      `).run(
        productId,
        name.trim(),
        cleanSku,
        openingStockNum,
        openingStockNum,
        cleanSku,
        costPriceNum,
        `Initial opening stock of ${openingStockNum} units`
      );
    }

    db.exec('COMMIT');

    const createdProduct = db.prepare(`
      SELECT id, name, sku, barcode, category, cost_price, selling_price,
             stock_quantity, reorder_level, unit, description, created_at, updated_at,
             ROUND(stock_quantity * cost_price, 2) AS stock_valuation
      FROM products WHERE id = ?
    `).get(productId);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: createdProduct
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update product
router.put('/:id', (req, res) => {
  const db = getDb();
  try {
    const { id } = req.params;
    const {
      name,
      sku,
      barcode,
      category,
      cost_price,
      selling_price,
      reorder_level,
      unit,
      description
    } = req.body;

    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (sku && sku.trim() !== existing.sku) {
      const duplicate = db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(sku.trim(), id);
      if (duplicate) {
        return res.status(400).json({ success: false, message: `SKU "${sku.trim()}" is already in use by another product` });
      }
    }

    db.prepare(`
      UPDATE products SET
        name = COALESCE(?, name),
        sku = COALESCE(?, sku),
        barcode = COALESCE(?, barcode),
        category = COALESCE(?, category),
        cost_price = COALESCE(?, cost_price),
        selling_price = COALESCE(?, selling_price),
        reorder_level = COALESCE(?, reorder_level),
        unit = COALESCE(?, unit),
        description = COALESCE(?, description),
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      sku ? sku.trim() : null,
      barcode ? barcode.trim() : null,
      category ? category.trim() : null,
      cost_price !== undefined ? parseFloat(cost_price) : null,
      selling_price !== undefined ? parseFloat(selling_price) : null,
      reorder_level !== undefined ? parseFloat(reorder_level) : null,
      unit ? unit.trim() : null,
      description !== undefined ? description.trim() : null,
      id
    );

    const updated = db.prepare(`
      SELECT id, name, sku, barcode, category, cost_price, selling_price,
             stock_quantity, reorder_level, unit, description, created_at, updated_at,
             ROUND(stock_quantity * cost_price, 2) AS stock_valuation
      FROM products WHERE id = ?
    `).get(id);

    res.json({ success: true, message: 'Product updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST adjust stock manually
router.post('/:id/adjust-stock', (req, res) => {
  const db = getDb();
  try {
    const { id } = req.params;
    const { quantity, reason, notes } = req.body;

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty === 0) {
      return res.status(400).json({ success: false, message: 'A valid non-zero adjustment quantity is required' });
    }

    db.exec('BEGIN');

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) {
      db.exec('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const newStock = product.stock_quantity + qty;
    if (newStock < 0) {
      // Check negative stock policy
      const policy = db.prepare("SELECT value FROM settings WHERE key = 'allow_negative_stock'").get();
      if (!policy || policy.value !== 'true') {
        db.exec('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Adjustment would cause negative stock (${newStock}). Current stock is ${product.stock_quantity}.`
        });
      }
    }

    db.prepare(`
      UPDATE products 
      SET stock_quantity = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(newStock, id);

    const movementType = qty > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
    db.prepare(`
      INSERT INTO inventory_movements (
        product_id, product_name, sku, type, quantity,
        stock_before, stock_after, reference_type, reference_id,
        unit_cost, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL_ADJUST', ?, ?, ?)
    `).run(
      product.id,
      product.name,
      product.sku,
      movementType,
      qty,
      product.stock_quantity,
      newStock,
      reason || 'Inventory Adjustment',
      product.cost_price,
      notes || `Stock adjusted by ${qty} units (${reason || 'Manual'})`
    );

    db.exec('COMMIT');

    const updated = db.prepare(`
      SELECT id, name, sku, barcode, category, cost_price, selling_price,
             stock_quantity, reorder_level, unit, description, created_at, updated_at,
             ROUND(stock_quantity * cost_price, 2) AS stock_valuation
      FROM products WHERE id = ?
    `).get(id);

    res.json({
      success: true,
      message: `Stock successfully adjusted. New quantity: ${newStock}`,
      data: updated
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE product
router.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const { id } = req.params;

    // Check if product was used in sales or purchases
    const hasSales = db.prepare('SELECT id FROM sale_items WHERE product_id = ? LIMIT 1').get(id);
    const hasPurchases = db.prepare('SELECT id FROM purchase_items WHERE product_id = ? LIMIT 1').get(id);

    if (hasSales || hasPurchases) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete product because it has associated sales or purchase transactions. Archive or adjust stock to 0 instead.'
      });
    }

    db.exec('BEGIN');
    db.prepare('DELETE FROM inventory_movements WHERE product_id = ?').run(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    db.exec('COMMIT');

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
