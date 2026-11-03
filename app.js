/* ==========================================================================
   Stockroom — inventory management
   Talks to Supabase through its auto-generated REST API (PostgREST).
   No build step, no framework, no external dependencies.
   ========================================================================== */

"use strict";

/* --------------------------------------------------------------- config */

const SUPABASE = {
  url: "https://pshotqrpdsqsihseijnn.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzaG90cXJwZHNxc2loc2Vpam5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxOTg2MTUsImV4cCI6MjEwODc3NDYxNX0.GawrX7GyRAuy2MlwCzZPoKPwNEN18bkXvbb_AZLfYpg",
  products: "products",
  movements: "stock_movements"
};

const ACTIVITY_LIMIT = 40;

/* ---------------------------------------------------------------- icons */

const ICON = {
  arrowDown:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v9M6 9.5l4 4 4-4M4 17h12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowUp:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V7M6 10.5l4-4 4 4M4 3h12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pencil:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.2 3.3l3.5 3.5L7.4 16H4v-3.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11.7 4.8l3.5 3.5" stroke="currentColor" stroke-width="1.6"/></svg>',
  trash:
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4.2h4V6M6.2 6l.7 10h6.2l.7-10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
};

/* ------------------------------------------------------------------ dom */

const $ = (sel) => document.querySelector(sel);

const els = {
  search: $("#searchInput"),
  refresh: $("#btnRefresh"),
  add: $("#btnAddProduct"),
  kpiProducts: $("#kpiProducts"),
  kpiUnits: $("#kpiUnits"),
  kpiValue: $("#kpiValue"),
  kpiLow: $("#kpiLow"),
  kpiLowSub: $("#kpiLowSub"),
  banner: $("#alertBanner"),
  bannerText: $("#alertText"),
  bannerAction: $("#alertAction"),
  chips: $("#categoryChips"),
  lowOnly: $("#lowOnly"),
  exportBtn: $("#btnExport"),
  rows: $("#productRows"),
  empty: $("#tableEmpty"),
  emptyTitle: $("#emptyTitle"),
  emptyText: $("#emptyText"),
  emptyAdd: $("#emptyAdd"),
  resultCount: $("#resultCount"),
  activity: $("#activityList"),
  activityRefresh: $("#btnActivityRefresh"),
  connDot: $("#connDot"),
  connText: $("#connText"),
  toastStack: $("#toastStack")
};

const productDialog = $("#productDialog");
const productForm = $("#productForm");
const productTitle = $("#productDialogTitle");
const productSubmit = $("#productSubmit");
const productError = $("#productError");
const qtyField = $("#qtyField");
const categoryList = $("#categoryList");

const moveDialog = $("#moveDialog");
const moveForm = $("#moveForm");
const moveTitle = $("#moveDialogTitle");
const moveSubmit = $("#moveSubmit");
const moveError = $("#moveError");
const moveProductName = $("#moveProductName");
const moveProductMeta = $("#moveProductMeta");
const moveHint = $("#moveHint");

const deleteDialog = $("#deleteDialog");
const deleteForm = $("#deleteForm");
const deleteName = $("#deleteName");
const deleteError = $("#deleteError");
const deleteSubmit = $("#deleteSubmit");

/* --------------------------------------------------------------- state */

const state = {
  products: [],
  movements: [],
  search: "",
  category: "all",
  lowOnly: false,
  loading: true,
  error: null
};

let editingProduct = null;
let movingProduct = null;
let movingKind = "in";
let deletingProduct = null;
let searchTimer = null;

/* ------------------------------------------------------------ formatting */

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const int = new Intl.NumberFormat("en-US");

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 45) return "just now";
  if (secs < 3600) return Math.floor(secs / 60) + "m ago";
  if (secs < 86400) return Math.floor(secs / 3600) + "h ago";
  if (secs < 604800) return Math.floor(secs / 86400) + "d ago";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------- rest api */

