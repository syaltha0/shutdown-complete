import type { Item } from './model';
import { uid } from './model';
import type { Words } from './words/en';
export const postponed = (_t: Item, from?: string, to?: string) => !!from && !!to && to > from;
export const deferred = (t: Item): Item => ({ ...t, deferCount: (t.deferCount ?? 0) + 1 });
/** One dialog for the whole operation. No changes are written before every decision is made. */
export async function decideMoves(items: Item[], T: Words): Promise<{ moving: Item[]; back: Item[]; deleted: Item[] } | null> {
  const candidates = items.filter(t => (t.deferCount ?? 0) >= 3);
  if (!candidates.length) return { moving: items.map(deferred), back: [], deleted: [] };
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'panel';
    const title = document.createElement('p'); title.textContent = T.tkDeferred; dialog.append(title);
    const rows = candidates.map(t => {
      const row = document.createElement('div'); row.className = 'field';
      const label = document.createElement('label'); label.textContent = t.text;
      const select = document.createElement('select'); select.className = 'input'; select.setAttribute('aria-label', t.text);
      for (const [value, text] of [['split',T.tkSplit],['date',T.tkChooseDay],['back',T.tkBackList],['delete',T.tkDeleteAll]]) { const o = document.createElement('option'); o.value=value; o.textContent=text; select.append(o); }
      const date = document.createElement('input'); date.type='date'; date.className='input'; date.setAttribute('aria-label',T.tkChooseDay); date.hidden=true;
      const steps = document.createElement('textarea'); steps.className='input'; steps.placeholder=T.tkSubPh; steps.setAttribute('aria-label',T.tkSubtasks);
      select.onchange=()=>{date.hidden=select.value!=='date';steps.hidden=select.value!=='split';};
      label.append(select); row.append(label,date,steps); dialog.append(row); return {t,select,date,steps};
    });
    const finish=(value: Awaited<ReturnType<typeof decideMoves>>)=>{dialog.close();dialog.remove();resolve(value);};
    const save=document.createElement('button');save.className='btn';save.textContent=T.tkDecisionApply;
    save.onclick=()=>{
      if(rows.some(r=>r.select.value==='date'&&!r.date.value || r.select.value==='split'&&!r.steps.value.trim()))return;
      const moving=items.filter(t=>!candidates.includes(t)).map(deferred),back:Item[]=[],deleted:Item[]=[];
      for(const r of rows){const t={...r.t,deferCount:0};switch(r.select.value){case 'delete':deleted.push(t);break;case 'back':back.push({...t,due:undefined,dueTime:undefined,remind:undefined,start:undefined});break;case 'date':back.push({...t,due:r.date.value});break;default:back.push({...t,steps:[...(t.steps??[]),...r.steps.value.split('\n').filter(s=>s.trim()).map(text=>({id:uid(),text:text.trim(),done:false}))]});}}
      finish({moving,back,deleted});
    };
    const cancel=document.createElement('button');cancel.className='btn ghost';cancel.textContent=T.cancel;cancel.onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};dialog.append(save,cancel);document.body.append(dialog);dialog.showModal();
  });
}
