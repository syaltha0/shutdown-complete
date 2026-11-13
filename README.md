# Shutdown Complete

A self-hosted planner for **time-block planning**: give every hour of the day a plan, redraw it when the day
changes, and end each day with a shutdown ritual. For school, work or the rest of life: plan the hours you choose,
or all 24. Runs on your own server, in English and Turkish.

![The day: time blocks in revision columns, daily metrics, tasks and notes](docs/screenshots/day.jpg)

> Shutdown Complete is an independent project. It is not affiliated with or endorsed by Cal Newport or the publishers
> of the *Time-Block Planner*.

## What it does

- **Overview** — one look at where things stand: today's plan as a line through the hours with the block running
  now, what is left to do, the week day by day, what is coming up (exams, dates, events), friends focusing.
- **Today** — a two-page spread like the paper planner: the time grid on the right, with up to **four revision
  columns**. When the plan breaks, *Revise from now* crosses out the rest of the day and redraws it in the next column.
  On the left: daily metrics, the *Shutdown complete* box, a task list and notes to capture things without leaving the block.
  Drag a task onto the grid to give it a block, save a day as a **template** (offered again on its weekdays), and
  **print** the day on one A4 page to keep it on the desk.
- **Weekly schedule** — make a block repeat on chosen weekdays (classes, training); every week's days get it.
  Give blocks a **subject** and see the hours planned and focused per subject. Open tasks of earlier days are offered
  on today (or moved by themselves), showing how long each has waited. Optional **reminders** as a block begins.
- **Week, Month, Quarter** — multi-scale planning. A weekly plan, monthly goals with dates to remember and a calendar,
  the season's goals. Each scale shows the one above it.
- **Calendars** — link a Google, Outlook or iCloud calendar by its private iCal address; its events show faintly on the
  day's grid (in your own time zone, repeats and exceptions included) and one click turns an event into an appointment block.
  Read-only: nothing is written to the calendar. The server fetches the feed and refuses addresses on its own network.
- **Weekly planning** — the start of the week, step by step: last week (and what to carry over), the month, the
  season and the week's events, what this week is for, and which days each item goes on. A quiet reminder on
  Monday and Tuesday.
- **On a phone** — swipe sideways between days, weeks and months; hold a block for a moment to move it.
- **Keyboard shortcuts** (press `?`) and **undo** for anything deleted (the note at the bottom, or Ctrl+Z).
- **Focus** — a pomodoro timer that runs inside your blocks. A finished session is logged on the day, and time spent
  in a deep-focus block is added to your *Deep focus* metric by itself.
- **Tasks** — task lists of your own plus Today, Next 7 days, Important, In progress and Completed: start and due
  dates, priority, progress, tags, notes, subtasks, a time estimate, and tasks that **repeat** (every day, every 2 days,
  on chosen weekdays, every month, every N weeks, counted from the due date or from the day they are done). Drag to
  order them or onto a list or tag, drag one from the day onto its hours to give it a block. A day says when its tasks
  need more time than it has free. Phone and desktop task apps keep them over **CalDAV**, and they can stay in step
  with a **Nextcloud** (see below).
- **Plans that hang together** — a month goal can serve a season goal, a week's item a month goal, a day's task a week's item; each shows what it serves and how far what serves it has come, and breaks down into the scale below in one click. Tasks take smaller steps, and a task made from a board card moves the card when it is done.
- **Only what you use** — Settings → Features turns off the inbox, boards, countdowns, habits, metrics, focusing together or the exam planner.
- **Boards** — Planka-style projects and kanban boards for work that runs over several days: personal projects and team projects shared with friends on the same server (title, optional description, members), each holding boards as tabs, lists you drag by their header, cards with labels, due dates, estimates, tasks, a description and a stopwatch, a filter by label or text, a colour per project (a few tones or any colour of your own), board templates of your own (made from scratch or saved from a board, with or without its cards); any card can go to today's tasks or the inbox.
- **Countdown** — the days left to the dates that matter (exams, deadlines, trips, birthdays that come back every year); the nearest one shows its days as a small calendar, exams planned in Month count down by themselves, and an exam can be prepared for straight from its countdown.
- **Focus room** — the whole screen for one session, with rain, waves, a fire or brown noise made in the browser.
- **Focus together** — friends on the same server see when each other is focusing (if they share it) and can start a
  session together that ends for everyone at the same moment.
