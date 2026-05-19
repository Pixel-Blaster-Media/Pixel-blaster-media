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

export type CatalogItemKind = "bundle" | "a_la_carte" | "addon";

export type ListingWebsiteTemplate =
  | "estate_cinematic"
  | "clean_mls_plus"
  | "modern_forest"
  | "editorial_magazine";

interface ProfilesTable {
  Row: {
    id: string;
    organization_id: string;
    email: string;
    full_name: string | null;
    phone: string | null;
    brokerage: string | null;
    profile_photo_url: string | null;
    brokerage_logo_url: string | null;
    website_url: string | null;
    instagram_url: string | null;
    delivery_cc_emails: string[];
    internal_notes: string | null;
    role: UserRole;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id: string;
    organization_id?: string;
    email: string;
    full_name?: string | null;
    phone?: string | null;
    brokerage?: string | null;
    profile_photo_url?: string | null;
    brokerage_logo_url?: string | null;
    website_url?: string | null;
    instagram_url?: string | null;
    delivery_cc_emails?: string[];
    internal_notes?: string | null;
    role?: UserRole;
  };
  Update: Partial<ProfilesTable["Insert"]>;
  Relationships: [];
}

interface PropertiesTable {
  Row: {
    id: string;
    organization_id: string;
    owner_id: string;
    street_address: string;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    mls_number: string | null;
    notes: string | null;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id?: string;
    owner_id: string;
    street_address: string;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    mls_number?: string | null;
    notes?: string | null;
    archived_at?: string | null;
  };
  Update: Partial<PropertiesTable["Insert"]>;
  Relationships: [];
}

interface BookingsTable {
  Row: {
    id: string;
    organization_id: string;
    property_id: string;
    owner_id: string;
    status: BookingStatus;
    scheduled_at: string | null;
    scheduled_ends_at: string | null;
    services: string[];
    add_ons: string[];
    square_footage: number | null;
    internal_notes: string | null;
    client_notes: string | null;
    iguide_id: string | null;
    iguide_portal_id: string | null;
    fotello_listing_id: string | null;
    quickbooks_invoice_id: string | null;
    quickbooks_invoice_number: string | null;
    quickbooks_invoice_url: string | null;
    quickbooks_invoice_status: string | null;
    quickbooks_invoice_total_cents: number | null;
    quickbooks_invoice_synced_at: string | null;
    google_calendar_event_id: string | null;
    google_calendar_event_url: string | null;
    unit_number: string | null;
    is_vacant: "vacant" | "occupied" | "partial" | null;
    include_basement: boolean | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id?: string;
    property_id: string;
    owner_id: string;
    status?: BookingStatus;
    scheduled_at?: string | null;
    scheduled_ends_at?: string | null;
    services?: string[];
    add_ons?: string[];
    square_footage?: number | null;
    internal_notes?: string | null;
    client_notes?: string | null;
    iguide_id?: string | null;
    iguide_portal_id?: string | null;
    fotello_listing_id?: string | null;
    quickbooks_invoice_id?: string | null;
    quickbooks_invoice_number?: string | null;
    quickbooks_invoice_url?: string | null;
    quickbooks_invoice_status?: string | null;
    quickbooks_invoice_total_cents?: number | null;
    quickbooks_invoice_synced_at?: string | null;
    google_calendar_event_id?: string | null;
    google_calendar_event_url?: string | null;
    unit_number?: string | null;
    is_vacant?: "vacant" | "occupied" | "partial" | null;
    include_basement?: boolean | null;
  };
  Update: Partial<BookingsTable["Insert"]>;
  Relationships: [];
}

interface GoogleCalendarConnectionTable {
  Row: {
    id: number;
    organization_id: string;
    google_account_email: string;
    calendar_id: string;
    refresh_token: string;
    access_token: string | null;
    access_token_expires_at: string | null;
    connected_at: string;
    connected_by: string | null;
    updated_at: string;
  };
  Insert: {
    id?: number;
    organization_id?: string;
    google_account_email: string;
    calendar_id?: string;
    refresh_token: string;
    access_token?: string | null;
    access_token_expires_at?: string | null;
    connected_by?: string | null;
  };
  Update: Partial<GoogleCalendarConnectionTable["Insert"]>;
  Relationships: [];
}

