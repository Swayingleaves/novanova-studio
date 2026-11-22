import { serverGet, serverPost } from "./server";

export type ClientDownloadSettings = {
    macIntelUrl: string | null;
    macAppleSiliconUrl: string | null;
    windowsUrl: string | null;
};

export const getClientDownloadSettings = () =>
    serverGet<ClientDownloadSettings>("/platform/getClientDownloadSettings", { auth: false });

export const saveClientDownloadSettings = (settings: ClientDownloadSettings) =>
    serverPost<ClientDownloadSettings>("/admin/platform/saveClientDownloadSettings", settings);
