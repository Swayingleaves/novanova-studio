# Novanova Studio UI 设计规范

> 状态：整体 UI 重构基线  
> 参考范式：`docs/ai-agent-black-theme-preview.html`  
> 适用范围：`web/` 下首页、图片创作、视频创作、无限画布、资产库、提示词库、管理后台及全局弹窗  
> 技术边界：Next.js App Router、React、TypeScript、Ant Design、Tailwind CSS、Zustand、Motion、XYFlow

## 1. 设计定位

### 1.1 Design Read

Novanova Studio 是面向视觉创作者的 AI Agent 创作工作台。整体设计采用冷静、精密、低干扰的专业工具语言，以 OLED 近黑、冷灰层级和单一黄绿色操作强调构成产品界面；现有紫粉 Logo 只承担品牌识别，不扩散为大面积界面渐变。

设计不是营销落地页，也不是传统管理后台。首页允许更强的品牌构图与作品展示，进入创作流程后，界面应逐步退后，把注意力让给输入、媒体结果和无限画布。

### 1.2 设计调节值

| 维度 | 全局值 | 首页 | 生成工作区 | 无限画布 | 资产与提示词 | 管理后台 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `DESIGN_VARIANCE` 视觉变化度 | 6 | 7 | 4 | 5 | 4 | 3 |
| `MOTION_INTENSITY` 动效强度 | 4 | 5 | 3 | 4 | 3 | 2 |
| `VISUAL_DENSITY` 信息密度 | 5 | 3 | 7 | 8 | 6 | 8 |

这些数值用于判断设计取舍，不作为运行时配置。页面越接近高频工作流，越应稳定、直接和紧凑。

### 1.3 核心原则

1. **内容优先**：真实作品、生成结果和画布节点是主视觉，装饰不能与内容竞争。
2. **一个操作强调色**：黄绿色只用于主要操作、当前选中、焦点和 Agent 就绪状态。
3. **品牌色与操作色分工**：紫粉属于 Logo 和品牌时刻，不能作为通用按钮、选中态或背景光晕。
4. **层级依靠明度和留白**：优先使用背景层级、细分隔线和间距，少用阴影，禁止全局玻璃拟态。
5. **工具界面保持熟悉**：保留 Ant Design、标准表单、表格、抽屉和弹窗的可预期行为，不为造型重新发明交互。
6. **双主题等价**：深色与浅色主题必须同时可用，不允许浅色只是颜色反转或出现残留深色区域。
7. **完整状态**：所有组件必须覆盖默认、悬停、焦点、按下、禁用、加载、错误和空状态。

## 2. 范式边界

### 2.1 从预览继承

- 近黑与冷白双主题。
- 左侧窄导航栏和底部主题切换入口。
- 冷灰表面层级、1px 分隔线、最大 8px 常规圆角。
- 黄绿色主要操作与选中状态。
- 首页的非对称品牌字标、真实作品墙和 Agent 输入区。
- 图标加文字的输入工具，以及紧邻提交按钮左侧的提示词优化图标。
- 简洁、轻量、状态驱动的悬停与切换动效。

### 2.2 不从预览继承

- 日期、时间、版本号、坐标编号等展示性文案。
- 为构图而存在的 `01 / 02 / 03` 编号脚手架。
- 作品图片上的装饰性标题条，除非标题和状态是业务信息。
- 外部 Picsum 图片资源。
- 首页的大字号艺术排版复制到管理后台、表单、弹窗或画布工具栏。
- 预览 HTML 中的固定尺寸和原生脚本实现；生产代码必须使用项目现有 React、Zustand 和主题能力。

## 3. 设计系统架构

### 3.1 单一主题源

重构后只有一个主题状态源：`useThemeStore`。主题偏好继续支持 `system | light | dark`，由 `AppProviders` 同步到根节点 `data-theme`。

颜色定义采用三层 Token：

```text
Primitive 原始值
        ↓
Semantic 语义角色
        ↓
Component 组件用途
        ↓
CSS / Tailwind / Ant Design / Canvas
```

约束：

