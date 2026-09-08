/* ============================================================
   terminal.js - the cashier terminal

   Keyboard-first: the product field holds focus, Enter commits a
   line and returns focus, and the running total is always on
   screen. The old build only revealed the total after printing.

   Price is never typed. It comes from the catalogue, so a cashier
   cannot quietly sell at their own price, and the server prices
   the sale again on save regardless of what the client sent.
   ============================================================ */
window.POS = window.POS || {};

POS.terminal = (function () {
    'use strict';

    var d = POS.dom;
    var fmt = POS.fmt;
    var state = POS.state;

    var els = {};
    var busy = false;

    function mount() {
        els = {
            form: d.$('#entryForm'),
            product: d.$('#productSearch'),
            datalist: d.$('#productOptions'),
            qty: d.$('#quantity'),
            stock: d.$('#availableStock'),
            price: d.$('#unitPrice'),
            preview: d.$('#linePreview'),
            customer: d.$('#customerName'),
            addBtn: d.$('#btnAddLine'),

            lines: d.$('#cartLines'),
            empty: d.$('#cartEmpty'),
            count: d.$('#cartCount'),
            total: d.$('#totalValue'),
            sub: d.$('#totalSub'),
            checkout: d.$('#btnCheckout'),
            checkoutLabel: d.$('#checkoutLabel'),
            clear: d.$('#btnClearCart')
        };

        els.form.addEventListener('submit', onAddLine);
        els.clear.addEventListener('click', clearCart);
        els.checkout.addEventListener('click', checkout);

        ['input', 'change'].forEach(function (evt) {
            els.product.addEventListener(evt, onProductChanged);
            els.qty.addEventListener(evt, updateLinePreview);
        });

        state.subscribe(render);
        render();
        onProductChanged();
    }

    function focusEntry() {
        els.product.focus();
        els.product.select();
    }

    /* ---------- Catalogue ---------- */

    // Rebuilt whenever stock changes so the picker never offers a
    // product that has since sold out.
    function renderCatalog() {
        d.clear(els.datalist);
        state.getCatalog().forEach(function (p) {
            els.datalist.appendChild(d.el('option', {
                value: p.name,
                label: fmt.money(p.priceKobo) + '  ·  ' + p.quantity + ' in stock'
            }));
        });
    }

    function currentProduct() {
        return state.findProduct(els.product.value);
    }

    function onProductChanged() {
        var product = currentProduct();
        if (!product) {
            els.stock.textContent = '—';
            els.price.textContent = '—';
            els.stock.classList.remove('low', 'out');
        } else {
            var left = state.availableFor(product);
            els.stock.textContent = fmt.qty(left);
            els.price.textContent = fmt.money(product.priceKobo);
            els.stock.classList.toggle('out', left <= 0);
            els.stock.classList.toggle('low', left > 0 && left <= 5);
        }
        updateLinePreview();
    }

    function updateLinePreview() {
        var product = currentProduct();
        var qty = fmt.toQty(els.qty.value);

        d.clear(els.preview);
        if (!product || qty === null) {
            els.preview.appendChild(d.el('span', { text: 'Line total' }));
            els.preview.appendChild(d.el('strong', { text: '—' }));
            els.addBtn.disabled = true;
            return;
        }

        els.preview.appendChild(d.el('span', {
            text: fmt.qty(qty) + ' x ' + fmt.money(product.priceKobo)
        }));
        els.preview.appendChild(d.el('strong', {
            text: fmt.money(fmt.lineTotal(qty, product.priceKobo))
        }));
        els.addBtn.disabled = false;
    }

    function flagInvalid(input, message) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        input.select();
        POS.ui.warn(message);
        setTimeout(function () { input.removeAttribute('aria-invalid'); }, 2000);
    }

    function onAddLine(e) {
        e.preventDefault();

        var product = currentProduct();
        if (!product) {
            return flagInvalid(els.product,
                'Pick a product from the inventory list');
        }

        var qty = fmt.toQty(els.qty.value);
        if (qty === null) {
            return flagInvalid(els.qty, 'Quantity must be greater than zero');
        }

        // Checked against stock LESS whatever is already in the cart, so
        // the shortfall surfaces here rather than at the end of the sale.
        var left = state.availableFor(product);
        if (qty > left) {
            return flagInvalid(els.qty, left <= 0
                ? '"' + product.name + '" is out of stock'
                : 'Only ' + fmt.qty(left) + ' left of "' + product.name + '"');
        }

        state.addLine(product, qty);
        state.updateSettings({ lastCategory: product.category });

        els.product.value = '';
        els.qty.value = '1';
        onProductChanged();
        focusEntry();
    }

    function resetEntry() {
        els.product.value = '';
        els.qty.value = '1';
        onProductChanged();
        focusEntry();
    }

    /* ---------- Cart rendering ---------- */

    function lineNode(line, selectedId) {
        return d.el('div.line' + (line.id === selectedId ? '.selected' : ''), {
            role: 'button',
            tabindex: '0',
            dataset: { id: line.id },
            onclick: function () { state.select(line.id); }
        }, [
            d.el('div.line-main', null, [
                d.el('div.line-name', { text: line.name }),
                d.el('div.line-meta', null, [
                    d.el('span.chip', { text: line.category }),
                    d.el('span.num', {
                        text: fmt.qty(line.quantity) + ' x ' + fmt.moneyPlain(line.unitKobo)
                    })
                ])
            ]),
            d.el('div.line-total.num', { text: fmt.money(line.totalKobo) }),
            d.el('button.line-del', {
                type: 'button',
                title: 'Remove line',
                'aria-label': 'Remove ' + line.name,
                onclick: function (ev) { ev.stopPropagation(); state.removeLine(line.id); }
            }, ['×'])
        ]);
    }

    function render() {
        renderCatalog();

        var cart = state.getCart();
        var selectedId = state.getSelectedId();

        d.clear(els.lines);
        cart.forEach(function (line) {
            els.lines.appendChild(lineNode(line, selectedId));
        });

        d.show(els.empty, cart.length === 0);
        d.show(els.lines, cart.length > 0);

        var units = state.unitCount();
        els.count.textContent = cart.length === 0
            ? 'Empty'
            : cart.length + (cart.length === 1 ? ' line' : ' lines') +
              ' · ' + fmt.qty(units) + (units === 1 ? ' unit' : ' units');

        els.total.textContent = fmt.money(state.totalKobo());
        els.sub.textContent = cart.length ? 'Ready to charge' : 'Nothing rung up';

        els.checkout.disabled = busy || cart.length === 0;
        els.clear.disabled = busy || cart.length === 0;
    }

    /* ---------- Cart actions ---------- */

    function removeSelected() {
        var id = state.getSelectedId();
        if (!id) return POS.ui.warn('No line selected', 'Click a line, then press F4');
        state.removeLine(id);
    }

    function clearCart() {
        if (!state.getCart().length) return;
        POS.ui.confirm({
            title: 'Clear the cart?',
            message: 'All ' + state.getCart().length + ' line(s) will be discarded. ' +
                     'Nothing has been recorded yet, so this cannot be undone.',
            confirmLabel: 'Clear cart',
            danger: true
        }).then(function (yes) {
            if (yes) {
                state.clearCart();
                POS.ui.info('Cart cleared');
                focusEntry();
            }
        });
    }

    /* ---------- Checkout: save, THEN print ---------- */

    function checkout() {
        var cart = state.getCart();
        if (busy || !cart.length) return;

        var settings = state.getSettings();
        var payload = {
            store: {
                storeName: settings.storeName,
                storeAddress: settings.storeAddress,
                storePhone: settings.storePhone
            },
            customerName: (els.customer.value || '').trim() || 'Walk-In',
            // Only name and quantity are sent. The server prices the sale
            // from the catalogue itself.
            items: cart.map(function (l) {
                return { name: l.name, quantity: l.quantity };
            })
        };

        busy = true;
        els.checkoutLabel.textContent = 'Saving…';
        render();

        POS.api.saveReceipt(payload).then(function (saved) {
            // Recorded, and stock deducted, before a character is printed.
            state.clearCart();
            els.customer.value = '';
            POS.ui.ok('Sale ' + saved.orderNumber + ' recorded', fmt.money(saved.totalKobo));
            POS.onSaleRecorded();
            return POS.receipt.preview(saved, { paperWidth: settings.paperWidth });
        }).catch(function (err) {
            if (err.sessionLost) return POS.auth.sessionExpired();
            // Loud and blocking. The cart is untouched so it can be retried.
            POS.ui.open({
                title: 'Sale NOT recorded',
                body: d.el('p', {
                    text: 'Nothing was printed, nothing was saved, and no stock ' +
                          'was deducted. The cart is intact so you can try again.\n\n' +
                          err.message
                }),
                dismissible: true,
                buttons: [{ label: 'Back to cart', kind: 'primary', value: true, autofocus: true }]
            });
            POS.ui.err('Save failed', err.message);
        }).then(function () {
            busy = false;
            els.checkoutLabel.textContent = 'Print & Save';
            render();
            focusEntry();
        });
    }

    return {
        mount: mount,
        focusEntry: focusEntry,
        resetEntry: resetEntry,
        removeSelected: removeSelected,
        clearCart: clearCart,
        checkout: checkout
    };
})();