interface OrganizationsTable {
  Row: {
    id: string;
    name: string;
    slug: string;
    primary_color: string | null;
    accent_color: string | null;
    logo_url: string | null;
    email_from_name: string | null;
    reply_to_email: string | null;
    admin_notification_email: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    name: string;
    slug: string;
    primary_color?: string | null;
    accent_color?: string | null;
    logo_url?: string | null;
    email_from_name?: string | null;
    reply_to_email?: string | null;
    admin_notification_email?: string | null;
  };
  Update: Partial<OrganizationsTable["Insert"]>;
  Relationships: [];
}

interface OrganizationMembersTable {
  Row: {
    organization_id: string;
    profile_id: string;
    role: "owner" | "admin" | "member";
    created_at: string;
  };
  Insert: {
    organization_id: string;
    profile_id: string;
    role?: "owner" | "admin" | "member";
  };
  Update: Partial<OrganizationMembersTable["Insert"]>;
  Relationships: [];
}

interface IntegrationCredentialsTable {
  Row: {
    organization_id: string;
    provider: string;
    credentials: Record<string, string>;
    updated_at: string;
    updated_by: string | null;
  };
  Insert: {
    organization_id?: string;
    provider: string;
    credentials?: Record<string, string>;
    updated_by?: string | null;
  };
  Update: Partial<IntegrationCredentialsTable["Insert"]>;
  Relationships: [];
}

interface IGuideJobsTable {
  Row: {
    id: string;
    organization_id: string;
    booking_id: string;
    property_id: string;
    iguide_id: string;
    alias: string | null;
    work_order_id: string | null;
    default_view_id: string | null;
    status: string;
    match_source: string;
    raw_create_response: Json;
    raw_ready_event: Json | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id?: string;
    booking_id: string;
    property_id: string;
    iguide_id: string;
    alias?: string | null;
    work_order_id?: string | null;
    default_view_id?: string | null;
    status?: string;
    match_source?: string;
    raw_create_response?: Json;
    raw_ready_event?: Json | null;
    last_error?: string | null;
  };
  Update: Partial<IGuideJobsTable["Insert"]>;
  Relationships: [];
}

interface IGuideWebhookEventsTable {
  Row: {
    id: string;
    organization_id: string;
    event_type: string;
    iguide_id: string;
    work_order_id: string | null;
    alias: string | null;
    payload_json: Json;
    match_status: string;
    matched_booking_id: string | null;
    match_source: string | null;
    processed_at: string | null;
    last_error: string | null;
    received_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id?: string;
    event_type: string;
    iguide_id: string;
    work_order_id?: string | null;
    alias?: string | null;
    payload_json?: Json;
    match_status?: string;
    matched_booking_id?: string | null;
    match_source?: string | null;
    processed_at?: string | null;
    last_error?: string | null;
  };
  Update: Partial<IGuideWebhookEventsTable["Insert"]>;
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
    organization_id: string;
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
    cart: Json;
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
    organization_id?: string;
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
    cart?: Json;
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
    organization_id: string;
    day_of_week: number; // 0 = Sunday, 6 = Saturday
    start_time: string; // HH:MM:SS
    end_time: string;
    enabled: boolean;
    updated_at: string;
  };
  Insert: {
    organization_id?: string;
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
    organization_id: string;
    starts_at: string;
    ends_at: string;
    label: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id?: string;
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
    organization_id: string;
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
    organization_id?: string;
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
    organization_id: string;
    price_cents: number;
    taxable: boolean;
    updated_at: string;
    updated_by: string | null;
  };
  Insert: {
    service_id: string;
    organization_id?: string;
    price_cents?: number;
    taxable?: boolean;
    updated_by?: string | null;
  };
  Update: Partial<ServicePricesTable["Insert"]>;
  Relationships: [];
}

