/* ============================================================
   inventory.js - product catalogue (administrators only)

   The catalogue is what makes the till trustworthy: prices come
   from here, not from whoever is standing at the keyboard, and
   stock is deducted against it on every sale.
   ============================================================ */
window.POS = window.POS || {};

POS.inventory = (function () {
    'use strict';

    var d = POS.dom;
    var fmt = POS.fmt;
    var state = POS.state;

    var els = {};
    var stale = true;
    var loading = false;
    var busy = false;

    function mount() {
        els = {
            form: d.$('#inventoryForm'),
            name: d.$('#invName'),
            category: d.$('#invCategory'),
            qty: d.$('#invQuantity'),
            price: d.$('#invPrice'),
            submit: d.$('#invSubmit'),
            hint: d.$('#invHint'),

            search: d.$('#invSearch'),
            lowOnly: d.$('#invLowOnly'),
            refresh: d.$('#invRefresh'),
            body: d.$('#invBody'),
            empty: d.$('#invEmpty'),
            summary: d.$('#invSummary')
        };

        populateCategories();

        els.form.addEventListener('submit', onSubmit);
        els.name.addEventListener('input', onNameChanged);
        els.search.addEventListener('input', render);
        els.lowOnly.addEventListener('change', render);
        els.refresh.addEventListener('click', function () { load(true); });

        state.subscribe(render);
    }

    // Built from state rather than typed free-hand, so the same product
    // band is not spelled three different ways across the catalogue.
    function populateCategories() {
        d.clear(els.category);
        state.getCategories().forEach(function (band) {
            var group = d.el('optgroup', { label: band.group });
            band.items.forEach(function (name) {
                group.appendChild(d.el('option', { value: name, text: name }));
            });
            els.category.appendChild(group);
        });
        els.category.value = state.getSettings().lastCategory || '';
        if (!els.category.value) els.category.selectedIndex = 0;
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
        POS.api.listInventory().then(function (rows) {
            stale = false;
            loading = false;
            state.setCatalog(rows);   // triggers render via subscribe
        }).catch(function (err) {
            loading = false;
            if (err.sessionLost) return POS.auth.sessionExpired();
            setMessage('Could not load inventory. ' + err.message, true);
        });
    }

    function setMessage(text, isError) {
        d.clear(els.body);
        d.show(els.empty, true);
        d.clear(els.empty);
        els.empty.appendChild(d.el('div.empty-title', { text: text }));
        els.empty.style.color = isError ? 'var(--err)' : '';
    }

    /* ---------- Add / restock ---------- */

    // Saving an existing name tops up its stock rather than replacing it,
    // so say so before the button is pressed.
    function onNameChanged() {
        var existing = state.findProduct(els.name.value);
        if (existing) {
            els.hint.textContent = 'Already stocked: ' + fmt.qty(existing.quantity) +
                ' at ' + fmt.money(existing.priceKobo) +
                '. Saving adds to that stock and updates the price.';
            els.hint.hidden = false;
            els.category.value = existing.category || els.category.value;
            els.submit.textContent = 'Restock product';
        } else {
            els.hint.hidden = true;
            els.submit.textContent = 'Add product';
        }
    }

    function flagInvalid(input, message) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        input.select();
        POS.ui.warn(message);
        setTimeout(function () { input.removeAttribute('aria-invalid'); }, 2000);
    }

    function onSubmit(e) {
        e.preventDefault();
        if (busy) return;

        var name = els.name.value.trim();
        if (!name) return flagInvalid(els.name, 'Enter a product name');

        var priceKobo = fmt.toKobo(els.price.value);
        if (priceKobo === null) return flagInvalid(els.price, 'Enter a valid price');

        var quantity = Number(els.qty.value);
        if (!isFinite(quantity)) return flagInvalid(els.qty, 'Enter a quantity');

        busy = true;
        els.submit.disabled = true;

        POS.api.saveProduct({
            name: name,
            category: els.category.value,
            priceKobo: priceKobo,
            quantity: quantity
        }).then(function (r) {
            POS.ui.ok(r.message || 'Product saved');
            state.updateSettings({ lastCategory: els.category.value });
            els.name.value = '';
            els.qty.value = '';
            els.price.value = '';
            onNameChanged();
            els.name.focus();
            markStale();
            return load(true);
        }).catch(function (err) {
            if (err.sessionLost) return POS.auth.sessionExpired();
            POS.ui.err('Could not save product', err.message);
        }).then(function () {
            busy = false;
            els.submit.disabled = false;
        });
    }

    /* ---------- Table ---------- */

    function remove(product) {
        POS.ui.confirm({
            title: 'Remove "' + product.name + '"?',
            message: 'It disappears from the catalogue and cashiers can no longer ' +
                     'sell it. Sales already recorded keep their history.',
            confirmLabel: 'Remove product',
            danger: true
        }).then(function (yes) {
            if (!yes) return;
            return POS.api.deleteProduct(product.id).then(function () {
                POS.ui.ok('Removed "' + product.name + '"');
                markStale();
                load(true);
            }, function (err) {
                if (err.sessionLost) return POS.auth.sessionExpired();
                POS.ui.err('Could not remove product', err.message);
            });
        });
    }

    function stockCell(product) {
        var cls = product.quantity <= 0 ? '.out' : (product.quantity <= 5 ? '.low' : '');
        return d.el('td.right', null, [
            d.el('span.stock-pill' + cls, { text: fmt.qty(product.quantity) })
        ]);
    }

    function row(product) {
        return d.el('tr', null, [
            d.el('td', null, [d.el('strong', { text: product.name })]),
            d.el('td', null, [d.el('span.chip', { text: product.category })]),
            d.el('td.right.num', { text: fmt.money(product.priceKobo) }),
            stockCell(product),
            d.el('td.right.num.muted', {
                text: fmt.money(product.priceKobo * product.quantity)
            }),
            d.el('td.right', null, [
                d.el('button.btn.btn-sm.btn-danger', {
                    type: 'button',
                    onclick: function () { remove(product); }
                }, ['Remove'])
            ])
        ]);
    }

    function filtered() {
        var needle = els.search.value.trim().toLowerCase();
        return state.getCatalog().filter(function (p) {
            if (els.lowOnly.checked && p.quantity > 5) return false;
            if (!needle) return true;
            return (p.name + ' ' + p.category).toLowerCase().indexOf(needle) !== -1;
        });
    }

    function render() {
        if (loading) return;

        var rows = filtered();
        d.clear(els.body);

        if (!rows.length) {
            setMessage(state.getCatalog().length
                ? 'No products match this filter.'
                : 'No products yet. Add your first one on the left.');
            els.summary.textContent = '';
            return;
        }

        d.show(els.empty, false);
        rows.forEach(function (p) { els.body.appendChild(row(p)); });

        var value = rows.reduce(function (a, p) {
            return a + p.priceKobo * p.quantity;
        }, 0);
        var lowCount = rows.filter(function (p) { return p.quantity <= 5; }).length;

        els.summary.textContent = rows.length + ' product' + (rows.length === 1 ? '' : 's') +
            ' · stock value ' + fmt.money(value) +
            (lowCount ? ' · ' + lowCount + ' low' : '');
    }

    return { mount: mount, activate: activate, markStale: markStale, load: load };
})();
