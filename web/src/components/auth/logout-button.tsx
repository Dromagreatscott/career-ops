"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start text-muted"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      title="Sign out"
    >
      <LogOut className="size-4" />
      Sign out
    </Button>
  );
}

