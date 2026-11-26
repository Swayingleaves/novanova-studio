package com.novanovastudio.service;

import java.util.List;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 媒体存储键提取测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-26 22:30
 */
class MediaStorageKeysTest {

    /** 只认业务媒体键，并算出保存后消失的键。 */
    @Test
    void shouldCollectRemovedStorageKeys() {
        String previous = """
                {"nodes":[{"content":{"storageKey":"image:keep"}},{"content":{"storageKey":"video:gone"}}]}
                """;
        String next = """
                {"nodes":[{"content":{"storageKey":"image:keep"}}]}
                """;

        Assertions.assertEquals(List.of("video:gone"), MediaStorageKeys.removed(previous, next));
        Assertions.assertEquals(List.of("audio:track"), MediaStorageKeys.fromPayloads(List.of("audio:track", "https://example.com/a.png")));
    }
}
