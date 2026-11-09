// LexiCare – API RESTful (Node.js + Express + PostgreSQL + JWT + bcrypt)
// Uso: npm install && node server.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SEGREDO = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@localhost:5432/lexicare',
  connectionTimeoutMillis: 5000,
});

app.use(cors());
// Aumenta limite do body (anotações longas podem passar de 100kb padrão)
app.use(express.json({ limit: '1mb' }));

// ===== Bloqueia acesso a arquivos sensíveis do projeto =====
// (impede que alguém baixe server.js, schema.sql, package.json, README.md)
app.use((req, res, next) => {
  if (/^\/(server\.js|schema\.sql|package(-lock)?\.json|README\.md|\.env)/i.test(req.path)) {
    return res.status(403).json({ erro: 'Acesso negado' });
  }
  next();
});

// Serve o frontend (index.html, styles.css, app.js)
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

// ===== Middleware de autenticação =====
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ erro: 'Token ausente' });
  try {
    req.usuario = jwt.verify(token, SEGREDO);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

// ===== Health check (usado pelo frontend em api.ping) =====
app.get('/api/health', (_, res) => res.json({ ok: true }));

// ===== Login / Cadastro automático (RF01, RF02) =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { nome, email, tipo, senha = email } = req.body || {};
    if (!email) return res.status(400).json({ erro: 'E-mail obrigatório' });

    // Sanitiza "tipo" para respeitar o CHECK do schema
    const tiposValidos = ['Dislexia', 'Disgrafia', 'Ambos'];
    const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'Dislexia';

    let { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);

    if (!rows.length) {
      // Cria novo usuário; senha padrão = email (modo demonstração)
      const hash = await bcrypt.hash(senha, 10);
      ({ rows } = await pool.query(
        'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1,$2,$3,$4) RETURNING *',
        [nome || 'Aluno', email, hash, tipoFinal]
      ));
    }

    const u = rows[0];
    const token = jwt.sign({ id: u.id, email: u.email }, SEGREDO, { expiresIn: '7d' });
    res.json({ token, nome: u.nome });
  } catch (e) {
    console.error('Erro no login:', e);
    res.status(500).json({ erro: 'Erro interno no login' });
  }
});

// ===== Dados do aluno (tarefas, notas, exercícios, caligrafia) =====
app.get('/api/data/:chave', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT valor FROM dados WHERE usuario_id=$1 AND chave=$2',
      [req.usuario.id, req.params.chave]
    );
    res.json({ value: rows[0] ? rows[0].valor : null });
  } catch (e) {
    console.error('Erro GET /data:', e);
    res.status(500).json({ erro: 'Erro ao buscar dados' });
  }
});

app.put('/api/data/:chave', auth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO dados (usuario_id, chave, valor) VALUES ($1,$2,$3)
       ON CONFLICT (usuario_id, chave) DO UPDATE SET valor = $3, atualizado_em = now()`,
      [req.usuario.id, req.params.chave, JSON.stringify(req.body.value)]
    );
    res.json({ salvo: true });
  } catch (e) {
    console.error('Erro PUT /data:', e);
    res.status(500).json({ erro: 'Erro ao salvar dados' });
  }
});

// ===== Relatório de progresso (RF12) =====
app.get('/api/relatorio', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT chave, valor FROM dados WHERE usuario_id=$1',
      [req.usuario.id]
    );
    const d = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    res.json({
      exercicios_feitos: d.exercicios || 0,
      tarefas_concluidas: Array.isArray(d.tarefas) ? d.tarefas.filter((t) => t.feita).length : 0,
      anotacoes: Array.isArray(d.notas) ? d.notas.length : 0,
      tentativas_caligrafia: Array.isArray(d.caligrafia) ? d.caligrafia.length : 0,
    });
  } catch (e) {
    console.error('Erro GET /relatorio:', e);
    res.status(500).json({ erro: 'Erro ao gerar relatório' });
  }
});

app.listen(PORT, () => {
  console.log(`LexiCare rodando em http://localhost:${PORT}`);
  if (SEGREDO === 'troque-este-segredo-em-producao') {
    console.warn('⚠️  JWT_SECRET não configurado — use variável de ambiente em produção!');
  }
});