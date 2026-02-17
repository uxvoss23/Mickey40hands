const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const BASE = 'http://127.0.0.1:5000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let testCustomerId = null;
let testJobId = null;
let testRouteId = null;

describe('Integration: Customer → Job → Route Workflow', () => {
  it('creates a customer', async () => {
    const res = await request('POST', '/api/customers', {
      full_name: 'Integration Test User',
      first_name: 'Integration',
      address: '123 Test St, Dallas, TX 75201',
      phone: '555-0199',
      email: 'test@integration.com',
      lat: 32.7767,
      lng: -96.7970,
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      customer_type: 'residential',
      status: 'unscheduled'
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id, 'Should return customer id');
    testCustomerId = res.body.id;
  });

  it('reads the created customer back', async () => {
    const res = await request('GET', `/api/customers/${testCustomerId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.full_name, 'Integration Test User');
    assert.equal(res.body.phone, '555-0199');
  });

  it('updates the customer', async () => {
    const res = await request('PATCH', `/api/customers/${testCustomerId}`, {
      phone: '555-0200',
      panels: 24
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.phone, '555-0200');
  });

  it('creates a job for the customer', async () => {
    const res = await request('POST', '/api/jobs', {
      customer_id: testCustomerId,
      job_description: 'Residential Panel Cleaning',
      status: 'unscheduled',
      panel_count: 24,
      price: 150,
      price_per_panel: 6.25
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    testJobId = res.body.id;
  });

  it('reads the job back', async () => {
    const res = await request('GET', `/api/jobs?customer_id=${testCustomerId}`);
    assert.equal(res.status, 200);
    const jobs = res.body.jobs || res.body;
    assert.ok(Array.isArray(jobs));
    const job = jobs.find(j => j.id === testJobId);
    assert.ok(job, 'Job should exist');
    assert.equal(job.job_description, 'Residential Panel Cleaning');
  });

  it('updates the job status', async () => {
    const res = await request('PATCH', `/api/jobs/${testJobId}`, {
      status: 'scheduled',
      scheduled_date: '2026-03-01'
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'scheduled');
  });

  it('creates a route', async () => {
    const res = await request('POST', '/api/routes', {
      name: 'Integration Test Route',
      scheduled_date: '2026-03-01',
      status: 'draft',
      stops: [{ customer_id: testCustomerId, stop_order: 1 }]
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    testRouteId = res.body.id;
  });

  it('reads the route with stops', async () => {
    const res = await request('GET', `/api/routes/${testRouteId}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.stops || res.body.route, 'Should return route data');
  });

  it('customer shows in customer list', async () => {
    const res = await request('GET', '/api/customers?search=Integration+Test');
    assert.equal(res.status, 200);
    const customers = res.body.customers || res.body;
    assert.ok(Array.isArray(customers));
    const found = customers.find(c => c.id === testCustomerId);
    assert.ok(found, 'Customer should appear in search');
  });

  it('customer stats endpoint works', async () => {
    const res = await request('GET', '/api/customers/stats');
    assert.equal(res.status, 200);
    assert.ok(res.body.total !== undefined || res.body.totalCustomers !== undefined, 'Stats should include totals');
  });

  it('deletes the job', async () => {
    const res = await request('DELETE', `/api/jobs/${testJobId}`);
    assert.ok([200, 204].includes(res.status));
  });

  it('deletes the route', async () => {
    const res = await request('DELETE', `/api/routes/${testRouteId}`);
    assert.ok([200, 204].includes(res.status));
  });

  it('deletes the customer', async () => {
    const res = await request('DELETE', `/api/customers/${testCustomerId}`);
    assert.ok([200, 204].includes(res.status));
  });

  it('deleted customer is gone', async () => {
    const res = await request('GET', `/api/customers/${testCustomerId}`);
    assert.ok([404, 200].includes(res.status));
    if (res.status === 200) {
      assert.equal(res.body, null);
    }
  });
});

describe('Integration: Gap-Fill Session Lifecycle', () => {
  let gfCustomerId = null;
  let gfRouteId = null;
  let gfStopId = null;

  it('setup: create customer and route for gap-fill', async () => {
    const cRes = await request('POST', '/api/customers', {
      full_name: 'GapFill Test Customer',
      first_name: 'GapFill',
      address: '456 GF St, Dallas, TX 75202',
      phone: '555-0300',
      lat: 32.78,
      lng: -96.80,
      city: 'Dallas',
      state: 'TX',
      zip: '75202',
      customer_type: 'residential',
      status: 'scheduled'
    });
    assert.equal(cRes.status, 201);
    gfCustomerId = cRes.body.id;

    const rRes = await request('POST', '/api/routes', {
      name: 'GF Test Route',
      scheduled_date: new Date().toISOString().split('T')[0],
      status: 'active',
      stops: [{ customer_id: gfCustomerId, stop_order: 1 }]
    });
    assert.equal(rRes.status, 201);
    gfRouteId = rRes.body.id;

    const routeDetail = await request('GET', `/api/routes/${gfRouteId}`);
    if (routeDetail.body.stops && routeDetail.body.stops.length > 0) {
      gfStopId = routeDetail.body.stops[0].id;
    } else if (routeDetail.body.route && routeDetail.body.route.stops) {
      gfStopId = routeDetail.body.route.stops[0].id;
    }
  });

  it('gap-fill status check returns inactive when no session', async () => {
    const res = await request('GET', `/api/gapfill/route/${gfRouteId}/status`);
    assert.equal(res.status, 200);
    assert.equal(res.body.active, false);
  });

  it('gap-fill stats endpoint works', async () => {
    const res = await request('GET', '/api/gapfill/stats');
    assert.equal(res.status, 200);
    assert.ok(res.body.totalSessions !== undefined);
    assert.ok(res.body.fillRate !== undefined);
  });

  it('gap-fill tier messages return for all tiers', async () => {
    for (let tier = 1; tier <= 5; tier++) {
      const res = await request('GET', `/api/gapfill/messages/${tier}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.message);
      assert.ok(res.body.message.includes('{firstName}'));
    }
  });

  it('cleanup: delete test data', async () => {
    if (gfRouteId) await request('DELETE', `/api/routes/${gfRouteId}`);
    if (gfCustomerId) await request('DELETE', `/api/customers/${gfCustomerId}`);
  });
});

describe('Integration: Export Endpoints', () => {
  it('CSV export returns valid response', async () => {
    const res = await request('GET', '/api/export/csv');
    assert.equal(res.status, 200);
  });

  it('JSON export returns customer data', async () => {
    const res = await request('GET', '/api/export/json');
    assert.equal(res.status, 200);
    const data = res.body.customers || res.body;
    assert.ok(Array.isArray(data) || (typeof res.body === 'object' && res.body.customers));
  });
});

describe('Integration: Lists CRUD', () => {
  let listId = null;

  it('creates a saved list', async () => {
    const res = await request('POST', '/api/lists', {
      name: 'Test List',
      filters: { status: 'active' },
      columns: ['full_name', 'phone']
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);
    listId = res.body.id;
  });

  it('reads all lists', async () => {
    const res = await request('GET', '/api/lists');
    assert.equal(res.status, 200);
    const lists = res.body.lists || res.body;
    assert.ok(Array.isArray(lists) || typeof res.body === 'object');
  });

  it('deletes the list', async () => {
    if (listId) {
      const res = await request('DELETE', `/api/lists/${listId}`);
      assert.ok([200, 204].includes(res.status));
    }
  });
});
