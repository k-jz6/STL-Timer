// === グローバル変数 ===
let db;
let timerInterval;
let startTime = null;
let pipWindow = null;
let currentTask = "";
let currentCategory = "";
let isHistoryDesc = true;

// === 初期化 ===
window.onload = async () => {
    await initDB();
    await checkAndInitTaskData(); // ★データがない場合に初期値を投入する処理
    loadHistory();
    loadSettings();
    updateTaskSelectOptions();
    updateTaskListUI();

    // イベントリスナー
    document.getElementById('launch-pip-btn').addEventListener('click', openPiP);
    document.getElementById('toggle-btn').addEventListener('click', toggleTimer);
    document.getElementById('menu-btn').addEventListener('click', () => { if (pipWindow) window.focus(); });
    document.getElementById('sort-toggle-btn').addEventListener('click', toggleSortHistory);

    // 履歴プルダウン変更時
    document.getElementById('task-history-select').addEventListener('change', (e) => {
        const input = document.getElementById('task-input');
        if (e.target.value) {
            input.value = e.target.value;
            e.target.value = "";
        }
    });

    // 設定関連
    document.getElementById('add-category-btn').addEventListener('click', addCategory);
    document.getElementById('show-category-chk').addEventListener('change', toggleCategoryDisplay);
    document.getElementById('manual-backup-btn').addEventListener('click', downloadJSON);
    document.getElementById('csv-export-btn').addEventListener('click', exportCSV);

    window.addEventListener('beforeunload', saveSettings);
};

// グローバル公開
window.deleteLog = deleteLog;
window.deleteCategory = deleteCategory;
window.deleteTaskHistory = deleteTaskHistory;

// === PiP 制御 ===
async function openPiP() {
    if (!('documentPictureInPicture' in window)) {
        alert("Document PiP未対応です。");
        return;
    }
    const widget = document.getElementById('timer-widget-container');
    const widgetContent = widget.querySelector('.timer-widget');

    pipWindow = await documentPictureInPicture.requestWindow({ width: 320, height: 80 });

    [...document.styleSheets].forEach((styleSheet) => {
        try {
            const cssRules = [...styleSheet.cssRules].map(r => r.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            pipWindow.document.head.appendChild(style);
        } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
        }
    });

    pipWindow.document.body.appendChild(widgetContent);
    widget.classList.remove('hidden-in-dashboard');

    pipWindow.addEventListener('pagehide', () => {
        document.getElementById('timer-widget-container').appendChild(widgetContent);
        document.getElementById('timer-widget-container').classList.add('hidden-in-dashboard');
        pipWindow = null;
    });

    updateTaskSelectOptions();
    toggleCategoryDisplay();

    // PiP内のSelectイベント
    const pipSelect = pipWindow.document.getElementById('task-history-select');
    if (pipSelect) {
        pipSelect.addEventListener('change', (e) => {
            const pipInput = pipWindow.document.getElementById('task-input');
            if (e.target.value) {
                pipInput.value = e.target.value;
                e.target.value = "";
            }
        });
    }
}

// === タイマー制御 ===
function getEl(id) {
    let el = document.getElementById(id);
    if (!el && pipWindow) el = pipWindow.document.getElementById(id);
    return el;
}

function toggleTimer() {
    const btn = getEl('toggle-btn');
    const input = getEl('task-input');
    const catSelect = getEl('category-select');
    const display = getEl('timer-display');

    if (!startTime) {
        // 開始処理
        startTime = new Date();
        currentTask = input.value;
        currentCategory = catSelect.value;

        btn.textContent = "停止";
        btn.classList.replace('btn-primary', 'btn-secondary');

        if (currentTask) addToTaskHistory(currentTask);

        timerInterval = setInterval(() => {
            const now = new Date();
            const diff = now - startTime;
            const iso = new Date(diff).toISOString().substr(11, 8);
            display.textContent = iso;
        }, 1000);

    } else {
        // 停止処理
        clearInterval(timerInterval);
        const endTime = new Date();
        saveLog(startTime, endTime, currentTask, currentCategory);

        startTime = null;
        btn.textContent = "開始";
        btn.classList.replace('btn-secondary', 'btn-primary');
        display.textContent = "00:00:00";
        loadHistory();
    }
}

