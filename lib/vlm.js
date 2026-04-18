import { GoogleGenAI } from "@google/genai";

// Optional Vision-Language Model check that runs after EXIF + GPS
// verification. It asks Gemma 4 (via the Google AI Studio API)
// whether the photo plausibly shows the goal scene — e.g. "is this
// really a gym?" — so a user can't just submit a random selfie at
// the right coordinates.
//
// This is *advisory*: never throws upward, never blocks goal
// resolution. The verdict is recorded on the proof doc as a `vlm`
// block and surfaced to the UI for an "AI confirmed" badge.

const DEFAULT_MODEL = process.env.GEMINI_VLM_MODEL || "gemma-4-26b-a4b-it";

let cachedClient = null;
function getClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

function buildPrompt(goal) {
  const title = (goal?.title || "their goal").trim();
  const locName = goal?.location?.name?.trim();
  const locClause = locName
    ? ` The check-in location is described as "${locName}".`
    : "";

  return [
    `A user committed to the goal: "${title}".${locClause}`,
    "",
    "Examine the attached photo and decide whether it is plausible visual evidence",
    "that the user is currently doing this activity or is at this kind of place.",
    "Be lenient — partial views, selfies, low light, or off-angle shots are fine",
    "as long as something in the frame supports the goal. Reject only if the",
    "scene clearly contradicts the goal (e.g. a goal of going to the gym but the",
    "photo is a bedroom or a meal).",
    "",
    'Respond with STRICT JSON only, no prose, in this exact shape:',
    '{"matches": boolean, "confidence": number between 0 and 1, "label": "short scene label", "rationale": "one sentence explanation"}',
  ].join("\n");
}

// Best-effort JSON extractor. Gemma sometimes wraps its JSON in
// markdown fences or adds leading prose despite instructions.
function parseJsonLoose(text) {
  if (!text) return null;
  const trimmed = String(text).trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // fall through
    }
  }

  return null;
}

// Single attempt — caller wraps this for retries.
async function callOnce({ client, contents, timeoutMs }) {
  const controller = AbortSignal.timeout
    ? AbortSignal.timeout(timeoutMs)
    : null;

  const response = await client.models.generateContent({
    model: DEFAULT_MODEL,
    contents,
    config: {
      // Deterministic outputs: same photo + same prompt should give
      // the same verdict. Removes most of the "sometimes works,
      // sometimes doesn't" judgment variance from the LLM side.
      temperature: 0,
      topP: 0.1,
      // Cap output so a runaway model can't eat into the budget.
      maxOutputTokens: 256,
      ...(controller ? { abortSignal: controller } : {}),
    },
  });

  const text =
    typeof response?.text === "string"
      ? response.text
      : response?.candidates?.[0]?.content?.parts
          ?.map((p) => p?.text || "")
          .join("") || "";

  return text;
}

export async function verifyImageMatchesGoal({
  buffer,
  mimeType,
  goal,
  // 10s per attempt × up to 2 attempts = 20s worst case. The caller
  // (proofs/upload route) wraps this in an outer 22s Promise.race to
  // guarantee EXIF + Mongo + XRPL EscrowFinish always have headroom
  // inside the function's maxDuration=60s budget. Callers can pass
  // their own values; these are sane defaults for any consumer.
  timeoutMs = 10_000,
  maxAttempts = 2,
}) {
  const client = getClient();
  if (!client) {
    return { checked: false, reason: "no_api_key" };
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { checked: false, reason: "empty_buffer" };
  }

  const prompt = buildPrompt(goal);
  const contents = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: mimeType || "image/jpeg",
            data: buffer.toString("base64"),
          },
        },
        { text: prompt },
      ],
    },
  ];

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const text = await callOnce({ client, contents, timeoutMs });
      const parsed = parseJsonLoose(text);
      if (!parsed || typeof parsed !== "object") {
        // Bad JSON — retry once, since this often clears with a
        // fresh deterministic call. If it persists, surface it.
        if (attempt < maxAttempts) {
          lastErr = new Error("unparseable_response");
          continue;
        }
        return {
          checked: true,
          model: DEFAULT_MODEL,
          attempts: attempt,
          matches: null,
          confidence: null,
          label: null,
          rationale: null,
          rawText: text?.slice(0, 500) || null,
          reason: "unparseable_response",
        };
      }

      const matches =
        typeof parsed.matches === "boolean" ? parsed.matches : null;
      const confidence =
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : null;

      return {
        checked: true,
        model: DEFAULT_MODEL,
        attempts: attempt,
        matches,
        confidence,
        label:
          typeof parsed.label === "string" ? parsed.label.slice(0, 80) : null,
        rationale:
          typeof parsed.rationale === "string"
            ? parsed.rationale.slice(0, 280)
            : null,
      };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      // Retry on transient failures (timeout, abort, network, 5xx).
      // Bail out fast on unrecoverable errors (auth, quota, bad request).
      const transient =
        /aborted|timeout|ETIMEDOUT|ECONNRESET|fetch failed|network|503|502|504|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(
          msg
        );
      if (!transient || attempt >= maxAttempts) {
        console.warn(
          `[vlm] verifyImageMatchesGoal failed after ${attempt} attempt(s):`,
          msg
        );
        // Friendly reason codes for the UI to interpret.
        let reason = "request_failed";
        if (/aborted|timeout|ETIMEDOUT/i.test(msg)) reason = "timeout";
        else if (/RESOURCE_EXHAUSTED|quota|429/i.test(msg)) reason = "rate_limited";
        else if (/PERMISSION_DENIED|UNAUTHENTICATED|API key/i.test(msg))
          reason = "auth_error";
        else if (/network|fetch failed|ECONNRESET/i.test(msg))
          reason = "network_error";

        return {
          checked: false,
          attempts: attempt,
          reason,
          error: msg.slice(0, 200),
        };
      }
      // else: fall through to next attempt
    }
  }

  // Should not reach here, but be safe.
  return {
    checked: false,
    attempts: maxAttempts,
    reason: "request_failed",
    error: String(lastErr?.message || lastErr || "unknown").slice(0, 200),
  };
}
