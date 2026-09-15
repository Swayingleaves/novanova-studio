> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes Video 2.5

> 使用 OpenAI Videos 兼容 API 接入 Agnes Video 2.5，支持文生视频、首尾帧控制和多模态参考生成。

<Info>
  Agnes Video 2.5 已在中国站上线，使用异步视频生成 API。先调用 `POST /v1/videos` 创建任务，再使用返回的 `id` 调用 `GET /agnesapi?video_id=<VIDEO_ID>` 查询进度和结果。当前限免内容请参阅下方“计费规则”。
</Info>

<CardGroup cols={2}>
  <Card title="模型 ID" icon="cube">
    `agnes-video-2.5`
  </Card>

  <Card title="创建任务" icon="video">
    `POST /v1/videos`
  </Card>

  <Card title="查询任务" icon="clock">
    `GET /agnesapi?video_id=<VIDEO_ID>`
  </Card>

  <Card title="价格" icon="tag">
    720P 刊例价 `¥0.15 / 秒`；当前仅计算输出视频秒数。
  </Card>
</CardGroup>

## 核心能力

<CardGroup cols={2}>
  <Card title="文生视频" icon="clapperboard">
    使用文本描述生成包含主体动作、环境动态和镜头运动的视频。
  </Card>

  <Card title="首尾帧控制" icon="images">
    使用首帧、尾帧或首尾帧共同约束视频的构图与过渡。
  </Card>

  <Card title="多模态参考" icon="layer-group">
    支持将图片、音频和视频作为内容、风格、节奏或运动参考。
  </Card>

  <Card title="视频参考生成" icon="film">
    基于参考视频延续或重构动作、视觉表现和时序关系。
  </Card>

  <Card title="音画协同" icon="waveform">
    可结合音频或带音轨的视频参考，增强画面节奏与声音的一致性。
  </Card>

  <Card title="多画幅输出" icon="expand">
    支持横屏、竖屏、方形和超宽屏等常用画幅比例。
  </Card>
</CardGroup>

## 快速接入

### 1. 准备 API Key

从 Agnes AI 平台获取 API Key。请只在服务端保存和使用密钥，不要将密钥写入前端代码或公开仓库。

### 2. 设置 Base URL

中国站 Base URL：

```text theme={null}
https://api.agnes-ai.cn/v1
```

以下示例使用环境变量：

```bash theme={null}
export AGNES_API_KEY="YOUR_API_KEY"
export AGNES_BASE_URL="https://api.agnes-ai.cn/v1"
```

### 3. 创建视频任务

```bash theme={null}
curl -sS -X POST "$AGNES_BASE_URL/videos" \
  -H "Authorization: Bearer $AGNES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-video-2.5",
    "prompt": "雨后的未来城市街道，霓虹灯倒映在地面，一辆银色跑车缓慢驶过，电影级运镜，自然环境声",
    "seconds": "5",
    "mode": "text",
    "size": "720P",
    "aspect_ratio": "16:9"
  }'
```

创建成功后，响应中的 `id` 是后续查询所需的视频任务 ID。

### 4. 查询任务结果

```bash theme={null}
curl -sS "https://api.agnes-ai.cn/agnesapi?video_id=VIDEO_ID" \
  -H "Authorization: Bearer $AGNES_API_KEY"
```

建议每隔 `1–2` 秒查询一次，直至 `status` 变为 `completed` 或 `failed`。任务完成后，使用响应中的 `url` 播放或下载视频。

## API Reference

### 创建视频任务

```text theme={null}
POST https://api.agnes-ai.cn/v1/videos
```

请求头：

