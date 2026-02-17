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


describe('Race Condition: Concurrent Customer Creates', () => {
  const ids = [];

  it('creating 10 customers concurrently produces 10 unique IDs', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(request('POST', '/api/customers', {
        full_name: `Race Test ${i}`,
        first_name: `Race${i}`,
        address: `${100 + i} Race St`,
        phone: `555-${String(i).padStart(4, '0')}`,
        lat: 32.77 + i * 0.001,
        lng: -96.80 + i * 0.001
      }));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.status, 201, `Expected 201, got ${r.status}`);
      assert.ok(r.body.id);
      ids.push(r.body.id);
    }
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, 10, 'All IDs should be unique');
  });

  it('cleanup race test customers', async () => {
    for (const id of ids) {
      await request('DELETE', `/api/customers/${id}`);
    }
  });
});


describe('Race Condition: Concurrent Job Updates', () => {
  let custId = null;
  let jobId = null;

  it('setup: create customer and job', async () => {
    const c = await request('POST', '/api/customers', {
      full_name: 'Race Job Test',
      first_name: 'RaceJob',
      address: '200 Race Blvd',
      phone: '555-7700'
    });
    custId = c.body.id;
    const j = await request('POST', '/api/jobs', {
      customer_id: custId,
      job_description: 'Race Test Job',
      status: 'unscheduled'
    });
    jobId = j.body.id;
  });

  it('concurrent PATCH requests do not corrupt data', async () => {
    const updates = [
      { status: 'scheduled', notes: 'Update A' },
      { status: 'unscheduled', notes: 'Update B' },
      { price: 100, notes: 'Update C' },
      { price: 200, notes: 'Update D' },
      { notes: 'Update E' }
    ];
    const promises = updates.map(u => request('PATCH', `/api/jobs/${jobId}`, u));
    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.status, 200, 'All updates should succeed');
    }

    const final = await request('GET', `/api/jobs?customer_id=${custId}`);
    const jobs = final.body.jobs || final.body;
    const job = jobs.find(j => j.id === jobId);
    assert.ok(job, 'Job should still exist');
    assert.ok(job.notes, 'Notes should have a value (last write wins)');
  });

  it('cleanup', async () => {
    if (jobId) await request('DELETE', `/api/jobs/${jobId}`);
    if (custId) await request('DELETE', `/api/customers/${custId}`);
  });
});


describe('Race Condition: Duplicate Gap-Fill Session Prevention', () => {
  it('cannot create two active gap-fill sessions simultaneously', async () => {
    const c1 = await request('POST', '/api/customers', {
      full_name: 'GF Race A', first_name: 'GFRaceA', address: '301 GF St', phone: '555-3001',
      lat: 32.78, lng: -96.80, status: 'scheduled'
    });
    const c2 = await request('POST', '/api/customers', {
      full_name: 'GF Race B', first_name: 'GFRaceB', address: '302 GF St', phone: '555-3002',
      lat: 32.79, lng: -96.81, status: 'scheduled'
    });

    const r1 = await request('POST', '/api/routes', {
      name: 'GF Race Route 1', scheduled_date: new Date().toISOString().split('T')[0],
      status: 'active', stops: [{ customer_id: c1.body.id, stop_order: 1 }]
    });
    const r2 = await request('POST', '/api/routes', {
      name: 'GF Race Route 2', scheduled_date: new Date().toISOString().split('T')[0],
      status: 'active', stops: [{ customer_id: c2.body.id, stop_order: 1 }]
    });

    const sessionBody = {
      route_id: r1.body.id,
      cancelled_stop_id: 1,
      cancelled_job_id: 1,
      cancelled_customer_id: c1.body.id,
      reference_lat: 32.78,
      reference_lng: -96.80,
      reference_address: '301 GF St',
      cancelled_job_description: 'Residential Panel Cleaning'
    };

    const firstSession = await request('POST', '/api/gapfill/sessions', sessionBody);

    if (firstSession.status === 201) {
      const secondSession = await request('POST', '/api/gapfill/sessions', {
        ...sessionBody,
        route_id: r2.body.id,
        cancelled_customer_id: c2.body.id
      });
      assert.equal(secondSession.status, 409, 'Second session should be rejected (409 conflict)');
      assert.ok(secondSession.body.error.includes('already active'));

      await request('POST', `/api/gapfill/sessions/${firstSession.body.session.id}/close`);
    }

    if (r1.body.id) await request('DELETE', `/api/routes/${r1.body.id}`);
    if (r2.body.id) await request('DELETE', `/api/routes/${r2.body.id}`);
    if (c1.body.id) await request('DELETE', `/api/customers/${c1.body.id}`);
    if (c2.body.id) await request('DELETE', `/api/customers/${c2.body.id}`);
  });
});


describe('Race Condition: Concurrent Route Creation', () => {
  it('concurrent route creates for same date produce unique routes', async () => {
    const date = '2026-04-15';
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(request('POST', '/api/routes', {
        name: `Concurrent Route ${i}`,
        scheduled_date: date,
        status: 'draft',
        stops: []
      }));
    }
    const results = await Promise.all(promises);
    const createdIds = [];
    for (const r of results) {
      assert.equal(r.status, 201, `Route creation should succeed`);
      createdIds.push(r.body.id);
    }

    const uniqueIds = new Set(createdIds);
    assert.equal(uniqueIds.size, 5, 'All route IDs should be unique');

    for (const id of createdIds) {
      await request('DELETE', `/api/routes/${id}`);
    }
  });
});
