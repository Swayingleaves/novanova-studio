package com.novanovastudio.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @title        NovanovaProperties.java
 * @author       zhenglin.cn.cq@gmail.com
 * @description  Novanova服务端配置属性
 * @createTime   2026-06-24 10:42:00
 */
@ConfigurationProperties(prefix = "novanova")
public class NovanovaProperties {

    /** app */
    private App app = new App();

    /** cors */
    private Cors cors = new Cors();

    /** admin */
    private Admin admin = new Admin();

    /** 邮箱 */
    private Email email = new Email();

    /** OAuth2第三方认证 */
    private OAuth2 oauth2 = new OAuth2();

    /** ai */
    private Ai ai = new Ai();

    /**
     * 获取应用配置
     *
     * @return App 应用配置
     */
    public App getApp() {
        return app;
    }

    /**
     * 设置应用配置
     *
     * @param app App 应用配置
     */
    public void setApp(App app) {
        this.app = app;
    }

    /**
     * 获取跨域配置
     *
     * @return Cors 跨域配置
     */
    public Cors getCors() {
        return cors;
    }

    /**
     * 设置跨域配置
     *
     * @param cors Cors 跨域配置
     */
    public void setCors(Cors cors) {
        this.cors = cors;
    }

    /**
     * 获取初始管理员配置
     *
     * @return Admin 初始管理员配置
     */
    public Admin getAdmin() {
        return admin;
    }

    /**
     * 设置初始管理员配置
     *
     * @param admin Admin 初始管理员配置
     */
    public void setAdmin(Admin admin) {
        this.admin = admin;
    }

    /**
     * 获取邮件配置
     *
     * @return Email 邮件配置
     */
    public Email getEmail() {
        return email;
    }

    /**
     * 设置邮件配置
     *
     * @param email Email 邮件配置
     */
    public void setEmail(Email email) {
        this.email = email;
    }

    /**
     * 获取OAuth2第三方认证配置
     *
     * @return OAuth2 OAuth2第三方认证配置
     */
    public OAuth2 getOauth2() {
        return oauth2;
    }

    /**
     * 设置OAuth2第三方认证配置
     *
     * @param oauth2 OAuth2 OAuth2第三方认证配置
     */
    public void setOauth2(OAuth2 oauth2) {
        this.oauth2 = oauth2;
    }

    /**
     * 获取AI配置
     *
     * @return Ai AI配置
     */
    public Ai getAi() {
        return ai;
    }

    /**
     * 设置AI配置
     *
     * @param ai Ai AI配置
     */
    public void setAi(Ai ai) {
        this.ai = ai;
    }

    /**
     * 应用配置
     */
    public static class App {

        /** 应用密钥 */
        private String secretKey = "";

        /** Token过期小时数 */
        private int tokenExpireHours = 24;

        /** 可信反向代理地址，多个地址使用英文逗号分隔 */
        private String trustedProxyAddresses = "";

        /**
         * 获取密钥
         *
         * @return String 密钥
         */
        public String getSecretKey() {
            return secretKey;
        }

        /**
         * 设置密钥
         *
         * @param secretKey String 密钥
         */
        public void setSecretKey(String secretKey) {
            this.secretKey = secretKey;
        }

        /**
         * 获取令牌有效小时数
         *
         * @return int 令牌有效小时数
         */
        public int getTokenExpireHours() {
            return tokenExpireHours;
        }

        /**
         * 设置令牌有效小时数
         *
         * @param tokenExpireHours int 令牌有效小时数
         */
        public void setTokenExpireHours(int tokenExpireHours) {
            this.tokenExpireHours = tokenExpireHours;
        }

        /**
         * 获取可信反向代理地址。
         *
         * @return String 可信反向代理地址列表
         */
        public String getTrustedProxyAddresses() {
            return trustedProxyAddresses;
        }

        /**
         * 设置可信反向代理地址。
         *
         * @param trustedProxyAddresses String 可信反向代理地址列表
         */
        public void setTrustedProxyAddresses(String trustedProxyAddresses) {
            this.trustedProxyAddresses = trustedProxyAddresses;
        }
    }

    /**
     * 跨域配置
     */
    public static class Cors {

        /** 允许跨域来源规则 */
        private String allowedOriginPatterns = "http://localhost:3000,http://127.0.0.1:3000,https://www.novanovastudio.cn";

