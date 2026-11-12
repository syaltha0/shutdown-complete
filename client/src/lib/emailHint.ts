// "ali@gmial.com" → "ali@gmail.com": a suggestion for a mistyped e-mail provider, so a confirmation e-mail does not
// go to an address nobody reads. Only the part after @ is looked at, only well-known providers are suggested, and
// nothing leaves the browser.
const DOMAINS = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'yandex.com', 'yandex.com.tr', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de',
  'mail.com', 'zoho.com', 'fastmail.com', 'hey.com', 'hotmail.co.uk', 'yahoo.co.uk', 'outlook.de', 'hotmail.de', 'hotmail.fr',
  'yahoo.fr', 'orange.fr', 'libero.it', 'mail.ru', 'qq.com', '163.com',
  // real providers that sit one letter away from the ones above, so they are never "corrected"
  'ymail.com', 'mac.com', 'ttmail.com', 'tutanota.com', 'tuta.io', 'posteo.de', 'mailbox.org', 'att.net', 'comcast.net',
  'verizon.net', 'hotmail.it', 'hotmail.es', 'yahoo.de', 'yahoo.es', 'outlook.fr', 'live.co.uk', 'live.fr', 'gmx.at', 'gmx.ch',
];
// real endings, so a company or school address is never "corrected"; only a near miss of one of these is
const TLDS = ['com', 'net', 'org', 'edu', 'gov', 'io', 'co', 'ai', 'app', 'dev', 'me', 'tr', 'de', 'fr', 'nl', 'it', 'es', 'ch', 'at', 'uk', 'us', 'ca', 'eu',
  'co.uk', 'com.tr', 'edu.tr', 'gov.tr', 'org.tr', 'net.tr', 'bel.tr', 'k12.tr'];

/** How many single edits (insert, delete, change, swap two neighbours) turn a into b. */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const closest = (s: string, list: string[], max: number) => {
  let best: string | null = null, bestD = max + 1;
  for (const x of list) { const d = distance(s, x); if (d < bestD) { best = x; bestD = d; } }
  return bestD > 0 && bestD <= max ? best : null;
};

/** A likely meant address, or null when the address looks right (or is not one we can judge). */
export function emailSuggestion(email: string): string | null {
  const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email.trim().toLowerCase());
  if (!m) return null;
  const [, local, domain] = m;
  if (DOMAINS.includes(domain)) return null;
  // a known provider with a slip anywhere in it (gmial.com, hotmial.com, outlok.com)
  const known = closest(domain, DOMAINS, domain.length < 9 ? 1 : 2);
  if (known) return `${local}@${known}`;
  // a known provider name with a mistyped ending (gmail.con, yahoo.cmo), or any name with one (sirket.cmo)
  const dot = domain.indexOf('.'), name = domain.slice(0, dot), tld = domain.slice(dot + 1);
  if (TLDS.includes(tld)) return null;
  const fixed = closest(tld, TLDS, 1);
  return fixed ? `${local}@${name}.${fixed}` : null;
}
