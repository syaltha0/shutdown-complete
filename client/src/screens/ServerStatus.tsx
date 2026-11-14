import { useEffect, useState } from 'react';
import { useAccount } from '../App';
import { useT } from '../lib/i18n';
import './server-status.css';
type Status = {version:string; release:{version:string;update:boolean}|null; uptime:number; warnings:string[]; backup:{last:{at:string;size:number}|null;attempt:{at:string;ok:boolean}|null;count:number;keep:number;next:string|null}; storage:{data:number|null;database:number|null;free:number|null;used:number|null};accounts:number;pending:number;push:number;config:{vapid:boolean;smtp:boolean;appUrl:boolean};nextcloud:{count:number;last:string|null;errors:number};calendars:{checked:number;errors:number}};
export function ServerStatus(){
 const {user}=useAccount(), T=useT(), W=T.serverStatus, useAttention=T.uiux.attention;
 const [data,setData]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 async function load(backup=false){setBusy(true);setError(false);try{if(backup){const r=await fetch('/api/admin/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error();}const r=await fetch('/api/admin/server-status');if(!r.ok)throw Error();setData(await r.json());}catch{setError(true);}finally{setBusy(false);}}
 useEffect(()=>{if(user.isAdmin)void load();},[user.isAdmin]);
 if(!user.isAdmin)return null;
 const date=(v:string|null|undefined)=>v?new Date(v).toLocaleString():W.unknown;
 const bytes=(v:number|null|undefined)=>v==null?W.unknown:new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(v/1048576)+' MB';
 const yes=(v:boolean)=>v?W.yes:W.no;
 const row=(label:string,value:React.ReactNode)=><div className="status-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>;
 return <div className="server-status"><h1>{W.title}</h1><div className="status-actions"><button className="btn" disabled={busy} onClick={()=>void load()}>{W.refresh}</button><button className="btn" disabled={busy} onClick={()=>void load(true)}>{W.now}</button></div>{error&&<p role="alert">{W.error}</p>}{busy&&<p role="status">{W.loading}</p>}{data&&<><div role="status"><h2>{data.warnings.length ? useAttention : W.healthy}</h2><p>{W.last}: {date(data.backup.last?.at)}</p>{data.warnings.length?data.warnings.map(w=><p className="status-warning" key={w}>{W[w as keyof typeof W]}</p>):<p>{W.healthy}</p>}{data.release?.update&&<p>{W.update}</p>}</div><dl>
 {row(W.last,date(data.backup.last?.at))}{row(W.attempt,data.backup.attempt?date(data.backup.attempt.at)+' / '+(data.backup.attempt.ok?W.success:W.failed):W.unknown)}{row(W.size,bytes(data.backup.last?.size))}{row(W.count,data.backup.count)}{row(W.keep,data.backup.keep)}{row(W.next,date(data.backup.next))}
 {row(W.data,bytes(data.storage.data))}{row(W.database,bytes(data.storage.database))}{row(W.free,bytes(data.storage.free))}{row(W.used,data.storage.used==null?W.unknown:Math.round(data.storage.used*100)+'%')}{row(W.version,data.version)}{row(W.release,data.release?.version??W.unknown)}{row(W.uptime,data.uptime)}{row(W.accounts,data.accounts)}{row(W.pending,data.pending)}{row(W.push,data.push)}{row(W.vapid,yes(data.config.vapid))}{row(W.smtp,yes(data.config.smtp))}{row(W.appUrl,yes(data.config.appUrl))}{row(W.nextcloud,data.nextcloud.count)}{row(W.lastSync,date(data.nextcloud.last))}{row(W.nextcloud+' / '+W.errors,data.nextcloud.errors)}{row(W.calendars,data.calendars.checked)}{row(W.calendars+' / '+W.errors,data.calendars.errors)}</dl></>}</div>;
}
