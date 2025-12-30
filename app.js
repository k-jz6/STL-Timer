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
    await checkAndInitTaskData();
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
            // 選択後はプルダウンをリセット（空にする）して、連続選択しやすくする
            e.target.value = "";
        }
    });

    document.getElementById('add-category-btn').addEventListener('click', addCategory);
    document.getElementById('show-category-chk').addEventListener('change', toggleCategoryDisplay);
    document.getElementById('manual-backup-btn').addEventListener('click', downloadJSON);
    document.getElementById('csv-export-btn').addEventListener('click', exportCSV);

    window.addEventListener('beforeunload', saveSettings);
};

// グローバル公開 (DOMイベント用)
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

    // スタイルのコピー
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
        const container = document.getElementById('timer-widget-container');
        if(container) {
            container.appendChild(widgetContent);
            container.classList.add('hidden-in-dashboard');
        }
        pipWindow = null;
    });

    updateTaskSelectOptions();
    toggleCategoryDisplay();

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

function checkAndInitTaskData() {
    return new Promise((resolve) => {
        const tx = db.transaction(['tasks'], 'readwrite');
        const store = tx.objectStore('tasks');
        const req = store.count();
        req.onsuccess = () => {
            if (req.result === 0) {
                ["メール確認", "資料作成", "会議", "設計", "調査"].forEach(t => store.put({ name: t }));
            }
            resolve();
        };
        req.onerror = () => resolve();
    });
}

function updateTaskSelectOptions() {
    if (!db) return;
    const tx = db.transaction(['tasks'], 'readonly');
    tx.objectStore('tasks').getAll().onsuccess = (e) => {
        const tasks = e.target.result;
        
        const createOptions = (doc) => {
            if (!doc) return;
            const sel = doc.getElementById('task-history-select');
            if (!sel) return;

            sel.innerHTML = ''; // クリア

            const emptyOpt = document.createElement('option');
            emptyOpt.value = "";
            emptyOpt.disabled = true;
            emptyOpt.selected = true;
            emptyOpt.hidden = true;
            emptyOpt.style.display = "none";
            sel.appendChild(emptyOpt);

            tasks.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.name;      
                
                // タスク履歴の表示文字数制限
                let displayText = t.name;
                if (displayText.length > 23) {
                    displayText = displayText.substring(0, 23) + "…";
                }
                opt.textContent = displayText;
                
                sel.appendChild(opt);
            });
        };

        createOptions(document);
        if (pipWindow) createOptions(pipWindow.document);
    };
}

function updateTaskListUI() {
    if (!db) return;
    const tx = db.transaction(['tasks'], 'readonly');
    tx.objectStore('tasks').getAll().onsuccess = (e) => {
        const tasks = e.target.result;
        const listEl = document.getElementById('task-list-display');
        if (!listEl) return;
        
        listEl.innerHTML = ''; // クリア
        
        tasks.forEach(t => {
            const li = document.createElement('li');
            const textNode = document.createTextNode(t.name + " ");
            li.appendChild(textNode);

            const btn = document.createElement('button');
            btn.className = "delete-btn";
            btn.textContent = "×";
            btn.onclick = () => deleteTaskHistory(t.name);
            
            li.appendChild(btn);
            listEl.appendChild(li);
        });
    };
}

// === 分類管理 ===
function getCategories() {
    const json = localStorage.getItem('timer_categories');
    try {
        return json ? JSON.parse(json) : [];
    } catch (e) {
        return [];
    }
}
function saveCategories(cats) {
    localStorage.setItem('timer_categories', JSON.stringify(cats));
    updateCategoryUI();
}
function addCategory() {
    const input = document.getElementById('new-category');
    // 長すぎる入力をカット（CWE-20対策）
    const val = input.value.trim().substring(0, 50);
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

// 【修正箇所】分類プルダウンも表示文字数を制限するよう変更
function updateCategoryUI() {
    const cats = getCategories();
    
    // 1. 設定画面リストの更新
    const listEl = document.getElementById('category-list-display');
    if (listEl) {
        listEl.innerHTML = '';
        cats.forEach(c => {
            const li = document.createElement('li');
            li.appendChild(document.createTextNode(c + " "));

            const btn = document.createElement('button');
            btn.className = "delete-btn";
            btn.textContent = "×";
            btn.onclick = () => deleteCategory(c);

            li.appendChild(btn);
            listEl.appendChild(li);
        });
    }

    // 2. Selectボックスの更新（ここを修正）
    const updateSelect = (doc) => {
        if (!doc) return;
        const sel = doc.getElementById('category-select');
        if (sel) {
            const currentVal = sel.value;
            sel.innerHTML = ''; // クリア

            const defaultOpt = document.createElement('option');
            defaultOpt.value = "";
            defaultOpt.textContent = "未分類";
            sel.appendChild(defaultOpt);

            cats.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; // 値は完全なまま保持
                
                // 表示だけ15文字でカットして「…」をつける
                let displayText = c;
                if (displayText.length > 15) {
                    displayText = displayText.substring(0, 15) + "…";
                }
                opt.textContent = displayText; 
                
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
        
        tbody.innerHTML = ''; // クリア

        logs.forEach(log => {
            const tr = document.createElement('tr');

            const createTd = (text) => {
                const td = document.createElement('td');
                td.textContent = text || "";
                return td;
            };

            tr.appendChild(createTd(formatDateTimeExact(log.startTime)));
            tr.appendChild(createTd(formatDateTimeExact(log.endTime)));
            tr.appendChild(createTd(log.duration));
            tr.appendChild(createTd(log.category));
            tr.appendChild(createTd(log.task));

            const tdAction = document.createElement('td');
            const btn = document.createElement('button');
            btn.className = "btn-secondary";
            btn.style.padding = "2px 8px";
            btn.textContent = "削除";
            btn.onclick = () => deleteLog(log.id);
            tdAction.appendChild(btn);
            
            tr.appendChild(tdAction);
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

// CSV Injection (Formula Injection) 対策関数 (CWE-1236)
function sanitizeCSVField(field) {
    if (field == null) return "";
    let str = String(field);
    
    if (/^[=\+\-@\t\r]/.test(str)) {
        str = "'" + str;
    }
    
    return `"${str.replace(/"/g, '""')}"`;
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
                let val = "";
                if (col === '開始時間') val = formatDateTimeExact(log.startTime);
                else if (col === '終了時間') val = formatDateTimeExact(log.endTime);
                else if (col === '経過時間') val = log.duration;
                else if (col === '分類') val = log.category;
                else if (col === '内容') val = log.task;
                
                return sanitizeCSVField(val);
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
function loadSettings() {
    updateCategoryUI();
    const showCat = localStorage.getItem('timer_show_category') === 'true';
    const chk = document.getElementById('show-category-chk');
    if (chk) chk.checked = showCat;
    toggleCategoryDisplay();
}
function saveSettings() { }