        /**
         * 获取允许的来源匹配表达式
         *
         * @return String 允许的来源匹配表达式
         */
        public String getAllowedOriginPatterns() {
            return allowedOriginPatterns;
        }

        /**
         * 设置允许的来源匹配表达式
         *
         * @param allowedOriginPatterns String 允许的来源匹配表达式
         */
        public void setAllowedOriginPatterns(String allowedOriginPatterns) {
            this.allowedOriginPatterns = allowedOriginPatterns;
        }
    }

    /**
     * 初始管理员配置
     */
    public static class Admin {

        /** 初始管理员邮箱 */
        private String initialEmail = "";

        /** 初始管理员密码 */
        private String initialPassword = "";

        /** 初始管理员昵称 */
        private String initialNickname = "管理员";

        /**
         * 获取初始管理员邮箱
         *
         * @return String 初始管理员邮箱
         */
        public String getInitialEmail() {
            return initialEmail;
        }

        /**
         * 设置初始管理员邮箱
         *
         * @param initialEmail String 初始管理员邮箱
         */
        public void setInitialEmail(String initialEmail) {
            this.initialEmail = initialEmail;
        }

        /**
         * 获取初始管理员密码
         *
         * @return String 初始管理员密码
         */
        public String getInitialPassword() {
            return initialPassword;
        }

        /**
         * 设置初始管理员密码
         *
         * @param initialPassword String 初始管理员密码
         */
        public void setInitialPassword(String initialPassword) {
            this.initialPassword = initialPassword;
        }

        /**
         * 获取初始管理员昵称
         *
         * @return String 初始管理员昵称
         */
        public String getInitialNickname() {
            return initialNickname;
        }

        /**
         * 设置初始管理员昵称
         *
         * @param initialNickname String 初始管理员昵称
         */
        public void setInitialNickname(String initialNickname) {
            this.initialNickname = initialNickname;
        }
    }

    /**
     * 邮件配置
     */
    public static class Email {

        /** 邮件发件人 */
        private String from = "";

        /**
         * 获取发件人邮箱
         *
         * @return String 发件人邮箱
         */
        public String getFrom() {
            return from;
        }

        /**
         * 设置发件人邮箱
         *
         * @param from String 发件人邮箱
         */
        public void setFrom(String from) {
            this.from = from;
        }
    }

    /**
     * OAuth2第三方认证配置
     */
    public static class OAuth2 {

        /** linux.do认证配置 */
        private LinuxDo linuxDo = new LinuxDo();

        /** Google认证配置 */
        private Google google = new Google();

        /**
         * 获取linux.do认证配置
         *
         * @return LinuxDo linux.do认证配置
         */
        public LinuxDo getLinuxDo() {
            return linuxDo;
        }

        /**
         * 设置linux.do认证配置
         *
         * @param linuxDo LinuxDo linux.do认证配置
         */
        public void setLinuxDo(LinuxDo linuxDo) {
            this.linuxDo = linuxDo;
        }

        /**
         * 获取Google认证配置
         *
         * @return Google Google认证配置
         */
        public Google getGoogle() {
            return google;
        }

        /**
         * 设置Google认证配置
         *
         * @param google Google Google认证配置
         */
        public void setGoogle(Google google) {
            this.google = google;
        }

        /**
         * linux.do认证配置
         */
        public static class LinuxDo {

            /** 是否启用 */
            private boolean enabled;

            /** 客户端ID */
            private String clientId = "";

            /** 客户端密钥 */
            private String clientSecret = "";

            /** OAuth2回调地址 */
            private String redirectUri = "";

            /**
             * 获取启用状态
             *
             * @return boolean 是否启用
             */
            public boolean isEnabled() {
                return enabled;
            }

            /**
             * 设置启用状态
             *
             * @param enabled boolean 是否启用
             */
            public void setEnabled(boolean enabled) {
                this.enabled = enabled;
            }

            /**
             * 获取客户端ID
             *
             * @return String 客户端ID
             */
            public String getClientId() {
                return clientId;
            }

            /**
             * 设置客户端ID
             *
             * @param clientId String 客户端ID
             */
            public void setClientId(String clientId) {
                this.clientId = clientId;
            }

            /**
             * 获取客户端密钥
             *
             * @return String 客户端密钥
             */
            public String getClientSecret() {
                return clientSecret;
            }

            /**
             * 设置客户端密钥
             *
             * @param clientSecret String 客户端密钥
             */
            public void setClientSecret(String clientSecret) {
                this.clientSecret = clientSecret;
            }

