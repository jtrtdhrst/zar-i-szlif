#!/usr/bin/env python3
# COMFY_PATCH_QC_REJECT_V1: ArkQCVerdict — REJECT fails the gate like fail;
# JSON null critic answer fails closed (controlled rejection, no NoneType).
# Target: <custom_nodes>/comfyui-arkennemasis/variation/qc.py (volume file).
# Idempotent. Run: python3 qc_reject_patch.py [path]
import sys
path = sys.argv[1] if len(sys.argv) > 1 else '/app/custom_nodes/comfyui-arkennemasis/variation/qc.py'
s = open(path).read()
if 'COMFY_PATCH_QC_REJECT_V1' in s:
    print('qc.py already patched')
    sys.exit(0)
a1 = """        try:
            data = json.loads(text)
            if not isinstance(data, dict):
                raise ValueError("not an object")"""
r1 = """        try:
            data = json.loads(text)
            # COMFY_PATCH_QC_REJECT_V1: a JSON null critic answer fails CLOSED
            # (controlled rejection) instead of raising "got NoneType" downstream.
            if data is None:
                print("[arkennemasis] QC %s: critic returned null - controlled FAIL" % key)
                return (False, str(original_prompt),
                        "critic returned null",
                        "QC NULL ANSWER - controlled FAIL (no verdict could be read).", 0.0)
            if not isinstance(data, dict):
                raise ValueError("not an object")"""
assert s.count(a1) == 1, 'anchor1 not unique/found'
s = s.replace(a1, r1)
a2 = '        passed = verdict != "fail"'
r2 = ('        # COMFY_PATCH_QC_REJECT_V1: REJECT fails the gate like fail. Previously\n'
      '        # only the exact string "fail" failed, so a "reject" verdict passed.\n'
      '        passed = verdict not in ("fail", "reject")')
assert s.count(a2) == 1, 'anchor2 not unique/found'
s = s.replace(a2, r2)
open(path, 'w').write(s)
print('patched', path)
