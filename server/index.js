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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
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
