// Prompt2Issue — a tiny zero-dependency HTTP server.
// Serves the static frontend and a small JSON API, and bridges to the Claude
// Code CLI for AI card generation. Run with: node server.js

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateCards } from "./lib/claude.js";
import {
  addCard,
  addCards,
  deleteCard,
  isValidDate,
  listDates,
  openDay,
  todayStr,
  updateCard,
} from "./lib/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 5173;
// Bind to loopback by default so the board (and the Claude CLI it can trigger)
// is never exposed to the local network. Set HOST=0.0.0.0 to opt into LAN access.
const HOST = process.env.HOST || "127.0.0.1";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

// Collect a JSON request body (with a small size cap).
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Resolve "today" unless a valid explicit date is provided.
function resolveDate(value) {
  return isValidDate(value) ? value : todayStr();
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, rel);

  // Prevent path traversal outside the public directory.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  // GET /api/board?date=YYYY-MM-DD
  // openDay carries unfinished work forward when today is first opened.
  if (method === "GET" && pathname === "/api/board") {
    const date = resolveDate(url.searchParams.get("date"));
    return sendJson(res, 200, openDay(date));
  }

  // GET /api/dates
  if (method === "GET" && pathname === "/api/dates") {
    return sendJson(res, 200, { dates: listDates() });
  }

  // POST /api/generate { text, category? } -> suggested cards (not saved)
  // When a category is given, every generated card gets it; otherwise the AI
  // picks a category per card.
  if (method === "POST" && pathname === "/api/generate") {
    const body = await readBody(req);
    const text = String(body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "Please provide some plan text." });
    const category = String(body.category || "").trim().slice(0, 40);
    const cards = await generateCards(text, category);
    return sendJson(res, 200, { cards });
  }

  // POST /api/cards/bulk { date, cards } -> save many cards
  if (method === "POST" && pathname === "/api/cards/bulk") {
    const body = await readBody(req);
    const date = resolveDate(body.date);
    if (!Array.isArray(body.cards)) return sendJson(res, 400, { error: "cards must be an array." });
    const created = addCards(date, body.cards, "ai");
    return sendJson(res, 201, { cards: created });
  }

  // POST /api/cards { date, title, description, priority } -> save one manual card
  if (method === "POST" && pathname === "/api/cards") {
    const body = await readBody(req);
    const date = resolveDate(body.date);
    const card = addCard(date, {
      title: body.title,
      description: body.description,
      priority: body.priority,
      status: body.status,
      source: "manual",
    });
    return sendJson(res, 201, { card });
  }

  // PUT /api/cards/:id { date, ...patch }
  const matchPut = pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (method === "PUT" && matchPut) {
    const body = await readBody(req);
    const date = resolveDate(body.date);
    const card = updateCard(date, decodeURIComponent(matchPut[1]), body);
    if (!card) return sendJson(res, 404, { error: "Card not found." });
    return sendJson(res, 200, { card });
  }

  // DELETE /api/cards/:id?date=YYYY-MM-DD
  const matchDel = pathname.match(/^\/api\/cards\/([^/]+)$/);
  if (method === "DELETE" && matchDel) {
    const date = resolveDate(url.searchParams.get("date"));
    const ok = deleteCard(date, decodeURIComponent(matchDel[1]));
    if (!ok) return sendJson(res, 404, { error: "Card not found." });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: "Unknown endpoint." });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      // Surface a clean message to the UI (e.g. Claude CLI not logged in).
      sendJson(res, 500, { error: err.message || "Internal server error" });
    }
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Prompt2Issue running at http://localhost:${PORT}`);
});
