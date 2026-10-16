const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, closeDb } = require('./db/database');

const productsRouter = require('./routes/products');
const salesRouter = require('./routes/sales');
const purchasesRouter = require('./routes/purchases');
const customersRouter = require('./routes/customers');
const suppliersRouter = require('./routes/suppliers');
const inventoryRouter = require('./routes/inventory');
const categoriesRouter = require('./routes/categories');
const settingsRouter = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure database is initialized
getDb();

// Static Assets
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/products', productsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/settings', settingsRouter);

// Fallback to SPA index.html for unknown non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

let serverInstance = null;

function startServer(port = PORT) {
  return new Promise((resolve) => {
    serverInstance = app.listen(port, () => {
      console.log(`[INFO] Inventory & POS Server running at http://localhost:${port}`);
      resolve(serverInstance);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        closeDb();
        console.log('[INFO] Server stopped and database closed.');
        resolve();
      });
    } else {
      closeDb();
      resolve();
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, stopServer };
