/* ==========================================================================

   DoFlow 全域邏輯、子任務 (Checklists) 與狀態管理

   ========================================================================== */



// 本地存儲（LocalStorage）的鍵名定義

const STORAGE_KEY_TASKS = 'doflow_tasks_v1';

const STORAGE_KEY_LOGS = 'doflow_logs_v1';

const STORAGE_KEY_SETTINGS = 'doflow_settings_v1';



// 應用程式核心狀態（AppState）物件

let appState = {
  activeTab: 'timer',
  taskViewMode: 'list',
  activeTaskId: null, // 👈 預設不選取任何任務
  timerMode: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
  timerRunning: false,
  timerSeconds: 25 * 60,
  timerTotalDuration: 25 * 60,
  timerInterval: null,

  // 1. 自訂時間 (單位：分鐘)
  customDurations: { focus: 25, shortBreak: 5, longBreak: 15 },

  // 2. 音效設定
  audioSettings: {
    sound: 'bell',        // 音效類型: 'bell' | 'alarm' | 'wooden'
    volume: 0.8,         // 音量: 0.0 ~ 1.0
  },

  // 3. 自動跨階段設定
  autoSwitchSettings: {
    autoStartBreaks: false, // 專注結束後，是否自動開始休息
    autoStartFocus: false,  // 休息結束後，是否自動開始專注
  },

  tasks: [], // 👈 將預設任務清空

  focusLogs: [] // 👈 若也想清空初始的測試專注紀錄，可改為 []
};



// 編輯 Task Modal 中的暫存子任務清單

let tempModalSubtasks = [];



// Chart.js 圖表實例全域變數

let weeklyChartInstance = null;

let categoryChartInstance = null;



// 當 DOM 內容加載完畢後執行的初始化流程

document.addEventListener('DOMContentLoaded', () => {

  loadLocalStorage();       // 載入本地儲存資料

  initializeCharts();       // 初始化分析圖表

  renderTasks();            // 渲染任務列表

  updateTimerDisplay();     // 更新倒數計時器 UI

  updateTargetTaskUI();     // 更新當前目標任務 UI

  updateAnalyticsStats();   // 更新統計分析數據

});



/* ==========================================================================

   通用工具函式 (Utility Functions)

   ========================================================================== */



/** HTML 字串安全轉義，避免 XSS 攻擊 */

function escapeHTML(str = '') {

  return String(str)

    .replace(/&/g, '&amp;')

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;')

    .replace(/'/g, '&#039;');

}



/** 簡易 Toast 提示訊息 */

function showToast(message) {

  const toast = document.createElement('div');

  toast.className = 'fixed bottom-5 right-5 bg-brand-600 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold z-[10000] transition-all duration-300 opacity-0 transform translate-y-2';

  toast.textContent = message;

  document.body.appendChild(toast);

 

  setTimeout(() => {

    toast.classList.remove('opacity-0', 'translate-y-2');

  }, 10);



  setTimeout(() => {

    toast.classList.add('opacity-0', 'translate-y-2');

    setTimeout(() => toast.remove(), 300);

  }, 3000);

}



/* ==========================================================================

   本地儲存 (LocalStorage) 管理

   ========================================================================== */



/** 從 LocalStorage 載入歷史任務、設定與專注紀錄 */

function loadLocalStorage() {
  try {
    const savedTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    if (savedTasks) appState.tasks = JSON.parse(savedTasks);

    const savedLogs = localStorage.getItem(STORAGE_KEY_LOGS);
    if (savedLogs) appState.focusLogs = JSON.parse(savedLogs);

    const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (savedSettings) {
      const parsedSettings = JSON.parse(savedSettings);
      appState.customDurations = parsedSettings.customDurations || appState.customDurations;
      appState.audioSettings = parsedSettings.audioSettings || appState.audioSettings;
      appState.autoSwitchSettings = parsedSettings.autoSwitchSettings || appState.autoSwitchSettings;
    }

    // 👈 只有當 tasks 有資料且目前沒選中 Task 時才自動選取第一個，否則維持 null
    if (appState.tasks.length > 0 && !appState.activeTaskId) {
      appState.activeTaskId = appState.tasks[0].id;
    } else if (appState.tasks.length === 0) {
      appState.activeTaskId = null;
    }

    appState.timerSeconds = appState.customDurations.focus * 60;
    appState.timerTotalDuration = appState.timerSeconds;
  } catch (err) {
    console.error('載入本地資料失敗:', err);
  }
}



/** 將當前 State 中的任務與紀錄同步寫入 LocalStorage */

function saveLocalStorage() {

  localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(appState.tasks));

  localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(appState.focusLogs));

  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({

    customDurations: appState.customDurations,

    audioSettings: appState.audioSettings,

    autoSwitchSettings: appState.autoSwitchSettings

  }));

}



