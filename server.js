#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
loadEnv(path.join(ROOT, ".env"));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const ANTHROPIC_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || 24000);
const ASSIGNMENT_BATCH_SIZE = Number(process.env.ASSIGNMENT_BATCH_SIZE || 25);
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    let value = rest.join("=").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendNdjson(res, data) {
  res.write(`${JSON.stringify(data)}\n`);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".md": "text/markdown; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request is too large. Reduce peak-list size or split the assignment."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function compactPayload(payload) {
  const experiments = {};
  for (const [key, exp] of Object.entries(payload.experiments || {})) {
    experiments[key] = {
      title: exp.title,
      mapping: exp.mapping,
      normalized_rows: exp.normalized_rows || [],
      row_count: (exp.normalized_rows || []).length
    };
  }
  return {
    sequence: payload.sequence || [],
    experiments
  };
}

function buildPrompt(payload) {
  const skillPath = path.join(ROOT, "skill.md");
  const skill = fs.existsSync(skillPath)
    ? fs.readFileSync(skillPath, "utf8")
    : "Assign protein NMR peak lists conservatively.";
  const data = compactPayload(payload);
  return [
    "You are assigning protein NMR peak lists for a local app.",
    "Use the NMR assignment skill below. Be conservative: leave fields blank or use low confidence when evidence is weak or contradictory.",
    "",
    "Return ONLY valid JSON with this shape:",
    "{",
    '  "assignments": [',
    "    {",
    '      "experiment_key": "HSQC",',
    '      "peak_id": "original peak id",',
    '      "assigned_label": "E31N-HN or E31N-CA-HN",',
    '      "assigned_anchor_residue": "E31",',
    '      "assigned_source_residue": "E31",',
    '      "assigned_source_atoms": "N,HN or N,CA,HN",',
    '      "assigned_relation": "intra or sequential_i_minus_1 or ambiguous",',
    '      "confidence": "high or medium or low or ambiguous",',
    '      "notes": "0-5 words"',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Include one output object for every normalized input peak row from every experiment.",
    "- Keep every peak_id exactly as provided.",
    "- For 1H-15N HSQC use labels such as E31N-HN.",
    "- For HNCACB/HNCA/CBCA(CO)NH/HN(CO)CACB use labels such as E31N-CA-HN or E31N-CB-HN.",
    "- Proline has no normal backbone amide peak.",
    "- First residue is often absent from HSQC.",
    "- If a peak cannot be assigned confidently, keep residue fields blank and confidence low or ambiguous.",
    "- Do not include markdown, code fences, comments, prose, or explanations outside the JSON object.",
    "- Output compact JSON. Do not pretty-print. Do not add whitespace unless required by JSON syntax.",
    "- Keep notes empty unless there is a critical warning. If used, notes must be 0-5 words.",
    "- Prefer empty strings over explanatory text for uncertain fields.",
    `- This request may be one batch from a larger job. Assign only the rows present in INPUT_DATA_JSON for this request.`,
    "",
    "SKILL.md:",
    skill,
    "",
    "INPUT_DATA_JSON:",
    JSON.stringify(data)
  ].join("\n");
}

function parseModelJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Model returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    const objectText = extractBalancedJsonObject(trimmed);
    if (objectText) return JSON.parse(objectText);
    throw new Error(`Model did not return JSON. Response started with: ${trimmed.slice(0, 220)}`);
  }
}

function extractBalancedJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return "";
}