            /**
             * 获取OAuth2回调地址
             *
             * @return String OAuth2回调地址
             */
            public String getRedirectUri() {
                return redirectUri;
            }

            /**
             * 设置OAuth2回调地址
             *
             * @param redirectUri String OAuth2回调地址
             */
            public void setRedirectUri(String redirectUri) {
                this.redirectUri = redirectUri;
            }
        }

        /**
         * Google认证配置
         */
        public static class Google {

            /** 是否启用 */
            private boolean enabled;

            /** 客户端ID */
            private String clientId = "";

            /** 客户端密钥 */
            private String clientSecret = "";

            /** OAuth2回调地址 */
            private String redirectUri = "";

            /**
             * 获取启用状态
             *
             * @return boolean 是否启用
             */
            public boolean isEnabled() {
                return enabled;
            }

            /**
             * 设置启用状态
             *
             * @param enabled boolean 是否启用
             */
            public void setEnabled(boolean enabled) {
                this.enabled = enabled;
            }

            /**
             * 获取客户端ID
             *
             * @return String 客户端ID
             */
            public String getClientId() {
                return clientId;
            }

            /**
             * 设置客户端ID
             *
             * @param clientId String 客户端ID
             */
            public void setClientId(String clientId) {
                this.clientId = clientId;
            }

            /**
             * 获取客户端密钥
             *
             * @return String 客户端密钥
             */
            public String getClientSecret() {
                return clientSecret;
            }

            /**
             * 设置客户端密钥
             *
             * @param clientSecret String 客户端密钥
             */
            public void setClientSecret(String clientSecret) {
                this.clientSecret = clientSecret;
            }

            /**
             * 获取OAuth2回调地址
             *
             * @return String OAuth2回调地址
             */
            public String getRedirectUri() {
                return redirectUri;
            }

            /**
             * 设置OAuth2回调地址
             *
             * @param redirectUri String OAuth2回调地址
             */
            public void setRedirectUri(String redirectUri) {
                this.redirectUri = redirectUri;
            }
        }
    }

    /**
     * AI服务配置
     */
    public static class Ai {
        /** AI任务队列配置 */
        private Task task = new Task();

        /** AI系统提示词文件配置 */
        private SystemPrompt systemPrompt = new SystemPrompt();

        /** 分镜Agent配置 */
        private StoryboardAgent storyboardAgent = new StoryboardAgent();

        /** AI图片结果配置 */
        private Image image = new Image();

        /** 视频合成任务配置 */
        private VideoComposition videoComposition = new VideoComposition();

        /**
         * 获取AI任务队列配置。
         *
         * @return Task AI任务队列配置
         */
        public Task getTask() {
            return task;
        }

        /**
         * 设置AI任务队列配置。
         *
         * @param task Task AI任务队列配置
         */
        public void setTask(Task task) {
            this.task = task;
        }

        /**
         * 获取AI系统提示词文件配置。
         *
         * @return SystemPrompt AI系统提示词文件配置
         */
        public SystemPrompt getSystemPrompt() {
            return systemPrompt;
        }

        /**
         * 设置AI系统提示词文件配置。
         *
         * @param systemPrompt SystemPrompt AI系统提示词文件配置
         */
        public void setSystemPrompt(SystemPrompt systemPrompt) {
            this.systemPrompt = systemPrompt;
        }

        /**
         * 获取分镜Agent配置。
         *
         * @return StoryboardAgent 分镜Agent配置
         */
        public StoryboardAgent getStoryboardAgent() {
            return storyboardAgent;
        }

        /**
         * 设置分镜Agent配置。
         *
         * @param storyboardAgent StoryboardAgent 分镜Agent配置
         */
        public void setStoryboardAgent(StoryboardAgent storyboardAgent) {
            this.storyboardAgent = storyboardAgent;
        }

        /**
         * 获取AI图片结果配置。
         *
         * @return Image AI图片结果配置
         */
        public Image getImage() {
            return image;
        }

        /**
         * 设置AI图片结果配置。
         *
         * @param image Image AI图片结果配置
         */
        public void setImage(Image image) {
            this.image = image;
        }

        /**
         * 获取视频合成任务配置。
         *
         * @return VideoComposition 视频合成任务配置
         */
        public VideoComposition getVideoComposition() {
            return videoComposition;
        }

