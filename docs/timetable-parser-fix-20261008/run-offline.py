"""Sanitized offline suites; all test scratch writes remain in this worktree."""
from pathlib import Path
import json
import signal
import subprocess
import unittest
import socket
import sys
import os

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent
NODE = '/Users/iaiangela/.local/bin/node'

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
       'NODE_OPTIONS': '--require=' + str(OUT / 'offline-guard.cjs')}
commands = {
    'node-full': [NODE, '--test', *[str(p.relative_to(ROOT)) for p in sorted((ROOT / 'tests').glob('*.test.cjs'))]],
    'python-full': [sys.executable, '-B', str(Path(__file__).resolve()), '--python-child'],
}
if '--red' in sys.argv or '--green' in sys.argv:
    phase = 'red' if '--red' in sys.argv else 'green'
    commands = {phase: [NODE, '--test', 'tests/publish_target.test.cjs', 'tests/timetable_parser_realhtml.test.cjs']}
else:
    phase = 'full'
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
(OUT / ('commands-' + phase + '.json')).write_text(json.dumps(results, indent=2) + '\n')
