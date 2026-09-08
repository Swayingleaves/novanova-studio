> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes 2.5 Flash

> Agnes 2.0 Flash 基础上的全量升级模型，优化编码专项能力、智能体工作流、工具调用和多模态理解体验。

<Info>
  Agnes 2.5 Flash 是基于 Agnes 2.0 Flash 升级的全量可用语言模型。它沿用 OpenAI 兼容的 Chat Completions 接入方式，同时在编码任务、智能体工作流、工具调用、多轮对话、推理和图像理解体验上进行了优化。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-2.5-flash`
  </Card>

  <Card title="API Endpoints" icon="link">
    Chat Completions：`POST /v1/chat/completions`

    <br />

    Responses：`POST /v1/responses`

    <br />

    Messages：`POST /v1/messages`
  </Card>

  <Card title="发布状态" icon="flask">
    已全量上线，面向具备 Agnes API 访问权限的用户开放。
  </Card>

  <Card title="升级路径" icon="arrow-up">
    与已废弃的 `agnes-2.0-flash` API 兼容，便于迁移。
  </Card>

  <Card title="人民币价格" icon="tag">
    输入：~~¥0.20 / 百万 Token~~ `¥0 / 百万 Token`；输出：~~¥1.00 / 百万 Token~~ `¥0 / 百万 Token`。
  </Card>
</CardGroup>

## 概述

Agnes 2.5 Flash 面向已经接入 Agnes 2.0 Flash 的开发者设计。大多数场景下，你只需要把请求中的 `model` 值替换为 `agnes-2.5-flash`；Base URL、Endpoint、请求头、消息格式、流式响应格式、工具调用格式和图像 URL 输入格式保持不变。

该模型重点提升开发者体验、指令遵循稳定性、多轮输出一致性，以及代码生成、调试、重构、解释和智能体编码工作流等代码专项能力。

<Tip>
  直接使用 `agnes-2.5-flash` 作为模型名称。`agnes-2.0-flash` 已废弃，现有集成应尽快完成迁移。
</Tip>

## 核心能力

<CardGroup cols={2}>
  <Card title="聊天补全" icon="message">
    为对话、应用和业务系统生成高质量响应。
  </Card>

  <Card title="多轮对话" icon="comments">
    在连续交互中保持上下文一致性。
  </Card>

  <Card title="图像 URL 输入" icon="link">
    支持通过公开可访问的图像 URL 输入视觉内容。
  </Card>

  <Card title="图像理解" icon="eye">
    可用于截图分析、图像描述、视觉问答和信息提取。
  </Card>

  <Card title="工具调用" icon="wrench">
    支持函数调用和外部工具编排。
  </Card>

  <Card title="智能体工作流" icon="robot">
    优化规划、执行、上下文跟踪和多步骤任务完成体验。
  </Card>

  <Card title="代码专项任务" icon="code">
    针对代码生成、调试、重构、解释和补丁式开发工作流进行优化。
  </Card>

  <Card title="流式输出" icon="bolt">
    支持实时返回响应，提升交互体验。
  </Card>
</CardGroup>

## 适用场景

<CardGroup cols={2}>
  <Card title="AI 助手" icon="robot">
    通用问答、效率助手、个人助理和应用内 Copilot。
  </Card>

  <Card title="自主智能体" icon="diagram-project">
    多步骤任务执行、规划、工具使用和工作流调度。
  </Card>

  <Card title="编码助手" icon="laptop-code">
    代码生成、Bug 排查、重构建议、代码审查、测试生成和代码解释。
  </Card>

  <Card title="客户支持" icon="headset">
    FAQ 自动回复、客服机器人和服务自动化。
  </Card>

  <Card title="搜索与问答" icon="magnifying-glass">
    基于检索的问答、摘要生成和信息提取。
  </Card>

  <Card title="图像理解" icon="image">
    截图分析、图片描述、视觉问答和结构化提取。
  </Card>
</CardGroup>

## 从 Agnes 2.0 Flash 升级

如果你已经在调用 `agnes-2.0-flash`，升级到 2.5 Flash 的改动很小。

| 项目        | Agnes 2.0 Flash（已废弃）             | Agnes 2.5 Flash              |
| --------- | -------------------------------- | ---------------------------- |
| Endpoint  | `POST /v1/chat/completions`      | `POST /v1/chat/completions`  |
| Base URL  | `https://api.agnes-ai.cn/v1`     | `https://api.agnes-ai.cn/v1` |
| 模型名称      | `agnes-2.0-flash`                | `agnes-2.5-flash`            |
| 消息格式      | OpenAI 兼容 `messages`             | 相同                           |
| 流式响应      | `stream: true`                   | 相同                           |
| 工具调用      | `tools` 和 `tool_choice`          | 相同                           |
| 图像 URL 输入 | `messages[].content[].image_url` | 相同                           |

