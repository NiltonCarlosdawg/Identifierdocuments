import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { FAQ } from "./src/content/faq";

// Gera o JSON-LD FAQPage do index.html a partir das mesmas perguntas que a página mostra.
const faqJsonLd = {
  name: "faq-jsonld",
  transformIndexHtml(html: string) {
    const faq = {
      "@type": "FAQPage",
      "@id": "https://docid.milvendas.ao/#faq",
      mainEntity: FAQ.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    };
    if (!html.includes('"__FAQ_JSONLD__"')) throw new Error("index.html sem o marcador __FAQ_JSONLD__");
    return html.replace('"__FAQ_JSONLD__"', JSON.stringify(faq, null, 2).replace(/\n/g, "\n          "));
  },
};

export default defineConfig({
  plugins: [react(), faqJsonLd],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", assetsInlineLimit: 2048 },
});
