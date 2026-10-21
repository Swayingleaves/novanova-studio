> ## Documentation Index
> Fetch the complete documentation index at: https://evolink.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# GPT Image 2 图像生成

> - GPT Image 2 (gpt-image-2) 模型支持文本转图片、图生图、图像编辑等多种生成模式
- 异步处理模式，使用返回的任务ID  [进行查询](/cn/api-manual/task-management/get-task-detail)
- 生成的图像链接，有效期为24小时，请尽快保存



## OpenAPI

````yaml cn/api-manual/image-series/gpt-image-2/gpt-image-2-image-generation.json POST /v1/images/generations
openapi: 3.1.0
info:
  title: gpt-image-2接口
  description: 使用AI模型创建图像任务，支持多种模型和参数配置
  license:
    name: MIT
  version: 1.0.0
servers:
  - url: https://api.evolink.ai
    description: 生产环境
security:
  - bearerAuth: []
tags:
  - name: 图像生成
    description: AI图像生成相关接口
paths:
  /v1/images/generations:
    post:
      tags:
        - 图像生成
      summary: gpt-image-2接口
      description: >-
        - GPT Image 2 (gpt-image-2) 模型支持文本转图片、图生图、图像编辑等多种生成模式

        - 异步处理模式，使用返回的任务ID 
        [进行查询](/cn/api-manual/task-management/get-task-detail)

        - 生成的图像链接，有效期为24小时，请尽快保存
      operationId: createImageGenerationGptImage2
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ImageGenerationRequest'
            examples:
              text_to_image:
                summary: 文生图（最简）
                value:
                  model: gpt-image-2
                  prompt: 海面上绚丽多彩的美丽日落
              text_to_image_hd:
                summary: 文生图（高清 16:9）
                value:
                  model: gpt-image-2
                  prompt: 黄昏时分未来都市天际线的电影级广角镜头
                  size: '16:9'
                  resolution: 4K
                  quality: high
                  'n': 1
              text_to_image_pixel:
                summary: 文生图（指定像素）
                value:
                  model: gpt-image-2
                  prompt: 极简主义 Logo 设计
                  size: 1024x1024
                  quality: medium
              image_edit:
                summary: 图生图 / 图像编辑
                value:
                  model: gpt-image-2
                  prompt: 在她旁边加一只可爱的小猫
                  size: '1:1'
                  resolution: 1K
                  quality: medium
                  image_urls:
                    - https://example.com/input.png
                  callback_url: https://your-domain.com/webhook/image-done
              image_inpaint:
                summary: 局部重绘（带 mask）
                value:
                  model: gpt-image-2
                  prompt: 把天空换成繁星点点的夜空
                  size: '1:1'
                  resolution: 1K
                  quality: medium
                  image_urls:
                    - https://example.com/input.png
                  mask_url: https://example.com/mask.png
              batch_generation:
                summary: 批量生成
                value:
                  model: gpt-image-2
                  prompt: 像素风格的可爱机器人
                  size: '1:1'
                  resolution: 2K
                  quality: high
                  'n': 4
      responses:
        '200':
          description: 图像任务创建成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ImageGenerationResponse'
        '400':
          description: 请求参数错误
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: invalid_request
                  message: Invalid request parameters
                  type: invalid_request_error
        '401':
          description: 未认证、Token无效或过期
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: unauthorized
                  message: Invalid or expired token
                  type: authentication_error
        '402':
          description: 配额不足、需要充值
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: insufficient_quota
                  message: Insufficient quota. Please top up your account.
                  type: insufficient_quota
        '403':
          description: 无权限访问
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: model_access_denied
                  message: 'Token does not have access to model: gpt-image-2'
                  type: invalid_request_error
        '429':
          description: 请求频率超限
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: rate_limit_exceeded
                  message: Too many requests, please try again later
                  type: rate_limit_error
        '500':
          description: 服务器内部错误
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
              example:
                error:
                  code: internal_error
                  message: Internal server error
                  type: api_error
