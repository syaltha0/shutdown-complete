// Keep the full suite here; quick mode selects whole files without skipping assertions.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const suite = ["home-fit","overview-tasks","overview-open","overview-habits","overview-streak","overview-recent","overview-ahead","overview-weeks","features","signup","planner","tasks","caldav","extras","welcome","publication","calendar-views","calendar-blocks","focus","mobile","metrics","together","focus-widgets","mini-timer","focus-integration","focus-responsive","focus-fit","focus-align","focus-card-v2","tasks-v2","focus-render","week-focus","backup-restore","security","palette","notifications","server-status","plan-actual","load-errors","server-down","schedule-exceptions","conflict-draft","conflict-draft-fields","task-block-link","year","tasks-v3","calendar-drift","week-capacity","day-start","shutdown-handoff","week-experiment"];
const quick = ['signup','calendar-views','tasks-v2','focus','mobile','calendar-blocks','backup-restore','security','palette','day-start'];
let jobs = Math.max(1, Math.min(6, Math.floor(availableParallelism() / 2)));
let only; let smoke = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--quick') smoke = true;
  else if (args[i] === '--jobs') {
    jobs = Number(args[++i]);
    if (!Number.isInteger(jobs) || jobs < 1) throw Error('--jobs requires a positive integer');
  } else if (args[i] === '--only') {
    only = args[++i]?.split(',').map(x => x.replace(/\.mjs$/, ''));
    if (!only?.length || only.some(x => !suite.includes(x))) throw Error('--only requires known suite names');
  } else throw Error('Unknown argument: ' + args[i]);
}
const selected = (smoke ? quick : suite).filter(x => !only || only.includes(x));
if (!selected.length) throw Error('No tests selected');
const base = join(root, 'reports/tmp-e2e');
mkdirSync(base, {recursive:true});
const runDir = mkdtempSync(join(base, 'run-'));
const timingPath = join(base, 'timings.json');
let timings = {};
try { timings = JSON.parse(readFileSync(timingPath, 'utf8')); } catch { /* first run */ }
// Start expensive suites first; recorded durations replace these initial estimates.
const estimates = {"features":18739,"focus-card-v2":38667,"focus":49099,"signup":70743,"tasks":72156,"home-fit":76433,"overview-tasks":14019,"notifications":43796,"overview-open":19121,"overview-streak":17864,"overview-habits":22756,"overview-recent":20741,"caldav":8734,"overview-ahead":24516,"publication":6932,"overview-weeks":24095,"mobile":2482,"calendar-views":11819,"planner":123272,"calendar-blocks":16681,"focus-widgets":6134,"extras":34554,"focus-integration":4463,"together":16003,"metrics":19036,"focus-align":13615,"tasks-v2":21943,"week-focus":4872,"backup-restore":9046,"focus-render":23328,"palette":25271,"welcome":107732,"server-status":14604,"load-errors":5567,"server-down":13978,"security":60748,"focus-responsive":103947,"plan-actual":25647,"task-block-link":8266,"conflict-draft":23710,"year":14774,"conflict-draft-fields":33670,"week-capacity":5097,"day-start":6184,"mini-timer":153205,"calendar-drift":22470,"schedule-exceptions":57461,"tasks-v3":37920,"focus-fit":262781};
selected.sort((a,b) => (timings[b] ?? estimates[b] ?? 20000) - (timings[a] ?? estimates[a] ?? 20000));
const started = Date.now(); const results = []; const active = new Set();
let interrupted = false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
  interrupted = true;
  for (const child of active) child.kill();
});
console.log('Running ' + selected.length + ' files with ' + jobs + ' workers; logs: ' + runDir);
async function worker() {
  while (selected.length && !interrupted) {
    const name = selected.shift(); const start = Date.now();
    const result = await new Promise(done => {
      const child = spawn(process.execPath, [join(root, 'tools/e2e', name + '.mjs')], {
        cwd: root, env: {...process.env, TOGETHER_SHOTS:join(runDir,name,'shots')}, stdio:['ignore','pipe','pipe']
      });
      active.add(child); let output = '';
      child.stdout.on('data', d => { output += d; });
      child.stderr.on('data', d => { output += d; });
      child.on('error', e => { output += e.stack; });
      child.on('close', (code, signal) => { active.delete(child); done({name,code,signal,output,ms:Date.now()-start}); });
    });
    writeFileSync(join(runDir,name+'.log'),result.output);
    result.passes = (result.output.match(/^PASS\b/gm) || []).length;
    timings[name] = result.ms; results.push(result);
    console.log((result.code === 0 ? 'PASS ' : 'FAIL ') + name + ' ' + (result.ms/1000).toFixed(1) + 's (' + result.passes + ' PASS lines)');
  }
}
await Promise.all(Array.from({length:Math.min(jobs,selected.length)},worker));
writeFileSync(timingPath,JSON.stringify(timings,null,2));
const failed = results.filter(r => r.code !== 0);
for (const r of failed) console.error('\n--- ' + r.name + ' ---\n' + r.output);
const summary = {seconds:(Date.now()-started)/1000,files:results.length,failed:failed.length,passes:results.reduce((n,r)=>n+r.passes,0),results:results.map(({output,...r})=>r)};
writeFileSync(join(runDir,'summary.json'),JSON.stringify(summary,null,2));
console.log(summary.files + ' files, ' + summary.failed + ' failed, ' + summary.passes + ' PASS lines, ' + summary.seconds.toFixed(1) + 's');
process.exitCode = failed.length || interrupted ? 1 : 0;