// === タスク履歴管理 ===
function addToTaskHistory(name) {
    if (!name) return;
    const tx = db.transaction(['tasks'], 'readwrite');
    tx.objectStore('tasks').put({ name: name });
    tx.oncomplete = () => {
        updateTaskSelectOptions();
        updateTaskListUI();
    };
}

function deleteTaskHistory(name) {
    if (!confirm(`履歴「${name}」を削除しますか？`)) return;
    const tx = db.transaction(['tasks'], 'readwrite');
    tx.objectStore('tasks').delete(name);
    tx.oncomplete = () => {
        updateTaskSelectOptions();
        updateTaskListUI();
    };
}

// 初期データチェック・投入（候補が出ない対策）
function checkAndInitTaskData() {
    return new Promise((resolve) => {
        const tx = db.transaction(['tasks'], 'readwrite');
        const store = tx.objectStore('tasks');
        const req = store.count();
        req.onsuccess = () => {
            if (req.result === 0) {
                store.put({ name: "メール確認" });
                store.put({ name: "資料作成" });
                store.put({ name: "会議" });
                store.put({ name: "設計" });
                store.put({ name: "調査" });
            }
            resolve();
        };
        req.onerror = () => resolve(); // エラーでも止まらないように
    });
}

function updateTaskSelectOptions() {
    if (!db) return;
    const tx = db.transaction(['tasks'], 'readonly');
    tx.objectStore('tasks').getAll().onsuccess = (e) => {
        const tasks = e.target.result;
        // 先頭は空（CSSで矢印表示）
        let opts = `<option value="" disabled selected hidden style="display:none"></option>`;
        opts += tasks.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');

        const setHTML = (doc) => {
            if (!doc) return;
            const sel = doc.getElementById('task-history-select');
            if (sel) sel.innerHTML = opts;
        };
        setHTML(document);
        if (pipWindow) setHTML(pipWindow.document);
    };
}

function updateTaskListUI() {
    if (!db) return;
    const tx = db.transaction(['tasks'], 'readonly');
    tx.objectStore('tasks').getAll().onsuccess = (e) => {
        const tasks = e.target.result;
        const listEl = document.getElementById('task-list-display');
        if (!listEl) return;
        listEl.innerHTML = '';
        tasks.forEach(t => {
            const li = document.createElement('li');
            li.innerHTML = `${escapeHtml(t.name)} <button class="delete-btn" onclick="deleteTaskHistory('${escapeHtml(t.name)}')">×</button>`;
            listEl.appendChild(li);
        });
    };
}

// === 分類管理 ===
function getCategories() {
    const json = localStorage.getItem('timer_categories');
    return json ? JSON.parse(json) : [];
}
function saveCategories(cats) {
    localStorage.setItem('timer_categories', JSON.stringify(cats));
    updateCategoryUI();
}
function addCategory() {
    const input = document.getElementById('new-category');
    const val = input.value.trim();
    if (val) {
        const cats = getCategories();
        if (!cats.includes(val)) {
            cats.push(val);
            saveCategories(cats);
            input.value = "";
        }
    }
}
function deleteCategory(val) {
    if (!confirm(`分類「${val}」を削除しますか？`)) return;
    const cats = getCategories();
    const newCats = cats.filter(c => c !== val);
    saveCategories(newCats);
}
function updateCategoryUI() {
    const cats = getCategories();
    const listEl = document.getElementById('category-list-display');
    if (listEl) {
        listEl.innerHTML = '';
        cats.forEach(c => {
            const li = document.createElement('li');
            li.innerHTML = `${escapeHtml(c)} <button class="delete-btn" onclick="deleteCategory('${escapeHtml(c)}')">×</button>`;
            listEl.appendChild(li);
        });
    }
    const updateSelect = (doc) => {
        if (!doc) return;
        const sel = doc.getElementById('category-select');
        if (sel) {
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">未分類</option>';
            cats.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                sel.appendChild(opt);
            });
            sel.value = currentVal;
        }
    };
    updateSelect(document);
    if (pipWindow) updateSelect(pipWindow.document);
}
function toggleCategoryDisplay() {
    const isChecked = document.getElementById('show-category-chk').checked;
    const setDisplay = (doc) => {
        if (!doc) return;
        const sel = doc.getElementById('category-select');
        if (sel) sel.style.display = isChecked ? 'inline-block' : 'none';
    };
    setDisplay(document);
    if (pipWindow) setDisplay(pipWindow.document);
    localStorage.setItem('timer_show_category', isChecked);
}