```http theme={null}
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### 通用请求参数

| 参数             | 类型      | 必填 | 说明                                                           |
| -------------- | ------- | -- | ------------------------------------------------------------ |
| `model`        | string  | 是  | 模型 ID，使用 `agnes-video-2.5`。                                  |
| `prompt`       | string  | 是  | 视频内容描述。参考模式可使用 `<Picture N>`、`<Audio N>`、`<Video N>` 指代输入素材。 |
| `mode`         | string  | 是  | 生成模式：`text`、`keyframe` 或 `reference`。                        |
| `seconds`      | string  | 否  | 视频时长，支持字符串 `"4"`–`"12"`，默认 `"5"`。                            |
| `size`         | string  | 否  | 输出档位，当前仅支持 `"720P"`。                                         |
| `aspect_ratio` | string  | 否  | 画幅比例，默认 `16:9`。支持值见下文。                                       |
| `seed`         | integer | 否  | 随机种子；传入相同种子可提高结果可复现性。                                        |
| `n`            | integer | 否  | 生成数量，当前仅支持 `1`，默认值为 `1`。                                     |

### 模式专用参数

| 参数            | 类型        | 适用模式        | 说明                               |
| ------------- | --------- | ----------- | -------------------------------- |
| `first_frame` | string    | `keyframe`  | 首帧图片 URL。与 `last_frame` 至少提供一个。  |
| `last_frame`  | string    | `keyframe`  | 尾帧图片 URL。与 `first_frame` 至少提供一个。 |
| `images`      | string\[] | `reference` | 参考图片 URL 列表。                     |
| `audios`      | string\[] | `reference` | 参考音频 URL 列表。                     |
| `videos`      | object\[] | `reference` | 参考视频列表。对象字段见下文。                  |

所有媒体 URL 都应当可由 Agnes AI 服务公开访问。请避免使用需要登录、带本地网络地址或即将过期的链接。

### 生成模式规则

| `mode`      | 用途               | 必需媒体                              | 不允许的媒体字段                                              |
| ----------- | ---------------- | --------------------------------- | ----------------------------------------------------- |
| `text`      | 纯文本生成视频          | 无                                 | `first_frame`、`last_frame`、`images`、`audios`、`videos` |
| `keyframe`  | 使用首帧、尾帧或首尾帧控制视频  | `first_frame` 与 `last_frame` 至少一个 | `images`、`audios`、`videos`                            |
| `reference` | 使用图片、音频或视频进行参考生成 | `images`、`audios`、`videos` 至少一类非空 | `first_frame`、`last_frame`                            |

<Tip>
  `keyframe` 会尽量将输入图片保持为成片的真实首帧或尾帧，适合控制起止构图；`reference` 将素材作为内容、风格、动作或节奏参考，生成结果可能重新构图或重新安排时序。
</Tip>

### 参考视频对象

`videos` 数组中的每个对象支持以下字段：

| 参数              | 类型      | 必填 | 说明                         |
| --------------- | ------- | -- | -------------------------- |
| `url`           | string  | 是  | 可公开访问的视频 URL。              |
| `start_seconds` | number  | 否  | 从参考视频的指定秒数开始读取，默认 `0`。     |
| `require_audio` | boolean | 否  | 是否要求参考视频必须包含音轨，默认 `false`。 |

当 `require_audio` 为 `false` 时，参考视频可以不包含音轨；若视频包含音轨，音轨也可参与参考。当该值为 `true` 时，片源必须带有音轨，否则请求会失败。

## 请求示例

<Tabs>
  <Tab title="文生视频">
    ```bash theme={null}
    curl -sS -X POST "$AGNES_BASE_URL/videos" \
      -H "Authorization: Bearer $AGNES_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-2.5",
        "prompt": "夜晚的森林中，三只猫组成微型铜管乐队向前行进，镜头平稳后退，月光穿过树叶，自然脚步声与乐器声",
        "seconds": "5",
        "mode": "text",
        "size": "720P",
        "aspect_ratio": "16:9",
        "seed": 1101
      }'
    ```
  </Tab>

  <Tab title="首尾帧控制">
    ```bash theme={null}
    curl -sS -X POST "$AGNES_BASE_URL/videos" \
      -H "Authorization: Bearer $AGNES_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-2.5",
        "prompt": "人物从首帧姿态自然转身走向窗边，衣物和头发运动真实，镜头缓慢推进，平滑过渡到尾帧构图",
        "seconds": "5",
        "mode": "keyframe",
        "size": "720P",
        "first_frame": "https://example.com/first.png",
        "last_frame": "https://example.com/last.png"
      }'
    ```
  </Tab>

  <Tab title="图片参考">
    ```bash theme={null}
    curl -sS -X POST "$AGNES_BASE_URL/videos" \
      -H "Authorization: Bearer $AGNES_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-2.5",
        "prompt": "以 <Picture 1> 中的角色和美术风格为参考，角色在花田中自然奔跑，保持外观一致，低机位跟拍",
        "seconds": "5",
        "mode": "reference",
        "size": "720P",
        "aspect_ratio": "16:9",
        "images": ["https://example.com/character.png"]
      }'
    ```
  </Tab>

  <Tab title="图片与音频参考">
    ```bash theme={null}
    curl -sS -X POST "$AGNES_BASE_URL/videos" \
      -H "Authorization: Bearer $AGNES_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-2.5",
        "prompt": "以 <Picture 1> 为视觉主体，根据 <Audio 1> 的节奏设计动作和镜头切换，保持自然连贯",
        "seconds": "5",
        "mode": "reference",
        "size": "720P",
        "images": ["https://example.com/subject.png"],
        "audios": ["https://example.com/music.mp3"]
      }'
    ```
  </Tab>

  <Tab title="视频参考">
    ```bash theme={null}
    curl -sS -X POST "$AGNES_BASE_URL/videos" \
      -H "Authorization: Bearer $AGNES_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-video-2.5",
        "prompt": "参考 <Video 1> 的主体动作和镜头节奏，将场景改为月光下的卧室，同时保持时序连贯",
        "seconds": "5",
        "mode": "reference",
        "size": "720P",
        "aspect_ratio": "16:9",
        "videos": [
          {
            "url": "https://example.com/input.mp4",
            "start_seconds": 35,
            "require_audio": false
          }
        ]
      }'
    ```
  </Tab>
</Tabs>

<Note>
  `<Picture N>`、`<Audio N>` 和 `<Video N>` 分别在各自素材数组中从 `1` 开始编号。例如，`images` 中的第二张图片应在提示词中写为 `<Picture 2>`。
</Note>

## 创建任务响应

```json theme={null}
{
  "id": "video_xxx",
  "object": "video",
  "model": "agnes-video-2.5",
  "status": "queued",
  "progress": 0,
  "created_at": 1786900000,
  "size": "720P",
  "seconds": "5",
  "quality": "standard",
  "url": null,
  "completed_at": null,
  "error": null
}
```

| 字段             | 类型              | 说明                                             |
| -------------- | --------------- | ---------------------------------------------- |
| `id`           | string          | 视频任务 ID，用于查询任务。                                |
| `object`       | string          | 对象类型，固定为 `video`。                              |
| `model`        | string          | 当前任务使用的模型。                                     |
| `status`       | string          | `queued`、`in_progress`、`completed` 或 `failed`。 |
| `progress`     | integer         | 任务进度，范围为 `0–100`。                              |
| `created_at`   | integer         | 任务创建时间，Unix 时间戳。                               |
| `completed_at` | integer \| null | 任务完成时间；未完成时为 `null`。                           |
| `size`         | string          | 输出档位，当前为 `720P`。                               |
| `seconds`      | string          | 视频时长，单位为秒。                                     |
| `quality`      | string          | 视频响应的质量档位字段。                                   |
| `url`          | string \| null  | 任务完成后的视频 URL。                                  |
| `error`        | object \| null  | 任务失败时包含错误信息。                                   |

## 查询任务

<Tabs>
  <Tab title="推荐方式：video_id">
    ```bash theme={null}
    curl -sS "https://api.agnes-ai.cn/agnesapi?video_id=video_xxx" \
      -H "Authorization: Bearer $AGNES_API_KEY"
    ```
  </Tab>

  <Tab title="指定 model_name">
    ```bash theme={null}
    curl -sS "https://api.agnes-ai.cn/agnesapi?video_id=video_xxx&model_name=agnes-video-2.5" \
      -H "Authorization: Bearer $AGNES_API_KEY"
    ```

    适用于使用上游原始视频 ID、非默认模型，或需要显式指定模型名称的场景。
  </Tab>
</Tabs>

任务完成响应示例：

```json theme={null}
{
  "id": "video_xxx",
  "object": "video",
  "model": "agnes-video-2.5",
  "status": "completed",
  "progress": 100,
  "created_at": 1786900000,
  "completed_at": 1786900120,
  "size": "720P",
  "seconds": "5",
  "quality": "standard",
  "url": "https://example.com/generated/video_xxx.mp4",
  "error": null
}
```

<Tip>
  请以 `status` 和 `url` 为准：只有当 `status` 为 `completed` 时，`url` 才是可交付的视频地址。生产环境应设置最大轮询时长，并对网络超时和 `429` 响应进行退避重试。
</Tip>

## Python SDK 示例

`mode`、`aspect_ratio` 和媒体字段通过 `extra_body` 合并到请求 JSON 顶层。

```python theme={null}
import os
import time
import requests
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["AGNES_API_KEY"],
    base_url="https://api.agnes-ai.cn/v1",
)