        /**
         * 设置视频合成任务配置。
         *
         * @param videoComposition VideoComposition 视频合成任务配置
         */
        public void setVideoComposition(VideoComposition videoComposition) {
            this.videoComposition = videoComposition;
        }

        /**
         * 分镜Agent配置。
         */
        public static class StoryboardAgent {

            /** Agent单次调用超时时间（秒） */
            private int timeoutSeconds = 90;

            /**
             * 获取Agent单次调用超时时间（秒）。
             *
             * @return int 超时时间秒数
             */
            public int getTimeoutSeconds() {
                return timeoutSeconds;
            }

            /**
             * 设置Agent单次调用超时时间（秒）。
             *
             * @param timeoutSeconds int 超时时间秒数
             */
            public void setTimeoutSeconds(int timeoutSeconds) {
                this.timeoutSeconds = timeoutSeconds;
            }
        }

        /**
         * AI图片结果配置。
         */
        public static class Image {

            /** 是否将HTTP图片结果转存到默认对象存储 */
            private boolean uploadHttpResultToObjectStorage;

            /**
             * 判断是否将HTTP图片结果转存到默认对象存储。
             *
             * @return boolean true表示转存，false表示保留第三方原始URL
             */
            public boolean isUploadHttpResultToObjectStorage() {
                return uploadHttpResultToObjectStorage;
            }

            /**
             * 设置是否将HTTP图片结果转存到默认对象存储。
             *
             * @param uploadHttpResultToObjectStorage boolean 是否转存HTTP图片结果
             */
            public void setUploadHttpResultToObjectStorage(boolean uploadHttpResultToObjectStorage) {
                this.uploadHttpResultToObjectStorage = uploadHttpResultToObjectStorage;
            }
        }

        /**
         * 视频合成任务配置。
         */
        public static class VideoComposition {

            /** 全站同时执行的合成任务数量 */
            private int concurrency = 1;

            /** 单个源视频最大字节数 */
            private long maximumInputBytes = 524_288_000L;

            /** 单次合成允许的源视频总时长秒数 */
            private int maximumTotalDurationSeconds = 600;

            /** FFmpeg进程超时秒数 */
            private int executionTimeoutSeconds = 1800;

            /** Redis活动任务租约秒数 */
            private int activeLeaseSeconds = 180;

            /** Redis活动任务租约续期间隔秒数 */
            private int leaseRenewSeconds = 60;

            /** FFmpeg可执行文件路径 */
            private String ffmpegExecutable = "ffmpeg";

            /** FFprobe可执行文件路径 */
            private String ffprobeExecutable = "ffprobe";

            /**
             * 获取全站同时执行的合成任务数量。
             *
             * @return int 并发数
             */
            public int getConcurrency() {
                return concurrency;
            }

            /**
             * 设置全站同时执行的合成任务数量。
             *
             * @param concurrency int 并发数
             */
            public void setConcurrency(int concurrency) {
                this.concurrency = concurrency;
            }

            /**
             * 获取单个源视频最大字节数。
             *
             * @return long 最大字节数
             */
            public long getMaximumInputBytes() {
                return maximumInputBytes;
            }

            /**
             * 设置单个源视频最大字节数。
             *
             * @param maximumInputBytes long 最大字节数
             */
            public void setMaximumInputBytes(long maximumInputBytes) {
                this.maximumInputBytes = maximumInputBytes;
            }

            /**
             * 获取单次合成允许的源视频总时长秒数。
             *
             * @return int 最大总时长秒数
             */
            public int getMaximumTotalDurationSeconds() {
                return maximumTotalDurationSeconds;
            }

            /**
             * 设置单次合成允许的源视频总时长秒数。
             *
             * @param maximumTotalDurationSeconds int 最大总时长秒数
             */
            public void setMaximumTotalDurationSeconds(int maximumTotalDurationSeconds) {
                this.maximumTotalDurationSeconds = maximumTotalDurationSeconds;
            }

            /**
             * 获取FFmpeg进程超时秒数。
             *
             * @return int 超时秒数
             */
            public int getExecutionTimeoutSeconds() {
                return executionTimeoutSeconds;
            }

            /**
             * 设置FFmpeg进程超时秒数。
             *
             * @param executionTimeoutSeconds int 超时秒数
             */
            public void setExecutionTimeoutSeconds(int executionTimeoutSeconds) {
                this.executionTimeoutSeconds = executionTimeoutSeconds;
            }

