const money = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 0
});

const statusMap = {
  pending: { label: '待赛果', className: 'status-pending' },
  win: { label: '已中奖', className: 'status-win' },
  lost: { label: '未中奖', className: 'status-lost' }
};

const rangeText = {
  recent: '近 7 单',
  month: '本月',
  all: '全部'
};

const state = {
  records: [],
  stats: {
    totalStake: 0,
    settledPrize: 0,
    netProfit: 0,
    pending: 0,
    total: 0
  },
  trendValues: [],
  activeFilter: 'all',
  selectedId: null,
  activeRange: 'recent',
  pendingLegs: [],
  ticketPreviewUrl: '',
  uploadedImagePath: ''
};

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const el = id => document.getElementById(id);
const recordForm = el('recordForm');
const formToast = el('formToast');
const recordTable = el('recordTable');
const resultInput = el('resultInput');
const prizeInput = el('prizeInput');
const settleNoteInput = el('settleNoteInput');
const settleToast = el('settleToast');
const settleWin = el('settleWin');
const settleLost = el('settleLost');
const rangeLabel = el('rangeLabel');
const summaryText = el('summaryText');
const copySummary = el('copySummary');
const copyToast = el('copyToast');
const legLeagueInput = el('legLeagueInput');
const legMatchInput = el('legMatchInput');
const legPlaySelect = el('legPlaySelect');
const legPickInput = el('legPickInput');
const addLegBtn = el('addLegBtn');
const legsList = el('legsList');
const legCountTag = el('legCountTag');
const ticketTypeSelect = el('ticketTypeSelect');
const amountInput = el('amountInput');
const multipleInput = el('multipleInput');
const previewType = el('previewType');
const previewLegs = el('previewLegs');
const previewStake = el('previewStake');
const ticketImageInput = el('ticketImageInput');
const aiPreview = el('aiPreview');
const runAiFill = el('runAiFill');
const aiToast = el('aiToast');
const aiEndpointInput = el('aiEndpointInput');
const aiKeyInput = el('aiKeyInput');

const fmt = value => money.format(Number(value || 0)).replace('CN¥', '¥');
const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, char => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char];
  });

