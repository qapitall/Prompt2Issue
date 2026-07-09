// Frontend logic for Prompt2Issue. Vanilla JS, no build step.
// UI strings are Turkish (user preference); code and comments are English.

const STATUS_LABELS = { todo: "To Do", doing: "In Progress", done: "Done" };
const PRIORITY_LABELS = { high: "High", medium: "Medium", low: "Low" };

// Current board date in YYYY-MM-DD (local). Defaults to today.
let currentDate = todayStr();

// Last loaded cards and the active category filter ("" = show all).
let boardCards = [];
let categoryFilter = "";

// --- Small DOM / API helpers -------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function api(method, url, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// --- Board loading & rendering ----------------------------------------------

async function loadBoard() {
  const data = await api("GET", `/api/board?date=${currentDate}`);
  boardCards = data.cards || [];
  updateCategoryFilter();
  renderBoard(boardCards);
}

// Rebuild the filter dropdown from the categories present on this board.
function updateCategoryFilter() {
  const categories = [...new Set(boardCards.map((c) => c.category).filter(Boolean))].sort();
  if (!categories.includes(categoryFilter)) categoryFilter = "";
  const select = $("#category-filter");
  select.innerHTML = '<option value="">All</option>';
  for (const cat of categories) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    if (cat === categoryFilter) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderBoard(cards) {
  for (const status of Object.keys(STATUS_LABELS)) {
    const container = document.querySelector(`.cards[data-status="${status}"]`);
    container.innerHTML = "";
    const inColumn = cards.filter(
      (c) => c.status === status && (!categoryFilter || c.category === categoryFilter)
    );
    if (inColumn.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "—";
      container.appendChild(hint);
    }
    for (const card of inColumn) container.appendChild(renderCard(card));
    const count = document.querySelector(`.column-count[data-status="${status}"]`);
    if (count) count.textContent = inColumn.length;
  }
}

function renderCard(card) {
  const el = document.createElement("div");
  el.className = "card";
  el.draggable = true;
  el.dataset.id = card.id;
  el.dataset.priority = card.priority;

  const title = document.createElement("p");
  title.className = "card-title";
  title.textContent = card.title;
  el.appendChild(title);

  if (card.description) {
    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = card.description;
    el.appendChild(desc);
  }

  const footer = document.createElement("div");
  footer.className = "card-footer";

  const left = document.createElement("div");
  const badge = document.createElement("span");
  badge.className = `badge ${card.priority}`;
  badge.textContent = PRIORITY_LABELS[card.priority];
  left.appendChild(badge);
  if (card.category) {
    const cat = document.createElement("span");
    cat.className = "category-badge";
    cat.textContent = card.category;
    left.appendChild(cat);
  }
  if (card.carryCount > 0) {
    // Show how many days this card has been on the board (first day + carries).
    const carry = document.createElement("span");
    carry.className = "carry-badge";
    carry.textContent = `↻ ${card.carryCount + 1}d`;
    carry.title = `Carried over for ${card.carryCount + 1} days`;
    left.appendChild(carry);
  }
  if (card.source === "ai") {
    const tag = document.createElement("span");
    tag.className = "source-tag";
    tag.textContent = " 🤖";
    tag.title = "Created by AI";
    left.appendChild(tag);
  }
  footer.appendChild(left);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const editBtn = document.createElement("button");
  editBtn.textContent = "✏️";
  editBtn.title = "Edit";
  editBtn.addEventListener("click", () => openCardEditor(card));
  const delBtn = document.createElement("button");
  delBtn.textContent = "🗑️";
  delBtn.title = "Delete";
  delBtn.addEventListener("click", () => removeCard(card.id));
  actions.append(editBtn);
  if (card.status !== "done") {
    const doneBtn = document.createElement("button");
    doneBtn.textContent = "✓";
    doneBtn.title = "Mark as Done";
    doneBtn.addEventListener("click", async () => {
      await api("PUT", `/api/cards/${card.id}`, { date: currentDate, status: "done" });
      await loadBoard();
    });
    actions.append(doneBtn);
  }
  actions.append(delBtn);
  footer.appendChild(actions);

  el.appendChild(footer);

  // Clicking anywhere on the card opens the editor; action buttons keep their own behavior.
  el.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    openCardEditor(card);
  });

  el.addEventListener("dragstart", () => {
    el.classList.add("dragging");
    window.__draggingId = card.id;
    window.__dropped = false;
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    window.__draggingId = null;
    // Drag was cancelled (no drop): restore the board to its saved order,
    // since dragover may have moved the card around in the DOM.
    if (!window.__dropped) loadBoard();
  });

  return el;
}