- 业务组件只能使用语义 Token 或组件 Token。
- `globals.css` 负责 CSS 变量与跨页面基础样式。
- `app-theme.ts` 只把语义 Token 映射为 Ant Design Token，不维护第二套色板。
- `canvas-theme.ts` 只补充画布特有 Token，不重新定义通用文本、表面、边框和状态色。
- 页面私有组件不得出现 `dark ? ... : ...` 色值分支。
- 禁止在 JSX、TSX 和页面私有 CSS 中新增直接十六进制颜色。

### 3.2 文件职责

| 文件 | 重构后职责 |
| --- | --- |
| `web/src/app/globals.css` | Primitive、Semantic、Component CSS Token；基础重置；共享组件类 |
| `web/src/shared/lib/app-theme.ts` | Ant Design Token 与组件 Token 映射 |
| `web/src/shared/lib/canvas-theme.ts` | 画布背景、节点、连线、选择框、工具栏等画布专用映射 |
| `web/src/features/theme/stores/use-theme-store.ts` | 唯一主题状态、持久化和系统主题同步 |
| `web/src/features/app-shell/components/app-providers.tsx` | 将当前主题注入 Ant Design 和 Pro Components |
| `web/src/features/app-shell/components/app-sidebar.tsx` | 桌面侧栏、品牌入口、主题入口和用户操作 |
| `web/src/features/app-shell/components/mobile-nav-drawer.tsx` | 移动端导航和同一主题偏好入口 |

## 4. 颜色系统

### 4.1 Primitive Token

#### 中性色

| Token | 深色值 | 浅色值 | 用途 |
| --- | --- | --- | --- |
| `--primitive-neutral-page` | `#050606` | `#F4F5F2` | 页面根背景 |
| `--primitive-neutral-rail` | `#090A09` | `#FFFFFF` | 侧栏与固定导航 |
| `--primitive-neutral-surface` | `#0C0E0D` | `#FFFFFF` | 普通面板和输入区 |
| `--primitive-neutral-raised` | `#121512` | `#ECEFE9` | 抬升层、选中背景 |
| `--primitive-neutral-hover` | `#181C18` | `#E5E9E2` | 悬停背景 |
| `--primitive-neutral-ink` | `#F3F6F0` | `#171A17` | 标题和主要文本 |
| `--primitive-neutral-text` | `#C2C9C0` | `#394037` | 正文 |
| `--primitive-neutral-muted` | `#858D84` | `#596157` | 次要文本 |
| `--primitive-neutral-faint` | `#727A71` | `#687066` | 辅助信息和占位文字，双主题均满足 4.5:1 |
| `--primitive-neutral-line` | `#242824` | `#DCE1DA` | 普通分隔线 |
| `--primitive-neutral-line-strong` | `#363C36` | `#C7CEC4` | 强边界和表单边框 |

#### 操作色与品牌色

| Token | 深色值 | 浅色值 | 用途 |
| --- | --- | --- | --- |
| `--primitive-action` | `#C7F36B` | `#526F1E` | 主要操作、当前项、焦点 |
| `--primitive-action-hover` | `#D6FF82` | `#648625` | 主要操作悬停 |
| `--primitive-action-foreground` | `#11170A` | `#FFFFFF` | 主要操作前景色 |
| `--primitive-brand-violet` | `#8B5CF6` | `#7C3AED` | Logo 主色，不作通用操作色 |
| `--primitive-brand-pink` | `#F472B6` | `#DB4F97` | Logo 辅色和少量品牌时刻 |

#### 状态色

| Token | 深色值 | 浅色值 | 语义 |
| --- | --- | --- | --- |
| `--primitive-success` | `#5ED69B` | `#1F7A4D` | 成功、已完成、在线 |
| `--primitive-warning` | `#F3C969` | `#8A5C00` | 警告、等待确认 |
| `--primitive-danger` | `#FF7C7C` | `#B42318` | 错误、危险操作 |
| `--primitive-info` | `#75B7F5` | `#28679B` | 信息和处理中 |

状态色只表达业务状态。Agent 就绪和主要创作操作仍使用 `action`，不要把 `success` 当作第二主色。

### 4.2 Semantic Token

生产代码使用以下语义名称：

