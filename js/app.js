/* ================================================================
   app.js — Lógica principal de BloomStudy
   Depende de: data.js (debe cargarse antes)
================================================================ */

/* ===================== INSTANCIAS GLOBALES ===================== */
const store   = new AppStore();
const tracker = new UsageTracker();

let firebaseAuth     = null;
let authenticatedUser = null;
let appInitialized   = false;
let motiveInterval   = null;
let currentTab      = 'all';
let calCurrentDate  = new Date();
let calSelectedDate = null;
let toastTimer      = null;

/* ===================== NAVEGACIÓN DE PANTALLAS ===================== */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navMap = {
    home: 'nav-home', tasks: 'nav-tareas',
    calendar: 'nav-cal', notes: 'nav-notas',
    profile: 'nav-perfil', usage: 'nav-usage'
  };
  if (navMap[name]) document.getElementById(navMap[name])?.classList.add('active');

  if (name === 'home')     renderHome();
  if (name === 'tasks')    renderTasks();
  if (name === 'calendar') renderCalendar();
  if (name === 'notes')    renderNotes();
  if (name === 'profile')  renderProfile();
  if (name === 'usage')    renderUsage();

  window.scrollTo(0, 0);
}

/* ===================== TICKER MOTIVACIONAL ===================== */
function initTicker() {
  const inner = document.getElementById('ticker-inner');
  const msgs  = [...TICKER_MSGS, ...TICKER_MSGS]; // duplicar para loop sin cortes
  inner.innerHTML = msgs.map(m => `<span class="ticker-item">${m}</span>`).join('');
}

/* ===================== PÉTALOS FLOTANTES ===================== */
function createPetals() {
  const emojis = ['🌸', '🌺', '💮', '🌷', '✿', '❀'];
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className   = 'petal';
    p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    p.style.left             = Math.random() * 100 + 'vw';
    p.style.animationDuration = (12 + Math.random() * 18) + 's';
    p.style.animationDelay   = (Math.random() * 20) + 's';
    p.style.fontSize         = (.8 + Math.random() * .8) + 'rem';
    document.body.appendChild(p);
  }
}

/* ===================== TOAST MOTIVACIONAL ===================== */
function showMotivationalToast() {
  const m = MOTIVATIONAL[Math.floor(Math.random() * MOTIVATIONAL.length)];
  document.getElementById('motive-icon').textContent = m.icon;
  document.getElementById('motive-text').textContent = m.text;
  const toast = document.getElementById('motive-toast');
  toast.style.display = 'flex';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(closeToast, 7000);
}
function closeToast() {
  document.getElementById('motive-toast').style.display = 'none';
  clearTimeout(toastTimer);
}

/* ===================== AUTENTICACIÓN CON GOOGLE ===================== */
function isFirebaseConfigured() {
  const config = window.BLOOM_FIREBASE_CONFIG;
  return config && config.apiKey && config.authDomain && config.projectId && config.appId;
}

function showAuthError(message) {
  const error = document.getElementById('auth-error');
  error.textContent = `⚠️ ${message}`;
  error.style.display = 'flex';
}

function clearAuthError() {
  const error = document.getElementById('auth-error');
  error.textContent = '';
  error.style.display = 'none';
}

