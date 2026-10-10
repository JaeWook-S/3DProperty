#!/usr/bin/env node
// Fake OS commands for start.sh tests: no SSH, HTTP, GPU or npm server is used.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const state = process.env.TEST_LAUNCHER_STATE;
const record = entry => fs.appendFileSync(path.join(state, 'trace.jsonl'), JSON.stringify(entry) + '\n');
const portFile = port => path.join(state, `port-${port}.json`);
record({ command, args, pid: process.pid });

function service(port, body, worker = false) {
  fs.writeFileSync(portFile(port), JSON.stringify({ pid: process.pid, body }));
  if (worker) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    record({ worker_pid: child.pid });
  }
  const timer = setInterval(() => {}, 1000);
  const stop = signal => {
    record({ stopped: command, pid: process.pid, signal });
    fs.rmSync(portFile(port), { force: true });
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

if (command === 'ssh') {
  if (args.includes('-N')) {
    if (process.env.TEST_LAUNCHER_MODE === 'tunnel-fails') process.exit(255);
    const binding = args[args.indexOf('-L') + 1];
    service(binding.split(':')[1], 'api');
  } else {
    if (process.env.TEST_LAUNCHER_MODE === 'unreachable') {
      process.stderr.write('fake SSH host unreachable\n');
      process.exit(255);
    }
    process.stdout.write(JSON.stringify({ status: 'ok', ready: process.env.TEST_LAUNCHER_MODE !== 'not-ready' }));
  }
} else if (command === 'npm') {
  const directory = args[args.indexOf('--prefix') + 1];
  const app = directory.endsWith('/apps/web');
  record({ service: app ? 'web' : 'viewer', measurement: process.env.VITE_FURNITURE_MEASUREMENT_ENABLED, target: process.env.FURNITURE_API_TARGET });
  service(app ? 5185 : 5173, app ? '<button id="space-tab">' : '<div id="viewport">', true);
} else if (command === 'curl') {
  const address = args.find(arg => arg.startsWith('http://'));
  const url = new URL(address);
  const file = portFile(url.port);
  if (!fs.existsSync(file)) process.exit(7);
  const { body } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (url.pathname === '/health') {
    if (body !== 'api') process.exit(22);
    process.stdout.write(JSON.stringify({ status: 'ok', ready: true, busy: false }));
  } else {
    process.stdout.write(body);
  }
} else if (command === 'lsof') {
  const port = args.find(arg => arg.startsWith('-iTCP:')).split(':')[1];
  if (!fs.existsSync(portFile(port))) process.exit(1);
  process.stdout.write('fake listener\n');
} else {
  process.exit(1);
}