video = client.videos.create(
    model="agnes-video-2.5",
    prompt="Follow the motion and timing of <Video 1>, while changing the setting to a moonlit room.",
    seconds="5",
    size="720P",
    extra_body={
        "mode": "reference",
        "aspect_ratio": "16:9",
        "videos": [
            {
                "url": "https://example.com/input.mp4",
                "start_seconds": 0,
                "require_audio": False,
            }
        ],
    },
)

video_id = video.id

while True:
    time.sleep(1.5)
    response = requests.get(
        "https://api.agnes-ai.cn/agnesapi",
        params={"video_id": video_id},
        headers={"Authorization": f"Bearer {os.environ['AGNES_API_KEY']}"},
        timeout=30,
    )
    response.raise_for_status()
    video = response.json()
    if video.get("status") in ("completed", "failed"):
        break

if video.get("status") == "failed":
    message = video.get("error", {}).get("message", "Video generation failed")
    raise RuntimeError(message)

print(video["url"])
```

## 视频尺寸与画幅

`size` 用于选择输出档位，当前仅支持 `"720P"`。通过 `aspect_ratio` 可以选择所有受支持的 720P 画幅，不支持直接传入 `WIDTHxHEIGHT` 或 `auto`。

| `aspect_ratio` | 输出像素       | 推荐场景            |
| -------------- | ---------- | --------------- |
| `21:9`         | `1680x720` | 超宽银幕、电影感场景。     |
| `16:9`         | `1280x720` | 横版视频、产品展示，默认比例。 |
| `4:3`          | `960x720`  | 通用横版和传统画幅内容。    |
| `1:1`          | `720x720`  | 社交媒体信息流和方形内容。   |
| `3:4`          | `720x960`  | 竖版展示和人物内容。      |
| `9:16`         | `720x1280` | 移动端短视频和竖屏内容。    |

## 参数限制

以下参数或写法不受支持，传入后将返回 `400`：

* 使用 `video_url`、`video_path` 或 `video_reference` 传入参考视频；请改用 `videos[].url`。
* 使用 `input_reference` 或 `reference_url` 传入素材；请根据模式使用 `first_frame`、`last_frame`、`images`、`audios` 或 `videos`。
* 传入 `width`、`height`、`fps`、`num_frames`、`quality`、`num_inference_steps` 等不可配置字段。
* 将 `size` 直接写成 `1280x720` 等分辨率，或传入 `"720P"` 以外的值；具体分辨率应通过 `aspect_ratio` 选择。
* 将 `aspect_ratio` 设为 `auto` 或白名单之外的比例。
* 将 `n` 设为 `1` 以外的值。
* `mode` 与媒体字段不匹配，或 `reference` 模式未提供任何参考媒体。

## 错误处理

| HTTP 状态码      | 常见原因                  | 建议处理方式            |
| ------------- | --------------------- | ----------------- |
| `400`         | 参数缺失、模式与媒体不匹配、时长或画幅非法 | 检查请求字段和模式校验规则。    |
| `401` / `403` | API Key 无效、过期或没有权限    | 检查请求头、密钥状态和模型权限。  |
| `404`         | 视频任务 ID 不存在           | 确认使用创建响应中的 `id`。  |
| `429`         | 请求频率超过限制              | 使用指数退避并降低轮询频率。    |
| `500`         | 服务端内部错误               | 稍后重试；持续失败时联系技术支持。 |

失败任务响应示例：

```json theme={null}
{
  "id": "video_xxx",
  "object": "video",
  "model": "agnes-video-2.5",
  "status": "failed",
  "progress": 100,
  "url": null,
  "error": {
    "message": "Invalid reference media"
  }
}
```

## 提示词建议

为了获得更稳定的结果，建议按以下顺序描述提示词：

1. **主体与场景**：明确人物、物体、环境和时间。
2. **动作与变化**：描述主体如何移动，以及场景如何变化。
3. **镜头语言**：指定推、拉、摇、移、跟拍、固定镜头或景别。
4. **视觉风格**：补充光线、色彩、材质、写实程度和氛围。
5. **声音与节奏**：需要时描述环境声、动作声或引用音频素材。
6. **一致性要求**：说明需要保持不变的主体外观、产品细节或构图。

<Tip>
  在 `reference` 模式中，应在提示词里明确写出素材占位符及其用途，例如“以 `<Picture 1>` 为角色参考，并跟随 `<Audio 1>` 的节奏”。这比只上传素材但不解释用途更容易获得可控结果。
</Tip>

## 接入检查清单

* 使用模型 ID `agnes-video-2.5`。
* Base URL 使用 `https://api.agnes-ai.cn/v1`。
* 创建任务后保存响应中的 `id`。
* 查询 `GET /agnesapi?video_id=<VIDEO_ID>`，直至状态为 `completed` 或 `failed`；需要显式指定模型时，增加 `model_name=agnes-video-2.5`。
* 媒体链接可公开访问，并在任务完成前保持有效。
* `seconds` 使用字符串 `"4"`–`"12"`，`n` 固定为 `1`。
* `size` 使用 `"720P"`，画幅使用受支持的 `aspect_ratio`。
* 不要在日志、客户端代码或公开仓库中暴露 API Key。

