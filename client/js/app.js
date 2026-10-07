/* ==========================================================================
   STATE MANAGEMENT & LOCAL STORAGE
   ========================================================================== */
const STORAGE_KEY_TASKS = 'studyflow_tasks_v1';
const STORAGE_KEY_LOGS = 'studyflow_logs_v1';
const STORAGE_KEY_SETTINGS = 'studyflow_settings_v1';

let appState = {
  activeTab: 'timer',
  taskViewMode: 'list', // 'list' or 'kanban'
  activeTaskId: null,
  
  // Timer State
  timerMode: 'focus', // 'focus', 'shortBreak', 'longBreak'
  timerRunning: false,
  timerSeconds: 25 * 60,
  timerTotalDuration: 25 * 60,
  timerInterval: null,
  customDurations: {
    focus: 25,
    shortBreak: 5,
    longBreak: 15
  },

  // Tasks Data
  tasks: [],

  // Analytics Logs (Array of { id, timestamp, durationMinutes, taskId, category })
  focusLogs: [],
  
  // User Settings
  soundVolume: 0.5
};

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */
window.onload = function () {
  loadLocalStorage();
  initializeCharts();
  renderTasks();
  updateTimerDisplay();
  updateTargetTaskUI();
  updateAnalyticsStats();
  setupKeyboardShortcuts();
};

function loadLocalStorage() {
  try {
    const savedTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    if (savedTasks) appState.tasks = JSON.parse(savedTasks);

    const savedLogs = localStorage.getItem(STORAGE_KEY_LOGS);
    if (savedLogs) appState.focusLogs = JSON.parse(savedLogs);

    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const parsedSettings = JSON.parse(savedSettings);
      if (parsedSettings.customDurations) appState.customDurations = parsedSettings.customDurations;
      document.getElementById('custom-focus').value = appState.customDurations.focus;
      document.getElementById('custom-short').value = appState.customDurations.shortBreak;
      document.getElementById('custom-long').value = appState.customDurations.longBreak;
    }

    // Set active timer initial duration based on settings
    appState.timerSeconds = appState.customDurations.focus * 60;
    appState.timerTotalDuration = appState.timerSeconds;
  } catch (err) {
    console.error('Failed to load local storage:', err);
  }
}

function saveLocalStorage() {
  localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(appState.tasks));
  localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(appState.focusLogs));
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({
    customDurations: appState.customDurations
  }));
}

/* ==========================================================================
   TAB SWITCHING LOGIC
   ========================================================================== */
function switchTab(tabName) {
  appState.activeTab = tabName;
  
  // Hide all tabs
  document.getElementById('view-timer').classList.add('hidden');
  document.getElementById('view-tasks').classList.add('hidden');
  document.getElementById('view-analytics').classList.add('hidden');

  // Unhighlight tab buttons
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.remove('bg-brand-600', 'text-white', 'shadow-md');
    btn.classList.add('text-gray-400');
  });

  // Show selected tab & update button styling
  if (tabName === 'timer') {
    document.getElementById('view-timer').classList.remove('hidden');
    document.getElementById('tab-timer-btn').classList.add('bg-brand-600', 'text-white', 'shadow-md');
    document.getElementById('tab-timer-btn').classList.remove('text-gray-400');
  } else if (tabName === 'tasks') {
    document.getElementById('view-tasks').classList.remove('hidden');
    document.getElementById('tab-tasks-btn').classList.add('bg-brand-600', 'text-white', 'shadow-md');
    document.getElementById('tab-tasks-btn').classList.remove('text-gray-400');
    renderTasks();
  } else if (tabName === 'analytics') {
    document.getElementById('view-analytics').classList.remove('hidden');
    document.getElementById('tab-analytics-btn').classList.add('bg-brand-600', 'text-white', 'shadow-md');
    document.getElementById('tab-analytics-btn').classList.remove('text-gray-400');
    updateAnalyticsStats();
  }
}

/* ==========================================================================
   WEB AUDIO API - AMBIENT SOUND & BEEP SYNTHESIZER
   ========================================================================== */
let audioCtx = null;
let ambientNodes = {
  rain: null,
  whitenoise: null,
  cafe: null,
  synth: null
};

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Play Beep on Timer Completion
function playTimerCompletionSound() {
  initAudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
  osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.4); // A5

  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.8);
}

