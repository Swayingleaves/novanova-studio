> ## Documentation Index
> Fetch the complete documentation index at: https://wiki.agnes-ai.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# Agnes Image 2.1 Flash

> 升级版图像生成模型，优化高信息密度图像生成，并支持文生图、图生图和多图合成工作流。

<Info>
  Agnes Image 2.1 Flash 是 Agnes AI 的升级图像生成模型，支持文生图、图生图和多图合成。相比 2.0 版本，它更适合高信息密度图像、复杂构图和细节丰富的视觉场景。
</Info>

<CardGroup cols={2}>
  <Card title="模型名称" icon="cube">
    `agnes-image-2.1-flash`
  </Card>

  <Card title="API Endpoint" icon="link">
    `POST /v1/images/generations`
  </Card>

  <Card title="核心优化" icon="chart-network">
    高信息密度图像、复杂视觉细节和语义对齐。
  </Card>

  <Card title="人民币价格" icon="tag">
    所有支持的输出分辨率档位和输入参考图片当前均免费。
  </Card>
</CardGroup>

## 概述

Agnes Image 2.1 Flash 可根据文本提示词生成图像，也可基于输入图像进行转换、重绘和风格化编辑。它支持以图像 URL 或 Base64 数据形式返回结果。

<CardGroup cols={2}>
  <Card title="高信息密度优化" icon="mountain-sun">
    更适合复杂场景、丰富构图和多层视觉元素。
  </Card>

  <Card title="构图保留" icon="crop">
    图生图编辑时可尽量保留原始构图和主体布局。
  </Card>
</CardGroup>

## 核心能力

<CardGroup cols={2}>
  <Card title="文生图" icon="wand-magic-sparkles">
    根据自然语言提示词生成高质量图像。
  </Card>

  <Card title="图生图" icon="images">
    根据提示词转换或优化现有图像。
  </Card>

  <Card title="多图合成" icon="layer-group">
    使用多张参考图像组合生成新图像。
  </Card>

  <Card title="高信息密度图像" icon="chart-network">
    优化细节丰富、布局复杂、视觉元素密集的图像生成效果。
  </Card>

  <Card title="构图保留" icon="crop">
    编辑输入图像时保留原始构图和主体布局。
  </Card>

  <Card title="灵活尺寸控制" icon="expand">
    使用 `1K`、`2K`、`3K`、`4K` 等尺寸档位，并配合支持的宽高比。
  </Card>

  <Card title="URL / Base64 输出" icon="file-code">
    支持图像 URL 或 Base64 数据返回。
  </Card>
</CardGroup>

## 适用场景

<CardGroup cols={2}>
  <Card title="创意设计" icon="pen-ruler">
    概念艺术、视觉探索和海报草稿。
  </Card>

  <Card title="营销内容" icon="bullhorn">
    活动图片、产品视觉和社交媒体创意。
  </Card>

  <Card title="高密度视觉生成" icon="mountain-sun">
    精细场景、复杂环境和丰富构图。
  </Card>

  <Card title="图像转换" icon="paintbrush">
    风格迁移、场景重打光和背景变换。
  </Card>

  <Card title="产品可视化" icon="box">
    产品照片、模型图和商业视觉。
  </Card>

  <Card title="社交媒体素材" icon="share-nodes">
    封面、横幅、缩略图和帖子图片。
  </Card>
</CardGroup>

## API Reference

### Endpoint

```text theme={null}
POST https://api.agnes-ai.cn/v1/images/generations
```

### 请求头

```bash theme={null}
-H "Authorization: Bearer YOUR_API_KEY"
-H "Content-Type: application/json"
```

### 请求参数

