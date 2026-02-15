const express = require('express');
const path = require('path');
const migrate = require('./db/migrate');

const customersRouter = require('./routes/customers');
const jobsRouter = require('./routes/jobs');
const routesRouter = require('./routes/routes');
const listsRouter = require('./routes/lists');
const exportRouter = require('./routes/export');
const emailRouter = require('./routes/email');

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

app.use('/api/customers', customersRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/routes', routesRouter);
app.use('/api/lists', listsRouter);
app.use('/api/export', exportRouter);
app.use('/api/email', emailRouter);

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

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
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
