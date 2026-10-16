"use client";

import { create } from "zustand";
import { languageCookieMaxAge, languageCookieName, languageTag, type WebsiteLocale } from "./locale";

/** 保存语言偏好，不刷新页面或重新挂载业务组件。 */
export const useLanguageStore = create<{ locale: WebsiteLocale | null; setLocale: (locale: WebsiteLocale) => void }>((set) => ({
    locale: null,
    setLocale(locale) {
        document.cookie = `${languageCookieName}=${locale}; Path=/; Max-Age=${languageCookieMaxAge}; SameSite=Lax`;
        document.documentElement.lang = languageTag(locale);
        document.documentElement.dataset.language = locale;
        set({ locale });
    },
}));
