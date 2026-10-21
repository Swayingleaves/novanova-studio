> ## Documentation Index
> Fetch the complete documentation index at: https://evolink.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Minimax H3 Reference-to-Video 多模态参考生视频

> - 支持最多 9 张参考图片、3 个参考视频和 3 段参考音频，三类总数不超过 12 个
- 至少传入一个参考素材：参考图片、参考视频或参考音频任一即可
- 输出时长支持 `4`–`15` 秒，分辨率支持 `768p`（默认）与 `2k`
- 异步处理模式，使用返回的任务 ID [进行查询](/cn/api-manual/task-management/get-task-detail)
- 生成的视频链接有效期为 24 小时，请尽快保存



## OpenAPI

````yaml cn/api-manual/video-series/minimax/minimax-h3/h3/minimax-h3-reference-to-video.json POST /v1/videos/generations
openapi: 3.1.0
info:
  title: Minimax H3 Reference-to-Video 接口
  description: Minimax H3 多模态参考生视频接口，支持图片、视频和音频参考素材
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
      summary: Minimax H3 Reference-to-Video 多模态参考生视频
      description: >-
        - 支持最多 9 张参考图片、3 个参考视频和 3 段参考音频，三类总数不超过 12 个

        - 至少传入一个参考素材：参考图片、参考视频或参考音频任一即可

        - 输出时长支持 `4`–`15` 秒，分辨率支持 `768p`（默认）与 `2k`

        - 异步处理模式，使用返回的任务 ID
        [进行查询](/cn/api-manual/task-management/get-task-detail)

        - 生成的视频链接有效期为 24 小时，请尽快保存
      operationId: createMinimaxH3ReferenceToVideo
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VideoGenerationRequest'
            examples:
              image_reference:
                summary: 图片参考
                value:
                  model: minimax-h3-reference-to-video
                  prompt: >-
                    以 Image 1
                    中的人物作为唯一角色参考，保持面部、发型和服装一致。角色沿海边木栈道迎风行走，镜头从中景平稳跟拍到侧面近景，夕阳逆光，动作自然。
                  image_urls:
                    - >-
                      https://cdn.hailuoai.com/prod/hailuo_demo/testsets/H3_AA_I2VA/gallery/sr_v17_variants_seed42_43_20260724/inputs/4a3a90bf9100_KDmcbkhzYo5sjjxr9FqcVmWVnzb.png
                  duration: 4
                  quality: 768p
                  aspect_ratio: adaptive
              video_audio_reference:
                summary: 视频与音频参考
                value:
                  model: minimax-h3-reference-to-video
                  prompt: >-
                    角色完全沿用 Video 1
                    的动作节奏、构图和运镜，并说：“追随风，自由地生活。把烦恼留在身后，享受这一刻。”对白音色参考 Audio
                    1，口型与语音同步。
                  video_urls:
                    - >-
                      https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/297573323635_00_%E8%A7%86%E9%A2%911_YnyRbxEwio_video_20260525_163755_1927e9d3.mp4
                  audio_urls:
                    - >-
                      https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/f463d523c5ce_01_%E9%9F%B3%E9%A2%911_RSLcbpzJPo_6%E6%9C%885%E6%97%A5(1).mp3
                  duration: 4
                  quality: 768p
                  aspect_ratio: adaptive
              multimodal:
                summary: 多模态参考（图片 + 视频 + 音频）
                value:
                  model: minimax-h3-reference-to-video
                  prompt: >-
                    将 Video 1 中的人物替换为 Image 1 中的角色，保持 Image 1 的面部、发型和服装；完整保留
                    Video 1 的动作、节奏、构图和运镜，并使用 Audio 1 的声音演绎对白，确保口型同步。
                  image_urls:
                    - >-
                      https://cdn.hailuoai.com/prod/hailuo_demo/testsets/H3_AA_I2VA/gallery/sr_v17_variants_seed42_43_20260724/inputs/4a3a90bf9100_KDmcbkhzYo5sjjxr9FqcVmWVnzb.png
                  video_urls:
                    - >-
                      https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/297573323635_00_%E8%A7%86%E9%A2%911_YnyRbxEwio_video_20260525_163755_1927e9d3.mp4
                  audio_urls:
                    - >-
                      https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/f463d523c5ce_01_%E9%9F%B3%E9%A2%911_RSLcbpzJPo_6%E6%9C%885%E6%97%A5(1).mp3
                  duration: 4
                  quality: 768p
                  aspect_ratio: adaptive
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
                  message: >-
                    Token does not have access to model:
                    minimax-h3-reference-to-video
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
          description: 视频生成模型名称
          enum:
            - minimax-h3-reference-to-video
          default: minimax-h3-reference-to-video
          example: minimax-h3-reference-to-video
        prompt:
          type: string
          minLength: 1
          maxLength: 7000
          description: >-
            描述如何使用参考素材以及期望生成的视频内容。


            **提示词要求：**

            - 必填且不能为空

            - 支持中文和英文

            - 最长 `7000` 字符（中文和英文均按字符计）

            - 提示词过长时，模型可能忽略部分细节


            **素材引用规则：**

            - 使用 `Image 1`、`Image 2`、`Video 1`、`Audio 1` 等名称引用素材，不要使用 Seedance
            风格的 `@image1`、`@video1`

            - 编号从 `1` 开始，并与各 URL 数组中的顺序一致

            - `image_urls` 第一项是 `Image 1`，`video_urls` 第一项是 `Video
            1`，`audio_urls` 第一项是 `Audio 1`


            **输入限制：**

            - 本模型不支持 `image_start` 或 `image_end`

            - 至少传入 `1` 个参考素材：参考图片、参考视频或参考音频任一即可，参考音频可以单独使用
          example: >-
            将 Video 1 中的人物替换为 Image 1 中的角色，保持 Image 1 的面部、发型和服装；完整保留 Video 1
            的动作、构图和运镜，并使用 Audio 1 的声音演绎对白，确保口型同步。
        image_urls:
          type: array
          description: |-
            参考图片的 HTTP(S) URL 数组，默认为 `[]`，最多 `9` 张。

            **角色与编号：**
            - 所有图片均作为 `reference_image` 使用
            - 数组第 1 项对应提示词中的 `Image 1`，第 2 项对应 `Image 2`，依此类推

            **图片要求：**
            - 支持格式：JPG、JPEG、PNG、WEBP、HEIC、HEIF
            - 单张大小：不超过 `30MB`
            - 图片宽度和高度：均为 `256`–`5760` px
            - 宽高比（宽/高）：`0.4`–`2.5`
            - URL 必须使用 HTTP(S)，且可由服务端直接访问
            - 整个 JSON 请求体大小不超过 `64MB`；不接受 Base64 或 `mm_file://` 输入

            **组合规则：**
            - `image_urls`、`video_urls`、`audio_urls` 至少传入其中一项
            - 三类参考素材总数不超过 `12` 个（参考图片 + 参考视频 + 参考音频）
            - 三者全部为空会返回参数错误；纯文本生成请改用 `minimax-h3-text-to-video`
          default: []
          maxItems: 9
          items:
            type: string
            format: uri
          example:
            - >-
              https://cdn.hailuoai.com/prod/hailuo_demo/testsets/H3_AA_I2VA/gallery/sr_v17_variants_seed42_43_20260724/inputs/4a3a90bf9100_KDmcbkhzYo5sjjxr9FqcVmWVnzb.png
        video_urls:
          type: array
          description: |-
            参考视频的 HTTP(S) URL 数组，默认为 `[]`，最多 `3` 个。

            **角色与编号：**
            - 所有视频均作为 `reference_video` 使用
            - 数组第 1 项对应提示词中的 `Video 1`，第 2 项对应 `Video 2`，依此类推

            **视频要求：**
            - 支持容器格式：MP4（`.mp4`）、MOV（`.mov`）
            - 视频编码：H.264/AVC、H.265/HEVC
            - 视频内音频编码：AAC、MP3
            - 单个大小：不超过 `50MB`
            - 单个时长：`2`–`15` 秒；所有参考视频总时长不超过 `15` 秒
            - 视频宽度和高度：均为 `256`–`5760` px
            - 宽高比（宽/高）：`0.4`–`2.5`
            - 帧率：`23.976`–`60` FPS
            - URL 必须使用 HTTP(S)，且可由服务端直接访问
            - 整个 JSON 请求体大小不超过 `64MB`；不接受 Base64 或 `mm_file://` 输入

            **计费说明：**
            - 参考视频的输入时长会计入费用

            **组合规则：**
            - `image_urls`、`video_urls`、`audio_urls` 至少传入其中一项
            - 三类参考素材总数不超过 `12` 个（参考图片 + 参考视频 + 参考音频）
            - 三者全部为空会返回参数错误；纯文本生成请改用 `minimax-h3-text-to-video`
          default: []
          maxItems: 3
          items:
            type: string
            format: uri
          example:
            - >-
              https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/297573323635_00_%E8%A7%86%E9%A2%911_YnyRbxEwio_video_20260525_163755_1927e9d3.mp4
        audio_urls:
          type: array
          description: |-
            参考音频的 HTTP(S) URL 数组，默认为 `[]`，最多 `3` 段。

            **角色与编号：**
            - 所有音频均作为 `reference_audio` 使用
            - 数组第 1 项对应提示词中的 `Audio 1`，第 2 项对应 `Audio 2`，依此类推

            **音频要求：**
            - 支持格式：WAV、MP3
            - 单段大小：不超过 `15MB`
            - 单段时长：`2`–`15` 秒；所有参考音频总时长不超过 `15` 秒
            - URL 必须使用 HTTP(S)，且可由服务端直接访问
            - 整个 JSON 请求体大小不超过 `64MB`；不接受 Base64 或 `mm_file://` 输入

            **计费说明：**
            - 参考音频不计入计费时长

            **组合规则：**
            - 支持仅传 `audio_urls`，无需搭配参考图片或参考视频
            - 三类参考素材总数不超过 `12` 个（参考图片 + 参考视频 + 参考音频）
            - 三者全部为空会返回参数错误；纯文本生成请改用 `minimax-h3-text-to-video`
          default: []
          maxItems: 3
          items:
            type: string
            format: uri
          example:
            - >-
              https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/f463d523c5ce_01_%E9%9F%B3%E9%A2%911_RSLcbpzJPo_6%E6%9C%885%E6%97%A5(1).mp3
        duration:
          type: integer
          description: |-
            输出视频时长（秒），默认为 `4` 秒。

            **取值限制：**
            - 仅支持 `4`–`15` 之间的整数，包括 `4` 和 `15`
            - 不支持小数、数字字符串、`auto` 或 `-1`
            - 输出时长与计费直接相关
          default: 4
          minimum: 4
          maximum: 15
          example: 4
        quality:
          type: string
          description: |-
            输出视频分辨率，默认为 `768p`。

            **可选值：**
            - `768p`：默认值
            - `2k`

            **注意：**
            - 不传该参数时按 `768p` 出片；需要 2K 输出请显式传 `quality="2k"`
            - 输出码率、帧率、视频编码和音频编码由平台决定，当前不提供对应请求参数
          enum:
            - 768p
            - 2k
          default: 768p
          example: 768p
        aspect_ratio:
          type: string
          description: |-
            输出视频宽高比，默认为 `adaptive`。

            **可选值：**
            - `adaptive`：模型根据参考素材和提示词自动选择合适的宽高比
            - `16:9`：横屏
            - `21:9`：超宽屏
            - `4:3`：横向标准画幅
            - `1:1`：方形
            - `3:4`：纵向标准画幅
            - `9:16`：竖屏
          enum:
            - adaptive
            - '16:9'
            - '21:9'
            - '4:3'
            - '1:1'
            - '3:4'
            - '9:16'
          default: adaptive
          example: adaptive
        callback_url:
          type: string
          description: |-
            任务完成后的 HTTPS 回调地址

            **回调时机：**
            - 任务完成（completed）或失败（failed）时触发
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
          format: uri
          example: https://your-domain.com/webhooks/video-task-completed
          pattern: ^https://
      additionalProperties: false
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
          example: minimax-h3-reference-to-video
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
          description: 任务是否可以取消。Minimax H3 任务不支持取消，始终为 `false`。
          example: false
          enum:
            - false
          default: false
        estimated_time:
          type: integer
          description: 预估完成时间（秒）
          minimum: 0
          example: 165
        video_duration:
          type: integer
          description: 视频时长（秒）
          example: 4
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
          example: 44.2
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

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.