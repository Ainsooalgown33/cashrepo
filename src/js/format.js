/* ============================================================
   format.js - money, quantities, dates

   Money is handled as INTEGER KOBO everywhere inside the app.
   Floats are only ever produced at the moment of display.
   The old build multiplied floats and called .toFixed(2), which
   drifts once totals get large or quantities are fractional.
   ============================================================ */
window.POS = window.POS || {};

POS.fmt = (function () {
    'use strict';

    var CURRENCY = '₦'; // naira

    /* ---------- Parsing ---------- */

    // "1,000.55" | 1000.55 -> 100055 kobo. Returns null when unusable.
    function toKobo(value) {
        if (value === null || value === undefined) return null;
        var raw = String(value).trim().replace(/[, ₦]/g, '');
        if (raw === '') return null;
        var n = Number(raw);
        if (!isFinite(n) || n < 0) return null;
        return Math.round(n * 100);
    }

    // Quantities may be fractional (sold by weight), max 3dp.
    function toQty(value) {
        var n = Number(String(value === undefined ? '' : value).trim());
        if (!isFinite(n) || n <= 0) return null;
        return Math.round(n * 1000) / 1000;
    }

    // qty x unit price, rounded to the nearest kobo once.
    function lineTotal(qty, unitKobo) {
        return Math.round(qty * unitKobo);
    }

    /* ---------- Display ---------- */

    function groups(kobo) {
        var neg = kobo < 0;
        var abs = Math.abs(Math.round(kobo));
        var whole = Math.floor(abs / 100);
        var cents = abs % 100;
        var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + s + '.' + (cents < 10 ? '0' + cents : cents);
    }

    // 500000 -> "N5,000.00" (with the naira sign)
    function money(kobo) {
        return CURRENCY + groups(kobo || 0);
    }

    // 500000 -> "5,000.00" (no sign; for table columns with a header unit)
    function moneyPlain(kobo) {
        return groups(kobo || 0);
    }

    // Trims trailing zeros: 1 -> "1", 1.5 -> "1.5", 2.250 -> "2.25"
    function qty(n) {
        if (!isFinite(n)) return '0';
        return String(Math.round(n * 1000) / 1000);
    }

    /* ---------- Dates ---------- */

    function dt(iso) {
        var d = new Date(iso);
        if (isNaN(d)) return '—';
        return d.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function timeOnly(d) {
        return d.toLocaleTimeString(undefined, {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }

    function dateOnly(d) {
        return d.toLocaleDateString(undefined, {
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
    }

    // Local YYYY-MM-DD, for <input type="date"> and day bucketing.
    // Deliberately NOT toISOString(), which shifts across the UTC boundary
    // and would file an 11pm sale under the following day.
    function dayKey(date) {
        var d = date ? new Date(date) : new Date();
        if (isNaN(d)) return '';
        var m = d.getMonth() + 1;
        var day = d.getDate();
        return d.getFullYear() + '-' +
               (m < 10 ? '0' + m : m) + '-' +
               (day < 10 ? '0' + day : day);
    }

    return {
        CURRENCY: CURRENCY,
        toKobo: toKobo,
        toQty: toQty,
        lineTotal: lineTotal,
        money: money,
        moneyPlain: moneyPlain,
        qty: qty,
        dt: dt,
        timeOnly: timeOnly,
        dateOnly: dateOnly,
        dayKey: dayKey
    };
})();