/* ==========================================================================

   分頁切換 (Tab Navigation)

   ========================================================================== */



/** 切換主要頁面分頁 (Timer / Tasks / Analytics) */

function switchTab(tabName) {

  appState.activeTab = tabName;



  // 隱藏所有頁面視圖

  ['timer', 'tasks', 'analytics'].forEach(tab => {

    const el = document.getElementById(`view-${tab}`);

    if (el) el.classList.add('hidden');

  });



  // 顯示指定的頁面視圖

  const activeView = document.getElementById(`view-${tabName}`);

  if (activeView) activeView.classList.remove('hidden');



  // 重置所有導覽頁籤按鈕的樣式

  document.querySelectorAll('.nav-tab').forEach(b => {

    b.classList.remove('bg-brand-600', 'text-white', 'shadow-md');

    b.classList.add('text-gray-400');

  });



  // 高亮當前頁籤

  const activeBtn = document.getElementById(`tab-${tabName}-btn`);

  if (activeBtn) activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow-md');



  if (tabName === 'tasks') renderTasks();

  if (tabName === 'analytics') updateAnalyticsStats();

}



/* ==========================================================================

   番茄鐘核心邏輯 (Timer Engine)

   ========================================================================== */



function setTimerMode(mode) {

  appState.timerMode = mode;

  if (appState.timerRunning) toggleTimer(); // 執行中則先暫停



  // 1. 清除模式按鈕高亮

  ['focus', 'shortBreak', 'longBreak'].forEach(m => {

    const btn = document.getElementById(`mode-${m}`);

    if (btn) {

      btn.classList.remove('bg-brand-600', 'text-white', 'shadow', 'active');

      btn.classList.add('text-gray-400');

    }

  });



  // 2. 為當前選中的按鈕加上高亮

  const activeBtn = document.getElementById(`mode-${mode}`);

  if (activeBtn) {

    activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow', 'active');

    activeBtn.classList.remove('text-gray-400');

  }



  // 3. 更新模式文字

  const labelMap = { focus: '專注時間', shortBreak: '短暫休息', longBreak: '長休息' };

  const labelEl = document.getElementById('timer-mode-label');

  if (labelEl) labelEl.textContent = labelMap[mode] || '專注時間';



  // 4. 重置倒數秒數

  const mins = appState.customDurations[mode] || 25;

  appState.timerSeconds = mins * 60;

  appState.timerTotalDuration = mins * 60;

  updateTimerDisplay();

}



const SOUND_SOURCES = {

  bell: 'https://actions.google.com/sounds/v1/sfx/digital_watch_alarm.ogg',

  wooden: 'https://actions.google.com/sounds/v1/impacts/wood_plank_flicks.ogg',

  alarm: 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'

};



function playCompletionSound() {

  const soundKey = appState.audioSettings.sound || 'bell';

  const soundUrl = SOUND_SOURCES[soundKey];



  if (soundUrl) {

    const audio = new Audio(soundUrl);

    audio.volume = appState.audioSettings.volume;

    audio.play().catch(err => console.warn("音效播放被阻擋或失敗:", err));

  }

}



