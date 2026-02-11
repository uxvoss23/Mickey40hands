const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sl.*, COUNT(sli.id) as customer_count
      FROM saved_lists sl
      LEFT JOIN saved_list_items sli ON sl.id = sli.list_id
      GROUP BY sl.id
      ORDER BY sl.created_at DESC
    `);
    res.json({ lists: result.rows });
  } catch (err) {
    console.error('Error fetching lists:', err);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

router.get('/:id/customers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.* FROM customers c
      JOIN saved_list_items sli ON c.id = sli.customer_id
      WHERE sli.list_id = $1
      ORDER BY c.full_name ASC
    `, [req.params.id]);
    res.json({ customers: result.rows });
  } catch (err) {
    console.error('Error fetching list customers:', err);
    res.status(500).json({ error: 'Failed to fetch list customers' });
  }
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { name, type, customer_ids } = req.body;

    const listResult = await client.query(
      `INSERT INTO saved_lists (name, type) VALUES ($1, $2) RETURNING *`,
      [name || '', type || 'list']
    );
    const list = listResult.rows[0];

    if (customer_ids && Array.isArray(customer_ids)) {
      for (const customerId of customer_ids) {
        await client.query(
          `INSERT INTO saved_list_items (list_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [list.id, customerId]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(list);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating list:', err);
    res.status(500).json({ error: 'Failed to create list' });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM saved_lists WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'List not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Error deleting list:', err);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

module.exports = router;
