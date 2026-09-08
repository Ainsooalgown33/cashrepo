/* ============================================================
   sales.js - sales history and reporting

   One view, two audiences. A cashier gets the list, a search box
   and reprint, because answering "what did I ring up for that
   customer" should not need an administrator standing over them.
   An administrator additionally gets the headline figures, the
   date range and CSV export.

   Read-only for everyone: nothing here edits or deletes a record.
   ============================================================ */
window.POS = window.POS || {};

POS.sales = (function () {
    'use strict';

    var d = POS.dom;
    var fmt = POS.fmt;

    var els = {};
    var receipts = [];
    var stale = true;
    var loading = false;

    function mount() {
        els = {
            search: d.$('#salesSearch'),
            mineOnly: d.$('#salesMine'),
            todayOnly: d.$('#salesToday'),
            from: d.$('#salesFrom'),
            to: d.$('#salesTo'),
            reset: d.$('#salesReset'),
            refresh: d.$('#salesRefresh'),
            csv: d.$('#salesExport'),

            stats: d.$('#salesStats'),
            revenue: d.$('#statRevenue'),
            orders: d.$('#statOrders'),
            average: d.$('#statAverage'),
            units: d.$('#statUnits'),
            top: d.$('#statTop'),

            body: d.$('#salesBody'),
            empty: d.$('#salesEmpty'),
            summary: d.$('#salesSummary'),
            cashierCol: d.$('#salesCashierCol')
        };

        els.search.addEventListener('input', render);
        els.mineOnly.addEventListener('change', render);
        els.todayOnly.addEventListener('change', render);
        [els.from, els.to].forEach(function (i) { i.addEventListener('change', render); });
        els.refresh.addEventListener('click', function () { load(true); });
        els.reset.addEventListener('click', function () {
            els.search.value = '';
            els.from.value = '';
            els.to.value = '';
            els.mineOnly.checked = false;
            els.todayOnly.checked = false;
            render();
        });
        els.csv.addEventListener('click', exportCsv);
    }

    function markStale() { stale = true; }

    function activate() {
        if (stale && !loading) load(false);
        else render();
    }

    function load(force) {
        if (loading) return;
        if (!force && !stale) return render();

        loading = true;
        setMessage('Loading sales…');

        // `loading` is cleared BEFORE render(), which bails out while it
        // is set - otherwise the table stays empty until the next event.
        POS.api.listReceipts().then(function (rows) {
            receipts = rows;
            stale = false;
            loading = false;
            render();
        }).catch(function (err) {
            receipts = [];
            loading = false;
            if (err.sessionLost) return POS.auth.sessionExpired();
            setMessage('Could not load sales. ' + err.message, true);
            resetStats();
        });
    }

    function setMessage(text, isError) {
        d.clear(els.body);
        d.show(els.empty, true);
        d.clear(els.empty);
        els.empty.appendChild(d.el('div.empty-title', { text: text }));
        els.empty.style.color = isError ? 'var(--err)' : '';
        els.summary.textContent = '';
    }

    function resetStats() {
        els.revenue.textContent = fmt.money(0);
        els.orders.textContent = '0';
        els.average.textContent = fmt.money(0);
        els.units.textContent = '0';
        els.top.textContent = '—';
    }

    /* ---------- Filtering ---------- */

    function filtered() {
        var needle = els.search.value.trim().toLowerCase();
        var from = els.from.value;
        var to = els.to.value;
        var today = fmt.dayKey(new Date());
        var me = POS.api.getSession().username;

        return receipts.filter(function (r) {
            var day = fmt.dayKey(r.timestamp);
            if (els.todayOnly.checked && day !== today) return false;
            if (els.mineOnly.checked && r.processedBy !== me) return false;
            if (from && day < from) return false;
            if (to && day > to) return false;
            if (!needle) return true;

            var hay = (r.orderNumber + ' ' + r.customerName + ' ' + r.processedBy + ' ' +
                       r.items.map(function (i) { return i.name; }).join(' ')).toLowerCase();
            return hay.indexOf(needle) !== -1;
        });
    }

    function computeStats(rows) {
        var revenue = 0, units = 0, byItem = {};
        rows.forEach(function (r) {
            revenue += r.totalKobo;
            r.items.forEach(function (i) {
                units += i.quantity;
                byItem[i.name] = (byItem[i.name] || 0) + i.totalKobo;
            });
        });
        var top = Object.keys(byItem).sort(function (a, b) {
            return byItem[b] - byItem[a];
        })[0];
        return {
            revenue: revenue,
            orders: rows.length,
            average: rows.length ? Math.round(revenue / rows.length) : 0,
            units: units,
            top: top || '—'
        };
    }

    /* ---------- Rendering ---------- */

    function itemSummary(receipt) {
        return receipt.items.map(function (i) {
            return fmt.qty(i.quantity) + 'x ' + i.name;
        }).join(', ');
    }

    function row(receipt) {
        var items = itemSummary(receipt);
        return d.el('tr', null, [
            d.el('td.muted', { text: fmt.dt(receipt.timestamp) }),
            d.el('td', null, [d.el('strong.num', { text: receipt.orderNumber })]),
            d.el('td', { text: receipt.customerName }),
            d.el('td.muted', { text: receipt.processedBy }),
            d.el('td.truncate.muted', { text: items, title: items }),
            d.el('td.right', null, [
                d.el('strong.num', { text: fmt.money(receipt.totalKobo) })
            ]),
            d.el('td.right', null, [
                d.el('button.btn.btn-sm', {
                    type: 'button',
                    onclick: function () { reprint(receipt); }
                }, ['Reprint'])
            ])
        ]);
    }

    function reprint(receipt) {
        POS.receipt.preview(receipt, {
            paperWidth: POS.state.getSettings().paperWidth,
            reprint: true
        });
    }

    function render() {
        if (loading) return;

        var isAdmin = POS.api.isAdmin();
        d.show(els.stats, isAdmin);
        els.csv.hidden = !isAdmin;
        els.from.parentNode.hidden = !isAdmin;
        els.to.parentNode.hidden = !isAdmin;

        var rows = filtered();
        if (isAdmin) {
            var stats = computeStats(rows);
            els.revenue.textContent = fmt.money(stats.revenue);
            els.orders.textContent = String(stats.orders);
            els.average.textContent = fmt.money(stats.average);
            els.units.textContent = fmt.qty(stats.units);
            els.top.textContent = stats.top;
        }

        d.clear(els.body);

        if (!rows.length) {
            setMessage(receipts.length
                ? 'No sales match this filter.'
                : 'No sales recorded yet.');
            els.csv.disabled = true;
            return;
        }

        d.show(els.empty, false);
        rows.forEach(function (r) { els.body.appendChild(row(r)); });

        var total = rows.reduce(function (a, r) { return a + r.totalKobo; }, 0);
        els.summary.textContent = rows.length + (rows.length === 1 ? ' sale' : ' sales') +
                                  ' · ' + fmt.money(total);
        els.csv.disabled = false;
    }

    /* ---------- CSV ---------- */

    function csvCell(value) {
        return '"' + String(value === undefined || value === null ? '' : value)
            .replace(/"/g, '""') + '"';
    }

    function exportCsv() {
        var rows = filtered();
        if (!rows.length) return POS.ui.warn('Nothing to export');

        // One line per ITEM, so the file drops straight into a pivot table.
        var header = ['Order #', 'Date', 'Time', 'Customer', 'Cashier',
                      'Category', 'Item', 'Qty', 'Unit Price', 'Line Total'];
        var lines = [header.map(csvCell).join(',')];

        rows.forEach(function (r) {
            var when = r.timestamp ? new Date(r.timestamp) : new Date();
            r.items.forEach(function (i) {
                lines.push([
                    r.orderNumber,
                    fmt.dateOnly(when),
                    fmt.timeOnly(when),
                    r.customerName,
                    r.processedBy,
                    i.category,
                    i.name,
                    fmt.qty(i.quantity),
                    fmt.moneyPlain(i.unitKobo),
                    fmt.moneyPlain(i.totalKobo)
                ].map(csvCell).join(','));
            });
        });

        // BOM so Excel reads the naira sign and UTF-8 names correctly.
        var blob = new Blob(['﻿' + lines.join('\r\n')],
                            { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'sales-' + fmt.dayKey(new Date()) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

        POS.ui.ok('Exported ' + rows.length + ' sales');
    }

    return { mount: mount, activate: activate, markStale: markStale, load: load };
})();
