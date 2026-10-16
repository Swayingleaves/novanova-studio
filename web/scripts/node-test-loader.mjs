import { stat, readFile } from "node:fs/promises";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolvePath(projectRoot, "src");
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx"];

/** 在原生测试中按ES模块读取项目JSON资源。 */
export async function load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".json")) {
        const source = await readFile(fileURLToPath(url), "utf8");
        return { format: "module", source: `export default ${source};`, shortCircuit: true };
    }
    return nextLoad(url, context);
}

/**
 * 解析Node原生测试不认识的项目路径别名和TypeScript本地导入。
 *
 * @param specifier string 导入说明符
 * @param context object Node加载上下文
 * @param nextResolve function Node默认解析器
 * @return Promise<object> 解析结果
 */
export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
        return resolveFile(pathToFileURL(resolvePath(sourceRoot, specifier.slice(2))).href);
    }

    try {
        return await nextResolve(specifier, context);
    } catch (error) {
        if (!isLocalSpecifier(specifier, context.parentURL)) throw error;
        const baseUrl = new URL(specifier, context.parentURL);
        return resolveFile(baseUrl.href);
    }
}

async function resolveFile(url) {
    const filePath = fileURLToPath(url);
    const candidates = extname(filePath)
        ? [filePath]
        : [filePath, ...sourceExtensions.map((extension) => `${filePath}${extension}`), ...sourceExtensions.map((extension) => resolvePath(filePath, `index${extension}`))];
    for (const candidate of candidates) {
        try {
            if (!(await stat(candidate)).isFile()) continue;
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
        } catch {
            // 继续尝试下一个本地扩展名。
        }
    }
    throw new Error(`找不到测试模块: ${filePath}`);
}

function isLocalSpecifier(specifier, parentUrl) {
    return (specifier.startsWith("./") || specifier.startsWith("../")) && Boolean(parentUrl?.startsWith("file:"));
}