components:
  schemas:
    ImageGenerationRequest:
      type: object
      required:
        - model
        - prompt
      properties:
        model:
          type: string
          description: 图像生成模型名称，官方通道，稳定性和可控性更好，适用于商业场景
          enum:
            - gpt-image-2
          default: gpt-image-2
          example: gpt-image-2
        prompt:
          type: string
          description: |-
            提示词，描述想要生成的图像，或描述如何编辑已输入的图像

            **长度限制（需同时满足）：**
            - 最多 `32,000` 字符（按 Unicode 码点统计）
            - `prompt` 文本本身经 UTF-8 编码后，不超过 `60,000` 字节

            不同字符占用的 UTF-8 字节数不同，请以实际编码后的字节数为准。

            超出任一限制时，请缩短提示词后重新提交。

            **建议：** 提示词超过 `8000` tokens 时，生成图像可能与预期不符，建议精简提示词
          example: 海面上绚丽多彩的美丽日落
          maxLength: 32000
        image_urls:
          type: array
          description: >-
            参考图像URL列表，用于图生图与图像编辑功能


            **注意：**

            - 单次请求支持输入图像数量：`1~16`张

            - 单张图像大小：不超过 `50MB`

            - 单张图像像素：宽 × 高不超过 `178,956,970` px

            - 单张图像边长：宽 / 高均不超过 `23170` px，超过可能产生异常

            - 支持的文件格式：`.jpeg`、`.jpg`、`.png`、`.webp`

            -
            图像URL需要服务器能直接查看，或者图像URL在访问时会直接进行下载（一般这种URL是以图像的扩展名作为结尾，例如`.png`、`.jpg`）

            - 图生图/图像编辑场景下，传入的参考图本身会产生额外的图像输入 token 消耗
          items:
            type: string
            format: uri
          example:
            - https://example.com/image1.png
            - https://example.com/image2.png
        mask_url:
          type: string
          format: uri
          description: >-
            局部重绘遮罩图 URL —— 标记参考图上需要重新生成的区域。**仅在图像编辑模式下生效**（必须同时传
            `image_urls`）；纯文生图时即使传了 `mask_url` 也会被忽略。


            **格式要求：**

            - **必须是带 alpha 通道的 PNG**：透明像素（`alpha < 255`）= 需要重绘的区域，不透明像素 = 保留原图

            - **遮罩尺寸必须与参考图完全一致**（宽 × 高，单位像素）

            - 单次请求仅支持一张遮罩


            **注意：**

            - 至少要在 `image_urls` 里提供 1 张参考图，单独传 mask 不会生效

            - 常见错误：
                - `Invalid mask image format - mask image missing alpha channel`：上传的图没有 alpha 通道（JPEG、不透明 PNG 等），请重新导出带透明区域的 PNG
                - `Invalid mask image format - mask size does not match image size`：遮罩与参考图尺寸不一致，请将遮罩调整到与参考图完全相同的像素尺寸
          example: https://example.com/mask.png
        size:
          type: string
          description: |-
            生成图像的尺寸，支持**比例格式**与**显式像素格式**两种写法，默认 `auto`

            **① 比例格式（推荐，15 种）**

            - `1:1`：正方形
            - `1:2` / `2:1`：极竖/极横
            - `1:3` / `3:1`：超竖/超横（临界 3:1）
            - `2:3` / `3:2`：标准竖/横
            - `3:4` / `4:3`：传统竖/横
            - `4:5` / `5:4`：社交媒体常用
            - `9:16` / `16:9`：手机/桌面宽屏
            - `9:21` / `21:9`：超宽屏

            **② 显式像素格式**：`WxH`（或 `W×H`），例如 `1024x1024`、`1536x1024`、`3840×2160`

            - 宽、高均必须为 `16` 的整数倍
            - 每条边范围：`[16, 3840]`
            - 像素预算：`655,360 ≤ width × height ≤ 8,294,400`（约 0.65 MP ~ 8.29 MP）
            - 长宽比：`≤ 3:1`

            **③ `auto`**：由模型自动决定尺寸（此时 `resolution` 不生效）

            **超限处理：**
            - 比例 + `resolution` 组合若超预算会自动按比例缩到顶格（例如 4K 2:1 → 3840×1920）
          default: auto
          example: auto
        resolution:
          type: string
          description: |-
            分辨率档位快捷参数，仅在 `size` 为比例格式时生效，显式像素格式下此字段被忽略

            **像素预算规则**（根据目标总像素数和 `size` 比例推算宽高，结果向 16 的倍数对齐）：

            - `1K`：~1 MP（1024² = 1,048,576 像素）
            - `2K`：~4 MP（2048² = 4,194,304 像素）
            - `4K`：~8.29 MP（3840×2160 = 8,294,400 像素，即上限）

            **横版/正方形对应实际输出尺寸**（竖版尺寸为对应横版的宽高调换，例如 `2:3` = `3:2` 反转）：

            | 比例 | 1K | 2K | 4K |
            |---|---|---|---|
            | `1:1` | 1024×1024 | 2048×2048 | 2880×2880 |
            | `2:1` | 1456×720 | 2896×1456 | 3840×1920 \* |
            | `3:1` | 1776×592 | 3552×1184 | 3840×1280 \* |
            | `3:2` | 1248×832 | 2512×1680 | 3520×2352 |
            | `4:3` | 1184×880 | 2368×1776 | 3312×2480 \* |
            | `5:4` | 1152×912 | 2288×1824 | 3216×2576 |
            | `16:9` | 1360×768 | 2736×1536 | 3840×2160（UHD）|
            | `21:9` | 1568×672 | 3136×1344 | 3840×1648 \* |

            \* 表示超像素预算后按比例自动缩到顶格。取值大小写不敏感。
          enum:
            - 1K
            - 2K
            - 4K
          default: 1K
          example: 1K
        quality:
          type: string
          description: |-
            渲染质量，控制模型的"思考深度"，直接影响输出 token 数和费用，默认 `medium`

            | 取值 | tile 基数 | 相对成本（1024²）|
            |---|---|---|
            | `low` | 16 | ~0.11× |
            | `medium` | 48 | 1.0× |
            | `high` | 96 | ~4.0× |
          enum:
            - low
            - medium
            - high
          default: medium
          example: medium
        background:
          type: string
          description: |-
            输出图像的背景通道，默认 `opaque`

            - `opaque`：不透明背景，不带 alpha 通道
            - `transparent`：保留 alpha 通道

            **注意：**
            - `transparent` 目前是 Preview 功能，效果可能不稳定
            - `gpt-image-2-beta` 不支持该参数
            - 使用 `transparent` 时，`output_format` 只能选 `png` 或 `webp`
          enum:
            - opaque
            - transparent
          default: opaque
          example: opaque
        output_format:
          type: string
          description: >-
            输出图像的文件格式，默认 `png`


            - `png`：无损，支持透明背景

            - `jpeg`：有损压缩，文件体积更小

            - `webp`：体积与质量兼顾，同样支持透明背景


            **注意：**

            - `background` 为 `transparent` 时只能使用 `png` 或 `webp`，`jpeg` 不支持 alpha
            通道
          enum:
            - png
            - jpeg
            - webp
          default: png
          example: png
        'n':
          type: integer
          description: >-
            生成图片数量，每张独立计费


            **注意：**

            - 文本输入 token 会随 `n` 等比放大

            - 官方当前对 `n > 1` 的支持并不稳定：即使传入大于 1 的值，也很可能只返回 1 张图。实际张数以响应中的 `results`
            为准，计费按返回的 `usage` 结算。需要多张时，建议改为发起多次单张请求
          minimum: 1
          maximum: 10
          default: 1
          example: 1
        callback_url:
          type: string
          description: |-
            任务完成后的HTTPS回调地址

            **回调时机：**
            - 任务完成（completed）、失败（failed）或取消（cancelled）时触发
            - 在计费确认完成后发送

            **安全限制：**
            - 仅支持HTTPS协议
            - 禁止回调到内网IP地址（127.0.0.1、10.x.x.x、172.16-31.x.x、192.168.x.x等）
            - URL长度不超过`2048`字符

            **回调机制：**
            - 超时时间：`10`秒
            - 失败后最多重试`3`次（会分别在失败的`1`秒/`2`秒/`4`秒后进行重试）
            - 回调响应体格式与任务查询接口返回的格式一致
            - 回调地址若返回2xx状态码视为成功，其他状态码会触发重试
          format: uri
          example: https://your-domain.com/webhooks/image-task-completed
    ImageGenerationResponse:
      type: object
      properties:
        created:
          type: integer
          description: 任务创建时间戳
          example: 1757156493
        id:
          type: string
          description: 任务ID
          example: task-unified-1757156493-imcg5zqt
        model:
          type: string
          description: 实际使用的模型名称
          example: gpt-image-2
        object:
          type: string
          enum:
            - image.generation.task
          description: 任务的具体类型
        progress:
          type: integer
          description: 任务进度百分比 (0-100)
          minimum: 0
          maximum: 100
          example: 0
        status:
          type: string
          description: 任务状态
          enum:
            - pending
            - processing
            - completed
            - failed
          example: pending
        task_info:
          $ref: '#/components/schemas/TaskInfo'
          description: 异步任务信息
        type:
          type: string
          enum:
            - text
            - image
            - audio
            - video
          description: 任务的输出类型
          example: image
        usage:
          $ref: '#/components/schemas/Usage'
          description: 使用量和计费信息
    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            code:
              type: string
              description: 错误代码标识符
            message:
              type: string
              description: 错误描述信息
            type:
              type: string
              description: 错误类型
    TaskInfo:
      type: object
      properties:
        can_cancel:
          type: boolean
          description: 任务是否可以取消
          example: true
        estimated_time:
          type: integer
          description: 预估完成时间（秒）
          minimum: 0
          example: 100
    Usage:
      type: object
      description: 使用量和计费信息
      properties:
        billing_rule:
          type: string
          description: 计费规则
          enum:
            - per_call
            - per_token
            - per_second
          example: per_call
        credits_reserved:
          type: number
          description: 预估消耗积分数
          minimum: 0
          example: 2.5
        user_group:
          type: string
          description: 用户组类别
          example: default
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: |-
        ##所有接口均需要使用Bearer Token进行认证##

        **获取 API Key ：**

        访问 [API Key 管理页面](https://evolink.ai/dashboard/keys) 获取您的 API Key

        **使用时在请求头中添加：**
        ```
        Authorization: Bearer YOUR_API_KEY
        ```

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.