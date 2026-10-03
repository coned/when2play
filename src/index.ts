import { Hono } from 'hono';
import type { Bindings } from './env';
import { errorHandler } from './middleware/error';
import { cors } from './middleware/cors';
import { securityHeaders } from './middleware/security-headers';
import { foreignKeys } from './middleware/fk';
import { guildDb } from './middleware/guild';
import auth from './routes/auth';
import users from './routes/users';
import games from './routes/games';
import votes from './routes/votes';
import steam from './routes/steam';
import availability from './routes/availability';
import gather from './routes/gather';
import shame from './routes/shame';
import settings from './routes/settings';
import rally from './routes/rally';
import guilds from './routes/guilds';
import bot from './routes/bot';

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', errorHandler);
app.use('*', cors);
app.use('*', securityHeaders);

// version is the commit the Worker was deployed from (set by `make deploy` via --var GIT_SHA).
// c.env can be missing when the app is called without bindings (tests).
app.get('/api/health', (c) => {
	const version = c.env?.GIT_SHA || 'dev';
	return c.json({ ok: true, data: { status: 'healthy', version, timestamp: new Date().toISOString() } });
});

// Cross-guild bot endpoints: mounted before /api so they skip guildDb/foreignKeys.
app.route('/api/bot', bot);

const api = new Hono<{ Bindings: Bindings }>();
api.use('*', guildDb);
api.use('*', foreignKeys);
api.route('/auth', auth);
api.route('/users', users);
api.route('/games', games);
api.route('/games', votes);
api.route('/steam', steam);
api.route('/availability', availability);
api.route('/gather', gather);
api.route('/shame', shame);
api.route('/settings', settings);
api.route('/rally', rally);
api.route('/guilds', guilds);

app.route('/api', api);

export default app;
