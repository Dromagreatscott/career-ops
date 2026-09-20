"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const form = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await signIn("credentials", {
            username: String(form.get("username") ?? ""),
            password: String(form.get("password") ?? ""),
            redirect: false,
          });
          if (result?.error) {
            setError("Sign in failed.");
            return;
          }
          router.replace(next);
          router.refresh();
        });
      }}
    >
      <label className="block text-sm font-medium text-foreground">
        Operator
        <input
          name="username"
          autoComplete="username"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
          required
        />
      </label>
      <label className="block text-sm font-medium text-foreground">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
          required
        />
      </label>
      {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

