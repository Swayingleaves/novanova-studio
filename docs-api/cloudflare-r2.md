# Cloudflare R2

## 中文

R2 适配器通过 S3 兼容 API 保存公开素材与生成结果，同时支持文件管理使用的临时 GET 链接和对象删除。凭证沿用现有对象存储配置的服务端加密保存流程；上传由服务端执行，无需数据库迁移。

### 配置

1. 在 Cloudflare R2 创建存储桶，并创建限定到该桶、具有 **Object Read & Write** 权限的 R2 API 凭证。
2. 保存 S3 客户端使用的 **Access Key ID** 和 **Secret Access Key**。表单使用这两项，不使用 Cloudflare API 的令牌值。
3. 为存储桶绑定自定义域名；开发测试也可以启用公共 `r2.dev` 地址。生产环境应使用自定义域名，`r2.dev` 有访问速率限制。
4. 在管理后台 → 系统配置 → 对象存储中新增配置，选择 **Cloudflare R2**，填写下表，执行测试上传，保存并按需设为默认。

| 字段 | 示例或说明 |
| --- | --- |
| 配置名称 | `R2 media` |
| 存储目录 | `novanova-studio`，作为对象键前缀 |
| Access Key ID | R2 提供的 S3 访问密钥 ID |
| Secret Access Key | 与该 ID 配对的 S3 机密访问密钥 |
| Bucket | `example-bucket`，仅填桶名称 |
| Region | `auto`，选择 R2 时自动填写 |
| Endpoint | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`，不追加桶名称 |
| 公开访问地址 | `https://media.example.com` 或已启用的 `https://pub-<ID>.r2.dev` |

使用管辖区专用桶时，复制 Cloudflare 控制台显示的对应 S3 Endpoint，例如 `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`；Region 仍填 `auto`。

**Endpoint 与公开访问地址用途不同。** S3 Endpoint 用于认证后的上传、删除和签名读取，不能作为匿名公开地址。生成结果使用配置的公开域名加上编码后的对象键。

### 支持范围

- 支持公开素材上传、生成结果保存、临时预览/下载链接、对象清理。
- 临时链接使用 S3 签名并带有到期时间；对已经公开的对象签名并不会使其变为私有。
- 暂不支持小说私有原文和私有分享素材上传。R2 不支持对象级 ACL，本适配器要求公开访问域名，因此会拒绝私有存储验证，避免把私有内容写入公开桶。
- 如果浏览器中的画布导出或素材读取需要跨域访问，请按实际站点域名配置该桶的 GET/HEAD CORS 规则。服务端上传本身不依赖浏览器 CORS。

## English

The R2 adapter stores public media and generated results through the S3-compatible API. It also signs temporary GET URLs for file previews/downloads and deletes objects during file cleanup. Credentials use the existing encrypted server-side configuration flow. No database migration is required.

Create an R2 bucket and bucket-scoped **Object Read & Write** credentials. In the administrator console's object storage settings, select **Cloudflare R2**, use the S3 **Access Key ID** and **Secret Access Key** (not the Cloudflare API token value), enter the bucket name and set **Region** to `auto`.

Use `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` as **Endpoint**, without a bucket path. For jurisdiction-specific buckets, copy the endpoint shown by Cloudflare, such as `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. Use a bucket-bound custom domain as **Public URL**. An enabled `r2.dev` URL is suitable for development but is rate-limited. Test the upload, save the configuration and set it as default if required.

The S3 endpoint is an authenticated API endpoint, not an anonymous public URL. Temporary signed links do not make publicly accessible objects private. Private source documents and private shared-work uploads are intentionally unsupported: R2 has no object-level ACL, and this adapter requires a public media URL. Configure bucket GET/HEAD CORS for the site's origin when browser-side media reads or canvas exports require it; server-side uploads do not need browser CORS.

## References

- [R2 S3 credentials](https://developers.cloudflare.com/r2/api/tokens/)
- [R2 Java SDK example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-java/)
- [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Public buckets and custom domains](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Configure CORS](https://developers.cloudflare.com/r2/buckets/cors/)
