# Apex Inventory & POS Management System

A modern, production-grade **Inventory & Point of Sale (POS) Management System** built with **Node.js**, **Express**, **SQLite** (`node:sqlite`), and a responsive web dashboard designed for retail, wholesale, and multi-category stock operations.

---

## 🌟 Key Features

### 1. Point of Sale (POS) Terminal
- **Fast Product Grid & Barcode Scanning**: Instant lookup by product name, SKU, or hardware barcode scanner input (`Enter` key triggers direct cart addition).
- **Interactive Cart & Multi-Tender Checkout**:
  - Live item quantity increment/decrement with real-time stock boundary checks.
  - Quick customer selection with built-in Walk-in customer and instant "+ New Customer" creation.
  - Configurable discount percentage and real-time tax calculation.
  - Cash tendered and instant change calculation with quick-cash denomination buttons.
  - Payment method support: Cash, Credit/Debit Card, Bank Transfer, Mobile Money.
- **Printable Thermal Receipt**:
  - Generates official POS receipts with business details, tax ID, cashier info, line items, subtotal, discounts, taxes, grand total, payment method, change returned, and barcode strip.
  - Optimized `@media print` style sheet formatted for 80mm POS thermal receipt printers.

### 2. Product Catalog & Opening Stock
- Complete CRUD operations: Product Name, SKU (unique), Barcode, Category, Cost Price, Selling Price, Reorder Level, Unit of Measure, and Description.
- **Opening Stock Initialization**: Setting opening stock automatically updates warehouse quantity and logs an immutable `OPENING_STOCK` audit ledger entry.
- **Real-Time Stock Valuation**: Automatically calculates `stock_quantity * cost_price` per item and across categories.
- **Low Stock Watchlist**: Proactive alerts when stock hits or falls below the designated reorder level.
- **Manual Stock Adjustments**: Fast adjustments for damaged items, returns, or physical count reconciliations with audit memo tracking.

### 3. Automatic Stock Deduction & Oversell Policy
- **ACID-Compliant Transactions**: Every sale deducts inventory stock inside an atomic database transaction.
- **Strict Oversell Protection**: Rejects sales when requested quantity exceeds available stock (unless the explicitly configured negative stock policy allows it).
- **Transaction Rollback Protection**: Failed sales roll back immediately without partially deducting stock or corrupting financial ledgers.

### 4. Purchases & Stock Receiving Workflow
- **Purchase Orders (PO)**: Create purchase orders with suppliers, line items, agreed unit costs, and ordered quantities.
- **Shipment Receiving**: Stock increases **only** upon receiving actual delivered quantities, not merely upon order creation.
- **Duplicate Receiving Guard**: Permanent server-side validation blocks receiving the same purchase order twice.
- **Accounts Payable Ledger**: Tracks supplier balances, credit, and recorded payments.

### 5. Inventory Movement Audit Ledger
- Immutable audit trail recording every stock alteration:
  - `OPENING_STOCK`
  - `SALE`
  - `PURCHASE_RECEIVE`
  - `ADJUSTMENT_IN` / `ADJUSTMENT_OUT`
- Tracks timestamp, product, SKU, quantity change, stock before, stock after, and reference transaction IDs (`INV-...` or `PO-...`).

### 6. Persistence & Isolated Test Architecture
- Permanent SQLite storage stored in `data/inventory.db` using Node.js built-in `node:sqlite`.
- Resilient to browser refreshes and server restarts.
- Fully isolated automated test suite running against a separate test database (`data/test_inventory.db`) with automatic teardown.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** v22.5.0 or higher (v24 recommended)
- **npm** (included with Node.js)

### Installation
```bash
git clone <repository-url>
cd "Inventory & POS Management System"
npm install
```

### Running the Application Locally
```bash
# Start the production server on port 3000
npm start
```
Then open your web browser to:
```
http://localhost:3000
```

### Running the Mandatory Verification Test Suite
```bash
npm test
```
The test suite automatically sets up an isolated test database, runs all 5 verification tests, checks API responses, database persistence, transaction rollbacks, and outputs a structured report.

---

## 🧪 Mandatory Verification Tests Executed

| Test | Objective | Result |
| :--- | :--- | :--- |
| **TEST 1** | **Product Creation & Opening Stock**: Product creation, SKU uniqueness, opening stock initialization, stock valuation calculation (`Qty * Cost`), and persistence across refresh. | **PASS** ✅ |
| **TEST 2** | **Complete POS Sale & Print Receipt**: Adding products to POS cart, customer assignment, invoice generation, discount & tax calculations, receipt modal rendering, and sales register appearance. | **PASS** ✅ |
| **TEST 3** | **Automatic Stock Deduction**: Exact stock deduction on sale, inventory movement logging, strict oversell rejection (HTTP 400), and transaction atomicity rollback verification. | **PASS** ✅ |
| **TEST 4** | **Purchase Receiving & Stock Increase**: Purchase order creation without premature stock increase, stock increment by exact received quantity, audit ledger logging, duplicate receiving prevention, and accounts payable consistency. | **PASS** ✅ |
| **TEST 5** | **Persistence After Refresh & Server Restart**: Server stop, restart with database reconnection, and verification of persistent products, stock levels, sales invoices, customer spend, and purchase records. | **PASS** ✅ |

---

## 📂 Project Architecture

```
├── server.js               # Express application server and route mounts
├── package.json            # Node.js dependencies and scripts
├── db/
│   ├── database.js         # SQLite database schema, pragmas, and connection manager
│   └── seed.js             # Initial catalog seed data for fresh setups
├── routes/
│   ├── products.js         # Product catalog and stock adjustment endpoints
│   ├── sales.js            # POS checkout, invoice generation, and sales register
│   ├── purchases.js        # Purchase orders and shipment receiving workflow
│   ├── customers.js        # Customer directory and purchase history
│   ├── suppliers.js        # Supplier accounts payable and contact directory
│   ├── inventory.js        # Movement audit ledger and valuation analytics
│   ├── categories.js       # Category management
│   └── settings.js         # Business details, tax rates, and stock policies
├── public/
│   ├── index.html          # Single Page Application dashboard & POS terminal
│   ├── css/
│   │   └── style.css       # Responsive UI layout and thermal receipt print media
│   └── js/
│       ├── app.js          # Main UI controller, routing, and notifications
│       ├── pos.js          # POS terminal, cart calculations, and receipt generator
│       ├── products.js     # Products table and modal handlers
│       ├── purchases.js    # Purchase orders and receiving verification
│       ├── customers.js    # Customer and supplier views
│       ├── sales.js        # Sales register and receipt reprint
│       └── inventory.js    # Movements ledger and valuation breakdown
├── tests/
│   ├── run-tests.js        # 5-stage automated integration test runner
│   └── test-helpers.js     # HTTP testing client
└── data/
    └── inventory.db        # SQLite database file
```

---

## 🔒 Security & Data Integrity
- Atomic transactions (`BEGIN ... COMMIT / ROLLBACK`) on all multi-table mutations.
- Strict input validation on quantities, costs, and selling prices.
- Relational foreign key enforcement via SQLite `PRAGMA foreign_keys = ON`.
- WAL (Write-Ahead Logging) journaling for concurrent read/write throughput.
- Zero mock data or test data leaks into the production database.
