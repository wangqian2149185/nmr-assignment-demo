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
const AMBIGUOUS_REFINE_LIMIT = Number(process.env.AMBIGUOUS_REFINE_LIMIT || 40);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const LOOSE_TOL = { H: 0.2, C: 0.5, N: 0.8 };
const CONFIRM_TOL = { H: 0.04, C: 0.25, N: 0.3 };
const TOL = LOOSE_TOL;
const CA_CB = {
  A: { CA: 52.5, CB: 19.0 }, R: { CA: 56.1, CB: 30.8 }, N: { CA: 53.2, CB: 38.9 },
  D: { CA: 54.6, CB: 40.8 }, C: { CA: 58.3, CB: 28.2 }, Q: { CA: 55.8, CB: 29.2 },
  E: { CA: 56.4, CB: 30.0 }, G: { CA: 45.1, CB: null }, H: { CA: 55.2, CB: 29.9 },
  I: { CA: 61.4, CB: 38.6 }, L: { CA: 55.2, CB: 42.1 }, K: { CA: 56.3, CB: 32.9 },
  M: { CA: 55.3, CB: 32.6 }, F: { CA: 58.0, CB: 39.5 }, P: { CA: 63.1, CB: 31.7 },
  S: { CA: 58.2, CB: 63.8 }, T: { CA: 62.1, CB: 69.8 }, W: { CA: 57.5, CB: 29.4 },
  Y: { CA: 58.1, CB: 38.6 }, V: { CA: 62.3, CB: 32.6 }
};

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
    "- Use two-stage tolerances: loose candidate search H=0.20 ppm, C=0.50 ppm, N=0.80 ppm; confirmation H=0.04 ppm, C=0.25 ppm, N=0.30 ppm.",
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

function buildResidueMapPrompt(payload) {
  const skillPath = path.join(ROOT, "skill.md");
  const skill = fs.existsSync(skillPath)
    ? fs.readFileSync(skillPath, "utf8")
    : "Assign protein NMR peak lists conservatively.";
  const data = compactPayload(payload);
  return [
    "You are assigning protein NMR backbone peak lists.",
    "Do NOT output one row per peak. First build a compact residue_assignment_map.",
    "Use HSQC anchors together with HNCACB and HN(CO)CACB/CBCA(CO)NH sequential carbon evidence.",
    "The app will programmatically fill all peak lists from your compact map.",
    "",
    "Return ONLY compact JSON with this shape:",
    "{",
    '  "residue_assignment_map": [',
    "    {",
    '      "anchor_residue": "E31",',
    '      "hsqc_peak_id": "peak id or empty",',
    '      "HN": 8.786,',
    '      "N": 121.04,',
    '      "CA_i": 56.04,',
    '      "CB_i": 30.2,',
    '      "previous_residue": "D30",',
    '      "CA_i_minus_1": 54.8,',
    '      "CB_i_minus_1": 42.1,',
    '      "confidence": "high|medium|low|ambiguous",',
    '      "notes": "0-8 words"',
    "    }",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Map each confident HSQC amide anchor to at most one sequence residue.",
    "- If anchor_mode is custom, honor seed_anchors first and walk sequentially from those seeds.",
    "- If anchor_mode is auto, use residue-type CA/CB patterns, Gly no CB, Ser/Thr high CB, Ala low CB, Pro gaps, and sequence pattern matching.",
    "- Use two-stage tolerances: loose candidate search H=0.20 ppm, C=0.50 ppm, N=0.80 ppm; confirmation H=0.04 ppm, C=0.25 ppm, N=0.30 ppm.",
    "- HNCACB contains intra-residue and possible i-1 CA/CB for the same amide anchor.",
    "- HN(CO)CACB/CBCA(CO)NH contains i-1 CA/CB for the same amide anchor.",
    "- Leave uncertain anchors out of the map or mark confidence low/ambiguous.",
    "- Keep JSON compact. No markdown. No prose outside JSON.",
    "",
    "SKILL.md:",
    skill,
    "",
    "INPUT_DATA_JSON:",
    JSON.stringify(data)
  ].join("\n");
}

