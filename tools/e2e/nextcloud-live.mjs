// Explicitly authorized integration test. Never print credentials or persist them.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount } from '../lib/demo.mjs';
const ssh = (cmd, input) => spawnSync('ssh', ['-o', 'BatchMode=yes', 'homeserver', cmd], { input, encoding: 'utf8', timeout: 60000 });
const occ = args => ssh(`docker exec -u www-data nextcloud php occ ${args}`);
const results = [];
let srv, created = false, clean = false;
const check = (label, ok) => { results.push(`| ${label} | ${ok ? 'GEÇTİ' : 'KALDI'} |`); assert.ok(ok, label); };
try {
  const before = occ('user:info sc-test');
  assert.ok(before.status !== 0 && /not exist|not found/i.test(before.stdout + before.stderr), 'sc-test absence must be verified before creating it');
  const password = randomBytes(32).toString('hex');
  created = true;
  const add = ssh('bash -s', `docker exec -e OC_PASS=${password} -u www-data nextcloud php occ user:add --password-from-env sc-test\n`);
  assert.equal(add.status, 0, 'temporary account creation');
  const tokenResult = occ('user:auth-tokens:add --name=planner-live-test sc-test');
  assert.equal(tokenResult.status, 0, 'app token creation');
  const token = tokenResult.stdout.trim().split('\n').at(-1).replace(/^.*(?:password|token):\s*/i, '').trim();
  assert.ok(token && !token.includes(' '), 'app token format');
  const base = occ('config:system:get overwrite.cli.url').stdout.trim();
  assert.match(base, /^https:\/\//);
  const auth = `Basic ${Buffer.from(`sc-test:${token}`).toString('base64')}`;
  const remote = async (method, path, body, extra = {}) => fetch(`${base}/remote.php/dav/calendars/sc-test/${path}`, { method, headers: { authorization: auth, 'content-type': 'text/calendar', ...extra }, body });
  srv = await startServer();
  const api = await demoAccount(client(srv.url));
  await api.put('inbox', { lists: [{ id: 'live', name: 'Integration test' }], items: [{ id: 'live-parent', text: 'Original', done: false, list: 'live', due: '2026-11-20', dueTime: '14:30', steps: [{ id: 'live-child', text: 'Child', done: false }] }] });
  const linked = await api.call('/api/account/nextcloud', { url: base, username: 'sc-test', password: token }, 'PUT');
  check('Public HTTPS discovery and authenticated davsync', linked.status === 200 && !linked.body.error);
  const sync = async () => { const r = await api.call('/api/account/nextcloud/sync', {}); assert.equal(r.body.result?.ok, true, 'sync succeeds'); };
  const read = async () => (await api.get('inbox')).value;
  let r = await remote('GET', 'sc-live/live-parent.ics');
  let ics = await r.text();
  check('Planner → Nextcloud list, task and UTC timed due', r.status === 200 && /DUE:\d{8}T\d{6}Z/.test(ics));
  check('Planner → Nextcloud RELATED-TO child', (await (await remote('GET', 'sc-live/live-child.ics')).text()).includes('RELATED-TO;RELTYPE=PARENT:live-parent'));
  r = await remote('PUT', 'sc-live/live-parent.ics', ics.replace('SUMMARY:Original', 'SUMMARY:Remote edit').replace('END:VTODO', 'X-LIVE-PRESERVE:yes\r\nEND:VTODO'), { 'if-match': r.headers.get('etag') });
  check('Nextcloud accepts conditional update', r.status < 300);
  await sync();
  check('Nextcloud → planner update', (await read()).items.find(t => t.id === 'live-parent').text === 'Remote edit');
  let doc = await read();
  await api.put('inbox', { ...doc, items: doc.items.map(t => t.id === 'live-parent' ? { ...t, text: 'Local edit', done: true } : t) });
  await sync();
  ics = await (await remote('GET', 'sc-live/live-parent.ics')).text();
  check('Planner edit, completion and opaque property round trip', ics.includes('SUMMARY:Local edit') && ics.includes('STATUS:COMPLETED') && ics.includes('X-LIVE-PRESERVE:yes'));
  check('Nextcloud rejects stale ETag with 412', (await remote('PUT', 'sc-live/live-parent.ics', ics, { 'if-match': '"stale"' })).status === 412);
  const recurring = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Integration//EN\r\nBEGIN:VTODO\r\nUID:live-repeat\r\nSUMMARY:Repeat\r\nDUE;VALUE=DATE:20261120\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
  check('Nextcloud creates completed recurring task', (await remote('PUT', 'sc-live/live-repeat.ics', recurring, { 'if-none-match': '*' })).status < 300);
  await sync();
  check('Completed recurrence rolls to next date', (await read()).items.some(t => t.id === 'live-repeat' && !t.done && t.due === '2026-11-21'));
  const rolled = await (await remote('GET', 'sc-live/live-repeat.ics')).text();
  check('Rolled recurrence immediately returns to Nextcloud', rolled.includes('DUE;VALUE=DATE:20261121') && rolled.includes('STATUS:NEEDS-ACTION'));
  await remote('DELETE', 'sc-live/live-child.ics'); await sync();
  check('Nextcloud → planner child deletion', !(await read()).items.find(t => t.id === 'live-parent').steps?.length);
  doc = await read(); await api.put('inbox', { ...doc, items: doc.items.filter(t => t.id !== 'live-parent') }); await sync();
  check('Planner → Nextcloud deletion', (await remote('GET', 'sc-live/live-parent.ics')).status === 404);
  await remote('DELETE', 'sc-live/'); await sync();
  check('Nextcloud → planner list deletion', !(await read()).lists.some(l => l.id === 'live'));
} catch (e) {
  results.push(`| Run | KALDI: ${e instanceof assert.AssertionError ? e.message.split('\n')[0] : 'runtime error (credentials suppressed)'} |`);
  process.exitCode = 1;
} finally {
  srv?.stop();
  if (created) {
    const del = occ('user:delete sc-test');
    const verify = occ('user:info sc-test');
    clean = del.status === 0 && verify.status !== 0 && /not exist|not found/i.test(verify.stdout + verify.stderr);
    results.push(`| Cleanup: user:delete + user:info sc-test | ${clean ? 'GEÇTİ: deleted, user does not exist' : 'KALDI: manual verification required'} |`);
    if (!clean) process.exitCode = 1;
  }
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/2026-11-13-caldav-live.md', '# Canlı Nextcloud doğrulaması\n\nPublic HTTPS üzerinden gerçek Nextcloud; yalnız geçici sc-test hesabı. Parola ve uygulama anahtarı dosyaya yazılmadı.\n\n| Senaryo | Sonuç |\n|---|---|\n' + results.join('\n') + '\n\n## KULLANICIYA\nDAVx5 üzerinde her listeyi yalnız bir hesaptan seçin; daha önce seçilmiş çift listeleri telefonda kaldırın. Nextcloud eşitlemesinden sonra doğrudan hesapta liste keşfini yenileyin. TZ değişkenini planlayıcının hedef saat dilimine ayarlayın. Ev DNS adresleri için ICS alan adını CALENDAR_PRIVATE_HOSTS ile izinli kılın; CALENDAR_ALLOW_PRIVATE kullanmayın. README ters vekil kontrol listesini uygulayın.\n\n## RİSK ve sınırlar\nFiziksel DAVx5/tasks.org/telefon takvimi oturumu ve gerçek istemci ağ kaydı yok; e2e protokol akışlarını taklit eder. Tasks.org fixture kaynağı: https://github.com/tasks/tasks/issues/2158 (takvim zarfı eklenmiştir). Nextcloud Tasks web arayüzünden bağımsız fixture alınmadı; canlı veriler CalDAV ile oluşturuldu. Canlı ICS aboneliği/yayını ayrıca denenmedi; birim testleri mevcut. Karmaşık tekrar kümeleri (BYSETPOS, EXDATE vb.) aynen korunur; tamamlandığında planlayıcı bunları ilerletmez. Özel VTIMEZONE tanımları korunur ancak IANA dışı özel TZID hesaplaması desteklenmez. Planlayıcı tarih/saat modeli sunucu TZ ayarını kullanır; farklı telefon diliminde mutlak an UTC ile korunur. Bu çalışma üretime dağıtım yapmaz.\n');
  console.log(results.join('\n'));
}
