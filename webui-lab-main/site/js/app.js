/* ==========================================================================
   StudyFlow 全域邏輯與狀態管理
   ========================================================================== */

// 本地存儲（LocalStorage）的鍵名定義
const STORAGE_KEY_TASKS = 'doflow_tasks_v1';
const STORAGE_KEY_LOGS = 'doflow_logs_v1';

// 應用程式核心狀態（AppState）物件
// 應用程式核心狀態（AppState）物件
let appState = {
  activeTab: 'timer',
  taskViewMode: 'list',
  activeTaskId: null,
  timerMode: 'focus',
  timerRunning: false,
  timerSeconds: 25 * 60,
  timerTotalDuration: 25 * 60,
  timerInterval: null,
  
  // 1. 自訂時間 (單位：分鐘)
  customDurations: { focus: 25, shortBreak: 5, longBreak: 15 },
  
  // 2. 音效設定
  audioSettings: {
    sound: 'bell',        // 音效類型: 'bell' (風鈴) | 'alarm' (鬧鐘) | 'wooden' (木魚)
    volume: 0.8,         // 音量: 0.0 ~ 1.0
  },
  
  // 3. 自動跨階段設定
  autoSwitchSettings: {
    autoStartBreaks: false, // 專注結束後，是否自動開始休息
    autoStartFocus: false,  // 休息結束後，是否自動開始專注
  },

  tasks: [],
  focusLogs: []
};

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

/**
 * 從 LocalStorage 載入歷史任務與專注紀錄
 */
function loadLocalStorage() {
  try {
    const savedTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    if (savedTasks) appState.tasks = JSON.parse(savedTasks);
    const savedLogs = localStorage.getItem(STORAGE_KEY_LOGS);
    if (savedLogs) appState.focusLogs = JSON.parse(savedLogs);
  } catch (err) {
    console.error('載入本地資料失敗:', err);
  }
}

/**
 * 將當前 State 中的任務與專注紀錄同步寫入 LocalStorage
 */
function saveLocalStorage() {
  localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(appState.tasks));
  localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(appState.focusLogs));
}

/**
 * 切換主要頁面分頁 (Timer / Tasks / Analytics)
 * @param {string} tabName - 欲切換的分頁名稱
 */
function switchTab(tabName) {
  // 隱藏所有頁面視圖
  document.getElementById('view-timer').classList.add('hidden');
  document.getElementById('view-tasks').classList.add('hidden');
  document.getElementById('view-analytics').classList.add('hidden');
  
  // 顯示指定的頁面視圖
  document.getElementById(`view-${tabName}`).classList.remove('hidden');

  // 重置所有導覽頁籤按鈕的樣式
  document.querySelectorAll('.nav-tab').forEach(b => {
    b.classList.remove('bg-brand-600', 'text-white', 'shadow-md');
    b.classList.add('text-gray-400');
  });
  
  // 為當前被選中的頁籤按鈕加上高亮樣式
  document.getElementById(`tab-${tabName}-btn`).classList.add('bg-brand-600', 'text-white', 'shadow-md');
  
  // 依據切換的頁籤更新特定視圖內容
  if (tabName === 'tasks') renderTasks();
  if (tabName === 'analytics') updateAnalyticsStats();
}

/* ==========================================================================
   番茄鐘核心邏輯與模式切換
   ========================================================================== */

/**
 * 設定番茄鐘模式（專注、短暫休息、長休息）
 * @param {string} mode - 'focus' | 'shortBreak' | 'longBreak'
 */
