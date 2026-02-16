const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

const JOB_DURATION_MINUTES = 75;
const BUFFER_MINUTES = 10;
const HARD_CUTOFF_HOUR = 18;
const MAX_CONTACTS_PER_WEEK = 1;
const MAX_CONTACTS_PER_MONTH = 3;
const COOLDOWN_MONTHS = 6;
const MILES_PER_DEGREE_LAT = 69.0;
const AVG_SPEED_MPH = 25;
const TIMEZONE = 'America/Chicago';

function getCSTNow() {
  const now = new Date();
  const cstStr = now.toLocaleString('en-US', { timeZone: TIMEZONE });
  const cstDate = new Date(cstStr);
  return cstDate;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDriveMinutes(distanceMiles) {
  return (distanceMiles / AVG_SPEED_MPH) * 60;
}

function directionScore(refLat, refLng, nextLat, nextLng, candidateLat, candidateLng) {
  if (!nextLat || !nextLng) return 0;
  const toNextLat = nextLat - refLat;
  const toNextLng = nextLng - refLng;
  const toCandLat = candidateLat - refLat;
  const toCandLng = candidateLng - refLng;
  const dot = toNextLat * toCandLat + toNextLng * toCandLng;
  const magNext = Math.sqrt(toNextLat ** 2 + toNextLng ** 2);
  const magCand = Math.sqrt(toCandLat ** 2 + toCandLng ** 2);
  if (magNext === 0 || magCand === 0) return 0;
  return dot / (magNext * magCand);
}

const LAYER_CONFIG = {
  1: { maxMiles: 8, enforceTimeGate: true, label: 'Close Range, Best Fit' },
  2: { maxMiles: 15, enforceTimeGate: true, label: 'Expanded Range' },
  3: { maxMiles: 20, enforceTimeGate: false, label: 'Flexible Timing (may delay route)' },
  4: { maxMiles: 30, enforceTimeGate: false, label: 'All Nearby Customers' }
};

const TIER_MESSAGES = {
  1: "Hey {firstName}, we had a cancellation and are pulling your project forward. We'll be stopping by shortly. Let us know if this is an issue. Remember, you don't have to be home -- we just need roof access. We'll send your full assessment with before and after photos when we're done.",
  2: "Hey {firstName}, you're coming up on your scheduled maintenance and we're already nearby. We can complete your service today if that works for you.",
  3: "Hey {firstName}, we had a cancellation nearby and can fit you in today if that works.",
  4: "Hey {firstName}, we have an unexpected opening in your area today. If you'd like to move your appointment forward, we can complete it this afternoon. Otherwise your current appointment stays as is.",
  5: "Hey {firstName}, we're working in your area and noticed it's been a while since your last cleaning. We have an opening this afternoon if you're interested."
};

router.get('/route/:routeId/status', async (req, res) => {
  try {
    const session = await pool.query(
      `SELECT gs.*, c.full_name as confirmed_customer_name, c.address as confirmed_address
       FROM gap_fill_sessions gs
       LEFT JOIN gap_fill_candidates gc ON gs.confirmed_candidate_id = gc.id
       LEFT JOIN customers c ON gc.customer_id = c.id
       WHERE gs.route_id = $1
       ORDER BY gs.created_at DESC LIMIT 1`,
      [req.params.routeId]
    );
    if (session.rows.length === 0) {
      return res.json({ active: false });
    }
    const s = session.rows[0];
    res.json({
      active: s.status === 'active',
      status: s.status,
      confirmed: s.status === 'filled',
      confirmed_customer_name: s.confirmed_customer_name || null,
      confirmed_address: s.confirmed_address || null,
      cancelled_stop_index: s.cancelled_stop_index,
      created_at: s.created_at
    });
  } catch (err) {
    console.error('Error fetching gap fill status:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

router.post('/sessions', async (req, res) => {
  try {
    const activeSession = await pool.query(
      `SELECT id FROM gap_fill_sessions WHERE status = 'active'`
    );
    if (activeSession.rows.length > 0) {
      return res.status(409).json({
        error: 'A gap-fill session is already active',
        activeSessionId: activeSession.rows[0].id
      });
    }

    const { route_id, cancelled_stop_id, cancelled_job_id, cancelled_customer_id,
      reference_lat, reference_lng, reference_address,
      next_stop_id, next_stop_lat, next_stop_lng, next_stop_time,
      cancelled_job_description } = req.body;

    const result = await pool.query(`
      INSERT INTO gap_fill_sessions 
        (route_id, cancelled_stop_id, cancelled_job_id, cancelled_customer_id,
         reference_lat, reference_lng, reference_address,
         next_stop_id, next_stop_lat, next_stop_lng, next_stop_time,
         cancelled_job_description, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
      RETURNING *
    `, [route_id, cancelled_stop_id, cancelled_job_id, cancelled_customer_id,
      reference_lat, reference_lng, reference_address,
      next_stop_id, next_stop_lat, next_stop_lng, next_stop_time,
      cancelled_job_description]);

    const session = result.rows[0];

    const candidates = await generateCandidates(session, 1);

    res.status(201).json({ session, candidates });
  } catch (err) {
    console.error('Error creating gap-fill session:', err);
    res.status(500).json({ error: 'Failed to create gap-fill session' });
  }
});

router.get('/sessions/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM gap_fill_sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
    );
    if (result.rows.length === 0) {
      return res.json({ session: null, candidates: [] });
    }
    const session = result.rows[0];
    const candidates = await pool.query(
      `SELECT gc.*, c.full_name, c.first_name, c.address, c.phone, c.email,
              c.lat, c.lng, c.panel_count, c.customer_notes, c.notes as job_notes,
              c.is_recurring, c.last_service_date, c.anytime_access, c.flexible,
              c.preferred_contact_method, c.cancellation_count, c.customer_type
       FROM gap_fill_candidates gc
       JOIN customers c ON gc.customer_id = c.id
       WHERE gc.session_id = $1
       ORDER BY gc.sort_rank ASC`,
      [session.id]
    );
    res.json({ session, candidates: candidates.rows });
  } catch (err) {
    console.error('Error fetching active session:', err);
    res.status(500).json({ error: 'Failed to fetch active session' });
  }
});

router.post('/sessions/:id/expand', async (req, res) => {
  try {
    const session = await pool.query('SELECT * FROM gap_fill_sessions WHERE id = $1', [req.params.id]);
    if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const s = session.rows[0];
    const newLayer = (s.search_layer || 1) + 1;
    if (newLayer > 4) {
      return res.status(400).json({ error: 'Already at maximum search expansion' });
    }

    await pool.query('UPDATE gap_fill_sessions SET search_layer = $1 WHERE id = $2', [newLayer, s.id]);
    s.search_layer = newLayer;

    const candidates = await generateCandidates(s, newLayer);

    const allCandidates = await pool.query(
      `SELECT gc.*, c.full_name, c.first_name, c.address, c.phone, c.email,
              c.lat, c.lng, c.panel_count, c.customer_notes, c.notes as job_notes,
              c.is_recurring, c.last_service_date, c.anytime_access, c.flexible,
              c.preferred_contact_method, c.cancellation_count, c.customer_type
       FROM gap_fill_candidates gc
       JOIN customers c ON gc.customer_id = c.id
       WHERE gc.session_id = $1
       ORDER BY gc.sort_rank ASC`,
      [s.id]
    );

    res.json({
      session: { ...s, search_layer: newLayer },
      candidates: allCandidates.rows,
      newCandidatesCount: candidates.length,
      layerLabel: LAYER_CONFIG[newLayer]?.label || 'Expanded'
    });
  } catch (err) {
    console.error('Error expanding search:', err);
    res.status(500).json({ error: 'Failed to expand search' });
  }
});

router.patch('/candidates/:id', async (req, res) => {
  try {
    const { outreach_status, outreach_note, contact_method_used } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (outreach_status) {
      updates.push(`outreach_status = $${idx}`);
      params.push(outreach_status);
      idx++;

      if (outreach_status === 'contacted' || outreach_status === 'no_answer') {
        updates.push(`contacted_at = NOW()`);
      }
      if (['confirmed', 'declined', 'no_answer', 'skipped'].includes(outreach_status)) {
        updates.push(`resolved_at = NOW()`);
      }
    }
    if (outreach_note !== undefined) {
      updates.push(`outreach_note = $${idx}`);
      params.push(outreach_note);
      idx++;
    }
    if (contact_method_used) {
      updates.push(`contact_method_used = $${idx}`);
      params.push(contact_method_used);
      idx++;
    }
    updates.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE gap_fill_candidates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidate not found' });

    const candidate = result.rows[0];

    if (outreach_status === 'contacted' || outreach_status === 'no_answer' || outreach_status === 'declined') {
      await pool.query(
        `INSERT INTO gap_fill_outreach_log (customer_id, session_id, contacted_at, outcome, tier, service_type)
         VALUES ($1, $2, NOW(), $3, $4, $5)`,
        [candidate.customer_id, candidate.session_id, outreach_status, candidate.tier,
          (await pool.query('SELECT cancelled_job_description FROM gap_fill_sessions WHERE id = $1', [candidate.session_id])).rows[0]?.cancelled_job_description || '']
      );
    }

    res.json(candidate);
  } catch (err) {
    console.error('Error updating candidate:', err);
    res.status(500).json({ error: 'Failed to update candidate' });
  }
});

router.post('/sessions/:id/confirm', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { candidate_id } = req.body;

    const candidateResult = await client.query(
      `SELECT gc.*, c.full_name, c.first_name, c.address, c.phone, c.panel_count,
              c.lat, c.lng, c.customer_notes
       FROM gap_fill_candidates gc
       JOIN customers c ON gc.customer_id = c.id
       WHERE gc.id = $1`, [candidate_id]
    );
    if (candidateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Candidate not found' });
    }
    const candidate = candidateResult.rows[0];

    const alreadyScheduled = await client.query(
      `SELECT rs.id FROM route_stops rs
       JOIN routes r ON rs.route_id = r.id
       WHERE rs.customer_id = $1 AND r.scheduled_date = CURRENT_DATE::text`,
      [candidate.customer_id]
    );
    if (alreadyScheduled.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Customer is already on a route today' });
    }

    const session = await client.query('SELECT * FROM gap_fill_sessions WHERE id = $1', [req.params.id]);
    if (session.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }
    const s = session.rows[0];

    const prevJob = await client.query(
      `SELECT * FROM jobs WHERE customer_id = $1 AND job_description = $2
       ORDER BY COALESCE(completed_date, scheduled_date, created_at::text) DESC LIMIT 1`,
      [candidate.customer_id, s.cancelled_job_description]
    );

    const jobDetails = prevJob.rows.length > 0 ? prevJob.rows[0] : {};

    const newJob = await client.query(`
      INSERT INTO jobs (customer_id, job_description, status, panel_count, price, price_per_panel,
                        preferred_days, preferred_time, technician, employee, notes, is_gap_fill)
      VALUES ($1, $2, 'unscheduled', $3, $4, $5, $6, $7, $8, $9, $10, true)
      RETURNING *
    `, [
      candidate.customer_id,
      s.cancelled_job_description || jobDetails.job_description || 'Residential Panel Cleaning',
      jobDetails.panel_count || candidate.panel_count || 0,
      parseFloat(jobDetails.price) || 0,
      parseFloat(jobDetails.price_per_panel) || 0,
      jobDetails.preferred_days || '',
      jobDetails.preferred_time || '',
      jobDetails.technician || '',
      jobDetails.employee || '',
      'Gap-fill job - review before routing',
      true
    ]);

    await client.query(
      `UPDATE gap_fill_candidates SET outreach_status = 'confirmed', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [candidate_id]
    );

    await client.query(
      `UPDATE gap_fill_sessions SET status = 'filled', resolved_at = NOW(), resolution = 'confirmed',
       confirmed_customer_id = $1, confirmed_candidate_id = $2 WHERE id = $3`,
      [candidate.customer_id, candidate_id, req.params.id]
    );

    await client.query(
      `INSERT INTO gap_fill_outreach_log (customer_id, session_id, contacted_at, outcome, tier, service_type)
       VALUES ($1, $2, NOW(), 'confirmed', $3, $4)`,
      [candidate.customer_id, s.id, candidate.tier, s.cancelled_job_description]
    );

    await client.query('COMMIT');

    res.json({
      session: { ...s, status: 'filled' },
      confirmedCandidate: candidate,
      newJob: newJob.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error confirming gap-fill:', err);
    res.status(500).json({ error: 'Failed to confirm gap-fill' });
  } finally {
    client.release();
  }
});

router.post('/sessions/:id/add-to-route', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { candidate_id } = req.body;

    const session = await client.query('SELECT * FROM gap_fill_sessions WHERE id = $1', [req.params.id]);
    if (session.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found' });
    }
    const s = session.rows[0];

    if (s.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Session is no longer active' });
    }

    const candidateResult = await client.query(
      `SELECT gc.*, c.full_name, c.first_name, c.address, c.phone, c.panel_count,
              c.lat, c.lng, c.customer_notes, c.customer_type
       FROM gap_fill_candidates gc
       JOIN customers c ON gc.customer_id = c.id
       WHERE gc.id = $1`, [candidate_id]
    );
    if (candidateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Candidate not found' });
    }
    const candidate = candidateResult.rows[0];

    const alreadyScheduled = await client.query(
      `SELECT rs.id FROM route_stops rs
       JOIN routes r ON rs.route_id = r.id
       WHERE rs.customer_id = $1 AND r.scheduled_date = (SELECT scheduled_date FROM routes WHERE id = $2)
       AND rs.cancelled = false`,
      [candidate.customer_id, s.route_id]
    );
    if (alreadyScheduled.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Customer is already on a route for this day' });
    }

    const cancelledStop = await client.query(
      `SELECT * FROM route_stops WHERE id = $1`, [s.cancelled_stop_id]
    );
    const cancelledStopOrder = cancelledStop.rows.length > 0 ? cancelledStop.rows[0].stop_order : null;
    const cancelledTime = cancelledStop.rows.length > 0 ? cancelledStop.rows[0].scheduled_time : null;

    const prevJob = await client.query(
      `SELECT * FROM jobs WHERE customer_id = $1 AND job_description = $2
       ORDER BY COALESCE(completed_date, scheduled_date, created_at::text) DESC LIMIT 1`,
      [candidate.customer_id, s.cancelled_job_description]
    );
    const jobDetails = prevJob.rows.length > 0 ? prevJob.rows[0] : {};

    const route = await client.query('SELECT * FROM routes WHERE id = $1', [s.route_id]);
    const scheduledDate = route.rows.length > 0 ? route.rows[0].scheduled_date : new Date().toISOString().split('T')[0];

    const newJob = await client.query(`
      INSERT INTO jobs (customer_id, job_description, status, panel_count, price, price_per_panel,
                        preferred_days, preferred_time, technician, employee, notes, is_gap_fill,
                        scheduled_date)
      VALUES ($1, $2, 'scheduled', $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
      RETURNING *
    `, [
      candidate.customer_id,
      s.cancelled_job_description || jobDetails.job_description || 'Residential Panel Cleaning',
      jobDetails.panel_count || candidate.panel_count || 0,
      parseFloat(jobDetails.price) || 0,
      parseFloat(jobDetails.price_per_panel) || 0,
      jobDetails.preferred_days || '',
      jobDetails.preferred_time || '',
      jobDetails.technician || route.rows[0]?.technician || '',
      jobDetails.employee || '',
      'Gap-fill replacement',
      true,
      scheduledDate
    ]);

    const newStop = await client.query(`
      INSERT INTO route_stops (route_id, customer_id, stop_order, scheduled_time, notes)
      VALUES ($1, $2, $3, $4, 'Gap-fill replacement')
      RETURNING *
    `, [s.route_id, candidate.customer_id, cancelledStopOrder || 999, cancelledTime]);

    await client.query(
      `UPDATE customers SET status = 'scheduled' WHERE id = $1`,
      [candidate.customer_id]
    );

    await client.query(
      `UPDATE gap_fill_candidates SET outreach_status = 'confirmed', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [candidate_id]
    );

    await client.query(
      `UPDATE gap_fill_sessions SET status = 'filled', resolved_at = NOW(), resolution = 'confirmed',
       confirmed_customer_id = $1, confirmed_candidate_id = $2 WHERE id = $3`,
      [candidate.customer_id, candidate_id, req.params.id]
    );

    await client.query(
      `INSERT INTO gap_fill_outreach_log (customer_id, session_id, contacted_at, outcome, tier, service_type)
       VALUES ($1, $2, NOW(), 'confirmed', $3, $4)`,
      [candidate.customer_id, s.id, candidate.tier, s.cancelled_job_description]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      session: { ...s, status: 'filled' },
      confirmedCandidate: candidate,
      newJob: newJob.rows[0],
      newStop: newStop.rows[0],
      routeId: s.route_id
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error adding gap-fill to route:', err);
    res.status(500).json({ error: 'Failed to add gap-fill to route' });
  } finally {
    client.release();
  }
});

router.post('/sessions/:id/close', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE gap_fill_sessions SET status = 'closed', resolved_at = NOW(), resolution = 'unfilled'
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const session = result.rows[0];

    if (session.cancelled_job_id) {
      await pool.query(
        `UPDATE jobs SET gap_fill_attempted = true WHERE id = $1`,
        [session.cancelled_job_id]
      );
    }

    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('Error closing session:', err);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

router.post('/sessions/:id/tech-moved-on', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE gap_fill_sessions SET tech_moved_on = true WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('Error updating tech status:', err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

router.post('/sessions/:id/tech-update-location', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    res.json({ ok: true, lat, lng });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.post('/customers/:id/anytime-access', async (req, res) => {
  try {
    const { anytime_access } = req.body;
    const result = await pool.query(
      `UPDATE customers SET anytime_access = $1 WHERE id = $2 RETURNING id, full_name, anytime_access`,
      [anytime_access !== false, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating anytime access:', err);
    res.status(500).json({ error: 'Failed to update' });
  }
});

router.post('/candidates/:id/reset-timer', async (req, res) => {
  try {
    const candidate = await pool.query('SELECT customer_id FROM gap_fill_candidates WHERE id = $1', [req.params.id]);
    if (candidate.rows.length === 0) return res.status(404).json({ error: 'Candidate not found' });

    await pool.query(
      `DELETE FROM gap_fill_outreach_log WHERE customer_id = $1 AND contacted_at > NOW() - INTERVAL '30 days'`,
      [candidate.rows[0].customer_id]
    );

    res.json({ ok: true, message: 'Contact timer reset' });
  } catch (err) {
    console.error('Error resetting timer:', err);
    res.status(500).json({ error: 'Failed to reset timer' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const totalSessions = await pool.query('SELECT COUNT(*) FROM gap_fill_sessions');
    const filledSessions = await pool.query(`SELECT COUNT(*) FROM gap_fill_sessions WHERE resolution = 'confirmed'`);
    const tierStats = await pool.query(`
      SELECT tier, outcome, COUNT(*) as cnt
      FROM gap_fill_outreach_log
      GROUP BY tier, outcome
      ORDER BY tier, outcome
    `);

    const tierSuccessRates = {};
    for (const row of tierStats.rows) {
      if (!tierSuccessRates[row.tier]) {
        tierSuccessRates[row.tier] = { total: 0, confirmed: 0 };
      }
      tierSuccessRates[row.tier].total += parseInt(row.cnt);
      if (row.outcome === 'confirmed') {
        tierSuccessRates[row.tier].confirmed += parseInt(row.cnt);
      }
    }

    for (const tier in tierSuccessRates) {
      const t = tierSuccessRates[tier];
      t.rate = t.total > 0 ? Math.round((t.confirmed / t.total) * 100) : 0;
    }

    res.json({
      totalSessions: parseInt(totalSessions.rows[0].count),
      filledSessions: parseInt(filledSessions.rows[0].count),
      fillRate: parseInt(totalSessions.rows[0].count) > 0
        ? Math.round((parseInt(filledSessions.rows[0].count) / parseInt(totalSessions.rows[0].count)) * 100)
        : 0,
      tierSuccessRates
    });
  } catch (err) {
    console.error('Error fetching gap-fill stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/messages/:tier', (req, res) => {
  const tier = parseInt(req.params.tier);
  const message = TIER_MESSAGES[tier] || TIER_MESSAGES[5];
  res.json({ tier, message });
});

async function generateCandidates(session, layer) {
  const config = LAYER_CONFIG[layer];
  if (!config) return [];

  const existingCustomerIds = await pool.query(
    `SELECT customer_id FROM gap_fill_candidates WHERE session_id = $1`,
    [session.id]
  );
  const excludeIds = new Set(existingCustomerIds.rows.map(r => r.customer_id));

  const routeCustomerIds = await pool.query(
    `SELECT rs.customer_id FROM route_stops rs
     JOIN routes r ON rs.route_id = r.id
     WHERE r.scheduled_date = CURRENT_DATE::text`,
    []
  );
  for (const row of routeCustomerIds.rows) {
    excludeIds.add(row.customer_id);
  }

  if (session.cancelled_customer_id) {
    excludeIds.add(session.cancelled_customer_id);
  }

  const latRange = config.maxMiles / MILES_PER_DEGREE_LAT;
  const lngRange = latRange / Math.cos((session.reference_lat || 32.7) * Math.PI / 180);

  const allCustomers = await pool.query(`
    SELECT c.*, 
      (SELECT j.completed_date FROM jobs j WHERE j.customer_id = c.id 
       AND j.job_description = $1 AND j.status = 'completed'
       ORDER BY j.completed_date DESC LIMIT 1) as last_service_for_type,
      (SELECT j.scheduled_date FROM jobs j WHERE j.customer_id = c.id
       AND j.job_description = $1 AND j.status NOT IN ('completed','cancelled')
       ORDER BY j.scheduled_date ASC LIMIT 1) as next_scheduled_for_type,
      (SELECT j.recurrence_interval FROM jobs j WHERE j.customer_id = c.id
       AND j.is_recurring = true AND j.job_description = $1
       ORDER BY j.created_at DESC LIMIT 1) as recurrence_for_type,
      (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id
       AND j.job_description = $1 AND j.status = 'completed') as completed_count_for_type
    FROM customers c
    WHERE c.lat IS NOT NULL AND c.lng IS NOT NULL
      AND c.lat != 0 AND c.lng != 0
      AND (c.phone IS NOT NULL AND c.phone != '')
      AND c.lat BETWEEN $2 AND $3
      AND c.lng BETWEEN $4 AND $5
  `, [
    session.cancelled_job_description || 'Residential Panel Cleaning',
    session.reference_lat - latRange, session.reference_lat + latRange,
    session.reference_lng - lngRange, session.reference_lng + lngRange
  ]);

  const now = new Date();
  const cstNow = getCSTNow();
  const todayStr = cstNow.toISOString().split('T')[0];

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const recentOutreach = await pool.query(`
    SELECT customer_id, 
      COUNT(*) FILTER (WHERE contacted_at > $1) as week_count,
      COUNT(*) FILTER (WHERE contacted_at > $2) as month_count
    FROM gap_fill_outreach_log
    GROUP BY customer_id
  `, [weekAgo.toISOString(), monthAgo.toISOString()]);

  const outreachMap = {};
  for (const row of recentOutreach.rows) {
    outreachMap[row.customer_id] = {
      weekCount: parseInt(row.week_count),
      monthCount: parseInt(row.month_count)
    };
  }

  const lastContactInfo = await pool.query(`
    SELECT DISTINCT ON (customer_id) customer_id, contacted_at, outcome
    FROM gap_fill_outreach_log
    ORDER BY customer_id, contacted_at DESC
  `);
  const lastContactMap = {};
  for (const row of lastContactInfo.rows) {
    lastContactMap[row.customer_id] = { contacted_at: row.contacted_at, outcome: row.outcome };
  }

  const candidates = [];

  for (const customer of allCustomers.rows) {
    if (excludeIds.has(customer.id)) continue;

    const distance = haversineDistance(
      session.reference_lat, session.reference_lng,
      customer.lat, customer.lng
    );

    if (distance > config.maxMiles) continue;

    const outreach = outreachMap[customer.id] || { weekCount: 0, monthCount: 0 };
    if (outreach.weekCount >= MAX_CONTACTS_PER_WEEK) continue;
    if (outreach.monthCount >= MAX_CONTACTS_PER_MONTH) continue;

    const cancelledToday = await pool.query(
      `SELECT id FROM jobs WHERE customer_id = $1 AND cancelled_at::date = CURRENT_DATE`,
      [customer.id]
    );
    if (cancelledToday.rows.length > 0) continue;

    const lastServiceDate = customer.last_service_for_type;
    if (lastServiceDate) {
      const monthsSinceService = (now - new Date(lastServiceDate)) / (1000 * 60 * 60 * 24 * 30);
      if (monthsSinceService < COOLDOWN_MONTHS) continue;
    }

    if (config.enforceTimeGate && session.next_stop_time) {
      const driveMinutes = estimateDriveMinutes(distance);
      const totalMinutes = JOB_DURATION_MINUTES + driveMinutes + BUFFER_MINUTES;
      const nowMinutes = cstNow.getHours() * 60 + cstNow.getMinutes();
      const endMinutes = nowMinutes + driveMinutes + JOB_DURATION_MINUTES;

      if (endMinutes > HARD_CUTOFF_HOUR * 60) continue;

      const nextTimeParts = session.next_stop_time.match(/(\d+):(\d+)/);
      if (nextTimeParts) {
        const nextMinutes = parseInt(nextTimeParts[1]) * 60 + parseInt(nextTimeParts[2]);
        if (nowMinutes + totalMinutes > nextMinutes) continue;
      }
    } else {
      const driveMinutes = estimateDriveMinutes(distance);
      const nowMinutes = cstNow.getHours() * 60 + cstNow.getMinutes();
      const endMinutes = nowMinutes + driveMinutes + JOB_DURATION_MINUTES;
      if (endMinutes > HARD_CUTOFF_HOUR * 60) continue;
    }

    const { tier, reason } = determineTier(customer, session, now);

    const dirScore = directionScore(
      session.reference_lat, session.reference_lng,
      session.next_stop_lat, session.next_stop_lng,
      customer.lat, customer.lng
    );

    candidates.push({
      customer_id: customer.id,
      tier,
      tier_reason: reason,
      distance_miles: Math.round(distance * 100) / 100,
      direction_score: Math.round(dirScore * 100) / 100,
      search_layer: layer,
      last_contact: lastContactMap[customer.id] || null
    });
  }

  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.distance_miles - b.distance_miles;
  });

  const maxExisting = await pool.query(
    `SELECT COALESCE(MAX(sort_rank), 0) as max_rank FROM gap_fill_candidates WHERE session_id = $1`,
    [session.id]
  );
  let rank = parseInt(maxExisting.rows[0].max_rank) || 0;

  const inserted = [];
  for (const c of candidates) {
    rank++;
    const result = await pool.query(`
      INSERT INTO gap_fill_candidates 
        (session_id, customer_id, tier, tier_reason, distance_miles, direction_score, sort_rank, search_layer)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [session.id, c.customer_id, c.tier, c.tier_reason, c.distance_miles, c.direction_score, rank, layer]);
    inserted.push(result.rows[0]);
  }

  return inserted;
}

function determineTier(customer, session, now) {
  if (customer.anytime_access) {
    return { tier: 1, reason: 'Anytime Access - no need to be home' };
  }

  const recurrence = customer.recurrence_for_type;
  const lastService = customer.last_service_for_type;
  const isRecurring = customer.is_recurring;

  if (isRecurring && recurrence && lastService) {
    const months = getRecurrenceMonths(recurrence);
    const monthsSince = (now - new Date(lastService)) / (1000 * 60 * 60 * 24 * 30);
    if (monthsSince >= months * 1.5) {
      return { tier: 2, reason: `Recurring, last cleaned ${Math.round(monthsSince)} months ago (overdue)` };
    }
    if (monthsSince >= months - 1) {
      return { tier: 2, reason: `Recurring, last cleaned ${Math.round(monthsSince)} months ago (due)` };
    }
  }

  if (customer.flexible) {
    const hasUnscheduled = !customer.next_scheduled_for_type;
    if (hasUnscheduled) {
      return { tier: 3, reason: 'Flexible, no scheduled job' };
    }
  }

  if (customer.next_scheduled_for_type) {
    const scheduledDate = new Date(customer.next_scheduled_for_type);
    const daysUntil = Math.floor((scheduledDate - now) / (1000 * 60 * 60 * 24));
    if (daysUntil > 0 && daysUntil <= 21) {
      const dateStr = scheduledDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return { tier: 4, reason: `Has job scheduled for ${dateStr}` };
    }
  }

  if (parseInt(customer.completed_count_for_type) > 0 && !isRecurring) {
    const lastService = customer.last_service_for_type;
    if (lastService) {
      const monthsSince = Math.round((now - new Date(lastService)) / (1000 * 60 * 60 * 24 * 30));
      return { tier: 5, reason: `Last service was ${monthsSince} months ago, non-recurring` };
    }
    return { tier: 5, reason: 'Past customer, non-recurring' };
  }

  return { tier: 5, reason: 'Past customer in area' };
}

function getRecurrenceMonths(interval) {
  if (interval === 'biannual' || interval === '6months' || interval === '6') return 6;
  if (interval === 'annual' || interval === 'yearly' || interval === '12months' || interval === '12') return 12;
  if (interval === 'triannual' || interval === '4months' || interval === '4') return 4;
  const months = parseInt(interval);
  return months > 0 ? months : 6;
}

module.exports = router;