<Tip>
  对已有集成来说，迁移通常只需要替换模型名称。请勿继续将已废弃的 `agnes-2.0-flash` 作为兼容回退。
</Tip>

## API Reference

### Endpoint

```text theme={null}
POST https://api.agnes-ai.cn/v1/chat/completions
```

### 请求头

```bash theme={null}
-H "Authorization: Bearer YOUR_API_KEY"
-H "Content-Type: application/json"
```

### 请求参数

| 参数                     | 类型              | 必填 | 说明                                          |
| ---------------------- | --------------- | -- | ------------------------------------------- |
| `model`                | string          | 是  | 模型名称，使用 `agnes-2.5-flash`。                  |
| `messages`             | array           | 是  | 对话消息数组，包含 `system`、`user` 和 `assistant` 消息。 |
| `messages[].content`   | string / array  | 是  | 可为纯文本，也可为包含 `text` 和 `image_url` 的内容块数组。    |
| `temperature`          | number          | 否  | 控制输出随机性。值越低，结果越确定。                          |
| `top_p`                | number          | 否  | 控制核采样。值越低，输出越聚焦。                            |
| `max_tokens`           | number          | 否  | 响应中生成的最大 token 数量。                          |
| `stream`               | boolean         | 否  | 是否启用流式输出。                                   |
| `tools`                | array           | 否  | 工具调用工作流的工具定义。                               |
| `tool_choice`          | string / object | 否  | 控制模型是否使用工具以及如何使用工具。                         |
| `chat_template_kwargs` | object          | 否  | OpenAI 兼容请求中启用 Thinking 等扩展能力。              |
| `thinking`             | object          | 否  | Anthropic 兼容请求中启用 Thinking 模式。              |

## 图像 URL 输入

Agnes 2.5 Flash 支持在同一个 `messages` 请求中同时传入文本和图像 URL。

| 输入类型   | 格式          | 说明                     |
| ------ | ----------- | ---------------------- |
| 文本     | `text`      | 纯文本指令或问题。              |
| 图像 URL | `image_url` | 通过公开可访问的图像 URL 传递图像内容。 |

```json theme={null}
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Describe the content of this image."
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/image.jpg"
      }
    }
  ]
}
```

## 请求示例

<Tabs>
  <Tab title="基础聊天">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-flash",
        "messages": [
          {
            "role": "system",
            "content": "You are a helpful AI assistant."
          },
          {
            "role": "user",
            "content": "Explain how autonomous agents use tools to complete tasks."
          }
        ],
        "temperature": 0.7,
        "max_tokens": 1024
      }'
    ```
  </Tab>

  <Tab title="流式输出">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-flash",
        "messages": [
          {
            "role": "user",
            "content": "Write a short product introduction for an AI assistant app."
          }
        ],
        "stream": true
      }'
    ```
  </Tab>

  <Tab title="工具调用">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-flash",
        "messages": [
          {
            "role": "user",
            "content": "What is the weather like in Singapore today?"
          }
        ],
        "tools": [
          {
            "type": "function",
            "function": {
              "name": "get_weather",
              "description": "Get the current weather for a location",
              "parameters": {
                "type": "object",
                "properties": {
                  "location": {
                    "type": "string",
                    "description": "The city and country"
                  }
                },
                "required": ["location"]
              }
            }
          }
        ]
      }'
    ```
  </Tab>

  <Tab title="图像理解">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-flash",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": "Describe the content of this image."
              },
              {
                "type": "image_url",
                "image_url": {
                  "url": "https://example.com/image.jpg"
                }
              }
            ]
          }
        ]
      }'
    ```
  </Tab>
</Tabs>

## 响应格式

```json theme={null}
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1774432125,
  "model": "agnes-2.5-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Autonomous agents use tools by understanding the user's goal, breaking it into steps, selecting the right tools, executing actions, and using the results to complete the task."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 35,
    "completion_tokens": 58,
    "total_tokens": 93
  }
}
```

### 响应字段

| 字段                          | 类型      | 说明                          |
| --------------------------- | ------- | --------------------------- |
| `id`                        | string  | 补全请求的唯一 ID。                 |
| `object`                    | string  | 对象类型，通常为 `chat.completion`。 |
| `created`                   | integer | 请求时间戳。                      |
| `model`                     | string  | 请求使用的模型。                    |
| `choices`                   | array   | 生成结果列表。                     |
| `choices[].message.role`    | string  | 消息发送者角色。                    |
| `choices[].message.content` | string  | 模型生成内容。                     |
| `choices[].finish_reason`   | string  | 生成停止原因。                     |
| `usage`                     | object  | Token 使用信息。                 |

## Responses API

除 Chat Completions 外，该模型还支持 OpenAI Responses API。使用 `input` 代替 `messages` 传递输入。

### Responses Endpoint

