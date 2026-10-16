import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTranslator } from "next-intl";

const directory = fileURLToPath(new URL("./messages/", import.meta.url));
const load = (language) => Object.fromEntries(readdirSync(`${directory}/${language}`).map((file) => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(`${directory}/${language}/${file}`, "utf8"))]));

test("源文件使用的固定消息键都存在", () => {
    const messages = load("zh-cn");
    const source = fileURLToPath(new URL("../../", import.meta.url));
    const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
    for (const file of walk(source).filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."))) {
        for (const match of readFileSync(file, "utf8").matchAll(/translate\("([a-zA-Z][\w]*\.[\w]+)"/g)) {
            const [module, key] = match[1].split(".");
            assert.equal(typeof messages[module]?.[key], "string", `${file}: ${match[1]}`);
        }
    }
});

test("所有业务模块的中英文消息键和参数一致，消息能完成插值", () => {
    const chinese = load("zh-cn");
    const english = load("en");
    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
    const parameters = (text) => [...new Set(text.match(/value\d+/g) ?? [])].sort();
    for (const [module, messages] of Object.entries(chinese)) {
        assert.deepEqual(Object.keys(messages).sort(), Object.keys(english[module]).sort(), module);
        for (const [key, text] of Object.entries(messages)) {
            const path = `${module}.${key}`;
            assert.deepEqual(parameters(text), parameters(english[module][key]), path);
            for (const [locale, allMessages] of [["zh-CN", chinese], ["en", english]]) {
                const translate = createTranslator({ locale, messages: allMessages, onError(error) { throw error; } });
                const values = Object.fromEntries(parameters(text).map((parameter) => [parameter, 2]));
                assert.ok(translate(path, values).length > 0, path);
            }
        }
    }
});

test("英文节点计数使用正确的单复数", () => {
    const english = load("en");
    const translate = createTranslator({ locale: "en", messages: english });
    const key = Object.keys(english.canvas).find((key) => english.canvas[key] === "{value0, plural, one {# node} other {# nodes}}");
    assert.ok(key);
    assert.equal(translate(`canvas.${key}`, { value0: 1 }), "1 node");
    assert.equal(translate(`canvas.${key}`, { value0: 2 }), "2 nodes");
});

test("调用模板的双花括号占位符按原文显示", () => {
    const translate = createTranslator({ locale: "zh-CN", messages: load("zh-cn") });
    assert.equal(translate("appShell.modelNameUsedByTheRequestBodyPlaceholder"), "填入请求体{{model}}占位符使用的模型名");
});
