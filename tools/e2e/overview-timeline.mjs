import assert from 'node:assert/strict';
import { launch } from '../lib/browser.mjs';
import { startServer, client } from '../lib/server.mjs';
import { demoAccount, iso } from '../lib/demo.mjs';

const server = await startServer(), browser = await launch();
try {
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const api = await demoAccount(client(server.url), {today:noon});
  const key = 'day:' + iso(noon), original = (await api.get(key)).value;
  const block = (id, start, end, kind) => ({id, start, end, kind, label:`Timeline ${id} with a long descriptive name`, note:''});
  const blocks = [block('past',540,570,'personal'),block('current',660,780,'deep'),block('short',810,820,'meeting'),block('future',840,870,'shallow')];
  await api.put(key,{...original,columns:[{from:null,closedAt:null,blocks}],focus:{active:null,sessions:[]},shutdown:{done:false,at:null,steps:{}}});
  const context = await browser.newContext({reducedMotion:'reduce'});
  await context.addCookies([{name:'sc_session',value:api.cookie.split('=')[1],url:server.url}]);
  const page = await context.newPage(); await page.clock.install({time:noon});
  for (const [width,height] of [[1366,768],[1440,900],[1904,1015],[390,844]]) {
    await page.setViewportSize({width,height}); await page.goto(server.url);
    const links = page.locator('.b-timeline-block'); await links.last().waitFor();
    assert.equal(await links.count(),4);
    assert.ok((await links.nth(0).getAttribute('class')).includes('past'));
    assert.ok((await links.nth(1).getAttribute('class')).includes('current'));
    assert.ok(!(await links.nth(3).getAttribute('class')).includes('past'));
    const short = links.nth(2);
    assert.match(await short.getAttribute('aria-label'),/Timeline short.*13:30.*13:40/);
    assert.equal(await short.locator('i').evaluate(e=>getComputedStyle(e,'::before').content),'""','Short blocks retain a kind mark');
    await short.focus(); assert.ok(await short.locator('.b-timeline-tip').isVisible());
    assert.equal(await links.nth(1).locator('i span').evaluate(e=>getComputedStyle(e).textOverflow),'ellipsis');
    assert.equal(await short.locator('i span').evaluate(e=>getComputedStyle(e).visibility),'hidden','Narrow blocks show their mark and tooltip');
    const ticks = await page.locator('.b-ticks span').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
    for(let i=1;i<ticks.length;i++) assert.ok(ticks[i-1].right<=ticks[i].left);
  }
  console.log('PASS overview-timeline: four widths, short block accessible name and kind mark, keyboard tooltip, ellipsis, temporal states and aligned ticks');
} finally { await browser.close(); server.stop(); }
