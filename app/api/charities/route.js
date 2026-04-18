import { NextResponse } from "next/server";
import { listCharitiesPublic } from "@/lib/charities";

// Public list for the charity dropdown at goal creation time.
// Intentionally omits XRPL addresses so the client never has to render
// or verify them; the server re-resolves the id at goal create time.

export async function GET() {
  return NextResponse.json({ charities: listCharitiesPublic() });
}

export const runtime = "nodejs";
