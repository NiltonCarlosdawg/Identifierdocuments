# MSIX (POC)

Empacotamento MSIX do DocID para testar sideload e, mais tarde, submissão à Microsoft Store.

## Como gerar

Actions → **Build MSIX (POC)** → *Run workflow*. Produz `DocID.msix` e `DocID-POC.cer`.

## Instalar na máquina de teste (sideload)

1. Copiar `DocID-POC.cer` e `DocID.msix` para a máquina.
2. Confiar no certificado (o MSIX auto-assinado não instala sem isto):
   ```powershell
   Import-Certificate -FilePath .\DocID-POC.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
   ```
   (pede admin; alternativa: duplo clique → *Instalar certificado* → *Autoridades de confiança de raiz*)
3. Ativar sideload: Definições → Sistema → Para programadores → **Modo de programador** (ou `Settings > Apps > Advanced app settings`).
4. Duplo clique no `DocID.msix` → *Instalar*.

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
