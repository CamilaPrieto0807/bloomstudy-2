const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const app = express();
const port = process.env.PORT || 3000;
const databasePath = path.resolve(process.env.DB_PATH || './data/bloomstudy.db');
const allowedRelaxationMethods = new Set([
  'breathing',
  'hydration',
  'gratitude',
  'pomodoro',
  'mindfulness',
  'movement',
  'sleep',
  'music'
]);
const allowedReminderOffsets = new Set(['1h', '3h', '1d', '2d', '1w']);

// --- Correo con Resend (HTTPS, no usa SMTP) ---
const resendApiKey = process.env.RESEND_API_KEY;
const mailFrom = process.env.MAIL_FROM || 'BloomStudy <onboarding@resend.dev>';
const mailEnabled = Boolean(resendApiKey);

async function enviarCorreo({ to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: mailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    uid TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    uid TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (uid, id)
  );
  CREATE TABLE IF NOT EXISTS usage_sessions (
    uid TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (uid, id)
  );
  CREATE TABLE IF NOT EXISTS preferences (
    uid TEXT PRIMARY KEY,
    relaxation_method TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_reminders (
    uid TEXT NOT NULL,
    task_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    locked_at INTEGER,
    last_error TEXT,
    sent_at INTEGER,
    PRIMARY KEY (uid, task_id)
  );
`);

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT debe contener un JSON válido.', { cause: error });
  }
  initializeApp({ credential: cert(serviceAccount) });
}

app.use(express.json({ limit: '1mb' }));

function requireAuth(req, res, next) {
  if (!getApps().length) {
    return res.status(503).json({ error: 'La autenticación Firebase no está configurada en el servidor.' });
  }

  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Se requiere un token de Firebase.' });
  }

  getAuth().verifyIdToken(match[1])
    .then(decodedToken => {
      req.userId = decodedToken.uid;
      req.userEmail = decodedToken.email;
      req.userEmailVerified = decodedToken.email_verified === true;
      next();
    })
    .catch(() => res.status(401).json({ error: 'El token de Firebase no es válido o ha expirado.' }));
}

function requireObjectBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'El cuerpo debe ser un objeto JSON.' });
  }
  next();
}

function parseData(row) {
  return row ? JSON.parse(row.data) : null;
}

function taskDataForStorage(task) {
  const { reminderStatus, reminderScheduledAt, reminderSentAt, reminderAttempts, ...storedTask } = task;
  return storedTask;
}

function reminderStatusForTask(uid, taskId) {
  const row = db.prepare(`
    SELECT status, scheduled_at, sent_at, attempts
    FROM task_reminders WHERE uid = ? AND task_id = ?
  `).get(uid, taskId);
  return {
    reminderStatus: row ? row.status : null,
    reminderScheduledAt: row ? new Date(row.scheduled_at).toISOString() : null,
    reminderSentAt: row && row.sent_at ? new Date(row.sent_at).toISOString() : null,
    reminderAttempts: row ? row.attempts : 0
  };
}

function getTaskReminder(task, email, emailVerified) {
  if (task.done || !task.reminder) return { schedule: null };
  if (!allowedReminderOffsets.has(task.reminder)) {
    return { error: 'El intervalo del recordatorio no es válido.', status: 400 };
  }
  if (!mailEnabled) {
    return { error: 'El correo no está configurado. Añade RESEND_API_KEY en Render para activar recordatorios.', status: 503 };
  }
  if (!emailVerified || !email) {
    return { error: 'Firebase no confirmó una dirección de correo para esta cuenta.', status: 400 };
  }

  const scheduledAt = typeof task.reminderAt === 'string' ? Date.parse(task.reminderAt) : NaN;
  if (!Number.isFinite(scheduledAt)) {
    return { error: 'La fecha del recordatorio no es válida.', status: 400 };
  }
  return {
    schedule: scheduledAt > Date.now()
      ? { email, scheduledAt }
      : null
  };
}

function saveTaskReminder(uid, taskId, schedule) {
  if (!schedule) {
    db.prepare('DELETE FROM task_reminders WHERE uid = ? AND task_id = ?').run(uid, taskId);
    return;
  }

  const existing = db.prepare(`
    SELECT recipient_email, scheduled_at, status
    FROM task_reminders WHERE uid = ? AND task_id = ?
  `).get(uid, taskId);
  if (existing && existing.recipient_email === schedule.email &&
      existing.scheduled_at === schedule.scheduledAt && existing.status !== 'failed') return;

  db.prepare(`
    INSERT INTO task_reminders (uid, task_id, recipient_email, scheduled_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(uid, task_id) DO UPDATE SET
      recipient_email = excluded.recipient_email,
      scheduled_at = excluded.scheduled_at,
      status = 'pending',
      attempts = 0,
      next_attempt_at = 0,
      locked_at = NULL,
      last_error = NULL,
      sent_at = NULL
  `).run(uid, taskId, schedule.email, schedule.scheduledAt);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

let processingReminders = false;
async function sendDueReminders() {
  if (!mailEnabled || processingReminders) return;
  processingReminders = true;
  try {
    const now = Date.now();
    db.prepare(`
      UPDATE task_reminders
      SET status = 'pending', locked_at = NULL
      WHERE status = 'sending' AND locked_at < ?
    `).run(now - 5 * 60 * 1000);

    for (let count = 0; count < 20; count++) {
      const reminder = db.transaction(() => {
        const due = db.prepare(`
          SELECT r.uid, r.task_id, r.recipient_email, r.attempts, t.data
          FROM task_reminders r
          JOIN tasks t ON t.uid = r.uid AND t.id = r.task_id
          WHERE r.status = 'pending'
            AND r.scheduled_at <= ?
            AND r.next_attempt_at <= ?
          ORDER BY r.scheduled_at
          LIMIT 1
        `).get(Date.now(), Date.now());
        if (!due) return null;
        const claim = db.prepare(`
          UPDATE task_reminders SET status = 'sending', locked_at = ?
          WHERE uid = ? AND task_id = ? AND status = 'pending'
        `).run(Date.now(), due.uid, due.task_id);
        return claim.changes ? due : null;
      })();
      if (!reminder) break;

      const task = parseData({ data: reminder.data });
      const dueText = `${task.date}${task.time ? ` a las ${task.time}` : ''}`;
      const subject = `Recordatorio académico: ${task.name}`.replace(/[\r\n]/g, ' ');
      const text = `Hola, este es tu recordatorio de BloomStudy.\n\n${task.name}\n${task.subject}\nFecha de entrega: ${dueText}\n\nIngresa a BloomStudy para revisar tus actividades.`;
      const html = `<div style="font-family:Arial,sans-serif;color:#252923;line-height:1.6"><h2 style="color:#806a3a">BloomStudy</h2><p>Este es tu recordatorio académico:</p><p><strong>${escapeHtml(task.name)}</strong><br>${escapeHtml(task.subject)}<br>Fecha de entrega: ${escapeHtml(dueText)}</p><p>Ingresa a BloomStudy para revisar tus actividades.</p></div>`;

      try {
        console.log(`Enviando recordatorio ${reminder.task_id} a ${reminder.recipient_email}...`);
        await enviarCorreo({
          to: reminder.recipient_email,
          subject,
          text,
          html
        });
        console.log(`Recordatorio ${reminder.task_id} enviado.`);
        db.prepare(`
          UPDATE task_reminders SET status = 'sent', sent_at = ?, locked_at = NULL, last_error = NULL
          WHERE uid = ? AND task_id = ? AND status = 'sending'
        `).run(Date.now(), reminder.uid, reminder.task_id);
      } catch (error) {
        const attempts = reminder.attempts + 1;
        const nextAttemptAt = Date.now() + Math.min(60 * 60 * 1000, 60 * 1000 * (2 ** attempts));
        db.prepare(`
          UPDATE task_reminders
          SET status = ?, attempts = ?, next_attempt_at = ?, locked_at = NULL, last_error = ?
          WHERE uid = ? AND task_id = ? AND status = 'sending'
        `).run(
          attempts >= 5 ? 'failed' : 'pending',
          attempts,
          nextAttemptAt,
          String(error.message).slice(0, 500),
          reminder.uid,
          reminder.task_id
        );
        console.error(`No se pudo enviar el recordatorio ${reminder.task_id}:`, error);
      }
    }
  } finally {
    processingReminders = false;
  }
}

app.use('/api', requireAuth);

app.get('/api/profile', (req, res) => {
  const row = db.prepare('SELECT data FROM profiles WHERE uid = ?').get(req.userId);
  res.json({ profile: parseData(row) });
});

app.put('/api/profile', requireObjectBody, (req, res) => {
  const submittedProfile = req.body.profile;
  if (!submittedProfile || typeof submittedProfile !== 'object' || Array.isArray(submittedProfile)) {
    return res.status(400).json({ error: 'El perfil académico no es válido.' });
  }
  const profile = { ...submittedProfile, uid: req.userId };
  db.prepare(`
    INSERT INTO profiles (uid, data) VALUES (?, ?)
    ON CONFLICT(uid) DO UPDATE SET data = excluded.data
  `).run(req.userId, JSON.stringify(profile));
  res.json({ profile });
});

app.get('/api/tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.data, r.status AS reminder_status, r.attempts AS reminder_attempts,
      r.scheduled_at AS reminder_scheduled_at, r.sent_at AS reminder_sent_at
    FROM tasks t
    LEFT JOIN task_reminders r ON r.uid = t.uid AND r.task_id = t.id
    WHERE t.uid = ?
    ORDER BY t.rowid
  `).all(req.userId);
  const tasks = rows.map(row => ({
    ...parseData(row),
    reminderStatus: row.reminder_status || null,
    reminderScheduledAt: row.reminder_scheduled_at
      ? new Date(row.reminder_scheduled_at).toISOString()
      : null,
    reminderSentAt: row.reminder_sent_at
      ? new Date(row.reminder_sent_at).toISOString()
      : null,
    reminderAttempts: row.reminder_attempts || 0
  }));
  res.json({ tasks });
});

