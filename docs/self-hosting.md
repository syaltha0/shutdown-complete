# Self-hosting

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

### Backups and recovery

Daily and manual `.db.gz` backups contain the entire SQLite database: accounts, documents,
authentication records, calendar tokens, push subscriptions, social data, and `meta.dav_key`.
The latter decrypts Nextcloud credentials; no separate DAV key file is needed. Treat backups
as secrets. User JSON exports contain documents only and cannot recover a server.

Keep an off-host copy of `data/backups`. Use the same application release for recovery.
Restore validates SQLite integrity, foreign keys, required core columns and schema version
(`PRAGMA user_version`, currently 0); newer versions are rejected. Deploy configuration
(`.env`, SMTP, proxy/TLS and any external push keys) is separate and must be retained separately.

For bare Node, obtain a backup with `node server/src/cli.mjs backup`, then recover into
a **new, empty directory** (never the running server's DATA_DIR):

```sh
node server/src/cli.mjs restore-new /safe/planner-manual-DATE.db.gz /srv/planner-recovered
DATA_DIR=/srv/planner-recovered node server/src/index.mjs
```

In PowerShell set `$env:DATA_DIR='C:\planner-recovered'` before starting Node.
Stop the original server before exposing the recovered one: both can send notifications
and synchronize remote calendars. Keep the original data directory until login, documents,
CalDAV and Nextcloud have been checked. `restore-new` refuses every nonempty destination.

For Docker Compose (the service mounts `./data` at `/data`):

```sh
docker compose exec planner node server/src/cli.mjs backup
docker compose stop planner
mkdir data-recovered
docker compose run --rm --no-deps -v ./data-recovered:/recovered planner node server/src/cli.mjs restore-new /data/backups/planner-manual-DATE.db.gz /recovered
```

Change the Compose data volume to `./data-recovered:/data`, then run `docker compose up -d`.
Keep `./data` unchanged for rollback. The account UI and legacy `restore <backup name>` CLI
stage recovery for the next restart instead; they preserve a before-restore backup, and startup
also saves the current database before replacing it. Do not manually delete SQLite WAL files.

Run `node tools/e2e/backup-restore.mjs` after `npm run build` for an isolated recovery rehearsal.

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


### Mobile reminders and offline edits

Settings → Notifications → **Even when the app is closed** subscribes this device to block reminders.
Choose a reminder time too. HTTPS and browser notification permission are required; on iPhone install the app
on the Home Screen first. The server generates and retains VAPID keys in its database, checks reminders every
minute in the subscription's time zone and removes expired subscriptions. Push carries only an encrypted generic
reminder signal, never block titles or schedule details. Tapping opens today's plan; delivery depends on the OS
and push service. Active subscriptions replace in-page block notifications, while automatic focus still works.
Signing out unsubscribes this browser. Set `VAPID_SUBJECT` to a real contact URI before enabling push.

Settings → Notifications also covers a subscribed device while the app is closed: a push when a focus session or a
break ends (on by default; the server reads the running phase from the day document, plans the push for its end
time, reads it again when that time comes, and re-plans on every restart), a morning "plan your day" reminder
(08:30, says how many blocks are planned) and an evening "time to shut down" reminder (the end of your workday,
else 17:30; not sent once the day's shutdown is done), each at a time of your choice in the device's time zone, with
weekends optional. An open page in front announces a phase end itself, so the service worker stays quiet then. The
notification's button ("Start break" / "Start focus", only when the next phase does not start by itself) opens the
app, where that phase starts. One account causes at most 240 pushes an hour. These need no new settings of the server.

Edits are queued by account in IndexedDB (localStorage fallback), survive reloads, and retry when connectivity
or window focus returns. The status line reports waiting changes. Concurrent edits retain the existing conflict
behavior: a 409 loads the newer server copy instead of overwriting it. Home Screen shortcuts open Today, Focus,
or the new-task input.


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