## 计费规则

<Info>
  Agnes Video 2.5 当前支持 720P 输出，本节仅展示 720P 刊例价。
</Info>

### 720P 输出视频刊例价

| 输出分辨率 | 刊例价         |
| ----- | ----------- |
| 720P  | `¥0.15 / 秒` |

### 正式计费公式

```text theme={null}
最终费用 =（输出视频秒数 + 输入视频秒数）× 输出视频分辨率单价
         + max(0, 参考图片数量 - 5) × ¥0.03
```

| 计费项  | 正式规则                                     |
| ---- | ---------------------------------------- |
| 输出视频 | 按实际输出视频秒数 × 输出视频分辨率对应单价计费。               |
| 输入视频 | 按输入视频总秒数 × 输出视频分辨率对应单价计费。存在多个输入视频时，时长累加。 |
| 参考图片 | 前 5 张免费；从第 6 张开始，超出部分按 `¥0.03 / 张` 计费。   |

<Note>
  当前支持 720P，公式中的“输出视频分辨率单价”按 720P 刊例价 `¥0.15 / 秒` 计算。
</Note>

### 当前限免规则

限免期间仅计算输出视频秒数，输入视频和参考图片暂不计费：

```text theme={null}
当前费用 = 输出视频秒数 × 720P 刊例价
```

