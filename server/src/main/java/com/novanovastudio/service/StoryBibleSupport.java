package com.novanovastudio.service;

import com.novanovastudio.common.CreditAmounts;
import com.novanovastudio.common.BusinessException;
import com.novanovastudio.common.ErrorCode;
import com.novanovastudio.dto.StoryBibleDtos;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 故事知识库计费字数、价格档位与原文证据定位的纯函数工具。
 *
 * @author zhenglin.cn.cq@gmail.com
 * @date 2026-09-27 00:00
 */
public final class StoryBibleSupport {
    /** 单个档位字数上限，防止整数溢出。 */
    private static final int MAX_TIER_CHARS = 100_000_000;
    /** 单条证据最大UTF-16字符数。 */
    private static final int MAX_QUOTE_LENGTH = 400;
    /** 名称归一时移除的空白与常见标点。 */
    private static final Pattern NAME_NOISE = Pattern.compile("[\\s\\u3000·•・.\\-—_'\"“”‘’「」『』()（）]");

    /** 禁止实例化。 */
    private StoryBibleSupport() { }

    /**
     * 统计范围内非空白Unicode字符数，汉字、字母、数字与标点计入，空格与换行不计入。
     *
     * @param text String 规范化正文
     * @param ranges List&lt;int[]&gt; 已合并的UTF-16范围，起点含、终点不含
     * @return int 计费字数
     */
    public static int countBillableChars(String text, List<int[]> ranges) {
        int count = 0;
        for (int[] range : ranges) {
            int index = range[0];
            while (index < range[1]) {
                int codePoint = text.codePointAt(index);
                if (!Character.isWhitespace(codePoint) && !Character.isSpaceChar(codePoint)) {
                    count++;
                }
                index += Character.charCount(codePoint);
            }
        }
        return count;
    }

    /**
     * 合并重叠或相邻的范围并按起点排序。
     *
     * @param ranges List&lt;int[]&gt; 原始范围
     * @return List&lt;int[]&gt; 合并后的范围
     */
    public static List<int[]> mergeRanges(List<int[]> ranges) {
        List<int[]> sorted = new ArrayList<>(ranges);
        sorted.sort(Comparator.comparingInt(range -> range[0]));
        List<int[]> merged = new ArrayList<>();
        for (int[] range : sorted) {
            if (!merged.isEmpty() && range[0] <= merged.getLast()[1]) {
                merged.getLast()[1] = Math.max(merged.getLast()[1], range[1]);
            } else {
                merged.add(new int[]{range[0], range[1]});
            }
        }
        return merged;
    }

