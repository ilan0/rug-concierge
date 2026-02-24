import { NextResponse } from "next/server";
import {
  applyPilotAccessCookie,
  getPilotAccessState,
  isPilotAccessEnabled,
  isPilotPasscodeValid,
} from "@/lib/auth/pilot-access";

export async function GET() {
  const state = await getPilotAccessState();
  return NextResponse.json(state);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { passcode?: unknown; clear?: unknown }
    | null;
  const clear = Boolean(body?.clear);

  if (!isPilotAccessEnabled()) {
    return NextResponse.json({ required: false, verified: true, ok: true });
  }

  if (clear) {
    const response = NextResponse.json({ required: true, verified: false, ok: true });
    applyPilotAccessCookie(response, false);
    return response;
  }

  const passcode = typeof body?.passcode === "string" ? body.passcode.trim() : "";
  if (!passcode || !isPilotPasscodeValid(passcode)) {
    const response = NextResponse.json(
      { required: true, verified: false, error: "Invalid passcode." },
      { status: 401 }
    );
    applyPilotAccessCookie(response, false);
    return response;
  }

  const response = NextResponse.json({ required: true, verified: true, ok: true });
  applyPilotAccessCookie(response, true);
  return response;
}
