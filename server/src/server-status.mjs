import { readdir, lstat, statfs, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { guardedFetch } from './safefetch.mjs';
export function newer(current, latest) {
 const parse = s => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(s)?.slice(1).map(Number);
 const a=parse(current), b=parse(latest); if(!a || !b) return null;
 for(let i=0;i<3;i++) { if(b[i]!==a[i]) return b[i]>a[i]; } return false;
}
export function releaseChecker(source, version, request=guardedFetch, now=Date.now) {
 let at=-Infinity, pending, value=null;
 return async () => {
 if(now()-at<86400000) return pending ? pending : value;
 at=now(); pending=(async()=>{try {
 const u=new URL(source); const m=/^\/([\w.-]+)\/([\w.-]+)\/?$/.exec(u.pathname);
 if(u.hostname!=='github.com'||!m) return null;
 const r=await request('https://api.github.com/repos/'+m[1]+'/'+m[2]+'/releases/latest',{timeoutMs:3000,maxBytes:65536,headers:{'user-agent':'shutdown-complete','accept':'application/vnd.github+json'}});
 if(r.status!==200) return null;
 const tag=JSON.parse(r.body.toString()).tag_name; const update=newer(version,tag);
 return update===null?null:{version:tag,update};
 }catch{return null;}})(); value=await pending; pending=null; return value;
 };
}
export function warnings(s, now=Date.now()) {
 const out=[];
 if(!s.backup.last || now-Date.parse(s.backup.last.at)>2*86400000) out.push('backupOld');
 if(s.backup.attempt?.ok===false) out.push('backupFailed');
 if(!s.config.appUrl) out.push('appUrlMissing');
 if(s.storage.used>=.9) out.push('diskFull');
 if(s.nextcloud.errors || s.calendars.errors) out.push('syncFailed');
 return out;
}
async function size(dir) { let n=0; for(const f of await readdir(dir)){const p=join(dir,f),s=await lstat(p); if(s.isSymbolicLink()) continue; n+=s.isDirectory()?await size(p):s.size;} return n; }
export async function storage(dir) { try { const d=await statfs(dir); return {data:await size(dir),database:(await stat(join(dir,'planner.db'))).size,free:d.bavail*d.bsize,used:1-d.bavail/d.blocks}; }catch{return {data:null,database:null,free:null,used:null};} }
