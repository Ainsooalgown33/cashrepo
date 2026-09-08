/* ============================================================
   server.js - local data service for the POS

   Keeps the role model this app was built around (admin/cashier,
   bcrypt + JWT), the inventory catalogue, and stock deduction on
   sale. What changed:

     * SECRET_KEY is no longer a literal in the source. It was
       committed to a public repository, which meant anyone could
       forge an admin token. It is now random per launch.
     * Every write is atomic (tmp -> fsync -> rename) with a
       rolling backup, so a power cut mid-sale can no longer
       truncate the stock file or the sales history.
     * A sale writes stock and receipts as one unit: if either
       file cannot be written, neither is changed.
     * Money is stored as INTEGER KOBO. Legacy naira floats are
       migrated once, after a backup.
     * Order numbers are assigned here, once per receipt, and are
       sequential per day rather than random.
     * Bound to 127.0.0.1 behind a per-launch token, so a web page
       in the user's browser cannot reach the login endpoint and
       grind away at passwords.
     * A busy port is reported instead of silently killing the
       backend for the rest of the session.
   ============================================================ */
'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const HOST = '127.0.0.1';
const PREFERRED_PORT = 3000;
const PORT_ATTEMPTS = 12;
const TOKEN_TTL = '12h';

// Random per launch. Restarting the app invalidates outstanding
// tokens, which is the correct trade for a till that is logged
// into at the start of a shift anyway.
const JWT_SECRET = crypto.randomBytes(48).toString('hex');

/* ============================================================
   Atomic JSON store
   ============================================================ */

function makeStore(file, fallback) {
    const bak = file + '.bak';
    const tmp = file + '.tmp';

    function readFrom(f) {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (Array.isArray(fallback) && !Array.isArray(parsed)) {
            throw new Error('expected an array at the root');
        }
        return parsed;
    }

    function read() {
        try {
            if (fs.existsSync(file)) return readFrom(file);
        } catch (err) {
            console.error('[db] ' + path.basename(file) + ' unreadable:', err.message);
            // Preserve the damaged file rather than overwrite the evidence.
            try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (_) {}
            try {
                if (fs.existsSync(bak)) {
                    console.warn('[db] recovering ' + path.basename(file) + ' from backup');
                    return readFrom(bak);
                }
            } catch (bakErr) {
                console.error('[db] backup unreadable too:', bakErr.message);
            }
        }
        return JSON.parse(JSON.stringify(fallback));
    }

    // Stage the new content without touching the live file yet.
    function stage(data) {
        const fd = fs.openSync(tmp, 'w');
        try {
            fs.writeFileSync(fd, JSON.stringify(data, null, 2));
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
    }

    // Swap the staged file in. Rename is atomic: a reader sees either
    // the whole old file or the whole new one, never a stump.
    function commit() {
        try {
            if (fs.existsSync(file)) fs.copyFileSync(file, bak);
        } catch (err) {
            console.error('[db] backup failed (continuing):', err.message);
        }
        fs.renameSync(tmp, file);
    }

    function discard() {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    }

    function write(data) {
        stage(data);
        commit();
    }

    if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        write(fallback);
    }

    return { read, write, stage, commit, discard, file };
}

/* ============================================================
   Money: integer kobo
   ============================================================ */

function nairaToKobo(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * The previous build stored naira floats. Convert once, keeping a
 * backup, so existing tills keep their stock levels and history.
 */
function migrateMoney(inventoryStore, receiptStore) {
    const inventory = inventoryStore.read();
    let changed = false;

    inventory.forEach((item) => {
        if (!Number.isInteger(item.priceKobo)) {
            item.priceKobo = nairaToKobo(item.price);
            delete item.price;
            changed = true;
        }
    });
    if (changed) {
        console.log('[db] migrating inventory prices to kobo');
        inventoryStore.write(inventory);
    }

    const receipts = receiptStore.read();
    let rChanged = false;

    receipts.forEach((r) => {
        if (!Number.isInteger(r.totalKobo)) {
            r.totalKobo = nairaToKobo(r.totalAmount);
            delete r.totalAmount;
            rChanged = true;
        }
        (r.items || []).forEach((it) => {
            if (!Number.isInteger(it.unitKobo)) {
                it.unitKobo = nairaToKobo(it.price);
                it.totalKobo = nairaToKobo(it.total);
                delete it.price;
                delete it.total;
                rChanged = true;
            }
        });
    });
    if (rChanged) {
        console.log('[db] migrating receipt totals to kobo');
        receiptStore.write(receipts);
    }
}

/* ============================================================
   Order numbers: YYMMDD-0001, sequential per day
   ============================================================ */

function todayPrefix(now) {
    const d = now || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate());
}

