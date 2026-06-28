/**
 * Custom email reminder cron (self-host). cal.diy has no built-in Workflows feature, so this sends
 * booking reminders to attendees: one ~24h before and one ~1h before the event. Idempotent — each
 * reminder is recorded under `Booking.metadata.reminders` so it's never sent twice. Sends via the
 * Resend HTTP API (same key/domain as SMTP). Invoked by a Vercel cron every 15 min.
 *
 * Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET`. `?dryRun=1` reports what would send
 * without sending or marking (for verification).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { BookingStatus } from "@calcom/prisma/enums";

const HOUR = 60 * 60 * 1000;
const WEBAPP_URL = process.env.NEXT_PUBLIC_WEBAPP_URL || "https://calendar.charliemeyer.xyz";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function fmt(date: Date, timeZone: string, locale: string | null) {
  try {
    return new Intl.DateTimeFormat(locale || "en", { dateStyle: "full", timeStyle: "short", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short", timeZone: "UTC" }).format(date);
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  const from = process.env.EMAIL_FROM_NAME
    ? `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`
    : process.env.EMAIL_FROM;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.EMAIL_SERVER_PASSWORD}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  return res.ok;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const apiKey = req.headers.get("authorization") || url.searchParams.get("apiKey");
  if (![process.env.CRON_API_KEY, `Bearer ${process.env.CRON_SECRET}`].includes(`${apiKey}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = url.searchParams.get("dryRun") === "1";

  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: { status: BookingStatus.ACCEPTED, startTime: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } },
    select: {
      id: true,
      uid: true,
      title: true,
      startTime: true,
      metadata: true,
      attendees: { select: { email: true, name: true, timeZone: true, locale: true } },
    },
    take: 200,
  });

  const plan: { uid: string; kind: string; to: string[] }[] = [];
  let sent = 0;

  for (const booking of bookings) {
    const minutesUntil = (booking.startTime.getTime() - now.getTime()) / 60000;
    const metadata = (booking.metadata ?? {}) as Prisma.JsonObject;
    const reminders = (metadata.reminders ?? {}) as Prisma.JsonObject;

    const kind = minutesUntil <= 70 && !reminders.h1 ? "h1" : minutesUntil > 70 && !reminders.h24 ? "h24" : null;
    if (!kind) continue;
    if (booking.attendees.length === 0) continue;

    plan.push({ uid: booking.uid, kind, to: booking.attendees.map((a) => a.email) });
    if (dryRun) continue;

    const when = kind === "h1" ? "in about an hour" : "tomorrow";
    for (const a of booking.attendees) {
      const subject = `Reminder: ${booking.title} ${when}`;
      const html =
        `<p>Hi ${esc(a.name || "there")},</p>` +
        `<p>This is a reminder for <strong>${esc(booking.title)}</strong>, ${when}.</p>` +
        `<p>🗓 ${esc(fmt(booking.startTime, a.timeZone, a.locale))} (${esc(a.timeZone)})</p>` +
        `<p><a href="${WEBAPP_URL}/booking/${booking.uid}">View or reschedule</a></p>`;
      if (await sendEmail(a.email, subject, html)) sent++;
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: { metadata: { ...metadata, reminders: { ...reminders, [kind]: true } } },
    });
  }

  return NextResponse.json({ ok: true, dryRun, candidates: plan.length, emailsSent: sent, plan });
}
