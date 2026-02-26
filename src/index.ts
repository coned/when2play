import { Hono } from 'hono';
import type { Bindings } from './env';

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) => {
	return c.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
});

export default app;
