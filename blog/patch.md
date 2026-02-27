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