            /**
             * 获取Redis活动任务租约秒数。
             *
             * @return int 租约秒数
             */
            public int getActiveLeaseSeconds() {
                return activeLeaseSeconds;
            }

            /**
             * 设置Redis活动任务租约秒数。
             *
             * @param activeLeaseSeconds int 租约秒数
             */
            public void setActiveLeaseSeconds(int activeLeaseSeconds) {
                this.activeLeaseSeconds = activeLeaseSeconds;
            }

            /**
             * 获取Redis活动任务租约续期间隔秒数。
             *
             * @return int 续期间隔秒数
             */
            public int getLeaseRenewSeconds() {
                return leaseRenewSeconds;
            }

            /**
             * 设置Redis活动任务租约续期间隔秒数。
             *
             * @param leaseRenewSeconds int 续期间隔秒数
             */
            public void setLeaseRenewSeconds(int leaseRenewSeconds) {
                this.leaseRenewSeconds = leaseRenewSeconds;
            }

            /**
             * 获取FFmpeg可执行文件路径。
             *
             * @return String FFmpeg路径
             */
            public String getFfmpegExecutable() {
                return ffmpegExecutable;
            }

            /**
             * 设置FFmpeg可执行文件路径。
             *
             * @param ffmpegExecutable String FFmpeg路径
             */
            public void setFfmpegExecutable(String ffmpegExecutable) {
                this.ffmpegExecutable = ffmpegExecutable;
            }

            /**
             * 获取FFprobe可执行文件路径。
             *
             * @return String FFprobe路径
             */
            public String getFfprobeExecutable() {
                return ffprobeExecutable;
            }

            /**
             * 设置FFprobe可执行文件路径。
             *
             * @param ffprobeExecutable String FFprobe路径
             */
            public void setFfprobeExecutable(String ffprobeExecutable) {
                this.ffprobeExecutable = ffprobeExecutable;
            }
        }

        /**
         * AI任务队列配置
         */
        public static class Task {

            /** Redis Stream键 */
            private String streamKey = "novanova:ai-task:stream";

            /** Redis消费组名称 */
            private String consumerGroup = "novanova-ai-task-consumer";

            /** 同时执行任务数量 */
            private int consumerConcurrency = 4;

            /** 单次读取消息数量 */
            private int readBatchSize = 4;

            /** 读取阻塞秒数 */
            private int readBlockSeconds = 5;

            /** 异步AI任务状态轮询间隔秒数，包括供应商、内部等待和视频合成恢复 */
            private int pollingIntervalSeconds = 3;

            /** 生成任务等待超时秒数（图片等常规任务） */
            private int waitTimeoutSeconds = 300;

            /** 视频生成任务等待超时秒数，需覆盖自定义模型异步轮询上限（约10分钟）并留余量 */
            private int videoWaitTimeoutSeconds = 900;

            /** 任务锁TTL秒数 */
            private int lockTtlSeconds = 300;

            /** 锁续期间隔秒数 */
            private int lockRenewSeconds = 60;

            /** 未确认消息重新认领空闲秒数 */
            private int pendingClaimIdleSeconds = 300;

            /** 运行中任务恢复阈值秒数 */
            private int runningRecoverSeconds = 900;

            /**
             * 获取Redis Stream键。
             *
             * @return String Redis Stream键
             */
            public String getStreamKey() {
                return streamKey;
            }

            /**
             * 设置Redis Stream键。
             *
             * @param streamKey String Redis Stream键
             */
            public void setStreamKey(String streamKey) {
                this.streamKey = streamKey;
            }

            /**
             * 获取Redis消费组名称。
             *
             * @return String Redis消费组名称
             */
            public String getConsumerGroup() {
                return consumerGroup;
            }

            /**
             * 设置Redis消费组名称。
             *
             * @param consumerGroup String Redis消费组名称
             */
            public void setConsumerGroup(String consumerGroup) {
                this.consumerGroup = consumerGroup;
            }

            /**
             * 获取同时执行任务数量。
             *
             * @return int 同时执行任务数量
             */
            public int getConsumerConcurrency() {
                return consumerConcurrency;
            }

            /**
             * 设置同时执行任务数量。
             *
             * @param consumerConcurrency int 同时执行任务数量
             */
            public void setConsumerConcurrency(int consumerConcurrency) {
                this.consumerConcurrency = consumerConcurrency;
            }

