/** 认证页背景光柱；平台入口与团队入口（/team/<slug>/auth）共用，配色由主题变量决定。 */
export function AuthBackdrop() {
    return (
        <div className="auth-backdrop" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((index) => <div key={index} className={`auth-ray auth-ray-${index}`} />)}
        </div>
    );
}
