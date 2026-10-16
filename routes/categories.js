const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET all categories with product counts
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const categories = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM products WHERE category = c.name) AS product_count,
        (SELECT COALESCE(SUM(stock_quantity), 0) FROM products WHERE category = c.name) AS total_stock_units
      FROM categories c
      ORDER BY c.name ASC
    `).all();

    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create category
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const cleanName = name.trim();
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(cleanName);
    if (existing) {
      return res.status(400).json({ success: false, message: `Category "${cleanName}" already exists` });
    }

    const result = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(cleanName, description || '');
    const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({ success: true, message: 'Category created successfully', data: created });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