async function api(path, options = {}) {
  const body = options.body;
  const headers = body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  Object.assign(headers, options.headers || {});

  const response = await fetch(path, {
    ...options,
    headers
  });

  if (!response.ok) {
    let message = '请求失败';
    try {
      const payload = await response.json();
      message = payload.error?.message || message;
    } catch (error) {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

function getLegs(record) {
  return Array.isArray(record.legs) && record.legs.length
    ? record.legs
    : [
        {
          league: record.league || '未分类赛事',
          match: record.match || '未命名赛事',
          play: record.play || '胜平负',
          pick: record.pick || '-'
        }
      ];
}

function ticketTitle(record) {
  const legs = getLegs(record);
  return legs.length > 1
    ? `${record.ticketType || `${legs.length} 串 1`} · ${legs.length} 场串关`
    : legs[0].match;
}

function ticketMeta(record) {
  const legs = getLegs(record);
  return legs.length > 1
    ? legs.map(leg => `${leg.play} ${leg.pick}`).join(' / ')
    : `${legs[0].league} · ${legs[0].play} · ${legs[0].pick}`;
}

function calculateStake() {
  return Math.max(0, Number(amountInput.value || 0)) * Math.max(1, Number(multipleInput.value || 1));
}

function updateTicketPreview() {
  previewType.textContent = ticketTypeSelect.value;
  previewLegs.textContent = String(state.pendingLegs.length);
  previewStake.textContent = fmt(calculateStake());
  legCountTag.textContent = `${state.pendingLegs.length} 场`;
}

function renderLegs() {
  legsList.innerHTML = state.pendingLegs.length
    ? state.pendingLegs
        .map(
          (leg, index) =>
            `<div class="leg-item motion-enter" style="animation-delay:${Math.min(index * 35, 140)}ms">
              <span class="leg-index">${index + 1}</span>
              <div class="leg-main">
                <strong>${esc(leg.match)}</strong>
                <div class="leg-meta">${esc(leg.league)} · ${esc(leg.play)} · ${esc(leg.pick)}</div>
              </div>
              <div class="leg-actions">
                <button class="btn btn-secondary" type="button" data-remove-leg="${index}">移除</button>
              </div>
            </div>`
        )
        .join('')
    : `<div class="is-empty-note">还没有加入场次。可手动添加，或上传票据后用 AI 自动填写。</div>`;
  updateTicketPreview();
}

function addLegFromFields() {
  const leg = {
    league: legLeagueInput.value.trim() || '未分类赛事',
    match: legMatchInput.value.trim(),
    play: legPlaySelect.value,
    pick: legPickInput.value.trim()
  };
  if (!leg.match || !leg.pick) {
    formToast.textContent = '请补全该场的主客队和投注选项。';
    return;
  }
  state.pendingLegs.push(leg);
  legMatchInput.value = '';
  legPickInput.value = '';
  legLeagueInput.value = '';
  formToast.textContent = '已加入 1 场，可继续添加下一场。';
  renderLegs();
}

function applyRecognizedTicket(ticket) {
  state.pendingLegs = ticket.legs.map(leg => ({
    league: leg.league || '未分类赛事',
    match: leg.match || '待确认赛事',
    play: leg.play || '胜平负',
    pick: leg.pick || '待确认'
  }));
  ticketTypeSelect.value = ticket.ticketType || `${state.pendingLegs.length} 串 1`;
  amountInput.value = ticket.amount || 20;
  multipleInput.value = ticket.multiple || 1;
  recordForm.elements.note.value = ticket.note || 'AI 识别票据，保存前已人工确认。';
  renderLegs();
}

async function recognizeTicket() {
  const file = ticketImageInput.files && ticketImageInput.files[0];
  if (!file) {
    aiToast.textContent = '请先上传票据图片。';
    return;
  }

  aiToast.textContent = '正在识别票据图片...';
  const payload = new FormData();
  payload.append('image', file);
  payload.append('endpoint', aiEndpointInput.value.trim());
  payload.append('apiKey', aiKeyInput.value.trim());

  try {
    const data = await api('/api/tickets/recognize', {
      method: 'POST',
      body: payload
    });
    state.uploadedImagePath = data.imagePath || '';
    applyRecognizedTicket(data.ticket);
    aiToast.textContent = data.usedFallback
      ? '未配置有效识别接口，已填入演示识别结果。'
      : 'AI 接口已返回，已自动填入串关明细。';
  } catch (error) {
    aiToast.textContent = error.message;
  }
}

function drawStats() {
  const s = state.stats;
  ['totalStake', 'heroStake'].forEach(id => {
    el(id).textContent = fmt(s.totalStake);
  });
  ['settledPrize', 'heroPrize'].forEach(id => {
    el(id).textContent = fmt(s.settledPrize);
  });
  ['netProfit', 'heroProfit'].forEach(id => {
    el(id).textContent = fmt(s.netProfit);
  });
  el('pendingTag').textContent = `${s.pending} 张待核验`;
}

function drawQueue() {
  const box = el('heroQueue');
  const queue = state.records.filter(record => record.status === 'pending').slice(0, 2);
  box.innerHTML = queue.length
    ? queue
        .map(
          record =>
            `<div class="ticket-line">
              <span>${esc(ticketTitle(record))}<br><span class="meta">${esc(ticketMeta(record))}</span></span>
              <strong>${fmt(record.stake)}</strong>
            </div>`
        )
        .join('')
    : `<div class="empty">暂无待核验记录</div>`;
}

function drawTable() {
  const list = state.records.filter(record => state.activeFilter === 'all' || record.status === state.activeFilter);
  recordTable.innerHTML = list.length
    ? list
        .map((record, index) => {
          const status = statusMap[record.status] || statusMap.pending;
          const legs = getLegs(record);
          return `<tr class="motion-enter" style="animation-delay:${Math.min(index * 28, 112)}ms">
            <td class="num">${esc(record.id)}</td>
            <td>
              <strong>${esc(ticketTitle(record))}</strong>
              <div class="record-match-list">
                ${legs
                  .map((leg, legIndex) => `<span>${legIndex + 1}. ${esc(leg.match)} · ${esc(leg.play)} ${esc(leg.pick)}</span>`)
                  .join('')}
              </div>
              <span class="meta">${esc(record.source || '手动录入')} · ${esc(record.note || '无备注')}</span>
            </td>
            <td class="num-col">${fmt(record.stake)}</td>
            <td><span class="status ${status.className}">${status.label}</span></td>
            <td class="num-col">${record.prize ? fmt(record.prize) : '-'}</td>
            <td class="num-col"><button class="btn btn-secondary compact-action" type="button" data-select="${esc(record.id)}">核验</button></td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="empty">当前筛选下暂无记录</td></tr>`;
}

function drawPanel() {
  const target = el('settleTarget');
  const record = state.records.find(item => item.id === state.selectedId);
  if (!record) {
    target.innerHTML = '<span class="meta">当前未选择记录</span><strong>从左侧点击“核验”开始。</strong>';
    return;
  }

  const legs = getLegs(record);
  target.innerHTML = `<span class="meta">${esc(record.id)} · ${esc(record.ticketType || '单关')} · 投入 ${fmt(record.stake)}</span>
    <strong>${esc(ticketTitle(record))}</strong>
    <div class="settle-leg-list">
      ${legs
        .map(
          (leg, index) =>
            `<div class="settle-leg motion-enter" style="animation-delay:${Math.min(index * 30, 120)}ms">
              ${index + 1}. ${esc(leg.match)}<br>${esc(leg.league)} · ${esc(leg.play)} · ${esc(leg.pick)}
            </div>`
        )
        .join('')}
    </div>`;
  resultInput.value = record.result === '待赛果' ? '' : record.result;
  prizeInput.value = record.prize || '';
  settleNoteInput.value = record.note || '';
}

function drawTrend() {
  const box = el('trendBars');
  const values = state.trendValues;
  rangeLabel.textContent = rangeText[state.activeRange];
  if (!values.length) {
    box.innerHTML = '<div class="empty" style="width:100%">暂无趋势数据</div>';
    drawSummary();
    return;
  }

  const max = Math.max(...values.map(value => Math.abs(value)), 1);
  box.innerHTML = values
    .map((value, index) => {
      const height = 18 + Math.round((Math.abs(value) / max) * 178);
      const label = value >= 0 ? `+${value}` : `${value}`;
      return `<div class="bar-wrap" title="第 ${index + 1} 单：${label} 元">
        <div class="bar ${value < 0 ? 'is-negative' : ''}" style="height:${height}px;animation-delay:${Math.min(index * 24, 144)}ms"></div>
        <div class="bar-label">${label}</div>
      </div>`;
    })
    .join('');
  drawSummary();
}

function drawSummary() {
  const s = state.stats;
  const wait = s.pending
    ? `还有 ${s.pending} 张待核验，建议赛后先补赛果再看趋势。`
    : '当前没有待核验记录，趋势可直接用于复盘。';
  const profit =
    s.netProfit >= 0
      ? `净盈亏为 ${fmt(s.netProfit)}，保持分项记录。`
      : `净盈亏为 ${fmt(s.netProfit)}，建议回看高倍数串关记录。`;
  summaryText.textContent = `本期投入：${fmt(s.totalStake)}\n已核奖金：${fmt(s.settledPrize)}\n${profit}\n${wait}`;
}

function drawAll() {
  drawStats();
  drawQueue();
  drawTable();
  drawPanel();
  drawTrend();
  renderLegs();
}

async function refreshAll() {
  try {
    const [recordsPayload, statsPayload] = await Promise.all([
      api('/api/records'),
      api(`/api/stats?range=${encodeURIComponent(state.activeRange)}`)
    ]);
    state.records = recordsPayload.records || [];
    state.stats = statsPayload.stats || state.stats;
    state.trendValues = statsPayload.trend?.values || [];
    if (state.selectedId && !state.records.some(record => record.id === state.selectedId)) {
      state.selectedId = null;
    }
    drawAll();
  } catch (error) {
    formToast.textContent = error.message;
    drawAll();
  }
}

addLegBtn.addEventListener('click', addLegFromFields);

legsList.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-leg]');
  if (!button) return;
  state.pendingLegs.splice(Number(button.dataset.removeLeg), 1);
  formToast.textContent = '已移除该场次。';
  renderLegs();
});

[ticketTypeSelect, amountInput, multipleInput].forEach(input => {
  input.addEventListener('input', updateTicketPreview);
});

ticketImageInput.addEventListener('change', () => {
  const file = ticketImageInput.files && ticketImageInput.files[0];
  if (!file) return;
  if (state.ticketPreviewUrl) URL.revokeObjectURL(state.ticketPreviewUrl);
  state.ticketPreviewUrl = URL.createObjectURL(file);
  aiPreview.innerHTML = `<img class="motion-enter" src="${state.ticketPreviewUrl}" alt="已上传票据缩略图">
    <div class="motion-enter">
      <strong>${esc(file.name)}</strong>
      <div class="meta">图片已就绪，点击识别后自动填入串关明细。</div>
    </div>`;
  aiToast.textContent = '图片已上传，等待识别。';
});

runAiFill.addEventListener('click', recognizeTicket);

recordForm.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = event.currentTarget.elements;
  const amount = Number(fields.amount.value);
  const multiple = Number(fields.multiple.value || 1);
  const note = fields.note.value.trim();

  if (!state.pendingLegs.length) {
    formToast.textContent = '请至少加入 1 场赛事，或先上传图片自动填写。';
    return;
  }
  if (!amount || amount <= 0 || !multiple || multiple <= 0) {
    formToast.textContent = '请补全单注金额和倍数。';
    return;
  }

  const ticketType =
    fields.ticketType.value === '单关' && state.pendingLegs.length > 1
      ? `${state.pendingLegs.length} 串 1`
      : fields.ticketType.value;

  try {
    await api('/api/records', {
      method: 'POST',
      body: JSON.stringify({
        ticketType,
        source: state.uploadedImagePath ? 'AI 图片识别' : '手动录入',
        amount,
        multiple,
        note,
        imagePath: state.uploadedImagePath,
        legs: state.pendingLegs
      })
    });

    event.currentTarget.reset();
    fields.multiple.value = 1;
    ticketTypeSelect.value = '2 串 1';
    state.pendingLegs = [];
    state.uploadedImagePath = '';
    aiPreview.innerHTML = '<div class="is-empty-note" style="flex:1">尚未上传图片。上传后会显示缩略图与识别状态。</div>';
    formToast.textContent = '已保存整张串关单，并进入待核验队列。';
    aiToast.textContent = '';
    state.activeFilter = 'all';
    document.querySelectorAll('[data-filter]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.filter === 'all');
    });
    await refreshAll();
  } catch (error) {
    formToast.textContent = error.message;
  }
});

