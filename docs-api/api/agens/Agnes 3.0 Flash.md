> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes 3.0 Flash

> Agnes AI 全新一代文本模型，强化 Agnes Code 任务执行、工具编排与可信交付能力。

<Info>
  Agnes 3.0 Flash 是 Agnes AI 推出的全新一代升级文本模型，面向 Agent 编程与工具驱动任务，重点提升复杂任务的端到端执行质量。价格待公布。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-3.0-flash`
  </Card>

  <Card title="API Endpoints" icon="link">
    Chat Completions：`POST /v1/chat/completions`

    <br />

    Responses：`POST /v1/responses`

    <br />

    Messages：`POST /v1/messages`
  </Card>

  <Card title="模型类型" icon="brain">
    新一代文本模型，支持文本和图像 URL 输入。
  </Card>

  <Card title="核心方向" icon="bolt">
    聚焦稳定执行、可靠工具调用、长任务上下文保持与高质量交付。
  </Card>

  <Card title="定价" icon="tags">
    价格待公布。
  </Card>
</CardGroup>

## 概述

Agnes 3.0 Flash 面向真实的 Agent 任务和开发工作流而设计，覆盖从任务理解、规划、工具调用到最终交付的完整执行链路。模型重点改善复杂任务中的稳定性、指令遵循、事实依据和输出完整性，帮助开发者构建更可靠的智能体应用。

使用以下 API 信息接入模型：

| 项目               | 数值                           |
| ---------------- | ---------------------------- |
| Base URL         | `https://api.agnes-ai.cn/v1` |
| Chat Completions | `POST /v1/chat/completions`  |
| Responses API    | `POST /v1/responses`         |
| Messages API     | `POST /v1/messages`          |
| 模型名称             | `agnes-3.0-flash`            |
| 输入模态             | 文本、图像 URL                    |
| 输出模态             | 文本                           |
| 价格               | 待公布                          |

## 核心方向

<CardGroup cols={2}>
  <Card title="Agnes Code 任务执行" icon="terminal">
    更适配 Agnes Code 与代码智能体工作流，强化从理解需求到完成交付的任务执行能力。
  </Card>

  <Card title="工具调用与编排" icon="wrench">
    增强函数调用、工具选择和多步骤工具编排能力，让智能体执行更稳定。
  </Card>

  <Card title="指令与上下文遵循" icon="list-check">
    在长任务和多轮执行中持续遵循目标、限制条件与运行上下文。
  </Card>

  <Card title="可信交付" icon="shield-check">
    强化事实依据、结果确认和输出完整性，减少无依据结论与错误完成确认。
  </Card>
</CardGroup>

## 能力亮点

<AccordionGroup>
  <Accordion title="更可靠的端到端任务交付">
    强化任务规划、执行和结果确认，在复杂 Agent 任务中更注重真实完成与最终交付质量。
  </Accordion>

  <Accordion title="更稳定的工具编排">
    更准确地理解工具定义、选择合适的工具并组织多步骤调用，减少无效调用、重复调用和异常循环。
  </Accordion>

  <Accordion title="更强的指令与上下文遵循">
    在长任务和多轮执行中持续关注原始目标、限制条件与运行上下文，降低任务偏离和关键要求遗漏。
  </Accordion>

  <Accordion title="更可信的执行结果">
    重视工具结果与事实依据，减少缺乏依据的结论和未完成任务的错误确认，使执行状态更透明可信。
  </Accordion>

  <Accordion title="更完整、干净的输出">
    改善重复内容、异常文本和不必要的内部推理暴露，让最终回复更连贯、清晰并适合直接交付。
  </Accordion>
</AccordionGroup>

<Note>
  Agnes 3.0 Flash 的公开评测与榜单信息将在正式发布后更新。
</Note>

## Chat Completions API

### Endpoint 与请求头

```text theme={null}
POST https://api.agnes-ai.cn/v1/chat/completions
```

```bash theme={null}
-H "Authorization: Bearer YOUR_API_KEY"
-H "Content-Type: application/json"
```

### 请求字段

Agnes 3.0 Flash 支持以下请求字段。

| 字段                     | 类型              | 必填 | 说明                                          |
| ---------------------- | --------------- | -- | ------------------------------------------- |
| `model`                | string          | 是  | 使用 `agnes-3.0-flash`。                       |
| `messages`             | array           | 是  | 对话消息数组，包含 `system`、`user` 和 `assistant` 角色。 |
| `messages[].content`   | string / array  | 是  | 纯文本，或包含 `text`、`image_url` 的内容块数组。          |
| `temperature`          | number          | 否  | 控制输出随机性。                                    |
| `top_p`                | number          | 否  | 控制核采样。                                      |
| `max_tokens`           | integer         | 否  | 最大输出 Token 数。                               |
| `stream`               | boolean         | 否  | 设为 `true` 时返回流式响应。                          |
| `tools`                | array           | 否  | 用于函数调用工作流的工具定义。                             |
| `tool_choice`          | string / object | 否  | 控制模型是否使用工具以及如何使用。                           |
| `chat_template_kwargs` | object          | 否  | Thinking 等兼容扩展能力的扩展字段。                      |

