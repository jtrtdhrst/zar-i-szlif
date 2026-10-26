#!/usr/bin/env python3
# COMFY_PATCH_JSON_TOLERANT_V1: ArkCodexLLM json_only accepts a leading complete
# JSON object with trailing prose (observed 2x: full verdict + explanation tail,
# "Extra data" -> whole 75-90s vision call failed). Garbage with no leading
# object still raises and retries exactly as before. Volume file, idempotent.
import sys
path = sys.argv[1] if len(sys.argv) > 1 else '/app/custom_nodes/comfyui-arkennemasis/codex_provider/llm.py'
s = open(path).read()
if 'COMFY_PATCH_JSON_TOLERANT_V1' in s:
    print('llm already patched')
    sys.exit(0)
a1 = """            if json_only:
                text = _strip_fences(text)
                try:
                    json.loads(text)
                except ValueError as exc:
                    raise CodexStreamTruncated(
                        "json_only is on but the answer is not valid JSON (%s). "
                        "Retrying with a fresh request. First 300 chars: %s"
                        % (exc, text[:300]))"""
r1 = """            if json_only:
                text = _strip_fences(text)
                try:
                    json.loads(text)
                except ValueError:
                    # COMFY_PATCH_JSON_TOLERANT_V1: tolerate trailing prose after a
                    # complete leading object (vision verdicts). No leading object ->
                    # same error + retry path as before.
                    _stripped = text.strip()
                    _start = _stripped.find('{')
                    try:
                        _obj, _ = json.JSONDecoder().raw_decode(_stripped[_start:] if _start != -1 else _stripped)
                    except ValueError as exc:
                        raise CodexStreamTruncated(
                            "json_only is on but the answer is not valid JSON (%s). "
                            "Retrying with a fresh request. First 300 chars: %s"
                            % (exc, text[:300]))
                    if not isinstance(_obj, dict):
                        raise CodexStreamTruncated(
                            "json_only is on but the answer is not a JSON object. "
                            "Retrying with a fresh request. First 300 chars: %s" % text[:300])
                    print("[arkennemasis] json_only: leading JSON object kept, %d trailing chars dropped"
                          % (len(text) - len(json.dumps(_obj))))
                    text = json.dumps(_obj)"""
assert s.count(a1) == 1, 'anchor not unique/found'
s = s.replace(a1, r1)
open(path, 'w').write(s)
print('patched', path)
