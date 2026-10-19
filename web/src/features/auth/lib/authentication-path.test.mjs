import assert from "node:assert/strict";
import { test } from "node:test";
import { authenticationPath, resolveAuthenticationRedirect } from "./authentication-path.ts";
import { isAuthenticationPath, parseSpacePath, pathInSpace } from "../../team/space-path.ts";

test("平台与团队入口由 URL 唯一确定，认证路径复用既有页面", () => {
    assert.deepEqual(parseSpacePath("/auth"), { teamSlug: null, pathname: "/auth" });
    assert.deepEqual(parseSpacePath("/"), { teamSlug: null, pathname: "/" });
    assert.deepEqual(parseSpacePath("/team/team1/auth?redirect=%2Fimage"), { teamSlug: "team1", pathname: "/auth" });
    assert.deepEqual(parseSpacePath("/team/team1"), { teamSlug: "team1", pathname: "/" });
    assert.deepEqual(parseSpacePath("/team/team1/"), { teamSlug: "team1", pathname: "/" });
    assert.equal(isAuthenticationPath("/team/team1/auth/resetPassword?token=test"), true);
    assert.equal(isAuthenticationPath("/team/team1/image"), false);
    assert.equal(pathInSpace("/auth/forgotPassword", "team1"), "/team/team1/auth/forgotPassword");
    assert.equal(pathInSpace("/team/team2/auth", "team1"), "/team/team2/auth");
    assert.equal(pathInSpace("/teams", "team1"), "/teams");
});

test("团队登录默认回本团队首页，完整保留合法目标参数和片段", () => {
    assert.equal(resolveAuthenticationRedirect(null, null), "/");
    assert.equal(resolveAuthenticationRedirect(null, "team1"), "/team/team1");
    assert.equal(resolveAuthenticationRedirect("", "team2"), "/team/team2");
    assert.equal(resolveAuthenticationRedirect("/image?initialPrompt=%E4%B8%AD%E6%96%87%26test#node1", "team1"), "/team/team1/image?initialPrompt=%E4%B8%AD%E6%96%87%26test#node1");
    assert.equal(resolveAuthenticationRedirect("/team/team1/image?model=x", "team1"), "/team/team1/image?model=x");
    assert.equal(resolveAuthenticationRedirect("/team/team1/image", null), "/team/team1/image");
    assert.equal(authenticationPath("team1"), "/team/team1/auth");
    const login = new URL(authenticationPath("team1", "/image?initialPrompt=%E4%B8%AD%E6%96%87"), "https://example.com");
    assert.equal(login.pathname, "/team/team1/auth");
    assert.equal(login.searchParams.get("redirect"), "/team/team1/image?initialPrompt=%E4%B8%AD%E6%96%87");
});

test("登录目标拒绝外站、跨团队和认证循环，不自动改用平台目标", () => {
    for (const target of ["https://example.com", "//example.com", "/\\example.com", "/%2f%2fexample.com", "/%5cexample.com", "/image\n", "/auth", "/auth/forgotPassword", "/team/team1/auth", "/team/team1/auth/oauthCallback", "/team/team2/image", "/team/team1/../team2/image", "/%61uth", "/team/team1/%61uth", "/team/team1//auth", "/team/team1/.%2fauth", "/image/%invalid", "/docs/zh-cn", "/teams"]) {
        assert.throws(() => resolveAuthenticationRedirect(target, "team1"), undefined, target);
    }
});
