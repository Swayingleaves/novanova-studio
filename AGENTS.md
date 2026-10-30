# AGENTS.md

本文档用于约束本项目中的 AI / 自动化开发行为。开发时优先遵循本文件，其次遵循用户当前消息。

# 必要
- 如果存在`~\.codex\AGENTS.md`全局配置文件，你需要读取并同时遵循其中的规定。
- ../novanova-studio 是开源版本。两个项目独立维护，不默认同步代码、迁移或架构决策。源码、依赖副本与缓存、构建产物、镜像、容器、网络、端口、数据库、Redis、日志和应用密钥必须隔离；OSS 按用户要求共用，不作为跨项目同步入口。

## 基本原则

- 先读现有代码，再动手修改，优先沿用项目已有结构和写法。
- 写代码保持最少行数，能简单实现就不要引入复杂抽象。
- 标准格式、协议、解析、压缩、加密、日期等通用能力优先使用成熟稳定的库，不要手写底层实现，除非用户明确要求或项目已有实现必须沿用。
- 不要为了“兼容更多场景”写大量分支，只实现当前明确需要的功能。
- 项目尚未上线，不需要兼容旧数据；表结构或字段调整时直接按新设计修改，不写旧字段兼容、数据迁移兜底或删除旧表的清理逻辑，除非用户明确要求。
- 不要改无关文件，不要顺手重构。
- 如果工作区已有用户改动，不要回滚，不要覆盖；只在必要范围内追加修改。
- 不要主动commit代码，除非我主动要求

## 反复提醒沉淀

- 如果开发过程中总是遇到某个问题，或者用户反复提醒同一个注意事项，需要把该注意事项补充到本文件。
- 补充时写成明确、可执行的规则，避免只写模糊描述。
- 新规则应放到最相关的章节；找不到合适章节时放到“项目注意事项”。

## 服务端规范