            /**
             * 获取单次读取消息数量。
             *
             * @return int 单次读取消息数量
             */
            public int getReadBatchSize() {
                return readBatchSize;
            }

            /**
             * 设置单次读取消息数量。
             *
             * @param readBatchSize int 单次读取消息数量
             */
            public void setReadBatchSize(int readBatchSize) {
                this.readBatchSize = readBatchSize;
            }

            /**
             * 获取读取阻塞秒数。
             *
             * @return int 读取阻塞秒数
             */
            public int getReadBlockSeconds() {
                return readBlockSeconds;
            }

            /**
             * 设置读取阻塞秒数。
             *
             * @param readBlockSeconds int 读取阻塞秒数
             */
            public void setReadBlockSeconds(int readBlockSeconds) {
                this.readBlockSeconds = readBlockSeconds;
            }

            /**
             * 获取异步AI任务状态轮询间隔秒数。
             *
             * @return int 轮询间隔秒数
             */
            public int getPollingIntervalSeconds() {
                return pollingIntervalSeconds;
            }

            /**
             * 获取生成任务等待超时秒数。
             *
             * @return int 生成任务等待超时秒数
             */
            public int getWaitTimeoutSeconds() {
                return waitTimeoutSeconds;
            }

            /**
             * 设置生成任务等待超时秒数。
             *
             * @param waitTimeoutSeconds int 生成任务等待超时秒数
             */
            public void setWaitTimeoutSeconds(int waitTimeoutSeconds) {
                this.waitTimeoutSeconds = waitTimeoutSeconds;
            }

            /**
             * 获取视频生成任务等待超时秒数。
             *
             * @return int 视频生成任务等待超时秒数
             */
            public int getVideoWaitTimeoutSeconds() {
                return videoWaitTimeoutSeconds;
            }

            /**
             * 设置视频生成任务等待超时秒数。
             *
             * @param videoWaitTimeoutSeconds int 视频生成任务等待超时秒数
             */
            public void setVideoWaitTimeoutSeconds(int videoWaitTimeoutSeconds) {
                this.videoWaitTimeoutSeconds = videoWaitTimeoutSeconds;
            }

            /**
             * 设置异步AI任务状态轮询间隔秒数。
             *
             * @param pollingIntervalSeconds int 轮询间隔秒数
             */
            public void setPollingIntervalSeconds(int pollingIntervalSeconds) {
                this.pollingIntervalSeconds = pollingIntervalSeconds;
            }

            /**
             * 获取任务锁TTL秒数。
             *
             * @return int 任务锁TTL秒数
             */
            public int getLockTtlSeconds() {
                return lockTtlSeconds;
            }

            /**
             * 设置任务锁TTL秒数。
             *
             * @param lockTtlSeconds int 任务锁TTL秒数
             */
            public void setLockTtlSeconds(int lockTtlSeconds) {
                this.lockTtlSeconds = lockTtlSeconds;
            }

            /**
             * 获取锁续期间隔秒数。
             *
             * @return int 锁续期间隔秒数
             */
            public int getLockRenewSeconds() {
                return lockRenewSeconds;
            }

            /**
             * 设置锁续期间隔秒数。
             *
             * @param lockRenewSeconds int 锁续期间隔秒数
             */
            public void setLockRenewSeconds(int lockRenewSeconds) {
                this.lockRenewSeconds = lockRenewSeconds;
            }

            /**
             * 获取未确认消息重新认领空闲秒数。
             *
             * @return int 未确认消息重新认领空闲秒数
             */
            public int getPendingClaimIdleSeconds() {
                return pendingClaimIdleSeconds;
            }

            /**
             * 设置未确认消息重新认领空闲秒数。
             *
             * @param pendingClaimIdleSeconds int 未确认消息重新认领空闲秒数
             */
            public void setPendingClaimIdleSeconds(int pendingClaimIdleSeconds) {
                this.pendingClaimIdleSeconds = pendingClaimIdleSeconds;
            }

            /**
             * 获取运行中任务恢复阈值秒数。
             *
             * @return int 运行中任务恢复阈值秒数
             */
            public int getRunningRecoverSeconds() {
                return runningRecoverSeconds;
            }

            /**
             * 设置运行中任务恢复阈值秒数。
             *
             * @param runningRecoverSeconds int 运行中任务恢复阈值秒数
             */
            public void setRunningRecoverSeconds(int runningRecoverSeconds) {
                this.runningRecoverSeconds = runningRecoverSeconds;
            }
        }

