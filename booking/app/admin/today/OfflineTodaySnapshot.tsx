"use client";

import { useEffect } from "react";

export interface OfflineTodayData {
  dateLabel: string;
  updatedAt: string;
  shoots: Array<{
    id: string;
    time: string;
    address: string;
    city: string;
    packageName: string;
    status: string;
  }>;
}

export default function OfflineTodaySnapshot({
  userId,
  data,
}: {
  userId: string;
  data: OfflineTodayData;
}) {
  useEffect(() => {
    try {
      window.localStorage.setItem(
        `pixel-booking:offline-today:${userId}`,
        JSON.stringify(data),
      );
    } catch (error) {
      console.warn("[pwa] could not save offline Today snapshot", error);
    }
  }, [data, userId]);

  return null;
}
