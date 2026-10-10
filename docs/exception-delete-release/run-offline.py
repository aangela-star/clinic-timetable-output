"""Sanitized offline suites; all test scratch writes remain in this worktree."""
from pathlib import Path
import json
import signal
import subprocess
import unittest
import socket
import sys
import os

HARNESS = Path(__file__).resolve().parent
ROOT = HARNESS.parent.parent
PHASE = next((a[8:] for a in sys.argv if a.startswith("--phase=")), "suites")
if not PHASE.replace("-", "").isalnum():
    raise ValueError("phase must be a simple directory name")
OUT = ROOT / ".local/release-prep" / PHASE
OUT.mkdir(parents=True, exist_ok=False) if "--python-child" not in sys.argv else None
NODE = next((a[7:] for a in sys.argv if a.startswith('--node=')), '/Users/iaiangela/.local/bin/node')

if '--python-child' in sys.argv:
    def blocked(*args, **kwargs):
        raise RuntimeError('EVIDENCE_EXTERNAL_NETWORK_FORBIDDEN')
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked
    socket.getaddrinfo = blocked
    suite = unittest.defaultTestLoader.discover(str(ROOT / 'tests'), pattern='test_*.py')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(not result.wasSuccessful())

scratch = OUT / 'scratch'
scratch.mkdir(exist_ok=True)
env = {'PATH': '/usr/bin:/bin', 'TMPDIR': str(scratch),
       'NODE_OPTIONS': '--require=' + str(HARNESS / 'offline-guard.cjs')}
commands = {
    'node-full': [NODE, '--test', *[str(p.relative_to(ROOT)) for p in sorted((ROOT / 'tests').glob('*.test.cjs'))]],
    'python-full': [sys.executable, '-B', str(Path(__file__).resolve()), '--python-child'],
}
results = {}
for name, command in commands.items():
    with (OUT / (name + '.log')).open('wb') as log:
        proc = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = proc.wait(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            code = proc.wait()
        finally:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    results[name] = {'command': command, 'exit_code': code}
    print(name, code, flush=True)
(OUT / 'commands-full.json').write_text(json.dumps(results, indent=2) + '\n')
sys.exit(any(r['exit_code'] != 0 for r in results.values()))