| 计费项    | 限免期间                            |
| ------ | ------------------------------- |
| 输出视频秒数 | 正常计费，按 720P 刊例价 `¥0.15 / 秒` 计算。 |
| 输入视频秒数 | `¥0`，暂不计费。                      |
| 参考图片数量 | `¥0`，包括超过 5 张的部分，暂不计费。          |

<Warning>
  限免规则属于阶段性优惠，结束时间和恢复正式计费的时间以 Agnes AI 平台公告为准。
</Warning>

### 积分计费

积分消耗采用与人民币计费相同的计量结构，但每项积分单价与人民币金额不同：

```text theme={null}
正式积分消耗 =（输出视频秒数 + 输入视频秒数）× 输出分辨率积分单价
             + max(0, 参考图片数量 - 5) × 超额图片积分单价
```

限免期间，积分同样只计算输出视频秒数；输入视频秒数和参考图片数量暂不计入积分消耗。具体的 720P 每秒积分单价和超额图片积分单价以 Agnes AI 平台展示为准。

### 计费示例

假设生成一个 8 秒的 720P 视频，使用 3 秒输入视频和 7 张参考图片，并按 720P 刊例价 `¥0.15 / 秒` 计算：

```text theme={null}
正式费用 =（8 + 3）× ¥0.15 + max(0, 7 - 5) × ¥0.03
         = ¥1.65 + ¥0.06
         = ¥1.71

当前限免费用 = 8 × ¥0.15
             = ¥1.20
```

以上人民币示例均按 720P 刊例价计算。
