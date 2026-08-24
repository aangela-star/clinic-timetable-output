# Clinic Timetable Output

## Static Stack

- Entrypoint: `index.html`
- Runtime: static browser app using CDN-hosted React, ReactDOM, Babel Standalone, Tailwind CDN, html2canvas, and Lucide.
- Install command: none required.
- Build command: none required.
- Required app secrets or environment variables: none.
- App authentication: none currently implemented in the app.

## Local Operation

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`.

## Tests

```sh
python3 -m unittest discover -s tests -v
```

The deployment smoke test verifies the HTML entrypoint, root element, pinned runtime dependency URLs, dependency order, and absence of floating runtime aliases.

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
- Recommended access layer on Vercel Pro: Vercel Authentication
- If the account has Enterprise or Advanced Deployment Protection: Password Protection is also acceptable.

Production deployment requires explicit human approval and must not be run now:

```sh
vercel --prod
```

## Production Smoke Checklist

- Production URL loads over HTTPS.
- Browser console has no dependency loading errors.
- Timetable UI renders in the `#root` entrypoint.
- Existing edit and export flows still work.
- No app secrets or credentials are present in the page source.
- Access layer matches the intended Vercel project protection setting.

## Rollback

- Preferred rollback: promote the previous known-good Vercel deployment.
- Git rollback reference: commit `797bec7`.

## Portal URL Field

Use the canonical production URL in any Portal URL field after deployment, for example `https://clinic-timetable-output.vercel.app`. Do not use preview deployment URLs for production portal configuration. After rollback, update the Portal URL field only if the canonical production URL changes.
