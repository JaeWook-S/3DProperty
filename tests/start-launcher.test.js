import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, chmod, symlink, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const root = new URL('../', import.meta.url);

async function fixture(t, { mode = 'healthy', config = true, localPort = 8000, remotePort = 8000, occupied = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), '3dproperty-launcher-'));
  const bin = join(directory, 'bin');
  const state = join(directory, 'state');
  await mkdir(bin);
  await mkdir(state);
  await copyFile(new URL('start.sh', root), join(directory, 'start.sh'));
  const fake = join(bin, 'launcher-command.cjs');
  await copyFile(new URL('tests/fixtures/launcher-command.cjs', root), fake);
  await chmod(fake, 0o755);
  for (const command of ['ssh', 'curl', 'lsof', 'npm']) await symlink(fake, join(bin, command));
  for (const app of ['', 'apps/web']) {
    const modules = join(directory, app, 'node_modules/.bin');
    await mkdir(modules, { recursive: true });
    await symlink(fake, join(modules, 'vite'));
  }
  if (config) {
    const service = join(directory, 'services/furniture_pipeline');
    await mkdir(service, { recursive: true });
    const pem = join(directory, 'test.pem');
    await writeFile(pem, 'fake test key (never used by SSH)');
    await writeFile(join(service, 'runyour.env'), `RUNYOUR_HOST=test.invalid\nRUNYOUR_USER=ubuntu\nRUNYOUR_PEM="${pem}"\nRUNYOUR_LOCAL_API_PORT=${localPort}\nRUNYOUR_REMOTE_API_PORT=${remotePort}\n`);
  }
  for (const [port, body] of Object.entries(occupied)) {
    await writeFile(join(state, `port-${port}.json`), JSON.stringify({ pid: 2147483000, body }));
  }
  let output = '';
  const child = spawn('/bin/bash', [join(directory, 'start.sh')], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_LAUNCHER_STATE: state, TEST_LAUNCHER_MODE: mode },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const finished = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  const trace = async () => (await readFile(join(state, 'trace.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  async function stop(signal = 'SIGTERM') {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    const result = await Promise.race([finished, pause(5000).then(() => { throw new Error(`Launcher did not stop:\n${output}`); })]);
    return result;
  }
  t.after(async () => {
    await stop();
    // Each fake npm also forks a worker; cleanup must remove grandchildren.
    for (const entry of await trace()) {
      if (entry.worker_pid && alive(entry.worker_pid)) {
        process.kill(entry.worker_pid, 'SIGKILL');
        assert.fail(`Launcher orphaned worker ${entry.worker_pid}`);
      }
    }
    await rm(directory, { recursive: true, force: true });
  });
  async function started() {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (output.includes('시작 완료:')) return;
      if (child.exitCode !== null) assert.fail(`Launcher exited ${child.exitCode}:\n${output}`);
      await pause(40);
    }
    assert.fail(`Launcher startup timed out:\n${output}`);
  }
  return { child, directory, state, trace, stop, started, finished, output: () => output };
}

test('launcher checks GPU API, starts one tunnel and two webs, and Ctrl+C cleans process groups', async t => {
  const f = await fixture(t, { localPort: 8999, remotePort: 8123 });
  await f.started();
  const trace = await f.trace();
  const probes = trace.filter(entry => entry.command === 'ssh' && !entry.args.includes('-N'));
  const tunnels = trace.filter(entry => entry.command === 'ssh' && entry.args.includes('-N'));
  assert.equal(probes.length, 1);
  assert.match(probes[0].args.at(-1), /127\.0\.0\.1:8123\/health/);
  assert.equal(tunnels.length, 1);
  assert.ok(tunnels[0].args.includes('127.0.0.1:8999:127.0.0.1:8123'));
  assert.deepEqual(trace.filter(entry => entry.service).map(({ service, measurement, target }) => ({ service, measurement, target })), [
    { service: 'viewer', measurement: '1', target: 'http://127.0.0.1:8999' },
    { service: 'web', measurement: '1', target: 'http://127.0.0.1:8999' },
  ]);
  assert.equal((await f.stop('SIGINT')).code, 130);
  for (const port of [8999, 5173, 5185]) await assert.rejects(access(join(f.state, `port-${port}.json`)));
});

for (const mode of ['unreachable', 'not-ready', 'tunnel-fails']) {
  test(`launcher ${mode}: preserves both webs in preview-only mode`, async t => {
    const f = await fixture(t, { mode });
    await f.started();
    const trace = await f.trace();
    const webs = trace.filter(entry => entry.service);
    assert.equal(webs.length, 2);
    assert.ok(webs.every(entry => entry.measurement === '0'));
    assert.match(f.output(), /웹 전용 모드/);
    if (mode !== 'tunnel-fails') assert.equal(trace.filter(entry => entry.command === 'ssh' && entry.args.includes('-N')).length, 0);
  });
}

test('launcher without SSH configuration still starts both webs and never invokes SSH', async t => {
  const f = await fixture(t, { config: false });
  await f.started();
  const trace = await f.trace();
  assert.equal(trace.filter(entry => entry.command === 'ssh').length, 0);
  assert.deepEqual(trace.filter(entry => entry.service).map(entry => entry.measurement), ['0', '0']);
});

test('a lost tunnel is retired while both local webs stay running', async t => {
  const f = await fixture(t);
  await f.started();
  const tunnel = (await f.trace()).find(entry => entry.command === 'ssh' && entry.args.includes('-N'));
  process.kill(tunnel.pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (!f.output().includes('[연결 해제]') && Date.now() < deadline) await pause(40);
  assert.match(f.output(), /\[연결 해제\]/);
  assert.equal(f.child.exitCode, null);
  for (const port of [5173, 5185]) await access(join(f.state, `port-${port}.json`));
});

test('launcher reuses healthy existing services and does not remove them on shutdown', async t => {
  const occupied = { 8000: 'api', 5173: '<div id="viewport">', 5185: '<button id="space-tab">' };
  const f = await fixture(t, { occupied });
  await f.started();
  const trace = await f.trace();
  assert.equal(trace.filter(entry => entry.command === 'npm').length, 0);
  assert.equal(trace.filter(entry => entry.command === 'ssh' && entry.args.includes('-N')).length, 0);
  await f.stop();
  for (const [port, body] of Object.entries(occupied)) {
    assert.equal(JSON.parse(await readFile(join(f.state, `port-${port}.json`), 'utf8')).body, body);
  }
});

test('an unrelated API port is untouched and the launcher falls back to web-only', async t => {
  const f = await fixture(t, { occupied: { 8000: 'unrelated service' } });
  await f.started();
  const trace = await f.trace();
  assert.equal(trace.filter(entry => entry.command === 'ssh' && entry.args.includes('-N')).length, 0);
  assert.ok(trace.filter(entry => entry.service).every(entry => entry.measurement === '0'));
  await f.stop();
  await access(join(f.state, 'port-8000.json'));
});

test('an unrelated web port aborts safely and cleans only newly launched processes', async t => {
  const f = await fixture(t, { occupied: { 5185: 'unrelated service' } });
  const result = await f.finished;
  assert.equal(result.code, 1, f.output());
  assert.match(f.output(), /포트 5185/);
  await access(join(f.state, 'port-5185.json'));
  for (const port of [8000, 5173]) await assert.rejects(access(join(f.state, `port-${port}.json`)));
});
