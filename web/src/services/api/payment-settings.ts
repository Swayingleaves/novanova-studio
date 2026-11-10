import { serverGet, serverPost } from "./server";

export type AlipaySettings = {
    enabled: boolean;
    appId: string;
    privateKeyConfigured: boolean;
    publicKeyConfigured: boolean;
    gatewayUrl: string;
    notifyUrl: string;
    returnUrl: string;
};

export type WechatSettings = {
    enabled: boolean;
    appId: string;
    merchantId: string;
    merchantSerialNumber: string;
    privateKeyConfigured: boolean;
    apiV3KeyConfigured: boolean;
    publicKeyConfigured: boolean;
    publicKeyId: string;
    notifyUrl: string;
};

export type PaymentSettings = { alipay: AlipaySettings; wechat: WechatSettings };

export type UpdateAlipaySettings = {
    enabled: boolean;
    appId: string;
    privateKey: string;
    publicKey: string;
    gatewayUrl: string;
    notifyUrl: string;
    returnUrl: string;
};

export type UpdateWechatSettings = {
    enabled: boolean;
    appId: string;
    merchantId: string;
    merchantSerialNumber: string;
    privateKey: string;
    apiV3Key: string;
    publicKey: string;
    publicKeyId: string;
    notifyUrl: string;
};

export const getPaymentSettings = () => serverGet<PaymentSettings>("/admin/payment/getPaymentSettings");

export const updateAlipaySettings = (settings: UpdateAlipaySettings) => serverPost<PaymentSettings>("/admin/payment/updateAlipaySettings", settings);

export const updateWechatSettings = (settings: UpdateWechatSettings) => serverPost<PaymentSettings>("/admin/payment/updateWechatSettings", settings);
