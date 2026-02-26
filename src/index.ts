import { Hono } from 'hono';
import type { Bindings } from './env';
import { errorHandler } from './middleware/error';
import { cors } from './middleware/cors';
import { foreignKeys } from './middleware/fk';
import auth from './routes/auth';
import users from './routes/users';
import games from './routes/games';
import votes from './routes/votes';
import steam from './routes/steam';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', errorHandler);
app.use('*', cors);

app.get('/api/health', (c) => {
	return c.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
});

const api = new Hono<{ Bindings: Bindings }>();
api.use('*', foreignKeys);
api.route('/auth', auth);
api.route('/users', users);
api.route('/games', games);
api.route('/games', votes);
api.route('/steam', steam);

app.route('/api', api);

export default app;