function toggleTimer() {

  appState.timerRunning = !appState.timerRunning;

  const btnText = document.getElementById('timer-btn-text');

  const timerIcon = document.getElementById('timer-icon');



  if (appState.timerRunning) {

    if (btnText) btnText.textContent = '暫停';

    if (timerIcon) timerIcon.className = 'fa-solid fa-pause text-xs';



    appState.timerInterval = setInterval(() => {

      if (appState.timerSeconds > 0) {

        appState.timerSeconds--;

        updateTimerDisplay();

      } else {

        handleTimerCompletion();

      }

    }, 1000);

  } else {

    if (btnText) btnText.textContent = appState.timerMode === 'focus' ? '開始專注' : '開始休息';

    if (timerIcon) timerIcon.className = 'fa-solid fa-play text-xs';

    clearInterval(appState.timerInterval);

  }

}



function resetTimer() {

  if (appState.timerRunning) toggleTimer();

  appState.timerSeconds = appState.customDurations[appState.timerMode] * 60;

  updateTimerDisplay();

}



function updateTimerDisplay() {

  const minutes = Math.floor(appState.timerSeconds / 60);

  const seconds = appState.timerSeconds % 60;

  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;



  const timerDisplay = document.getElementById('timer-display');

  if (timerDisplay) timerDisplay.textContent = formatted;



  const overlayTimerDisplay = document.getElementById('overlay-timer-display');

  if (overlayTimerDisplay) overlayTimerDisplay.textContent = formatted;



  if (appState.timerRunning) {

    const modeMap = { focus: '專注中', shortBreak: '短休息', longBreak: '長休息' };

    document.title = `(${formatted}) DoFlow - ${modeMap[appState.timerMode] || '專注中'}`;

  } else {

    document.title = 'DoFlow - 現代學習生產力中心';

  }



  const circle = document.getElementById('timer-progress-circle');

  if (circle) {

    const fraction = appState.timerSeconds / appState.timerTotalDuration;

    circle.style.strokeDashoffset = (2 * Math.PI * 44) * (1 - fraction);

  }

}



function handleTimerCompletion() {

  clearInterval(appState.timerInterval);

  appState.timerRunning = false;



  playCompletionSound();



  if (typeof confetti === 'function') {

    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });

  }



  if (appState.timerMode === 'focus') {

    appState.focusLogs.push({

      id: Date.now(),

      timestamp: new Date().toISOString(),

      durationMinutes: appState.customDurations.focus

    });



    const activeTask = appState.tasks.find(t => t.id === appState.activeTaskId);

    if (activeTask) {

      activeTask.actPomo = (activeTask.actPomo || 0) + 1;

    }



    saveLocalStorage();

    updateAnalyticsStats();

    updateTargetTaskUI();

    renderTasks();



    showToast("🎉 專注完成！獲得 1 個番茄 🍅");

    setTimerMode('shortBreak');



    if (appState.autoSwitchSettings.autoStartBreaks) toggleTimer();

  } else {

    showToast("☕ 休息結束！準備開始專注囉。");

    setTimerMode('focus');



    if (appState.autoSwitchSettings.autoStartFocus) toggleTimer();

  }

}



/* ==========================================================================

   子任務 (Checklists) 與任務動態管理

   ========================================================================== */



function toggleSubtask(taskId, subtaskId) {

  const task = appState.tasks.find(t => t.id === taskId);

  if (!task || !task.subtasks) return;



  const subtask = task.subtasks.find(st => st.id === subtaskId);

  if (subtask) {

    subtask.completed = !subtask.completed;

    saveLocalStorage();

    updateTargetTaskUI();

    renderTasks();

    renderOverlaySubtasks();

  }

}



function setFocusTarget(id) {

  appState.activeTaskId = id;

  saveLocalStorage();

  updateTargetTaskUI();

  renderTasks();

  switchTab('timer');

}



