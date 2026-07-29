// ============================================================
// Controle Financeiro — app.js
// Lógica completa: auth, carteiras, abas arrastáveis, CRUD de
// lançamentos/investimentos/reserva de emergência, tema, drag reorder.
// ============================================================

const sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

let state = {
  user: null,
  carteiras: [],
  carteiraAtualId: null,
  abas: ['entradas_saidas', 'investimentos', 'reserva_emergencia', 'analises'],
  abaAtual: 'entradas_saidas',
  esView: 'entrada', // sub-view dentro de Entradas/Saídas
  mesAtual: new Date().toISOString().slice(0, 7), // 'YYYY-MM' — mês navegável (Entradas/Saídas e Análises)
  transacoes: [],
  metaReserva: null,
  aportesReserva: [],
  tema: 'escuro',
  appName: 'Meu Financeiro',
  pendingDelete: null, // { type, id, label }
  authMode: 'login',
  visaoAnualTipo: 'barra', // 'barra' | 'linha' — tipo de gráfico da Visão Anual
};

const ABA_META = {
  entradas_saidas: { label: 'Entradas & Saídas', icon: 'ti-arrows-exchange' },
  investimentos: { label: 'Investimentos', icon: 'ti-chart-line' },
  reserva_emergencia: { label: 'Reserva de Emergência', icon: 'ti-shield-check' },
  analises: { label: 'Análises', icon: 'ti-chart-bar' },
};

const MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function mesLabelFmt(mesStr) {
  const [ano, mes] = mesStr.split('-').map(Number);
  return `${MESES_PT[mes - 1]} de ${ano}`;
}
function mesAbrevFmt(mesStr) {
  const nome = mesLabelFmt(mesStr).split(' de ')[0].slice(0, 3);
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}
function mesHojeStr() { return new Date().toISOString().slice(0, 7); }
function somarMeses(mesStr, delta) {
  const [ano, mes] = mesStr.split('-').map(Number);
  const d = new Date(ano, mes - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}
function mesesDoAno(ano) {
  return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
}

// ============================================================
// UTIL
// ============================================================
function fmtMoeda(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function showToast(msg, type = 'success') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="ti ti-${type === 'success' ? 'circle-check' : 'circle-x'}"></i> ${msg}`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function showLoading(v) {
  document.getElementById('loadingOverlay').classList.toggle('show', v);
}
function nowFmt() {
  const d = new Date();
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function marcarEdicao() {
  localStorage.setItem('cf_ultima_edicao', nowFmt());
  document.getElementById('lastEditChip').textContent = 'Última edição: ' + nowFmt();
}

// ============================================================
// TEMA
// ============================================================
function aplicarTema(tema) {
  state.tema = tema;
  document.documentElement.setAttribute('data-theme', tema);
  localStorage.setItem('cf_tema', tema);
  document.getElementById('themeToggleBtn').innerHTML =
    `<i class="ti ti-${tema === 'escuro' ? 'moon' : 'sun'}"></i>`;
}
document.getElementById('themeToggleBtn').addEventListener('click', () => {
  const novo = state.tema === 'escuro' ? 'claro' : 'escuro';
  aplicarTema(novo);
  if (state.user) salvarPreferencias({ tema: novo });
});

// ============================================================
// AUTENTICAÇÃO
// ============================================================
const authTitle = document.getElementById('authTitle');
const authSub = document.getElementById('authSub');
const authSwitch = document.getElementById('authSwitch');
const authSwitchLink = document.getElementById('authSwitchLink');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authError = document.getElementById('authError');

function renderAuthMode() {
  if (state.authMode === 'login') {
    authTitle.textContent = 'Entrar';
    authSub.textContent = 'Acesse seu controle financeiro.';
    authSubmitBtn.innerHTML = '<i class="ti ti-login"></i> Entrar';
    authSwitch.innerHTML = 'Não tem conta? <a id="authSwitchLink">Cadastrar</a>';
  } else {
    authTitle.textContent = 'Criar conta';
    authSub.textContent = 'Leva menos de um minuto.';
    authSubmitBtn.innerHTML = '<i class="ti ti-user-plus"></i> Cadastrar';
    authSwitch.innerHTML = 'Já tem conta? <a id="authSwitchLink">Entrar</a>';
  }
  document.getElementById('authSwitchLink').addEventListener('click', () => {
    state.authMode = state.authMode === 'login' ? 'signup' : 'login';
    authError.style.display = 'none';
    renderAuthMode();
  });
}
renderAuthMode();

authSubmitBtn.addEventListener('click', async () => {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  authError.style.display = 'none';
  if (!email || !password) {
    authError.textContent = 'Preencha e-mail e senha.';
    authError.style.display = 'block';
    return;
  }
  showLoading(true);
  try {
    if (state.authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      showToast('Conta criada! Verifique seu e-mail se a confirmação estiver ativa.', 'success');
    }
    await bootAfterAuth();
  } catch (err) {
    authError.textContent = traduzErroAuth(err.message);
    authError.style.display = 'block';
  } finally {
    showLoading(false);
  }
});

function traduzErroAuth(msg) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/already registered/i.test(msg)) return 'Esse e-mail já está cadastrado.';
  if (/password should be/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  return msg;
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

// ============================================================
// BOOT — carrega tudo após login
// ============================================================
async function bootAfterAuth() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  state.user = user;

  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').classList.add('show');

  aplicarTema(localStorage.getItem('cf_tema') || 'escuro');
  const lastEdit = localStorage.getItem('cf_ultima_edicao');
  if (lastEdit) document.getElementById('lastEditChip').textContent = 'Última edição: ' + lastEdit;

  await carregarPreferencias();
  await carregarCarteiras();
  renderTopNav();
  await carregarDadosCarteira();
  renderPagina();
}

async function carregarPreferencias() {
  const { data } = await sb.from('preferencias_usuario').select('*').eq('user_id', state.user.id).maybeSingle();
  if (data) {
    state.tema = data.tema;
    aplicarTema(data.tema);
    if (Array.isArray(data.ordem_abas) && data.ordem_abas.length) {
      state.abas = data.ordem_abas.filter((a) => ABA_META[a]);
      // garante que abas novas do sistema apareçam mesmo se não estiverem salvas ainda
      Object.keys(ABA_META).forEach((a) => { if (!state.abas.includes(a)) state.abas.push(a); });
    }
  }
}
async function salvarPreferencias(patch) {
  await sb.from('preferencias_usuario').update(patch).eq('user_id', state.user.id);
}

async function carregarCarteiras() {
  const { data, error } = await sb.from('carteiras').select('*').order('ordem');
  if (error) { showToast('Erro ao carregar carteiras.', 'error'); return; }
  state.carteiras = data || [];
  if (!state.carteiras.length) {
    // primeira vez — cria carteira padrão
    const { data: nova } = await sb.from('carteiras').insert({
      user_id: state.user.id, nome: 'Pessoal', tipo: 'PF', ordem: 0,
    }).select().single();
    state.carteiras = [nova];
  }
  if (!state.carteiraAtualId || !state.carteiras.find((c) => c.id === state.carteiraAtualId)) {
    state.carteiraAtualId = state.carteiras[0].id;
  }
  renderCarteiraSelect();
}

function renderCarteiraSelect() {
  const sel = document.getElementById('carteiraSelect');
  sel.innerHTML = state.carteiras.map((c) =>
    `<option value="${c.id}" ${c.id === state.carteiraAtualId ? 'selected' : ''}>${escapeHtml(c.nome)} (${c.tipo})</option>`
  ).join('');
}
document.getElementById('carteiraSelect').addEventListener('change', async (e) => {
  state.carteiraAtualId = e.target.value;
  await carregarDadosCarteira();
  renderPagina();
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// CARREGAR DADOS DA CARTEIRA ATUAL
// ============================================================
async function carregarDadosCarteira() {
  showLoading(true);
  try {
    const { data: trans } = await sb.from('transacoes')
      .select('*').eq('carteira_id', state.carteiraAtualId).order('ordem').order('criado_em');
    state.transacoes = trans || [];

    const { data: reserva } = await sb.from('metas')
      .select('*').eq('carteira_id', state.carteiraAtualId).eq('tipo', 'reserva_emergencia').maybeSingle();
    if (!reserva) {
      const { data: novaReserva } = await sb.from('metas').insert({
        carteira_id: state.carteiraAtualId, tipo: 'reserva_emergencia', valor_limite: 0,
      }).select().single();
      state.metaReserva = novaReserva;
    } else {
      state.metaReserva = reserva;
    }

    state.aportesReserva = state.transacoes
      .filter((t) => t.natureza === 'investimento' && t.observacao === '__reserva__')
      .sort((a, b) => a.ordem - b.ordem);
  } finally {
    showLoading(false);
  }
}

// ============================================================
// ABAS (arrastáveis)
// ============================================================
function renderTopNav() {
  const nav = document.getElementById('topNav');
  nav.innerHTML = state.abas.map((aba) => {
    const m = ABA_META[aba];
    return `<button class="tnav-btn ${aba === state.abaAtual ? 'on' : ''}" draggable="true" data-aba="${aba}">
      <i class="ti ${m.icon}"></i> ${m.label}
    </button>`;
  }).join('');

  nav.querySelectorAll('.tnav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.abaAtual = btn.dataset.aba;
      renderTopNav();
      renderPagina();
    });
    habilitarDrag(btn, nav, '.tnav-btn', async (novaOrdem) => {
      state.abas = novaOrdem.map((el) => el.dataset.aba);
      renderTopNav();
      if (state.user) await salvarPreferencias({ ordem_abas: state.abas });
    });
  });
}

// ── Drag-and-drop genérico (reordenar filhos de um container) ──
function habilitarDrag(el, container, selector, onDrop) {
  el.addEventListener('dragstart', () => el.classList.add('dragging'));
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    container.querySelectorAll(selector).forEach((n) => n.classList.remove('drag-over'));
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over');
    const dragging = container.querySelector('.dragging');
    if (!dragging || dragging === el) return;
    const items = Array.from(container.querySelectorAll(selector));
    const draggingIdx = items.indexOf(dragging);
    const targetIdx = items.indexOf(el);
    if (draggingIdx < targetIdx) el.after(dragging); else el.before(dragging);
    onDrop(Array.from(container.querySelectorAll(selector)));
  });
}

// ============================================================
// BARRA DE MÊS — visível apenas em Entradas/Saídas e Análises
// (Investimentos e Reserva são saldo acumulado, não fazem sentido por mês)
// ============================================================
function renderMesBar() {
  const visivel = ['entradas_saidas', 'analises'].includes(state.abaAtual);
  document.getElementById('monthBarWrap').style.display = visivel ? 'flex' : 'none';
  document.getElementById('mesLabel').textContent = mesLabelFmt(state.mesAtual);
}
document.getElementById('mesPrevBtn').addEventListener('click', () => {
  state.mesAtual = somarMeses(state.mesAtual, -1);
  renderMesBar();
  renderPagina();
});
document.getElementById('mesNextBtn').addEventListener('click', () => {
  state.mesAtual = somarMeses(state.mesAtual, 1);
  renderMesBar();
  renderPagina();
});
document.getElementById('mesHojeBtn').addEventListener('click', () => {
  state.mesAtual = mesHojeStr();
  renderMesBar();
  renderPagina();
});

// ============================================================
// RENDER DE PÁGINA (roteador simples entre abas)
// ============================================================
function renderPagina() {
  const wrap = document.getElementById('pageWrap');
  renderMesBar();
  if (state.abaAtual === 'entradas_saidas') wrap.innerHTML = renderEntradasSaidas();
  else if (state.abaAtual === 'investimentos') wrap.innerHTML = renderInvestimentos();
  else if (state.abaAtual === 'reserva_emergencia') wrap.innerHTML = renderReserva();
  else if (state.abaAtual === 'analises') { wrap.innerHTML = renderAnalises(); }
  ligarEventosPagina();
  if (state.abaAtual === 'analises') montarGraficos();
}

// ============================================================
// ENTRADAS & SAÍDAS
// ============================================================
// mesFiltro: string 'YYYY-MM' para restringir por mês, ou null para trazer tudo
// (usado pelos gráficos, que precisam do histórico completo)
function listaPorTipoNatureza(tipo, natureza, mesFiltro = state.mesAtual) {
  return state.transacoes.filter((t) =>
    t.tipo === tipo && t.natureza === natureza && t.natureza !== 'investimento' &&
    (mesFiltro === null || t.data.startsWith(mesFiltro))
  );
}
function somaLista(arr) { return arr.reduce((s, t) => s + Number(t.valor || 0), 0); }

function renderEntradasSaidas() {
  const doMes = (t) => t.tipo && t.natureza !== 'investimento' && t.data.startsWith(state.mesAtual);
  const totalEntradas = somaLista(state.transacoes.filter((t) => t.tipo === 'entrada' && doMes(t)));
  const totalSaidas = somaLista(state.transacoes.filter((t) => t.tipo === 'saida' && doMes(t)));
  const saldo = totalEntradas - totalSaidas;

  const fixas = listaPorTipoNatureza(state.esView, 'fixo');
  const variaveis = listaPorTipoNatureza(state.esView, 'variavel');

  return `
    <div class="kg">
      <div class="kc"><div class="kl">Total Entradas</div><div class="kv" style="color:var(--green)">${fmtMoeda(totalEntradas)}</div></div>
      <div class="kc"><div class="kl">Total Saídas</div><div class="kv" style="color:var(--red)">${fmtMoeda(totalSaidas)}</div></div>
      <div class="kc"><div class="kl">Saldo</div><div class="kv" style="color:${saldo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoeda(saldo)}</div></div>
    </div>

    <div class="cat-tabs">
      <button class="cat-tab ${state.esView === 'entrada' ? 'on' : ''}" data-esview="entrada"><i class="ti ti-arrow-down"></i> Entradas</button>
      <button class="cat-tab ${state.esView === 'saida' ? 'on' : ''}" data-esview="saida"><i class="ti ti-arrow-up"></i> Saídas</button>
    </div>

    ${renderTabelaLancamentos('Fixas', fixas, state.esView, 'fixo')}
    ${renderTabelaLancamentos('Variáveis', variaveis, state.esView, 'variavel')}
  `;
}

function renderTabelaLancamentos(titulo, itens, tipo, natureza) {
  const total = somaLista(itens);
  return `
  <div class="card" data-list-container data-tipo="${tipo}" data-natureza="${natureza}">
    <div class="row-actions">
      <div class="sec-label"><i class="ti ti-list"></i> ${titulo}</div>
      <button class="add-btn" data-add-lancamento data-tipo="${tipo}" data-natureza="${natureza}"><i class="ti ti-plus"></i> Adicionar item</button>
    </div>
    <div class="tbl-wrap">
      <div class="tbl-hd"><span></span><span>Descrição</span><span style="text-align:right">Valor</span><span></span></div>
      ${itens.length ? itens.map((t) => renderLinhaLancamento(t)).join('') : `<div class="empty"><i class="ti ti-inbox"></i>Nenhum item ainda. Clique em "Adicionar item".</div>`}
    </div>
    ${itens.length ? `<div class="total-row ${tipo === 'entrada' ? 'pos' : 'neg'}"><span>Total ${titulo.toLowerCase()}</span><span>${fmtMoeda(total)}</span></div>` : ''}
  </div>`;
}

function renderLinhaLancamento(t) {
  return `
  <div class="tbl-row" draggable="true" data-row-id="${t.id}" data-row-type="transacao">
    <span class="drag-handle"><i class="ti ti-grip-vertical"></i></span>
    <input class="fi" data-field="descricao" data-id="${t.id}" value="${escapeHtml(t.descricao)}" placeholder="Descrição">
    <input class="fi fi-val" data-field="valor" data-id="${t.id}" type="number" step="0.01" value="${t.valor}">
    <button class="del-btn" data-del="transacao" data-id="${t.id}" data-label="${escapeHtml(t.descricao)}"><i class="ti ti-trash"></i></button>
  </div>`;
}

// ============================================================
// INVESTIMENTOS
// ============================================================
function renderInvestimentos() {
  const itens = state.transacoes
    .filter((t) => t.natureza === 'investimento' && t.observacao !== '__reserva__')
    .sort((a, b) => a.ordem - b.ordem);
  const total = somaLista(itens);

  return `
    <div class="kg">
      <div class="kc"><div class="kl">Total Investido</div><div class="kv" style="color:var(--gold)">${fmtMoeda(total)}</div></div>
    </div>
    <div class="card">
      <div class="row-actions">
        <div class="sec-label"><i class="ti ti-chart-line"></i> Alocações</div>
        <button class="add-btn" data-add-investimento><i class="ti ti-plus"></i> Adicionar</button>
      </div>
      <div id="investList">
        ${itens.length ? itens.map((t) => renderLinhaInvestimento(t, total)).join('') : `<div class="empty"><i class="ti ti-inbox"></i>Nenhum investimento cadastrado.</div>`}
      </div>
    </div>
  `;
}

function renderLinhaInvestimento(t, total) {
  const pct = total > 0 ? ((t.valor / total) * 100).toFixed(1) : '0.0';
  return `
  <div class="div-item" draggable="true" data-row-id="${t.id}" data-row-type="investimento">
    <span class="drag-handle"><i class="ti ti-grip-vertical"></i></span>
    <div class="div-body">
      <div class="div-header">
        <input class="div-name-in" data-field="descricao" data-id="${t.id}" value="${escapeHtml(t.descricao)}" placeholder="Nome do investimento">
        <button class="del-btn" data-del="transacao" data-id="${t.id}" data-label="${escapeHtml(t.descricao)}"><i class="ti ti-trash"></i></button>
      </div>
      <input class="div-val-in" data-field="valor" data-id="${t.id}" type="number" step="0.01" value="${t.valor}">
      <div class="pbar-bg"><div class="pbar" style="width:${pct}%"></div></div>
      <span style="font-size:11px;color:var(--text-faint)">${pct}% da carteira</span>
      <input class="div-bank-in" data-field="observacao" data-id="${t.id}" value="${t.observacao && t.observacao !== '__reserva__' ? escapeHtml(t.observacao) : ''}" placeholder="Instituição / corretora (opcional)">
    </div>
  </div>`;
}

// ============================================================
// RESERVA DE EMERGÊNCIA
// ============================================================
function renderReserva() {
  const valorAtual = somaLista(state.aportesReserva);
  const meta = state.metaReserva?.valor_limite || 0;
  const pct = meta > 0 ? Math.min(100, (valorAtual / meta) * 100).toFixed(1) : '0.0';

  const gastosFixos = somaLista(listaPorTipoNatureza('saida', 'fixo', mesHojeStr()));
  const mesesCobertos = gastosFixos > 0 ? (valorAtual / gastosFixos).toFixed(1) : '—';

  return `
    <div class="meta-wrap">
      <div class="meta-header">
        <div class="meta-block">
          <div class="meta-label">Valor atual</div>
          <div class="meta-val-in" style="border:none;font-size:24px">${fmtMoeda(valorAtual)}</div>
        </div>
        <div class="meta-block">
          <div class="meta-label">Meta (reserva ideal)</div>
          <input class="meta-val-in" id="reservaMetaInput" type="number" step="0.01" value="${meta}">
        </div>
        <div class="meta-block" style="max-width:120px">
          <div class="meta-label">Meses cobertos</div>
          <div class="meta-val-in" style="border:none;font-size:24px;color:var(--accent-hover)">${mesesCobertos}</div>
        </div>
      </div>
      <div class="pbar-bg"><div class="pbar" style="width:${pct}%;background:var(--green)"></div></div>
      <span style="font-size:11px;color:var(--text-faint)">${pct}% da meta atingida · baseado nas saídas fixas do mês</span>
    </div>

    <div class="card">
      <div class="row-actions">
        <div class="sec-label"><i class="ti ti-piggy-bank"></i> Aportes</div>
        <button class="add-btn" data-add-aporte><i class="ti ti-plus"></i> Adicionar aporte</button>
      </div>
      <div class="tbl-wrap">
        <div class="tbl-hd"><span></span><span>Descrição</span><span style="text-align:right">Valor</span><span></span></div>
        ${state.aportesReserva.length ? state.aportesReserva.map((t) => renderLinhaLancamento(t)).join('') : `<div class="empty"><i class="ti ti-inbox"></i>Nenhum aporte registrado ainda.</div>`}
      </div>
    </div>
  `;
}

// ============================================================
// ANÁLISES — gráficos de evolução anual e composição de gastos
// ============================================================
let chartLinha = null;
let chartPizza = null;

function renderDivisaoSaldos() {
  const doMes = (t) => t.data.startsWith(state.mesAtual);
  const fixas = somaLista(state.transacoes.filter((t) => t.tipo === 'saida' && t.natureza === 'fixo' && doMes(t)));
  const variaveis = somaLista(state.transacoes.filter((t) => t.tipo === 'saida' && t.natureza === 'variavel' && doMes(t)));
  const investido = somaLista(state.transacoes.filter((t) => t.natureza === 'investimento' && doMes(t)));
  const total = fixas + variaveis + investido;
  const pct = (v) => (total > 0 ? ((v / total) * 100).toFixed(0) : '0');

  const linha = (label, valor, cor) => `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span>${label}</span><span style="color:var(--text-faint)">${pct(valor)}%</span>
      </div>
      <div style="font-weight:600;font-size:16px;color:${cor};margin-bottom:6px">${fmtMoeda(valor)}</div>
      <div class="pbar-bg"><div class="pbar" style="width:${pct(valor)}%;background:${cor}"></div></div>
    </div>`;

  return `
    <div class="chart-card">
      <div class="card-title"><i class="ti ti-chart-donut"></i> DIVISÃO DE SALDOS</div>
      ${total > 0 ? `
        ${linha('Contas fixas', fixas, 'var(--red)')}
        ${linha('Gastos variáveis', variaveis, 'var(--gold)')}
        ${linha('Investido / Reserva', investido, 'var(--accent-hover)')}
      ` : `<div class="empty"><i class="ti ti-inbox"></i>Sem movimentação em ${mesLabelFmt(state.mesAtual)}.</div>`}
    </div>`;
}

function renderAnalises() {
  const anoAtual = state.mesAtual.split('-')[0];
  return `
    <div class="row-actions" style="margin-bottom:14px">
      <div class="sec-label"><i class="ti ti-file-analytics"></i> Relatórios</div>
      <button class="add-btn" id="abrirExportModalBtn"><i class="ti ti-file-download"></i> Exportar PDF</button>
    </div>
    <div class="chart-card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span><i class="ti ti-chart-bar"></i> VISÃO ANUAL ${anoAtual}</span>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-faint)">
          <span>Opções de Visualização</span>
          <select id="visaoAnualTipoSelect" class="fi" style="width:auto;padding:4px 10px;font-size:12px">
            <option value="barra" ${state.visaoAnualTipo === 'barra' ? 'selected' : ''}>Barras</option>
            <option value="linha" ${state.visaoAnualTipo === 'linha' ? 'selected' : ''}>Linha</option>
          </select>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chartLinha"></canvas></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
      ${renderDivisaoSaldos()}
      <div class="chart-card">
        <div class="card-title"><i class="ti ti-chart-pie"></i> SAÍDA POR CATEGORIA</div>
        <div class="chart-wrap"><canvas id="chartPizza"></canvas></div>
      </div>
    </div>
  `;
}

function montarGraficos() {
  const anoAtual = state.mesAtual.split('-')[0];
  const meses = mesesDoAno(anoAtual);
  const entradasPorMes = meses.map((m) =>
    somaLista(state.transacoes.filter((t) => t.tipo === 'entrada' && t.natureza !== 'investimento' && t.data.startsWith(m)))
  );
  const saidasPorMes = meses.map((m) =>
    somaLista(state.transacoes.filter((t) => t.tipo === 'saida' && t.natureza !== 'investimento' && t.data.startsWith(m)))
  );

  if (chartLinha) chartLinha.destroy();
  const ctxLinha = document.getElementById('chartLinha');
  if (ctxLinha) {
    const ehBarra = state.visaoAnualTipo === 'barra';
    chartLinha = new Chart(ctxLinha, {
      type: ehBarra ? 'bar' : 'line',
      data: {
        labels: meses.map((m) => mesAbrevFmt(m)),
        datasets: [
          {
            label: 'Entradas', data: entradasPorMes,
            borderColor: '#6fc43a', backgroundColor: ehBarra ? '#6fc43a' : 'rgba(111,196,58,0.1)',
            tension: .3, fill: !ehBarra,
          },
          {
            label: 'Saídas', data: saidasPorMes,
            borderColor: '#e05252', backgroundColor: ehBarra ? '#e05252' : 'rgba(224,82,82,0.1)',
            tension: .3, fill: !ehBarra,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { ticks: { callback: (v) => 'R$' + v } } },
        plugins: { legend: { labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text') } } },
      },
    });
  }

  const saidasDoMes = state.transacoes.filter((t) => t.tipo === 'saida' && t.natureza !== 'investimento' && t.data.startsWith(state.mesAtual) && t.valor > 0);
  const porDescricao = {};
  saidasDoMes.forEach((t) => { porDescricao[t.descricao] = (porDescricao[t.descricao] || 0) + Number(t.valor); });
  const labels = Object.keys(porDescricao);
  const valores = Object.values(porDescricao);
  const cores = ['#4d9ef5','#6fc43a','#ffc36b','#e05252','#7bbcff','#b58aef','#4dd0c4','#f5a84d','#f56ba0','#8892aa'];

  if (chartPizza) chartPizza.destroy();
  const ctxPizza = document.getElementById('chartPizza');
  if (ctxPizza) {
    chartPizza = new Chart(ctxPizza, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: valores, backgroundColor: cores, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text'), boxWidth: 12 } } },
      },
    });
  }
}

// ============================================================
// EXPORTAÇÃO EM PDF — por período (mês inicial/final escolhidos)
// ============================================================
function abrirExportModal() {
  document.getElementById('exportMesInicio').value = state.mesAtual;
  document.getElementById('exportMesFim').value = state.mesAtual;
  document.getElementById('exportModal').classList.add('show');
}
document.getElementById('exportModalCancel').addEventListener('click', () =>
  document.getElementById('exportModal').classList.remove('show'));
document.getElementById('exportModalGerar').addEventListener('click', () => {
  const ini = document.getElementById('exportMesInicio').value;
  const fim = document.getElementById('exportMesFim').value;
  if (!ini || !fim) { showToast('Escolha os dois meses.', 'error'); return; }
  if (ini > fim) { showToast('O mês inicial não pode ser depois do final.', 'error'); return; }
  document.getElementById('exportModal').classList.remove('show');
  if (ini === fim) exportarPdfMes(ini);
  else exportarPdfPeriodo(ini, fim);
});

function cabecalhoPdf(doc, subtitulo) {
  const carteira = state.carteiras.find((c) => c.id === state.carteiraAtualId);
  doc.setFontSize(16);
  doc.text(state.appName, 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`${subtitulo} — Carteira: ${carteira ? carteira.nome : ''}`, 14, 25);
  doc.setTextColor(0);
}

// Relatório detalhado de um único mês (item por item)
function exportarPdfMes(mesStr) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  cabecalhoPdf(doc, `Relatório de ${mesLabelFmt(mesStr)}`);

  const grupos = [
    ['Entradas Fixas', listaPorTipoNatureza('entrada', 'fixo', mesStr)],
    ['Entradas Variáveis', listaPorTipoNatureza('entrada', 'variavel', mesStr)],
    ['Saídas Fixas', listaPorTipoNatureza('saida', 'fixo', mesStr)],
    ['Saídas Variáveis', listaPorTipoNatureza('saida', 'variavel', mesStr)],
  ];

  let y = 34;
  let algumGrupo = false;
  grupos.forEach(([titulo, itens]) => {
    if (!itens.length) return;
    algumGrupo = true;
    doc.autoTable({
      startY: y,
      head: [[titulo, 'Valor']],
      body: itens.map((t) => [t.descricao, fmtMoeda(t.valor)]),
      foot: [['Total', fmtMoeda(somaLista(itens))]],
      theme: 'grid',
      headStyles: { fillColor: [77, 158, 245] },
      footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 8;
  });
  if (!algumGrupo) doc.text('Nenhum lançamento neste mês.', 14, y);

  doc.save(`relatorio-${mesStr}.pdf`);
  showToast('PDF exportado.');
}

// Resumo mês a mês para um período com mais de um mês
function exportarPdfPeriodo(mesIni, mesFim) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  cabecalhoPdf(doc, `Resumo de ${mesLabelFmt(mesIni)} até ${mesLabelFmt(mesFim)}`);

  const meses = [];
  let m = mesIni;
  while (m <= mesFim) { meses.push(m); m = somarMeses(m, 1); }

  const linhas = [];
  let totalEntradas = 0, totalSaidas = 0, totalInvest = 0;
  meses.forEach((mesStr) => {
    const ent = somaLista(state.transacoes.filter((t) => t.tipo === 'entrada' && t.natureza !== 'investimento' && t.data.startsWith(mesStr)));
    const sai = somaLista(state.transacoes.filter((t) => t.tipo === 'saida' && t.natureza !== 'investimento' && t.data.startsWith(mesStr)));
    const inv = somaLista(state.transacoes.filter((t) => t.natureza === 'investimento' && t.data.startsWith(mesStr)));
    totalEntradas += ent; totalSaidas += sai; totalInvest += inv;
    linhas.push([mesLabelFmt(mesStr), fmtMoeda(ent), fmtMoeda(sai), fmtMoeda(inv), fmtMoeda(ent - sai)]);
  });

  doc.autoTable({
    startY: 34,
    head: [['Mês', 'Entradas', 'Saídas', 'Investido', 'Saldo']],
    body: linhas,
    foot: [['Total do período', fmtMoeda(totalEntradas), fmtMoeda(totalSaidas), fmtMoeda(totalInvest), fmtMoeda(totalEntradas - totalSaidas)]],
    theme: 'grid',
    headStyles: { fillColor: [77, 158, 245] },
    footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
  });

  doc.save(`relatorio-${mesIni}-a-${mesFim}.pdf`);
  showToast('PDF exportado.');
}

// ============================================================
// EVENTOS DA PÁGINA (delegação, re-ligados a cada render)
// ============================================================
function ligarEventosPagina() {
  const wrap = document.getElementById('pageWrap');

  const abrirExportBtn = document.getElementById('abrirExportModalBtn');
  if (abrirExportBtn) abrirExportBtn.addEventListener('click', abrirExportModal);

  const visaoSelect = wrap.querySelector('#visaoAnualTipoSelect');
  if (visaoSelect) visaoSelect.addEventListener('change', () => {
    state.visaoAnualTipo = visaoSelect.value;
    montarGraficos();
  });

  // cat-tabs Entradas/Saídas
  wrap.querySelectorAll('[data-esview]').forEach((b) => b.addEventListener('click', () => {
    state.esView = b.dataset.esview;
    renderPagina();
  }));

  // adicionar lançamento
  wrap.querySelectorAll('[data-add-lancamento]').forEach((b) => b.addEventListener('click', () =>
    criarTransacao({ tipo: b.dataset.tipo, natureza: b.dataset.natureza, descricao: 'Novo item', valor: 0 })
  ));
  wrap.querySelectorAll('[data-add-investimento]').forEach((b) => b.addEventListener('click', () =>
    criarTransacao({ tipo: 'entrada', natureza: 'investimento', descricao: 'Novo investimento', valor: 0 })
  ));
  wrap.querySelectorAll('[data-add-aporte]').forEach((b) => b.addEventListener('click', () =>
    criarTransacao({ tipo: 'entrada', natureza: 'investimento', descricao: 'Novo aporte', valor: 0, observacao: '__reserva__' })
  ));

  // edição inline (debounce simples via blur + input imediato no estado local)
  wrap.querySelectorAll('[data-field]').forEach((input) => {
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => salvarCampoTransacao(input.dataset.id, input.dataset.field, input.value), 500);
    });
    input.addEventListener('blur', () => {
      clearTimeout(timer);
      salvarCampoTransacao(input.dataset.id, input.dataset.field, input.value);
    });
  });

  // meta da reserva
  const reservaInput = document.getElementById('reservaMetaInput');
  if (reservaInput) {
    let t;
    reservaInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => salvarMetaReserva(reservaInput.value), 500);
    });
  }

  // excluir (com confirmação)
  wrap.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    abrirConfirmDelete(b.dataset.del, b.dataset.id, b.dataset.label);
  }));

  // drag reorder das linhas
  wrap.querySelectorAll('[data-row-id]').forEach((row) => {
    const container = row.parentElement;
    const selector = `[data-row-type="${row.dataset.rowType}"]`;
    habilitarDrag(row, container, selector, (novaOrdem) => {
      novaOrdem.forEach((el, idx) => salvarOrdemTransacao(el.dataset.rowId, idx));
    });
  });
}

// ============================================================
// PERSISTÊNCIA — transações
// ============================================================
async function criarTransacao({ tipo, natureza, descricao, valor, observacao = null }) {
  showLoading(true);
  try {
    const maxOrdem = Math.max(0, ...state.transacoes.map((t) => t.ordem || 0));
    // Entradas/Saídas: cria no mês que está sendo visualizado.
    // Investimentos e aportes de reserva não são filtrados por mês, usa a data de hoje.
    const dataLancamento = natureza === 'investimento'
      ? new Date().toISOString().split('T')[0]
      : `${state.mesAtual}-01`;
    const { data, error } = await sb.from('transacoes').insert({
      carteira_id: state.carteiraAtualId,
      descricao, valor, tipo, natureza, observacao,
      data: dataLancamento,
      origem: 'manual', status: 'confirmado', ordem: maxOrdem + 1,
    }).select().single();
    if (error) throw error;
    state.transacoes.push(data);
    if (observacao === '__reserva__') state.aportesReserva.push(data);
    marcarEdicao();
    renderPagina();
    showToast('Item adicionado.');
  } catch (err) {
    showToast('Erro ao adicionar item.', 'error');
  } finally {
    showLoading(false);
  }
}

async function salvarCampoTransacao(id, field, value) {
  const val = field === 'valor' ? Number(value || 0) : value;
  const t = state.transacoes.find((x) => x.id === id);
  if (t) t[field] = val;
  const { error } = await sb.from('transacoes').update({ [field]: val }).eq('id', id);
  if (error) { showToast('Erro ao salvar alteração.', 'error'); return; }
  marcarEdicao();
  // Reflete totais/percentuais sem perder o foco do campo sendo digitado
  if (field === 'valor') atualizarTotaisSemRerender();
}

function atualizarTotaisSemRerender() {
  // Recalcula só os números visíveis (evita re-render completo enquanto o usuário digita)
  renderPagina();
}

async function salvarOrdemTransacao(id, ordem) {
  const t = state.transacoes.find((x) => x.id === id);
  if (t) t.ordem = ordem;
  await sb.from('transacoes').update({ ordem }).eq('id', id);
  marcarEdicao();
}

async function salvarMetaReserva(valor) {
  const v = Number(valor || 0);
  state.metaReserva.valor_limite = v;
  await sb.from('metas').update({ valor_limite: v }).eq('id', state.metaReserva.id);
  marcarEdicao();
}

// ============================================================
// EXCLUSÃO COM CONFIRMAÇÃO
// ============================================================
function abrirConfirmDelete(type, id, label) {
  state.pendingDelete = { type, id, label };
  document.getElementById('confirmModalItemName').textContent = `"${label}"`;
  document.getElementById('confirmModal').classList.add('show');
}
document.getElementById('confirmModalCancel').addEventListener('click', () => {
  state.pendingDelete = null;
  document.getElementById('confirmModal').classList.remove('show');
});
document.getElementById('confirmModalOk').addEventListener('click', async () => {
  if (!state.pendingDelete) return;
  const { type, id } = state.pendingDelete;
  showLoading(true);
  try {
    if (type === 'transacao') {
      await sb.from('transacoes').delete().eq('id', id);
      state.transacoes = state.transacoes.filter((t) => t.id !== id);
      state.aportesReserva = state.aportesReserva.filter((t) => t.id !== id);
      marcarEdicao();
      showToast('Item excluído.');
      renderPagina();
    } else if (type === 'conta_bancaria') {
      const { error } = await sb.from('contas_conectadas').delete().eq('id', id);
      if (error) throw error;
      marcarEdicao();
      showToast('Conta bancária removida.');
      carregarContasBancarias();
    } else if (type === 'carteira') {
      if (state.carteiras.length <= 1) {
        showToast('Não é possível excluir a única carteira.', 'error');
      } else {
        const { error } = await sb.from('carteiras').delete().eq('id', id);
        if (error) throw error;
        state.carteiras = state.carteiras.filter((c) => c.id !== id);
        if (state.carteiraAtualId === id) {
          state.carteiraAtualId = state.carteiras[0].id;
          await carregarDadosCarteira();
          renderPagina();
        }
        renderCarteirasSettings();
        renderCarteiraSelect();
        marcarEdicao();
        showToast('Carteira excluída.');
      }
    }
  } catch (err) {
    if (type === 'carteira') {
      showToast('Não foi possível excluir: existem transações ou contas conectadas vinculadas a esta carteira.', 'error');
    } else {
      showToast('Erro ao excluir.', 'error');
    }
  } finally {
    showLoading(false);
    state.pendingDelete = null;
    document.getElementById('confirmModal').classList.remove('show');
  }
});

// ============================================================
// CONFIGURAÇÕES (nome do sistema, tema, carteiras)
// ============================================================
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('settingsAppName').value = state.appName;
  document.getElementById('appTitleDisplay').textContent = state.appName;
  atualizarThemeOpts();
  renderCarteirasSettings();
  carregarContasBancarias();
  document.getElementById('settingsModal').classList.add('show');
});
document.getElementById('settingsClose').addEventListener('click', () =>
  document.getElementById('settingsModal').classList.remove('show'));

function atualizarThemeOpts() {
  document.getElementById('themeOptEscuro').classList.toggle('on', state.tema === 'escuro');
  document.getElementById('themeOptClaro').classList.toggle('on', state.tema === 'claro');
}
document.getElementById('themeOptEscuro').addEventListener('click', () => { aplicarTema('escuro'); atualizarThemeOpts(); });
document.getElementById('themeOptClaro').addEventListener('click', () => { aplicarTema('claro'); atualizarThemeOpts(); });

function renderCarteirasSettings() {
  const list = document.getElementById('settingsCarteirasList');
  list.innerHTML = state.carteiras.map((c) => `
    <div class="carteira-row">
      <input class="fi" style="flex:1" data-carteira-nome="${c.id}" value="${escapeHtml(c.nome)}">
      <span class="carteira-badge">${c.tipo}</span>
      <button class="del-btn" data-del-carteira="${c.id}" data-label="${escapeHtml(c.nome)}"><i class="ti ti-trash"></i></button>
    </div>`).join('');
  list.querySelectorAll('[data-carteira-nome]').forEach((input) => {
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        await sb.from('carteiras').update({ nome: input.value }).eq('id', input.dataset.carteiraNome);
        const c = state.carteiras.find((x) => x.id === input.dataset.carteiraNome);
        if (c) c.nome = input.value;
        renderCarteiraSelect();
        marcarEdicao();
      }, 500);
    });
  });
  list.querySelectorAll('[data-del-carteira]').forEach((b) => b.addEventListener('click', () => {
    abrirConfirmDelete('carteira', b.dataset.delCarteira, b.dataset.label);
  }));
}

// ============================================================
// CONTAS BANCÁRIAS CONECTADAS (Pluggy)
// ============================================================
async function carregarContasBancarias() {
  const list = document.getElementById('settingsContasList');
  list.innerHTML = '<div class="empty" style="padding:12px 0"><i class="ti ti-loader"></i> Carregando...</div>';
  const { data: contas, error } = await sb.from('contas_conectadas')
    .select('*').eq('carteira_id', state.carteiraAtualId).eq('ativa', true);
  if (error) { list.innerHTML = '<div class="empty" style="padding:12px 0">Erro ao carregar contas.</div>'; return; }
  if (!contas.length) {
    list.innerHTML = '<div class="empty" style="padding:12px 0">Nenhuma conta conectada nesta carteira ainda.</div>';
    return;
  }
  list.innerHTML = contas.map((c) => {
    const badgePessoa = (c.tipo_conta === 'PF' || c.tipo_conta === 'PJ')
      ? `<span class="carteira-badge">${c.tipo_conta}</span>` : '';
    return `
    <div class="conta-row">
      <div class="conta-info">
        <div class="conta-nome">${escapeHtml(c.banco)} ${c.apelido ? '· ' + escapeHtml(c.apelido) : ''} ${badgePessoa}</div>
        <div class="conta-detalhe">${c.pluggy_account_id ? 'conectado' : 'sincronizando...'} ${c.ultima_sincronizacao ? '· atualizado ' + new Date(c.ultima_sincronizacao).toLocaleString('pt-BR') : ''}</div>
      </div>
      <div class="conta-saldo">${c.pluggy_account_id ? fmtMoeda(c.saldo_atual) : '—'}</div>
      <button class="del-btn" data-del-conta="${c.id}" data-label="${escapeHtml(c.banco)}"><i class="ti ti-trash"></i></button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-del-conta]').forEach((b) => b.addEventListener('click', () => {
    abrirConfirmDelete('conta_bancaria', b.dataset.delConta, b.dataset.label);
  }));
}

