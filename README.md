# Clinic Timetable Output

## Static Stack

- Entrypoint: `index.html`
- Runtime: static browser app using CDN-hosted React, ReactDOM, Babel Standalone, Tailwind CDN, html2canvas, and Lucide.
- Install command: none required.
- Build command: none required.
- Required app secrets or environment variables: none.
- App authentication: frontend-only shared password gate using a SHA-256 digest in `auth-config.js`.

## Frontend-Only Password Gate

`FRONTEND_ONLY_SHARED_SECRET`

This app has a minimal shared-password gate before the timetable editor renders. This is not a security boundary. The SHA-256 digest is shipped to every browser in `auth-config.js`, so it is vulnerable to source inspection, offline guessing, and client-side bypass. Never describe this as server-side secret storage.

- Password location: no production plaintext password belongs in this repository. The current local-only test password is `LOCAL_TEST_ONLY_PASSWORD` for local verification only.
- Digest location: `auth-config.js` contains `passwordSha256Hex`.
- Before deployment: choose the real shared password locally, compute its SHA-256 hex digest, replace `passwordSha256Hex` in `auth-config.js`, and do not commit or store the plaintext password.
- Important limitation: the resulting digest still ships to browsers and remains inspectable by anyone who can load the app.
- Session behavior: successful login writes only an authenticated flag to `sessionStorage`, so reloads in the same browser session stay authenticated while a new browser session starts unauthenticated.
- Logout: the `登出` control clears the `sessionStorage` flag and returns to the login screen.

Example local digest replacement command:

```sh
python3 -c 'import getpass, hashlib; print(hashlib.sha256(getpass.getpass("Password: ").encode()).hexdigest())'
```

## Local Operation

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`.

## Tests

```sh
python3 -m unittest discover -s tests -v
node --test tests/auth_gate.test.cjs
```

The deployment smoke tests verify the HTML entrypoint, root element, pinned runtime dependency URLs, dependency order, auth script order, login gating, logout wiring, and absence of floating runtime aliases. The Node test verifies the same framework-free auth logic used by the browser.

## Browser Runtime Dependencies

- React: `https://unpkg.com/react@18.3.1/umd/react.production.min.js`
- ReactDOM: `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js`
- Babel Standalone: `https://unpkg.com/@babel/standalone@8.0.4/babel.min.js`
- Tailwind CDN: `https://cdn.tailwindcss.com/3.4.17`
- html2canvas: `https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js`
- Lucide: `https://unpkg.com/lucide@1.33.0/dist/umd/lucide.min.js`

## Recommended Vercel Settings

- Project name: `clinic-timetable-output`
- Framework Preset: Other
- Root Directory: `.`
- Install Command: leave empty
- Build Command: leave empty
- Output Directory: `.`
- Expected production URL form: `https://clinic-timetable-output.vercel.app`
- Hosting-level access protection: none configured. Do not add Vercel Authentication or paid Password Protection for this task; the frontend-only `FRONTEND_ONLY_SHARED_SECRET` gate is the only planned access gate.

Production deployment requires explicit human approval and must not be run now:

```sh
vercel --prod
```

## Production Smoke Checklist

- Production URL loads over HTTPS.
- Browser console has no dependency loading errors.
- Login screen renders before authentication; after successful login, the timetable UI renders in the `#root` entrypoint.
- Existing edit and export flows still work.
- No production plaintext app passwords are present in the page source.
- Access layer remains the frontend-only `FRONTEND_ONLY_SHARED_SECRET` gate, with no hosting-level or paid Vercel protection configured.

## Rollback

- Preferred rollback: promote the previous known-good Vercel deployment.
- Git rollback reference: commit `73bd68edc593d55859d83c6f09ed92b696391d89`.

## Portal URL Field

Use the canonical production URL in any Portal URL field after deployment, for example `https://clinic-timetable-output.vercel.app`. Do not use preview deployment URLs for production portal configuration. After rollback, update the Portal URL field only if the canonical production URL changes.