| 参数                           | 类型        | 必填         | 说明                                                                                     |
| ---------------------------- | --------- | ---------- | -------------------------------------------------------------------------------------- |
| `model`                      | string    | 是          | 模型名称，使用 `agnes-image-2.1-flash`。                                                       |
| `prompt`                     | string    | 是          | 图像生成或图像编辑的文本指令。                                                                        |
| `size`                       | string    | 是          | 输出尺寸档位。推荐值为 `1K`、`2K`、`3K`、`4K`。也兼容 `1024x768` 这类历史精确尺寸写法，但不支持的尺寸可能会被标准化。              |
| `ratio`                      | string    | 否          | 与档位式 `size` 配合使用的宽高比。支持 `1:1`、`3:4`、`4:3`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9`，默认值为 `1:1`。 |
| `image`                      | string\[] | 图生图或多图合成必填 | 输入图像数组，支持公共图像 URL 或 Data URI Base64。多图合成时传入多张图像。                                       |
| `return_base64`              | boolean   | 否          | 文生图需要以 Base64 返回时使用。                                                                   |
| `extra_body`                 | object    | 否          | 高级工作流的附加参数。                                                                            |
| `extra_body.response_format` | string    | 否          | 输出格式，常见值为 `url` 或 `b64_json`。                                                          |

## 尺寸与宽高比

为了获得可预期的输出尺寸，建议将 `size` 与 `ratio` 配合使用。

* 推荐 `size` 值：`1K`、`2K`、`3K`、`4K`
* 支持的 `ratio` 值：`1:1`、`3:4`、`4:3`、`16:9`、`9:16`、`2:3`、`3:2`、`21:9`
* 如果请求 `1920x1080` 或 `2560x1440` 这类不受原生支持的精确尺寸，服务可能会自动映射到最接近的标准档位和宽高比。
* 如果需要生成 `1920x1080` 或 `2560x1440` 这类常见 16:9 显示素材，建议请求 `size: "2K"` 和 `ratio: "16:9"`，再在下游裁剪或缩放到最终画布。

<Warning>
  `1920x1080` 和 `2560x1440` 是标准显示器分辨率，但不是该图像模型的原生输出尺寸。不支持的精确尺寸可能会被标准化，例如映射为 16:9 的 `1K` 输出尺寸 `1312x736`。
</Warning>

### 输出尺寸参考

| Ratio  | 1K          | 2K          | 3K          | 4K          |
| ------ | ----------- | ----------- | ----------- | ----------- |
| `1:1`  | `1024x1024` | `2048x2048` | `3072x3072` | `4096x4096` |
| `3:4`  | `864x1152`  | `1728x2304` | `2592x3456` | `3456x4608` |
| `4:3`  | `1152x864`  | `2304x1728` | `3456x2592` | `4608x3456` |
| `16:9` | `1312x736`  | `2624x1472` | `3936x2208` | `5248x2944` |
| `9:16` | `736x1312`  | `1472x2624` | `2208x3936` | `2944x5248` |
| `2:3`  | `832x1248`  | `1664x2496` | `2496x3744` | `3328x4992` |
| `3:2`  | `1248x832`  | `2496x1664` | `3744x2496` | `4992x3328` |
| `21:9` | `1568x672`  | `3136x1344` | `4704x2016` | `6272x2688` |

### 示例：16:9 的 2K 输出

```bash theme={null}
curl https://api.agnes-ai.cn/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "agnes-image-2.1-flash",
    "prompt": "A cinematic product hero image for a desktop monitor wallpaper, clean lighting, high detail",
    "size": "2K",
    "ratio": "16:9",
    "extra_body": {
      "response_format": "url"
    }
  }'
