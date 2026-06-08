import "server-only";

import type { CSSProperties } from "react";

import { getServiceSupabase } from "@/lib/supabase/server";

export interface OrganizationBrand {
  id?: string;
  name: string;
  slug?: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  bookingHeroImageUrl: string | null;
  bookingHeroSecondaryImageUrl: string | null;
}

interface OrganizationBrandRow {
  name: string;
  slug: string;
  primary_color: string | null;
  accent_color: string | null;
  logo_url: string | null;
  booking_hero_image_url: string | null;
  booking_hero_secondary_image_url: string | null;
}

type ThemeStyle = CSSProperties & Record<`--${string}`, string>;

const DEFAULT_PRIMARY = "#3f7356";
const DEFAULT_ACCENT = "#c7b17a";

export async function loadOrganizationBrand(
  organizationId: string,
): Promise<OrganizationBrand | null> {
  const service = getServiceSupabase();
  const { data, error } = await service
    .from("organizations")
    .select(
      "name, slug, primary_color, accent_color, logo_url, booking_hero_image_url, booking_hero_secondary_image_url",
    )
    .eq("id", organizationId)
    .maybeSingle<OrganizationBrandRow>();

  if (error || !data) return null;
  return {
    id: organizationId,
    name: data.name,
    slug: data.slug,
    primaryColor: data.primary_color,
    accentColor: data.accent_color,
    logoUrl: data.logo_url,
    bookingHeroImageUrl: data.booking_hero_image_url,
    bookingHeroSecondaryImageUrl: data.booking_hero_secondary_image_url,
  };
}

export function organizationThemeStyle(
  brand: Pick<OrganizationBrand, "primaryColor" | "accentColor">,
): ThemeStyle {
  const primary = sanitizeHex(brand.primaryColor) ?? DEFAULT_PRIMARY;
  const accent = sanitizeHex(brand.accentColor) ?? DEFAULT_ACCENT;
  const primaryRgb = hexToRgb(primary);
  const accentRgb = hexToRgb(accent);
  const primaryLight = mixHex(primary, "#ffffff", 0.34);
  const primaryDark = mixHex(primary, "#000000", 0.2);

  return {
    "--realtor-primary": primary,
    "--realtor-primary-rgb": rgbString(primaryRgb),
    "--realtor-primary-light": primaryLight,
    "--realtor-primary-light-rgb": rgbString(hexToRgb(primaryLight)),
    "--realtor-primary-dark": primaryDark,
    "--realtor-primary-dark-rgb": rgbString(hexToRgb(primaryDark)),
    "--realtor-accent": accent,
    "--realtor-accent-rgb": rgbString(accentRgb),
    "--realtor-border": `rgb(${rgbString(primaryRgb)} / 0.18)`,
    "--brand-glow": `rgb(${rgbString(primaryRgb)} / 0.12)`,
  };
}

export function initialsForOrganization(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "PB";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function sanitizeHex(value: string | null | undefined): string | null {
  const hex = value?.trim();
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function mixHex(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mixed = a.map((channel, index) =>
    Math.round(channel + (b[index] - channel) * amount),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function rgbString(rgb: [number, number, number]): string {
  return `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
}