```css
:root {
    --studio-page: var(--primitive-neutral-page);
    --studio-rail: var(--primitive-neutral-rail);
    --studio-surface: var(--primitive-neutral-surface);
    --studio-surface-raised: var(--primitive-neutral-raised);
    --studio-surface-hover: var(--primitive-neutral-hover);
    --studio-ink: var(--primitive-neutral-ink);
    --studio-text: var(--primitive-neutral-text);
    --studio-muted: var(--primitive-neutral-muted);
    --studio-faint: var(--primitive-neutral-faint);
    --studio-line: var(--primitive-neutral-line);
    --studio-line-strong: var(--primitive-neutral-line-strong);
    --studio-action: var(--primitive-action);
    --studio-action-hover: var(--primitive-action-hover);
    --studio-action-foreground: var(--primitive-action-foreground);
    --studio-brand-violet: var(--primitive-brand-violet);
    --studio-brand-pink: var(--primitive-brand-pink);
    --studio-success: var(--primitive-success);
    --studio-warning: var(--primitive-warning);
    --studio-danger: var(--primitive-danger);
    --studio-info: var(--primitive-info);
}
```

旧的 `--studio-primary` 必须迁移为更明确的 `--studio-action`；旧的渐变 `--studio-brand-start/middle/end` 仅可保留给 Logo 资产兼容，不能继续用于按钮、画布背景或输入框。

### 4.3 Component Token

```css
:root {
    --sidebar-bg: var(--studio-rail);
    --sidebar-item-hover-bg: var(--studio-surface-hover);
    --sidebar-item-active-bg: var(--studio-action);
    --sidebar-item-active-fg: var(--studio-action-foreground);

    --button-primary-bg: var(--studio-action);
    --button-primary-bg-hover: var(--studio-action-hover);
    --button-primary-fg: var(--studio-action-foreground);

    --input-bg: var(--studio-surface);
    --input-border: var(--studio-line-strong);
    --input-placeholder: var(--studio-faint);
    --input-focus: var(--studio-action);

    --composer-bg: var(--studio-surface);
    --composer-border: var(--studio-line-strong);

    --table-header-bg: var(--studio-surface-raised);
    --table-row-hover-bg: var(--studio-surface-hover);
    --table-row-selected-bg: color-mix(in srgb, var(--studio-action) 12%, var(--studio-surface));
}
```

### 4.4 色彩使用比例

- 中性色占界面面积 `85%` 至 `95%`。
- 黄绿色操作色占 `5%` 至 `10%`，同一视口内不应同时出现多个大面积黄绿块。
- 紫粉品牌色占 `0%` 至 `3%`，主要出现在 Logo、品牌字标、启动或欢迎场景。
- 状态色按业务需要出现，不用于装饰。
- 禁止紫蓝渐变背景、渐变按钮、渐变文字和发光球体。

## 5. 排版系统

### 5.1 字体角色

| 角色 | 字体 | 使用范围 |
| --- | --- | --- |
| 产品正文 | `SF Pro Text`, `PingFang SC`, `Microsoft YaHei`, system-ui | 导航、表单、表格、正文、弹窗 |
| 英文品牌展示 | `Bricolage Grotesque` | 首页 `Novanova Studio` 字标和少量品牌标题 |
| 艺术字形 | `Syne` | 仅首页或品牌预览中的大字号英文，不进入产品控件 |
| 数字与时间 | 正文字体 + `font-variant-numeric: tabular-nums` | 积分、尺寸、时长、日期、任务编号 |

生产环境通过 `next/font` 或本地字体文件加载 Bricolage/Syne，禁止运行时链接 Google Fonts。字体加载失败时回退到系统无衬线字体。

### 5.2 产品字号

| Token | 字号/行高 | 用途 |
| --- | --- | --- |
| `--text-xs` | `12px / 18px` | 辅助说明、表格次要信息 |
| `--text-sm` | `14px / 22px` | 产品正文、按钮、表单 |
| `--text-base` | `16px / 26px` | 重要说明、空状态正文 |
| `--text-lg` | `18px / 26px` | 面板标题 |
| `--text-xl` | `24px / 32px` | 页面标题 |
| `--text-display` | `48px 至 96px / 0.92 至 1.0` | 仅首页品牌标题 |

规则：

- 产品界面使用固定字号，不用视口宽度缩放字体。
- 页面标题默认 `24px`，管理后台和弹窗不得使用展示字号。
- 字距保持 `0`；仅 Logo 自身可包含字形设计，不在 CSS 中使用负字距。
- 正文单行长度限制在 `65ch` 至 `75ch`。
- 中文按钮不换行，文本过长时调整布局或改用菜单。

