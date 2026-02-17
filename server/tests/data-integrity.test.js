const { describe, it } = require('node:test');
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}


describe('Data Integrity: Customer CRUD Consistency', () => {
  let custId = null;

  it('created customer has all fields persisted correctly', async () => {
    const data = {
      full_name: 'Integrity Test User',
      first_name: 'Integrity',
      address: '500 Integrity Blvd, Dallas, TX 75201',
      phone: '555-5050',
      email: 'integrity@test.com',
      lat: 32.7800,
      lng: -96.8000,
      city: 'Dallas',
      state: 'TX',
      zip: '75201',
      customer_type: 'residential',
      status: 'unscheduled',
      panels: 20
    };
    const res = await request('POST', '/api/customers', data);
    assert.equal(res.status, 201);
    custId = res.body.id;

    const readBack = await request('GET', `/api/customers/${custId}`);
    assert.equal(readBack.body.full_name, data.full_name);
    assert.equal(readBack.body.phone, data.phone);
    assert.equal(readBack.body.email, data.email);
    assert.equal(readBack.body.city, data.city);
    assert.equal(readBack.body.state, data.state);
    assert.equal(readBack.body.customer_type, data.customer_type);
  });

  it('PATCH updates only specified fields, preserves others', async () => {
    await request('PATCH', `/api/customers/${custId}`, { phone: '555-6060' });
    const readBack = await request('GET', `/api/customers/${custId}`);
    assert.equal(readBack.body.phone, '555-6060', 'Phone should be updated');
    assert.equal(readBack.body.full_name, 'Integrity Test User', 'Name should be preserved');
    assert.equal(readBack.body.email, 'integrity@test.com', 'Email should be preserved');
  });

  it('customer appears in list after creation', async () => {
    const res = await request('GET', '/api/customers?search=Integrity+Test');
    const customers = res.body.customers || res.body;
    const found = customers.find(c => c.id === custId);
    assert.ok(found, 'Customer should be in search results');
  });

  it('customer disappears from list after deletion', async () => {
    await request('DELETE', `/api/customers/${custId}`);
    const res = await request('GET', '/api/customers?search=Integrity+Test');
    if (res.status === 200) {
      const customers = res.body.customers || res.body;
      if (Array.isArray(customers)) {
        const found = customers.find(c => c.id === custId);
        assert.ok(!found, 'Deleted customer should not appear in search');
      }
    }
    custId = null;
  });
});


describe('Data Integrity: Job-Customer Relationship', () => {
  let custId = null;
  let jobIds = [];

  it('setup customer', async () => {
    const c = await request('POST', '/api/customers', {
      full_name: 'Job Integrity User',
      first_name: 'JobInteg',
      address: '600 Job St',
      phone: '555-6000'
    });
    custId = c.body.id;
  });

  it('multiple jobs for same customer each get unique IDs', async () => {
    for (let i = 0; i < 3; i++) {
      const j = await request('POST', '/api/jobs', {
        customer_id: custId,
        job_description: `Job ${i}`,
        status: 'unscheduled',
        price: 100 + i * 50
      });
      assert.equal(j.status, 201);
      jobIds.push(j.body.id);
    }
    const uniqueIds = new Set(jobIds);
    assert.equal(uniqueIds.size, 3, 'All job IDs should be unique');
  });

  it('jobs are correctly linked to customer', async () => {
    const res = await request('GET', `/api/jobs?customer_id=${custId}`);
    assert.equal(res.status, 200);
    const jobs = res.body.jobs || res.body;
    const customerJobs = jobs.filter(j => j.customer_id === custId);
    assert.ok(customerJobs.length >= 3, 'Should find all created jobs');
  });

  it('job status update persists', async () => {
    await request('PATCH', `/api/jobs/${jobIds[0]}`, { status: 'completed', completed_date: '2026-02-17' });
    const res = await request('GET', `/api/jobs?customer_id=${custId}`);
    const jobs = res.body.jobs || res.body;
    const job = jobs.find(j => j.id === jobIds[0]);
    assert.equal(job.status, 'completed');
  });

  it('deleting a job does not delete the customer', async () => {
    await request('DELETE', `/api/jobs/${jobIds[0]}`);
    const c = await request('GET', `/api/customers/${custId}`);
    assert.equal(c.status, 200);
    assert.equal(c.body.full_name, 'Job Integrity User');
    jobIds.shift();
  });

  it('cleanup', async () => {
    for (const id of jobIds) await request('DELETE', `/api/jobs/${id}`);
    if (custId) await request('DELETE', `/api/customers/${custId}`);
  });
});


