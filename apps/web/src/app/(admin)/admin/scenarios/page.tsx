import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminScenarios } from "@/components/admin/pages/scenarios";

export const metadata: Metadata = { title: "Scenarios" };

export default function Page() {
  return (
    <Suspense>
      <AdminScenarios />
    </Suspense>
  );
}