// === IndexedDB (Log) ===
function initDB() {
    return new Promise((resolve, reject) => {
        // DBバージョンを 3 に変更
        const req = indexedDB.open('WorkTimerDB', 3);
        req.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains('logs')) {
                db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('tasks')) {
                db.createObjectStore('tasks', { keyPath: 'name' });
            }
        };
        req.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        req.onerror = reject;
    });
}

function saveLog(start, end, task, category) {
    const tx = db.transaction(['logs'], 'readwrite');
    const durationMs = end - start;
    const durationStr = new Date(durationMs).toISOString().substr(11, 8);
    const record = {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        duration: durationStr,
        task: task,
        category: category,
        createdAt: new Date().toISOString()
    };
    tx.objectStore('logs').add(record);
}

function toggleSortHistory() {
    isHistoryDesc = !isHistoryDesc;
    const btn = document.getElementById('sort-toggle-btn');
    btn.textContent = isHistoryDesc ? "▼ 新しい順" : "▲ 古い順";
    loadHistory();
}

function loadHistory() {
    if (!db) return;
    const tx = db.transaction(['logs'], 'readonly');
    tx.objectStore('logs').getAll().onsuccess = (e) => {
        let logs = e.target.result;
        logs.sort((a, b) => {
            const tA = new Date(a.startTime).getTime();
            const tB = new Date(b.startTime).getTime();
            return isHistoryDesc ? tB - tA : tA - tB;
        });
        const tbody = document.querySelector('#history-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatDateTimeExact(log.startTime)}</td>
                <td>${formatDateTimeExact(log.endTime)}</td>
                <td>${log.duration}</td>
                <td>${escapeHtml(log.category)}</td>
                <td>${escapeHtml(log.task)}</td>
                <td><button class="btn-secondary" onclick="deleteLog(${log.id})" style="padding:2px 8px;">削除</button></td>
            `;
            tbody.appendChild(tr);
        });
    };
}
function deleteLog(id) {
    if (!confirm('この履歴を削除しますか？')) return;
    const tx = db.transaction(['logs'], 'readwrite');
    tx.objectStore('logs').delete(id);
    tx.oncomplete = () => loadHistory();
}

// === フォーマット ===
function getNowFileNameStr() {
    const d = new Date();
    const pad = n => (n < 10 ? '0' + n : n);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function formatDateTimeExact(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = n => (n < 10 ? '0' + n : n);
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// === 出力 ===
function downloadJSON() {
    const tx = db.transaction(['logs', 'tasks'], 'readonly');
    Promise.all([
        new Promise(r => tx.objectStore('logs').getAll().onsuccess = e => r(e.target.result)),
        new Promise(r => tx.objectStore('tasks').getAll().onsuccess = e => r(e.target.result))
    ]).then(([logs, tasks]) => {
        const data = {
            logs: logs,
            tasks: tasks,
            categories: getCategories(),
            exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `timer_backup_${getNowFileNameStr()}.json`;
        link.click();
    });
}
function exportCSV() {
    const orderStr = document.getElementById('csv-order').value;
    const order = orderStr.split(',').map(s => s.trim());
    const tx = db.transaction(['logs'], 'readonly');
    tx.objectStore('logs').getAll().onsuccess = (e) => {
        const logs = e.target.result;
        let csv = "\uFEFF" + order.join(',') + "\n";
        logs.forEach(log => {
            const row = order.map(col => {
                if (col === '開始時間') return formatDateTimeExact(log.startTime);
                if (col === '終了時間') return formatDateTimeExact(log.endTime);
                if (col === '経過時間') return log.duration;
                if (col === '分類') return `"${(log.category || '').replace(/"/g, '""')}"`;
                if (col === '内容') return `"${(log.task || '').replace(/"/g, '""')}"`;
                return "";
            });
            csv += row.join(',') + "\n";
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `timer_log_${getNowFileNameStr()}.csv`;
        link.click();
    };
}

// === ユーティリティ ===
function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}
function loadSettings() {
    updateCategoryUI();
    const showCat = localStorage.getItem('timer_show_category') === 'true';
    const chk = document.getElementById('show-category-chk');
    if (chk) chk.checked = showCat;
    toggleCategoryDisplay();
}
function saveSettings() { }