## 6. 尺寸、间距与形状

### 6.1 4px 间距基线

| Token | 值 | 常见用途 |
| --- | ---: | --- |
| `--space-1` | `4px` | 图标与紧凑状态点 |
| `--space-2` | `8px` | 控件内部小间距 |
| `--space-3` | `12px` | 紧凑面板和表格单元格 |
| `--space-4` | `16px` | 普通组件内边距 |
| `--space-5` | `20px` | 页面区块内部间距 |
| `--space-6` | `24px` | 页面横向边距、面板间距 |
| `--space-8` | `32px` | 区块间距 |
| `--space-10` | `40px` | 首页结构间距 |
| `--space-12` | `48px` | 首页主要段落间距 |

### 6.2 圆角

| Token | 值 | 使用范围 |
| --- | ---: | --- |
| `--radius-xs` | `4px` | 小标签、颜色块 |
| `--radius-sm` | `6px` | 图标按钮、小输入框 |
| `--radius-md` | `8px` | 默认按钮、输入、卡片、侧栏、面板 |
| `--radius-lg` | `12px` | 仅大型弹窗、媒体预览或明确的容器层级 |
| `--radius-full` | `999px` | 头像、状态点、开关轨道，不用于普通按钮 |

常规卡片和输入最大 `8px`。不允许页面区块使用超大圆角，也不允许卡片内再嵌套装饰卡片。

### 6.3 阴影与边框

- 结构优先使用 `1px` 语义边框。
- 深色侧栏可使用 `0 20px 48px rgb(0 0 0 / 24%)`，仅用于固定外壳。
- 浅色侧栏可使用 `0 10px 28px rgb(32 43 27 / 8%)`。
- 普通卡片不同时使用细边框和宽散射阴影。
- 弹窗、下拉和拖拽预览可使用中等阴影，用于真实的 Z 轴层级。
- 禁止把阴影作为每个卡片的默认装饰。

## 7. 布局系统

### 7.1 断点

沿用 Tailwind：`sm 640`、`md 768`、`lg 1024`、`xl 1280`、`2xl 1536`。

- 使用 `100dvh`，不使用 `100vh` 或 `h-screen` 构建全屏工作区。
- 桌面外壳从 `md` 开始显示左侧栏。
- 图片/视频对话侧栏从 `lg` 开始常驻，低于 `lg` 使用 Drawer。
- 页面内容最大宽度默认 `1280px`；首页作品构图最大可放宽至 `1480px`。
- 无限画布不受内容最大宽度限制，占满剩余工作区。

### 7.2 应用外壳

#### 桌面侧栏

- 外边距 `12px`，宽度 `88px`，高度 `calc(100dvh - 24px)`。
- 顶部为 Logo，主体为导航，底部依次为主题、积分、公告、配置和用户。
- 导航项高度 `56px` 至 `60px`，图标 `18px` 至 `20px`，标签 `11px`。
- 当前项使用黄绿色背景和高对比前景，不使用紫色渐变。
- 悬停只改变表面和轻微位移，离开即恢复，不创建持久状态。
- 主题菜单继续支持跟随系统、浅色、深色，不能退化成仅黑白二选一。

#### 移动端导航

- 采用现有 Drawer，不复制预览 HTML 的固定底部栏。
- Drawer 顶部保留品牌与关闭操作，导航项使用 `44px` 以上触控高度。
- 主题偏好位于 Drawer 底部，与桌面侧栏共享 `ThemePreferenceMenu`。

### 7.3 页面头部

- 产品页面头部使用标题、简短说明和右侧主要操作，底部 `1px` 分隔线。
- 首页可使用非对称品牌字标和作品墙。
- 资产、提示词、管理后台不使用巨型 Hero、编号眉题或营销指标。
- 页面级筛选和操作栏保持单独一行，窄屏自动换行。

## 8. 图标与品牌资产

