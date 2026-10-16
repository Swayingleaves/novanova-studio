"use client";

import { translateMessage as translate } from "@/features/locale/translate";
import { useTranslation } from "@/features/locale/use-translation";
import type { LucideIcon } from "lucide-react";
import { Check, Code2, Layers3, Minus, Network, Server } from "lucide-react";

import { ContactMe } from "./components/contact-me";


type EditionKey = "openSource" | "standaloneEnterprise" | "clusterEnterprise";

type Edition = {
    key: EditionKey;
    name: string;
    description: string;
    Icon: LucideIcon;
};

type Feature = {
    name: string;
    availability: Record<EditionKey, boolean>;
};

type FeatureGroup = {
    name: string;
    features: Feature[];
};

const createEditions = (translator: typeof translate = translate): Edition[] => ([
    {
        key: "openSource",
        get name() { return translator("editions.openSource"); },
        get description() { return translator("editions.forIndividualCreatorsAndTeamsThatDeployThemselves"); },
        Icon: Code2,
    },
    {
        key: "standaloneEnterprise",
        get name() { return translator("editions.enterpriseSingleInstance"); },
        get description() { return translator("editions.allOpenSourceFeaturesPlusEnterpriseBusinessGovernanceAnd"); },
        Icon: Server,
    },
    {
        key: "clusterEnterprise",
        get name() { return translator("editions.enterpriseCluster"); },
        get description() { return translator("editions.allSingleInstanceEnterpriseFeaturesPlusServiceSeparationAnd"); },
        Icon: Network,
    },
]);

