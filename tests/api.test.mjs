// API-Tests: starten einen PHP-Entwicklungsserver mit temporärem Speicher.
// Aufruf: node --test tests/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

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
    env: { ...process.env, TM_STORAGE: storage, TM_PHOTOS: photos, TM_CREATE_PER_IP: '1000', TM_CREATE_GLOBAL: '1000' },
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

test('nach 10 Fehlversuchen wird gesperrt, auch der richtige PIN', async () => {
  const { json: t } = await create();
  const wrong = t.pin === '1234' ? '4321' : '1234';
  const body = { id: t.id, version: 1, data: sample() };
  for (let i = 0; i < 10; i++) {
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

test('Turnier-Dateien liegen nur im Speicherordner, der PIN ist nur dort lesbar', () => {
  const files = readdirSync(join(storage, 'tournaments')).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  const doc = JSON.parse(readFileSync(join(storage, 'tournaments', files[0]), 'utf8'));
  assert.match(doc.pin, /^\d{4}$/);
  assert.equal(doc.pinHash, undefined);
  assert.ok(!existsSync(join(root, 'public', 'data', files[0])));
});

// ------------------------------------------------------------ Nachträglich ergänzte Prüfungen

test('Admin kann den PIN jederzeit abrufen, alle anderen nicht', async () => {
  const { json: t } = await create();
  const adminH = { 'X-Admin': ADMIN };
  const got = await call('get_pin', { body: { id: t.id }, headers: adminH });
  assert.equal(got.status, 200);
  assert.equal(got.json.pin, t.pin);
  assert.equal((await call('get_pin', { body: { id: t.id }, headers: { 'X-Pin': t.pin } })).status, 403, 'PIN-Inhaber darf nicht über den Admin-Weg');
  assert.equal((await call('get_pin', { body: { id: t.id } })).status, 401);
  const reset = await call('reset_pin', { body: { id: t.id }, headers: adminH });
  assert.equal((await call('get_pin', { body: { id: t.id }, headers: adminH })).json.pin, reset.json.pin);
});

test('der PIN taucht in load und list nie auf', async () => {
  const { json: t } = await create();
  const loaded = await call('load', { method: 'GET', query: `&id=${t.id}` });
  assert.equal(loaded.json.pin, undefined);
  assert.ok(!JSON.stringify(loaded.json).includes(t.pin) || !JSON.stringify(loaded.json).includes('"pin"'));
  const list = await call('list', { method: 'GET', headers: { 'X-Admin': ADMIN } });
  assert.ok(!JSON.stringify(list.json).includes('"pin"'));
  const conflict = await call('update', { body: { id: t.id, version: 99, data: sample() }, headers: { 'X-Pin': t.pin } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.current.pin, undefined);
});

test('ältere Turniere ohne lesbaren PIN funktionieren weiter, get_pin liefert null', async () => {
  const hash = execFileSync('php', ['-r', "echo password_hash('1234', PASSWORD_BCRYPT);"]).toString();
  const now = new Date().toISOString();
  const doc = { id: 'LGCY22', version: 1, createdAt: now, updatedAt: now, previousId: null, hidden: false, pinHash: hash, phase: 'group', players: [], matches: [] };
  writeFileSync(join(storage, 'tournaments', 'LGCY22.json'), JSON.stringify(doc));
  assert.equal((await call('verify', { query: '&id=LGCY22', headers: { 'X-Pin': '1234' } })).status, 200);
  assert.equal((await call('get_pin', { body: { id: 'LGCY22' }, headers: { 'X-Admin': ADMIN } })).json.pin, null);
  const reset = await call('reset_pin', { body: { id: 'LGCY22' }, headers: { 'X-Admin': ADMIN } });
  assert.equal((await call('verify', { query: '&id=LGCY22', headers: { 'X-Pin': reset.json.pin } })).status, 200);
  assert.equal((await call('get_pin', { body: { id: 'LGCY22' }, headers: { 'X-Admin': ADMIN } })).json.pin, reset.json.pin);
});

test('ein veralteter Admin-Code blockiert einen gültigen PIN nicht', async () => {
  const { json: t } = await create();
  for (let i = 0; i < 4; i++) {
    const r = await call('update', { body: { id: t.id, version: i + 1, data: sample({ phase: 'group' }) }, headers: { 'X-Admin': 'veralteter-code-123456', 'X-Pin': t.pin } });
    assert.equal(r.status, 200, `Versuch ${i + 1}`);
  }
});

test('gleichzeitige Fehlversuche umgehen die Sperre nicht', async () => {
  const { json: t } = await create();
  const wrong = t.pin === '1234' ? '4321' : '1234';
  const results = await Promise.all(Array.from({ length: 60 }, () => call('verify', { query: `&id=${t.id}`, headers: { 'X-Pin': wrong } })));
  const evaluated = results.filter((r) => r.status === 403).length;
  assert.ok(evaluated <= 10, `${evaluated} Versuche wurden geprüft (erlaubt: 10)`);
  assert.ok(results.filter((r) => r.status === 429).length >= 50);
});

test('Admin setzt den PIN neu und hebt damit die Sperre auf', async () => {
  const { json: t } = await create();
  const wrong = t.pin === '1234' ? '4321' : '1234';
  for (let i = 0; i < 11; i++) await call('verify', { query: `&id=${t.id}`, headers: { 'X-Pin': wrong } });
  assert.equal((await call('verify', { query: `&id=${t.id}`, headers: { 'X-Pin': t.pin } })).status, 429);
  const reset = await call('reset_pin', { body: { id: t.id }, headers: { 'X-Admin': ADMIN } });
  assert.equal((await call('verify', { query: `&id=${t.id}`, headers: { 'X-Pin': reset.json.pin } })).status, 200);
});

test('falsche Datentypen führen zu einer sauberen JSON-Antwort statt zu PHP-Warnungen', async () => {
  const { json: prev } = await create();
  const res = await call('create', { body: { data: sample(), previousId: prev.id, previousPin: [1] } });
  assert.equal(res.status, 401);
  assert.ok(res.json?.error);
  const res2 = await call('create', { body: { data: sample(), previousId: ['x'] } });
  assert.equal(res2.status, 404);
  const res3 = await call('update', { body: { id: ['A'], version: 1, data: sample() } });
  assert.equal(res3.status, 400);
  assert.equal((await call('load', { method: 'GET', query: '&id[]=A' })).status, 400);
});

test('Foto: zu grosse Pixelzahl wird vor dem Dekodieren abgelehnt', async () => {
  const { json: t } = await create();
  // PNG-Kopf mit 30000 x 30000 Pixeln, nur wenige Bytes gross
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(30000, 0); ihdr.writeUInt32BE(30000, 4); ihdr[8] = 1; ihdr[9] = 0;
  const bomb = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
  const f = new FormData(); f.append('photo', new Blob([bomb], { type: 'image/png' }), 'b.png');
  const started = Date.now();
  const res = await fetch(`${BASE}?action=photo&id=${t.id}`, { method: 'POST', headers: { 'X-Pin': t.pin }, body: f });
  assert.equal(res.status, 413);
  assert.ok(Date.now() - started < 3000, 'wurde schnell abgelehnt');
});

test('Löschen entfernt Turnier und Foto', async () => {
  const { json: t } = await create();
  const f = new FormData(); f.append('photo', new Blob([PNG], { type: 'image/png' }), 'a.png');
  assert.equal((await fetch(`${BASE}?action=photo&id=${t.id}`, { method: 'POST', headers: { 'X-Pin': t.pin }, body: f })).status, 200);
  assert.ok(existsSync(join(photos, `${t.id}.jpg`)));
  assert.equal((await call('delete', { body: { id: t.id }, headers: { 'X-Admin': ADMIN } })).status, 200);
  assert.ok(!existsSync(join(photos, `${t.id}.jpg`)));
  assert.ok(!existsSync(join(storage, 'tournaments', `${t.id}.json`)));
});

test('Erstellen ist pro Adresse begrenzt, der Admin nicht (Server mit echten Grenzwerten)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tm-limit-'));
  const hash = execFileSync('php', ['-r', `echo password_hash('${ADMIN}', PASSWORD_BCRYPT);`]).toString();
  writeFileSync(join(dir, 'config.php'), `<?php return ['admin_hash' => '${hash}'];`);
  const port = 8766;
  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', join(root, 'public')], { env: { ...process.env, TM_STORAGE: dir, TM_PHOTOS: dir }, stdio: 'ignore' });
  try {
    const url = `http://127.0.0.1:${port}/api.php?action=create`;
    for (let i = 0; i < 50; i++) { try { await fetch(url, { method: 'POST', body: '{}' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const make = (headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ data: sample() }) });
    const statuses = [];
    // Gefälschte X-Forwarded-For-Werte dürfen das Limit nicht aushebeln
    for (let i = 0; i < 7; i++) statuses.push((await make({ 'X-Forwarded-For': `198.51.100.${i}` })).status);
    assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429, 429]);
    assert.equal((await make({ 'X-Admin': ADMIN })).status, 201);
  } finally {
    srv.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
