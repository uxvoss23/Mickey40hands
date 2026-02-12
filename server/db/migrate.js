const pool = require('./pool');

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(255) DEFAULT '',
        last_name VARCHAR(255) DEFAULT '',
        full_name VARCHAR(500) DEFAULT '',
        address TEXT DEFAULT '',
        street VARCHAR(500) DEFAULT '',
        city VARCHAR(255) DEFAULT '',
        state VARCHAR(50) DEFAULT '',
        zip VARCHAR(20) DEFAULT '',
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        phone VARCHAR(50) DEFAULT '',
        email VARCHAR(255) DEFAULT '',
        secondary_phones TEXT[] DEFAULT '{}',
        secondary_emails TEXT[] DEFAULT '{}',
        status VARCHAR(50) DEFAULT '',
        notes TEXT DEFAULT '',
        customer_notes TEXT DEFAULT '',
        panel_count INTEGER DEFAULT 0,
        total_panels INTEGER DEFAULT 0,
        pricing_tier VARCHAR(50) DEFAULT 'standard',
        preferred_date VARCHAR(255) DEFAULT '',
        preferred_time_window VARCHAR(255) DEFAULT '',
        scheduled_date VARCHAR(255) DEFAULT '',
        scheduled_time VARCHAR(255) DEFAULT '',
        solar_verified VARCHAR(10) DEFAULT NULL,
        is_recurring BOOLEAN DEFAULT FALSE,
        amount_paid NUMERIC(10,2) DEFAULT 0,
        tip_amount NUMERIC(10,2) DEFAULT 0,
        last_service_date VARCHAR(255) DEFAULT '',
        next_service_date VARCHAR(255) DEFAULT '',
        job_description TEXT DEFAULT '',
        tags TEXT DEFAULT '',
        employee VARCHAR(255) DEFAULT '',
        existing_job BOOLEAN DEFAULT FALSE,
        route_confirmed BOOLEAN DEFAULT FALSE,
        verification_data JSONB DEFAULT NULL,
        notes_history JSONB DEFAULT '[]',
        source VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        job_description TEXT DEFAULT '',
        status VARCHAR(50) DEFAULT '',
        scheduled_date VARCHAR(255) DEFAULT '',
        scheduled_time VARCHAR(255) DEFAULT '',
        completed_date VARCHAR(255) DEFAULT '',
        amount NUMERIC(10,2) DEFAULT 0,
        tip NUMERIC(10,2) DEFAULT 0,
        notes TEXT DEFAULT '',
        is_recurring BOOLEAN DEFAULT FALSE,
        employee VARCHAR(255) DEFAULT '',
        panel_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS routes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(500) DEFAULT '',
        scheduled_date VARCHAR(255) DEFAULT '',
        status VARCHAR(50) DEFAULT 'planned',
        total_distance NUMERIC(10,2) DEFAULT 0,
        sent_to_tech BOOLEAN DEFAULT FALSE,
        sent_date VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS route_stops (
        id SERIAL PRIMARY KEY,
        route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        stop_order INTEGER DEFAULT 0,
        scheduled_time VARCHAR(255) DEFAULT '',
        notes TEXT DEFAULT '',
        route_confirmed BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS saved_lists (
        id SERIAL PRIMARY KEY,
        name VARCHAR(500) DEFAULT '',
        type VARCHAR(50) DEFAULT 'list',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS saved_list_items (
        id SERIAL PRIMARY KEY,
        list_id INTEGER REFERENCES saved_lists(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        UNIQUE(list_id, customer_id)
      );

      CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
      CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(city);
      CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(state);
      CREATE INDEX IF NOT EXISTS idx_customers_zip ON customers(zip);
      CREATE INDEX IF NOT EXISTS idx_customers_full_name ON customers(full_name);
      CREATE INDEX IF NOT EXISTS idx_customers_lat_lng ON customers(lat, lng);
      CREATE INDEX IF NOT EXISTS idx_customers_last_service ON customers(last_service_date);
      CREATE INDEX IF NOT EXISTS idx_customers_panel_count ON customers(panel_count);
      CREATE INDEX IF NOT EXISTS idx_customers_is_recurring ON customers(is_recurring);
      CREATE INDEX IF NOT EXISTS idx_customers_solar_verified ON customers(solar_verified);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS price_per_panel NUMERIC(10,2) DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preferred_days VARCHAR(255) DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preferred_time VARCHAR(50) DEFAULT '';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS technician VARCHAR(255) DEFAULT '';

      CREATE INDEX IF NOT EXISTS idx_jobs_customer_id ON jobs(customer_id);
      CREATE INDEX IF NOT EXISTS idx_route_stops_route_id ON route_stops(route_id);
      CREATE INDEX IF NOT EXISTS idx_route_stops_customer_id ON route_stops(customer_id);
      CREATE INDEX IF NOT EXISTS idx_saved_list_items_list_id ON saved_list_items(list_id);
    `);

    await client.query('COMMIT');
    console.log('Database migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = migrate;
