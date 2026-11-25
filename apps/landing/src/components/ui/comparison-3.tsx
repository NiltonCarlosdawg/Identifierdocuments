import * as React from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiArrowRightLine,
  RiSparkling2Line,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type CellValue = boolean | string;

type Feature = {
  label: string;
  values: [CellValue, CellValue, CellValue];
};

type FeatureGroup = {
  section: string;
  features: Feature[];
};

const plans = [
  { name: "Essencial", price: "50.000 Kz", cadence: "Por mês", highlighted: false },
  { name: "Profissional", price: "100.000 Kz", cadence: "Por mês", highlighted: true },
  { name: "Empresarial", price: "250.000 Kz", cadence: "Por mês", highlighted: false },
] as const;

const groups: FeatureGroup[] = [
  {
    section: "Essencial do dia a dia",
    features: [
      { label: "Utilizadores incluídos", values: ["3", "10", "30"] },
      { label: "Identificadores por mês", values: ["100", "500", "2.000"] },
      { label: "Partilha de documentos", values: [true, true, true] },
      { label: "Pedidos de acesso", values: [true, true, true] },
    ],
  },
  {
    section: "Equipa e organização",
    features: [
      { label: "Tipos de acesso", values: ["Básicos", "Avançados", "Personalizados"] },
      { label: "Convites por e-mail", values: [true, true, true] },
      { label: "Configuração assistida", values: [false, true, true] },
      { label: "Gestor de conta dedicado", values: [false, false, true] },
    ],
  },
  {
    section: "Apoio",
    features: [
      { label: "Tempo de resposta", values: ["Comunidade", "Até 24 h", "Até 1 h"] },
      { label: "Atendimento prioritário", values: [false, true, true] },
      { label: "Acompanhamento mensal", values: [false, false, true] },
    ],
  },
];

function Cell({ value, highlighted }: { value: CellValue; highlighted: boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <span
        className={cn(
          "mx-auto flex size-5 items-center justify-center",
          highlighted ? "bg-primary" : "bg-foreground/80",
        )}
      >
        <RiCheckLine
          className={cn("size-3.5", highlighted ? "text-primary-foreground" : "text-background")}
          aria-hidden
        />
        <span className="sr-only">Incluído</span>
      </span>
    ) : (
      <span className="mx-auto flex size-5 items-center justify-center bg-muted">
        <RiCloseLine className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">Não incluído</span>
      </span>
    );
  }
  return (
    <span className={cn("text-sm font-medium", highlighted ? "text-foreground" : "text-muted-foreground")}>
      {value}
    </span>
  );
}

export default function ComparisonBlock() {
  return (
    <section className="flex w-full justify-center bg-background px-6 py-10 text-foreground">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 max-w-2xl">
          <Badge variant="outline" className="mb-4">
            <RiSparkling2Line data-icon="inline-start" />
            Compare os planos
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Encontre o plano certo para a sua equipa
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Veja o que cada plano inclui e escolha o que acompanha o crescimento da sua organização.
          </p>
        </div>

        <div className="relative">
          <Badge
            variant="default"
            className="absolute bottom-full left-[68%] z-20 mb-2 -translate-x-1/2"
          >
            Mais escolhido
          </Badge>
          <div className="overflow-x-auto border border-border">
            <Table className="table-fixed text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky top-0 z-20 w-[36%] border-b border-border bg-background align-bottom">
                    <span className="inline-block pb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                      Funcionalidades
                    </span>
                  </TableHead>
                  {plans.map((plan) => (
                    <TableHead
                      key={plan.name}
                      className={cn(
                        "sticky top-0 z-20 border-b border-border text-center align-bottom",
                        plan.highlighted ? "bg-primary/5" : "bg-background",
                      )}
                    >
                      <div className="flex flex-col items-center gap-1 py-3">
                        <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                        <span className="text-lg font-bold text-foreground">{plan.price}</span>
                        <span className="text-xs font-normal text-muted-foreground">{plan.cadence}</span>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody>
                {groups.map((group) => (
                  <React.Fragment key={group.section}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell
                        colSpan={4}
                        className="py-2 text-xs font-semibold tracking-wide text-foreground uppercase"
                      >
                        {group.section}
                      </TableCell>
                    </TableRow>
                    {group.features.map((feature) => (
                      <TableRow key={`${group.section}-${feature.label}`}>
                        <TableCell className="py-2.5 font-medium text-foreground">{feature.label}</TableCell>
                        {feature.values.map((value, i) => (
                          <TableCell
                            key={`${feature.label}-${plans[i].name}`}
                            className={cn("py-2.5 text-center", plans[i].highlighted && "bg-primary/5")}
                          >
                            <Cell value={value} highlighted={plans[i].highlighted} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}

                <TableRow className="hover:bg-transparent">
                  <TableCell className="py-4" />
                  {plans.map((plan) => (
                    <TableCell
                      key={`cta-${plan.name}`}
                      className={cn("py-4 text-center", plan.highlighted && "bg-primary/5")}
                    >
                      <Button
                        asChild
                        size="sm"
                        variant={plan.highlighted ? "default" : "secondary"}
                        className="w-full"
                      >
                        <a href={plan.name === "Empresarial" ? "mailto:geralverano@verano.sbs" : "#pedido"}>
                          {plan.name === "Empresarial" ? "Falar com a equipa" : "Escolher"}
                          <RiArrowRightLine data-icon="inline-end" />
                        </a>
                      </Button>
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </section>
  );
}
