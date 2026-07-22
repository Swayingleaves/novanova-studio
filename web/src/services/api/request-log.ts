type ApiRequestMethod = "GET" | "POST";

export function logApiRequestParameters(scope: string, method: ApiRequestMethod, url: string, parameters?: unknown) {
    const parameterLabel = method === "GET" ? "URL参数" : "Body参数";
    const requestParameters = parameters ?? (method === "GET" ? readUrlParameters(url) : {});
    console.log(`[${scope}请求参数] ${method} URL=${safeRequestUrl(url)} ${parameterLabel}=${requestParameterJsonString(requestParameters)}`);
}

export function logApiResponseParameters(scope: string, method: ApiRequestMethod, url: string, parameters: unknown) {
    console.log(`[${scope}返回JSON] ${method} URL=${safeRequestUrl(url)} 返回JSON=${requestParameterJsonString(parameters)}`);
}

function requestParameterJsonString(value: unknown) {
    try {
        return JSON.stringify(toLogValue(value, new WeakSet<object>()));
    } catch {
        return JSON.stringify({ "序列化失败": true });
    }
}

function toLogValue(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "string") return summarizeString(value);
    if (!value || typeof value !== "object") return value;
    if (typeof File !== "undefined" && value instanceof File) return { "文件名": value.name, "类型": value.type, "字节数": value.size };
    if (typeof Blob !== "undefined" && value instanceof Blob) return { "类型": value.type, "字节数": value.size };
    if (typeof FormData !== "undefined" && value instanceof FormData) return formDataToLogValue(value, seen);
    if (seen.has(value)) return "[循环引用]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => toLogValue(item, seen));
    return recordToLogValue(value as Record<string, unknown>, seen);
}

function formDataToLogValue(formData: FormData, seen: WeakSet<object>) {
    const result: Record<string, unknown> = {};
    formData.forEach((value, key) => {
        appendLogValue(result, key, toLogValue(value, seen));
    });
    return result;
}

function recordToLogValue(record: Record<string, unknown>, seen: WeakSet<object>) {
    const result: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, value]) => {
        if (key === "data" && typeof value === "string" && hasMimeType(record)) {
            result[key] = summarizeBase64(value);
            return;
        }
        result[key] = toLogValue(value, seen);
    });
    return result;
}

function appendLogValue(target: Record<string, unknown>, key: string, value: unknown) {
    if (!(key in target)) {
        target[key] = value;
        return;
    }
    const current = target[key];
    target[key] = Array.isArray(current) ? [...current, value] : [current, value];
}

function readUrlParameters(url: string) {
    try {
        const parsedUrl = new URL(url, "http://local.invalid");
        return searchParametersToObject(parsedUrl.searchParams);
    } catch {
        const query = url.split("?")[1]?.split("#")[0] || "";
        return searchParametersToObject(new URLSearchParams(query));
    }
}

function searchParametersToObject(searchParameters: URLSearchParams) {
    const result: Record<string, string | string[]> = {};
    searchParameters.forEach((value, key) => appendLogValue(result, key, value));
    return result;
}

function safeRequestUrl(url: string) {
    try {
        const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(url);
        const parsedUrl = new URL(url, "http://local.invalid");
        parsedUrl.username = "";
        parsedUrl.password = "";
        parsedUrl.search = "";
        parsedUrl.hash = "";
        const value = parsedUrl.toString();
        return isAbsolute ? value : value.replace("http://local.invalid", "");
    } catch {
        return url.split("?")[0].split("#")[0];
    }
}

function summarizeString(value: string) {
    const dataUrlMatch = value.match(/^data:([^;,]+);base64,(.*)$/);
    if (dataUrlMatch) return `data:${dataUrlMatch[1]};base64,${summarizeBase64(dataUrlMatch[2])}`;
    return value;
}

function summarizeBase64(value: string) {
    return `<${estimateBase64Bytes(value)}B>`;
}

function estimateBase64Bytes(value: string) {
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function hasMimeType(record: Record<string, unknown>) {
    return typeof record.mimeType === "string" || typeof record.mime_type === "string";
}
