# Stockroom — Inventory Management System

A small web application that lets a business manage its product catalogue and
monitor stock levels. Products, stock movements and quantities live in a
Supabase (Postgres) database; the frontend talks to it through Supabase's
auto-generated REST API. There is no build step and no framework — just three
static files, deployed on Vercel.

| | |
|---|---|
| **Live app** | `VERCEL_URL_PLACEHOLDER` |
| **Source** | https://github.com/belisemukantabana-git/inventory-management-system |
| **Supabase project** | `pshotqrpdsqsihseijnn` |
| **API base** | `https://pshotqrpdsqsihseijnn.supabase.co/rest/v1` |

---

## What it does

**Dashboard**
- Total products, units in stock, stock value and "needs attention" counters.
- A banner listing how many products are at or below their reorder level.

**Catalogue**
- Add, edit and delete products (SKU, name, category, unit price, reorder level).
- Search across name, SKU and category; filter by category chip.
- "Low stock only" filter and severity-first ordering, so problems surface first.
- Export the current view to CSV.

**Stock control**
- **Stock in** and **Stock out** actions record a movement instead of silently
  overwriting the quantity.
- Each movement is written to an append-only ledger (`stock_movements`) and a
  database trigger updates `products.quantity` in the same transaction.
- Stock-out is guarded on both sides: the UI blocks it, and the trigger refuses
  it if another user already took the units.
- Every product shows an **In stock / Below reorder level / Out of stock** badge.

**Activity feed**
- The 40 most recent movements, with product name, direction, quantity, note
  and relative time.

**Details**
- Responsive down to phone width, keyboard accessible, `/` focuses search,
  `Esc` closes dialogs, toast confirmations for every write.

---

## Tech stack

| Layer | Choice |
|---|---|
| UI | HTML, CSS, vanilla JavaScript (ES2020) |
| Data | Supabase Postgres + PostgREST (auto-generated REST API) |
| Auth | Supabase anon key + Row Level Security |
| Hosting | Vercel (static) |
| Tooling | Git, GitHub, Supabase MCP, AI coding agent |

No npm dependencies, no bundler, no CDN requests. The app loads three files.

---

## How it works

```
┌──────────────────────────────┐
│  Browser                     │
│  index.html · styles.css     │
│  app.js  ── fetch() ─────────┼──► https://<project>.supabase.co/rest/v1
└──────────────────────────────┘            │  apikey + Bearer <anon key>
                                            ▼
                                 ┌─────────────────────┐
                                 │  PostgREST          │
                                 │  (Supabase)         │
                                 └──────────┬──────────┘
                                            ▼
                                 ┌─────────────────────┐
                                 │  Postgres           │
                                 │  products           │
                                 │  stock_movements    │
                                 │   └ trigger:        │
                                 │     apply_stock_... │
                                 └─────────────────────┘
```

The frontend never computes a new stock level and sends it. It inserts a row in
`stock_movements`; the trigger locks the product row, validates the direction,
and adjusts `products.quantity`. `products.quantity` is a cached value kept in
sync by the trigger — reads stay a single indexed column, and the ledger stays
the source of truth.

### Data model

**`products`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key, `gen_random_uuid()` |
| `sku` | `text` | unique, not null |
| `name` | `text` | not null |
| `category` | `text` | defaults to `General` |
| `unit_price` | `numeric(12,2)` | `>= 0` |
| `quantity` | `integer` | `>= 0`, maintained by trigger |
| `reorder_level` | `integer` | `>= 0`, low-stock threshold |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` maintained by trigger |

**`stock_movements`**

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint identity` | primary key |
| `product_id` | `uuid` | → `products.id`, `on delete cascade` |
| `kind` | `text` | `in` or `out` |
| `quantity` | `integer` | `> 0` |
| `note` | `text` | optional |
| `created_at` | `timestamptz` | defaults to `now()` |

Indexes cover `category`, `(quantity, reorder_level)`, and the activity query
(`created_at desc`, `(product_id, created_at desc)`).

Full DDL, policies and demo data: [`supabase/schema.sql`](supabase/schema.sql).

---

## API

Supabase exposes the tables directly through PostgREST. The frontend uses the
anon key, which is safe to ship **because RLS is enabled**.

Every request needs:

```
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json
```

### List products

```bash
curl "https://pshotqrpdsqsihseijnn.supabase.co/rest/v1/products?select=*&order=name.asc" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

### Create a product

```bash
curl -X POST "https://pshotqrpdsqsihseijnn.supabase.co/rest/v1/products" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"sku":"SKU-2001","name":"Bluetooth Speaker","category":"Electronics","unit_price":45.00,"reorder_level":5,"quantity":0}'
```

### Record a stock movement

```bash
curl -X POST "https://pshotqrpdsqsihseijnn.supabase.co/rest/v1/stock_movements" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"product_id":"<uuid>","kind":"out","quantity":3,"note":"Order #1050"}'
```

The trigger updates `products.quantity` and returns `400` with
`Only N unit(s) in stock` when issuing more than is available.

### Recent movements (with product names embedded)

```bash
curl "https://pshotqrpdsqsihseijnn.supabase.co/rest/v1/stock_movements?select=id,kind,quantity,note,created_at,product:products(name,sku)&order=created_at.desc&limit=40" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

### Other endpoints used

| Operation | Request |
|---|---|
| Update product | `PATCH /rest/v1/products?id=eq.<uuid>` |
| Delete product | `DELETE /rest/v1/products?id=eq.<uuid>` (movements cascade) |
| Filter | `GET /rest/v1/products?select=*&category=eq.Office` |

---

## Run locally

Any static file server works:

```bash
python -m http.server 8080
# or: npx serve .
```

Then open <http://localhost:8080>. The app talks to the hosted Supabase project,
so no local database is required.

---

## Deploy

1. Push this repository to GitHub.
2. On [vercel.com/new](https://vercel.com/new), import the repository.
3. Framework preset: **Other**. Build command: none. Output directory: `.`
4. **Deploy**.

`vercel.json` adds clean URLs and a few security headers; no other
configuration is needed.

### Supabase setup (already done for this project)

Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor,
then put the project URL and **anon** key into `app.js`:

```js
const SUPABASE = {
  url: "https://<project-ref>.supabase.co",
  anonKey: "<anon public key>",
  products: "products",
  movements: "stock_movements"
};
```

---

## Security notes

- Only the **anon public** key is in the client. The `service_role` key is never
  used and must never be added.
- RLS is enabled on both tables and every access goes through a policy.
- The demo policies allow anonymous `select / insert / update / delete` so the
  app can be graded without a login. **For production**, add Supabase Auth and
  replace `using (true)` with a check for an authenticated staff role, e.g.
  `using (auth.role() = 'authenticated')`.
- Product deletes cascade to their movements by design; there is no soft-delete
  yet.
- The anon key can be rotated in Supabase without touching the schema.

---

## Verification

- Schema, policies and triggers created through the Supabase MCP and inspected
  with `list_tables` / `pg_policies`.
- REST round-trips against the live project: list, create, update, delete,
  stock in, stock out, over-issue rejection.
- Browser end-to-end run: add a product, restock it, issue stock, filter,
  search, export, delete.
- Responsive layout checked at 1440, 1024, 768 and 390 px.
- `node --check app.js` for syntax.

---

## Project layout

```
.
├── index.html            # layout and dialogs
├── styles.css            # design system + responsive rules
├── app.js                # state, REST client, rendering, dialogs
├── supabase/
│   └── schema.sql        # tables, triggers, RLS, demo data
├── vercel.json           # clean URLs + security headers
├── .gitignore
└── README.md
```
