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
class AppStore {
  constructor() {
    this.uid   = null;
    this.user  = null;
    this.tasks = [];
  }
  load(uid) {
    this.uid = uid;
    this.user = null;
    this.tasks = [];
    try {
      const u = localStorage.getItem(this._key('user'));
      const t = localStorage.getItem(this._key('tasks'));
      if (u) {
        const data = JSON.parse(u);
        this.user = Object.assign(
          new User(data.name, data.code, data.career, data.university, data.semester, data.email, data.uid),
          data
        );
      }
      if (t) this.tasks = JSON.parse(t).map(d => Object.assign(new Task('', '', '', '', '', '', ''), d));
    } catch (e) { console.error('Error cargando datos:', e); }
  }
  _key(name) {
    if (!this.uid) throw new Error('No hay una cuenta autenticada para guardar los datos.');
    return `bloom_${name}_${this.uid}`;
  }
  saveUser()  { localStorage.setItem(this._key('user'), JSON.stringify(this.user)); }
  saveTasks() { localStorage.setItem(this._key('tasks'), JSON.stringify(this.tasks)); }
  addTask(task)    { this.tasks.push(task); this.saveTasks(); }
  removeTask(id)   { this.tasks = this.tasks.filter(t => t.id !== id); this.saveTasks(); }
  updateTask(task) {
    const i = this.tasks.findIndex(t => t.id === task.id);
    if (i >= 0) { this.tasks[i] = task; this.saveTasks(); }
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
 * Los datos se guardan en localStorage separados por cuenta autenticada.
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
    this._storageKey = null;
  }

  /** Carga todas las sesiones guardadas */
  getSessions() {
    try {
      return this._storageKey ? JSON.parse(localStorage.getItem(this._storageKey) || '[]') : [];
    } catch (e) { return []; }
  }

  /** Guarda la lista completa de sesiones */
  _saveSessions(sessions) {
    if (!this._storageKey) throw new Error('No hay una cuenta autenticada para guardar el uso.');
    localStorage.setItem(this._storageKey, JSON.stringify(sessions));
  }

  /** Registra una nueva visita/sesión */
  startSession(screenName = 'home', userId) {
    if (!userId) throw new Error('Se requiere una cuenta autenticada para registrar el uso.');
    this._storageKey = `bloom_usage_${userId}`;
    const now    = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5);

    this._currentSession = {
      date:     dateStr,
      time:     timeStr,
      screen:   screenName,
      duration: 0
    };

    this._sessionStart = Date.now();

    const sessions = this.getSessions();
    sessions.push(this._currentSession);
    this._saveSessions(sessions);

    // Actualiza la duración cada 30 segundos mientras la página está abierta
    this._durationInterval = setInterval(() => this._updateDuration(), 30000);
  }

  /** Actualiza la duración de la sesión actual */
  _updateDuration() {
    if (!this._currentSession) return;
    const elapsed = Math.round((Date.now() - this._sessionStart) / 1000);
    const sessions = this.getSessions();
    if (sessions.length > 0) {
      sessions[sessions.length - 1].duration = elapsed;
      this._saveSessions(sessions);
    }
  }

  /** Finaliza la sesión (llamar al cerrar página) */
  endSession() {
    this._updateDuration();
    clearInterval(this._durationInterval);
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
  clearAll() {
    if (this._storageKey) localStorage.removeItem(this._storageKey);
  }
}

/* ===================== CONSTANTES ===================== */
const MOTIVATIONAL = [
  { icon: '🌸', text: '¡Cada tarea completada es un pétalo más en tu jardín del éxito! Sigue adelante.' },
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
  '🌸 ¡Tú puedes con todo!', '📚 El conocimiento es tu superpoder', '⭐ Un día a la vez',
  '💪 El esfuerzo siempre vale la pena', '🌈 Cada error es aprendizaje',
  '🎯 Enfócate en el proceso', '🦋 Confía en ti misma', '☕ Un descanso también es productivo',
  '🚀 Tu futuro te agradecerá hoy', '💖 El éxito es tuyo', '🌟 Brilla con tu propio ritmo',
];

const ANTI_STRESS_NOTES = [
  { icon: '🫁', title: 'Técnica 4-7-8', text: 'Inhala 4 seg → retén 7 seg → exhala 8 seg. Repite 3 veces para calmar tu sistema nervioso al instante.', bg: 'linear-gradient(135deg,#fff0f5,#fce7f3)' },
  { icon: '🎵', title: 'Música que ayuda', text: 'Escucha música a 432 Hz o sonidos de la naturaleza mientras estudias. Reducen el cortisol y mejoran la concentración.', bg: 'linear-gradient(135deg,#f0f9ff,#e0f2fe)' },
  { icon: '🍓', title: 'Hidratación y snacks', text: 'Un cerebro hidratado rinde 20% más. Toma agua cada 30 min y come frutos secos o frutas para mantener la energía.', bg: 'linear-gradient(135deg,#fef9f0,#fef3c7)' },
  { icon: '⏱️', title: 'Pomodoro Study', text: '25 min de estudio enfocado + 5 min de descanso = máxima productividad. Después de 4 rondas, descansa 15-30 min.', bg: 'linear-gradient(135deg,#f0fdf4,#dcfce7)' },
  { icon: '🌙', title: 'Sueño es sagrado', text: 'Dormir 7-8 horas consolida lo aprendido en tu memoria. Trasnochar antes de un examen perjudica más de lo que ayuda.', bg: 'linear-gradient(135deg,#f5f3ff,#ede9fe)' },
  { icon: '🚶', title: 'Mueve el cuerpo', text: '10 minutos de caminar aumentan endorfinas y claridad mental. Es más efectivo que otra hora de estudio sin moverse.', bg: 'linear-gradient(135deg,#fff9f0,#ffedd5)' },
  { icon: '📓', title: 'Diario de gratitud', text: 'Escribe 3 cosas por las que estás agradecida hoy. La gratitud redirige tu mente del estrés hacia lo positivo.', bg: 'linear-gradient(135deg,#fff1f2,#ffe4e6)' },
  { icon: '🧘', title: 'Mindfulness express', text: 'Cierra los ojos 2 minutos. Observa tus pensamientos sin juzgarlos. Esto reinicia tu corteza prefrontal.', bg: 'linear-gradient(135deg,#f0fdfa,#ccfbf1)' },
];
