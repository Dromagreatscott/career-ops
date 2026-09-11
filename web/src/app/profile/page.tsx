import { commandCenterData } from "@/lib/command-center/service";
import { ProfileCommandCenter } from "@/components/command-center/profile-command-center";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const { profile } = commandCenterData();
  return <ProfileCommandCenter profile={profile} />;
}