```text theme={null}
POST https://api.agnes-ai.cn/v1/responses
```

### Responses 请求参数

| 参数                  | 类型             | 必填 | 说明                                        |
| ------------------- | -------------- | -- | ----------------------------------------- |
| `model`             | string         | 是  | 模型名称，使用 `agnes-2.5-flash`。                |
| `input`             | string / array | 是  | 纯文本 Prompt 或结构化输入消息数组。                    |
| `max_output_tokens` | integer        | 否  | 最大输出预算。推理模型建议设置较大值，避免响应状态变为 `incomplete`。 |

<Tabs>
  <Tab title="文本输入">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/responses \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-flash",
        "input": "Explain how autonomous agents use tools.",
        "max_output_tokens": 1024
      }'
    ```
  </Tab>

  <Tab title="结构化输入">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/responses \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-flash",
        "input": [
          {
            "role": "user",
            "content": [
              {
                "type": "input_text",
                "text": "Explain how autonomous agents use tools."
              }
            ]
          }
        ],
        "max_output_tokens": 1024
      }'
    ```
  </Tab>
</Tabs>

### Responses 输出格式

```json theme={null}
{
  "id": "resp_xxx",
  "object": "response",
  "status": "completed",
  "model": "agnes-2.5-flash",
  "output": [
    {
      "type": "reasoning",
      "summary": []
    },
    {
      "type": "message",
      "role": "assistant",
      "status": "completed",
      "content": [
        {
          "type": "output_text",
          "text": "Autonomous agents use tools to retrieve data and perform actions."
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 40,
    "output_tokens": 80,
    "total_tokens": 120
  },
  "error": null,
  "incomplete_details": null
}
```

| 字段                        | 类型            | 说明                                      |
| ------------------------- | ------------- | --------------------------------------- |
| `id`                      | string        | 响应的唯一 ID。                               |
| `object`                  | string        | 对象类型，通常为 `response`。                    |
| `status`                  | string        | 响应状态，例如 `completed` 或 `incomplete`。     |
| `output`                  | array         | 有序输出项，包括 reasoning 和 assistant message。 |
| `output[].type`           | string        | 输出项类型，例如 `reasoning` 或 `message`。       |
| `output[].content[].type` | string        | 内容类型；模型生成文本使用 `output_text`。            |
| `output[].content[].text` | string        | 模型生成的正文。                                |
| `usage`                   | object        | Token 使用信息。                             |
| `error`                   | object / null | 请求失败时的错误详情。                             |
| `incomplete_details`      | object / null | 响应提前停止时的原因。                             |

<Warning>
  当前响应不包含顶层 `output_text` 便捷字段。请从 `output[].type` 为 `message`、且 `output[].content[].type` 为 `output_text` 的内容块中读取生成文本。
</Warning>

<Note>
  Reasoning 输出是可选项，可能位于 `content[].reasoning_text`，也可能位于 `summary[].summary_text`。不同模型的 Token 字段命名也可能不同，客户端应同时兼容 `input_tokens` / `output_tokens` 与 `prompt_tokens` / `completion_tokens`。
</Note>

<Tip>
  如果 `status` 为 `incomplete`，请检查 `incomplete_details`，并使用更大的 `max_output_tokens` 重试。推理模型可能在输出回答正文前消耗一部分输出预算。
</Tip>

## Messages API

该模型还支持 Anthropic 兼容的 Messages API。使用 `messages` 传递对话输入，并通过 `x-api-key` 完成认证。

### Messages Endpoint

```text theme={null}
POST https://api.agnes-ai.cn/v1/messages
```

### Messages 请求头

```bash theme={null}
-H "x-api-key: YOUR_API_KEY"
-H "anthropic-version: 2023-06-01"
-H "Content-Type: application/json"
```

### Messages 请求参数

| 参数                   | 类型             | 必填 | 说明                                 |
| -------------------- | -------------- | -- | ---------------------------------- |
| `model`              | string         | 是  | 模型名称，使用 `agnes-2.5-flash`。         |
| `max_tokens`         | integer        | 是  | 最大输出 Token 数量。推理模型建议设置较大值。         |
| `messages`           | array          | 是  | 对话消息数组，支持 `user` 和 `assistant` 角色。 |
| `messages[].role`    | string         | 是  | 消息角色，使用 `user` 或 `assistant`。      |
| `messages[].content` | string / array | 是  | 纯文本或 Anthropic 兼容的内容块数组。           |
| `system`             | string / array | 否  | 请求使用的系统指令。                         |
| `temperature`        | number         | 否  | 控制输出随机性。                           |
| `stream`             | boolean        | 否  | 是否返回流式响应。                          |

### Messages 请求示例

