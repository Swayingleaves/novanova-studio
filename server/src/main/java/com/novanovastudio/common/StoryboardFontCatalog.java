package com.novanovastudio.common;

import java.util.Map;

/**
 * 分镜文字字体白名单及随服务端分发的字体资源目录。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-09-24 00:00
 */
public final class StoryboardFontCatalog {

    /** 中文及英文字体的稳定标识与资源路径。 */
    private static final Map<String, String> FONT_FILES = Map.of(
            "notoSansSc", "NotoSansSC.ttf",
            "notoSerifSc", "NotoSerifSC.ttf",
            "lxgwWenKai", "LXGWWenKai.ttf",
            "inter", "Inter.ttf",
            "montserrat", "Montserrat.ttf",
            "lora", "Lora.ttf",
            "caveat", "Caveat.ttf");

    /** 默认中文补字字体标识。 */
    public static final String DEFAULT_FONT_FAMILY = "notoSansSc";

    /**
     * 禁止实例化字体目录。
     */
    private StoryboardFontCatalog() {
    }

    /**
     * 查询字体对应的资源文件并校验白名单。
     *
     * @param fontFamily 字体稳定标识
     * @return 字体资源文件名
     * @throws BusinessException 字体不在支持目录中
     */
    public static String fileName(String fontFamily) {
        String fileName = fontFamily == null ? null : FONT_FILES.get(fontFamily);
        if (fileName == null) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的分镜文字字体: " + fontFamily);
        }
        return fileName;
    }

    /**
     * 判断字体是否为仅支持西文的选项。
     *
     * @param fontFamily 字体稳定标识
     * @return 是否需要使用默认中文字体补字
     */
    public static boolean isLatinFont(String fontFamily) {
        return "inter".equals(fontFamily) || "montserrat".equals(fontFamily)
                || "lora".equals(fontFamily) || "caveat".equals(fontFamily);
    }
}
