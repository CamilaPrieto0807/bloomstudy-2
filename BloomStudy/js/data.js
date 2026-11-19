/* ================================================================
   data.js — Clases de datos y constantes de BloomStudy
================================================================ */

/* ===================== CLASE USER ===================== */
class User {
  constructor(name, code, career, university, semester, email = '', uid = '') {
    this.name       = name;
    this.code       = code;
    this.career     = career;
    this.university = university;
    this.semester   = semester;
    this.email      = email;
    this.uid        = uid;
    this.createdAt  = new Date().toISOString();
  }
  get initials() {
    return this.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }
}

/* ===================== CLASE TASK ===================== */
class Task {
  constructor(name, subject, date, time, priority, desc, reminder) {
    this.id       = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    this.name     = name;
    this.subject  = subject;
    this.date     = date;
    this.time     = time;
    this.priority = priority;
    this.desc     = desc;
    this.reminder = reminder;
    this.done     = false;
    this.createdAt = new Date().toISOString();
  }
  get daysLeft() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due   = new Date(this.date + 'T00:00:00');
    return Math.ceil((due - today) / 86400000);
  }
  get isOverdue() { return this.daysLeft < 0 && !this.done; }
  get daysLabel() {
    const d = this.daysLeft;
    if (this.done) return '✅ Completada';
    if (d < 0)     return `⚠️ Vencida hace ${Math.abs(d)} día${Math.abs(d) !== 1 ? 's' : ''}`;
    if (d === 0)   return '🔥 ¡Hoy es la entrega!';
    if (d === 1)   return '⏰ ¡Mañana!';
    return `📅 En ${d} días`;
  }
}