// Web Audio Noise Generators
function setAmbientVolume(type, val) {
  initAudioContext();
  const volume = parseFloat(val) / 100;
  const labelEl = document.getElementById(`${type}-vol-val`);
  if (labelEl) labelEl.textContent = volume > 0 ? `${Math.round(volume * 100)}%` : 'Off';

  // Update ambient indicator badge
  checkAnyAmbientActive();

  if (!ambientNodes[type]) {
    if (volume > 0) createAmbientSource(type);
    else return;
  }

  if (ambientNodes[type] && ambientNodes[type].gainNode) {
    ambientNodes[type].gainNode.gain.setValueAtTime(volume * 0.15, audioCtx.currentTime);
  }
}

function createAmbientSource(type) {
  const bufferSize = 2 * audioCtx.sampleRate;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);

  // Synthesize noise buffer
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const whiteNoise = audioCtx.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.loop = true;

  const filter = audioCtx.createBiquadFilter();
  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);

  if (type === 'rain') {
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, audioCtx.currentTime);
  } else if (type === 'whitenoise') {
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, audioCtx.currentTime);
  } else if (type === 'cafe') {
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, audioCtx.currentTime);
  } else if (type === 'synth') {
    // Simple ambient sine oscillator pair
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, audioCtx.currentTime); // A2 drone
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    ambientNodes[type] = { osc, gainNode };
    return;
  }

  whiteNoise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  whiteNoise.start();
  ambientNodes[type] = { whiteNoise, filter, gainNode };
}

function checkAnyAmbientActive() {
  const active = ['rain', 'whitenoise', 'cafe', 'synth'].some(type => {
    const input = document.querySelector(`input[oninput*="${type}"]`);
    return input && parseInt(input.value) > 0;
  });
  const indicator = document.getElementById('ambient-indicator');
  if (indicator) {
    if (active) indicator.classList.remove('hidden');
    else indicator.classList.add('hidden');
  }
}

function toggleAmbientMenu() {
  const popover = document.getElementById('ambient-popover');
  popover.classList.toggle('hidden');
}

function quickToggleAmbient(type) {
  const currentVal = ambientNodes[type] && ambientNodes[type].gainNode ? 0 : 50;
  setAmbientVolume(type, currentVal);
}

/* ==========================================================================
   POMODORO TIMER LOGIC
   ========================================================================== */
function setTimerMode(mode) {
  appState.timerMode = mode;
  
  // Stop running timer
  if (appState.timerRunning) toggleTimer();

  // Update button styling
  document.querySelectorAll('.timer-mode-btn').forEach(btn => {
    btn.classList.remove('active', 'bg-brand-600', 'text-white', 'shadow');
    btn.classList.add('text-gray-400');
  });

  const modeBtn = document.getElementById(`mode-${mode}`);
  if (modeBtn) {
    modeBtn.classList.add('active', 'bg-brand-600', 'text-white', 'shadow');
    modeBtn.classList.remove('text-gray-400');
  }

  // Update duration
  const minutes = appState.customDurations[mode] || 25;
  appState.timerSeconds = minutes * 60;
  appState.timerTotalDuration = minutes * 60;

  // Update mode labels
  const labelMap = {
    focus: 'Focus Time',
    shortBreak: 'Short Break',
    longBreak: 'Long Break'
  };
  document.getElementById('timer-mode-label').textContent = labelMap[mode];

  updateTimerDisplay();
}

function updateCustomDurations() {
  const focusVal = parseInt(document.getElementById('custom-focus').value) || 25;
  const shortVal = parseInt(document.getElementById('custom-short').value) || 5;
  const longVal = parseInt(document.getElementById('custom-long').value) || 15;

  appState.customDurations = {
    focus: Math.max(1, focusVal),
    shortBreak: Math.max(1, shortVal),
    longBreak: Math.max(1, longVal)
  };

  saveLocalStorage();

  // Update current timer if not running
  if (!appState.timerRunning) {
    setTimerMode(appState.timerMode);
  }
}

