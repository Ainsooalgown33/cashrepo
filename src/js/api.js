/* ============================================================
   api.js - backend access, session, connection status

   Two credentials travel on every call:
     X-POS-Token   - proves the request came from this app at all
     Authorization - proves who is signed in

   Receipts are read tolerantly: records written by the previous
   build stored naira floats under different field names, and are
   normalised here rather than rewritten on disk.
   ============================================================ */
window.POS = window.POS || {};

POS.api = (function () {
    'use strict';

    var config = null;
    var session = { token: null, role: null, username: null };

    // null = not checked yet. Distinct from false, so the status light
    // does not show a red alarm before the first health check answers.
    var online = null;
    var listeners = [];

    function onStatus(fn) { listeners.push(fn); fn(online); }
    function setOnline(next) {
        if (next === online) return;
        online = next;
        listeners.forEach(function (fn) { fn(online); });
    }

    function init() {
        if (!window.posBridge) {
            return Promise.reject(new Error(
                'Preload bridge unavailable. Launch through the Cashier POS app.'
            ));
        }
        return window.posBridge.getConfig().then(function (cfg) {
            config = cfg;
            return cfg;
        });
    }

    /* ---------- Transport ---------- */

    function request(path, options) {
        if (!config) return Promise.reject(new Error('API not initialised'));
        var opts = options || {};

        var headers = { 'X-POS-Token': config.token };
        if (session.token) headers.Authorization = 'Bearer ' + session.token;
        if (opts.body) headers['Content-Type'] = 'application/json';

        return fetch(config.baseUrl + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined
        }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (data) {
                setOnline(true);
                if (!res.ok) {
                    var err = new Error(data.error || ('Request failed (' + res.status + ')'));
                    err.status = res.status;
                    // An expired or rejected session must not look like a
                    // random failure: the app has to send them back to login.
                    if ((res.status === 401 || res.status === 403) && session.token) {
                        err.sessionLost = true;
                    }
                    throw err;
                }
                return data;
            });
        }, function (netErr) {
            setOnline(false);
            throw new Error('Cannot reach the local data service. ' + netErr.message);
        });
    }

    /* ---------- Session ---------- */

    function login(username, password) {
        return request('/login', {
            method: 'POST',
            body: { username: username, password: password }
        }).then(function (data) {
            session = {
                token: data.token,
                role: data.role,
                username: data.username
            };
            return data;
        });
    }

    function logout() {
        session = { token: null, role: null, username: null };
    }

    function changePassword(currentPassword, newPassword) {
        return request('/change-password', {
            method: 'POST',
            body: { currentPassword: currentPassword, newPassword: newPassword }
        });
    }

    function recover(username, recoveryKey, newPassword) {
        return request('/recover', {
            method: 'POST',
            body: { username: username, recoveryKey: recoveryKey, newPassword: newPassword }
        });
    }

    /* ---------- Users ---------- */

    function listUsers() { return request('/users'); }

    function createUser(username, password, role) {
        return request('/users', {
            method: 'POST',
            body: { username: username, password: password, role: role }
        });
    }

    function deleteUser(id) {
        return request('/users/' + encodeURIComponent(id), { method: 'DELETE' });
    }

    /* ---------- Inventory ---------- */

    function normaliseProduct(raw) {
        if (!raw || typeof raw !== 'object') return null;
        return {
            id: raw.id,
            name: String(raw.name || ''),
            category: String(raw.category || 'Other'),
            // Server migrates on boot; this covers a stale response.
            priceKobo: Number.isInteger(raw.priceKobo)
                ? raw.priceKobo
                : Math.round(Number(raw.price || 0) * 100),
            quantity: Number(raw.quantity) || 0
        };
    }

    function listInventory() {
        return request('/inventory').then(function (rows) {
            return (Array.isArray(rows) ? rows : []).map(normaliseProduct).filter(Boolean);
        });
    }

    function saveProduct(product) {
        return request('/inventory', { method: 'POST', body: product });
    }

    function deleteProduct(id) {
        return request('/inventory/' + encodeURIComponent(id), { method: 'DELETE' });
    }

    /* ---------- Receipts ---------- */

    function toKoboFromNaira(value) {
        var n = Number(value);
        return isFinite(n) ? Math.round(n * 100) : 0;
    }

    function normaliseItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var isNew = Number.isInteger(raw.totalKobo);
        var qty = Number(raw.quantity);
        return {
            name: String(raw.name || raw.item_name || 'Item'),
            category: String(raw.category || 'Other'),
            quantity: isFinite(qty) && qty > 0 ? qty : 1,
            unitKobo: isNew ? raw.unitKobo : toKoboFromNaira(raw.price),
            totalKobo: isNew ? raw.totalKobo : toKoboFromNaira(raw.total)
        };
    }

    function normaliseReceipt(raw) {
        if (!raw || typeof raw !== 'object') return null;

        var items = (Array.isArray(raw.items) ? raw.items : [])
            .map(normaliseItem)
            .filter(Boolean);

        var totalKobo = Number.isInteger(raw.totalKobo)
            ? raw.totalKobo
            : (raw.totalAmount !== undefined
                ? toKoboFromNaira(raw.totalAmount)
                : items.reduce(function (a, it) { return a + it.totalKobo; }, 0));

        var store = raw.store || raw.storeData || {};

        return {
            orderNumber: String(raw.orderNumber || '—'),
            timestamp: raw.timestamp || null,
            // Recorded server-side from the signed-in account, so it is
            // the cashier who actually rang the sale, not whoever is at
            // the till now.
            processedBy: String(raw.processedBy || '—'),
            customerName: String(raw.customerName || 'Walk-In'),
            store: {
                storeName: String(store.storeName || ''),
                storeAddress: String(store.storeAddress || ''),
                storePhone: String(store.storePhone || '')
            },
            items: items,
            totalKobo: totalKobo
        };
    }

    function listReceipts() {
        return request('/receipts').then(function (rows) {
            return (Array.isArray(rows) ? rows : []).map(normaliseReceipt).filter(Boolean);
        });
    }

    function saveReceipt(payload) {
        return request('/receipts', { method: 'POST', body: payload })
            .then(normaliseReceipt);
    }

    /* ---------- Health ---------- */

    function health() { return request('/health'); }

    function startHeartbeat(intervalMs) {
        var tick = function () { health().catch(function () { /* light goes red */ }); };
        tick();
        setInterval(tick, intervalMs || 15000);
    }

    return {
        init: init,
        onStatus: onStatus,
        isOnline: function () { return online === true; },

        getSession: function () {
            return { role: session.role, username: session.username };
        },
        isSignedIn: function () { return !!session.token; },
        isAdmin: function () { return session.role === 'admin'; },
        login: login,
        logout: logout,
        changePassword: changePassword,
        recover: recover,

        listUsers: listUsers,
        createUser: createUser,
        deleteUser: deleteUser,

        listInventory: listInventory,
        saveProduct: saveProduct,
        deleteProduct: deleteProduct,

        listReceipts: listReceipts,
        saveReceipt: saveReceipt,

        health: health,
        startHeartbeat: startHeartbeat
    };
})();
