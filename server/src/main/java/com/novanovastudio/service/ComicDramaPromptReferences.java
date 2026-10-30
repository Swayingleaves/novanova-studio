package com.novanovastudio.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.repository.ComicDramaRepository.ShotReferenceImage;
import java.util.List;
import java.util.Objects;
import org.springframework.util.StringUtils;

/**
 * 漫剧提示词正文与系统参考图片说明的确定性组装及快照校验。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-28 10:00
 */
final class ComicDramaPromptReferences {

    /** 禁止实例化纯函数工具类。 */
    private ComicDramaPromptReferences() {
    }

    /**
     * 按实际提交顺序记录稳定图片身份，不记录会刷新的签名地址。
     * @param references 已选中的有序图片
     * @return 有序图片映射
     */
    static JSONArray mapping(List<ShotReferenceImage> references) {
        JSONArray mapping = new JSONArray();
        for (ShotReferenceImage image : references) {
            JSONObject entry = new JSONObject();
            entry.put("imageNumber", mapping.size() + 1);
            entry.put("sourceType", image.sourceType());
            entry.put("sourceId", image.sourceId());
            entry.put("assetType", image.assetType());
            entry.put("mediaId", image.mediaId());
            entry.put("name", image.reference().name());
            entry.put("purpose", purpose(image.assetType()));
            entry.put("role", image.reference().role());
            if (StringUtils.hasText(image.reference().storageKey())) {
                entry.put("storageKey", image.reference().storageKey());
            } else {
                entry.put("url", image.reference().url());
            }
            mapping.add(entry);
        }
        return mapping;
    }

    /**
     * 按资产类型说明图片用途，避免把多个角色都标为主要人物。
     * @param assetType 资产或分镜类型
     * @return 图片用途
     * @throws BusinessException 图片来源类型不受支持
     */
    private static String purpose(String assetType) {
        return switch (assetType) {
            case "character" -> "外观与服装参考";
            case "scene" -> "背景与环境参考";
            case "prop" -> "外观参考";
            case "storyboard" -> "首帧与构图参考";
            default -> throw new BusinessException(ErrorCode.PARAM_INVALID, "不支持的参考图片资产类型：" + assetType);
        };
    }

    /**
     * 创建与当前有序图片绑定的提示词快照。
     * @param body 可编辑正文
     * @param references 实际图片顺序
     * @param source 原有业务来源快照
     * @return 正文、系统说明与映射快照
     */
    static JSONObject snapshot(String body, List<ShotReferenceImage> references, JSONObject source) {
        JSONObject snapshot = new JSONObject(source);
        snapshot.put("promptBody", body.trim());
        JSONArray mapping = mapping(references);
        snapshot.put("referenceImages", mapping);
        String instructions = mapping.stream().map(value -> {
            JSONObject image = (JSONObject) value;
            String type = switch (image.getString("assetType")) {
                case "character" -> "角色";
                case "scene" -> "场景";
                case "prop" -> "道具";
                default -> "分镜画面";
            };
            return "使用 @图片" + image.getIntValue("imageNumber") + " 作为" + type + "「"
                    + image.getString("name") + "」的" + image.getString("purpose");
        }).collect(java.util.stream.Collectors.joining("；"));
        snapshot.put("referenceInstructions", instructions.isEmpty() ? "" : "参考图片说明：\n" + instructions + "。");
        return snapshot;
    }

    /**
     * 读取可编辑正文，旧版本无快照时保留原文。
     * @param version 提示词版本
     * @return 正文
     */
    static String body(ComicDramaDtos.PromptVersion version) {
        JSONObject snapshot = version.sourceSnapshot();
        return snapshot != null && snapshot.containsKey("promptBody")
                ? snapshot.getString("promptBody") : version.prompt();
    }

    /**
     * 合并正文和只读说明，供展示、复制与视频提交共同使用。
     * @param snapshot 提示词快照
     * @return 完整提示词
     */
    static String fullPrompt(JSONObject snapshot) {
        String instructions = snapshot.getString("referenceInstructions");
        return snapshot.getString("promptBody") + (StringUtils.hasText(instructions) ? "\n\n" + instructions : "");
    }

    /**
     * 在报价、建任务与扣费前核对当前图片和提示词版本。
     * @param version 已采用提示词
     * @param references 当前图片
     * @param shotNumber 镜头序号
     * @throws BusinessException 参考图片已变化或旧版本缺少必要映射
     */
    static void validate(ComicDramaDtos.PromptVersion version, List<ShotReferenceImage> references, int shotNumber) {
        JSONArray current = mapping(references);
        JSONArray saved = version.sourceSnapshot() == null ? null : version.sourceSnapshot().getJSONArray("referenceImages");
        if (saved == null ? !current.isEmpty() : !Objects.equals(saved, current)) {
            throw new BusinessException(ErrorCode.BUSINESS_ERROR,
                    "镜头" + shotNumber + "：参考图片已变化，请重新生成最终提示词");
        }
    }
}