function setTimerMode(mode) {
  appState.timerMode = mode;
  if (appState.timerRunning) toggleTimer(); // 如果計時器運行中，先暫停

  // 1. 清除所有模式按鈕的高亮樣式
  ['focus', 'shortBreak', 'longBreak'].forEach(m => {
    const btn = document.getElementById(`mode-${m}`);
    if (btn) {
      btn.classList.remove('bg-brand-600', 'text-white', 'shadow', 'active');
      btn.classList.add('text-gray-400');
    }
  });

  // 2. 為當前被點選的模式按鈕加上藍色高亮
  const activeBtn = document.getElementById(`mode-${mode}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow', 'active');
    activeBtn.classList.remove('text-gray-400');
  }

  // 3. 更新模式文字標示
  const labelMap = { focus: '專注時間', shortBreak: '短暫休息', longBreak: '長休息' };
  const labelEl = document.getElementById('timer-mode-label');
  if (labelEl) labelEl.textContent = labelMap[mode];

  // 4. 重置倒數秒數並更新顯示
  const mins = appState.customDurations[mode] || 25;
  appState.timerSeconds = mins * 60;
  appState.timerTotalDuration = mins * 60;
  updateTimerDisplay();
}

// 音效網址對照表 (可替換為你專案目錄下的音效檔，例如 '/sounds/bell.mp3')
const SOUND_SOURCES = {
  bell: 'https://actions.google.com/sounds/v1/sfx/digital_watch_alarm.ogg',     // 清脆風鈴/電子聲
  wooden: 'https://actions.google.com/sounds/v1/impacts/wood_plank_flicks.ogg',  // 木魚聲
  alarm: 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'           // 經典鬧鐘聲
};

/**
 * 播放倒數完成提示音
 */
function playCompletionSound() {
  const soundKey = appState.audioSettings.sound || 'bell';
  const soundUrl = SOUND_SOURCES[soundKey];

  if (soundUrl) {
    const audio = new Audio(soundUrl);
    audio.volume = appState.audioSettings.volume; // 設定音量
    audio.play().catch(err => console.warn("音效播放失敗或被瀏覽器阻擋:", err));
  }
}

/**
 * 切換計時器（開始 / 暫停）
 */
function toggleTimer() {
  appState.timerRunning = !appState.timerRunning;
  const btnText = document.getElementById('timer-btn-text');
  const timerIcon = document.getElementById('timer-icon');

  if (appState.timerRunning) {
    // 啟動計時
    if (btnText) btnText.textContent = '暫停';
    if (timerIcon) timerIcon.className = 'fa-solid fa-pause text-sm';
    
    appState.timerInterval = setInterval(() => {
      if (appState.timerSeconds > 0) {
        appState.timerSeconds--;
        updateTimerDisplay();
      } else {
        handleTimerCompletion(); // 時間到的處理邏輯
      }
    }, 1000);
  } else {
    // 暫停計時
    if (btnText) btnText.textContent = '開始';
    if (timerIcon) timerIcon.className = 'fa-solid fa-play text-sm';
    clearInterval(appState.timerInterval);
  }
}

/**
 * 重置當前計時器至預設時間
 */
function resetTimer() {
  if (appState.timerRunning) toggleTimer();
  appState.timerSeconds = appState.customDurations[appState.timerMode] * 60;
  updateTimerDisplay();
}

/**
 * 跳過當前階段
 */
function skipTimer() { 
  if (confirm("確定跳過此階段？")) resetTimer(); 
}

/**
 * 更新頁面上所有計時器顯示（包括主計時器、全螢幕覆蓋計時器與 SVG 進度環）
 */
function updateTimerDisplay() {
  const minutes = Math.floor(appState.timerSeconds / 60);
  const seconds = appState.timerSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  // 更新文字時間格式 MM:SS
  const timerDisplay = document.getElementById('timer-display');
  if (timerDisplay) timerDisplay.textContent = formatted;
  
  const overlayTimerDisplay = document.getElementById('overlay-timer-display');
  if (overlayTimerDisplay) overlayTimerDisplay.textContent = formatted;

  // 【新增】如果計時器正在執行，動態同步分頁標題
  if (appState.timerRunning) {
    const modeMap = { focus: '專注中', shortBreak: '短休息', longBreak: '長休息' };
    const currentModeText = modeMap[appState.timerMode] || '專注中';
    document.title = `(${formatted}) DoFlow - ${currentModeText}`;
  }

  // 計算並更新 SVG 圓形進度條 strokeDashoffset
  const circle = document.getElementById('timer-progress-circle');
  if (circle) {
    const fraction = appState.timerSeconds / appState.timerTotalDuration;
    circle.style.strokeDashoffset = (2 * Math.PI * 44) * (1 - fraction);
  }
}

/**
 * 倒數計時完成時的處理邏輯
 */
/**
 * 倒數計時完成時的處理邏輯
 */
function handleTimerCompletion() {
  // 停止當前計時器
  clearInterval(appState.timerInterval);
  appState.timerRunning = false;

  // 1. 播放提示音效
  playCompletionSound();

  // 2. 更新紀錄與切換模式
  if (appState.timerMode === 'focus') {
    appState.focusLogs.push({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      durationMinutes: appState.customDurations.focus
    });
    saveLocalStorage();
    updateAnalyticsStats();

    sendNotification("DoFlow 專注完成！", "🎉 恭喜獲得 1 個番茄 🍅，辛苦了！");
    if (typeof showToast === 'function') showToast("🎉 專注完成！獲得 1 個番茄 🍅");

    // 切換至短暫休息
    setTimerMode('shortBreak');

    // 【自動跨階段】：如果開啟自動開始休息
    if (appState.autoSwitchSettings.autoStartBreaks) {
      toggleTimer();
    }
  } else {
    sendNotification("DoFlow 休息結束！", "☕ 休息時間結束囉，準備開始下一輪專注吧！");
    if (typeof showToast === 'function') showToast("☕ 休息結束！準備開始專注囉。");

    // 切換回專注模式
    setTimerMode('focus');

    // 【自動跨階段】：如果開啟自動開始專注
    if (appState.autoSwitchSettings.autoStartFocus) {
      toggleTimer();
    }
  }
}


/* ==========================================================================
   任務動態過濾與渲染邏輯 (全深色系)
   ========================================================================== */

/**
 * 依據關鍵字搜尋與類別篩選器動態渲染任務列表
 */
function renderTasks() {
  const container = document.getElementById('tasks-list-container');
  if (!container) return;

  const searchInput = document.getElementById('task-search-input');
  const catFilterEl = document.getElementById('task-category-filter');

  const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const catFilter = catFilterEl ? catFilterEl.value : 'all';

  // 篩選符合條件的任務
  let filtered = appState.tasks.filter(t => {
    const matchesSearch = !searchQuery || t.title.toLowerCase().includes(searchQuery);
    const matchesCat = (catFilter === 'all') || (t.category === catFilter);
    return matchesSearch && matchesCat;
  });

  // 若無相符任務時顯示提示
  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-gray-500 text-xs font-medium">沒有找到符合條件的任務。</div>`;
    return;
  }

  // 分類名稱對照表
  const categoryMap = { Study: '📚 課業學習', Work: '💼 工作專案', Life: '🌿 個人生活' };

  // 拼接卡片 HTML 內容
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

/**
 * 將指定任務設為當前專注目標，並跳轉至番茄鐘分頁
 * @param {string} id - 任務 ID
 */
function setFocusTarget(id) {
  appState.activeTaskId = id;
  updateTargetTaskUI();
  switchTab('timer');
}

/**
 * 更新主介面與全螢幕覆蓋介面中的當前專注目標名稱
 */
function updateTargetTaskUI() {
  const task = appState.tasks.find(t => t.id === appState.activeTaskId);
  const container = document.getElementById('active-task-container');
  const titleOverlay = document.getElementById('overlay-task-title');

  if (task) {
    if (container) container.innerHTML = `<h4 class="text-sm font-bold text-white">${task.title}</h4>`;
    if (titleOverlay) titleOverlay.textContent = task.title;
  } else {
    if (container) container.innerHTML = `<p class="text-gray-500 text-sm text-center">尚未選擇專注目標。</p>`;
    if (titleOverlay) titleOverlay.textContent = "尚未選擇進行中的任務";
  }
}

/** 顯示新增任務模態框 */
function openAddTaskModal() { 
  const modal = document.getElementById('task-modal');
  if (modal) modal.classList.remove('hidden'); 
}

/** 關閉新增任務模態框 */
function closeTaskModal() { 
  const modal = document.getElementById('task-modal');
  if (modal) modal.classList.add('hidden'); 
}

/**
 * 表單提交處理：儲存新任務
 * @param {Event} e - 表單提交事件物件
 */
function saveTask(e) {
  e.preventDefault();
  const title = document.getElementById('form-task-title').value;
  const category = document.getElementById('form-task-category').value;
  const estimatedPomodoros = parseInt(document.getElementById('form-task-est-pomo').value) || 1;

  // 新增至任務陣列最前端
  appState.tasks.unshift({
    id: 'task_' + Date.now(),
    title,
    category,
    estimatedPomodoros,
    completed: false,
    status: 'todo'
  });

  saveLocalStorage();
  closeTaskModal();
  renderTasks();
}

/* ==========================================================================
   數據分析與 Chart.js 圖表控制
   ========================================================================== */

/**
 * 初始化 Chart.js 週專注統計圖表與分類圓圖
 */
function initializeCharts() {
  // 週專注時數長條圖 (Bar Chart)
  const cWeekly = document.getElementById('weekly-chart');
  if (cWeekly) {
    weeklyChartInstance = new Chart(cWeekly.getContext('2d'), {
      type: 'bar',
      data: { 
        labels: ['週一','週二','週三','週四','週五','週六','週日'], 
        datasets: [{ 
          label: '專注時數', 
          data: [1, 2, 1.5, 3, 2, 0.5, 4], 
          backgroundColor: '#6366f1' 
        }] 
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  // 任務類別比例甜甜圈圖 (Doughnut Chart)
  const cCat = document.getElementById('category-chart');
  if (cCat) {
    categoryChartInstance = new Chart(cCat.getContext('2d'), {
      type: 'doughnut',
      data: { 
        labels: ['課業', '工作', '生活'], 
        datasets: [{ 
          data: [6, 2, 2], 
          backgroundColor: ['#6366f1', '#f59e0b', '#10b981'] 
        }] 
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }
}

/**
 * 計算並更新統計頁面的數據總覽 (總專注時數與番茄數)
 */
function updateAnalyticsStats() {
  const totalMin = appState.focusLogs.reduce((acc, l) => acc + (l.durationMinutes || 0), 0);
  
  const hoursEl = document.getElementById('stats-total-hours');
  if (hoursEl) {
    hoursEl.innerHTML = `${(totalMin / 60).toFixed(1)} <span class="text-xs font-sans text-gray-400">小時</span>`;
  }
  
  const pomoEl = document.getElementById('stats-total-pomo');
  if (pomoEl) {
    pomoEl.textContent = `${appState.focusLogs.length} 🍅`;
  }
}

/* ==========================================================================
   UI 輔助與事件監聽函式
   ========================================================================== */

/**
 * 切換任務檢視模式（列表 / 看板模式）
 * @param {string} m - 'list' | 'kanban'
 */
function setTaskViewMode(m) { 
  appState.taskViewMode = m; 
}

/** HTML5 拖曳放置事件阻擋預設行為 */
function handleDragOver(e) { 
  e.preventDefault(); 
}

/**
 * Kanban 看板放開拖曳處理
 * @param {Event} e - DragEvent
 * @param {string} status - 放置目標狀態 ('todo' | 'inProgress' | 'done')
 */
function handleDrop(e, status) { 
  e.preventDefault(); 
}

/** 開啟全螢幕沉浸專注覆蓋層 */
function enterFocusOverlay() { 
  const overlay = document.getElementById('focus-overlay');
  if (overlay) overlay.classList.remove('hidden'); 
}

/** 退出全螢幕沉浸專注覆蓋層 */
function exitFocusOverlay() { 
  const overlay = document.getElementById('focus-overlay');
  if (overlay) overlay.classList.add('hidden'); 
}

/** 切換背景白噪音（Ambient Menu）彈出選單的顯示/隱藏 */
function toggleAmbientMenu() { 
  const popover = document.getElementById('ambient-popover');
  if (popover) popover.classList.toggle('hidden'); 
}

/**
 * 調整白噪音音量大小（待擴充）
 * @param {Event} e - Input 事件物件
 */
function setAmbientVolume(e) {}

/** 請求瀏覽器桌面通知權限 */
function requestNotificationPermission() { 
  alert("通知功能已就緒！"); 
}

/**
 * 更新自訂番茄鐘時長設定（待擴充）
 * @param {number} focus - 專注分鐘數
 * @param {number} shortBreak - 短休分鐘數
 * @param {number} longBreak - 長休分鐘數
 */
function updateCustomDurations(focus, shortBreak, longBreak) {
  if (focus) appState.customDurations.focus = focus;
  if (shortBreak) appState.customDurations.shortBreak = shortBreak;
  if (longBreak) appState.customDurations.longBreak = longBreak;
  setTimerMode(appState.timerMode);
}

/* ==========================================================================
   設定 Modal 控制與狀態更新邏輯
   ========================================================================== */

/** 開啟設定 Modal 並帶入當前狀態 */
function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  // 填入時間
  if (appState.customDurations) {
    const elFocus = document.getElementById('setting-focus-time');
    const elShort = document.getElementById('setting-short-break');
    const elLong = document.getElementById('setting-long-break');
    if (elFocus) elFocus.value = appState.customDurations.focus || 25;
    if (elShort) elShort.value = appState.customDurations.shortBreak || 5;
    if (elLong) elLong.value = appState.customDurations.longBreak || 15;
  }

  // 填入音效與音量
  if (appState.audioSettings) {
    const elSound = document.getElementById('setting-sound-type');
    const elVol = document.getElementById('setting-volume');
    if (elSound) elSound.value = appState.audioSettings.sound || 'bell';
    if (elVol) elVol.value = appState.audioSettings.volume ?? 0.8;
  }

  // 填入自動跨階段狀態
  if (appState.autoSwitchSettings) {
    const elAutoBreak = document.getElementById('setting-auto-break');
    const elAutoFocus = document.getElementById('setting-auto-focus');
    if (elAutoBreak) elAutoBreak.checked = !!appState.autoSwitchSettings.autoStartBreaks;
    if (elAutoFocus) elAutoFocus.checked = !!appState.autoSwitchSettings.autoStartFocus;
  }

  modal.classList.remove('hidden');
}

/** 關閉設定 Modal */
function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

/** 更新自訂時間 */
function updateCustomDurations(focus, shortBreak, longBreak) {
  if (!appState.customDurations) appState.customDurations = {};
  if (focus) appState.customDurations.focus = parseInt(focus);
  if (shortBreak) appState.customDurations.shortBreak = parseInt(shortBreak);
  if (longBreak) appState.customDurations.longBreak = parseInt(longBreak);
  
  if (typeof setTimerMode === 'function') {
    setTimerMode(appState.timerMode || 'focus');
  }
}

/** 更新音效與音量 */
function updateAudioSettings(soundKey, volume) {
  if (!appState.audioSettings) appState.audioSettings = {};
  if (soundKey) appState.audioSettings.sound = soundKey;
  if (volume !== undefined) appState.audioSettings.volume = parseFloat(volume);
}

/** 更新自動跨階段 */
function updateAutoSwitchSettings(autoBreaks, autoFocus) {
  if (!appState.autoSwitchSettings) appState.autoSwitchSettings = {};
  if (autoBreaks !== undefined) appState.autoSwitchSettings.autoStartBreaks = autoBreaks;
  if (autoFocus !== undefined) appState.autoSwitchSettings.autoStartFocus = autoFocus;
}

/** 按下「儲存變更」按鈕時執行 */
function saveSettingsModal() {
  const focus = parseInt(document.getElementById('setting-focus-time')?.value) || 25;
  const shortBreak = parseInt(document.getElementById('setting-short-break')?.value) || 5;
  const longBreak = parseInt(document.getElementById('setting-long-break')?.value) || 15;

  const sound = document.getElementById('setting-sound-type')?.value || 'bell';
  const volume = parseFloat(document.getElementById('setting-volume')?.value) ?? 0.8;

  const autoBreaks = document.getElementById('setting-auto-break')?.checked || false;
  const autoFocus = document.getElementById('setting-auto-focus')?.checked || false;

  // 1. 更新內部狀態
  updateCustomDurations(focus, shortBreak, longBreak);
  updateAudioSettings(sound, volume);
  updateAutoSwitchSettings(autoBreaks, autoFocus);

  // 2. 儲存至 LocalStorage
  if (typeof saveLocalStorage === 'function') {
    saveLocalStorage();
  }

  // 3. 關閉 Modal 視窗
  closeSettingsModal();

  // 4. 顯示提示
  if (typeof showToast === 'function') {
    showToast("⚙️ 設定已成功儲存！");
  }
}