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

// Normalize an arbitrary card-like object into a complete, valid card.
function normalizeCard(input) {
  const status = STATUSES.includes(input.status) ? input.status : "todo";
  const priority = PRIORITIES.includes(input.priority) ? input.priority : "medium";
  return {
    id: randomUUID(),
    title: String(input.title || "").trim() || "Untitled",
    description: String(input.description || "").trim(),
    priority,
    status,
    source: input.source === "ai" ? "ai" : "manual",
    createdAt: new Date().toISOString(),
  };
}

export function addCards(date, cards, source) {
  const board = readBoard(date);
  const created = cards.map((c) => normalizeCard({ ...c, source: source || c.source }));
  board.cards.push(...created);
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
  if (PRIORITIES.includes(patch.priority)) card.priority = patch.priority;
  if (STATUSES.includes(patch.status)) card.status = patch.status;

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
