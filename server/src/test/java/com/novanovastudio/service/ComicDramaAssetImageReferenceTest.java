package com.novanovastudio.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.common.BusinessException;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 资产图生成引用已有资产图的入参。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-10 01:30
 */
class ComicDramaAssetImageReferenceTest {

    @Test
    void shouldKeepSelectedAssetImagesInOrder() {
        JSONObject settings = new JSONObject();
        settings.put("referenceAssetVersionIds", new JSONArray(List.of("version-b", "version-a")));

        assertEquals(List.of("version-b", "version-a"), ComicDramaService.referenceAssetVersionIds(settings));
        assertTrue(ComicDramaService.referenceAssetVersionIds(null).isEmpty());
        assertTrue(ComicDramaService.referenceAssetVersionIds(new JSONObject()).isEmpty());
    }

    @Test
    void shouldRejectInvalidReferenceAssetImages() {
        JSONObject duplicate = new JSONObject();
        duplicate.put("referenceAssetVersionIds", new JSONArray(List.of("version-a", "version-a")));
        JSONObject blank = new JSONObject();
        blank.put("referenceAssetVersionIds", new JSONArray(List.of(" ")));
        JSONObject tooMany = new JSONObject();
        tooMany.put("referenceAssetVersionIds", new JSONArray(List.of("1", "2", "3", "4", "5", "6", "7", "8", "9")));
        JSONObject wrongType = new JSONObject();
        wrongType.put("referenceAssetVersionIds", "version-a");

        assertThrows(BusinessException.class, () -> ComicDramaService.referenceAssetVersionIds(duplicate));
        assertThrows(BusinessException.class, () -> ComicDramaService.referenceAssetVersionIds(blank));
        assertThrows(BusinessException.class, () -> ComicDramaService.referenceAssetVersionIds(tooMany));
        assertThrows(BusinessException.class, () -> ComicDramaService.referenceAssetVersionIds(wrongType));
    }
}
