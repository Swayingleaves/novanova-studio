package com.novanovastudio;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * @title        NovanovaStudioServerApplication.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Novanova Studio Java服务端入口
 * @createTime   2026-06-24 10:36:00
 */
@SpringBootApplication
public class NovanovaStudioServerApplication {

    /**
     * 服务端启动入口
     *
     * @param args String[] 启动参数
     */
    public static void main(String[] args) {
        SpringApplication.run(NovanovaStudioServerApplication.class, args);
    }
}
