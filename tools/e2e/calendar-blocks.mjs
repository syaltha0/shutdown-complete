import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';
import { demoAccount, iso, weekOf } from '../lib/demo.mjs';
import { feedProblem } from '../../server/src/calendar.mjs';

const shotsAt = 'reports/shots/calendar-blocks';
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const shot = async (page, name) => { if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png` }); };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const TZ = 'Europe/Istanbul';

// ---------- the feed address guard, on its own ----------
check('a feed on this machine is refused', (await feedProblem('http://127.0.0.1:8080/cal.ics')) === 'private' && (await feedProblem('http://localhost/cal.ics')) === 'private');
check('a feed on a private network is refused', (await feedProblem('http://10.0.0.5/cal.ics')) === 'private' && (await feedProblem('http://192.168.1.2/cal.ics')) === 'private');
check('only web addresses are feeds', (await feedProblem('ftp://example.org/cal.ics')) === 'url' && (await feedProblem('not a url')) === 'url');

// ---------- a calendar for today, in Istanbul time ----------
const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:review@test', 'SUMMARY:Design review', 'LOCATION:Room 2', 'DESCRIPTION:Agenda review', `DTSTART;TZID=${TZ}:${day}T160000`, `DTEND;TZID=${TZ}:${day}T163000`, 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:lunch@test', 'SUMMARY:Lunch with Ece', `DTSTART;TZID=${TZ}:${day}T120000`, `DTEND;TZID=${TZ}:${day}T123000`, 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:conf@test', 'SUMMARY:Conference week', `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${String(Number(day) + 1)}`, 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
const feed = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/calendar' }); res.end(ics); }).listen(0, '127.0.0.1');
await new Promise((ok) => feed.once('listening', ok));
const feedUrl = `http://127.0.0.1:${feed.address().port}/work.ics`;

const srv = await startServer({ env: { CALENDAR_ALLOW_PRIVATE: 'on' } });
const api = await demoAccount(client(srv.url), { lang: 'en' });
const D = iso(new Date());
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB', timezoneId: TZ, reducedMotion: 'reduce' });
await ctx.addCookies([{ name: 'sc_session', value: api.cookie.split('=')[1], url: srv.url }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
const doc = async (key) => (await api.get(key)).value;
const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.className || '');

try {
 const settings = await doc('settings');
 await api.put('settings', {...settings, calendars:[{id:'work',name:'Work',url:feedUrl}]});
 const initial = await doc('day:'+D);
 await api.put('day:'+D, {...initial, columns:[{id:'plan',from:480,blocks:[]}]});
 await page.goto(srv.url+'/day/'+D);
 const review=page.locator('.cal-event',{hasText:'Design review'});
 await review.waitFor();
 await review.focus(); await page.keyboard.press('Enter');
 await page.locator('.kb-pop').waitFor();
 check('Enter opens event actions',await page.locator('.kb-pop').isVisible());
 await page.keyboard.press('Escape');
 check('Escape closes actions',await page.locator('.kb-pop').count()===0);
 await review.click(); await page.getByRole('button',{name:'Make block',exact:true}).click(); await wait(1000);
 check('event becomes sourced shallow block',(await doc('day:'+D)).columns[0].blocks[0].source.uid==='review@test');
 check('event details become a note',(await doc('day:'+D)).columns[0].blocks[0].note==='Room 2\nAgenda review');
 await review.click(); await page.getByText('This event is already in the plan.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Make block',exact:true}).click(); await wait(800);
 check('duplicate prevented',(await doc('day:'+D)).columns[0].blocks.length===1);
 const lunch=page.locator('.cal-event',{hasText:'Lunch with Ece'});
 await lunch.click(); await page.getByRole('button',{name:'Make block and edit',exact:true}).click();
 await page.locator('dialog[open] #be-label').fill('Edited lunch'); await page.keyboard.press('Escape'); await wait(1000);
 check('edit flow persists',(await doc('day:'+D)).columns[0].blocks.some(b=>b.label==='Edited lunch'));

 // A conflict is skipped while the other calendar item is imported.
 const current = await doc('day:'+D);
 await api.put('day:'+D,{...current,columns:[{id:'plan',from:480,blocks:[{id:'busy',start:720,end:750,label:'Busy',note:'',kind:'shallow'}]}]});
 await page.reload(); await review.waitFor();
 await page.getByRole('button',{name:/Add calendar events/}).click(); await wait(1000);
 const batch=await doc('day:'+D);
 check('batch skips conflicts and imports free event',batch.columns[0].blocks.length===2 && batch.columns[0].blocks.some(b=>b.source?.uid==='review@test'));
 await page.getByRole('button',{name:'Revise from now',exact:true}).click();
 await page.locator('#rv-at').selectOption('630');
 await page.locator('dialog.sheet[open]').getByRole('button',{name:/^Revise from/}).click(); await wait(1000);
 check('revision keeps source metadata',(await doc('day:'+D)).columns.length===2 && (await doc('day:'+D)).columns[0].blocks.some(b=>b.source?.uid==='review@test'));

 await lunch.click(); await page.getByRole('button',{name:'Make block',exact:true}).click(); await wait(1000);
 const revised=await doc('day:'+D);
 check('new import uses active revision',revised.columns[1].blocks.some(b=>b.source?.uid==='lunch@test') && !revised.columns[0].blocks.some(b=>b.source?.uid==='lunch@test'));
 for (const width of [1440,390]) for (const lang of ['en','tr']) for (const theme of ['light','dark']) {
   await api.put('settings',{...(await doc('settings')),lang});
   await page.setViewportSize({width,height:900}); await page.reload(); await review.waitFor();
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await review.click(); await shot(page,width+'-'+lang+'-'+theme); await page.keyboard.press('Escape');
 }
 console.log(results.filter(Boolean).length+' passed, '+results.filter(x=>!x).length+' failed');
 if(results.some(x=>!x))process.exitCode=1;
} finally {await browser.close();srv.stop();feed.close();}
