const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const {
      search, status, city, state, zip,
      solar_verified, is_recurring, existing_job,
      min_panels, last_service,
      sort_by, sort_order,
      limit, offset,
      lat_min, lat_max, lng_min, lng_max
    } = req.query;

    let query = `SELECT c.*, 
      COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled'))), 0)::int AS active_job_count,
      COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id), 0)::int AS total_job_count,
      (SELECT j.preferred_days FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_preferred_days,
      (SELECT j.price FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_price,
      (SELECT j.job_description FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_description,
      (SELECT j.id FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_id
    FROM customers c WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (search) {
      query += ` AND (
        full_name ILIKE $${paramIndex} OR
        address ILIKE $${paramIndex} OR
        city ILIKE $${paramIndex} OR
        email ILIKE $${paramIndex} OR
        phone ILIKE $${paramIndex} OR
        zip ILIKE $${paramIndex} OR
        notes ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status && status !== 'all') {
      query += ` AND LOWER(c.status) = $${paramIndex}`;
      params.push(status.toLowerCase());
      paramIndex++;
    }

    if (city) {
      query += ` AND LOWER(city) = $${paramIndex}`;
      params.push(city.toLowerCase());
      paramIndex++;
    }

    if (state) {
      query += ` AND LOWER(state) = $${paramIndex}`;
      params.push(state.toLowerCase());
      paramIndex++;
    }

    if (zip) {
      query += ` AND zip = $${paramIndex}`;
      params.push(zip);
      paramIndex++;
    }

    if (solar_verified && solar_verified !== 'all') {
      if (solar_verified === 'verified') {
        query += ` AND solar_verified = 'yes'`;
      } else if (solar_verified === 'no-solar') {
        query += ` AND solar_verified = 'no'`;
      } else if (solar_verified === 'unverified') {
        query += ` AND solar_verified IS NULL`;
      }
    }

    if (is_recurring === 'true') {
      query += ` AND is_recurring = true`;
    }

    if (existing_job === 'true') {
      query += ` AND existing_job = true`;
    }

    if (min_panels) {
      query += ` AND panel_count >= $${paramIndex}`;
      params.push(parseInt(min_panels));
      paramIndex++;
    }

    if (last_service) {
      const months = parseInt(last_service);
      if (months > 0) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);
        query += ` AND last_service_date IS NOT NULL AND last_service_date >= $${paramIndex}`;
        params.push(cutoff.toISOString().split('T')[0]);
        paramIndex++;
      }
    }

    if (lat_min && lat_max && lng_min && lng_max) {
      query += ` AND lat >= $${paramIndex} AND lat <= $${paramIndex + 1} AND lng >= $${paramIndex + 2} AND lng <= $${paramIndex + 3}`;
      params.push(parseFloat(lat_min), parseFloat(lat_max), parseFloat(lng_min), parseFloat(lng_max));
      paramIndex += 4;
    }

    const validSortFields = {
      'name': 'full_name',
      'status': 'status',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'panels': 'panel_count',
      'lastService': 'last_service_date',
      'amount': 'amount_paid',
      'created': 'created_at',
      'updated': 'updated_at'
    };

    const sortField = validSortFields[sort_by] || 'full_name';
    const order = sort_order === 'desc' ? 'DESC' : 'ASC';
    query += ` ORDER BY ${sortField} ${order}`;

    if (limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(parseInt(limit));
      paramIndex++;
    }

    if (offset) {
      query += ` OFFSET $${paramIndex}`;
      params.push(parseInt(offset));
      paramIndex++;
    }

    if (search && search.length > 500) {
      return res.status(400).json({ error: 'Search query too long', customers: [], total: 0 });
    }

    const result = await pool.query(query, params);

    let countQuery = `SELECT COUNT(*) FROM customers c WHERE 1=1`;
    const countParams = [];
    let countParamIndex = 1;

    if (search) {
      countQuery += ` AND (
        full_name ILIKE $${countParamIndex} OR
        address ILIKE $${countParamIndex} OR
        city ILIKE $${countParamIndex} OR
        email ILIKE $${countParamIndex} OR
        phone ILIKE $${countParamIndex} OR
        zip ILIKE $${countParamIndex} OR
        notes ILIKE $${countParamIndex}
      )`;
      countParams.push(`%${search}%`);
      countParamIndex++;
    }

    if (status && status !== 'all') {
      countQuery += ` AND LOWER(c.status) = $${countParamIndex}`;
      countParams.push(status.toLowerCase());
      countParamIndex++;
    }

    if (city) {
      countQuery += ` AND LOWER(city) = $${countParamIndex}`;
      countParams.push(city.toLowerCase());
      countParamIndex++;
    }

    if (state) {
      countQuery += ` AND LOWER(state) = $${countParamIndex}`;
      countParams.push(state.toLowerCase());
      countParamIndex++;
    }

    if (zip) {
      countQuery += ` AND zip = $${countParamIndex}`;
      countParams.push(zip);
      countParamIndex++;
    }

    if (lat_min && lat_max && lng_min && lng_max) {
      countQuery += ` AND lat >= $${countParamIndex} AND lat <= $${countParamIndex + 1} AND lng >= $${countParamIndex + 2} AND lng <= $${countParamIndex + 3}`;
      countParams.push(parseFloat(lat_min), parseFloat(lat_max), parseFloat(lng_min), parseFloat(lng_max));
      countParamIndex += 4;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      customers: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: limit ? parseInt(limit) : null,
      offset: offset ? parseInt(offset) : 0
    });
  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN LOWER(status) = 'unscheduled' THEN 1 END) as unscheduled,
        COUNT(CASE WHEN LOWER(status) = 'scheduled' THEN 1 END) as scheduled,
        COUNT(CASE WHEN last_service_date IS NOT NULL THEN 1 END) as completed,
        COUNT(DISTINCT state) as states,
        COUNT(DISTINCT city) as cities,
        COUNT(CASE WHEN is_recurring = true THEN 1 END) as recurring,
        COUNT(CASE WHEN solar_verified = 'yes' THEN 1 END) as verified_solar,
        COALESCE(SUM(amount_paid), 0) as total_revenue
      FROM customers
    `);
    res.json(stats.rows[0]);
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/filter-options', async (req, res) => {
  try {
    const cities = await pool.query(`SELECT DISTINCT city FROM customers WHERE city != '' ORDER BY city`);
    const states = await pool.query(`SELECT DISTINCT state FROM customers WHERE state != '' ORDER BY state`);
    const zips = await pool.query(`SELECT DISTINCT zip FROM customers WHERE zip != '' ORDER BY zip`);
    const statuses = await pool.query(`SELECT DISTINCT status FROM customers WHERE status IS NOT NULL ORDER BY status`);

    res.json({
      cities: cities.rows.map(r => r.city),
      states: states.rows.map(r => r.state),
      zips: zips.rows.map(r => r.zip),
      statuses: statuses.rows.map(r => r.status)
    });
  } catch (err) {
    console.error('Error fetching filter options:', err);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

router.get('/autocomplete', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 4) {
      return res.json([]);
    }
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=us&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SolarCRM/1.0' }
    });
    const data = await response.json();
    const results = data.map(r => {
      const a = r.address || {};
      return {
        display: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
        street: [a.house_number, a.road].filter(Boolean).join(' '),
        city: a.city || a.town || a.village || a.hamlet || '',
        state: a.state || '',
        zip: a.postcode || ''
      };
    });
    res.json(results);
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.json([]);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
        COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled'))), 0)::int AS active_job_count,
        COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id), 0)::int AS total_job_count,
        (SELECT j.preferred_days FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_preferred_days,
        (SELECT j.price FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_price,
        (SELECT j.job_description FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_description,
        (SELECT j.id FROM jobs j WHERE j.customer_id = c.id AND (j.status IS NULL OR j.status NOT IN ('completed', 'cancelled')) ORDER BY j.id DESC LIMIT 1) AS active_job_id
      FROM customers c WHERE c.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

router.post('/', async (req, res) => {
  try {
    const c = req.body;

    const fullName = c.full_name || c.name || `${c.first_name || c.firstName || ''} ${c.last_name || c.lastName || ''}`.trim();
    const address = c.address || '';
    if (!fullName || !address) {
      return res.status(400).json({ error: 'Customer name and address are required' });
    }

    const dupCheck = await pool.query(
      `SELECT id, full_name FROM customers WHERE LOWER(address) = LOWER($1)`,
      [address]
    );
    const isDuplicate = dupCheck.rows.length > 0;
    const result = await pool.query(`
      INSERT INTO customers (
        first_name, last_name, full_name, address, street, city, state, zip,
        lat, lng, phone, email, secondary_phones, secondary_emails,
        status, notes, customer_notes, panel_count, total_panels, pricing_tier,
        preferred_date, preferred_time_window, scheduled_date, scheduled_time,
        solar_verified, is_recurring, amount_paid, tip_amount,
        last_service_date, next_service_date, job_description, tags, employee,
        existing_job, route_confirmed, verification_data, notes_history, source, customer_type
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39
      ) RETURNING *
    `, [
      c.first_name || c.firstName || '', c.last_name || c.lastName || '',
      c.full_name || c.name || `${c.first_name || c.firstName || ''} ${c.last_name || c.lastName || ''}`.trim(),
      c.address || '', c.street || '', c.city || '', c.state || '', c.zip || '',
      c.lat || null, c.lng || null,
      c.phone || '', c.email || '',
      c.secondary_phones || c.secondaryPhones || [],
      c.secondary_emails || c.secondaryEmails || [],
      (c.status || '').toLowerCase() || 'none', c.notes || '', c.customer_notes || c.customerNotes || '',
      parseInt(c.panel_count || c.panelCount) || 0, parseInt(c.total_panels || c.totalPanels) || 0,
      c.pricing_tier || c.pricingTier || 'standard',
      c.preferred_date || c.preferredDate || null, c.preferred_time_window || c.preferredTimeWindow || null,
      c.scheduled_date || c.scheduledDate || null, c.scheduled_time || c.scheduledTime || null,
      c.solar_verified || c.solarVerified || null,
      c.is_recurring || c.isRecurring || false,
      parseFloat(c.amount_paid || c.amountPaid) || 0, parseFloat(c.tip_amount || c.tipAmount) || 0,
      c.last_service_date || c.lastServiceDate || null, c.next_service_date || c.nextServiceDate || null,
      c.job_description || c.jobDescription || '', c.tags || '', c.employee || '',
      c.existing_job || c.existingJob || false, c.route_confirmed || c.routeConfirmed || false,
      c.verification_data || c.verificationData || null,
      JSON.stringify(c.notes_history || c.notesHistory || []),
      c.source || '',
      c.customer_type || c.customerType || 'residential'
    ]);
    const customer = result.rows[0];
    if (isDuplicate) {
      customer._duplicate_warning = `Address already exists for: ${dupCheck.rows.map(r => r.full_name).join(', ')}`;
    }
    res.status(201).json(customer);
  } catch (err) {
    console.error('Error creating customer:', err);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

router.post('/bulk', async (req, res) => {
  const { customers } = req.body;
  if (!customers || !Array.isArray(customers)) {
    return res.status(400).json({ error: 'customers array is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];

    for (const c of customers) {
      const result = await client.query(`
        INSERT INTO customers (
          first_name, last_name, full_name, address, street, city, state, zip,
          lat, lng, phone, email, secondary_phones, secondary_emails,
          status, notes, customer_notes, panel_count, total_panels, pricing_tier,
          preferred_date, preferred_time_window, scheduled_date, scheduled_time,
          solar_verified, is_recurring, amount_paid, tip_amount,
          last_service_date, next_service_date, job_description, tags, employee,
          existing_job, route_confirmed, notes_history, source, customer_type
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
          $29, $30, $31, $32, $33, $34, $35, $36, $37, $38
        ) RETURNING *
      `, [
        c.first_name || c.firstName || '', c.last_name || c.lastName || '',
        c.full_name || c.name || `${c.first_name || c.firstName || ''} ${c.last_name || c.lastName || ''}`.trim(),
        c.address || '', c.street || '', c.city || '', c.state || '', c.zip || '',
        c.lat || null, c.lng || null,
        c.phone || '', c.email || '',
        c.secondary_phones || c.secondaryPhones || [],
        c.secondary_emails || c.secondaryEmails || [],
        (c.status || '').toLowerCase() || null, c.notes || '', c.customer_notes || c.customerNotes || '',
        parseInt(c.panel_count || c.panelCount) || 0, parseInt(c.total_panels || c.totalPanels) || 0,
        c.pricing_tier || c.pricingTier || 'standard',
        c.preferred_date || c.preferredDate || null, c.preferred_time_window || c.preferredTimeWindow || null,
        c.scheduled_date || c.scheduledDate || null, c.scheduled_time || c.scheduledTime || null,
        c.solar_verified || c.solarVerified || null,
        c.is_recurring || c.isRecurring || false,
        parseFloat(c.amount_paid || c.amountPaid) || 0, parseFloat(c.tip_amount || c.tipAmount) || 0,
        c.last_service_date || c.lastServiceDate || null, c.next_service_date || c.nextServiceDate || null,
        c.job_description || c.jobDescription || '', c.tags || '', c.employee || '',
        c.existing_job || c.existingJob || false, c.route_confirmed || c.routeConfirmed || false,
        JSON.stringify(c.notes_history || c.notesHistory || []),
        c.source || '',
        c.customer_type || c.customerType || 'residential'
      ]);
      const customerId = result.rows[0].id;
      results.push(result.rows[0]);

      const serviceHistory = c.serviceHistory || c.service_history || [];
      for (const job of serviceHistory) {
        await client.query(`
          INSERT INTO jobs (
            customer_id, job_description, status, completed_date,
            amount, tip, notes, is_recurring, panel_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          customerId,
          job.jobDescription || job.job_description || '',
          (job.status || 'completed').toLowerCase(),
          job.date || job.completed_date || null,
          parseFloat(job.amount) || 0,
          parseFloat(job.tip) || 0,
          job.notes || '',
          job.isRecurring || job.is_recurring || false,
          parseInt(job.panelCount || job.panel_count) || 0
        ]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ imported: results.length, customers: results });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error bulk importing customers:', err);
    res.status(500).json({ error: 'Failed to bulk import customers' });
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

    const fieldMap = {
      firstName: 'first_name', first_name: 'first_name',
      lastName: 'last_name', last_name: 'last_name',
      name: 'full_name', full_name: 'full_name',
      address: 'address', street: 'street', city: 'city', state: 'state', zip: 'zip',
      lat: 'lat', lng: 'lng', phone: 'phone', email: 'email',
      secondaryPhones: 'secondary_phones', secondary_phones: 'secondary_phones',
      secondaryEmails: 'secondary_emails', secondary_emails: 'secondary_emails',
      status: 'status', notes: 'notes',
      customerNotes: 'customer_notes', customer_notes: 'customer_notes',
      panelCount: 'panel_count', panel_count: 'panel_count',
      totalPanels: 'total_panels', total_panels: 'total_panels',
      pricingTier: 'pricing_tier', pricing_tier: 'pricing_tier',
      preferredDate: 'preferred_date', preferred_date: 'preferred_date',
      preferredTimeWindow: 'preferred_time_window', preferred_time_window: 'preferred_time_window',
      scheduledDate: 'scheduled_date', scheduled_date: 'scheduled_date',
      scheduledTime: 'scheduled_time', scheduled_time: 'scheduled_time',
      solarVerified: 'solar_verified', solar_verified: 'solar_verified',
      isRecurring: 'is_recurring', is_recurring: 'is_recurring',
      amountPaid: 'amount_paid', amount_paid: 'amount_paid',
      tipAmount: 'tip_amount', tip_amount: 'tip_amount',
      lastServiceDate: 'last_service_date', last_service_date: 'last_service_date',
      nextServiceDate: 'next_service_date', next_service_date: 'next_service_date',
      jobDescription: 'job_description', job_description: 'job_description',
      tags: 'tags', employee: 'employee',
      existingJob: 'existing_job', existing_job: 'existing_job',
      routeConfirmed: 'route_confirmed', route_confirmed: 'route_confirmed',
      verificationData: 'verification_data', verification_data: 'verification_data',
      notesHistory: 'notes_history', notes_history: 'notes_history',
      source: 'source',
      customerType: 'customer_type', customer_type: 'customer_type',
      anytime_access: 'anytime_access', anytimeAccess: 'anytime_access',
      flexible: 'flexible',
      preferred_contact_method: 'preferred_contact_method', preferredContactMethod: 'preferred_contact_method',
      cancellation_count: 'cancellation_count'
    };

    if (updates.status === 'unscheduled' || updates.status === 'scheduled') {
      const jobCheck = await pool.query(
        `SELECT COUNT(*) FROM jobs WHERE customer_id = $1 AND status NOT IN ('completed', 'cancelled')`,
        [req.params.id]
      );
      if (parseInt(jobCheck.rows[0].count) === 0) {
        updates.status = null;
      }
    }

    for (const [key, value] of Object.entries(updates)) {
      const dbField = fieldMap[key];
      if (dbField) {
        let processedValue = value;
        if (dbField === 'status') processedValue = (value || '').toLowerCase() || null;
        if (['preferred_date', 'preferred_time_window', 'scheduled_date', 'scheduled_time', 'last_service_date', 'next_service_date'].includes(dbField)) processedValue = value || null;
        if (dbField === 'notes_history') processedValue = JSON.stringify(value);
        if (dbField === 'verification_data' && typeof value === 'object') processedValue = JSON.stringify(value);
        setClauses.push(`${dbField} = $${paramIndex}`);
        params.push(processedValue);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE customers SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating customer:', err);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM customers WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ deleted: true, customer: result.rows[0] });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

router.post('/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const headers = { 'User-Agent': 'SolarCRM/1.0' };

    const expandAbbreviations = (addr) => {
      return addr
        .replace(/\bFm\b/gi, 'Farm to Market Road')
        .replace(/\bCr\b/gi, 'County Road')
        .replace(/\bHwy\b/gi, 'Highway')
        .replace(/\bRr\b/gi, 'Ranch Road');
    };

    const tryGeocode = async (query) => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=us&addressdetails=1`;
      const response = await fetch(url, { headers });
      return response.json();
    };

    let data = await tryGeocode(address);

    if (data.length === 0) {
      const expanded = expandAbbreviations(address);
      if (expanded !== address) {
        data = await tryGeocode(expanded);
      }
    }

    if (data.length === 0) {
      const parts = address.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        const cityStateZip = parts.slice(1).join(', ');
        data = await tryGeocode(cityStateZip);
        if (data.length > 0) {
          const result = data[0];
          const addr = result.address || {};
          return res.json({
            success: true,
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon),
            display_name: result.display_name,
            city: addr.city || addr.town || addr.village || addr.hamlet || '',
            state: addr.state || '',
            zip: addr.postcode || '',
            street: '',
            approximate: true
          });
        }
      }
    }

    if (data.length === 0) {
      return res.json({ success: false, error: 'Address not found' });
    }

    const result = data[0];
    const addr = result.address || {};
    res.json({
      success: true,
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      display_name: result.display_name,
      city: addr.city || addr.town || addr.village || addr.hamlet || '',
      state: addr.state || '',
      zip: addr.postcode || '',
      street: [addr.house_number, addr.road].filter(Boolean).join(' ')
    });
  } catch (err) {
    console.error('Geocoding error:', err);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const allCustomers = await pool.query('SELECT id, full_name, status, is_recurring, existing_job, scheduled_date FROM customers');
    const allJobs = await pool.query('SELECT id, customer_id, status, scheduled_date FROM jobs');

    const jobsByCustomer = {};
    for (const job of allJobs.rows) {
      if (!jobsByCustomer[job.customer_id]) jobsByCustomer[job.customer_id] = [];
      jobsByCustomer[job.customer_id].push(job);
    }

    let fixed = 0;
    const fixes = [];

    for (const c of allCustomers.rows) {
      const jobs = jobsByCustomer[c.id] || [];
      const hasJobs = jobs.length > 0;
      const hasScheduledJob = jobs.some(j => j.status === 'scheduled' && j.scheduled_date);
      const hasCompletedJob = jobs.some(j => j.status === 'completed');
      const allCompleted = hasJobs && jobs.every(j => j.status === 'completed' || j.status === 'cancelled');

      let correctStatus = c.status;
      let correctExistingJob = c.existing_job;

      if (!c.status || c.status.trim() === '') {
        if (hasScheduledJob) {
          correctStatus = 'scheduled';
        } else if (hasJobs && !allCompleted) {
          correctStatus = 'unscheduled';
        } else {
          correctStatus = 'none';
        }
      }

      if (hasJobs && !c.existing_job) {
        correctExistingJob = true;
      }

      if (correctStatus !== c.status || correctExistingJob !== c.existing_job) {
        await pool.query(
          'UPDATE customers SET status = $1, existing_job = $2, updated_at = NOW() WHERE id = $3',
          [correctStatus, correctExistingJob, c.id]
        );
        fixed++;
        fixes.push({ id: c.id, name: c.full_name, oldStatus: c.status, newStatus: correctStatus, oldExistingJob: c.existing_job, newExistingJob: correctExistingJob });
      }
    }

    res.json({ success: true, totalCustomers: allCustomers.rows.length, totalJobs: allJobs.rows.length, fixed, fixes });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

module.exports = router;