function updateTargetTaskUI() {

  const task = appState.tasks.find(t => t.id === appState.activeTaskId);

  const container = document.getElementById('active-task-container');

  const titleOverlay = document.getElementById('overlay-task-title');



  if (!task) {

    if (container) container.innerHTML = `<p class="text-gray-500 text-xs font-medium text-center">尚未選擇進行中的任務</p>`;

    if (titleOverlay) titleOverlay.textContent = "尚未選擇任務";

    return;

  }



  if (titleOverlay) titleOverlay.textContent = `🎯 ${task.title}`;



  const totalSub = task.subtasks ? task.subtasks.length : 0;

  const completedSub = task.subtasks ? task.subtasks.filter(st => st.completed).length : 0;

  const percent = totalSub > 0 ? Math.round((completedSub / totalSub) * 100) : 0;



  let subtasksHTML = '';

  if (totalSub > 0) {

    subtasksHTML = `

      <div class="mt-3 pt-3 border-t border-white/10 space-y-2">

        <div class="flex items-center justify-between text-[11px] text-gray-400 font-semibold mb-1">

          <span><i class="fa-solid fa-bars-progress text-brand-400 mr-1"></i>步驟完成度</span>

          <span>${completedSub}/${totalSub} (${percent}%)</span>

        </div>

        <div class="w-full bg-[#0b0f17] h-1.5 rounded-full overflow-hidden mb-2">

          <div class="bg-gradient-to-r from-brand-500 to-indigo-400 h-full transition-all duration-300" style="width: ${percent}%"></div>

        </div>

        <div class="space-y-1.5 max-h-36 overflow-y-auto pr-1">

          ${task.subtasks.map(st => `

            <div onclick="toggleSubtask('${task.id}', '${st.id}')" class="flex items-start space-x-2 p-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-all">

              <i class="${st.completed ? 'fa-solid fa-circle-check text-emerald-400' : 'fa-regular fa-circle text-gray-500'} text-xs mt-0.5"></i>

              <span class="text-xs ${st.completed ? 'line-through text-gray-500' : 'text-gray-200'}">${escapeHTML(st.title)}</span>

            </div>

          `).join('')}

        </div>

      </div>

    `;

  }



  if (container) {

    const categoryMap = { Study: '📚 課業學習', Work: '💼 工作專案', Life: '🌿 個人生活' };

    container.innerHTML = `

      <div class="space-y-1">

        <div class="flex items-center justify-between">

          <span class="px-2 py-0.5 rounded-md bg-brand-500/20 text-brand-300 text-[10px] font-bold">${categoryMap[task.category] || '📚 課業學習'}</span>

          <span class="text-xs font-mono text-rose-400"><i class="fa-solid fa-tomato mr-1"></i>${task.actPomo || 0} / ${task.estimatedPomodoros || 1} 🍅</span>

        </div>

        <h4 class="text-sm font-bold text-white mt-1">${escapeHTML(task.title)}</h4>

        ${subtasksHTML}

      </div>

    `;

  }



  renderOverlaySubtasks();

}



