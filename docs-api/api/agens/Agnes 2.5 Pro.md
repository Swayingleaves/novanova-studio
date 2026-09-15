> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes 2.5 Pro

> Agnes 2.5 Pro Alpha 打榜模型的商业化稳定版本，面向高级编码、科学推理、长上下文分析、智能体工作流和多模态理解。

<Info>
  Agnes 2.5 Pro 是 Agnes 2.5 Pro Alpha 打榜模型的商业化稳定版本，适用于高级编码、科学推理、长上下文分析、智能体工作流和多模态理解。该模型通过 OpenAI 兼容的 Chat Completions API 接入。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-2.5-pro`
  </Card>

  <Card title="API Endpoints" icon="link">
    Chat Completions：`POST /v1/chat/completions`

    <br />

    Responses：`POST /v1/responses`

    <br />

    Messages：`POST /v1/messages`
  </Card>

  <Card title="模型类型" icon="brain">
    付费推理模型，支持文本和图像输入。
  </Card>

  <Card title="榜单参考" icon="chart-line">
    基于 Agnes 2.5 Pro Alpha 的 Artificial Analysis 打榜参考。
  </Card>
</CardGroup>

## 概述

Agnes 2.5 Pro 面向需要更强推理深度的生产任务，包括复杂代码任务、科学与数学推理、长上下文理解、知识密集型问答，以及智能体终端或工作流任务。

它与 Agnes 其他文本模型保持一致的基础接入方式：

| 项目       | 数值                           |
| -------- | ---------------------------- |
| Base URL | `https://api.agnes-ai.cn/v1` |
| Endpoint | `POST /v1/chat/completions`  |
| 模型名称     | `agnes-2.5-pro`              |
| 输入模态     | 文本、图像 URL                    |
| 输出模态     | 文本                           |
| 发布日期     | 2026 年 8 月 1 日               |
| 计费方式     | 付费模型                         |

