package com.novanovastudio.common;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Iterator;
import java.util.Locale;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import net.coobird.thumbnailator.Thumbnails;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 按展示用途压缩静态图片，优先保住观感，只在结果更小时替换原图。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-11-11 09:09
 */
public final class ImageCompressor {

    private static final Logger log = LoggerFactory.getLogger(ImageCompressor.class);

    /** 长边上限。封面在高分屏上仍清晰，超过后才等比缩小，不放大。 */
    static final int MAX_LONG_EDGE = 2048;

    /** JPEG 质量。0.92 接近视觉无损，避免封面发糊或出现明显色块。 */
    static final double JPEG_QUALITY = 0.92;

    /** 已是 JPEG 或 WebP、且体积不超过该值时不再二次编码，避免代际损失。 */
    private static final int JPEG_KEEP_BYTES = 800 * 1024;

    /** PNG、BMP、静态 GIF 不超过该体积且尺寸合适时保留原图。 */
    private static final int LOSSLESS_KEEP_BYTES = 400 * 1024;

    /** 解码像素上限，超过后拒绝，避免超大图撑满内存。 */
    private static final long MAX_PIXELS = 40_000_000L;

    /**
     * 禁止实例化。
     */
    private ImageCompressor() {
    }

    /**
     * 压缩一张静态图片。
     * <p>
     * 长边超过 {@link #MAX_LONG_EDGE} 时等比缩小。无透明通道时用高质量 JPEG，有透明通道时用无损 PNG。
     * 动图、无法识别的内容，以及压缩后不会更小的文件都保留原字节。
     *
     * @param data byte[] 原始图片字节
     * @param mimeType String 调用方提供的媒体类型，仅在未压缩时原样带回
     * @param fileName String 原始文件名，用于生成压缩后的文件名
     * @return CompressedImage 压缩结果；{@code changed} 为 false 时数据与入参相同
     * @throws BusinessException 图片像素超过解码上限时抛出
     */
    public static CompressedImage compress(byte[] data, String mimeType, String fileName) {
        int originalBytes = data == null ? 0 : data.length;
        Integer originalWidth = null;
        Integer originalHeight = null;
        try {
            if (data == null || data.length == 0) {
                return logCompression(fileName, originalBytes, null, null, CompressedImage.unchanged(data, mimeType, fileName));
            }
            Probe probe = probe(data);
            if (probe != null && probe.width() > 0 && probe.height() > 0) {
                originalWidth = probe.width();
                originalHeight = probe.height();
            }
            if (probe == null || probe.animated() || originalWidth == null) {
                return logCompression(fileName, originalBytes, originalWidth, originalHeight, CompressedImage.unchanged(data, mimeType, fileName));
            }
            if ((long) originalWidth * originalHeight > MAX_PIXELS) {
                logCompression(fileName, originalBytes, originalWidth, originalHeight, CompressedImage.unchanged(data, mimeType, fileName));
                throw new BusinessException(ErrorCode.PARAM_INVALID, SystemMessage.of("business.imageDimensionsTooLarge"));
            }
            if (alreadyCompact(probe, data.length)) {
                return logCompression(fileName, originalBytes, originalWidth, originalHeight, CompressedImage.unchanged(data, mimeType, fileName));
            }
            // 用比例缩小而不是 size：size 会把小图放大。拍摄方向交换宽高后，长边不变，比例仍然正确。
            double scale = Math.min(1.0, (double) MAX_LONG_EDGE / Math.max(originalWidth, originalHeight));
            BufferedImage fitted = Thumbnails.of(new ByteArrayInputStream(data))
                    .useExifOrientation(true)
                    .scale(scale)
                    .asBufferedImage();
            if (fitted == null) {
                return logCompression(fileName, originalBytes, originalWidth, originalHeight, CompressedImage.unchanged(data, mimeType, fileName));
            }
            boolean keepTransparency = hasVisibleTransparency(fitted);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            var encoder = Thumbnails.of(fitted).scale(1.0);
            if (keepTransparency) {
                encoder.outputFormat("png");
            } else {
                encoder.outputQuality(JPEG_QUALITY).outputFormat("jpg");
            }
            encoder.toOutputStream(output);
            if (output.size() == 0 || output.size() >= data.length) {
                return logCompression(fileName, originalBytes, originalWidth, originalHeight, CompressedImage.unchanged(data, mimeType, fileName));
            }
            String storedMimeType = keepTransparency ? "image/png" : "image/jpeg";
            CompressedImage compressed = new CompressedImage(output.toByteArray(), storedMimeType, storedFileName(fileName, keepTransparency), fitted.getWidth(), fitted.getHeight(), true);
            return logCompression(fileName, originalBytes, originalWidth, originalHeight, compressed);
        } catch (BusinessException exception) {
            throw exception;
        } catch (IOException exception) {
            log.warn("图片无法压缩，已保留原图: fileName={}", fileName, exception);
            return logCompression(fileName, originalBytes, originalWidth, originalHeight, CompressedImage.unchanged(data, mimeType, fileName));
        }
    }

