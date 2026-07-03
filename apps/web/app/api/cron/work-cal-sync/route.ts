/**
 * Reliable work-calendar sync (self-host). The BOOKING_CREATED webhook (/api/work-cal-sync) is
 * delivered asynchronously via cal.diy's Tasker and proved unreliable, so this cron is the source of
 * truth: for every upcoming accepted booking it ensures charlie.meyer@cognition.ai is a guest on the
 * booking's Google event (so it also lands on the work calendar). Idempotent + reschedule-safe via
 * `Booking.metadata.workSyncedEventId` (the Google event id we last synced); a reschedule produces a
 * new event id, so it re-syncs. Runs every 5 min.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus } from "@calcom/prisma/enums";

const WORK_EMAIL = "charlie.meyer@cognition.ai";

function str(obj: Prisma.JsonObject, k: string) {
  const v = obj[k];
  return typeof v === "string" ? v : null;
}

async function freshToken(key: Prisma.JsonObject, appKeys: Prisma.JsonObject) {
  const refresh = str(key, "refresh_token");
  const clientId = str(appKeys, "client_id");
  const clientSecret = str(appKeys, "client_secret");
  if (!refresh || !clientId || !clientSecret) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { access_token?: string }).access_token ?? null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const apiKey = req.headers.get("authorization") || url.searchParams.get("apiKey");
  if (![process.env.CRON_API_KEY, `Bearer ${process.env.CRON_SECRET}`].includes(`${apiKey}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const app = await prisma.app.findUnique({ where: { slug: "google-calendar" }, select: { keys: true } });
  if (!app?.keys) return NextResponse.json({ error: "no google app keys" }, { status: 500 });
  const appKeys = app.keys as Prisma.JsonObject;

  const bookings = await prisma.booking.findMany({
    where: { status: BookingStatus.ACCEPTED, startTime: { gt: new Date() } },
    select: { id: true, uid: true, metadata: true, references: { select: { type: true, uid: true, credentialId: true } } },
    orderBy: { startTime: "asc" },
    take: 200,
  });

  const tokenCache = new Map<number, string | null>();
  let synced = 0;
  const results: { uid: string; action: string }[] = [];

  for (const booking of bookings) {
    const ref = booking.references.find((r) => r.type === "google_calendar" && r.uid && r.credentialId);
    if (!ref?.uid || !ref.credentialId) continue;

    const metadata = (booking.metadata ?? {}) as Prisma.JsonObject;
    if (str(metadata, "workSyncedEventId") === ref.uid) continue; // already synced this event

    if (!tokenCache.has(ref.credentialId)) {
      const cred = await prisma.credential.findUnique({ where: { id: ref.credentialId }, select: { key: true } });
      tokenCache.set(ref.credentialId, cred?.key ? await freshToken(cred.key as Prisma.JsonObject, appKeys) : null);
    }
    const accessToken = tokenCache.get(ref.credentialId);
    if (!accessToken) continue;

    const base = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ref.uid)}`;
    const getRes = await fetch(base, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!getRes.ok) continue;
    const event = (await getRes.json()) as { attendees?: { email?: string; responseStatus?: string }[] };
    const attendees = event.attendees ?? [];

    if (!attendees.some((a) => a.email?.toLowerCase() === WORK_EMAIL.toLowerCase())) {
      // pre-accept so the event shows on the work calendar without inbox action + counts as busy
      attendees.push({ email: WORK_EMAIL, responseStatus: "accepted" });
      const patchRes = await fetch(`${base}?sendUpdates=all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ attendees }),
      });
      if (!patchRes.ok) continue;
      synced++;
      results.push({ uid: booking.uid, action: "added-guest" });
    } else {
      results.push({ uid: booking.uid, action: "already-present" });
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: { metadata: { ...metadata, workSyncedEventId: ref.uid } },
    });
  }

  return NextResponse.json({ ok: true, scanned: bookings.length, guestsAdded: synced, results });
}