function renderOverlaySubtasks() {

  const container = document.getElementById('overlay-subtasks-container');

  if (!container) return;



  const task = appState.tasks.find(t => t.id === appState.activeTaskId);



  if (!task || !task.subtasks || task.subtasks.length === 0) {

    container.innerHTML = `<p class="text-gray-500 text-xs text-center">此任務無子步驟拆解</p>`;

    return;

  }



  container.innerHTML = `

    <div class="text-xs font-bold text-gray-400 mb-2 border-b border-white/10 pb-1 flex justify-between">

      <span><i class="fa-solid fa-list-check text-brand-400 mr-1"></i>步驟拆解 (Subtasks)</span>

      <span>${task.subtasks.filter(s=>s.completed).length}/${task.subtasks.length}</span>

    </div>

    <div class="space-y-2">

      ${task.subtasks.map(st => `

        <div onclick="toggleSubtask('${task.id}', '${st.id}')" class="flex items-center space-x-2.5 p-2 rounded-xl bg-[#0b0f17]/40 hover:bg-white/10 cursor-pointer transition-all">

          <i class="${st.completed ? 'fa-solid fa-circle-check text-emerald-400' : 'fa-regular fa-circle text-gray-500'} text-sm"></i>

          <span class="text-xs ${st.completed ? 'line-through text-gray-500' : 'text-gray-200'}">${escapeHTML(st.title)}</span>

        </div>

      `).join('')}

    </div>

  `;

}



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

    container.innerHTML = `<div class="dark-card rounded-2xl p-8 text-center text-gray-500 text-xs">無符合條件的任務</div>`;

    return;

  }



  const categoryMap = { Study: '📚 課業學習', Work: '💼 工作專案', Life: '🌿 個人生活' };



  container.innerHTML = filtered.map(t => {

    const isActive = t.id === appState.activeTaskId;

    const totalSub = t.subtasks ? t.subtasks.length : 0;

    const completedSub = t.subtasks ? t.subtasks.filter(st => st.completed).length : 0;



    return `

      <div class="dark-card rounded-2xl p-4 transition-all hover:border-brand-500/30 ${isActive ? 'border-brand-500/50 bg-brand-500/5' : ''}">

        <div class="flex items-center justify-between gap-3">

          <button onclick="toggleTaskComplete('${t.id}')" class="text-lg transition-colors">

            <i class="${t.completed ? 'fa-solid fa-circle-check text-emerald-400' : 'fa-regular fa-circle text-gray-500 hover:text-gray-300'}"></i>

          </button>



          <div class="flex-1 min-w-0">

            <div class="flex items-center space-x-2">

              <span class="px-2 py-0.5 rounded-md bg-white/5 text-gray-400 text-[10px] font-semibold">${categoryMap[t.category] || '📚 課業學習'}</span>

              <h4 class="text-xs sm:text-sm font-bold text-white truncate ${t.completed ? 'line-through text-gray-500' : ''}">${escapeHTML(t.title)}</h4>

            </div>



            <div class="flex items-center space-x-4 mt-1.5 text-[11px] text-gray-400">

              <span class="flex items-center font-mono text-rose-400"><i class="fa-solid fa-tomato mr-1"></i>${t.actPomo || 0}/${t.estimatedPomodoros || 1}</span>

              ${totalSub > 0 ? `

                <span class="flex items-center text-brand-300"><i class="fa-solid fa-list-check mr-1 text-[10px]"></i>${completedSub}/${totalSub} 步驟</span>

              ` : ''}

            </div>

          </div>



          <div class="flex items-center space-x-2">

            ${!isActive ? `

              <button onclick="setFocusTarget('${t.id}')" class="px-3 py-1.5 rounded-xl bg-brand-600/20 text-brand-300 hover:bg-brand-600 hover:text-white text-xs font-bold transition-all border border-brand-500/30">

                專注此任務

              </button>

            ` : `

              <span class="px-3 py-1.5 rounded-xl bg-brand-600 text-white text-xs font-bold shadow-sm">專注中</span>

            `}

            <button onclick="openEditTaskModal('${t.id}')" class="p-2 text-gray-400 hover:text-white transition-colors" title="編輯">

              <i class="fa-solid fa-pen-to-square text-xs"></i>

            </button>

            <button onclick="deleteTask('${t.id}')" class="p-2 text-gray-400 hover:text-rose-400 transition-colors" title="刪除">

              <i class="fa-solid fa-trash-can text-xs"></i>

            </button>

          </div>

        </div>



        ${totalSub > 0 ? `

          <div class="mt-3 pt-3 border-t border-white/5 pl-7 space-y-1.5">

            ${t.subtasks.map(st => `

              <div onclick="toggleSubtask('${t.id}', '${st.id}')" class="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-1 rounded-lg transition-colors">

                <i class="${st.completed ? 'fa-solid fa-check text-emerald-400' : 'fa-solid fa-minus text-gray-600'} text-[10px]"></i>

                <span class="text-xs ${st.completed ? 'line-through text-gray-500' : 'text-gray-300'}">${escapeHTML(st.title)}</span>

              </div>

            `).join('')}

          </div>

        ` : ''}

      </div>

    `;

  }).join('');

}