function toggleTimer() {
  initAudioContext();
  appState.timerRunning = !appState.timerRunning;

  const btnText = document.getElementById('timer-btn-text');
  const timerIcon = document.getElementById('timer-icon');
  const overlayBtnText = document.getElementById('overlay-btn-text');
  const overlayTimerIcon = document.getElementById('overlay-timer-icon');

  if (appState.timerRunning) {
    if (btnText) btnText.textContent = 'Pause';
    if (timerIcon) timerIcon.className = 'fa-solid fa-pause text-sm';
    if (overlayBtnText) overlayBtnText.textContent = 'Pause';
    if (overlayTimerIcon) overlayTimerIcon.className = 'fa-solid fa-pause text-base';

    // Glow animation
    document.getElementById('timer-glow').classList.add('animate-pulse-slow');

    appState.timerInterval = setInterval(() => {
      if (appState.timerSeconds > 0) {
        appState.timerSeconds--;
        updateTimerDisplay();
      } else {
        handleTimerCompletion();
      }
    }, 1000);
  } else {
    if (btnText) btnText.textContent = 'Start';
    if (timerIcon) timerIcon.className = 'fa-solid fa-play text-sm';
    if (overlayBtnText) overlayBtnText.textContent = 'Start';
    if (overlayTimerIcon) overlayTimerIcon.className = 'fa-solid fa-play text-base';

    document.getElementById('timer-glow').classList.remove('animate-pulse-slow');
    clearInterval(appState.timerInterval);
  }
}

function resetTimer() {
  if (appState.timerRunning) toggleTimer();
  const minutes = appState.customDurations[appState.timerMode] || 25;
  appState.timerSeconds = minutes * 60;
  updateTimerDisplay();
}

function skipTimer() {
  if (confirm("Skip this session?")) {
    resetTimer();
  }
}

function updateTimerDisplay() {
  const minutes = Math.floor(appState.timerSeconds / 60);
  const seconds = appState.timerSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // Update Display UI Elements
  document.getElementById('timer-display').textContent = formatted;
  document.getElementById('overlay-timer-display').textContent = formatted;

  // Update Page Title
  document.title = `(${formatted}) StudyFlow - ${appState.timerMode === 'focus' ? 'Focus' : 'Break'}`;

  // Update SVG Progress Ring
  const circle = document.getElementById('timer-progress-circle');
  if (circle) {
    const total = appState.timerTotalDuration;
    const fraction = appState.timerSeconds / total;
    const circumference = 2 * Math.PI * 44; // 276.46
    const strokeDashoffset = circumference * (1 - fraction);
    circle.style.strokeDashoffset = strokeDashoffset;
  }
}

function handleTimerCompletion() {
  toggleTimer();
  playTimerCompletionSound();

  // Trigger Browser Notification
  if (Notification.permission === 'granted') {
    new Notification("StudyFlow Timer Complete!", {
      body: appState.timerMode === 'focus' ? "Great focus session! Time for a break." : "Break is over! Ready to focus?",
      icon: "https://cdn-icons-png.flaticon.com/512/3209/3209995.png"
    });
  }

  // Log stats if focus session completed
  if (appState.timerMode === 'focus') {
    const durationMin = appState.customDurations.focus;
    
    // Log Session
    appState.focusLogs.push({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      durationMinutes: durationMin,
      taskId: appState.activeTaskId,
      category: getActiveTaskCategory()
    });

    // Increment target task pomodoro count
    if (appState.activeTaskId) {
      const task = appState.tasks.find(t => t.id === appState.activeTaskId);
      if (task) {
        task.completedPomodoros = (task.completedPomodoros || 0) + 1;
        // Auto complete if target reached
        if (task.completedPomodoros >= task.estimatedPomodoros) {
          task.completed = true;
          task.status = 'done';
        }
      }
    }

    saveLocalStorage();
    updateTargetTaskUI();
    updateAnalyticsStats();
    
    alert("🎉 Focus session completed! Earned 1 Tomato 🍅");
    setTimerMode('shortBreak');
  } else {
    alert("Break complete! Time to focus.");
    setTimerMode('focus');
  }
}

function requestNotificationPermission() {
  if (!("Notification" in window)) {
    alert("This browser does not support desktop notifications.");
    return;
  }
  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      alert("Desktop notifications enabled!");
    }
  });
}

/* ==========================================================================
   TASK MANAGEMENT ENGINE
   ========================================================================== */