```

该请求会返回 16:9 的 `2K` 档位输出尺寸：`2624x1472`。

## 重要说明

<Warning>
  请勿在请求体顶层放置 `response_format`。需要 URL 输出时，请使用 `extra_body.response_format: "url"`；图生图 Base64 输出请使用 `extra_body.response_format: "b64_json"`。
</Warning>

<CardGroup cols={2}>
  <Card title="文生图" icon="wand-magic-sparkles">
    必填参数为 `model`、`prompt` 和 `size`。
  </Card>

  <Card title="尺寸 + 宽高比" icon="expand">
    使用 `2K` 等档位式 `size`，并配合 `16:9` 等 `ratio`。
  </Card>

  <Card title="图生图" icon="images">
    需要在 `extra_body.image` 中提供输入图像 URL 或 Data URI Base64。
  </Card>

  <Card title="多图合成" icon="layer-group">
    在 `extra_body.image` 中传入多张参考图像。
  </Card>

  <Card title="Base64 输出" icon="file-code">
    文生图可使用 `return_base64: true`；图生图请使用 `extra_body.response_format: "b64_json"`。
  </Card>

  <Card title="无需 tags" icon="ban">
    图生图不需要传递 `tags: ["img2img"]`。
  </Card>
</CardGroup>

## 请求示例

<Tabs>
  <Tab title="文生图：URL 输出">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "A luminous floating city above a misty canyon at sunrise, cinematic realism",
        "size": "1024x768",
        "extra_body": {
          "response_format": "url"
        }
      }'
    ```

    返回路径：`data[0].url`
  </Tab>

  <Tab title="文生图：Base64 输出">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "A clean product photo of a glass cube on a white studio background, soft shadows, high detail",
        "size": "1024x768",
        "return_base64": true
      }'
    ```

    返回路径：`data[0].b64_json`
  </Tab>

  <Tab title="图生图：URL 输出">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "Transform the scene into a rain-soaked cyberpunk night with neon reflections while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/input-image.png"
          ],
          "response_format": "url"
        }
      }'
    ```

    返回路径：`data[0].url`
  </Tab>

  <Tab title="图生图：Base64 输出">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "Make the object orange while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/input-image.png"
          ],
          "response_format": "b64_json"
        }
      }'
    ```

    返回路径：`data[0].b64_json`
  </Tab>

  <Tab title="多图合成">
    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "Combine the two characters into an intense fantasy battle scene, dynamic lighting, detailed background, cinematic composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "https://example.com/character-1.png",
            "https://example.com/character-2.png"
          ],
          "response_format": "url"
        }
      }'
    ```
  </Tab>

  <Tab title="Data URI 输入">
    ```text theme={null}
    data:image/png;base64,BASE64_HERE
    ```

    ```bash theme={null}
    curl https://api.agnes-ai.cn/v1/images/generations \
      -H "Authorization: Bearer YOUR_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "agnes-image-2.1-flash",
        "prompt": "Make the object matte black while preserving the original composition",
        "size": "1024x768",
        "extra_body": {
          "image": [
            "data:image/png;base64,BASE64_HERE"
          ],
          "response_format": "b64_json"
        }
      }'
    ```
  </Tab>
</Tabs>

## 响应格式

<Tabs>
  <Tab title="URL 输出">
    ```json theme={null}
    {
      "created": 1780000000,
      "data": [
        {
          "url": "https://storage.googleapis.com/agnes-aigc/xxx.png",
          "b64_json": null,
          "revised_prompt": null
        }
      ]
    }
    ```
  </Tab>

  <Tab title="Base64 输出">
    ```json theme={null}
    {
      "created": 1780000000,
      "data": [
        {
          "url": null,
          "b64_json": "iVBORw0KGgoAAAANSUhEUgAA...",
          "revised_prompt": null
        }
      ]
    }
    ```
  </Tab>
</Tabs>

## 推荐提示词结构

<AccordionGroup>
  <Accordion title="文生图结构">
    ```text theme={null}
    [主体] + [场景 / 环境] + [风格] + [光照] + [构图] + [质量要求]
    ```

    ```text theme={null}
    日出时分薄雾峡谷上方的发光浮空城市，电影级写实风格，广角构图，丰富的建筑细节，柔和的金色光线，高视觉密度
    ```
  </Accordion>

  <Accordion title="图生图结构">
    ```text theme={null}
    [改变要求] + [新风格 / 场景] + [需要添加或移除的元素] + [需要保留的元素]
    ```

    ```text theme={null}
    将白天街道场景改为电影级赛博朋克夜景，添加霓虹招牌和湿滑路面倒影，同时保留原始街道布局、相机角度和主要建筑形状。
    ```
  </Accordion>

  <Accordion title="多图合成结构">
    请说明每张参考图的角色，以及最终图像应如何组合这些参考信息。

    ```text theme={null}
    [参考图角色] + [目标场景] + [图像之间的关系] + [风格 / 光照 / 构图]
    ```

    ```text theme={null}
    将第一张图作为主要角色，第二张图作为产品参考，生成一张电影级活动海报，保留角色身份和产品外形，使用自然光照和干净的商业构图。
    ```
  </Accordion>

  <Accordion title="高信息密度图像">
    请清晰描述视觉层次结构，包括主要主体、背景环境、重要次要细节、风格、光照和构图约束。

    ```text theme={null}
    建在悬崖上的大型奇幻港口城市，数百艘小船，层叠的石桥，发光的窗户，远山，多云的日落天空，电影级奇幻写实风格，广角构图，丰富的建筑细节，高视觉密度
    ```
  </Accordion>
