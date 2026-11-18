import { Nav } from "@/components/sections/Nav";
import { Hero } from "@/components/sections/Hero";
import { Product } from "@/components/sections/Product";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Security } from "@/components/sections/Security";
import { Faq } from "@/components/sections/Faq";
import { DownloadSection } from "@/components/ui/download-section";
import { Footer } from "@/components/sections/Footer";

export default function App() {
  return (
    <div className="min-h-screen bg-docid-bg">
      <a href="#main" className="skip-link">
        Saltar para o conteúdo
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Product />
        <Features />
        <HowItWorks />
        <Security />
        <Faq />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  );
}
