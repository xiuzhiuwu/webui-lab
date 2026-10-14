/* ==========================================================================
   StudyFlow 全域邏輯與狀態管理
   ========================================================================== */
const STORAGE_KEY_TASKS = 'doflow_tasks_v1';
const STORAGE_KEY_LOGS = 'doflow_logs_v1';

let appState = {
  activeTab: 'timer',
  taskViewMode: 'list',
  activeTaskId: null,
  timerMode: 'focus',
  timerRunning: false,
  timerSeconds: 25 * 60,
  timerTotalDuration: 25 * 60,
  timerInterval: null,
  customDurations: { focus: 25, shortBreak: 5, longBreak: 15 },
  tasks: [],
  focusLogs: []
};

let weeklyChartInstance = null;
let categoryChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  loadLocalStorage();
  initializeCharts();
  renderTasks();
  updateTimerDisplay();
  updateTargetTaskUI();
  updateAnalyticsStats();
});

function loadLocalStorage() {
  try {
    const savedTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    if (savedTasks) appState.tasks = JSON.parse(savedTasks);
    const savedLogs = localStorage.getItem(STORAGE_KEY_LOGS);
    if (savedLogs) appState.focusLogs = JSON.parse(savedLogs);
  } catch (err) {}
}

function saveLocalStorage() {
  localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(appState.tasks));
  localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(appState.focusLogs));
}

function switchTab(tabName) {
  document.getElementById('view-timer').classList.add('hidden');
  document.getElementById('view-tasks').classList.add('hidden');
  document.getElementById('view-analytics').classList.add('hidden');
  document.getElementById(`view-${tabName}`).classList.remove('hidden');

  document.querySelectorAll('.nav-tab').forEach(b => {
    b.classList.remove('bg-brand-600', 'text-white', 'shadow-md');
    b.classList.add('text-gray-400');
  });
  document.getElementById(`tab-${tabName}-btn`).classList.add('bg-brand-600', 'text-white', 'shadow-md');
  
  if (tabName === 'tasks') renderTasks();
  if (tabName === 'analytics') updateAnalyticsStats();
}

/* ==========================================================================
   番茄鐘模式切換（修復藍色高亮區塊）
   ========================================================================== */
function setTimerMode(mode) {
  appState.timerMode = mode;
  if (appState.timerRunning) toggleTimer();

  // 1. 清除所有按鈕高亮
  ['focus', 'shortBreak', 'longBreak'].forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (btn) {
      btn.classList.remove('bg-brand-600', 'text-white', 'shadow', 'active');
      btn.classList.add('text-gray-400');
    }
  });

  // 2. 為點選按鈕加上高亮
  const activeBtn = document.getElementById(`mode-${mode}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow', 'active');
    activeBtn.classList.remove('text-gray-400');
  }

  const labelMap = { focus: '專注時間', shortBreak: '短暫休息', longBreak: '長休息' };
  const labelEl = document.getElementById('timer-mode-label');
  if (labelEl) labelEl.textContent = labelMap[mode];

  const mins = appState.customDurations[mode] || 25;
  appState.timerSeconds = mins * 60;
  appState.timerTotalDuration = mins * 60;
  updateTimerDisplay();
}

function toggleTimer() {
  appState.timerRunning = !appState.timerRunning;
  const btnText = document.getElementById('timer-btn-text');
  const timerIcon = document.getElementById('timer-icon');

  if (appState.timerRunning) {
    if (btnText) btnText.textContent = '暫停';
    if (timerIcon) timerIcon.className = 'fa-solid fa-pause text-sm';
    appState.timerInterval = setInterval(() => {
      if (appState.timerSeconds > 0) {
        appState.timerSeconds--;
        updateTimerDisplay();
      } else {
        handleTimerCompletion();
      }
    }, 1000);
  } else {
    if (btnText) btnText.textContent = '開始';
    if (timerIcon) timerIcon.className = 'fa-solid fa-play text-sm';
    clearInterval(appState.timerInterval);
  }
}

function resetTimer() {
  if (appState.timerRunning) toggleTimer();
  appState.timerSeconds = appState.customDurations[appState.timerMode] * 60;
  updateTimerDisplay();
}

function skipTimer() { if (confirm("確定跳過此階段？")) resetTimer(); }

function updateTimerDisplay() {
  const minutes = Math.floor(appState.timerSeconds / 60);
  const seconds = appState.timerSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  document.getElementById('timer-display').textContent = formatted;
  document.getElementById('overlay-timer-display').textContent = formatted;

  const circle = document.getElementById('timer-progress-circle');
  if (circle) {
    const fraction = appState.timerSeconds / appState.timerTotalDuration;
    circle.style.strokeDashoffset = (2 * Math.PI * 44) * (1 - fraction);
  }
}

function handleTimerCompletion() {
  toggleTimer();
  if (appState.timerMode === 'focus') {
    appState.focusLogs.push({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      durationMinutes: appState.customDurations.focus
    });
    saveLocalStorage();
    updateAnalyticsStats();
    alert("🎉 專注完成！獲得 1 個番茄 🍅");
    setTimerMode('shortBreak');
  } else {
    alert("休息結束！準備開始專注囉。");
    setTimerMode('focus');
  }
}

/* ==========================================================================
   任務動態過濾與渲染邏輯（修復分類與搜尋連動）
   ========================================================================== */
/* ==========================================================================
   任務動態過濾與渲染邏輯 (白底極簡版)
   ========================================================================== */
/* ==========================================================================
   任務動態過濾與渲染邏輯 (白底 + 深色卡片版)
   ========================================================================== */
/* ==========================================================================
   任務動態過濾與渲染邏輯 (全深色系)
   ========================================================================== */
function renderTasks() {
  const container = document.getElementById('tasks-list-container');
  if (!container) return;

  const searchInput = document.getElementById('task-search-input');
  const catFilterEl = document.getElementById('task-category-filter');

  const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const catFilter = catFilterEl ? catFilterEl.value : 'all';

  let filtered = appState.tasks.filter(t => {
    const matchesSearch = !searchQuery || t.title.toLowerCase().includes(searchQuery);
    const matchesCat = (catFilter === 'all') || (t.category === catFilter);
    return matchesSearch && matchesCat;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-gray-500 text-xs font-medium">沒有找到符合條件的任務。</div>`;
    return;
  }

  const categoryMap = { Study: '📚 課業學習', Work: '💼 工作專案', Life: '🌿 個人生活' };

  container.innerHTML = filtered.map(t => `
    <div class="dark-card p-4 rounded-2xl flex items-center justify-between">
      <div>
        <div class="flex items-center space-x-2 mb-1">
          <h4 class="text-sm font-bold text-white">${t.title}</h4>
          <span class="text-[10px] px-2 py-0.5 rounded-md bg-[#0b0f17] border border-white/10 text-brand-300 font-semibold">
            ${categoryMap[t.category] || '📚 課業學習'}
          </span>
        </div>
        <span class="text-[10px] text-gray-400 font-medium">預估番茄: ${t.estimatedPomodoros || 1} 🍅</span>
      </div>
      <button onclick="setFocusTarget('${t.id}')" class="px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold transition-all shadow-sm">專注</button>
    </div>
  `).join('');
}
function setFocusTarget(id) {
  appState.activeTaskId = id;
  updateTargetTaskUI();
  switchTab('timer');
}