function renderTasks() {
  const container = document.getElementById('tasks-list-container');
  const searchQuery = document.getElementById('task-search-input').value.toLowerCase();
  const catFilter = document.getElementById('task-category-filter').value;
  const statusFilter = document.getElementById('task-status-filter').value;

  // Filter tasks
  let filtered = appState.tasks.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(searchQuery) || (t.desc && t.desc.toLowerCase().includes(searchQuery));
    const matchesCat = catFilter === 'all' || t.category === catFilter;
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'active' && !t.completed) || 
      (statusFilter === 'completed' && t.completed);
    return matchesSearch && matchesCat && matchesStatus;
  });

  // Update pending badge
  const pendingCount = appState.tasks.filter(t => !t.completed).length;
  document.getElementById('pending-count-badge').textContent = pendingCount;

  if (appState.taskViewMode === 'list') {
    document.getElementById('tasks-list-container').classList.remove('hidden');
    document.getElementById('tasks-kanban-container').classList.add('hidden');

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 border border-dashed border-dark-border rounded-2xl bg-dark-card/40">
          <i class="fa-solid fa-clipboard-list text-3xl text-gray-600 mb-2"></i>
          <p class="text-gray-400 text-sm">No tasks found.</p>
          <button onclick="openAddTaskModal()" class="mt-2 text-xs text-brand-400 underline hover:text-brand-300">Create a new task</button>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(t => renderTaskCardHTML(t)).join('');
  } else {
    // Render Kanban Columns
    document.getElementById('tasks-list-container').classList.add('hidden');
    document.getElementById('tasks-kanban-container').classList.remove('hidden');

    renderKanbanColumns(filtered);
  }
}

