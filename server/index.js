const express = require('express');
const path = require('path');
const migrate = require('./db/migrate');

const customersRouter = require('./routes/customers');
const jobsRouter = require('./routes/jobs');
const routesRouter = require('./routes/routes');
const listsRouter = require('./routes/lists');
const exportRouter = require('./routes/export');

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

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  } else {
    next();
  }
});

const start = async () => {
  try {
    await migrate();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
