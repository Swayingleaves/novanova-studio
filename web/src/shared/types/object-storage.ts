export type ObjectStorageProvider = "tencentCos" | "aliyunOss" | "qiniuKodo";

export type ObjectStorageConfig = {
    id: string;
    name: string;
    provider: ObjectStorageProvider;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
    endpoint: string;
    directory: string;
    publicBaseUrl: string;
    lastTestedAt: string;
    defaultStorage: boolean;
};

export type ObjectStorageFile = {
    provider: ObjectStorageProvider;
    url: string;
    key: string;
    bucket: string;
    region: string;
    bytes: number;
    mimeType: string;
    uploadedAt: string;
};
