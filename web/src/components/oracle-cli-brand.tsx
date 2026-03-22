import { kimiCliVersion } from "@/lib/version";
import { cn } from "@/lib/utils";

type OracleCliBrandProps = {
  className?: string;
  size?: "sm" | "md";
  showVersion?: boolean;
};

export function OracleCliBrand({
  className,
  size = "md",
  showVersion = true,
}: OracleCliBrandProps) {
  const textSizeClass = size === "sm" ? "text-base" : "text-lg";
  const versionPadding = size === "sm" ? "text-xs" : "text-sm";
  const logoSize = size === "sm" ? "size-6" : "size-7";
  const logoPx = size === "sm" ? 24 : 28;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <a
        href="https://mythicoracle.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <svg width={logoPx} height={logoPx} viewBox="0 0 100 100" className={logoSize}>
          <polygon points="50,8 20,44 50,56" fill="#39FF14" opacity="0.9"/>
          <polygon points="50,8 80,44 50,56" fill="#66FF44" opacity="0.75"/>
          <polygon points="20,44 50,56 80,44 50,92" fill="#1A8A0A" opacity="0.85"/>
        </svg>
        <span className={cn(textSizeClass, "font-semibold text-foreground")}>
          Oracle CLI
        </span>
      </a>
      {showVersion && (
        <span
          className={cn("text-muted-foreground font-medium", versionPadding)}
        >
          v{kimiCliVersion}
        </span>
      )}
    </div>
  );
}
