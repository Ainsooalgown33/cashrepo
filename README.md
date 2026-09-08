# Cashier POS

An offline point-of-sale terminal for Windows. Electron shell, a local
data service on `127.0.0.1`, and flat JSON storage in the app data
folder. Nothing leaves the machine.

- **Roles** — administrators manage stock and staff; cashiers sell.
- **Inventory** — prices come from the catalogue, and stock is deducted
  on every sale.
- **Sales history** — visible to cashiers as well as administrators,
  with receipt reprint.
- **Thermal receipts** — 58 mm and 80 mm rolls.

---

## Running it

```bash
npm install
npm start
```

If `npm start` fails with *"Electron failed to install correctly"*, npm
blocked Electron's postinstall (it downloads the binary). Run it by hand:

```bash
node node_modules/electron/install.js
```

To build the Windows installer:

```bash
npm run build
```

## First run

A master administrator is created the first time the app starts:

| Username | Password |
| --- | --- |
| `admin` | `admin123` |

You are required to change it before you can sell. A recovery key is
written to **`RECOVERY_KEY.txt`** in the app data folder
(`%APPDATA%/Cashier POS/`) — copy it somewhere off this machine. It is
the only way back in if a password is lost, and it is stored hashed, so
the file is the only copy.

Then, in order:

1. **Settings** — store name, address, phone, and the paper width that
   matches your roll. These are printed on every receipt.
2. **Settings** — create a cashier account per person. Sales are recorded
   against whoever is signed in, so shared logins destroy the audit trail.
3. **Inventory** — add your products. Cashiers can only sell what is here.

## Using the till

The terminal is keyboard-first; a cashier should not need the mouse.

| Key | Action |
| --- | --- |
| `Enter` | add the line to the cart |
| `F2` | save the sale and print |
| `F4` | remove the selected line |
| `Del` | clear the cart |
| `Esc` | clear the entry form |
| `Ctrl+T` / `Ctrl+H` | terminal / sales |
| `Ctrl+I` / `Ctrl+,` | inventory / settings *(administrators)* |

A sale is **recorded and stock deducted before anything prints**. If the
save fails, nothing prints and the cart is left intact so it can be
retried — a customer never walks away with a receipt for a sale that was
not recorded.

## Data

Everything lives in `%APPDATA%/Cashier POS/`:

| File | Contents |
| --- | --- |
| `users.json` | accounts; passwords and recovery keys are bcrypt hashes |
| `inventory.json` | product catalogue and stock levels |
| `receipts.json` | every completed sale |
| `RECOVERY_KEY.txt` | the master recovery key |

Writes are atomic (write to a temp file, fsync, rename) and each file
keeps a `.bak` of its previous version, so an interrupted write cannot
truncate your sales history. Money is stored as **integer kobo**;
databases written by earlier versions are converted on first launch,
after a backup.

Back this folder up. It is the only copy of your sales records.

## Notes

- Sessions end when the app closes. Signing tokens are generated fresh
  each launch and are never written to disk.
- The data service listens only on `127.0.0.1` and additionally requires
  a per-launch token, so pages in a web browser cannot reach it.
- Prices are re-read from the catalogue server-side when a sale is
  saved, so the amount charged never depends on what the client sent.
