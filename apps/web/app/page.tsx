import { HomeScreen } from "@/components/home/home-screen";
import { redirect } from "next/navigation";
import { getServerDeploymentType } from "@/lib/auth/deployment";

export default async function HomePage() {
  const deploymentType = getServerDeploymentType();
  if (deploymentType === "customer") {
    redirect("/concierge");
  }

  return <HomeScreen />;
}