recordTable.addEventListener('click', event => {
  const button = event.target.closest('[data-select]');
  if (!button) return;
  state.selectedId = button.dataset.select;
  settleToast.textContent = '';
  drawPanel();
});

document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
    state.activeFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(item => {
      item.classList.toggle('is-active', item === button);
    });
    drawTable();
  });
});

async function settle(status) {
  if (!state.selectedId) {
    settleToast.textContent = '请先选择一条记录。';
    return;
  }

  try {
    await api(`/api/records/${encodeURIComponent(state.selectedId)}/settle`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        result: resultInput.value.trim() || (status === 'win' ? '整单中奖' : '未中奖'),
        prize: Number(prizeInput.value || 0),
        note: settleNoteInput.value.trim()
      })
    });
    settleToast.textContent = status === 'win' ? '已标记中奖并更新奖金。' : '已标记未中并清空奖金。';
    await refreshAll();
  } catch (error) {
    settleToast.textContent = error.message;
  }
}

settleWin.addEventListener('click', () => settle('win'));
settleLost.addEventListener('click', () => settle('lost'));

document.querySelectorAll('[data-range]').forEach(button => {
  button.addEventListener('click', async () => {
    state.activeRange = button.dataset.range;
    document.querySelectorAll('[data-range]').forEach(item => {
      item.classList.toggle('is-active', item === button);
    });
    try {
      const payload = await api(`/api/stats?range=${encodeURIComponent(state.activeRange)}`);
      state.stats = payload.stats || state.stats;
      state.trendValues = payload.trend?.values || [];
      drawTrend();
    } catch (error) {
      copyToast.textContent = error.message;
    }
  });
});

copySummary.addEventListener('click', async () => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(summaryText.textContent);
      copyToast.textContent = '复盘摘要已复制。';
    } else {
      copyToast.textContent = '当前浏览器不支持自动复制，可手动选中文本。';
    }
  } catch (error) {
    copyToast.textContent = '复制受限，可手动选中文本。';
  }
});

document.querySelectorAll('[data-jump]').forEach(button => {
  button.addEventListener('click', () => {
    const target = el(button.dataset.jump);
    if (!target) return;
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.pageYOffset - 72,
      behavior: prefersReducedMotion.matches ? 'auto' : 'smooth'
    });
  });
});

refreshAll();
