import { unzipSync, zipSync } from "fflate";

/** 待打包文件的条目：文件名 + 任意可作为 Blob 构造内容的数据。 */
interface ZipEntry {
    name: string;
    data: BlobPart;
}

/**
 * 在浏览器内存中将多个文件打包成 ZIP Blob。
 * <p>
 * 采用不压缩（level 0）策略，因为这些产物多为已压缩的媒体或小体积 JSON，压缩收益有限而 CPU 开销明显。
 *
 * @param files 待打包文件条目数组
 * @return application/zip 类型的 Blob
 */
export async function createZip(files: ZipEntry[]): Promise<Blob> {
    const entries = await Promise.all(
        files.map(async (file) => {
            const bytes = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [file.name, bytes] as const;
        }),
    );
    const archived = zipSync(Object.fromEntries(entries), { level: 0 });
    return new Blob([archived], { type: "application/zip" });
}

/**
 * 在浏览器内存中解压一个 ZIP Blob，返回文件名到内容的映射。
 *
 * @param file ZIP 归档 Blob
 * @return 文件名 → Blob 内容的映射
 */
export async function readZip(file: Blob): Promise<Map<string, Blob>> {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    return new Map(
        Object.entries(entries).map(([name, bytes]) => [name, new Blob([bytes])]),
    );
}