function setupFirebaseAuth() {
  if (!isFirebaseConfigured()) return;
  if (!window.firebase) {
    showAuthError('No se pudo cargar Firebase. Comprueba tu conexión e inténtalo de nuevo.');
    return;
  }

  try {
    firebase.initializeApp(window.BLOOM_FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    document.getElementById('auth-hint').textContent = 'Acceso protegido por Google. Tu perfil académico se completa después de ingresar.';
    firebaseAuth.onAuthStateChanged(handleAuthState, error => {
      showAuthError(`No se pudo comprobar la sesión de Google: ${error.message}`);
    });
  } catch (error) {
    showAuthError(`No se pudo iniciar Firebase: ${error.message}`);
  }
}

async function startGoogleSignIn() {
  clearAuthError();
  if (!isFirebaseConfigured()) {
    showAuthError('Falta configurar Firebase. Sigue los pasos de CONFIGURACION.md para habilitar el acceso real con Google.');
    return;
  }
  if (!firebaseAuth) {
    showAuthError('El servicio de autenticación no está disponible. Recarga la página o revisa tu conexión.');
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    if (window.matchMedia('(pointer: coarse)').matches) {
      await firebaseAuth.signInWithRedirect(provider);
    } else {
      await firebaseAuth.signInWithPopup(provider);
    }
  } catch (error) {
    if (error.code === 'auth/popup-blocked') {
      try {
        await firebaseAuth.signInWithRedirect(provider);
      } catch (redirectError) {
        showAuthError(`No se pudo ingresar con Google: ${redirectError.message}`);
      }
      return;
    }
    if (error.code !== 'auth/popup-closed-by-user') {
      showAuthError(`No se pudo ingresar con Google: ${error.message}`);
    }
  }
}

function handleAuthState(user) {
  authenticatedUser = user;
  appInitialized = false;
  clearAuthError();
  if (!user) {
    store.uid = null;
    store.user = null;
    store.tasks = [];
    document.getElementById('bottom-nav').style.display = 'none';
    showScreen('welcome');
    return;
  }

  store.load(user.uid);
  if (store.user) {
    initApp();
    return;
  }

  document.getElementById('reg-name').value = user.displayName || '';
  document.getElementById('reg-google-email').textContent = user.email || '';
  document.getElementById('bottom-nav').style.display = 'none';
  showScreen('register');
}

/* ===================== REGISTRO DE PERFIL ACADÉMICO ===================== */
function registerUser() {
  if (!authenticatedUser) {
    showAuthError('Primero ingresa con tu cuenta de Google para crear tu perfil.');
    showScreen('welcome');
    return;
  }
  const name     = document.getElementById('reg-name').value.trim();
  const code     = document.getElementById('reg-code').value.trim();
  const career   = document.getElementById('reg-career').value;
  const uni      = document.getElementById('reg-uni').value.trim();
  const semester = document.getElementById('reg-semester').value;
  const err      = document.getElementById('reg-error');

  if (!name || !code || !career || !uni || !semester) {
    err.style.display = 'flex'; return;
  }
  err.style.display = 'none';
  try {
    store.user = new User(name, code, career, uni, semester, authenticatedUser.email, authenticatedUser.uid);
    store.saveUser();
    initApp();
  } catch (error) {
    err.textContent = `⚠️ No se pudo guardar tu perfil: ${error.message}`;
    err.style.display = 'flex';
  }
}

function cancelRegistration() {
  if (firebaseAuth) {
    firebaseAuth.signOut().catch(error => {
      showAuthError(`No se pudo cerrar la sesión de Google: ${error.message}`);
    });
  }
}

/* ===================== LOGOUT ===================== */
function logout() {
  if (!confirm('¿Segura que quieres cerrar sesión?')) return;
  tracker.endSession();
  if (!firebaseAuth) {
    showAuthError('No se pudo cerrar la sesión porque Firebase no está disponible.');
    return;
  }
  firebaseAuth.signOut().catch(error => {
    showAuthError(`No se pudo cerrar la sesión de Google: ${error.message}`);
  });
}

/* ===================== INICIO DE LA APP ===================== */
function initApp() {
  if (appInitialized || !authenticatedUser) return;
  appInitialized = true;
  document.getElementById('bottom-nav').style.display = 'flex';
  tracker.startSession('home', authenticatedUser.uid);
  showScreen('home');
  if (!motiveInterval) motiveInterval = setInterval(showMotivationalToast, 90000);
  setTimeout(showMotivationalToast, 3000);
}

/* ===================== HOME / DASHBOARD ===================== */
function renderHome() {
  const u    = store.user;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '¡Buenos días' : hour < 18 ? '¡Buenas tardes' : '¡Buenas noches';

  document.getElementById('home-greeting').innerHTML = `
    <div class="user-avatar">${u.initials}</div>
    <div>
      <div style="font-weight:700;font-size:1rem;">${greeting}, ${u.name.split(' ')[0]}! 🌸</div>
      <div style="font-size:.78rem;color:var(--text-light);">${u.career} · ${u.semester} semestre</div>
    </div>`;

  const pending = store.pending.length;
  const total   = store.tasks.length;
  const done    = store.completed.length;
  const overdue = store.tasks.filter(t => t.isOverdue).length;

  document.getElementById('home-stats').innerHTML = `
    <div class="stat-chip"><div class="stat-num">${total}</div><div class="stat-lbl">Total tareas</div></div>
    <div class="stat-chip"><div class="stat-num" style="color:#f59e0b;">${pending}</div><div class="stat-lbl">Pendientes</div></div>
    <div class="stat-chip"><div class="stat-num" style="color:#10b981;">${done}</div><div class="stat-lbl">Completadas</div></div>
    <div class="stat-chip"><div class="stat-num" style="color:#ef4444;">${overdue}</div><div class="stat-lbl">Vencidas</div></div>`;

  const pct = store.pct;
  document.getElementById('prog-pct').textContent  = pct + '%';
  document.getElementById('prog-fill').style.width = pct + '%';

  const upcoming = store.pending
    .filter(t => !t.isOverdue)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 3);

  const up = document.getElementById('upcoming-tasks');
  if (!upcoming.length) {
    up.innerHTML = `<div class="empty-state"><span>🎉</span>¡No tienes entregas próximas! Disfruta tu tiempo libre 🌸</div>`;
  } else {
    up.innerHTML = `<div class="task-list">${upcoming.map(taskHTML).join('')}</div>`;
  }
  updateTaskDot();
}

