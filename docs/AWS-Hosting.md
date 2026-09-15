# Hosting Pulse on AWS

Pulse is a **static single-page app**. `npm run build` produces ~1.4 MB in
`dist/um-supervisor/browser` — HTML, one JS bundle, one stylesheet, a favicon. There is no
server, no database, and no API call at runtime; the demonstration data is generated in the
browser from the deterministic pools in `src/app/data`.

That matters for the hosting decision more than anything else below: **there is nothing to run**,
so this is a file-serving problem, not a deployment architecture problem.

## Two realistic paths

### 1. Amplify Hosting — closest to what Render does today

Connect the GitHub repo, pick the branch, and Amplify builds on every push. `amplify.yml` and
`customHttp.yml` in the repo root are already written for this and mirror `render.yaml`.

Two things the files cannot carry, both set in the Amplify console:

- **SPA rewrite** — source `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff2?|ttf|map|json)$)([^.]+$)/>`,
  target `/index.html`, type **200 (Rewrite)**. Without it every deep link 404s.
- **Node 20** — the project has no `engines` field and Angular 22 needs 20+. Set the build image
  accordingly; `amplify.yml` also attempts `nvm use 20` defensively.

Free TLS, branch previews, custom domain through Route 53 or an external registrar.

### 2. S3 + CloudFront — if it must live in an existing account

More control, more moving parts, no build pipeline unless you add one (CodeBuild or a GitHub
Action publishing on push).

- Private S3 bucket, origin access control — **not** S3 website hosting, which cannot serve TLS
  on a custom domain.
- CloudFront distribution, ACM certificate in **us-east-1** (CloudFront only reads certs there).
- Custom error responses: **403 and 404 → `/index.html`, response code 200.** That is the SPA
  fallback; 403 matters because a private bucket returns 403, not 404, for a missing key.
- Cache behaviours matching `customHttp.yml`: hashed assets immutable for a year, `index.html`
  never cached. Caching `index.html` is how a deploy silently fails to reach anyone — it is the
  file that points at the new bundle hashes.
- Invalidate `/index.html` on deploy.

## Things worth deciding before, not after

**Is this demonstration data or does it look like production?** Nothing here is real PHI — every
member is generated — but the screens are deliberately realistic, and a Pulse instance sitting on
a client-facing AWS domain will be read as a client system by someone. If it goes anywhere
adjacent to the real NextGen tenant, label it as a demonstration environment in the page itself,
not only in conversation.

**Does it need to be private?** It is public on Render today. On AWS, gating it is cheap and
worth doing if it will carry client-branded scenarios: CloudFront signed URLs, Amplify's built-in
basic auth (per branch, one setting), or Cognito in front of CloudFront if it needs real accounts.

**Whose account, and who owns the pipeline?** The only genuine blocker in any of this. The build
is thirty seconds and the artefact is 1.4 MB; everything else is access.

## What does not change

The demo docs in this folder are plain HTML files with no dependencies — they can be served from
the same bucket or distribution, or handed over as files, and need no build step at all.
