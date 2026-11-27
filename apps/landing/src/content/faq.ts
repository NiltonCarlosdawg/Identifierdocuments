/**
 * Perguntas frequentes da landing. Fonte única: o componente Faq mostra-as e o
 * vite.config.ts gera a partir delas o JSON-LD (FAQPage) do index.html, que é o que o
 * Google lê. Antes havia uma cópia à mão no index.html, que ficou desactualizada.
 */
export type FaqItem = { q: string; a: string };

export const FAQ: FaqItem[] = [
  {
    q: "Preciso de internet para usar o DocID?",
    a: "Só para entrar pela primeira vez e para sincronizar. Sem rede, a aplicação continua a gerar identificadores (incluindo a numeração das facturas), anexar e consultar documentos; quando a ligação volta envia tudo sozinha, sem números duplicados entre computadores.",
  },
  {
    q: "Onde ficam os dados da minha empresa?",
    a: "Na base de dados da organização, com cada registo separado por organização. Cada pedido é autenticado e limitado à organização a que pertence.",
  },
  {
    q: "Quantas pessoas podem usar?",
    a: "Depende do plano: 3, 10 ou 30 utilizadores. O período de teste gratuito de 14 dias permite até 5 utilizadores.",
  },
  {
    q: "Funciona em Mac ou Linux?",
    a: "Sim, em Linux: há um pacote .deb para Ubuntu 22.04 e compatíveis (64 bits). No Windows 10 e 11, 64 bits, há o instalador normal e um instalador completo para instalar sem internet. A versão para macOS está em preparação e será publicada na mesma página.",
  },
  {
    q: "Como actualizo a aplicação?",
    a: "A aplicação verifica actualizações ao arrancar e instala a versão mais recente. Também pode descarregar o instalador por cima da versão antiga: os dados ficam no servidor e a sessão mantém-se.",
  },
  {
    q: "O que é um identificador DocID?",
    a: "Um código único com o prefixo da organização, a categoria, a data de emissão e um número de série. Por exemplo, VL-PROP-2026-1118-001: organização VL, categoria Propostas, emitido a 18 de Novembro de 2026, número 1 da série de propostas.",
  },
];
