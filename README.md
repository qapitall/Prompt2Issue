# Prompt2Issue

A simple, local kanban board for managing your daily tasks — with an AI helper
that turns a plain-language plan into ready-to-use cards.

Write something like _"today I want to finish the API docs and fix the login
bug"_, and Prompt2Issue creates kanban cards for it. You can also add and edit
cards by hand. Each day's plan is saved so you can look back.

> The UI is in Turkish, but it works with plans written in any language.

## How it works

The AI feature runs through the **Claude Code CLI** in headless mode
(`claude -p`) using **your existing Claude Code subscription session** on your
machine. That means:

- **No API key and no per-call API billing** — it uses the subscription you're
  already logged into.
- **Everything stays local.** The app runs on `localhost`, and your plans are
  stored as plain JSON files on your own disk. Nothing is sent to any server
  other than the Claude request the CLI already makes.

Because it relies on your local, logged-in Claude Code session, Prompt2Issue is
designed to run **on your own machine**, not as a public website.

## Prerequisites

- **Node.js 18+**
- **[Claude Code](https://claude.com/claude-code) installed and logged in.**
  Verify with:

  ```bash
  claude --version   # should print a version
  claude -p "say hi" # should respond (confirms you are logged in)
  ```

No npm dependencies are required.

## Install & run

```bash
git clone <your-repo-url> prompt2issue
cd prompt2issue
node server.js
```

Then open <http://localhost:5173>.

To use a different port: `PORT=8080 node server.js`.

## Usage

- **Add a card by hand:** click the `+` in any column.
- **Generate cards with AI:** type your plan in the top box and click
  **"Kartları üret"** (Generate cards).
  - With **"Eklemeden önce önizle"** (preview before adding) checked — the
    default — you get a preview where you can edit, remove, then confirm the
    suggested cards.
  - Uncheck it to add the generated cards straight to the board.
- **Move cards:** drag them between the **Yapılacak / Yapılıyor / Bitti**
  (To do / In progress / Done) columns.
- **History:** pick a date or use the "Geçmiş günler…" (past days) dropdown to
  revisit a previous day's plan.

## Data & privacy

Each day is saved to `data/YYYY-MM-DD.json` in the project folder — readable
JSON you can back up or edit. The `data/` directory is git-ignored, so your
personal plans are never committed.

## Tech

Zero-dependency Node.js: the built-in `http`, `fs`, and `child_process` modules
serve a static vanilla-JS frontend and a small JSON API. No build step.

## License

[MIT](LICENSE)
