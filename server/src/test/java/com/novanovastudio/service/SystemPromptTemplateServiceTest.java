package com.novanovastudio.service;

import com.novanovastudio.config.NovanovaProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumMap;
import java.util.Map;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.DefaultResourceLoader;

/**
 * 系统提示词模板服务测试。
 *
 * @author   zhenglin.cn.cq@gmail.com
 * @date     2026-07-17 00:00
 */
class SystemPromptTemplateServiceTest {

    /** 临时模板目录 */
    @TempDir
    Path temporaryDirectory;

    /**
     * 验证五类模板均按UTF-8内容加载并缓存。
     *
     * @throws IOException 创建模板文件失败时抛出
     */
    @Test
    void shouldLoadAllExternalTemplates() throws IOException {
        Map<PromptTemplateType, String> expectedTemplates = new EnumMap<>(PromptTemplateType.class);
        for (PromptTemplateType templateType : PromptTemplateType.values()) {
            String template = "模板-" + templateType;
            Files.writeString(templateFile(templateType), "\n" + template + "\n");
            expectedTemplates.put(templateType, template);
        }
        SystemPromptTemplateService service = newService();

        service.loadTemplates();

        expectedTemplates.forEach((templateType, template) -> Assertions.assertEquals(template, service.get(templateType)));
    }

    /**
     * 验证任一模板缺失时初始化失败。
     *
     * @throws IOException 创建模板文件失败时抛出
     */
    @Test
    void shouldRejectMissingTemplate() throws IOException {
        writeAllTemplates();
        Files.delete(templateFile(PromptTemplateType.OPTIMIZATION_IMAGE));

        Assertions.assertThrows(IllegalStateException.class, () -> newService().loadTemplates());
    }

    /**
     * 验证任一模板为空时初始化失败。
     *
     * @throws IOException 创建模板文件失败时抛出
     */
    @Test
    void shouldRejectEmptyTemplate() throws IOException {
        writeAllTemplates();
        Files.writeString(templateFile(PromptTemplateType.OPTIMIZATION_IMAGE), "   \n\t");

        Assertions.assertThrows(IllegalStateException.class, () -> newService().loadTemplates());
    }

    /**
     * 验证模板路径指向不可读取的目录时初始化失败。
     *
     * @throws IOException 创建测试目录失败时抛出
     */
    @Test
    void shouldRejectUnreadableTemplate() throws IOException {
        writeAllTemplates();
        Path unreadableDirectory = Files.createDirectory(temporaryDirectory.resolve("unreadable.md"));
        NovanovaProperties properties = properties();
        properties.getAi().getSystemPrompt().setOptimizationImageFile(unreadableDirectory.toUri().toString());
        SystemPromptTemplateService service = new SystemPromptTemplateService(properties, new DefaultResourceLoader());

        Assertions.assertThrows(IllegalStateException.class, service::loadTemplates);
    }

    /**
     * 创建使用临时目录文件的模板服务。
     *
     * @return SystemPromptTemplateService 模板服务
     */
    private SystemPromptTemplateService newService() {
        return new SystemPromptTemplateService(properties(), new DefaultResourceLoader());
    }

    /**
     * 创建模板文件路径配置。
     *
     * @return NovanovaProperties 已配置模板路径的服务端配置
     */
    private NovanovaProperties properties() {
        NovanovaProperties properties = new NovanovaProperties();
        NovanovaProperties.Ai.SystemPrompt systemPrompt = properties.getAi().getSystemPrompt();
        systemPrompt.setOptimizationImageFile(templateFile(PromptTemplateType.OPTIMIZATION_IMAGE).toUri().toString());
        systemPrompt.setOptimizationVideoFile(templateFile(PromptTemplateType.OPTIMIZATION_VIDEO).toUri().toString());
        systemPrompt.setAgentImageFile(templateFile(PromptTemplateType.AGENT_IMAGE).toUri().toString());
        systemPrompt.setAgentVideoFile(templateFile(PromptTemplateType.AGENT_VIDEO).toUri().toString());
        systemPrompt.setAgentCanvasFile(templateFile(PromptTemplateType.AGENT_CANVAS).toUri().toString());
        return properties;
    }

    /**
     * 写入全部非空测试模板。
     *
     * @throws IOException 写入模板文件失败时抛出
     */
    private void writeAllTemplates() throws IOException {
        for (PromptTemplateType templateType : PromptTemplateType.values()) {
            Files.writeString(templateFile(templateType), "模板-" + templateType);
        }
    }

    /**
     * 获取指定类型的临时模板文件路径。
     *
     * @param templateType PromptTemplateType 模板类型
     * @return Path 模板文件路径
     */
    private Path templateFile(PromptTemplateType templateType) {
        return temporaryDirectory.resolve(templateType.name().toLowerCase() + ".md");
    }
}
