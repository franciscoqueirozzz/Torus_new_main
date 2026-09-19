# Publicando o Torus com o frontend na Vercel

O SQLite usado pelo backend não funciona em funções serverless (a Vercel não
suporta — sistema de arquivos é read-only e não persiste entre requisições).
Por isso a divisão é: **frontend estático na Vercel** + **backend (com o
banco) em um serviço que roda um processo contínuo**, como Render ou Railway.

## 1. Backend (Render)

1. Suba a pasta `backend/` para um repositório Git.
2. Em render.com → New → Web Service, aponte para o repositório com
   Root Directory = `backend`.
3. Build Command: `pip install uv && uv sync --no-dev`
4. Start Command: `uv run uvicorn app.api:app --host 0.0.0.0 --port $PORT`
5. Depois do deploy, anote a URL gerada, ex.: `https://torus-backend.onrender.com`.

(Railway funciona do mesmo jeito, só muda a tela de configuração.)

## 2. Frontend (Vercel)

A pasta `vercel-frontend/` já é uma cópia do frontend pronta para hospedagem
separada (os caminhos `/assets/...` viraram relativos, e as chamadas de API
passam por uma URL configurável).

1. Suba a pasta `vercel-frontend/` para um repositório Git (pode ser o
   mesmo repositório do backend, só configurando o Root Directory).
2. Antes de subir, edite `vercel-frontend/config.js` e coloque a URL do
   backend do passo 1:
   ```js
   window.TORUS_API_BASE = 'https://torus-backend.onrender.com';
   ```
3. Em vercel.com → Add New → Project, importe o repositório e defina
   **Root Directory = `vercel-frontend`**. Não precisa de Build Command
   nem Output Directory — são arquivos estáticos puros.
4. Deploy. A Vercel te dá uma URL tipo `https://seu-projeto.vercel.app`.

O backend já está liberado (CORS) para aceitar qualquer origem
`https://*.vercel.app` — inclusive os deploys de preview. Se depois você
configurar um domínio próprio na Vercel, adicione esse domínio na lista
`allow_origins` em `backend/app/api.py`.

## 3. Uso normal (Render sozinho ou local) continua igual

A pasta `frontend/` original não foi alterada — se você rodar tudo junto
(local ou só no Render, sem separar o front), continua funcionando como
sempre, sem precisar do `vercel-frontend/` nem do `config.js`.
