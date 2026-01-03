#!/usr/bin/env python3
"""
Benchmark OpenAI-compatible /chat/completions latency (sequential or concurrent).

This is an optional dev tool for investigating LexiPath subtitle performance:
  - Stage 1: SELECT_KEYWORDS-like prompt (keyword selection)
  - Stage 2: EXPLAIN_WORD-like prompt (word/phrase explanation)

Requirements:
  - Python 3.8+
  - No third-party packages (stdlib only)

Security:
  - Prefer setting API key via env var `LEXIPATH_API_KEY`.
  - Avoid putting keys directly into shell history.

Examples:
  set LEXIPATH_API_KEY=sk-...
  python .\\llm_benchmark.py --base-url http://10.126.126.5:3000 --model doubao-seed-1-6-flash --scenario tiny --runs 10 --concurrency 1

  python .\\llm_benchmark.py --base-url http://10.126.126.5:3000 --model doubao-seed-1-6-flash --scenario explain --word "selection sort" --context "Compared to selection sort..." --runs 10 --concurrency 2
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def normalize_base_url(url: str) -> str:
  return url.strip().rstrip("/")


def build_keyword_select_prompt(text: str) -> str:
  trimmed = (text or "").strip()
  return f"""You are LexiPath, a language learning assistant.

Task: Select key vocabulary items from the given subtitle text for a learner.

Learner:
- Native language: Simplified Chinese
- Target language: English
- Level: B1

Rules:
- Output ONLY a JSON array of strings. No markdown, no code fences, no extra text.
- Each item must be a word OR a short phrase (collocation/phrasal verb/idiom) that appears in the text.
- Prefer phrases when they carry meaning beyond the individual words.
- Exclude people names and place names.
- Exclude basic numbers/counting words (e.g., 3, three) unless they are essential to meaning.
- Return at most 8 items.
- Do NOT output indices/positions.

Text:
{trimmed}
"""


def build_explain_word_prompt(word: str, context: str) -> str:
  w = (word or "").strip()
  ctx = (context or "").strip()
  context_section = f'\nContext where the word appears:\n"{ctx}"' if ctx else ""

  return f"""You are a vocabulary learning assistant. Explain the following English word/phrase for a B1-level language learner.

Word/Phrase: "{w}"{context_section}

Provide:
1. translation: Translation to Simplified Chinese
2. phonetic: IPA phonetic notation for the English word
3. difficulty: CEFR level (A1, A2, B1, B2, C1, or C2)
4. definition: Concise definition in Simplified Chinese (adapted to B1 level)
5. example: Example sentence in English (only if no context provided)
6. example_translation: Translation of example sentence to Simplified Chinese (only if example provided)

Guidelines:
- Keep definitions simple and clear for B1-level learners
- Use common, everyday language in explanations
- If the word has multiple meanings, choose the most relevant based on context