function updateTargetTaskUI() {
  const task = appState.tasks.find(t => t.id === appState.activeTaskId);
  const container = document.getElementById('active-task-container');
  const titleOverlay = document.getElementById('overlay-task-title');

  if (task) {
    container.innerHTML = `<h4 class="text-sm font-bold text-white">${task.title}</h4>`;
    if (titleOverlay) titleOverlay.textContent = task.title;
  } else {
    container.innerHTML = `<p class="text-gray-500 text-sm text-center">尚未選擇專注目標。</p>`;
    if (titleOverlay) titleOverlay.textContent = "尚未選擇進行中的任務";
  }
}

function openAddTaskModal() { document.getElementById('task-modal').classList.remove('hidden'); }
function closeTaskModal() { document.getElementById('task-modal').classList.add('hidden'); }

function saveTask(e) {
  e.preventDefault();
  const title = document.getElementById('form-task-title').value;
  const category = document.getElementById('form-task-category').value;
  const estimatedPomodoros = parseInt(document.getElementById('form-task-est-pomo').value) || 1;

  appState.tasks.unshift({
    id: 'task_' + Date.now(),
    title, category, estimatedPomodoros, completed: false, status: 'todo'
  });

  saveLocalStorage();
  closeTaskModal();
  renderTasks();
}

function initializeCharts() {
  const cWeekly = document.getElementById('weekly-chart');
  if (cWeekly) {
    weeklyChartInstance = new Chart(cWeekly.getContext('2d'), {
      type: 'bar',
      data: { labels: ['週一','週二','週三','週四','週五','週六','週日'], datasets: [{ label: '專注時數', data: [1,2,1.5,3,2,0.5,4], backgroundColor: '#6366f1' }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
  const cCat = document.getElementById('category-chart');
  if (cCat) {
    categoryChartInstance = new Chart(cCat.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['課業', '工作', '生活'], datasets: [{ data: [6, 2, 2], backgroundColor: ['#6366f1', '#f59e0b', '#10b981'] }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

function updateAnalyticsStats() {
  const totalMin = appState.focusLogs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);
  document.getElementById('stats-total-hours').innerHTML = `${(totalMin / 60).toFixed(1)} <span class="text-xs font-sans text-gray-400">小時</span>`;
  document.getElementById('stats-total-pomo').textContent = `${appState.focusLogs.length} 🍅`;
}

function setTaskViewMode(m) { appState.taskViewMode = m; }
function handleDragOver(e) { e.preventDefault(); }
function handleDrop(e, status) { e.preventDefault(); }
function enterFocusOverlay() { document.getElementById('focus-overlay').classList.remove('hidden'); }
function exitFocusOverlay() { document.getElementById('focus-overlay').classList.add('hidden'); }
function toggleAmbientMenu() { document.getElementById('ambient-popover').classList.toggle('hidden'); }
function setAmbientVolume() {}
function requestNotificationPermission() { alert("通知功能已就緒！"); }
function updateCustomDurations() {}