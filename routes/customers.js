const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET all customers
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { search } = req.query;

    let query = 'SELECT * FROM customers WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY id ASC';
    const customers = db.prepare(query).all(...params);

    res.json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single customer with sales history
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const sales = db.prepare('SELECT * FROM sales WHERE customer_id = ? ORDER BY id DESC').all(customer.id);

    res.json({ success: true, data: { ...customer, sales } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create customer
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name, phone, email, address } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Customer name is required' });
    }

    const result = db.prepare(`
      INSERT INTO customers (name, phone, email, address, total_spent, balance)
      VALUES (?, ?, ?, ?, 0.0, 0.0)
    `).run(
      name.trim(),
      phone ? phone.trim() : '',
      email ? email.trim() : '',
      address ? address.trim() : ''
    );

    const newCustomer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: newCustomer
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update customer
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, phone, email, address } = req.body;

    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    db.prepare(`
      UPDATE customers SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address)
      WHERE id = ?
    `).run(
      name ? name.trim() : null,
      phone ? phone.trim() : null,
      email ? email.trim() : null,
      address ? address.trim() : null,
      id
    );

    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    res.json({ success: true, message: 'Customer updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