/* ===================== DOT DE NOTIFICACIÓN ===================== */
function updateTaskDot() {
  document.getElementById('task-dot').style.display = store.pending.length ? 'block' : 'none';
}

/* ===================== RENDER TAREAS ===================== */
function renderTasks() {
  let list = store.tasks;
  if (currentTab === 'pending') list = store.tasks.filter(t => !t.done);
  if (currentTab === 'done')    list = store.tasks.filter(t => t.done);

  list = [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done - b.done;
    return new Date(a.date) - new Date(b.date);
  });

  const container = document.getElementById('task-list-container');
  if (!list.length) {
    container.innerHTML = `<div class="empty-state">
      <span>${currentTab === 'done' ? '🎉' : '📋'}</span>
      ${currentTab === 'done' ? 'Aún no has completado tareas. ¡Tú puedes!' : 'Sin tareas aquí. Agrega una nueva 🌸'}
    </div>`;
  } else {
    container.innerHTML = `<div class="task-list">${list.map(taskHTML).join('')}</div>`;
  }
  updateTaskDot();
}

function switchTab(tab) {
  currentTab = tab;
  ['all', 'pending', 'done'].forEach(t =>
    document.getElementById('tab-' + t).classList.toggle('active', t === tab)
  );
  renderTasks();
}

/* ===================== HTML DE UNA TAREA ===================== */
function taskHTML(task) {
  const pri   = task.priority;
  const badge = `<span class="task-badge badge-${pri === 'alta' ? 'urgent' : pri === 'baja' ? 'low' : 'normal'}">
    ${pri === 'alta' ? '🔴 Alta' : pri === 'baja' ? '🟢 Baja' : '🟡 Media'}
  </span>`;
  const priDot = `<div class="pri-dot pri-${pri}"></div>`;

  return `
  <div class="task-item ${task.done ? 'done' : ''}" id="item-${task.id}">
    ${priDot}
    <div class="task-check ${task.done ? 'checked' : ''}" onclick="toggleTask('${task.id}')">
      ${task.done ? '✓' : ''}
    </div>
    <div class="task-body">
      <div class="task-name">${task.name}</div>
      <div class="task-meta">${task.subject} · ${task.daysLabel}</div>
      ${task.time ? `<div class="task-meta">🕐 ${task.time}</div>` : ''}
      ${task.desc ? `<div class="task-meta" style="margin-top:.3rem;font-style:italic;">
        ${task.desc.slice(0, 80)}${task.desc.length > 80 ? '…' : ''}
      </div>` : ''}
      <div style="margin-top:.4rem;">${badge}</div>
    </div>
    <div class="task-actions">
      <button class="btn btn-warn btn-sm" onclick="openEditTask('${task.id}')" title="Editar">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')" title="Eliminar">🗑️</button>
    </div>
  </div>`;
}

/* ===================== MODAL — AGREGAR / EDITAR TAREA ===================== */
function openAddTask() {
  document.getElementById('modal-title').textContent       = '📝 Nueva tarea';
  document.getElementById('edit-task-id').value            = '';
  document.getElementById('task-name').value               = '';
  document.getElementById('task-subject').value            = '';
  document.getElementById('task-date').value               = '';
  document.getElementById('task-time').value               = '';
  document.getElementById('task-priority').value           = 'media';
  document.getElementById('task-desc').value               = '';
  document.getElementById('task-reminder').value           = '';
  document.getElementById('modal-success').style.display  = 'none';
  document.getElementById('modal-error').style.display    = 'none';
  document.getElementById('task-modal').classList.add('open');
}

