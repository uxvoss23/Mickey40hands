const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const { customer_id, status, sort_by, sort_order } = req.query;
    let query = `SELECT j.*, c.full_name as customer_name, c.address as customer_address 
                 FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (customer_id) {
      query += ` AND j.customer_id = $${paramIndex}`;
      params.push(parseInt(customer_id));
      paramIndex++;
    }

    if (status) {
      query += ` AND LOWER(j.status) = $${paramIndex}`;
      params.push(status.toLowerCase());
      paramIndex++;
    }

    const sortField = sort_by === 'date' ? 'j.completed_date' : 'j.created_at';
    const order = sort_order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortField} ${order}`;

    const result = await pool.query(query, params);
    res.json({ jobs: result.rows });
  } catch (err) {
    console.error('Error fetching jobs:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

router.post('/', async (req, res) => {
  try {
    const j = req.body;
    const result = await pool.query(`
      INSERT INTO jobs (customer_id, job_description, status, scheduled_date, scheduled_time,
                        completed_date, amount, tip, notes, is_recurring, employee, panel_count,
                        price, price_per_panel, preferred_days, preferred_time, technician,
                        recurrence_interval, next_service_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *
    `, [
      j.customer_id, j.job_description || '', (j.status || '').toLowerCase(),
      j.scheduled_date || '', j.scheduled_time || '', j.completed_date || '',
      parseFloat(j.amount) || 0, parseFloat(j.tip) || 0, j.notes || '',
      j.is_recurring || false, j.employee || '', parseInt(j.panel_count) || 0,
      parseFloat(j.price) || 0, parseFloat(j.price_per_panel) || 0,
      j.preferred_days || '', j.preferred_time || '', j.technician || '',
      j.recurrence_interval || '', j.next_service_date || ''
    ]);

    const job = result.rows[0];

    if (j.is_recurring && j.preferred_days && j.next_service_date) {
      try {
        const days = (j.preferred_days || '').split(',').filter(Boolean);
        const nextDate = new Date(j.next_service_date);
        const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };

        for (const day of days) {
          const targetDay = dayMap[day];
          if (targetDay === undefined) continue;

          const routeDate = new Date(nextDate);
          const diff = (targetDay - routeDate.getDay() + 7) % 7;
          routeDate.setDate(routeDate.getDate() + (diff === 0 ? 0 : diff));
          const dateStr = routeDate.toISOString().split('T')[0];

          let routeResult = await pool.query(
            `SELECT id FROM routes WHERE scheduled_date = $1 AND name LIKE $2 LIMIT 1`,
            [dateStr, `%${day}%`]
          );

          let routeId;
          if (routeResult.rows.length > 0) {
            routeId = routeResult.rows[0].id;
          } else {
            const newRoute = await pool.query(
              `INSERT INTO routes (name, scheduled_date, status) VALUES ($1, $2, 'planned') RETURNING id`,
              [`${day} Route - ${dateStr}`, dateStr]
            );
            routeId = newRoute.rows[0].id;
          }

          const existing = await pool.query(
            `SELECT id FROM route_stops WHERE route_id = $1 AND customer_id = $2`,
            [routeId, j.customer_id]
          );
          if (existing.rows.length === 0) {
            const maxOrder = await pool.query(
              `SELECT COALESCE(MAX(stop_order), 0) as max_order FROM route_stops WHERE route_id = $1`,
              [routeId]
            );
            await pool.query(
              `INSERT INTO route_stops (route_id, customer_id, stop_order, notes) VALUES ($1, $2, $3, $4)`,
              [routeId, j.customer_id, (maxOrder.rows[0].max_order || 0) + 1, j.job_description || '']
            );
          }
        }
      } catch (routeErr) {
        console.error('Error auto-adding to route:', routeErr);
      }
    }

    res.status(201).json(job);
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updates = req.body;
    const setClauses = [];
    const params = [];
    let paramIndex = 1;

    const fields = ['job_description', 'status', 'scheduled_date', 'scheduled_time',
                    'completed_date', 'amount', 'tip', 'notes', 'is_recurring', 'employee', 'panel_count',
                    'price', 'price_per_panel', 'preferred_days', 'preferred_time', 'technician',
                    'recurrence_interval', 'next_service_date'];

    for (const field of fields) {
      if (updates[field] !== undefined) {
        let val = updates[field];
        if (field === 'status') val = (val || '').toLowerCase();
        setClauses.push(`${field} = $${paramIndex}`);
        params.push(val);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    const updatedJob = result.rows[0];
    let nextJob = null;

    const statusBeingSetToCompleted = (updates.status || '').toLowerCase() === 'completed';
    if (statusBeingSetToCompleted) {
      try {
        if (!updatedJob.completed_date || updatedJob.completed_date === '') {
          const today = new Date().toISOString().split('T')[0];
          await pool.query(`UPDATE jobs SET completed_date = $1 WHERE id = $2`, [today, updatedJob.id]);
          updatedJob.completed_date = today;
        }

        const completedDateStr = updatedJob.completed_date;

        await pool.query(
          `UPDATE customers SET last_service_date = $1 WHERE id = $2`,
          [completedDateStr, updatedJob.customer_id]
        );

        if (updatedJob.is_recurring) {
          const existingFuture = await pool.query(
            `SELECT id FROM jobs WHERE customer_id = $1 AND is_recurring = true AND status = 'scheduled' AND id != $2`,
            [updatedJob.customer_id, updatedJob.id]
          );
          
          if (existingFuture.rows.length === 0) {
            const interval = updatedJob.recurrence_interval || '6months';
            const completedDate = new Date(completedDateStr);
            const nextDate = new Date(completedDate);
            
            if (interval === '3months' || interval === 'quarterly') nextDate.setMonth(nextDate.getMonth() + 3);
            else if (interval === '6months') nextDate.setMonth(nextDate.getMonth() + 6);
            else if (interval === 'yearly' || interval === '12') nextDate.setFullYear(nextDate.getFullYear() + 1);
            else if (interval === 'monthly') nextDate.setMonth(nextDate.getMonth() + 1);
            else {
              const months = parseInt(interval);
              nextDate.setMonth(nextDate.getMonth() + (months > 0 ? months : 6));
            }
            
            const nextDateStr = nextDate.toISOString().split('T')[0];

            const nextJobResult = await pool.query(`
              INSERT INTO jobs (customer_id, job_description, status, scheduled_date, scheduled_time,
                                completed_date, amount, tip, notes, is_recurring, employee, panel_count,
                                price, price_per_panel, preferred_days, preferred_time, technician,
                                recurrence_interval, next_service_date)
              VALUES ($1, $2, 'scheduled', $3, $4, '', 0, 0, $5, true, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              RETURNING *
            `, [
              updatedJob.customer_id,
              updatedJob.job_description || '',
              nextDateStr,
              updatedJob.scheduled_time || updatedJob.preferred_time || '',
              `Auto-scheduled from completed job #${updatedJob.id}`,
              updatedJob.employee || updatedJob.technician || '',
              updatedJob.panel_count || 0,
              updatedJob.price || 0,
              updatedJob.price_per_panel || 0,
              updatedJob.preferred_days || '',
              updatedJob.preferred_time || '',
              updatedJob.technician || '',
              updatedJob.recurrence_interval || '6months',
              ''
            ]);

            nextJob = nextJobResult.rows[0];

            await pool.query(
              `UPDATE customers SET status = 'scheduled', scheduled_date = $1, next_service_date = $1, last_service_date = $2 WHERE id = $3`,
              [nextDateStr, completedDateStr, updatedJob.customer_id]
            );

            console.log(`Auto-scheduled next recurring job #${nextJob.id} for customer ${updatedJob.customer_id} on ${nextDateStr}`);
          }
        }
      } catch (autoErr) {
        console.error('Error processing completed job:', autoErr);
      }
    }

    res.json({ ...updatedJob, next_job: nextJob });
  } catch (err) {
    console.error('Error updating job:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM jobs WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting job:', err);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

module.exports = router;