function renderTaskCardHTML(task) {
  const isTarget = appState.activeTaskId === task.id;
  const priorityColors = {
    P1: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    P2: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    P3: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  };

  const categoryIcons = {
    Study: '📚 Study',
    Work: '💼 Work',
    Life: '🌿 Life'
  };

  const subtasksDone = task.subtasks ? task.subtasks.filter(s => s.completed).length : 0;
  const subtasksTotal = task.subtasks ? task.subtasks.length : 0;

  return `
    <div class="bg-dark-card border ${isTarget ? 'border-brand-500 shadow-lg shadow-brand-500/10' : 'border-dark-border'} hover:border-gray-600 rounded-2xl p-4 transition-all duration-200" draggable="true" ondragstart="handleDragStart(event, '${task.id}')">
      <div class="flex items-start justify-between gap-3">
        
        <!-- Checkbox & Main Info -->
        <div class="flex items-start space-x-3 flex-1">
          <button onclick="toggleTaskCompletion('${task.id}')" class="mt-0.5 text-lg text-gray-500 hover:text-brand-400 transition-all">
            ${task.completed ? '<i class="fa-solid fa-circle-check text-emerald-400"></i>' : '<i class="fa-regular fa-circle"></i>'}
          </button>

          <div class="space-y-1 flex-1">
            <div class="flex items-center space-x-2 flex-wrap">
              <h4 class="text-sm font-semibold ${task.completed ? 'line-through text-gray-500' : 'text-gray-100'}">${escapeHTML(task.title)}</h4>
              
              <!-- Priority Badge -->
              <span class="text-[10px] px-2 py-0.5 rounded-md border font-bold ${priorityColors[task.priority] || priorityColors.P2}">
                ${task.priority}
              </span>

              <!-- Category Badge -->
              <span class="text-[10px] px-2 py-0.5 rounded-md bg-dark-bg border border-dark-border text-gray-300">
                ${categoryIcons[task.category] || '📌 ' + task.category}
              </span>
            </div>

            ${task.desc ? `<p class="text-xs text-gray-400 line-clamp-2">${escapeHTML(task.desc)}</p>` : ''}

            <!-- Subtasks & Pomodoro Info Bar -->
            <div class="flex items-center space-x-4 pt-2 text-[11px] text-gray-400">
              <span class="flex items-center text-rose-400">
                <i class="fa-solid fa-apple-whole mr-1"></i> ${task.completedPomodoros || 0} / ${task.estimatedPomodoros || 1} 🍅
              </span>

              ${subtasksTotal > 0 ? `
                <span class="flex items-center">
                  <i class="fa-solid fa-list-check mr-1"></i> ${subtasksDone}/${subtasksTotal} subtasks
                </span>
              ` : ''}

              ${task.dueDate ? `
                <span class="flex items-center">
                  <i class="fa-regular fa-calendar mr-1"></i> Due ${task.dueDate}
                </span>
              ` : ''}
            </div>

            <!-- Subtasks Checklist Dropdown if exists -->
            ${task.subtasks && task.subtasks.length > 0 ? `
              <div class="mt-2 pt-2 border-t border-dark-border/60 space-y-1">
                ${task.subtasks.map((st, idx) => `
                  <div class="flex items-center space-x-2 text-xs text-gray-300">
                    <button onclick="toggleSubtask('${task.id}', ${idx})" class="text-gray-500 hover:text-emerald-400">
                      ${st.completed ? '<i class="fa-solid fa-square-check text-emerald-400"></i>' : '<i class="fa-regular fa-square"></i>'}
                    </button>
                    <span class="${st.completed ? 'line-through text-gray-500' : ''}">${escapeHTML(st.title)}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}

          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center space-x-2">
          <!-- Set Target Button -->
          <button onclick="setFocusTarget('${task.id}')" class="px-2.5 py-1 rounded-xl text-xs font-semibold ${isTarget ? 'bg-rose-500 text-white' : 'bg-dark-bg border border-dark-border text-gray-300 hover:border-brand-500 hover:text-brand-400'} transition-all" title="Focus on this task">
            <i class="fa-solid fa-bullseye mr-1"></i> ${isTarget ? 'Active' : 'Focus'}
          </button>

          <button onclick="openEditTaskModal('${task.id}')" class="p-1.5 text-gray-400 hover:text-white transition-all"><i class="fa-solid fa-pen"></i></button>
          <button onclick="deleteTask('${task.id}')" class="p-1.5 text-gray-400 hover:text-rose-400 transition-all"><i class="fa-solid fa-trash-can"></i></button>
        </div>

      </div>
    </div>
  `;
}

function renderKanbanColumns(tasks) {
  const todoCol = document.getElementById('kanban-col-todo');
  const inProgressCol = document.getElementById('kanban-col-in-progress');
  const doneCol = document.getElementById('kanban-col-done');

  const todoTasks = tasks.filter(t => !t.completed && (t.status === 'todo' || !t.status));
  const inProgressTasks = tasks.filter(t => !t.completed && t.status === 'in-progress');
  const doneTasks = tasks.filter(t => t.completed || t.status === 'done');

  document.getElementById('kanban-todo-count').textContent = todoTasks.length;
  document.getElementById('kanban-in-progress-count').textContent = inProgressTasks.length;
  document.getElementById('kanban-done-count').textContent = doneTasks.length;

  todoCol.innerHTML = todoTasks.map(t => renderTaskCardHTML(t)).join('') || '<div class="text-xs text-gray-600 text-center py-6">Empty</div>';
  inProgressCol.innerHTML = inProgressTasks.map(t => renderTaskCardHTML(t)).join('') || '<div class="text-xs text-gray-600 text-center py-6">Empty</div>';
  doneCol.innerHTML = doneTasks.map(t => renderTaskCardHTML(t)).join('') || '<div class="text-xs text-gray-600 text-center py-6">Empty</div>';
}

function setTaskViewMode(mode) {
  appState.taskViewMode = mode;
  const listBtn = document.getElementById('view-mode-list-btn');
  const kanbanBtn = document.getElementById('view-mode-kanban-btn');

  if (mode === 'list') {
    listBtn.className = 'px-3 py-1 rounded-lg text-xs font-medium bg-brand-600 text-white shadow';
    kanbanBtn.className = 'px-3 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white';
  } else {
    kanbanBtn.className = 'px-3 py-1 rounded-lg text-xs font-medium bg-brand-600 text-white shadow';
    listBtn.className = 'px-3 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white';
  }
  renderTasks();
}

/* Kanban Drag & Drop */
let draggedTaskId = null;
function handleDragStart(e, taskId) {
  draggedTaskId = taskId;
  e.dataTransfer.setData('text/plain', taskId);
}

function handleDragOver(e) {
  e.preventDefault();
}

function handleDrop(e, status) {
  e.preventDefault();
  if (!draggedTaskId) return;

  const task = appState.tasks.find(t => t.id === draggedTaskId);
  if (task) {
    task.status = status;
    if (status === 'done') {
      task.completed = true;
    } else {
      task.completed = false;
    }
    saveLocalStorage();
    renderTasks();
  }
  draggedTaskId = null;
}

/* Task Actions */
function setFocusTarget(taskId) {
  appState.activeTaskId = taskId;
  updateTargetTaskUI();
  renderTasks();
  switchTab('timer');
}

function updateTargetTaskUI() {
  const container = document.getElementById('active-task-container');
  const overlayBadge = document.getElementById('overlay-task-title');
  const counterEl = document.getElementById('target-pomodoro-counter');

  if (!appState.activeTaskId) {
    container.innerHTML = `
      <div class="text-center text-gray-500 text-sm py-2">
        <i class="fa-regular fa-square-check text-2xl mb-1 opacity-50"></i>
        <p>No active focus task selected.</p>
        <button onclick="switchTab('tasks')" class="text-brand-400 underline text-xs mt-1 hover:text-brand-300">Pick or create one from Tasks</button>
      </div>
    `;
    if (overlayBadge) overlayBadge.textContent = "No Active Task Selected";
    if (counterEl) counterEl.innerHTML = `<span>0</span> / <span>0</span> <span class="text-rose-500 ml-1">🍅</span>`;
    return;
  }

  const task = appState.tasks.find(t => t.id === appState.activeTaskId);
  if (!task) {
    appState.activeTaskId = null;
    updateTargetTaskUI();
    return;
  }

  container.innerHTML = `
    <div class="flex items-center justify-between">
      <div>
        <span class="text-[10px] px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 font-semibold mb-1 inline-block">${task.category}</span>
        <h4 class="text-sm font-bold text-white">${escapeHTML(task.title)}</h4>
        ${task.desc ? `<p class="text-xs text-gray-400 line-clamp-1">${escapeHTML(task.desc)}</p>` : ''}
      </div>
      <button onclick="setFocusTarget(null)" class="text-xs text-gray-500 hover:text-gray-300"><i class="fa-solid fa-xmark"></i> Clear</button>
    </div>
  `;

  if (overlayBadge) overlayBadge.textContent = task.title;
  if (counterEl) {
    counterEl.innerHTML = `<span>${task.completedPomodoros || 0}</span> / <span>${task.estimatedPomodoros || 1}</span> <span class="text-rose-500 ml-1">🍅</span>`;
  }
}

function toggleTaskCompletion(taskId) {
  const task = appState.tasks.find(t => t.id === taskId);
  if (task) {
    task.completed = !task.completed;
    task.status = task.completed ? 'done' : 'todo';
    saveLocalStorage();
    renderTasks();
    updateAnalyticsStats();
  }
}

function toggleSubtask(taskId, subtaskIdx) {
  const task = appState.tasks.find(t => t.id === taskId);
  if (task && task.subtasks && task.subtasks[subtaskIdx]) {
    task.subtasks[subtaskIdx].completed = !task.subtasks[subtaskIdx].completed;
    saveLocalStorage();
    renderTasks();
  }
}

function deleteTask(taskId) {
  if (confirm("Delete this task?")) {
    appState.tasks = appState.tasks.filter(t => t.id !== taskId);
    if (appState.activeTaskId === taskId) appState.activeTaskId = null;
    saveLocalStorage();
    renderTasks();
    updateTargetTaskUI();
    updateAnalyticsStats();
  }
}

/* Modal Handlers */
function openAddTaskModal() {
  document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-brand-400 mr-2"></i> Add New Task`;
  document.getElementById('task-id').value = '';
  document.getElementById('form-task-title').value = '';
  document.getElementById('form-task-desc').value = '';
  document.getElementById('form-task-category').value = 'Study';
  document.getElementById('form-task-priority').value = 'P2';
  document.getElementById('form-task-est-pomo').value = 2;
  document.getElementById('form-task-due').value = '';
  document.getElementById('subtasks-input-container').innerHTML = '';

  document.getElementById('task-modal').classList.remove('hidden');
}

function openEditTaskModal(taskId) {
  const task = appState.tasks.find(t => t.id === taskId);
  if (!task) return;

  document.getElementById('modal-title').innerHTML = `<i class="fa-solid fa-pen-to-square text-brand-400 mr-2"></i> Edit Task`;
  document.getElementById('task-id').value = task.id;
  document.getElementById('form-task-title').value = task.title;
  document.getElementById('form-task-desc').value = task.desc || '';
  document.getElementById('form-task-category').value = task.category || 'Study';
  document.getElementById('form-task-priority').value = task.priority || 'P2';
  document.getElementById('form-task-est-pomo').value = task.estimatedPomodoros || 1;
  document.getElementById('form-task-due').value = task.dueDate || '';

  const subContainer = document.getElementById('subtasks-input-container');
  subContainer.innerHTML = '';
  if (task.subtasks) {
    task.subtasks.forEach(st => addSubtaskInput(st.title));
  }

  document.getElementById('task-modal').classList.remove('hidden');
}

function addSubtaskInput(value = '') {
  const container = document.getElementById('subtasks-input-container');
  const div = document.createElement('div');
  div.className = 'flex items-center space-x-2';
  div.innerHTML = `
    <input type="text" value="${escapeHTML(value)}" placeholder="Subtask title" class="subtask-item-input flex-1 bg-dark-bg border border-dark-border rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-brand-500">
    <button type="button" onclick="this.parentElement.remove()" class="text-gray-500 hover:text-rose-400"><i class="fa-solid fa-xmark"></i></button>
  `;
  container.appendChild(div);
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
}

function saveTask(e) {
  e.preventDefault();
  const id = document.getElementById('task-id').value;
  const title = document.getElementById('form-task-title').value.trim();
  const desc = document.getElementById('form-task-desc').value.trim();
  const category = document.getElementById('form-task-category').value;
  const priority = document.getElementById('form-task-priority').value;
  const estimatedPomodoros = parseInt(document.getElementById('form-task-est-pomo').value) || 1;
  const dueDate = document.getElementById('form-task-due').value;

  // Extract subtasks
  const subtaskInputs = document.querySelectorAll('.subtask-item-input');
  const subtasks = Array.from(subtaskInputs)
    .map(input => input.value.trim())
    .filter(val => val.length > 0)
    .map(val => ({ title: val, completed: false }));

  if (id) {
    // Edit existing
    const task = appState.tasks.find(t => t.id === id);
    if (task) {
      task.title = title;
      task.desc = desc;
      task.category = category;
      task.priority = priority;
      task.estimatedPomodoros = estimatedPomodoros;
      task.dueDate = dueDate;
      task.subtasks = subtasks;
    }
  } else {
    // Create new
    const newTask = {
      id: 'task_' + Date.now(),
      title,
      desc,
      category,
      priority,
      estimatedPomodoros,
      completedPomodoros: 0,
      dueDate,
      subtasks,
      completed: false,
      status: 'todo',
      createdAt: new Date().toISOString()
    };
    appState.tasks.unshift(newTask);
  }

  saveLocalStorage();
  closeTaskModal();
  renderTasks();
  updateAnalyticsStats();
}

/* ==========================================================================
   FOCUS OVERLAY & KEYBOARD SHORTCUTS
   ========================================================================== */
function enterFocusOverlay() {
  document.getElementById('focus-overlay').classList.remove('hidden');
  updateTargetTaskUI();
}

function exitFocusOverlay() {
  document.getElementById('focus-overlay').classList.add('hidden');
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore if typing inside input / textarea
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      toggleTimer();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openAddTaskModal();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      resetTimer();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      const overlay = document.getElementById('focus-overlay');
      if (overlay.classList.contains('hidden')) enterFocusOverlay();
      else exitFocusOverlay();
    }
  });
}

