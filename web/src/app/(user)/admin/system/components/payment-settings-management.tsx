"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Skeleton, Switch, Tabs } from "antd";
import { getPaymentSettings, updateAlipaySettings, updateWechatSettings, type AlipaySettings, type UpdateAlipaySettings, type UpdateWechatSettings, type WechatSettings } from "@/services/api/payment-settings";

/** 微信标识取自官方组合图左上角，避免整张横幅在标签里变形。 */
function WechatPayMark() {
    return (
        <svg viewBox="0 0 324 273" className="h-5 w-6" aria-hidden="true" focusable="false">
            <image href="/payment/wechat-pay.png" width={1152} height={468} />
        </svg>
    );
}

/** 支付宝配置。表单实例和表单一起挂载，避免未连接时回填触发 useForm 警告。 */
function AlipaySettingsForm({ alipay }: { alipay: AlipaySettings }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<UpdateAlipaySettings>();
    const save = useMutation({
        mutationFn: (values: UpdateAlipaySettings) => updateAlipaySettings({
            ...values,
            appId: values.appId?.trim() || "",
            privateKey: values.privateKey?.trim() || "",
            publicKey: values.publicKey?.trim() || "",
            gatewayUrl: values.gatewayUrl?.trim() || "",
            notifyUrl: values.notifyUrl?.trim() || "",
            returnUrl: values.returnUrl?.trim() || "",
        }),
        onSuccess: async (settings) => {
            form.setFieldValue("privateKey", "");
            form.setFieldValue("publicKey", "");
            message.success("支付宝配置已保存");
            queryClient.setQueryData(["payment-settings"], settings);
        },
        onError: (error: Error) => message.error(error.message || "保存支付宝配置失败"),
    });

    return (
        <Form<UpdateAlipaySettings> name="alipaySettings" form={form} layout="vertical" className="max-w-3xl" disabled={save.isPending}
            initialValues={{ enabled: alipay.enabled, appId: alipay.appId, privateKey: "", publicKey: "", gatewayUrl: alipay.gatewayUrl, notifyUrl: alipay.notifyUrl, returnUrl: alipay.returnUrl }}
            onFinish={(values) => save.mutate(values)}>
            <Form.Item name="enabled" label="启用支付宝" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="appId" label="应用标识"><Input maxLength={64} placeholder="支付宝开放平台应用标识" autoComplete="off" /></Form.Item>
            <Form.Item name="privateKey" label="应用私钥" extra={alipay.privateKeyConfigured ? "已保存应用私钥。留空则不修改，填写后会覆盖。" : "填写应用私钥，不要填写支付宝公钥。"}>
                <Input.TextArea rows={4} maxLength={8000} spellCheck={false} placeholder={alipay.privateKeyConfigured ? "已保存，留空则不修改" : "粘贴应用私钥"} />
            </Form.Item>
            <Form.Item name="publicKey" label="支付宝公钥" extra={alipay.publicKeyConfigured ? "已保存支付宝公钥。留空则不修改，填写后会覆盖。" : "填写支付宝公钥，不是应用公钥。"}>
                <Input.TextArea rows={4} maxLength={8000} spellCheck={false} placeholder={alipay.publicKeyConfigured ? "已保存，留空则不修改" : "粘贴支付宝公钥"} />
            </Form.Item>
            <Form.Item name="gatewayUrl" label="网关地址" extra="正式环境使用 https://openapi.alipay.com/gateway.do，沙箱环境改为开放平台提供的沙箱网关。">
                <Input maxLength={255} placeholder="https://openapi.alipay.com/gateway.do" />
            </Form.Item>
            <Form.Item name="notifyUrl" label="异步通知地址" extra="必须是支付宝可以访问的公网 HTTPS 地址，例如 https://域名/api/v1/payment/alipay/notify。">
                <Input maxLength={500} placeholder="https://example.com/api/v1/payment/alipay/notify" />
            </Form.Item>
            <Form.Item name="returnUrl" label="同步回跳地址" extra="支付完成后回到购买页，例如 https://域名/api/v1/payment/alipay/return。到账仍以异步通知或查单为准。">
                <Input maxLength={500} placeholder="https://example.com/api/v1/payment/alipay/return" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={save.isPending}>保存支付宝配置</Button>
        </Form>
    );
}

