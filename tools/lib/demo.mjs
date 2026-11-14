// A believable planner for screenshots, the tutorial and tests, made through the real API on a throwaway server.
// Deterministic: the same autumn every time.
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const weekOf = (s) => {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const y = d.getFullYear(), ft = new Date(y, 0, 4);
  ft.setDate(ft.getDate() - ((ft.getDay() + 6) % 7) + 3);
  return `${y}-W${pad(1 + Math.round((d - ft) / 6048e5))}`;
};

export const WORDS = {
  en: {
    deep: 'Deep focus', h: 'h', exercise: 'Exercise', read: 'Read 20 pages', nophone: 'No phone after 21:00',
    email: 'Morning e-mail', lunch: 'Lunch and walk', call: 'Editorial call', pilot: 'Pilot analysis', shutdown: 'Shutdown ritual',
    manuscript: 'Manuscript', chapter: 'Chapter draft', overflow: 'Overflow: chapter', grant: 'Grant office call',
    task1: 'Send the revised budget', task2: 'Book flights for the workshop', task3: 'Ask for the copy-edit schedule',
    note: 'Open chapter 4 with the switching-cost study.',
    week: ['Finish the chapter 4 draft', 'Send the revised grant budget', 'Run the pilot analysis', 'Review two conference papers'],
    month: ['Chapters 4 and 5 drafted', 'Grant renewal submitted', 'Pilot data analysed'], dates: ['Grant deadline', 'Workshop abstract due'],
    quarter: ['A full manuscript draft by 15 December', 'Submit the attention-study paper', 'Fifteen hours of deep work every week'],
    template: 'Writing day',
    ritual: ['Check e-mail and messages for anything that needs an answer before tomorrow', 'Move every task on today’s list into your task system or onto a day', 'Look over the calendar for the next two weeks', 'Update the weekly plan with what got done and revise the days left', 'Sketch the first blocks of tomorrow'],
  },
  tr: {
    deep: 'Derin odak', h: 'sa', exercise: 'Spor', read: '20 sayfa oku', nophone: '21:00’den sonra telefon yok',
    email: 'Sabah e-postaları', lunch: 'Öğle yemeği ve yürüyüş', call: 'Editörle görüşme', pilot: 'Pilot analiz', shutdown: 'Kapanış ritüeli',
    manuscript: 'Kitap taslağı', chapter: 'Bölüm taslağı', overflow: 'Taşma: bölüm', grant: 'Hibe ofisi araması',
    task1: 'Revize bütçeyi gönder', task2: 'Çalıştay için uçak bileti al', task3: 'Redaksiyon takvimini sor',
    note: '4. bölümü geçiş maliyeti çalışmasıyla aç.',
    week: ['4. bölüm taslağını bitir', 'Revize hibe bütçesini gönder', 'Pilot analizi çalıştır', 'İki konferans makalesini değerlendir'],
    month: ['4. ve 5. bölümlerin taslağı', 'Hibe yenilemesi gönderildi', 'Pilot veriler analiz edildi'], dates: ['Hibe son günü', 'Çalıştay özeti'],
    quarter: ['15 Aralık’a kadar tam kitap taslağı', 'Dikkat çalışması makalesini gönder', 'Her hafta on beş saat derin çalışma'],
    template: 'Yazma günü',
    ritual: ['E-postalara ve mesajlara bak: yarından önce yanıt gerektiren bir şey var mı?', 'Bugünkü listedeki her görevi görev sistemine ya da bir güne taşı', 'Önümüzdeki iki haftanın takvimine göz at', 'Haftalık planı bugün yapılanlarla güncelle, kalan günleri revize et', 'Yarının ilk bloklarını çiz'],
  },
};

/**
 * Fills an account's planner. `today` decides the dates; `plan` is today's starting plan:
 * 'partial' (the morning left open, for blocking it out on camera) or 'full'. `history` is how many days before it are filled.
 */
