import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPractice } from "@/components/admin/pages/practice";

export const metadata: Metadata = { title: "Practice" };

export default function Page() {
  return (
    <Suspense>
      <AdminPractice />
    </Suspense>
  );
}
