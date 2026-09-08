const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { app } = require('electron');

const serverApp = express();
const PORT = 3000;
const SECRET_KEY = "enterprise-pos-secure-key";

const userDataPath = app.getPath('userData');
const DB_USERS = path.join(userDataPath, 'users.json');
const DB_INVENTORY = path.join(userDataPath, 'inventory.json');
const DB_RECEIPTS = path.join(userDataPath, 'receipts.json');
const RECOVERY_FILE = path.join(userDataPath, 'RECOVERY_KEY.txt');

serverApp.use(cors());
serverApp.use(express.json());

const initDB = (file, defaultData) => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
};

initDB(DB_INVENTORY, []);
initDB(DB_RECEIPTS, []);

// Master Admin Setup
if (!fs.existsSync(DB_USERS)) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const recoveryKey = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    const masterAdmin = [{ id: 1, username: 'admin', password: hashedPassword, role: 'admin', recoveryKey }];
    
    fs.writeFileSync(DB_USERS, JSON.stringify(masterAdmin, null, 2));
    fs.writeFileSync(RECOVERY_FILE, `Cashier Pro Recovery Key\nUsername: admin\nRecovery Key: ${recoveryKey}\n\nKeep this file safe. Use this key on the login screen if you forget your password.`);
    console.log(`Master Admin initialized. Recovery key saved to: ${RECOVERY_FILE}`);
}

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "No token provided" });
    
    jwt.verify(token.split(' ')[1], SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Unauthorized" });
        req.user = decoded;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: "Admin access required" });
    next();
};

// --- AUTHENTICATION & USERS ---
serverApp.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(DB_USERS));
    const user = users.find(u => u.username === username);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: "Invalid credentials" });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '12h' });
    res.json({ token, role: user.role, username: user.username });
});

// Admin creates a Cashier account
serverApp.post('/api/create-cashier', [verifyToken, requireAdmin], (req, res) => {
    const { username, password } = req.body;
    const users = JSON.parse(fs.readFileSync(DB_USERS));
    
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ error: "Username already exists" });
    }
    
    users.push({
        id: Date.now(),
        username,
        password: bcrypt.hashSync(password, 10),
        role: 'cashier'
    });
    
    fs.writeFileSync(DB_USERS, JSON.stringify(users, null, 2));
    res.json({ message: `Cashier account "${username}" created successfully.` });
});

// Admin views existing cashier users
serverApp.get('/api/users', [verifyToken, requireAdmin], (req, res) => {
    const users = JSON.parse(fs.readFileSync(DB_USERS));
    const safeUsers = users.map(u => ({ id: u.id, username: u.username, role: u.role }));
    res.json(safeUsers);
});

// --- INVENTORY MANAGEMENT ---
// Both admin and cashier can view items
serverApp.get('/api/inventory', verifyToken, (req, res) => {
    res.json(JSON.parse(fs.readFileSync(DB_INVENTORY)));
});

// Admin adds/updates product name, quantity, price, and category
serverApp.post('/api/inventory', [verifyToken, requireAdmin], (req, res) => {
    const { name, category, price, quantity } = req.body;
    const inventory = JSON.parse(fs.readFileSync(DB_INVENTORY));
    
    const existingIndex = inventory.findIndex(item => item.name.trim().toLowerCase() === name.trim().toLowerCase());
    
    if (existingIndex > -1) {
        inventory[existingIndex].quantity += Number(quantity);
        inventory[existingIndex].price = Number(price);
        inventory[existingIndex].category = category;
    } else {
        inventory.push({
            id: Date.now(),
            name: name.trim(),
            category: category.trim(),
            price: Number(price),
            quantity: Number(quantity)
        });
    }
    
    fs.writeFileSync(DB_INVENTORY, JSON.stringify(inventory, null, 2));
    res.json({ message: "Product saved to inventory successfully" });
});

// --- SALES & RECEIPT PROCESSING ---
serverApp.post('/api/save-receipt', verifyToken, (req, res) => {
    const { orderNumber, totalAmount, items, timestamp } = req.body;
    const inventory = JSON.parse(fs.readFileSync(DB_INVENTORY));
    const receipts = JSON.parse(fs.readFileSync(DB_RECEIPTS));
    
    // Validate stock before deducting
    for (const soldItem of items) {
        const product = inventory.find(p => p.name.trim().toLowerCase() === soldItem.name.trim().toLowerCase());
        if (!product) {
            return res.status(400).json({ error: `Product "${soldItem.name}" does not exist in inventory.` });
        }
        if (product.quantity < soldItem.quantity) {
            return res.status(400).json({ error: `Insufficient stock for "${product.name}". Available: ${product.quantity}` });
        }
    }
    
    // Deduct stock
    for (const soldItem of items) {
        const product = inventory.find(p => p.name.trim().toLowerCase() === soldItem.name.trim().toLowerCase());
        product.quantity -= Number(soldItem.quantity);
    }
    
    receipts.push({
        orderNumber,
        totalAmount,
        items,
        timestamp,
        processedBy: req.user.username
    });
    
    fs.writeFileSync(DB_INVENTORY, JSON.stringify(inventory, null, 2));
    fs.writeFileSync(DB_RECEIPTS, JSON.stringify(receipts, null, 2));
    
    res.json({ message: "Receipt processed and inventory stock updated." });
});

serverApp.get('/api/receipts', verifyToken, (req, res) => {
    const receipts = JSON.parse(fs.readFileSync(DB_RECEIPTS));
    receipts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(receipts);
});

serverApp.listen(PORT, () => console.log(`Secure Server running on port ${PORT}`));