    /**
     * 校验价格档位：起点从1开始连续、互不重叠，仅最后一档允许无上限。
     *
     * @param tiers List&lt;PricingTier&gt; 价格档位
     * @return List&lt;PricingTier&gt; 按起点排序后的档位
     */
    public static List<StoryBibleDtos.PricingTier> validateTiers(List<StoryBibleDtos.PricingTier> tiers) {
        if (tiers == null || tiers.isEmpty()) {
            return List.of();
        }
        List<StoryBibleDtos.PricingTier> sorted = new ArrayList<>(tiers);
        for (StoryBibleDtos.PricingTier tier : sorted) {
            if (tier == null || tier.minChars() == null || tier.credits() == null) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "价格档位必须填写起始字数与积分");
            }
        }
        sorted.sort(Comparator.comparingInt(StoryBibleDtos.PricingTier::minChars));
        int expectedMin = 1;
        for (int index = 0; index < sorted.size(); index++) {
            StoryBibleDtos.PricingTier tier = sorted.get(index);
            boolean last = index == sorted.size() - 1;
            if (tier.minChars() != expectedMin) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "价格档位必须从1字开始且首尾相接、不能重叠");
            }
            if (CreditAmounts.of(tier.credits()).compareTo(CreditAmounts.of(0)) < 0) {
                throw new BusinessException(ErrorCode.PARAM_INVALID, "档位积分不能小于0");
            }
            if (tier.maxChars() == null) {
                if (!last) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "只有最后一个档位可以不设上限");
                }
            } else {
                if (tier.maxChars() < tier.minChars() || tier.maxChars() > MAX_TIER_CHARS) {
                    throw new BusinessException(ErrorCode.PARAM_INVALID, "档位上限必须不小于起始字数");
                }
                expectedMin = tier.maxChars() + 1;
            }
        }
        return sorted;
    }

    /**
     * 查找覆盖计费字数的档位。
     *
     * @param tiers List&lt;PricingTier&gt; 已校验档位
     * @param chars int 计费字数
     * @return PricingTier 命中档位，无覆盖档位时为空
     */
    public static StoryBibleDtos.PricingTier selectTier(List<StoryBibleDtos.PricingTier> tiers, int chars) {
        for (StoryBibleDtos.PricingTier tier : tiers) {
            if (chars >= tier.minChars() && (tier.maxChars() == null || chars <= tier.maxChars())) {
                return tier;
            }
        }
        return null;
    }

    /**
     * 校验管理员实测的分析输入与输出容量；不推测Token与汉字的换算比例。
     * @param configuration QuickConfiguration 管理员配置，空值禁用该模型的分析
     * @return QuickConfiguration 已校验配置
     */
    public static StoryBibleDtos.QuickConfiguration validateQuickConfiguration(StoryBibleDtos.QuickConfiguration configuration) {
        if (configuration == null) return null;
        if (configuration.contextWindowTokens() == null || configuration.contextWindowTokens() < 4096
                || configuration.maximumInputCharacters() == null || configuration.maximumInputCharacters() < 1000
                || configuration.maximumInputCharacters() > 500_000
                || configuration.maximumOutputTokens() == null || configuration.maximumOutputTokens() < 1024
                || configuration.maximumOutputTokens() >= configuration.contextWindowTokens()
                || configuration.maximumSupplementCalls() == null || configuration.maximumSupplementCalls() < 0
                || configuration.maximumSupplementCalls() > 100) {
            throw new BusinessException(ErrorCode.PARAM_INVALID, "分析配置无效：请填写已验证的上下文、输入字符、输出Token与最多补分析次数");
        }
        return configuration;
    }

    /**
     * 在片段内逐字定位证据，返回原文绝对偏移。
     *
     * @param segmentText String 片段正文
     * @param segmentStart int 片段在原文中的起点
     * @param quote String 模型返回的证据
     * @return int[] 起点含、终点不含的绝对偏移，无法定位时为空
     */
    public static int[] locate(String segmentText, int segmentStart, String quote) {
        if (quote == null) {
            return null;
        }
        String value = quote.strip();
        if (value.isEmpty() || value.length() > MAX_QUOTE_LENGTH) {
            return null;
        }
        int index = segmentText.indexOf(value);
        if (index < 0) {
            return null;
        }
        return new int[]{segmentStart + index, segmentStart + index + value.length()};
    }

    /**
     * 校验证据范围与原文完全一致且不切开代理对。
     *
     * @param text String 规范化正文
     * @param start int 起点
     * @param end int 终点
     * @param quote String 证据文字
     * @return boolean 是否一致
     */
    public static boolean matches(String text, int start, int end, String quote) {
        if (start < 0 || end <= start || end > text.length()) {
            return false;
        }
        if (Character.isLowSurrogate(text.charAt(start)) || (end < text.length() && Character.isLowSurrogate(text.charAt(end)))) {
            return false;
        }
        return text.substring(start, end).equals(quote);
    }

    /**
     * 归一化名称用于匹配与抑制。
     *
     * @param name String 名称
     * @return String 归一化键
     */
    public static String normalize(String name) {
        if (name == null) {
            return "";
        }
        String value = NAME_NOISE.matcher(name).replaceAll("").toLowerCase(Locale.ROOT);
        return value.length() > 255 ? value.substring(0, 255) : value;
    }
}
