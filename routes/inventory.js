const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET inventory movement history / audit ledger
router.get('/movements', (req, res) => {
  try {
    const db = getDb();
    const { product_id, sku, type, search, limit } = req.query;

    let query = `SELECT * FROM inventory_movements WHERE 1=1`;
    const params = [];

    if (product_id) {
      query += ` AND product_id = ?`;
      params.push(product_id);
    }

    if (sku) {
      query += ` AND sku = ?`;
      params.push(sku.trim());
    }

    if (type && type !== 'All') {
      query += ` AND type = ?`;
      params.push(type);
    }

    if (search) {
      query += ` AND (product_name LIKE ? OR sku LIKE ? OR reference_id LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY id DESC`;

    if (limit) {
      query += ` LIMIT ?`;
      params.push(parseInt(limit, 10));
    }

    const movements = db.prepare(query).all(...params);

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_movements,
        COALESCE(SUM(CASE WHEN type = 'SALE' THEN ABS(quantity) ELSE 0 END), 0) as total_sold_units,
        COALESCE(SUM(CASE WHEN type = 'PURCHASE_RECEIVE' THEN quantity ELSE 0 END), 0) as total_received_units,
        COALESCE(SUM(CASE WHEN type = 'OPENING_STOCK' THEN quantity ELSE 0 END), 0) as total_opening_units
      FROM inventory_movements
    `).get() || { total_movements: 0, total_sold_units: 0, total_received_units: 0, total_opening_units: 0 };

    res.json({
      success: true,
      data: movements,
      stats: {
        total_movements: Number(stats.total_movements),
        total_sold_units: Number(stats.total_sold_units),
        total_received_units: Number(stats.total_received_units),
        total_opening_units: Number(stats.total_opening_units)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET inventory valuation report
router.get('/valuation', (req, res) => {
  try {
    const db = getDb();

    // Summary totals
    const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_skus,
        COALESCE(SUM(stock_quantity), 0) as total_stock_units,
        COALESCE(ROUND(SUM(stock_quantity * cost_price), 2), 0.0) as total_cost_valuation,
        COALESCE(ROUND(SUM(stock_quantity * selling_price), 2), 0.0) as total_retail_valuation,
        COALESCE(ROUND(SUM(stock_quantity * (selling_price - cost_price)), 2), 0.0) as potential_profit
      FROM products
    `).get();

    // Grouped by Category
    const byCategory = db.prepare(`
      SELECT 
        category,
        COUNT(*) as sku_count,
        COALESCE(SUM(stock_quantity), 0) as stock_units,
        COALESCE(ROUND(SUM(stock_quantity * cost_price), 2), 0.0) as cost_valuation,
        COALESCE(ROUND(SUM(stock_quantity * selling_price), 2), 0.0) as retail_valuation
      FROM products
      GROUP BY category
      ORDER BY cost_valuation DESC
    `).all();

    // Product list with valuation
    const items = db.prepare(`
      SELECT id, name, sku, category, stock_quantity, cost_price, selling_price,
             ROUND(stock_quantity * cost_price, 2) as cost_valuation,
             ROUND(stock_quantity * selling_price, 2) as retail_valuation,
             ROUND(stock_quantity * (selling_price - cost_price), 2) as potential_profit
      FROM products
      ORDER BY cost_valuation DESC
    `).all();

    res.json({
      success: true,
      data: {
        summary: {
          total_skus: Number(summary.total_skus),
          total_stock_units: Number(summary.total_stock_units),
          total_cost_valuation: Number(summary.total_cost_valuation),
          total_retail_valuation: Number(summary.total_retail_valuation),
          potential_profit: Number(summary.potential_profit)
        },
        by_category: byCategory,
        items
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET low stock alerts
router.get('/low-stock', (req, res) => {
  try {
    const db = getDb();
    const lowStockItems = db.prepare(`
      SELECT id, name, sku, category, stock_quantity, reorder_level, unit, cost_price, selling_price
      FROM products
      WHERE stock_quantity <= reorder_level
      ORDER BY (stock_quantity - reorder_level) ASC
    `).all();

    res.json({ success: true, count: lowStockItems.length, data: lowStockItems });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
