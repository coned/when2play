import { Hono } from 'hono';
import type { Bindings } from './env';
import { errorHandler } from './middleware/error';
import { cors } from './middleware/cors';
import { foreignKeys } from './middleware/fk';
import auth from './routes/auth';
import users from './routes/users';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', errorHandler);
app.use('*', cors);
app.use('/api/*', foreignKeys);

app.get('/api/health', (c) => {
	return c.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
});

app.route('/api/auth', auth);
app.route('/api/users', users);

export default app;
