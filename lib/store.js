// Persistence layer: one JSON file per day under data/YYYY-MM-DD.json.
// Human-readable, easy to back up, and a day's history is just a file listing.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

const STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["high", "medium", "low"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Create the data directory on demand so the repo can ship without it.
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Local-time YYYY-MM-DD (the user's "today", not UTC).
export function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidDate(date) {
  return typeof date === "string" && DATE_RE.test(date);
}

function filePath(date) {
  return path.join(DATA_DIR, `${date}.json`);
}

// Read a day's board, returning an empty board when the file does not exist.
export function readBoard(date) {
  const file = filePath(date);
  if (!fs.existsSync(file)) return { date, cards: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { date, cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
  } catch {
    // Corrupt file: fail soft with an empty board rather than crashing.
    return { date, cards: [] };
  }
}

function writeBoard(board) {
  ensureDataDir();
  fs.writeFileSync(filePath(board.date), JSON.stringify(board, null, 2));
}

// Dates that have a saved plan, newest first.
export function listDates() {
  ensureDataDir();
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .filter(isValidDate)
    .sort()
    .reverse();
}

// Case-insensitive category key: "Oyun" and "oyun" are the same category.
// Turkish locale so dotted/dotless i lowercase correctly.
const catKey = (s) => s.toLocaleLowerCase("tr");

// Resolve a raw category against the board: if a card already uses the same
// category in any casing, reuse that casing so one category never splits into
// casing variants. `excludeId` lets an edited card recase its own category
// when no other card shares it.
function canonicalCategory(board, raw, excludeId) {
  const value = String(raw || "").trim().slice(0, 40);
  if (!value) return "";
  const match = board.cards.find(
    (c) => c.category && c.id !== excludeId && catKey(c.category) === catKey(value)
  );
  return match ? match.category : value;
}

// Normalize an arbitrary card-like object into a complete, valid card.
function normalizeCard(input) {
  const status = STATUSES.includes(input.status) ? input.status : "todo";
  const priority = PRIORITIES.includes(input.priority) ? input.priority : "medium";
  return {
    id: randomUUID(),
    title: String(input.title || "").trim() || "Untitled",
    description: String(input.description || "").trim(),
    category: String(input.category || "").trim().slice(0, 40),
    priority,
    status,
    source: input.source === "ai" ? "ai" : "manual",
    carryCount: 0, // how many times this card has rolled over to a new day
    createdAt: new Date().toISOString(),
  };
}

// Open a day's board. For TODAY only, if it has no file yet, seed it by
// carrying over the unfinished cards from the most recent previous day (a
// move, not a copy). Browsing any other date never mutates anything.
export function openDay(date) {
  if (fs.existsSync(filePath(date))) return readBoard(date);
  if (date !== todayStr()) return { date, cards: [] };

  const prevDate = listDates().find((d) => d < date);
  if (!prevDate) return { date, cards: [] };

  const prev = readBoard(prevDate);
  const carried = prev.cards.filter((c) => c.status !== "done");
  if (carried.length === 0) return { date, cards: [] };

  // Bump the carry counter and detach the cards from the previous day.
  for (const card of carried) card.carryCount = (card.carryCount || 0) + 1;
  prev.cards = prev.cards.filter((c) => c.status === "done");
  if (prev.cards.length === 0) {
    fs.unlinkSync(filePath(prevDate)); // keep history free of empty days
  } else {
    writeBoard(prev);
  }

  const today = { date, cards: carried };
  writeBoard(today);
  return today;
}

export function addCards(date, cards, source) {
  const board = readBoard(date);
  const created = [];
  // Push one at a time so cards within the same batch also share a casing.
  for (const c of cards) {
    const card = normalizeCard({ ...c, source: source || c.source });
    card.category = canonicalCategory(board, card.category);
    board.cards.push(card);
    created.push(card);
  }
  writeBoard(board);
  return created;
}

export function addCard(date, card) {
  return addCards(date, [card], card.source)[0];
}

// Apply an allow-listed patch to a single card and persist.
export function updateCard(date, id, patch) {
  const board = readBoard(date);
  const card = board.cards.find((c) => c.id === id);
  if (!card) return null;

  if (typeof patch.title === "string") card.title = patch.title.trim();
  if (typeof patch.description === "string") card.description = patch.description.trim();
  if (typeof patch.category === "string")
    card.category = canonicalCategory(board, patch.category, card.id);
  if (PRIORITIES.includes(patch.priority)) card.priority = patch.priority;
  if (STATUSES.includes(patch.status)) card.status = patch.status;

  // Optional reorder: place the card at `position` within its (new) column.
  // Column order is the card's relative order inside board.cards.
  if (Number.isInteger(patch.position) && patch.position >= 0) {
    board.cards = board.cards.filter((c) => c.id !== id);
    const sameStatus = board.cards.filter((c) => c.status === card.status);
    const anchor = sameStatus[patch.position];
    const insertAt = anchor ? board.cards.indexOf(anchor) : board.cards.length;
    board.cards.splice(insertAt, 0, card);
  }

  writeBoard(board);
  return card;
}

export function deleteCard(date, id) {
  const board = readBoard(date);
  const before = board.cards.length;
  board.cards = board.cards.filter((c) => c.id !== id);
  if (board.cards.length === before) return false;
  writeBoard(board);
  return true;
}