// --- Drag & drop: reorder within a column and move across columns ------------

// The card (below the pointer) that the dragged card should be inserted before.
function getDragAfterElement(zone, y) {
  const others = [...zone.querySelectorAll(".card:not(.dragging)")];
  let closest = { offset: -Infinity, element: null };
  for (const child of others) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
  }
  return closest.element;
}

function wireDragAndDrop() {
  document.querySelectorAll(".cards").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
      const dragging = document.querySelector(".card.dragging");
      if (!dragging) return;
      zone.querySelector(".empty-hint")?.remove();
      // Move the card in the DOM as it is dragged, so the user sees the
      // exact spot it will land in — within this column or another one.
      const after = getDragAfterElement(zone, e.clientY);
      if (after) zone.insertBefore(dragging, after);
      else zone.appendChild(dragging);
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const id = window.__draggingId;
      if (!id) return;
      window.__dropped = true;
      const dragging = zone.querySelector(".card.dragging");
      // Map the drop spot to a position in the FULL column (a category filter
      // may be hiding cards): insert before the next visible card, or at the end.
      const visible = dragging ? [...zone.querySelectorAll(".card")] : [];
      const next = visible[visible.indexOf(dragging) + 1];
      const column = boardCards.filter((c) => c.status === zone.dataset.status && c.id !== id);
      const position = next ? column.findIndex((c) => c.id === next.dataset.id) : column.length;
      await api("PUT", `/api/cards/${id}`, {
        date: currentDate,
        status: zone.dataset.status,
        position,
      });
      await loadBoard();
    });
  });
}

// --- Manual card add / edit --------------------------------------------------

let editingCardId = null;

function openCardEditor(card) {
  editingCardId = card ? card.id : null;
  $("#card-modal-title").textContent = card ? "Edit card" : "New card";
  $("#card-title").value = card ? card.title : "";
  $("#card-description").value = card ? card.description : "";
  $("#card-category").value = card ? card.category || "" : "";
  $("#card-priority").value = card ? card.priority : "medium";
  $("#card-modal").dataset.status = card ? card.status : $("#card-modal").dataset.status || "todo";
  $("#card-modal").hidden = false;
  $("#card-title").focus();
}

async function saveCardFromEditor() {
  const payload = {
    date: currentDate,
    title: $("#card-title").value.trim(),
    description: $("#card-description").value.trim(),
    category: $("#card-category").value.trim(),
    priority: $("#card-priority").value,
  };
  if (!payload.title) {
    $("#card-title").focus();
    return;
  }
  if (editingCardId) {
    await api("PUT", `/api/cards/${editingCardId}`, payload);
  } else {
    payload.status = $("#card-modal").dataset.status || "todo";
    await api("POST", "/api/cards", payload);
  }
  $("#card-modal").hidden = true;
  await loadBoard();
}

async function removeCard(id) {
  if (!confirm("Delete this card?")) return;
  await api("DELETE", `/api/cards/${id}?date=${currentDate}`);
  await loadBoard();
}

// --- AI generation -----------------------------------------------------------

function setStatus(message, kind) {
  const el = $("#ai-status");
  if (!message) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.className = `status ${kind || ""}`;
}

