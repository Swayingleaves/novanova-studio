"use client";

import type { ReactNode } from "react";
import { Modal } from "antd";

type CreationSettingsModalProps = {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
};

export function CreationSettingsModal({ open, title, onClose, children }: CreationSettingsModalProps) {
    return (
        <Modal title={title} open={open} onCancel={onClose} footer={null} width={480} centered styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingTop: 8 } }}>
            {children}
        </Modal>
    );
}
