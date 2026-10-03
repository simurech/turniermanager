// API-Tests: starten einen PHP-Entwicklungsserver mit temporärem Speicher.
// Aufruf: node --test tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}/api.php`;
const ADMIN = 'ein-langer-admin-code-123';
// Gültiges 16x16-PNG, von PHP erzeugt
const PNG = Buffer.from(
  execFileSync('php', ['-r', 'ob_start(); imagepng(imagecreatetruecolor(16, 16)); echo base64_encode(ob_get_clean());']).toString(),
  'base64',
);

let server, storage, photos;

const sample = (extra = {}) => ({
  config: { numPlayers: 4 },
  players: [{ id: 1, name: 'Marco', team: 'Liverpool' }, { id: 2, name: 'Simon & Co', team: '' }],
  matches: [],
  phase: 'setup',
  ...extra,
});

async function call(action, { method = 'POST', query = '', body, headers = {}, raw } = {}) {
  const res = await fetch(`${BASE}?action=${action}${query}`, {
    method,
    headers: raw ? headers : { 'Content-Type': 'application/json', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// Jeder Aufruf kommt von einer anderen (gefälschten) IP, damit das Erstellungslimit nicht stört.
let ipCounter = 0;
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const create = (extra = {}, headers = {}) =>
  call('create', { body: { data: sample(extra.data), ...extra.top }, headers: { 'X-Forwarded-For': nextIp(), ...headers } });

before(async () => {
  storage = mkdtempSync(join(tmpdir(), 'tm-store-'));
  photos = mkdtempSync(join(tmpdir(), 'tm-photos-'));
  const hash = execFileSync('php', ['-r', `echo password_hash('${ADMIN}', PASSWORD_BCRYPT);`]).toString();
  writeFileSync(join(storage, 'config.php'), `<?php return ['admin_hash' => '${hash}'];`);
  server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', join(root, 'public')], {
    env: { ...process.env, TM_STORAGE: storage, TM_PHOTOS: photos },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}?action=list`); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('PHP-Server startet nicht');
});

after(() => {
  server?.kill();
  rmSync(storage, { recursive: true, force: true });
  rmSync(photos, { recursive: true, force: true });
});

test('create liefert ID und 4-stelligen PIN, load zeigt nie den Hash', async () => {
  const { status, json } = await create();
  assert.equal(status, 201);
  assert.match(json.id, /^[A-NP-Z2-9]{6}$/);
  assert.match(json.pin, /^\d{4}$/);
  const loaded = await call('load', { method: 'GET', query: `&id=${json.id}` });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.json.pinHash, undefined);
  assert.equal(loaded.json.players[1].name, 'Simon & Co', 'kein htmlspecialchars mehr');
  assert.equal(loaded.json.version, 1);
});

test('update braucht PIN, falscher PIN wird abgelehnt, richtiger speichert', async () => {
  const { json: t } = await create();
  const data = sample({ phase: 'group' });
  assert.equal((await call('update', { body: { id: t.id, version: 1, data } })).status, 401);
  assert.equal((await call('update', { body: { id: t.id, version: 1, data }, headers: { 'X-Pin': t.pin === '0000' ? '1111' : '0000' } })).status, 403);
  const ok = await call('update', { body: { id: t.id, version: 1, data }, headers: { 'X-Pin': t.pin } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.version, 2);
  const loaded = await call('load', { method: 'GET', query: `&id=${t.id}` });
  assert.equal(loaded.json.phase, 'group');
});

test('veraltete Version gibt 409 mit aktuellem Stand', async () => {
  const { json: t } = await create();
  const h = { 'X-Pin': t.pin };
  await call('update', { body: { id: t.id, version: 1, data: sample({ phase: 'group' }) }, headers: h });
  const conflict = await call('update', { body: { id: t.id, version: 1, data: sample({ phase: 'finished' }) }, headers: h });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.current.phase, 'group');
  assert.equal(conflict.json.current.pinHash, undefined);
});

test('nach 5 Fehlversuchen wird gesperrt, auch der richtige PIN', async () => {
  const { json: t } = await create();
  const wrong = t.pin === '1234' ? '4321' : '1234';
  const body = { id: t.id, version: 1, data: sample() };
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('update', { body, headers: { 'X-Pin': wrong } })).status, 403);
  }
  const blocked = await call('update', { body, headers: { 'X-Pin': t.pin } });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.json.retryAfter > 0);
});

test('Validierung: Phase, Spielerzahl, Textlänge, Feldname, Grösse', async () => {
  assert.equal((await create({ data: { phase: 'hacked' } })).status, 400);
  assert.equal((await create({ data: { players: Array.from({ length: 9 }, (_, i) => ({ id: i, name: 'x' })) } })).status, 400);
  assert.equal((await create({ data: { name: 'x'.repeat(200) } })).status, 400);
  assert.equal((await create({ data: { config: { 'bad key!': 1 } } })).status, 400);
  const huge = await call('create', { raw: 'x'.repeat(300000), headers: { 'Content-Type': 'application/json' } });
  assert.equal(huge.status, 413);
  assert.equal((await call('create', { raw: 'kein json' })).status, 400);
  assert.equal((await call('load', { method: 'GET', query: '&id=../../x' })).status, 400);
});

test('unbekannte Felder werden verworfen', async () => {
  const { json: t } = await create({ data: { pinHash: 'evil', hidden: true, version: 99 } });
  const loaded = await call('load', { method: 'GET', query: `&id=${t.id}` });
  assert.equal(loaded.json.hidden, false);
  assert.equal(loaded.json.version, 1);
});

test('list: öffentlich ohne Hash, versteckte nur für Admin', async () => {
  const { json: t } = await create({ data: { name: 'Versteckt' } });
  const adminH = { 'X-Admin': ADMIN };
  assert.equal((await call('hide', { body: { id: t.id, hidden: true }, headers: { 'X-Pin': t.pin } })).status, 403, 'PIN darf nicht verstecken');
  assert.equal((await call('hide', { body: { id: t.id, hidden: true }, headers: adminH })).status, 200);
  const publicList = await call('list', { method: 'GET' });
  assert.ok(!publicList.json.tournaments.some(x => x.id === t.id));
  assert.ok(!JSON.stringify(publicList.json).includes('pinHash'));
  const adminList = await call('list', { method: 'GET', headers: adminH });
  assert.equal(adminList.json.isAdmin, true);
  assert.equal(adminList.json.tournaments.find(x => x.id === t.id)?.hidden, true);
});

test('Admin kann bearbeiten, PIN zurücksetzen und löschen', async () => {
  const { json: t } = await create();
  const adminH = { 'X-Admin': ADMIN };
  assert.equal((await call('update', { body: { id: t.id, version: 1, data: sample({ phase: 'group' }) }, headers: adminH })).status, 200);
  const reset = await call('reset_pin', { body: { id: t.id }, headers: adminH });
  assert.match(reset.json.pin, /^\d{4}$/);
  const withNew = await call('update', { body: { id: t.id, version: 3, data: sample() }, headers: { 'X-Pin': reset.json.pin } });
  assert.equal(withNew.status, 200);
  assert.equal((await call('delete', { body: { id: t.id }, headers: adminH })).status, 200);
  assert.equal((await call('load', { method: 'GET', query: `&id=${t.id}` })).status, 404);
});

test('falscher Admin-Code wird abgelehnt', async () => {
  const res = await call('admin_check', { headers: { 'X-Admin': 'falsch-falsch-falsch' } });
  assert.equal(res.status, 403);
  assert.equal((await call('admin_check', { headers: { 'X-Admin': ADMIN } })).status, 200);
});

test('Vorgänger: nur mit dessen PIN oder als Admin', async () => {
  const { json: prev } = await create({ data: { phase: 'finished' } });
  assert.equal((await create({ top: { previousId: prev.id } })).status, 401);
  const wrong = prev.pin === '1234' ? '4321' : '1234';
  assert.equal((await create({ top: { previousId: prev.id, previousPin: wrong } })).status, 403);
  const ok = await create({ top: { previousId: prev.id, previousPin: prev.pin } });
  assert.equal(ok.status, 201);
  const loaded = await call('load', { method: 'GET', query: `&id=${ok.json.id}` });
  assert.equal(loaded.json.previousId, prev.id);
  const viaAdmin = await create({ top: { previousId: prev.id } }, { 'X-Admin': ADMIN });
  assert.equal(viaAdmin.status, 201);
  assert.equal((await create({ top: { previousId: 'ZZZZZZ' } })).status, 404);
});

test('Foto: braucht PIN, nur Bilder, wird als JPEG gespeichert', async () => {
  const { json: t } = await create({}, { 'X-Admin': ADMIN });
  const form = (bytes, type, name) => {
    const f = new FormData();
    f.append('photo', new Blob([bytes], { type }), name);
    return f;
  };
  const post = (f, headers = {}) => fetch(`${BASE}?action=photo&id=${t.id}`, { method: 'POST', body: f, headers });

  assert.equal((await post(form(PNG, 'image/png', 'a.png'))).status, 401);
  const bad = await post(form(Buffer.from('<?php echo 1; ?>'), 'image/png', 'a.png'), { 'X-Pin': t.pin });
  assert.equal(bad.status, 400);
  const ok = await post(form(PNG, 'image/png', 'a.png'), { 'X-Pin': t.pin });
  assert.equal(ok.status, 200);
  assert.ok(existsSync(join(photos, `${t.id}.jpg`)));
  const bytes = readFileSync(join(photos, `${t.id}.jpg`));
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8], 'JPEG-Signatur');
  const loaded = await call('load', { method: 'GET', query: `&id=${t.id}` });
  assert.equal(loaded.json.hasPhoto, true);
});

test('Erstellen pro IP ist begrenzt, Admin nicht', async () => {
  let last;
  const sameIp = { 'X-Forwarded-For': '203.0.113.7' };
  for (let i = 0; i < 6; i++) last = await create({}, sameIp);
  assert.equal(last.status, 429);
  assert.equal((await create({}, { 'X-Admin': ADMIN })).status, 201);
});

test('Turnier-Dateien liegen nur im Speicherordner und enthalten nur Hashes', () => {
  const files = readdirSync(join(storage, 'tournaments')).filter(f => f.endsWith('.json'));
  assert.ok(files.length > 0);
  const doc = JSON.parse(readFileSync(join(storage, 'tournaments', files[0]), 'utf8'));
  assert.match(doc.pinHash, /^\$2y\$/);
  assert.ok(!existsSync(join(root, 'public', 'data', files[0])));
});
