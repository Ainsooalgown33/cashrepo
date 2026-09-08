/* ============================================================
   ui.js - toasts and modals

   Replaces every alert() in the old build, and gives failures a
   visible home. The previous version reported a failed save with
   console.error only, so a cashier could hand over a receipt for
   a sale that was never recorded and never know.
   ============================================================ */
window.POS = window.POS || {};

POS.ui = (function () {
    'use strict';

    var d = POS.dom;
    var toastHost = null;
    var backdrop = null;
    var activeModal = null;

    function mount() {
        toastHost = d.$('#toasts');
        backdrop = d.$('#modalBackdrop');

        backdrop.addEventListener('mousedown', function (e) {
            if (e.target === backdrop && activeModal && activeModal.dismissible) {
                settle(null);
            }
        });
    }

    /* ---------- Toasts ---------- */

    function toast(kind, title, message, ms) {
        var node = d.el('div.toast.' + kind, { role: 'status' }, [
            d.el('div.toast-body', null, [
                d.el('div.toast-title', { text: title }),
                message ? d.el('div.toast-msg', { text: message }) : null
            ])
        ]);
        toastHost.appendChild(node);

        var life = ms || (kind === 'err' ? 7000 : 3200);
        setTimeout(function () {
            node.classList.add('out');
            setTimeout(function () {
                if (node.parentNode) node.parentNode.removeChild(node);
            }, 150);
        }, life);
    }

    /* ---------- Modal ---------- */

    /**
     * open({ title, body: Node, buttons: [{label, kind, kbd, value, autofocus}],
     *        dismissible })
     * Resolves with the chosen button's `value`, or null if dismissed.
     */
    function open(spec) {
        return new Promise(function (resolve) {
            var foot = d.el('div.modal-foot');
            (spec.buttons || []).forEach(function (b) {
                var btn = d.el('button.btn' + (b.kind ? '.btn-' + b.kind : ''), {
                    type: 'button',
                    onclick: function () { settle(b.value); }
                }, [b.label, b.kbd ? d.el('kbd', { text: b.kbd }) : null]);
                if (b.autofocus) btn.dataset.autofocus = '1';
                foot.appendChild(btn);
            });

            var modal = d.el('div.modal', { role: 'dialog', 'aria-modal': 'true' }, [
                d.el('div.modal-head', null, [
                    d.el('div.modal-title', { text: spec.title || '' })
                ]),
                d.el('div.modal-body', null, [spec.body]),
                foot
            ]);

            d.clear(backdrop).appendChild(modal);
            backdrop.hidden = false;
            activeModal = {
                dismissible: spec.dismissible !== false,
                resolve: resolve
            };

            var focusTarget = modal.querySelector('[data-autofocus]') ||
                              modal.querySelector('button');
            if (focusTarget) focusTarget.focus();
        });
    }

    /**
     * Tears the modal down and settles its promise exactly once.
     * Every exit path - button, backdrop click, Esc, or a caller
     * closing it programmatically - goes through here, so no
     * open() promise is ever left dangling.
     */
    function settle(value) {
        if (!activeModal) return;
        var pending = activeModal;
        activeModal = null;
        backdrop.hidden = true;
        d.clear(backdrop);
        pending.resolve(value);
    }

    function close() { settle(null); }

    function isOpen() { return !!activeModal; }

    // Esc closes; handled here so views do not each reimplement it.
    function handleEscape() {
        if (!activeModal) return false;
        if (activeModal.dismissible) settle(null);
        return true;   // swallowed either way: the modal owns the key
    }

    /* ---------- Confirm ---------- */

    function confirm(spec) {
        var body = d.el('p', { text: spec.message });
        return open({
            title: spec.title,
            body: body,
            dismissible: true,
            buttons: [
                { label: spec.cancelLabel || 'Cancel', kind: 'ghost', value: false },
                {
                    label: spec.confirmLabel || 'Confirm',
                    kind: spec.danger ? 'danger' : 'primary',
                    value: true,
                    autofocus: true
                }
            ]
        }).then(function (v) { return v === true; });
    }

    return {
        mount: mount,
        toast: toast,
        ok: function (t, m) { toast('ok', t, m); },
        err: function (t, m) { toast('err', t, m); },
        warn: function (t, m) { toast('warn', t, m); },
        info: function (t, m) { toast('', t, m); },
        open: open,
        close: close,
        isOpen: isOpen,
        handleEscape: handleEscape,
        confirm: confirm
    };
})();
