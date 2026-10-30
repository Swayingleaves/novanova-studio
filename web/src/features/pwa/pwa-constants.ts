/**
 * PWA 运行时路径常量（无 "use client"：服务端 layout 与客户端组件均可直接读取字面量）。
 *
 * 这些路径必须与 `scripts/generate-pwa.mjs` 生成的产物位置一致：
 * - generate-pwa.mjs 从 next.config.ts 解析 basePath 并校验本文件常量与其一致；
 * - 修改部署子路径时需同步调整两处，否则 SW scope 会错位。
 */

/** 部署 base 路径（须与 next.config.ts 的 basePath 一致） */
export const PWA_BASE_PATH = "/";

/** Service Worker 脚本路径（相对 origin） */
export const PWA_SW_PATH = "/novanova-sw.js";

/** SW 注册 scope（须与 manifest 的 scope 一致） */
export const PWA_SCOPE = "/";

/** manifest 中 start_url 携带的桌面图标启动标记参数名 */
export const PWA_LAUNCH_PARAM = "pwa-launch";
