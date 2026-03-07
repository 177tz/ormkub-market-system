// ================= 設定區 =================
const CONFIG = {
  // 您的 GAS 部署網址
  API_URL: 'https://script.google.com/macros/s/AKfycbxAxlODopFrwlM2W2WGMv6Zq6sFVUjbz9XsEGbKeZRZp89qLhmdCtkwk4_IkTFucchQ/exec',
  // 您的 LIFF ID
  LIFF_ID: '2008873691-AM28m7jo'
};

const APP_VERSION = 'v6.0.0 (Premium Dark)';

let currentUid = '', currentUser = null;
let loadedData = { markets: false, orders: false };

// ================= 初始化 =================
window.onload = async () => {
  const vEl = document.getElementById('app-version-display');
  if(vEl) vEl.innerText = APP_VERSION;

  try {
    await liff.init({ liffId: CONFIG.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }
    
    currentUid = (await liff.getProfile()).userId;
    await checkUser(currentUid);
  } catch (e) { 
    console.error(e); 
    hideLoading(); 
    document.getElementById('m-body').innerText = '系統連線錯誤: ' + e.message;
    new bootstrap.Modal(document.getElementById('infoModal')).show();
  }
};

// ================= API 核心 =================
async function callApi(act, pay={}) {
  const r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify({action: act, payload: pay}) });
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message);
  return j.data;
}

// 🔥 手風琴切換功能 (必須放在全域)
function toggleGroup(header) {
  header.classList.toggle('active');
  const content = header.nextElementSibling;
  // 切換顯示/隱藏
  if (content.style.display === 'none' || content.style.display === '') {
    content.style.display = 'block';
  } else {
    content.style.display = 'none';
  }
}

// ================= 使用者邏輯 =================
async function checkUser(uid) {
  try {
    const u = await callApi('checkUser', {uid});
    hideLoading();
    if (u) {
      currentUser = u;
      renderProfile(u);
      showView('dashboard-view');
    } else { showView('register-view'); }
  } catch (e) { alert(e.message); }
}

async function doRegister() {
  const ids = ['email','name','receiver','phone','store'];
  let vals = {};
  for (let k of ids) {
    let el = document.getElementById('reg-' + k);
    if (!el || !el.value.trim()) { alert('請填寫所有欄位'); return; }
    vals[k] = el.value.trim();
  }
  showLoading();
  try { 
    await callApi('register', {...vals, uid:currentUid}); 
    alert('綁定成功！');
    location.reload(); 
  } catch(e) { hideLoading(); alert('綁定失敗: ' + e.message); }
}

function renderProfile(u) {
  document.getElementById('header-name').innerText = u.name;
  document.getElementById('header-group').innerText = u.group_name;
  
  // ===========================================
  // 1. 首頁公告 (情報通知中心風格)
  // ===========================================
  const annoBox = document.getElementById('announcement-container');
  if (u.announcements && u.announcements.length > 0) {
    annoBox.innerHTML = u.announcements.map(a => {
      let typeClass = 'type-info'; 
      let icon = 'bi-info-circle-fill';
      
      if (a.type === 'alert') { 
        typeClass = 'type-alert'; 
        icon = 'bi-exclamation-triangle-fill'; 
      } else if (a.type === 'success') { 
        typeClass = 'type-success'; 
        icon = 'bi-check-circle-fill'; 
      }

      return `
        <div class="anno-card ${typeClass} fade-in">
          <div class="anno-title">
            <i class="bi ${icon}"></i> ${a.title}
          </div>
          <div class="anno-content">${a.content}</div>
        </div>`;
    }).join('');
  } else {
    annoBox.innerHTML = `
      <div class="anno-card type-info">
        <div class="anno-title"><i class="bi bi-megaphone-fill"></i> 最新公告</div>
        <div class="anno-content">目前沒有新公告。</div>
      </div>`;
  }

  // ===========================================
  // 3. 個人資料 (虛擬黑卡 + iOS 設定頁)
  // ===========================================
  document.getElementById('p-group').innerText = u.group_name;
  document.getElementById('p-email').innerText = u.email;
  document.getElementById('p-phone').innerText = u.phone;
  document.getElementById('p-receiver').innerText = u.name;
  document.getElementById('p-store').innerText = u.store;
}

// ================= 頁面切換 =================
function switchTab(tab, btn) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.querySelectorAll('.content-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');

  if (tab === 'markets' && !loadedData.markets) loadMarkets(currentUid);
  if (tab === 'orders' && !loadedData.orders) loadOrders(currentUid);
}

// ================= 資料載入：賣場 (VIP 專屬通行證) =================
async function loadMarkets(uid) {
  const div = document.getElementById('market-list');
  div.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>';
  try {
    const mkts = await callApi('getMarkets', {uid});
    loadedData.markets = true; 
    div.innerHTML = mkts.length ? mkts.map(m => `
      <a href="${m.link}" target="_blank" class="btn-market fade-in">
        <div class="market-info">
          <h6>${m.sheetName}</h6>
          <small>${m.desc||'點擊前往專屬賣場'}</small>
        </div>
        <i class="bi bi-chevron-right"></i>
      </a>`).join('') : '<div class="text-center text-muted p-4">目前無專屬賣場</div>';
  } catch(e) { div.innerHTML = '載入失敗'; }
}

