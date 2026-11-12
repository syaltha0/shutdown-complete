// How guessable a password is, for the strength bar on the sign-up page and for the server, which refuses the
// guessable ones. The same file runs in both places, so the bar and the server never disagree. Everything is local:
// no password, or any part of one, is sent anywhere to be checked.
//
// A password is refused when it is short, one of the passwords people use most (or one of them with digits and
// symbols around it), made of the person's own name or e-mail, a keyboard run or a repeat, or simply too small a
// space to guess in. Long passphrases of plain words pass: length beats symbols.

// Words at the heart of the most leaked passwords; "Galatasaray1905!" counts as "galatasaray".
const BASES = new Set(`
password passw0rd parola sifre şifre secret letmein welcome iloveyou admin administrator login master changeme default
qwerty qwertyuiop qwertyui asdfgh asdfghjkl zxcvbn zxcvbnm qazwsx qazwsxedc qwer1234 asdasd asdqwe zaq12wsx 1q2w3e4r
1q2w3e4r5t abc123 abcd1234 aaaaaa football baseball soccer basketball hockey dragon monkey shadow sunshine princess
superman batman spiderman starwars pokemon trustno1 michael jennifer charlie jordan thomas daniel jessica ashley
computer internet whatever freedom summer winter flower purple orange chocolate cookie cheese pepper ginger hello
hellokitty liverpool chelsea arsenal manchester barcelona realmadrid juventus galatasaray fenerbahce besiktas beşiktaş
trabzonspor istanbul ankara izmir turkiye türkiye turkey germany london newyork samsung iphone google facebook
instagram youtube microsoft windows linux ubuntu planner shutdown shutdowncomplete timeblock deepwork newport
january february march april june july august september october november december spring autumn
ocak subat şubat mart nisan mayis mayıs haziran temmuz agustos ağustos eylul eylül ekim kasim kasım aralik aralık
`.split(/\s+/).filter(Boolean));

// Whole passwords that are common as they are.
const WHOLE = new Set(`
1234567890 0987654321 1234567891 1111111111 0000000000 1231231234 1122334455 1qaz2wsx3edc qwertyuiop123 qwerty12345
password12 password123 password1234 iloveyou123 sifre12345 parola1234 asdfghjkl1 zaq1xsw2cde 1q2w3e4r5t6y q1w2e3r4t5
`.split(/\s+/).filter(Boolean));

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz', 'qwertzuiop', 'azertyuiop'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

const unleet = (s) => s.replace(/[0134578@$!]/g, (c) => LEET[c]);
/** Lower case without accents: ı and İ become i, ş s, ç c, ğ g, ö o, ü u. */
const fold = (s) => String(s).replace(/[ıİ]/g, 'i').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** How much of the password sits in runs along a keyboard row or the alphabet (forwards or backwards), as a share. */
function runShare(p) {
  let inRuns = 0, i = 0;
  while (i < p.length) {
    let j = i + 1;
    const next = (a, b) => ROWS.some((r) => { const k = r.indexOf(a); return k >= 0 && (r[k + 1] === b || r[k - 1] === b); });
    while (j < p.length && next(p[j - 1], p[j])) j++;
    if (j - i >= 3) inRuns += j - i;
    i = j;
  }
  return inRuns / p.length;
}

/** True when the password is one short piece said over and over (abcabcabc, 12121212, aaaaaaa). */
const repeated = (p) => { for (let n = 1; n <= Math.min(4, p.length / 2); n++) if (p.slice(0, n).repeat(Math.ceil(p.length / n)).slice(0, p.length) === p) return true; return false; };

/** The rules a new password must meet, for each policy the server owner can choose (Settings > Server). */
export const POLICIES = {
  // the default: easy to meet, still not "12345678"
  basic: { min: 8, upper: true, lower: false, digit: false, special: true, deep: false },
  // the owner's choice: longer, every kind of character, and none of the guessable kinds
  strong: { min: 12, upper: true, lower: true, digit: true, special: true, deep: true },
};