async function generate() {
  const text = $("#plan-input").value.trim();
  if (!text) return;
  const btn = $("#generate-btn");
  btn.disabled = true;
  setStatus("AI is generating cards… (a few seconds)", "loading");
  try {
    const { cards } = await api("POST", "/api/generate", { text });
    if (!cards.length) {
      setStatus("AI couldn't generate any cards. Try describing your plan more clearly.", "error");
      return;
    }
    if ($("#preview-toggle").checked) {
      openPreview(cards);
      setStatus("", "");
    } else {
      await api("POST", "/api/cards/bulk", { date: currentDate, cards });
      $("#plan-input").value = "";
      setStatus(`${cards.length} card(s) added.`, "");
      await loadBoard();
    }
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// --- Preview modal for AI suggestions ---------------------------------------

function openPreview(cards) {
  const list = $("#preview-list");
  list.innerHTML = "";
  cards.forEach((card) => list.appendChild(renderPreviewItem(card)));
  $("#preview-modal").hidden = false;
}

function renderPreviewItem(card) {
  const item = document.createElement("div");
  item.className = "preview-item";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = card.title;
  titleInput.dataset.field = "title";

  const descInput = document.createElement("textarea");
  descInput.rows = 2;
  descInput.value = card.description;
  descInput.dataset.field = "description";

  const footer = document.createElement("div");
  footer.className = "preview-item-footer";

  const categoryInput = document.createElement("input");
  categoryInput.type = "text";
  categoryInput.value = card.category || "";
  categoryInput.placeholder = "Category";
  categoryInput.dataset.field = "category";

  const prioritySelect = document.createElement("select");
  prioritySelect.dataset.field = "priority";
  for (const [value, label] of Object.entries(PRIORITY_LABELS)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === card.priority) opt.selected = true;
    prioritySelect.appendChild(opt);
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "preview-remove";
  removeBtn.textContent = "Kaldır";
  removeBtn.addEventListener("click", () => item.remove());

  footer.append(categoryInput, prioritySelect, removeBtn);
  item.append(titleInput, descInput, footer);
  return item;
}

// Read the (possibly edited) cards back out of the preview DOM.
function collectPreviewCards() {
  return Array.from($("#preview-list").children)
    .map((item) => ({
      title: item.querySelector('[data-field="title"]').value.trim(),
      description: item.querySelector('[data-field="description"]').value.trim(),
      category: item.querySelector('[data-field="category"]').value.trim(),
      priority: item.querySelector('[data-field="priority"]').value,
    }))
    .filter((c) => c.title);
}

async function confirmPreview() {
  const cards = collectPreviewCards();
  $("#preview-modal").hidden = true;
  if (!cards.length) return;
  await api("POST", "/api/cards/bulk", { date: currentDate, cards });
  $("#plan-input").value = "";
  setStatus(`${cards.length} card(s) added.`, "");
  await loadBoard();
}

// --- History (dated plans) ---------------------------------------------------

async function loadHistory() {
  const { dates } = await api("GET", "/api/dates");
  const select = $("#history-select");
  select.innerHTML = '<option value="">Past days…</option>';
  for (const date of dates) {
    const opt = document.createElement("option");
    opt.value = date;
    opt.textContent = date;
    select.appendChild(opt);
  }
}

// --- Theme (light / dark) ----------------------------------------------------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $("#theme-toggle");
  btn.textContent = theme === "dark" ? "☀️" : "🌙";
  btn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function initTheme() {
  // The inline script in <head> already set the theme; mirror it on the button.
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  $("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });
}

// --- Wiring ------------------------------------------------------------------

function init() {
  $("#date-picker").value = currentDate;
  initTheme();

  $("#date-picker").addEventListener("change", async (e) => {
    currentDate = e.target.value || todayStr();
    await loadBoard();
  });

  $("#history-select").addEventListener("change", async (e) => {
    if (!e.target.value) return;
    currentDate = e.target.value;
    $("#date-picker").value = currentDate;
    await loadBoard();
  });

  $("#category-filter").addEventListener("change", (e) => {
    categoryFilter = e.target.value;
    renderBoard(boardCards);
  });

  $("#generate-btn").addEventListener("click", generate);

  // Enter generates cards right away; Shift+Enter inserts a newline.
  $("#plan-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!$("#generate-btn").disabled) generate();
    }
  });

  document.querySelectorAll(".add-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#card-modal").dataset.status = btn.dataset.status;
      openCardEditor(null);
    });
  });

  $("#card-save").addEventListener("click", saveCardFromEditor);
  $("#card-cancel").addEventListener("click", () => ($("#card-modal").hidden = true));
  $("#preview-confirm").addEventListener("click", confirmPreview);
  $("#preview-cancel").addEventListener("click", () => ($("#preview-modal").hidden = true));

  wireDragAndDrop();
  loadBoard();
  loadHistory();
}

init();
