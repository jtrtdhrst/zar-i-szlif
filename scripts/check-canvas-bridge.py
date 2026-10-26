#!/usr/bin/env python3
"""E2E canvas bridge (regression test for mcp/comfyui/canvas-bridge/).

Simulates a sharing browser tab against the exact bridge.js protocol, then
verifies the agent path end to end: heartbeat delivers the read command, ack
stores the snapshot, agent result returns it, node 1 filename resolves, and MCP
get_image downloads the identical bytes (SHA vs /view) as decodable pixels.
Set COMFY_BASE / MCP_BASE env to target another deployment.
"""
import json, subprocess, base64, hashlib, time, urllib.request, urllib.error, os
BASE = os.environ.get('COMFY_BASE', 'https://comfy.kompaszbiorek.pl')
MCP = os.environ.get('MCP_BASE', 'https://mcp-comfy.kompaszbiorek.pl/mcp')
FAILS = []
def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'curl/8.14.1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.load(r)
def get(path):
    req = urllib.request.Request(BASE + path, headers={'User-Agent': 'curl/8.14.1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.load(r)
def check(name, cond, extra=''):
    print(('PASS' if cond else 'FAIL'), name, extra)
    if not cond: FAILS.append(name)
def mcp_sid():
    c = ['curl', '-s', '--max-time', '30', '-X', 'POST', MCP, '-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream', '-H', 'User-Agent: curl/8.14.1', '-d', json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'e2e', 'version': '1'}}}), '-D', '-', '-o', '/tmp/m.txt']
    out = subprocess.run(c, capture_output=True, text=True, timeout=40).stdout
    for line in out.splitlines():
        if line.lower().startswith('mcp-session-id:'):
            return line.split(':', 1)[1].strip()
    raise RuntimeError('no sid')
def mcp_call(name, args, sid, i, timeout=120):
    c = ['curl', '-s', '--max-time', str(timeout), '-X', 'POST', MCP, '-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream', '-H', 'User-Agent: curl/8.14.1', '-H', 'Mcp-Session-Id: ' + sid, '-H', 'Mcp-Protocol-Version: 2025-03-26', '-d', json.dumps({'jsonrpc': '2.0', 'id': i, 'method': 'tools/call', 'params': {'name': name, 'arguments': args}})]
    t = subprocess.run(c, capture_output=True, text=True, timeout=timeout + 20).stdout
    return json.loads([ln for ln in t.splitlines() if ln.startswith('data: ')][0][6:])
# 1. idle status
s, c = post('/arkennemasis/mcp/browser/connection-status', {})
check('status-waiting-no-tabs', s == 200 and c.get('state') in ('waiting', 'online'), str(c)[:90])
# 2. register (browser tab)
s, reg = post('/arkennemasis/mcp/browser/register', {'client_id': 'e2e-tab-1', 'title': 'e2e canvas'})
check('register', s == 200 and 'session_secret' in reg, 'sid=' + reg.get('session_id', '?')[:8])
SID, SEC = reg['session_id'], reg['session_secret']
# 3. agent enqueues read
s, rd = post('/arkennemasis/mcp/agent/read', {})
check('agent-read-enqueued', s == 200 and rd.get('session_id') == SID and 'request_id' in rd, 'rid=' + str(rd.get('request_id', '?'))[:8])
RID = rd['request_id']
# 4. heartbeat delivers the read command
s, hb = post('/arkennemasis/mcp/browser/heartbeat', {'session_id': SID, 'session_secret': SEC, 'client_id': 'e2e-tab-1', 'title': 'e2e canvas'})
cmds = hb.get('commands', []) if isinstance(hb, dict) else []
hit = [c for c in cmds if c.get('request_id') == RID and c.get('command') == 'read' and c.get('session_id') == SID]
check('heartbeat-delivers-read', s == 200 and len(hit) == 1, 'cmds=%d' % len(cmds))
# 5. tab acks with faithful snapshot (bridge.js snapshot() shape)
snapshot = {'workflow': {'nodes': [{'id': 1, 'type': 'LoadImage'}]}, 'prompt': None, 'prompt_error': None, 'revision': 'e2e-rev-1', 'nodes': [{'id': 1, 'type': 'LoadImage', 'title': 'photo in', 'widgets': [{'name': 'image', 'value': 'loop_accepted_20261026_00001_.png', 'index': 0, 'serialized': True}]}], 'info': {'workflow_id': 'e2e-wf', 'workflow_name': 'e2e', 'undo_available': False}}
s, ak = post('/arkennemasis/mcp/browser/ack', {'session_id': SID, 'session_secret': SEC, 'request_id': RID, 'result': snapshot})
check('ack-stored', s == 200 and ak.get('ok') is True, str(ak)[:60])
# 6. agent fetches result, extracts node 1 filename
s, rs = get('/arkennemasis/mcp/agent/result?request_id=' + RID)
got = s == 200 and rs.get('status') == 'done' and isinstance(rs.get('result'), dict)
check('agent-result-snapshot', got, 'status=' + str(rs.get('status')))
fn = None
if got:
    for n in rs['result'].get('nodes', []):
        if str(n.get('id')) == '1':
            for w in n.get('widgets', []):
                if w.get('name') == 'image':
                    fn = w.get('value')
