// Administration from the server's shell, for when there is no e-mail or the owner is locked out.
//   node server/src/cli.mjs users
//   node server/src/cli.mjs reset-password <email>     prints a new temporary password and signs the account out everywhere
//   node server/src/cli.mjs disable-2fa <email>
//   node server/src/cli.mjs make-admin <email>
//   node server/src/cli.mjs signups open|approve|invite|closed
//   node server/src/cli.mjs approve <email>            lets in an account that waits for approval
//   node server/src/cli.mjs domains <a.com,b.org>|none  with open sign-ups, only these e-mail domains may sign up
//   node server/src/cli.mjs invite [uses] [days]       prints a new invite link (uses and days: 0 = no limit; default 1 use, 7 days)
//   node server/src/cli.mjs backup                     makes a backup now (DATA_DIR/backups)
//   node server/src/cli.mjs backups                    lists the backups
//   node server/src/cli.mjs restore <backup name>      puts a backup in place at the next start (then restart the server)
// In Docker: docker compose exec planner node server/src/cli.mjs <command>
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { randomToken, sha256 } from './auth.mjs';
import { openDb } from './db.mjs';
import { hashPassword } from './password.mjs';
import { backups } from './backup.mjs';

const db = openDb(resolve(process.env.DATA_DIR || 'data', 'planner.db'));
const [cmd, arg, arg2] = process.argv.slice(2);

function need(email) {
  const u = email && db.users.byEmail(email);
  if (!u) { console.error(`No account with the e-mail "${email ?? ''}".`); process.exit(1); }
  return u;
}

const bk = () => backups({ db, dataDir: resolve(process.env.DATA_DIR || 'data'), hour: -1, log: () => {} });

switch (cmd) {
  case 'backup': { console.log(`Made ${await bk().make('manual')}`); break; }
  case 'backups': { for (const b of bk().list()) console.log(`${b.name}\t${Math.round(b.size / 1024)} kB\t${b.at}`); break; }
  case 'restore': {
    const r = await bk().restore(String(arg || ''));
    if (r.error) { console.error(r.error === 'not-found' ? `No backup called "${arg ?? ''}" (see: backups).` : 'That backup is damaged.'); process.exit(1); }
    console.log('Restart the server: it starts on that backup. What was there is kept as a backup too.');
    break;
  }
  case 'users': {
    const list = db.users.list();
    if (!list.length) console.log('No accounts yet. Open the planner in a browser to create the first one.');
    for (const u of list) console.log(`${u.email}\t${u.name}${u.is_admin ? '\t(admin)' : ''}${u.totp_enabled ? '\t2FA' : ''}${u.email_verified ? '' : '\tunverified'}${u.approved ? '' : '\twaiting for approval'}`);
    const domains = db.meta.get('signup_domains', '');
    for (const r of db.requests.list()) console.log(`${r.email}\tasks for an invite${r.note ? `: ${r.note}` : ''}`);
    const mode = db.meta.get('signups', 'open');
    console.log(`Sign-up mode: ${mode}${domains && mode === 'open' ? ` (only ${domains.split(',').join(', ')})` : ''}.`);
    break;
  }
  case 'reset-password': {
    const u = need(arg);
    // random letters and digits plus a fixed tail, so it meets either password policy; the person picks their own at sign-in
    const pw = `${randomBytes(9).toString('base64url').replace(/[-_]/g, 'x')}-Q7k!`;
    db.users.set(u.id, { password: hashPassword(pw), email_verified: 1, must_change: 2 });
    db.sessions.removeAll(u.id);
    console.log(`New temporary password for ${u.email}: ${pw}\nSign in with it; the planner then asks for a new one.`);
    break;
  }
  case 'disable-2fa': {
    const u = need(arg);
    db.users.set(u.id, { totp_enabled: 0, totp_secret: null, recovery: '[]', totp_last_step: 0 });
    console.log(`Two-step sign-in is off for ${u.email}.`);
    break;
  }
  case 'make-admin': {
    const u = need(arg);
    db.users.set(u.id, { is_admin: 1 });
    console.log(`${u.email} can now change this installation's settings.`);
    break;
  }
  case 'signups': {
    if (!['open', 'approve', 'invite', 'closed'].includes(arg)) { console.error('Use: signups open | approve | invite | closed'); process.exit(1); }
    db.meta.set('signups', arg);
    console.log({ invite: 'Sign-ups need an invite link (make one with: invite).', approve: 'New accounts wait for approval (approve <email>).' }[arg] || `Sign-ups are ${arg}.`);
    break;
  }
  case 'approve': {
    const u = need(arg);
    db.users.set(u.id, { approved: 1 });
    console.log(`${u.email} can sign in now.`);
    break;
  }
  case 'domains': {
    if (!arg) { console.error('Use: domains example.com,school.edu   or   domains none'); process.exit(1); }
    const list = arg === 'none' ? [] : [...new Set(arg.toLowerCase().split(/[\s,;]+/).map((d) => d.replace(/^@+/, '')).filter((d) => /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)))];
    db.meta.set('signup_domains', list.join(','));
    console.log(list.length ? `With open sign-ups, only addresses at ${list.join(', ')} can sign up; others need an invite.` : 'Any e-mail domain can sign up.');
    break;
  }
  case 'invite': {
    const uses = arg == null ? 1 : Number(arg), days = arg2 == null ? 7 : Number(arg2);
    if (!(uses >= 0) || !(days >= 0)) { console.error('Use: invite [uses] [days]   (0 = no limit)'); process.exit(1); }
    const token = randomToken();
    db.invites.create({ tokenHash: sha256(token), maxUses: uses || null, expiresAt: days ? new Date(Date.now() + days * 24 * 3600_000).toISOString() : null, note: 'command line' });
    const base = (process.env.APP_URL || '').replace(/\/$/, '');
    console.log(`${base || '<your planner address>'}/register?invite=${token}`);
    console.log(`${uses ? `${uses} sign-up${uses > 1 ? 's' : ''}` : 'Any number of sign-ups'}, ${days ? `for ${days} day${days > 1 ? 's' : ''}` : 'until revoked'}. This link is shown only once.`);
    if (db.meta.get('signups', 'open') === 'closed') console.log('Sign-ups are closed: run "signups invite" so the link works.');
    break;
  }
  default:
    console.log('Commands: users | reset-password <email> | disable-2fa <email> | make-admin <email> | signups open|approve|invite|closed | approve <email> | domains <list>|none | invite [uses] [days]');
}
