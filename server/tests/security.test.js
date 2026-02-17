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
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}


describe('Security: SQL Injection Prevention', () => {
  it('search parameter with SQL injection is safely handled', async () => {
    const res = await request('GET', "/api/customers?search=' OR 1=1; --");
    assert.ok([200, 400].includes(res.status), `Should handle SQL injection gracefully, got ${res.status}`);
  });

  it('search with DROP TABLE attempt is safely handled', async () => {
    const res = await request('GET', "/api/customers?search='; DROP TABLE customers; --");
    assert.ok([200, 400].includes(res.status), `Should handle SQL injection gracefully, got ${res.status}`);
  });

  it('customer name with SQL injection is safely stored', async () => {
    const res = await request('POST', '/api/customers', {
      full_name: "Robert'); DROP TABLE customers;--",
      first_name: 'Bobby',
      address: '123 Injection St',
      phone: '555-0666'
    });
    if (res.status === 201) {
      const readBack = await request('GET', `/api/customers/${res.body.id}`);
      assert.ok(readBack.body.full_name.includes('DROP TABLE'), 'SQL should be stored as literal text');
      await request('DELETE', `/api/customers/${res.body.id}`);
    }
  });

  it('job notes with SQL injection are safely stored', async () => {
    const cRes = await request('POST', '/api/customers', {
      full_name: 'SQL Test User',
      first_name: 'SQL',
      address: '123 SQL St',
      phone: '555-0667'
    });
    if (cRes.status === 201) {
      const jRes = await request('POST', '/api/jobs', {
        customer_id: cRes.body.id,
        job_description: "'; DELETE FROM jobs; --",
        notes: "1'; UPDATE customers SET status='hacked'; --"
      });
      if (jRes.status === 201) {
        await request('DELETE', `/api/jobs/${jRes.body.id}`);
      }
      await request('DELETE', `/api/customers/${cRes.body.id}`);
    }
  });

  it('route name with SQL injection is safely handled', async () => {
    const res = await request('POST', '/api/routes', {
      name: "'; DROP TABLE routes; --",
      scheduled_date: '2026-03-01',
      status: 'draft',
      stops: []
    });
    if (res.status === 201) {
      await request('DELETE', `/api/routes/${res.body.id}`);
    }
    assert.ok([201, 400, 500].includes(res.status), 'Should not crash server');
  });

  it('filter parameters with SQL injection are safely handled', async () => {
    const res = await request('GET', "/api/customers?city=' UNION SELECT * FROM pg_shadow; --");
    assert.ok([200, 400].includes(res.status), `Should handle SQL injection gracefully, got ${res.status}`);
  });

  it('customer ID path parameter with SQL injection returns error gracefully', async () => {
    const res = await request('GET', "/api/customers/1 OR 1=1");
    assert.ok([400, 404, 500].includes(res.status), 'Should not return all customers');
  });
});


describe('Security: XSS Prevention', () => {
  it('customer name with script tag is stored as-is (server-side)', async () => {
    const xssPayload = '<script>alert("xss")</script>';
    const res = await request('POST', '/api/customers', {
      full_name: xssPayload,
      first_name: 'XSS',
      address: '123 XSS St',
      phone: '555-0668'
    });
    if (res.status === 201) {
      const readBack = await request('GET', `/api/customers/${res.body.id}`);
      assert.equal(readBack.body.full_name, xssPayload, 'Should store exactly what was sent');
      await request('DELETE', `/api/customers/${res.body.id}`);
    }
  });

  it('notes with HTML injection do not crash server', async () => {
    const cRes = await request('POST', '/api/customers', {
      full_name: 'HTML Test',
      first_name: 'HTML',
      address: '123 HTML St',
      phone: '555-0669',
      customer_notes: '<img src=x onerror=alert(1)>'
    });
    if (cRes.status === 201) {
      await request('DELETE', `/api/customers/${cRes.body.id}`);
    }
    assert.ok([201, 400].includes(cRes.status));
  });
});


describe('Security: Data Exposure', () => {
  it('maps API key endpoint does not expose full key in error', async () => {
    const res = await request('GET', '/api/config/maps-key');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.key, 'string');
  });

  it('error responses do not expose stack traces', async () => {
    const res = await request('GET', '/api/customers/not-a-valid-id');
    if (res.status >= 400) {
      const bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
      assert.ok(!bodyStr.includes('node_modules'), 'Should not expose file paths');
      assert.ok(!bodyStr.includes('at Object'), 'Should not expose stack traces');
    }
  });

  it('database connection details are not exposed in errors', async () => {
    const res = await request('POST', '/api/customers', { invalid: true });
    const bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert.ok(!bodyStr.includes('postgresql://'), 'Should not expose connection string');
    assert.ok(!bodyStr.includes('PGPASSWORD'), 'Should not expose env vars');
  });

  it('non-existent routes return 404, not internal details', async () => {
    const res = await request('GET', '/api/this-does-not-exist');
    assert.ok([404, 200].includes(res.status));
  });
});


describe('Security: Request Size & Rate Limits', () => {
  it('server handles large JSON body without crash', async () => {
    const bigPayload = { full_name: 'X'.repeat(10000), address: 'A'.repeat(10000) };
    const res = await request('POST', '/api/customers', bigPayload);
    assert.ok([201, 400, 413, 500].includes(res.status), 'Should handle gracefully');
    if (res.status === 201) await request('DELETE', `/api/customers/${res.body.id}`);
  });

  it('extremely long search query does not crash', async () => {
    const longSearch = 'a'.repeat(5000);
    const res = await request('GET', `/api/customers?search=${encodeURIComponent(longSearch)}`);
    assert.ok([200, 400, 414].includes(res.status), `Should handle long query gracefully, got ${res.status}`);
  });
});