- **Exam planner** — an exam's topics spread over the days before it, in the free time between your blocks, with
  review days at the end; spread again when the days change.
- **Plan and reality** — what the revision columns show over weeks: when the day usually breaks, which blocks run
  long (and a realistic length when you plan the next one).
- **The day's card** — a picture of a finished day to keep or share.
- **Habits** — your yes-or-no metrics as a month grid with streaks; a tick there is the same tick as on the day.
- **Metrics** — eight weeks or a quarter of any metric, focus time and the shutdown streak.
- **Shutdown** — your end-of-day ritual, step by step, ending with *Schedule shutdown, complete*.
- **Accounts** — sign-up with optional e-mail confirmation (and a hint when the address looks mistyped), a short
  first-run setup that asks what the planner is for and what you will do with it (school, work, everyday life; studying, exams, sport…) and sets up the hours, metrics, subjects, reminders and the online parts from the answers, **passkeys**, "keep me signed in", a list of signed-in
  devices, two-step sign-in (TOTP, with recovery codes), password reset by e-mail or from the command line.
- **Sign-ups your way** — open to anyone (optionally only some e-mail domains), open but **approved by you**, by
  **invite link** only (people can ask for one from the sign-up page), or closed; invite links can be limited in uses and days and revoked, or made for one address (sent by e-mail when it is set up); a short note from you can greet people
  on the sign-up page. Bot sign-ups are turned
  away without a CAPTCHA or any outside service.