```bash theme={null}
curl https://api.agnes-ai.cn/v1/messages \
  -H "x-api-key: YOUR_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-2.5-flash",
    "max_tokens": 1024,
    "system": "You are a helpful AI assistant.",
    "messages": [
      {
        "role": "user",
        "content": "Explain how autonomous agents use tools."
      }
    ]
  }'
```

### Messages 响应格式

```json theme={null}
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "model": "agnes-2.5-flash",
  "content": [
    {
      "type": "text",
      "text": "Autonomous agents use tools to retrieve information and perform actions."
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 290,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "output_tokens": 28
  }
}
```

| 字段                                  | 类型      | 说明                                   |
| ----------------------------------- | ------- | ------------------------------------ |
| `id`                                | string  | 消息的唯一 ID。                            |
| `type`                              | string  | 对象类型，通常为 `message`。                  |
| `role`                              | string  | 响应角色，通常为 `assistant`。                |
| `model`                             | string  | 请求使用的模型。                             |
| `content`                           | array   | 有序响应内容块。                             |
| `content[].type`                    | string  | 内容块类型；生成文本使用 `text`。                 |
| `content[].text`                    | string  | 模型生成的正文。                             |
| `stop_reason`                       | string  | 生成停止原因，例如 `end_turn` 或 `max_tokens`。 |
| `usage.input_tokens`                | integer | 输入 Token 数量。                         |
| `usage.output_tokens`               | integer | 输出 Token 数量。                         |
| `usage.cache_creation_input_tokens` | integer | 写入 Prompt 缓存的输入 Token 数量。            |
| `usage.cache_read_input_tokens`     | integer | 从 Prompt 缓存读取的输入 Token 数量。           |

<Note>
  请从 `content[].type` 为 `text` 的内容块读取生成正文。如果 `stop_reason` 为 `max_tokens`，请提高 `max_tokens` 后重试。
</Note>

## Thinking 模式

对于编码、调试、推理和智能体工作流，可以启用 Thinking 模式以提升任务分解和问题解决能力。

<Tabs>
  <Tab title="OpenAI 兼容格式">
    ```json theme={null}
    {
      "model": "agnes-2.5-flash",
      "messages": [
        {
          "role": "user",
          "content": "Help me write a Python script to process a CSV file."
        }
      ],
      "chat_template_kwargs": {
        "enable_thinking": true
      }
    }
    ```
  </Tab>

  <Tab title="Anthropic 兼容格式">
    ```json theme={null}
    {
      "model": "agnes-2.5-flash",
      "messages": [
        {
          "role": "user",
          "content": "Help me refactor this TypeScript function and explain the changes."
        }
      ],
      "thinking": {
        "type": "enabled",
        "budget_tokens": 2048
      }
    }
    ```
  </Tab>
</Tabs>

<Tip>
  常规编码任务建议从 `budget_tokens: 2048` 开始；复杂调试、重构或多步骤智能体任务可适当提高预算。
</Tip>

## 最佳实践

<AccordionGroup>
  <Accordion title="提示词结构">
    ```text theme={null}
    [角色] + [任务] + [上下文] + [要求] + [输出格式]
    ```
  </Accordion>

  <Accordion title="产品文案生成">
    ```text theme={null}
    You are a product marketing expert. Write a concise App Store description for an AI assistant app. The tone should be clear, professional, and user-friendly.
    ```
  </Accordion>

  <Accordion title="编码任务">
    ```text theme={null}
    Help me debug this React component. The issue is that the button state does not update after clicking. Explain the cause and provide the corrected code.
    ```
  </Accordion>

  <Accordion title="智能体工作流">
    ```text theme={null}
    You are an autonomous research agent. Search for relevant information, summarize the key findings, and return the result in a structured format with source links.
    ```
  </Accordion>

  <Accordion title="图像理解任务">
    ```text theme={null}
    Analyze this screenshot. Identify the main UI elements, explain the possible issue, and provide suggestions to improve the user experience.
    ```
  </Accordion>
</AccordionGroup>

## 限制与价格

Agnes 2.5 Flash 已全量上线。可用性、速率限制和计费规则以你的 Agnes AI 账户和 API Key 权限为准。

| 项目    | 数值      |
| ----- | ------- |
| 上下文窗口 | `512K`  |
| 最大输出  | `65.5K` |

| 类型       |                   原价 |              现价 |
| -------- | -------------------: | --------------: |
| 输入 Token | ~~¥0.20 / 百万 Token~~ | `¥0 / 百万 Token` |
| 输出 Token | ~~¥1.00 / 百万 Token~~ | `¥0 / 百万 Token` |

## 接入检查清单

<Check>
  使用 `agnes-2.5-flash` 作为模型名称。
</Check>

<Check>
  基础聊天补全请求必须包含 `model` 和 `messages`。
</Check>

<Check>
  图像输入需要使用公开可访问的 `image_url`。
</Check>

<Check>
  流式响应请将 `stream` 设置为 `true`。
</Check>