function openEditTask(id) {
  const t = store.getTask(id);
  if (!t) return;
  document.getElementById('modal-title').textContent       = '✏️ Editar tarea';
  document.getElementById('edit-task-id').value            = t.id;
  document.getElementById('task-name').value               = t.name;
  document.getElementById('task-subject').value            = t.subject;
  document.getElementById('task-date').value               = t.date;
  document.getElementById('task-time').value               = t.time;
  document.getElementById('task-priority').value           = t.priority;
  document.getElementById('task-desc').value               = t.desc;
  document.getElementById('task-reminder').value           = t.reminder;
  document.getElementById('modal-success').style.display  = 'none';
  document.getElementById('modal-error').style.display    = 'none';
  document.getElementById('task-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('task-modal').classList.remove('open');
}

function saveTask() {
  const name     = document.getElementById('task-name').value.trim();
  const subject  = document.getElementById('task-subject').value.trim();
  const date     = document.getElementById('task-date').value;
  const time     = document.getElementById('task-time').value;
  const priority = document.getElementById('task-priority').value;
  const desc     = document.getElementById('task-desc').value.trim();
  const reminder = document.getElementById('task-reminder').value;
  const editId   = document.getElementById('edit-task-id').value;

  if (!name || !subject || !date) {
    document.getElementById('modal-error').style.display = 'flex'; return;
  }
  document.getElementById('modal-error').style.display = 'none';

  if (editId) {
    const t = store.getTask(editId);
    t.name = name; t.subject = subject; t.date = date;
    t.time = time; t.priority = priority; t.desc = desc; t.reminder = reminder;
    store.updateTask(t);
  } else {
    const t = new Task(name, subject, date, time, priority, desc, reminder);
    store.addTask(t);
  }

  document.getElementById('modal-success').style.display = 'flex';

  if (reminder) {
    const rLabel = {
      '1h': '1 hora', '3h': '3 horas', '1d': '1 día', '2d': '2 días', '1w': '1 semana'
    }[reminder] || reminder;
    document.getElementById('remind-text').textContent =
      `Se ha programado un recordatorio para "${name}" (${subject}) — ${rLabel} antes de la fecha de entrega (${date}).`;
    setTimeout(() => {
      closeModal();
      document.getElementById('remind-modal').classList.add('open');
    }, 900);
  } else {
    setTimeout(() => closeModal(), 900);
  }

  renderHome();
  renderTasks();
  renderCalendar();
}

/* ===================== TOGGLE / ELIMINAR TAREA ===================== */
function toggleTask(id) {
  const t = store.getTask(id);
  if (!t) return;
  t.done = !t.done;
  store.updateTask(t);
  renderTasks();
  renderHome();
  if (t.done) showMotivationalToast();
}

function deleteTask(id) {
  if (!confirm('¿Eliminar esta tarea?')) return;
  store.removeTask(id);
  renderTasks();
  renderHome();
  renderCalendar();
}

/* ===================== CALENDARIO ===================== */
function renderCalendar() {
  const wrap = document.getElementById('calendar-wrap');
  const y = calCurrentDate.getFullYear();
  const m = calCurrentDate.getMonth();

  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const days   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  const firstDay    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays    = new Date(y, m, 0).getDate();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const taskDates = new Set(store.tasks.map(t => t.date));

  let html = `<div class="cal-header">
    <button class="btn btn-secondary btn-sm" onclick="calPrev()">‹</button>
    <h3>${months[m]} ${y}</h3>
    <button class="btn btn-secondary btn-sm" onclick="calNext()">›</button>
  </div>
  <div class="cal-grid">
    ${days.map(d => `<div class="cal-day-name">${d}</div>`).join('')}`;

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day other-month">${prevDays - firstDay + 1 + i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt      = new Date(y, m, d); dt.setHours(0, 0, 0, 0);
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dt.getTime() === today.getTime();
    const hasTask = taskDates.has(dateStr);
    const isSel   = calSelectedDate === dateStr;
    html += `<div class="cal-day${isToday ? ' today' : ''}${hasTask ? ' has-task' : ''}${isSel ? ' selected' : ''}"
      onclick="selectCalDay('${dateStr}')">${d}</div>`;
  }
  const total     = firstDay + daysInMonth;
  const remaining = total % 7 ? 7 - (total % 7) : 0;
  for (let i = 1; i <= remaining; i++) html += `<div class="cal-day other-month">${i}</div>`;
  html += `</div>`;

  wrap.innerHTML = html;
  renderCalDayTasks();
}

function calPrev() { calCurrentDate.setMonth(calCurrentDate.getMonth() - 1); renderCalendar(); }
function calNext() { calCurrentDate.setMonth(calCurrentDate.getMonth() + 1); renderCalendar(); }

function selectCalDay(dateStr) {
  calSelectedDate = dateStr;
  renderCalendar();
  renderCalDayTasks();
}

