// AI bridge: turn a plain-language daily plan into kanban cards by invoking the
// local Claude Code CLI in headless print mode. This uses the user's existing
// Claude Code subscription session — no API key and no per-call API billing.

import { spawn } from "node:child_process";

// Pinned to Haiku: this is a fast, well-bounded structuring task. Change here
// if you prefer a different model.
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You convert a person's plain-language daily plan into kanban cards.
Rules:
- Output ONLY a JSON array, nothing else. No prose, no markdown fences.
- Each item: {"title": string, "description": string, "priority": "high"|"medium"|"low"}.
- Keep titles short and actionable. Write a one-sentence description.
- Infer priority from urgency/impact words (bugs, deadlines => high).
- Preserve the input language in the card text (e.g. answer in Turkish if the plan is Turkish).`;

// Remove ```json ... ``` fences a model might wrap output in, just in case.
function stripFences(text) {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function runClaude(planText) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", SYSTEM_PROMPT, "--output-format", "json", "--model", MODEL],
      { stdio: ["pipe", "pipe", "pipe"] }
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

    child.stdin.write(planText);
    child.stdin.end();
  });
}

// Returns an array of { title, description, priority } card suggestions.
export async function generateCards(planText) {
  const raw = await runClaude(planText);

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

  // Keep only the fields we trust; the store assigns id/status/createdAt.
  return cards
    .filter((c) => c && (c.title || c.description))
    .map((c) => ({
      title: String(c.title || "").trim(),
      description: String(c.description || "").trim(),
      priority: ["high", "medium", "low"].includes(c.priority) ? c.priority : "medium",
    }));
}
