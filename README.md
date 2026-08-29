# Hudaifa Ahamed — Portfolio (V1)

A single-page Data Engineer portfolio, built with [Eleventy](https://www.11ty.dev/) so the output is plain static HTML/CSS/JS — no framework runtime, free to host anywhere.

## Run it locally

```
npm install
npm start
```

This opens the site at `http://localhost:8080` and rebuilds automatically whenever you edit a file.

To produce the final static files (what actually gets deployed):

```
npm run build
```

The output lands in `_site/` — that folder is what your host serves. It's git-ignored; you don't commit it.

## Changing content — the only files you should ever need to touch

Everything that changes over time lives in `src/_data/*.json`. Editing these does not require touching any code, and you can do it straight from GitHub's website (open the file, click the pencil icon, edit, commit) without installing anything locally.

| File | What it controls |
|---|---|
| `src/_data/site.json` | Name, tagline, intro, contact details, resume filename, WhatsApp link, nav labels |
| `src/_data/careerPanel.json` | The three Career Control Panel values: experience start date, career status, current mode |
| `src/_data/certifications.json` | The certificate carousel — add/remove/reorder entries here |
| `src/_data/experience.json` | The Experience section and the condensed résumé view |
| `src/_data/projects.json` | The four case studies |
| `src/_data/skills.json` | Skills, grouped by category |
| `src/_data/mindset.json` | The Engineering Mindset bullets under About |
| `src/_data/learning.json` | The Continuous Development paragraph and "currently learning" tags |

A few examples:

- **"3+ years" will become "4+ years" automatically** — it's computed from `experienceStartDate` in `careerPanel.json` every time the site builds, so you never edit that number by hand. You'd only touch `experienceStartDate` if the start date itself was ever wrong.
- **Switch the mode lever to Employment:** in `careerPanel.json`, change `"mode": "LEARNING"` to `"mode": "EMPLOYMENT"`.
- **Add a certificate:** add one more object to the array in `certifications.json`, with an `image` path pointing at a file you've placed in `src/assets/images/certificates/`.

Only someone with access to this GitHub repository can make these edits — there's no separate admin panel or password to manage.

## Swapping the photo, resume, or certificate images

- **Photo:** replace `src/assets/images/profile.jpg` and `profile.webp` (and `profile-square.*` if you use it elsewhere later). Keep it web-sized — roughly 700px wide and well under 500KB is plenty; a full-resolution original is unnecessary weight.
- **Resume PDF:** replace `src/assets/resume/Hudaifa_Ahamed_Resume.pdf`. If you rename the file, also update `resumeFile` and `resumeFileName` in `site.json`.
- **Certificates:** drop new images into `src/assets/images/certificates/` and reference them from `certifications.json`.

## Setting up the contact form (required before it will deliver messages)

The form posts to Formspree, but it needs your own form endpoint:

1. Create a free account at [formspree.io](https://formspree.io) and add a new form.
2. Copy the endpoint URL it gives you (`https://formspree.io/f/xxxxxxxx`).
3. Paste it into `contactFormAction` in `src/_data/site.json`, replacing the placeholder.

Until you do this, the form will render but won't actually send anywhere.

## Deploying (free)

**GitHub Pages (recommended to start):**

1. Push this repo to GitHub.
2. In the repo's Settings → Pages, set the source to GitHub Actions, and add a simple Eleventy build workflow (or use Settings → Pages → "Deploy from a branch" with a `gh-pages` branch produced by `npm run build` — happy to wire up the GitHub Actions workflow file for you when you're ready to deploy).
3. Your site is live at `https://<your-username>.github.io/<repo-name>/`.

**Netlify (also free, slightly simpler):**

1. Push this repo to GitHub.
2. In Netlify, "Add new site" → import from GitHub → pick this repo.
3. Build command: `npx @11ty/eleventy`. Publish directory: `_site`.
4. Netlify builds and deploys automatically on every push.

**Adding a custom domain later:** once you own one, point it at whichever host you chose (both have a simple "Add custom domain" step) — no rebuild or code changes required.

## What's deliberately not in V1

Per the agreed blueprint: no Education section, no employer-specific Achievements (including the Best Performer recognition), no Recommendations placeholder, no Blog, no Learning Journal, no AWS/GenAI project write-ups, and no backend/database. All of these can be added later without restructuring the site — see the blueprint document for how each would slot in.
