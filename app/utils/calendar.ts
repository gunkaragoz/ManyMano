export interface CalendarEventParams {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startTime?: string | null; // ISO string
  endTime?: string | null;   // ISO string
  organizerName?: string | null;
  organizerEmail?: string | null;
}

function formatDateToICS(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function generateICS(event: CalendarEventParams): string {
  const now = new Date();
  const dtStamp = formatDateToICS(now);
  
  let dtStart = dtStamp;
  let dtEnd = formatDateToICS(new Date(now.getTime() + 60 * 60 * 1000)); // default 1 hour

  if (event.startTime) {
    const parsedStart = new Date(event.startTime);
    if (!isNaN(parsedStart.getTime())) {
      dtStart = formatDateToICS(parsedStart);
      if (event.endTime) {
        const parsedEnd = new Date(event.endTime);
        if (!isNaN(parsedEnd.getTime())) {
          dtEnd = formatDateToICS(parsedEnd);
        } else {
          dtEnd = formatDateToICS(new Date(parsedStart.getTime() + 60 * 60 * 1000));
        }
      } else {
        dtEnd = formatDateToICS(new Date(parsedStart.getTime() + 60 * 60 * 1000));
      }
    }
  }

  const cleanTitle = (event.title || "ManyMano Event").replace(/\n/g, " ");
  const cleanDesc = (event.description || "").replace(/\n/g, "\\n");
  const cleanLoc = (event.location || "").replace(/\n/g, " ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ManyMano//Open Source Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@manymano.local`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${cleanTitle}`,
    cleanDesc ? `DESCRIPTION:${cleanDesc}` : null,
    cleanLoc ? `LOCATION:${cleanLoc}` : null,
    event.organizerEmail
      ? `ORGANIZER;CN=${event.organizerName || "Organizer"}:mailto:${event.organizerEmail}`
      : null,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.join("\r\n");
}
