// Frontend logic for Prompt2Issue. Vanilla JS, no build step.
// UI strings are Turkish (user preference); code and comments are English.

const STATUS_LABELS = { todo: "To Do", doing: "In Progress", done: "Done" };
const PRIORITY_LABELS = { high: "High", medium: "Medium", low: "Low" };

// Current board date in YYYY-MM-DD (local). Defaults to today.
let currentDate = todayStr();

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
  renderBoard(data.cards || []);
}

function renderBoard(cards) {
  for (const status of Object.keys(STATUS_LABELS)) {
    const container = document.querySelector(`.cards[data-status="${status}"]`);
    container.innerHTML = "";
    const inColumn = cards.filter((c) => c.status === status);
    if (inColumn.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "—";
      container.appendChild(hint);
    }
    for (const card of inColumn) container.appendChild(renderCard(card));
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
  actions.append(editBtn, delBtn);
  footer.appendChild(actions);

  el.appendChild(footer);

  el.addEventListener("dragstart", () => {
    el.classList.add("dragging");
    window.__draggingId = card.id;
  });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));

  return el;
}

// --- Drag & drop between columns --------------------------------------------

function wireDragAndDrop() {
  document.querySelectorAll(".cards").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const id = window.__draggingId;
      const newStatus = zone.dataset.status;
      if (!id) return;
      await api("PUT", `/api/cards/${id}`, { date: currentDate, status: newStatus });
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

  footer.append(prioritySelect, removeBtn);
  item.append(titleInput, descInput, footer);
  return item;
}

// Read the (possibly edited) cards back out of the preview DOM.
function collectPreviewCards() {
  return Array.from($("#preview-list").children)
    .map((item) => ({
      title: item.querySelector('[data-field="title"]').value.trim(),
      description: item.querySelector('[data-field="description"]').value.trim(),
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

  $("#generate-btn").addEventListener("click", generate);

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