const createFeatureGroups = (translator: typeof translate = translate): FeatureGroup[] => ([
    {
        get name() { return translator("editions.architectureDeployment"); },
        features: [
            {
                get name() { return translator("editions.distributedMicroservicesServiceSeparationAndKubernetesK8s"); },
                availability: { openSource: false, standaloneEnterprise: false, clusterEnterprise: true },
            },
        ],
    },
    {
        get name() { return translator("editions.commercialFeatures"); },
        features: [
            {
                get name() { return translator("editions.enhancedPayments"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
        ],
    },
    {
        get name() { return translator("editions.governanceOperations"); },
        features: [
            {
                get name() { return translator("editions.enhancedAuditLogs"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
            {
                get name() { return translator("editions.enhancedSecurity"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
            {
                get name() { return translator("editions.enhancedMonitoring"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
        ],
    },
    {
        get name() { return translator("editions.workflowsWorkspaces"); },
        features: [
            {
                get name() { return translator("editions.moreWorkflowSkills"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
            {
                get name() { return translator("editions.screenplayWorkspaceSeparateMenu"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
            {
                get name() { return translator("editions.comicWorkspaceSeparateMenu"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
        ],
    },
    {
        get name() { return translator("editions.businessOperations"); },
        features: [
            {
                get name() { return translator("editions.subscriptionPlans"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
        ],
    },
    {
        get name() { return translator("editions.support"); },
        features: [
            {
                get name() { return translator("editions.oneYearTechnicalSupport"); },
                availability: { openSource: false, standaloneEnterprise: true, clusterEnterprise: true },
            },
        ],
    },
]);

export default function EditionsPage() {
    const translate = useTranslation();
    return (
        <main className="studio-page h-full overflow-y-auto px-4 pb-12 pt-20 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-6xl">
                <header className="max-w-3xl border-b border-[var(--studio-line)] pb-6">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--studio-action)]">
                        <Layers3 className="size-4" aria-hidden="true" />
                        Novanova Studio Editions
                    </div>
                    <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[var(--studio-ink)] sm:text-4xl">{translate("editions.chooseYourEdition")}</h1>
                    <p className="mt-4 text-base leading-7 text-[var(--studio-text)]">
                        {translate("editions.bothEnterpriseEditionsIncludeOpenSourceFeaturesClusterAdds")}</p>
                </header>

                <section className="mt-8 overflow-hidden rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface)]" aria-labelledby="edition-overview-title">
                    <h2 id="edition-overview-title" className="sr-only">{translate("editions.editionsOverview")}</h2>
                    <div className="divide-y divide-[var(--studio-line)] md:grid md:grid-cols-3 md:divide-x md:divide-y-0">
                        {createEditions(translate).map(({ key, name, description, Icon }) => (
                            <article key={key} className="p-5 sm:p-6">
                                <div className="flex items-center gap-3">
                                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--studio-primary-soft)] text-[var(--studio-action)]">
                                        <Icon className="size-[18px]" aria-hidden="true" />
                                    </span>
                                    <h3 className="text-base font-semibold text-[var(--studio-ink)]">{name}</h3>
                                </div>
                                <p className="mt-4 text-sm leading-6 text-[var(--studio-muted)]">{description}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="mt-10" aria-labelledby="edition-comparison-title">
                    <div className="mb-5">
                        <h2 id="edition-comparison-title" className="text-xl font-semibold text-[var(--studio-ink)]">{translate("editions.compareEnterpriseFeatures")}</h2>
                        <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">{translate("editions.enterpriseAdditionsRelativeToOpenSource")}</p>
                    </div>

                    <DesktopComparisonTable />
                    <MobileComparisonList />
                </section>

                <ContactMe />
            </div>
        </main>
    );
}

function DesktopComparisonTable() {
    const translate = useTranslation();
    return (
        <div className="hidden overflow-hidden rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface)] md:block">
            <table className="w-full table-fixed border-collapse text-sm">
                <caption className="sr-only">{translate("editions.compareOpenSourceSingleInstanceAndClusterEditions")}</caption>
                <thead className="bg-[var(--studio-surface-raised)] text-[var(--studio-ink)]">
                    <tr>
                        <th scope="col" className="w-[40%] px-5 py-4 text-left font-semibold">{translate("editions.features")}</th>
                        {createEditions(translate).map((edition) => (
                            <th key={edition.key} scope="col" className="w-[20%] border-l border-[var(--studio-line)] px-3 py-4 text-center font-semibold">
                                {edition.name}
                            </th>
                        ))}
                    </tr>
                </thead>
                {createFeatureGroups(translate).map((group) => (
                    <FeatureGroupRows key={group.name} group={group} />
                ))}
            </table>
        </div>
    );
}

function FeatureGroupRows({ group }: { group: FeatureGroup }) {
    const translate = useTranslation();
    return (
        <tbody>
            <tr className="border-t border-[var(--studio-line-strong)] bg-[var(--studio-surface-soft)]">
                <th scope="rowgroup" colSpan={4} className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.12em] text-[var(--studio-muted)]">
                    {group.name}
                </th>
            </tr>
            {group.features.map((feature) => (
                <tr key={feature.name} className="border-t border-[var(--studio-line)]">
                    <th scope="row" className="px-5 py-4 text-left font-medium leading-6 text-[var(--studio-text)]">
                        {feature.name}
                    </th>
                    {createEditions(translate).map((edition) => (
                        <td key={edition.key} className="border-l border-[var(--studio-line)] px-3 py-4 text-center">
                            <FeatureAvailabilityStatus supported={feature.availability[edition.key]} />
                        </td>
                    ))}
                </tr>
            ))}
        </tbody>
    );
}

function MobileComparisonList() {
    const translate = useTranslation();
    return (
        <div className="space-y-5 md:hidden">
            {createFeatureGroups(translate).map((group) => (
                <section key={group.name} className="overflow-hidden rounded-lg border border-[var(--studio-line-strong)] bg-[var(--studio-surface)]" aria-labelledby={`mobile-${group.name}`}>
                    <h3 id={`mobile-${group.name}`} className="bg-[var(--studio-surface-raised)] px-4 py-3 text-sm font-semibold text-[var(--studio-ink)]">
                        {group.name}
                    </h3>
                    <div className="divide-y divide-[var(--studio-line)]">
                        {group.features.map((feature) => (
                            <article key={feature.name} className="p-4">
                                <h4 className="text-sm font-medium leading-6 text-[var(--studio-ink)]">{feature.name}</h4>
                                <dl className="mt-3 space-y-2">
                                    {createEditions(translate).map((edition) => (
                                        <div key={edition.key} className="flex min-w-0 items-center justify-between gap-4">
                                            <dt className="text-sm text-[var(--studio-muted)]">{edition.name}</dt>
                                            <dd className="shrink-0">
                                                <FeatureAvailabilityStatus supported={feature.availability[edition.key]} />
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </article>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function FeatureAvailabilityStatus({ supported }: { supported: boolean }) {
    const translate = useTranslation();
    return supported ? (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-[var(--studio-success)]">
            <Check className="size-4" aria-hidden="true" />
            {translate("editions.supported")}</span>
    ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-[var(--studio-muted)]">
            <Minus className="size-4" aria-hidden="true" />
            {translate("editions.excludes")}</span>
    );
}