// Derived from the receipts themselves, so it self-heals after a
// restore from backup rather than colliding with existing numbers.
function nextOrderNumber(receipts, now) {
    const prefix = todayPrefix(now);
    let max = 0;
    for (const r of receipts) {
        const num = r && r.orderNumber;
        if (typeof num !== 'string' || num.slice(0, 6) !== prefix) continue;
        const seq = parseInt(num.slice(7), 10);
        if (Number.isFinite(seq) && seq > max) max = seq;
    }
    return prefix + '-' + String(max + 1).padStart(4, '0');
}

/* ============================================================
   Helpers
   ============================================================ */

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function sameName(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/* ============================================================
   Server
   ============================================================ */

function listenWithFallback(app, port, attemptsLeft) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, HOST);
        server.once('listening', () => resolve({ server, port }));
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
                console.warn('[api] port ' + port + ' busy, trying ' + (port + 1));
                resolve(listenWithFallback(app, port + 1, attemptsLeft - 1));
            } else {
                reject(err);
            }
        });
    });
}

/**
 * @param {{ userDataPath: string, token: string }} options
 * @returns {Promise<{ port: number }>}
 */
function start(options) {
    const dir = options.userDataPath;
    const posToken = options.token;

    const users = makeStore(path.join(dir, 'users.json'), []);
    const inventory = makeStore(path.join(dir, 'inventory.json'), []);
    const receipts = makeStore(path.join(dir, 'receipts.json'), []);
    const recoveryFile = path.join(dir, 'RECOVERY_KEY.txt');

    migrateMoney(inventory, receipts);

    /* ---------- First run: master admin ---------- */
    let firstRun = false;
    if (users.read().length === 0) {
        const recoveryKey = 'KEY-' + crypto.randomBytes(6).toString('hex').toUpperCase();
        users.write([{
            id: 1,
            username: 'admin',
            password: bcrypt.hashSync('admin123', 10),
            role: 'admin',
            // Hashed, so a stolen users.json does not hand over a
            // working password reset.
            recoveryKey: bcrypt.hashSync(recoveryKey, 10),
            mustChangePassword: true
        }]);
        fs.writeFileSync(recoveryFile,
            'Cashier POS Recovery Key\n' +
            '========================\n\n' +
            'Username: admin\n' +
            'First-time password: admin123\n' +
            'Recovery key: ' + recoveryKey + '\n\n' +
            'CHANGE THE PASSWORD THE FIRST TIME YOU SIGN IN.\n' +
            'Keep this file somewhere safe and off this machine.\n');
        firstRun = true;
        console.log('[auth] master admin created. Recovery key written to ' + recoveryFile);
    }

    const app = express();
    app.use(cors({ origin: true }));
    app.use(express.json({ limit: '1mb' }));

    // Gate 1: is this our own renderer at all? CORS cannot keep a browser
    // page off a localhost port, but a per-launch secret can - and this is
    // what stops an outside page grinding away at /api/login.
    app.use('/api', (req, res, next) => {
        if (req.get('X-POS-Token') !== posToken) {
            return res.status(401).json({ error: 'unauthorised' });
        }
        next();
    });

    // Gate 2: who is signed in?
    function verifyToken(req, res, next) {
        const header = req.get('Authorization') || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) return res.status(403).json({ error: 'Not signed in' });
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) return res.status(401).json({ error: 'Session expired. Sign in again.' });
            req.user = decoded;
            next();
        });
    }

    function requireAdmin(req, res, next) {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Administrator access required' });
        }
        next();
    }

    /* ---------- Health ---------- */

    app.get('/api/health', (req, res) => {
        res.json({ ok: true, firstRun: firstRun, recoveryFile: firstRun ? recoveryFile : null });
    });

    /* ---------- Auth ---------- */

    app.post('/api/login', (req, res, next) => {
        try {
            const body = req.body || {};
            const list = users.read();
            const user = list.find((u) => sameName(u.username, body.username));

            // One message for both failure modes, so the response does
            // not reveal which usernames exist.
            if (!user || !bcrypt.compareSync(String(body.password || ''), user.password)) {
                throw httpError(401, 'Incorrect username or password');
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                JWT_SECRET,
                { expiresIn: TOKEN_TTL }
            );
            res.json({
                token: token,
                role: user.role,
                username: user.username,
                mustChangePassword: user.mustChangePassword === true
            });
        } catch (err) { next(err); }
    });

    app.post('/api/change-password', verifyToken, (req, res, next) => {
        try {
            const body = req.body || {};
            if (String(body.newPassword || '').length < 6) {
                throw httpError(400, 'New password must be at least 6 characters');
            }
            const list = users.read();
            const user = list.find((u) => u.id === req.user.id);
            if (!user) throw httpError(404, 'Account not found');
            if (!bcrypt.compareSync(String(body.currentPassword || ''), user.password)) {
                throw httpError(401, 'Current password is incorrect');
            }
            user.password = bcrypt.hashSync(String(body.newPassword), 10);
            user.mustChangePassword = false;
            users.write(list);
            res.json({ message: 'Password changed' });
        } catch (err) { next(err); }
    });

    app.post('/api/recover', (req, res, next) => {
        try {
            const body = req.body || {};
            if (String(body.newPassword || '').length < 6) {
                throw httpError(400, 'New password must be at least 6 characters');
            }
            const list = users.read();
            const user = list.find((u) => sameName(u.username, body.username));
            if (!user || !user.recoveryKey ||
                !bcrypt.compareSync(String(body.recoveryKey || ''), user.recoveryKey)) {
                throw httpError(401, 'That recovery key does not match the account');
            }
            user.password = bcrypt.hashSync(String(body.newPassword), 10);
            user.mustChangePassword = false;
            users.write(list);
            res.json({ message: 'Password reset. Sign in with the new password.' });
        } catch (err) { next(err); }
    });

    /* ---------- Users ---------- */

    app.get('/api/users', [verifyToken, requireAdmin], (req, res) => {
        res.json(users.read().map((u) => ({
            id: u.id, username: u.username, role: u.role
        })));
    });

    app.post('/api/users', [verifyToken, requireAdmin], (req, res, next) => {
        try {
            const body = req.body || {};
            const username = String(body.username || '').trim();
            const password = String(body.password || '');
            const role = body.role === 'admin' ? 'admin' : 'cashier';

            if (username.length < 3) throw httpError(400, 'Username must be at least 3 characters');
            if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters');

            const list = users.read();
            if (list.some((u) => sameName(u.username, username))) {
                throw httpError(400, 'That username is already taken');
            }

            list.push({
                id: Date.now(),
                username: username,
                password: bcrypt.hashSync(password, 10),
                role: role,
                mustChangePassword: true
            });
            users.write(list);
            res.status(201).json({ message: 'Account "' + username + '" created' });
        } catch (err) { next(err); }
    });

    app.delete('/api/users/:id', [verifyToken, requireAdmin], (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const list = users.read();
            const target = list.find((u) => u.id === id);
            if (!target) throw httpError(404, 'Account not found');
            if (target.id === req.user.id) throw httpError(400, 'You cannot delete your own account');
            if (target.role === 'admin' &&
                list.filter((u) => u.role === 'admin').length === 1) {
                throw httpError(400, 'This is the only administrator account');
            }
            users.write(list.filter((u) => u.id !== id));
            res.json({ message: 'Account removed' });
        } catch (err) { next(err); }
    });

    /* ---------- Inventory ---------- */

    app.get('/api/inventory', verifyToken, (req, res) => {
        res.json(inventory.read());
    });

    app.post('/api/inventory', [verifyToken, requireAdmin], (req, res, next) => {
        try {
            const body = req.body || {};
            const name = String(body.name || '').trim();
            const category = String(body.category || '').trim() || 'Other';
            const priceKobo = Number(body.priceKobo);
            const quantity = Number(body.quantity);

            if (!name) throw httpError(400, 'Product name is required');
            if (!Number.isInteger(priceKobo) || priceKobo < 0) {
                throw httpError(400, 'Price is not valid');
            }
            if (!Number.isFinite(quantity)) throw httpError(400, 'Quantity is not valid');

            const list = inventory.read();
            const existing = list.find((i) => sameName(i.name, name));

            if (existing) {
                // Restocking adds to what is on the shelf; price and
                // category are corrected to whatever was just entered.
                existing.quantity = Math.max(0, existing.quantity + quantity);
                existing.priceKobo = priceKobo;
                existing.category = category;
            } else {
                if (quantity < 0) throw httpError(400, 'A new product cannot start with negative stock');
                list.push({
                    id: Date.now(),
                    name: name,
                    category: category,
                    priceKobo: priceKobo,
                    quantity: quantity
                });
            }

            inventory.write(list);
            res.json({ message: 'Saved "' + name + '"' });
        } catch (err) { next(err); }
    });

    app.delete('/api/inventory/:id', [verifyToken, requireAdmin], (req, res, next) => {
        try {
            const id = Number(req.params.id);
            const list = inventory.read();
            if (!list.some((i) => i.id === id)) throw httpError(404, 'Product not found');
            inventory.write(list.filter((i) => i.id !== id));
            res.json({ message: 'Product removed' });
        } catch (err) { next(err); }
    });

    /* ---------- Sales ---------- */

    app.get('/api/receipts', verifyToken, (req, res) => {
        const list = receipts.read();
        list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(list);
    });

    app.post('/api/receipts', verifyToken, (req, res, next) => {
        try {
            const body = req.body || {};
            const lines = Array.isArray(body.items) ? body.items : [];
            if (lines.length === 0) throw httpError(400, 'The sale has no items');

            const stock = inventory.read();
            const priced = [];

            for (const line of lines) {
                const qty = Number(line && line.quantity);
                if (!Number.isFinite(qty) || qty <= 0) {
                    throw httpError(400, 'Bad quantity for "' + (line && line.name) + '"');
                }
                const product = stock.find((p) => sameName(p.name, line && line.name));
                if (!product) {
                    throw httpError(400, '"' + (line && line.name) + '" is not in the inventory');
                }
                if (product.quantity < qty) {
                    throw httpError(400,
                        'Not enough stock for "' + product.name +
                        '". Available: ' + product.quantity);
                }
                // Price comes from the catalogue, never from the client, so a
                // tampered request cannot sell goods at a price of its choosing.
                priced.push({
                    product: product,
                    line: {
                        name: product.name,
                        category: product.category,
                        quantity: qty,
                        unitKobo: product.priceKobo,
                        totalKobo: Math.round(qty * product.priceKobo)
                    }
                });
            }

            const items = priced.map((p) => p.line);
            const totalKobo = items.reduce((a, it) => a + it.totalKobo, 0);
            const now = new Date();
            const all = receipts.read();

            const receipt = {
                orderNumber: nextOrderNumber(all, now),
                timestamp: now.toISOString(),
                processedBy: req.user.username,
                customerName: String(body.customerName || '').slice(0, 120) || 'Walk-In',
                store: {
                    storeName: String((body.store && body.store.storeName) || '').slice(0, 120),
                    storeAddress: String((body.store && body.store.storeAddress) || '').slice(0, 200),
                    storePhone: String((body.store && body.store.storePhone) || '').slice(0, 60)
                },
                items: items,
                totalKobo: totalKobo
            };

            priced.forEach((p) => { p.product.quantity -= p.line.quantity; });
            all.push(receipt);

            // Stage both files, then swap both in. Either the sale is
            // recorded AND the stock is deducted, or neither happens -
            // the two can no longer drift apart on a failed write.
            inventory.stage(stock);
            try {
                receipts.stage(all);
            } catch (err) {
                inventory.discard();
                throw err;
            }
            inventory.commit();
            receipts.commit();

            console.log('[db] ' + receipt.orderNumber + ' by ' + receipt.processedBy +
                        ' (' + items.length + ' items, ' + totalKobo + ' kobo)');
            res.status(201).json(receipt);
        } catch (err) { next(err); }
    });

    /* ---------- Errors ---------- */

    app.use((err, req, res, _next) => {
        const status = err.status || 500;
        if (status >= 500) console.error('[api]', err);
        res.status(status).json({ error: err.message || 'Server error' });
    });

    return listenWithFallback(app, PREFERRED_PORT, PORT_ATTEMPTS).then(({ port }) => {
        console.log('[api] listening on http://' + HOST + ':' + port);
        console.log('[db] ' + dir);
        return { port: port };
    });
}

module.exports = { start };
