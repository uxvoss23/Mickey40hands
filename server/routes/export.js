const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/csv', async (req, res) => {
  try {
    const { status, city, state, zip } = req.query;

    let query = 'SELECT * FROM customers WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      query += ` AND LOWER(status) = $${paramIndex}`;
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

    query += ' ORDER BY full_name ASC';
    const result = await pool.query(query, params);

    const headers = [
      'Customer Name', 'Job Status', 'Job Description', 'Address', 'Street',
      'City', 'State', 'Zipcode', 'Email', 'Phone', 'Latitude', 'Longitude',
      'Number of Panels', 'Amount Paid', 'Tip', 'Recurring', 'Last Service Date',
      'Next Service Date', 'Notes', 'Solar Verified', 'Employee', 'Tags'
    ];

    const rows = result.rows.map(c => [
      c.full_name, c.status, c.job_description, c.address, c.street,
      c.city, c.state, c.zip, c.email, c.phone, c.lat, c.lng,
      c.panel_count, c.amount_paid, c.tip_amount, c.is_recurring ? 'TRUE' : 'FALSE',
      c.last_service_date, c.next_service_date, c.notes, c.solar_verified || '',
      c.employee, c.tags
    ]);

    const escapeCsv = (val) => {
      const str = String(val === null || val === undefined ? '' : val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csv = [headers.map(escapeCsv).join(',')]
      .concat(rows.map(row => row.map(escapeCsv).join(',')))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="customers_export_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Error exporting CSV:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

router.get('/json', async (req, res) => {
  try {
    const customers = await pool.query('SELECT * FROM customers ORDER BY full_name ASC');
    const jobs = await pool.query(`
      SELECT j.*, c.full_name as customer_name 
      FROM jobs j LEFT JOIN customers c ON j.customer_id = c.id 
      ORDER BY j.created_at DESC
    `);

    res.json({
      exported_at: new Date().toISOString(),
      customers: customers.rows,
      jobs: jobs.rows
    });
  } catch (err) {
    console.error('Error exporting JSON:', err);
    res.status(500).json({ error: 'Failed to export' });
  }
});

module.exports = router;