async function api(path, options = {}) {
  const headers = {
    apikey: SUPABASE.anonKey,
    Authorization: "Bearer " + SUPABASE.anonKey
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers.Prefer = options.prefer;

  const res = await fetch(SUPABASE.url + "/rest/v1/" + path, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    const err = new Error((payload && payload.message) || res.status + " " + res.statusText);
    err.status = res.status;
    err.code = payload && payload.code;
    err.details = payload && payload.details;
    throw err;
  }
  return payload;
}

function friendlyError(err) {
  if (err && err.code === "23505") return "That SKU is already used by another product.";
  if (err && err.code === "23514") return "A value is out of range. Check the price, quantity and reorder level.";
  if (err && err.code === "23503") return "That product no longer exists. Refresh and try again.";
  if (err && /Only \d+ unit/.test(err.message || "")) return err.message;
  return (err && err.message) || "Something went wrong.";
}

/* ----------------------------------------------------------------- load */

async function refresh({ quiet = false } = {}) {
  if (!quiet) {
    state.loading = true;
    state.error = null;
    render();
  }
  els.refresh.disabled = true;

  try {
    const [products, movements] = await Promise.all([
      api(SUPABASE.products + "?select=*&order=name.asc"),
      api(
        SUPABASE.movements +
        "?select=id,kind,quantity,note,created_at,product:products(name,sku)" +
        "&order=created_at.desc&limit=" + ACTIVITY_LIMIT
      )
    ]);

    state.products = Array.isArray(products) ? products : [];
    state.movements = Array.isArray(movements) ? movements : [];
    state.error = null;
    setConnection(true);
  } catch (err) {
    state.error = friendlyError(err);
    setConnection(false);
    toast(state.error, "err");
  } finally {
    state.loading = false;
    els.refresh.disabled = false;
    render();
  }
}

function setConnection(ok) {
  els.connDot.className = "dot " + (ok ? "ok" : "err");
  els.connText.textContent = ok ? "Connected to Supabase" : "Connection problem";
}

/* --------------------------------------------------------------- render */

function isLow(p) {
  return num(p.quantity) <= num(p.reorder_level);
}

function stockKind(p) {
  if (num(p.quantity) <= 0) return "out";
  if (isLow(p)) return "low";
  return "ok";
}

const SEVERITY = { out: 0, low: 1, ok: 2 };

function filteredProducts() {
  const q = state.search.trim().toLowerCase();
  return state.products
    .filter((p) => {
      if (state.category !== "all" && p.category !== state.category) return false;
      if (state.lowOnly && !isLow(p)) return false;
      if (!q) return true;
      return (p.name + " " + p.sku + " " + p.category).toLowerCase().includes(q);
    })
    .sort((a, b) => SEVERITY[stockKind(a)] - SEVERITY[stockKind(b)] || a.name.localeCompare(b.name));
}

function render() {
  renderKpis();
  renderChips();
  renderTable();
  renderActivity();
  renderBanner();
  els.lowOnly.setAttribute("aria-pressed", String(state.lowOnly));
}

function renderKpis() {
  const count = state.products.length;
  const units = state.products.reduce((sum, p) => sum + num(p.quantity), 0);
  const value = state.products.reduce((sum, p) => sum + num(p.quantity) * num(p.unit_price), 0);
  const low = state.products.filter(isLow).length;

  els.kpiProducts.textContent = state.loading && !count ? "—" : int.format(count);
  els.kpiUnits.textContent = state.loading && !count ? "—" : int.format(units);
  els.kpiValue.textContent = state.loading && !count ? "—" : money.format(value);
  els.kpiLow.textContent = state.loading && !count ? "—" : int.format(low);
  els.kpiLowSub.textContent = low === 0 ? "everything is healthy" : "at or below reorder level";
}

function renderChips() {
  const categories = [...new Set(state.products.map((p) => p.category))].sort((a, b) => a.localeCompare(b));

  if (state.category !== "all" && !categories.includes(state.category)) {
    state.category = "all";
  }

  els.chips.replaceChildren();

  const make = (label, value) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (state.category === value ? " is-active" : "");
    b.setAttribute("aria-pressed", String(state.category === value));
    b.textContent = label;
    b.addEventListener("click", () => {
      state.category = value;
      render();
    });
    return b;
  };

  els.chips.appendChild(make("All", "all"));
  categories.forEach((c) => els.chips.appendChild(make(c, c)));
}

