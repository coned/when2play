import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import {
	getAvailability,
	setAvailability,
	clearAvailability,
	getAvailabilityStatus,
	upsertAvailabilityStatus,
	getLastWeekSlots,
	getAvailabilityStatusForDate,
	getDistinctAvailabilityDates,
	getDatesWithTentativeSlots,
} from '../db/queries/availability';
import { uuid, now } from '../db/helpers';
import type { UserRow } from '../db/queries/users';

const MAX_DATE_RANGE_DAYS = 31;

/** Validate YYYY-MM-DD string is a real calendar date. Returns the normalised string or null. */
function parseDate(s: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
	const d = new Date(s + 'T12:00:00Z');
	if (isNaN(d.getTime())) return null;
	// Round-trip check: rejects "2026-02-30" etc.
	return d.toISOString().split('T')[0] === s ? s : null;
}

type AvailEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const availability = new Hono<AvailEnv>();

availability.use('/*', requireAuth);

// GET /api/availability/my-status?from=YYYY-MM-DD&to=YYYY-MM-DD
availability.get('/my-status', async (c) => {
	const user = c.get('user');
	const from = c.req.query('from');
	const to = c.req.query('to');

	if (!from || !to) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'from and to query params required' } }, 400);
	}

	const parsedFrom = parseDate(from);
	const parsedTo = parseDate(to);
	if (!parsedFrom || !parsedTo) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'invalid date format (YYYY-MM-DD)' } }, 400);
	}

	// Build date array
	const dates: string[] = [];
	const cur = new Date(parsedFrom + 'T12:00:00Z');
	const end = new Date(parsedTo + 'T12:00:00Z');
	if (cur > end) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'from must be <= to' } }, 400);
	}
	while (cur <= end) {
		dates.push(cur.toISOString().split('T')[0]);
		cur.setUTCDate(cur.getUTCDate() + 1);
		if (dates.length > MAX_DATE_RANGE_DAYS) {
			return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: `date range exceeds ${MAX_DATE_RANGE_DAYS} days` } }, 400);
		}
	}

	// 1. Get explicit status rows
	const statusRows = await getAvailabilityStatus(c.env.DB, user.id, dates);
	const statusMap = new Map(statusRows.map((r) => [r.date, r.status]));

	// 2. Get dates where user has actual slots
	const datesWithSlots = await getDistinctAvailabilityDates(c.env.DB, user.id, dates);
	const slotDates = new Set(datesWithSlots);

	// 3. For dates with neither status nor slots, check last-week auto-fill
	const needAutoFillCheck: string[] = [];
	for (const date of dates) {
		if (!statusMap.has(date) && !slotDates.has(date)) {
			needAutoFillCheck.push(date);
		}
	}

	// Compute last-week dates to check
	const lastWeekDates: string[] = [];
	for (const date of needAutoFillCheck) {
		const d = new Date(date + 'T12:00:00Z');
		d.setUTCDate(d.getUTCDate() - 7);
		lastWeekDates.push(d.toISOString().split('T')[0]);
	}

	const lastWeekSlotDates = lastWeekDates.length > 0
		? new Set(await getDistinctAvailabilityDates(c.env.DB, user.id, lastWeekDates))
		: new Set<string>();

	// Check which dates have tentative slots (slot_status = 'tentative')
	const tentativeSlotDates = await getDatesWithTentativeSlots(c.env.DB, user.id, dates);

	// Build response
	const result: Record<string, { status: string | null; hasTentativeSlots?: boolean }> = {};
	for (const date of dates) {
		let status: string | null;
		if (statusMap.has(date)) {
			status = statusMap.get(date)!;
		} else if (slotDates.has(date)) {
			// Legacy data (pre-feature) - treat as manual
			status = 'manual';
		} else {
			// Check if last-week date had slots
			const d = new Date(date + 'T12:00:00Z');
			d.setUTCDate(d.getUTCDate() - 7);
			const lwDate = d.toISOString().split('T')[0];
			status = lastWeekSlotDates.has(lwDate) ? 'tentative' : null;
		}

		const entry: { status: string | null; hasTentativeSlots?: boolean } = { status };
		if (tentativeSlotDates.has(date)) {
			entry.hasTentativeSlots = true;
		}
		result[date] = entry;
	}

	return c.json({ ok: true, data: result });
});

