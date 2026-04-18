import { NextResponse } from "next/server";
import { clientPromise } from "@/lib/mongodb";

export async function GET() {
  try {
    const client = await clientPromise;
    await client.db("admin").command({ ping: 1 });

    return NextResponse.json({
      ok: true,
      message: "MongoDB connection successful",
    });
  } catch (err) {
    console.error("[GET /api/test-db]", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Could not connect to MongoDB",
        details: process.env.NODE_ENV === "development" ? String(err?.message ?? err) : undefined,
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";
