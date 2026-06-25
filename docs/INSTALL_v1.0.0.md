# DocID v1.0.0 — Guia de Instalação

> Plataformas: Windows (`.exe`/`.msi`) e Linux (`.AppImage`/`.deb`)

---

## 1. Instalar a API DocID (servidor)

A aplicação desktop conecta-se a uma API alojada num servidor. Primeiro, instala e configura a API.

### Requisitos do servidor

- Ubuntu 22.04+ (ou qualquer distro com PostgreSQL 16+ e Redis 7+)
- PostgreSQL
- Redis
- Bun
- Domínio/subdomínio para a API (ex: `api.empresa.ao`)

### Passos de instalação

```bash
# 1. Clonar ou copiar o código da API
cd apps/api

# 2. Configurar variáveis de ambiente
cp .env .env.production
# Editar .env.production:
#   - JWT_SECRET=gerar-uma-chave-secreta-min-32-caracteres
#   - DATABASE_URL=postgresql://user:pass@host:5432/docid
#   - REDIS_URL=redis://localhost:6379
#   - GROQ_API_KEY=sua-chave-groq
#   - PORT=3000

# 3. Criar base de dados
sudo -u postgres psql
CREATE DATABASE docid;
CREATE USER docid_user WITH PASSWORD 'sua_password';
GRANT ALL PRIVILEGES ON DATABASE docid TO docid_user;
\q

# 4. Criar base de dados
sudo -u postgres psql -d docid -c "CREATE SCHEMA drizzle;"
sudo -u postgres psql -d docid -c "GRANT ALL ON SCHEMA drizzle TO docid_user;"
sudo -u postgres psql -d docid -c "GRANT ALL ON SCHEMA public TO docid_user;"

# 5. Executar migrações
bun run db:migrate

# 6. Executar seed (cria categorias e roles)
bun run db:seed

# 7. Iniciar a API
bun run start

# 8. (Opcional) Configurar como serviço systemd
sudo tee /etc/systemd/system/docid-api.service <<EOF
[Unit]
Description=DocID API v1.0.0
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/docid/api
ExecStart=/usr/local/bin/bun /opt/docid/api/src/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable docid-api
sudo systemctl start docid-api
```

### Configurar reverse proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name api.empresa.ao;

    ssl_certificate /etc/ssl/certs/empresa.ao.pem;
    ssl_certificate_key /etc/ssl/private/empresa.ao.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 2. Instalar a aplicação Desktop

### Linux — AppImage (recomendado)

```bash
chmod +x DocID_1.0.0_amd64.AppImage
./DocID_1.0.0_amd64_amd64.AppImage
```

### Linux — .deb

```bash
sudo dpkg -i DocID_1.0.0_amd64.deb
# ou
sudo apt install ./DocID_1.0.0_amd64.deb
```

### Windows — .exe (NSIS installer)

1. Executar `DocID_1.0.0_x64-setup.exe`
2. Seguir o assistente de instalação
3. Executar DocID a partir do Menu Iniciar

### Windows — .msi (Enterprise)

```powershell
msiexec /i DocID_1.0.0_x64_en-US.msi /quiet
```

---

## 3. Configurar a aplicação

Ao abrir a aplicação pela primeira vez:

1. Clicar em **"Criar"** para registar a organização
2. Ou fazer login se já tiver conta
3. Após login: **Configurações → Servidor** — confirmar o URL da API
   - Para desenvolvimento local: `http://localhost:3000`
   - Para produção: `https://api.empresa.ao`

---

## 4. Testar a instalação

```bash
# Testar API
curl https://api.empresa.ao/

# Deve retornar:
# {"name":"Verano Labs — DocID API","version":"1.0.0","status":"online","docs":"/docs"}
```

---

## Ficheiros gerados

```
apps/desktop/src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/
├── deb/
│   └── DocID_1.0.0_amd64.deb          (6.6 MB)
└── appimage/
    └── DocID_1.0.0_amd64.AppImage      (79 MB)

# No Windows (fazer build com mingw):
├── nsis/
│   └── DocID_1.0.0_x64-setup.exe
└── msi/
    └── DocID_1.0.0_x64_en-US.msi
```

---

## Ambientes de teste

| Utilizador | Password | Organização | Role |
|---|---|---|---|
| admin@verano.ao | (criado no onboarding) | A tua organização | ORG_ADMIN |

---

## Notas importantes

- **PostgreSQL + Redis** são obrigatórios no servidor
- A aplicação funciona offline mas precisa de conexão à API para sincronizar
- O primeiro utilizador cria a organização — este é automaticamente ORG_ADMIN
- Para trocar o URL da API: **Configurações → Servidor → Testar e guardar**
