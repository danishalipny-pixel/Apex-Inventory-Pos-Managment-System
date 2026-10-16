const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET all suppliers
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { search } = req.query;

    let query = 'SELECT * FROM suppliers WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR contact_person LIKE ? OR phone LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY id ASC';
    const suppliers = db.prepare(query).all(...params);

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_suppliers,
        COALESCE(SUM(balance), 0) as total_payable_balance
      FROM suppliers
    `).get() || { total_suppliers: 0, total_payable_balance: 0 };

    res.json({
      success: true,
      data: suppliers,
      stats: {
        total_suppliers: Number(stats.total_suppliers),
        total_payable_balance: Number(stats.total_payable_balance)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single supplier with purchases & payment ledger
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    const purchases = db.prepare('SELECT * FROM purchases WHERE supplier_id = ? ORDER BY id DESC').all(supplier.id);
    const payments = db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY id DESC').all(supplier.id);

    res.json({
      success: true,
      data: {
        ...supplier,
        purchases,
        payments
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create supplier
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, contact_person, phone, email, address, opening_balance } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Supplier company name is required' });
    }

    const initialBalance = parseFloat(opening_balance) || 0.0;

    const result = db.prepare(`
      INSERT INTO suppliers (name, contact_person, phone, email, address, balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      contact_person ? contact_person.trim() : '',
      phone ? phone.trim() : '',
      email ? email.trim() : '',
      address ? address.trim() : '',
      initialBalance
    );

    const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: created
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update supplier
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, contact_person, phone, email, address } = req.body;

    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    db.prepare(`
      UPDATE suppliers SET
        name = COALESCE(?, name),
        contact_person = COALESCE(?, contact_person),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address)
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      contact_person ? contact_person.trim() : null,
      phone ? phone.trim() : null,
      email ? email.trim() : null,
      address ? address.trim() : null,
      id
    );

    const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    res.json({ success: true, message: 'Supplier updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