- 服务端使用 Java、JDK 21、Spring Boot 3.5、AgentScope Java、Redis、PostgreSQL。
- 服务端目录为 `server/`，基础包名为 `com.novanovastudio`。
- `controller/` 只处理 HTTP 入参、调用 service、返回 `ApiResponse`。
- `service/` 放业务逻辑、默认值、校验、时间、ID、鉴权、任务编排等处理。
- `repository/` 只做数据库访问，优先使用 Spring R2DBC `DatabaseClient` 和显式 SQL，不使用 JPA 自动建表。
- 服务端 HTTP 层统一使用 Spring WebFlux，SSE 使用 `Flux<ServerSentEvent<?>>` 返回，不再引入 Servlet API、`SseEmitter` 或 Spring MVC 组件。
- `entity/` 只定义数据库实体和简单模型方法，每个属性都必须有中文注释。
- `dto/` 只定义接口请求、响应和事件数据结构。
- `security/` 放鉴权、当前用户、权限校验等安全相关能力。
- `task/` 放任务队列、事件发布、异步任务状态协作等能力。
- `agent/` 放 AgentScope Java 任务编排入口和 Agent 能力封装。
- `storage/` 放对象存储、媒体上传下载等外部存储能力。
- `common/` 放统一响应、错误码、业务异常、通用工具。
- `config/` 放 Spring Bean、安全、配置属性等应用配置。
- 服务端 JSON 序列化和反序列化统一使用 Fastjson2，不新增 Jackson `ObjectMapper` 作为业务序列化入口。
- 服务端使用 Logback 输出日志，请求接口必须记录 URL、Header、请求内容和响应内容；重要业务节点使用 `log.info`，异常使用 `log.error`。
- 业务接口保持 `{ code, data, msg }` 的响应结构。
- 接口路径名称统一为驼峰命名，比如 `/auth/userInfo`、`/ai/task/createTask`。
- PostgreSQL schema 使用 Flyway，迁移文件放在 `server/src/main/resources/db/migration/`。
- Flyway 已执行或已发布的版本迁移 SQL 禁止修改；数据库结构、数据或注释变更必须新增更高版本迁移文件，避免校验和不一致导致 `Validate failed`。
- 数据库表名、库名、字段名统一使用下划线，表和字段必须写注释。
- 新增或调整数据表时同步更新 `docs-api/backend-database.md`。
- 要求模型回填内容时，不要让模型逐字转抄 36 位 UUID 之类的长随机标识：一个批次动辄几十个标识，抄错一位就整批报废。改用批内短序号（`e1`、`ep2`）交给模型填写，服务端在落库前映射回真实标识；序号一律从 1 起，避免模型把下标偏移当成合法值。
- 同一份数据在同一次模型调用里只能有一套标识体系。跨单元传递时（例如事件取舍的结果要交给逐集规划参考），必须翻译成同一套批内序号，不能让模型同时看到 UUID 和序号两种写法。
- 服务端固定的身份字段（分集标识、集号、排序、时长、内容形式、目标集数）由服务端按预分配结果覆写，不要校验模型是否填对。校验模型的回填值只会带来整批作废的风险，模型本来就只该负责内容。**服务端的进度/状态字段（如 `completionStatus`）同样适用**：它在合并阶段按缺省值补齐即可，不要用 `@NotBlank` 要求模型给，更不要因为模型漏填就拒绝整批。补齐时只填缺失的，已填值必须保留，避免把已完成的内容误降级。
- 存 AI 草稿时 `sourceData` 必须写生成时的真实目标内容快照（`targetSnapshot`），不能存空对象。草稿应用前会拿 `sourceData` 与当前内容做全等比对来发现人工改动；存空对象会让校验永久失败，并被误报成"目标内容已经变化，请重新生成草稿"。同理，这个快照不能只在有结构校验的分支里取，所有产出草稿的分支都要有。
- 用 SQL 或脚本直接构造 `source_data` 这类要与 DTO 序列化结果做全等比对的 JSON 时，不要用 `to_jsonb(表行)`：它产出 snake_case（`episode_id`），而 fastjson2 默认序列化成 camelCase（`episodeNumber`），键名不一致会让比对恒为失败。正确做法是复用 DTO 构造，保证序列化形态一致。写完必须离线复现同一构造并逐类比对通过，再让用户点应用。
- JDBC 的 `PreparedStatement.executeQuery(参数)` 会报"不能使用获取查询字符的查询方法"，必须先 `setString`/`setXxx` 再 `executeQuery()`。
- 批量 UPDATE 一定要带主键条件。按业务字段（如 `target_type`）匹配会在循环里反复命中同一批行，执行次数会成倍放大。写完立刻核对受影响行数是否等于预期条数。
- javac 报的语法错误行号不一定指向真正出错的行，多写或少写一个括号时报错会落在括号提前闭合之后的位置，肉眼扫不出来。遇到看起来完全合法的行却报语法错，用脚本跳过字符串和注释做括号平衡扫描来定位真实位置。

## 前端UI规范

[UI-DESIGN.md](UI-DESIGN.md)

## 前端规范

