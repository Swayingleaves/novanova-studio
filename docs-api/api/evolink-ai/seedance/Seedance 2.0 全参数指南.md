> ## Documentation Index
> Fetch the complete documentation index at: https://evolink.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Seedance 2.0 全参数指南

> Seedance 2.0 全系列统一接口，通过 `model` 参数选择具体模型

**3 种生成模式：**
- **Text-to-Video**：纯文本描述生成视频，支持联网搜索增强
- **Image-to-Video**：1-2 张图片作为首尾帧驱动视频生成
- **Reference-to-Video**：图片 + 视频 + 音频多模态素材混合参考

每种模式均有标准版、快速版和 Mini 版，共 9 个模型

- **现已支持 AIGC 类真人素材**
- 异步处理模式，使用返回的任务ID [进行查询](/cn/api-manual/task-management/get-task-detail)
- 生成的视频链接，有效期为24小时，请尽快保存



## OpenAPI

````yaml cn/api-manual/video-series/seedance2.0/seedance-2.0-overview.json POST /v1/videos/generations
openapi: 3.1.0
info:
  title: Seedance 2.0 全模型接口
  description: Seedance 2.0 全系列 9 个模型的统一接口，涵盖文生视频、图生视频、多模态参考生视频的标准版、快速版与 Mini 版
  license:
    name: MIT
  version: 1.0.0
servers:
  - url: https://api.evolink.ai
    description: 生产环境
security:
  - bearerAuth: []
tags:
  - name: 视频生成
    description: AI视频生成相关接口
