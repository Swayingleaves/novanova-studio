# 团队管理接口

所有业务响应保持 `{ code, data, msg }`。除公开品牌外必须登录；团队请求携带 `X-Team-Id`，SSE携带查询参数 `teamId`。平台空间不传或传0。无效、禁用、未加入或被移除的团队返回明确权限错误，不切回平台资源。身份、我的团队、我的邀请与接受邀请接口独立于当前团队。

仅 `/api/v1/ai/task/subscribe` 和 `/api/v1/ai/agent/events` 从查询参数 `teamId` 解析访问空间，其他请求使用 `X-Team-Id`。`/api/v1/admin/team/listResourceGrants` 的 `teamId` 表示授权管理目标，超级管理员在平台空间即可查看，无需加入目标团队，包括已禁用的团队；团队空间仍不可访问全局团队管理接口。

团队入口 `/team/{teamSlug}/...` 重写至现有页面；团队切换先保存剧本与画布，失败保留原空间，成功整页导航以重建业务状态、缓存和事件连接。登录身份不随切换改变。

平台 `/auth` 与 `/` 分别为平台登录页和首页；`/team/{teamSlug}/auth` 与 `/team/{teamSlug}` 使用对应团队品牌。团队登录入口、访客创作和受限页面引导使用专属登录 URL，`redirect` 保留当前团队业务路径及参数，默认返回团队首页；外站、其他团队及认证循环目标明确拒绝。平台继续使用现有登录弹窗。认证页面不初始化创作数据、钱包和任务订阅；已登录用户访问团队业务页面必须验证有效成员身份，未加入、已禁用或已移除时提示无权限，不自动加入团队。OAuth 使用现有全局回调地址，回调后恢复目标并重新验证成员。跨空间客户端导航重建整页；退出或会话失效时清理登录态、旧团队及钱包，按当前 URL 返回对应空间登录页，团队返回 `/team/{teamSlug}/auth`，平台返回 `/auth`。直接更换已登录账号仍清理旧团队并返回平台入口，新账号进入团队时重新验证成员身份。

团队专属登录页仅提供登录，不显示注册表单、注册验证码或平台注册邀请提示，并提供“返回平台登录”按钮直接进入 `/auth`，不携带团队登录目标；附加 `invitationCode` 不会启用注册入口，也不会传入平台邀请奖励流程。平台登录页与平台登录弹窗继续提供邮箱注册，团队成员仍由管理员创建或邀请加入。

团队空间的首页、侧栏、登录和欢迎标题统一使用团队名称与 Logo；未配置 Logo 时使用平台默认图标，团队名称仍保留。浏览器标题、描述和图标随当前空间同步，保存品牌后立即刷新，返回平台时恢复平台品牌。产品文档、版本对比及平台积分商店保留平台品牌。首页开始创作保留团队路径和提示词参数。

侧栏“切换团队”在当前页面打开选择框，打开、关闭或取消均不改变 URL、当前团队或创作状态。当前团队明确标记，禁用团队与禁用成员不能作为切换目标；仅用户选择其他团队或明确点击“进入平台空间”后执行保存和导航。

从平台入口完成密码或 OAuth 登录后，非超级管理员先查询最新团队关系：有团队时优先弹出同一空间选择框，包含团队管理员和普通成员，只有一个团队也需选择，可明确进入平台空间；无团队时继续原登录目标。查询失败显示错误与重试，不按无团队处理。登录选择期间暂停业务初始化及欢迎弹窗，首次进入不保存登录前的数据；选择原目标所在空间时保留路径及参数，选择其他空间只进入该空间首页。团队专属入口（包括恢复团队目标的 OAuth 回调）直接进入对应团队，不弹选择框。选择状态不持久化，页面刷新不重复弹出。

## 用户名与密码登录

`POST /api/v1/auth/login` 请求为 `{ account, password }`。`account` 包含 `@` 时按小写邮箱查询，否则按全平台唯一且区分大小写的用户名查询；密码错误后不尝试其他标识。公开注册仍通过邮箱验证码完成。

`POST /api/v1/admin/user/createUser` 请求为 `{ account, password, nickname?, role? }`。输入用户名时保存空邮箱，输入邮箱时沿用邮箱账号创建方式。用户名修改后可用于登录；新建或修改用户名为1–50个字符，禁止空白和 `@`。已有邮箱式用户名未修改时仍保留。

