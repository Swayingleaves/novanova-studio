package com.novanovastudio.ai;

import com.novanovastudio.common.BusinessException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * @title        AiHttpClientTest.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  AI供应商HTTP调用客户端测试
 * @createTime   2026-07-15 10:00:00
 */
class AiHttpClientTest {

    /**
     * OpenAI兼容格式应由服务端携带Bearer鉴权拉取模型并完成去重排序。
     *
     * @throws IOException 本地测试服务创建失败时抛出
     */
    @Test
    void shouldFetchOpenAiCompatibleModelsFromServer() throws IOException {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        HttpServer server = startJsonServer(200, "{\"data\":[{\"id\":\"model-b\"},{\"id\":\"model-a\"},{\"id\":\"model-b\"}]}", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            path.set(exchange.getRequestURI().getPath());
        });
        try {
            AiHttpClient client = new AiHttpClient();

            List<String> models = client.fetchChannelModels(baseUrl(server) + "/v1", "secret-key", "openai").block();

            Assertions.assertEquals(List.of("model-a", "model-b"), models);
            Assertions.assertEquals("Bearer secret-key", authorization.get());
            Assertions.assertEquals("/v1/models", path.get());
        } finally {
            server.stop(0);
        }
    }

    /**
     * Agnes格式应沿用OpenAI兼容的模型列表协议。
     *
     * @throws IOException 本地测试服务创建失败时抛出
     */
    @Test
    void shouldFetchAgnesModelsWithBearerAuthentication() throws IOException {
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server = startJsonServer(200, "{\"data\":[{\"id\":\"agnes-image-2.1-flash\"}]}",
                exchange -> authorization.set(exchange.getRequestHeaders().getFirst("Authorization")));
        try {
            List<String> models = new AiHttpClient().fetchChannelModels(baseUrl(server), "agnes-key", "agnes").block();

            Assertions.assertEquals(List.of("agnes-image-2.1-flash"), models);
            Assertions.assertEquals("Bearer agnes-key", authorization.get());
        } finally {
            server.stop(0);
        }
    }

    /**
     * Gemini格式应使用Google鉴权头，并移除模型名称中的models前缀。
     *
     * @throws IOException 本地测试服务创建失败时抛出
     */
    @Test
    void shouldFetchGeminiModelsWithGoogleApiKey() throws IOException {
        AtomicReference<String> apiKey = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        HttpServer server = startJsonServer(200, "{\"models\":[{\"name\":\"models/gemini-2.5-pro\"}]}", exchange -> {
            apiKey.set(exchange.getRequestHeaders().getFirst("x-goog-api-key"));
            path.set(exchange.getRequestURI().getPath());
        });
        try {
            List<String> models = new AiHttpClient().fetchChannelModels(baseUrl(server), "gemini-key", "gemini").block();

            Assertions.assertEquals(List.of("gemini-2.5-pro"), models);
            Assertions.assertEquals("gemini-key", apiKey.get());
            Assertions.assertEquals("/v1beta/models", path.get());
        } finally {
            server.stop(0);
        }
    }

    /**
     * Anthropic格式应使用专用鉴权头和协议版本头。
     *
     * @throws IOException 本地测试服务创建失败时抛出
     */
    @Test
    void shouldFetchAnthropicModelsWithDedicatedHeaders() throws IOException {
        AtomicReference<String> apiKey = new AtomicReference<>();
        AtomicReference<String> version = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        HttpServer server = startJsonServer(200, "{\"data\":[{\"id\":\"claude-sonnet-4\"}]}", exchange -> {
            apiKey.set(exchange.getRequestHeaders().getFirst("x-api-key"));
            version.set(exchange.getRequestHeaders().getFirst("anthropic-version"));
            path.set(exchange.getRequestURI().getPath());
        });
        try {
            List<String> models = new AiHttpClient().fetchChannelModels(baseUrl(server) + "/v1", "anthropic-key", "anthropic").block();

            Assertions.assertEquals(List.of("claude-sonnet-4"), models);
            Assertions.assertEquals("anthropic-key", apiKey.get());
            Assertions.assertEquals("2023-06-01", version.get());
            Assertions.assertEquals("/v1/models", path.get());
        } finally {
            server.stop(0);
        }
    }

    /**
     * 第三方错误响应应转换为包含状态码和渠道消息的业务异常。
     *
     * @throws IOException 本地测试服务创建失败时抛出
     */
    @Test
    void shouldExposeChannelErrorMessage() throws IOException {
        HttpServer server = startJsonServer(401, "{\"error\":{\"message\":\"密钥无效: wrong-key\"}}", exchange -> { });
        try {
            BusinessException exception = Assertions.assertThrows(BusinessException.class,
                    () -> new AiHttpClient().fetchChannelModels(baseUrl(server), "wrong-key", "openai").block());

            Assertions.assertTrue(exception.getMessage().contains("HTTP 401"));
            Assertions.assertTrue(exception.getMessage().contains("密钥无效"));
            Assertions.assertFalse(exception.getMessage().contains("wrong-key"));
            Assertions.assertTrue(exception.getMessage().contains("***"));
        } finally {
            server.stop(0);
        }
    }

    /**
     * 非法JSON和空模型列表都应返回明确业务异常。
     *
     * @throws IOException 本地测试服务创建失败时抛出
     */
    @Test
    void shouldRejectInvalidOrEmptyModelResponses() throws IOException {
        HttpServer invalidServer = startJsonServer(200, "not-json", exchange -> { });
        try {
            BusinessException invalidJson = Assertions.assertThrows(BusinessException.class,
                    () -> new AiHttpClient().fetchChannelModels(baseUrl(invalidServer), "key", "openai").block());
            Assertions.assertTrue(invalidJson.getMessage().contains("合法JSON"));
        } finally {
            invalidServer.stop(0);
        }

        HttpServer emptyServer = startJsonServer(200, "{\"data\":[]}", exchange -> { });
        try {
            BusinessException emptyModels = Assertions.assertThrows(BusinessException.class,
                    () -> new AiHttpClient().fetchChannelModels(baseUrl(emptyServer), "key", "openai").block());
            Assertions.assertTrue(emptyModels.getMessage().contains("没有返回可用模型"));
        } finally {
            emptyServer.stop(0);
        }
    }

    /**
     * 模型拉取应拒绝空字段、非法地址和不支持的调用格式。
     */
    @Test
    void shouldValidateModelRefreshConfiguration() {
        AiHttpClient client = new AiHttpClient();

        Assertions.assertTrue(assertBusinessMessage(() -> client.fetchChannelModels("", "key", "openai").block()).contains("Base URL"));
        Assertions.assertTrue(assertBusinessMessage(() -> client.fetchChannelModels("https://example.com/v1", "", "openai").block()).contains("API Key"));
        Assertions.assertTrue(assertBusinessMessage(() -> client.fetchChannelModels("file:///tmp", "key", "openai").block()).contains("HTTP或HTTPS"));
        Assertions.assertTrue(assertBusinessMessage(() -> client.fetchChannelModels("https://example.com", "key", "unknown").block()).contains("不支持"));
    }

    /**
     * OpenAI兼容接口必须直接在配置的基础地址后拼接业务路径，不能主动增加版本路径。
     */
    @Test
    void shouldAppendPathToConfiguredAiBaseUrl() {
        Assertions.assertEquals("https://api.deepseek.com/chat/completions",
                AiHttpClient.buildAiUrl("https://api.deepseek.com", "/chat/completions"));
        Assertions.assertEquals("https://api.openai.com/v1/chat/completions",
                AiHttpClient.buildAiUrl("https://api.openai.com/v1/", "/chat/completions"));
    }

    /**
     * 应允许HTTP或HTTPS远程媒体地址。
     */
    @Test
    void shouldAllowHttpAndHttpsRemoteMediaUrls() {
        AiHttpClient client = new AiHttpClient();

        Assertions.assertDoesNotThrow(() -> client.validateRemoteMediaUrl("http://127.0.0.1/media.png").block());
        Assertions.assertDoesNotThrow(() -> client.validateRemoteMediaUrl("https://[::1]/media.png").block());
    }

    /**
     * 应拒绝非HTTP(S)远程媒体地址。
     */
    @Test
    void shouldRejectUnsupportedRemoteMediaProtocol() {
        AiHttpClient client = new AiHttpClient();

        BusinessException exception = Assertions.assertThrows(BusinessException.class,
                () -> client.validateRemoteMediaUrl("file:///tmp/media.png").block());

        Assertions.assertTrue(exception.getMessage().contains("HTTP或HTTPS"));
    }

    /**
     * 创建返回固定JSON的本地HTTP测试服务。
     *
     * @param statusCode int HTTP响应状态码
     * @param responseBody String HTTP响应内容
     * @param requestObserver RequestObserver 请求观察器
     * @return HttpServer 已启动的本地HTTP服务
     * @throws IOException 本地服务创建失败时抛出
     */
    private HttpServer startJsonServer(int statusCode, String responseBody, RequestObserver requestObserver) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requestObserver.accept(exchange);
            byte[] body = responseBody.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
            exchange.sendResponseHeaders(statusCode, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        return server;
    }

    /**
     * 获取本地HTTP测试服务的基础地址。
     *
     * @param server HttpServer 本地HTTP服务
     * @return String 基础地址
     */
    private String baseUrl(HttpServer server) {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /**
     * 断言回调抛出业务异常并返回错误消息。
     *
     * @param executable ExecutableCallback 待执行回调
     * @return String 业务异常消息
     */
    private String assertBusinessMessage(ExecutableCallback executable) {
        return Assertions.assertThrows(BusinessException.class, executable::execute).getMessage();
    }

    /** 本地HTTP请求观察器。 */
    @FunctionalInterface
    private interface RequestObserver {

        /**
         * 观察收到的HTTP请求。
         *
         * @param exchange HttpExchange HTTP交换对象
         */
        void accept(HttpExchange exchange);
    }

    /** 可抛异常的测试回调。 */
    @FunctionalInterface
    private interface ExecutableCallback {

        /**
         * 执行测试回调。
         */
        void execute();
    }
}
