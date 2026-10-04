export default function TermsContent() {
  return (
    <div className="space-y-6 text-sm text-docid-text">
      <div>
        <h2 className="mb-2 text-lg font-bold">Termos e Condições de Uso — DocID</h2>
        <p className="text-xs text-docid-muted">Última actualização: 4 de Outubro de 2026</p>
      </div>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">1. Introdução e Aceitação</h3>
        <p className="text-docid-muted">
          Estes Termos e Condições de Uso ("Termos") regulam o acesso e a utilização da plataforma DocID
          ("Plataforma", "Serviço"), incluindo a aplicação desktop, os componentes de sincronização, a API
          e quaisquer serviços associados, desenvolvidos e operados pela VeranoLabs ("nós", "nossa empresa").
        </p>
        <p className="mt-2 text-docid-muted">
          Ao criar uma conta, instalar a aplicação desktop ou utilizar o Serviço em nome de uma organização
          ("Cliente", "Organização", "Tenant"), o utilizador declara ter lido, compreendido e aceite estes
          Termos, em nome próprio e, se aplicável, em representação da Organização que o autorizou a agir.
          Se não concordar com algum destes Termos, não deve utilizar o Serviço.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">2. Definições</h3>
        <ul className="list-disc space-y-1 pl-5 text-docid-muted">
          <li><strong>Tenant/Organização:</strong> entidade empresarial que subscreve o Serviço e cujos dados são isolados logicamente das restantes organizações.</li>
          <li><strong>Utilizador:</strong> pessoa singular com uma conta activa associada a um Tenant.</li>
          <li><strong>Sector:</strong> unidade organizacional interna do Tenant à qual são atribuídas permissões (RBAC) e visibilidade de documentos.</li>
          <li><strong>Identificador Fiscalmente Válido:</strong> número sequencial e cronológico atribuído a documentos de categorias fiscais (ex.: Factura, Recibo, Nota de Crédito/Débito), em conformidade com o Decreto Presidencial n.º 292/18 e o Decreto Presidencial n.º 71/25.</li>
          <li><strong>Dispositivo:</strong> computador ou equipamento onde a aplicação desktop está instalada e registada junto de um Tenant.</li>
          <li><strong>Documento:</strong> qualquer ficheiro, registo ou identificador criado, digitalizado, importado ou processado através do Serviço.</li>
        </ul>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">3. Objecto do Serviço</h3>
        <p className="text-docid-muted">
          O DocID é uma plataforma de gestão de documentos empresariais que fornece, entre outras funcionalidades:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-docid-muted">
          <li>Multi-tenancy com isolamento de dados reforçado ao nível da base de dados;</li>
          <li>Geração de identificadores fiscalmente válidos, incluindo em modo offline;</li>
          <li>Sincronização automática de documentos e identificadores gerados sem ligação à internet;</li>
          <li>Vigilância de pastas locais para detecção de identificadores em ficheiros;</li>
          <li>Integração com scanner para digitalização de documentos físicos;</li>
          <li>Classificação de documentos assistida por Inteligência Artificial;</li>
          <li>Controlo de acesso baseado em papéis (RBAC) e por sector;</li>
          <li>Registo de auditoria das acções realizadas na Plataforma.</li>
        </ul>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">4. Contas, Registo e Segurança de Acesso</h3>
        <p className="text-docid-muted">
          4.1. O acesso ao Serviço depende da criação de uma conta associada a um Tenant e de credenciais de autenticação válidas.
        </p>
        <p className="mt-2 text-docid-muted">
          4.2. O Utilizador é responsável por manter a confidencialidade das suas credenciais e por todas as actividades realizadas através da sua conta.
        </p>
        <p className="mt-2 text-docid-muted">
          4.3. O Utilizador compromete-se a notificar-nos de imediato em caso de suspeita de acesso não autorizado à sua conta ou a um Dispositivo registado.
        </p>
        <p className="mt-2 text-docid-muted">
          4.4. Os administradores da Organização (ORG_ADMIN) são responsáveis pela correcta atribuição de papéis, sectores e permissões aos demais Utilizadores, bem como pela gestão dos pedidos de acesso a documentos restritos.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">5. Licença de Uso</h3>
        <p className="text-docid-muted">
          Sujeito ao cumprimento destes Termos e ao pagamento de quaisquer valores devidos, concedemos ao Cliente uma licença limitada, não exclusiva, intransmissível e revogável para utilizar o Serviço exclusivamente para fins internos da sua actividade empresarial, durante o período de subscrição contratado.
        </p>
        <p className="mt-2 text-docid-muted">
          Esta licença não inclui o direito de: (a) revender, sublicenciar ou disponibilizar o Serviço a terceiros; (b) realizar engenharia inversa, descompilar ou tentar extrair o código-fonte da aplicação, salvo nos casos permitidos por lei imperativa; (c) utilizar o Serviço para fins ilícitos ou em violação destes Termos.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">6. Geração e Responsabilidade sobre Identificadores Fiscais</h3>
        <p className="text-docid-muted">
          6.1. O DocID disponibiliza um mecanismo técnico de geração de identificadores fiscalmente válidos, incluindo em modo offline, através da reserva antecipada de lotes de sequência por Dispositivo, com o objectivo de assegurar a numeração sequencial e cronológica exigida pela legislação angolana aplicável.
        </p>
        <p className="mt-2 text-docid-muted">
          6.2. Não obstante o mecanismo técnico disponibilizado, <strong>a responsabilidade legal e fiscal pela correcta emissão, numeração e utilização dos documentos fiscais perante a Administração Geral Tributária (AGT) e demais autoridades competentes é exclusivamente do Cliente</strong>, enquanto entidade emitente dos documentos.
        </p>
        <p className="mt-2 text-docid-muted">
          6.3. Uma vez libertado, um identificador de sequência fiscal é considerado permanentemente utilizado, não sendo reatribuído a outro documento, mesmo em caso de cancelamento, erro ou falha de sincronização — sendo da responsabilidade do Cliente adoptar os procedimentos de correcção fiscalmente apropriados (ex.: nota de crédito/débito) nesses casos.
        </p>
        <p className="mt-2 text-docid-muted">
          6.4. O Cliente reconhece que a atribuição de lotes de sequência a Dispositivos e a sincronização destes com o servidor central dependem de configurações correctamente mantidas pelo Cliente (ex.: registo e gestão de dispositivos, dimensão dos lotes), e que o uso indevido destas configurações pode originar inconsistências pelas quais o Cliente é responsável.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">7. Classificação de Documentos por Inteligência Artificial</h3>
        <p className="text-docid-muted">
          7.1. O Serviço pode sugerir automaticamente a categoria de um documento com recurso a um modelo de IA fornecido por um prestador terceiro. Esta sugestão constitui um auxílio à decisão e não substitui a verificação humana.
        </p>
        <p className="mt-2 text-docid-muted">
          7.2. O Cliente e os seus Utilizadores mantêm sempre a responsabilidade final pela categorização, tratamento e arquivo correcto dos documentos, independentemente da sugestão gerada pela IA.
        </p>
        <p className="mt-2 text-docid-muted">
          7.3. Informações adicionais sobre o tratamento de dados no âmbito desta funcionalidade constam da nossa Política de Privacidade.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">8. Vigilância de Pastas e Digitalização</h3>
        <p className="text-docid-muted">
          O Utilizador reconhece que a funcionalidade de vigilância automática de pastas processa localmente o conteúdo de ficheiros existentes nas pastas monitorizadas para fins de extracção e detecção de identificadores, e é responsável por assegurar que apenas monitoriza pastas cujo conteúdo está autorizado a processar.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">9. Obrigações do Cliente e dos Utilizadores</h3>
        <p className="text-docid-muted">O Cliente e os seus Utilizadores comprometem-se a:</p>
        <ul className="list-disc space-y-1 pl-5 text-docid-muted">
          <li>Utilizar o Serviço em conformidade com a lei aplicável e com estes Termos;</li>
          <li>Não carregar, processar ou distribuir através do Serviço conteúdo ilícito, fraudulento ou que viole direitos de terceiros;</li>
          <li>Não tentar contornar os mecanismos de isolamento entre Tenants, RBAC ou auditoria;</li>
          <li>Assegurar a exactidão dos dados inseridos na Plataforma, incluindo dados fiscais e de identificação de documentos;</li>
          <li>Cumprir as obrigações legais aplicáveis em matéria fiscal, contabilística e de protecção de dados pessoais relativamente aos documentos que gere através do Serviço.</li>
        </ul>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">10. Propriedade Intelectual</h3>
        <p className="text-docid-muted">
          O Serviço, incluindo o seu código, design, marca, documentação e demais elementos, é propriedade da VeranoLabs ou dos seus licenciantes, encontrando-se protegido pelas leis de propriedade intelectual aplicáveis. Nenhuma disposição destes Termos transfere para o Cliente qualquer direito de propriedade sobre o Serviço, com excepção da licença de uso concedida na secção 5.
        </p>
        <p className="mt-2 text-docid-muted">
          Os Documentos e demais conteúdos carregados pelo Cliente permanecem propriedade do Cliente. Concedemos ao Cliente o direito de exportar os seus dados, sujeito a limites técnicos e de utilização razoável definidos na Plataforma.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">11. Disponibilidade do Serviço</h3>
        <p className="text-docid-muted">
          Envidamos esforços comercialmente razoáveis para manter o Serviço disponível e operacional, mas não garantimos disponibilidade ininterrupta. Poderão ocorrer períodos de indisponibilidade para manutenção, actualização ou por motivos alheios ao nosso controlo. A funcionalidade offline-first foi desenhada precisamente para mitigar o impacto de indisponibilidade de rede no lado do Cliente, mas não elimina totalmente os riscos associados a falhas técnicas.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">12. Limitação de Responsabilidade</h3>
        <p className="text-docid-muted">
          Na máxima medida permitida por lei, a VeranoLabs não será responsável por danos indirectos, lucros cessantes, perda de dados resultante de utilização indevida do Serviço pelo Cliente, ou por incumprimentos fiscais decorrentes de uso incorrecto da Plataforma pelo Cliente ou seus Utilizadores.
        </p>
        <p className="mt-2 text-docid-muted">
          Nada nestes Termos exclui ou limita responsabilidade que não possa ser legalmente excluída ou limitada.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">13. Suspensão e Rescisão</h3>
        <p className="text-docid-muted">
          13.1. Podemos suspender ou encerrar o acesso de um Cliente ou Utilizador que viole materialmente estes Termos, mediante notificação prévia sempre que razoavelmente possível.
        </p>
        <p className="mt-2 text-docid-muted">
          13.2. O Cliente pode cessar a utilização do Serviço nos termos do respectivo contrato de subscrição.
        </p>
        <p className="mt-2 text-docid-muted">
          13.3. Após a cessação, o Cliente poderá solicitar a exportação dos seus dados dentro do prazo definido no contrato aplicável, findo o qual os dados poderão ser eliminados de acordo com a nossa política de retenção.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">14. Alterações aos Termos</h3>
        <p className="text-docid-muted">
          Podemos actualizar estes Termos periodicamente. As alterações materiais serão comunicadas ao Cliente com antecedência razoável. A utilização continuada do Serviço após a entrada em vigor das alterações implica a aceitação dos novos Termos.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">15. Lei Aplicável e Foro</h3>
        <p className="text-docid-muted">
          Estes Termos são regidos pela lei angolana. Para a resolução de qualquer litígio emergente destes Termos, é competente o foro da comarca de Luanda, com renúncia expressa a qualquer outro.
        </p>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-docid-text">16. Contactos</h3>
        <p className="text-docid-muted">
          Para questões relacionadas com estes Termos, contacte-nos através de: nzilalabs@gmail.com.
        </p>
      </section>

      <div className="border-t border-docid-border pt-4 text-xs text-docid-muted">
        <p>
          Este documento é um modelo base e deve ser revisto por um jurista antes da sua publicação e
          entrada em vigor, de forma a assegurar plena conformidade com a legislação angolana aplicável,
          incluindo em matéria fiscal e de protecção de dados pessoais.
        </p>
      </div>
    </div>
  );
}
