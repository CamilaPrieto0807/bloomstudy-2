const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const admin = require('firebase-admin');

const app = express();
const port = process.env.PORT || 3000;
const databasePath = path.resolve(process.env.DB_PATH || './data/bloomstudy.db');
const allowedRelaxationMethods = new Set([
  'breathing',
  'pomodoro',
  'mindfulness',
  'music'
]);

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
`);

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT debe contener un JSON válido.', { cause: error });
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

app.use(express.json({ limit: '1mb' }));

function requireAuth(req, res, next) {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'La autenticación Firebase no está configurada en el servidor.' });
  }

  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Se requiere un token de Firebase.' });
  }

  admin.auth().verifyIdToken(match[1])
    .then(decodedToken => {
      req.userId = decodedToken.uid;
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
  const rows = db.prepare('SELECT data FROM tasks WHERE uid = ? ORDER BY rowid').all(req.userId);
  res.json({ tasks: rows.map(parseData) });
});

app.post('/api/tasks', requireObjectBody, (req, res) => {
  const task = req.body.task;
  if (!task || typeof task !== 'object' || Array.isArray(task) || typeof task.id !== 'string' || !task.id) {
    return res.status(400).json({ error: 'La tarea debe incluir un identificador válido.' });
  }
  db.prepare('INSERT INTO tasks (uid, id, data) VALUES (?, ?, ?)')
    .run(req.userId, task.id, JSON.stringify(task));
  res.status(201).json({ task });
});

app.put('/api/tasks/:id', requireObjectBody, (req, res) => {
  const task = req.body.task;
  if (!task || typeof task !== 'object' || Array.isArray(task) || task.id !== req.params.id) {
    return res.status(400).json({ error: 'La tarea no coincide con el identificador de la ruta.' });
  }
  const result = db.prepare('UPDATE tasks SET data = ? WHERE uid = ? AND id = ?')
    .run(JSON.stringify(task), req.userId, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'No se encontró la tarea.' });
  res.json({ task });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE uid = ? AND id = ?').run(req.userId, req.params.id);
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
