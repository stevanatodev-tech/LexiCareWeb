## Estrutura do projeto
- `index.html` — estrutura e conteúdo
- `styles.css` — estilos (com variáveis, tema escuro e acessibilidade)
- `app.js` — lógica do frontend (SPA com abas)
- `server.js` — API REST (Express)
- `schema.sql` — criação das tabelas PostgreSQL
- `package.json` — dependências e scripts

## Variáveis de ambiente (opcional)
- `PORT` — porta do servidor (padrão: 3000)
- `DATABASE_URL` — string de conexão PostgreSQL
- `JWT_SECRET` — segredo para assinar tokens (⚠️ obrigatório em produção)

## Endpoints da API
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Verifica se o servidor está ativo |
| POST | `/api/auth/login` | Login/cadastro (retorna JWT) |
| GET | `/api/data/:chave` | Busca dados do aluno (tarefas, notas...) |
| PUT | `/api/data/:chave` | Salva dados do aluno |
| GET | `/api/relatorio` | Resumo de progresso (RF12) |

## Modo demonstração (sem API)
Se o servidor estiver desligado, o frontend detecta automaticamente
e passa a salvar tudo em `localStorage`. O status aparece no dashboard.