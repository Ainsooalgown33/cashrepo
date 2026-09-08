/* ============================================================
   app.js - bootstrap, view switching, global keyboard map

   Load order matters (classic scripts, no bundler): format, dom,
   state, api, ui, receipt, auth, then the views, then this file.
   ============================================================ */
window.POS = window.POS || {};

(function () {
    'use strict';

    var d = POS.dom;

    var VIEWS = {
        terminal:  { view: '#viewTerminal',  tab: '#tabTerminal',  admin: false },
        sales:     { view: '#viewSales',     tab: '#tabSales',     admin: false },
        inventory: { view: '#viewInventory', tab: '#tabInventory', admin: true },
        settings:  { view: '#viewSettings',  tab: '#tabSettings',  admin: true }
    };

    var current = 'terminal';

    /* ---------- Views ---------- */

    function switchView(name) {
        var cfg = VIEWS[name];
        if (!cfg) return;
        // Belt and braces: the tab is hidden for cashiers, and the server
        // rejects the calls anyway, but the client should not pretend.
        if (cfg.admin && !POS.api.isAdmin()) return;

        current = name;

        Object.keys(VIEWS).forEach(function (key) {
            var v = VIEWS[key];
            var active = key === name;
            d.$(v.view).hidden = !active;
            d.$(v.tab).classList.toggle('active', active);
            d.$(v.tab).setAttribute('aria-selected', active ? 'true' : 'false');
        });

        d.$('#hintsTerminal').hidden = name !== 'terminal';

        if (name === 'terminal') POS.terminal.focusEntry();
        if (name === 'sales') POS.sales.activate();
        if (name === 'inventory') POS.inventory.activate();
        if (name === 'settings') POS.settings.activate();
    }

    // A recorded sale changes both the takings and the stock on hand.
    POS.onSaleRecorded = function () {
        POS.sales.markStale();
        POS.inventory.markStale();
        // The catalogue is refreshed straight away rather than lazily:
        // the next customer's stock figures must already be correct.
        POS.api.listInventory().then(function (rows) {
            POS.state.setCatalog(rows);
        }).catch(function () { /* the stale figure is still usable */ });
    };

    /* ---------- Session ---------- */

    function applyRole() {
        var session = POS.api.getSession();
        var isAdmin = POS.api.isAdmin();

        d.$('#barUser').textContent = session.username || '—';
        var roleTag = d.$('#barRole');
        roleTag.textContent = session.role || '';
        roleTag.classList.toggle('chip-admin', isAdmin);

        Object.keys(VIEWS).forEach(function (key) {
            var v = VIEWS[key];
            if (v.admin) d.$(v.tab).hidden = !isAdmin;
        });
    }

    function onSignedIn() {
        applyRole();
        d.$('#appShell').hidden = false;

        // The catalogue has to be in hand before the terminal is usable,
        // since prices and stock all come from it.
        POS.api.listInventory().then(function (rows) {
            POS.state.setCatalog(rows);
            if (!rows.length && POS.api.isAdmin()) {
                POS.ui.warn('No products yet',
                            'Add stock under Inventory before selling.');
            } else if (!rows.length) {
                POS.ui.warn('No products yet',
                            'An administrator needs to add stock before you can sell.');
            }
        }).catch(function (err) {
            if (err.sessionLost) return POS.auth.sessionExpired();
            POS.ui.err('Could not load inventory', err.message);
        });

        POS.sales.markStale();
        POS.inventory.markStale();
        POS.settings.markStale();
        switchView('terminal');
    }

    /* ---------- Status bar ---------- */

    function mountStatus() {
        var dot = d.$('#dotBackend');
        var label = d.$('#labelBackend');

        POS.api.onStatus(function (online) {
            dot.classList.toggle('ok', online === true);
            dot.classList.toggle('err', online === false);
            label.textContent = online === null ? 'Connecting…'
                              : online ? 'Data service'
                              : 'Data service down';
        });

        var clock = d.$('#clock');
        var tick = function () { clock.textContent = POS.fmt.timeOnly(new Date()); };
        tick();
        setInterval(tick, 1000);

        var paint = function () {
            d.$('#barStore').textContent = POS.state.getSettings().storeName || '—';
        };
        paint();
        POS.state.subscribe(paint);
    }

    /* ---------- Keyboard ---------- */

    function isTyping(target) {
        if (!target) return false;
        var tag = target.tagName;
        return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' ||
               target.isContentEditable;
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            if (POS.ui.handleEscape()) { e.preventDefault(); return; }
            if (current === 'terminal' && POS.api.isSignedIn()) {
                e.preventDefault();
                POS.terminal.resetEntry();
            }
            return;
        }

        // A modal, or the sign-in screen, owns the keyboard.
        if (POS.ui.isOpen() || !POS.api.isSignedIn()) return;

        if (e.ctrlKey && !e.altKey) {
            var key = e.key.toLowerCase();
            if (key === 't') { e.preventDefault(); return switchView('terminal'); }
            if (key === 'h') { e.preventDefault(); return switchView('sales'); }
            if (key === 'i') { e.preventDefault(); return switchView('inventory'); }
            if (key === ',') { e.preventDefault(); return switchView('settings'); }
        }

        if (e.key === 'F2') {
            e.preventDefault();
            if (current !== 'terminal') switchView('terminal');
            POS.terminal.checkout();
            return;
        }

        if (e.key === 'F4') {
            e.preventDefault();
            if (current === 'terminal') POS.terminal.removeSelected();
            return;
        }

        if (e.key === 'Delete' && !isTyping(e.target)) {
            e.preventDefault();
            if (current === 'terminal') POS.terminal.clearCart();
        }
    }

    /* ---------- Boot ---------- */

    function fatal(message) {
        document.body.innerHTML = '';
        document.body.appendChild(
            d.el('div.empty', null, [
                d.el('div.empty-title', { text: 'Cashier POS could not start' }),
                d.el('div.empty-hint', { text: message })
            ])
        );
    }

    function boot() {
        POS.state.init();
        POS.ui.mount();

        POS.api.init().then(function () {
            POS.auth.mount({ onSignedIn: onSignedIn });
            POS.terminal.mount();
            POS.sales.mount();
            POS.inventory.mount();
            POS.settings.mount();
            mountStatus();

            POS.receipt.applyPageSize(POS.state.getSettings().paperWidth);

            d.$('#tabTerminal').addEventListener('click', function () { switchView('terminal'); });
            d.$('#tabSales').addEventListener('click', function () { switchView('sales'); });
            d.$('#tabInventory').addEventListener('click', function () { switchView('inventory'); });
            d.$('#tabSettings').addEventListener('click', function () { switchView('settings'); });

            document.addEventListener('keydown', onKeyDown);

            POS.api.startHeartbeat(15000);
            POS.auth.show();
        }).catch(function (err) {
            console.error('[boot]', err);
            fatal(err.message);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
