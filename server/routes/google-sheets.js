const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// Shared secret check helper
function checkSecret(req, res) {
  const expectedSecret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = req.headers['x-webhook-secret'];
    if (provided !== expectedSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
  }
  return true;
}

// POST /api/google-sheets/intake
// Original customer intake form — creates customer only (no job).
router.post('/intake', async (req, res) => {
  if (!checkSecret(req, res)) return;

  try {
    const c = req.body;

    const firstName = (c.first_name || '').trim();
    const lastName  = (c.last_name  || '').trim();
    const fullName  = (c.full_name  || `${firstName} ${lastName}`).trim();
    const address   = (c.address    || '').trim();

    if (!fullName || !address) {
      return res.status(400).json({ error: 'Name and address are required' });
    }

    const dupCheck = await pool.query(
      'SELECT id, full_name FROM customers WHERE LOWER(address) = LOWER($1)',
      [address]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(200).json({
        status: 'duplicate',
        message: `Address already on file for: ${dupCheck.rows[0].full_name}`,
        existing_id: dupCheck.rows[0].id
      });
    }

    const result = await pool.query(`
      INSERT INTO customers (
        first_name, last_name, full_name, address,
        phone, email, status, notes, panel_count,
        amount_paid, job_description, source, customer_type,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        NOW(), NOW()
      ) RETURNING id, full_name
    `, [
      firstName,
      lastName,
      fullName,
      address,
      c.phone           || '',
      c.email           || '',
      'unscheduled',
      c.notes           || '',
      parseInt(c.panel_count)   || 0,
      parseFloat(c.amount_paid) || 0,
      c.job_description || '',
      'google_form',
      c.customer_type   || 'residential'
    ]);

    console.log(`[Google Sheets] New customer created: ${fullName} (id ${result.rows[0].id})`);
    res.status(201).json({ status: 'created', customer: result.rows[0] });
  } catch (err) {
    console.error('[Google Sheets] intake error:', err);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/google-sheets/partner-doherty
//
// Doherty Services partner form — only needs address + panel_count.
// Automatically:
//   • Creates a new customer named "Doherty Services #N" (auto-incremented).
//   • Creates a $0 unscheduled job for that customer.
//
// Google Apps Script snippet for this form:
// ─────────────────────────────────────────────────────────────────────────
// function onDohertyFormSubmit(e) {
//   var row = e.namedValues;
//   var payload = {
//     address:     (row['Address'] || [''])[0].trim(),
//     panel_count: parseInt((row['Number of Panels'] || ['0'])[0]) || 0
//   };
//   var options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(payload),
//     headers: { 'x-webhook-secret': 'YOUR_SECRET_HERE' },
//     muteHttpExceptions: true
//   };
//   UrlFetchApp.fetch('https://YOUR_APP_URL/api/google-sheets/partner-doherty', options);
// }
// ─────────────────────────────────────────────────────────────────────────
router.post('/partner-doherty', async (req, res) => {
  if (!checkSecret(req, res)) return;

  try {
    const address    = (req.body.address    || '').trim();
    const panelCount = parseInt(req.body.panel_count) || 0;

    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    // Determine next Doherty Services number
    const numResult = await pool.query(`
      SELECT COALESCE(
        MAX(CAST(REGEXP_REPLACE(full_name, '^Doherty Services #', '') AS INTEGER)),
        0
      ) + 1 AS next_num
      FROM customers
      WHERE full_name ~ '^Doherty Services #[0-9]+'
    `);
    const nextNum  = numResult.rows[0].next_num;
    const fullName = `Doherty Services #${nextNum}`;

    // Create the customer
    const custResult = await pool.query(`
      INSERT INTO customers (
        full_name, address, panel_count,
        status, existing_job, source, customer_type,
        solar_verified, created_at, updated_at
      ) VALUES (
        $1, $2, $3,
        'unscheduled', true, 'partner_doherty', 'commercial',
        'yes', NOW(), NOW()
      ) RETURNING id, full_name
    `, [fullName, address, panelCount]);

    const customer = custResult.rows[0];

    // Create the unscheduled $0 job
    const jobResult = await pool.query(`
      INSERT INTO jobs (
        customer_id, job_description, status,
        price, panel_count, notes,
        created_at
      ) VALUES (
        $1, 'Solar Panel Cleaning', NULL,
        0, $2, 'Doherty Services referral',
        NOW()
      ) RETURNING id
    `, [customer.id, panelCount]);

    console.log(`[Doherty] Created customer "${fullName}" (id ${customer.id}), job id ${jobResult.rows[0].id}`);

    res.status(201).json({
      status:   'created',
      customer: customer,
      job_id:   jobResult.rows[0].id
    });
  } catch (err) {
    console.error('[Doherty] partner-doherty error:', err);
    res.status(500).json({ error: 'Failed to create Doherty job' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/google-sheets/partner-new-customer
//
// Generic partner form — creates a brand-new customer AND a new unscheduled job.
// Fields accepted: full_name (or first_name + last_name), address, phone, email,
//                  panel_count, job_description, notes, customer_type, source
//
// Google Apps Script snippet for this form:
// ─────────────────────────────────────────────────────────────────────────
// function onPartnerFormSubmit(e) {
//   var row = e.namedValues;
//   var payload = {
//     full_name:       (row['Customer Full Name'] || [''])[0].trim(),
//     address:         (row['Address']            || [''])[0].trim(),
//     phone:           (row['Phone']              || [''])[0].trim(),
//     email:           (row['Email']              || [''])[0].trim(),
//     panel_count:     parseInt((row['Number of Panels'] || ['0'])[0]) || 0,
//     job_description: (row['Job Details']        || [''])[0].trim(),
//     notes:           (row['Notes']              || [''])[0].trim()
//   };
//   var options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(payload),
//     headers: { 'x-webhook-secret': 'YOUR_SECRET_HERE' },
//     muteHttpExceptions: true
//   };
//   UrlFetchApp.fetch('https://YOUR_APP_URL/api/google-sheets/partner-new-customer', options);
// }
// ─────────────────────────────────────────────────────────────────────────
router.post('/partner-new-customer', async (req, res) => {
  if (!checkSecret(req, res)) return;

  try {
    const c = req.body;

    const firstName = (c.first_name || '').trim();
    const lastName  = (c.last_name  || '').trim();
    const fullName  = (c.full_name  || `${firstName} ${lastName}`).trim();
    const address   = (c.address    || '').trim();

    if (!fullName || !address) {
      return res.status(400).json({ error: 'Customer name and address are required' });
    }

    // Duplicate-address guard
    const dupCheck = await pool.query(
      'SELECT id, full_name FROM customers WHERE LOWER(address) = LOWER($1)',
      [address]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(200).json({
        status:      'duplicate',
        message:     `Address already on file for: ${dupCheck.rows[0].full_name}`,
        existing_id: dupCheck.rows[0].id
      });
    }

    const panelCount = parseInt(c.panel_count) || 0;

    // Create the customer
    const custResult = await pool.query(`
      INSERT INTO customers (
        first_name, last_name, full_name, address,
        phone, email, panel_count,
        job_description, notes,
        status, existing_job, source, customer_type,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9,
        'unscheduled', true, $10, $11,
        NOW(), NOW()
      ) RETURNING id, full_name
    `, [
      firstName,
      lastName,
      fullName,
      address,
      c.phone           || '',
      c.email           || '',
      panelCount,
      c.job_description || 'Solar Panel Cleaning',
      c.notes           || '',
      c.source          || 'partner_form',
      c.customer_type   || 'residential'
    ]);

    const customer = custResult.rows[0];

    // Create the unscheduled job
    const jobResult = await pool.query(`
      INSERT INTO jobs (
        customer_id, job_description, status,
        price, panel_count, notes,
        created_at
      ) VALUES (
        $1, $2, NULL,
        0, $3, $4,
        NOW()
      ) RETURNING id
    `, [
      customer.id,
      c.job_description || 'Solar Panel Cleaning',
      panelCount,
      c.notes           || ''
    ]);

    console.log(`[Partner] New customer "${fullName}" (id ${customer.id}), job id ${jobResult.rows[0].id}`);

    res.status(201).json({
      status:   'created',
      customer: customer,
      job_id:   jobResult.rows[0].id
    });
  } catch (err) {
    console.error('[Partner] partner-new-customer error:', err);
    res.status(500).json({ error: 'Failed to create partner customer' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/google-sheets/import-sheet
//
// One-time bulk import of existing Google Sheet rows.
// Each row maps to your sheet columns:
//   Timestamp | First Name | Last Name | Address | Primary Phone Number |
//   Primary Contact Email Address | Type of Service | Number of Panels |
//   Total Cost | Job Notes
//
// Creates a customer + unscheduled job for each row.
// Skips rows where the address already exists in the database.
//
// ── Google Apps Script (run once to import all existing data) ────────────
// function importAllRowsToCRM() {
//   var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
//   var data  = sheet.getDataRange().getValues();
//   var headers = data[0].map(function(h) { return h.toString().trim(); });
//
//   var rows = [];
//   for (var i = 1; i < data.length; i++) {
//     if (!data[i][0]) continue; // skip blank rows
//     var row = {};
//     for (var j = 0; j < headers.length; j++) {
//       row[headers[j]] = data[i][j] ? data[i][j].toString().trim() : '';
//     }
//     rows.push(row);
//   }
//
//   var options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify({ rows: rows }),
//     headers: { 'x-webhook-secret': 'YOUR_SECRET_HERE' },
//     muteHttpExceptions: true
//   };
//   var response = UrlFetchApp.fetch(
//     'https://YOUR_APP_URL/api/google-sheets/import-sheet', options
//   );
//   Logger.log(response.getContentText());
// }
//
// ── Google Apps Script (ongoing — triggers on every new form submission) ──
// function onIntakeFormSubmit(e) {
//   var row = e.namedValues;
//   var get = function(key) {
//     return (row[key] || [''])[0].toString().trim();
//   };
//   var payload = {
//     first_name:      get('First Name'),
//     last_name:       get('Last Name'),
//     address:         get('Address'),
//     phone:           get('Primary Phone Number'),
//     email:           get('Primary Contact Email Address'),
//     job_description: get('Type of Service'),
//     panel_count:     parseInt(get('Number of Panels')) || 0,
//     total_cost:      parseFloat(get('Total Cost'))     || 0,
//     notes:           get('Job Notes')
//   };
//   var options = {
//     method: 'post',
//     contentType: 'application/json',
//     payload: JSON.stringify(payload),
//     headers: { 'x-webhook-secret': 'YOUR_SECRET_HERE' },
//     muteHttpExceptions: true
//   };
//   UrlFetchApp.fetch(
//     'https://YOUR_APP_URL/api/google-sheets/intake-with-job', options
//   );
// }
// ─────────────────────────────────────────────────────────────────────────
router.post('/import-sheet', async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array is required' });
  }

  // Flexible column name lookup — handles variations like
  // "Primary Phone Number" vs "Primary Phone" etc.
  function col(row, ...keys) {
    for (const k of keys) {
      // exact match
      if (row[k] !== undefined && row[k] !== '') return row[k].toString().trim();
      // case-insensitive match
      const found = Object.keys(row).find(
        rk => rk.trim().toLowerCase() === k.toLowerCase()
      );
      if (found && row[found] !== '') return row[found].toString().trim();
    }
    return '';
  }

  const client = await pool.connect();
  let imported = 0;
  let skipped  = 0;
  const errors = [];

  try {
    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const firstName = col(row, 'First Name', 'first_name', 'firstname');
      const lastName  = col(row, 'Last Name',  'last_name',  'lastname');
      const fullName  = `${firstName} ${lastName}`.trim();
      const address   = col(row, 'Address', 'address');

      if (!address) {
        skipped++;
        continue;
      }

      // Skip duplicates by address
      const dup = await client.query(
        'SELECT id FROM customers WHERE LOWER(address) = LOWER($1)',
        [address]
      );
      if (dup.rows.length > 0) {
        skipped++;
        continue;
      }

      const phone       = col(row, 'Primary Phone Number', 'Primary Phone', 'Phone', 'phone');
      const email       = col(row, 'Primary Contact Email Address', 'Primary Contact Email', 'Email', 'email');
      const serviceType = col(row, 'Type of Service', 'Service Type', 'Service', 'job_description');
      const panelCount  = parseInt(col(row, 'Number of Panels', 'Panels', 'panel_count')) || 0;
      const totalCost   = parseFloat(col(row, 'Total Cost', 'Cost', 'Price', 'total_cost')) || 0;
      const notes       = col(row, 'Job Notes', 'Notes', 'notes');

      try {
        const custResult = await client.query(`
          INSERT INTO customers (
            first_name, last_name, full_name, address,
            phone, email, panel_count,
            job_description, notes,
            status, existing_job, source, customer_type,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9,
            'unscheduled', true, 'google_sheet_import', 'residential',
            NOW(), NOW()
          ) RETURNING id
        `, [
          firstName, lastName, fullName || address,
          address, phone, email, panelCount,
          serviceType || 'Solar Panel Cleaning', notes
        ]);

        const customerId = custResult.rows[0].id;

        await client.query(`
          INSERT INTO jobs (
            customer_id, job_description, status,
            price, panel_count, notes,
            created_at
          ) VALUES (
            $1, $2, NULL,
            $3, $4, $5,
            NOW()
          )
        `, [
          customerId,
          serviceType || 'Solar Panel Cleaning',
          totalCost, panelCount, notes
        ]);

        imported++;
      } catch (rowErr) {
        errors.push({ row: i + 2, address, error: rowErr.message });
      }
    }

    await client.query('COMMIT');
    console.log(`[Sheet Import] imported=${imported} skipped=${skipped} errors=${errors.length}`);
    res.status(200).json({ imported, skipped, errors });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Sheet Import] fatal error:', err);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /api/google-sheets/intake-with-job
//
// Used by the ongoing form-submit trigger (onIntakeFormSubmit above).
// Creates a new customer AND a new unscheduled job in one call.
router.post('/intake-with-job', async (req, res) => {
  if (!checkSecret(req, res)) return;

  try {
    const c = req.body;

    const firstName = (c.first_name || '').trim();
    const lastName  = (c.last_name  || '').trim();
    const fullName  = (c.full_name  || `${firstName} ${lastName}`).trim();
    const address   = (c.address    || '').trim();

    if (!fullName || !address) {
      return res.status(400).json({ error: 'Name and address are required' });
    }

    const dupCheck = await pool.query(
      'SELECT id, full_name FROM customers WHERE LOWER(address) = LOWER($1)',
      [address]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(200).json({
        status:      'duplicate',
        message:     `Address already on file for: ${dupCheck.rows[0].full_name}`,
        existing_id: dupCheck.rows[0].id
      });
    }

    const panelCount  = parseInt(c.panel_count)  || 0;
    const totalCost   = parseFloat(c.total_cost) || 0;
    const jobDesc     = (c.job_description || 'Solar Panel Cleaning').trim();

    const custResult = await pool.query(`
      INSERT INTO customers (
        first_name, last_name, full_name, address,
        phone, email, panel_count,
        job_description, notes,
        status, existing_job, source, customer_type,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9,
        'unscheduled', true, 'google_form', 'residential',
        NOW(), NOW()
      ) RETURNING id, full_name
    `, [
      firstName, lastName, fullName, address,
      c.phone || '', c.email || '', panelCount,
      jobDesc, c.notes || ''
    ]);

    const customerId = custResult.rows[0].id;

    const jobResult = await pool.query(`
      INSERT INTO jobs (
        customer_id, job_description, status,
        price, panel_count, notes,
        created_at
      ) VALUES (
        $1, $2, NULL,
        $3, $4, $5,
        NOW()
      ) RETURNING id
    `, [customerId, jobDesc, totalCost, panelCount, c.notes || '']);

    console.log(`[Intake] New customer "${fullName}" (id ${customerId}), job id ${jobResult.rows[0].id}`);
    res.status(201).json({
      status:   'created',
      customer: custResult.rows[0],
      job_id:   jobResult.rows[0].id
    });
  } catch (err) {
    console.error('[Intake] intake-with-job error:', err);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

module.exports = router;
