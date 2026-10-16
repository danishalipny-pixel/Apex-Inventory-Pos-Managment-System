const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET all business settings
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST update settings
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    db.exec('BEGIN');
    const upsertStmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    for (const [key, val] of Object.entries(updates)) {
      upsertStmt.run(key, String(val));
    }
    db.exec('COMMIT');

    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: settings
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET system health and statistics
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    const counts = {
      products: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
      sales: db.prepare('SELECT COUNT(*) as c FROM sales').get().c,
      purchases: db.prepare('SELECT COUNT(*) as c FROM purchases').get().c,
      customers: db.prepare('SELECT COUNT(*) as c FROM customers').get().c,
      suppliers: db.prepare('SELECT COUNT(*) as c FROM suppliers').get().c,
      movements: db.prepare('SELECT COUNT(*) as c FROM inventory_movements').get().c
    };

    res.json({
      success: true,
      status: 'UP',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      node_version: process.version,
      database: 'SQLite (node:sqlite)',
      records: counts
    });
  } catch (error) {
    res.status(500).json({ success: false, status: 'DOWN', message: error.message });
  }
});

module.exports = router;
