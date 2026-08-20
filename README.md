# Flagship Solar — Inspections

Static web app. Capture one compliance inspection on site, then export it as a
PDF report **per discipline** — Electrical, Plumbing, Solar / PV, or Combined.

Runs entirely in the browser. No server, no build step, no dependencies.
GitHub Pages serves it as-is.

## Files to upload (repo root)

```
index.html
app.css
app.js
manifest.webmanifest
sw.js
.nojekyll                 <- stops GitHub Pages ignoring files; keep it
assets/letterhead.png     <- the letterhead printed on every page
assets/icon-192.png
assets/icon-512.png
```

That is the complete app. Upload all of them, keeping `assets/` as a folder.

## How the discipline split works

Two ideas, nothing more:

1. Every photo and every scope line carries a `disc` string — `"E"`, `"P"`,
   `"S"`, or any combination. `"EP"` means the item belongs in **both** the
   electrical and the plumbing report. The earth bonding on the geyser pipework
   is the real case for this: it is physically at the geyser but it is an
   electrical finding.
2. `exportReport(want)` filters on `disc` and renumbers the photos from 1.

Each export therefore gets its own photo numbering, its own section numbers,
its own scope of works, and its own sign-off block.

## Why the sign-off differs per discipline

An electrical CoC is signed by a registered person under the Electrical
Installation Regulations. A plumbing CoC is signed by a PIRB-registered
plumber. Different registration, often a different person. Each export asks
only for the registration that discipline needs; the combined export prints
both blocks and says so.

## The letterhead

`app.css` puts the whole report inside one `<table class="page">` with the
letterhead in `<thead>`. Browsers repeat `thead` on every printed page **and
reserve its vertical space**, so the logo can never be painted on top of the
content.

Do not replace this with `position: fixed`. That is what the previous version
did, and it is why the logo landed on top of the text from page 2 onward:
a fixed element is repainted on each page but nothing holds space for it.
Chrome's headless print also mis-places fixed elements outright.

## Exporting on a phone

Tap **Export → Electrical / Plumbing / Combined**, then in Chrome's print
sheet choose **Save as PDF**. Set *Paper size* to **A4** the first time —
Chrome remembers it. The suggested filename comes from the job number, so set
that on the Details tab.

## Storage

Everything is kept in IndexedDB on the device, saved as you type. Photos are
downscaled to 1400 px / JPEG 82% on capture.

Nothing is uploaded anywhere. That also means **clearing the browser's site
data deletes the inspections**. Use *Export → Download job as file* after a
site visit if the job matters; the resulting `.json` restores through *Load
job from file*.

## After you change any file

Bump `CACHE` in `sw.js` (`fs-inspections-v1` → `-v2`). The service worker
serves the cached copy first, so without the bump phones keep running the old
version.

## Adding a discipline later

Add one entry to `DISCIPLINES` and one to `SECTIONS` in `app.js`. Everything
else — the export buttons, the filtering, the numbering, the sign-off — is
generated from those two objects.
