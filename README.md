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

## Accounts and roles

Everyone signs in. Accounts live in the **Users** sheet; the script checks
them on every request. The app hides buttons a role can't use, but hiding is
only tidiness — the script is what actually enforces it.

**Three roles:**

- **Admin** — everything, plus the Users screen. Sees all workers' hours and is
  the only one who can change a closed cycle.
- **Technician** — inspections and timesheets for the whole team.
- **Worker** — their own hours only, current cycle only.

### First run

1. In `Code.gs`, set `ADMIN_USERNAME` to the username you intend to use.
2. Run `setup`, then deploy (below).
3. In the app, tap **Create account** and register with that exact username.
   You come out as Admin, Active, ready to sign in.
4. Everyone else registers the same way and lands as **Pending** with no role.
   Open **Users**, give them a role, then set them Active.

### What a worker can and can't do

- Only their own name appears on the timesheet screen.
- Only the current pay cycle can be edited. Past cycles are visible but locked.
  An Admin can still correct a closed cycle.
- Filing hours under someone else's name is refused by the script, whatever the
  app appears to allow.

### Edits are traceable

Sending a day that already exists **replaces** the row rather than adding a
second one, and writes a line to the **Log** sheet with the old and new values
side by side. So if hours change after the fact, you can see who changed what,
when, and what it was before.

### An honest limit

The app is public HTML — anyone can read its code. Sign-in decides what a normal
user sees and does, and the script refuses anything a role isn't allowed. But
someone technical with valid credentials could craft requests the app itself
would never send. For a team of five who know each other this is normally fine.
It is not a system for keeping out a determined outsider.

## Connecting the sheet

One-time setup, on a computer:

1. Open the Google Sheet on the work account.
2. Extensions → Apps Script. Delete what's there, paste in all of `Code.gs`.
3. Set `ADMIN_USERNAME` at the top.
4. Run → pick `setup` → Run. Approve the prompts. It builds Users, Timesheets,
   Workers and Log, and seeds the five names.
5. Deploy → New deployment → Web app.
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the `/exec` URL.

On each phone: open the app → **Connection settings** → paste the URL → Save and
test. Then sign in. The URL is stored per phone; you only do this once.

**"Anyone" sounds alarming but is required** — the phones aren't signed into
Google, so the script has to accept anonymous requests. The Users sheet is what
controls access.

**After changing `Code.gs`:** Deploy → Manage deployments → pencil → Version:
**New version** → Deploy. The URL stays the same. Skip this and the old code
keeps running.

### Entering a month

The Timesheets screen shows one pay cycle at a time, 25th to 24th. Arrows at the
top move between cycles.

Tap a worker's name to open their days; tap again to close. **Fill weekdays
07:00–17:00** stamps the whole cycle in one go, then you change only the days that
differ. Weekends are shaded and marked — every hour on them is overtime.

Days you don't fill in are simply not sent. Sick days, days off and anything else
go in the note line next to the job.

Everything is held on the phone as you type, per cycle, so a month can be entered
over several sittings. Nothing reaches the sheet until **Send to sheet**.

**Sending twice sends everything twice.** The sheet has no way to tell a genuine
second entry from a duplicate, so it will simply add the rows again. The app clears
the cycle after a successful send to make this less likely, but if you're unsure
whether a send went through, check the sheet before pressing it again.

### Where the rows land

Every send writes to three places at once:

- **Timesheets** — the master sheet, every row ever sent. Don't delete from here;
  it's what the other two are built from.
- **A tab per worker** — created automatically the first time that person's hours
  come through, and kept sorted by date. A new worker needs nothing set up.
- **Summary** — one line per worker per pay cycle: days, normal hours, overtime.
  This is the sheet to look at for payroll.

A **Flagship** menu appears in the sheet's menu bar with three items:

- *Rebuild summary* — recalculates Summary from the master sheet
- *Rebuild worker tabs* — wipes and rebuilds every worker tab from the master.
  Use this if a tab ever looks out of step, or after you edit rows by hand.
- *Check sheets / setup* — same as running `setup`

If the menu isn't there, close and reopen the sheet.

**Editing by hand:** correct the row on the master **Timesheets** sheet, then run
*Rebuild worker tabs*. Editing a worker tab directly will be overwritten the next
time that runs.

### How hours are worked out

- Normal day 07:00–17:00, less lunch (30 min default, editable per person)
- Started before 06:00 → those minutes count as overtime
- Arrived between 06:00 and 07:00 → the real time is recorded, but it counts as
  normal. People come in early; that isn't overtime.
- Worked past 17:00 → overtime
- Saturday and Sunday → every hour is overtime, no normal hours

The app deliberately does **not** apply 1.5x or 2x. It writes a `Day Type` column
(Weekday / Saturday / Sunday) and leaves the rate maths to a formula in the sheet,
where you can see it and check it. Getting a pay multiplier wrong inside app code
is the kind of error nobody notices for months.

### No signal

Hours are queued on the phone if the send fails, and go through automatically next
time the app is opened with signal. The Timesheets screen shows how many are waiting.

## The clause library

The seeded entries deliberately have **blank clause numbers**. They point you at the
right standard from plain-language search terms — type "neutral cable too thin" and it
finds SANS 10142-1, conductor sizing.

Fill the clause number in from your own copy of the standard, once, using *Add your own*
in the finder. It saves on the phone and is there from then on. Anything you add is
tagged "yours" and sorts to the top.
