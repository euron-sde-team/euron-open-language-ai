"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@open-language/ui";

/**
 * One choice as a hairline row with a real radio or checkbox inside (keyboard and screen
 * reader behaviour for free). The picked row is marked with a check and a heavier label,
 * not a box. Group the rows in an element with role="radiogroup" or role="group".
 */
export function ChoiceRow({
  type,
  name,
  checked,
  onChange,
  title,
  description,
  testId,
  disabled,
}: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("group relative flex cursor-pointer items-center gap-3 border-b border-border py-3 pl-1 pr-2 hover:bg-muted/40", disabled && "cursor-not-allowed opacity-60")}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="peer sr-only"
      />
      <span className="min-w-0 flex-1 rounded-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background">
        <span className={cn("block text-[15px]", checked ? "font-semibold text-foreground" : "font-medium text-foreground")}>{title}</span>
        {description ? <span className="block text-[13px] text-muted-foreground">{description}</span> : null}
      </span>
      <Check className={cn("size-4 shrink-0 text-primary transition-opacity", checked ? "opacity-100" : "opacity-0")} aria-hidden />
    </label>
  );
}
