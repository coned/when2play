import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { getAvailability, setAvailability, clearAvailability } from '../db/queries/availability';
import type { UserRow } from '../db/queries/users';

type AvailEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const availability = new Hono<AvailEnv>();

availability.use('/*', requireAuth);

// GET /api/availability?user_id=&date=
availability.get('/', async (c) => {
	const userId = c.req.query('user_id');
	const date = c.req.query('date');
	const slots = await getAvailability(c.env.DB, { user_id: userId, date });
	return c.json({ ok: true, data: slots });
});

// PUT /api/availability — bulk replace slots for a date
availability.put('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ date: string; slots: Array<{ start_time: string; end_time: string }> }>();

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
