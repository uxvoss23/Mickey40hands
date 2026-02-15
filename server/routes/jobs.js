const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

function getRecurrenceMonths(interval) {
  if (interval === 'biannual' || interval === '6months' || interval === '6') return 6;
  if (interval === 'annual' || interval === 'yearly' || interval === '12months' || interval === '12') return 12;
  const months = parseInt(interval);
  return months > 0 ? months : 6;
}

async function generateRecurringJobs(customerId, baseJob, interval, startDate) {
  const months = getRecurrenceMonths(interval);
  const totalJobs = Math.floor(120 / months);
  const jobs = [];
  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  for (let i = 1; i <= totalJobs; i++) {
    const jobDate = new Date(startDate);
    jobDate.setMonth(jobDate.getMonth() + (months * i));
    const dateStr = jobDate.toISOString().split('T')[0];

    const daysUntilJob = Math.floor((jobDate - now) / (1000 * 60 * 60 * 24));
    const autoStatus = daysUntilJob <= 30 && daysUntilJob >= 0 ? 'scheduled' : '';

    const result = await pool.query(`
      INSERT INTO jobs (customer_id, job_description, status, scheduled_date, scheduled_time,
                        completed_date, amount, tip, notes, is_recurring, employee, panel_count,
                        price, price_per_panel, preferred_days, preferred_time, technician,
                        recurrence_interval, next_service_date)
      VALUES ($1, $2, $3, $4, $5, '', 0, 0, $6, true, $7, $8, $9, $10, $11, $12, $13, $14, '')
      RETURNING *
    `, [
      customerId,
      baseJob.job_description || baseJob.jobDescription || '',
      autoStatus,
      dateStr,
      baseJob.scheduled_time || baseJob.preferred_time || '',
      `Recurring service #${i}`,
      baseJob.employee || baseJob.technician || '',
      baseJob.panel_count || 0,
      parseFloat(baseJob.price) || 0,
      parseFloat(baseJob.price_per_panel) || 0,
      baseJob.preferred_days || '',
      baseJob.preferred_time || '',
      baseJob.technician || '',
      interval
    ]);
    jobs.push(result.rows[0]);
  }

  const nextJob = jobs.find(j => j.status !== 'completed' && j.status !== 'cancelled' && j.scheduled_date);
  if (nextJob) {
    const daysUntilNext = Math.floor((new Date(nextJob.scheduled_date) - now) / (1000 * 60 * 60 * 24));
    const customerStatus = daysUntilNext <= 30 && daysUntilNext >= 0 ? 'scheduled' : '';
    await pool.query(
      `UPDATE customers SET is_recurring = true, next_service_date = $1, status = $2 WHERE id = $3`,
      [nextJob.scheduled_date, customerStatus, customerId]
    );
  } else {
    await pool.query(
      `UPDATE customers SET is_recurring = true WHERE id = $1`,
      [customerId]
    );
  }

  console.log(`Generated ${jobs.length} recurring jobs for customer ${customerId} (every ${months} months, 10 years)`);
  return jobs;
}

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
    let recurringJobs = [];

    if (j.is_recurring && j.recurrence_interval) {
      const startDate = j.scheduled_date || new Date().toISOString().split('T')[0];
      recurringJobs = await generateRecurringJobs(j.customer_id, j, j.recurrence_interval, startDate);
    }

    res.status(201).json({ ...job, recurring_jobs_created: recurringJobs.length });
  } catch (err) {
    console.error('Error creating job:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

router.post('/generate-recurring', async (req, res) => {
  try {
    const { customer_id, recurrence_interval, base_job } = req.body;
    if (!customer_id || !recurrence_interval) {
      return res.status(400).json({ error: 'customer_id and recurrence_interval required' });
    }

    await pool.query(
      `DELETE FROM jobs WHERE customer_id = $1 AND is_recurring = true AND (status = '' OR status IS NULL OR status = 'scheduled') AND (completed_date IS NULL OR completed_date = '')`,
      [customer_id]
    );

    let startDate;
    const lastCompleted = await pool.query(
      `SELECT scheduled_date, completed_date FROM jobs WHERE customer_id = $1 AND status = 'completed' ORDER BY COALESCE(completed_date, scheduled_date) DESC LIMIT 1`,
      [customer_id]
    );
    if (lastCompleted.rows.length > 0) {
      startDate = lastCompleted.rows[0].completed_date || lastCompleted.rows[0].scheduled_date;
    }

    if (!startDate) {
      const lastJob = await pool.query(
        `SELECT scheduled_date FROM jobs WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [customer_id]
      );
      startDate = lastJob.rows.length > 0 && lastJob.rows[0].scheduled_date ? lastJob.rows[0].scheduled_date : new Date().toISOString().split('T')[0];
    }

    const baseJobData = base_job || {};
    if (!baseJobData.job_description) {
      const existingJob = await pool.query(
        `SELECT * FROM jobs WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [customer_id]
      );
      if (existingJob.rows.length > 0) {
        const ej = existingJob.rows[0];
        baseJobData.job_description = ej.job_description;
        baseJobData.panel_count = ej.panel_count;
        baseJobData.price = ej.price;
        baseJobData.price_per_panel = ej.price_per_panel;
        baseJobData.preferred_days = ej.preferred_days;
        baseJobData.preferred_time = ej.preferred_time;
        baseJobData.technician = ej.technician;
        baseJobData.employee = ej.employee;
      }
    }

    const jobs = await generateRecurringJobs(customer_id, baseJobData, recurrence_interval, startDate);

    await pool.query(
      `UPDATE customers SET is_recurring = true WHERE id = $1`,
      [customer_id]
    );

    const allJobs = await pool.query(
      `SELECT * FROM jobs WHERE customer_id = $1 ORDER BY scheduled_date ASC`,
      [customer_id]
    );

    res.json({ generated: jobs.length, recurrence_interval, jobs: allJobs.rows });
  } catch (err) {
    console.error('Error generating recurring jobs:', err);
    res.status(500).json({ error: 'Failed to generate recurring jobs' });
  }
});

router.post('/cancel-recurring', async (req, res) => {
  try {
    const { customer_id } = req.body;
    if (!customer_id) {
      return res.status(400).json({ error: 'customer_id required' });
    }

    const deleted = await pool.query(
      `DELETE FROM jobs WHERE customer_id = $1 AND is_recurring = true AND (status = '' OR status IS NULL OR status = 'scheduled') AND (completed_date IS NULL OR completed_date = '') RETURNING id`,
      [customer_id]
    );

    await pool.query(
      `UPDATE customers SET is_recurring = false, status = '', next_service_date = NULL WHERE id = $1`,
      [customer_id]
    );

    res.json({ cancelled: true, deleted_jobs: deleted.rows.length });
  } catch (err) {
    console.error('Error cancelling recurring:', err);
    res.status(500).json({ error: 'Failed to cancel recurring' });
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
          const nextUpcoming = await pool.query(
            `SELECT * FROM jobs WHERE customer_id = $1 AND is_recurring = true AND status != 'completed' AND status != 'cancelled' AND id != $2 AND scheduled_date > $3 ORDER BY scheduled_date ASC LIMIT 1`,
            [updatedJob.customer_id, updatedJob.id, completedDateStr]
          );

          if (nextUpcoming.rows.length > 0) {
            const nextJob = nextUpcoming.rows[0];
            const nextDate = nextJob.scheduled_date;
            const daysUntilNext = Math.floor((new Date(nextDate) - new Date()) / (1000 * 60 * 60 * 24));
            const customerStatus = daysUntilNext <= 30 && daysUntilNext >= 0 ? 'scheduled' : null;
            await pool.query(
              `UPDATE customers SET status = $1, next_service_date = $2, scheduled_date = NULL, scheduled_time = NULL WHERE id = $3`,
              [customerStatus, nextDate, updatedJob.customer_id]
            );
            updatedJob.next_job = nextJob;
          } else {
            await pool.query(
              `UPDATE customers SET status = NULL, next_service_date = NULL, scheduled_date = NULL, scheduled_time = NULL WHERE id = $1`,
              [updatedJob.customer_id]
            );
            updatedJob.next_job = null;
          }
        } else {
          await pool.query(
            `UPDATE customers SET status = NULL, scheduled_date = NULL, scheduled_time = NULL WHERE id = $1`,
            [updatedJob.customer_id]
          );
        }
      } catch (autoErr) {
        console.error('Error processing completed job:', autoErr);
      }
    }

    res.json(updatedJob);
  } catch (err) {
    console.error('Error updating job:', err);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM jobs WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });

    const deletedJob = result.rows[0];
    const customerId = deletedJob.customer_id;

    const remaining = await pool.query(
      `SELECT * FROM jobs WHERE customer_id = $1 ORDER BY COALESCE(completed_date, scheduled_date) DESC`,
      [customerId]
    );
    const jobs = remaining.rows;

    const completedJobs = jobs.filter(j => j.status === 'completed' && (j.completed_date || j.scheduled_date));
    const lastServiceDate = completedJobs.length > 0
      ? (completedJobs[0].completed_date || completedJobs[0].scheduled_date)
      : null;

    const activeJobs = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled');
    let nextServiceDate = null;
    let newStatus = '';

    if (activeJobs.length > 0) {
      const upcoming = activeJobs
        .filter(j => j.scheduled_date)
        .sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));
      if (upcoming.length > 0) {
        nextServiceDate = upcoming[0].scheduled_date;
        const isRecurring = upcoming[0].is_recurring;
        if (isRecurring) {
          const daysUntil = Math.floor((new Date(nextServiceDate) - new Date()) / (1000 * 60 * 60 * 24));
          newStatus = daysUntil <= 30 ? 'scheduled' : null;
        } else {
          newStatus = 'scheduled';
        }
      } else {
        newStatus = 'unscheduled';
      }
    } else {
      newStatus = null;
    }

    await pool.query(
      `UPDATE customers SET last_service_date = $1, next_service_date = $2, status = $3, scheduled_date = NULL, scheduled_time = NULL WHERE id = $4`,
      [lastServiceDate || null, nextServiceDate || null, newStatus, customerId]
    );

    res.json({ deleted: true, customer_update: { last_service_date: lastServiceDate, next_service_date: nextServiceDate, status: newStatus } });
  } catch (err) {
    console.error('Error deleting job:', err);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

module.exports = router;