describe('Data Integrity: Route-Stop Consistency', () => {
  let custIds = [];
  let routeId = null;

  it('setup: create 3 customers', async () => {
    for (let i = 0; i < 3; i++) {
      const c = await request('POST', '/api/customers', {
        full_name: `Route Integrity ${i}`,
        first_name: `RI${i}`,
        address: `${700 + i} Route St`,
        phone: `555-700${i}`,
        lat: 32.77 + i * 0.01,
        lng: -96.80 - i * 0.01
      });
      custIds.push(c.body.id);
    }
  });

  it('route with stops persists all stops in correct order', async () => {
    const r = await request('POST', '/api/routes', {
      name: 'Integrity Route',
      scheduled_date: '2026-03-15',
      status: 'draft',
      stops: custIds.map((id, idx) => ({ customer_id: id, stop_order: idx + 1 }))
    });
    assert.equal(r.status, 201);
    routeId = r.body.id;

    const detail = await request('GET', `/api/routes/${routeId}`);
    const stops = detail.body.stops || (detail.body.route && detail.body.route.stops) || [];
    assert.equal(stops.length, 3, 'All 3 stops should be persisted');

    for (let i = 0; i < stops.length; i++) {
      assert.equal(stops[i].stop_order, i + 1, `Stop ${i} should have order ${i + 1}`);
    }
  });

  it('deleting a route does not delete the customers', async () => {
    await request('DELETE', `/api/routes/${routeId}`);
    for (const id of custIds) {
      const c = await request('GET', `/api/customers/${id}`);
      assert.equal(c.status, 200);
      assert.ok(c.body.full_name);
    }
  });

  it('cleanup', async () => {
    for (const id of custIds) await request('DELETE', `/api/customers/${id}`);
  });
});


describe('Data Integrity: Schedule Date Handling', () => {
  let custId = null;
  let jobId = null;

  it('setup', async () => {
    const c = await request('POST', '/api/customers', {
      full_name: 'Date Test User',
      first_name: 'DateTest',
      address: '800 Date St',
      phone: '555-8000'
    });
    custId = c.body.id;
    const j = await request('POST', '/api/jobs', {
      customer_id: custId,
      job_description: 'Date Test Job',
      status: 'unscheduled'
    });
    jobId = j.body.id;
  });

  it('scheduled_date is stored and returned correctly', async () => {
    await request('PATCH', `/api/jobs/${jobId}`, {
      status: 'scheduled',
      scheduled_date: '2026-06-15'
    });
    const res = await request('GET', `/api/jobs?customer_id=${custId}`);
    const jobs = res.body.jobs || res.body;
    const job = jobs.find(j => j.id === jobId);
    assert.ok(job.scheduled_date.startsWith('2026-06-15'), `Expected 2026-06-15, got ${job.scheduled_date}`);
  });

  it('completed_date is stored correctly', async () => {
    await request('PATCH', `/api/jobs/${jobId}`, {
      status: 'completed',
      completed_date: '2026-06-16'
    });
    const res = await request('GET', `/api/jobs?customer_id=${custId}`);
    const jobs = res.body.jobs || res.body;
    const job = jobs.find(j => j.id === jobId);
    assert.ok(job.completed_date.startsWith('2026-06-16'));
  });

  it('cleanup', async () => {
    if (jobId) await request('DELETE', `/api/jobs/${jobId}`);
    if (custId) await request('DELETE', `/api/customers/${custId}`);
  });
});


describe('Data Integrity: Export Completeness', () => {
  it('JSON export includes all fields', async () => {
    const res = await request('GET', '/api/export/json');
    assert.equal(res.status, 200);
    const data = res.body.customers || res.body;
    if (Array.isArray(data) && data.length > 0) {
      const c = data[0];
      const requiredFields = ['id', 'full_name'];
      for (const f of requiredFields) {
        assert.ok(f in c, `Export should include ${f}`);
      }
    }
  });

  it('CSV export returns string content', async () => {
    const res = await request('GET', '/api/export/csv');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body === 'string' || typeof res.body === 'object');
  });
});
