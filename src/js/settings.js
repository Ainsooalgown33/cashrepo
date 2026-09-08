/* ============================================================
   settings.js - staff accounts and till details (admins only)

   Store details live on this machine and are stamped onto each
   receipt at the moment of sale, so changing them later never
   rewrites history.
   ============================================================ */
window.POS = window.POS || {};

POS.settings = (function () {
    'use strict';

    var d = POS.dom;
    var state = POS.state;

    var els = {};
    var stale = true;
    var busy = false;

    function mount() {
        els = {
            storeForm: d.$('#storeForm'),
            storeName: d.$('#storeName'),
            storeAddress: d.$('#storeAddress'),
            storePhone: d.$('#storePhone'),
            paperWidth: d.$('#paperWidth'),

            userForm: d.$('#userForm'),
            newUser: d.$('#newUser'),
            newPass: d.$('#newPass'),
            newRole: d.$('#newRole'),
            userSubmit: d.$('#userSubmit'),

            userBody: d.$('#userBody'),
            userEmpty: d.$('#userEmpty'),
            changePw: d.$('#btnChangePassword')
        };

        els.storeForm.addEventListener('submit', onSaveStore);
        els.userForm.addEventListener('submit', onCreateUser);
        els.changePw.addEventListener('click', function () {
            POS.auth.promptPasswordChange(false);
        });

        loadStore();
    }

    function markStale() { stale = true; }

    function activate() {
        loadStore();
        if (stale) loadUsers();
    }

    /* ---------- Store details ---------- */

    function loadStore() {
        var s = state.getSettings();
        els.storeName.value = s.storeName;
        els.storeAddress.value = s.storeAddress;
        els.storePhone.value = s.storePhone;
        els.paperWidth.value = s.paperWidth;
    }

    function onSaveStore(e) {
        e.preventDefault();
        state.updateSettings({
            storeName: els.storeName.value.trim(),
            storeAddress: els.storeAddress.value.trim(),
            storePhone: els.storePhone.value.trim(),
            paperWidth: els.paperWidth.value === '58' ? '58' : '80'
        });
        POS.receipt.applyPageSize(state.getSettings().paperWidth);
        POS.ui.ok('Till details saved');
    }

    /* ---------- Staff ---------- */

    function loadUsers() {
        POS.api.listUsers().then(function (rows) {
            stale = false;
            renderUsers(rows);
        }).catch(function (err) {
            if (err.sessionLost) return POS.auth.sessionExpired();
            d.clear(els.userBody);
            d.show(els.userEmpty, true);
            d.clear(els.userEmpty);
            els.userEmpty.appendChild(d.el('div.empty-title', {
                text: 'Could not load accounts. ' + err.message
            }));
            els.userEmpty.style.color = 'var(--err)';
        });
    }

    function removeUser(user) {
        POS.ui.confirm({
            title: 'Remove "' + user.username + '"?',
            message: 'They will not be able to sign in again. Sales they already ' +
                     'rang up keep their name on them.',
            confirmLabel: 'Remove account',
            danger: true
        }).then(function (yes) {
            if (!yes) return;
            return POS.api.deleteUser(user.id).then(function () {
                POS.ui.ok('Removed "' + user.username + '"');
                loadUsers();
            }, function (err) {
                if (err.sessionLost) return POS.auth.sessionExpired();
                POS.ui.err('Could not remove account', err.message);
            });
        });
    }

    function renderUsers(rows) {
        d.clear(els.userBody);

        if (!rows.length) {
            d.show(els.userEmpty, true);
            return;
        }
        d.show(els.userEmpty, false);

        var me = POS.api.getSession().username;

        rows.forEach(function (u) {
            var isMe = u.username === me;
            els.userBody.appendChild(d.el('tr', null, [
                d.el('td', null, [
                    d.el('strong', { text: u.username }),
                    isMe ? d.el('span.chip', {
                        text: 'you', style: 'margin-left:8px;'
                    }) : null
                ]),
                d.el('td', null, [
                    d.el('span.chip' + (u.role === 'admin' ? '.chip-admin' : ''),
                         { text: u.role })
                ]),
                d.el('td.right', null, [
                    isMe ? d.el('span.muted', { text: '—' })
                         : d.el('button.btn.btn-sm.btn-danger', {
                               type: 'button',
                               onclick: function () { removeUser(u); }
                           }, ['Remove'])
                ])
            ]));
        });
    }

    function onCreateUser(e) {
        e.preventDefault();
        if (busy) return;

        var username = els.newUser.value.trim();
        var password = els.newPass.value;

        if (username.length < 3) {
            return POS.ui.warn('Username must be at least 3 characters');
        }
        if (password.length < 6) {
            return POS.ui.warn('Password must be at least 6 characters');
        }

        busy = true;
        els.userSubmit.disabled = true;

        POS.api.createUser(username, password, els.newRole.value).then(function (r) {
            POS.ui.ok(r.message || 'Account created',
                      'They will be asked to choose a new password when they first sign in.');
            els.userForm.reset();
            loadUsers();
        }).catch(function (err) {
            if (err.sessionLost) return POS.auth.sessionExpired();
            POS.ui.err('Could not create account', err.message);
        }).then(function () {
            busy = false;
            els.userSubmit.disabled = false;
        });
    }

    return { mount: mount, activate: activate, markStale: markStale };
})();