- **Password rules you choose** — standard (8 characters with a capital letter and a symbol; runs and repeats such as
  12345 are refused) or strong (12 characters with every kind of character; common passwords, ones made of the
  person's name and easily guessed ones are refused too). The rules tick themselves off under the field as people type,
  and the server checks the same. Turning on the strong rules asks you to meet them first; everyone else whose password
  does not meet them picks a new one at their next sign-in.
- **Light and dark**, or whatever the device is set to; animations on, reduced, or as the system says.
- **Installable** on a phone or desktop (a PWA): it opens in its own window, shows your last plan without a
  connection and notifies you when a focus session ends.
- **Week in review** — a page for each finished week (`/review/<week>`): planned against done, focus and deep time,
  shutdowns; with e-mail set up, people who ask for it get it on Sunday evening.
- **Timetable import** — bring classes from a calendar file into the weekly schedule (Settings → Weekly schedule).
- **Server backups** — a daily compressed copy of the whole server in `data/backups`; the owner can make, download,
  upload and restore them in *Settings → Server*.
- Syncs between devices, warns when two devices edit the same page, exports and imports one's own planner as JSON.

| | |
|---|---|
| ![Sign in, beside five short clips of the planner in use](docs/screenshots/sign-in.jpg) | ![The day in the dark theme](docs/screenshots/day-dark.jpg) |
| ![The month](docs/screenshots/month.jpg) | ![Habits](docs/screenshots/habits.jpg) |
| ![The overview: today, what is left, the week, what is coming up](docs/screenshots/home.jpg) | ![Focus](docs/screenshots/focus.jpg) |

## Run it with Docker

You need Docker with Compose v2.24 or newer.

```bash
git clone https://github.com/syaltha0/shutdown-complete.git
cd shutdown-complete
cp .env.example .env        # optional: e-mail, public address, port
docker compose up -d --build
```

Open `http://<server>:3000` (or the address your reverse proxy serves). The first visit shows a **setup screen**:
the account you create there is the owner of this installation. A new server takes only people you invite; each account has its own,
separate planner. In *Settings → Server* you can choose between open
sign-ups (optionally only some e-mail domains), sign-ups you approve, invite links only, or none, and make invite
links to send.

Data lives in `./data/planner.db` (SQLite). The server keeps a daily copy in `./data/backups` (see `BACKUP_HOUR`); copy that folder somewhere else too.

### HTTPS with nginx

The container listens on `127.0.0.1:3000` only. Put a reverse proxy with HTTPS in front of it; sign-in cookies are
marked `Secure`, so plain `http://` only works with `COOKIE_SECURE=false` (for trying it out).

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/planner
sudo nano /etc/nginx/sites-available/planner     # set server_name to your domain
sudo ln -s /etc/nginx/sites-available/planner /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d planner.example.com
```

Sign-in, two-step and app-password limits count requests per address. The planner believes `X-Forwarded-For` (its
last entry, the one your proxy appended) only from a proxy on the same machine or a private network, as with the nginx
example; reached directly from the internet it uses the connection's own address. Pages carry a content security
policy, and request bodies are capped (1 MB of JSON, 16 MB for an import, 6 MB for a calendar file, 1 MB over CalDAV).

### E-mail (optional)

Set `SMTP_URL` (for example `smtps://user:password@smtp.example.com:465`), `MAIL_FROM` and `APP_URL` in `.env`.
With e-mail, new addresses are confirmed and people can reset their own passwords. Without it, sign-ups are not
confirmed and a forgotten password is reset by the server's owner from the command line.

### Task apps and Nextcloud

The task lists are served over CalDAV at `https://planner.example.com/dav/` (`/.well-known/caldav` leads there), so
DAVx⁵ with Tasks.org or OpenTasks, Thunderbird and Apple Reminders can keep them. Apps sign in with the account's
e-mail and an **app password** made in Settings → Account → Task apps, one per device. The nginx example above passes
everything through; another proxy must let the WebDAV methods (PROPFIND, REPORT, MKCALENDAR...) through.

Settings → Account → Nextcloud links the lists to a Nextcloud (its address, user name and an app password made in
Nextcloud): each list becomes a task calendar there, and changes go both ways every few minutes and soon after a change.
Only the server's owner may link a Nextcloud on the server's own network.

### Command line

```bash
docker compose exec planner node server/src/cli.mjs users
docker compose exec planner node server/src/cli.mjs reset-password person@example.com   # prints a temporary password (a new one is asked at sign-in)
docker compose exec planner node server/src/cli.mjs disable-2fa person@example.com
docker compose exec planner node server/src/cli.mjs make-admin person@example.com
docker compose exec planner node server/src/cli.mjs signups invite    # or: open, approve, closed
docker compose exec planner node server/src/cli.mjs approve person@example.com   # let in an account that waits for approval
docker compose exec planner node server/src/cli.mjs domains company.com,school.edu   # with open sign-ups, only these (or: none)
docker compose exec planner node server/src/cli.mjs invite 1 7        # an invite link for 1 sign-up, valid 7 days (0 = no limit)
```

### Updating

```bash
git pull && docker compose up -d --build
```

A ready-made image is also built by GitHub Actions on every push to `main` (`ghcr.io/syaltha0/shutdown-complete:latest`; a `v*` tag gives a versioned one).

### Deploy behind a reverse proxy

For Nginx Proxy Manager, create an HTTPS Proxy Host for the planner, forward to its HTTP port,
enable Force SSL and forward the original Host and X-Forwarded-Proto headers. In Advanced,
use `client_max_body_size 10m;` (or your intended backup upload limit). Do not cache `/dav/` or `/api/`.

- Verify `/.well-known/caldav` returns **301** to `/dav/` on the same HTTPS host; do not send it to Nextcloud.
- Pass OPTIONS, GET, HEAD, PUT, PROPFIND, REPORT, MKCALENDAR, PROPPATCH and DELETE unchanged.
- Preserve Authorization, Content-Type, Depth, If-Match and If-None-Match request headers, ETag response headers and XML/calendar bodies.
- Avoid proxy authentication or method restrictions on `/dav/`; use a planner app password in DAVx5.
- Test discovery, task creation, update with ETag, stale ETag (412), and deletion through the public HTTPS address.
- In DAVx5, select each Nextcloud list from one account only. Synced lists are hidden on the planner's direct CalDAV by default; Settings → Account → Nextcloud can explicitly publish individual lists with a duplicate warning.
- Set `TZ` to the planner's intended timezone. New timed tasks are exported in UTC; imported timezone definitions and unchanged dates are preserved.

For split DNS (a public Nextcloud hostname resolving to a LAN address), the server owner may link
Nextcloud directly. For ICS subscriptions, set `CALENDAR_PRIVATE_HOSTS=cloud.example.org`
on the planner service and restart it. This is an exact hostname allowlist, including redirects;
do not list untrusted hosts. `CALENDAR_ALLOW_PRIVATE=on` permits **all users** to fetch any private
HTTP(S) destination and is intended for isolated test servers. Keep it unset in production.
Default SSRF checks remain in force for other hosts. A private-address error can mean split DNS;
ask the administrator to grant the exact calendar hostname. Public ICS publication is read-only;
keep its bearer URL secret, and use CalDAV for task edits.

### Settings

| Variable | Default | What it does |
|---|---|---|
| `APP_URL` | taken from the request | Public address used in e-mail links. Set it whenever `SMTP_URL` is set: otherwise a visitor can choose the host in a password-reset link |
| `TZ` | system timezone | IANA timezone for planner task dates and new timed CalDAV exports |
| `CALENDAR_PRIVATE_HOSTS` | empty | Comma-separated exact hostnames allowed on private networks for ICS and DAV sync |
| `CALENDAR_ALLOW_PRIVATE` | unset | `on` disables private-address protection globally; isolated tests only |
| `SMTP_URL` | empty (e-mail off) | SMTP server for confirmations and password resets |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Push service contact URI; set to your HTTPS site or administrator mailto address |
| `MAIL_FROM` | `Shutdown Complete <no-reply@localhost>` | Sender of those e-mails |
| `COOKIE_SECURE` | `true` | Send sign-in cookies over HTTPS only |
| `SOURCE_URL` | this repository | Link to the source code shown in the app (see License) |
| `PLANNER_PORT` | `3000` | Host port the container is published on (127.0.0.1 only) |
| `BACKUP_HOUR` | `3` | Hour (server time, 0-23) after which the daily backup is made |
| `BACKUP_KEEP` | `7` | How many backups are kept |
| `WEEKLY_HOUR` | `18` | Hour on Sunday the week-in-review e-mail is sent (with e-mail set up) |

## Development

### Mobile reminders and offline edits

Settings → Notifications → **Even when the app is closed** subscribes this device to block reminders.
Choose a reminder time too. HTTPS and browser notification permission are required; on iPhone install the app
on the Home Screen first. The server generates and retains VAPID keys in its database, checks reminders every
minute in the subscription's time zone and removes expired subscriptions. Push carries only an encrypted generic
reminder signal, never block titles or schedule details. Tapping opens today's plan; delivery depends on the OS
and push service. Active subscriptions replace in-page block notifications, while automatic focus still works.
Signing out unsubscribes this browser. Set `VAPID_SUBJECT` to a real contact URI before enabling push.

Edits are queued by account in IndexedDB (localStorage fallback), survive reloads, and retry when connectivity
or window focus returns. The status line reports waiting changes. Concurrent edits retain the existing conflict
behavior: a 409 loads the newer server copy instead of overwriting it. Home Screen shortcuts open Today, Focus,
or the new-task input.

Node 24 or newer.

```bash
npm install
npm run dev:server      # API on :3000
npm run dev:client      # Vite on :5173, proxies /api to :3000
```

Open `http://localhost:5173` and create the first account. The server is Hono on Node with the built-in `node:sqlite`;
the client is React + TypeScript built with Vite. Every visible string lives in `client/src/lib/i18n.tsx` and
`client/src/lib/i18n-auth.ts` (English and Turkish); adding a language means adding one more dictionary.

```
client/   React app (screens, components, the shared document store in lib/useDoc.ts)
server/   API, accounts, sessions and passkeys (src/index.mjs, db.mjs, auth.mjs, webauthn.mjs, mail.mjs, cli.mjs),
          CalDAV and Nextcloud sync (caldav.mjs, vtodo.mjs, davsync.mjs), backups, week in review, friends and teams
deploy/   nginx example
tools/    recorder, screenshots and browser tests (below)
```

### Tools

The tools drive the built app in a real browser (Chrome, Edge or Chromium; set `CHROME_PATH` if it is somewhere
unusual). Each one starts its own throwaway server with a demo account in a temporary folder and deletes it when it
is done, so your own planner is never touched. Build first: `npm run build`.

| Command | What it does |
|---|---|
| `npm run test:e2e` | Browser checks of passkeys, templates, task drag, printing, the dark theme, the sign-in tutorial, the PWA files, creating an account (bot protection, the e-mail hint, the first-run setup, invites), calendars, shortcuts, undo, weekly planning, task lists, CalDAV and Nextcloud sync, the week in review, backups and the first-run setup at every screen size |
| `npm run tutorial:record` | Re-records the sign-in tutorial in every language (`-- --lang tr` for one) and renders the film. Needs ffmpeg (`FFMPEG_PATH`, Playwright's copy, or on the `PATH`). Run it after a UI change, then `npm run build` again |
| `npm run tutorial:render` | Renders the film again from the last recording (kept in `tools/tutorial/.cache/`), to change how it looks without recording again; `-- --stills 2,9.5 --out <dir>` writes just those frames, `-- --probe` prints where the camera looks |
| `node tools/screenshots.mjs` | Retakes the README screenshots in `docs/screenshots/` |
| `node tools/serve-demo.mjs` | A signed-in demo planner on `http://localhost:3200`, for design inspectors and quick looks (`?theme=dark` switches the theme) |
| `node tools/make-icons.mjs` | Redraws the app icons in `client/public/icons/` |

The tutorial is made in two passes. `tools/tutorial/record.mjs` drives the real app through five short scenes and
keeps the raw screen frames, where the cursor went and what each step is about. `tools/tutorial/render.mjs` then draws
every frame of the finished film in `compositor.html`: the app as a window on a quiet backdrop, a title card for each
chapter, a spring camera that moves in on the action, a soft spotlight, the cursor and a caption for each step. The
sign-in page only plays the result (`client/public/tutorial/<lang>/tutorial.webm`, its `poster.jpg`, and
`tutorial.json` with the chapter times for the progress bars). The words of the cards and captions live in
`client/src/lib/reel.ts`; after changing them, `npm run tutorial:render` is enough.

## License

Shutdown Complete is free software under the **GNU Affero General Public License v3.0** (see [LICENSE](LICENSE)).
You may use, study, change and share it. If you run a modified version for other people over a network, you must
offer them its source code; set `SOURCE_URL` to where your version lives.
Third-party code and fonts are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


### Calendar subscription and readable exports

Settings > Account > Calendar subscription creates a private, read-only ICS address for calendar apps.
Copy it when shown: only its SHA-256 hash is stored. Renewing the address immediately revokes the old one;
disable the subscription to revoke access entirely. Anyone with the address can read the feed, so keep it private.
Select your account time zone and optionally include dated tasks, then create or renew the address to save those options.
The feed contains active-column blocks from seven days ago through thirty days ahead, and optionally top-level dated tasks as all-day events.
Block times are converted from the selected zone to UTC, including daylight saving changes.

Settings > Your data also downloads Markdown (daily blocks, tasks, notes, metrics and weekly/monthly/quarterly goals),
blocks CSV, and metrics CSV. These are generated in your browser; JSON remains the full backup/import format.
CSV fields are quoted, use UTF-8 with a BOM, and spreadsheet formula prefixes are neutralised.