`POST /api/v1/admin/user/resetUserPassword` 请求为 `{ userId, newPassword }`，仅平台空间超级管理员可重置无邮箱账号。管理列表的 `canResetPassword` 为展示能力标识，接口仍重新鉴权。重置事务递增 `token_version`，旧令牌后续请求被拒绝，提交后清除密码锁定。全局角色、账号状态、成员状态和余额保持不变。操作日志仅记录操作者、目标和团队。

团队重置要求当前团队启用、操作者仍为有效管理员、目标来源团队匹配且仍为未移除普通成员；使用与移除相同的团队锁。邀请加入不改变来源，历史账号不推断来源。移除立即失去重置权，重新加入原创建团队后恢复。密码在所有空间共用，无邮箱账号忘记密码需联系创建团队或超级管理员。

邀请中的 `invitedUserId` 是已有账号的稳定身份，`invitedAccount` 是展示快照，`email` 允许为空。改名不改变邀请目标；未注册邮箱邀请在用户注册后由邮箱校验接受。

## 超级管理员

以下路径以 `/api/v1/admin/team` 为前缀，仅平台超级管理员可调用。

| 方法与路径 | 参数 | 行为 |
| --- | --- | --- |
| `GET /listTeams` | 无 | 团队、主管理员、子账号数、人数上限及状态 |
| `POST /createTeam` | `name,teamSlug,memberLimit,account,password?,nickname?` | 团队名称最多50字；新账号设置至少8位密码，初始双钱包为0；已有用户名或邮箱发送主管理员站内邀请 |
| `POST /updateTeamSettings` | `teamId,enabled,memberLimit` | 禁用或恢复、修改人数上限，不可低于现有子账号数 |
| `GET /listResourceGrants` | `teamId` | 查看显式授权 |
| `POST /updateResourceGrants` | `teamId,modelIds,objectStorageIds` | 完整替换授权；平台模型与OSS分别授权 |

平台用户列表、用户统计、积分概览和流水支持可选 `filterTeamId`，该参数与访问作用域分开，仅超级管理员可用。不传为全平台，积分查询传0为平台空间，传团队标识只统计该团队发生的数据。

## 用户与团队管理员

以下路径以 `/api/v1/team` 为前缀。

| 方法与路径 | 参数 | 权限与行为 |
| --- | --- | --- |
| `GET /getPublicTeam` | `teamSlug` | 公开名称、介绍、Logo及状态，不返回成员信息 |
| `GET /listMyTeams` | 无 | 当前用户已加入的团队、简介、Logo、本人成员身份和主管理员用户名 `administratorUsername`，不返回管理员邮箱或其他成员账号 |
| `GET /listMyInvitations` | 无 | 当前用户标识或未注册时受邀邮箱对应的未过期邀请 |
| `POST /acceptInvitation` | `invitationId` | 本人账号接受；团队行锁检查名额，重复接受幂等 |
| `GET /getTeam` | 无 | 当前团队管理员查看概况 |
| `POST /updateTeam` | `name,introduction,logoUrl` | 当前管理员修改品牌；名称最多50字；介绍最多200字，可留空；Logo留空使用平台品牌 |
| `GET /listMembers` | 无 | 成员用户名、邮箱、`canResetPassword`、当前团队余额与当前团队消费，不返回成员平台总余额 |
| `POST /createMember` | `account,password,nickname?` | 新用户名或邮箱创建子账号；已有账号明确拒绝，必须邀请 |
| `POST /inviteMember` | `account` | 用户名必须已存在，邮箱可等待注册；7天站内邀请，重复邀请撤销此前待接受邀请 |
| `GET /listInvitations` | 无 | 当前团队邀请管理 |
| `POST /resendInvitation` | `invitationId` | 按原目标重新发出7天邀请，不通过旧用户名重新匹配账号 |
| `POST /resetMemberPassword` | `userId,newPassword` | 仅重置本团队创建、未移除、无邮箱且全局角色为普通用户的普通成员；禁用成员仍可重置 |
| `POST /revokeInvitation` | `invitationId` | 撤销本团队待接受邀请 |
| `POST /updateMemberStatus` | `userId,enabled` | 仅修改当前团队成员状态，不修改全局账号 |
| `POST /updateMemberRole` | `userId,memberRole` | 当前有效团队管理员授予其他现有成员 `administrator` 或 `member`，不能修改主管理员及本人身份；保留成员状态、钱包和其他空间角色 |
| `POST /removeMember` | `userId` | 撤权、冻结余额并持久化清理；保留全局账号及账本 |
| `GET /listConfigurationModes` | 无 | 五类内容模块的继承设置 |
| `POST /updateConfigurationMode` | `moduleName,inheritGlobal` | 模块值为 `prompts,notifications,styles,skills,homepage` |
| `GET /listAvailableResources` | 无 | 管理员可见资源目录，绝不返回密钥 |
| `GET /listResourcePreferences` | 无 | 当前团队启用及默认设置 |
| `POST /saveResourcePreference` | `resourceType,resourceId,enabled,defaultResource` | `resourceType` 为 `model` 或 `objectStorage` |
| `POST /adjustMemberCredits` | `userId,changeAmount,reason` | 仅手动调整当前团队钱包，金额为6位以内十进制字符串 |
| `GET /listCreditTransactions` | 无 | 当前团队最近200条流水；平台钱包余额快照不返回 |