- 前端使用 Next.js App Router、React、TypeScript、Ant Design、Tailwind、Zustand。
- 编写 Ant Design 相关代码时，参考 https://ant.design/llms-full.txt 理解组件 API、示例和设计规范，并优先结合项目当前 antd 版本与既有写法。
- 新增或修改 Ant Design 组件时，核对当前安装版本的废弃属性并使用替代 API：Modal 遮罩关闭使用 `mask.closable`；InputNumber 单位使用 `suffix`，独立附加控件使用 `Space.Compact`，不要新增 `maskClosable`、`addonBefore` 或 `addonAfter`。
- antd 组件自带固定宽度的样式（如 `InputNumber` 默认 90px）是无 CSS 层的样式，优先级高于 Tailwind v4 放在 `@layer utilities` 里的工具类，所以 `className="w-full"` 对它无效。必须用 v4 的后缀感叹号写法 `className="w-full!"`（前缀写法 `!w-full` 在 v4 已失效）。同一个表单里如果有字段没撑满、和其他字段对不齐，先查这里。
- 表单字段的 `<label>` 默认是行内元素：控件有固定宽度时会和 label 挤在同一行，没有固定宽度时会换到下一行，同一排的两个字段就会一上一下。统一给 label 加 `block`，让每个字段都是「标签在上、控件在下」。
- API 请求统一放在 `web/src/services/api/`。
- 全局或跨页面状态优先放在 `web/src/stores/`。
- 已经放在全局 store 或全局 hook 中的状态/动作，组件需要时直接使用对应 store/hook，不要为了“纯组件”层层透传 props；避免一个组件传递过多参数。
- 全局组件、全局常量、全局配置等全局性质的内容不要作为 props 或参数层层传递；哪里需要就在哪里直接从对应全局入口获取。
- 多个页面重复出现的 UI 副作用动作，例如复制文本并提示、下载并提示、统一确认弹窗，优先抽成 `web/src/hooks/` 下的全局 hook；不要放进 store，除非它确实是需要共享/订阅的状态。
- 画布相关状态和组件放在 `web/src/app/(user)/canvas/` 内部。
- 页面里只有一个主业务组件时直接写在 `page.tsx`，不要单独拆 `Manager` 组件再传一堆 props。
- 不要新增只做简单转发的组件，例如只 `return <X>{children}</X>` 或只换个名字透传 props；直接在使用处使用真实组件或把逻辑写进当前文件。
- 页面私有 hook 放在对应页面目录下，例如 `admin/assets/use-admin-assets.ts`；只有多个页面真实复用的 hook 才放到外层 `hooks/`。
- 管理后台页面私有组件放到各自页面目录的 `components/` 下，例如 `admin/assets/components/`、`admin/prompts/components/`；不要为了单页面使用放到 `admin/components/` 共享目录。
- 管理后台主题、背景、卡片阴影、表格配色等统一在 `web/src/lib/app-theme.ts`、`AppProviders` 或必要的全局 CSS 作用域中配置；页面私有组件不要自己写 `dark ? ...` 主题分支。
- 组件优先使用函数组件和现有 hooks，不新增大型状态管理方案。
- UI 图标优先使用 `lucide-react` 或项目已经使用的 Ant Design 图标。
- 页面文案保持中文。
- 不要在组件里堆太多无关逻辑；复杂逻辑优先抽成同目录工具函数或小组件。
- 样式优先由组件自己管理；组件私有样式优先使用 Tailwind className 或少量内联 style，不要为单个组件新增大量全局 CSS。
- 全局 CSS 只放基础变量、全局重置、跨页面通用样式和少量第三方组件必要覆盖；不要在 `globals.css` 堆页面私有样式。
- 代码尽量短小直接，少拆不必要组件，少做多层 props 传递，避免为了抽象堆出更多代码。
- 前端业务数据需要浏览器本地持久化时，默认使用 `localforage`；`localStorage` 只用于极小的简单配置，不要用来保存业务列表、生成记录、图片、base64 或大 JSON。
- 渠道模型适配各自的svg图标时要注意适配暗色模式和亮色模式

## 画布 UI 规范

- 做 canvas 前端 UI 时必须遵循当前画布主题。
- 优先使用 `canvasThemes`、`useThemeStore` 或 Ant Design `ConfigProvider` token。
- 不要硬编码黑白、stone、slate 等颜色导致浅色/深色主题不一致。
- 新增画布按钮、弹窗、浮层时，尽量复用已有工具栏、节点面板、Modal 的视觉风格。
- 画布顶部工具栏和状态信息优先采用极简扁平风格：无边框、无阴影、无胶囊背景，融入整体背景，弱化按钮感，仅保留轻微 hover 反馈，保持简洁现代、低视觉重量。
- 图片节点尺寸逻辑要尊重原始比例，除非功能明确要求自由变形。
- 批量生成、多图展示、助手面板等画布交互要尽量简洁，不要占用过多画布空间。


# 本地构建
- powershell: `$env:JAVA_HOME="$env:USERPROFILE\.jabba\jdk\openjdk@21.0.2"; $env:PATH="$env:JAVA_HOME\bin;$env:PATH"; mvn compile -q`
- Windows 测试出现 `Unable to establish loopback connection` 或 `UnixDomainSockets.connect` 的 `Invalid argument` 时，先在本项目 `server/target/` 下创建短路径套接字目录，再通过 Maven `-DargLine=-Djdk.net.unixdomain.tmpdir=该目录绝对路径` 仅为测试 JVM 指定目录；不要直接跳过网络测试，也不要修改全局 JDK 配置。
- 运行 `mvn springboot:run`
- 注意，如果只是测试的话，运行完成之后需要关掉启动的服务
- 本地测试账号密码是 admin@admin.com / novanovastudio@pwss