function buildAmbiguousRefinePrompt(payload, residueMap, ambiguous) {
  const data = {
    anchor_mode: payload.anchor_mode || "auto",
    seed_anchors: payload.seed_anchors || [],
    sequence: payload.sequence || [],
    residue_assignment_map: residueMap,
    ambiguous_rows: ambiguous.slice(0, AMBIGUOUS_REFINE_LIMIT)
  };
  return [
    "Refine only these ambiguous NMR peak assignments using the residue_assignment_map.",
    "Return ONLY compact JSON: {\"assignments\":[...]}",
    "Each assignment must keep experiment_key and peak_id exactly.",
    "Use empty strings and low confidence if still uncertain.",
    "No markdown. No prose.",
    "INPUT_JSON:",
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
  return callAnthropicPromptStream(buildPrompt(payload), onEvent);
}

async function callAnthropicPromptStream(prompt, onEvent) {
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
        { role: "user", content: prompt }
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
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    residue_assignment_map: Array.isArray(parsed.residue_assignment_map) ? parsed.residue_assignment_map : []
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

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function near(a, b, tol) {
  return a !== null && b !== null && Math.abs(a - b) <= tol;
}

function previousResidue(sequence, label) {
  const idx = sequence.findIndex(row => row.residue_label === label);
  return idx > 0 ? sequence[idx - 1] : null;
}

function normalizeMapEntry(entry) {
  return {
    anchor_residue: String(entry.anchor_residue || entry.residue || "").trim().toUpperCase(),
    hsqc_peak_id: String(entry.hsqc_peak_id || "").trim(),
    HN: toNum(entry.HN),
    N: toNum(entry.N),
    CA_i: toNum(entry.CA_i),
    CB_i: toNum(entry.CB_i),
    previous_residue: String(entry.previous_residue || "").trim().toUpperCase(),
    CA_i_minus_1: toNum(entry.CA_i_minus_1),
    CB_i_minus_1: toNum(entry.CB_i_minus_1),
    confidence: entry.confidence || "medium",
    notes: entry.notes || ""
  };
}

function findMapForRow(row, residueMap) {
  return residueMap.find(item => item.hsqc_peak_id && item.hsqc_peak_id === row.peak_id)
    || residueMap.find(item => near(item.HN, toNum(row.HN), TOL.H) && near(item.N, toNum(row.N), TOL.N))
    || null;
}

function closestAtom(c, pairs) {
  if (c === null) return { atom: "", distance: Infinity };
  let best = { atom: "", distance: Infinity };
  for (const [atom, value] of pairs) {
    if (value === null || value === undefined) continue;
    const distance = Math.abs(c - value);
    if (distance < best.distance) best = { atom, distance };
  }
  return best;
}

function assignmentForRow(experimentKey, row, mapEntry, sequence) {
  const c = toNum(row.C);
  const anchor = mapEntry?.anchor_residue || "";
  if (!anchor) return blankAssignment(experimentKey, row, "no anchor");
  const anchorConfirmed = near(mapEntry.HN, toNum(row.HN), CONFIRM_TOL.H) && near(mapEntry.N, toNum(row.N), CONFIRM_TOL.N);
  let source = anchor;
  let relation = "intra";
  let atom = "";
  let atomDistance = 0;
  if (experimentKey === "HSQC") {
    atom = "N";
  } else if (["CBCACONH", "HNCOCA"].includes(experimentKey)) {
    source = mapEntry.previous_residue || previousResidue(sequence, anchor)?.residue_label || "";
    relation = source ? "sequential_i_minus_1" : "";
    const best = closestAtom(c, [["CA", mapEntry.CA_i_minus_1], ["CB", mapEntry.CB_i_minus_1]]);
    atom = best.atom || "Cx";
    atomDistance = best.distance;
  } else if (experimentKey === "HNCO") {
    source = mapEntry.previous_residue || previousResidue(sequence, anchor)?.residue_label || "";
    relation = source ? "sequential_i_minus_1" : "";
    atom = "CO";
  } else if (experimentKey === "HNCACB" || experimentKey === "HNCA") {
    const intra = closestAtom(c, [["CA", mapEntry.CA_i], ["CB", mapEntry.CB_i]]);
    const prev = closestAtom(c, [["CA", mapEntry.CA_i_minus_1], ["CB", mapEntry.CB_i_minus_1]]);
    if (prev.distance + 0.15 < intra.distance) {
      source = mapEntry.previous_residue || previousResidue(sequence, anchor)?.residue_label || "";
      relation = source ? "sequential_i_minus_1" : "";
      atom = prev.atom || "Cx";
      atomDistance = prev.distance;
    } else {
      atom = intra.atom || "Cx";
      atomDistance = intra.distance;
    }
  } else {
    atom = c === null ? "Hx" : "Cx";
  }
  const atoms = experimentKey === "HSQC" ? "N,HN" : `N,${atom || "Cx"},HN`;
  const assignedLabel = experimentKey === "HSQC" ? `${anchor}N-HN` : `${anchor}N-${atom || "Cx"}-HN`;
  const carbonConfirmed = experimentKey === "HSQC" || experimentKey === "HNCO" || atomDistance <= CONFIRM_TOL.C;
  const low = !source || ["low", "ambiguous"].includes(String(mapEntry.confidence || "").toLowerCase());
  const confidence = low ? (mapEntry.confidence || "low") : (anchorConfirmed && carbonConfirmed ? "high" : "medium");
  return {
    experiment_key: experimentKey,
    peak_id: row.peak_id,
    assigned_label: assignedLabel,
    assigned_anchor_residue: anchor,
    assigned_source_residue: source,
    assigned_source_atoms: atoms,
    assigned_relation: relation,
    confidence,
    notes: mapEntry.notes || "map",
    HN: toNum(row.HN),
    N: toNum(row.N),
    C: toNum(row.C)
  };
}

function blankAssignment(experimentKey, row, notes) {
  return {
    experiment_key: experimentKey,
    peak_id: row.peak_id,
    assigned_label: "",
    assigned_anchor_residue: "",
    assigned_source_residue: "",
    assigned_source_atoms: "",
    assigned_relation: "",
    confidence: "low",
    notes,
    HN: toNum(row.HN),
    N: toNum(row.N),
    C: toNum(row.C)
  };
}

function applyResidueMapToPeaks(payload, residueMapRaw) {
  const residueMap = (residueMapRaw || []).map(normalizeMapEntry).filter(item => item.anchor_residue);
  const assignments = [];
  for (const [experimentKey, exp] of Object.entries(payload.experiments || {})) {
    for (const row of exp.normalized_rows || []) {
      const mapEntry = findMapForRow(row, residueMap);
      assignments.push(mapEntry
        ? assignmentForRow(experimentKey, row, mapEntry, payload.sequence || [])
        : blankAssignment(experimentKey, row, "not in map"));
    }
  }
  return { residueMap, assignments };
}

function ambiguousAssignments(assignments) {
  return assignments.filter(row => !row.assigned_label || ["low", "ambiguous"].includes(String(row.confidence || "").toLowerCase()));
}

function mergeAssignments(base, refined) {
  const byKey = new Map((refined || []).map(row => [`${row.experiment_key}::${row.peak_id}`, row]));
  return base.map(row => {
    const next = byKey.get(`${row.experiment_key}::${row.peak_id}`);
    return next ? { ...row, ...next } : row;
  });
}

async function callAnthropicResidueMapWorkflowStream(payload, onEvent) {
  const usage = {};
  let previousUsage = {};
  const mapResult = await callAnthropicPromptStream(buildResidueMapPrompt(payload), event => {
    if (event.type !== "usage") return onEvent(event);
    const delta = {};
    for (const [key, value] of Object.entries(event.usage || {})) {
      if (typeof value === "number") delta[key] = value - (previousUsage[key] || 0);
    }
    previousUsage = event.usage || {};
    addUsage(usage, delta);
    onEvent({ type: "usage", usage });
  });
  let { residueMap, assignments } = applyResidueMapToPeaks(payload, mapResult.residue_assignment_map);
  onEvent({ type: "progress", stage: "map_applied", residue_count: residueMap.length, ambiguous_count: ambiguousAssignments(assignments).length });

  const ambiguous = ambiguousAssignments(assignments);
  if (ambiguous.length && AMBIGUOUS_REFINE_LIMIT > 0) {
    previousUsage = {};
    const refineResult = await callAnthropicPromptStream(buildAmbiguousRefinePrompt(payload, residueMap, ambiguous), event => {
      if (event.type !== "usage") return onEvent(event);
      const delta = {};
      for (const [key, value] of Object.entries(event.usage || {})) {
        if (typeof value === "number") delta[key] = value - (previousUsage[key] || 0);
      }
      previousUsage = event.usage || {};
      addUsage(usage, delta);
      onEvent({ type: "usage", usage });
    });
    assignments = mergeAssignments(assignments, refineResult.assignments);
  }

  return {
    engine: `anthropic:${ANTHROPIC_MODEL}:residue-map`,
    usage,
    residue_assignment_map: residueMap,
    assignments
  };
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
        const result = await callAnthropicResidueMapWorkflowStream(payload, event => sendNdjson(res, event));
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
