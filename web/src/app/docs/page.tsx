import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { localeFromAcceptLanguage } from "@/features/docs/docs";

export default async function DocsRedirectPage() {
    const locale = localeFromAcceptLanguage((await headers()).get("accept-language"));
    redirect(`/docs/${locale}`);
}
