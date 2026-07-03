/**
 * Custom webhook (self-host): on BOOKING_CREATED / BOOKING_RESCHEDULED, add the work email
 * (charlie.meyer@cognition.ai) as a guest on the booking's Google Calendar event, so the booking
 * also lands on the work calendar and the work address gets the invite/email.
 *
 * cal.com writes bookings to a single destination calendar (the personal one). The Cognition
 * calendar is connected free/busy-only and can't be a destination, so we add it as an attendee
 * here instead. Secured by a shared secret in the subscriber URL (?secret=...).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";

const WORK_EMAIL = "charlie.meyer@cognition.ai";

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

function str(obj: Prisma.JsonObject, k: string) {
  const v = obj[k];
  return typeof v === "string" ? v : null;
}

export async function POST(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WORK_CAL_SYNC_SECRET || secret !== process.env.WORK_CAL_SYNC_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { payload?: { uid?: string } } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const bookingUid = body?.payload?.uid;
  if (!bookingUid) return NextResponse.json({ ok: true, skipped: "no booking uid" });

  const booking = await prisma.booking.findUnique({
    where: { uid: bookingUid },
    select: { references: { select: { type: true, uid: true, credentialId: true } } },
  });
  const ref = booking?.references.find(
    (r) => r.type === "google_calendar" && r.uid && r.credentialId
  );
  if (!ref?.uid || !ref.credentialId) {
    return NextResponse.json({ ok: true, skipped: "no google calendar reference" });
  }

  const [credential, app] = await Promise.all([
    prisma.credential.findUnique({ where: { id: ref.credentialId }, select: { key: true } }),
    prisma.app.findUnique({ where: { slug: "google-calendar" }, select: { keys: true } }),
  ]);
  if (!credential?.key || !app?.keys) {
    return NextResponse.json({ ok: true, skipped: "missing credential or app keys" });
  }

  const key = credential.key as Prisma.JsonObject;
  const keys = app.keys as Prisma.JsonObject;
  const refreshToken = str(key, "refresh_token");
  const clientId = str(keys, "client_id");
  const clientSecret = str(keys, "client_secret");
  if (!refreshToken || !clientId || !clientSecret) {
    return NextResponse.json({ ok: true, skipped: "incomplete google credentials" });
  }

  const accessToken = await refreshAccessToken(refreshToken, clientId, clientSecret);
  if (!accessToken) return NextResponse.json({ error: "token refresh failed" }, { status: 502 });

  const eventId = ref.uid;
  const base = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;

  const getRes = await fetch(base, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!getRes.ok) {
    return NextResponse.json({ error: "event fetch failed", status: getRes.status }, { status: 502 });
  }
  const event = (await getRes.json()) as { attendees?: { email?: string; responseStatus?: string }[] };
  const attendees = event.attendees ?? [];
  if (attendees.some((a) => a.email?.toLowerCase() === WORK_EMAIL.toLowerCase())) {
    return NextResponse.json({ ok: true, alreadyPresent: true });
  }
  // pre-accept so the event shows on the work calendar without inbox action + counts as busy
  attendees.push({ email: WORK_EMAIL, responseStatus: "accepted" });

  const patchRes = await fetch(`${base}?sendUpdates=all`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ attendees }),
  });
  if (!patchRes.ok) {
    return NextResponse.json({ error: "event patch failed", status: patchRes.status }, { status: 502 });
  }

  return NextResponse.json({ ok: true, added: WORK_EMAIL });
}