// POST /api/availability/:date/confirm
availability.post('/:date/confirm', async (c) => {
	const user = c.get('user');
	const date = c.req.param('date');

	if (!parseDate(date)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'invalid date format (YYYY-MM-DD)' } }, 400);
	}

	// Check if user already has slots for this date
	const existingSlots = await getAvailability(c.env.DB, { user_id: user.id, date });

	if (existingSlots.length > 0) {
		// Just mark as confirmed
		await upsertAvailabilityStatus(c.env.DB, user.id, date, 'confirmed');
		return c.json({ ok: true, data: existingSlots });
	}

	// Copy from last week
	const d = new Date(date + 'T12:00:00Z');
	d.setUTCDate(d.getUTCDate() - 7);
	const lastWeekDate = d.toISOString().split('T')[0];

	const lastWeekSlots = await getAvailability(c.env.DB, { user_id: user.id, date: lastWeekDate });

	if (lastWeekSlots.length === 0) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'no last-week slots to confirm' } }, 404);
	}

	// Insert copies for the target date
	const timestamp = now();
	const results = [];
	for (const slot of lastWeekSlots) {
		const id = uuid();
		const slotStatus = slot.slot_status ?? 'available';
		await c.env.DB
			.prepare('INSERT INTO availability (id, user_id, date, start_time, end_time, created_at, slot_status) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.bind(id, user.id, date, slot.start_time, slot.end_time, timestamp, slotStatus)
			.run();
		results.push({ id, user_id: user.id, date, start_time: slot.start_time, end_time: slot.end_time, created_at: timestamp, slot_status: slotStatus });
	}

	await upsertAvailabilityStatus(c.env.DB, user.id, date, 'confirmed');

	return c.json({ ok: true, data: results });
});

// GET /api/availability?user_id=&date=
availability.get('/', async (c) => {
	const user = c.get('user');
	let userId = c.req.query('user_id');
	const date = c.req.query('date');

	// If user_id is specified but different from authenticated user,
	// only allow it when also filtering by date (overlap queries).
	// Personal data queries are always scoped to the authenticated user.
	if (userId && userId !== user.id && !date) {
		userId = user.id;
	}

	const slots = await getAvailability(c.env.DB, { user_id: userId, date });

	// When querying by date (overlap queries), augment with tentative + status
	if (date && !userId) {
		// Collect user IDs that have real slots for this date
		const realUserIds = new Set(slots.map((s) => s.user_id));

		// Get status rows for this date
		const statusRows = await getAvailabilityStatusForDate(c.env.DB, date);
		const statusByUser = new Map(statusRows.map((r) => [r.user_id, r.status]));

		// Users with a status row for this date should NOT get auto-filled
		// (they explicitly acted on this date, even if they have no current slots)
		const excludeFromAutoFill = new Set([...realUserIds, ...statusByUser.keys()]);

		// Get last-week slots for users who don't have real data and no status row
		const tentativeSlots = await getLastWeekSlots(
			c.env.DB,
			date,
			Array.from(excludeFromAutoFill),
		);

		// Build augmented response
		const augmentedSlots = slots.map((s) => ({
			...s,
			status: statusByUser.get(s.user_id) ?? 'manual',
		}));

		// Map tentative slots to target date
		for (const slot of tentativeSlots) {
			augmentedSlots.push({
				...slot,
				id: `tentative-${slot.user_id}-${slot.start_time}`,
				date,
				status: 'tentative',
			});
		}

		return c.json({ ok: true, data: augmentedSlots });
	}

	return c.json({ ok: true, data: slots });
});

// PUT /api/availability - bulk replace slots for a date
availability.put('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ date: string; slots: Array<{ start_time: string; end_time: string; slot_status?: string }> }>();

	if (!body.date || !body.slots) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'date and slots required' } }, 400);
	}

	const result = await setAvailability(c.env.DB, user.id, body.date, body.slots);
	return c.json({ ok: true, data: result });
});

// DELETE /api/availability?date=
availability.delete('/', async (c) => {
	const user = c.get('user');
	const date = c.req.query('date');

	if (!date) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'date query param required' } }, 400);
	}

	await clearAvailability(c.env.DB, user.id, date);
	return c.json({ ok: true, data: null });
});

export default availability;