/* ==========================================================================
   ANALYTICS & CHART VISUALIZATIONS
   ========================================================================== */
let weeklyChartInstance = null;
let categoryChartInstance = null;

function initializeCharts() {
  // Weekly Bar Chart
  const ctxWeekly = document.getElementById('weekly-chart').getContext('2d');
  weeklyChartInstance = new Chart(ctxWeekly, {
    type: 'bar',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [{
        label: 'Focus Hours',
        data: [0, 0, 0, 0, 0, 0, 0],
        backgroundColor: 'rgba(99, 102, 241, 0.7)',
        borderColor: '#6366f1',
        borderWidth: 1.5,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3af' } },
        y: { grid: { color: '#1e293b' }, ticks: { color: '#9ca3af' } }
      }
    }
  });

  // Category Donut Chart
  const ctxCat = document.getElementById('category-chart').getContext('2d');
  categoryChartInstance = new Chart(ctxCat, {
    type: 'doughnut',
    data: {
      labels: ['Study', 'Work', 'Life'],
      datasets: [{
        data: [0, 0, 0],
        backgroundColor: ['#6366f1', '#f59e0b', '#10b981'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', font: { size: 11 } } }
      }
    }
  });
}

function updateAnalyticsStats() {
  // Calculate Stats
  const totalMinutes = appState.focusLogs.reduce((acc, log) => acc + (log.durationMinutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const completedTasksCount = appState.tasks.filter(t => t.completed).length;
  const totalPomodoros = appState.focusLogs.length;

  // Update Summary Cards
  document.getElementById('stats-total-hours').innerHTML = `${totalHours} <span class="text-xs font-sans text-gray-400">hrs</span>`;
  document.getElementById('stats-completed-tasks').textContent = completedTasksCount;
  document.getElementById('stats-total-pomo').textContent = `${totalPomodoros} 🍅`;
  document.getElementById('today-focus-hours').textContent = (getTodayFocusMinutes() / 60).toFixed(1);
  document.getElementById('today-pomo-count').textContent = getTodayPomoCount();

  // Update Weekly Chart Data
  const daysData = [0, 0, 0, 0, 0, 0, 0];
  const now = new Date();
  appState.focusLogs.forEach(log => {
    const logDate = new Date(log.timestamp);
    const diffDays = Math.floor((now - logDate) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) {
      let dayIdx = logDate.getDay() - 1; // 0 is Sun
      if (dayIdx === -1) dayIdx = 6;
      daysData[dayIdx] += (log.durationMinutes / 60);
    }
  });

  if (weeklyChartInstance) {
    weeklyChartInstance.data.datasets[0].data = daysData.map(v => parseFloat(v.toFixed(1)));
    weeklyChartInstance.update();
  }

  // Update Category Donut Chart
  const catCounts = { Study: 0, Work: 0, Life: 0 };
  appState.tasks.forEach(t => {
    if (catCounts[t.category] !== undefined) {
      catCounts[t.category] += (t.completedPomodoros || 0);
    }
  });

  if (categoryChartInstance) {
    categoryChartInstance.data.datasets[0].data = [catCounts.Study, catCounts.Work, catCounts.Life];
    categoryChartInstance.update();
  }

  // Render Heatmap Grid
  renderHeatmap();
}

function getTodayFocusMinutes() {
  const todayStr = new Date().toDateString();
  return appState.focusLogs
    .filter(l => new Date(l.timestamp).toDateString() === todayStr)
    .reduce((acc, l) => acc + l.durationMinutes, 0);
}

function getTodayPomoCount() {
  const todayStr = new Date().toDateString();
  return appState.focusLogs.filter(l => new Date(l.timestamp).toDateString() === todayStr).length;
}

function getActiveTaskCategory() {
  if (!appState.activeTaskId) return 'Study';
  const task = appState.tasks.find(t => t.id === appState.activeTaskId);
  return task ? task.category : 'Study';
}

function renderHeatmap() {
  const container = document.getElementById('heatmap-grid');
  container.innerHTML = '';

  // Generate last 30 days tiles
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const dateStr = d.toDateString();

    const logsOnDay = appState.focusLogs.filter(l => new Date(l.timestamp).toDateString() === dateStr);
    const totalMin = logsOnDay.reduce((acc, l) => acc + l.durationMinutes, 0);

    let bgClass = 'bg-dark-bg border border-dark-border';
    if (totalMin > 0 && totalMin <= 30) bgClass = 'bg-emerald-900/60';
    else if (totalMin > 30 && totalMin <= 60) bgClass = 'bg-emerald-700';
    else if (totalMin > 60 && totalMin <= 120) bgClass = 'bg-emerald-500';
    else if (totalMin > 120) bgClass = 'bg-emerald-400 shadow-sm shadow-emerald-500/50';

    const tile = document.createElement('div');
    tile.className = `w-5 h-5 sm:w-6 sm:h-6 rounded-md ${bgClass} transition-all hover:scale-110 relative group cursor-pointer`;
    tile.title = `${d.toLocaleDateString()}: ${totalMin} mins focus`;
    container.appendChild(tile);
  }
}

/* Helper function to sanitize HTML */
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}