团队管理员可复用内容、专项价格及自有资源管理后台；无权访问全局用户、接口记录、全站配置、卡密和团队管理接口。继承内容模块只读，切换独立后才能编辑。团队不提供签到、注册赠送、邀请奖励或卡密充值。

团队保留一名由 `administratorUserId` 指定的主管理员，可授权多名团队管理员。成员列表的 `isPrimaryAdministrator` 标记主管理员；其他成员可在“团队身份”列修改身份，授权管理员仍占子账号名额。普通成员没有后台权限，管理员权限调整在后续请求重新鉴权时生效，刷新或重新进入团队后更新页面入口。已禁用成员修改身份后仍为禁用；授权管理员需先降为普通成员才能禁用或移除。授权与移除、密码重置共用团队行锁，事务内重新检查操作者仍为有效管理员，不修改平台角色或其他团队身份。

个人资料中的“专属邀请链接”属于平台邀请奖励功能，仅在平台空间展示和查询；同一账号作为团队管理员或子账号进入团队空间时隐藏，切回平台空间后恢复。团队管理员邀请成员加入团队仍使用独立的团队邀请流程，不受此显示规则影响。

## 钱包与存储

`GET /api/v1/credit/getWalletBalances` 返回本人 `platformBalance`、`teamBalance`（十进制字符串）和 `teamId`。平台模型扣平台钱包，团队模型扣当前团队钱包；模型和OSS独立判断来源。收入记录只表示实际扣款，不增加管理员可消费余额。

以下路径以 `/api/v1/storage` 为前缀。

| 方法与路径 | 参数 | 行为 |
| --- | --- | --- |
| `GET /getTeamUsage` | 无 | 管理员查看本空间全部成员存储占用 |
| `GET /getUsage` | 无 | 本人当前空间实际对象数及字节数 |
| `GET /listBills` | 无 | 本人当前空间最近200条账单 |
| `GET /listTeamBills` | 无 | 当前管理员查看本空间成员账单 |
| `GET /listUnregisteredStorageGroups` | 无 | 历史文件待确认的提供方、桶、区域及数量，不返回成员私有内容 |
| `POST /registerExistingMedia` | `storageId` | 管理员明确确认同一存储身份对应的自有配置后补录台账 |
| `GET /listBillingRates` | 无 | 管理员查看可见资源费率历史 |
| `POST /saveBillingRate` | `storageId,creditsPerGigabyteMonth,enabledDate?` | 仅自有资源；首次启用必须指定今天或未来日期，后续改价下月生效，单价0表示以后免收 |

账单 `billStatus` 为 `unpaid` 或 `paid`，`ownerTeamId=0` 表示扣平台积分，否则扣对应团队积分；用量明细保存实际对象、有效秒数与费率。欠费期间保留读取、下载和删除。移除成员后的实际对象删除失败会持续重试，清理完成前不能重新入团。

历史原文按已保存的配置标识补入台账；历史媒体只有提供方、桶、区域唯一对应一个配置时自动登记，多配置歧义必须由管理员确认。存在待确认文件时该资源不能启用计费。存储配置删除改为停用并保留密钥供物理清理，已有对象时不能直接改变桶、区域、提供方或端点。
