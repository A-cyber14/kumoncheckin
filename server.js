require('dotenv').config();
const express      = require('express');
const { Pool }     = require('pg');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer   = require('nodemailer');
const path         = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Database ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5,
});

// ─── Email ─────────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
});

// ─── Auth Middleware ───────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.center = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ error: 'Session expired' });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function getLimits(centerId) {
  const { rows } = await pool.query(
    'SELECT math_limit_min, reading_limit_min, both_limit_min FROM settings WHERE center_id = $1',
    [centerId]
  );
  return rows[0] || { math_limit_min: 35, reading_limit_min: 35, both_limit_min: 70 };
}

function subjectLimit(limits, subject) {
  return subject === 'Math'    ? limits.math_limit_min
    :    subject === 'Reading' ? limits.reading_limit_min
    :    limits.both_limit_min;
}

async function sendAlert({ name: centerName, alert_emails }, studentName, subject, elapsedMin, limitMin) {
  if (!alert_emails?.length || !process.env.GMAIL_USER) return;
  try {
    await transporter.sendMail({
      from:    `"Kumon Check-In" <${process.env.GMAIL_USER}>`,
      to:      alert_emails.join(', '),
      subject: `⚠️ ${centerName}: ${studentName} over ${limitMin} min`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f0f4ff;border-radius:12px;">
          <h2 style="color:#1a3c8f;margin-bottom:8px;">⚠️ Kumon Time Alert</h2>
          <p style="font-size:1.1rem;color:#1e293b;">
            <strong>${studentName}</strong> has been at <strong>${centerName}</strong> for
            <strong style="color:#dc2626;">${Math.floor(elapsedMin)} minutes</strong>.
          </p>
          <p style="color:#1e293b;margin-top:8px;">
            Subject: <strong>${subject}</strong> &nbsp;|&nbsp; Limit: <strong>${limitMin} min</strong>
          </p>
          <p style="color:#64748b;margin-top:16px;">Please check on them.</p>
        </div>`,
    });
    console.log(`[ALERT] Sent for ${studentName} — ${subject} (${Math.floor(elapsedMin)}/${limitMin} min)`);
  } catch (e) { console.error('[ALERT] Failed:', e.message); }
}

// ─── AUTH ROUTES ───────────────────────────────────────────────────────────────

app.post('/api/auth/signup', async (req, res) => {
  const { centerName, ownerName, email, password } = req.body;
  if (!centerName || !ownerName || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO centers (name, owner_name, email, password_hash, alert_emails)
       VALUES ($1, $2, $3, $4, ARRAY[$3::TEXT]) RETURNING id, name, email`,
      [centerName.trim(), ownerName.trim(), email.toLowerCase().trim(), hash]
    );
    const center = rows[0];
    await pool.query('INSERT INTO settings (center_id) VALUES ($1)', [center.id]);

    const token = jwt.sign(
      { id: center.id, email: center.email, name: center.name },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 86400000, sameSite: 'lax' });
    res.json({ success: true, center });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    console.error('[SIGNUP]', err);
    res.status(500).json({ error: 'Signup failed — please try again' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM centers WHERE email = $1', [email.toLowerCase().trim()]
    );
    if (!rows.length || !await bcrypt.compare(password, rows[0].password_hash))
      return res.status(401).json({ error: 'Invalid email or password' });

    const center = rows[0];
    const token = jwt.sign(
      { id: center.id, email: center.email, name: center.name },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.cookie('token', token, { httpOnly: true, maxAge: 30 * 86400000, sameSite: 'lax' });
    res.json({ success: true, center: { id: center.id, name: center.name } });
  } catch (err) {
    console.error('[LOGIN]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, owner_name, email, alert_emails FROM centers WHERE id = $1',
    [req.center.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Center not found' });
  res.json(rows[0]);
});

// ─── KIOSK ROUTES (public — uses center ID from URL) ──────────────────────────

app.get('/api/kiosk/:centerId/students', async (req, res) => {
  const { centerId } = req.params;
  try {
    const limits = await getLimits(centerId);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.default_subject,
              ac.id        AS checkin_id,
              ac.subject   AS subject,
              ac.check_in_time,
              ac.alerted
       FROM students s
       LEFT JOIN active_checkins ac ON s.id = ac.student_id
       WHERE s.center_id = $1
       ORDER BY s.name`,
      [centerId]
    );

    const now = Date.now();
    const students = rows.map(s => {
      const checkInTime = s.check_in_time ? new Date(s.check_in_time).getTime() : null;
      const elapsedMs   = checkInTime ? now - checkInTime : null;
      const limitMin    = s.subject ? subjectLimit(limits, s.subject) : null;
      return {
        id: s.id, name: s.name, defaultSubject: s.default_subject,
        checkedIn: !!s.checkin_id, checkInTime, subject: s.subject,
        limitMs: limitMin ? limitMin * 60000 : null, elapsedMs,
      };
    });

    // Fire over-time alerts inline — no cron needed, triggers on every kiosk poll
    const needAlert = rows.filter(r =>
      r.checkin_id && !r.alerted &&
      (now - new Date(r.check_in_time).getTime()) > subjectLimit(limits, r.subject) * 60000
    );
    if (needAlert.length) {
      pool.query('SELECT name, alert_emails FROM centers WHERE id = $1', [centerId])
        .then(({ rows: [ci] }) => {
          for (const r of needAlert) {
            const elapsed  = now - new Date(r.check_in_time).getTime();
            const limitMin = subjectLimit(limits, r.subject);
            sendAlert(ci, r.name, r.subject, elapsed / 60000, limitMin)
              .catch(e => console.error('[ALERT send]', e));
            pool.query('UPDATE active_checkins SET alerted = true WHERE student_id = $1', [r.id])
              .catch(e => console.error('[ALERT mark]', e));
          }
        }).catch(e => console.error('[ALERT center fetch]', e));
    }

    res.json({
      limits: { Math: limits.math_limit_min, Reading: limits.reading_limit_min, Both: limits.both_limit_min },
      students,
    });
  } catch (err) {
    console.error('[KIOSK/STUDENTS]', err);
    res.status(500).json({ error: 'Failed to load students' });
  }
});

app.post('/api/kiosk/:centerId/checkin/:studentId', async (req, res) => {
  const { centerId, studentId } = req.params;
  const { subject } = req.body;
  if (!['Math', 'Reading', 'Both'].includes(subject))
    return res.status(400).json({ error: 'Invalid subject' });

  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM active_checkins WHERE student_id = $1', [studentId]
    );
    if (existing.length) return res.status(400).json({ error: 'Already checked in' });

    await pool.query(
      'INSERT INTO active_checkins (student_id, center_id, subject) VALUES ($1, $2, $3)',
      [studentId, centerId, subject]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[CHECKIN]', err);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

app.post('/api/kiosk/:centerId/checkout/:studentId', async (req, res) => {
  const { centerId, studentId } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM active_checkins WHERE student_id = $1 AND center_id = $2',
      [studentId, centerId]
    );
    if (!rows.length) return res.status(400).json({ error: 'Not checked in' });
    const ac = rows[0];

    const checkOutTime = new Date();
    const elapsedMin   = Math.floor((checkOutTime - new Date(ac.check_in_time)) / 60000);
    const { rows: [student] } = await pool.query('SELECT name FROM students WHERE id = $1', [studentId]);

    await pool.query(
      `INSERT INTO sessions (student_id, center_id, student_name, subject, check_in_time, check_out_time, elapsed_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [studentId, centerId, student.name, ac.subject, ac.check_in_time, checkOutTime, elapsedMin]
    );
    await pool.query('DELETE FROM active_checkins WHERE student_id = $1', [studentId]);
    res.json({ success: true, elapsedMinutes: elapsedMin });
  } catch (err) {
    console.error('[CHECKOUT]', err);
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// ─── ADMIN ROUTES (auth required) ─────────────────────────────────────────────

app.get('/api/admin/students', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.default_subject, s.parent_email, s.created_at,
              ac.subject       AS current_subject,
              ac.check_in_time AS check_in_time,
              COUNT(DISTINCT ses.id)::int      AS total_sessions,
              ROUND(AVG(ses.elapsed_min))::int AS avg_min
       FROM students s
       LEFT JOIN active_checkins ac  ON s.id = ac.student_id
       LEFT JOIN sessions ses        ON s.id = ses.student_id
       WHERE s.center_id = $1
       GROUP BY s.id, ac.subject, ac.check_in_time
       ORDER BY s.name`,
      [req.center.id]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/students', requireAuth, async (req, res) => {
  const { name, defaultSubject, parentEmail } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO students (center_id, name, default_subject, parent_email)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.center.id, name.trim(), defaultSubject || null, parentEmail || null]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A student with that name already exists' });
    res.status(500).json({ error: 'Failed to add student' });
  }
});

app.put('/api/admin/students/:id', requireAuth, async (req, res) => {
  const { name, defaultSubject, parentEmail } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE students SET name=$1, default_subject=$2, parent_email=$3
       WHERE id=$4 AND center_id=$5 RETURNING *`,
      [name?.trim(), defaultSubject || null, parentEmail || null, req.params.id, req.center.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Student not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to update' }); }
});

app.delete('/api/admin/students/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM students WHERE id=$1 AND center_id=$2', [req.params.id, req.center.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete' }); }
});

// Force checkout from admin panel
app.post('/api/admin/students/:id/checkout', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM active_checkins WHERE student_id=$1 AND center_id=$2',
      [req.params.id, req.center.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Student is not checked in' });
    const ac = rows[0];
    const checkOutTime = new Date();
    const elapsedMin   = Math.floor((checkOutTime - new Date(ac.check_in_time)) / 60000);
    const { rows: [student] } = await pool.query('SELECT name FROM students WHERE id=$1', [req.params.id]);
    await pool.query(
      `INSERT INTO sessions (student_id, center_id, student_name, subject, check_in_time, check_out_time, elapsed_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, req.center.id, student.name, ac.subject, ac.check_in_time, checkOutTime, elapsedMin]
    );
    await pool.query('DELETE FROM active_checkins WHERE student_id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed' }); }
});

// Admin manual check-in
app.post('/api/admin/students/:id/checkin', requireAuth, async (req, res) => {
  const { subject } = req.body;
  if (!['Math', 'Reading', 'Both'].includes(subject))
    return res.status(400).json({ error: 'Invalid subject' });
  try {
    const { rows: [student] } = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND center_id = $2',
      [req.params.id, req.center.id]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { rows: existing } = await pool.query(
      'SELECT id FROM active_checkins WHERE student_id = $1', [req.params.id]
    );
    if (existing.length) return res.status(400).json({ error: 'Student is already checked in' });

    await pool.query(
      'INSERT INTO active_checkins (student_id, center_id, subject) VALUES ($1, $2, $3)',
      [req.params.id, req.center.id, subject]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[ADMIN CHECKIN]', err);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// End-of-day clear all check-ins
app.delete('/api/admin/checkins', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM active_checkins WHERE center_id=$1', [req.center.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/settings', requireAuth, async (req, res) => {
  try {
    const { rows: [settings] } = await pool.query('SELECT * FROM settings WHERE center_id=$1', [req.center.id]);
    const { rows: [center] }   = await pool.query(
      'SELECT name, owner_name, email, alert_emails FROM centers WHERE id=$1', [req.center.id]
    );
    res.json({ ...settings, ...center });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/admin/settings', requireAuth, async (req, res) => {
  const { mathLimit, readingLimit, bothLimit, alertEmails, centerName } = req.body;
  try {
    await pool.query(
      `UPDATE settings SET math_limit_min=$1, reading_limit_min=$2, both_limit_min=$3 WHERE center_id=$4`,
      [mathLimit || 35, readingLimit || 35, bothLimit || 70, req.center.id]
    );
    const updates = []; const params = []; let i = 1;
    if (centerName)  { updates.push(`name=$${i++}`);          params.push(centerName); }
    if (alertEmails) { updates.push(`alert_emails=$${i++}`);  params.push(alertEmails); }
    if (updates.length) {
      params.push(req.center.id);
      await pool.query(`UPDATE centers SET ${updates.join(',')} WHERE id=$${i}`, params);
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to save settings' }); }
});

app.get('/api/admin/sessions', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sessions WHERE center_id=$1 ORDER BY check_in_time DESC LIMIT 200`,
      [req.center.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/stats', requireAuth, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { rows: [stats] } = await pool.query(
      `SELECT
        COUNT(DISTINCT student_id) FILTER (WHERE check_in_time >= $2)::int AS students_today,
        COUNT(*)                   FILTER (WHERE check_in_time >= $2)::int AS sessions_today,
        ROUND(AVG(elapsed_min))::int AS avg_min,
        COUNT(*)::int                AS total_sessions
       FROM sessions WHERE center_id=$1`,
      [req.center.id, today]
    );
    const { rows: [act] } = await pool.query(
      'SELECT COUNT(*)::int AS active FROM active_checkins WHERE center_id=$1', [req.center.id]
    );
    const { rows: [sc] } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM students WHERE center_id=$1', [req.center.id]
    );
    res.json({
      studentsToday: stats.students_today || 0,
      sessionsToday: stats.sessions_today || 0,
      avgMin:        stats.avg_min        || 0,
      totalSessions: stats.total_sessions || 0,
      activeNow:     act.active           || 0,
      totalStudents: sc.total             || 0,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/admin/kiosk-url', requireAuth, (req, res) => {
  const base = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  res.json({ url: `${base}/?center=${req.center.id}`, centerId: req.center.id });
});

// ─── WEEKLY REPORT CRON (runs every Monday at 8 AM UTC via Vercel Cron) ───────
app.get('/api/cron/weekly-report', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  try {
    // Fetch all over-limit sessions from the past 7 days, grouped by center
    const { rows } = await pool.query(
      `SELECT
         s.center_id,
         c.name        AS center_name,
         c.alert_emails,
         s.student_name,
         s.subject,
         s.elapsed_min,
         s.check_in_time,
         CASE
           WHEN s.subject = 'Math'    THEN st.math_limit_min
           WHEN s.subject = 'Reading' THEN st.reading_limit_min
           ELSE st.both_limit_min
         END AS limit_min
       FROM sessions s
       JOIN centers  c  ON c.id = s.center_id
       JOIN settings st ON st.center_id = s.center_id
       WHERE s.check_in_time >= NOW() - INTERVAL '7 days'
         AND s.elapsed_min IS NOT NULL
         AND s.elapsed_min > CASE
           WHEN s.subject = 'Math'    THEN st.math_limit_min
           WHEN s.subject = 'Reading' THEN st.reading_limit_min
           ELSE st.both_limit_min
         END
       ORDER BY s.center_id, s.student_name, s.check_in_time`
    );

    // Group by center
    const byCenterMap = new Map();
    for (const row of rows) {
      if (!byCenterMap.has(row.center_id)) {
        byCenterMap.set(row.center_id, {
          centerName:  row.center_name,
          alertEmails: row.alert_emails,
          sessions:    [],
        });
      }
      byCenterMap.get(row.center_id).sessions.push(row);
    }

    let emailsSent = 0;
    for (const { centerName, alertEmails, sessions } of byCenterMap.values()) {
      if (!alertEmails?.length || !process.env.GMAIL_USER) continue;

      const tableRows = sessions.map(s => {
        const date    = new Date(s.check_in_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const overBy  = s.elapsed_min - s.limit_min;
        return `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${s.student_name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${s.subject}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${date}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${s.elapsed_min} min</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${s.limit_min} min</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#dc2626;font-weight:600;">+${overBy} min</td>
          </tr>`;
      }).join('');

      const weekEnd   = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      await transporter.sendMail({
        from:    `"Kumon Check-In" <${process.env.GMAIL_USER}>`,
        to:      alertEmails.join(', '),
        subject: `Weekly Report — ${centerName} (week ending ${weekEnd})`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:32px;background:#f0f4ff;border-radius:12px;">
            <h2 style="color:#1a3c8f;margin-bottom:4px;">Weekly Kumon Time Report</h2>
            <p style="color:#64748b;margin-top:0;margin-bottom:24px;">${centerName} &mdash; week ending ${weekEnd}</p>
            <p style="color:#1e293b;margin-bottom:16px;">
              The following students had <strong>at least one session over their time limit</strong> this week:
            </p>
            <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#1a3c8f;color:#fff;">
                  <th style="padding:10px 12px;text-align:left;">Student</th>
                  <th style="padding:10px 12px;text-align:left;">Subject</th>
                  <th style="padding:10px 12px;text-align:left;">Date</th>
                  <th style="padding:10px 12px;text-align:left;">Time Taken</th>
                  <th style="padding:10px 12px;text-align:left;">Limit</th>
                  <th style="padding:10px 12px;text-align:left;">Over By</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
            <p style="color:#64748b;margin-top:24px;font-size:0.85rem;">
              Sent automatically every Monday by Kumon Check-In.
            </p>
          </div>`,
      });
      emailsSent++;
    }

    res.json({ centersChecked: byCenterMap.size, emailsSent });
  } catch (err) { console.error('[WEEKLY-REPORT]', err); res.status(500).json({ error: 'Weekly report failed' }); }
});

// ─── MONTHLY REPORT CRON (runs 1st of each month at 8 AM UTC) ─────────────────
app.get('/api/cron/monthly-report', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  try {
    const now        = new Date();
    const monthEnd   = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const { rows: centers } = await pool.query(
      "SELECT id, name, alert_emails FROM centers WHERE array_length(alert_emails, 1) > 0"
    );

    let emailsSent = 0;
    for (const center of centers) {
      if (!center.alert_emails?.length || !process.env.GMAIL_USER) continue;

      const { rows: stats } = await pool.query(`
        SELECT
          s.student_name,
          COUNT(*)::int                                                                          AS total_sessions,
          COALESCE(SUM(s.elapsed_min), 0)::int                                                  AS total_min,
          ROUND(AVG(s.elapsed_min))::int                                                        AS avg_min,
          COALESCE(SUM(CASE WHEN s.subject='Math'    THEN s.elapsed_min ELSE 0 END),0)::int    AS math_min,
          COALESCE(SUM(CASE WHEN s.subject='Reading' THEN s.elapsed_min ELSE 0 END),0)::int    AS reading_min,
          COALESCE(SUM(CASE WHEN s.subject='Both'    THEN s.elapsed_min ELSE 0 END),0)::int    AS both_min,
          COUNT(CASE WHEN s.elapsed_min > CASE
            WHEN s.subject='Math'    THEN st.math_limit_min
            WHEN s.subject='Reading' THEN st.reading_limit_min
            ELSE st.both_limit_min END THEN 1 END)::int                                        AS over_limit
        FROM sessions s
        JOIN settings st ON st.center_id = s.center_id
        WHERE s.center_id=$1 AND s.check_in_time>=$2 AND s.check_in_time<$3
        GROUP BY s.student_name ORDER BY total_min DESC
      `, [center.id, monthStart, monthEnd]);

      if (!stats.length) continue;

      const totalSessions = stats.reduce((a, s) => a + s.total_sessions, 0);
      const totalMin      = stats.reduce((a, s) => a + s.total_min, 0);
      const totalHours    = Math.floor(totalMin / 60);
      const totalMinRem   = totalMin % 60;

      const studentRows = stats.map(s => {
        const overStyle = s.over_limit > 0 ? 'color:#dc2626;font-weight:700;' : 'color:#15803d;';
        return `<tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 12px;font-weight:700;">${s.student_name}</td>
          <td style="padding:8px 12px;text-align:center;">${s.total_sessions}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700;">${s.total_min} min</td>
          <td style="padding:8px 12px;text-align:center;">${s.avg_min ?? '—'} min</td>
          <td style="padding:8px 12px;text-align:center;">${s.math_min    > 0 ? s.math_min    + ' min' : '—'}</td>
          <td style="padding:8px 12px;text-align:center;">${s.reading_min > 0 ? s.reading_min + ' min' : '—'}</td>
          <td style="padding:8px 12px;text-align:center;">${s.both_min    > 0 ? s.both_min    + ' min' : '—'}</td>
          <td style="padding:8px 12px;text-align:center;${overStyle}">${s.over_limit > 0 ? s.over_limit : '✓'}</td>
        </tr>`;
      }).join('');

      await transporter.sendMail({
        from:    `"Kumon Check-In" <${process.env.GMAIL_USER}>`,
        to:      center.alert_emails.join(', '),
        subject: `Monthly Report — ${center.name} (${monthLabel})`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;padding:32px;background:#f0f4ff;border-radius:12px;">
            <h2 style="color:#1a3c8f;margin-bottom:4px;">📅 Monthly Kumon Time Report</h2>
            <p style="color:#64748b;margin-top:0;margin-bottom:20px;">${center.name} &mdash; ${monthLabel}</p>
            <div style="display:flex;gap:16px;margin-bottom:28px;flex-wrap:wrap;">
              <div style="background:white;border-radius:10px;padding:14px 22px;box-shadow:0 2px 8px rgba(0,0,0,0.06);min-width:110px;text-align:center;">
                <div style="font-size:2rem;font-weight:800;color:#1a3c8f;line-height:1;">${totalSessions}</div>
                <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Sessions</div>
              </div>
              <div style="background:white;border-radius:10px;padding:14px 22px;box-shadow:0 2px 8px rgba(0,0,0,0.06);min-width:110px;text-align:center;">
                <div style="font-size:2rem;font-weight:800;color:#1a3c8f;line-height:1;">${stats.length}</div>
                <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Students</div>
              </div>
              <div style="background:white;border-radius:10px;padding:14px 22px;box-shadow:0 2px 8px rgba(0,0,0,0.06);min-width:110px;text-align:center;">
                <div style="font-size:2rem;font-weight:800;color:#1a3c8f;line-height:1;">${totalHours}h ${totalMinRem}m</div>
                <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Total Time</div>
              </div>
            </div>
            <p style="font-weight:700;color:#1e293b;margin-bottom:12px;">Student Breakdown</p>
            <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#1a3c8f;color:#fff;">
                  <th style="padding:10px 12px;text-align:left;">Student</th>
                  <th style="padding:10px 12px;text-align:center;">Sessions</th>
                  <th style="padding:10px 12px;text-align:center;">Total Time</th>
                  <th style="padding:10px 12px;text-align:center;">Avg/Session</th>
                  <th style="padding:10px 12px;text-align:center;">Math</th>
                  <th style="padding:10px 12px;text-align:center;">Reading</th>
                  <th style="padding:10px 12px;text-align:center;">Both</th>
                  <th style="padding:10px 12px;text-align:center;">Over Limit</th>
                </tr>
              </thead>
              <tbody>${studentRows}</tbody>
            </table>
            <p style="color:#64748b;margin-top:24px;font-size:0.85rem;">Sent automatically on the 1st of each month by Kumon Check-In.</p>
          </div>`,
      });
      emailsSent++;
    }

    res.json({ centersChecked: centers.length, emailsSent });
  } catch (err) { console.error('[MONTHLY-REPORT]', err); res.status(500).json({ error: 'Monthly report failed' }); }
});

// ─── YEARLY REPORT CRON (runs Jan 1st at 8 AM UTC) ────────────────────────────
app.get('/api/cron/yearly-report', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });

  try {
    const now       = new Date();
    const yearEnd   = new Date(now.getFullYear(), 0, 1);
    const yearStart = new Date(now.getFullYear() - 1, 0, 1);
    const year      = now.getFullYear() - 1;

    const { rows: centers } = await pool.query(
      "SELECT id, name, alert_emails FROM centers WHERE array_length(alert_emails, 1) > 0"
    );

    let emailsSent = 0;
    for (const center of centers) {
      if (!center.alert_emails?.length || !process.env.GMAIL_USER) continue;

      const { rows: stats } = await pool.query(`
        SELECT
          s.student_name,
          COUNT(*)::int                                                                          AS total_sessions,
          COALESCE(SUM(s.elapsed_min), 0)::int                                                  AS total_min,
          ROUND(AVG(s.elapsed_min))::int                                                        AS avg_min,
          COALESCE(SUM(CASE WHEN s.subject='Math'    THEN s.elapsed_min ELSE 0 END),0)::int    AS math_min,
          COALESCE(SUM(CASE WHEN s.subject='Reading' THEN s.elapsed_min ELSE 0 END),0)::int    AS reading_min,
          COALESCE(SUM(CASE WHEN s.subject='Both'    THEN s.elapsed_min ELSE 0 END),0)::int    AS both_min,
          COUNT(CASE WHEN s.elapsed_min > CASE
            WHEN s.subject='Math'    THEN st.math_limit_min
            WHEN s.subject='Reading' THEN st.reading_limit_min
            ELSE st.both_limit_min END THEN 1 END)::int                                        AS over_limit
        FROM sessions s
        JOIN settings st ON st.center_id = s.center_id
        WHERE s.center_id=$1 AND s.check_in_time>=$2 AND s.check_in_time<$3
        GROUP BY s.student_name ORDER BY total_min DESC
      `, [center.id, yearStart, yearEnd]);

      if (!stats.length) continue;

      const { rows: monthly } = await pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', check_in_time), 'Mon YYYY') AS month_label,
          COUNT(*)::int                                            AS sessions,
          COALESCE(SUM(elapsed_min), 0)::int                      AS total_min
        FROM sessions
        WHERE center_id=$1 AND check_in_time>=$2 AND check_in_time<$3
        GROUP BY DATE_TRUNC('month', check_in_time)
        ORDER BY DATE_TRUNC('month', check_in_time)
      `, [center.id, yearStart, yearEnd]);

      const totalSessions = stats.reduce((a, s) => a + s.total_sessions, 0);
      const totalMin      = stats.reduce((a, s) => a + s.total_min, 0);
      const totalHours    = Math.floor(totalMin / 60);
      const totalMinRem   = totalMin % 60;

      const studentRows = stats.map(s => {
        const topSubj   = Math.max(s.math_min, s.reading_min, s.both_min) === s.math_min ? 'Math'
                        : Math.max(s.reading_min, s.both_min) === s.reading_min ? 'Reading' : 'Both';
        const overStyle = s.over_limit > 0 ? 'color:#dc2626;font-weight:700;' : 'color:#15803d;';
        return `<tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 12px;font-weight:700;">${s.student_name}</td>
          <td style="padding:8px 12px;text-align:center;">${s.total_sessions}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700;">${s.total_min} min</td>
          <td style="padding:8px 12px;text-align:center;">${s.avg_min ?? '—'} min</td>
          <td style="padding:8px 12px;text-align:center;">${topSubj}</td>
          <td style="padding:8px 12px;text-align:center;${overStyle}">${s.over_limit > 0 ? s.over_limit : '✓'}</td>
        </tr>`;
      }).join('');

      const monthRows = monthly.map(m => `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 12px;font-weight:600;">${m.month_label}</td>
          <td style="padding:8px 12px;text-align:center;">${m.sessions}</td>
          <td style="padding:8px 12px;text-align:center;font-weight:700;">${m.total_min} min (${Math.floor(m.total_min/60)}h ${m.total_min%60}m)</td>
        </tr>`).join('');

      const medals  = ['🥇','🥈','🥉'];
      const top3Html = stats.slice(0, 3).map((s, i) =>
        `<div style="display:inline-block;background:white;border-radius:10px;padding:12px 18px;margin:0 8px 8px 0;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <span style="font-size:1.3rem;">${medals[i]}</span>
          <strong style="color:#1e293b;margin-left:8px;">${s.student_name}</strong>
          <span style="color:#64748b;font-size:0.85rem;margin-left:6px;">${s.total_min} min &middot; ${s.total_sessions} sessions</span>
        </div>`
      ).join('');

      await transporter.sendMail({
        from:    `"Kumon Check-In" <${process.env.GMAIL_USER}>`,
        to:      center.alert_emails.join(', '),
        subject: `${year} Annual Report — ${center.name}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;padding:32px;background:#f0f4ff;border-radius:12px;">
            <h2 style="color:#1a3c8f;margin-bottom:4px;">🏆 Annual Kumon Time Report</h2>
            <p style="color:#64748b;margin-top:0;margin-bottom:20px;">${center.name} &mdash; Year ${year}</p>
            <div style="display:flex;gap:16px;margin-bottom:28px;flex-wrap:wrap;">
              <div style="background:white;border-radius:10px;padding:14px 22px;box-shadow:0 2px 8px rgba(0,0,0,0.06);min-width:110px;text-align:center;">
                <div style="font-size:2rem;font-weight:800;color:#1a3c8f;line-height:1;">${totalSessions}</div>
                <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Sessions</div>
              </div>
              <div style="background:white;border-radius:10px;padding:14px 22px;box-shadow:0 2px 8px rgba(0,0,0,0.06);min-width:110px;text-align:center;">
                <div style="font-size:2rem;font-weight:800;color:#1a3c8f;line-height:1;">${stats.length}</div>
                <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Students</div>
              </div>
              <div style="background:white;border-radius:10px;padding:14px 22px;box-shadow:0 2px 8px rgba(0,0,0,0.06);min-width:110px;text-align:center;">
                <div style="font-size:2rem;font-weight:800;color:#1a3c8f;line-height:1;">${totalHours}h ${totalMinRem}m</div>
                <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">Total Time</div>
              </div>
            </div>

            <p style="font-weight:700;color:#1e293b;margin-bottom:12px;">Student Annual Summary</p>
            <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:28px;">
              <thead>
                <tr style="background:#1a3c8f;color:#fff;">
                  <th style="padding:10px 12px;text-align:left;">Student</th>
                  <th style="padding:10px 12px;text-align:center;">Sessions</th>
                  <th style="padding:10px 12px;text-align:center;">Total Time</th>
                  <th style="padding:10px 12px;text-align:center;">Avg/Session</th>
                  <th style="padding:10px 12px;text-align:center;">Top Subject</th>
                  <th style="padding:10px 12px;text-align:center;">Over-Limit</th>
                </tr>
              </thead>
              <tbody>${studentRows}</tbody>
            </table>

            <p style="font-weight:700;color:#1e293b;margin-bottom:12px;">Month-by-Month Breakdown</p>
            <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;margin-bottom:28px;">
              <thead>
                <tr style="background:#1a3c8f;color:#fff;">
                  <th style="padding:10px 12px;text-align:left;">Month</th>
                  <th style="padding:10px 12px;text-align:center;">Sessions</th>
                  <th style="padding:10px 12px;text-align:center;">Total Time</th>
                </tr>
              </thead>
              <tbody>${monthRows}</tbody>
            </table>

            ${stats.length > 0 ? `<p style="font-weight:700;color:#1e293b;margin-bottom:12px;">Most Active Students</p>
            <div style="margin-bottom:24px;">${top3Html}</div>` : ''}

            <p style="color:#64748b;margin-top:24px;font-size:0.85rem;">Sent automatically on January 1st by Kumon Check-In.</p>
          </div>`,
      });
      emailsSent++;
    }

    res.json({ centersChecked: centers.length, emailsSent });
  } catch (err) { console.error('[YEARLY-REPORT]', err); res.status(500).json({ error: 'Yearly report failed' }); }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`\nKumon → http://localhost:${PORT}\n`));
}
module.exports = app; // required for Vercel
