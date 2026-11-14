# Development

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

