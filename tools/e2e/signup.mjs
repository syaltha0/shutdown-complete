// End-to-end checks of creating an account: bot protection, the e-mail typo hint, the first-run setup, invite links
// and the owner's sign-up settings, in a real browser against a throwaway server.
//   npm run build && node tools/e2e/signup.mjs [--shots <dir>]
import { mkdirSync } from 'node:fs';
import { launch } from '../lib/browser.mjs';
import { client, startServer } from '../lib/server.mjs';

const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };
const shot = async (page, name) => { if (shotsAt) await page.screenshot({ path: `${shotsAt}/${name}.png` }); };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

const srv = await startServer();
const owner = client(srv.url);
const browser = await launch();
const fresh = () => browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-GB', reducedMotion: 'reduce' });

try {
  // ---------- the owner, through the setup screen ----------
  {
    const ctx = await fresh(), page = await ctx.newPage();
    await page.goto(`${srv.url}/`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
    check('the setup screen asks nothing about other people', (await page.locator('.auth-form .segmented').count()) === 0);
    check('the owner\'s setup asks only for an address and a password', !(await page.locator('#name').count()));
    await page.locator('#email').fill('robin@hale.test');
    await page.locator('#password').fill('Demo-password-1');
    await shot(page, 'setup');
    await page.getByRole('button', { name: 'Create the owner account' }).click();
    await page.locator('.welcome').waitFor({ timeout: 8000 });
    owner.cookie = `sc_session=${(await ctx.cookies()).find((c) => c.name === 'sc_session').value}`;
    check('a new server takes invited people only', (await owner.call('/api/admin/state')).body.mode === 'invite');
    await owner.call('/api/admin/state', { mode: 'open' }, 'PUT');
    await ctx.close();
  }

  // ---------- bots ----------
  const guest = client(srv.url);
  const person = { name: 'Bot', email: 'bot@hale.test', password: 'A-long-password-1', lang: 'en' };
  const noForm = await guest.call('/api/auth/register', { ...person, website: '' });
  check('a sign-up without the form note is refused', noForm.status === 400 && noForm.body.error === 'try-again');
  const form = (await guest.call('/api/auth/state')).body.form;
  const quick = await guest.call('/api/auth/register', { ...person, website: '', form });
  check('a sign-up sent back at once is asked to wait', quick.status === 425 && quick.body.error === 'too-fast' && quick.body.wait > 0);
  await wait(3100);
  const trap = await guest.call('/api/auth/register', { ...person, website: 'http://spam.example', form });
  check('a sign-up with the hidden field filled in is refused', trap.status === 400);
  check('no account was made by any of them', !(await owner.call('/api/admin/state')).body.users.some((u) => u.email === person.email));

  // ---------- signing up in the browser ----------
  let ctx = await fresh(), page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${srv.url}/register`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('no language switch before there is an account', !(await page.locator('.lang-switch').count()) && !(await page.getByRole('button', { name: 'Türkçe' }).count()));
  check('the sign-up form asks only for an address and a password', !(await page.locator('#name').count()) && await page.locator('#email').isVisible());
  await page.locator('#email').focus();
  await page.keyboard.press('ArrowDown');
  const downTo = await page.evaluate(() => document.activeElement?.id);
  await page.keyboard.press('ArrowDown');
  const roundTo = await page.evaluate(() => document.activeElement?.id);
  await page.keyboard.press('ArrowUp');
  check('the arrow keys move between e-mail and password, and round from the last to the first', downTo === 'password' && roundTo === 'email' && (await page.evaluate(() => document.activeElement?.id)) === 'password', `${downTo} ${roundTo}`);
  await page.locator('#email').focus();
  await page.keyboard.press('Enter');
  check('Enter in the e-mail moves on to the password instead of sending', (await page.evaluate(() => document.activeElement?.id)) === 'password' && page.url().endsWith('/register'));
  const rules = await page.locator('#password').evaluate((i) => ({ min: i.minLength, rules: i.getAttribute('passwordrules'), user: document.querySelector('#email').autocomplete }));
  check('password managers are told the rules and the account name', rules.min === 8 && rules.rules?.includes('minlength: 8') && rules.rules?.includes('required: upper') && rules.rules?.includes('required: special') && rules.user === 'username', JSON.stringify(rules));
  await page.getByRole('button', { name: 'Show' }).click();
  check('the eye shows the password and becomes "Hide"', (await page.locator('#password').getAttribute('type')) === 'text' && await page.getByRole('button', { name: 'Hide' }).isVisible());
  await page.getByRole('button', { name: 'Hide' }).click();
  const hint = await page.locator('.pw-meter').boundingBox();
  check('the password rules fit on one line', hint && hint.height < 32, String(hint?.height));
  await page.locator('#email').fill('ali@gmial.com');
  await page.locator('#password').focus();
  const fix = page.locator('.email-fix button');
  check('a mistyped e-mail provider gets a suggestion', (await fix.textContent().catch(() => '')) === 'ali@gmail.com');
  await shot(page, 'register-hint');
  await fix.click();
  check('the suggestion fixes the address', (await page.locator('#email').inputValue()) === 'ali@gmail.com' && !(await page.locator('.email-fix').count()));
  await page.locator('#password').fill('A-long-password-1');
  await page.getByRole('button', { name: 'Create account' }).click(); // well within the first seconds: the page waits and sends again
  check('the button shows it is working while the page waits', await page.locator('.auth-form button[type=submit] .spinner').isVisible({ timeout: 1000 }).catch(() => false));
  await page.locator('.welcome').waitFor({ timeout: 10000 });
  check('a quick person is let through and lands on the setup', true);
  check('the setup asks the name first, with nothing filled in from the address', (await page.locator('#w-name').inputValue()) === '');
  await page.locator('#w-name').fill('ali kaya');
  check('the greeting uses the first name with a capital', await page.getByRole('heading', { name: 'Welcome, Ali' }).isVisible());
  await page.locator('#w-name').fill('Ali Kaya');
  check('the greeting takes the name as it is typed', await page.getByRole('heading', { name: 'Welcome, Ali' }).isVisible());
  await shot(page, 'welcome-1');

  // ---------- the first-run setup ----------
  await page.getByRole('button', { name: 'Next' }).click({ force: true }); // aria-disabled: still pressable, it says what is missing
  check('a step never seen cannot be jumped to', await page.locator('.welcome-progress li').nth(2).getByRole('button').isDisabled());
  check('the setup does not move on without an answer', (await page.locator('#w-name').count()) === 1 && await page.getByText('Pick at least one to go on.').isVisible());
  await page.locator('#w-name').fill('');
  await page.getByRole('button', { name: 'Work' }).click();
  await page.getByRole('button', { name: 'Next' }).click({ force: true });
  check('the setup does not move on without a name', (await page.locator('#w-name').count()) === 1 && await page.getByText('Tell us what to call you first.').isVisible()
    && (await page.locator('#w-name').getAttribute('aria-invalid')) === 'true' && (await page.evaluate(() => document.activeElement?.id)) === 'w-name');
  await page.getByRole('button', { name: 'Work' }).click();
  await page.getByRole('button', { name: 'Use “Ali”' }).click();
  check('the address offers a name', (await page.locator('#w-name').inputValue()) === 'Ali' && !(await page.getByRole('button', { name: 'Use “Ali”' }).count()));
  await page.locator('#w-name').fill('Ali Kaya');
  const sketchBefore = await page.locator('.welcome-sketch .ws-grid').textContent().catch(() => '');
  await page.getByRole('button', { name: 'School or exams' }).click();
  const sketchAfter = await page.locator('.welcome-sketch .ws-grid').textContent().catch(() => '');
  check('an answer changes the sketch of the day', sketchBefore !== sketchAfter && sketchAfter.includes('Lecture'), sketchAfter);
  await page.locator('#w-name').press('Enter');
  check('Enter in the name field moves on', await page.getByRole('heading', { name: 'Which hours do you plan?' }).isVisible({ timeout: 3000 }).catch(() => false));
  const ends = page.locator('.day-span [role=slider]');
  check('the day starts 09:00-17:00 whatever the answer', (await ends.nth(0).getAttribute('aria-valuenow')) === '9' && (await ends.nth(1).getAttribute('aria-valuenow')) === '17');
  const bar = await page.locator('.day-span').boundingBox(), end = await ends.nth(1).boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2); await page.mouse.down();
  await page.mouse.move(bar.x + (bar.width * 16) / 24, end.y + end.height / 2, { steps: 6 }); await page.mouse.up();
  check('the end of the day is dragged to 16:00', (await ends.nth(1).getAttribute('aria-valuenow')) === '16', await ends.nth(1).getAttribute('aria-valuenow'));
  await ends.nth(0).focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
  check('the arrow keys move an end by an hour', (await ends.nth(0).getAttribute('aria-valuenow')) === '9');
  await page.getByRole('button', { name: /Office hours/ }).click();
  check('a day to start from sets both ends', (await ends.nth(0).getAttribute('aria-valuenow')) === '9' && (await ends.nth(1).getAttribute('aria-valuenow')) === '17'
    && (await page.getByRole('button', { name: /Office hours/ }).getAttribute('aria-pressed')) === 'true');
  await page.getByRole('button', { name: 'Next' }).click();
  check('school picks deep focus in advance', (await page.getByRole('button', { name: 'Deep focus' }).getAttribute('aria-pressed')) === 'true');
  await page.getByRole('button', { name: 'Words written' }).click();
  await page.getByRole('button', { name: 'Read 20 pages' }).click();
  await page.getByRole('button', { name: 'Exercise' }).click();
  await page.getByRole('button', { name: 'Exercise' }).click(); // off again
  await shot(page, 'welcome-2');
  await page.reload(); await page.locator('.welcome').waitFor({ timeout: 8000 });
  check('a reload keeps the step and the answers', await page.getByRole('heading', { name: 'What will you keep count of?' }).isVisible() && (await page.getByRole('button', { name: 'Words written' }).getAttribute('aria-pressed')) === 'true');
  await page.locator('.welcome-progress li').nth(0).getByRole('button').click();
  check('a step already seen can be gone back to', (await page.locator('#w-name').inputValue()) === 'Ali Kaya');
  check('the setup asks no language (it follows the browser; Settings changes it)', !(await page.getByRole('button', { name: 'TR', exact: true }).count()));
  check('a step already seen can be gone to again, forward too', await page.locator('.welcome-progress li').nth(2).getByRole('button').isEnabled());
  await page.locator('.welcome-progress li').nth(2).getByRole('button').click();
  await shot(page, 'welcome-3');
  await page.getByRole('button', { name: 'Start planning' }).click();
  check('finishing ticks the shutdown box first', await page.getByRole('button', { name: 'Ready' }).isVisible({ timeout: 1000 }).catch(() => false));
  await page.locator('.tour').waitFor({ timeout: 8000 }).catch(() => {});
  check('finishing the setup opens the day with the tour', page.url().includes('/day/') && (await page.locator('.tour').count()) > 0);
  const ali = client(srv.url);
  ali.cookie = `sc_session=${(await ctx.cookies()).find((c) => c.name === 'sc_session').value}`;
  await wait(1200);
  const st = (await ali.get('settings')).value;
  check('the setup saved the hours', st.startHour === 9 && st.endHour === 17, `${st.startHour}-${st.endHour}`);
  check('the setup saved the chosen metrics', st.metrics.map((m) => m.name).join(',') === 'Deep focus,Words written,Read 20 pages', st.metrics.map((m) => m.name).join(','));
  check('the setup saved the answers', st.profile?.uses?.includes('school') && st.profile?.activities?.includes('exams'), JSON.stringify(st.profile));
  check('the setup is not shown again', st.setupDone === true);
  check('a new account shares no focus with friends until it says so', (await ali.call('/api/friends')).body.share.focus === false);
  check('the setup saved the name', (await ali.call('/api/account')).body.name === 'Ali Kaya');
  check('the draft of the answers is dropped', (await page.evaluate(() => sessionStorage.getItem('sc-welcome-2'))) === null);
  await ctx.close();

  // ---------- invites ----------
  await owner.call('/api/admin/state', { mode: 'invite' }, 'PUT');
  ctx = await fresh(); page = await ctx.newPage();
  await page.goto(`${srv.url}/login`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('with invites only, the sign-in page offers no sign-up', !(await page.getByRole('link', { name: 'Create one' }).count()));
  await page.goto(`${srv.url}/register`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('without a link the sign-up page says it is by invitation', await page.getByText('by invitation').isVisible());
  const inv = (await owner.call('/api/admin/invites', { uses: 1, days: 7, note: 'Deniz' })).body;
  await page.goto(inv.link.replace(/^https?:\/\/[^/]+/, srv.url)); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByText('You have been invited').waitFor({ timeout: 5000 });
  check('an invite link opens the sign-up form', true);
  await page.locator('#email').fill('deniz@kuzey.test');
  await page.locator('#password').fill('A-long-password-2');
  await wait(3000);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.welcome').waitFor({ timeout: 8000 });
  check('an invited person can sign up', true);
  const used = (await owner.call('/api/admin/state')).body.invites.find((i) => i.id === inv.id);
  check('the invite counts its use and is spent', used.uses === 1 && used.live === false);
  await ctx.close();
  ctx = await fresh(); page = await ctx.newPage();
  await page.goto(inv.link.replace(/^https?:\/\/[^/]+/, srv.url)); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('a spent invite link says so', await page.getByText('expired or has been used up').waitFor({ timeout: 5000 }).then(() => true, () => false));
  const other = client(srv.url), f2 = (await other.call('/api/auth/state')).body.form;
  await wait(3100);
  const direct = await other.call('/api/auth/register', { name: 'X', email: 'x@kuzey.test', password: 'A-long-password-3', lang: 'en', form: f2, website: '' });
  check('the server refuses a sign-up without an invite', direct.status === 403 && direct.body.error === 'invite-invalid');
  await ctx.close();

  // ---------- the owner's screen ----------
  await owner.put('settings', { setupDone: true, tourDone: true }); // the owner has been through the first-run setup
  ctx = await fresh();
  await ctx.addCookies([{ name: 'sc_session', value: owner.cookie.split('=')[1], url: srv.url }]);
  page = await ctx.newPage();
  await page.goto(`${srv.url}/settings/server`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByRole('button', { name: 'Invited', exact: true }).waitFor();
  check('the server settings show the sign-up mode', (await page.getByRole('button', { name: 'Invited', exact: true }).getAttribute('aria-pressed')) === 'true');
  await page.locator('#iv-note').fill('Team');
  await page.getByRole('button', { name: 'Make the link' }).click();
  await page.locator('.invite-link input').waitFor();
  const shown = await page.locator('.invite-link input').inputValue();
  check('a new link is shown once to copy', /\/register\?invite=[\w-]{20,}$/.test(shown));
  await shot(page, 'server-invites');
  await page.locator('.session-row', { hasText: 'Team' }).getByRole('button', { name: 'Revoke' }).click();
  await page.waitForTimeout(500);
  check('a link can be revoked', !(await page.locator('.session-row', { hasText: 'Team' }).count()));
  await page.getByRole('button', { name: 'Nobody' }).click();
  await page.waitForTimeout(400);
  check('sign-ups can be closed from the screen', (await owner.call('/api/auth/state')).body.signups === false && (await owner.call('/api/admin/state')).body.mode === 'closed');
  await page.getByRole('button', { name: 'Anyone' }).click();
  await page.waitForTimeout(400);

  // ---------- keeping sign-ups to some e-mail domains ----------
  await page.locator('#s-domains').fill('@Kuzey.test, okul.edu.tr');
  await page.locator('.domains-form').getByRole('button', { name: 'Save' }).click();
  await page.locator('.domains-form').getByRole('button', { name: 'Saved' }).waitFor({ timeout: 4000 });
  check('the owner can keep sign-ups to some domains', (await owner.call('/api/admin/state')).body.domains.join(',') === 'kuzey.test,okul.edu.tr');
  await ctx.close();
  const outsider = client(srv.url), f3 = (await outsider.call('/api/auth/state')).body.form;
  await wait(3100);
  const away = await outsider.call('/api/auth/register', { name: 'Ece', email: 'ece@gmail.com', password: 'A-long-password-4', lang: 'en', form: f3, website: '' });
  check('an address at another domain is turned away', away.status === 403 && away.body.error === 'domain');
  ctx = await fresh(); page = await ctx.newPage();
  await page.goto(`${srv.url}/register`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('the sign-up page says which domains it takes', await page.getByText('addresses at kuzey.test, okul.edu.tr').waitFor({ timeout: 5000 }).then(() => true, () => false));

  // ---------- how strong the password is ----------
  await page.locator('#email').fill('ece@ogr.okul.edu.tr');
  await page.locator('#password').fill('kalem123');
  check('the rules are crossed off one by one: 8 characters, but no capital and no symbol', (await page.locator('.pw-needs > span.part.done').count()) === 1 && (await page.locator('.pw-needs > span.part').count()) === 3 && await page.getByRole('button', { name: 'Create account' }).isDisabled());
  const redBefore = await page.locator('.pw-needs > span.part:not(.done)').first().evaluate((e) => getComputedStyle(e).color);
  await page.locator('#password').press('Enter');
  await wait(400);
  const redAfter = await page.locator('.pw-needs > span.part:not(.done)').first().evaluate((e) => getComputedStyle(e).color);
  check('Enter on a password that is not ready shows the missing parts in red, and sends nothing', redBefore !== redAfter && page.url().endsWith('/register'), `${redBefore} -> ${redAfter}`);
  await page.locator('#password').fill('Qwerty123!');
  await page.locator('.pw-meter.refused p', { hasText: 'keyboard run' }).waitFor({ timeout: 3000 }).catch(() => {});
  check('a keyboard run is marked and cannot be sent', (await page.locator('.pw-meter.refused p', { hasText: 'keyboard run' }).count()) === 1 && await page.getByRole('button', { name: 'Create account' }).isDisabled());
  await page.locator('#password').fill('Kalem!12');
  check('8 characters with a capital and a symbol are enough', await page.getByRole('button', { name: 'Create account' }).isEnabled());
  await page.locator('#password').fill('Kalem!12 ');
  check('a space at the end is pointed out', await page.locator('.pw-space').isVisible());
  await page.locator('#password').fill('Kalem defter mavi!');
  await page.locator('.pw-meter.strong').waitFor({ timeout: 3000 }).catch(() => {});
  check('a password pasted at once is crossed off and judged in under a second', (await page.locator('.pw-meter.strong').count()) === 1);
  await page.locator('#password').fill('Kalem defter mavi bulut!');
  await page.locator('.pw-meter.strong').waitFor({ timeout: 3000 }).catch(() => {});
  check('a passphrase is strong and can be sent', (await page.locator('.pw-meter.strong').count()) === 1 && await page.getByRole('button', { name: 'Create account' }).isEnabled());
  await shot(page, 'register-strength');
  const f4 = (await outsider.call('/api/auth/state')).body.form;
  await wait(3100);
  const weak = await outsider.call('/api/auth/register', { name: 'Ece', email: 'ece2@kuzey.test', password: 'kalem123', lang: 'en', form: f4, website: '' });
  check('the server refuses a password without a capital too', weak.status === 400 && weak.body.error === 'weak-upper', weak.body.error);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.welcome').waitFor({ timeout: 8000 });
  check('a sub-domain of an allowed domain can sign up', true);
  await ctx.close();

  // ---------- approving new accounts ----------
  await owner.call('/api/admin/state', { mode: 'approve' }, 'PUT');
  ctx = await fresh(); page = await ctx.newPage();
  await page.goto(`${srv.url}/register`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('the sign-up page says accounts are approved', await page.getByText('approves new accounts').isVisible());
  await page.locator('#email').fill('kerem@gmail.com');
  await page.locator('#password').fill('Sabah kahvesi ve yürüyüş!');
  await wait(2500);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Almost there' }).waitFor({ timeout: 8000 });
  check('a new account is told it waits for approval', true);
  await shot(page, 'register-pending');
  const early = await client(srv.url).call('/api/auth/login', { email: 'kerem@gmail.com', password: 'Sabah kahvesi ve yürüyüş!', remember: false });
  check('it cannot sign in before it is approved', early.status === 403 && early.body.error === 'pending');
  await ctx.close();
  ctx = await fresh();
  await ctx.addCookies([{ name: 'sc_session', value: owner.cookie.split('=')[1], url: srv.url }]);
  page = await ctx.newPage();
  await page.goto(`${srv.url}/settings/server`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByText('1 account waits for your approval').waitFor({ timeout: 5000 });
  check('the owner sees the waiting account', true);
  await shot(page, 'server-waiting');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByText('1 account waits for your approval').waitFor({ state: 'detached', timeout: 5000 });
  const late = await client(srv.url).call('/api/auth/login', { email: 'kerem@gmail.com', password: 'Sabah kahvesi ve yürüyüş!', remember: false });
  check('once approved, it can sign in', late.status === 200, String(late.status));

  // ---------- the owner's note on the sign-up page ----------
  await owner.call('/api/admin/state', { mode: 'open', domains: '' }, 'PUT');
  await page.reload();
  await page.locator('#s-note-text').fill('This planner is for our team.\nPlans stay on our own server.');
  await page.locator('.note-form').getByRole('button', { name: 'Save' }).click();
  await page.locator('.note-form').getByRole('button', { name: 'Saved' }).waitFor({ timeout: 4000 });
  await ctx.close();
  ctx = await fresh(); page = await ctx.newPage();
  await page.goto(`${srv.url}/register`); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('the owner\'s note shows above the sign-up form', await page.getByText('This planner is for our team.').isVisible());

  // ---------- field checks, Caps Lock, and an address that already has an account ----------
  await page.locator('#email').fill('robin@');
  await page.locator('#password').focus();
  check('a broken address is pointed out once the field is left', await page.locator('#email-error').isVisible());
  // the automated keyboard does not report Caps Lock, so send the key event a real one would
  await page.locator('#password').dispatchEvent('keydown', { key: 'A', modifierCapsLock: true, bubbles: true });
  check('Caps Lock is pointed out while typing the password', await page.locator('.caps-warn').isVisible());
  await page.locator('#password').dispatchEvent('keyup', { key: 'a', modifierCapsLock: false, bubbles: true });
  check('the Caps Lock note goes when it is off', !(await page.locator('.caps-warn').count()));
  await page.locator('#email').fill('robin@hale.test');
  await page.locator('#password').fill('Kalem defter mavi bulut!');
  await shot(page, 'register-note');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name: 'Sign in instead' }).waitFor({ timeout: 8000 });
  check('a taken address offers sign-in and a reset', await page.getByRole('link', { name: 'Reset the password' }).isVisible());
  await shot(page, 'register-taken');
  await page.getByRole('link', { name: 'Sign in instead' }).click();
  await page.waitForURL('**/login');
  check('sign-in opens with the address filled in, not in the URL', (await page.locator('#email').inputValue()) === 'robin@hale.test' && !page.url().includes('robin'));
  await ctx.close();

  // ---------- an invite for one address ----------
  const forNur = (await owner.call('/api/admin/invites', { uses: 1, days: 7, note: '', email: 'nur@kuzey.test', lang: 'en' })).body;
  check('an invite can be made for one address', !!forNur.link && forNur.sent === false);
  const sly = client(srv.url), f5 = (await sly.call('/api/auth/state')).body.form;
  await wait(3100);
  const token = new URL(forNur.link).searchParams.get('invite');
  const wrong = await sly.call('/api/auth/register', { name: 'Sly', email: 'sly@kuzey.test', password: 'Kalem defter mavi bulut!', lang: 'en', form: f5, website: '', invite: token });
  check('that invite cannot be used with another address', wrong.status === 403 && wrong.body.error === 'invite-email');
  ctx = await fresh(); page = await ctx.newPage();
  await page.goto(forNur.link.replace(/^https?:\/\/[^/]+/, srv.url)); await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByText('This invite is for nur@kuzey.test').waitFor({ timeout: 5000 });
  check('the invited address comes filled in and fixed', (await page.locator('#email').inputValue()) === 'nur@kuzey.test' && await page.locator('#email').getAttribute('readonly') !== null);
  await page.locator('#password').fill('Sabah yürüyüşü ve çay!');
  await wait(2500);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.welcome').waitFor({ timeout: 8000 });
  check('the invited person signs up', true);
  await ctx.close();

  // ---------- asking for an invite (a fresh server: the hourly sign-up allowance above is used up) ----------
  {
    const srv2 = await startServer();
    const own = client(srv2.url);
    await own.call('/api/auth/setup', { email: 'robin@hale.org', password: 'Kalem defter mavi bulut!', lang: 'en' });
    await own.put('settings', { setupDone: true, tourDone: true });
    let c2 = await fresh(), p2 = await c2.newPage();
    await p2.goto(`${srv2.url}/login`); await p2.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
    check('with invites only, sign-in offers to ask for one', await p2.getByRole('link', { name: 'Ask for an invite' }).isVisible());
    await p2.getByRole('link', { name: 'Ask for an invite' }).click();
    await p2.locator('#email').fill('ece@kuzey.org');
    await p2.locator('#ask-note').fill('Ece from the design team');
    await shot(p2, 'ask-invite');
    await wait(3100);
    await p2.getByRole('button', { name: 'Ask for an invite' }).click();
    await p2.getByRole('heading', { name: 'Request sent' }).waitFor({ timeout: 6000 });
    check('a person can ask for an invite', true);
    const st2 = (await own.call('/api/admin/state')).body;
    check('the owner gets the request with its note', st2.requests.length === 1 && st2.requests[0].note === 'Ece from the design team');
    await c2.close();
    c2 = await fresh();
    await c2.addCookies([{ name: 'sc_session', value: own.cookie.split('=')[1], url: srv2.url }]);
    p2 = await c2.newPage();
    await p2.goto(`${srv2.url}/day/${new Date().toISOString().slice(0, 10)}`); await p2.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
    check('a dot on Settings says something waits', await p2.locator('.rail .attn').waitFor({ timeout: 5000 }).then(() => true, () => false));
    await p2.goto(`${srv2.url}/settings/server`); await p2.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
    await p2.getByText('1 person asks for an invite').waitFor({ timeout: 5000 });
    await shot(p2, 'server-requests');
    await p2.getByRole('button', { name: 'Send invite' }).click();
    await p2.locator('.invite-link input').waitFor();
    const link = await p2.locator('.invite-link input').inputValue();
    check('saying yes makes an invite for that address', /\/register\?invite=/.test(link) && !(await p2.getByText('asks for an invite').count()));
    check('the dot goes once nothing waits', !(await p2.locator('.rail .attn').count()));
    await c2.close();
    c2 = await fresh(); p2 = await c2.newPage();
    await p2.goto(link.replace(/^https?:\/\/[^/]+/, srv2.url)); await p2.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
    await p2.getByText('This invite is for ece@kuzey.org').waitFor({ timeout: 5000 });
    await p2.locator('#password').fill('Sabah kahvesi ve deniz!');
    await wait(2500);
    await p2.getByRole('button', { name: 'Create account' }).click();
    await p2.locator('.welcome').waitFor({ timeout: 8000 });
    check('the person who asked signs up with the invite', true);
    await c2.close();

    // ---------- password rules: the owner turns on the strong ones ----------
    c2 = await fresh();
    await c2.addCookies([{ name: 'sc_session', value: own.cookie.split('=')[1], url: srv2.url }]);
    p2 = await c2.newPage();
    await p2.goto(`${srv2.url}/settings/server`); await p2.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
    await p2.getByRole('button', { name: 'Strong' }).click();
    await p2.locator('#s-pw-cur').fill('Kalem defter mavi bulut!');
    check('turning on the strong rules asks the owner for a new password when theirs does not meet them', await p2.locator('#s-pw-new').isVisible({ timeout: 3000 }).catch(() => false));
    await p2.locator('#s-pw-new').fill('Kalem defter 7 mavi bulut!');
    await shot(p2, 'server-policy');
    await p2.getByRole('button', { name: 'Turn on strong rules' }).click();
    await p2.getByText('Strong rules are on.').waitFor({ timeout: 5000 });
    check('the strong rules are on', (await own.call('/api/auth/state')).body.policy === 'strong');
    check('the owner signs in with the new password', (await client(srv2.url).call('/api/auth/login', { email: 'robin@hale.org', password: 'Kalem defter 7 mavi bulut!' })).status === 200);
    check('the owner list marks who must choose a new password', await p2.getByText('new password due').isVisible());
    await c2.close();
    const ece = client(srv2.url);
    const eIn = await ece.call('/api/auth/login', { email: 'ece@kuzey.org', password: 'Sabah kahvesi ve deniz!', remember: false });
    check('an old password still signs in', eIn.status === 200, String(eIn.status));
    check('but nothing else works until a new one is chosen', (await ece.call('/api/doc/settings')).body.error === 'must-change');
    c2 = await fresh();
    await c2.addCookies([{ name: 'sc_session', value: ece.cookie.split('=')[1], url: srv2.url }]);
    p2 = await c2.newPage();
    await p2.goto(`${srv2.url}/day/${new Date().toISOString().slice(0, 10)}`); await p2.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => {});
    await p2.getByRole('heading', { name: 'Choose a new password' }).waitFor({ timeout: 5000 });
    await p2.locator('#current').fill('Sabah kahvesi ve deniz!');
    await p2.locator('#password').fill('Sabah kahvesi ve deniz!');
    check('the gate shows the strong rules and refuses the old password', (await p2.locator('.pw-needs > span.part').count()) === 5 && await p2.getByRole('button', { name: 'Save and continue' }).isDisabled());
    await p2.locator('#password').fill('Sabah 7 kahvesi ve deniz!');
    await shot(p2, 'must-change');
    await p2.getByRole('button', { name: 'Save and continue' }).click();
    await p2.locator('.welcome').waitFor({ timeout: 8000 });
    check('with a new password the planner opens', true);
    await c2.close();
    const back = await own.call('/api/admin/password-policy', { policy: 'basic' }, 'PUT');
    check('the owner can go back to the standard rules', back.status === 200 && (await own.call('/api/auth/state')).body.policy === 'basic');
    srv2.stop();
  }
} finally {
  await browser.close();
  srv.stop();
}
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} checks failed` : `all ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