check('node1-filename', fn == 'loop_accepted_20261026_00001_.png', str(fn))
# 7. MCP downloads the actual bytes; compare with /view; decode pixels
sid = mcp_sid()
j = mcp_call('get_image', {'action': 'get', 'filename': fn, 'type': 'output'}, sid, 10, timeout=120)
img = [c for c in j['result']['content'] if isinstance(c, dict) and c.get('type') == 'image'][0]
raw = base64.b64decode(img['data'])
srv = urllib.request.urlopen(BASE + '/view?filename=' + fn + '&type=output', timeout=30).read()
check('mcp-bytes-match-server', hashlib.sha256(raw).hexdigest() == hashlib.sha256(srv).hexdigest(), '%d bytes' % len(raw))
open('/tmp/e2e_canvas.png', 'wb').write(raw)
from PIL import Image
im = Image.open('/tmp/e2e_canvas.png')
check('pixels-decodable', im.size[0] > 0 and im.size[1] > 0, '%dx%d %s' % (im.size[0], im.size[1], im.mode))
# 8. negative: bad secret heartbeat -> unknown_session
try:
    post('/arkennemasis/mcp/browser/heartbeat', {'session_id': SID, 'session_secret': 'wrong', 'client_id': 'x', 'title': 'x'})
    check('bad-secret-rejected', False, 'no error raised')
except urllib.error.HTTPError as e:
    body = json.load(e.fp)
    check('bad-secret-rejected', e.code == 404 and body.get('error', {}).get('code') == 'unknown_session', 'http=%d' % e.code)
# 9. negative: ack unknown request -> request_expired code
try:
    post('/arkennemasis/mcp/browser/ack', {'session_id': SID, 'session_secret': SEC, 'request_id': 'nope', 'result': {}})
    check('unknown-ack-expired', False, 'no error raised')
except urllib.error.HTTPError as e:
    body = json.load(e.fp)
    check('unknown-ack-expired', e.code == 410 and body.get('error', {}).get('code') == 'request_expired', 'http=%d' % e.code)
# 10. disconnect + sessions empty + status back to waiting
s, dc = post('/arkennemasis/mcp/browser/disconnect', {'session_id': SID, 'session_secret': SEC})
s, ses = get('/arkennemasis/mcp/agent/sessions')
check('sessions-empty-after-disconnect', s == 200 and ses.get('sessions') == [], str(ses)[:60])
s, c = post('/arkennemasis/mcp/browser/connection-status', {})
check('status-waiting-after-disconnect', s == 200 and c.get('state') == 'waiting', str(c)[:60])
print('FAILURES:', FAILS if FAILS else 'none')
sys_exit = 1 if FAILS else 0
raise SystemExit(sys_exit)