app.post('/api/tasks', requireObjectBody, (req, res) => {
  const task = req.body.task;
  if (!task || typeof task !== 'object' || Array.isArray(task) || typeof task.id !== 'string' || !task.id) {
    return res.status(400).json({ error: 'La tarea debe incluir un identificador válido.' });
  }
  const storedTask = taskDataForStorage(task);
  const reminder = getTaskReminder(storedTask, req.userEmail, req.userEmailVerified);
  if (reminder.error) return res.status(reminder.status).json({ error: reminder.error });
  db.transaction(() => {
    db.prepare('INSERT INTO tasks (uid, id, data) VALUES (?, ?, ?)')
      .run(req.userId, storedTask.id, JSON.stringify(storedTask));
    saveTaskReminder(req.userId, task.id, reminder.schedule);
  })();
  res.status(201).json({
    task: { ...storedTask, ...reminderStatusForTask(req.userId, task.id) }
  });
});

app.put('/api/tasks/:id', requireObjectBody, (req, res) => {
  const task = req.body.task;
  if (!task || typeof task !== 'object' || Array.isArray(task) || task.id !== req.params.id) {
    return res.status(400).json({ error: 'La tarea no coincide con el identificador de la ruta.' });
  }
  const existing = db.prepare('SELECT id FROM tasks WHERE uid = ? AND id = ?').get(req.userId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'No se encontró la tarea.' });
  const storedTask = taskDataForStorage(task);
  const reminder = getTaskReminder(storedTask, req.userEmail, req.userEmailVerified);
  if (reminder.error) return res.status(reminder.status).json({ error: reminder.error });
  const result = db.transaction(() => {
    const updated = db.prepare('UPDATE tasks SET data = ? WHERE uid = ? AND id = ?')
      .run(JSON.stringify(storedTask), req.userId, req.params.id);
    if (updated.changes) saveTaskReminder(req.userId, req.params.id, reminder.schedule);
    return updated;
  })();
  if (!result.changes) return res.status(404).json({ error: 'No se encontró la tarea.' });
  res.json({
    task: { ...storedTask, ...reminderStatusForTask(req.userId, req.params.id) }
  });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE uid = ? AND id = ?').run(req.userId, req.params.id);
    db.prepare('DELETE FROM task_reminders WHERE uid = ? AND task_id = ?').run(req.userId, req.params.id);
  })();
  res.status(204).end();
});

