import { redirect } from "next/navigation";
import { getWebsiteLocale } from "@/features/locale/server";

export default async function DocsRedirectPage() {
    const locale = await getWebsiteLocale();
    redirect(`/docs/${locale}`);
}
