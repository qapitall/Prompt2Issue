// AI bridge: turn a plain-language daily plan into kanban cards by invoking the
// local Claude Code CLI in headless print mode. This uses the user's existing
// Claude Code subscription session — no API key and no per-call API billing.

import { spawn } from "node:child_process";
import os from "node:os";

// Pinned to Haiku: this is a fast, well-bounded structuring task. Change here
// if you prefer a different model.
const MODEL = "claude-haiku-4-5-20251001";

const GENERATE_PROMPT = `You convert a person's plain-language daily plan into kanban cards.
Rules:
- Output ONLY a JSON array, nothing else. No prose, no markdown fences.
- Each item: {"title": string, "description": string, "priority": "high"|"medium"|"low", "category": string}.
- Keep titles short and actionable. Write a one-sentence description.
- Infer priority from urgency/impact words (bugs, deadlines => high).
- category: a single short lowercase word grouping the task (e.g. "work", "bug", "meeting", "personal", "chore"). Reuse the same category for similar tasks.
- Preserve the input language in the card text (e.g. answer in Turkish if the plan is Turkish).`;

const BREAKDOWN_PROMPT = `You split one kanban card (a task) into smaller subtask cards.
Rules:
- Output ONLY a JSON array, nothing else. No prose, no markdown fences.
- 2 to 4 items. Each item: {"title": string, "description": string, "priority": "high"|"medium"|"low"}.
- Together the subtasks should cover the whole original task; each one is a single concrete step.
- Keep titles short and actionable. Write a one-sentence description.
- Preserve the input language in the card text (e.g. answer in Turkish if the card is Turkish).`;

// Remove ```json ... ``` fences a model might wrap output in, just in case.
function stripFences(text) {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function runClaude(systemPrompt, inputText) {
  return new Promise((resolve, reject) => {
    // Run as a pure text transformer: the instructions go in as the system
    // prompt, the plan text as the (stdin) prompt, and all tools are disabled
    // so the CLI cannot act on the project. cwd is a neutral directory so no
    // project context (CLAUDE.md, permissions) leaks into the call.
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format", "json",
        "--model", MODEL,
        "--system-prompt", systemPrompt,
        "--tools", "",
      ],
      { stdio: ["pipe", "pipe", "pipe"], cwd: os.tmpdir() }
    );

    let stdout = "";
    let stderr = "";

    child.on("error", (err) => {
      // Most commonly ENOENT: the `claude` binary is not on PATH.
      reject(
        new Error(
          `Could not run the "claude" CLI (${err.code || err.message}). ` +
            `Make sure Claude Code is installed and you are logged in.`
        )
      );
    });

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim() || "unknown error"}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(inputText);
    child.stdin.end();
  });
}

// Run the CLI and parse the model's answer into a raw array of card objects.
async function requestCards(systemPrompt, inputText) {
  const raw = await runClaude(systemPrompt, inputText);

  // The CLI wraps everything in an envelope; the model's answer is in `result`.
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("Could not parse the Claude CLI response envelope.");
  }
  if (envelope.is_error) {
    throw new Error(`Claude reported an error: ${envelope.result || "unknown"}`);
  }

  let cards;
  try {
    cards = JSON.parse(stripFences(String(envelope.result ?? "")));
  } catch {
    throw new Error("Claude did not return valid JSON cards. Try rephrasing your plan.");
  }
  if (!Array.isArray(cards)) {
    throw new Error("Expected a JSON array of cards from Claude.");
  }
  return cards;
}

// Returns an array of { title, description, category, priority } card
// suggestions. A non-empty `category` overrides whatever the model suggested,
// so a user-chosen category is applied deterministically.
export async function generateCards(planText, category = "") {
  const cards = await requestCards(GENERATE_PROMPT, planText);

  // Keep only the fields we trust; the store assigns id/status/createdAt.
  return cards
    .filter((c) => c && (c.title || c.description))
    .map((c) => ({
      title: String(c.title || "").trim(),
      description: String(c.description || "").trim(),
      category: category || String(c.category || "").trim(),
      priority: ["high", "medium", "low"].includes(c.priority) ? c.priority : "medium",
    }));
}

// Returns 2-4 subtask suggestions for a single card. The parent's category is
// applied to every subtask so they stay grouped with the original.
export async function breakdownCard(title, description = "", category = "") {
  const input = description ? `${title}\n\n${description}` : title;
  const cards = await requestCards(BREAKDOWN_PROMPT, input);

  return cards
    .filter((c) => c && (c.title || c.description))
    .slice(0, 4)
    .map((c) => ({
      title: String(c.title || "").trim(),
      description: String(c.description || "").trim(),
      category,
      priority: ["high", "medium", "low"].includes(c.priority) ? c.priority : "medium",
    }));
}
