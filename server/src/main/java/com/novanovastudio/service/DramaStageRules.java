package com.novanovastudio.service;

import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import java.util.List;

/**
 * 智能短剧的阶段顺序。制作进度只在确认后前进一步，修改则回到被修改的阶段。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-14 00:40
 */
public final class DramaStageRules {

    /** 主Agent入口来源。 */
    public static final String ENTRY = "drama";

    /** 文本积分流水使用的稳定业务名称。 */
    public static final String OPERATION = "智能短剧文本生成";

    /** 从制作方案到成片预览的固定顺序。声音步骤暂时不进入流程。 */
    public static final List<String> ORDER = List.of("plan", "script", "cast", "storyboard", "shot", "preview");

    private DramaStageRules() {
    }

    /**
     * 返回阶段在固定顺序中的位置。
     *
     * @param stage 阶段标识
     * @return 从0开始的位置
     * @throws BusinessException 阶段不在制作流程内时抛出
     */
    public static int index(String stage) {
        int index = ORDER.indexOf(stage);
        if (index < 0) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的短剧阶段");
        }
        return index;
    }

    /**
     * 返回确认后的下一阶段。
     *
     * @param stage 当前阶段
     * @return 下一阶段；成片预览返回空
     */
    public static String next(String stage) {
        int index = index(stage);
        return index + 1 >= ORDER.size() ? null : ORDER.get(index + 1);
    }

    /**
     * 返回依赖指定阶段的后续阶段。
     *
     * @param stage 被修改的阶段
     * @return 需要标记为待更新的阶段
     */
    public static List<String> downstream(String stage) {
        int index = index(stage);
        return ORDER.subList(index + 1, ORDER.size());
    }

    /**
     * 判断目标阶段是否已经产生过，或就是当前等待确认的阶段。
     *
     * @param currentStage 当前进度
     * @param targetStage 用户要修改的阶段
     * @param targetExists 该阶段是否已有版本
     * @return 允许修改时为true
     */
    public static boolean canRevise(String currentStage, String targetStage, boolean targetExists) {
        return targetExists || index(targetStage) == index(currentStage);
    }
}