/** 微信支付配置。表单实例和表单一起挂载，未打开标签页时不会提前回填。 */
function WechatSettingsForm({ wechat }: { wechat: WechatSettings }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [form] = Form.useForm<UpdateWechatSettings>();
    const save = useMutation({
        mutationFn: (values: UpdateWechatSettings) => updateWechatSettings({
            ...values,
            appId: values.appId?.trim() || "",
            merchantId: values.merchantId?.trim() || "",
            merchantSerialNumber: values.merchantSerialNumber?.trim() || "",
            privateKey: values.privateKey?.trim() || "",
            apiV3Key: values.apiV3Key?.trim() || "",
            publicKey: values.publicKey?.trim() || "",
            publicKeyId: values.publicKeyId?.trim() || "",
            notifyUrl: values.notifyUrl?.trim() || "",
        }),
        onSuccess: async (settings) => {
            form.setFieldValue("privateKey", "");
            form.setFieldValue("apiV3Key", "");
            form.setFieldValue("publicKey", "");
            message.success("微信支付配置已保存");
            queryClient.setQueryData(["payment-settings"], settings);
        },
        onError: (error: Error) => message.error(error.message || "保存微信支付配置失败"),
    });

    return (
        <Form<UpdateWechatSettings> name="wechatSettings" form={form} layout="vertical" className="max-w-3xl" disabled={save.isPending}
            initialValues={{
                enabled: wechat.enabled, appId: wechat.appId, merchantId: wechat.merchantId, merchantSerialNumber: wechat.merchantSerialNumber,
                privateKey: "", apiV3Key: "", publicKey: "", publicKeyId: wechat.publicKeyId, notifyUrl: wechat.notifyUrl,
            }}
            onFinish={(values) => save.mutate(values)}>
            <Form.Item name="enabled" label="启用微信支付" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="appId" label="应用标识" extra="填写已与商户号绑定的公众账号或应用标识。"><Input maxLength={64} autoComplete="off" /></Form.Item>
            <Form.Item name="merchantId" label="商户号"><Input maxLength={32} autoComplete="off" /></Form.Item>
            <Form.Item name="merchantSerialNumber" label="商户 API 证书序列号"><Input maxLength={64} autoComplete="off" /></Form.Item>
            <Form.Item name="privateKey" label="商户 API 私钥" extra={wechat.privateKeyConfigured ? "已保存商户私钥。留空则不修改，填写后会覆盖。" : "粘贴 apiclient_key.pem 的完整内容，包含 BEGIN 和 END 行。"}>
                <Input.TextArea rows={4} maxLength={8000} spellCheck={false} placeholder={wechat.privateKeyConfigured ? "已保存，留空则不修改" : "粘贴 PEM 私钥"} />
            </Form.Item>
            <Form.Item name="apiV3Key" label="APIv3 密钥" extra={wechat.apiV3KeyConfigured ? "已保存 APIv3 密钥。留空则不修改，填写后会覆盖。" : "商户平台设置的 32 字节 APIv3 密钥。"}>
                <Input.Password maxLength={128} autoComplete="new-password" placeholder={wechat.apiV3KeyConfigured ? "已保存，留空则不修改" : "32 字节密钥"} />
            </Form.Item>
            <Form.Item name="publicKey" label="微信支付公钥" extra={wechat.publicKeyConfigured ? "已保存微信支付公钥。留空则不修改，填写后会覆盖。" : "粘贴商户平台下载的微信支付公钥，不是商户 API 证书。"}>
                <Input.TextArea rows={4} maxLength={8000} spellCheck={false} placeholder={wechat.publicKeyConfigured ? "已保存，留空则不修改" : "粘贴 PEM 公钥"} />
            </Form.Item>
            <Form.Item name="publicKeyId" label="微信支付公钥 ID" extra="以 PUB_KEY_ID_ 开头，不能填写商户证书序列号。"><Input maxLength={64} autoComplete="off" /></Form.Item>
            <Form.Item name="notifyUrl" label="支付通知地址" extra="必须是微信可以访问、不含查询参数的公网 HTTPS 地址，例如 https://域名/api/v1/payment/wechat/notify。">
                <Input maxLength={500} placeholder="https://example.com/api/v1/payment/wechat/notify" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={save.isPending}>保存微信支付配置</Button>
        </Form>
    );
}

/**
 * 渲染平台支付宝和微信支付配置。密钥留空时由服务端保留原值。
 */
export function PaymentSettingsManagement() {
    const settingsQuery = useQuery({ queryKey: ["payment-settings"], queryFn: getPaymentSettings });
    const alipay = settingsQuery.data?.alipay;
    const wechat = settingsQuery.data?.wechat;

    return (
        <div className="space-y-4">
            <p className="text-sm text-[var(--studio-muted)]">支付宝电脑网站支付和微信 Native 扫码支付在这里配置。保存后当前服务立即生效，密钥不会再次显示。</p>
            {settingsQuery.isError && <Alert type="error" showIcon title="支付配置加载失败" action={<Button onClick={() => void settingsQuery.refetch()}>重试</Button>} />}
            {settingsQuery.isPending ? <Skeleton active paragraph={{ rows: 8 }} /> : alipay && wechat && (
                <Tabs items={[
                    {
                        key: "alipay",
                        label: <span className="inline-flex items-center gap-2"><img src="/payment/alipay.png" alt="" className="size-5 rounded-sm object-contain" />支付宝</span>,
                        children: <AlipaySettingsForm alipay={alipay} />,
                    },
                    {
                        key: "wechat",
                        label: <span className="inline-flex items-center gap-2"><WechatPayMark />微信支付</span>,
                        children: <WechatSettingsForm wechat={wechat} />,
                    },
                ]} />
            )}
        </div>
    );
}
