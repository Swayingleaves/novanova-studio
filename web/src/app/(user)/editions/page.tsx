"use client";

import { useTranslation } from "@/features/locale/use-translation";
import { Layers3, Network } from "lucide-react";

import { ContactMe } from "./components/contact-me";

export default function EditionsPage() {
    const translate = useTranslation();
    const clusterFeatures = [
        { title: translate("editions.modularArchitecture"), description: translate("editions.modularArchitectureDescription") },
        { title: translate("editions.gatewayAccess"), description: translate("editions.gatewayAccessDescription") },
        { title: translate("editions.distributedMicroservices"), description: translate("editions.distributedMicroservicesDescription") },
        { title: translate("editions.clusterDeployment"), description: translate("editions.clusterDeploymentDescription") },
        { title: translate("editions.highConcurrency"), description: translate("editions.highConcurrencyDescription") },
        { title: translate("editions.containerDeployment"), description: translate("editions.containerDeploymentDescription") },
    ];
    return (
        <main className="studio-page h-full overflow-y-auto px-4 pb-12 pt-20 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">
                <header className="max-w-3xl border-b border-[var(--studio-line)] pb-6">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--studio-action)]">
                        <Layers3 className="size-4" aria-hidden="true" />
                        Novanova Studio Editions
                    </div>
                    <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--studio-ink)] sm:text-4xl">{translate("editions.chooseYourEdition")}</h1>
                </header>

                <section className="mt-8 overflow-hidden rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface)]" aria-labelledby="edition-title">
                    <h2 id="edition-title" className="sr-only">{translate("editions.editionsOverview")}</h2>
                    <article className="p-5 sm:p-6">
                        <div className="flex items-center gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--studio-primary-soft)] text-[var(--studio-action)]">
                                <Network className="size-[18px]" aria-hidden="true" />
                            </span>
                            <h3 className="text-base font-semibold text-[var(--studio-ink)]">{translate("editions.enterpriseCluster")}</h3>
                        </div>
                        <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--studio-text)]">
                            {clusterFeatures.map((feature) => (
                                <li key={feature.title}>
                                    <strong className="font-medium text-[var(--studio-ink)]">{feature.title}</strong>{" "}
                                    {feature.description}
                                </li>
                            ))}
                        </ul>
                    </article>
                </section>

                <ContactMe />
            </div>
        </main>
    );
}
