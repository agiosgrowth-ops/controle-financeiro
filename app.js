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
// Interpreta o que foi digitado num campo de valor:
// - "+90" ou "-30" (string toda começando com sinal) → soma/subtrai do valor já salvo
// - "800+100", "90-30+10" (expressão com números já visíveis + operação) → soma os termos
//   e usa o resultado direto (cobre o caso comum de digitar "+100" no final do valor que já estava lá)
// - "200" → substitui pelo valor digitado
// - "" (vazio) → zera
function parseValorInput(raw, valorAtual) {
  let s = String(raw).trim().replace(/\s+/g, '').replace(/,/g, '.');
  if (s === '') return 0;
  const ehExpressao = /^[+-]?\d+(\.\d+)?([+-]\d+(\.\d+)?)*$/.test(s);
  if (ehExpressao) {
    const termos = s.match(/[+-]?\d+(\.\d+)?/g) || [];
    const soma = termos.reduce((acc, termo) => acc + parseFloat(termo), 0);
    const comecaComSinal = s.charAt(0) === '+' || s.charAt(0) === '-';
    const resultado = comecaComSinal ? valorAtual + soma : soma;
    return Math.round(resultado * 100) / 100;
  }
  const v = parseFloat(s);
  return isNaN(v) ? valorAtual : v;
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
    <input class="fi fi-val" data-field="valor" data-id="${t.id}" type="text" inputmode="decimal" value="${t.valor}" title="Digite um número para substituir, ou +90 / -30 para somar ou subtrair do valor atual">
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
      <input class="div-val-in" data-field="valor" data-id="${t.id}" type="text" inputmode="decimal" value="${t.valor}" title="Digite um número para substituir, ou +90 / -30 para somar ou subtrair do valor atual">
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
        plugins: { legend: {