        /**
         * AI系统提示词文件配置。
         */
        public static class SystemPrompt {

            /** 图片提示词优化文件路径 */
            private String optimizationImageFile = "";

            /** 视频提示词优化文件路径 */
            private String optimizationVideoFile = "";

            /** 主Agent文件路径 */
            private String agentMainFile = "";

            /** 主Agent失败恢复文件路径 */
            private String agentRecoveryFile = "";

            /** 图片生成Agent文件路径 */
            private String agentImageFile = "";

            /** 视频生成Agent文件路径 */
            private String agentVideoFile = "";

            /** 画布Agent文件路径 */
            private String agentCanvasFile = "";

            /** 分镜脚本Agent文件路径 */
            private String agentStoryboardFile = "";

            /**
             * 获取图片提示词优化文件路径。
             *
             * @return String 图片提示词优化文件路径
             */
            public String getOptimizationImageFile() {
                return optimizationImageFile;
            }

            /**
             * 设置图片提示词优化文件路径。
             *
             * @param optimizationImageFile String 图片提示词优化文件路径
             */
            public void setOptimizationImageFile(String optimizationImageFile) {
                this.optimizationImageFile = optimizationImageFile;
            }

            /**
             * 获取视频提示词优化文件路径。
             *
             * @return String 视频提示词优化文件路径
             */
            public String getOptimizationVideoFile() {
                return optimizationVideoFile;
            }

            /**
             * 设置视频提示词优化文件路径。
             *
             * @param optimizationVideoFile String 视频提示词优化文件路径
             */
            public void setOptimizationVideoFile(String optimizationVideoFile) {
                this.optimizationVideoFile = optimizationVideoFile;
            }

            /**
             * 获取主Agent文件路径。
             *
             * @return String 主Agent文件路径
             */
            public String getAgentMainFile() {
                return agentMainFile;
            }

            /**
             * 设置主Agent文件路径。
             *
             * @param agentMainFile String 主Agent文件路径
             */
            public void setAgentMainFile(String agentMainFile) {
                this.agentMainFile = agentMainFile;
            }

            /**
             * 获取主Agent失败恢复文件路径。
             *
             * @return String 主Agent失败恢复文件路径
             */
            public String getAgentRecoveryFile() {
                return agentRecoveryFile;
            }

            /**
             * 设置主Agent失败恢复文件路径。
             *
             * @param agentRecoveryFile String 主Agent失败恢复文件路径
             */
            public void setAgentRecoveryFile(String agentRecoveryFile) {
                this.agentRecoveryFile = agentRecoveryFile;
            }

            /**
             * 获取图片生成Agent文件路径。
             *
             * @return String 图片生成Agent文件路径
             */
            public String getAgentImageFile() {
                return agentImageFile;
            }

            /**
             * 设置图片生成Agent文件路径。
             *
             * @param agentImageFile String 图片生成Agent文件路径
             */
            public void setAgentImageFile(String agentImageFile) {
                this.agentImageFile = agentImageFile;
            }

            /**
             * 获取视频生成Agent文件路径。
             *
             * @return String 视频生成Agent文件路径
             */
            public String getAgentVideoFile() {
                return agentVideoFile;
            }

            /**
             * 设置视频生成Agent文件路径。
             *
             * @param agentVideoFile String 视频生成Agent文件路径
             */
            public void setAgentVideoFile(String agentVideoFile) {
                this.agentVideoFile = agentVideoFile;
            }

            /**
             * 获取画布Agent文件路径。
             *
             * @return String 画布Agent文件路径
             */
            public String getAgentCanvasFile() {
                return agentCanvasFile;
            }

            /**
             * 设置画布Agent文件路径。
             *
             * @param agentCanvasFile String 画布Agent文件路径
             */
            public void setAgentCanvasFile(String agentCanvasFile) {
                this.agentCanvasFile = agentCanvasFile;
            }

            /**
             * 获取分镜脚本Agent文件路径。
             *
             * @return String 分镜脚本Agent文件路径
             */
            public String getAgentStoryboardFile() {
                return agentStoryboardFile;
            }

            /**
             * 设置分镜脚本Agent文件路径。
             *
             * @param agentStoryboardFile String 分镜脚本Agent文件路径
             */
            public void setAgentStoryboardFile(String agentStoryboardFile) {
                this.agentStoryboardFile = agentStoryboardFile;
            }

        }
    }
}
