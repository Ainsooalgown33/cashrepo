/* ============================================================
   dom.js - element helpers and HTML escaping

   The old build interpolated item names straight into innerHTML.
   Combined with nodeIntegration that was remote code execution
   from a product name. Everything user-supplied now goes through
   esc(), and most rows are built as real nodes instead.
   ============================================================ */
window.POS = window.POS || {};

POS.dom = (function () {
    'use strict';

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    var ENTITIES = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    };

    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, function (c) { return ENTITIES[c]; });
    }

    /**
     * el('tr.line', { title: 'x' }, [child, 'text'])
     * Text children are appended as text nodes, never parsed as HTML.
     */
    function el(spec, attrs, children) {
        var parts = String(spec).split('.');
        var tag = parts.shift() || 'div';
        var node = document.createElement(tag);
        if (parts.length) node.className = parts.join(' ');

        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                var v = attrs[k];
                if (v === null || v === undefined || v === false) return;
                if (k === 'text') { node.textContent = v; return; }
                if (k === 'class') { node.className = v; return; }
                if (k === 'dataset') {
                    Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
                    return;
                }
                if (k.indexOf('on') === 0 && typeof v === 'function') {
                    node.addEventListener(k.slice(2).toLowerCase(), v);
                    return;
                }
                node.setAttribute(k, v === true ? '' : v);
            });
        }

        if (children) {
            (Array.isArray(children) ? children : [children]).forEach(function (c) {
                if (c === null || c === undefined || c === false) return;
                node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
            });
        }
        return node;
    }

    function clear(node) {
        while (node && node.firstChild) node.removeChild(node.firstChild);
        return node;
    }

    function show(node, visible) {
        if (node) node.hidden = !visible;
    }

    return { $: $, $$: $$, esc: esc, el: el, clear: clear, show: show };
})();