function toggleTaskComplete(taskId) {

  const task = appState.tasks.find(t => t.id === taskId);

  if (task) {

    task.completed = !task.completed;

    saveLocalStorage();

    renderTasks();

    updateTargetTaskUI();

  }

}



function deleteTask(taskId) {

  if (confirm('確定要刪除此任務嗎？')) {

    appState.tasks = appState.tasks.filter(t => t.id !== taskId);

    if (appState.activeTaskId === taskId) {

      appState.activeTaskId = appState.tasks.length > 0 ? appState.tasks[0].id : null;

    }

    saveLocalStorage();

    renderTasks();

    updateTargetTaskUI();

  }

}



/* ==========================================================================

   新增 / 編輯任務 Modal 邏輯

   ========================================================================== */



function openAddTaskModal() {

  const titleEl = document.getElementById('task-modal-title');

  if (titleEl) titleEl.textContent = '新增任務';



  document.getElementById('form-task-id').value = '';

  document.getElementById('form-task-title').value = '';

  document.getElementById('form-task-category').value = 'Study';

  document.getElementById('form-task-est-pomo').value = 2;

 

  tempModalSubtasks = [];

  renderModalSubtasks();



  const modal = document.getElementById('task-modal');

  if (modal) modal.classList.remove('hidden');

}



function openEditTaskModal(taskId) {

  const task = appState.tasks.find(t => t.id === taskId);

  if (!task) return;



  const titleEl = document.getElementById('task-modal-title');

  if (titleEl) titleEl.textContent = '編輯任務與步驟';



  document.getElementById('form-task-id').value = task.id;

  document.getElementById('form-task-title').value = task.title;

  document.getElementById('form-task-category').value = task.category;

  document.getElementById('form-task-est-pomo').value = task.estimatedPomodoros || 1;



  tempModalSubtasks = task.subtasks ? JSON.parse(JSON.stringify(task.subtasks)) : [];

  renderModalSubtasks();



  const modal = document.getElementById('task-modal');

  if (modal) modal.classList.remove('hidden');

}



function closeTaskModal() {

  const modal = document.getElementById('task-modal');

  if (modal) modal.classList.add('hidden');

}



function addModalSubtask() {

  const input = document.getElementById('modal-new-subtask-input');

  if (!input) return;



  const val = input.value.trim();

  if (!val) return;



  tempModalSubtasks.push({

    id: 'st-' + Date.now() + Math.random().toString(36).substr(2, 4),

    title: val,

    completed: false

  });



  input.value = '';

  renderModalSubtasks();

}



function removeModalSubtask(subtaskId) {

  tempModalSubtasks = tempModalSubtasks.filter(st => st.id !== subtaskId);

  renderModalSubtasks();

}



function renderModalSubtasks() {

  const container = document.getElementById('modal-subtask-list');

  if (!container) return;



  if (tempModalSubtasks.length === 0) {

    container.innerHTML = `<p class="text-gray-500 text-[11px] italic">尚未新增步驟拆解</p>`;

    return;

  }



  container.innerHTML = tempModalSubtasks.map((st, index) => `

    <div class="flex items-center justify-between bg-[#0b0f17] px-3 py-1.5 rounded-xl border border-white/5">

      <span class="text-xs text-gray-200 truncate">${index + 1}. ${escapeHTML(st.title)}</span>

      <button type="button" onclick="removeModalSubtask('${st.id}')" class="text-gray-500 hover:text-rose-400 transition-colors ml-2">

        <i class="fa-solid fa-xmark text-xs"></i>

      </button>

    </div>

  `).join('');

}