- 项目已经统一使用 `lucide-react`，重构继续沿用，避免混入第二套图标库。
- 常规图标尺寸：`16px`、`18px`、`20px`、`24px`；同一层级必须统一。
- 线宽默认 `1.5` 至 `1.75`，主操作最多 `2`。
- 熟悉的图标按钮不重复显示文字；不熟悉的图标必须提供 Tooltip 和 `aria-label`。
- 参考素材、资产库、提示词库、更多设置使用无边框 `图标 + 文字`。
- AI 提示词优化只使用 Sparkles 图标，带 Tooltip，位于提交按钮左侧。
- Logo 使用正式矢量资产，不继续使用嵌入 Base64 PNG 的 SVG 容器。
- 紫粉 Logo 不随主题改色，必须保留足够安全空间；单色版仅用于 favicon、打印或特殊单色环境。

## 9. 核心组件规范

### 9.1 按钮

| 类型 | 视觉 | 使用场景 |
| --- | --- | --- |
| Primary | 黄绿色实底，高对比文字 | 每个视区唯一主要动作 |
| Default | 语义表面 + 1px 边框 | 次要动作、表单提交组 |
| Text/Ghost | 透明，无默认边框 | 工具栏、卡片内部动作 |
| Icon | 方形 `32/36/40px` | 熟悉工具操作，必须 Tooltip |
| Danger | 危险色文字或实底 | 删除、禁用、不可恢复动作 |

尺寸：

- `small`: 高 `32px`，图标 `16px`。
- `middle`: 高 `36px` 或 `40px`，图标 `18px`。
- `large`: 高 `44px` 或 `48px`，只用于首页与主要表单。
- 图标触控区在移动端不得小于 `44px`。

状态优先级：`disabled > loading > active > focus > hover > default`。

### 9.2 表单与选择控件

- 默认高度 `40px`，紧凑后台表格内可使用 `32px`。
- 标签在输入框上方，错误说明紧邻输入框下方。
- 占位符在双主题下均达到 `4.5:1`。
- Focus 使用 `2px` 黄绿色焦点环或边框，不使用紫色光晕。
- 复选框、开关、单选和分段控件使用 Ant Design 原生语义，不制作自定义替代品。
- 数值、比例、时长使用 Select、Segmented、Slider、InputNumber 等对应控件，不用普通文本按钮模拟。

### 9.3 卡片与媒体项

- 卡片只用于资产、提示词、项目预览、生成结果等可独立选择的实体。
- 页面区块、筛选栏和普通信息组不应全部卡片化。
- 卡片圆角 `8px`，媒体保持稳定 `aspect-ratio`，文本与操作不能改变卡片尺寸。
- 卡片悬停可提升 `1px` 至 `2px`，同时改变边框或背景，不叠加宽阴影。
- 媒体必须展示真实内容；空媒体使用有业务说明的 Empty 状态，不用抽象装饰图形。

### 9.4 Modal、Drawer、Popover

- 简单确认使用 Modal；列表导航和移动侧栏使用 Drawer；轻量设置使用 Popover。
- 常规宽度 `480px` 至 `560px`，复杂设置最大 `720px`，媒体选择器可到 `1040px`。
- 移动端 Modal 宽度为 `calc(100vw - 32px)`，内容区可滚动，底部操作可见。
- Modal 最大圆角 `12px`，不得沿用当前 `16px` 以上大圆角。
- 下拉和 Popover 必须通过 Portal 渲染，避免被 `overflow: hidden` 裁切。

### 9.5 表格

- 管理后台默认高密度，表头高 `40px`，普通行高 `48px`。
- 文本左对齐，数字右对齐并使用等宽数字，状态居中，操作右对齐。
- 表格外不再包一层装饰卡片，直接使用页面区块和分隔线。
- 筛选栏可横向排列，低于可用宽度时折行，不允许横向溢出。
- 行内操作超过三个时使用“更多”菜单，危险动作与普通动作分组。
- 加载使用对应列宽的 Skeleton，空状态说明下一步操作。

### 9.6 Toast 与反馈

- 成功、失败和短暂反馈使用 Ant Design Message。
- 需要用户行动或较长说明时使用 Alert 或页面内状态，不用 Toast 承载。
- 保存中、上传中、生成中必须在触发控件和对应内容区域同时表达状态。
- 颜色不是唯一状态信息，必须同时有文字、图标或进度。

## 10. 页面与工作流规范

### 10.1 首页