// ================= 資料載入：訂單 (存摺風) =================
async function loadOrders(uid) {
  const div = document.getElementById('orders-container');
  div.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><div class="small mt-2 text-muted">同步訂單中...</div></div>';
  
  try {
    const groups = await callApi('getOrders', {uid});
    loadedData.orders = true;

    if (!groups || groups.length === 0) {
      div.innerHTML = `<div class="text-center py-5 fade-in"><i class="bi bi-basket display-1 text-muted opacity-25"></i><p class="mt-3 text-muted">尚無訂購紀錄</p></div>`;
      return;
    }

    const formatTime = (t) => {
      if (!t) return '-';
      try {
        let d = new Date(t);
        if (isNaN(d.getTime())) return t; 
        return (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getDate().toString().padStart(2,'0') + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
      } catch(e) { return t; }
    };

    div.innerHTML = groups.map((g, index) => {
      // 邏輯：第一筆(最新)展開，其他收合
      const isFirst = index === 0;
      const displayStyle = isFirst ? 'block' : 'none';
      const activeClass = isFirst ? 'active' : '';

      // 1. 明細 HTML
      let details = (g.details && g.details.length) ? g.details.map(d => `
        <div class="item-row">
          <div>
            <div class="item-name">${d.item}</div>
            ${d.note ? `<div class="item-note"><i class="bi bi-info-circle-fill me-1"></i>${d.note}</div>` : ''}
          </div>
          <div class="item-qty">x${d.qty}</div>
        </div>`).join('') : '<div class="text-center small text-muted py-2">無明細</div>';

      // 2. 對帳 HTML 與 橫列外觀
      let summaryHtml = '';
      let rowTotal = '0';
      let rowStatus = '未標示';
      let badgeCls = 'st-wait';
      let rowDate = '-';
      
      if (g.summary && g.summary.length > 0) {
        let s = g.summary[0]; // 取第一筆對帳資料
        rowTotal = s.total;
        rowStatus = s.status || '未標示';
        rowDate = formatTime(s.time);
        
        if(rowStatus.includes('✅') || rowStatus.includes('完成') || rowStatus.includes('OK') || rowStatus.includes('面交')) { badgeCls = 'st-ok'; }
        else if(rowStatus.includes('❌') || rowStatus.includes('有誤') || rowStatus.includes('不符')) { badgeCls = 'st-err'; }

        let noteHtml = s.note ? `<div class="mt-3 p-3 bg-warning bg-opacity-10 rounded-3 text-warning border border-warning border-opacity-25" style="font-size:0.85rem; white-space: pre-wrap;"><i class="bi bi-exclamation-circle-fill me-1"></i>備註：${s.note}</div>` : '';
        
        let actionBtn = s.formLink ? `
          <div class="mt-3">
            <a href="${s.formLink}" target="_blank" class="action-btn">前往匯款 / 填寫表單</a>
          </div>
        ` : '';

        summaryHtml = `
          <div class="info-grid">
            <div class="info-item">
              <span class="info-label">總件數</span>
              <span class="info-value">${s.count || '-'} 件</span>
            </div>
            <div class="info-item">
              <span class="info-label">實收金額</span>
              <span class="info-value val-blue">$${s.actual || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">後五碼</span>
              <span class="info-value">${s.last5 || '未填'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">收款時間</span>
              <span class="info-value">${rowDate}</span>
            </div>
          </div>
          ${noteHtml}
          ${actionBtn}
        `;
      } else {
        summaryHtml = '<div class="text-center small text-muted">待核算</div>';
      }

      // 🔥 Apple Wallet 存摺風 橫列結構
      return `
        <div class="transaction-row fade-in">
          <!-- 橫列標題 (點擊展開) -->
          <div class="group-header-clickable ${activeClass}" onclick="toggleGroup(this)">
            <div class="tx-left">
              <div class="tx-icon">
                <i class="bi bi-bag-check"></i>
              </div>
              <div class="tx-title">
                <span class="group-name">${g.groupName}</span>
                <span class="tx-date">${rowDate}</span>
              </div>
            </div>
            <div class="tx-right">
              <span class="tx-amount">$${rowTotal}</span>
              <span class="status-badge ${badgeCls}">${rowStatus}</span>
            </div>
          </div>
          
          <!-- 抽屜內容 (預設隱藏) -->
          <div class="group-content" style="display: ${displayStyle};">
            <div class="item-list">${details}</div>
            ${summaryHtml}
          </div>
        </div>`;
    }).join('');
  } catch(e) { div.innerHTML = '載入失敗，請刷新重試'; }
}

// Helper
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }
function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function showView(id) {
  document.getElementById('register-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
}