Respond in JSON format:
{{
  "translation": "Simplified Chinese translation",
  "phonetic": "pronunciation notation",
  "difficulty": "B1",
  "definition": "clear definition in Simplified Chinese",
  "example": "English example sentence (optional)",
  "example_translation": "Simplified Chinese translation (optional)"
}}
"""


def build_payload(
  scenario: str,
  model: str,
  text: str,
  word: str,
  context: str,
  content_format: str,
) -> Dict[str, Any]:
  def make_message_content(value: str) -> Any:
    if content_format == "parts":
      return [{"type": "text", "text": value}]
    return value

  if scenario == "tiny":
    return {
      "model": model,
      "messages": [{"role": "user", "content": make_message_content("Reply with exactly: OK")}],
      "temperature": 0,
      "max_tokens": 16,
    }

  if scenario == "keyword":
    prompt = build_keyword_select_prompt(text)
    return {
      "model": model,
      "messages": [{"role": "user", "content": make_message_content(prompt)}],
      "temperature": 0.1,
      "max_tokens": 250,
    }

  if scenario == "explain":
    prompt = build_explain_word_prompt(word, context)
    return {
      "model": model,
      "messages": [{"role": "user", "content": make_message_content(prompt)}],
      "temperature": 0.1,
      "max_tokens": 350,
    }

  raise ValueError(f"unknown scenario: {scenario}")


@dataclass
class PostResult:
  ok: bool
  status: int
  elapsed_ms: int
  content: Optional[str] = None
  reasoning: Optional[str] = None
  raw_json: Optional[str] = None
  error: Optional[str] = None


def post_chat_completions(
  url: str,
  api_key: str,
  payload: Dict[str, Any],
  timeout_ms: int,
) -> PostResult:
  body = json.dumps(payload).encode("utf-8")
  req = Request(
    url=url,
    data=body,
    method="POST",
    headers={
      "Authorization": f"Bearer {api_key}",
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  )

  start = time.perf_counter()
  try:
    with urlopen(req, timeout=timeout_ms / 1000.0) as resp:
      raw = resp.read()
      elapsed_ms = int((time.perf_counter() - start) * 1000)
      raw_text = raw.decode("utf-8", errors="replace")
      content, reasoning = extract_chat_content(raw_text)
      return PostResult(
        ok=True,
        status=getattr(resp, "status", 200),
        elapsed_ms=elapsed_ms,
        content=content,
        reasoning=reasoning,
        raw_json=raw_text,
      )
  except HTTPError as e:
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    try:
      msg = e.read().decode("utf-8", errors="replace")
    except Exception:
      msg = str(e)
    return PostResult(ok=False, status=int(getattr(e, "code", 0) or 0), elapsed_ms=elapsed_ms, error=msg)
  except URLError as e:
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    return PostResult(ok=False, status=0, elapsed_ms=elapsed_ms, error=str(e))
  except TimeoutError as e:
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    return PostResult(ok=False, status=0, elapsed_ms=elapsed_ms, error=f"timeout: {e}")
  except Exception as e:
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    return PostResult(ok=False, status=0, elapsed_ms=elapsed_ms, error=str(e))


def resolve_endpoint(
  base_url: str,
  api_key: str,
  probe_payload: Dict[str, Any],
  timeout_ms: int,
) -> Tuple[str, PostResult]:
  base = normalize_base_url(base_url)
  candidates = [
    f"{base}/v1/chat/completions",
    f"{base}/chat/completions",
  ]

  probe_timeout_ms = min(8000, timeout_ms)
  for url in candidates:
    probe = post_chat_completions(url, api_key, probe_payload, probe_timeout_ms)
    if probe.ok and 200 <= probe.status < 300:
      return url, probe

  tried = "\n".join([f"  - {u}" for u in candidates])
  raise RuntimeError(f"unable to reach chat completions endpoint. tried:\n{tried}")


def extract_chat_content(raw_json_text: str) -> Tuple[Optional[str], Optional[str]]:
  """
  Try to extract `choices[0].message.content` from OpenAI-compatible JSON.
  Also attempts to extract an optional "reasoning/thinking" field if present.
  """
  try:
    data = json.loads(raw_json_text)
  except Exception:
    return None, None

  choices = data.get("choices")
  if not isinstance(choices, list) or not choices:
    return None, None

  first = choices[0] if isinstance(choices[0], dict) else None
  if not isinstance(first, dict):
    return None, None

  message = first.get("message")
  if not isinstance(message, dict):
    return None, None

  content = message.get("content")
  if isinstance(content, str):
    pass
  elif isinstance(content, list):
    # Some providers (e.g. Ark v3) may return structured content parts.
    parts: List[str] = []
    for item in content:
      if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str):
        parts.append(item["text"])
    content = "\n".join(parts) if parts else None
  else:
    content = None

  reasoning = None
  for key in ("reasoning_content", "thinking", "reasoning"):
    value = message.get(key)
    if isinstance(value, str) and value.strip():
      reasoning = value
      break

  return content, reasoning


def percentile(sorted_vals: List[int], p: float) -> int:
  if not sorted_vals:
    raise ValueError("empty values")
  idx = int((len(sorted_vals) * p) + 0.999999) - 1  # ceil(n*p)-1
  idx = max(0, min(idx, len(sorted_vals) - 1))
  return sorted_vals[idx]


def apply_disable_thinking(payload: Dict[str, Any]) -> Dict[str, Any]:
  """
  Best-effort knobs used by some OpenAI-compatible gateways/models to disable reasoning/thinking.
  Not part of the official OpenAI Chat Completions spec, so servers may ignore or reject it.
  """
  cloned = dict(payload)
  # Ark (Volcengine) style:
  #   "thinking": { "type": "disabled" }
  # Some gateways also accept a simpler boolean switch.
  cloned["thinking"] = {"type": "disabled"}
  cloned["enable_thinking"] = False
  return cloned


def main() -> int:
  parser = argparse.ArgumentParser()
  parser.add_argument("--base-url", default="http://10.126.126.5:3000")
  parser.add_argument("--model", default="doubao-seed-1-6-flash")
  parser.add_argument("--scenario", choices=["tiny", "keyword", "explain"], default="tiny")
  parser.add_argument("--runs", type=int, default=8)
  parser.add_argument("--concurrency", type=int, default=1)
  parser.add_argument("--timeout-ms", type=int, default=30000)
  parser.add_argument("--api-key", default=None)
  parser.add_argument("--disable-thinking", action="store_true", help="Try to disable model thinking/reasoning (best-effort).")
  parser.add_argument("--print-json", action="store_true", help="Print raw JSON response per run (very verbose).")
  parser.add_argument(
    "--content-format",
    choices=["string", "parts"],
    default="string",
    help="Message content format: plain string (OpenAI) or typed parts list (Ark v3).",
  )
  parser.add_argument("--text", default="To be clear, compared to selection sort, bubble sort is slightly different.")
  parser.add_argument("--word", default="selection sort")
  parser.add_argument("--context", default="To be clear, compared to selection sort, bubble sort is slightly different.")
  args = parser.parse_args()

  api_key = args.api_key or os.environ.get("LEXIPATH_API_KEY")
  if not api_key:
    api_key = getpass.getpass("Enter API key (input hidden): ").strip()

  if args.runs < 1:
    raise SystemExit("--runs must be >= 1")
  if args.concurrency < 1:
    raise SystemExit("--concurrency must be >= 1")

  payload = build_payload(
    scenario=args.scenario,
    model=args.model,
    text=args.text,
    word=args.word,
    context=args.context,
    content_format=args.content_format,
  )

  # Always probe with a tiny request so endpoint resolution can't be blocked by a slow scenario payload.
  probe_payload = build_payload(
    scenario="tiny",
    model=args.model,
    text="",
    word="",
    context="",
    content_format=args.content_format,
  )
  url, probe = resolve_endpoint(args.base_url, api_key, probe_payload, args.timeout_ms)
  print(f"Resolved endpoint: {url} (probe {probe.elapsed_ms}ms, HTTP {probe.status})")

  disable_thinking_supported = args.disable_thinking
  if args.disable_thinking:
    probe_off = post_chat_completions(url, api_key, apply_disable_thinking(probe_payload), min(8000, args.timeout_ms))
    if probe_off.ok and 200 <= probe_off.status < 300:
      print("Disable-thinking probe: supported (request accepted).")
    else:
      disable_thinking_supported = False
      print("Disable-thinking probe: NOT supported (request rejected). Continuing without disable-thinking.")

  all_results: List[PostResult] = []

  # runs are batches; each batch spawns N concurrent requests
  for batch in range(1, args.runs + 1):
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
      futures = []
      for slot in range(1, args.concurrency + 1):
        request_payload = apply_disable_thinking(payload) if disable_thinking_supported else payload
        futures.append(
          pool.submit(post_chat_completions, url, api_key, request_payload, args.timeout_ms)
        )

      for slot, fut in enumerate(as_completed(futures), start=1):
        result = fut.result()
        all_results.append(result)
        print(f"Run {batch}.{slot} HTTP {result.status} {result.elapsed_ms}ms")
        # Print the returned model content for manual inspection (one result per run).
        if result.content is not None:
          print(result.content.rstrip())
        else:
          print("(no parsed content)")
        if result.reasoning is not None:
          print("\n[reasoning/thinking]\n" + result.reasoning.rstrip())
        if args.print_json and result.raw_json is not None:
          print("\n[raw_json]\n" + result.raw_json.rstrip())
        print("")

  ok_times = [r.elapsed_ms for r in all_results if r.ok and 200 <= r.status < 300]
  ok_times_sorted = sorted(ok_times)

  print("")
  print(
    f"Scenario={args.scenario} Runs={args.runs} Concurrency={args.concurrency} TimeoutMs={args.timeout_ms}"
  )
  print(f"Success={len(ok_times)}/{len(all_results)}")

  if ok_times_sorted:
    p50 = percentile(ok_times_sorted, 0.50)
    p90 = percentile(ok_times_sorted, 0.90)
    p95 = percentile(ok_times_sorted, 0.95)
    avg = int(statistics.mean(ok_times_sorted))
    print(
      "Latency ms: "
      f"min={ok_times_sorted[0]} p50={p50} p90={p90} p95={p95} avg={avg} max={ok_times_sorted[-1]}"
    )
  else:
    print("No successful responses to compute latency stats.")

  # If there are errors, print a short summary
  errors = [r for r in all_results if not (r.ok and 200 <= r.status < 300)]
  if errors:
    unique = {}
    for e in errors:
      key = (e.status, (e.error or "")[:120])
      unique[key] = unique.get(key, 0) + 1
    print("")
    print("Errors:")
    for (status, msg), count in sorted(unique.items(), key=lambda x: (-x[1], x[0][0])):
      print(f"- {count}x HTTP {status}: {msg}")

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
