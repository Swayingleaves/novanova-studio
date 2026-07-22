import type { Asset, AssetKind } from "../stores/use-asset-store";

export type AssetQuery = {
    keyword: string;
    kind: AssetKind | "all";
};

export type AssetPage = {
    items: Asset[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
};

export function queryAssets(assets: readonly Asset[], query: AssetQuery): Asset[] {
    const keyword = query.keyword.trim().toLocaleLowerCase("zh-CN");
    return assets.filter((asset) => {
        if (query.kind !== "all" && asset.kind !== query.kind) return false;
        return !keyword || createAssetSearchText(asset).includes(keyword);
    });
}

export function paginateAssets(assets: readonly Asset[], requestedPage: number, requestedPageSize: number): AssetPage {
    const pageSize = Math.max(1, Math.floor(requestedPageSize) || 1);
    const totalPages = Math.max(1, Math.ceil(assets.length / pageSize));
    const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage) || 1));
    const start = (page - 1) * pageSize;
    return { items: assets.slice(start, start + pageSize), page, pageSize, total: assets.length, totalPages };
}

export function createAssetSearchText(asset: Asset): string {
    const content = asset.kind === "text" ? asset.data.content : asset.data.mimeType;
    return [asset.title, asset.source, asset.note, ...asset.tags, content].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
}