- 第一屏直接呈现 Novanova Studio 品牌、Agent 入口和真实作品，不能是营销功能介绍页。
- 桌面采用非对称双栏；移动端按品牌、输入、作品顺序单列。
- 品牌字标最多占两行，支撑文案最多四行。
- Agent 输入区是第一主操作，图片、视频、无限画布是第二层入口。
- 首页只保留必要文案，避免重复解释功能。
- 作品墙使用真实用户资产或项目内示例资源，不使用随机外链图片。

### 10.2 图片与视频创作

- 保留 `CreationWorkspace` 的对话侧栏、消息区、输入区三段结构。
- 桌面对话侧栏宽度 `300px` 至 `320px`；移动端使用 Drawer。
- 输入区贴近底部，但必须保留安全间距，不能遮住最后一条结果。
- 输入区使用纯色表面与细边框，移除现有多层渐变、光带和大阴影。
- 参考图上传后立即显示本地预览与上传状态；上传未完成时禁止生成。
- 工具顺序：参考素材、资产库、提示词库、更多设置；Sparkles；提交。
- 模型、尺寸、数量、时长放入更多设置，不占用主输入区。
- 生成结果以媒体为中心，提示词和技术元数据默认折叠或弱化。

### 10.3 无限画布

- 画布是沉浸式工作区，隐藏全局侧栏，保留顶部栏、主工具栏、节点操作和 Agent 面板。
- 背景改为纯色冷中性表面，可选点阵或线网格；禁止紫粉背景渐变。
- 工具栏和状态栏使用无边框、无阴影、无胶囊背景的极简扁平风格。
- 节点使用 `8px` 圆角和清晰边界；选中态使用黄绿色描边，不使用紫色发光。
- 图片和视频节点尊重原始比例，加载、失败、选中、批量子节点状态必须可区分。
- 连接线默认弱化，选中连接线提升对比度；连接把手不依赖颜色单独表达可连接状态。
- Agent 面板是创作编排入口，文案强调当前动作、阶段与结果，不使用泛泛的 AI 魔法文案。
- 拖拽预览必须使用真实缩略图或图标库，禁止使用 Emoji 作为节点类型图标。
- 画布动效用于缩放、拖拽、选择、连接和节点状态切换，不做装饰性漂浮。

### 10.4 资产库

- 页面结构为标题与操作、筛选栏、资产网格、分页。
- 资产网格响应式使用 `repeat(auto-fit, minmax(240px, 1fr))` 或等价 Tailwind 栅格。
- 筛选栏使用无阴影表面，搜索与 Segmented 保持同一高度。
- 卡片优先展示媒体，文本资产展示真实摘要；操作放底部或更多菜单。
- 批量导入、导出和新增资产保持当前业务行为，视觉重构不得改变数据格式。

### 10.5 提示词库

- 卡片展示标题、真实封面或提示词摘要、标签和使用动作。
- 标签最多展示四个，其余收起；Tag 使用中性底色，不使用多彩装饰标签。
- 选择弹窗保留筛选、无限加载和使用动作，加载状态改为匹配卡片布局的 Skeleton。
- “复制”和“使用”文案必须区分，不能用相同图标或反馈混淆行为。

### 10.6 管理后台

- 使用相同主题与外壳，但视觉密度更高，不复制首页艺术排版。
- 页面标题 `24px`，Tabs、筛选、表格直接构成结构，不使用营销卡片。
- 用户、公告、提示词等数据使用 Ant Design Table 和标准表单。
- 搜索、筛选和新增操作在同一工具行，低宽度时按筛选区、主要操作顺序换行。
- 行内操作超过三项改为 Dropdown，删除和禁用保持危险语义。
- 管理后台不额外维护自己的 `dark` 分支，所有主题由 `app-theme.ts` 控制。

## 11. 主题切换规范

- 默认偏好为 `dark`，服务器端根据 Cookie 输出初始 `data-theme`；用户仍可在侧栏切换浅色或跟随系统。
- 桌面主题入口位于左侧菜单下方操作区；移动端位于导航 Drawer 底部。
- 菜单提供：跟随系统、浅色模式、暗色模式，并标明跟随系统时的当前解析结果。
- 主题切换只过渡颜色、边框和轻量阴影，持续 `150ms` 至 `220ms`。
- 不在主题切换时播放页面级过场动画。
- 同步浏览器 `theme-color`、Ant Design、Pro Components、XYFlow 与画布主题。
- 所有新功能提交前必须在两个主题下独立检查，不允许从单主题推断另一个主题。

