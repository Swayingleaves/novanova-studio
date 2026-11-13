package com.novanovastudio;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.novanovastudio.storage.MediaAccessService;
import reactor.core.publisher.Mono;

/**
 * 私有存储桶签名服务测试替身，单元测试只关注业务字段，签名地址原样返回。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-09 18:10
 */
public final class MediaAccessTestSupport {

    /** 禁止实例化测试工具类。 */
    private MediaAccessTestSupport() {
    }

    /**
     * 创建按原地址返回的签名服务替身。
     *
     * @return MediaAccessService 签名服务替身
     */
    public static MediaAccessService echo() {
        MediaAccessService service = mock(MediaAccessService.class);
        stubEcho(service);
        return service;
    }

    /**
     * 让签名服务替身原样返回输入地址，供已有 Mock 复用。
     *
     * @param service MediaAccessService 签名服务替身
     */
    public static void stubEcho(MediaAccessService service) {
        lenient().when(service.signUrl(anyString(), any())).thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));
        lenient().when(service.signJson(any(JSONObject.class), any()))
                .thenAnswer(invocation -> Mono.justOrEmpty((JSONObject) invocation.getArgument(0)));
        lenient().when(service.signJsonArray(any(JSONArray.class), any()))
                .thenAnswer(invocation -> Mono.justOrEmpty((JSONArray) invocation.getArgument(0)));
        lenient().when(service.signObject(nullable(String.class), nullable(String.class), nullable(String.class),
                        nullable(String.class), any(), anyBoolean()))
                .thenAnswer(invocation -> Mono.just(new MediaAccessService.Access(
                        "https://signed.example.com/" + invocation.getArgument(1), "2099-01-01T00:00:00Z")));
    }
}
