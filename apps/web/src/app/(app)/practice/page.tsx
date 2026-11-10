import type { Metadata } from "next";
import { PracticePicker } from "@/components/practice/practice-picker";

export const metadata: Metadata = { title: "Practice" };

export default function PracticePage() {
  return <PracticePicker />;
}
