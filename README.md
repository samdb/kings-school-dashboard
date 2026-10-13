# The Family School Desk — King's School Rochester

A private, local-only dashboard that reads King's School Rochester emails from Gmail
(**read-only**) and sorts them for one family: what names your child, what is for their
year group, what mentions an activity you follow, and what is general school news.

- Python 3 standard library backend, plain HTML/CSS/JS frontend. No build step, no
  third-party packages, no paid APIs, no external fonts, scripts or telemetry.
- Your profile, synced emails and saved/done/dismissed marks live only in `data/`
  (gitignored, created with `0700`/`0600` permissions).

## Run it

```bash
cd projects/kings-school-dashboard
python3 run.py            # or: python3 -m kingsdash
```

Open <http://127.0.0.1:8765/>. Press **Settings** and enter:

| Setting | Notes |
|---|---|
| Child's first name | Used for whole-word name matching. |
| Year group | 1–13 (default Year 3). |
| Activities to follow | One per line, e.g. `Chess Club`. Highlights mentions only. |
| Gmail accounts | Up to 5 addresses already signed in to the gog helper. |
| School search query | Default `from:(kings-rochester.co.uk) newer_than:180d`. |
| Auto-refresh | Minutes, default 30 (min 5). Runs only while the server runs. |
| Demo mode | Optional synthetic sample content, clearly labelled. Off by default. |

Nothing is shown until real email is synced — the dashboard never invents school activity.

### Environment overrides (optional)

See `.env.example`. Export them in the shell before starting; the app does not read `.env` files.

| Variable | Default |
|---|---|
| `KINGSDASH_GOG_BIN` | `gog-authenticated` (on `PATH`) |
| `KINGSDASH_PORT` | `8765` |
| `KINGSDASH_DATA_DIR` | `./data` |
| `KINGSDASH_COMMAND_TIMEOUT` | `45` seconds per helper call |
| `KINGSDASH_MAX_PAGES` | `4` search pages (50 threads each) per account |
| `KINGSDASH_MAX_THREADS` | `200` threads per account |
| `KINGSDASH_REFRESH_BUDGET` | `600` seconds total per refresh |

## Local-only access

The server binds **127.0.0.1 only** and has **no login of its own**. It is
designed for one person on one machine, not for production use.

To use it from another computer, use an SSH tunnel. Don't expose the port:

```bash
ssh -N -L 8765:127.0.0.1:8765 you@the-server
# then browse to http://localhost:8765/ on your own machine
```

Don't put it behind a public reverse proxy. Anyone who can reach the port can read the synced emails.

Further protections:

- `Host` header must be `localhost`, `127.0.0.1` or `[::1]` (any port, so SSH tunnels work) — blocks DNS-rebinding.
- Every mutation (`POST`) must carry an `Origin` matching the `Host`, `Content-Type: application/json`,
  a JSON object body under 32 KB, and pass strict type validation. Cross-site and form posts are refused.
- Only a fixed whitelist of files is served (`/`, `/static/app.js`, `/static/app.css`, `/static/favicon.svg`);
  every other path, including anything under `data/`, returns 404.
- Strict Content-Security-Policy (`default-src 'none'`, `script-src 'self'`, no inline script), `nosniff`,
  `no-referrer`, frame denial. Email text is always rendered with `textContent` — never as HTML.

## How Gmail sync works (read-only)

The dashboard only ever runs these two helper commands, with arguments passed as a list (no shell):

```
gog-authenticated --account ACCOUNT --readonly --no-input gmail search QUERY --max 50 --json [--page TOKEN]
gog-authenticated --account ACCOUNT --readonly --no-input gmail thread get THREAD_ID --json
```

- Every call has a timeout. Pagination stops at the page/thread cap, and the sidebar shows
  **Sync coverage** (threads loaded, whether older matches were not loaded, failures).
