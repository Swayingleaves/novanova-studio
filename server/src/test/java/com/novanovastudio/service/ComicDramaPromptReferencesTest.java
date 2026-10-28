package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.dto.AiTaskDtos;
import com.novanovastudio.dto.ComicDramaDtos;
import com.novanovastudio.repository.ComicDramaRepository.ShotReferenceImage;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 漫剧参考图片说明与稳定身份校验测试。
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-10-28 10:00
 */
class ComicDramaPromptReferencesTest {

    /** 验证多角色、场景、道具和首帧使用连续编号及各自用途。 */
    @Test
    void shouldDescribeEveryReferenceInSubmissionOrder() {
        List<ShotReferenceImage> images = List.of(image("storyboard", "分镜画面", "frame", "frame.png", ""),
                image("character", "林青—日常装", "actor-one", "actor.png", ""),
                image("character", "小白", "actor-two", "actor-two.png", ""),
                image("scene", "庭院", "garden", "garden.png", ""),
                image("prop", "折扇", "fan", "fan.png", ""));
        JSONObject snapshot = ComicDramaPromptReferences.snapshot(" 正文 ", images, new JSONObject());
        assertEquals("正文\n\n参考图片说明：\n使用 @图片1 作为分镜画面「分镜画面」的首帧与构图参考；"
                + "使用 @图片2 作为角色「林青—日常装」的外观与服装参考；使用 @图片3 作为角色「小白」的外观与服装参考；"
                + "使用 @图片4 作为场景「庭院」的背景与环境参考；使用 @图片5 作为道具「折扇」的外观参考。",
                ComicDramaPromptReferences.fullPrompt(snapshot));
        assertEquals(List.of(1, 2, 3, 4, 5), snapshot.getJSONArray("referenceImages").stream()
                .map(value -> ((JSONObject) value).getIntValue("imageNumber")).toList());
        assertDoesNotThrow(() -> ComicDramaPromptReferences.validate(version(JSON.parseObject(snapshot.toJSONString())), images, 1));
    }

    /** 存储键相同且媒体身份相同时，签名地址刷新不应让提示词过期。 */
    @Test
    void shouldIgnoreSignedUrlRefreshButRejectMediaOrLocationChanges() {
        ShotReferenceImage original = image("character", "林青", "media", "actor.png", "https://example.test/old");
        ComicDramaDtos.PromptVersion version = version(ComicDramaPromptReferences.snapshot("正文", List.of(original), new JSONObject()));
        assertDoesNotThrow(() -> ComicDramaPromptReferences.validate(version,
                List.of(image("character", "林青", "media", "actor.png", "https://example.test/new")), 8));
        assertThrows(BusinessException.class, () -> ComicDramaPromptReferences.validate(version,
                List.of(image("character", "林青", "replacement", "actor.png", "")), 8));
        assertThrows(BusinessException.class, () -> ComicDramaPromptReferences.validate(version,
                List.of(image("character", "林青", "media", "replacement.png", "")), 8));
        ShotReferenceImage urlOnly = image("scene", "庭院", "garden", null, "https://example.test/old");
        assertThrows(BusinessException.class, () -> ComicDramaPromptReferences.validate(
                version(ComicDramaPromptReferences.snapshot("正文", List.of(urlOnly), new JSONObject())),
                List.of(image("scene", "庭院", "garden", null, "https://example.test/new")), 8));
    }

    /** 新增、删除、重排以及同数量换图均需要重新生成最终提示词。 */
    @Test
    void shouldRejectAllOrderedReferenceChanges() {
        ShotReferenceImage actor = image("character", "林青", "actor", "actor.png", "");
        ShotReferenceImage scene = image("scene", "庭院", "garden", "garden.png", "");
        ShotReferenceImage frame = image("storyboard", "分镜画面", "frame", "frame.png", "");
        ComicDramaDtos.PromptVersion version = version(ComicDramaPromptReferences.snapshot("正文", List.of(actor, scene), new JSONObject()));
        for (List<ShotReferenceImage> changed : List.of(List.of(actor), List.of(scene, actor),
                List.of(frame, actor, scene), List.of(actor, frame), List.<ShotReferenceImage>of())) {
            BusinessException error = assertThrows(BusinessException.class, () -> ComicDramaPromptReferences.validate(version, changed, 12));
            assertEquals("镜头12：参考图片已变化，请重新生成最终提示词", error.getMessage());
        }
    }

    /** 旧版只有无图任务可直接使用，文字资产不产生图片编号。 */
    @Test
    void shouldSupportTextOnlyVersionsAndRequireSnapshotForImages() {
        ComicDramaDtos.PromptVersion legacy = version(new JSONObject());
        assertDoesNotThrow(() -> ComicDramaPromptReferences.validate(legacy, List.of(), 1));
        assertThrows(BusinessException.class, () -> ComicDramaPromptReferences.validate(legacy,
                List.of(image("prop", "折扇", "fan", "fan.png", "")), 1));
        JSONObject snapshot = ComicDramaPromptReferences.snapshot("无图资产文字描述", List.of(), new JSONObject());
        assertEquals("无图资产文字描述", ComicDramaPromptReferences.fullPrompt(snapshot));
        assertTrue(snapshot.getJSONArray("referenceImages").isEmpty());
    }

    /** 构造指定媒体身份的参考图片。
     * @param type 资产类型
     * @param name 资产名称
     * @param mediaId 媒体身份
     * @param storageKey 存储键
     * @param url 图片地址
     * @return 参考图片
     */
    private static ShotReferenceImage image(String type, String name, String mediaId, String storageKey, String url) {
        return new ShotReferenceImage("storyboard".equals(type) ? "shot" : "assetVersion", name, type, mediaId,
                new AiTaskDtos.AiTaskMediaReference(mediaId, name, "image/png", storageKey, url, "subject"));
    }

    /** 构造绑定指定快照的提示词版本。
     * @param snapshot 来源快照
     * @return 测试提示词版本
     */
    private static ComicDramaDtos.PromptVersion version(JSONObject snapshot) {
        return new ComicDramaDtos.PromptVersion("prompt", "shot", 1, "ai", "正文", snapshot,
                "model", BigDecimal.ZERO, "adopted", OffsetDateTime.now());
    }
}
