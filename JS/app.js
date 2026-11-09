/* ============================================================
   LexiCare — Lógica da aplicação
   ============================================================ */
'use strict';

/* ===== 1. Configuração ===== */
const API_URL = 'http://localhost:3000/api';
const STORAGE_PREFIX = 'lx_';

/* ===== 2. Helpers ===== */
const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/** Escapa caracteres especiais para inserção segura em HTML */
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}

/** Garante que uma cor seja hexadecimal válida */
function corSegura(c) {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#1F5FA8';
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

function fala(texto) {
  if (!('speechSynthesis' in window)) {
    toast('Seu navegador não tem suporte a voz.');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR';
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

const hoje = () => new Date().toISOString().slice(0, 10);

/** fetch com timeout (compatível com navegadores antigos) */
async function fetchWithTimeout(url, options = {}, ms = 2000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ===== 3. Estado global ===== */
let user = null;
let online = false;
let tarefas = [];
let notas = [];
let ref = new Date();
let selDia = hoje();

/* ===== 4. Camada de API ===== */
const api = {
  async ping() {
    try {
      const r = await fetchWithTimeout(`${API_URL}/health`, {}, 1500);
      online = r.ok;
    } catch {
      online = false;
    }
    return online;
  },

  async login(u) {
    if (!online) return;
    try {
      const r = await fetchWithTimeout(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(u),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.token) localStorage.setItem('lx_token', d.token);
      }
    } catch (e) {
      console.warn('Login API falhou:', e);
    }
  },

  async get(chave, padrao) {
    // Tenta API primeiro
    if (online && user) {
      try {
        const token = localStorage.getItem('lx_token');
        const r = await fetchWithTimeout(`${API_URL}/data/${chave}`, {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        if (r.ok) {
          const d = await r.json();
          return d.value ?? padrao;
        }
      } catch (e) {
        console.warn('GET API falhou:', e);
      }
    }
    // Fallback: localStorage
    if (!user) return padrao;
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${user.email}_${chave}`);
      return raw ? JSON.parse(raw) : padrao;
    } catch {
      return padrao;
    }
  },

  async set(chave, valor) {
    if (!user) return;
    // Salva sempre no localStorage (backup)
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${user.email}_${chave}`, JSON.stringify(valor));
    } catch (e) {
      console.warn('localStorage cheio:', e);
    }
    // Tenta API se online
    if (online) {
      try {
        const token = localStorage.getItem('lx_token');
        await fetchWithTimeout(`${API_URL}/data/${chave}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
          },
          body: JSON.stringify({ value: valor }),
        });
      } catch (e) {
        console.warn('PUT API falhou:', e);
      }
    }
  },
};

/* ===== 5. Login / Logout ===== */
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const nome  = $('#nome').value.trim();
  const email = $('#email').value.trim().toLowerCase();
  const tipo  = $('#tipo').value;

  if (!nome || !email) {
    toast('Preencha nome e e-mail.');
    return;
  }

  user = { nome, email, tipo };
  localStorage.setItem('lx_user', JSON.stringify(user));
  document.documentElement.classList.add('logado');

  await iniciar();
};

$('#sair').onclick = () => {
  localStorage.removeItem('lx_user');
  location.reload();
};

$('#aMais').onclick = () => {
  const atual = parseFloat(getComputedStyle(document.body).fontSize);
  document.body.style.fontSize = (atual >= 24 ? 16 : atual + 2) + 'px';
};

/* ===== 6. Navegação por abas ===== */
function ir(id) {
  $$('section').forEach((s) => s.classList.toggle('on', s.id === id));
  $$('#tabs button').forEach((b) => {
    const sel = b.dataset.t === id;
    b.setAttribute('aria-selected', sel);
    b.setAttribute('tabindex', sel ? '0' : '-1');
  });
  if (id === 'cal2') desenhaBase();
  resumo();
}

$$('#tabs button').forEach((b) => (b.onclick = () => ir(b.dataset.t)));
$$('[data-go]').forEach((b) => (b.onclick = () => ir(b.dataset.go)));

// Navegação por teclado nas abas
$('#tabs').addEventListener('keydown', (e) => {
  const tabs = $$('#tabs button');
  const idx = tabs.indexOf(document.activeElement);
  if (idx === -1) return;

  let novo = idx;
  if (e.key === 'ArrowRight') novo = (idx + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') novo = (idx - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') novo = 0;
  else if (e.key === 'End') novo = tabs.length - 1;
  else return;

  e.preventDefault();
  tabs[novo].focus();
  ir(tabs[novo].dataset.t);
});

// Inicializa tabindex das abas
$$('#tabs button').forEach((b, i) => b.setAttribute('tabindex', i === 0 ? '0' : '-1'));

/* ===== 7. Calendário ===== */
async function carregaCal() {
  tarefas = (await api.get('tarefas', [])) || [];
  if (!Array.isArray(tarefas)) tarefas = [];
  desenhaCal();
}

function desenhaCal() {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const n = new Date(y, m + 1, 0).getDate();
  const ini = new Date(y, m, 1).getDay();

  $('#mes').textContent = ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  let h = 'DSTQQSS'.split('').map((d) => `<b>${d}</b>`).join('');
  h += '<span></span>'.repeat(ini);

  for (let d = 1; d <= n; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const temTarefa = tarefas.some((t) => t.data === iso);
    h += `<button class="day ${iso === hoje() ? 'today' : ''} ${iso === selDia ? 'sel' : ''}"
            data-d="${iso}" aria-label="Dia ${d}${temTarefa ? ' (com tarefas)' : ''}">${d}${temTarefa ? '<i></i>' : ''}</button>`;
  }

  $('#grid').innerHTML = h;
  $$('.day').forEach((b) => (b.onclick = () => { selDia = b.dataset.d; desenhaCal(); }));

  $('#diaSel').textContent = 'Tarefas de ' + selDia.split('-').reverse().join('/');

  const lista = tarefas
    .filter((t) => t.data === selDia)
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));

  $('#tarefas').innerHTML = lista.length
    ? lista.map((t) => `
        <div class="task ${t.feita ? 'done' : ''}" style="--c:${corSegura(t.cor)}">
          <input type="checkbox" ${t.feita ? 'checked' : ''} data-f="${t.id}"
                 style="width:28px;height:28px" aria-label="Concluir tarefa">
          <span>${esc(t.hora || '')} ${esc(t.titulo)}</span>
          <button class="alt" data-x="${t.id}" aria-label="Remover tarefa">🗑</button>
        </div>`).join('')
    : '<p class="status">Nenhuma tarefa neste dia.</p>';

  $$('[data-f]').forEach((c) => (c.onchange = async () => {
    const t = tarefas.find((x) => x.id == c.dataset.f);
    if (t) t.feita = c.checked;
    await api.set('tarefas', tarefas);
    toast('Salvo!');
    desenhaCal();
    resumo();
  }));

  $$('[data-x]').forEach((b) => (b.onclick = async () => {
    tarefas = tarefas.filter((x) => x.id != b.dataset.x);
    await api.set('tarefas', tarefas);
    toast('Tarefa removida');
    desenhaCal();
    resumo();
  }));
}

$('#prev').onclick = () => { ref.setMonth(ref.getMonth() - 1); desenhaCal(); };
$('#next').onclick = () => { ref.setMonth(ref.getMonth() + 1); desenhaCal(); };

$('#addT').onclick = async () => {
  const titulo = $('#tt').value.trim();
  if (!titulo) return toast('Digite o nome da tarefa');

  tarefas.push({
    id: Date.now(),
    titulo,
    data: selDia,
    hora: $('#th').value,
    cor: $('#tc').value,
    feita: false,
  });

  await api.set('tarefas', tarefas);
  $('#tt').value = '';
  toast('Tarefa salva!');
  desenhaCal();
  resumo();
};

// Atalho: Enter no campo de tarefa adiciona
$('#tt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#addT').click(); }
});

/* ===== 8. Exercícios de leitura ===== */
const NIV = {
  1: {
    enun: 'Qual o som desta letra?',
    itens: [
      ['B', ['/b/', '/d/', '/p/'], 0, 'O B tem a barriga para a frente.'],
      ['D', ['/b/', '/d/', '/t/'], 1, 'O D tem a barriga para trás.'],
      ['P', ['/p/', '/b/', '/q/'], 0, 'O P tem a perna para baixo.'],
      ['M', ['/n/', '/m/', '/l/'], 1, 'O M tem duas perninhas.'],
    ],
  },
  2: {
    enun: 'Qual sílaba você ouviu?',
    itens: [
      ['BA', ['BA', 'DA', 'PA'], 0, 'Feche os lábios para o B.'],
      ['TO', ['DO', 'TO', 'CO'], 1, 'Língua nos dentes para o T.'],
      ['LA', ['LA', 'NA', 'RA'], 0, 'Língua no céu da boca.'],
      ['VE', ['FE', 'VE', 'BE'], 1, 'Dentes no lábio para o V.'],
    ],
  },
  3: {
    enun: 'Qual palavra está certa?',
    itens: [
      ['bolo', ['volo', 'bolo', 'dolo'], 1, 'Doce de aniversário.'],
      ['casa', ['caza', 'gasa', 'casa'], 2, 'Onde moramos.'],
      ['pato', ['bato', 'pato', 'dato'], 1, 'Animal que faz quá.'],
      ['dado', ['tado', 'dado', 'bado'], 1, 'Jogo de seis lados.'],
    ],
  },
  4: {
    enun: 'Complete a frase:',
    itens: [
      ['O gato bebe ___.', ['leite', 'pedra', 'livro'], 0, 'Pense no que o gato bebe.'],
      ['Eu leio um ___.', ['sapato', 'livro', 'prato'], 1, 'Ele tem páginas.'],
      ['A bola é ___.', ['redonda', 'salgada', 'curta'], 0, 'Pense na forma.'],
      ['O sol é ___.', ['frio', 'quente', 'duro'], 1, 'Ele aquece o dia.'],
    ],
  },
};

let nivel = 1;
let idx = 0;
let acertos = 0;

function mostraNivel(n) {
  nivel = n;
  idx = 0;
  acertos = 0;

  $('#niveis').innerHTML = [1, 2, 3, 4]
    .map((i) => `<button class="${i === n ? '' : 'alt'}" data-n="${i}">Nível ${i}</button>`)
    .join('');

  $$('[data-n]').forEach((b) => (b.onclick = () => mostraNivel(+b.dataset.n)));
  questao();
}

function questao() {
  const L = NIV[nivel].itens;
  $('#dica').hidden = true;

  if (idx >= L.length) {
    $('#pergunta').textContent = acertos >= 3 ? '🎉' : '💪';
    $('#enunciado').textContent = `Você acertou ${acertos} de ${L.length}. ${acertos >= 3 ? 'Muito bem!' : 'Tente novamente!'}`;
    $('#opts').innerHTML = '<button id="rep">Refazer nível</button>';
    $('#rep').onclick = () => mostraNivel(nivel);
    $('#barra').style.width = '100%';
    return;
  }

  const q = L[idx];
  $('#pergunta').textContent = q[0];
  $('#pergunta').style.fontSize = nivel === 4 ? '2rem' : '';
  $('#enunciado').textContent = NIV[nivel].enun;
  $('#prog').textContent = `Exercício ${idx + 1} de ${L.length}`;
  $('#barra').style.width = (idx / L.length * 100) + '%';

  $('#opts').innerHTML = q[1].map((o, i) => `<button data-i="${i}">${o}</button>`).join('');
  $$('#opts button').forEach((b) => (b.onclick = () => responde(b, q)));
}

async function responde(b, q) {
  const ok = +b.dataset.i === q[2];
  $$('#opts button').forEach((x) => (x.disabled = true));
  b.classList.add(ok ? 'ok' : 'no');

  if (ok) {
    acertos++;
    fala('Muito bem!');
  } else {
    $$('#opts button')[q[2]].classList.add('ok');
    $('#dica').textContent = 'Dica: ' + q[3];
    $('#dica').hidden = false;
    fala('Quase! ' + q[3]);
  }

  // Incrementa contador total de exercícios
  const total = (await api.get('exercicios', 0)) + 1;
  await api.set('exercicios', total);
  resumo();

  setTimeout(() => { idx++; questao(); }, ok ? 900 : 2200);
}

$('#ouvir').onclick = () => fala($('#pergunta').textContent.replace('___', 'espaço'));

/* ===== 9. Caligrafia ===== */
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let li = 2;
const cv = $('#cv');
const cx = cv.getContext('2d');
let pintando = false;

function desenhaBase() {
  cx.clearRect(0, 0, 420, 420);
  cx.fillStyle = '#fff';
  cx.fillRect(0, 0, 420, 420);

  // Linhas guia
  cx.strokeStyle = '#cfe0f5';
  cx.lineWidth = 2;
  for (let y = 105; y < 420; y += 105) {
    cx.beginPath(); cx.moveTo(0, y); cx.lineTo(420, y); cx.stroke();
  }

  // Letra pontilhada
  cx.font = 'bold 330px Verdana, Arial';
  cx.textAlign = 'center';
  cx.textBaseline = 'middle';
  cx.setLineDash([8, 10]);
  cx.strokeStyle = '#8fb6e6';
  cx.lineWidth = 3;
  cx.strokeText(LETRAS[li], 210, 225);
  cx.setLineDash([]);

  $('#letra').textContent = 'Trace a letra ' + LETRAS[li];
  $('#nota').textContent = '';
  cv.setAttribute('aria-label', `Área de desenho para praticar a letra ${LETRAS[li]}`);
}

const pos = (e) => {
  const r = cv.getBoundingClientRect();
  return [
    (e.clientX - r.left) * 420 / r.width,
    (e.clientY - r.top) * 420 / r.height,
  ];
};

cv.onpointerdown = (e) => {
  pintando = true;
  try { cv.setPointerCapture(e.pointerId); } catch {}
  const [x, y] = pos(e);
  cx.beginPath();
  cx.moveTo(x, y);
  cx.strokeStyle = '#1F5FA8';
  cx.lineWidth = 10;
  cx.lineCap = 'round';
  cx.lineJoin = 'round';
};

cv.onpointermove = (e) => {
  if (!pintando) return;
  const [x, y] = pos(e);
  cx.lineTo(x, y);
  cx.stroke();
};

cv.onpointerup = () => { pintando = false; };
cv.onpointercancel = () => { pintando = false; };
cv.onpointerleave = () => { pintando = false; };

$('#limpar').onclick = desenhaBase;
$('#lp').onclick = () => { li = (li + 25) % 26; desenhaBase(); };
$('#ln').onclick = () => { li = (li + 1) % 26; desenhaBase(); };

$('#avaliar').onclick = async () => {
  let snap;
  try {
    snap = cx.getImageData(0, 0, 420, 420).data;
  } catch {
    return toast('Não foi possível ler o desenho.');
  }

  const mk = (w) => {
    const c = document.createElement('canvas');
    c.width = c.height = 420;
    const g = c.getContext('2d');
    g.font = 'bold 330px Verdana, Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = w;
    g.lineJoin = 'round';
    g.strokeStyle = '#000';
    g.fillStyle = '#000';
    g.fillText(LETRAS[li], 210, 225);
    g.strokeText(LETRAS[li], 210, 225);
    return g.getImageData(0, 0, 420, 420).data;
  };

  const tol = mk(36);
  const mod = mk(0);

  let user = 0, dentro = 0, alvo = 0, cobre = 0;

  for (let i = 0; i < snap.length; i += 4) {
    const azul = snap[i] < 60 && snap[i + 2] > 140 && snap[i + 1] < 120;
    const t = tol[i + 3] > 128;
    const m = mod[i + 3] > 128;

    if (azul) { user++; if (t) dentro++; }
    if (m)    { alvo++; if (azul) cobre++; }
  }

  if (user < 200) return toast('Faça o traçado primeiro');

  const prec = dentro / user;
  const cob  = Math.min(1, cobre / alvo * 2.2);
  const nota = Math.round(prec * cob * 100);

  $('#nota').textContent = `Pontuação: ${nota}/100 — ${
    nota >= 70 ? 'Excelente!' : nota >= 40 ? 'Bom, continue!' : 'Tente novamente!'
  }`;

  const h = await api.get('caligrafia', []);
  h.push({ letra: LETRAS[li], nota, data: hoje() });
  await api.set('caligrafia', h);
  toast('Tentativa salva!');
};

/* ===== 10. Anotações ===== */
const DIC = {
  caza: 'casa', volo: 'bolo', jente: 'gente', conpra: 'compra', pratu: 'prato',
  livru: 'livro', eskola: 'escola', esquola: 'escola', iscola: 'escola',
  tudu: 'tudo', redaçao: 'redação', ciencias: 'ciências', historia: 'história',
  pesquizar: 'pesquisar', fraçoes: 'frações', fraçao: 'fração', naum: 'não',
  nao: 'não', voce: 'você', porem: 'porém', tambem: 'também',
};

function corrige(t) {
  return t.replace(/\p{L}+/gu, (w) => {
    const k = w.toLowerCase();
    const r = DIC[k];
    if (!r) return w;
    return w[0] === w[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
  });
}

async function carregaNotas() {
  notas = (await api.get('notas', [])) || [];
  if (!Array.isArray(notas)) notas = [];
  listaNotas();
}

function listaNotas() {
  $('#lista').innerHTML = notas.length
    ? notas.map((n) => `
        <div class="note">
          <div>
            <b>${esc(n.t || 'Sem título')}</b><br>
            <span class="status">${esc(String(n.b || '').slice(0, 70))}</span>
          </div>
          <button class="alt" data-l="${n.id}" aria-label="Ouvir anotação">🔊</button>
          <button class="alt" data-r="${n.id}" aria-label="Apagar anotação">🗑</button>
        </div>`).join('')
    : '<p class="status">Nenhuma anotação salva.</p>';

  $$('[data-l]').forEach((b) => (b.onclick = () => {
    const n = notas.find((x) => x.id == b.dataset.l);
    if (n) fala(n.b);
  }));

  $$('[data-r]').forEach((b) => (b.onclick = async () => {
    notas = notas.filter((n) => n.id != b.dataset.r);
    await api.set('notas', notas);
    toast('Anotação apagada');
    listaNotas();
    resumo();
  }));
}

$('#corr').onclick = () => {
  $('#nb').value = corrige($('#nb').value);
  toast('Texto corrigido');
};

$('#lerN').onclick = () => fala($('#nb').value || 'Escreva algo para eu ler.');

$('#salvarN').onclick = async () => {
  const b = $('#nb').value.trim();
  if (!b) return toast('Escreva algo primeiro');

  notas.unshift({ id: Date.now(), t: $('#nt').value.trim(), b });
  await api.set('notas', notas);
  $('#nt').value = '';
  $('#nb').value = '';
  toast('Anotação salva!');
  listaNotas();
  resumo();
};

$('#voz').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Use o Google Chrome para gravar por voz');

  const r = new SR();
  r.lang = 'pt-BR';
  r.onresult = (e) => {
    const texto = e.results[0][0].transcript;
    $('#nb').value += ($('#nb').value ? ' ' : '') + texto;
  };
  r.onerror = () => toast('Não consegui ouvir. Tente de novo.');
  r.start();
  toast('Pode falar…');
};

/* ===== 11. Resumo / Início ===== */
async function resumo() {
  $('#resumo').textContent = tarefas.filter((t) => t.data === hoje()).length;
  $('#nns').textContent = notas.length;
  $('#exs').textContent = (await api.get('exercicios', 0)) ?? 0;
}

/* ===== 12. Inicialização ===== */
async function iniciar() {
  await api.ping();

  if (!user) return;

  $('#auth').hidden = true;

  const primeiroNome = user.nome.split(' ')[0];
  $('#ola').textContent = primeiroNome;
  $('#ola2').textContent = primeiroNome + '!';

  $('#apiStatus').textContent = online
    ? '● Conectado à API (Node.js + PostgreSQL)'
    : '● Modo demonstração: dados salvos neste navegador (API desligada)';

  await carregaCal();
  await carregaNotas();
  mostraNivel(1);
  desenhaBase();
  await resumo();
}

/* Carrega usuário salvo, se existir */
try {
  const salvo = localStorage.getItem('lx_user');
  if (salvo) {
    user = JSON.parse(salvo);
    iniciar().catch((e) => {
      console.error('Falha ao iniciar:', e);
      document.documentElement.classList.remove('logado');
      $('#auth').hidden = false;
      localStorage.removeItem('lx_user');
      user = null;
    });
  }
} catch (e) {
  localStorage.removeItem('lx_user');
}