#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8765);
loadEnv(path.join(ROOT, ".env"));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";
const ANTHROPIC_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || 24000);
const AMBIGUOUS_REFINE_LIMIT = Number(process.env.AMBIGUOUS_REFINE_LIMIT || 40);
const FRAGMENT_VALIDATION_BATCH_SIZE = Number(process.env.FRAGMENT_VALIDATION_BATCH_SIZE || 4);
const FRAGMENT_VALIDATION_MAX_BATCHES = Number(process.env.FRAGMENT_VALIDATION_MAX_BATCHES || 8);
const FRAGMENT_VALIDATION_MAX_TOKENS = Number(process.env.FRAGMENT_VALIDATION_MAX_TOKENS || 4000);
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

function readTextIfExists(file, fallback = "") {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback;
}

function loadStageSkills(stageFiles) {
  const controller = readTextIfExists(
    path.join(ROOT, "skill.md"),
    "NMR assignment controller: assign conservatively and use staged sub-skills."
  );
  const parts = [`# Controller skill\n${controller}`];
  for (const fileName of stageFiles) {
    const file = path.join(ROOT, "skills", fileName);
    parts.push(`# ${fileName}\n${readTextIfExists(file, "")}`);
  }
  return parts.join("\n\n");
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

function buildFragmentValidationPrompt(payload, fragments, iteration, batchIndex, previousFeedback) {
  const skill = loadStageSkills([
    "stage_5_refine_ambiguous.md",
    "stage_6_validation.md"
  ]);
  const data = {
    iteration,
    batch_index: batchIndex,
    sequence: payload.sequence || [],
    connected_fragments: fragments,
    previous_feedback: previousFeedback || []
  };
  return [
    "Validate a SMALL BATCH of connected pseudo-residue fragments from protein NMR spectra.",
    "The app grouped peaks by matching HN/N and linked pseudo residues with i-1 Cx evidence.",
    "Decide whether each fragment can be a contiguous part of the uploaded protein sequence.",
    "Use conservative chemical-shift reasoning: HN, N, intra Cx, i-1 Cx, Gly N 90-110 and no CB, Ser/Thr high CB, Ala low CB, Pro amide gaps.",
    "Return ONLY plain text line protocol. No JSON.",
    "Placement line format: F001|31|m|R001:E31,R002:G32",
    "Rejected link line format: !R001>R002",
    "If there is no confident placement or rejected link, return exactly: NONE",
    "Rules:",
    "- Placement columns are fragment_id|start sequence index|confidence|temp_id:residue_label pairs.",
    "- Confidence is h, m, or l.",
    "- Use one placement or rejected-link line per result.",
    "- Omit uncertain fragments instead of explaining them.",
    "- Include only confident or useful placements. Do not return every fragment.",
    "- No notes, no mismatches, no prose, no markdown, no code fences.",
    "- Keep output under 2000 tokens.",
    "- Do not output field names.",
    "SKILL_CONTEXT:",
    skill,
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

async function callAnthropicPromptStream(prompt, onEvent, signal, maxTokens = ANTHROPIC_MAX_TOKENS) {
  const result = await callAnthropicTextStream(prompt, onEvent, signal, maxTokens);
  const parsed = parseModelJson(result.text);
  return {
    engine: result.engine,
    usage: result.usage,
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    residue_assignment_map: Array.isArray(parsed.residue_assignment_map) ? parsed.residue_assignment_map : [],
    placements: Array.isArray(parsed.placements) ? parsed.placements : [],
    rejected_links: Array.isArray(parsed.rejected_links) ? parsed.rejected_links : [],
    p: Array.isArray(parsed.p) ? parsed.p : [],
    x: Array.isArray(parsed.x) ? parsed.x : [],
    notes: parsed.notes || ""
  };
}

async function callAnthropicTextStream(prompt, onEvent, signal, maxTokens = ANTHROPIC_MAX_TOKENS) {
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
    signal,
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
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
    throw new Error(`Model output hit the ${maxTokens} token limit. Try lowering FRAGMENT_VALIDATION_BATCH_SIZE or raising FRAGMENT_VALIDATION_MAX_TOKENS in .env.`);
  }
  return {
    engine: `anthropic:${ANTHROPIC_MODEL}`,
    usage,
    text
  };
}

function addUsage(total, next) {
  for (const [key, value] of Object.entries(next || {})) {
    if (typeof value === "number") total[key] = (total[key] || 0) + value;
  }
  return total;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
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

function residueByLabel(sequence, label) {
  return sequence.find(row => row.residue_label === String(label || "").toUpperCase()) || null;
}

function rowsFor(payload, key) {
  return payload.experiments?.[key]?.normalized_rows || [];
}

function uniqueRounded(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const rounded = Number(value.toFixed(3));
    const key = rounded.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rounded);
  }
  return out.sort((a, b) => a - b);
}

function carbonDimension(row) {
  const dim = String(row.C_dimension || row.C_atom || "").toUpperCase();
  if (["CA", "CB", "CO", "CX"].includes(dim)) return dim;
  return toNum(row.CO) !== null ? "CO" : "CX";
}

function collectMatchingRows(payload, anchor) {
  const rows = [];
  for (const [experimentKey, exp] of Object.entries(payload.experiments || {})) {
    for (const row of exp.normalized_rows || []) {
      if (!near(toNum(row.HN), toNum(anchor.HN), LOOSE_TOL.H) || !near(toNum(row.N), toNum(anchor.N), LOOSE_TOL.N)) continue;
      rows.push({ ...row, experiment_key: experimentKey });
    }
  }
  return rows;
}

function buildObservedResidueTerms(payload) {
  const hsqcRows = rowsFor(payload, "HSQC").filter(row => toNum(row.HN) !== null && toNum(row.N) !== null);
  return hsqcRows.map((anchor, index) => {
    const termId = `R${String(index + 1).padStart(3, "0")}`;
    const matchedRows = collectMatchingRows(payload, anchor);
    const intraCarbonRows = matchedRows.filter(row => ["HNCA", "HNCACB"].includes(row.experiment_key) && toNum(row.C) !== null);
    const previousCarbonRows = matchedRows.filter(row => ["CBCACONH", "HNCOCA"].includes(row.experiment_key) && toNum(row.C) !== null);
    const coRows = matchedRows.filter(row => row.experiment_key === "HNCO" && toNum(row.C) !== null);
    const hxRows = matchedRows.filter(row => ["HBHACONH"].includes(row.experiment_key) && toNum(row.Hx) !== null);
    return {
      temp_id: termId,
      hsqc_peak_id: anchor.peak_id || "",
      HN: toNum(anchor.HN),
      N: toNum(anchor.N),
      intra_carbons: uniqueRounded(intraCarbonRows.map(row => toNum(row.C))),
      previous_carbons: uniqueRounded(previousCarbonRows.map(row => toNum(row.C))),
      co_i_minus_1: uniqueRounded(coRows.map(row => toNum(row.C))),
      hx_values: uniqueRounded(hxRows.map(row => toNum(row.Hx))),
      peak_refs: matchedRows.map(row => ({
        experiment_key: row.experiment_key,
        peak_id: row.peak_id || "",
        HN: toNum(row.HN),
        N: toNum(row.N),
        C: toNum(row.C),
        C_dimension: carbonDimension(row)
      })),
      candidate_residue_label: "",
      confidence: "unplaced"
    };
  });
}

function carbonSetMatchScore(needles, haystack) {
  if (!needles.length || !haystack.length) return 0;
  let score = 0;
  for (const value of needles) {
    const best = Math.min(...haystack.map(other => Math.abs(value - other)));
    if (best <= CONFIRM_TOL.C) score += 2;
    else if (best <= LOOSE_TOL.C) score += 1;
  }
  return score;
}

function buildResidueLinks(terms, rejectedLinks = new Set()) {
  const candidates = [];
  for (const next of terms) {
    for (const prev of terms) {
      if (prev.temp_id === next.temp_id) continue;
      const key = `${prev.temp_id}->${next.temp_id}`;
      if (rejectedLinks.has(key)) continue;
      const score = carbonSetMatchScore(next.previous_carbons, prev.intra_carbons);
      if (score <= 0) continue;
      candidates.push({
        from_temp_id: prev.temp_id,
        to_temp_id: next.temp_id,
        score,
        matched_previous_carbons: next.previous_carbons,
        matched_intra_carbons: prev.intra_carbons
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedFrom = new Set();
  const usedTo = new Set();
  const links = [];
  for (const link of candidates) {
    if (usedFrom.has(link.from_temp_id) || usedTo.has(link.to_temp_id)) continue;
    if (link.score < 2) continue;
    usedFrom.add(link.from_temp_id);
    usedTo.add(link.to_temp_id);
    links.push(link);
  }
  return links;
}

function buildConnectedFragments(terms, links) {
  const byId = new Map(terms.map(term => [term.temp_id, term]));
  const nextById = new Map(links.map(link => [link.from_temp_id, link]));
  const prevById = new Map(links.map(link => [link.to_temp_id, link]));
  const starts = terms.filter(term => !prevById.has(term.temp_id));
  const visited = new Set();
  const fragments = [];

  function addFragment(start) {
    const residues = [];
    const fragmentLinks = [];
    let current = start;
    while (current && !visited.has(current.temp_id)) {
      visited.add(current.temp_id);
      residues.push(current);
      const link = nextById.get(current.temp_id);
      if (!link) break;
      fragmentLinks.push(link);
      current = byId.get(link.to_temp_id);
    }
    if (residues.length) {
      fragments.push({
        fragment_id: `F${String(fragments.length + 1).padStart(3, "0")}`,
        residues,
        links: fragmentLinks,
        length: residues.length
      });
    }
  }

  for (const start of starts) addFragment(start);
  for (const term of terms) {
    if (!visited.has(term.temp_id)) addFragment(term);
  }
  return fragments.filter(fragment => fragment.length > 1);
}

function compactFragmentsForLLM(fragments) {
  return fragments.map(fragment => ({
    fragment_id: fragment.fragment_id,
    length: fragment.length,
    residues: fragment.residues.map(term => ({
      temp_id: term.temp_id,
      HN: term.HN,
      N: term.N,
      intra_carbons: term.intra_carbons,
      previous_carbons: term.previous_carbons,
      co_i_minus_1: term.co_i_minus_1,
      hx_values: term.hx_values,
      seed_or_current_assignment: term.candidate_residue_label || "",
      confidence: term.confidence || "unplaced"
    })),
    links: fragment.links.map(link => ({
      from_temp_id: link.from_temp_id,
      to_temp_id: link.to_temp_id,
      score: link.score
    }))
  }));
}

function normalizeRejectedLinks(feedback) {
  const rejected = new Set();
  for (const item of feedback || []) {
    for (const link of item.rejected_links || []) {
      if (link.from_temp_id && link.to_temp_id) rejected.add(`${link.from_temp_id}->${link.to_temp_id}`);
    }
  }
  return rejected;
}

function normalizeFragmentValidationResult(result) {
  const placements = [];
  for (const item of result.p || result.placements || []) {
    const residueMap = item.m || item.residue_labels_by_temp_id || {};
    placements.push({
      fragment_id: item.f || item.fragment_id || "",
      start_index: item.s || item.start_index || "",
      confidence: item.c === "h" ? "high" : item.c === "m" ? "medium" : item.c === "l" ? "low" : (item.confidence || "medium"),
      residue_labels_by_temp_id: residueMap
    });
  }
  const rejected_links = [];
  for (const item of result.x || result.rejected_links || []) {
    rejected_links.push({
      from_temp_id: item.a || item.from_temp_id || "",
      to_temp_id: item.b || item.to_temp_id || ""
    });
  }
  return { placements, rejected_links };
}

function parseFragmentLineProtocol(text) {
  const placements = [];
  const rejected_links = [];
  const cleaned = String(text || "")
    .replace(/```(?:text)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!cleaned || /^NONE$/i.test(cleaned)) return { placements, rejected_links };

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^NONE$/i.test(line)) continue;
    if (line.startsWith("!")) {
      const match = line.match(/^!?\s*([A-Za-z]\d+)\s*>\s*([A-Za-z]\d+)/);
      if (match) {
        rejected_links.push({
          from_temp_id: match[1].toUpperCase(),
          to_temp_id: match[2].toUpperCase()
        });
      }
      continue;
    }
    const parts = line.split("|").map(part => part.trim());
    if (parts.length < 4) continue;
    const [fragmentId, startIndex, confidenceRaw, mappingText] = parts;
    const residueMap = {};
    for (const pair of mappingText.split(",")) {
      const [tempId, residueLabel] = pair.split(":").map(value => String(value || "").trim().toUpperCase());
      if (/^R\d+$/i.test(tempId) && /^[A-Z]\d+$/i.test(residueLabel)) residueMap[tempId] = residueLabel;
    }
    if (!fragmentId || !Object.keys(residueMap).length) continue;
    const c = confidenceRaw.toLowerCase()[0] || "m";
    placements.push({
      fragment_id: fragmentId,
      start_index: Number(startIndex) || "",
      confidence: c === "h" ? "high" : c === "l" ? "low" : "medium",
      residue_labels_by_temp_id: residueMap
    });
  }
  return { placements, rejected_links };
}

function placementMapFromFeedback(feedback) {
  const out = new Map();
  for (const item of feedback || []) {
    for (const placement of item.placements || []) {
      const labels = placement.residue_labels_by_temp_id || {};
      for (const [tempId, residueLabel] of Object.entries(labels)) {
        const clean = String(residueLabel || "").toUpperCase();
        if (clean) out.set(tempId, { residue_label: clean, confidence: placement.confidence || "medium", fragment_id: placement.fragment_id || "" });
      }
    }
  }
  return out;
}

function compactFeedbackForPrompt(feedback) {
  const lines = [];
  for (const item of feedback || []) {
    for (const placement of item.placements || []) {
      const c = String(placement.confidence || "medium")[0].toLowerCase();
      const pairs = Object.entries(placement.residue_labels_by_temp_id || {}).map(([tempId, residueLabel]) => `${tempId}:${residueLabel}`).join(",");
      if (placement.fragment_id && pairs) lines.push(`${placement.fragment_id}|${placement.start_index || ""}|${c}|${pairs}`);
    }
    for (const link of item.rejected_links || []) {
      if (link.from_temp_id && link.to_temp_id) lines.push(`!${link.from_temp_id}>${link.to_temp_id}`);
    }
  }
  return lines.join("\n") || "NONE";
}

function seedPlacementMap(payload, terms) {
  const out = new Map();
  for (const seed of payload.seed_anchors || []) {
    const residue = residueByLabel(payload.sequence || [], seed.residue_label);
    if (!residue) continue;
    const term = terms.find(item => seed.peak_id ? item.hsqc_peak_id === seed.peak_id : near(toNum(seed.HN), item.HN, LOOSE_TOL.H) && near(toNum(seed.N), item.N, LOOSE_TOL.N));
    if (!term) continue;
    out.set(term.temp_id, { residue_label: residue.residue_label, confidence: "high", fragment_id: "seed" });
  }
  return out;
}

function applyPlacementsToTerms(terms, placements) {
  return terms.map(term => {
    const placement = placements.get(term.temp_id);
    if (!placement) return term;
    return {
      ...term,
      candidate_residue_label: placement.residue_label,
      confidence: placement.confidence || "medium",
      placed_fragment_id: placement.fragment_id || ""
    };
  });
}

function fragmentBatches(fragments) {
  const sorted = [...fragments].sort((a, b) => b.length - a.length);
  const limited = sorted.slice(0, Math.max(0, FRAGMENT_VALIDATION_BATCH_SIZE * FRAGMENT_VALIDATION_MAX_BATCHES));
  const batches = [];
  for (let start = 0; start < limited.length; start += FRAGMENT_VALIDATION_BATCH_SIZE) {
    batches.push(limited.slice(start, start + FRAGMENT_VALIDATION_BATCH_SIZE));
  }
  return batches;
}

async function validateFragmentsWithLLM(payload, terms, onEvent, signal) {
  const usage = {};
  const feedback = [];
  let placements = seedPlacementMap(payload, terms);
  let bestAssigned = placements.size;
  let stalled = 0;
  let fragments = [];
  let skippedReason = "";

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    const rejectedLinks = normalizeRejectedLinks(feedback);
    const placedTerms = applyPlacementsToTerms(terms, placements);
    const links = buildResidueLinks(placedTerms, rejectedLinks);
    fragments = buildConnectedFragments(placedTerms, links);
    onEvent({ type: "progress", stage: "fragments_built", iteration, residue_terms: terms.length, fragment_count: fragments.length });
    if (!fragments.length) {
      skippedReason = "no_connected_fragments";
      onEvent({ type: "progress", stage: "validation_skipped", reason: skippedReason });
      break;
    }
    if (!ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY. Fragment validation cannot call Anthropic.");
    }
    if (AMBIGUOUS_REFINE_LIMIT === 0) {
      skippedReason = "llm_validation_disabled";
      onEvent({ type: "progress", stage: "validation_skipped", reason: skippedReason });
      break;
    }

    const batches = fragmentBatches(fragments);
    let rejectedThisIteration = 0;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      onEvent({ type: "progress", stage: "fragment_batch", iteration, batch_index: batchIndex + 1, batch_count: batches.length, fragment_count: batches[batchIndex].length });
      let previousUsage = {};
      const result = await callAnthropicTextStream(buildFragmentValidationPrompt(payload, compactFragmentsForLLM(batches[batchIndex]), iteration, batchIndex + 1, compactFeedbackForPrompt(feedback)), event => {
        if (event.type !== "usage") return onEvent(event);
        const delta = {};
        for (const [key, value] of Object.entries(event.usage || {})) {
          if (typeof value === "number") delta[key] = value - (previousUsage[key] || 0);
        }
        previousUsage = event.usage || {};
        addUsage(usage, delta);
        onEvent({ type: "usage", usage });
      }, signal, FRAGMENT_VALIDATION_MAX_TOKENS);
      const parsed = parseFragmentLineProtocol(result.text);
      rejectedThisIteration += parsed.rejected_links.length;
      feedback.push(parsed);
      placements = placementMapFromFeedback(feedback);
    }
    const assigned = placements.size;
    onEvent({ type: "progress", stage: "fragments_validated", iteration, assigned_residue_terms: assigned, rejected_links: rejectedThisIteration });
    if (assigned <= bestAssigned) stalled += 1;
    else stalled = 0;
    bestAssigned = Math.max(bestAssigned, assigned);
    if (bestAssigned >= terms.length || stalled >= 3) break;
  }

  const finalTerms = applyPlacementsToTerms(terms, placements);
  const finalLinks = buildResidueLinks(finalTerms, normalizeRejectedLinks(feedback));
  const finalFragments = buildConnectedFragments(finalTerms, finalLinks);
  return { usage, feedback, placements, residueTerms: finalTerms, connectedFragments: finalFragments, skippedReason };
}

function residueMapFromObservedTerms(payload, terms) {
  const sequence = payload.sequence || [];
  return terms
    .filter(term => term.candidate_residue_label)
    .map(term => {
      const residue = residueByLabel(sequence, term.candidate_residue_label);
      const prev = previousResidue(sequence, term.candidate_residue_label);
      const expected = CA_CB[residue?.one_letter] || {};
      const prevExpected = CA_CB[prev?.one_letter] || {};
      const pickClosest = (values, target) => {
        if (target === null || target === undefined || !values.length) return null;
        let best = null;
        let bestDistance = Infinity;
        for (const value of values) {
          const distance = Math.abs(value - target);
          if (distance < bestDistance) {
            best = value;
            bestDistance = distance;
          }
        }
        return bestDistance <= LOOSE_TOL.C ? best : null;
      };
      return {
        anchor_residue: term.candidate_residue_label,
        temp_id: term.temp_id,
        hsqc_peak_id: term.hsqc_peak_id,
        HN: term.HN,
        N: term.N,
        CA_i: pickClosest(term.intra_carbons, expected.CA),
        CB_i: pickClosest(term.intra_carbons, expected.CB),
        previous_residue: prev?.residue_label || "",
        CA_i_minus_1: pickClosest(term.previous_carbons, prevExpected.CA),
        CB_i_minus_1: pickClosest(term.previous_carbons, prevExpected.CB),
        confidence: term.confidence || "medium",
        notes: `fragment ${term.temp_id}`
      };
    });
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

async function callAnthropicResidueMapWorkflowStream(payload, onEvent, signal) {
  const observedTerms = buildObservedResidueTerms(payload);
  const validation = await validateFragmentsWithLLM(payload, observedTerms, onEvent, signal);
  const programmaticMap = residueMapFromObservedTerms(payload, validation.residueTerms);
  let { residueMap, assignments } = applyResidueMapToPeaks(payload, programmaticMap);
  onEvent({ type: "progress", stage: "map_applied", residue_count: residueMap.length, ambiguous_count: ambiguousAssignments(assignments).length });

  return {
    engine: `programmatic-terms-fragments+anthropic:${ANTHROPIC_MODEL}:fragment-validation`,
    usage: validation.usage,
    validation_skipped_reason: validation.skippedReason,
    observed_residue_terms: validation.residueTerms,
    connected_fragments: validation.connectedFragments,
    fragment_validation_feedback: validation.feedback,
    residue_assignment_map: residueMap,
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
      const abortController = new AbortController();
      req.on("close", () => {
        if (!res.writableEnded) abortController.abort();
      });
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store"
      });
      try {
        const result = await callAnthropicResidueMapWorkflowStream(payload, event => sendNdjson(res, event), abortController.signal);
        sendNdjson(res, { type: "result", ...result });
      } catch (error) {
        if (!abortController.signal.aborted) {
          sendNdjson(res, { type: "error", error: error.message || String(error) });
        }
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
