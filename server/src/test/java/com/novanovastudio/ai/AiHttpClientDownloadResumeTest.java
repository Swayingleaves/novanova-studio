package com.novanovastudio.ai;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

/**
 * 结果媒体下载中断后的续传测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-11-23 10:00
 */
class AiHttpClientDownloadResumeTest {

    /**
     * 第一次响应写到一半就断开，客户端应从已收到的字节续传，最终文件与原内容一致。
     *
     * @throws Exception 本地服务或下载失败时抛出
     */
    @Test
    void shouldResumeInterruptedResultMediaDownload() throws Exception {
        byte[] content = payload(64 * 1024);
        AtomicInteger requests = new AtomicInteger();
        List<String> ranges = new ArrayList<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            ranges.add(exchange.getRequestHeaders().getFirst("Range"));
            if (requests.incrementAndGet() == 1) {
                // 声明全长但只写一半：客户端读到的字节数与 Content-Length 不符
                exchange.getResponseHeaders().add("Content-Type", "video/mp4");
                exchange.sendResponseHeaders(200, content.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(content, 0, content.length / 2);
                    out.flush();
                }
                exchange.close();
                return;
            }
            String range = exchange.getRequestHeaders().getFirst("Range");
            int start = range == null ? 0 : Integer.parseInt(range.replaceAll("\\D", ""));
            byte[] rest = Arrays.copyOfRange(content, start, content.length);
            exchange.getResponseHeaders().add("Content-Type", "video/mp4");
            exchange.getResponseHeaders().add("Content-Range", "bytes " + start + "-" + (content.length - 1) + "/" + content.length);
            exchange.sendResponseHeaders(206, rest.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(rest);
            }
        });
        server.start();
        Path target = Files.createTempFile("resume", ".mp4");
        try {
            AiHttpClient client = retryImmediately();
            AiHttpClient.RemoteMediaFile result = client.downloadRemoteMediaToFile(url(server), "video/mp4", target, content.length + 1L).block();

            Assertions.assertNotNull(result);
            Assertions.assertArrayEquals(content, Files.readAllBytes(target));
            Assertions.assertEquals(2, requests.get(), "应当只续传一次");
            Assertions.assertNull(ranges.get(0), "首次不带 Range");
            Assertions.assertEquals("bytes=" + content.length / 2 + "-", ranges.get(1));
        } finally {
            server.stop(0);
            Files.deleteIfExists(target);
        }
    }

    /**
     * 服务端忽略 Range、每次都返回整份内容时，不能把重复内容追加到文件里。
     *
     * @throws Exception 本地服务或下载失败时抛出
     */
    @Test
    void shouldRestartFromScratchWhenServerIgnoresRange() throws Exception {
        byte[] content = payload(8 * 1024);
        AtomicInteger requests = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            if (requests.incrementAndGet() == 1) {
                exchange.sendResponseHeaders(200, content.length);
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(content, 0, content.length / 4);
                    out.flush();
                }
                exchange.close();
                return;
            }
            // 完全不认 Range：200 + 全文
            exchange.sendResponseHeaders(200, content.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(content);
            }
        });
        server.start();
        Path target = Files.createTempFile("resume-restart", ".mp4");
        try {
            AiHttpClient client = retryImmediately();
            client.downloadRemoteMediaToFile(url(server), "video/mp4", target, content.length + 1L).block();

            Assertions.assertArrayEquals(content, Files.readAllBytes(target));
            Assertions.assertEquals(2, requests.get());
        } finally {
            server.stop(0);
            Files.deleteIfExists(target);
        }
    }

    /**
     * 地址不存在这类再试也没用的失败不能重试，也不留下半截文件。
     *
     * @throws Exception 本地服务创建失败时抛出
     */
    @Test
    void shouldNotRetryClientErrorsAndDeletePartialFile() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.incrementAndGet();
            respond(exchange, 404, "missing");
        });
        server.start();
        Path target = Files.createTempFile("resume-404", ".mp4");
        try {
            AiHttpClient client = retryImmediately();
            Assertions.assertThrows(RuntimeException.class,
                    () -> client.downloadRemoteMediaToFile(url(server), "video/mp4", target, 1024).block());
            Assertions.assertEquals(1, requests.get(), "4xx 不应重试");
            Assertions.assertFalse(Files.exists(target), "失败后不留半截文件");
        } finally {
            server.stop(0);
            Files.deleteIfExists(target);
        }
    }

    /** 重试等待设为 0，避免测试等真实时间。 */
    private static AiHttpClient retryImmediately() {
        AiHttpClient client = new AiHttpClient();
        client.resultMediaRetryDelay = Duration.ZERO;
        return client;
    }

    private static String url(HttpServer server) {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/result.mp4";
    }

    private static byte[] payload(int size) {
        byte[] content = new byte[size];
        for (int i = 0; i < size; i++) {
            content[i] = (byte) (i * 31 + 7);
        }
        return content;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
