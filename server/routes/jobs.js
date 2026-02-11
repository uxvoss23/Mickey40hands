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
                        completed_date, amount, tip, notes, is_recurring, employee, panel_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      j.customer_id, j.job_description || '', (j.status || '').toLowerCase(),
      j.scheduled_date || '', j.scheduled_time || '', j.completed_date || '',
      parseFloat(j.amount) || 0, parseFloat(j.tip) || 0, j.notes || '',
      j.is_recurring || false, j.employee || '', parseInt(j.panel_count) || 0
    ]);
    res.status(201).json(result.rows[0]);
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
                    'completed_date', 'amount', 'tip', 'notes', 'is_recurring', 'employee', 'panel_count'];

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
    res.json(result.rows[0]);
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
