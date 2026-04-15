// Hand-authored Supabase types covering the schema in
// supabase/migrations/. Once you provision Supabase, regenerate this file
// from the actual schema to pick up policies, function returns, and any
// drift:
//
//   npx supabase gen types typescript \
//     --project-id YOUR-PROJECT-REF > lib/supabase/database.types.ts
//
//   # or, with the local CLI linked:
//   npm run db:types
//
// Until then this hand-written shape keeps the Supabase clients usable
// from typed call sites.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "realtor" | "admin";

export type BookingStatus =
  | "requested"
  | "confirmed"
  | "shot"
  | "editing"
  | "delivered"
  | "cancelled";

export type DeliverableType =
  | "photo_gallery"
  | "virtual_tour"
  | "floor_plan"
  | "video"
  | "aerial";

export type DeliverableSource = "fotello" | "iguide" | "manual";

export type BookingRequestStatus =
  | "new"
  | "reviewing"
  | "accepted"
  | "declined";

interface ProfilesTable {
  Row: {
    id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    brokerage: string | null;
    role: UserRole;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id: string;
    email: string;
    full_name?: string | null;
    phone?: string | null;
    brokerage?: string | null;
    role?: UserRole;
  };
  Update: Partial<ProfilesTable["Insert"]>;
  Relationships: [];
}

interface PropertiesTable {
  Row: {
    id: string;
    owner_id: string;
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    mls_number: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    owner_id: string;
    street_address: string;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    mls_number?: string | null;
    notes?: string | null;
  };
  Update: Partial<PropertiesTable["Insert"]>;
  Relationships: [];
}

interface BookingsTable {
  Row: {
    id: string;
    property_id: string;
    owner_id: string;
    status: BookingStatus;
    scheduled_at: string | null;
    services: string[];
    add_ons: string[];
    square_footage: number | null;
    internal_notes: string | null;
    client_notes: string | null;
    iguide_id: string | null;
    fotello_listing_id: string | null;
    quickbooks_invoice_id: string | null;
    quickbooks_invoice_number: string | null;
    quickbooks_invoice_url: string | null;
    quickbooks_invoice_status: string | null;
    quickbooks_invoice_total_cents: number | null;
    quickbooks_invoice_synced_at: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    property_id: string;
    owner_id: string;
    status?: BookingStatus;
    scheduled_at?: string | null;
    services?: string[];
    add_ons?: string[];
    square_footage?: number | null;
    internal_notes?: string | null;
    client_notes?: string | null;
    iguide_id?: string | null;
    fotello_listing_id?: string | null;
    quickbooks_invoice_id?: string | null;
    quickbooks_invoice_number?: string | null;
    quickbooks_invoice_url?: string | null;
    quickbooks_invoice_status?: string | null;
    quickbooks_invoice_total_cents?: number | null;
    quickbooks_invoice_synced_at?: string | null;
  };
  Update: Partial<BookingsTable["Insert"]>;
  Relationships: [];
}

interface DeliverablesTable {
  Row: {
    id: string;
    booking_id: string;
    property_id: string;
    type: DeliverableType;
    source: DeliverableSource;
    external_id: string | null;
    url: string;
    embed_html: string | null;
    thumbnail_url: string | null;
    metadata: Json;
    ready_at: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    booking_id: string;
    property_id: string;
    type: DeliverableType;
    source: DeliverableSource;
    external_id?: string | null;
    url: string;
    embed_html?: string | null;
    thumbnail_url?: string | null;
    metadata?: Json;
    ready_at?: string | null;
  };
  Update: Partial<DeliverablesTable["Insert"]>;
  Relationships: [];
}

interface BookingRequestsTable {
  Row: {
    id: string;
    status: BookingRequestStatus;
    contact_name: string;
    contact_email: string;
    contact_phone: string | null;
    brokerage: string | null;
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    square_footage: number | null;
    services: string[];
    add_ons: string[];
    preferred_date: string | null;
    preferred_time: string | null;
    notes: string | null;
    booking_id: string | null;
    source: string | null;
    user_agent: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    status?: BookingRequestStatus;
    contact_name: string;
    contact_email: string;
    contact_phone?: string | null;
    brokerage?: string | null;
    street_address: string;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    square_footage?: number | null;
    services?: string[];
    add_ons?: string[];
    preferred_date?: string | null;
    preferred_time?: string | null;
    notes?: string | null;
    booking_id?: string | null;
    source?: string | null;
    user_agent?: string | null;
  };
  Update: Partial<BookingRequestsTable["Insert"]>;
  Relationships: [];
}

interface BusinessHoursTable {
  Row: {
    day_of_week: number; // 0 = Sunday, 6 = Saturday
    start_time: string; // HH:MM:SS
    end_time: string;
    enabled: boolean;
    updated_at: string;
  };
  Insert: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    enabled?: boolean;
  };
  Update: Partial<BusinessHoursTable["Insert"]>;
  Relationships: [];
}

interface CalendarBlocksTable {
  Row: {
    id: string;
    starts_at: string;
    ends_at: string;
    label: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    starts_at: string;
    ends_at: string;
    label?: string | null;
  };
  Update: Partial<CalendarBlocksTable["Insert"]>;
  Relationships: [];
}

interface QuickBooksConnectionTable {
  Row: {
    id: number;
    environment: "sandbox" | "production";
    realm_id: string;
    refresh_token: string;
    access_token: string | null;
    access_token_expires_at: string | null;
    default_item_id: string | null;
    connected_at: string;
    connected_by: string | null;
    updated_at: string;
  };
  Insert: {
    id?: number;
    environment: "sandbox" | "production";
    realm_id: string;
    refresh_token: string;
    access_token?: string | null;
    access_token_expires_at?: string | null;
    default_item_id?: string | null;
    connected_by?: string | null;
  };
  Update: Partial<QuickBooksConnectionTable["Insert"]>;
  Relationships: [];
}

interface ServicePricesTable {
  Row: {
    service_id: string;
    price_cents: number;
    taxable: boolean;
    updated_at: string;
    updated_by: string | null;
  };
  Insert: {
    service_id: string;
    price_cents?: number;
    taxable?: boolean;
    updated_by?: string | null;
  };
  Update: Partial<ServicePricesTable["Insert"]>;
  Relationships: [];
}

export interface Database {
  public: {
    Tables: {
      profiles: ProfilesTable;
      properties: PropertiesTable;
      bookings: BookingsTable;
      deliverables: DeliverablesTable;
      booking_requests: BookingRequestsTable;
      business_hours: BusinessHoursTable;
      calendar_blocks: CalendarBlocksTable;
      quickbooks_connection: QuickBooksConnectionTable;
      service_prices: ServicePricesTable;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      booking_status: BookingStatus;
      deliverable_type: DeliverableType;
      deliverable_source: DeliverableSource;
      booking_request_status: BookingRequestStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
