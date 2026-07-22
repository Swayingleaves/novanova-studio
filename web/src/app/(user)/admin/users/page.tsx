"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OldAdminUsersRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/admin/system"); }, [router]);
    return null;
}
