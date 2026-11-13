package com.novanovastudio.common;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.zip.CRC32;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import org.junit.jupiter.api.Test;

/**
 * 封面压缩的体积、透明通道和观感边界。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-11 09:09
 */
class ImageCompressorTest {

    /** 超大 PNG 应缩到 2K 内，并用高质量 JPEG 明显减小体积。 */
    @Test
    void shouldShrinkOversizedPhotoWithoutVisibleDamage() throws Exception {
        BufferedImage source = new BufferedImage(3000, 2000, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = source.createGraphics();
        try {
            graphics.setPaint(new GradientPaint(0, 0, new Color(24, 72, 160), 3000, 2000, new Color(230, 126, 48)));
            graphics.fillRect(0, 0, 3000, 2000);
            graphics.setColor(Color.WHITE);
            graphics.fillOval(400, 280, 980, 720);
        } finally {
            graphics.dispose();
        }
        byte[] png = write(source, "png");
        ImageCompressor.CompressedImage result = ImageCompressor.compress(png, "image/png", "dir/cover.png");

        assertTrue(result.changed());
        assertEquals("image/jpeg", result.mimeType());
        assertEquals("cover.jpg", result.fileName());
        assertTrue(result.data().length < png.length / 2);
        assertTrue(result.width() <= ImageCompressor.MAX_LONG_EDGE);
        assertTrue(result.height() <= ImageCompressor.MAX_LONG_EDGE);
        assertEquals(1.5, result.width() / (double) result.height(), 0.02);
        BufferedImage compressed = ImageIO.read(new ByteArrayInputStream(result.data()));
        assertEquals(result.width(), compressed.getWidth());
        assertEquals(result.height(), compressed.getHeight());
        double error = meanAbsoluteError(scale(source, result.width(), result.height()), compressed);
        assertTrue(error < 12, "平均通道误差 " + error);
    }

    /** 已经足够小的 JPEG 不再二次编码。 */
    @Test
    void shouldKeepCompactJpegUntouched() throws Exception {
        BufferedImage source = new BufferedImage(80, 60, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = source.createGraphics();
        try {
            graphics.setColor(new Color(20, 120, 80));
            graphics.fillRect(0, 0, 80, 60);
        } finally {
            graphics.dispose();
        }
        byte[] jpeg = write(source, "jpg");
        ImageCompressor.CompressedImage result = ImageCompressor.compress(jpeg, "image/jpeg", "small.jpg");
        assertFalse(result.changed());
        assertArrayEquals(jpeg, result.data());
    }

    /** 透明封面保持 PNG，不能铺成 JPEG 底色。 */
    @Test
    void shouldKeepTransparencyAsPng() throws Exception {
        BufferedImage source = new BufferedImage(2600, 1600, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = source.createGraphics();
        try {
            graphics.setColor(new Color(180, 40, 40, 255));
            graphics.fillRect(0, 0, 2600, 1600);
        } finally {
            graphics.dispose();
        }
        for (int y = 0; y < 240; y++) {
            for (int x = 0; x < 240; x++) source.setRGB(x, y, 0x00FFFFFF);
        }
        byte[] png = write(source, "png");
        ImageCompressor.CompressedImage result = ImageCompressor.compress(png, "image/png", "logo.png");
        assertNotEquals("image/jpeg", result.mimeType());
        if (!result.changed()) {
            assertArrayEquals(png, result.data());
            return;
        }
        assertEquals("image/png", result.mimeType());
        assertEquals("logo.png", result.fileName());
        BufferedImage compressed = ImageIO.read(new ByteArrayInputStream(result.data()));
        int alpha = (compressed.getRGB(2, 2) >>> 24) & 0xff;
        assertEquals(0, alpha);
        int opaque = (compressed.getRGB(compressed.getWidth() - 2, compressed.getHeight() - 2) >>> 24) & 0xff;
        assertEquals(255, opaque);
    }

    /** 多帧 GIF 保留动画，不能只留下第一帧。 */
    @Test
    void shouldKeepAnimatedGif() throws Exception {
        byte[] gif = animatedGif();
        ImageCompressor.CompressedImage result = ImageCompressor.compress(gif, "image/gif", "motion.gif");
        assertFalse(result.changed());
        assertArrayEquals(gif, result.data());
    }

    /** 无法识别的内容按原文件上传。 */
    @Test
    void shouldKeepUnknownBytes() {
        byte[] data = "not-an-image".getBytes();
        ImageCompressor.CompressedImage result = ImageCompressor.compress(data, "application/octet-stream", "x.bin");
        assertFalse(result.changed());
        assertArrayEquals(data, result.data());
    }

    /** 像素超过解码上限时拒绝，避免把超大图展开到内存。 */
    @Test
    void shouldRejectExtremeDimensions() throws Exception {
        BufferedImage source = new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB);
        byte[] png = write(source, "png");
        byte[] oversized = png.clone();
        // PNG 宽高是大端 4 字节，位于 IHDR 的固定偏移 16。改完后重算该块 CRC，否则读取器会当成损坏文件。
        oversized[16] = 0x00;
        oversized[17] = (byte) 0xF0;
        oversized[18] = 0x00;
        oversized[19] = 0x00;
        oversized[20] = 0x00;
        oversized[21] = (byte) 0xF0;
        oversized[22] = 0x00;
        oversized[23] = 0x00;
        CRC32 crc = new CRC32();
        crc.update(oversized, 12, 17);
        int checksum = (int) crc.getValue();
        oversized[29] = (byte) (checksum >>> 24);
        oversized[30] = (byte) (checksum >>> 16);
        oversized[31] = (byte) (checksum >>> 8);
        oversized[32] = (byte) checksum;
        BusinessException exception = assertThrows(BusinessException.class, () -> ImageCompressor.compress(oversized, "image/png", "huge.png"));
        assertEquals("图片尺寸过大，请缩小后重新上传", exception.getMessage());
    }

    /**
     * 写出测试图片。
     *
     * @param image BufferedImage 图片
     * @param format String ImageIO 格式名
     * @return byte[] 文件字节
     */
    private static byte[] write(BufferedImage image, String format) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        assertTrue(ImageIO.write(image, format, output));
        return output.toByteArray();
    }

    /**
     * 用双线性缩放做观感对照，不作为压缩实现本身。
     *
     * @param source BufferedImage 原图
     * @param width int 目标宽度
     * @param height int 目标高度
     * @return BufferedImage 对照图
     */
    private static BufferedImage scale(BufferedImage source, int width, int height) {
        BufferedImage target = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = target.createGraphics();
        try {
            graphics.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            graphics.drawImage(source, 0, 0, width, height, null);
        } finally {
            graphics.dispose();
        }
        return target;
    }

    /**
     * 计算两张同尺寸图片的平均通道绝对误差。
     *
     * @param expected BufferedImage 对照图
     * @param actual BufferedImage 压缩后再解码的图
     * @return double 单通道平均误差，0 表示完全一致
     */
    private static double meanAbsoluteError(BufferedImage expected, BufferedImage actual) {
        assertEquals(expected.getWidth(), actual.getWidth());
        assertEquals(expected.getHeight(), actual.getHeight());
        long total = 0;
        int width = expected.getWidth();
        int[] left = new int[width];
        int[] right = new int[width];
        for (int y = 0; y < expected.getHeight(); y++) {
            expected.getRGB(0, y, width, 1, left, 0, width);
            actual.getRGB(0, y, width, 1, right, 0, width);
            for (int x = 0; x < width; x++) {
                total += Math.abs(((left[x] >> 16) & 0xff) - ((right[x] >> 16) & 0xff));
                total += Math.abs(((left[x] >> 8) & 0xff) - ((right[x] >> 8) & 0xff));
                total += Math.abs((left[x] & 0xff) - (right[x] & 0xff));
            }
        }
        return total / (double) (expected.getWidth() * expected.getHeight() * 3L);
    }

    /**
     * 写一个两帧 GIF，用来确认动图不会被抽成静图。
     *
     * @return byte[] GIF 字节
     */
    private static byte[] animatedGif() throws IOException {
        BufferedImage first = new BufferedImage(2200, 8, BufferedImage.TYPE_INT_RGB);
        BufferedImage second = new BufferedImage(2200, 8, BufferedImage.TYPE_INT_RGB);
        first.setRGB(0, 0, 0xFFFF0000);
        second.setRGB(0, 0, 0xFF0000FF);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ImageWriter writer = ImageIO.getImageWritersByFormatName("gif").next();
        try (ImageOutputStream imageOutput = ImageIO.createImageOutputStream(output)) {
            writer.setOutput(imageOutput);
            writer.prepareWriteSequence(null);
            writer.writeToSequence(new IIOImage(first, null, null), writer.getDefaultWriteParam());
            writer.writeToSequence(new IIOImage(second, null, null), writer.getDefaultWriteParam());
            writer.endWriteSequence();
        } finally {
            writer.dispose();
        }
        return output.toByteArray();
    }
}
