// ================= 設定區 =================
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxAxlODopFrwlM2W2WGMv6Zq6sFVUjbz9XsEGbKeZRZp89qLhmdCtkwk4_IkTFucchQ/exec',
  LIFF_ID: '2008873691-AM28m7jo'
};

const APP_VERSION = 'v4.0.0 (Navy Wallet)';
let currentUid = '', currentUser = null;
let loadedData = { markets: false, orders: false };

// ================= 初始化 =================
window.onload = async () => {
  try {
    await liff.init({ liffId: CONFIG.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }
    currentUid = (await liff.getProfile()).userId;
    await checkUser(currentUid);
  } catch (e) { 
    console.error(e); hideLoading(); 
    document.getElementById('m-body').innerText = '系統連線錯誤: ' + e.message;
    new bootstrap.Modal(document.getElementById('infoModal')).show();
  }
};

async function callApi(act, pay={}) {
  const r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify({action: act, payload: pay}) });
  const j = await r.json();
  if (j.status === 'error') throw new Error(j.message);
  return j.data;
}

// 手風琴切換
function toggleWallet(header) {
  header.classList.toggle('active');
  const content = header.nextElementSibling;
  content.style.display = (content.style.display === 'none' || content.style.display === '') ? 'block' : 'none';
}

// ================= 使用者與註冊 =================
async function checkUser(uid) {
  try {
    const u = await callApi('checkUser', {uid});
    hideLoading();
    if (u) {
      currentUser = u; renderProfile(u); showView('dashboard-view');
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
    location.reload(); 
  } catch(e) { hideLoading(); alert('綁定失敗: ' + e.message); }
}

// ================= 渲染資料 =================
function renderProfile(u) {
  document.getElementById('header-name').innerText = u.name;
  document.getElementById('header-group').innerText = u.group_name;
  
  const annoBox = document.getElementById('announcement-container');
  if (u.announcements && u.announcements.length > 0) {
    annoBox.innerHTML = u.announcements.map(a => {
      let cls = 'anno-card '; let icon = 'bi-info-circle-fill'; let color = 'var(--accent-teal)';
      if (a.type === 'alert') { cls += 'alert'; icon = 'bi-exclamation-triangle-fill'; color = 'var(--accent-orange)'; } 
      else if (a.type === 'success') { cls += 'success'; icon = 'bi-check-circle-fill'; color = 'var(--accent-gold)'; }
      return `
        <div class="card-box ${cls} fade-in">
          <h6 class="fw-bold mb-2" style="color:${color}"><i class="bi ${icon} me-2"></i>${a.title}</h6>
          <p class="small mb-0" style="color:var(--text-sub); line-height:1.5; white-space:pre-wrap;">${a.content}</p>
        </div>`;
    }).join('');
  } else { annoBox.innerHTML = `<div class="card-box"><p class="small mb-0 text-center" style="color:var(--text-sub);">目前沒有新公告</p></div>`; }

  ['group','email','phone','receiver','store'].forEach(k => {
    document.getElementById('p-'+k).innerText = u[k==='group'?'group_name':(k==='receiver'?'name':k)];
  });
}

function switchTab(tab, btn) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  document.querySelectorAll('.content-section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  if (tab === 'markets' && !loadedData.markets) loadMarkets(currentUid);
  if (tab === 'orders' && !loadedData.orders) loadOrders(currentUid);
}

async function loadMarkets(uid) {
  const div = document.getElementById('market-list');
  div.innerHTML = '<div class="text-center py-4"><div class="spinner-border" style="color:var(--accent-teal);"></div></div>';
  try {
    const mkts = await callApi('getMarkets', {uid}); loadedData.markets = true; 
    div.innerHTML = mkts.length ? mkts.map(m => `
      <a href="${m.link}" target="_blank" class="btn-market fade-in">
        <div><h6>${m.sheetName}</h6><small style="color:var(--text-sub);">${m.desc||'點擊前往'}</small></div>
        <i class="bi bi-chevron-right"></i>
      </a>`).join('') : '<div class="text-center p-4" style="color:var(--text-sub);">目前無專屬賣場</div>';
  } catch(e) { div.innerHTML = '載入失敗'; }
}

// 🔥 核心：電子存摺風訂單載入
async function loadOrders(uid) {
  const div = document.getElementById('orders-container');
  div.innerHTML = '<div class="text-center py-4"><div class="spinner-border" style="color:var(--accent-teal);"></div></div>';
  
  try {
    const groups = await callApi('getOrders', {uid});
    loadedData.orders = true;
    if (!groups || groups.length === 0) {
      div.innerHTML = `<div class="text-center py-5"><i class="bi bi-wallet2 display-1" style="color:var(--border-light);"></i><p class="mt-3" style="color:var(--text-sub);">尚無交易紀錄</p></div>`;
      return;
    }

    // 格式化時間 (修復 ISO 字串問題)
    const formatTime = (t) => {
      if (!t) return '-';
      try {
        let d = new Date(t); if (isNaN(d.getTime())) return t; 
        return (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getDate().toString().padStart(2,'0') + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
      } catch(e) { return t; }
    };

    div.innerHTML = groups.map((g, index) => {
      const isFirst = index === 0;
      const displayStyle = isFirst ? 'block' : 'none';
      const activeClass = isFirst ? 'active' : '';

      // 明細
      let details = (g.details && g.details.length) ? g.details.map(d => `
        <div class="detail-row">
          <div><div class="d-item">${d.item}</div>${d.note ? `<div class="d-note">${d.note}</div>` : ''}</div>
          <div class="d-qty">x${d.qty}</div>
        </div>`).join('') : '<div class="text-center small py-2" style="color:var(--text-sub);">無明細</div>';

      // 摘要與對帳
      let summaryData = (g.summary && g.summary.length > 0) ? g.summary[0] : {};
      
      let st = summaryData.status || '未標示';
      let badgeCls = 'st-wait';
      if(st.includes('✅') || st.includes('完成') || st.includes('OK') || st.includes('面交')) { badgeCls = 'st-ok'; }
      else if(st.includes('❌') || st.includes('有誤') || st.includes('不符')) { badgeCls = 'st-err'; }

      let totalAmt = summaryData.total !== undefined ? summaryData.total : '-';
      let prettyTime = formatTime(summaryData.time);
      let noteHtml = summaryData.note ? `<div class="note-box"><i class="bi bi-exclamation-circle-fill me-1"></i>備註：${summaryData.note}</div>` : '';
      let actionBtn = summaryData.formLink ? `<a href="${summaryData.formLink}" target="_blank" class="action-btn mt-3"><i class="bi bi-credit-card-fill me-2"></i>前往匯款</a>` : '';

      return `
        <div class="wallet-card fade-in">
          <div class="wallet-header ${activeClass}" onclick="toggleWallet(this)">
            <div class="w-title-area">
              <div class="w-icon"><i class="bi bi-bag-check-fill"></i></div>
              <div>
                <p class="w-name">${g.groupName}</p>
                <p class="w-date">${prettyTime !== '-' ? prettyTime.split(' ')[0] : '待確認'}</p>
              </div>
            </div>
            <div class="w-amount-area">
              <p class="w-amount">$${totalAmt}</p>
              <span class="st-badge ${badgeCls}">${st}</span>
              <i class="bi bi-chevron-down toggle-arrow"></i>
            </div>
          </div>
          
          <div class="wallet-content" style="display: ${displayStyle};">
            <div class="detail-list">${details}</div>
            <div class="acc-grid">
              <div class="acc-box"><span class="acc-label">總件數</span><span class="acc-val">${summaryData.count || '-'} 件</span></div>
              <div class="acc-box"><span class="acc-label">實收金額</span><span class="acc-val acc-val-blue">$${summaryData.actual || '-'}</span></div>
              <div class="acc-box"><span class="acc-label">後五碼</span><span class="acc-val">${summaryData.last5 || '-'}</span></div>
              <div class="acc-box"><span class="acc-label">收款時間</span><span class="acc-val" style="font-size:12px;">${prettyTime}</span></div>
            </div>
            ${noteHtml}
            ${actionBtn}
          </div>
        </div>`;
    }).join('');
  } catch(e) { div.innerHTML = '載入失敗，請刷新重試'; }
}

function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }
function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function showView(id) {
  document.getElementById('register-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
}
