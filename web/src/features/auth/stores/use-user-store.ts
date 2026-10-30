"use client";

import type { CreditAmount } from "@/shared/lib/credit-amounts";

import { create } from "zustand";
import { authenticationPath } from "@/features/auth/lib/authentication-path";
import { parseSpacePath } from "@/features/team/space-path";

const USER_SESSION_KEY = "novanova:user_session:v1";

export type ServerUserRole = "user" | "admin";

export type ServerUserProfile = {
    id: number;
    email: string;
    username: string;
    nickname: string;
    avatar: string;
    role: ServerUserRole;
    status: number;
    creditBalance: CreditAmount;
    createdAt: string;
    lastLoginAt: string;
    welcomeRead: boolean;
    onboardingVersion: number;
    creationTourVersion: number;
    passwordLockedUntil: string | null;
    canResetPassword: boolean;
};

export type LocalUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    email: string;
    role: ServerUserRole;
    status: number;
    creditBalance: CreditAmount;
    welcomeRead: boolean;
    onboardingVersion: number;
    creationTourVersion: number;
};

export type UserSession = {
    token: string;
    expiresAt: string;
    user: LocalUser;
};

type UserStore = {
    hydrated: boolean;
    token: string;
    expiresAt: string;
    user: LocalUser | null;
    hydrateSession: () => void;
    setSession: (session: { token: string; expiresAt: string; user: ServerUserProfile }, authenticationRedirect?: string) => void;
    setUser: (user: ServerUserProfile) => void;
    setCreditBalance: (creditBalance: CreditAmount) => void;
    markWelcomeRead: () => void;
    markOnboardingCompleted: (version: number) => void;
    markCreationTourCompleted: (version: number) => void;
    clearSession: () => void;
    showAuthModal: boolean;
    pendingRedirect: string;
    authenticationRedirect: string;
    openAuthModal: (redirect?: string) => void;
    closeAuthModal: () => void;
};

export const useUserStore = create<UserStore>()((set, get) => ({
    hydrated: false,
    token: "",
    expiresAt: "",
    user: null,
    showAuthModal: false,
    pendingRedirect: "",
    authenticationRedirect: "",
    hydrateSession: () => {
        if (get().hydrated) return;
        const session = readStoredSession();
        if (!session || isExpired(session.expiresAt)) {
            removeStoredSession();
            set({ hydrated: true, token: "", expiresAt: "", user: null });
            return;
        }
        set({ hydrated: true, ...session });
    },
    setSession: (session, authenticationRedirect = "") => {
        const nextSession = { token: session.token, expiresAt: session.expiresAt, user: normalizeUser(session.user) };
        writeStoredSession(nextSession);
        set({ ...nextSession, authenticationRedirect });
    },
    setUser: (user) => {
        const current = get();
        const nextUser = normalizeUser(user);
        if (current.token) writeStoredSession({ token: current.token, expiresAt: current.expiresAt, user: nextUser });
        set({ user: nextUser });
    },
    setCreditBalance: (creditBalance) => {
        const current = get();
        if (!current.user || current.user.creditBalance === creditBalance) return;
        const user = { ...current.user, creditBalance };
        if (current.token) writeStoredSession({ token: current.token, expiresAt: current.expiresAt, user });
        set({ user });
    },
    markWelcomeRead: () => {
        const current = get();
        if (!current.user || current.user.welcomeRead) return;
        const user = { ...current.user, welcomeRead: true };
        if (current.token) writeStoredSession({ token: current.token, expiresAt: current.expiresAt, user });
        set({ user });
    },
    markOnboardingCompleted: (version) => {
        const current = get();
        if (!current.user || (current.user.onboardingVersion ?? 0) >= version) return;
        const user = { ...current.user, onboardingVersion: version };
        if (current.token) writeStoredSession({ token: current.token, expiresAt: current.expiresAt, user });
        set({ user });
    },
    markCreationTourCompleted: (version) => {
        const current = get();
        if (!current.user || (current.user.creationTourVersion ?? 0) >= version) return;
        const user = { ...current.user, creationTourVersion: version };
        if (current.token) writeStoredSession({ token: current.token, expiresAt: current.expiresAt, user });
        set({ user });
    },
    clearSession: () => {
        removeStoredSession();
        set({ token: "", expiresAt: "", user: null, hydrated: true, showAuthModal: false, pendingRedirect: "", authenticationRedirect: "" });
    },
    openAuthModal: (redirect) => {
        const teamSlug = typeof window === "undefined" ? null : parseSpacePath(window.location.pathname).teamSlug;
        if (teamSlug) {
            set({ showAuthModal: false, pendingRedirect: "" });
            window.location.assign(authenticationPath(teamSlug, redirect));
            return;
        }
        set({ showAuthModal: true, pendingRedirect: redirect || "" });
    },
    closeAuthModal: () => {
        set({ showAuthModal: false, pendingRedirect: "" });
    },
}));

export function getAuthToken() {
    const state = useUserStore.getState();
    if (state.token && !isExpired(state.expiresAt)) return state.token;
    if (state.token) {
        state.clearSession();
        return "";
    }
    const session = readStoredSession();
    if (!session || isExpired(session.expiresAt)) {
        removeStoredSession();
        return "";
    }
    return session.token;
}

function normalizeUser(user: ServerUserProfile): LocalUser {
    return {
        id: String(user.id),
        username: user.username || user.email,
        displayName: user.nickname || user.username || user.email,
        avatarUrl: user.avatar || "",
        email: user.email,
        role: user.role,
        status: user.status,
        creditBalance: user.creditBalance,
        welcomeRead: user.welcomeRead,
        onboardingVersion: user.onboardingVersion ?? 0,
        creationTourVersion: user.creationTourVersion ?? 0,
    };
}

function readStoredSession(): UserSession | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(USER_SESSION_KEY);
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<UserSession>;
        if (!value.token || !value.expiresAt || !value.user) return null;
        return value as UserSession;
    } catch {
        return null;
    }
}

function writeStoredSession(session: UserSession) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(USER_SESSION_KEY, JSON.stringify(session));
    } catch {
        // 浏览器禁用本地存储时，仅保留当前内存登录态。
    }
}

function removeStoredSession() {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(USER_SESSION_KEY);
    } catch {
        // 浏览器禁用本地存储时无需额外处理。
    }
}

function isExpired(expiresAt: string) {
    const time = Date.parse(expiresAt);
    return Number.isNaN(time) || time <= Date.now();
}