function renderTable() {
  const rows = filteredProducts();

  els.rows.replaceChildren();

  if (state.error && !state.products.length) {
    showEmpty("Could not reach the database", state.error, "Try again");
    return;
  }
  if (state.loading && !state.products.length) {
    showEmpty("Loading products…", "Fetching the latest stock levels.", null);
    return;
  }
  if (!state.products.length) {
    showEmpty("No products yet", "Add your first product to start tracking stock.", "Add product");
    return;
  }
  if (!rows.length) {
    showEmpty("No matching products", "Try a different search or clear the filters.", null);
    return;
  }

  hideEmpty();

  const frag = document.createDocumentFragment();
  rows.forEach((p) => frag.appendChild(productRow(p)));
  els.rows.appendChild(frag);

  const total = state.products.length;
  els.resultCount.textContent =
    rows.length === total
      ? total + (total === 1 ? " product" : " products")
      : rows.length + " of " + total + " products";
}

function showEmpty(title, text, actionLabel) {
  els.empty.hidden = false;
  els.emptyTitle.textContent = title;
  els.emptyText.textContent = text;
  if (actionLabel) {
    els.emptyAdd.hidden = false;
    els.emptyAdd.textContent = actionLabel;
    els.emptyAdd.classList.toggle("primary", actionLabel !== "Try again");
  } else {
    els.emptyAdd.hidden = true;
  }
  els.resultCount.textContent = title;
}

function hideEmpty() {
  els.empty.hidden = true;
}

function productRow(p) {
  const tr = document.createElement("tr");

  /* product */
  const tdProduct = document.createElement("td");
  tdProduct.className = "cell-product";
  const name = document.createElement("div");
  name.className = "pname";
  name.textContent = p.name;
  const sku = document.createElement("div");
  sku.className = "psku";
  sku.textContent = p.sku;
  tdProduct.append(name, sku);

  /* category */
  const tdCategory = document.createElement("td");
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = p.category;
  tag.title = p.category;
  tdCategory.appendChild(tag);

  /* price */
  const tdPrice = document.createElement("td");
  tdPrice.className = "num money";
  tdPrice.textContent = money.format(num(p.unit_price));

  /* stock */
  const tdStock = document.createElement("td");
  const kind = stockKind(p);
  const stock = document.createElement("span");
  stock.className = "stock stock--" + kind;
  stock.appendChild(document.createElement("i"));
  stock.appendChild(document.createTextNode(int.format(num(p.quantity))));
  tdStock.appendChild(stock);

  const note = document.createElement("small");
  note.className = "stock-note";
  note.textContent =
    kind === "out" ? "Out of stock" : kind === "low" ? "Below reorder level" : "In stock";
  tdStock.appendChild(note);

  /* reorder */
  const tdReorder = document.createElement("td");
  tdReorder.className = "num money--muted";
  tdReorder.textContent = int.format(num(p.reorder_level));

  /* value */
  const tdValue = document.createElement("td");
  tdValue.className = "num money";
  tdValue.textContent = money.format(num(p.quantity) * num(p.unit_price));

  /* actions */
  const tdActions = document.createElement("td");
  tdActions.className = "right";
  const actions = document.createElement("div");
  actions.className = "row-actions";

  actions.appendChild(rowButton("in", ICON.arrowDown, "Stock in for " + p.name, p.id));
  actions.appendChild(rowButton("out", ICON.arrowUp, "Stock out for " + p.name, p.id));
  actions.appendChild(rowButton("edit", ICON.pencil, "Edit " + p.name, p.id));
  actions.appendChild(rowButton("delete", ICON.trash, "Delete " + p.name, p.id, "del"));
  tdActions.appendChild(actions);

  tr.append(tdProduct, tdCategory, tdPrice, tdStock, tdReorder, tdValue, tdActions);
  return tr;
}

function rowButton(action, icon, label, id, extra) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "row-btn" + (extra ? " " + extra : "");
  b.dataset.action = action;
  b.dataset.id = id;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon;
  return b;
}

