# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ATIK-mgmt is a business management SPA for an artisanal incense company ("All Trees I Know"). It is built entirely in **vanilla HTML/CSS/JavaScript with no build tooling, no npm, no framework**. The app is deployed to GitHub Pages and uses Firebase (Auth + Firestore) as an optional backend.

## Running the Application

Since there is no build step, simply open the files in a browser or serve them with any static file server:

```bash
# Python (simplest)
python3 -m http.server 8080

# Then open:
# http://localhost:8080/index.html   — admin app
# http://localhost:8080/order.html   — public order form
```

Firebase configuration is loaded from `firebase-config.js` (not tracked, copy from `firebase-config.example.js` and fill in real credentials). Cloud sync is optional — the app works fully offline via localStorage.

## Architecture

### Two Applications in One Repo

| File | Purpose |
|---|---|
| `index.html` | Admin/management SPA (~3800 lines) — invoicing, warehouse, sales, buyers |
| `order.html` | Public order/catalog form (~1000 lines) — customers browse and submit orders |

Both are fully self-contained single-file SPAs: all CSS, JS, and HTML in one file each.

### Data Layer

**Primary storage is `localStorage`** — all data is read/written on every change via `load()` / `save()`. Firestore is a supplementary real-time sync layer for sharing state between two users.

LocalStorage keys (all prefixed `atik5_`):
- `atik5_products`, `atik5_buyers`, `atik5_journal`, `atik5_settings`
- `atik5_wh` (warehouse stock), `atik5_raw` (raw materials), `atik5_recv` (receive history)
- `atik5_retail`, `atik5_salesrep`, `atik5_suppliers`

**Firestore structure** (in `index.html`):
- `shared/main` — entire app state serialised as one document, synced on change
- `orders` — order submissions from `order.html`

Cloud sync flow: `collectAppState()` → `pushCloudState()` → Firestore; incoming: `subscribeToCloudState()` calls `applyAppState()` then `rerenderAfterStateChange()`.

### Tab System (`index.html`)

Navigation is a flat tab switcher — no router. `switchTab(tab)` hides/shows `#pane-<tab>` divs and calls the corresponding render function. The seven tabs are: `dashboard`, `docs`, `warehouse`, `sales`, `orders`, `catalog`, `settings`.

### Key Constants & State (global variables in `index.html`)

```
DEFAULT_PRODUCTS  — seed product catalogue (11 incense types)
DEFAULT_BUYERS    — seed buyer records
BOM               — Bill of Materials: packaging units per product
AROMAS            — aroma ID → {en, uk} name map
SUPPLIERS_DEFAULT — 4 main suppliers with aroma assignments

products, buyers, journal, warehouseStock, rawStock,
receiveHistory, retailStock, salesReports, suppliers, settings  — live state arrays/objects
items             — current invoice line items (transient, not persisted)
```

### Document Generation

The core business operation is `generate()` which:
1. Reads `items[]`, buyer, doc type (invoice vs. bill), price type (shelf/wholesale/dealer)
2. Calculates totals using `getItemPrice()` / `getTotal()`
3. Builds a `journalEntry` object, pushes to `journal[]`, saves, triggers cloud push
4. Calls `renderPreview()` which renders the formatted document into `#preview-area`

Export paths: `doExportExcel()` (HTML table → `.xls`), `doExportPDF()` (window.print with @media print styles), `doCopyText()`.

### COGS Calculator

`renderCogs()` / `renderCogsResult()` compute cost-of-goods using `BOM` (sticks, tubes, labels) and configurable material prices stored in `localStorage` under `atik_cogs_*` keys. `calcCogsForProduct(productId)` returns per-unit cost.

### Styling Conventions

CSS custom properties define the entire palette — never use hard-coded colours:
```css
--moss, --moss2…4   /* primary greens */
--pine, --pine2     /* dark greens */
--bamboo, --bamboo2
--cedar, --cedar2
--washi, --washi2…4 /* off-white backgrounds */
--sakura, --sakura2 /* pink accents */
--gold, --gold2     /* warning/highlight */
--red, --red2       /* danger */
--ink, --ink2…4     /* text hierarchy */
```

Button classes: `.btn-moss` (primary), `.btn-pine`, `.btn-gray`, `.btn-danger`, `.btn-excel`, `.btn-pdf`. Size modifier: `.btn-sm`.

All UI text is in **Ukrainian (`uk`)**. Number formatting uses `fmt(n)` (integer) and `fmt2(n)` (2 decimal) which call `toLocaleString("uk-UA")`.

## Firebase Setup (for cloud sync)

1. Copy `firebase-config.example.js` → `firebase-config.js`, fill in your project credentials.
2. Enable **Google Authentication** and **Firestore Database** in Firebase Console.
3. Apply Firestore rules (minimum for testing):
   ```
   match /shared/{document} { allow read, write: if request.auth != null; }
   match /orders/{document} { allow create: if true; allow read, write: if request.auth != null; }
   ```

## Merge / Backup Logic

`mergeImportBackup()` performs a smart merge when importing a JSON backup: `mergeById()` for arrays with `.id` fields, `mergeJournal()` for the journal (preserves manual status changes), `mergePlainObject()` for settings. `convertV4BackupToV5()` handles migration from older backup formats.
