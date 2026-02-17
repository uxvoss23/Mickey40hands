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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}


describe('Load: Concurrent API Reads', () => {
  it('handles 50 concurrent GET /api/customers requests', async () => {
    const start = Date.now();
    const promises = Array.from({ length: 50 }, () => request('GET', '/api/customers?limit=10'));
    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;

    let successCount = 0;
    for (const r of results) {
      if (r.status === 200) successCount++;
    }
    assert.ok(successCount >= 45, `At least 45/50 should succeed, got ${successCount}`);
    assert.ok(elapsed < 15000, `Should complete within 15s, took ${elapsed}ms`);
  });

  it('handles 30 concurrent GET /api/jobs requests', async () => {
    const start = Date.now();
    const promises = Array.from({ length: 30 }, () => request('GET', '/api/jobs'));
    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;

    const successes = results.filter(r => r.status === 200).length;
    assert.ok(successes >= 25, `At least 25/30 should succeed, got ${successes}`);
    assert.ok(elapsed < 15000, `Should complete within 15s, took ${elapsed}ms`);
  });

  it('handles 20 concurrent GET /api/routes requests', async () => {
    const promises = Array.from({ length: 20 }, () => request('GET', '/api/routes'));
    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 200).length;
    assert.ok(successes >= 18, `At least 18/20 should succeed, got ${successes}`);
  });

  it('handles mixed concurrent reads across endpoints', async () => {
    const start = Date.now();
    const promises = [
      ...Array.from({ length: 10 }, () => request('GET', '/api/customers?limit=5')),
      ...Array.from({ length: 10 }, () => request('GET', '/api/jobs')),
      ...Array.from({ length: 10 }, () => request('GET', '/api/routes')),
      ...Array.from({ length: 5 }, () => request('GET', '/api/gapfill/stats')),
      ...Array.from({ length: 5 }, () => request('GET', '/api/export/json')),
    ];
    const results = await Promise.all(promises);
    const elapsed = Date.now() - start;

    const successes = results.filter(r => r.status === 200).length;
    assert.ok(successes >= 35, `At least 35/40 should succeed, got ${successes}`);
    assert.ok(elapsed < 20000, `Should complete within 20s, took ${elapsed}ms`);
  });
});


describe('Load: Bulk Write Operations', () => {
  const createdIds = [];

  it('creates 20 customers rapidly in sequence', async () => {
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      const res = await request('POST', '/api/customers', {
        full_name: `Load Test ${i}`,
        first_name: `LT${i}`,
        address: `${900 + i} Load St`,
        phone: `555-9${String(i).padStart(3, '0')}`,
        lat: 32.77 + i * 0.001,
        lng: -96.80 + i * 0.001
      });
      assert.equal(res.status, 201);
      createdIds.push(res.body.id);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 30000, `Should create 20 in <30s, took ${elapsed}ms`);
  });

  it('reads all load test customers back', async () => {
    const res = await request('GET', '/api/customers?search=Load+Test');
    assert.equal(res.status, 200);
    const customers = res.body.customers || res.body;
    const found = customers.filter(c => c.full_name.startsWith('Load Test'));
    assert.ok(found.length >= 15, `Should find most load test customers, found ${found.length}`);
  });

  it('cleanup load test customers', async () => {
    const delPromises = createdIds.map(id => request('DELETE', `/api/customers/${id}`));
    await Promise.all(delPromises);
  });
});


describe('Stress: Rapid Sequential Requests', () => {
  it('100 rapid GETs to /api/customers/stats do not crash server', async () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      const res = await request('GET', '/api/customers/stats');
      results.push(res.status);
    }
    const successes = results.filter(s => s === 200).length;
    assert.ok(successes >= 90, `At least 90/100 should succeed, got ${successes}`);
  });

  it('server still responds normally after stress', async () => {
    const res = await request('GET', '/api/customers?limit=1');
    assert.equal(res.status, 200);
    const data = res.body.customers || res.body;
    assert.ok(Array.isArray(data));
  });
});


describe('Stress: Large Payload Handling', () => {
  it('handles customer with very long notes', async () => {
    const longNotes = 'X'.repeat(50000);
    const res = await request('POST', '/api/customers', {
      full_name: 'Long Notes User',
      first_name: 'LongNotes',
      address: '111 Notes St',
      phone: '555-1199',
      customer_notes: longNotes
    });
    if (res.status === 201) {
      const readBack = await request('GET', `/api/customers/${res.body.id}`);
      assert.ok(readBack.body.customer_notes.length >= 40000, 'Long notes should persist');
      await request('DELETE', `/api/customers/${res.body.id}`);
    } else {
      assert.ok([400, 413, 500].includes(res.status), 'Should fail gracefully');
    }
  });

  it('handles bulk import with many records', async () => {
    const customers = Array.from({ length: 50 }, (_, i) => ({
      full_name: `Bulk ${i}`,
      first_name: `B${i}`,
      address: `${i} Bulk St`,
      phone: `555-B${String(i).padStart(3, '0')}`
    }));
    const res = await request('POST', '/api/customers/bulk', { customers });
    assert.ok([200, 201, 400].includes(res.status), 'Bulk import should handle gracefully');
    if (res.status === 200 || res.status === 201) {
      const search = await request('GET', '/api/customers?search=Bulk');
      const searchData = search.body.customers || search.body;
      const bulkCustomers = searchData.filter(c => c.full_name.startsWith('Bulk '));
      for (const c of bulkCustomers) {
        await request('DELETE', `/api/customers/${c.id}`);
      }
    }
  });
});