function saveTask(e) {

  e.preventDefault();

  const id = document.getElementById('form-task-id').value;

  const title = document.getElementById('form-task-title').value.trim();

  const category = document.getElementById('form-task-category').value;

  const estimatedPomodoros = parseInt(document.getElementById('form-task-est-pomo').value, 10) || 1;



  if (id) {

    const task = appState.tasks.find(t => t.id === id);

    if (task) {

      task.title = title;

      task.category = category;

      task.estimatedPomodoros = estimatedPomodoros;

      task.subtasks = tempModalSubtasks;

    }

  } else {

    const newId = 'task_' + Date.now();

    appState.tasks.unshift({

      id: newId,

      title,

      category,

      estimatedPomodoros,

      actPomo: 0,

      completed: false,

      subtasks: tempModalSubtasks

    });

    if (!appState.activeTaskId) appState.activeTaskId = newId;

  }



  saveLocalStorage();

  closeTaskModal();

  renderTasks();

  updateTargetTaskUI();

}



/* ==========================================================================

   數據分析與 Chart.js 圖表控制

   ========================================================================== */



function initializeCharts() {

  const cWeekly = document.getElementById('weekly-chart');

  if (cWeekly) {

    weeklyChartInstance = new Chart(cWeekly.getContext('2d'), {

      type: 'bar',

      data: {

        labels: ['週一','週二','週三','週四','週五','週六','週日'],

        datasets: [{

          label: '專注小時',

          data: [1.5, 2.0, 0.5, 3.0, 2.5, 1.0, 0.5],

          backgroundColor: '#6366f1',

          borderRadius: 8

        }]

      },

      options: {

        responsive: true,

        maintainAspectRatio: false,

        plugins: { legend: { display: false } },

        scales: {

          x: { grid: { display: false }, ticks: { color: '#94a3b8' } },

          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } }

        }

      }

    });

  }

}



function updateAnalyticsStats() {

  const totalMin = appState.focusLogs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);

 

  const hoursEl = document.getElementById('stats-total-hours');

  if (hoursEl) {

    hoursEl.innerHTML = `${(totalMin / 60).toFixed(1)} <span class="text-xs font-sans text-gray-500">小時</span>`;

  }

 

  const pomoEl = document.getElementById('stats-total-pomo');

  if (pomoEl) {

    pomoEl.textContent = `${appState.focusLogs.length} 🍅`;

  }



  const todayHoursEl = document.getElementById('today-focus-hours');

  if (todayHoursEl) {

    todayHoursEl.innerHTML = `${(totalMin / 60).toFixed(1)} <span class="text-xs font-sans text-gray-500">小時</span>`;

  }



  const todayPomoEl = document.getElementById('today-pomo-count');

  if (todayPomoEl) {

    todayPomoEl.innerHTML = `${appState.focusLogs.length} <span class="text-xs font-sans text-gray-500">🍅</span>`;

  }

}



/* ==========================================================================

   設定 Modal 控制與狀態更新邏輯

   ========================================================================== */



function openSettingsModal() {

  const modal = document.getElementById('settings-modal');

  if (!modal) return;



  if (appState.customDurations) {

    const elFocus = document.getElementById('setting-focus-time');

    const elShort = document.getElementById('setting-short-break');

    const elLong = document.getElementById('setting-long-break');

    if (elFocus) elFocus.value = appState.customDurations.focus || 25;

    if (elShort) elShort.value = appState.customDurations.shortBreak || 5;

    if (elLong) elLong.value = appState.customDurations.longBreak || 15;

  }



  if (appState.audioSettings) {

    const elSound = document.getElementById('setting-sound-type');

    const elVol = document.getElementById('setting-volume');

    if (elSound) elSound.value = appState.audioSettings.sound || 'bell';

    if (elVol) elVol.value = appState.audioSettings.volume ?? 0.8;

  }



  if (appState.autoSwitchSettings) {

    const elAutoBreak = document.getElementById('setting-auto-break');

    const elAutoFocus = document.getElementById('setting-auto-focus');

    if (elAutoBreak) elAutoBreak.checked = !!appState.autoSwitchSettings.autoStartBreaks;

    if (elAutoFocus) elAutoFocus.checked = !!appState.autoSwitchSettings.autoStartFocus;

  }



  modal.classList.remove('hidden');

}