- Threads whose listing hasn't changed are reused from the last sync instead of re-fetched.
- One feed item per thread: the latest **incoming** message (your own replies never replace the
  school's message and never produce "actions"). The **Open in Gmail** link points at that message.
- Messages are de-duplicated within a thread, and the same email received in two family accounts is
  merged (by `Message-ID`). The feed is sorted newest first.
- Bodies: `text/plain` is preferred; otherwise HTML is converted to text (scripts/styles dropped).
  Quoted history (`On … wrote:`, `>` lines, Outlook headers, Gmail quote blocks) and signatures are
  removed for the excerpt and for matching. **Read here** shows the new text, with an option to show the
  full decoded text including earlier messages.
- Attachments are **not downloaded or parsed** — the card says how many were skipped.
- Writes are atomic (temp file + fsync + rename). If an account fails (expired auth, timeout, helper
  error), its error is shown and **previously synced emails stay**. Error messages are short, and tokens,
  secrets and file paths are redacted.
- Refreshes never overlap: a manual Refresh while one is running is refused (HTTP 409), and the scheduler
  skips. No system cron or service is installed — auto-refresh runs in-process only.

### Expired Gmail access

If a card at the top says **"Gmail access expired for …"**, the gog helper's token for that
account has expired or been revoked. On the machine running the dashboard, re-run your normal gog
sign-in for that account (for example `gog auth add you@example.com`, or however your
`gog-authenticated` wrapper is set up), then press **Refresh**. Emails you already had stay visible
in the meantime.

## How relevance is decided

Every card has a **Why this is here** panel. Rules (applied to the subject + newly-written text only):

| Category | Rule |
|---|---|
| **Names your child** | First name as a whole, capitalised word (`Robin`, `ROBIN`; not `robin`/`Robinson`). Wins even if another year is mentioned. |
| **Year N** | `Year 3`, `Yr 3`, `Y3`, `Year three`, lists (`Years 3 and 4`, `Year 3/4`) and ranges (`Years 1–6`). `Year 13`, `Year 30` and `2026` are not Year 3. |
| **Activities you follow** | The activity is mentioned. Labelled *possible relevance* — the dashboard never claims your child is enrolled. |
| **General school correspondence** | No year group matched; not necessarily a whole-school announcement. |
| **Other year groups** | Only other years are mentioned. |

Views: **For [child]** (name, year, activity matches), **Year N**, **All school** (all five sections).

**Possible action — check email** appears when wording like *consent, sign, return by, payment, book,
RSVP, deadline* is present in an incoming email. It is a keyword hint only — it doesn't confirm that a
task exists or is outstanding. No deadlines are inferred; the date shown is when the email was **received**.

Save / Mark done / Dismiss are stored in `data/marks.json` on this machine. Nothing is ever changed in Gmail.

## Limitations

- No authentication of its own: local single-user use only (loopback + SSH tunnel).
- Attachments (PDF letters, calendars, images) are not read. Content that only exists in an
  attachment won't be matched — open the email.
- Matching is keyword-based. A child's name that is also a common capitalised word (e.g. "May") can
  produce false positives. Unusual phrasings ("Lower School", "Upper Sixth", "Reception") are not mapped to year numbers.
- Quoted-history and signature removal are heuristics; unusual mail clients may slip through.
- Coverage is bounded by the page/thread caps and the time budget (shown in the sidebar).
- Gmail links use `authuser=<account>`; if the browser isn't signed in to that account, Gmail may ask you to switch.

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

Covers year-boundary matching (Year 3 vs 13, lists, ranges), direct names in another year, quoted
history, MIME decoding (plain/HTML/charsets/attachments), thread/account dedup, pagination caps,
failed-refresh retention, overlap refusal, command shape and read-only enforcement, error redaction,
file permissions, and HTTP privacy (Host validation, Origin checks, JSON validation, path traversal).
All fixtures are synthetic.

## Layout

```
run.py                 entry point
kingsdash/server.py    HTTP server, guards, route whitelist
kingsdash/service.py   refresh orchestration, scheduler, marks, feed assembly
kingsdash/gmail.py     gog helper client + thread → item reduction
kingsdash/mime.py      MIME/base64url decoding
kingsdash/textclean.py HTML→text, quoted-history/signature stripping, excerpts
kingsdash/matching.py  relevance rules and action hints
kingsdash/demo.py      synthetic demo content
kingsdash/config.py    env settings, profile validation
static/                index.html, app.css, app.js, favicon.svg
tests/                 unittest suite
data/                  (gitignored) config.json, state.json, marks.json
```
