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

    const fields = ['name', 'scheduled_date', 'status', 'total_distance', 'sent_to_tech', 'sent_date', 'sent_at', 'completed_at'];
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

router.delete('/clear-all', async (req, res) => {
  try {
    await pool.query(`UPDATE customers SET status = 'unscheduled', scheduled_date = NULL, scheduled_time = NULL, route_confirmed = false WHERE status IN ('scheduled', 'in progress')`);
    await pool.query(`UPDATE jobs SET status = 'unscheduled', scheduled_date = NULL, scheduled_time = NULL WHERE status IN ('scheduled', 'in progress')`);
    await pool.query('DELETE FROM route_stops');
    await pool.query('DELETE FROM routes');
    res.json({ success: true, message: 'All routes cleared. Completed jobs were not touched.' });
  } catch (err) {
    console.error('Error clearing all routes:', err);
    res.status(500).json({ error: 'Failed to clear routes: ' + err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const check = await pool.query('SELECT sent_to_tech FROM routes WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
    if (check.rows[0].sent_to_tech) return res.status(403).json({ error: 'Cannot delete a route that has been sent to the technician' });
    const stops = await pool.query('SELECT customer_id FROM route_stops WHERE route_id = $1', [req.params.id]);
    for (const stop of stops.rows) {
      await pool.query(`UPDATE customers SET status = 'unscheduled', scheduled_date = NULL, scheduled_time = NULL WHERE id = $1 AND (status = 'scheduled' OR status = 'in progress')`, [stop.customer_id]);
      await pool.query(`UPDATE jobs SET status = 'unscheduled', scheduled_date = NULL, scheduled_time = NULL WHERE customer_id = $1 AND status IN ('scheduled', 'in progress')`, [stop.customer_id]);
    }
    const result = await pool.query('DELETE FROM routes WHERE id = $1 RETURNING *', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting route:', err);
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

router.get('/:id/tech-view', async (req, res) => {
  try {
    const routeResult = await pool.query('SELECT * FROM routes WHERE id = $1', [req.params.id]);
    if (routeResult.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
    const route = routeResult.rows[0];

    const stops = await pool.query(`
      SELECT rs.id, rs.stop_order, rs.scheduled_time, rs.notes as stop_notes, rs.completed_at,
             rs.before_photo, rs.after_photo, rs.photos, rs.inspection_notes, rs.recurring_selection,
             rs.completion_data,
             c.id as customer_id, c.full_name, c.address, c.phone, c.email, c.city, c.state, c.zip,
             c.panel_count, c.customer_notes, c.notes as job_notes, c.amount_paid,
             c.customer_type, c.is_recurring
      FROM route_stops rs
      JOIN customers c ON rs.customer_id = c.id
      WHERE rs.route_id = $1
      ORDER BY rs.stop_order ASC
    `, [req.params.id]);

    res.json({ route, stops: stops.rows });
  } catch (err) {
    console.error('Error fetching tech route view:', err);
    res.status(500).json({ error: 'Failed to load route' });
  }
});

router.post('/:id/stops/:stopId/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { photos, inspection_notes, recurring_selection, completion_data } = req.body || {};

    const stopResult = await client.query(
      'SELECT rs.*, c.is_recurring FROM route_stops rs JOIN customers c ON rs.customer_id = c.id WHERE rs.id = $1 AND rs.route_id = $2',
      [req.params.stopId, req.params.id]
    );
    if (stopResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Stop not found' });
    }

    const stop = stopResult.rows[0];
    if (stop.completed_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Stop already completed' });
    }

    const photosArray = photos || [];
    const photosJson = JSON.stringify(photosArray);
    const firstPhoto = photosArray.length > 0 ? (typeof photosArray[0] === 'object' ? photosArray[0].data : photosArray[0]) : null;
    const secondPhoto = photosArray.length > 1 ? (typeof photosArray[1] === 'object' ? photosArray[1].data : photosArray[1]) : null;
    const completionDataJson = completion_data ? JSON.stringify(completion_data) : '{}';
    await client.query(
      `UPDATE route_stops SET completed_at = NOW(), before_photo = $1, after_photo = $2, photos = $3, inspection_notes = $4, recurring_selection = $5, completion_data = $6 WHERE id = $7`,
      [firstPhoto, secondPhoto, photosJson, inspection_notes || '', recurring_selection || '', completionDataJson, stop.id]
    );

    const routeResult = await client.query('SELECT scheduled_date FROM routes WHERE id = $1', [req.params.id]);
    const scheduledDate = routeResult.rows[0]?.scheduled_date || new Date().toISOString().split('T')[0];

    if (stop.is_recurring) {
      const jobsResult = await client.query(
        `SELECT * FROM jobs WHERE customer_id = $1 AND is_recurring = true AND status != 'completed' AND status != 'cancelled' AND scheduled_date <= $2 ORDER BY scheduled_date ASC LIMIT 1`,
        [stop.customer_id, scheduledDate]
      );
      if (jobsResult.rows.length > 0) {
        const job = jobsResult.rows[0];
        await client.query(
          `UPDATE jobs SET status = 'completed', completed_date = $1 WHERE id = $2`,
          [scheduledDate, job.id]
        );
      }

      const nextUpcoming = await client.query(
        `SELECT scheduled_date FROM jobs WHERE customer_id = $1 AND is_recurring = true AND status != 'completed' AND status != 'cancelled' AND scheduled_date > $2 ORDER BY scheduled_date ASC LIMIT 1`,
        [stop.customer_id, scheduledDate]
      );

      if (nextUpcoming.rows.length > 0) {
        const nextDate = nextUpcoming.rows[0].scheduled_date;
        const daysUntilNext = Math.floor((new Date(nextDate) - new Date()) / (1000 * 60 * 60 * 24));
        const newStatus = daysUntilNext <= 30 ? 'scheduled' : '';
        await client.query(
          `UPDATE customers SET status = $1, last_service_date = $2, next_service_date = $3, route_confirmed = false WHERE id = $4`,
          [newStatus, scheduledDate, nextDate, stop.customer_id]
        );
      } else {
        await client.query(
          `UPDATE customers SET status = '', last_service_date = $1, next_service_date = NULL, route_confirmed = false WHERE id = $2`,
          [scheduledDate, stop.customer_id]
        );
      }
    } else {
      await client.query(
        `UPDATE customers SET status = '', last_service_date = $1, scheduled_date = NULL, route_confirmed = false WHERE id = $2`,
        [scheduledDate, stop.customer_id]
      );
      const jobsResult = await client.query(
        `SELECT id FROM jobs WHERE customer_id = $1 AND status != 'completed' AND status != 'cancelled'`,
        [stop.customer_id]
      );
      for (const j of jobsResult.rows) {
        await client.query(`UPDATE jobs SET status = 'completed', completed_date = $1 WHERE id = $2`, [scheduledDate, j.id]);
      }
    }

    const allStops = await client.query('SELECT completed_at FROM route_stops WHERE route_id = $1', [req.params.id]);
    const allDone = allStops.rows.every(s => s.completed_at !== null);
    if (allDone) {
      await client.query('UPDATE routes SET completed_at = NOW() WHERE id = $1', [req.params.id]);
    }

    await client.query('COMMIT');
    res.json({ success: true, allComplete: allDone });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error completing stop:', err);
    res.status(500).json({ error: 'Failed to complete stop' });
  } finally {
    client.release();
  }
});

module.exports = router;
