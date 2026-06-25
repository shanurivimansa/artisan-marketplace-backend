const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const db = new Database(path.join(__dirname, 'marketplace.db'));

// Create tables
db.exec(`
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

// Seed some sample products if empty
const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (productCount.count === 0) {
  const insert = db.prepare('INSERT INTO products (name, description, price, seller) VALUES (?, ?, ?, ?)');
  insert.run('Hand-thrown Ceramic Mug', 'Beautifully crafted stoneware mug, dishwasher safe', 28.00, 'Clay & Co.');
  insert.run('Macrame Wall Hanging', 'Boho-style wall art made with natural cotton rope', 65.00, 'Knotted by Kai');
  insert.run('Beeswax Candle Set', 'Set of 3 hand-poured beeswax candles with lavender', 34.00, 'Wick & Wild');
  insert.run('Hand-knit Beanie', 'Merino wool beanie, warm and cozy, one size fits most', 42.00, 'Woolly Made');
  insert.run('Wooden Serving Board', 'Handcrafted rimu wood charcuterie board', 85.00, 'Timber & Craft');
  insert.run('Pressed Flower Cards', 'Set of 6 greeting cards with real pressed flowers', 22.00, 'Petal Press');
}

// ── USER ROUTES ──────────────────────────────────────────────
app.post('/api/users/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  try {
    const stmt = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');
    const result = stmt.run(name, email, password, role || 'customer');
    res.status(201).json({ message: 'User registered successfully', id: result.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/users/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE email = ? AND password = ?').get(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ message: 'Login successful', user });
});

// ── PRODUCT ROUTES ───────────────────────────────────────────
app.get('/api/products', (req, res) => {
  const { search } = req.query;
  let products;
  if (search) {
    products = db.prepare(`SELECT * FROM products WHERE name LIKE ? OR description LIKE ? ORDER BY created_at DESC`)
      .all(`%${search}%`, `%${search}%`);
  } else {
    products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  }
  res.json(products);
});

app.post('/api/products', (req, res) => {
  const { name, description, price, seller } = req.body;
  if (!name || !price || !seller) {
    return res.status(400).json({ error: 'Name, price and seller are required' });
  }
  const result = db.prepare('INSERT INTO products (name, description, price, seller) VALUES (?, ?, ?, ?)')
    .run(name, description || '', price, seller);
  res.status(201).json({ message: 'Product listed successfully', id: result.lastInsertRowid });
});

// ── ORDER ROUTES ─────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders);
});

app.post('/api/orders', (req, res) => {
  const { customerName, productName, quantity } = req.body;
  if (!customerName || !productName) {
    return res.status(400).json({ error: 'Customer name and product name are required' });
  }
  const result = db.prepare('INSERT INTO orders (customerName, productName, quantity) VALUES (?, ?, ?)')
    .run(customerName, productName, quantity || 1);
  res.status(201).json({ message: 'Order placed successfully', id: result.lastInsertRowid, orderId: result.lastInsertRowid });
});

// ── PAYMENT ROUTES ───────────────────────────────────────────
app.post('/api/payments', (req, res) => {
  const { orderId, amount, paymentMethod } = req.body;
  if (!orderId || !amount) {
    return res.status(400).json({ error: 'Order ID and amount are required' });
  }
  const result = db.prepare('INSERT INTO payments (orderId, amount, paymentMethod) VALUES (?, ?, ?)')
    .run(orderId, amount, paymentMethod || 'card');
  db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(orderId);
  res.status(201).json({ message: 'Payment processed successfully', id: result.lastInsertRowid });
});

// ── DELIVERY ROUTES ──────────────────────────────────────────
app.post('/api/deliveries', (req, res) => {
  const { orderId, address, deliveryPartner } = req.body;
  if (!orderId || !address) {
    return res.status(400).json({ error: 'Order ID and address are required' });
  }
  const result = db.prepare('INSERT INTO deliveries (orderId, address, deliveryPartner) VALUES (?, ?, ?)')
    .run(orderId, address, deliveryPartner || '');
  db.prepare("UPDATE orders SET status = 'in-delivery' WHERE id = ?").run(orderId);
  res.status(201).json({ message: 'Delivery record created', id: result.lastInsertRowid });
});

// ── ADMIN DASHBOARD ──────────────────────────────────────────
app.get('/api/admin/dashboard', (req, res) => {
  const totalUsers      = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const totalProducts   = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  const totalOrders     = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const totalDeliveries = db.prepare('SELECT COUNT(*) as count FROM deliveries').get().count;
  const recentOrders    = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5').all();
  res.json({ totalUsers, totalProducts, totalOrders, totalDeliveries, recentOrders });
});

app.get('/', (req, res) => res.json({ message: 'Artisan Marketplace API is running!' }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
