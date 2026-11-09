-- LexiCare – banco PostgreSQL
-- Uso: createdb lexicare && psql lexicare -f schema.sql
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  tipo TEXT CHECK (tipo IN ('Dislexia','Disgrafia','Ambos')),
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dados (
  usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,            -- tarefas | notas | exercicios | caligrafia
  valor JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (usuario_id, chave)
);
