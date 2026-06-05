#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
loadEnv(path.join(ROOT, ".env"));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
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
      normalized_rows: (exp.normalized_rows || []).slice(0, 800),
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
    '      "notes": "brief evidence summary"',
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
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return JSON.parse(match[0]);
  }
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
      max_tokens: 12000,
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
  const parsed = parseModelJson(text);
  return {
    engine: `anthropic:${ANTHROPIC_MODEL}`,
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : []
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
      const result = await callAnthropic(payload);
      sendJson(res, 200, result);
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
