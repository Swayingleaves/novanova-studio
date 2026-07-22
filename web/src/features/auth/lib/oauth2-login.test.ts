import assert from "node:assert/strict";
import test from "node:test";

import { oauth2ErrorMessage, safeAuthRedirect } from "./oauth2-login.ts";

test("safeAuthRedirect 只允许非认证页面的站内路径", () => {
    assert.equal(safeAuthRedirect("/image?model=test"), "/image?model=test");
    assert.equal(safeAuthRedirect("https://example.com"), "/");
    assert.equal(safeAuthRedirect("//example.com/path"), "/");
    assert.equal(safeAuthRedirect("/\\example.com/path"), "/");
    assert.equal(safeAuthRedirect("/auth/oauthCallback"), "/");
    assert.equal(safeAuthRedirect(null), "/");
});

test("oauth2ErrorMessage 只暴露固定中文错误信息", () => {
    assert.equal(oauth2ErrorMessage("accessDenied"), "你已取消第三方平台授权。");
    assert.equal(oauth2ErrorMessage("emailUnverified"), "第三方账号邮箱尚未验证，无法完成登录。");
    assert.equal(oauth2ErrorMessage("unknown"), "OAuth2登录失败，请重新尝试。");
});
