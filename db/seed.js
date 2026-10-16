function seedSampleProducts(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (count > 0) return;

  const sampleProducts = [
    {
      name: 'Wireless Ergonomic Mouse',
      sku: 'ELEC-MOUSE-01',
      barcode: '8934001001',
      category: 'Electronics',
      cost_price: 14.50,
      selling_price: 29.99,
      stock_quantity: 25,
      reorder_level: 5,
      unit: 'pcs',
      description: '2.4GHz optical rechargeable ergonomic mouse'
    },
    {
      name: 'Mechanical Gaming Keyboard',
      sku: 'ELEC-KEYB-02',
      barcode: '8934001002',
      category: 'Electronics',
      cost_price: 38.00,
      selling_price: 79.99,
      stock_quantity: 15,
      reorder_level: 4,
      unit: 'pcs',
      description: 'RGB mechanical switches with detachable wrist rest'
    },
    {
      name: 'USB-C Fast Charging Cable 2m',
      sku: 'ELEC-CABL-03',
      barcode: '8934001003',
      category: 'Electronics',
      cost_price: 3.20,
      selling_price: 12.99,
      stock_quantity: 50,
      reorder_level: 10,
      unit: 'pcs',
      description: 'Braided nylon 100W PD charging cable'
    },
    {
      name: 'Organic Green Tea (50 bags)',
      sku: 'BEV-TEA-04',
      barcode: '8934001004',
      category: 'Beverages',
      cost_price: 4.10,
      selling_price: 8.50,
      stock_quantity: 40,
      reorder_level: 8,
      unit: 'box',
      description: 'Pure whole leaf Japanese matcha blend'
    },
    {
      name: 'Cold Brew Artisan Coffee 12oz',
      sku: 'BEV-COFF-05',
      barcode: '8934001005',
      category: 'Beverages',
      cost_price: 1.85,
      selling_price: 4.50,
      stock_quantity: 3,
      reorder_level: 6,
      unit: 'can',
      description: 'Nitro infused single-origin cold brew'
    },
    {
      name: 'A4 Premium Copy Paper (500 sheets)',
      sku: 'OFF-PAPR-06',
      barcode: '8934001006',
      category: 'Office Supplies',
      cost_price: 3.50,
      selling_price: 7.99,
      stock_quantity: 60,
      reorder_level: 15,
      unit: 'ream',
      description: '80gsm high brightness multipurpose paper'
    }
  ];

  db.exec('BEGIN');

  const insertProd = db.prepare(`
    INSERT INTO products (
      name, sku, barcode, category, cost_price, selling_price,
      stock_quantity, reorder_level, unit, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMovement = db.prepare(`
    INSERT INTO inventory_movements (
      product_id, product_name, sku, type, quantity,
      stock_before, stock_after, reference_type, reference_id,
      unit_cost, notes
    ) VALUES (?, ?, ?, 'OPENING_STOCK', ?, 0, ?, 'PRODUCT_CREATE', ?, ?, ?)
  `);

  for (const p of sampleProducts) {
    const res = insertProd.run(
      p.name, p.sku, p.barcode, p.category, p.cost_price, p.selling_price,
      p.stock_quantity, p.reorder_level, p.unit, p.description
    );
    const prodId = Number(res.lastInsertRowid);

    insertMovement.run(
      prodId, p.name, p.sku, p.stock_quantity, p.stock_quantity,
      p.sku, p.cost_price, `Initial stock seeded on system setup`
    );
  }

  db.exec('COMMIT');
}

module.exports = { seedSampleProducts };