    /**
     * 打印压缩前后的尺寸、体积和压缩率。压缩率是相对原体积减少的比例，未替换原图时为 0%。
     *
     * @param fileName String 原始文件名
     * @param originalBytes int 原图字节数
     * @param originalWidth Integer 原图宽度，无法识别时为 null
     * @param originalHeight Integer 原图高度，无法识别时为 null
     * @param result CompressedImage 实际存储的结果
     * @return CompressedImage 原样返回结果
     */
    private static CompressedImage logCompression(String fileName, int originalBytes, Integer originalWidth, Integer originalHeight, CompressedImage result) {
        int storedBytes = result.data() == null ? 0 : result.data().length;
        Integer storedWidth = result.changed() ? result.width() : originalWidth;
        Integer storedHeight = result.changed() ? result.height() : originalHeight;
        log.info("图片压缩: fileName={}, 原尺寸={}, 原体积={}字节, 压缩后尺寸={}, 压缩后体积={}字节, 压缩率={}",
                fileName, dimensionText(originalWidth, originalHeight), originalBytes, dimensionText(storedWidth, storedHeight), storedBytes, compressionRate(originalBytes, storedBytes));
        return result;
    }

    /**
     * 计算相对原体积减少的比例。
     *
     * @param originalBytes int 原图字节数
     * @param storedBytes int 压缩后字节数
     * @return String 保留一位小数的百分比，原体积为 0 时返回 0%
     */
    private static String compressionRate(int originalBytes, int storedBytes) {
        if (originalBytes <= 0) return "0%";
        double rate = (originalBytes - storedBytes) * 100.0 / originalBytes;
        return String.format(Locale.ROOT, "%.1f%%", rate);
    }

    /**
     * 把宽高格式化成日志中的尺寸。
     *
     * @param width Integer 宽度
     * @param height Integer 高度
     * @return String 如 3000x2000，无法识别时返回“未知”
     */
    private static String dimensionText(Integer width, Integer height) {
        if (width == null || height == null || width < 1 || height < 1) return "未知";
        return width + "x" + height;
    }

    /**
     * 读取格式、尺寸和是否为动图，不把像素全部展开。
     *
     * @param data byte[] 原始图片字节
     * @return Probe 可识别时返回探测结果，否则返回 null
     * @throws IOException 读取图片头失败时抛出
     */
    private static Probe probe(byte[] data) throws IOException {
        try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(data))) {
            if (input == null) return null;
            Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) return null;
            ImageReader reader = readers.next();
            try {
                reader.setInput(input, false, false);
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                boolean animated = "gif".equals(format) && reader.getNumImages(true) > 1;
                return new Probe(format, width, height, animated);
            } finally {
                reader.dispose();
            }
        }
    }

    /**
     * 尺寸已经适合封面、体积也不大时跳过二次编码。
     *
     * @param probe Probe 图片头信息
     * @param bytes int 原始字节数
     * @return boolean 为 true 时保留原图
     */
    private static boolean alreadyCompact(Probe probe, int bytes) {
        if (Math.max(probe.width(), probe.height()) > MAX_LONG_EDGE) return false;
        boolean jpegLike = probe.format().contains("jpeg") || probe.format().contains("jpg") || probe.format().contains("webp");
        return bytes <= (jpegLike ? JPEG_KEEP_BYTES : LOSSLESS_KEEP_BYTES);
    }

    /**
     * 判断缩小后的图是否真有透明像素。只有完全不透明的图才转成 JPEG。
     *
     * @param image BufferedImage 已按封面尺寸处理好的图片
     * @return boolean 存在非不透明像素时返回 true
     */
    private static boolean hasVisibleTransparency(BufferedImage image) {
        if (!image.getColorModel().hasAlpha()) return false;
        int width = image.getWidth();
        int[] row = new int[width];
        for (int y = 0; y < image.getHeight(); y++) {
            image.getRGB(0, y, width, 1, row, 0, width);
            for (int argb : row) {
                if (((argb >>> 24) & 0xff) != 0xff) return true;
            }
        }
        return false;
    }

    /**
     * 用原文件名主干加上压缩后的扩展名。
     *
     * @param originalName String 原始文件名
     * @param png boolean 是否输出 PNG
     * @return String 压缩后的文件名
     */
    private static String storedFileName(String originalName, boolean png) {
        String base = "image";
        if (originalName != null && !originalName.isBlank()) {
            String name = originalName.trim();
            int separator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
            if (separator >= 0 && separator + 1 < name.length()) name = name.substring(separator + 1);
            int dot = name.lastIndexOf('.');
            if (dot > 0) name = name.substring(0, dot);
            if (!name.isBlank()) base = name;
        }
        return base + (png ? ".png" : ".jpg");
    }

    /**
     * 图片头探测结果。
     *
     * @param format String ImageIO 格式名，已转为小写
     * @param width int 宽度
     * @param height int 高度
     * @param animated boolean 是否为多帧动图
     */
    private record Probe(String format, int width, int height, boolean animated) {
    }

    /**
     * 压缩结果。未压缩时宽高为 null，调用方继续使用自己持有的尺寸。
     *
     * @param data byte[] 最终写入存储的字节
     * @param mimeType String 媒体类型
     * @param fileName String 文件名
     * @param width Integer 压缩后的宽度，未压缩时为 null
     * @param height Integer 压缩后的高度，未压缩时为 null
     * @param changed boolean 是否已替换为更小的压缩结果
     */
    public record CompressedImage(byte[] data, String mimeType, String fileName, Integer width, Integer height, boolean changed) {

        /**
         * 保留原始字节。
         *
         * @param data byte[] 原始字节
         * @param mimeType String 原始媒体类型
         * @param fileName String 原始文件名
         * @return CompressedImage 未改动的结果
         */
        public static CompressedImage unchanged(byte[] data, String mimeType, String fileName) {
            return new CompressedImage(data, mimeType, fileName, null, null, false);
        }
    }
}
