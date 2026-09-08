/* ============================================================
   receipt.js - render, preview, print

   The receipt is built from the SAVED record, so the paper always
   matches what is on disk, including the order number the server
   assigned. The old build printed first and saved afterwards,
   which meant a backend failure produced a receipt for a sale
   that was never recorded.
   ============================================================ */
window.POS = window.POS || {};

POS.receipt = (function () {
    'use strict';

    var d = POS.dom;
    var fmt = POS.fmt;

    function rule() { return d.el('div.rc-rule'); }

    function kv(key, value) {
        return d.el('div.rc-kv', null, [
            d.el('span', { text: key }),
            d.el('span', { text: value })
        ]);
    }

    /**
     * @param {object} receipt normalised receipt record
     * @param {{ paperWidth: string, reprint: boolean }} opts
     */
    function render(receipt, opts) {
        var o = opts || {};
        var store = receipt.store || {};
        var when = receipt.timestamp ? new Date(receipt.timestamp) : new Date();

        var paper = d.el('div.receipt' + (o.paperWidth === '58' ? '.paper-58' : ''), {
            id: 'receiptPaper'
        });

        paper.appendChild(d.el('div.rc-store', { text: store.storeName || 'Store' }));
        if (store.storeAddress) {
            paper.appendChild(d.el('div.rc-sub', { text: store.storeAddress }));
        }
        if (store.storePhone) {
            paper.appendChild(d.el('div.rc-sub', { text: 'Tel: ' + store.storePhone }));
        }

        paper.appendChild(rule());

        paper.appendChild(kv('Order', receipt.orderNumber));
        paper.appendChild(kv('Date', fmt.dateOnly(when)));
        paper.appendChild(kv('Time', fmt.timeOnly(when)));
        // Recorded server-side from the signed-in account, so the receipt
        // names whoever actually rang the sale.
        if (receipt.processedBy) paper.appendChild(kv('Cashier', receipt.processedBy));
        if (receipt.customerName) paper.appendChild(kv('Sold to', receipt.customerName));

        paper.appendChild(rule());

        receipt.items.forEach(function (item) {
            paper.appendChild(d.el('div.rc-item', null, [
                d.el('div.rc-item-name', null, [
                    document.createTextNode(item.name),
                    d.el('div.rc-item-qty', {
                        text: fmt.qty(item.quantity) + ' x ' + fmt.moneyPlain(item.unitKobo)
                    })
                ]),
                d.el('div.rc-item-amt', { text: fmt.moneyPlain(item.totalKobo) })
            ]));
        });

        paper.appendChild(rule());

        paper.appendChild(d.el('div.rc-total', null, [
            d.el('span', { text: 'TOTAL' }),
            d.el('span', { text: fmt.money(receipt.totalKobo) })
        ]));

        paper.appendChild(d.el('div.rc-foot', {
            text: 'Thank you for your business!'
        }));

        if (o.reprint) {
            paper.appendChild(d.el('div.rc-reprint', { text: '*** REPRINT ***' }));
        }

        return paper;
    }

    // The @page size has to match the roll or the driver scales the
    // output; it cannot be expressed in a class, so it is injected.
    function applyPageSize(paperWidth) {
        var style = document.getElementById('pageSizeStyle');
        if (!style) {
            style = document.createElement('style');
            style.id = 'pageSizeStyle';
            document.head.appendChild(style);
        }
        var mm = paperWidth === '58' ? '58mm' : '80mm';
        style.textContent = '@media print { @page { size: ' + mm + ' auto; margin: 0; } }';
    }

    /**
     * Shows the paper, then prints on confirmation.
     * The sale is already saved by this point: closing without
     * printing loses the paper, never the record.
     */
    function preview(receipt, opts) {
        var o = opts || {};
        applyPageSize(o.paperWidth);

        var body = d.el('div.receipt-preview', null, [render(receipt, o)]);

        return POS.ui.open({
            title: o.reprint
                ? 'Reprint ' + receipt.orderNumber
                : 'Receipt ' + receipt.orderNumber,
            body: body,
            dismissible: true,
            buttons: [
                { label: 'Close', kind: 'ghost', value: false },
                { label: 'Print', kind: 'primary', kbd: 'Enter', value: true, autofocus: true }
            ]
        }).then(function (shouldPrint) {
            if (shouldPrint !== true) return false;

            // Reopen with no buttons so the print stylesheet has only the
            // paper to work with (the modal chrome is hidden in @media print).
            POS.ui.open({
                title: 'Printing…',
                body: d.el('div.receipt-preview', null, [render(receipt, o)]),
                dismissible: false,
                buttons: []
            });

            return new Promise(function (resolve) {
                // Let the modal paint before the blocking print dialog opens.
                setTimeout(function () {
                    try {
                        window.print();
                    } finally {
                        POS.ui.close();   // settles the modal above with null
                        resolve(true);
                    }
                }, 60);
            });
        });
    }

    return { render: render, preview: preview, applyPageSize: applyPageSize };
})();
