> ## Documentation Index
> Fetch the complete documentation index at: https://evolink.ai/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Nanobanana 2.1 图像生成

> - Nano Banana 2.1 (gemini-nano-banana-2.1) 模型支持文本转图片、图生图、图像编辑、多图合成等多种生成模式，可输出 `1K`、`2K`、`4K` 三档分辨率
- 异步处理模式，使用返回的任务ID  [进行查询](/cn/api-manual/task-management/get-task-detail)
- 生成的图像链接，有效期为24小时，请尽快保存
- 计费：输出图按分辨率档位计费，输入图按张计费，联网搜索与图片搜索按实际搜索次数计费，提示词文本、文本输出与思考按 token 计费；实际扣费以任务查询返回的 `usage` 为准



## OpenAPI

````yaml cn/api-manual/image-series/nanobanana/nanobanana-2.1/nanobanana-2.1-image-generate.json POST /v1/images/generations
openapi: 3.1.0
info:
  title: Nano Banana 2.1接口
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
      summary: Nano Banana 2.1接口
      description: >-
        - Nano Banana 2.1 (gemini-nano-banana-2.1)
        模型支持文本转图片、图生图、图像编辑、多图合成等多种生成模式，可输出 `1K`、`2K`、`4K` 三档分辨率

        - 异步处理模式，使用返回的任务ID 
        [进行查询](/cn/api-manual/task-management/get-task-detail)

        - 生成的图像链接，有效期为24小时，请尽快保存

        - 计费：输出图按分辨率档位计费，输入图按张计费，联网搜索与图片搜索按实际搜索次数计费，提示词文本、文本输出与思考按 token
        计费；实际扣费以任务查询返回的 `usage` 为准
      operationId: createImageGenerationNanoBanana21
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ImageGenerationRequest'
            examples:
              text_to_image:
                summary: 文本生成图像
                value:
                  model: gemini-nano-banana-2.1
                  prompt: 一只猫在草地上玩耍
                  size: '16:9'
                  quality: 2K
              image_edit:
                summary: 图生图 / 图像编辑
                value:
                  model: gemini-nano-banana-2.1
                  prompt: 把图中的猫换成一只柴犬，保持背景和光线不变
                  quality: 2K
                  image_urls:
                    - https://example.com/image1.png
              web_search:
                summary: 联网搜索后生成
                value:
                  model: gemini-nano-banana-2.1
                  prompt: 东京本周末的天气信息图，扁平风格，文字清晰可读
                  size: '16:9'
                  quality: 2K
                  model_params:
                    web_search: true
      responses:
        '200':
          description: 图像生成任务创建成功
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
                  message: 'Token does not have access to model: gemini-nano-banana-2.1'
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
          example: gemini-nano-banana-2.1
          enum:
            - gemini-nano-banana-2.1
          default: gemini-nano-banana-2.1
        prompt:
          type: string
          description: 提示词，描述想要生成的图像，或描述如何编辑已输入的图像，最多 `4000` token
          example: 一只猫在草地上玩耍
        size:
          type: string
          description: 生成图像的宽高比，默认值为`auto`
          enum:
            - auto
            - '1:1'
            - '1:4'
            - '4:1'
            - '1:8'
            - '8:1'
            - '2:3'
            - '3:2'
            - '3:4'
            - '4:3'
            - '4:5'
            - '5:4'
            - '9:16'
            - '16:9'
            - '21:9'
          default: auto
        quality:
          type: string
          description: |-
            生成图像的分辨率档位，默认为`2K`

            **注意：**
            - 不同档位价格不同，输出图按所选档位计费，建议显式传入
          enum:
            - 1K
            - 2K
            - 4K
          default: 2K
        image_urls:
          type: array
          description: >-
            参考图像URL列表，用于图生图、图像编辑与多图合成


            **注意：**

            - 单次请求支持输入图像数量：`14`张

            - 图像大小：不超过 `20MB`

            - 支持的文件格式：`.jpeg`、`.jpg`、`.png`、`.webp`

            -
            图像URL需要服务器能直接查看，或者图像URL在访问时会直接进行下载（一般这种URL是以图像的扩展名作为结尾，例如`.png`、`.jpg`）

            - 输入图像按张计费
          items:
            type: string
            format: uri
          maxItems: 14
          example:
            - https://example.com/image1.png
            - https://example.com/image2.png
        model_params:
          type: object
          description: 模型扩展参数
          properties:
            web_search:
              type: boolean
              description: |-
                是否启用联网搜索，默认为 `false`。启用后模型会在生成前查询网络上的最新信息

                **注意：**
                - 按模型实际执行的搜索次数计费，一次请求可能搜索多次
              default: false
              example: true
            image_search:
              type: boolean
              description: |-
                是否启用图片搜索，默认为 `false`。启用后模型会在生成前从网络检索图片作为视觉参考

                **注意：**
                - 按模型实际执行的搜索次数计费，一次请求可能搜索多次
              default: false
              example: true
            thinking_level:
              type: string
              description: |-
                思考推理级别，控制模型在生成图像前的推理深度，默认为 `auto`

                - `auto`：不指定，由模型自行决定
                - `min`：最少推理，速度最快
                - `medium`：均衡推理
                - `high`：深度推理

                **注意：**
                - 思考产生的 token 按文本输出计费
              enum:
                - auto
                - min
                - medium
                - high
              default: auto
              example: medium
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
          example: 1757165031
        id:
          type: string
          description: 任务ID
          example: task-unified-1757165031-uyujaw3d
        model:
          type: string
          description: 实际使用的模型名称
          example: gemini-nano-banana-2.1
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
          example: 45
    Usage:
      type: object
      description: 使用量和计费信息
      properties:
        billing_rule:
          type: string
          description: 计费规则
          enum:
            - per_call
            - per_image
            - per_token
            - per_second
          example: per_image
        credits_reserved:
          type: number
          description: 预估消耗积分数
          minimum: 0
          example: 3.0845
        user_group:
          type: string
          description: 用户所属计费分组
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