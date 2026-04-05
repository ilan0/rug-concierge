"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type SiteHeaderProps = {
  storeName: string;
  storeLogoUrl: string | null;
  showNewChat: boolean;
  isNewChatDisabled?: boolean;
  onNewChat: () => void;
};

export function SiteHeader({
  storeName,
  storeLogoUrl,
  showNewChat,
  isNewChatDisabled,
  onNewChat,
}: SiteHeaderProps) {
  const [showLogo, setShowLogo] = useState(Boolean(storeLogoUrl));

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border/35 bg-background/88 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          {showLogo && storeLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={storeLogoUrl}
              alt={`${storeName} logo`}
              className="h-7 w-auto flex-shrink-0 object-contain"
              onError={() => setShowLogo(false)}
            />
          ) : null}
          <span className="truncate font-serif text-[15px] font-semibold tracking-tight text-foreground">
            {storeName}
          </span>
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          {showNewChat ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="New Chat"
              className="h-8 rounded-full border border-border/45 bg-background/65 px-3 text-xs font-medium text-foreground/80 hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"
              onClick={onNewChat}
              disabled={isNewChatDisabled}
            >
              <Plus className="mr-1 size-3.5" />
              New Chat
            </Button>
          ) : null}
          <span className="select-none text-[11px] text-muted-foreground/50">
            Powered by RugDesk
          </span>
        </div>
      </div>
    </header>
  );
}