/* ===================== CLASE APPSTORE ===================== */
async function apiRequest(path, options = {}) {
  const currentUser = window.firebase && window.firebase.auth().currentUser;
  if (!currentUser) throw new Error('No hay una cuenta autenticada para acceder al servidor.');

  const token = await currentUser.getIdToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let message = `Error del servidor (${response.status}).`;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch (error) {
      console.error('No se pudo leer el error de la API:', error);
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

class AppStore {
  constructor() {
    this.uid   = null;
    this.user  = null;
    this.tasks = [];
    this.relaxationMethod = null;
  }
  async load(uid) {
    this.uid = uid;
    this.user = null;
    this.tasks = [];
    this.relaxationMethod = null;
    const [profileResult, tasksResult, relaxationResult] = await Promise.all([
      apiRequest('/profile'),
      apiRequest('/tasks'),
      apiRequest('/relaxation')
    ]);
    if (profileResult.profile) {
      const data = profileResult.profile;
      this.user = Object.assign(
        new User(data.name, data.code, data.career, data.university, data.semester, data.email, data.uid),
        data
      );
    }
    this.tasks = tasksResult.tasks.map(data => Object.assign(new Task('', '', '', '', '', '', ''), data));
    this.relaxationMethod = relaxationResult.method;
  }
  async saveUser() {
    await apiRequest('/profile', { method: 'PUT', body: JSON.stringify({ profile: this.user }) });
  }
  async saveRelaxationMethod(method) {
    const result = await apiRequest('/relaxation', {
      method: 'PUT',
      body: JSON.stringify({ method })
    });
    this.relaxationMethod = result.method;
  }
  async addTask(task) {
    await apiRequest('/tasks', { method: 'POST', body: JSON.stringify({ task }) });
    this.tasks.push(task);
  }
  async removeTask(id) {
    await apiRequest(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.tasks = this.tasks.filter(t => t.id !== id);
  }
  async updateTask(task) {
    await apiRequest(`/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ task })
    });
    const i = this.tasks.findIndex(t => t.id === task.id);
    if (i >= 0) this.tasks[i] = task;
  }
  getTask(id) { return this.tasks.find(t => t.id === id); }
  get pending()   { return this.tasks.filter(t => !t.done); }
  get completed() { return this.tasks.filter(t => t.done); }
  get pct() {
    if (!this.tasks.length) return 0;
    return Math.round(this.completed.length / this.tasks.length * 100);
  }
}

/* ===================== CLASE USAGETRACKER ===================== */
/**
 * Registra cuántas veces y cuándo una persona abre/usa la app.
 * Los datos se guardan en la API y se separan por cuenta autenticada.
 *
 * Estructura de cada sesión:
 * {
 *   date: '2025-04-07',      // Fecha de la visita (YYYY-MM-DD)
 *   time: '14:32',           // Hora de ingreso (HH:MM)
 *   screen: 'home',          // Pantalla inicial
 *   duration: 120            // Segundos activos en la app (se actualiza al salir)
 * }
 */
class UsageTracker {
  constructor() {
    this._sessionStart = Date.now();
    this._currentSession = null;
    this._sessions = [];
    this._durationInterval = null;
  }

  getSessions() { return this._sessions; }

  async startSession(screenName = 'home', userId) {
    if (!userId) throw new Error('Se requiere una cuenta autenticada para registrar el uso.');
    clearInterval(this._durationInterval);
    const result = await apiRequest('/usage');
    this._sessions = result.sessions;
    const now    = new Date();
    this._currentSession = {
      id:       `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date:     now.toISOString().slice(0, 10),
      time:     now.toTimeString().slice(0, 5),
      screen:   screenName,
      duration: 0
    };

    this._sessionStart = Date.now();
    const saved = await apiRequest('/usage', {
      method: 'POST',
      body: JSON.stringify({ session: this._currentSession })
    });
    this._currentSession = saved.session;
    this._sessions.push(this._currentSession);
    this._durationInterval = setInterval(() => {
      this._updateDuration().catch(error => showAuthError(`No se pudo guardar la duración de uso: ${error.message}`));
    }, 30000);
  }

  async _updateDuration() {
    if (!this._currentSession) return;
    const elapsed = Math.round((Date.now() - this._sessionStart) / 1000);
    this._currentSession.duration = elapsed;
    await apiRequest(`/usage/${encodeURIComponent(this._currentSession.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ session: this._currentSession })
    });
  }

  async endSession() {
    clearInterval(this._durationInterval);
    await this._updateDuration();
  }

  /** Retorna estadísticas resumidas */
  getStats() {
    const sessions = this.getSessions();
    if (!sessions.length) return { total: 0, today: 0, thisWeek: 0, avgDuration: 0, byDay: {} };

    const today     = new Date().toISOString().slice(0, 10);
    const weekAgo   = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const todaySessions    = sessions.filter(s => s.date === today);
    const weekSessions     = sessions.filter(s => s.date >= weekAgo);
    const totalDuration    = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
    const avgDuration      = sessions.length ? Math.round(totalDuration / sessions.length) : 0;

    // Agrupado por día (últimos 7 días)
    const byDay = {};
    weekSessions.forEach(s => {
      byDay[s.date] = (byDay[s.date] || 0) + 1;
    });

    return {
      total:       sessions.length,
      today:       todaySessions.length,
      thisWeek:    weekSessions.length,
      avgDuration: avgDuration,
      byDay:       byDay,
      sessions:    sessions
    };
  }

  /** Borra todos los registros de uso */
  async clearAll() {
    await apiRequest('/usage', { method: 'DELETE' });
    this._sessions = [];
    this._currentSession = null;
    clearInterval(this._durationInterval);
  }
}

/* ===================== CONSTANTES ===================== */
const MOTIVATIONAL = [
  { icon: '✦', text: 'Cada tarea completada es un paso hacia tus metas. Sigue adelante.' },
  { icon: '⭐', text: 'Respira profundo. Tú puedes con todo esto y más. ¡Eres increíble!' },
  { icon: '💪', text: 'No estás sola en esto. Cada estudiante tiene sus luchas — y tú estás ganando.' },
  { icon: '🌈', text: 'Pequeños pasos llevan a grandes resultados. ¡Una tarea a la vez, siempre!' },
  { icon: '🦋', text: 'El estrés es temporal. Tu conocimiento y esfuerzo son eternos. ¡Tú vales mucho!' },
  { icon: '🎯', text: 'Hoy es un buen día para aprender algo nuevo. ¡Tu mente es poderosa!' },
  { icon: '🌟', text: 'Cada hora de estudio es una inversión en tu futuro brillante. ¡Sigue así!' },
  { icon: '☕', text: 'Tómate un descanso, respira, y vuelve con más energía. ¡Tu cerebro lo necesita!' },
  { icon: '🚀', text: 'Los grandes logros empiezan con una decisión hoy. ¡Tú ya tomaste la correcta!' },
  { icon: '💖', text: 'Recuerda por qué empezaste. Esa razón sigue siendo válida hoy. ¡No te rindas!' },
];

const TICKER_MSGS = [
  '✦ Avanza a tu propio ritmo', '📚 El conocimiento es tu superpoder', '⭐ Un día a la vez',
  '💪 El esfuerzo siempre vale la pena', '🌈 Cada error es aprendizaje',
  '🎯 Enfócate en el proceso', '🦋 Confía en ti misma', '☕ Un descanso también es productivo',
  '🚀 Tu futuro te agradecerá hoy', '💖 El éxito es tuyo', '🌟 Brilla con tu propio ritmo',
];

const ANTI_STRESS_NOTES = [
  { id: 'breathing', icon: '◉', title: 'Técnica 4-7-8', text: 'Sigue una respiración guiada: inhala, haz una pausa cómoda y exhala lentamente.', duration: '1 minuto', bg: 'linear-gradient(135deg,#f7f2e7,#ebe2cd)', steps: [
    { title: 'Inhala', seconds: 4, instruction: 'Toma aire suavemente por la nariz. Observa cómo el pecho y el abdomen se expanden.', breath: 'inhale' },
    { title: 'Pausa', seconds: 7, instruction: 'Mantén el aire solo si te resulta cómodo. Si no, continúa respirando con normalidad.', breath: 'hold' },
    { title: 'Exhala', seconds: 8, instruction: 'Suelta el aire lentamente, sin vaciar los pulmones a la fuerza.', breath: 'exhale' }
  ], cycles: 3, safety: 'Hazlo sin forzar. Si te mareas o sientes incomodidad, detente y respira normalmente.' },
  { id: 'music', icon: '♫', title: 'Música que ayuda', text: 'Prepara un momento tranquilo con música instrumental o sonidos de la naturaleza.', duration: '3 minutos', bg: 'linear-gradient(135deg,#eff3ed,#e1e9df)', steps: [
    { title: 'Elige un sonido', seconds: 30, instruction: 'Busca música instrumental o sonidos de la naturaleza y pon el volumen a un nivel cómodo.' },
    { title: 'Escucha con atención', seconds: 120, instruction: 'Acomódate y escucha. Si te distraes, nota el sonido y vuelve a él sin juzgarte.' },
    { title: 'Regresa poco a poco', seconds: 30, instruction: 'Baja el volumen, mueve suavemente las manos y vuelve a tu actividad cuando estés lista.' }
  ] },
  { id: 'hydration', icon: '○', title: 'Hidratación y snacks', text: 'Tómate una pausa para beber agua y revisar si necesitas una merienda.', duration: '1 min 30 s', bg: 'linear-gradient(135deg,#f5f2e7,#eee8d6)', steps: [
    { title: 'Prepara tu pausa', seconds: 20, instruction: 'Busca agua y, si tienes hambre, algo sencillo para comer. No necesitas apresurarte.' },
    { title: 'Toma un descanso', seconds: 40, instruction: 'Bebe a tu ritmo y nota cómo te sientes. No hace falta terminar el vaso.' },
    { title: 'Vuelve con calma', seconds: 30, instruction: 'Deja el espacio ordenado y elige qué tarea retomarás después.' }
  ] },
  { id: 'pomodoro', icon: '◷', title: 'Pomodoro Study', text: 'Un bloque de concentración de 25 minutos seguido por un descanso de 5 minutos.', duration: '30 minutos', bg: 'linear-gradient(135deg,#edf2eb,#dfe8dc)', steps: [
    { title: 'Enfoque', seconds: 1500, instruction: 'Elige una sola tarea. Silencia las distracciones y trabaja a tu ritmo durante este bloque.' },
    { title: 'Descanso', seconds: 300, instruction: 'Al terminar, levántate, estira el cuerpo o descansa la vista. Puedes volver a iniciar otro bloque cuando quieras.' }
  ] },
  { id: 'sleep', icon: '☾', title: 'Pausa para descansar', text: 'Crea una transición tranquila para cerrar el estudio o prepararte para dormir.', duration: '2 min 30 s', bg: 'linear-gradient(135deg,#efedf3,#e5e1ec)', steps: [
    { title: 'Baja el ritmo', seconds: 30, instruction: 'Reduce la luz y aparta por un momento las pantallas y los materiales de estudio.' },
    { title: 'Afloja los hombros', seconds: 60, instruction: 'Busca una postura cómoda. Suelta los hombros y la mandíbula; respira con naturalidad.' },
    { title: 'Cierra la pausa', seconds: 60, instruction: 'Quédate en quietud y nota cómo se siente tu cuerpo. No tienes que quedarte dormida.' }
  ] },
  { id: 'movement', icon: '↗', title: 'Pausa de movimiento', text: 'Haz movimientos suaves y una caminata corta para cambiar de postura.', duration: '2 minutos', bg: 'linear-gradient(135deg,#edf2ef,#dfe9e4)', steps: [
    { title: 'Estira suavemente', seconds: 30, instruction: 'Rueda los hombros despacio y estira los brazos solo hasta donde te resulte cómodo.' },
    { title: 'Da unos pasos', seconds: 60, instruction: 'Camina por un lugar seguro a un ritmo cómodo. También puedes marchar suavemente en el sitio.' },
    { title: 'Haz una pausa', seconds: 30, instruction: 'Detente, nota tu respiración y vuelve a sentarte cuando estés lista. Para si algo duele.' }
  ] },
  { id: 'gratitude', icon: '✎', title: 'Diario de gratitud', text: 'Escribe tres cosas que agradeces o que salieron bien hoy, aunque sean pequeñas.', duration: '3 minutos', bg: 'linear-gradient(135deg,#f7f1e7,#eee5d7)', steps: [
    { title: 'Primera cosa', seconds: 60, instruction: 'Escribe una cosa pequeña que agradezcas o que haya salido bien hoy.' },
    { title: 'Segunda cosa', seconds: 60, instruction: 'Anota otra experiencia, persona o momento que valores.' },
    { title: 'Tercera cosa', seconds: 60, instruction: 'Escribe una última cosa. Puedes volver a leer tus notas cuando termines.' }
  ] },
  { id: 'mindfulness', icon: '◎', title: 'Mindfulness express', text: 'Dedica dos minutos a notar tu respiración, tus sensaciones y los sonidos a tu alrededor.', duration: '2 minutos', bg: 'linear-gradient(135deg,#edf2ee,#dfe8e1)', steps: [
    { title: 'Nota tu respiración', seconds: 40, instruction: 'Siéntate con comodidad y siente el aire entrar y salir. No necesitas cambiar el ritmo.' },
    { title: 'Observa tus sentidos', seconds: 40, instruction: 'Nota un sonido, una sensación del cuerpo y algo que percibas a tu alrededor.' },
    { title: 'Vuelve al presente', seconds: 40, instruction: 'Si aparece un pensamiento, reconócelo y vuelve con amabilidad a tu respiración.' }
  ] }
];