async function callAnthropic(payload) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "user", content: buildPrompt(payload) }
      ]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `Anthropic API returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  const text = (data.content || [])
    .filter(part => part.type === "text")
    .map(part => part.text)
    .join("\n");
  if (data.stop_reason === "max_tokens") {
    throw new Error(`Model output hit the ${ANTHROPIC_MAX_TOKENS} token limit before completing JSON. Try fewer peak-list rows or raise ANTHROPIC_MAX_TOKENS in .env.`);
  }
  const parsed = parseModelJson(text);
  return {
    engine: `anthropic:${ANTHROPIC_MODEL}`,
    usage: data.usage || {},
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : []
  };
}

async function callAnthropicStream(payload, onEvent) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      temperature: 0,
      stream: true,
      messages: [
        { role: "user", content: buildPrompt(payload) }
      ]
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data.error?.message || `Anthropic API returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = {};
  let stopReason = "";

  function mergeUsage(next) {
    if (!next) return;
    usage = { ...usage, ...next };
    onEvent({ type: "usage", usage });
  }

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || "";
    for (const eventText of events) {
      const dataLine = eventText.split(/\n/).find(line => line.startsWith("data: "));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(6));
      if (event.type === "message_start") {
        mergeUsage(event.message?.usage);
      } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text || "";
      } else if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason || stopReason;
        mergeUsage(event.usage);
      } else if (event.type === "error") {
        throw new Error(event.error?.message || "Anthropic stream returned an error.");
      }
    }
  }

  if (buffer.trim()) {
    for (const eventText of buffer.split(/\n\n/)) {
      const dataLine = eventText.split(/\n/).find(line => line.startsWith("data: "));
      if (!dataLine) continue;
      const event = JSON.parse(dataLine.slice(6));
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        text += event.delta.text || "";
      } else if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason || stopReason;
        mergeUsage(event.usage);
      }
    }
  }

  if (stopReason === "max_tokens") {
    throw new Error(`Model output hit the ${ANTHROPIC_MAX_TOKENS} token limit before completing JSON. Try fewer peak-list rows or raise ANTHROPIC_MAX_TOKENS in .env.`);
  }
  const parsed = parseModelJson(text);
  return {
    engine: `anthropic:${ANTHROPIC_MODEL}`,
    usage,
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : []
  };
}

function buildAssignmentBatches(payload) {
  const batches = [];
  for (const [key, exp] of Object.entries(payload.experiments || {})) {
    const rows = exp.normalized_rows || [];
    if (!rows.length) continue;
    for (let start = 0; start < rows.length; start += ASSIGNMENT_BATCH_SIZE) {
      batches.push({
        sequence: payload.sequence || [],
        experiments: {
          [key]: {
            title: exp.title,
            mapping: exp.mapping,
            normalized_rows: rows.slice(start, start + ASSIGNMENT_BATCH_SIZE)
          }
        },
        batch: {
          experiment_key: key,
          start_row: start + 1,
          end_row: Math.min(start + ASSIGNMENT_BATCH_SIZE, rows.length),
          row_count: rows.length
        }
      });
    }
  }
  return batches;
}

function addUsage(total, next) {
  for (const [key, value] of Object.entries(next || {})) {
    if (typeof value === "number") total[key] = (total[key] || 0) + value;
  }
  return total;
}

async function callAnthropicBatchedStream(payload, onEvent) {
  const batches = buildAssignmentBatches(payload);
  if (!batches.length) {
    return { engine: `anthropic:${ANTHROPIC_MODEL}`, usage: {}, assignments: [] };
  }
  const usage = {};
  const assignments = [];
  for (let index = 0; index < batches.length; index += 1) {
    onEvent({ type: "progress", batch_index: index + 1, batch_count: batches.length, batch: batches[index].batch });
    let previousUsage = {};
    const result = await callAnthropicStream(batches[index], event => {
      if (event.type !== "usage") {
        onEvent(event);
        return;
      }
      const delta = {};
      for (const [key, value] of Object.entries(event.usage || {})) {
        if (typeof value === "number") delta[key] = value - (previousUsage[key] || 0);
      }
      previousUsage = event.usage || {};
      addUsage(usage, delta);
      onEvent({ type: "usage", usage });
    });
    assignments.push(...result.assignments);
    onEvent({ type: "progress", batch_index: index + 1, batch_count: batches.length, completed: true, batch: batches[index].batch });
  }
  return {
    engine: `anthropic:${ANTHROPIC_MODEL}`,
    usage,
    assignments
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        provider: "anthropic",
        model: ANTHROPIC_MODEL,
        has_api_key: Boolean(ANTHROPIC_API_KEY)
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/assign") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store"
      });
      try {
        const result = await callAnthropicBatchedStream(payload, event => sendNdjson(res, event));
        sendNdjson(res, { type: "result", ...result });
      } catch (error) {
        sendNdjson(res, { type: "error", error: error.message || String(error) });
      } finally {
        res.end();
      }
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`NMR assignment app: http://localhost:${PORT}`);
  console.log(`Anthropic model: ${ANTHROPIC_MODEL}`);
  console.log(ANTHROPIC_API_KEY ? "API key: loaded from environment" : "API key: missing");
});
