import { HomeScreen } from "@/components/home/home-screen";
import { redirect } from "next/navigation";
import { getServerDeploymentType } from "@/lib/auth/deployment";
import { getPilotAccessState } from "@/lib/auth/pilot-access";

export default async function HomePage() {
  const deploymentType = getServerDeploymentType();
  if (deploymentType === "customer") {
    redirect("/concierge");
  }

  if (deploymentType === "staff") {
    const access = await getPilotAccessState();
    if (access.verified) {
      redirect("/join");
    }
  }

  return <HomeScreen />;
}
