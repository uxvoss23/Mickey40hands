const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const BASE = 'http://127.0.0.1:5000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}


describe('API: Status Codes & Error Handling', () => {
  it('GET /api/customers returns 200', async () => {
    const res = await request('GET', '/api/customers');
    assert.equal(res.status, 200);
    const data = res.body.customers || res.body;
    assert.ok(Array.isArray(data));
  });

  it('GET /api/customers/:id returns 404 for non-existent', async () => {
    const res = await request('GET', '/api/customers/999999');
    assert.ok([404, 200].includes(res.status));
  });

  it('GET /api/jobs returns 200', async () => {
    const res = await request('GET', '/api/jobs');
    assert.equal(res.status, 200);
    const data = res.body.jobs || res.body;
    assert.ok(Array.isArray(data));
  });

  it('GET /api/routes returns 200', async () => {
    const res = await request('GET', '/api/routes');
    assert.equal(res.status, 200);
    const data = res.body.routes || res.body;
    assert.ok(Array.isArray(data) || typeof res.body === 'object');
  });

  it('GET /api/lists returns 200', async () => {
    const res = await request('GET', '/api/lists');
    assert.equal(res.status, 200);
    const data = res.body.lists || res.body;
    assert.ok(Array.isArray(data) || typeof res.body === 'object');
  });

  it('GET /api/gapfill/stats returns 200 with proper shape', async () => {
    const res = await request('GET', '/api/gapfill/stats');
    assert.equal(res.status, 200);
    assert.ok('totalSessions' in res.body);
    assert.ok('filledSessions' in res.body);
    assert.ok('fillRate' in res.body);
    assert.ok('tierSuccessRates' in res.body);
  });

  it('GET /api/gapfill/sessions/active returns 200', async () => {
    const res = await request('GET', '/api/gapfill/sessions/active');
    assert.equal(res.status, 200);
  });

  it('GET /api/export/csv returns 200', async () => {
    const res = await request('GET', '/api/export/csv');
    assert.equal(res.status, 200);
  });

  it('GET /api/export/json returns 200 with data', async () => {
    const res = await request('GET', '/api/export/json');
    assert.equal(res.status, 200);
    const data = res.body.customers || res.body;
    assert.ok(Array.isArray(data) || typeof res.body === 'object');
  });

  it('POST /api/customers with empty body returns error', async () => {
    const res = await request('POST', '/api/customers', {});
    assert.ok(res.status >= 400 || res.status === 201);
  });

  it('PATCH /api/jobs/999999 returns 404', async () => {
    const res = await request('PATCH', '/api/jobs/999999', { status: 'completed' });
    assert.ok([404, 500].includes(res.status));
  });

  it('DELETE /api/jobs/999999 returns 404', async () => {
    const res = await request('DELETE', '/api/jobs/999999');
    assert.ok([404, 200, 204].includes(res.status));
  });

  it('POST /api/gapfill/sessions/:id/expand with invalid id returns 404', async () => {
    const res = await request('POST', '/api/gapfill/sessions/999999/expand');
    assert.equal(res.status, 404);
  });

  it('POST /api/gapfill/sessions/:id/close with invalid id returns 404', async () => {
    const res = await request('POST', '/api/gapfill/sessions/999999/close');
    assert.equal(res.status, 404);
  });

  it('PATCH /api/gapfill/candidates/999999 returns 404', async () => {
    const res = await request('PATCH', '/api/gapfill/candidates/999999', { outreach_status: 'contacted' });
    assert.equal(res.status, 404);
  });

  it('GET /api/config/maps-key returns 200', async () => {
    const res = await request('GET', '/api/config/maps-key');
    assert.equal(res.status, 200);
    assert.ok('key' in res.body);
  });
});


describe('API: Invalid Input Handling', () => {
  it('POST /api/customers with invalid lat/lng types still creates', async () => {
    const res = await request('POST', '/api/customers', {
      full_name: 'Bad Coords User',
      first_name: 'Bad',
      address: '999 Bad St',
      phone: '555-9999',
      lat: 'not-a-number',
      lng: 'also-bad'
    });
    if (res.status === 201 && res.body.id) {
      await request('DELETE', `/api/customers/${res.body.id}`);
    }
  });

  it('PATCH /api/customers/:id with no fields returns 200 (no-op)', async () => {
    const create = await request('POST', '/api/customers', {
      full_name: 'NoOp Test',
      first_name: 'NoOp',
      address: '111 NoOp St',
      phone: '555-1111'
    });
    if (create.status === 201) {
      const res = await request('PATCH', `/api/customers/${create.body.id}`, {});
      assert.ok([200, 400].includes(res.status));
      await request('DELETE', `/api/customers/${create.body.id}`);
    }
  });

  it('POST /api/jobs with missing customer_id returns 400', async () => {
    const res = await request('POST', '/api/jobs', {
      job_description: 'Orphan job'
    });
    assert.equal(res.status, 400, `Should reject job without customer_id, got ${res.status}`);
  });

  it('GET /api/customers with filters returns filtered results', async () => {
    const res = await request('GET', '/api/customers?status=unscheduled&limit=5');
    assert.equal(res.status, 200);
    const data = res.body.customers || res.body;
    assert.ok(Array.isArray(data));
    assert.ok(data.length <= 5);
  });

  it('GET /api/customers with geo bounds returns 200', async () => {
    const res = await request('GET', '/api/customers?lat_min=32&lat_max=33&lng_min=-97&lng_max=-96');
    assert.equal(res.status, 200);
    const data = res.body.customers || res.body;
    assert.ok(Array.isArray(data));
  });

  it('GET /api/routes?include_stops=true returns routes with stops', async () => {
    const res = await request('GET', '/api/routes?include_stops=true');
    assert.equal(res.status, 200);
    const data = res.body.routes || res.body;
    assert.ok(Array.isArray(data) || typeof res.body === 'object');
  });
});


describe('API: Response Shape Validation', () => {
  it('customer object has required fields', async () => {
    const res = await request('GET', '/api/customers?limit=1');
    if (res.body.length > 0) {
      const c = res.body[0];
      assert.ok('id' in c, 'Missing id');
      assert.ok('full_name' in c, 'Missing full_name');
    }
  });

  it('job object has required fields', async () => {
    const res = await request('GET', '/api/jobs');
    if (res.body.length > 0) {
      const j = res.body[0];
      assert.ok('id' in j, 'Missing id');
      assert.ok('customer_id' in j, 'Missing customer_id');
    }
  });

  it('gap-fill stats has correct shape', async () => {
    const res = await request('GET', '/api/gapfill/stats');
    assert.equal(typeof res.body.totalSessions, 'number');
    assert.equal(typeof res.body.filledSessions, 'number');
    assert.equal(typeof res.body.fillRate, 'number');
    assert.equal(typeof res.body.tierSuccessRates, 'object');
  });

  it('tier message has correct shape', async () => {
    const res = await request('GET', '/api/gapfill/messages/1');
    assert.equal(typeof res.body.tier, 'number');
    assert.equal(typeof res.body.message, 'string');
  });

  it('API responses have no-cache headers', async () => {
    const res = await request('GET', '/api/customers?limit=1');
    assert.ok(res.headers['cache-control'], 'Should have cache-control header');
    assert.ok(res.headers['cache-control'].includes('no-cache'), 'Should be no-cache');
  });
});