<Note>
  Agnes 2.5 Pro Alpha 官方权重现已采用 Apache 2.0 许可证在 [Hugging Face](https://huggingface.co/Agnes-AI/Agnes-2.5-Pro-Alpha) 开源。Agnes 2.5 Pro 是基于该 Alpha 打榜模型提供的商业化稳定 API 模型。Artificial Analysis 的外部评测元数据可能随榜单更新而变化。
</Note>

## 核心能力

<CardGroup cols={2}>
  <Card title="高级推理" icon="brain">
    适合科学推理、知识密集型问题和多步骤分析。
  </Card>

  <Card title="编码与终端任务" icon="terminal">
    适用于代码生成、调试、重构、测试生成和智能体编码工作流。
  </Card>

  <Card title="长上下文分析" icon="file-lines">
    支持长文档、结构化上下文和多轮推理任务。
  </Card>

  <Card title="图像理解" icon="eye">
    支持图像 URL 输入，可用于视觉分析和多模态推理。
  </Card>

  <Card title="工具调用" icon="wrench">
    支持 OpenAI 兼容的函数调用和外部工具编排。
  </Card>

  <Card title="流式输出" icon="bolt">
    支持流式响应，适合交互式产品体验。
  </Card>
</CardGroup>

## Artificial Analysis 结果

以下指标基于 Agnes 2.5 Pro Alpha 打榜模型的 Artificial Analysis 数据。

| 摘要项                  | 数值          |
| -------------------- | ----------- |
| Intelligence 摘要排名    | `#9 / 153`  |
| Price 摘要排名           | `#46 / 153` |
| Cache hit price 摘要排名 | `#8 / 153`  |

| 指标                 |         得分 |
| ------------------ | ---------: |
| Intelligence Index |       `39` |
| GPQA               |    `87.6%` |
| SciCode            |    `42.2%` |
| LCR                |    `63.7%` |
| Omniscience        |    `-26.3` |
| Accuracy           |    `32.3%` |
| Non-hallucination  |    `13.3%` |
| CritPt             |    `10.9%` |
| HLE                |    `31.9%` |
| TerminalBench v2.1 |    `67.0%` |
| GDPval v2          | `1170 elo` |
| Tau3               |    `11.6%` |

<CardGroup cols={2}>
  <Card title="Artificial Analysis 模型页" icon="arrow-up-right" href="https://artificialanalysis.ai/models/agnes-2-5-pro-alpha">
    查看打榜模型介绍、摘要和价格分析。
  </Card>

  <Card title="Artificial Analysis 榜单" icon="chart-line" href="https://artificialanalysis.ai/models?models=mimo-v2-5-pro%2Cgemini-3-5-flash-lite%2Cinkling%2Cclaude-sonnet-5%2Cminimax-m3%2Ccommand-a-plus%2Cgpt-5-6-luna%2Ck2-think-v2%2Cnvidia-nemotron-3-ultra-550b-a55b%2Cqwen3-7-max%2Cgemini-3-6-flash%2Cgrok-4-5%2Cclaude-opus-4-8%2Cclaude-4-5-haiku-reasoning%2Cgemini-3-1-pro-preview%2Cgpt-5-6-terra%2Cdeepseek-v4-pro%2Cgemma-4-31b%2Cclaude-fable-5%2Cmuse-spark-1-1%2Cdeepseek-v4-flash%2Cgpt-5-6-sol%2Cmistral-medium-3-5%2Cgpt-5-5-pro%2Cgpt-oss-120b%2Cglm-5-2%2Ckimi-k3%2Cagnes-2-5-pro-alpha">
    将 Agnes 2.5 Pro Alpha 打榜模型与其他上榜模型对比。
  </Card>
</CardGroup>

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
| `model`                | string          | 是  | 模型名称，使用 `agnes-2.5-pro`。                    |
| `messages`             | array           | 是  | 对话消息数组，包含 `system`、`user` 和 `assistant` 消息。 |
| `messages[].content`   | string / array  | 是  | 可为纯文本，也可为包含 `text` 和 `image_url` 的内容块数组。    |
| `temperature`          | number          | 否  | 控制输出随机性。值越低，输出越确定。                          |
| `top_p`                | number          | 否  | 控制核采样。                                      |
| `max_tokens`           | number          | 否  | 响应中生成的最大 token 数量。                          |
| `stream`               | boolean         | 否  | 是否启用流式输出。                                   |
| `tools`                | array           | 否  | 工具调用工作流的工具定义。                               |
| `tool_choice`          | string / object | 否  | 控制模型是否使用工具以及如何使用工具。                         |
| `chat_template_kwargs` | object          | 否  | OpenAI 兼容请求扩展字段。                            |
| `thinking`             | object          | 否  | Anthropic 兼容请求中启用 Thinking 模式。              |

## 图像 URL 输入

Agnes 2.5 Pro 支持在同一个 `messages` 请求中传入文本和图像 URL。

```json theme={null}
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Analyze this architecture diagram and identify possible failure points."
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/diagram.png"
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
        "model": "agnes-2.5-pro",
        "messages": [
          {
            "role": "system",
            "content": "You are a precise technical assistant."
          },
          {
            "role": "user",
            "content": "Explain the tradeoffs between optimistic locking and pessimistic locking in distributed systems."
          }
        ],
        "temperature": 0.3,
        "max_tokens": 1200
      }'
    ```
  </Tab>

  <Tab title="编码任务">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-pro",
        "messages": [
          {
            "role": "user",
            "content": "Review this TypeScript API handler for security issues, explain the risks, and provide a corrected version."
          }
        ],
        "temperature": 0.2,
        "max_tokens": 2000
      }'
    ```
  </Tab>

  <Tab title="流式输出">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-pro",
        "messages": [
          {
            "role": "user",
            "content": "Create a step-by-step migration plan for moving a monolith to services."
          }
        ],
        "stream": true
      }'
    ```
  </Tab>

  <Tab title="图像理解">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/chat/completions \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-pro",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": "Summarize this chart and call out any anomalies."
              },
              {
                "type": "image_url",
                "image_url": {
                  "url": "https://example.com/chart.png"
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
  "created": 1784899200,
  "model": "agnes-2.5-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 300,
    "total_tokens": 420
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
| `model`             | string         | 是  | 模型名称，使用 `agnes-2.5-pro`。                  |
| `input`             | string / array | 是  | 纯文本 Prompt 或结构化输入消息数组。                    |
| `max_output_tokens` | integer        | 否  | 最大输出预算。推理模型建议设置较大值，避免响应状态变为 `incomplete`。 |

<Tabs>
  <Tab title="文本输入">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/responses \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-2.5-pro",
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
        "model": "agnes-2.5-pro",
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
  "model": "agnes-2.5-pro",
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
| `model`              | string         | 是  | 模型名称，使用 `agnes-2.5-pro`。           |
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
    "model": "agnes-2.5-pro",
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
  "model": "agnes-2.5-pro",
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

## 限制与价格

Agnes 2.5 Pro 是付费商业化稳定模型，按输入缓存命中、输入缓存未命中和输出 Token 计费。

| 项目        | 数值              |
| --------- | --------------- |
| 上下文窗口     | `1M` tokens     |
| 最大输出长度    | `65536` tokens  |
| 输入模态      | 文本、图像           |
| 输出模态      | 文本              |
| Reasoning | 是               |
| 模型权重      | Proprietary，非开源 |

| 类型     |              人民币价格 |
| ------ | -----------------: |
| 输入缓存命中 | `¥0.30 / 百万 Token` |
| 输入     | `¥3.00 / 百万 Token` |
| 输出     | `¥6.00 / 百万 Token` |

<Note>
  输入缓存命中单价为普通输入 Token 单价的 10%。价格和可用性可能受账户、地区、计费配置或后续价格更新影响。请以 Agnes AI 平台控制台中展示的账户价格为准。
</Note>

## 最佳实践

<AccordionGroup>
  <Accordion title="高推理任务">
    当任务更关注正确性和多步骤推理，而不是极低延迟时，建议使用 Agnes 2.5 Pro，例如科学推理、复杂策略分析和长篇技术规划。
  </Accordion>

  <Accordion title="编码任务">
    提供目标语言、框架、已有代码、错误信息、期望行为和约束条件。复杂问题建议先要求模型分析根因，再给出修复补丁。
  </Accordion>

  <Accordion title="长上下文任务">
    在 Prompt 中使用结构化章节、文件名或文档标签，帮助模型引用来源并生成可追踪的结论。
  </Accordion>
</AccordionGroup>

## 接入检查清单

<Check>
  使用 `agnes-2.5-pro` 作为模型名称。
</Check>

<Check>
  确认你的账户已开通 Agnes 2.5 Pro 付费商业化稳定模型访问权限。
</Check>

<Check>
  基础聊天补全请求必须包含 `model` 和 `messages`。
</Check>

<Check>
  图像输入需要使用公开可访问的 `image_url`。
</Check>

<Check>
  该模型为付费模型，请跟踪输入缓存命中、输入缓存未命中和输出 Token 使用量。
</Check>
