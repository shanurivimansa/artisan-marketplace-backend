const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'marketplace.db');

app.use(cors());
app.use(express.json());

// ── DATABASE SETUP ───────────────────────────────────────────
let db;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB file or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Save helper
  function saveDB() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
  global.saveDB = saveDB;

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'customer',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      seller TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerName TEXT NOT NULL,
      productName TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      address TEXT NOT NULL,
      deliveryPartner TEXT,
      status TEXT DEFAULT 'in-delivery',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed sample products if empty
  const count = db.exec('SELECT COUNT(*) as count FROM products')[0]?.values[0][0];
  if (!count || count === 0) {
    db.run(`INSERT INTO products (name, description, price, seller) VALUES
      ('Hand-thrown Ceramic Mug', 'Beautifully crafted stoneware mug, dishwasher safe', 28.00, 'Clay & Co.'),
      ('Macrame Wall Hanging', 'Boho-style wall art made with natural cotton rope', 65.00, 'Knotted by Kai'),
      ('Beeswax Candle Set', 'Set of 3 hand-poured beeswax candles with lavender', 34.00, 'Wick & Wild'),
      ('Hand-knit Beanie', 'Merino wool beanie, warm and cozy, one size fits most', 42.00, 'Woolly Made'),
      ('Wooden Serving Board', 'Handcrafted rimu wood charcuterie board', 85.00, 'Timber & Craft'),
      ('Pressed Flower Cards', 'Set of 6 greeting cards with real pressed flowers', 22.00, 'Petal Press')
    `);
    saveDB();
  }

  // Helper: run query and return rows as objects
  global.query = function(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (e) {
      throw e;
    }
  };

  global.run = function(sql, params = []) {
    db.run(sql, params);
    saveDB();
    return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
  };

  console.log('Database ready');
}

// ── USER ROUTES ──────────────────────────────────────────────
app.post('/api/users/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required' });
  try {
    const id = global.run(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, password, role || 'customer']
    );
    res.status(201).json({ message: 'User registered successfully', id });
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/users/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' });
  const rows = global.query(
    'SELECT id, name, email, role FROM users WHERE email = ? AND password = ?',
    [email, password]
  );
  if (!rows.length)
    return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ message: 'Login successful', user: rows[0] });
});

// ── PASSWORD RESET ──────────────────────────────────────────
app.post('/api/users/reset-password', (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) return res.status(400).json({ error: 'Email and new password required' });
  const user = global.query('SELECT id FROM users WHERE email = ?', [email]);
  if (!user.length) return res.status(404).json({ error: 'No account found with that email' });
  global.run('UPDATE users SET password = ? WHERE email = ?', [newPassword, email]);
  res.json({ message: 'Password reset successfully' });
});

// ── PRODUCT ROUTES ───────────────────────────────────────────
app.get('/api/products', (req, res) => {
  const { search } = req.query;
  let products;
  if (search) {
    products = global.query(
      'SELECT * FROM products WHERE name LIKE ? OR description LIKE ? ORDER BY id DESC',
      [`%${search}%`, `%${search}%`]
    );
  } else {
    products = global.query('SELECT * FROM products ORDER BY id DESC');
  }
  res.json(products);
});

app.post('/api/products', (req, res) => {
  const { name, description, price, seller } = req.body;
  if (!name || !price || !seller)
    return res.status(400).json({ error: 'Name, price and seller are required' });
  const id = global.run(
    'INSERT INTO products (name, description, price, seller) VALUES (?, ?, ?, ?)',
    [name, description || '', price, seller]
  );
  res.status(201).json({ message: 'Product listed successfully', id });
});

// ── ORDER ROUTES ─────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  res.json(global.query('SELECT * FROM orders ORDER BY id DESC'));
});

app.post('/api/orders', (req, res) => {
  const { customerName, productName, quantity } = req.body;
  if (!customerName || !productName)
    return res.status(400).json({ error: 'Customer name and product name are required' });
  const id = global.run(
    'INSERT INTO orders (customerName, productName, quantity) VALUES (?, ?, ?)',
    [customerName, productName, quantity || 1]
  );
  res.status(201).json({ message: 'Order placed successfully', id, orderId: id });
});

// ── PAYMENT ROUTES ───────────────────────────────────────────
app.post('/api/payments', (req, res) => {
  const { orderId, amount, paymentMethod } = req.body;
  if (!orderId || !amount)
    return res.status(400).json({ error: 'Order ID and amount are required' });
  const id = global.run(
    'INSERT INTO payments (orderId, amount, paymentMethod) VALUES (?, ?, ?)',
    [orderId, amount, paymentMethod || 'card']
  );
  global.run("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);
  res.status(201).json({ message: 'Payment processed successfully', id });
});

// ── DELIVERY ROUTES ──────────────────────────────────────────
app.post('/api/deliveries', (req, res) => {
  const { orderId, address, deliveryPartner } = req.body;
  if (!orderId || !address)
    return res.status(400).json({ error: 'Order ID and address are required' });
  const id = global.run(
    'INSERT INTO deliveries (orderId, address, deliveryPartner) VALUES (?, ?, ?)',
    [orderId, address, deliveryPartner || '']
  );
  global.run("UPDATE orders SET status = 'in-delivery' WHERE id = ?", [orderId]);
  res.status(201).json({ message: 'Delivery record created', id });
});

// ── ADMIN DASHBOARD ──────────────────────────────────────────
app.get('/api/admin/dashboard', (req, res) => {
  const totalUsers      = global.query('SELECT COUNT(*) as count FROM users')[0]?.count || 0;
  const totalProducts   = global.query('SELECT COUNT(*) as count FROM products')[0]?.count || 0;
  const totalOrders     = global.query('SELECT COUNT(*) as count FROM orders')[0]?.count || 0;
  const totalDeliveries = global.query('SELECT COUNT(*) as count FROM deliveries')[0]?.count || 0;
  const recentOrders    = global.query('SELECT * FROM orders ORDER BY id DESC LIMIT 5');
  res.json({ totalUsers, totalProducts, totalOrders, totalDeliveries, recentOrders });
});

app.get('/', (req, res) => res.json({ message: 'Artisan Marketplace API is running!' }));

// Start server after DB is ready
initDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