## 12. 动效规范

### 12.1 时长与缓动

| 类型 | 时长 | 缓动 |
| --- | ---: | --- |
| 颜色、边框、透明度 | `150ms` | `cubic-bezier(0.22, 1, 0.36, 1)` |
| 悬停位移、按钮反馈 | `180ms` 至 `220ms` | 同上 |
| Drawer、Modal | `220ms` 至 `300ms` | Ant Design 默认或同等指数缓出 |
| 首页作品切换 | `400ms` 至 `600ms` | 同上 |

### 12.2 允许的动效

- 导航悬停和当前项切换。
- 按钮按下 `scale(0.98)` 或 `translateY(1px)`。
- 媒体卡片轻微缩放，最大 `1.03`。
- 画布节点拖拽、连接、缩放和状态变化。
- 上传、生成和保存状态进度。

### 12.3 禁止的动效

- 无限循环漂浮、呼吸光、跑马灯和无业务意义的粒子。
- 弹跳、弹性和夸张旋转。
- 在滚动容器上使用大面积 Blur 动画。
- 使用 React state 持续记录鼠标位置或滚动进度。
- 用 `top`、`left`、`width`、`height` 实现高频动画。

所有动效必须在 `prefers-reduced-motion: reduce` 下禁用或退化为直接状态切换。

## 13. 内容、状态与无障碍

### 13.1 文案

- 页面文案使用中文，简短、动作导向，避免泛化的“释放创造力”“AI 魔法”等措辞。
- 用户保存和复用的内容使用“资产”“资产库”；临时上传或参考输入继续使用“素材”。
- 按钮使用明确动词：创建、生成、上传、保存、复制、删除。
- 不在产品界面显示功能教学、键盘快捷键说明或视觉风格自述；需要时使用 Tooltip、帮助菜单或空状态引导。

### 13.2 加载与空状态

- 页面和列表加载使用与最终内容同形的 Skeleton。
- 按钮加载保留原宽度，避免布局跳动。
- 空状态包含状态说明和一个最相关的下一步动作。
- 媒体加载失败显示重试、删除或替换动作，不能只显示错误图标。

### 13.3 对比度与键盘

- 正文、占位符达到 WCAG AA `4.5:1`。
- 大字号文本和 UI 边界至少 `3:1`。
- 所有交互支持键盘访问，焦点环宽 `2px`，偏移 `2px` 至 `3px`。
- Icon-only 按钮必须有 `aria-label` 和 Tooltip。
- 对话框打开后管理焦点，关闭后返回触发控件。
- 状态不能只依赖颜色，必须有图标、文字或形状差异。

## 14. 技术实现约束

### 14.1 Ant Design 映射

`getAntThemeConfig` 必须从语义 Token 构造：

| Ant Design Token | Novanova Token |
| --- | --- |
| `colorPrimary` | `studio.action` |
| `colorPrimaryHover` | `studio.actionHover` |
| `colorTextLightSolid` | `studio.actionForeground` |
| `colorBgLayout` | `studio.page` |
| `colorBgContainer` | `studio.surface` |
| `colorBgElevated` | `studio.surfaceRaised` |
| `colorBorder` | `studio.lineStrong` |
| `colorBorderSecondary` | `studio.line` |
| `colorText` | `studio.ink` |
| `colorTextSecondary` | `studio.text` |
| `colorTextTertiary` | `studio.muted` |
| `colorFillTertiary` | `studio.surfaceHover` |
| `borderRadius` | `8` |

Button、Input、Modal、Table、Tag、Select、Menu、Tabs 和 Drawer 必须有双主题映射。Modal 的 `borderRadiusLG` 从当前 `16` 收敛到 `12`。

### 14.2 Tailwind 使用

- 优先使用 `text-[var(--studio-ink)]`、`bg-[var(--studio-surface)]` 等语义变量。
- 重复三次以上的视觉模式应抽成共享组件类或组件，不复制长串 Tailwind。
- 页面私有布局留在对应组件中，避免继续扩张 `globals.css`。
- 不使用任意十六进制 Tailwind 值表达主题颜色。
- Tailwind 断点和组件尺寸必须与本规范一致。

### 14.3 画布主题映射