export async function fillDemo(api, { lang = 'en', today = new Date(), plan = 'full', tourDone = true, history = 40 } = {}) {
  const L = WORDS[lang];
  let n = 0; const id = () => `d${(n++).toString(36)}`;
  let seed = 5; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blk = (s, e, label, kind, note = '') => ({ id: id(), start: s, end: e, label, note, kind });
  const D = iso(today);

  await api.put('settings', {
    lang, tourDone, startHour: 9, endHour: 17,
    focus: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, sound: false, metricId: 'deep' },
    metrics: [
      { id: 'deep', name: L.deep, kind: 'number', unit: L.h, target: 3 },
      { id: 'exercise', name: L.exercise, kind: 'check', unit: '', target: null },
      { id: 'read', name: L.read, kind: 'check', unit: '', target: null },
      { id: 'nophone', name: L.nophone, kind: 'check', unit: '', target: null },
    ],
    ritual: ['inbox', 'capture', 'calendar', 'week', 'tomorrow'].map((k, i) => ({ id: k, text: L.ritual[i] })),
    templates: [{ id: 'tpl-writing', name: L.template, days: [0, 2], blocks: [
      { start: 540, end: 570, label: L.email, note: '', kind: 'shallow' },
      { start: 570, end: 720, label: L.manuscript, note: '', kind: 'deep' },
      { start: 720, end: 780, label: L.lunch, note: '', kind: 'personal' },
    ] }],
  });

  for (let k = history; k >= 1; k--) {
    const d = new Date(today); d.setDate(d.getDate() - k);
    const we = d.getDay() === 0 || d.getDay() === 6;
    const deep = Math.round((1.5 + rand() * 2.5) * 2) / 2;
    const shut = !we && rand() < 0.86;
    const end = new Date(d); end.setHours(17, Math.floor(rand() * 40), 0, 0);
    await api.put(`day:${iso(d)}`, {
      columns: [{ from: null, closedAt: null, blocks: we ? [] : [
        blk(540, 570, L.email, 'shallow'), blk(570, 570 + deep * 36, L.manuscript, 'deep'),
        blk(720, 780, L.lunch, 'personal'), blk(780, 780 + deep * 24, L.pilot, 'deep'), blk(990, 1020, L.shutdown, 'shallow'),
      ] }],
      tasks: we ? [] : [{ id: id(), text: L.task1, done: true }],
      notes: '',
      metrics: { ...(we ? {} : { deep }), exercise: rand() < 0.6, read: k <= 4 || rand() < 0.72, nophone: k <= 4 || rand() < 0.6 },
      shutdown: { done: shut, at: shut ? end.toISOString() : null, steps: {} },
      focus: { active: null, sessions: we ? [] : Array.from({ length: 2 + Math.floor(rand() * 4) }, (_, j) => {
        const s0 = new Date(d); s0.setHours(9, 30 + j * 30, 0, 0);
        return { id: id(), blockId: null, label: L.manuscript, kind: 'deep', start: s0.toISOString(), end: new Date(s0.getTime() + 25 * 60000).toISOString(), minutes: 25 };
      }) },
    });
  }

  const morning = plan === 'partial' ? [blk(540, 570, L.email, 'shallow')] : [blk(540, 570, L.email, 'shallow'), blk(570, 690, L.chapter, 'deep'), blk(690, 720, L.overflow, 'overflow')];
  await api.put(`day:${D}`, {
    columns: [{ from: null, closedAt: null, blocks: [...morning,
      blk(720, 780, L.lunch, 'personal'), blk(780, 840, L.call, 'meeting'), blk(870, 960, L.pilot, 'deep'), blk(990, 1020, L.shutdown, 'shallow')] }],
    tasks: [{ id: id(), text: L.task1, done: true }, { id: id(), text: L.task2, done: false }, { id: id(), text: L.task3, done: false }],
    notes: L.note,
    metrics: { deep: 1, exercise: true },
    shutdown: { done: false, at: null, steps: {} },
  });

  // planned already, so the Monday reminder to plan the week stays out of screenshots and the tutorial
  await api.put(`week:${weekOf(D)}`, { items: L.week.map((text, i) => ({ id: id(), text, done: i % 2 === 1 })), notes: '', plannedAt: new Date().toISOString() });
  const m = D.slice(0, 7);
  await api.put(`month:${m}`, { goals: L.month.map((text, i) => ({ id: id(), text, done: i === 1 })), notes: '', dates: [
    { id: id(), date: `${m}-14`, text: L.dates[0] }, { id: id(), date: `${m}-28`, text: L.dates[1] },
  ] });
  await api.put(`quarter:${today.getFullYear()}-Q${Math.floor(today.getMonth() / 3) + 1}`, { goals: L.quarter.map((text) => ({ id: id(), text, done: false })), notes: '' });
}

/** Sets up the owner (first visit) or signs in, then fills the planner. Returns the API client. */
export async function demoAccount(api, { lang = 'en', email = lang === 'tr' ? 'deniz@kuzey.test' : 'robin@hale.test', ...opts } = {}) {
  const st = (await api.call('/api/auth/state')).body;
  if (st.setup) await api.call('/api/auth/setup', { name: lang === 'tr' ? 'Deniz' : 'Robin', email, password: 'Demo-password-1', signupMode: 'open', lang });
  else {
    const r = await api.call('/api/auth/login', { email, password: 'Demo-password-1', remember: true });
    if (r.status !== 200) {
      // sign-up forms are refused when sent back within a few seconds of being handed out (bot protection)
      const form = (await api.call('/api/auth/state')).body.form;
      await new Promise((ok) => setTimeout(ok, 3100));
      await api.call('/api/auth/register', { name: lang === 'tr' ? 'Deniz' : 'Robin', email, password: 'Demo-password-1', lang, form, website: '' });
    }
  }
  await fillDemo(api, { lang, ...opts });
  return api;
}
