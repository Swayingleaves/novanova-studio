declare module "cos-js-sdk-v5" {
    type CosOptions = {
        SecretId: string;
        SecretKey: string;
    };
    type PutObjectParams = {
        Bucket: string;
        Region: string;
        Key: string;
        Body: Blob;
        ContentType?: string;
    };
    type CosCallback = (error: unknown, data: unknown) => void;

    class COS {
        constructor(options: CosOptions);
        putObject(params: PutObjectParams, callback: CosCallback): void;
    }

    export = COS;
}