app.get('/api/usage', (req, res) => {
  const rows = db.prepare('SELECT data FROM usage_sessions WHERE uid = ? ORDER BY rowid').all(req.userId);
  res.json({ sessions: rows.map(parseData) });
});

app.post('/api/usage', requireObjectBody, (req, res) => {
  const session = req.body.session;
  if (!session || typeof session !== 'object' || Array.isArray(session) ||
      typeof session.id !== 'string' || !session.id) {
    return res.status(400).json({ error: 'La sesión debe incluir un identificador válido.' });
  }
  db.prepare('INSERT INTO usage_sessions (uid, id, data) VALUES (?, ?, ?)')
    .run(req.userId, session.id, JSON.stringify(session));
  res.status(201).json({ session });
});

app.patch('/api/usage/:id', requireObjectBody, (req, res) => {
  const session = req.body.session;
  if (!session || typeof session !== 'object' || Array.isArray(session) || session.id !== req.params.id) {
    return res.status(400).json({ error: 'La sesión no coincide con el identificador de la ruta.' });
  }
  const result = db.prepare('UPDATE usage_sessions SET data = ? WHERE uid = ? AND id = ?')
    .run(JSON.stringify(session), req.userId, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'No se encontró la sesión.' });
  res.json({ session });
});

app.delete('/api/usage', (req, res) => {
  db.prepare('DELETE FROM usage_sessions WHERE uid = ?').run(req.userId);
  res.status(204).end();
});

app.get('/api/relaxation', (req, res) => {
  const row = db.prepare('SELECT relaxation_method FROM preferences WHERE uid = ?').get(req.userId);
  res.json({ method: row ? row.relaxation_method : null });
});

app.put('/api/relaxation', requireObjectBody, (req, res) => {
  const { method } = req.body;
  if (typeof method !== 'string' || !allowedRelaxationMethods.has(method)) {
    return res.status(400).json({ error: 'El método de relajación seleccionado no es válido.' });
  }
  db.prepare(`
    INSERT INTO preferences (uid, relaxation_method) VALUES (?, ?)
    ON CONFLICT(uid) DO UPDATE SET relaxation_method = excluded.relaxation_method
  `).run(req.userId, method);
  res.json({ method });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta API no encontrada.' }));
app.use(express.static(path.join(__dirname, 'BloomStudy')));

app.listen(port, () => {
  console.log(`BloomStudy disponible en http://localhost:${port}`);
});

if (mailEnabled) {
  console.log('Correo listo: usando Resend.');
  sendDueReminders().catch(error => console.error('Falló la revisión inicial de recordatorios:', error));
  const reminderInterval = setInterval(() => {
    sendDueReminders().catch(error => console.error('Falló la revisión de recordatorios:', error));
  }, 30000);
  reminderInterval.unref();
} else {
  console.warn('Recordatorios por correo desactivados: configura RESEND_API_KEY.');
}