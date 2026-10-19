"use client";

import { useEffect } from "react";
import { useRouter } from "@/shared/lib/team-navigation";

export default function OldAdminUsersRedirect() {
    const router = useRouter();
    useEffect(() => { router.replace("/admin/system"); }, [router]);
    return null;
}
