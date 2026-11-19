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
let guidedActivityState = null;
let guideLastFocus = null;

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
  if (name === 'tasks') {
    renderTasks();
    store.refreshReminderStatuses().then(() => {
      if (document.getElementById('screen-tasks').classList.contains('active')) renderTasks();
    }).catch(error => {
      showAuthError(`No se pudo actualizar el estado de los recordatorios: ${error.message}`);
    });
  }
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
    firebaseAuth.onAuthStateChanged(user => {
      handleAuthState(user).catch(error => {
        appInitialized = false;
        showAuthError(`No se pudieron cargar tus datos: ${error.message}`);
      });
    }, error => {
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

async function handleAuthState(user) {
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

  try {
    await store.load(user.uid);
  } catch (error) {
    store.uid = null;
    throw error;
  }
  if (store.user) {
    await initApp();
    return;
  }

  document.getElementById('reg-name').value = user.displayName || '';
  document.getElementById('reg-google-email').textContent = user.email || '';
  document.getElementById('bottom-nav').style.display = 'none';
  showScreen('register');
}

/* ===================== REGISTRO DE PERFIL ACADÉMICO ===================== */
async function registerUser() {
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
    await store.saveUser();
    await initApp();
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
async function logout() {
  if (!confirm('¿Segura que quieres cerrar sesión?')) return;
  try {
    await tracker.endSession();
  } catch (error) {
    showAuthError(`No se pudo guardar el historial de uso: ${error.message}`);
    return;
  }
  if (!firebaseAuth) {
    showAuthError('No se pudo cerrar la sesión porque Firebase no está disponible.');
    return;
  }
  firebaseAuth.signOut().catch(error => {
    showAuthError(`No se pudo cerrar la sesión de Google: ${error.message}`);
  });
}

/* ===================== INICIO DE LA APP ===================== */
async function initApp() {
  if (appInitialized || !authenticatedUser) return;
  appInitialized = true;
  document.getElementById('bottom-nav').style.display = 'flex';
  showScreen('home');
  try {
    await tracker.startSession('home', authenticatedUser.uid);
  } catch (error) {
    showAuthError(`No se pudo registrar el uso de la aplicación: ${error.message}`);
  }
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
      <div style="font-weight:700;font-size:1rem;">${greeting}, ${u.name.split(' ')[0]}.</div>
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
    up.innerHTML = `<div class="empty-state"><span>✓</span>No tienes entregas próximas.</div>`;
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
      ${currentTab === 'done' ? 'Aún no has completado tareas.' : 'No hay tareas en esta lista. Agrega una nueva.'}
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
      ${reminderStatusHTML(task)}
      <div style="margin-top:.4rem;">${badge}</div>
    </div>
    <div class="task-actions">
      <button class="btn btn-warn btn-sm" onclick="openEditTask('${task.id}')" title="Editar">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')" title="Eliminar">🗑️</button>
    </div>
  </div>`;
}

function reminderStatusHTML(task) {
  if (!task.reminder) return '';

  const scheduledAt = task.reminderScheduledAt
    ? new Date(task.reminderScheduledAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const sentAt = task.reminderSentAt
    ? new Date(task.reminderSentAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const retryMessage = task.reminderAttempts
    ? `El servidor está reintentando el envío (intento ${task.reminderAttempts} de 5). Revisa los registros de Render.`
    : '';
  const statuses = {
    pending: {
      className: 'reminder-pending',
      text: retryMessage || `Correo programado para ${scheduledAt || 'la hora elegida'}. No se envía al guardar.`
    },
    sending: { className: 'reminder-sending', text: 'El servidor está enviando el correo.' },
    sent: {
      className: 'reminder-sent',
      text: `Correo enviado por el servidor${sentAt ? ` el ${sentAt}` : ''}. Si no aparece, revisa Spam.`
    },
    failed: {
      className: 'reminder-failed',
      text: 'No se pudo enviar. Revisa SMTP y los registros de Render.'
    }
  };
  const status = statuses[task.reminderStatus] || {
    className: 'reminder-missing',
    text: 'No hay correo programado. Edita y vuelve a guardar esta tarea.'
  };
  return `<div class="task-meta reminder-status ${status.className}">🔔 ${status.text}</div>`;
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

async function saveTask() {
  const name     = document.getElementById('task-name').value.trim();
  const subject  = document.getElementById('task-subject').value.trim();
  const date     = document.getElementById('task-date').value;
  const time     = document.getElementById('task-time').value;
  const priority = document.getElementById('task-priority').value;
  const desc     = document.getElementById('task-desc').value.trim();
  const reminder = document.getElementById('task-reminder').value;
  const editId   = document.getElementById('edit-task-id').value;
  let reminderAt = null;

  if (!name || !subject || !date) {
    document.getElementById('modal-error').style.display = 'flex'; return;
  }
  document.getElementById('modal-error').style.display = 'none';

  try {
    reminderAt = calculateReminderAt(date, time, reminder);
    if (editId) {
      const task = store.getTask(editId);
      if (!task) throw new Error('No se encontró la tarea que intentas editar.');
      await store.updateTask({
        ...task,
        name, subject, date, time, priority, desc, reminder, reminderAt
      });
    } else {
      const task = new Task(name, subject, date, time, priority, desc, reminder);
      task.reminderAt = reminderAt;
      await store.addTask(task);
    }
  } catch (error) {
    const modalError = document.getElementById('modal-error');
    modalError.textContent = `⚠️ No se pudo guardar la tarea: ${error.message}`;
    modalError.style.display = 'flex';
    return;
  }

  document.getElementById('modal-error').textContent = '⚠️ Completa los campos requeridos.';
  document.getElementById('modal-success').style.display = 'flex';

  if (reminder) {
    const scheduledAt = new Date(reminderAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('remind-text').textContent =
      `El correo quedó programado para ${scheduledAt}. Se enviará a tu cuenta de Google a esa hora; guardar la tarea no lo envía inmediatamente.`;
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

function calculateReminderAt(date, time, reminder) {
  if (!reminder) return null;
  const dueAt = new Date(`${date}T${time || '09:00'}:00`);
  if (Number.isNaN(dueAt.getTime())) throw new Error('La fecha u hora de entrega no es válida.');
  const offsets = { '1h': 3600000, '3h': 10800000, '1d': 86400000, '2d': 172800000, '1w': 604800000 };
  const offset = offsets[reminder];
  if (!offset) throw new Error('El intervalo del recordatorio no es válido.');
  const reminderAt = new Date(dueAt.getTime() - offset);
  if (reminderAt.getTime() <= Date.now()) {
    throw new Error('La hora de ese recordatorio ya pasó. Elige otra fecha u otro intervalo.');
  }
  return reminderAt.toISOString();
}

/* ===================== TOGGLE / ELIMINAR TAREA ===================== */
async function toggleTask(id) {
  const t = store.getTask(id);
  if (!t) return;
  try {
    await store.updateTask({ ...t, done: !t.done });
  } catch (error) {
    showAuthError(`No se pudo actualizar la tarea: ${error.message}`);
    return;
  }
  renderTasks();
  renderHome();
  if (store.getTask(id).done) showMotivationalToast();
}

async function deleteTask(id) {
  if (!confirm('¿Eliminar esta tarea?')) return;
  try {
    await store.removeTask(id);
  } catch (error) {
    showAuthError(`No se pudo eliminar la tarea: ${error.message}`);
    return;
  }
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
      `<div class="empty-state"><span>—</span>Nada programado para este día.</div>`;
  } else {
    document.getElementById('cal-day-tasks').innerHTML =
      `<div class="task-list">${tasks.map(taskHTML).join('')}</div>`;
  }
}

/* ===================== NOTAS ANTI-ESTRÉS ===================== */
function renderNotes() {
  const methods = [
    { id: 'breathing', label: 'Respiración consciente (4-7-8)' },
    { id: 'music', label: 'Música y sonidos tranquilos' },
    { id: 'hydration', label: 'Hidratación y pausa' },
    { id: 'pomodoro', label: 'Pomodoro: estudio y descanso' },
    { id: 'sleep', label: 'Pausa para descansar' },
    { id: 'movement', label: 'Pausa de movimiento' },
    { id: 'gratitude', label: 'Diario de gratitud' },
    { id: 'mindfulness', label: 'Mindfulness' },
  ];
  const select = document.getElementById('relaxation-method');
  select.innerHTML = `<option value="">Elige una opción</option>${methods.map(method =>
    `<option value="${method.id}">${method.label}</option>`
  ).join('')}`;
  select.value = store.relaxationMethod || '';
  document.getElementById('relaxation-status').textContent = store.relaxationMethod
    ? 'Tu preferencia está guardada en tu cuenta.'
    : 'Aún no has elegido un método.';
  document.getElementById('notes-grid').innerHTML = ANTI_STRESS_NOTES.map(n => `
    <button class="note-card" type="button" style="--note-background:${n.bg};"
      onclick="openGuidedActivity('${n.id}')" aria-label="Iniciar guía: ${n.title}">
      <span class="note-card-top">
        <span class="note-icon" aria-hidden="true">${n.icon}</span>
        <span class="note-duration">${n.duration}</span>
      </span>
      <span class="note-title">${n.title}</span>
      <span class="note-text">${n.text}</span>
      <span class="note-start">Iniciar guía <span aria-hidden="true">→</span></span>
    </button>`).join('');
}

function openGuidedActivity(activityId) {
  const activity = ANTI_STRESS_NOTES.find(note => note.id === activityId);
  if (!activity) {
    console.error(`No se encontró la actividad guiada: ${activityId}`);
    return;
  }

  clearInterval(guidedActivityState && guidedActivityState.interval);
  const cycles = activity.cycles || 1;
  const phases = Array.from({ length: cycles }, (_, cycleIndex) =>
    activity.steps.map((step, stepIndex) => ({ ...step, cycle: cycleIndex + 1, step: stepIndex + 1 }))
  ).flat();
  guidedActivityState = {
    activity,
    phases,
    phaseIndex: 0,
    remainingMs: phases[0].seconds * 1000,
    phaseEndsAt: null,
    completed: false,
    running: false,
    interval: null
  };
  guideLastFocus = document.activeElement;

  const modal = document.getElementById('guide-modal');
  document.getElementById('guide-title').textContent = activity.title;
  document.getElementById('guide-intro').textContent = activity.text;
  document.getElementById('guide-safety').textContent = activity.safety || '';
  document.getElementById('guide-safety').hidden = !activity.safety;
  document.getElementById('guide-generic-icon').textContent = activity.icon;
  document.getElementById('guide-visual').classList.toggle('is-breathing', activity.id === 'breathing');
  document.getElementById('lung-illustration').hidden = activity.id !== 'breathing';
  document.getElementById('guide-generic-icon').hidden = activity.id === 'breathing';
  document.body.classList.add('guide-open');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  renderGuidedPhase(true);
  document.getElementById('guide-close').focus();
}

function renderGuidedPhase(resetVisual = false) {
  if (!guidedActivityState) return;
  const state = guidedActivityState;
  const activity = state.activity;
  const phase = state.phases[state.phaseIndex];
  const visual = document.getElementById('guide-visual');
  const startButton = document.getElementById('guide-start');
  const breathState = state.running ? phase.breath || 'rest' : 'rest';

  if (state.completed) {
    document.getElementById('guide-phase-title').textContent = 'Actividad completada';
    document.getElementById('guide-instruction').textContent = 'Tómate un momento para notar cómo te sientes. Puedes cerrar la guía cuando quieras.';
    document.getElementById('guide-phase-count').textContent = 'Buen trabajo, hiciste una pausa para ti.';
    document.getElementById('guide-timer').textContent = '00:00';
    document.getElementById('guide-progress-fill').style.width = '100%';
    document.getElementById('guide-progress').setAttribute('aria-valuenow', '100');
    startButton.textContent = 'Completado';
    startButton.disabled = true;
    visual.dataset.breath = 'rest';
    return;
  }

  document.getElementById('guide-phase-title').textContent = phase.title;
  document.getElementById('guide-instruction').textContent = phase.instruction;
  document.getElementById('guide-phase-count').textContent =
    `Paso ${phase.step} de ${activity.steps.length}` +
    (activity.cycles > 1 ? ` · Ciclo ${phase.cycle} de ${activity.cycles}` : '');
  startButton.textContent = state.running
    ? 'Pausar'
    : state.remainingMs === phase.seconds * 1000 ? 'Comenzar' : 'Continuar';
  startButton.disabled = false;
  visual.dataset.breath = breathState;
  visual.style.setProperty('--breath-duration', `${phase.seconds}s`);

  if (resetVisual && state.running && phase.breath === 'inhale') {
    visual.dataset.breath = 'rest';
    requestAnimationFrame(() => {
      if (guidedActivityState === state && !state.completed) visual.dataset.breath = 'inhale';
    });
  }
  updateGuidedTimer();
}

function updateGuidedTimer() {
  if (!guidedActivityState || guidedActivityState.completed) return;
  const state = guidedActivityState;
  const phase = state.phases[state.phaseIndex];
  const remainingMs = state.running
    ? Math.max(0, state.phaseEndsAt - Date.now())
    : state.remainingMs;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const totalSeconds = state.phases.reduce((total, item) => total + item.seconds, 0);
  const elapsedSeconds = totalSeconds - (
    state.phases.slice(state.phaseIndex + 1).reduce((total, item) => total + item.seconds, 0) +
    remainingSeconds
  );
  const progress = Math.max(0, Math.min(100, Math.floor((elapsedSeconds / totalSeconds) * 100)));

  document.getElementById('guide-timer').textContent = formatGuideTime(remainingSeconds);
  document.getElementById('guide-progress-fill').style.width = `${progress}%`;
  document.getElementById('guide-progress').setAttribute('aria-valuenow', String(progress));
  document.getElementById('guide-progress').setAttribute('aria-valuetext', `${progress}% completado`);
}

function formatGuideTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function tickGuidedActivity() {
  const state = guidedActivityState;
  if (!state || !state.running) return;

  const now = Date.now();
  while (state.running && now >= state.phaseEndsAt) {
    state.phaseIndex++;
    if (state.phaseIndex >= state.phases.length) {
      state.completed = true;
      state.running = false;
      clearInterval(state.interval);
      state.interval = null;
      renderGuidedPhase();
      return;
    }
    state.remainingMs = state.phases[state.phaseIndex].seconds * 1000;
    state.phaseEndsAt += state.remainingMs;
    renderGuidedPhase(true);
  }

  if (state.running) updateGuidedTimer();
}

function toggleGuidedActivity() {
  const state = guidedActivityState;
  if (!state || state.completed) return;

  if (state.running) {
    state.remainingMs = Math.max(0, state.phaseEndsAt - Date.now());
    state.running = false;
    clearInterval(state.interval);
    state.interval = null;
  } else {
    state.running = true;
    state.phaseEndsAt = Date.now() + state.remainingMs;
    state.interval = setInterval(tickGuidedActivity, 200);
  }
  renderGuidedPhase();
}

function restartGuidedActivity() {
  if (!guidedActivityState) return;
  const state = guidedActivityState;
  clearInterval(state.interval);
  state.phaseIndex = 0;
  state.remainingMs = state.phases[0].seconds * 1000;
  state.phaseEndsAt = null;
  state.completed = false;
  state.running = false;
  state.interval = null;
  renderGuidedPhase(true);
}

function closeGuidedActivity() {
  const modal = document.getElementById('guide-modal');
  if (!modal.classList.contains('open')) return;
  if (guidedActivityState) clearInterval(guidedActivityState.interval);
  guidedActivityState = null;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('guide-open');
  if (guideLastFocus && guideLastFocus.isConnected) guideLastFocus.focus();
}

async function saveRelaxationMethod() {
  const method = document.getElementById('relaxation-method').value;
  if (!method) {
    document.getElementById('relaxation-status').textContent = 'Elige un método antes de guardar.';
    return;
  }
  try {
    await store.saveRelaxationMethod(method);
    document.getElementById('relaxation-status').textContent = 'Método guardado en tu cuenta.';
  } catch (error) {
    document.getElementById('relaxation-status').textContent = `No se pudo guardar: ${error.message}`;
  }
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
    <div class="stat-chip"><div class="stat-num" style="color:var(--rose-600);">${store.pct}%</div><div class="stat-lbl">Progreso</div></div>`;
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

async function clearUsageData() {
  if (!confirm('¿Borrar todo el historial de uso?')) return;
  try {
    await tracker.clearAll();
  } catch (error) {
    showAuthError(`No se pudo borrar el historial: ${error.message}`);
    return;
  }
  renderUsage();
}

/* ===================== ARRANQUE ===================== */
window.addEventListener('DOMContentLoaded', () => {
  initTicker();
  showScreen('welcome');
  setupFirebaseAuth();
});

document.addEventListener('keydown', event => {
  const modal = document.getElementById('guide-modal');
  if (!modal || !modal.classList.contains('open')) return;
  if (event.key === 'Escape') {
    closeGuidedActivity();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = [...modal.querySelectorAll('button:not([disabled])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

// Guardar duración al cerrar/recargar la página
window.addEventListener('beforeunload', () => {
  tracker.endSession().catch(error => console.error('No se pudo guardar la duración final:', error));
});