async function conectarBanco() {
  if (typeof PluggyConnect === 'undefined') {
    showToast('Widget da Pluggy não carregou. Verifica sua conexão e tenta de novo.', 'error');
    return;
  }
  const tipoPessoa = confirm('Essa conta bancária é Pessoa Jurídica (PJ)?\n\nOK = PJ  ·  Cancelar = PF') ? 'PJ' : 'PF';
  showLoading(true);
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_CONFIG.url}/functions/v1/pluggy-connect-token`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await res.json();
    if (!res.ok || !result.accessToken) throw new Error(result.error || 'Falha ao gerar token de conexão.');

    const pluggyConnect = new PluggyConnect({
      connectToken: result.accessToken,
      includeSandbox: true, // sandbox habilitado — permite testar com bancos simulados antes de conectar o real
      onSuccess: async (itemData) => {
        showLoading(true);
        try {
          const bancoNome = itemData.item?.connector?.name || 'Banco';
          // Cria o "placeholder" que o webhook usa para saber a qual carteira essa conta pertence
          const { error: insErr } = await sb.from('contas_conectadas').insert({
            carteira_id: state.carteiraAtualId,
            pluggy_item_id: itemData.item.id,
            banco: bancoNome,
            tipo_conta: tipoPessoa, // 'PF' ou 'PJ', informado antes de abrir o widget
          });
          if (insErr) throw insErr;
          showToast(`${bancoNome} conectado! A sincronização das transações pode levar alguns instantes.`);
          marcarEdicao();
          carregarContasBancarias();
        } catch (err) {
          showToast('Conta autorizada, mas houve erro ao vincular à carteira.', 'error');
        } finally {
          showLoading(false);
        }
      },
      onError: (err) => {
        console.error('Erro Pluggy Connect:', err);
        showToast('A conexão bancária foi cancelada ou falhou.', 'error');
      },
    });
    pluggyConnect.init();
  } catch (err) {
    showToast('Erro ao iniciar conexão bancária.', 'error');
  } finally {
    showLoading(false);
  }
}
document.getElementById('conectarBancoBtn').addEventListener('click', conectarBanco);

document.getElementById('addCarteiraBtn').addEventListener('click', async () => {
  const tipo = confirm('Clique OK para PJ, ou Cancelar para PF.') ? 'PJ' : 'PF';
  const nome = tipo === 'PJ' ? 'Nova Carteira PJ' : 'Nova Carteira PF';
  const { data } = await sb.from('carteiras').insert({
    user_id: state.user.id, nome, tipo, ordem: state.carteiras.length,
  }).select().single();
  state.carteiras.push(data);
  renderCarteirasSettings();
  renderCarteiraSelect();
  marcarEdicao();
  showToast('Carteira criada.');
});

document.getElementById('settingsSave').addEventListener('click', () => {
  state.appName = document.getElementById('settingsAppName').value.trim() || 'Meu Financeiro';
  document.getElementById('appTitleDisplay').textContent = state.appName;
  localStorage.setItem('cf_app_name', state.appName);
  document.getElementById('settingsModal').classList.remove('show');
  showToast('Configurações salvas.');
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================
(async function init() {
  aplicarTema(localStorage.getItem('cf_tema') || 'escuro');
  state.appName = localStorage.getItem('cf_app_name') || 'Meu Financeiro';
  document.getElementById('appTitleDisplay').textContent = state.appName;

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await bootAfterAuth();
  }
})();