## 图像 URL 输入

在 `messages[].content` 中，将公开可访问的图像 URL 与文本一起传入。

```json theme={null}
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "请描述这张图片中的关键信息。"
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

### 基础请求

```bash theme={null}
curl https://api.agnes-ai.cn/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-3.0-flash",
    "messages": [
      {
        "role": "user",
        "content": "请说明智能体应如何选择并调用工具。"
      }
    ],
    "max_tokens": 1024
  }'
```

### 响应格式

Chat Completions 响应使用 OpenAI 兼容结构：

```json theme={null}
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "model": "agnes-3.0-flash",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "智能体应根据任务和工具声明的能力选择工具。"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 24,
    "completion_tokens": 18,
    "total_tokens": 42
  }
}
```

### 工具调用请求

```json theme={null}
{
  "model": "agnes-3.0-flash",
  "messages": [
    {
      "role": "user",
      "content": "上海现在的天气怎么样？"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "获取指定城市当前天气。",
        "parameters": {
          "type": "object",
          "properties": {
            "city": { "type": "string" }
          },
          "required": ["city"]
        }
      }
    }
  ]
}
```

从 `choices[].message.content` 读取生成文本。模型返回工具调用时，读取 `choices[].message.tool_calls`，在你的应用中执行相应函数，将结果追加到 `messages` 后发起下一次 Chat Completions 请求。

## Responses API

Responses API 使用 `input` 传入文本或结构化消息。

```text theme={null}
POST https://api.agnes-ai.cn/v1/responses
```

```bash theme={null}
curl https://api.agnes-ai.cn/v1/responses \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-3.0-flash",
    "input": "总结这个任务，并列出完成它需要的工具。",
    "max_output_tokens": 1024
  }'
```

| 字段                  | 类型             | 必填 | 说明                    |
| ------------------- | -------------- | -- | --------------------- |
| `model`             | string         | 是  | 使用 `agnes-3.0-flash`。 |
| `input`             | string / array | 是  | 纯文本提示词或结构化输入消息。       |
| `max_output_tokens` | integer        | 否  | 最大输出预算。               |

从 `output` 中类型为 `message` 的项读取生成内容，其中 `output[].content[].type` 为 `output_text`。响应对象还可能包含 `usage`、`error` 和 `incomplete_details`。

## Messages API

Agnes 3.0 Flash 支持 Anthropic 兼容 Messages API。

```text theme={null}
POST https://api.agnes-ai.cn/v1/messages
```

```bash theme={null}
curl https://api.agnes-ai.cn/v1/messages \
  -H "x-api-key: YOUR_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-3.0-flash",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "请起草一份简洁的产品公告，并列出后续行动。"
      }
    ]
  }'
```

| 字段                   | 类型             | 必填 | 说明                              |
| -------------------- | -------------- | -- | ------------------------------- |
| `model`              | string         | 是  | 使用 `agnes-3.0-flash`。           |
| `max_tokens`         | integer        | 是  | 最大输出 Token 预算。                  |
| `messages`           | array          | 是  | 含 `user` 与 `assistant` 角色的消息数组。 |
| `messages[].content` | string / array | 是  | 纯文本或 Anthropic 兼容的内容块。          |
| `system`             | string / array | 否  | 系统指令。                           |
| `temperature`        | number         | 否  | 控制输出随机性。                        |
| `stream`             | boolean        | 否  | 设为 `true` 时返回流式响应。              |

从 `content[]` 中 `content[].type` 为 `text` 的内容块读取生成文本。

## Thinking 模式

需要更充分的任务拆解或推理时，可启用 Thinking 模式。

<Tabs>
  <Tab title="OpenAI 兼容格式">
    ```json theme={null}
    {
      "model": "agnes-3.0-flash",
      "messages": [
        {
          "role": "user",
          "content": "请规划此仓库任务的实现步骤。"
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
      "model": "agnes-3.0-flash",
      "max_tokens": 2048,
      "messages": [
        {
          "role": "user",
          "content": "请规划此仓库任务的实现步骤。"
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

## 最佳实践

<AccordionGroup>
  <Accordion title="Agnes Code 与智能体任务">
    明确任务目标、仓库或运行环境上下文、限制条件、预期输出和工具权限。执行完工具后，应将工具结果返回对话，再请求模型给出下一步动作。
  </Accordion>

  <Accordion title="工具调用">
    工具描述与 JSON Schema 应保持精确、聚焦。在应用侧执行会产生副作用的操作前，应先校验工具参数。
  </Accordion>

  <Accordion title="长任务执行">
    将复杂任务拆分为可验证的阶段，并在每轮执行中保留目标、限制条件和关键工具结果。
  </Accordion>
</AccordionGroup>

<Note>
  打榜数据将另行公布。模型可用性、速率限制和计费以你的 Agnes AI 账户与 API Key 权限为准。
</Note>

## 限制与价格

Agnes 3.0 Flash 的价格**待公布**；模型可用性、速率限制和计费信息请以你的 Agnes AI 账户与后续平台公告为准。
