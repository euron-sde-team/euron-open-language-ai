import type { Metadata } from "next";
import { SessionView } from "@/components/practice/session-view";

export const metadata: Metadata = { title: "Lesson" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionView id={id} />;
}