function closeSettingsModal() {

  const modal = document.getElementById('settings-modal');

  if (modal) modal.classList.add('hidden');

}



function saveSettingsModal() {

  const focus = parseInt(document.getElementById('setting-focus-time')?.value, 10) || 25;

  const shortBreak = parseInt(document.getElementById('setting-short-break')?.value, 10) || 5;

  const longBreak = parseInt(document.getElementById('setting-long-break')?.value, 10) || 15;



  const sound = document.getElementById('setting-sound-type')?.value || 'bell';

  const volume = parseFloat(document.getElementById('setting-volume')?.value) ?? 0.8;



  const autoBreaks = document.getElementById('setting-auto-break')?.checked || false;

  const autoFocus = document.getElementById('setting-auto-focus')?.checked || false;



  appState.customDurations = { focus, shortBreak, longBreak };

  appState.audioSettings = { sound, volume };

  appState.autoSwitchSettings = { autoStartBreaks: autoBreaks, autoStartFocus: autoFocus };



  saveLocalStorage();

  closeSettingsModal();

  setTimerMode(appState.timerMode || 'focus');

  showToast("⚙️ 設定已成功儲存！");

}



/* ==========================================================================

   UI 輔助與全螢幕沉浸模式

   ========================================================================== */



function enterFocusOverlay() {

  const overlay = document.getElementById('focus-overlay');

  if (overlay) {

    overlay.classList.remove('hidden');

    renderOverlaySubtasks();

  }

}



function exitFocusOverlay() {

  const overlay = document.getElementById('focus-overlay');

  if (overlay) overlay.classList.add('hidden');

} 

/** 根據 focusLogs 計算本週（週一至週日）每天的專注時數 */
function calculateWeeklyData() {
  const weeklyHours = [0, 0, 0, 0, 0, 0, 0]; // 對應 週一 ~ 週日
  const now = new Date();
  
  appState.focusLogs.forEach(log => {
    const logDate = new Date(log.timestamp);
    // 可在此處加入日期篩選條件（例如只統計本週）
    let day = logDate.getDay(); // 0 是週日, 1-6 是週一至週六
    let index = (day === 0) ? 6 : day - 1; // 轉為 0:週一 ~ 6:週日
    weeklyHours[index] += (log.durationMinutes || 0) / 60;
  });

  return weeklyHours.map(h => parseFloat(h.toFixed(1)));
}

/** 更新統計與圖表 */
function updateAnalyticsStats() {
  const totalMin = appState.focusLogs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);
  
  const hoursEl = document.getElementById('stats-total-hours');
  if (hoursEl) hoursEl.innerHTML = `${(totalMin / 60).toFixed(1)} <span class="text-xs font-sans text-gray-500">小時</span>`;
  
  const pomoEl = document.getElementById('stats-total-pomo');
  if (pomoEl) pomoEl.textContent = `${appState.focusLogs.length} 🍅`;

  const todayHoursEl = document.getElementById('today-focus-hours');
  if (todayHoursEl) todayHoursEl.innerHTML = `${(totalMin / 60).toFixed(1)} <span class="text-xs font-sans text-gray-500">小時</span>`;

  const todayPomoEl = document.getElementById('today-pomo-count');
  if (todayPomoEl) todayPomoEl.innerHTML = `${appState.focusLogs.length} <span class="text-xs font-sans text-gray-500">🍅</span>`;

  // 👈 新增：同步刷新 Chart.js 圖表資料
  if (weeklyChartInstance) {
    weeklyChartInstance.data.datasets[0].data = calculateWeeklyData();
    weeklyChartInstance.update();
  }
}

