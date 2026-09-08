/* ============================================================
   auth.js - sign-in screen, password change, recovery

   The sign-in screen is a full overlay rather than a route: until
   there is a session there is nothing to look at behind it, and no
   till data is fetched or rendered.
   ============================================================ */
window.POS = window.POS || {};

POS.auth = (function () {
    'use strict';

    var d = POS.dom;
    var els = {};
    var onSignedIn = null;
    var busy = false;

    function mount(options) {
        onSignedIn = options.onSignedIn;

        els = {
            overlay: d.$('#loginOverlay'),
            form: d.$('#loginForm'),
            user: d.$('#loginUser'),
            pass: d.$('#loginPass'),
            submit: d.$('#loginSubmit'),
            error: d.$('#loginError'),
            forgot: d.$('#loginForgot'),
            logout: d.$('#btnLogout')
        };

        els.form.addEventListener('submit', onSubmit);
        els.forgot.addEventListener('click', openRecovery);
        els.logout.addEventListener('click', signOut);
    }

    function show() {
        els.overlay.hidden = false;
        els.error.hidden = true;
        els.pass.value = '';
        els.user.focus();
        els.user.select();
    }

    function hide() { els.overlay.hidden = true; }

    function setError(message) {
        if (!message) { els.error.hidden = true; return; }
        els.error.textContent = message;
        els.error.hidden = false;
    }

    /* ---------- Sign in ---------- */

    function onSubmit(e) {
        e.preventDefault();
        if (busy) return;

        var username = els.user.value.trim();
        var password = els.pass.value;
        if (!username || !password) {
            return setError('Enter your username and password');
        }

        busy = true;
        setError('');
        els.submit.textContent = 'Signing in…';
        els.submit.disabled = true;

        POS.api.login(username, password).then(function (data) {
            hide();
            els.pass.value = '';
            if (data.mustChangePassword) {
                // A till running on the shipped default password is an
                // open door; make it the first thing that happens.
                return promptPasswordChange(true).then(function () {
                    onSignedIn();
                });
            }
            onSignedIn();
        }).catch(function (err) {
            setError(err.message);
            els.pass.value = '';
            els.pass.focus();
        }).then(function () {
            busy = false;
            els.submit.textContent = 'Sign in';
            els.submit.disabled = false;
        });
    }

    function signOut() {
        POS.ui.confirm({
            title: 'Sign out?',
            message: POS.state.getCart().length
                ? 'There are still items in the cart. They stay saved on this ' +
                  'machine and will be here when you sign back in.'
                : 'You will need your password to get back in.',
            confirmLabel: 'Sign out'
        }).then(function (yes) {
            if (!yes) return;
            POS.api.logout();
            show();
            POS.ui.info('Signed out');
        });
    }

    // Called when the server rejects a token mid-session.
    function sessionExpired() {
        POS.api.logout();
        show();
        setError('Your session ended. Please sign in again.');
    }

    /* ---------- Change password ---------- */

    function promptPasswordChange(forced) {
        var current = d.el('input.input', { type: 'password', autocomplete: 'off' });
        var next = d.el('input.input', { type: 'password', autocomplete: 'off' });
        var again = d.el('input.input', { type: 'password', autocomplete: 'off' });
        var note = d.el('div.form-error', { hidden: true });

        var body = d.el('div', { style: 'display:grid; gap:12px;' }, [
            forced ? d.el('p', {
                text: 'This account is still on its first-time password. ' +
                      'Choose a new one before you start selling.'
            }) : null,
            d.el('div.field', null, [d.el('label', { text: 'Current password' }), current]),
            d.el('div.field', null, [d.el('label', { text: 'New password' }), next]),
            d.el('div.field', null, [d.el('label', { text: 'Repeat new password' }), again]),
            note
        ]);

        function attempt() {
            note.hidden = true;
            if (next.value.length < 6) {
                note.textContent = 'New password must be at least 6 characters';
                note.hidden = false;
                return Promise.resolve(false);
            }
            if (next.value !== again.value) {
                note.textContent = 'The two new passwords do not match';
                note.hidden = false;
                return Promise.resolve(false);
            }
            return POS.api.changePassword(current.value, next.value).then(function () {
                POS.ui.ok('Password changed');
                return true;
            }, function (err) {
                note.textContent = err.message;
                note.hidden = false;
                return false;
            });
        }

        // Loops until it succeeds when forced; a voluntary change can be
        // abandoned with Cancel or Esc.
        function round() {
            return POS.ui.open({
                title: 'Change password',
                body: body,
                dismissible: !forced,
                buttons: [
                    forced ? null : { label: 'Cancel', kind: 'ghost', value: false },
                    { label: 'Change password', kind: 'primary', value: true, autofocus: true }
                ].filter(Boolean)
            }).then(function (go) {
                if (go !== true) return forced ? round() : false;
                return attempt().then(function (done) { return done ? true : round(); });
            });
        }

        return round();
    }

    /* ---------- Recovery ---------- */

    function openRecovery() {
        var username = d.el('input.input', { type: 'text', value: els.user.value.trim() });
        var key = d.el('input.input', { type: 'text', placeholder: 'KEY-XXXXXXXXXXXX' });
        var next = d.el('input.input', { type: 'password' });
        var note = d.el('div.form-error', { hidden: true });

        var body = d.el('div', { style: 'display:grid; gap:12px;' }, [
            d.el('p', {
                text: 'Your recovery key is in RECOVERY_KEY.txt, saved to the app ' +
                      'data folder when this till was first set up.'
            }),
            d.el('div.field', null, [d.el('label', { text: 'Username' }), username]),
            d.el('div.field', null, [d.el('label', { text: 'Recovery key' }), key]),
            d.el('div.field', null, [d.el('label', { text: 'New password' }), next]),
            note
        ]);

        function round() {
            return POS.ui.open({
                title: 'Reset password',
                body: body,
                dismissible: true,
                buttons: [
                    { label: 'Cancel', kind: 'ghost', value: false },
                    { label: 'Reset password', kind: 'primary', value: true, autofocus: true }
                ]
            }).then(function (go) {
                if (go !== true) return;
                return POS.api.recover(username.value.trim(), key.value.trim(), next.value)
                    .then(function (r) {
                        POS.ui.ok(r.message || 'Password reset');
                        els.user.value = username.value.trim();
                        els.pass.focus();
                    }, function (err) {
                        note.textContent = err.message;
                        note.hidden = false;
                        return round();
                    });
            });
        }

        round();
    }

    return {
        mount: mount,
        show: show,
        hide: hide,
        signOut: signOut,
        sessionExpired: sessionExpired,
        promptPasswordChange: promptPasswordChange
    };
})();
