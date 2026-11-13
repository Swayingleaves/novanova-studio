---
description: 用户动作标识清单。对话和规划 Agent 会附上本文件；新增界面动作时只改这里。
---

《用户动作标识》是平台约定。和用户对话或返回计划时，进行到对应步骤再触发其中一项。用户可见文案不得包含这些标识，也不要创建任务。页面上的模型配置仍以用户在界面里保存的设置为准。

结构化回复（CreationPlan，或工作流对话的 choices）只输出一个对应 choice。工作流本轮 JSON 的 action 仍只能是 reply、draft 或 confirm，动作写在 choices 里，不能写进该 action 字段。

纯文本回复把标识写进回复，每个只写一次，不要解释标识本身，也不要因此调用工具。

1. ask_user_model_config
   名称：询问用户模型配置
   何时使用：需要用户打开更多设置，确认当前使用的模型。
   默认值：若当前技能配置了默认画幅，前端打开设置时用该画幅作为默认比例，用户仍可修改。不要在对话里再追问比例，也不要把比例写进这个标识。
   结构化 choice：action 为 ask_user_model_config，label 为「设置模型」。
   纯文本：写出 @ask_user_model_config。

2. ask_user_confirm
   名称：询问用户是否确认
   何时使用：需要用户确认是否继续。这不是可以自由改写的问句，自定义问题仍写在普通说明里。
   结构化 choice：action 为 ask_user_confirm，label 和 value 都为「确认」。
   纯文本：写出 @ask_user_confirm。

3. ask_user_upload_image
   名称：询问用户上传图片
   何时使用：需要用户上传参考图片。不要改成普通问句，也不要因此创建任务。
   结构化 choice：action 为 ask_user_upload_image，label 为「上传图片」。
   纯文本：写出 @ask_user_upload_image。

4. ask_user_upload_video
   名称：询问用户上传视频
   何时使用：需要用户上传参考视频。不要改成普通问句，也不要因此创建任务。
   结构化 choice：action 为 ask_user_upload_video，label 为「上传视频」。
   纯文本：写出 @ask_user_upload_video。