function renderActivity() {
  els.activity.replaceChildren();

  if (!state.movements.length) {
    const li = document.createElement("li");
    li.className = "activity-empty";
    li.textContent = state.loading ? "Loading activity…" : "No stock movements yet.";
    els.activity.appendChild(li);
    return;
  }

  state.movements.forEach((m) => {
    const li = document.createElement("li");
    li.className = "act";

    const icon = document.createElement("span");
    icon.className = "act-icon " + m.kind;
    icon.innerHTML = m.kind === "in" ? ICON.arrowDown : ICON.arrowUp;

    const body = document.createElement("div");
    body.className = "act-body";

    const line = document.createElement("div");
    line.className = "act-line";

    const nameEl = document.createElement("span");
    nameEl.className = "act-name";
    nameEl.textContent = m.product ? m.product.name : "Unknown product";

    const qtyEl = document.createElement("span");
    qtyEl.className = "act-qty " + m.kind;
    qtyEl.textContent = (m.kind === "in" ? "+" : "−") + int.format(num(m.quantity));

    line.append(nameEl, qtyEl);

    const meta = document.createElement("div");
    meta.className = "act-meta";
    meta.appendChild(document.createTextNode(timeAgo(m.created_at)));
    if (m.note) {
      meta.appendChild(document.createTextNode(" · "));
      const noteEl = document.createElement("span");
      noteEl.className = "act-note";
      noteEl.textContent = m.note;
      meta.appendChild(noteEl);
    }

    body.append(line, meta);
    li.append(icon, body);
    els.activity.appendChild(li);
  });
}

function renderBanner() {
  const low = state.products.filter(isLow).length;
  const show = low > 0 && !state.lowOnly && !state.error;
  els.banner.hidden = !show;
  if (show) {
    els.bannerText.textContent =
      low + (low === 1 ? " product is" : " products are") + " at or below the reorder level.";
  }
}

/* -------------------------------------------------------------- dialogs */

function openProductDialog(product) {
  editingProduct = product || null;
  productForm.reset();
  productError.hidden = true;

  if (product) {
    productTitle.textContent = "Edit product";
    productSubmit.textContent = "Save changes";
    qtyField.hidden = true;

    productForm.elements.sku.value = product.sku;
    productForm.elements.name.value = product.name;
    productForm.elements.category.value = product.category;
    productForm.elements.unit_price.value = num(product.unit_price).toFixed(2);
    productForm.elements.reorder_level.value = product.reorder_level;
  } else {
    productTitle.textContent = "Add product";
    productSubmit.textContent = "Add product";
    qtyField.hidden = false;
    productForm.elements.reorder_level.value = 5;
    productForm.elements.quantity.value = 0;
  }

  refreshCategoryList();
  productDialog.showModal();
  window.setTimeout(() => productForm.elements.sku.focus(), 40);
}

function refreshCategoryList() {
  const categories = [...new Set(state.products.map((p) => p.category))].sort((a, b) => a.localeCompare(b));
  categoryList.replaceChildren();
  categories.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    categoryList.appendChild(o);
  });
}

