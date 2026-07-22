type AdminCreditUser = {
    username: string;
    nickname: string | null;
    email: string;
};

type AdminCreditFilters = {
    userId?: number;
    startDate: string;
    endDate: string;
    generationType?: "image" | "video";
};

/**
 * 获取管理员积分筛选的稳定查询键参数。
 *
 * @param filters 管理员积分筛选条件
 * @return 查询键参数
 */
export function adminCreditFilterKey(filters: AdminCreditFilters) {
    return [filters.userId ?? null, filters.startDate, filters.endDate, filters.generationType ?? null] as const;
}

/**
 * 获取管理员界面中的用户展示文案。
 *
 * @param user 用户基础信息
 * @return 用户展示文案
 */
export function adminCreditUserLabel(user: AdminCreditUser) {
    return user.nickname || user.username || user.email;
}