paths:
  /v1/videos/generations:
    post:
      tags:
        - 视频生成
      summary: Seedance 2.0 视频生成（全模型）
      description: >-
        Seedance 2.0 全系列统一接口，通过 `model` 参数选择具体模型


        **3 种生成模式：**

        - **Text-to-Video**：纯文本描述生成视频，支持联网搜索增强

        - **Image-to-Video**：1-2 张图片作为首尾帧驱动视频生成

        - **Reference-to-Video**：图片 + 视频 + 音频多模态素材混合参考


        每种模式均有标准版、快速版和 Mini 版，共 9 个模型


        - **现已支持 AIGC 类真人素材**

        - 异步处理模式，使用返回的任务ID
        [进行查询](/cn/api-manual/task-management/get-task-detail)

        - 生成的视频链接，有效期为24小时，请尽快保存
      operationId: createSeedance20VideoGeneration
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoGenerationRequest'
            examples:
              text_to_video:
                summary: 文生视频
                value:
                  model: seedance-2.0-text-to-video
                  prompt: 一只猫在钢琴上弹奏月光奏鸣曲，电影感光影，特写镜头
                  duration: 8
                  quality: 720p
                  aspect_ratio: '16:9'
                  generate_audio: true
                  content_filter: true
              image_to_video:
                summary: 图生视频（首帧驱动）
                value:
                  model: seedance-2.0-image-to-video
                  prompt: 镜头缓缓推进，花瓣随风飘落
                  image_urls:
                    - https://example.com/flower.jpg
                  duration: 5
                  aspect_ratio: adaptive
                  generate_audio: true
                  content_filter: true
              reference_to_video:
                summary: 多模态参考（图片 + 视频 + 音频）
                value:
                  model: seedance-2.0-reference-to-video
                  prompt: 全程使用 @video1 的第一视角构图，全程使用 @audio1 作为背景音乐。第一人称视角果茶宣传广告...
                  image_urls:
                    - https://example.com/ref1.jpg
                    - https://example.com/ref2.jpg
                  video_urls:
                    - https://example.com/reference.mp4
                  audio_urls:
                    - https://example.com/bgm.mp3
                  duration: 10
                  quality: 720p
                  aspect_ratio: '16:9'
                  generate_audio: true
                  content_filter: true
              fast_text_to_video:
                summary: 快速版文生视频
                value:
                  model: seedance-2.0-fast-text-to-video
                  prompt: 城市日落延时摄影，金色光线洒满天际线
                  duration: 5
                  aspect_ratio: '21:9'
                  generate_audio: true
                  content_filter: true
      responses:
        '200':
          description: 视频生成任务创建成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VideoGenerationResponse'
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
                  message: Token does not have access to the specified model
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
    VideoGenerationRequest:
      type: object
      required:
        - model
        - prompt
      properties:
        model:
          type: string
          description: |-
            视频生成模型名称

            | 模型 ID | 模式 | 版本 |
            |:--------|:-----|:-----|
            | `seedance-2.0-text-to-video` | 文生视频 | 标准 |
            | `seedance-2.0-image-to-video` | 图生视频 | 标准 |
            | `seedance-2.0-reference-to-video` | 多模态参考 | 标准 |
            | `seedance-2.0-fast-text-to-video` | 文生视频 | 快速 |
            | `seedance-2.0-fast-image-to-video` | 图生视频 | 快速 |
            | `seedance-2.0-fast-reference-to-video` | 多模态参考 | 快速 |
            | `seedance-2.0-mini-text-to-video` | 文生视频 | Mini |
            | `seedance-2.0-mini-image-to-video` | 图生视频 | Mini |
            | `seedance-2.0-mini-reference-to-video` | 多模态参考 | Mini |
          enum:
            - seedance-2.0-text-to-video
            - seedance-2.0-image-to-video
            - seedance-2.0-reference-to-video
            - seedance-2.0-fast-text-to-video
            - seedance-2.0-fast-image-to-video
            - seedance-2.0-fast-reference-to-video
            - seedance-2.0-mini-text-to-video
            - seedance-2.0-mini-image-to-video
            - seedance-2.0-mini-reference-to-video
          example: seedance-2.0-text-to-video
        prompt:
          type: string
          description: >-
            描述期望生成视频的文本提示词。支持中英文，建议中文不超过 500 字，英文不超过 1000 词。提示词最大长度：10000 tokens


            **不同模型的 prompt 用法：**

            - **Text-to-Video**：纯文本描述，不支持在 prompt 中使用
            `image_urls`、`video_urls`、`audio_urls`

            - **Image-to-Video**：纯文本描述，不支持在 prompt 中使用 `video_urls`、`audio_urls`

            - **Reference-to-Video**：引用输入素材时，优先使用 `@image1`、`@video1`、`@audio1`
            这类显式标签；编号与对应 URL 数组顺序一致并从 1 开始。自然语言编号可能仍可被识别，但显式标签能更准确地建立素材与用途的对应关系
          example: 一只猫在钢琴上弹奏月光奏鸣曲，电影感光影，特写镜头
        image_urls:
          type: array
          description: |-
            图片 URL 数组

            **适用模型与数量限制：**
            - **Text-to-Video**：❌ 不支持
            - **Image-to-Video**：✅ 必填，**1–2 张**
            - **Reference-to-Video**：✅ 可选，**0–9 张**

            **Image-to-Video 图片行为：**

            | 图片数量 | 行为 | 角色 |
            |:--------:|------|------|
            | 1 张 | 首帧图生视频 | 自动设为 `first_frame` |
            | 2 张 | 首尾帧图生视频 | 第 1 张 → `first_frame`，第 2 张 → `last_frame` |

            **Reference-to-Video 图片角色：**
            - 风格参考、产品图、人物形象、首帧/尾帧（通过 prompt 指定）

            **图片要求：**
            - 支持格式：`.jpeg`、`.png`、`.webp`
            - 宽高比（宽/高）：`0.4` ~ `2.5`
            - 宽高像素：`300` ~ `6000` px
            - 单张大小：不超过 `30MB`
            - 请求体总大小不超过 `64MB`
            - 传入首尾帧时，两张图片可相同。宽高比不一致时以首帧为准，尾帧会自动裁剪适配
            - 图像 URL 需要服务器能直接访问
          items:
            type: string
            format: uri
          maxItems: 9
          example:
            - https://example.com/image1.jpg
        video_urls:
          type: array
          description: >-
            参考视频 URL 数组


            **仅适用于 Reference-to-Video 模型**，其他模型不支持此参数


            **数量限制：** 0–3 个


            **角色说明：**

            - 运镜参考、动作参考、待编辑/延长的原始视频


            **视频要求：**

            - 支持格式：`.mp4`、`.mov`

            - 分辨率：480p、720p、1080p

            - 单个视频时长：`2` ~ `15` 秒，最多 3 个，所有视频总时长 ≤ `15` 秒

            - 宽高比（宽/高）：`0.4` ~ `2.5`

            - 宽高像素：`300` ~ `6000` px

            - 画面像素（宽 × 高）：`409,600` ~ `2,086,876`（如 640×640 ~ 2206×946）

            - 单个大小：不超过 `50MB`

            - 帧率：`24` ~ `60` FPS

            - 使用视频参考会增加费用（输入视频时长计入计费）

            - 视频 URL 需要服务器能直接访问


            **注意：** 不可仅传入 `audio_urls`，必须至少包含 1 张图片（`image_urls`）或 1
            个视频（`video_urls`）
          items:
            type: string
            format: uri
          maxItems: 3
          example:
            - https://example.com/reference.mp4
        audio_urls:
          type: array
          description: |-
            参考音频 URL 数组

            **仅适用于 Reference-to-Video 模型**，其他模型不支持此参数

            **数量限制：** 0–3 段

            **角色说明：**
            - 背景音乐、音效、语音/台词参考

            **音频要求：**
            - 支持格式：`.wav`、`.mp3`
            - 单段音频时长：`2` ~ `15` 秒，最多 3 段，所有音频总时长 ≤ `15` 秒
            - 单个大小：不超过 `15MB`
            - 音频 URL 需要服务器能直接访问

            **注意：** 不可仅传入 `audio_urls`，必须至少包含 1 张图片或 1 个视频
          items:
            type: string
            format: uri
          maxItems: 3
          example:
            - https://example.com/bgm.mp3
        duration:
          type: integer
          description: |-
            输出视频时长（秒），默认为 `5` 秒

            - 支持 `4`–`15` 秒之间的任意整数值
            - 时长与计费直接相关
            - 适用于全部 9 个模型
          default: 5
          minimum: 4
          maximum: 15
          example: 8
        quality:
          type: string
          description: >-
            视频分辨率，默认为 `720p`


            **可选值：**

            - `480p`：清晰度较低，价格较低

            - `720p`：标准清晰度，此为默认值

            -
            `1080p`：超高清晰度，**仅标准版模型支持**（Text-to-Video、Image-to-Video、Reference-to-Video）；3
            个 Fast 模型与 3 个 Mini 模型暂不支持


            `480p` 与 `720p` 适用于全部 9 个模型
          enum:
            - 480p
            - 720p
            - 1080p
          default: 720p
          example: 720p
        aspect_ratio:
          type: string
          description: |-
            视频宽高比，默认为 `adaptive`

            **可选值：**
            - `16:9`（横屏）、`9:16`（竖屏）、`1:1`（方形）、`4:3`、`3:4`、`21:9`（超宽屏）
            - `adaptive`：自动选择最佳比例

            **`adaptive` 不同模型行为：**
            - **Text-to-Video**：根据提示词内容自动选择
            - **Image-to-Video**：根据首帧图片宽高比自动适配
            - **Reference-to-Video**：优先级：视频素材比例 > 图片素材比例 > 提示词推断

            **各分辨率对应像素值：**

            | 宽高比 | 480p | 720p | 1080p |
            |:------:|:----:|:----:|:-----:|
            | 16:9 | 864×496 | 1280×720 | 1920×1080 |
            | 4:3 | 752×560 | 1112×834 | 1664×1248 |
            | 1:1 | 640×640 | 960×960 | 1440×1440 |
            | 3:4 | 560×752 | 834×1112 | 1248×1664 |
            | 9:16 | 496×864 | 720×1280 | 1080×1920 |
            | 21:9 | 992×432 | 1470×630 | 2206×946 |

            *1080p 仅标准版模型支持*
          enum:
            - '16:9'
            - '9:16'
            - '1:1'
            - '4:3'
            - '3:4'
            - '21:9'
            - adaptive
          default: adaptive
          example: '16:9'
        generate_audio:
          type: boolean
          description: |-
            是否生成同步音频，默认为 `true`

            - `true`：视频包含同步音频（人声、音效、背景音乐），不额外收费
            - `false`：输出无声视频

            适用于全部 9 个模型
          default: true
          example: true
        content_filter:
          type: boolean
          description: |-
            内容过滤开关，默认为 `true`

            **可选值：**
            - `true`：标准内容安全检查，这是默认值
            - `false`：放松内容限制，按 +10%（`1.1x`）计费。违法违禁内容始终强制拦截，不受此设置影响
          default: true
          example: true
        model_params:
          type: object
          description: |-
            模型扩展参数

            **仅适用于 Text-to-Video 模型**（标准版和快速版）
          properties:
            web_search:
              type: boolean
              description: >-
                联网搜索，默认为 `false`


                **仅适用于 Text-to-Video 模型**（`seedance-2.0-text-to-video` 和
                `seedance-2.0-fast-text-to-video`）


                **说明：**

                - 开启后模型根据提示词自主判断是否搜索互联网内容（如商品、天气等），可提升时效性

                - 会增加一定时延

                - 仅在实际触发搜索时产生费用，开启后可能调用多次
              default: false
              example: false
        callback_url:
          type: string
          description: |-
            任务完成后的 HTTPS 回调地址

            **回调时机：**
            - 任务完成（completed）、失败（failed）或取消（cancelled）时触发
            - 在计费确认完成后发送

            **安全限制：**
            - 仅支持 HTTPS 协议
            - 禁止回调到内网 IP 地址（127.0.0.1、10.x.x.x、172.16-31.x.x、192.168.x.x 等）
            - URL 长度不超过 `2048` 字符

            **回调机制：**
            - 超时时间：`10` 秒
            - 失败后最多重试 `3` 次（分别在失败后 `1`/`2`/`4` 秒重试）
            - 回调响应体格式与任务查询接口返回格式一致
            - 返回 2xx 状态码视为成功，其他状态码触发重试

            适用于全部 9 个模型
          format: uri
          example: https://your-domain.com/webhooks/video-task-completed
    VideoGenerationResponse:
      type: object
      properties:
        created:
          type: integer
          description: 任务创建时间戳
          example: 1761313744
        id:
          type: string
          description: 任务ID
          example: task-unified-1774857405-abc123
        model:
          type: string
          description: 实际使用的模型名称
          example: seedance-2.0-text-to-video
        object:
          type: string
          enum:
            - video.generation.task
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
          $ref: '#/components/schemas/VideoTaskInfo'
          description: 视频任务详细信息
        type:
          type: string
          enum:
            - text
            - image
            - audio
            - video
          description: 任务的输出类型
          example: video
        usage:
          $ref: '#/components/schemas/VideoUsage'
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
    VideoTaskInfo:
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
          example: 165
        video_duration:
          type: integer
          description: 视频时长（秒）
          example: 8
    VideoUsage:
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
          example: per_second
        credits_reserved:
          type: number
          description: 预估消耗积分数
          minimum: 0
          example: 50
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

        **获取 API Key：**

        访问 [API Key 管理页面](https://evolink.ai/dashboard/keys) 获取您的 API Key

        **使用时在请求头中添加：**
        ```
        Authorization: Bearer YOUR_API_KEY
        ```

````