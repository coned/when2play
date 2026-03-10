## v0.2

This release introduces the Rally coordination system, cross-platform Discord + web actions, and the Gaming Tree visualization, along with significant UI/UX improvements across every page.

### New (feat)

- Rally interaction system — `/call`, `/in`, `/brb`, `/out`, `/ping`, `/where` — with optional message for every action
- Cross-platform actions: Discord slash commands mirror web Rally panel
- Post commands: `/post schedule` (best overlapping time windows), `/post gamerank` (game rankings), `/post gametree` (gaming tree image to channel)
- `/call2select @user` — nudge someone to set their availability on the web
- Anonymous rally call option
- Share ranking button in Rally panel
- Schedule finder uses all users with availability set; configurable daily cutoff (default 8 AM ET)
- Admin-configurable Rally button labels and suggested phrases with drag-and-drop phrase editor
- User display name customization with optional Discord sync
- Light/dark mode toggle (☀/☾) independent of 5 selectable accent color palettes; active palette shown with checkmark
- Anonymous shame voting; non-anonymous entries show voter avatar and name

### New (qol)

- Post schedule shows times in viewer's local timezone (Discord timestamps on bot; browser local time on web)
- "On behalf of" attribution on all Discord post command channel broadcasts
- Voter avatars on same-day Shame Wall entries; anonymous placeholder for anonymous votes
- Adjacent availability time slots grouped into ranges with colored `+1` next-day badge
- Dates shown in Schedule, Availability column headers, and Who's Around Today
- Responsive availability grid: horizontal scroll on mobile, 3-column separator on desktop, dynamic column count
- User avatar stack on Who's Around Today slots
- Two-step Rally action flow: preview message before broadcast
- Steam game name search with debounced dropdown on game propose form
- Touch drag and drop-to-unrank support in game ranking UI
- Ocean teal accent theme (replaced forest green to avoid availability color conflict)
- Blog rendered from Markdown with a wider centered column

### Experimental

- Gaming Tree visualization — web view and automatic delivery as Discord image attachment via tree share polling

### Fix

- Display name update in header applies immediately without page reload
- Theme checkmark indicator replaces border/outline rings (no zoom-level visual glitch)
- Dates and day-offset logic corrected across Schedule, Availability, and Who's Around Today
- Past availability slots no longer hidden
- Schedule grouped slot layout alignment corrected
- Shame Wall correctly scopes today/week columns to current date window
- `+1` badge rendered without layout shift alongside time ranges

## v0.3

This release adds multi-guild support -- one bot instance and one API deployment now serve multiple Discord servers, each with a fully isolated database. Also includes admin tooling improvements and UX refinements.

### New (feat)

- Multi-guild architecture -- dynamic D1 database routing via `X-Guild-Id` header; each Discord server gets its own isolated data store
- Guild DB routing middleware -- API resolves the correct database binding per request based on guild context
- `/setchannel` persistence in D1 -- channel configuration survives bot restarts and redeploys (previously stored in local JSON)
- `/welcome` admin command -- posts a public introduction message explaining when2play and how to get started
- `/when2play` now replies as an ephemeral channel message instead of a DM -- fewer clicks for the user
- Day cutoff setting -- admin-configurable "today's cutoff" (default 5 AM ET) so late-night sessions still count as the previous day on the Availability page
- Settings export/import -- admin can export the full settings JSON and re-import it on the Settings page, with server-side validation against injection
- Schedule tab renamed to Dashboard

### New (qol)

- Guild name displayed in the Dashboard header so users know which server they are viewing
- Local timezone dates shown throughout the UI
- Guild-scoped slash command registration -- commands appear instantly in new guilds (no 1-hour global propagation delay)
- Stale global commands auto-cleared when guild-scoped registration is active

### Fix

- Multi-guild token isolation -- auth tokens are scoped per guild; using a token from one guild in another is rejected
- Bot fetch error handling -- all API responses guarded against non-JSON error bodies (fixes "Internal Server Error" parse crashes)
- Debug info stripped from production error responses; developers can opt in via `VERBOSE_ERRORS` environment variable
- Large integer precision preserved in settings retrieval
- Passed availability time slots show a deletion line instead of being hidden

### Style

- 18 historical migration files consolidated into a single init schema
- Default DB binding renamed to guild-specific format (`DB_<guild_id>`)