`canvasThemes` 仅保留以下专用角色：

- `canvas.background`
- `canvas.dot`
- `canvas.line`
- `canvas.selectionStroke`
- `canvas.selectionFill`
- `node.fill`
- `node.stroke`
- `node.activeStroke`
- `connection.default`
- `connection.active`

节点文本、弱文本、表面和工具栏应直接引用全局语义 Token。删除 `backgroundGradient` 与 `activeGradient`，避免画布形成独立紫色主题岛。

### 14.4 图像与性能

- 项目内静态图片使用 Next.js Image 或明确尺寸的 `img`，始终提供 `width/height` 或 `aspect-ratio`。
- 首屏只对真正的 LCP 图片使用优先加载。
- 大型媒体列表使用懒加载和缩略图，不在网格中直接加载原图。
- Blur 仅用于固定浮层且有明确必要，不用于滚动面板和画布大区域。
- 连续画布交互使用 `requestAnimationFrame`、XYFlow 或 Motion value，不用 React state 驱动每帧更新。

## 15. 重构落地顺序

### 阶段 A：主题基础

1. 在 `globals.css` 建立三层 Token 和双主题语义变量。
2. 重构 `app-theme.ts`，从同一语义色板映射 Ant Design。
3. 保留 `useThemeStore` 与现有 Cookie/系统主题能力。
4. 重构 `canvas-theme.ts`，删除独立紫色渐变主题。
5. 增加 Token 与主题映射测试，验证双主题对比度。

### 阶段 B：应用外壳与首页

1. 重构 `AppShell`、`AppSidebar`、`MobileNavDrawer`。
2. 把主题入口固定到侧栏下方操作区。
3. 将首页按预览范式实现为品牌字标、Agent 输入、真实作品和三个创作入口。
4. 使用正式 Logo 资产替换嵌入位图的 SVG。

### 阶段 C：图片与视频工作区

1. 收敛 `CreationWorkspace`、对话侧栏、消息线程和 Composer。
2. 移除 Composer 渐变、光带和大阴影。
3. 统一参考素材、资产库、提示词库、更多设置和提示词优化布局。
4. 补齐上传、生成、取消、失败和重试状态。

### 阶段 D：无限画布

1. 替换画布背景、节点、连接线和选择状态。
2. 重构顶部栏、工具栏、悬停工具栏、提示词面板和 Agent 面板。
3. 移除 Emoji 节点拖拽预览和硬编码视觉值。
4. 验证缩放、拖拽、批量生成和多节点布局不发生视觉回归。

### 阶段 E：资产、提示词与管理后台

1. 统一页面头部、筛选栏、实体卡片和分页。
2. 统一 Prompt 弹窗和 Asset 弹窗。
3. 将管理后台收敛为高密度表格和标准操作栏。
4. 清理页面私有主题分支与重复样式。

### 阶段 F：验收

1. 桌面视口：`1440x900`、`1280x800`、`1024x768`。
2. 移动视口：`390x844`、`375x667`。
3. 深色、浅色、跟随系统三种主题偏好。
4. 键盘、屏幕阅读器、减少动态效果、200% 缩放。
5. 图片/视频生成、粘贴上传、资产选择、提示词选择、画布创建与导出、管理后台筛选与编辑。
6. 检查内容重叠、文本溢出、布局抖动、滚动裁切和焦点丢失。

## 16. 完成标准

整体重构只有同时满足以下条件才算完成：

- 所有主要页面使用同一套语义 Token，不存在页面级色板孤岛。
- 深浅主题均通过 WCAG AA，且系统主题无闪屏。
- 首页接近参考预览的品牌气质，产品页保持专业工具密度。
- 图片、视频和无限画布的核心工作流行为未改变。
- 所有组件具备完整交互状态，移动端触控区和布局稳定。
- 不存在紫蓝 AI 渐变、装饰性玻璃、过度圆角、嵌套卡片和大面积发光。
- 不存在 Emoji 结构图标、手写 SVG UI 图标或混用图标库。
- 不存在 `dark ? color : color` 页面私有主题分支和新增硬编码主题色。
- Ant Design、Tailwind、全局 CSS 和画布主题从同一主题源派生。
- 已完成静态检查、主题对比度检查、关键交互测试和桌面/移动端视觉验收。