</AccordionGroup>

## 常见错误与故障排除

<AccordionGroup>
  <Accordion title="顶层放置 response_format">
    错误写法：

    ```json theme={null}
    {
      "model": "agnes-image-2.1-flash",
      "prompt": "A futuristic city",
      "size": "1024x768",
      "response_format": "url"
    }
    ```

    正确写法：

    ```json theme={null}
    {
      "model": "agnes-image-2.1-flash",
      "prompt": "A futuristic city",
      "size": "1024x768",
      "extra_body": {
        "response_format": "url"
      }
    }
    ```
  </Accordion>

  <Accordion title="图生图传递 tags">
    图生图不需要传递 `tags: ["img2img"]`。只需在 `extra_body.image` 中提供输入图像。
  </Accordion>

  <Accordion title="输入图像 URL 无法访问">
    请使用公共 HTTPS 图像 URL，并确认不需要登录、cookie 或私有请求头；如果无法公开访问，请使用 Data URI Base64。
  </Accordion>

  <Accordion title="请求超时">
    根据提示词复杂度、图像尺寸和服务器负载情况，图像生成可能需要数秒到几十秒。客户端超时时间建议设置为 `60s - 360s`。
  </Accordion>

  <Accordion title="图生图缺少 image 参数">
    图生图和多图合成生成时，`extra_body.image` 为必填项。

    ```json theme={null}
    {
      "model": "agnes-image-2.1-flash",
      "prompt": "Make the image cyberpunk style while preserving the original composition",
      "size": "1024x768",
      "extra_body": {
        "image": ["https://example.com/input.png"],
        "response_format": "url"
      }
    }
    ```
  </Accordion>
</AccordionGroup>

## 定价

`agnes-image-2.0-flash` 和 `agnes-image-2.1-flash` 的价格相同。

| 计费项           |                  刊例价（原价） |      现价（优惠价） |
| ------------- | -----------------------: | -----------: |
| 1K 输出图片       |  `¥70 / 千张`（`¥0.07 / 张`） |     **`¥0`** |
| 2K 输出图片       | `¥120 / 千张`（`¥0.12 / 张`） |     **`¥0`** |
| 3K 输出图片       | `¥140 / 千张`（`¥0.14 / 张`） |     **`¥0`** |
| 4K 输出图片       | `¥160 / 千张`（`¥0.16 / 张`） |     **`¥0`** |
| 第 4 张起的输入参考图片 |              `¥0.02 / 张` | **`¥0 / 张`** |

按刊例价计算时，前 3 张输入参考图片不额外收费。当前所有输出分辨率档位和输入参考图片均免费。

完整价格说明请参阅 [模型定价](/zh-Hans/docs/pricing#图片模型)。

## 接入检查清单

<Check>
  使用 `agnes-image-2.1-flash` 作为模型名称。
</Check>

<Check>
  使用 `https://api.agnes-ai.cn/v1/images/generations` 作为 API 端点。
</Check>

<Check>
  文生图请求必须包含 `model`、`prompt` 和 `size`。
</Check>

<Check>
  为获得可预期的输出尺寸，建议使用 `1K` 或 `2K` 等 `size` 档位，并配合 `ratio`。
</Check>

<Check>
  图生图和多图合成请求需要在 `extra_body.image` 中提供输入图像。
</Check>

<Check>
  请勿将 `response_format` 放在顶层，也不要传递 `tags: ["img2img"]`。
</Check>
