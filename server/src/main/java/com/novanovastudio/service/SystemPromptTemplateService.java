package com.novanovastudio.service;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.EnumMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import com.novanovastudio.config.NovanovaProperties;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * AI系统提示词模板服务。
 * <p>
 * 服务启动时读取外部Markdown文件并缓存，避免运行时读取文件导致提示词内容不一致。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-17 00:00
 */
@Slf4j
@Service
public class SystemPromptTemplateService {

    /** 服务端配置 */
    private final NovanovaProperties properties;

    /** Spring资源加载器 */
    private final ResourceLoader resourceLoader;

    /** 按模板类型缓存的系统提示词 */
    private final Map<PromptTemplateType, String> templates = new EnumMap<>(PromptTemplateType.class);

    /**
     * 创建系统提示词模板服务。
     *
     * @param properties NovanovaProperties 服务端配置
     * @param resourceLoader ResourceLoader Spring资源加载器
     */
    public SystemPromptTemplateService(NovanovaProperties properties, ResourceLoader resourceLoader) {
        this.properties = properties;
        this.resourceLoader = resourceLoader;
    }

    /**
     * 加载并校验全部系统提示词模板。
     *
     * @throws IllegalStateException 任一模板缺失、不可读或为空时抛出
     */
    @PostConstruct
    public void loadTemplates() {
        for (PromptTemplateType templateType : PromptTemplateType.values()) {
            templates.put(templateType, readTemplate(templateType));
        }
    }

    /**
     * 获取已缓存的系统提示词模板。
     *
     * @param templateType PromptTemplateType 模板类型
     * @return String 系统提示词内容
     * @throws IllegalStateException 模板尚未完成加载时抛出
     */
    public String get(PromptTemplateType templateType) {
        String template = templates.get(templateType);
        if (template == null) {
            throw new IllegalStateException("AI系统提示词模板尚未加载: " + templateType);
        }
        return template;
    }

    /**
     * 读取并校验单个外部系统提示词模板。
     *
     * @param templateType PromptTemplateType 模板类型
     * @return String 去除首尾空白后的模板内容
     * @throws IllegalStateException 模板路径为空、文件不可读或内容为空时抛出
     */
    private String readTemplate(PromptTemplateType templateType) {
        String location = templateLocation(templateType);
        if (!StringUtils.hasText(location)) {
            log.error("AI系统提示词模板加载失败: 类型={}, 原因=未配置文件路径", templateType);
            throw new IllegalStateException("AI系统提示词模板未配置文件路径: " + templateType);
        }
        try {
            Resource resource = resourceLoader.getResource(location);
            try (InputStream inputStream = resource.getInputStream()) {
                String template = new String(inputStream.readAllBytes(), StandardCharsets.UTF_8).trim();
                if (!StringUtils.hasText(template)) {
                    log.error("AI系统提示词模板加载失败: 类型={}, 路径={}, 原因=文件内容为空", templateType, location);
                    throw new IllegalStateException("AI系统提示词模板文件内容为空: " + templateType);
                }
                return template;
            }
        } catch (IOException exception) {
            log.error("AI系统提示词模板加载失败: 类型={}, 路径={}, 原因=文件不可读", templateType, location, exception);
            throw new IllegalStateException("AI系统提示词模板文件不可读: " + templateType, exception);
        }
    }

    /**
     * 获取指定模板类型对应的外部文件路径。
     *
     * @param templateType PromptTemplateType 模板类型
     * @return String 外部文件路径
     */
    private String templateLocation(PromptTemplateType templateType) {
        NovanovaProperties.Ai.SystemPrompt systemPrompt = properties.getAi().getSystemPrompt();
        return switch (templateType) {
            case OPTIMIZATION_IMAGE -> systemPrompt.getOptimizationImageFile();
            case OPTIMIZATION_VIDEO -> systemPrompt.getOptimizationVideoFile();
            case AGENT_MAIN -> systemPrompt.getAgentMainFile();
            case AGENT_RECOVERY -> systemPrompt.getAgentRecoveryFile();
            case AGENT_IMAGE -> systemPrompt.getAgentImageFile();
            case AGENT_VIDEO -> systemPrompt.getAgentVideoFile();
            case AGENT_CANVAS -> systemPrompt.getAgentCanvasFile();
            case AGENT_STORYBOARD -> systemPrompt.getAgentStoryboardFile();
        };
    }
}
