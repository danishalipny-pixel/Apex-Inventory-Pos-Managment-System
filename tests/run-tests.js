const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { ApiClient } = require('./test-helpers');

// Configure isolated test environment
const TEST_PORT = 3199;
const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'test_inventory.db');

// Ensure clean test database on startup
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}
// Also remove WAL / SHM files if any
if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);

process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.PORT = TEST_PORT;

let { startServer, stopServer } = require('../server');

const client = new ApiClient(`http://localhost:${TEST_PORT}`);

const testResults = {
  test1: { status: 'PENDING', title: 'Product Creation & Opening Stock', details: [] },
  test2: { status: 'PENDING', title: 'Complete POS Sale & Print Receipt', details: [] },
  test3: { status: 'PENDING', title: 'Automatic Stock Deduction', details: [] },
  test4: { status: 'PENDING', title: 'Purchase Receiving & Stock Increase', details: [] },
  test5: { status: 'PENDING', title: 'Persistence After Refresh & Server Restart', details: [] }
};

function logStep(testKey, message, isSuccess = true) {
  const icon = isSuccess ? '  ✓' : '  ✗';
  console.log(`${icon} ${message}`);
  testResults[testKey].details.push({ message, isSuccess });
}

async function runAllTests() {
  console.log('===============================================================');
  console.log('    MANDATORY FINAL VERIFICATION TEST SUITE');
  console.log('    Isolated Test DB:', TEST_DB_PATH);
  console.log('    Server Port:', TEST_PORT);
  console.log('===============================================================\n');

  await startServer(TEST_PORT);

  let createdProduct = null;
  let testCustomer = null;
  let firstSaleInvoice = null;
  let testPurchaseId = null;

  try {
    // ------------------------------------------------------------------------
    // TEST 1 — Product Creation & Opening Stock
    // ------------------------------------------------------------------------
    console.log('[TEST 1] Executing: Product Creation & Opening Stock...');
    try {
      // 1. Add new product with opening stock
      const productPayload = {
        name: 'Precision Wireless Barcode Scanner',
        sku: 'SCAN-WL-900',
        barcode: '890123456789',
        category: 'Electronics',
        cost_price: 35.00,
        selling_price: 79.50,
        reorder_level: 5,
        opening_stock: 20,
        unit: 'pcs',
        description: 'High-speed 1D/2D wireless handheld barcode reader'
      };

      const createRes = await client.post('/api/products', productPayload);
      assert.strictEqual(createRes.status, 201, `Expected status 201, got ${createRes.status}: ${JSON.stringify(createRes.data)}`);
      assert.strictEqual(createRes.data.success, true);
      createdProduct = createRes.data.data;

      logStep('test1', `Created product "${createdProduct.name}" (SKU: ${createdProduct.sku}) with opening stock 20`);

      // 2. Verify product appears in product listing
      const listRes = await client.get('/api/products');
      assert.strictEqual(listRes.status, 200);
      assert.strictEqual(listRes.data.success, true);
      const foundInList = listRes.data.data.find(p => p.sku === 'SCAN-WL-900');
      assert.ok(foundInList, 'Product SCAN-WL-900 must appear in products listing');
      logStep('test1', 'Verified product appears in catalog listing');

      // 3. Verify stock quantity and stock valuation
      assert.strictEqual(Number(foundInList.stock_quantity), 20, 'Stock quantity must be 20');
      const expectedValuation = Math.round(20 * 35.00 * 100) / 100; // 700.00
      assert.strictEqual(Number(foundInList.stock_valuation), expectedValuation, `Valuation must be ${expectedValuation}`);
      logStep('test1', `Verified stock quantity = 20 and stock valuation = $${expectedValuation.toFixed(2)}`);

      // 4. Verify opening stock movement history
      const movRes = await client.get(`/api/inventory/movements?sku=SCAN-WL-900`);
      assert.strictEqual(movRes.status, 200);
      const openingMov = movRes.data.data.find(m => m.type === 'OPENING_STOCK');
      assert.ok(openingMov, 'An OPENING_STOCK movement must be recorded');
      assert.strictEqual(Number(openingMov.quantity), 20);
      assert.strictEqual(Number(openingMov.stock_before), 0);
      assert.strictEqual(Number(openingMov.stock_after), 20);
      logStep('test1', 'Verified opening stock movement recorded in audit ledger (0 -> 20)');

      // 5. Simulate page refresh / refetch
      const refreshRes = await client.get(`/api/products/${createdProduct.id}`);
      assert.strictEqual(refreshRes.status, 200);
      assert.strictEqual(refreshRes.data.data.name, productPayload.name);
      assert.strictEqual(Number(refreshRes.data.data.stock_quantity), 20);
      logStep('test1', 'Simulated page refresh: data remains saved and persistent');

      testResults.test1.status = 'PASS';
      console.log('>>> TEST 1 RESULT: PASS\n');
    } catch (err) {
      testResults.test1.status = 'FAIL';
      logStep('test1', `Failure: ${err.message}`, false);
      console.error('>>> TEST 1 RESULT: FAIL:', err);
    }

    // ------------------------------------------------------------------------
    // TEST 2 — Complete POS Sale & Print Receipt
    // ------------------------------------------------------------------------
    console.log('[TEST 2] Executing: Complete POS Sale & Print Receipt...');
    try {
      // 1. Create a customer or select walk-in
      const custRes = await client.post('/api/customers', {
        name: 'Sarah Connor',
        phone: '+1 (555) 839-2001',
        email: 'sarah.connor@cyber.local',
        address: '42 Industrial Blvd'
      });
      assert.strictEqual(custRes.status, 201);
      testCustomer = custRes.data.data;
      logStep('test2', `Customer created: ${testCustomer.name} (ID: ${testCustomer.id})`);

      // 2. Select product and complete POS sale
      // Sale parameters: 2 units of SCAN-WL-900 @ 79.50 each
      // Subtotal = 159.00
      // 10% discount = 15.90
      // Taxable = 143.10
      // 10% tax = 14.31
      // Total = 157.41
      // Payment method: Cash, Amount tendered: 160.00, Change: 2.59
      const salePayload = {
        customer_id: testCustomer.id,
        items: [
          {
            product_id: createdProduct.id,
            quantity: 2,
            unit_price: 79.50
          }
        ],
        discount_rate: 10,
        tax_rate: 10.0,
        amount_paid: 160.00,
        payment_method: 'Cash',
        notes: 'Test sale with 10% discount and cash payment'
      };

      const saleRes = await client.post('/api/sales', salePayload);
      assert.strictEqual(saleRes.status, 201, `Failed to complete sale: ${JSON.stringify(saleRes.data)}`);
      assert.strictEqual(saleRes.data.success, true);
      const saleData = saleRes.data.data;
      firstSaleInvoice = saleData.invoice_number;

      logStep('test2', `Completed sale invoice #${saleData.invoice_number}`);

      // 3. Verify financial calculations
      assert.ok(saleData.invoice_number.startsWith('INV-'), 'Invoice number must have INV- prefix');
      assert.strictEqual(Number(saleData.subtotal), 159.00, 'Subtotal must be 159.00');
      assert.strictEqual(Number(saleData.discount_amount), 15.90, 'Discount must be 15.90');
      assert.strictEqual(Number(saleData.tax_amount), 14.31, 'Tax must be 14.31');
      assert.strictEqual(Number(saleData.total), 157.41, 'Total must be 157.41');
      assert.strictEqual(Number(saleData.amount_paid), 160.00, 'Amount paid must be 160.00');
      assert.strictEqual(Number(saleData.change_amount), 2.59, 'Change must be 2.59');
      assert.strictEqual(saleData.payment_status, 'PAID', 'Payment status must be PAID');
      assert.strictEqual(saleData.payment_method, 'Cash', 'Payment method must be Cash');
      logStep('test2', 'Verified invoice financial fields: subtotal, discount, tax, total, and change return');

      // 4. Verify receipt payload with business details
      assert.ok(saleData.business, 'Receipt business information must exist');
      assert.ok(saleData.business.name, 'Business name must exist on receipt');
      assert.ok(saleData.business.tax_id, 'Tax ID must exist on receipt');
      assert.ok(saleData.items && saleData.items.length === 1, 'Receipt must contain sold line items');
      assert.strictEqual(saleData.items[0].product_name, 'Precision Wireless Barcode Scanner');
      logStep('test2', `Verified receipt payload: business details ("${saleData.business.name}"), tax ID, and line items`);

      // 5. Verify sale appears in sales register
      const registerRes = await client.get('/api/sales');
      assert.strictEqual(registerRes.status, 200);
      const foundSale = registerRes.data.data.find(s => s.invoice_number === firstSaleInvoice);
      assert.ok(foundSale, 'Sale must be present in sales register');
      assert.strictEqual(Number(foundSale.total), 157.41);
      logStep('test2', 'Verified sale appears in the sales register');

      testResults.test2.status = 'PASS';
      console.log('>>> TEST 2 RESULT: PASS\n');
    } catch (err) {
      testResults.test2.status = 'FAIL';
      logStep('test2', `Failure: ${err.message}`, false);
      console.error('>>> TEST 2 RESULT: FAIL:', err);
    }

    // ------------------------------------------------------------------------
    // TEST 3 — Automatic Stock Deduction & Oversell Policy & Atomicity
    // ------------------------------------------------------------------------
    console.log('[TEST 3] Executing: Automatic Stock Deduction & Integrity...');
    try {
      // 1. Record stock before sale
      const checkStock1 = await client.get(`/api/products/${createdProduct.id}`);
      const stockBeforeSale = Number(checkStock1.data.data.stock_quantity);
      // It was 20 initially, sold 2 in Test 2, so it should be 18
      assert.strictEqual(stockBeforeSale, 18, 'Stock before test sale must be 18');
      logStep('test3', `Recorded available stock before sale: ${stockBeforeSale} units`);

      // 2. Sell known quantity of 3 units
      const saleQty = 3;
      const secondSaleRes = await client.post('/api/sales', {
        customer_id: 1, // Walk-in
        items: [{ product_id: createdProduct.id, quantity: saleQty, unit_price: 79.50 }],
        payment_method: 'Card',
        amount_paid: 3 * 79.50 * 1.10
      });
      assert.strictEqual(secondSaleRes.status, 201);
      const secondSaleInvoice = secondSaleRes.data.data.invoice_number;
      logStep('test3', `Sold known quantity of ${saleQty} units under invoice ${secondSaleInvoice}`);

      // 3. Verify stock decreased by exactly 3 units (18 -> 15)
      const checkStock2 = await client.get(`/api/products/${createdProduct.id}`);
      const stockAfterSale = Number(checkStock2.data.data.stock_quantity);
      assert.strictEqual(stockAfterSale, stockBeforeSale - saleQty, `Stock must decrease from ${stockBeforeSale} to ${stockBeforeSale - saleQty}`);
      logStep('test3', `Verified stock decreased by exactly ${saleQty} units (${stockBeforeSale} -> ${stockAfterSale})`);

      // 4. Verify inventory movement history records the sale
      const movRes = await client.get(`/api/inventory/movements?sku=${createdProduct.sku}&type=SALE`);
      assert.strictEqual(movRes.status, 200);
      const saleMovement = movRes.data.data.find(m => m.reference_id === secondSaleInvoice);
      assert.ok(saleMovement, `Movement record for invoice ${secondSaleInvoice} must exist`);
      assert.strictEqual(Number(saleMovement.quantity), -saleQty);
      assert.strictEqual(Number(saleMovement.stock_before), stockBeforeSale);
      assert.strictEqual(Number(saleMovement.stock_after), stockAfterSale);
      logStep('test3', `Verified movement audit record: type=SALE, qty=-${saleQty}, before=${stockBeforeSale}, after=${stockAfterSale}`);

      // 5. Attempt to sell more than available stock (current stock is 15, attempt to sell 50)
      const overSellQty = 50;
      const overSellRes = await client.post('/api/sales', {
        customer_id: 1,
        items: [{ product_id: createdProduct.id, quantity: overSellQty, unit_price: 79.50 }],
        payment_method: 'Cash',
        amount_paid: 5000.00
      });

      // Confirm rejection
      assert.strictEqual(overSellRes.status, 400, `Expected 400 rejection on oversell, got ${overSellRes.status}`);
      assert.strictEqual(overSellRes.data.success, false);
      assert.ok(overSellRes.data.message.includes('Insufficient stock'), 'Message must indicate insufficient stock');
      logStep('test3', `Attempted over-sell of ${overSellQty} units (available: ${stockAfterSale}): rejected with HTTP 400 and clear error message`);

      // 6. Verify atomicity: failed sale does NOT modify stock or create records
      const checkStock3 = await client.get(`/api/products/${createdProduct.id}`);
      assert.strictEqual(Number(checkStock3.data.data.stock_quantity), stockAfterSale, 'Stock must remain completely unchanged after failed sale');
      
      const salesAfterCheck = await client.get('/api/sales');
      const badSale = salesAfterCheck.data.data.find(s => s.items && s.items.some(i => i.quantity === overSellQty));
      assert.strictEqual(badSale, undefined, 'No partial sale record should be saved on rejection');
      logStep('test3', 'Verified transaction atomicity: stock, sales register, and financial records completely untouched');

      testResults.test3.status = 'PASS';
      console.log('>>> TEST 3 RESULT: PASS\n');
    } catch (err) {
      testResults.test3.status = 'FAIL';
      logStep('test3', `Failure: ${err.message}`, false);
      console.error('>>> TEST 3 RESULT: FAIL:', err);
    }

    // ------------------------------------------------------------------------
    // TEST 4 — Purchase Receiving & Stock Increase
    // ------------------------------------------------------------------------
    console.log('[TEST 4] Executing: Purchase Receiving & Stock Increase...');
    try {
      // Current stock is 15.
      const currentStockBeforePO = 15;

      // 1. Create a purchase record for product
      const poQty = 10;
      const poCost = 30.00;
      const createPORes = await client.post('/api/purchases', {
        supplier_id: 1, // Global Wholesale Supplies Inc.
        items: [
          {
            product_id: createdProduct.id,
            ordered_quantity: poQty,
            cost_price: poCost
          }
        ],
        amount_paid: 100.00, // Total is 300, unpaid is 200
        payment_method: 'Bank Transfer',
        notes: 'Replenishment order for barcode scanner'
      });

      assert.strictEqual(createPORes.status, 201);
      assert.strictEqual(createPORes.data.success, true);
      const purchaseData = createPORes.data.data;
      testPurchaseId = purchaseData.id;
      const poNumber = purchaseData.purchase_number;

      logStep('test4', `Created purchase order #${poNumber} for ${poQty} units @ $${poCost}`);

      // 2. Verify stock has NOT increased yet merely by ordering
      const checkStockOnPO = await client.get(`/api/products/${createdProduct.id}`);
      assert.strictEqual(Number(checkStockOnPO.data.data.stock_quantity), currentStockBeforePO, 'Stock must NOT increase upon order creation');
      logStep('test4', `Verified stock remains at ${currentStockBeforePO} units prior to receiving`);

      // 3. Receive the purchased quantity
      const receiveRes = await client.post(`/api/purchases/${testPurchaseId}/receive`, {
        items: [{ product_id: createdProduct.id, received_quantity: poQty }]
      });
      assert.strictEqual(receiveRes.status, 200, `Receiving failed: ${JSON.stringify(receiveRes.data)}`);
      assert.strictEqual(receiveRes.data.success, true);
      assert.strictEqual(receiveRes.data.data.status, 'RECEIVED');
      logStep('test4', `Successfully received ${poQty} units against #${poNumber}`);

      // 4. Verify stock increases by exactly the quantity received (15 -> 25)
      const checkStockAfterReceive = await client.get(`/api/products/${createdProduct.id}`);
      const newStock = Number(checkStockAfterReceive.data.data.stock_quantity);
      assert.strictEqual(newStock, currentStockBeforePO + poQty, `Stock must be ${currentStockBeforePO + poQty}`);
      logStep('test4', `Verified stock increased by exactly the received quantity (${currentStockBeforePO} -> ${newStock})`);

      // 5. Verify inventory movement history records PURCHASE_RECEIVE
      const receiveMovRes = await client.get(`/api/inventory/movements?sku=${createdProduct.sku}&type=PURCHASE_RECEIVE`);
      assert.strictEqual(receiveMovRes.status, 200);
      const receiveMov = receiveMovRes.data.data.find(m => m.reference_id === poNumber);
      assert.ok(receiveMov, 'PURCHASE_RECEIVE movement must be logged');
      assert.strictEqual(Number(receiveMov.quantity), poQty);
      assert.strictEqual(Number(receiveMov.stock_before), currentStockBeforePO);
      assert.strictEqual(Number(receiveMov.stock_after), newStock);
      logStep('test4', `Verified movement audit record: type=PURCHASE_RECEIVE, qty=+${poQty}, before=${currentStockBeforePO}, after=${newStock}`);

      // 6. Confirm receiving the same quantity twice is prevented
      const duplicateReceiveRes = await client.post(`/api/purchases/${testPurchaseId}/receive`, {
        items: [{ product_id: createdProduct.id, received_quantity: poQty }]
      });
      assert.strictEqual(duplicateReceiveRes.status, 400, 'Duplicate receiving must be rejected with 400');
      assert.strictEqual(duplicateReceiveRes.data.success, false);
      assert.strictEqual(duplicateReceiveRes.data.error_code, 'ALREADY_RECEIVED');
      logStep('test4', 'Confirmed duplicate receiving is strictly blocked with ALREADY_RECEIVED error');

      // Verify stock did NOT increase again
      const checkStockNoDuplicate = await client.get(`/api/products/${createdProduct.id}`);
      assert.strictEqual(Number(checkStockNoDuplicate.data.data.stock_quantity), newStock);
      logStep('test4', 'Confirmed stock level remained constant at 25 after rejected duplicate receiving');

      // 7. Verify supplier balance consistency
      const supplierRes = await client.get(`/api/suppliers/1`);
      assert.strictEqual(supplierRes.status, 200);
      assert.strictEqual(supplierRes.data.success, true);
      // Unpaid portion was 300 - 100 = 200
      assert.strictEqual(Number(supplierRes.data.data.balance), 200.00, 'Supplier balance must reflect accounts payable');
      logStep('test4', 'Verified supplier accounts payable balance is consistent ($200.00)');

      testResults.test4.status = 'PASS';
      console.log('>>> TEST 4 RESULT: PASS\n');
    } catch (err) {
      testResults.test4.status = 'FAIL';
      logStep('test4', `Failure: ${err.message}`, false);
      console.error('>>> TEST 4 RESULT: FAIL:', err);
    }

    // ------------------------------------------------------------------------
    // TEST 5 — Persistence After Refresh & Server Restart
    // ------------------------------------------------------------------------
    console.log('[TEST 5] Executing: Persistence After Refresh & Server Restart...');
    try {
      // 1. Simulate browser refresh by fetching all entities
      const preCheckProduct = await client.get(`/api/products/${createdProduct.id}`);
      const preCheckCustomer = await client.get(`/api/customers/${testCustomer.id}`);
      const preCheckPurchase = await client.get(`/api/purchases/${testPurchaseId}`);
      const preCheckSales = await client.get(`/api/sales`);

      assert.strictEqual(preCheckProduct.status, 200);
      assert.strictEqual(preCheckCustomer.status, 200);
      assert.strictEqual(preCheckPurchase.status, 200);
      assert.strictEqual(preCheckSales.status, 200);
      logStep('test5', 'Verified all created entities accessible on browser/API refresh');

      // 2. STOP the Node.js server and close database
      console.log('  Stopping Node.js server...');
      await stopServer();
      logStep('test5', 'Node.js server stopped and SQLite database connection closed');

      // Verify server is down
      let serverDown = false;
      try {
        await client.get('/api/settings/health');
      } catch (e) {
        serverDown = true;
      }
      assert.ok(serverDown, 'Server must be offline after stopServer');

      // 3. RESTART the Node.js server with the same database path
      console.log('  Restarting Node.js server with configured database...');
      await startServer(TEST_PORT);
      logStep('test5', 'Node.js server restarted on port ' + TEST_PORT);

      // 4. Verify all records and inventory quantities remain correct after restart
      const postRestartProduct = await client.get(`/api/products/${createdProduct.id}`);
      assert.strictEqual(postRestartProduct.status, 200);
      assert.strictEqual(postRestartProduct.data.data.name, 'Precision Wireless Barcode Scanner');
      assert.strictEqual(Number(postRestartProduct.data.data.stock_quantity), 25, 'Stock quantity must remain 25 after restart');
      assert.strictEqual(Number(postRestartProduct.data.data.stock_valuation), 25 * 30.00, 'Valuation must match updated cost');
      logStep('test5', 'Verified product and stock quantity (25 units) persistent in SQLite database');

      const postRestartCustomer = await client.get(`/api/customers/${testCustomer.id}`);
      assert.strictEqual(postRestartCustomer.status, 200);
      assert.strictEqual(postRestartCustomer.data.data.name, 'Sarah Connor');
      assert.strictEqual(Number(postRestartCustomer.data.data.total_spent), 157.41, 'Customer total spent persistent');
      logStep('test5', 'Verified customer records and spend balance persistent after restart');

      const postRestartPurchase = await client.get(`/api/purchases/${testPurchaseId}`);
      assert.strictEqual(postRestartPurchase.status, 200);
      assert.strictEqual(postRestartPurchase.data.data.status, 'RECEIVED', 'Purchase status must remain RECEIVED');
      logStep('test5', 'Verified purchase order status persistent (RECEIVED) after restart');

      const postRestartSales = await client.get(`/api/sales`);
      assert.strictEqual(postRestartSales.status, 200);
      const persistentSale = postRestartSales.data.data.find(s => s.invoice_number === firstSaleInvoice);
      assert.ok(persistentSale, `Sale invoice #${firstSaleInvoice} must be persistent in database`);
      logStep('test5', 'Verified all sales register invoices persistent after restart');

      // 5. Confirm file-based storage in configured database
      assert.ok(fs.existsSync(TEST_DB_PATH), `Database file ${TEST_DB_PATH} must exist on disk`);
      const dbStats = fs.statSync(TEST_DB_PATH);
      assert.ok(dbStats.size > 0, `Database file size (${dbStats.size} bytes) confirms disk storage`);
      logStep('test5', `Confirmed data stored in SQLite file on disk (${dbStats.size} bytes), independent of browser state`);

      testResults.test5.status = 'PASS';
      console.log('>>> TEST 5 RESULT: PASS\n');
    } catch (err) {
      testResults.test5.status = 'FAIL';
      logStep('test5', `Failure: ${err.message}`, false);
      console.error('>>> TEST 5 RESULT: FAIL:', err);
    }

  } finally {
    await stopServer();
    console.log('Test server shut down cleanly.');
  }

  // --------------------------------------------------------------------------
  // Summary & Report Generation
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log('                  FINAL AUTOMATED TEST REPORT');
  console.log('===============================================================');
  let allPassed = true;
  for (const [key, res] of Object.entries(testResults)) {
    const symbol = res.status === 'PASS' ? '✅' : '❌';
    console.log(`${symbol} ${key.toUpperCase()}: ${res.status} — ${res.title}`);
    if (res.status !== 'PASS') allPassed = false;
  }
  console.log('===============================================================\n');

  // Clean up isolated test database
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(`${TEST_DB_PATH}-wal`)) fs.unlinkSync(`${TEST_DB_PATH}-wal`);
    if (fs.existsSync(`${TEST_DB_PATH}-shm`)) fs.unlinkSync(`${TEST_DB_PATH}-shm`);
    console.log('Cleaned up isolated test database successfully.');
  } catch (e) {
    console.warn('Test DB cleanup warning:', e.message);
  }

  if (!allPassed) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
