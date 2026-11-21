# MSIX (POC)

Empacotamento MSIX do DocID para testar sideload e, mais tarde, submissão à Microsoft Store.

## Como gerar

Actions → **Build MSIX (POC)** → *Run workflow*. Produz `DocID.msix` e `DocID-POC.cer`.

## Instalar na máquina de teste (sideload)

Pacote pronto a testar: `https://docid.milvendas.ao/downloads/poc/DocID-MSIX-POC.zip`
(traz `DocID.msix`, `DocID-POC.cer`, `instalar-poc.ps1` e `LEIA-ME.txt`).

1. Extrair a pasta e executar `instalar-poc.ps1` em PowerShell **como Administrador**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\instalar-poc.ps1
   ```
   O script confia no certificado (`Cert:\LocalMachine\TrustedPeople`) e instala com `Add-AppxPackage`.
2. Se o Windows recusar por política, ativar **Instalar aplicações de forma arbitrária** em
   Definições → Sistema → Para programadores (o *Modo de programador* é alternativa, não é
   necessário nas edições que já permitem sideload por omissão, Windows 10 1803+).
3. Confirmar: `Get-AppxPackage MilVendas.DocID`.

## O que o POC tem de provar

- [ ] A app arranca dentro do contentor MSIX (full-trust).
- [ ] WebView2 arranca (vem do Edge do sistema, não do instalador de 223 MB).
- [ ] Login e chamadas a `https://didall.milvendas.ao` funcionam.
- [ ] Onde ficam os dados: `%LOCALAPPDATA%\Packages\MilVendas.DocID_*\LocalCache\...` — confirmar que a versão NSIS já instalada **não** vê os dados antigos.

## Limitações conhecidas deste POC

- Certificado auto-assinado, gerado a cada execução: cada build novo exige voltar a confiar no `.cer`.
- `Identity Name` e `Publisher` são de exemplo. Na Store têm de coincidir exatamente com
  Partner Center → Product management → **View app identity details**.
- Sem updater (a Store trata das atualizações). O NSIS continua a ser o canal fora da Store.
- Só x64, `MinVersion 10.0.17763.0` (Windows 10 1809+).