const has = {
  upper: (p) => /\p{Lu}/u.test(p),
  lower: (p) => /\p{Ll}/u.test(p),
  digit: (p) => /\p{N}/u.test(p),
  special: (p) => /[^\p{L}\p{N}\s]/u.test(p),
};

/** Roughly how many bits of guessing the password takes (the bar follows it, the score is made from it). */
function strength(p) {
  const low = p.toLowerCase();
  let pool = 0;
  if (/\p{Ll}/u.test(p)) pool += 26;
  if (/\p{Lu}/u.test(p)) pool += 26;
  if (/\p{N}/u.test(p)) pool += 10;
  if (has.special(p)) pool += 33;
  if (/\s/.test(p)) pool += 1;
  const distinct = new Set(low).size;
  const effective = p.length * (1 - 0.6 * runShare(low)) * Math.min(1, 0.45 + distinct / p.length);
  const bits = effective * Math.log2(Math.max(pool, 10));
  return bits;
}
const scoreOf = (bits) => (bits < 36 ? 1 : bits < 52 ? 2 : bits < 68 ? 3 : 4);

/**
 * @param {string} pw
 * @param {{ email?: string, name?: string }} [who]
 * @param {'basic'|'strong'} [policy]
 * @returns {{ score: 0|1|2|3|4, problem: null|'long'|'short'|'upper'|'lower'|'digit'|'special'|'email'|'pattern'|'common'|'personal'|'guessable',
 *   rules: { id: 'length'|'upper'|'lower'|'digit'|'special', ok: boolean }[], min: number }}
 *   score: 0 too weak … 4 strong; rules: the policy's requirements and whether each is met. Anything with a problem is refused.
 */
export function passwordCheck(pw, who = {}, policy = 'basic') {
  const P = POLICIES[policy] || POLICIES.basic;
  const p = String(pw || '');
  const rules = [{ id: 'length', ok: p.length >= P.min }];
  for (const k of ['upper', 'lower', 'digit', 'special']) if (P[k]) rules.push({ id: k, ok: has[k](p) });
  const out = (problem, score) => ({ score: problem ? Math.min(score, 1) : score, problem, rules, min: P.min, bits });
  const bits = p ? strength(p) : 0;
  const score = p ? scoreOf(bits) : 0;
  if (p.length > 200) return out('long', 0);
  const broken = rules.find((r) => !r.ok);
  if (broken) return out(broken.id === 'length' ? 'short' : broken.id, score);
  const low = p.toLowerCase(), email = String(who.email || '').toLowerCase();
  if (email && low === email) return out('email', score);
  // a run along the keyboard or the alphabet, one piece over and over, or two or three characters in all
  const plain = low.replace(/[^\p{L}\p{N}]/gu, '');
  if (repeated(low) || runShare(low) >= 0.7 || new Set(plain).size <= 3) return out('pattern', score);
  if (!P.deep) return out(null, Math.max(score, 1));
  // the common ones, and the common ones dressed up with digits, symbols and capitals around them
  // (the ends come off first, then 0/1/3/@/$ inside are read as the letters they stand for)
  const core = unleet(low.replace(/^[^a-zçğıöşü]+|[^a-zçğıöşü]+$/g, ''));
  if (WHOLE.has(low) || WHOLE.has(unleet(low)) || BASES.has(core) || BASES.has(core.replace(/[^a-zçğıöşü]/g, ''))) return out('common', score);
  // built from the person's own name or address: little is left once those words are taken out
  // (compared without accents, so "Yıldız" is found in "yildiz1999")
  const flat = fold(low);
  const mine = [email.split('@')[0], ...String(who.name || '').split(/\s+/)].map(fold).filter((x) => x.length >= 3);
  const rest = mine.reduce((s, m) => s.split(m).join(''), flat).replace(/[^a-z]/g, '');
  if (mine.some((m) => flat.includes(m)) && rest.length < 4) return out('personal', score);
  return out(score < 3 ? 'guessable' : null, score);
}

