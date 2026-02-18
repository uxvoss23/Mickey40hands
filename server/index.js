const express = require('express');
const path = require('path');
const migrate = require('./db/migrate');

const customersRouter = require('./routes/customers');
const jobsRouter = require('./routes/jobs');
const routesRouter = require('./routes/routes');
const listsRouter = require('./routes/lists');
const exportRouter = require('./routes/export');
const emailRouter = require('./routes/email');
const gapfillRouter = require('./routes/gapfill');
const googleSheetsRouter = require('./routes/google-sheets');

const app = express();
const PORT = 5000;

const technicianLocations = {};


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

app.get('/api/config/maps-key', (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  res.json({ key });
});

app.get('/api/geocode', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`;
    const response = await fetch(nominatimUrl, {
      headers: { 'User-Agent': 'GalacticNavCRM/1.0' }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Geocode proxy error:', error);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

app.use('/api/customers', customersRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/routes', routesRouter);
app.use('/api/lists', listsRouter);
app.use('/api/export', exportRouter);
app.use('/api/email', emailRouter);
app.use('/api/gapfill', gapfillRouter);
app.use('/api/google-sheets', googleSheetsRouter);

app.use(express.static(path.join(__dirname, '..'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.post('/api/technician/location', (req, res) => {
  const { technician, lat, lng, speed, heading, accuracy, timestamp, active } = req.body;
  if (!technician) return res.status(400).json({ error: 'Technician name required' });
  
  if (active === false) {
    delete technicianLocations[technician];
    return res.json({ ok: true, removed: true });
  }
  
  technicianLocations[technician] = {
    technician,
    lat, lng, speed, heading, accuracy,
    timestamp: timestamp || Date.now(),
    lastSeen: Date.now(),
    active: true
  };
  res.json({ ok: true });
});

app.get('/api/technician/location', (req, res) => {
  const now = Date.now();
  const activeTechs = {};
  for (const [name, data] of Object.entries(technicianLocations)) {
    if (now - data.lastSeen < 60000) {
      activeTechs[name] = data;
    } else {
      delete technicianLocations[name];
    }
  }
  res.json({ technicians: activeTechs });
});

app.get('/intake', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'intake.html'));
});

app.get('/track', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'track.html'));
});

app.get('/tech-route/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'tech-route.html'));
});

app.get('/enroll/:token', async (req, res) => {
  const pool = require('./db/pool');
  const { token } = req.params;
  try {
    const result = await pool.query('SELECT * FROM enrollment_tokens WHERE token = $1', [token]);
    if (result.rows.length === 0) {
      return res.send(buildEnrollmentPage('Token Not Found', 'This enrollment link is invalid or has expired.', 'error'));
    }
    const enrollment = result.rows[0];
    if (enrollment.used_at) {
      return res.send(buildEnrollmentPage('Already Enrolled', 'You have already enrolled in a recurring maintenance plan. We look forward to your next service!', 'info'));
    }
    if (enrollment.expired) {
      return res.send(buildEnrollmentPage('Link Expired', 'This enrollment link has expired. Please contact us to set up your recurring service plan.', 'error'));
    }

    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1', [enrollment.customer_id]);
    if (customerResult.rows.length === 0) {
      return res.send(buildEnrollmentPage('Customer Not Found', 'We could not find your account. Please contact us for assistance.', 'error'));
    }
    const customer = customerResult.rows[0];

    const planLabels = { annual: 'Annual (1x/year)', biannual: 'Bi-Annual (2x/year)', triannual: '3x Per Year' };
    const planIntervals = { annual: '12', biannual: '6', triannual: '4' };
    const planDiscounts = { annual: '10%', biannual: '15%', triannual: '20%' };

    const interval = planIntervals[enrollment.plan_type] || '6';
    const label = planLabels[enrollment.plan_type] || enrollment.plan_type;
    const discount = planDiscounts[enrollment.plan_type] || '';

    const ppp = parseFloat(enrollment.price_per_panel) || 9;
    const panels = parseInt(enrollment.panel_count) || parseInt(customer.panels) || 0;
    const basePrice = panels > 0 ? panels * ppp : parseFloat(enrollment.service_price) || 0;
    const discountMultiplier = { annual: 0.90, biannual: 0.85, triannual: 0.80 };
    const discountedPrice = (basePrice * (discountMultiplier[enrollment.plan_type] || 0.85)).toFixed(2);

    await pool.query('UPDATE enrollment_tokens SET used_at = NOW() WHERE id = $1', [enrollment.id]);
    await pool.query('UPDATE enrollment_tokens SET expired = TRUE WHERE customer_id = $1 AND id != $2 AND used_at IS NULL', [enrollment.customer_id, enrollment.id]);

    await pool.query(
      `DELETE FROM jobs WHERE customer_id = $1 AND is_recurring = true AND (status IS NULL OR status = 'scheduled') AND completed_date IS NULL`,
      [enrollment.customer_id]
    );

    await pool.query('UPDATE customers SET is_recurring = true WHERE id = $1', [enrollment.customer_id]);

    const baseJob = {
      job_description: 'Solar Panel Cleaning',
      price: discountedPrice,
      price_per_panel: (ppp * (discountMultiplier[enrollment.plan_type] || 0.85)).toFixed(2),
      panel_count: panels,
      preferred_days: customer.preferred_days || '',
      preferred_time: customer.preferred_time || '',
      technician: ''
    };

    const { generateRecurringJobs } = require('./routes/jobs');
    const startDate = new Date();
    const jobs = await generateRecurringJobs(enrollment.customer_id, baseJob, interval, startDate);

    return res.send(buildEnrollmentPage(
      'You\'re All Set!',
      `Thank you, ${customer.name || 'valued customer'}! You've been enrolled in our <strong>${label}</strong> maintenance plan at <strong>$${discountedPrice} per cleaning</strong> (${discount} off). We've scheduled your upcoming cleanings — you don't need to do anything else. We'll reach out before each service to confirm your appointment.`,
      'success',
      { planName: label, price: discountedPrice, jobsCreated: jobs.length, discount }
    ));
  } catch (err) {
    console.error('Enrollment error:', err);
    return res.send(buildEnrollmentPage('Something Went Wrong', 'We encountered an issue processing your enrollment. Please contact us and we\'ll get you set up right away.', 'error'));
  }
});

function buildEnrollmentPage(title, message, type, details) {
  const colors = {
    success: { bg: '#f0fdf4', border: '#22c55e', icon: '✅', accent: '#16a34a' },
    error: { bg: '#fef2f2', border: '#ef4444', icon: '❌', accent: '#dc2626' },
    info: { bg: '#eef2ff', border: '#6366f1', icon: 'ℹ️', accent: '#4f46e5' }
  };
  const c = colors[type] || colors.info;

  const detailsHTML = details ? `
    <div style="margin-top:24px;background:#f8fafc;border-radius:12px;padding:20px;text-align:left;">
      <div style="font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Your Plan Details</div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;">
        <span style="color:#64748b;font-size:14px;">Plan</span>
        <span style="color:#1e293b;font-size:14px;font-weight:600;">${details.planName}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;">
        <span style="color:#64748b;font-size:14px;">Price Per Cleaning</span>
        <span style="color:#16a34a;font-size:14px;font-weight:700;">$${details.price}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0;">
        <span style="color:#64748b;font-size:14px;">Your Discount</span>
        <span style="color:#4f46e5;font-size:14px;font-weight:600;">${details.discount} off</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;">
        <span style="color:#64748b;font-size:14px;">Cleanings Scheduled</span>
        <span style="color:#1e293b;font-size:14px;font-weight:600;">${details.jobsCreated} upcoming</span>
      </div>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Sunton Solutions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:480px;width:90%;margin:40px auto;text-align:center;">
    <div style="background:#ffffff;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,0.08);overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px 24px;">
        <div style="font-size:13px;color:#fbbf24;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:8px;">Sunton Solutions</div>
        <div style="font-size:11px;color:#94a3b8;">Solar Panel Cleaning & Maintenance</div>
      </div>
      <div style="padding:32px 24px;">
        <div style="font-size:48px;margin-bottom:16px;">${c.icon}</div>
        <h1 style="font-size:24px;font-weight:800;color:#1e293b;margin:0 0 12px;">${title}</h1>
        <p style="font-size:14px;color:#475569;line-height:1.6;margin:0;">${message}</p>
        ${detailsHTML}
      </div>
      <div style="padding:16px 24px 24px;border-top:1px solid #f1f5f9;">
        <p style="font-size:12px;color:#94a3b8;margin:0;">Questions? Reply to your service email or contact us anytime.</p>
      </div>
    </div>
    <p style="font-size:11px;color:#cbd5e1;margin-top:16px;">© ${new Date().getFullYear()} Sunton Solutions</p>
  </div>
</body>
</html>`;
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    const fs = require('fs');
    const filePath = path.join(__dirname, '..', 'index.html');
    let html = fs.readFileSync(filePath, 'utf-8');
    const buildId = Date.now().toString(36);
    html = html.replace('</head>', `<meta name="build-id" content="${buildId}"></head>`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.type('html').send(html);
  } else {
    next();
  }
});

const pool = require('./db/pool');

const updateScheduledStatuses = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const cutoffDate = thirtyDaysFromNow.toISOString().split('T')[0];
    
    const recurringCustomers = await pool.query(
      `SELECT id FROM customers WHERE is_recurring = true`
    );

    let flippedCount = 0;
    for (const cust of recurringCustomers.rows) {
      const nextJob = await pool.query(
        `SELECT scheduled_date FROM jobs WHERE customer_id = $1 AND is_recurring = true AND status != 'completed' AND status != 'cancelled' AND scheduled_date >= $2 ORDER BY scheduled_date ASC LIMIT 1`,
        [cust.id, today]
      );

      if (nextJob.rows.length > 0) {
        const nextDate = nextJob.rows[0].scheduled_date;
        const daysUntil = Math.floor((new Date(nextDate) - new Date()) / (1000 * 60 * 60 * 24));
        const newStatus = daysUntil <= 30 ? 'scheduled' : '';

        await pool.query(
          `UPDATE customers SET next_service_date = $1, status = CASE WHEN (status = '' OR status IS NULL) AND $2 = 'scheduled' THEN 'scheduled' WHEN (status = 'scheduled') AND $2 = '' THEN '' ELSE status END WHERE id = $3`,
          [nextDate, newStatus, cust.id]
        );
        if (newStatus === 'scheduled') flippedCount++;
      } else {
        await pool.query(
          `UPDATE customers SET next_service_date = NULL WHERE id = $1 AND is_recurring = true`,
          [cust.id]
        );
      }
    }
    
    if (flippedCount > 0) {
      console.log(`30-day check: ${flippedCount} recurring customers within 30-day window`);
    }
  } catch (err) {
    console.error('Error in 30-day schedule check:', err);
  }
};

const applySchemaUpdates = async () => {
  const pool = require('./db/pool');
  try {
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP`);
    await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS before_photo TEXT`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS after_photo TEXT`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS photos TEXT DEFAULT '[]'`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS inspection_notes TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS recurring_selection VARCHAR(50) DEFAULT ''`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS completion_data TEXT DEFAULT '{}'`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS anytime_access BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS flexible BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR(20) DEFAULT 'call'`);
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS cancellation_count INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(50)`);
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_note TEXT`);
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP`);
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS gap_fill_attempted BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS gap_fill_session_id INTEGER`);
    await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_gap_fill BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(255)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS gap_fill_sessions (
      id SERIAL PRIMARY KEY,
      route_id INTEGER REFERENCES routes(id),
      cancelled_stop_id INTEGER,
      cancelled_job_id INTEGER,
      cancelled_customer_id INTEGER,
      reference_lat DOUBLE PRECISION,
      reference_lng DOUBLE PRECISION,
      reference_address TEXT,
      next_stop_id INTEGER,
      next_stop_lat DOUBLE PRECISION,
      next_stop_lng DOUBLE PRECISION,
      next_stop_time VARCHAR(20),
      cancelled_job_description VARCHAR(255),
      search_layer INTEGER DEFAULT 1,
      status VARCHAR(20) DEFAULT 'active',
      tech_notified BOOLEAN DEFAULT false,
      tech_moved_on BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      resolved_at TIMESTAMP,
      resolution VARCHAR(50),
      confirmed_customer_id INTEGER,
      confirmed_candidate_id INTEGER
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS gap_fill_candidates (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES gap_fill_sessions(id) ON DELETE CASCADE,
      customer_id INTEGER,
      tier INTEGER NOT NULL,
      tier_reason TEXT,
      distance_miles DOUBLE PRECISION,
      direction_score DOUBLE PRECISION DEFAULT 0,
      outreach_status VARCHAR(30) DEFAULT 'pending',
      outreach_note TEXT,
      contact_method_used VARCHAR(20),
      sort_rank INTEGER,
      search_layer INTEGER DEFAULT 1,
      contacted_at TIMESTAMP,
      resolved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS gap_fill_outreach_log (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER,
      session_id INTEGER,
      contacted_at TIMESTAMP DEFAULT NOW(),
      outcome VARCHAR(30),
      tier INTEGER,
      service_type VARCHAR(255)
    )`);
  } catch (err) {
    console.error('Schema update warning:', err.message);
  }
};

const start = async () => {
  try {
    await migrate();
    await applySchemaUpdates();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
    
    await updateScheduledStatuses();
    setInterval(updateScheduledStatuses, 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
