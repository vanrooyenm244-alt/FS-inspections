# Flagship Solar Inspections — setup

Four files make up the app:

- `index.html` — the whole app (logo built in)
- `manifest.webmanifest` — name and icon for the home screen
- `sw.js` — makes it work offline
- `icon-192.png`, `icon-512.png` — home screen icons

## Getting it onto phones

The app needs to sit on an **https** address. Without https the browser will not
install it to the home screen and will not run offline. Any of these work and are free:

**GitHub Pages** — make a repo, drop the four files in, Settings → Pages → deploy from
main branch. You get `https://yourname.github.io/reponame/`.

**Netlify Drop** — go to app.netlify.com/drop and drag the folder in. Live in seconds.
Needs a computer to drag files.

**From the phone only (GitHub, no computer needed):** sign up at github.com in Chrome →
new repository, name it `inspect`, set it **Public** → Add file → Upload files → pick all
six from Downloads → Settings → Pages → Deploy from a branch, `main`, `/ (root)` → Save.
A minute later you have `https://yourname.github.io/inspect/`.

**Your own site** — if flagshipsolar.co.za already has hosting, put the folder in
something like `/inspect/` and it works at `https://www.flagshipsolar.co.za/inspect/`.

## Installing on a phone

**Android (Chrome):** open the address → menu (⋮) → *Add to Home screen* → *Install*.

**iPhone (Safari — must be Safari, not Chrome):** open the address → Share button →
*Add to Home Screen*.

After that it opens with its own icon, no browser bar, and works with no signal.
Open it once on wifi before heading to a job so the offline copy is cached.

## Why it has to be https

Opening `index.html` straight off the phone (a `file://` or `content://` address) will not
work properly:

- Chrome blocks the local database there, so nothing saves.
- The service worker will not register, so no offline use.
- It cannot be added to the home screen.

A `content://` link cannot be made clickable in WhatsApp or anywhere else — it is a private,
expiring handle Android gives to one app, not a web address. No prefix or symbol changes that.

## A note on the camera on Android

Chrome on Android 14 and 15 hides the Camera option when a file input specifies
`accept` or `capture`. The photo slots therefore use a plain `<input type="file">`
with neither attribute, which brings the Camera tile back. If a future Chrome
changes this again, that is the line to look at. Firefox on Android is not affected.

## Updating it later

Change any file, then **bump the version in `sw.js`** — change `flagship-v1` to
`flagship-v2`. Phones keep the old copy until that number changes.

## Where the data lives

Everything is stored in the browser's own database on that phone. It is not sent
anywhere and it is not backed up. Consequences worth knowing:

- Photos stay after closing the app or the phone going flat.
- Uninstalling the app, clearing site data, or "clear browsing data" wipes it.
- Nothing syncs between phones. Each phone has its own jobs and its own clause library.
- Export each job to PDF when you finish it. Treat the PDF as the record, not the app.

## The clause library

The seeded entries deliberately have **blank clause numbers**. They point you at the
right standard from plain-language search terms — type "neutral cable too thin" and it
finds SANS 10142-1, conductor sizing.

Fill the clause number in from your own copy of the standard, once, using *Add your own*
in the finder. It saves on the phone and is there from then on. Anything you add is
tagged "yours" and sorts to the top.
