import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { CoMark } from "@/components/co-mark";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/auth/request";
import { instrumentSerif } from "@/lib/fonts";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next ?? "/");
  const session = await auth();
  if (session?.user?.id) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <CoMark size={36} />
          <div>
            <h1 className={`${instrumentSerif.className} text-3xl text-landing`}>career-ops</h1>
            <p className="text-sm text-muted">Operator access</p>
          </div>
        </div>
        <LoginForm next={next} />
      </section>
    </main>
  );
}