interface CatalogItemsTable {
  Row: {
    id: string;
    organization_id: string;
    kind: CatalogItemKind;
    slug: string;
    name: string;
    description: string;
    duration_minutes: number;
    price_cents: number;
    sqft_pricing_enabled: boolean;
    included_sqft: number | null;
    overage_increment_sqft: number | null;
    overage_price_cents: number | null;
    taxable: boolean;
    active: boolean;
    display_order: number;
    is_photo: boolean;
    is_video: boolean;
    require_has_video: boolean;
    badge: string | null;
    highlight: boolean;
    ideal_for: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id?: string;
    kind: CatalogItemKind;
    slug: string;
    name: string;
    description?: string;
    duration_minutes?: number;
    price_cents?: number;
    sqft_pricing_enabled?: boolean;
    included_sqft?: number | null;
    overage_increment_sqft?: number | null;
    overage_price_cents?: number | null;
    taxable?: boolean;
    active?: boolean;
    display_order?: number;
    is_photo?: boolean;
    is_video?: boolean;
    require_has_video?: boolean;
    badge?: string | null;
    highlight?: boolean;
    ideal_for?: string | null;
  };
  Update: Partial<CatalogItemsTable["Insert"]>;
  Relationships: [];
}

interface BookingLineItemsTable {
  Row: {
    id: string;
    booking_id: string;
    catalog_item_id: string;
    quantity: number;
    unit_price_cents: number;
    unit_duration_minutes: number;
    created_at: string;
  };
  Insert: {
    id?: string;
    booking_id: string;
    catalog_item_id: string;
    quantity?: number;
    unit_price_cents: number;
    unit_duration_minutes: number;
  };
  Update: Partial<BookingLineItemsTable["Insert"]>;
  Relationships: [];
}

interface BookingNotificationsTable {
  Row: {
    id: string;
    booking_id: string;
    kind: string;
    sent_at: string;
    recipient_email: string;
  };
  Insert: {
    id?: string;
    booking_id: string;
    kind: string;
    sent_at?: string;
    recipient_email: string;
  };
  Update: Partial<BookingNotificationsTable["Insert"]>;
  Relationships: [];
}

interface ListingWebsitesTable {
  Row: {
    id: string;
    organization_id: string;
    property_id: string;
    booking_id: string | null;
    owner_id: string;
    template: ListingWebsiteTemplate;
    slug: string;
    is_published: boolean;
    headline: string | null;
    description: string | null;
    feature_bullets: string[];
    included_sections: string[];
    gallery_image_urls: string[] | null;
    hero_image_url: string | null;
    agent_name: string | null;
    agent_email: string | null;
    agent_phone: string | null;
    brokerage_name: string | null;
    cta_text: string | null;
    cta_url: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id?: string;
    property_id: string;
    booking_id?: string | null;
    owner_id: string;
    template?: ListingWebsiteTemplate;
    slug: string;
    is_published?: boolean;
    headline?: string | null;
    description?: string | null;
    feature_bullets?: string[];
    included_sections?: string[];
    gallery_image_urls?: string[] | null;
    hero_image_url?: string | null;
    agent_name?: string | null;
    agent_email?: string | null;
    agent_phone?: string | null;
    brokerage_name?: string | null;
    cta_text?: string | null;
    cta_url?: string | null;
  };
  Update: Partial<ListingWebsitesTable["Insert"]>;
  Relationships: [];
}

export interface Database {
  public: {
    Tables: {
      profiles: ProfilesTable;
      organizations: OrganizationsTable;
      organization_members: OrganizationMembersTable;
      properties: PropertiesTable;
      bookings: BookingsTable;
      deliverables: DeliverablesTable;
      booking_requests: BookingRequestsTable;
      business_hours: BusinessHoursTable;
      calendar_blocks: CalendarBlocksTable;
      quickbooks_connection: QuickBooksConnectionTable;
      service_prices: ServicePricesTable;
      catalog_items: CatalogItemsTable;
      booking_line_items: BookingLineItemsTable;
      booking_notifications: BookingNotificationsTable;
      listing_websites: ListingWebsitesTable;
      google_calendar_connection: GoogleCalendarConnectionTable;
      integration_credentials: IntegrationCredentialsTable;
      iguide_jobs: IGuideJobsTable;
      iguide_webhook_events: IGuideWebhookEventsTable;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      current_organization_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_organization_admin: {
        Args: { target_org_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      booking_status: BookingStatus;
      deliverable_type: DeliverableType;
      deliverable_source: DeliverableSource;
      booking_request_status: BookingRequestStatus;
      catalog_item_kind: CatalogItemKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
