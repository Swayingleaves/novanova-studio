"use client";

import { useCallback, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { TranslationValues } from "next-intl";

/** 组件直接订阅语言，动作回调保持引用稳定，避免重启生成副作用。 */
export function useTranslation() {
    const translator = useTranslations();
    const locale = useLocale();
    const current = useRef(translator);
    current.current = translator;
    const translate = useCallback((key: string, values?: TranslationValues) => current.current(key, values), []);
    return Object.assign(translate, { locale });
}
