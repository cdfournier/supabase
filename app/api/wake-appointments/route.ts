import { NextResponse } from "next/server";

import { writeCapabilityAccessLevelForSurface } from "@/lib/capability-profile";
import {
  statusWithSettings,
  updateWakeAppointmentPolicy
} from "@/lib/agent-wake-appointments";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await statusWithSettings());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load wake appointments." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (String(body.action) !== "set_policy") {
      return NextResponse.json({ error: 'Choose action "set_policy".' }, { status: 400 });
    }

    const agent = requiredAgent(body.agent);
    const enabled = body.enabled === true;
    const policy = await updateWakeAppointmentPolicy(agent, {
      enabled,
      allow_quiet_time_interrupt: body.allowQuietTimeInterrupt === true,
      quiet_start_minute: hasOwn(body, "quietStartMinute") ? optionalQuietMinute(body.quietStartMinute) : undefined,
      quiet_end_minute: hasOwn(body, "quietEndMinute") ? optionalQuietMinute(body.quietEndMinute) : undefined,
      timezone: optionalTimezone(body.timezone)
    });
    await writeCapabilityAccessLevelForSurface(
      getSupabaseAdmin(),
      agent,
      "wake_appointments",
      enabled ? "write" : "off"
    );

    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save wake appointment policy." },
      { status: 500 }
    );
  }
}

function requiredAgent(value: unknown): "soren" | "varro" {
  if (value === "soren" || value === "varro") {
    return value;
  }
  throw new Error("Wake appointment policy agent must be soren or varro.");
}

function optionalQuietMinute(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const minute = Number(value);
  if (!Number.isInteger(minute) || minute < 0 || minute > 1439) {
    throw new Error("Quiet-time values must be whole minutes from 0 through 1439.");
  }
  return minute;
}

function optionalTimezone(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const timezone = String(value).trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error("Timezone must be a valid IANA timezone name.");
  }
  return timezone;
}

function hasOwn(value: unknown, key: string): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key);
}
