# Guia para IT — instalar o DocID sem aviso do SmartScreen

**Público:** administradores de TI dos clientes (B2B).
**Problema:** o instalador não tem certificado Authenticode comercial. O Windows mostra
“Windows protegeu o seu PC / Editor desconhecido”. Isto é reputação, não vírus.

> **Não desativar o SmartScreen nem o Defender globalmente** para resolver isto.
> As opções abaixo permitem o DocID sem baixar a proteção do resto do parque.

## Ficheiro a distribuir

- Página de download: `https://docid.milvendas.ao` (botão Windows). O nome segue o padrão
  `DocID_<versão>_x64-setup.exe`; à data desta revisão (27/11/2026) é a versão **1.2.7**:
  `https://docid.milvendas.ao/downloads/DocID_1.2.7_x64-setup.exe` (304 152 197 bytes).
- Para instalar em massa ou em computadores sem internet, use o **instalador completo**
  `DocID_<versão>_x64-setup-offline.exe` (~300 MB, inclui o WebView2). O instalador normal
  (`…_x64-setup.exe`, ~9 MB) descarrega o WebView2 da Microsoft se o computador ainda não o tiver.
- Hash oficial de cada versão: `https://docid.milvendas.ao/downloads/SHA256SUMS`, actualizado
  automaticamente a cada versão publicada.
- Depois de instalada, a app actualiza-se sozinha (pede confirmação); só a primeira instalação
  precisa deste guia.

O instalador inclui o runtime WebView2 — não é preciso instalar mais nada.
O download demora vários minutos; **confirmar sempre o hash antes de aprovar**, para excluir
um ficheiro interrompido:

```powershell
Get-FileHash .\DocID_1.2.7_x64-setup.exe -Algorithm SHA256
# comparar com a linha do ficheiro em SHA256SUMS
```

## Opção 1 — Intune (recomendado: instalação silenciosa, zero avisos)

1. Empacotar o `.exe` com o `IntuneWinAppUtil` da Microsoft.
2. Intune admin center → **Apps** → **Windows** → **Add** → *Windows app (Win32)*.
3. Comando de instalação: `DocID_<versão>_x64-setup.exe /S`
   (testar numa máquina piloto antes de implementar; `/S` é o comando silencioso do NSIS).
4. Comando de desinstalação: `uninstall.exe /S`, criado pelo instalador NSIS na pasta de instalação.
5. Requisitos: Windows 10 1809+ / Windows 11, x64. Regras de deteção: ficheiro
   `DocID.exe` na pasta de instalação.
6. Atribuir ao grupo de dispositivos/utilizadores. Sendo implementado pelo Intune,
   o Windows não apresenta o SmartScreen ao utilizador.

## Opção 2 — Defender for Endpoint: permitir por hash (rápido)

1. `security.microsoft.com` → **Settings** → **Endpoints** → **Indicators**.
2. **Add indicator** → *File hash* → colar o SHA-256 acima → **Allow**.
3. Propaga-se aos dispositivos geridos em minutos.

**Limitação:** o hash muda a cada versão. Atualizar o indicador em cada release.

## Opção 3 — Pasta de rede de confiança (sem EDR)

Se o parque não tiver Intune/Defender for Endpoint:

1. Colocar o instalador num share interno (`\\servidor\software\docid\`).
2. GPO → *Computer Configuration → Policies → Windows Settings → Security Settings →
   Application Control Policies → AppLocker* → regra *Executable* que permita esse caminho.
3. Os utilizadores executam a partir do share, não de `Downloads`.

**Limitação:** regras por caminho não cobrem o instalador se for copiado para outro sítio;
preferir regra por hash (AppLocker também aceita *file hash*).

## Opção 4 — Sem infraestrutura de IT

No aviso do SmartScreen: **Mais informações** → **Executar mesmo assim**.
Um clique por versão, sem direitos de administrador (desde que a política não bloqueie).

**Se o botão “Executar mesmo assim” não aparecer**, não insista: uma das duas situações está ativa:

- o dispositivo tem **Smart App Control** ligado (Windows 11 22H2+), que bloqueia código
  não assinado sem opção de continuar — confirmar com o administrador;
- uma política corporativa do SmartScreen proíbe ultrapassar o aviso.

Nesses casos, encaminhar para a administração: ou aplicam a Opção 1/2, ou usam o pacote
MSIX da Microsoft Store (em preparação). A MilVendas não pode forçar este botão num
dispositivo gerido por outra organização.

## Atenção: Smart App Control

Em Windows 11 com **Smart App Control** ativo, ficheiros não assinados podem ser bloqueados
**sem botão “Executar mesmo assim”**. Nesses casos nenhuma das opções 3 e 4 funciona:
é preciso Intune/Defender, ou a versão assinada via Microsoft Store (em preparação).

## O que ainda não resolve

- O instalador não tem publisher verificado: mesmo com whitelist, o nome “MilVendas” não
  aparece como editor confirmado no Windows.
- Cada nova versão recomeca a reputação. Para reputação persistente é necessário
  certificado Authenticode OV (em avaliação).

---

Em caso de dúvida, enviar ao contacto habitual da MilVendas o hash calculado localmente
e o nome exato do aviso apresentado.