async function submitProduct(event) {
  event.preventDefault();
  productError.hidden = true;

  const fd = new FormData(productForm);
  const sku = String(fd.get("sku") || "").trim();
  const name = String(fd.get("name") || "").trim();
  const category = String(fd.get("category") || "").trim() || "General";
  const price = Number(fd.get("unit_price"));
  const reorder = Number(fd.get("reorder_level"));
  const opening = Number(fd.get("quantity") || 0);

  if (!sku) return failProduct("Enter a SKU.");
  if (!name) return failProduct("Enter a product name.");
  if (!Number.isFinite(price) || price < 0) return failProduct("Unit price must be zero or more.");
  if (!Number.isInteger(reorder) || reorder < 0) return failProduct("Reorder level must be a whole number.");
  if (!editingProduct && (!Number.isInteger(opening) || opening < 0)) {
    return failProduct("Opening stock must be a whole number.");
  }

  const label = editingProduct ? "Save changes" : "Add product";
  setBusy(productSubmit, true, "Saving…");

  try {
    if (editingProduct) {
      await api(SUPABASE.products + "?id=eq." + encodeURIComponent(editingProduct.id), {
        method: "PATCH",
        body: {
          sku,
          name,
          category,
          unit_price: price,
          reorder_level: reorder
        },
        prefer: "return=minimal"
      });

      // Reflect the change immediately; the refresh below confirms it.
      Object.assign(editingProduct, {
        sku,
        name,
        category,
        unit_price: price,
        reorder_level: reorder
      });
      render();
      toast("Product updated.");
    } else {
      const created = await api(SUPABASE.products, {
        method: "POST",
        body: { sku, name, category, unit_price: price, reorder_level: reorder, quantity: 0 },
        prefer: "return=representation"
      });
      const row = Array.isArray(created) ? created[0] : created;

      if (opening > 0 && row && row.id) {
        await api(SUPABASE.movements, {
          method: "POST",
          body: { product_id: row.id, kind: "in", quantity: opening, note: "Initial stock" },
          prefer: "return=minimal"
        });
      }
      toast("Product added.");
    }

    productDialog.close();
    await refresh({ quiet: true });
  } catch (err) {
    failProduct(friendlyError(err));
  } finally {
    setBusy(productSubmit, false, label);
  }
}

function failProduct(message) {
  productError.textContent = message;
  productError.hidden = false;
}

function openMoveDialog(product, kind) {
  movingProduct = product;
  setMoveKind(kind || "in");
  moveForm.reset();
  moveError.hidden = true;

  moveTitle.textContent = kind === "out" ? "Stock out" : "Stock in";
  moveProductName.textContent = product.name;
  moveProductMeta.textContent = product.sku + " · " + int.format(num(product.quantity)) + " in stock";

  moveDialog.showModal();
  window.setTimeout(() => {
    const input = moveForm.elements.quantity;
    input.focus();
    input.select();
  }, 40);
}

function setMoveKind(kind) {
  movingKind = kind;
  moveDialog.querySelectorAll(".seg").forEach((b) => {
    b.classList.toggle("active", b.dataset.kind === kind);
  });
  moveHint.textContent = kind === "in" ? "Units added to stock." : "Units removed from stock.";
}

async function submitMove(event) {
  event.preventDefault();
  moveError.hidden = true;

  const qty = Number(new FormData(moveForm).get("quantity"));
  const note = String(new FormData(moveForm).get("note") || "").trim();

  if (!Number.isInteger(qty) || qty < 1) {
    moveError.textContent = "Quantity must be a whole number of at least 1.";
    moveError.hidden = false;
    return;
  }
  if (movingKind === "out" && qty > num(movingProduct.quantity)) {
    moveError.textContent = "Only " + int.format(num(movingProduct.quantity)) + " unit(s) in stock.";
    moveError.hidden = false;
    return;
  }

  setBusy(moveSubmit, true, "Saving…");
  try {
    await api(SUPABASE.movements, {
      method: "POST",
      body: {
        product_id: movingProduct.id,
        kind: movingKind,
        quantity: qty,
        note: note || null
      },
      prefer: "return=minimal"
    });

    // Reflect the movement immediately; the refresh below confirms it.
    movingProduct.quantity = num(movingProduct.quantity) + (movingKind === "in" ? qty : -qty);
    render();

    toast(
      movingKind === "in"
        ? "Added " + int.format(qty) + " unit(s) to " + movingProduct.name + "."
        : "Removed " + int.format(qty) + " unit(s) from " + movingProduct.name + "."
    );

    moveDialog.close();
    await refresh({ quiet: true });
  } catch (err) {
    moveError.textContent = friendlyError(err);
    moveError.hidden = false;
  } finally {
    setBusy(moveSubmit, false, "Record movement");
  }
}

function openDeleteDialog(product) {
  deletingProduct = product;
  deleteName.textContent = product.name;
  deleteError.hidden = true;
  deleteDialog.showModal();
}

