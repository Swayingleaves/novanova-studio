import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";

const root = path.resolve(process.cwd(), "../docs");
const locales = ["zh-cn", "en"];
const files = (locale) => walk(path.join(root, locale)).filter((file) => file.endsWith(".mdx") || file.endsWith(".md"));
const slugs = (locale) => files(locale).map((file) => path.relative(path.join(root, locale), file).replace(/\\/g, "/").replace(/\.(mdx|md)$/, "").replace(/\/index$/, ""));
const errors = [];

const sets = locales.map((locale) => new Set(slugs(locale)));
for (const slug of new Set([...sets[0], ...sets[1]])) {
    if (!sets[0].has(slug)) errors.push(`缺少中文文档: ${slug || "index"}`);
    if (!sets[1].has(slug)) errors.push(`缺少英文文档: ${slug || "index"}`);
}

for (const locale of locales) {
    const seen = new Set();
    for (const file of files(locale)) {
        const relativeSlug = path.relative(path.join(root, locale), file).replace(/\\/g, "/").replace(/\.(mdx|md)$/, "").replace(/\/index$/, "");
        if (seen.has(relativeSlug)) errors.push(`重复 slug: ${locale}/${relativeSlug || "index"}`);
        seen.add(relativeSlug);
        const source = fs.readFileSync(file, "utf8");
        const match = source.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) errors.push(`缺少 frontmatter: ${file}`);
        else {
            const data = parse(match[1]) || {};
            if (!data.title) errors.push(`缺少 title: ${file}`);
            if (!data.description) errors.push(`缺少 description: ${file}`);
        }
        for (const link of source.matchAll(/\]\(([^)]+)\)/g)) {
            const href = link[1].trim();
            if (!href.startsWith("./") && !href.startsWith("../")) continue;
            const target = href.split(/[?#]/, 1)[0].replace(/\/$/, "") || "index";
            const localeRoot = path.join(root, locale);
            const candidate = path.resolve(path.dirname(file), target);
            if (!candidate.startsWith(`${localeRoot}${path.sep}`) && candidate !== localeRoot) {
                errors.push(`内部链接越界: ${file} -> ${href}`);
                continue;
            }
            const targets = path.extname(candidate)
                ? [candidate]
                : [`${candidate}.mdx`, `${candidate}.md`, path.join(candidate, "index.mdx"), path.join(candidate, "index.md")];
            if (!targets.some((targetPath) => fs.existsSync(targetPath))) errors.push(`内部链接无效: ${file} -> ${href}`);
        }
    }
}

if (errors.length) {
    console.error(["文档校验失败:", ...errors.map((error) => `- ${error}`)].join("\n"));
    process.exit(1);
}
console.log(`文档校验通过：${files("zh-cn").length} 篇中文，${files("en").length} 篇英文。`);

function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(file) : [file];
    });
}
