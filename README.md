# Paperprint

Sistema de controle de impressões para laboratório de informática educacional.

---

## Como subir o ambiente

### Pré-requisitos

- Docker e Docker Compose instalados.
- Arquivo `.env` configurado (copie o `.env.example`).

### Passos

```bash
cp .env.example .env
# Edite o .env com suas credenciais

docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Banco: localhost:5432

---

## Credenciais padrão

| Campo | Valor |
|---|---|
| Usuário | `admin` |
| Senha | `Admin@1234` |

**Troque a senha imediatamente após o primeiro acesso** via Configurações → Usuários do Sistema.

---

## Como testar os fluxos

### 1. Identificação manual + impressão simples

1. Login com `admin / Admin@1234`.
2. Tela **Impressão** → aba **Matrícula** → informe qualquer matrícula → clicar **Identificar**.
   - Se o Lyceum estiver disponível, os dados serão preenchidos automaticamente.
   - Se indisponível, o aluno é criado em modo contingência e sincronizado depois.
3. Informe o número de folhas e confirme.

### 2. Empilhamento de matrículas

1. Identifique um aluno com saldo zero (ou informe mais folhas do que o saldo disponível).
2. Adicione uma matrícula emprestadora via botão **Adicionar matrícula emprestadora**.
3. O sistema exibe o preview do empilhamento antes da confirmação.

### 3. Ajuste de lançamento

1. Menu **Ajuste** → informe o ID da operação → buscar.
2. Clique **Ajustar** em um lançamento → informe o novo valor e o motivo.
3. Dupla confirmação antes de salvar; log de auditoria registrado automaticamente.

### 4. Relatórios

1. Menu **Relatórios** (perfil auditor ou admin).
2. Filtre por período e escolha entre as abas: Por Curso, Por Período, Top Alunos, Mensal, Auditoria.

### 5. Configurações

1. Menu **Config.** (somente admin).
2. Ajuste cota diária, máximo de empilhamentos, duplex e horário de reset.
3. Crie/desative usuários do sistema.

---

## Decisões arquiteturais

### Migrations via Knex no boot do backend

Optamos por rodar as migrations direto no startup do backend (`runMigrations()` em `server.ts`) em vez de usar scripts de init do Postgres. Motivos:

- As migrations ficam versionadas no mesmo repositório do código, com linguagem familiar (TypeScript).
- Não há dependência de volumes extras no container do Postgres.
- O backend já aguarda o healthcheck do Postgres antes de iniciar (via `depends_on` no Compose), então não há risco de race condition.

### Modelo de saldo calculado em runtime

Conforme especificado nos requisitos, **não existe campo de cota/saldo no cadastro do aluno**. O saldo disponível é sempre calculado como:

```
disponível = cota_atual_do_sistema − SUM(sheets) dos lançamentos do aluno no dia corrente
```

Isso significa que uma mudança na cota global impacta todos os alunos imediatamente, sem nenhuma migração de dados.

### Race condition

Operações de débito usam `SELECT ... FOR UPDATE` via `trx('students').whereIn('id', ...).forUpdate()` para serializar débitos concorrentes no mesmo aluno.

### Modo de contingência

Quando o Lyceum está indisponível, o aluno é criado com `sync_status = 'pending'`. Um worker (`syncWorker.ts`) tenta sincronizar esses registros a cada 5 minutos. Se a tentativa falhar, o status muda para `'attention'` para intervenção manual.

### Clientes externos isolados

Cada API externa (`lyceumClient`, `situatorClient`, `vectorAIClient`) é um módulo isolado com timeout e tratamento de erro próprios, sem acoplamento ao resto da aplicação. Fáceis de mockar em testes.

---

## Estrutura do projeto

```
paperprint/
├── docker-compose.yml
├── .env.example
├── README.md
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
│       ├── components/   # UI reutilizável (Modal, Button, Input, StudentCard, StackPreview...)
│       ├── contexts/     # AuthProvider
│       ├── hooks/        # useAuth
│       ├── lib/          # api client, formatters, error messages
│       ├── pages/        # LoginPage, PrintFlowPage, TodayPage, ReportsPage, SettingsPage, AdjustEntryPage
│       └── types/
└── backend/
    ├── Dockerfile
    └── src/
        ├── clients/      # lyceumClient, situatorClient, vectorAIClient
        ├── db/           # knex instance, migrate.ts
        ├── lib/          # logger
        ├── middleware/   # auth.ts
        ├── routes/       # auth, students, print, settings, reports, systemUsers
        ├── services/     # quotaService, studentService, printService, syncWorker
        └── types/
```