async function submitDelete(event) {
  event.preventDefault();
  if (!deletingProduct) return;

  setBusy(deleteSubmit, true, "Deleting…");
  try {
    await api(SUPABASE.products + "?id=eq." + encodeURIComponent(deletingProduct.id), {
      method: "DELETE",
      prefer: "return=minimal"
    });
    toast("Product deleted.");
    deleteDialog.close();
    await refresh({ quiet: true });
  } catch (err) {
    deleteError.textContent = friendlyError(err);
    deleteError.hidden = false;
  } finally {
    setBusy(deleteSubmit, false, "Delete product");
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
  button.setAttribute("aria-busy", String(busy));
}

/* ---------------------------------------------------------------- toast */

function toast(message, kind) {
  const el = document.createElement("div");
  el.className = "toast " + (kind || "ok");
  el.textContent = message;
  els.toastStack.appendChild(el);

  window.setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    window.setTimeout(() => el.remove(), 180);
  }, 3800);
}

/* ------------------------------------------------------------------ csv */

function exportCsv() {
  const rows = filteredProducts();
  if (!rows.length) {
    toast("Nothing to export.", "err");
    return;
  }

  const header = ["SKU", "Product", "Category", "Unit price", "Quantity", "Reorder level", "Stock value"];
  const lines = [header].concat(
    rows.map((p) => [
      p.sku,
      p.name,
      p.category,
      num(p.unit_price).toFixed(2),
      num(p.quantity),
      num(p.reorder_level),
      (num(p.quantity) * num(p.unit_price)).toFixed(2)
    ])
  );

  const csv = lines
    .map((line) =>
      line
        .map((cell) => {
          const s = String(cell);
          return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(",")
    )
    .join("\r\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "stockroom-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  toast("Exported " + rows.length + " product(s).");
}

/* --------------------------------------------------------------- events */

function bindEvents() {
  els.add.addEventListener("click", () => openProductDialog(null));
  els.refresh.addEventListener("click", () => refresh());
  els.activityRefresh.addEventListener("click", () => refresh({ quiet: true }));
  els.exportBtn.addEventListener("click", exportCsv);

  els.emptyAdd.addEventListener("click", () => {
    if (state.error) refresh();
    else openProductDialog(null);
  });

  els.lowOnly.addEventListener("click", () => {
    state.lowOnly = !state.lowOnly;
    render();
  });

  els.bannerAction.addEventListener("click", () => {
    state.lowOnly = true;
    render();
    $("#productRows").closest(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  els.search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.search = els.search.value;
      render();
    }, 110);
  });

  els.rows.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const product = state.products.find((p) => p.id === btn.dataset.id);
    if (!product) return;

    if (btn.dataset.action === "in") openMoveDialog(product, "in");
    if (btn.dataset.action === "out") openMoveDialog(product, "out");
    if (btn.dataset.action === "edit") openProductDialog(product);
    if (btn.dataset.action === "delete") openDeleteDialog(product);
  });

  productForm.addEventListener("submit", submitProduct);
  moveForm.addEventListener("submit", submitMove);
  deleteForm.addEventListener("submit", submitDelete);

  moveDialog.querySelectorAll(".seg").forEach((b) => {
    b.addEventListener("click", () => {
      setMoveKind(b.dataset.kind);
      moveError.hidden = true;
      moveTitle.textContent = b.dataset.kind === "out" ? "Stock out" : "Stock in";
    });
  });

  document.querySelectorAll("[data-close]").forEach((b) => {
    b.addEventListener("click", () => b.closest("dialog").close());
  });

  [productDialog, moveDialog, deleteDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = (event.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || event.target.isContentEditable) return;
    if (document.querySelector("dialog[open]")) return;
    event.preventDefault();
    els.search.focus();
  });

  let lastFocusRefresh = 0;
  window.addEventListener("focus", () => {
    const now = Date.now();
    if (now - lastFocusRefresh < 15000) return;
    lastFocusRefresh = now;
    refresh({ quiet: true });
  });
}

/* ----------------------------------------------------------------- init */

function init() {
  bindEvents();
  refresh();
}

init();
