const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let currentDbInstance = null;
let currentDbPath = null;

function getDb(customPath) {
  const dbPath = customPath || process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'inventory.db');
  
  if (currentDbInstance && currentDbPath === dbPath) {
    return currentDbInstance;
  }

  // Ensure target directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  currentDbInstance = db;
  currentDbPath = dbPath;

  // Configure pragmas
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  initSchema(db);
  seedInitialData(db);

  return db;
}

function closeDb() {
  if (currentDbInstance) {
    try {
      currentDbInstance.close();
    } catch (e) {
      // Ignore if already closed
    }
    currentDbInstance = null;
    currentDbPath = null;
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT,
      category TEXT NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0.0,
      selling_price REAL NOT NULL DEFAULT 0.0,
      stock_quantity REAL NOT NULL DEFAULT 0.0,
      reorder_level REAL NOT NULL DEFAULT 5.0,
      unit TEXT DEFAULT 'pcs',
      description TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      total_spent REAL DEFAULT 0.0,
      balance REAL DEFAULT 0.0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      balance REAL DEFAULT 0.0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      customer_name TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount_rate REAL DEFAULT 0.0,
      discount_amount REAL DEFAULT 0.0,
      tax_rate REAL DEFAULT 0.0,
      tax_amount REAL DEFAULT 0.0,
      total REAL NOT NULL,
      amount_paid REAL NOT NULL,
      change_amount REAL DEFAULT 0.0,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      unit_cost REAL NOT NULL,
      unit_price REAL NOT NULL,
      quantity REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      supplier_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ORDERED',
      total_amount REAL NOT NULL,
      amount_paid REAL DEFAULT 0.0,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID',
      notes TEXT,
      received_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      ordered_quantity REAL NOT NULL,
      received_quantity REAL DEFAULT 0.0,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      stock_before REAL NOT NULL,
      stock_after REAL NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      unit_cost REAL DEFAULT 0.0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      purchase_id INTEGER REFERENCES purchases(id),
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);
}

function seedInitialData(db) {
  // Default Settings
  const defaultSettings = [
    ['business_name', 'Apex Retail POS & Inventory'],
    ['business_address', '742 Evergreen Commercial Way, Suite 100'],
    ['business_phone', '+1 (800) 555-0199'],
    ['business_email', 'sales@apexpos.com'],
    ['business_tax_id', 'US-TAX-994820'],
    ['currency', 'USD'],
    ['currency_symbol', '$'],
    ['tax_rate', '10.0'],
    ['allow_negative_stock', 'false'],
    ['receipt_footer', 'Thank you for shopping with us! Returns accepted within 30 days with receipt.']
  ];

  const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

  for (const [key, val] of defaultSettings) {
    if (!checkSetting.get(key)) {
      insertSetting.run(key, val);
    }
  }

  // Walk-in Customer
  const checkCustomer = db.prepare('SELECT id FROM customers WHERE id = 1');
  if (!checkCustomer.get()) {
    db.prepare(`
      INSERT INTO customers (id, name, phone, email, address, total_spent, balance)
      VALUES (1, 'Walk-in Customer', '000-000-0000', 'walkin@store.local', 'In-Store', 0.0, 0.0)
    `).run();
  }

  // Default Categories
  const categories = ['Electronics', 'Beverages', 'Office Supplies', 'Snacks & Food', 'Hardware'];
  const checkCat = db.prepare('SELECT id FROM categories WHERE name = ?');
  const insertCat = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)');
  for (const cat of categories) {
    if (!checkCat.get(cat)) {
      insertCat.run(cat, `General category for ${cat}`);
    }
  }

  // Default Supplier
  const checkSup = db.prepare('SELECT id FROM suppliers WHERE id = 1');
  if (!checkSup.get()) {
    db.prepare(`
      INSERT INTO suppliers (id, name, contact_person, phone, email, address, balance)
      VALUES (1, 'Global Wholesale Supplies Inc.', 'John Reynolds', '+1 (555) 321-4567', 'orders@globalsupplies.com', '450 Industrial Parkway', 0.0)
    `).run();
  }

  // Sample Products for Fresh Install
  try {
    const { seedSampleProducts } = require('./seed');
    seedSampleProducts(db);
  } catch (e) {
    console.error('Failed seeding sample products:', e);
  }
}

module.exports = {
  getDb,
  closeDb,
  initSchema
};