function renderCalDayTasks() {
  if (!calSelectedDate) {
    document.getElementById('cal-day-title').textContent = 'Selecciona un día para ver sus tareas';
    document.getElementById('cal-day-tasks').innerHTML   = '';
    return;
  }
  const tasks = store.tasks.filter(t => t.date === calSelectedDate);
  document.getElementById('cal-day-title').textContent = `📅 ${calSelectedDate} — ${tasks.length} tarea(s)`;
  if (!tasks.length) {
    document.getElementById('cal-day-tasks').innerHTML =
      `<div class="empty-state"><span>🌸</span>Nada programado para este día.</div>`;
  } else {
    document.getElementById('cal-day-tasks').innerHTML =
      `<div class="task-list">${tasks.map(taskHTML).join('')}</div>`;
  }
}

/* ===================== NOTAS ANTI-ESTRÉS ===================== */
function renderNotes() {
  document.getElementById('notes-grid').innerHTML = ANTI_STRESS_NOTES.map(n => `
    <div class="note-card" style="background:${n.bg};border:1px solid rgba(244,114,182,.18);">
      <div class="note-icon">${n.icon}</div>
      <div class="note-title" style="color:var(--text-dark);">${n.title}</div>
      <div class="note-text" style="color:var(--text-mid);">${n.text}</div>
    </div>`).join('');
}

/* ===================== PERFIL ===================== */
function renderProfile() {
  const u = store.user;
  document.getElementById('profile-avatar').textContent = u.initials;
  document.getElementById('profile-name').textContent   = u.name;
  document.getElementById('profile-sub').textContent    = `${u.career} · ${u.semester} semestre`;
  document.getElementById('profile-code').value         = u.code;
  document.getElementById('profile-email').value        = u.email || '';
  document.getElementById('profile-career').value       = u.career;
  document.getElementById('profile-uni').value          = u.university;
  document.getElementById('profile-stats').innerHTML = `
    <div class="stat-chip"><div class="stat-num">${store.tasks.length}</div><div class="stat-lbl">Tareas totales</div></div>
    <div class="stat-chip"><div class="stat-num" style="color:#10b981;">${store.completed.length}</div><div class="stat-lbl">Completadas</div></div>
    <div class="stat-chip"><div class="stat-num" style="color:#e11d48;">${store.pct}%</div><div class="stat-lbl">Progreso</div></div>`;
}

/* ===================== REGISTRO DE USO ===================== */
function renderUsage() {
  const stats    = tracker.getStats();
  const sessions = stats.sessions || [];

  // --- Resumen ---
  document.getElementById('usage-total').textContent   = stats.total;
  document.getElementById('usage-today').textContent   = stats.today;
  document.getElementById('usage-week').textContent    = stats.thisWeek;

  const avgMin = Math.floor(stats.avgDuration / 60);
  const avgSec = stats.avgDuration % 60;
  document.getElementById('usage-avg').textContent =
    stats.avgDuration > 0 ? `${avgMin}m ${avgSec}s` : '—';

  // --- Barra por día (últimos 7 días) ---
  const maxVisits = Math.max(...Object.values(stats.byDay), 1);
  const barsEl    = document.getElementById('usage-bars');
  barsEl.innerHTML = '';

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    last7.push(d.toISOString().slice(0, 10));
  }

  last7.forEach(day => {
    const count = stats.byDay[day] || 0;
    const label = new Date(day + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
    const pct   = Math.round((count / maxVisits) * 100);
    barsEl.innerHTML += `
      <div class="usage-bar-row">
        <span class="usage-bar-label">${label}</span>
        <div class="usage-bar-bg">
          <div class="usage-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="usage-bar-val">${count}</span>
      </div>`;
  });

  // --- Tabla de sesiones recientes (últimas 20) ---
  const tableEl = document.getElementById('usage-table-body');
  const recent  = [...sessions].reverse().slice(0, 20);

  if (!recent.length) {
    tableEl.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-light);padding:1.5rem;">Aún no hay registros</td></tr>`;
  } else {
    tableEl.innerHTML = recent.map((s, i) => {
      const dur = s.duration > 0
        ? `${Math.floor(s.duration / 60)}m ${s.duration % 60}s`
        : '< 30s';
      return `<tr>
        <td>${recent.length - i}</td>
        <td>${s.date}</td>
        <td>${s.time}</td>
        <td><span class="usage-chip">⏱️ ${dur}</span></td>
      </tr>`;
    }).join('');
  }
}

function clearUsageData() {
  if (!confirm('¿Borrar todo el historial de uso?')) return;
  tracker.clearAll();
  renderUsage();
}

/* ===================== ARRANQUE ===================== */
window.addEventListener('DOMContentLoaded', () => {
  createPetals();
  initTicker();
  showScreen('welcome');
  setupFirebaseAuth();
});

// Guardar duración al cerrar/recargar la página
window.addEventListener('beforeunload', () => tracker.endSession());
