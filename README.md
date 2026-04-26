# Verano Labs — DocID API

API de Gestão de Identificadores Únicos de Documentos Empresariais.

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Framework:** [Elysia](https://elysiajs.com)
- **ORM:** [Drizzle ORM](https://orm.drizzle.team)
- **Base de Dados:** SQLite (via `better-sqlite3`)
- **Extracção de PDF:** `pdf-parse`
- **Extracção de DOCX:** `mammoth`
- **Docs:** Swagger UI em `/docs`

---

## Instalação e Arranque

```bash
# Instalar dependências
bun install

# Iniciar em modo desenvolvimento (com hot-reload)
bun dev

# Iniciar em produção
bun start
```

A API fica disponível em `http://localhost:3000`  
Swagger UI: `http://localhost:3000/docs`

---

## Estrutura do Projecto

```
src/
├── index.ts                        # Entry point — Elysia app
├── db/
│   └── index.ts                    # Conexão SQLite + seed de categorias
│   └── schema.ts                   # Schema Drizzle (tabelas e tipos)
├── modules/
│   ├── categories.module.ts        # GET /categories
│   ├── identifiers.module.ts       # POST /identifiers/generate, GET /identifiers/:id ...
│   ├── documents.module.ts         # POST /documents/attach, GET /documents/:id ...
│   ├── audit.module.ts             # GET /audit
│   └── stats.module.ts             # GET /stats
└── services/
    ├── identifier.service.ts       # Lógica de geração e consulta de IDs
    ├── document.service.ts         # Extracção de texto (PDF / DOCX / TXT)
    └── attachment.service.ts       # Upload, verificação e associação de ficheiros
```

---

## Fluxo Principal

```
1. Gerar identificador
   POST /identifiers/generate
   { "categoryId": "PROP", "issuedTo": "Colégio IMTELC" }
   → { identifier: "VL-PROP-2026-0424-001" }

2. Incluir o identificador no documento (PDF, DOCX, etc.)
   O documento DEVE conter o texto "VL-PROP-2026-0424-001"

3. Associar o documento ao identificador
   POST /documents/attach  (multipart/form-data)
   { identifier: "VL-PROP-2026-0424-001", file: <ficheiro> }
   → Verifica se o identificador está no conteúdo do ficheiro
   → Se encontrado: guarda e marca como "attached"
   → Se não encontrado: rejeita com erro 422

4. Consultar
   GET /identifiers/VL-PROP-2026-0424-001
   → Dados completos: identificador + documento + categoria

5. Download
   GET /documents/VL-PROP-2026-0424-001/download
```

---

## Categorias de Documentos

| Grupo          | ID    | Nome                                  |
|----------------|-------|---------------------------------------|
| Comercial      | PROP  | Proposta Comercial                    |
| Comercial      | FAT   | Factura                               |
| Comercial      | REC   | Recibo                                |
| Comercial      | NOT   | Nota de Crédito                       |
| Comercial      | NDB   | Nota de Débito                        |
| Comercial      | ORD   | Ordem de Compra                       |
| Comercial      | GUE   | Guia de Entrega / Remessa             |
| Comercial      | COT   | Cotação                               |
| Financeiro     | REL   | Relatório Financeiro                  |
| Financeiro     | EXT   | Extracto de Conta                     |
| Financeiro     | ORC   | Orçamento Interno                     |
| Financeiro     | AUT   | Autorização de Pagamento              |
| Financeiro     | TRF   | Comprovativo de Transferência         |
| RH             | CTR   | Contrato de Trabalho                  |
| RH             | TER   | Termo de Rescisão                     |
| RH             | FLC   | Folha de Salário                      |
| RH             | DEC   | Declaração de Vínculo                 |
| RH             | MAP   | Mapa de Férias                        |
| RH             | ADM   | Admissão de Colaborador               |
| Jurídico       | CPS   | Contrato de Prestação de Serviços     |
| Jurídico       | CPF   | Contrato de Parceria / Fornecimento   |
| Jurídico       | NDA   | Acordo de Confidencialidade (NDA)     |
| Jurídico       | SLA   | Acordo de Nível de Serviço (SLA)      |
| Jurídico       | MOU   | Memorando de Entendimento (MOU)       |
| Jurídico       | POW   | Procuração                            |
| Jurídico       | ACO   | Acordo de Colaboração                 |
| Jurídico       | LIC   | Contrato de Licenciamento             |
| Jurídico       | CLA   | Contrato de Locação / Arrendamento    |
| Jurídico       | GAR   | Carta de Garantia                     |
| Jurídico       | TIT   | Título Executivo / Livrança           |
| Administrativo | ATA   | Acta de Reunião                       |
| Administrativo | MEM   | Memorando Interno                     |
| Administrativo | CIR   | Circular                              |
| Administrativo | REQ   | Requisição Interna                    |
| Administrativo | POL   | Política / Regulamento Interno        |
| Administrativo | PRO   | Procedimento Operacional              |
| Administrativo | DEL   | Despacho / Deliberação                |
| Técnico        | ESP   | Especificação Técnica                 |
| Técnico        | MAN   | Manual de Utilização                  |
| Técnico        | REP   | Relatório Técnico                     |
| Técnico        | TAS   | Termo de Aceitação / Entrega          |
| Técnico        | PLN   | Plano de Projecto                     |

---

## Endpoints Completos

### Categorias
| Método | Rota             | Descrição                       |
|--------|------------------|---------------------------------|
| GET    | /categories      | Listar todas (agrupadas)        |
| GET    | /categories/:id  | Obter categoria por ID          |

### Identificadores
| Método | Rota                           | Descrição                        |
|--------|--------------------------------|----------------------------------|
| POST   | /identifiers/generate          | Gerar novo identificador         |
| GET    | /identifiers                   | Listar (filtros: categoria, status, ano) |
| GET    | /identifiers/:identifier       | Consultar identificador          |
| PATCH  | /identifiers/:identifier/cancel| Cancelar identificador           |

### Documentos
| Método | Rota                                | Descrição                        |
|--------|-------------------------------------|----------------------------------|
| POST   | /documents/attach                   | Associar documento (multipart)   |
| GET    | /documents/:identifier              | Consultar metadados              |
| GET    | /documents/:identifier/download     | Download do ficheiro             |

### Auditoria & Stats
| Método | Rota    | Descrição               |
|--------|---------|-------------------------|
| GET    | /audit  | Logs de auditoria       |
| GET    | /stats  | Estatísticas gerais     |

---

## Exemplos com cURL

```bash
# 1. Listar categorias
curl http://localhost:3000/categories

# 2. Gerar identificador para uma proposta comercial
curl -X POST http://localhost:3000/identifiers/generate \
  -H "Content-Type: application/json" \
  -d '{ "categoryId": "PROP", "issuedTo": "Colégio IMTELC", "description": "Infraestrutura de rede" }'

# 3. Associar documento PDF
curl -X POST http://localhost:3000/documents/attach \
  -F "identifier=VL-PROP-2026-0424-001" \
  -F "file=@/caminho/para/proposta.pdf" \
  -F "uploadedBy=Edgar Janota"

# 4. Consultar
curl http://localhost:3000/identifiers/VL-PROP-2026-0424-001

# 5. Cancelar
curl -X PATCH http://localhost:3000/identifiers/VL-PROP-2026-0424-001/cancel \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Cliente recusou proposta" }'

# 6. Estatísticas
curl http://localhost:3000/stats
```

---

## Variáveis de Ambiente (opcional)

Crie um ficheiro `.env` na raiz:

```env
PORT=3000
DB_PATH=./verano_docs.db
UPLOAD_DIR=./uploads
```

> Por defeito, a API corre na porta `3000` sem necessidade de `.env`.
# Identifierdocuments
