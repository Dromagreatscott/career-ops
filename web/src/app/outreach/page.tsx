import { commandCenterData } from "@/lib/command-center/service";
import { OutreachBoard } from "@/components/command-center/outreach-board";

export const dynamic = "force-dynamic";

export default function OutreachPage() {
  const { outreach } = commandCenterData();
  return <OutreachBoard outreach={outreach} />;
}
