/* ============================================================
   state.js - cart, catalogue cache and till settings

   The cart survives a crash or an accidental close, which matters
   when a customer is at the counter with fifteen items rung up.

   Note what is NOT here: the cashier's name. That comes from the
   signed-in account, so a receipt cannot claim to have been rung
   by someone who was not at the till.
   ============================================================ */
window.POS = window.POS || {};

POS.state = (function () {
    'use strict';

    var CART_KEY = 'pos.cart.v3';
    var SETTINGS_KEY = 'pos.settings.v3';

    /* ------------------------------------------------------------
       Categories for the inventory form.

       Grouped rather than one flat list: a 30-item dropdown is
       unscannable, and optgroups let you jump to the right band.
       ------------------------------------------------------------ */
    var CATEGORIES = [
        { group: 'Food & drink', items: [
            'Groceries', 'Provisions', 'Drinks & Beverages', 'Frozen Foods',
            'Fruits & Vegetables', 'Meat & Fish', 'Bakery', 'Snacks & Confectionery'
        ] },
        { group: 'Household', items: [
            'Household & Cleaning', 'Home & Kitchen', 'Furniture',
            'Building & Hardware', 'Gas & Fuel'
        ] },
        { group: 'Personal care', items: [
            'Toiletries & Personal Care', 'Cosmetics', 'Baby Products',
            'Health & Pharmacy', 'Pharmaceuticals'
        ] },
        { group: 'Fashion', items: [
            'Clothing', 'Footwear', 'Bags & Accessories', 'Jewellery'
        ] },
        { group: 'Technology', items: [
            'Electronics', 'Phones & Accessories', 'Computers & Accessories',
            'Airtime & Data'
        ] },
        { group: 'General', items: [
            'Stationery & Books', 'Automotive', 'Agriculture & Livestock',
            'Services', 'Other'
        ] }
    ];

    var DEFAULT_SETTINGS = {
        storeName: 'Cashier POS',
        storeAddress: '',
        storePhone: '',
        paperWidth: '80',        // '58' or '80' millimetre roll
        lastCategory: 'Groceries'
    };

    var listeners = [];
    var cart = [];
    var selectedId = null;
    var settings = Object.assign({}, DEFAULT_SETTINGS);
    var catalog = [];

    function load(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (err) {
            console.warn('[state] could not read ' + key, err);
            return fallback;
        }
    }

    function persist() {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (err) {
            console.warn('[state] could not persist', err);
        }
    }

    function emit() {
        persist();
        listeners.forEach(function (fn) { fn(); });
    }

    function isValidLine(l) {
        return l && typeof l === 'object' &&
               Number.isInteger(l.unitKobo) &&
               isFinite(l.quantity) && l.quantity > 0;
    }

    function init() {
        var storedCart = load(CART_KEY, []);
        cart = Array.isArray(storedCart) ? storedCart.filter(isValidLine) : [];
        settings = Object.assign({}, DEFAULT_SETTINGS, load(SETTINGS_KEY, {}));
        if (settings.paperWidth !== '58') settings.paperWidth = '80';
    }

    /* ---------- Catalogue ---------- */

    function setCatalog(list) {
        catalog = Array.isArray(list) ? list : [];
        emit();
    }

    function findProduct(name) {
        var needle = String(name || '').trim().toLowerCase();
        if (!needle) return null;
        return catalog.filter(function (p) {
            return p.name.trim().toLowerCase() === needle;
        })[0] || null;
    }

    /**
     * Stock still sellable for a product, after subtracting what is
     * already sitting in the cart. The previous build only checked the
     * raw shelf figure, so two lines of five against a stock of eight
     * both looked fine and the sale was rejected at the very end.
     */
    function availableFor(product, ignoreLineId) {
        if (!product) return 0;
        var claimed = cart.reduce(function (a, l) {
            if (ignoreLineId && l.id === ignoreLineId) return a;
            return l.name.trim().toLowerCase() === product.name.trim().toLowerCase()
                ? a + l.quantity
                : a;
        }, 0);
        return product.quantity - claimed;
    }

    /* ---------- Cart ---------- */

    function addLine(product, quantity) {
        var id = 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        cart.push({
            id: id,
            productId: product.id,
            name: product.name,
            category: product.category,
            quantity: quantity,
            unitKobo: product.priceKobo,
            totalKobo: POS.fmt.lineTotal(quantity, product.priceKobo)
        });
        selectedId = id;
        emit();
        return id;
    }

    function removeLine(id) {
        var before = cart.length;
        cart = cart.filter(function (l) { return l.id !== id; });
        if (selectedId === id) selectedId = cart.length ? cart[cart.length - 1].id : null;
        if (cart.length !== before) emit();
    }

    function clearCart() {
        cart = [];
        selectedId = null;
        emit();
    }

    function select(id) {
        selectedId = id;
        emit();
    }

    function totalKobo() {
        return cart.reduce(function (a, l) { return a + l.totalKobo; }, 0);
    }

    function unitCount() {
        return cart.reduce(function (a, l) { return a + l.quantity; }, 0);
    }

    /* ---------- Settings ---------- */

    function updateSettings(patch) {
        settings = Object.assign({}, settings, patch);
        emit();
    }

    return {
        init: init,
        subscribe: function (fn) { listeners.push(fn); },

        setCatalog: setCatalog,
        getCatalog: function () { return catalog.slice(); },
        findProduct: findProduct,
        availableFor: availableFor,

        getCart: function () { return cart.slice(); },
        getSelectedId: function () { return selectedId; },
        addLine: addLine,
        removeLine: removeLine,
        clearCart: clearCart,
        select: select,
        totalKobo: totalKobo,
        unitCount: unitCount,

        getSettings: function () { return Object.assign({}, settings); },
        updateSettings: updateSettings,
        getCategories: function () { return CATEGORIES; }
    };
})();
