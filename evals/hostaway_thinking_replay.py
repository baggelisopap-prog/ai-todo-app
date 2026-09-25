"""
COSTS MONEY (gemini-3.5-flash, both configurations): 60 threads was ~78,000
tokens, about $0.39. Ask the owner first.

Does turning thinking OFF change the Hostaway classifier's decisions?

Replays real guest threads (the exact text the classifier saw is stored as
hostaway_thread) through the SAME model, instruction and schema twice — default
thinking vs thinking_budget=0 — and compares priorities. Read-only: nothing is
written to the database; token usage is recorded here, not in token_usage_log.
It builds both configurations itself, so it still answers the question after
production switched thinking off on 2026-09-25 (55/60 identical that day).

  ./venv/Scripts/python.exe evals/hostaway_thinking_replay.py [N_THREADS]
Writes evals/results/hostaway_replay.json.
"""
import collections
import json
import logging
import os
import sys
import time

ROOT = str(__import__("pathlib").Path(__file__).resolve().parent.parent)
sys.path.insert(0, ROOT)
os.chdir(ROOT)
sys.stdout.reconfigure(encoding="utf-8")
logging.disable(logging.CRITICAL)

from google.genai import types  # noqa: E402
import hostaway_integration as hi  # noqa: E402
from repository import supabase  # noqa: E402

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(HERE, exist_ok=True)
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 60

rows = (supabase.table("tasks")
        .select("id,hostaway_thread,ai_suggested_priority,priority,created_at")
        .eq("category", "Hostaway").not_.is_("hostaway_thread", "null")
        .order("created_at", desc=True).execute().data)
seen, sample = set(), []
# every thread once; the ones first classified P1 first, so emergencies are all in
for r in sorted(rows, key=lambda r: (r.get("ai_suggested_priority") != "P1", r["created_at"]), reverse=False):
    text = (r.get("hostaway_thread") or "").strip()
    if not text or text in seen:
        continue
    seen.add(text)
    sample.append(r)
    if len(sample) >= LIMIT:
        break

instruction = hi._build_classification_instruction()


def classify(text, thinking_off):
    cfg = dict(system_instruction=instruction, response_mime_type="application/json",
               response_schema=hi._MessageClassification)
    if thinking_off:
        cfg["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
    for attempt in range(3):
        try:
            resp = hi.client.models.generate_content(model=hi.HOSTAWAY_CLASSIFICATION_MODEL, contents=text,
                                                     config=types.GenerateContentConfig(**cfg))
            um = resp.usage_metadata
            parsed = hi._MessageClassification.model_validate_json(resp.text)
            return parsed.priority, {
                "prompt": um.prompt_token_count or 0, "output": um.candidates_token_count or 0,
                "thinking": getattr(um, "thoughts_token_count", 0) or 0, "total": um.total_token_count or 0}
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** attempt)
    raise last


results = []
for r in sample:
    on, u_on = classify(r["hostaway_thread"], thinking_off=False)
    off, u_off = classify(r["hostaway_thread"], thinking_off=True)
    results.append({"id": r["id"], "stored_ai": r.get("ai_suggested_priority"), "on": on, "off": off,
                    "u_on": u_on, "u_off": u_off, "chars": len(r["hostaway_thread"])})
json.dump(results, open(os.path.join(HERE, "hostaway_replay.json"), "w", encoding="utf-8"), ensure_ascii=False)

agree = sum(1 for x in results if x["on"] == x["off"])
print(f"threads replayed: {len(results)} | thinking ON vs OFF agree: {agree}/{len(results)}")
print("confusion (ON -> OFF):", dict(collections.Counter(f"{x['on']}->{x['off']}" for x in results)))
print("stored first verdict vs ON :", sum(1 for x in results if x["stored_ai"] == x["on"]), "/", len(results))
print("stored first verdict vs OFF:", sum(1 for x in results if x["stored_ai"] == x["off"]), "/", len(results))
for key in ("u_on", "u_off"):
    tot = {k: sum(x[key][k] for x in results) for k in ("prompt", "output", "thinking", "total")}
    cost = (tot["prompt"] * 1.50 + (tot["output"] + tot["thinking"]) * 9.00) / 1e6
    print(f"{key}: {tot} | ${cost:.4f} | per message ${cost/len(results):.5f}")
print("disagreements:")
for x in results:
    if x["on"] != x["off"]:
        print(f"  {x['id'][:8]} stored={x['stored_ai']} ON={x['on']} OFF={x['off']} chars={x['chars']}")
