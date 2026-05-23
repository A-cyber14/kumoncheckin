require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Email Transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ─── Subject Time Limits ───────────────────────────────────────────────────────
const LIMITS = { Math: 35, Reading: 35, Both: 70 };

// ─── Student State ─────────────────────────────────────────────────────────────
const students = {
  'Aarushi Vaghasia':              { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Ahan Patel':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Ahitana Morales':               { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Alexander Su':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Alina Patel':                   { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Amuthan Paulraja':              { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Anisa Junaid':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Ari Agarwal':                   { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Arnav Patil':                   { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Arya Samala':                   { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Arya Agarwal':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Ashar Junaid':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Avi Sharma':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Avyan Agarwal':                 { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Avyukth "Avy" Pranesh':        { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Ayaan Samala':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Bennett Presta':                { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Charlie Tran':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Conor Cole':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Daniel Su':                     { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Darsh Patel':                   { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Dhruv Varsani':                 { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Disha Hirpara':                 { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Diya Gowda':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Elena Bare':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Heidi Le':                      { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'JAY KUMBHANI':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Kai Haselden':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Kavin Keshor Kumar':            { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'KAVIN SANGEETH':                { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Kevin Wachtel':                 { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Lilly Anampa':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Lincoln Tran':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Louise De Mattos':              { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Lucas Campos':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Luke De Mattos':                { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Marika Szilagyi':               { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Martin Makarius':               { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Marvin Williamson':             { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Michael Makarius':              { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Mishka Patel':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Myra Patel':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Nyra Patel':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Raymond "Trey" Mills':          { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Richitha "Richi" Korlakunta':   { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Rishal Yeruva':                 { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Rudhvik Thimmasani':            { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Rushiv Patel':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Saanvi Sinha':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Saavi Sharma':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Sage Mills':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Sahaan Patel':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Sathvik Hariprakash':           { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Shanmukh Bobba':                { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Shreya Gowda':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Sia Parmar':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Sithara Deepak':                { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Sri Varshini Nadupalli':        { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Tanvik Thimmasani':             { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Vaiga Rahul':                   { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Veer Daftari':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Veeya Sangeeth':                { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Viaan Daftari':                 { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Vihaan Patel':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Zara Hayat':                    { checkedIn: false, checkInTime: null, subject: null, alerted: false },
  'Zohair Hayat':                  { checkedIn: false, checkInTime: null, subject: null, alerted: false },
};

// ─── API: Get All Students ──────────────────────────────────────────────────────
app.get('/api/students', (req, res) => {
  const now = Date.now();
  const data = Object.entries(students).map(([name, s]) => ({
    name,
    checkedIn: s.checkedIn,
    checkInTime: s.checkInTime,
    subject: s.subject,
    limitMs: s.subject ? LIMITS[s.subject] * 60 * 1000 : null,
    elapsedMs: s.checkedIn && s.checkInTime ? now - s.checkInTime : null,
  }));
  res.json(data);
});

// ─── API: Check In ─────────────────────────────────────────────────────────────
app.post('/api/checkin/:name', (req, res) => {
  const { name } = req.params;
  const { subject } = req.body;

  if (!students[name]) return res.status(404).json({ error: 'Student not found' });
  if (students[name].checkedIn) return res.status(400).json({ error: 'Already checked in' });
  if (!LIMITS[subject]) return res.status(400).json({ error: 'Invalid subject' });

  students[name] = { checkedIn: true, checkInTime: Date.now(), subject, alerted: false };
  console.log(`[${new Date().toLocaleTimeString()}] ${name} checked IN — ${subject} (${LIMITS[subject]} min)`);
  res.json({ success: true });
});

// ─── API: Check Out ────────────────────────────────────────────────────────────
app.post('/api/checkout/:name', (req, res) => {
  const { name } = req.params;
  if (!students[name]) return res.status(404).json({ error: 'Student not found' });
  if (!students[name].checkedIn) return res.status(400).json({ error: 'Not checked in' });

  const elapsed = students[name].checkInTime
    ? Math.floor((Date.now() - students[name].checkInTime) / 1000 / 60)
    : 0;
  const subj = students[name].subject;

  students[name] = { checkedIn: false, checkInTime: null, subject: null, alerted: false };
  console.log(`[${new Date().toLocaleTimeString()}] ${name} checked OUT after ~${elapsed} min (${subj})`);
  res.json({ success: true, elapsedMinutes: elapsed });
});

// ─── Alert Check (every 60 seconds) ───────────────────────────────────────────
setInterval(async () => {
  const now = Date.now();
  for (const [name, s] of Object.entries(students)) {
    if (!s.checkedIn || !s.checkInTime || s.alerted || !s.subject) continue;

    const elapsedMin = (now - s.checkInTime) / 1000 / 60;
    const limitMin   = LIMITS[s.subject];

    if (elapsedMin >= limitMin) {
      s.alerted = true;
      const elapsed = Math.floor(elapsedMin);
      try {
        await transporter.sendMail({
          from: `"Kumon Check-In" <${process.env.GMAIL_USER}>`,
          to: process.env.ALERT_EMAIL,
          subject: `⚠️ Kumon Alert: ${name} — ${s.subject} session over ${limitMin} min`,
          text: `${name} has been at the center for ${elapsed} minutes (${s.subject}, limit: ${limitMin} min) and has not checked out.`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f0f4ff;border-radius:12px;">
              <h2 style="color:#1a3c8f;margin-bottom:8px;">⚠️ Kumon Time Alert</h2>
              <p style="font-size:1.1rem;color:#1e293b;">
                <strong>${name}</strong> has been at the center for
                <strong style="color:#dc2626;">${elapsed} minutes</strong>.
              </p>
              <p style="color:#1e293b;margin-top:8px;">
                Subject: <strong>${s.subject}</strong> &nbsp;|&nbsp; Time limit: <strong>${limitMin} minutes</strong>
              </p>
              <p style="color:#64748b;margin-top:16px;">Please check on them.</p>
            </div>
          `,
        });
        console.log(`[ALERT] Email sent for ${name} — ${s.subject} (${elapsed}/${limitMin} min)`);
      } catch (err) {
        console.error(`[ALERT] Failed to send email for ${name}:`, err.message);
      }
    }
  }
}, 60 * 1000);

// ─── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nKumon Check-In running → http://localhost:${PORT}\n`);
});
