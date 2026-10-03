import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('Health endpoint', () => {
	it('returns healthy status', async () => {
		const response = await app.request('/api/health');
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({
			ok: true,
			data: { status: 'healthy' },
		});
		expect(body.data.timestamp).toBeDefined();
	});

	it('reports "dev" as the version when GIT_SHA is not set', async () => {
		const response = await app.request('/api/health', {}, {});
		const body = await response.json();
		expect(body.data.version).toBe('dev');
	});

	it('reports the deployed commit from GIT_SHA as the version', async () => {
		const response = await app.request('/api/health', {}, { GIT_SHA: 'abc1234-dirty' });
		const body = await response.json();
		expect(body.data.version).toBe('abc1234-dirty');
	});
});
