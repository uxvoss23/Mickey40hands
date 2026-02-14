const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const { status, include_stops } = req.query;
    let query = 'SELECT * FROM routes WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY scheduled_date DESC, created_at DESC';
    const result = await pool.query(query, params);

    if (include_stops === 'true') {
      for (const route of result.rows) {
        const stops = await pool.query(`
          SELECT rs.*, c.full_name, c.address, c.phone, c.email, c.lat, c.lng,
                 c.panel_count, c.status as customer_status, c.city, c.state, c.zip
          FROM route_stops rs
          JOIN customers c ON rs.customer_id = c.id
          WHERE rs.route_id = $1
          ORDER BY rs.stop_order ASC
        `, [route.id]);
        route.stops = stops.rows;
      }
    }

    res.json({ routes: result.rows });
  } catch (err) {
    console.error('Error fetching routes:', err);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = req.body;

    const routeResult = await client.query(`
      INSERT INTO routes (name, scheduled_date, status, total_distance)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [r.name || '', r.scheduled_date || '', r.status || 'planned', r.total_distance || 0]);

    const route = routeResult.rows[0];

    if (r.stops && Array.isArray(r.stops)) {
      for (let i = 0; i < r.stops.length; i++) {
        const stop = r.stops[i];
        await client.query(`
          INSERT INTO route_stops (route_id, customer_id, stop_order, scheduled_time, notes, route_confirmed)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [route.id, stop.customer_id, i + 1, stop.scheduled_time || '', stop.notes || '', stop.route_confirmed || false]);
      }
    }

    await client.query('COMMIT');

    const stops = await pool.query(`
      SELECT rs.*, c.full_name, c.address, c.phone, c.lat, c.lng, c.panel_count
      FROM route_stops rs JOIN customers c ON rs.customer_id = c.id
      WHERE rs.route_id = $1 ORDER BY rs.stop_order ASC
    `, [route.id]);
    route.stops = stops.rows;

    res.status(201).json(route);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating route:', err);
    res.status(500).json({ error: 'Failed to create route' });
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updates = req.body;
    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    const fields = ['name', 'scheduled_date', 'status', 'total_distance', 'sent_to_tech', 'sent_date', 'sent_at'];
    for (const field of fields) {
      if (updates[field] !== undefined) {
        setClauses.push(`${field} = $${paramIndex}`);
        params.push(updates[field]);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields' });

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE routes SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating route:', err);
    res.status(500).json({ error: 'Failed to update route' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const check = await pool.query('SELECT sent_to_tech FROM routes WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
    if (check.rows[0].sent_to_tech) return res.status(403).json({ error: 'Cannot delete a route that has been sent to the technician' });
    const result = await pool.query('DELETE FROM routes WHERE id = $1 RETURNING *', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting route:', err);
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

module.exports = router;
